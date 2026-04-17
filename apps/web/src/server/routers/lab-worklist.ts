import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  labOrders, labResults, labPanels, labPanelComponents,
  patients, encounters, users, externalLabOrders, externalLabs
} from '@db/schema';
import {
  eq, and, or, sql, desc, asc, count, like, gte, lte, ne, inArray
} from 'drizzle-orm';

/* ================================================================= */
/*  Validation Schemas                                               */
/* ================================================================= */

const barcodeSchema = z.object({
  order_number: z.string().min(1),
});

/* ================================================================= */
/*  Router                                                           */
/* ================================================================= */

export const labWorklistRouter = router({

  /* ----- Summary Counts ----- */
  worklistSummary: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Pending collection: status = ordered
        const pendingCollection = await db
          .select({ count: count() })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'ordered' as any)
            )
          );

        // In transit: status = collected
        const inTransit = await db
          .select({ count: count() })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'collected' as any)
            )
          );

        // Processing: status IN (received, processing)
        const processing = await db
          .select({ count: count() })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              or(
                eq(labOrders.status, 'received' as any),
                eq(labOrders.status, 'processing' as any)
              )
            )
          );

        // Pending verification: status = resulted
        const pendingVerification = await db
          .select({ count: count() })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'resulted' as any)
            )
          );

        // Verified today: status = verified AND verified_at >= today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const verifiedToday = await db
          .select({ count: count() })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'verified' as any),
              gte(labOrders.verified_at, today)
            )
          );

        // Critical values: lab_results with critical flags
        const criticalValues = await db
          .select({ count: count() })
          .from(labResults)
          .where(
            and(
              eq(labResults.hospital_id, hospitalId),
              eq(labResults.is_critical, true)
            )
          );

        // Outsourced pending: external lab orders NOT in terminal state
        const outsourcedPending = await db
          .select({ count: count() })
          .from(externalLabOrders)
          .where(
            and(
              eq(externalLabOrders.hospital_id, hospitalId),
              or(
                eq(externalLabOrders.status, 'pending_dispatch' as any),
                eq(externalLabOrders.status, 'dispatched' as any),
                eq(externalLabOrders.status, 'received_by_lab' as any),
                eq(externalLabOrders.status, 'processing' as any),
                eq(externalLabOrders.status, 'results_received' as any),
                eq(externalLabOrders.status, 'results_entered' as any)
              )
            )
          );

        return {
          pending_collection: pendingCollection[0]?.count || 0,
          in_transit: inTransit[0]?.count || 0,
          processing: processing[0]?.count || 0,
          pending_verification: pendingVerification[0]?.count || 0,
          verified_today: verifiedToday[0]?.count || 0,
          critical_values: criticalValues[0]?.count || 0,
          outsourced_pending: outsourcedPending[0]?.count || 0,
        };
      } catch (err) {
        console.error('[labWorklist.worklistSummary]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- Pending Collection ----- */
  pendingCollection: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            id: labOrders.id,
            order_number: labOrders.order_number,
            urgency: labOrders.urgency,
            panel_name: labOrders.panel_name,
            panel_code: labOrders.panel_code,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            ordered_at: labOrders.ordered_at,
            clinical_notes: labOrders.clinical_notes,
            ordered_by_name: users.full_name,
          })
          .from(labOrders)
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .innerJoin(users, eq(labOrders.ordered_by, users.id))
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'ordered' as any)
            )
          )
          .orderBy(
            // STAT first, then by ordered_at
            sql`CASE WHEN ${labOrders.urgency} = ${'stat'} THEN 0 WHEN ${labOrders.urgency} = ${'asap'} THEN 1 WHEN ${labOrders.urgency} = ${'urgent'} THEN 2 ELSE 3 END ASC`,
            asc(labOrders.ordered_at)
          );

        return results.map((r) => ({
          ...r,
          ordered_at: r.ordered_at?.toISOString() || null,
        }));
      } catch (err) {
        console.error('[labWorklist.pendingCollection]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- In Transit ----- */
  inTransit: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            id: labOrders.id,
            order_number: labOrders.order_number,
            panel_name: labOrders.panel_name,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            collected_at: labOrders.collected_at,
            urgency: labOrders.urgency,
          })
          .from(labOrders)
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'collected' as any)
            )
          )
          .orderBy(desc(labOrders.collected_at));

        return results.map((r) => ({
          ...r,
          collected_at: r.collected_at?.toISOString() || null,
        }));
      } catch (err) {
        console.error('[labWorklist.inTransit]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- Processing ----- */
  processing: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            id: labOrders.id,
            order_number: labOrders.order_number,
            panel_name: labOrders.panel_name,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            received_at: labOrders.received_at,
            status: labOrders.status,
            urgency: labOrders.urgency,
          })
          .from(labOrders)
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              or(
                eq(labOrders.status, 'received' as any),
                eq(labOrders.status, 'processing' as any)
              )
            )
          )
          .orderBy(asc(labOrders.received_at));

        return results.map((r) => ({
          ...r,
          received_at: r.received_at?.toISOString() || null,
        }));
      } catch (err) {
        console.error('[labWorklist.processing]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- Pending Verification ----- */
  pendingVerification: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            id: labOrders.id,
            order_number: labOrders.order_number,
            panel_name: labOrders.panel_name,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            resulted_at: labOrders.resulted_at,
            is_critical: labOrders.is_critical,
            urgency: labOrders.urgency,
            result_count: count(labResults.id),
          })
          .from(labOrders)
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .leftJoin(labResults, eq(labOrders.id, labResults.order_id))
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'resulted' as any)
            )
          )
          .groupBy(labOrders.id, patients.id)
          .orderBy(desc(labOrders.resulted_at));

        return results.map((r) => ({
          ...r,
          resulted_at: r.resulted_at?.toISOString() || null,
          result_count: Number(r.result_count),
        }));
      } catch (err) {
        console.error('[labWorklist.pendingVerification]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- Critical Values ----- */
  criticalValues: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            result_id: labResults.id,
            order_id: labOrders.id,
            order_number: labOrders.order_number,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            test_name: labResults.test_name,
            value_numeric: labResults.value_numeric,
            value_text: labResults.value_text,
            unit: labResults.unit,
            flag: labResults.flag,
            ref_range_low: labPanelComponents.reference_range_low,
            ref_range_high: labPanelComponents.reference_range_high,
            critical_low: labPanelComponents.critical_low,
            critical_high: labPanelComponents.critical_high,
            resulted_at: labResults.resulted_at,
          })
          .from(labResults)
          .innerJoin(labOrders, eq(labResults.order_id, labOrders.id))
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .leftJoin(labPanelComponents, eq(labResults.component_id, labPanelComponents.id))
          .where(
            and(
              eq(labResults.hospital_id, hospitalId),
              eq(labResults.is_critical, true)
            )
          )
          .orderBy(desc(labResults.resulted_at));

        return results.map((r) => ({
          ...r,
          resulted_at: r.resulted_at?.toISOString() || null,
        }));
      } catch (err) {
        console.error('[labWorklist.criticalValues]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- Outsourced Pending ----- */
  outsourcedPending: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            id: externalLabOrders.id,
            lab_name: externalLabs.lab_name,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            order_number: labOrders.order_number,
            panel_name: labOrders.panel_name,
            status: externalLabOrders.status,
            dispatch_date: externalLabOrders.dispatch_date,
            dispatch_tracking: externalLabOrders.dispatch_tracking,
            tat_promised_hours: externalLabOrders.tat_promised_hours,
          })
          .from(externalLabOrders)
          .innerJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
          .innerJoin(labOrders, eq(externalLabOrders.lab_order_id, labOrders.id))
          .innerJoin(patients, eq(externalLabOrders.patient_id, patients.id))
          .where(
            and(
              eq(externalLabOrders.hospital_id, hospitalId),
              or(
                eq(externalLabOrders.status, 'pending_dispatch' as any),
                eq(externalLabOrders.status, 'dispatched' as any),
                eq(externalLabOrders.status, 'received_by_lab' as any),
                eq(externalLabOrders.status, 'processing' as any),
                eq(externalLabOrders.status, 'results_received' as any),
                eq(externalLabOrders.status, 'results_entered' as any)
              )
            )
          )
          .orderBy(asc(externalLabOrders.dispatch_date));

        return results.map((r) => ({
          ...r,
          dispatch_date: r.dispatch_date?.toISOString() || null,
        }));
      } catch (err) {
        console.error('[labWorklist.outsourcedPending]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- Lookup by Barcode ----- */
  lookupByBarcode: protectedProcedure
    .input(barcodeSchema)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const order = await db
          .select({
            id: labOrders.id,
            order_number: labOrders.order_number,
            status: labOrders.status,
            urgency: labOrders.urgency,
            panel_name: labOrders.panel_name,
            panel_code: labOrders.panel_code,
            patient_name: patients.name_full,
            patient_uhid: patients.uhid,
            patient_id: patients.id,
            clinical_notes: labOrders.clinical_notes,
            ordered_at: labOrders.ordered_at,
            collected_at: labOrders.collected_at,
            received_at: labOrders.received_at,
            resulted_at: labOrders.resulted_at,
            verified_at: labOrders.verified_at,
            ordered_by_name: users.full_name,
          })
          .from(labOrders)
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .innerJoin(users, eq(labOrders.ordered_by, users.id))
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.order_number, input.order_number)
            )
          )
          .limit(1);

        if (!order || order.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
        }

        const o = order[0];

        // Get results
        const results = await db
          .select({
            id: labResults.id,
            test_name: labResults.test_name,
            value_numeric: labResults.value_numeric,
            value_text: labResults.value_text,
            unit: labResults.unit,
            flag: labResults.flag,
            ref_range_low: labResults.ref_range_low,
            ref_range_high: labResults.ref_range_high,
          })
          .from(labResults)
          .where(eq(labResults.order_id, o.id));

        return {
          ...o,
          ordered_at: o.ordered_at?.toISOString() || null,
          collected_at: o.collected_at?.toISOString() || null,
          received_at: o.received_at?.toISOString() || null,
          resulted_at: o.resulted_at?.toISOString() || null,
          verified_at: o.verified_at?.toISOString() || null,
          results,
        };
      } catch (err) {
        console.error('[labWorklist.lookupByBarcode]', err);
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  /* ----- TAT Analysis ----- */
  tatAnalysis: protectedProcedure
    .input(z.object({}).strict())
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const results = await db
          .select({
            id: labOrders.id,
            order_number: labOrders.order_number,
            panel_name: labOrders.panel_name,
            patient_name: patients.name_full,
            ordered_at: labOrders.ordered_at,
            verified_at: labOrders.verified_at,
            tat_minutes_actual: labOrders.tat_minutes_actual,
            panel_tat: labPanels.tat_minutes,
          })
          .from(labOrders)
          .innerJoin(patients, eq(labOrders.patient_id, patients.id))
          .leftJoin(labPanels, eq(labOrders.panel_id, labPanels.id))
          .where(
            and(
              eq(labOrders.hospital_id, hospitalId),
              eq(labOrders.status, 'verified' as any),
              gte(labOrders.verified_at, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            )
          )
          .orderBy(desc(labOrders.verified_at));

        return results.map((r) => ({
          ...r,
          ordered_at: r.ordered_at?.toISOString() || null,
          verified_at: r.verified_at?.toISOString() || null,
          tat_minutes_expected: r.panel_tat || 0,
          tat_status: !r.panel_tat || !r.tat_minutes_actual ? 'unknown'
            : r.tat_minutes_actual > r.panel_tat ? 'breached' : 'met',
        }));
      } catch (err) {
        console.error('[labWorklist.tatAnalysis]', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

});
