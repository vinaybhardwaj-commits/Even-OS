import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  externalLabOrders, externalLabs, externalLabPricing, labOrders, labResults, labPanels,
  labPanelComponents, patients, encounters, users,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import {
  eq, and, or, sql, desc, asc, count, like, gte, lte, ne, inArray, isNull,
} from 'drizzle-orm';

// ============================================================
// OUTSOURCED LAB WORKFLOW — B.4
// ~10 endpoints: dispatch, track, enter results, verify, costs
// ============================================================

export const outsourcedWorkflowRouter = router({

  // ──────────────────────────────────────────────────────────────────
  // DISPATCH QUEUE
  // ──────────────────────────────────────────────────────────────────

  // List lab orders pending dispatch to external labs
  dispatchQueue: protectedProcedure
    .input(z.object({
      skip: z.number().int().min(0).default(0),
      take: z.number().int().min(1).max(100).default(20),
      urgency: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [
        eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        eq(externalLabOrders.status as any, 'pending_dispatch'),
      ];

      if (input.urgency) {
        filters.push(eq(labOrders.urgency as any, input.urgency));
      }

      const rows = await db.select({
        id: externalLabOrders.id,
        lab_order_id: externalLabOrders.lab_order_id,
        order_number: labOrders.order_number,
        panel_name: labOrders.panel_name,
        urgency: labOrders.urgency,
        patient_name: patients.name_full,
        patient_uhid: patients.uhid,
        external_lab_id: externalLabOrders.external_lab_id,
        created_at: externalLabOrders.created_at,
      })
        .from(externalLabOrders)
        .innerJoin(labOrders, eq(externalLabOrders.lab_order_id, labOrders.id))
        .innerJoin(patients, eq(externalLabOrders.patient_id, patients.id))
        .where(and(...filters))
        .orderBy(desc(labOrders.urgency), desc(externalLabOrders.created_at))
        .limit(input.take)
        .offset(input.skip);

      const countRes = await db.select({ count: count() })
        .from(externalLabOrders)
        .innerJoin(labOrders, eq(externalLabOrders.lab_order_id, labOrders.id))
        .where(and(...filters));

      return {
        data: rows,
        total: countRes[0]?.count || 0,
      };
    }),

  // ──────────────────────────────────────────────────────────────────
  // DISPATCH ORDERS
  // ──────────────────────────────────────────────────────────────────

  // Dispatch selected orders to external lab
  dispatchOrders: adminProcedure
    .input(z.object({
      order_ids: z.array(z.string().uuid()),
      external_lab_id: z.string().uuid(),
      dispatch_method: z.enum(['courier', 'pickup', 'digital']),
      dispatch_tracking: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      // Verify all orders exist and belong to hospital
      const orders = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          inArray(externalLabOrders.id, input.order_ids),
        ));

      if (orders.length !== input.order_ids.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Some orders not found' });
      }

      // Verify external lab exists
      const [lab] = await db.select().from(externalLabs)
        .where(and(
          eq(externalLabs.id, input.external_lab_id as any),
          eq(externalLabs.hospital_id, ctx.user.hospital_id),
        ));

      if (!lab) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'External lab not found' });
      }

      // Update orders
      const updates = await Promise.all(
        input.order_ids.map((orderId) => {
          const updateData = {
            status: 'dispatched' as const,
            dispatch_date: now,
            dispatch_method: input.dispatch_method,
            dispatch_tracking: input.dispatch_tracking || null,
            dispatched_by: ctx.user.sub,
            updated_at: now,
          };

          return db.update(externalLabOrders)
            .set(updateData as any)
            .where(eq(externalLabOrders.id, orderId as any))
            .returning({ id: externalLabOrders.id });
        }),
      );

      // Audit log
      for (const orderId of input.order_ids) {
        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'external_lab_orders',
          row_id: orderId,
          new_values: {
            status: 'dispatched',
            dispatch_method: input.dispatch_method,
            dispatch_tracking: input.dispatch_tracking,
          },
          reason: `Dispatched to ${lab.lab_name}`,
        });
      }

      return { count: input.order_ids.length };
    }),

  // ──────────────────────────────────────────────────────────────────
  // TRACKING DASHBOARD
  // ──────────────────────────────────────────────────────────────────

  // List all orders grouped by status
  trackingDashboard: protectedProcedure
    .input(z.object({
      status: z.enum(['dispatched', 'received_by_lab', 'processing', 'results_received']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [eq(externalLabOrders.hospital_id, ctx.user.hospital_id)];

      if (input.status) {
        filters.push(eq(externalLabOrders.status as any, input.status));
      } else {
        // Show in-transit statuses only
        filters.push(
          or(
            eq(externalLabOrders.status as any, 'dispatched'),
            eq(externalLabOrders.status as any, 'received_by_lab'),
            eq(externalLabOrders.status as any, 'processing'),
            eq(externalLabOrders.status as any, 'results_received'),
          ) as any,
        );
      }

      const rows = await db.select({
        id: externalLabOrders.id,
        status: externalLabOrders.status,
        order_number: labOrders.order_number,
        panel_name: labOrders.panel_name,
        patient_name: patients.name_full,
        patient_uhid: patients.uhid,
        lab_name: externalLabs.lab_name,
        dispatch_date: externalLabOrders.dispatch_date,
        received_at: externalLabOrders.received_at,
        processing_at: externalLabOrders.processing_at,
        results_received_at: externalLabOrders.results_received_at,
        tat_promised_hours: externalLabOrders.tat_promised_hours,
        tat_breach: externalLabOrders.tat_breach,
      })
        .from(externalLabOrders)
        .innerJoin(labOrders, eq(externalLabOrders.lab_order_id, labOrders.id))
        .innerJoin(patients, eq(externalLabOrders.patient_id, patients.id))
        .innerJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
        .where(and(...filters))
        .orderBy(desc(externalLabOrders.dispatch_date));

      return rows;
    }),

  // ──────────────────────────────────────────────────────────────────
  // UPDATE ORDER STATUS
  // ──────────────────────────────────────────────────────────────────

  // Advance order through lifecycle
  updateOrderStatus: adminProcedure
    .input(z.object({
      order_id: z.string().uuid(),
      new_status: z.enum(['received_by_lab', 'processing', 'results_received', 'results_entered', 'verified']),
    }))
    .mutation(async ({ ctx, input }) => {
      const [order] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.order_id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      const now = new Date().toISOString();
      const updateData: any = {
        status: input.new_status,
        updated_at: now,
      };

      // Set appropriate timestamp
      if (input.new_status === 'received_by_lab') {
        updateData.received_at = now;
      } else if (input.new_status === 'processing') {
        updateData.processing_at = now;
      } else if (input.new_status === 'results_received') {
        updateData.results_received_at = now;
        // Calculate TAT breach if promised_hours set
        if (order.dispatch_date && order.tat_promised_hours) {
          const dispatchTime = new Date(order.dispatch_date).getTime();
          const resultTime = new Date(now).getTime();
          const actualHours = (resultTime - dispatchTime) / (1000 * 60 * 60);
          updateData.tat_actual_hours = String(actualHours);
          if (actualHours > order.tat_promised_hours) {
            updateData.tat_breach = true;
          }
        }
      } else if (input.new_status === 'results_entered') {
        updateData.results_entered_at = now;
        updateData.results_entered_by = ctx.user.sub;
      } else if (input.new_status === 'verified') {
        updateData.verified_at = now;
        updateData.verified_by = ctx.user.sub;
      }

      await db.update(externalLabOrders)
        .set(updateData)
        .where(eq(externalLabOrders.id, input.order_id as any));

      // If verified, update lab_order status too
      if (input.new_status === 'verified') {
        await db.update(labOrders)
          .set({
            status: 'verified' as any,
            verified_at: now,
            verified_by: ctx.user.sub,
            updated_at: now,
          } as any)
          .where(eq(labOrders.id, order.lab_order_id as any));
      }

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_lab_orders',
        row_id: input.order_id,
        new_values: updateData,
        reason: `Status updated to ${input.new_status}`,
      });

      return { success: true };
    }),

  // ──────────────────────────────────────────────────────────────────
  // ENTER RESULTS
  // ──────────────────────────────────────────────────────────────────

  // Enter lab results from external lab
  enterResults: adminProcedure
    .input(z.object({
      order_id: z.string().uuid(),
      results: z.array(z.object({
        component_id: z.string().uuid().optional(),
        test_code: z.string(),
        test_name: z.string(),
        value_numeric: z.number().optional(),
        value_text: z.string().optional(),
        value_coded: z.string().optional(),
        unit: z.string().optional(),
        flag: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal']).default('normal'),
        is_critical: z.boolean().default(false),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify external lab order exists
      const [order] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.order_id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      const now = new Date().toISOString();

      // Create result records
      const resultIds: string[] = [];
      for (const result of input.results) {
        const [createdResult] = await db.insert(labResults)
          .values({
            id: sql`gen_random_uuid()`,
            hospital_id: ctx.user.hospital_id,
            order_id: order.lab_order_id,
            component_id: result.component_id || null,
            test_code: result.test_code,
            test_name: result.test_name,
            value_numeric: result.value_numeric ? String(result.value_numeric) : null,
            value_text: result.value_text || null,
            value_coded: result.value_coded || null,
            unit: result.unit || null,
            flag: result.flag,
            is_critical: result.is_critical,
            resulted_by: ctx.user.sub,
            resulted_at: now,
          } as any)
          .returning({ id: labResults.id });

        if (createdResult) resultIds.push(createdResult.id);
      }

      // Update external lab order status
      await db.update(externalLabOrders)
        .set({
          status: 'results_entered' as any,
          results_entered_at: now,
          results_entered_by: ctx.user.sub,
          updated_at: now,
        } as any)
        .where(eq(externalLabOrders.id, input.order_id as any));

      // Update lab order status
      await db.update(labOrders)
        .set({
          status: 'resulted' as any,
          resulted_at: now,
          updated_at: now,
        } as any)
        .where(eq(labOrders.id, order.lab_order_id as any));

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'external_lab_orders',
        row_id: input.order_id,
        new_values: { results_count: resultIds.length },
        reason: `Entered ${resultIds.length} result(s)`,
      });

      return { result_ids: resultIds };
    }),

  // ──────────────────────────────────────────────────────────────────
  // VERIFY RESULTS
  // ──────────────────────────────────────────────────────────────────

  // Verify results and mark order as complete
  verifyResults: adminProcedure
    .input(z.object({
      order_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [order] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.order_id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      const now = new Date().toISOString();

      // Update external lab order
      await db.update(externalLabOrders)
        .set({
          status: 'verified' as any,
          verified_at: now,
          verified_by: ctx.user.sub,
          updated_at: now,
        } as any)
        .where(eq(externalLabOrders.id, input.order_id as any));

      // Update lab order
      await db.update(labOrders)
        .set({
          status: 'verified' as any,
          verified_at: now,
          verified_by: ctx.user.sub,
          updated_at: now,
        } as any)
        .where(eq(labOrders.id, order.lab_order_id as any));

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_lab_orders',
        row_id: input.order_id,
        new_values: { status: 'verified' },
        reason: 'Results verified',
      });

      return { success: true };
    }),

  // ──────────────────────────────────────────────────────────────────
  // CANCEL ORDER
  // ──────────────────────────────────────────────────────────────────

  // Cancel external lab order
  cancelOrder: adminProcedure
    .input(z.object({
      order_id: z.string().uuid(),
      reason: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [order] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.order_id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      const now = new Date().toISOString();

      await db.update(externalLabOrders)
        .set({
          status: 'cancelled' as any,
          rejection_reason: input.reason,
          updated_at: now,
        } as any)
        .where(eq(externalLabOrders.id, input.order_id as any));

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_lab_orders',
        row_id: input.order_id,
        new_values: { status: 'cancelled' },
        reason: input.reason,
      });

      return { success: true };
    }),

  // ──────────────────────────────────────────────────────────────────
  // TAT BREACH REPORT
  // ──────────────────────────────────────────────────────────────────

  // List TAT breaches
  tatBreachReport: protectedProcedure
    .input(z.object({
      skip: z.number().int().min(0).default(0),
      take: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const breaches = await db.select({
        id: externalLabOrders.id,
        lab_name: externalLabs.lab_name,
        order_number: labOrders.order_number,
        patient_name: patients.name_full,
        dispatch_date: externalLabOrders.dispatch_date,
        results_received_at: externalLabOrders.results_received_at,
        tat_promised_hours: externalLabOrders.tat_promised_hours,
        tat_actual_hours: externalLabOrders.tat_actual_hours,
      })
        .from(externalLabOrders)
        .innerJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
        .innerJoin(labOrders, eq(externalLabOrders.lab_order_id, labOrders.id))
        .innerJoin(patients, eq(externalLabOrders.patient_id, patients.id))
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          eq(externalLabOrders.tat_breach, true),
        ))
        .orderBy(desc(externalLabOrders.results_received_at))
        .limit(input.take)
        .offset(input.skip);

      // Count by lab
      const labCounts = await db.select({
        lab_name: externalLabs.lab_name,
        breach_count: count(),
      })
        .from(externalLabOrders)
        .innerJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          eq(externalLabOrders.tat_breach, true),
        ))
        .groupBy(externalLabs.lab_name);

      return {
        data: breaches,
        lab_summary: labCounts,
        total: breaches.length,
      };
    }),

  // ──────────────────────────────────────────────────────────────────
  // COST SUMMARY
  // ──────────────────────────────────────────────────────────────────

  // Cost analysis by lab
  costSummary: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [eq(externalLabOrders.hospital_id, ctx.user.hospital_id)];

      if (input.date_from) {
        filters.push(gte(externalLabOrders.dispatch_date, new Date(input.date_from)));
      }
      if (input.date_to) {
        filters.push(lte(externalLabOrders.dispatch_date, new Date(input.date_to)));
      }

      const summary = await db.select({
        lab_name: externalLabs.lab_name,
        order_count: count(),
        total_cost: sql<string>`COALESCE(SUM(CAST(${externalLabOrders.cost_amount} AS NUMERIC)), 0)`,
        total_billing: sql<string>`COALESCE(SUM(CAST(${externalLabOrders.billing_amount} AS NUMERIC)), 0)`,
      })
        .from(externalLabOrders)
        .innerJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
        .where(and(...filters))
        .groupBy(externalLabs.lab_name)
        .orderBy(desc(count()));

      return summary.map((row) => ({
        ...row,
        margin: Number(row.total_billing || 0) - Number(row.total_cost || 0),
        margin_pct: row.total_cost && Number(row.total_cost) > 0
          ? ((Number(row.total_billing || 0) - Number(row.total_cost)) / Number(row.total_cost) * 100)
          : 0,
      }));
    }),

  // ──────────────────────────────────────────────────────────────────
  // ORDER TIMELINE
  // ──────────────────────────────────────────────────────────────────

  // Full timeline for a single order
  orderTimeline: protectedProcedure
    .input(z.object({
      order_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const [order] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.order_id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      return {
        id: order.id,
        created_at: order.created_at,
        dispatched_at: order.dispatch_date,
        received_by_lab_at: order.received_at,
        processing_started_at: order.processing_at,
        results_received_at: order.results_received_at,
        results_entered_at: order.results_entered_at,
        verified_at: order.verified_at,
        status: order.status,
        tat_promised_hours: order.tat_promised_hours,
        tat_actual_hours: order.tat_actual_hours,
        tat_breach: order.tat_breach,
      };
    }),

});
