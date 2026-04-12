/**
 * Lab Reports & Outsourced Labs — Module 8 LIS (L.4)
 *
 * Report generation from verified results, PDF rendering,
 * outsourced lab document management with manual result entry.
 *
 * Endpoints:
 *   1. generate        — Bundle verified results into a report
 *   2. getByOrder      — Report retrieval for an order
 *   3. list            — Report list with filters
 *   4. verify          — Pathologist/lab director verification
 *   5. amend           — Create amendment with reason
 *   6. uploadOutsourced — Upload external lab PDF
 *   7. listOutsourced  — Outsourced doc list with filters
 *   8. getOutsourced   — Single outsourced doc detail
 *   9. enterResults    — Manual result entry for outsourced doc
 *  10. verifyOutsourced — Verify entered results
 *  11. rejectOutsourced — Reject outsourced doc
 *  12. reportStats     — Dashboard counts
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { labReports, outsourcedLabDocs } from '@db/schema';
import { labOrders, labResults } from '@db/schema';
import { patients } from '@db/schema';
import { eq, and, desc, count, sql, gte, asc, or } from 'drizzle-orm';

// ============================================================
// Router
// ============================================================

export const labReportsRouter = router({

  // ----------------------------------------------------------
  // 1. GENERATE — Bundle verified results into a report
  // ----------------------------------------------------------
  generate: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      order_id: z.string().uuid(),
      interpretation: z.string().optional(),
      clinical_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get order
      const [order] = await db.select()
        .from(labOrders)
        .where(eq(labOrders.id, input.order_id))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      // Get all results for this order
      const results = await db.select()
        .from(labResults)
        .where(eq(labResults.order_id, input.order_id))
        .orderBy(asc(labResults.test_code));

      if (results.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No results found for this order' });
      }

      // Build results snapshot
      const resultsSnapshot = results.map((r) => ({
        test_code: r.test_code,
        test_name: r.test_name,
        value_numeric: r.value_numeric,
        value_text: r.value_text,
        unit: r.unit,
        ref_range_low: r.ref_range_low,
        ref_range_high: r.ref_range_high,
        ref_range_text: r.ref_range_text,
        flag: r.flag,
        is_critical: r.is_critical,
        loinc_code: r.loinc_code,
      }));

      const criticalCount = results.filter((r) => r.is_critical).length;
      const abnormalCount = results.filter((r) => r.flag && !['normal'].includes(r.flag)).length;

      // Generate report number: RPT-YYYYMMDD-XXXX
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
      const reportNumber = `RPT-${dateKey}-${seq}`;

      const [report] = await db.insert(labReports).values({
        hospital_id: input.hospital_id,
        order_id: input.order_id,
        patient_id: order.patient_id,
        report_number: reportNumber,
        status: 'generated',
        panel_name: order.panel_name,
        results_snapshot: resultsSnapshot,
        clinical_notes: input.clinical_notes ?? order.clinical_notes,
        interpretation: input.interpretation ?? null,
        has_critical: criticalCount > 0,
        critical_count: criticalCount,
        abnormal_count: abnormalCount,
        generated_by: ctx.user.sub,
      }).returning();

      return report;
    }),

  // ----------------------------------------------------------
  // 2. GET BY ORDER — Report retrieval
  // ----------------------------------------------------------
  getByOrder: protectedProcedure
    .input(z.object({ order_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const reports = await db.select()
        .from(labReports)
        .where(eq(labReports.order_id, input.order_id))
        .orderBy(desc(labReports.created_at));

      return reports;
    }),

  // ----------------------------------------------------------
  // 3. LIST — Report list with filters
  // ----------------------------------------------------------
  list: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['draft', 'generated', 'verified', 'amended', 'cancelled']).optional(),
      has_critical: z.boolean().optional(),
      patient_id: z.string().uuid().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(labReports.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(labReports.status, input.status));
      if (input.has_critical !== undefined) conditions.push(eq(labReports.has_critical, input.has_critical));
      if (input.patient_id) conditions.push(eq(labReports.patient_id, input.patient_id));

      const reports = await db.select()
        .from(labReports)
        .where(and(...conditions))
        .orderBy(desc(labReports.generated_at))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db.select({ total: count() })
        .from(labReports)
        .where(and(...conditions));

      return { reports, total: totalRow?.total ?? 0 };
    }),

  // ----------------------------------------------------------
  // 4. VERIFY — Pathologist verification
  // ----------------------------------------------------------
  verify: protectedProcedure
    .input(z.object({ report_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [report] = await db.select()
        .from(labReports)
        .where(eq(labReports.id, input.report_id))
        .limit(1);

      if (!report) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      if (report.status !== 'generated') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot verify report in status: ${report.status}` });
      }

      const [updated] = await db.update(labReports)
        .set({
          status: 'verified',
          verified_by: ctx.user.sub,
          verified_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(labReports.id, input.report_id))
        .returning();

      return updated;
    }),

  // ----------------------------------------------------------
  // 5. AMEND — Create amendment with reason
  // ----------------------------------------------------------
  amend: protectedProcedure
    .input(z.object({
      report_id: z.string().uuid(),
      reason: z.string().min(1),
      new_interpretation: z.string().optional(),
      new_results_snapshot: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [original] = await db.select()
        .from(labReports)
        .where(eq(labReports.id, input.report_id))
        .limit(1);

      if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });

      // Mark original as amended
      await db.update(labReports)
        .set({
          status: 'amended',
          amendment_reason: input.reason,
          amended_by: ctx.user.sub,
          amended_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(labReports.id, input.report_id));

      // Create new version
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');

      const [amended] = await db.insert(labReports).values({
        hospital_id: original.hospital_id,
        order_id: original.order_id,
        patient_id: original.patient_id,
        report_number: `RPT-${dateKey}-${seq}`,
        status: 'generated',
        panel_name: original.panel_name,
        results_snapshot: input.new_results_snapshot ?? original.results_snapshot,
        clinical_notes: original.clinical_notes,
        interpretation: input.new_interpretation ?? original.interpretation,
        has_critical: original.has_critical,
        critical_count: original.critical_count,
        abnormal_count: original.abnormal_count,
        generated_by: ctx.user.sub,
        previous_version_id: original.id,
      }).returning();

      return amended;
    }),

  // ----------------------------------------------------------
  // 6. UPLOAD OUTSOURCED — External lab PDF
  // ----------------------------------------------------------
  uploadOutsourced: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      patient_id: z.string().uuid(),
      order_id: z.string().uuid().optional(),
      external_lab_name: z.string().min(1),
      external_report_number: z.string().optional(),
      external_report_date: z.string().optional(),
      file_name: z.string().min(1),
      file_url: z.string().min(1),
      file_size_bytes: z.number().optional(),
      mime_type: z.string().default('application/pdf'),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await db.insert(outsourcedLabDocs).values({
        hospital_id: input.hospital_id,
        patient_id: input.patient_id,
        order_id: input.order_id ?? null,
        external_lab_name: input.external_lab_name,
        external_report_number: input.external_report_number ?? null,
        external_report_date: input.external_report_date ? new Date(input.external_report_date) : null,
        file_name: input.file_name,
        file_url: input.file_url,
        file_size_bytes: input.file_size_bytes ?? null,
        mime_type: input.mime_type,
        status: 'pending_entry',
        uploaded_by: ctx.user.sub,
      }).returning();

      return doc;
    }),

  // ----------------------------------------------------------
  // 7. LIST OUTSOURCED — With filters
  // ----------------------------------------------------------
  listOutsourced: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['uploaded', 'pending_entry', 'results_entered', 'verified', 'rejected']).optional(),
      patient_id: z.string().uuid().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(outsourcedLabDocs.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(outsourcedLabDocs.status, input.status));
      if (input.patient_id) conditions.push(eq(outsourcedLabDocs.patient_id, input.patient_id));

      const docs = await db.select()
        .from(outsourcedLabDocs)
        .where(and(...conditions))
        .orderBy(desc(outsourcedLabDocs.uploaded_at))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db.select({ total: count() })
        .from(outsourcedLabDocs)
        .where(and(...conditions));

      return { docs, total: totalRow?.total ?? 0 };
    }),

  // ----------------------------------------------------------
  // 8. GET OUTSOURCED — Single doc detail
  // ----------------------------------------------------------
  getOutsourced: protectedProcedure
    .input(z.object({ doc_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [doc] = await db.select()
        .from(outsourcedLabDocs)
        .where(eq(outsourcedLabDocs.id, input.doc_id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      // Get patient info
      const [patient] = await db.select()
        .from(patients)
        .where(eq(patients.id, doc.patient_id))
        .limit(1);

      return { doc, patient };
    }),

  // ----------------------------------------------------------
  // 9. ENTER RESULTS — Manual result entry for outsourced doc
  // ----------------------------------------------------------
  enterResults: protectedProcedure
    .input(z.object({
      doc_id: z.string().uuid(),
      results: z.array(z.object({
        test_name: z.string(),
        value: z.string(),
        unit: z.string().optional(),
        ref_range: z.string().optional(),
        flag: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal']).optional(),
      })),
      entry_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await db.select()
        .from(outsourcedLabDocs)
        .where(eq(outsourcedLabDocs.id, input.doc_id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      const [updated] = await db.update(outsourcedLabDocs)
        .set({
          extracted_results: input.results,
          entry_notes: input.entry_notes ?? null,
          status: 'results_entered',
          entered_by: ctx.user.sub,
          entered_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(outsourcedLabDocs.id, input.doc_id))
        .returning();

      return updated;
    }),

  // ----------------------------------------------------------
  // 10. VERIFY OUTSOURCED — Verify entered results
  // ----------------------------------------------------------
  verifyOutsourced: protectedProcedure
    .input(z.object({ doc_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(outsourcedLabDocs)
        .set({
          status: 'verified',
          verified_by: ctx.user.sub,
          verified_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(outsourcedLabDocs.id, input.doc_id))
        .returning();

      return updated;
    }),

  // ----------------------------------------------------------
  // 11. REJECT OUTSOURCED — Reject with reason
  // ----------------------------------------------------------
  rejectOutsourced: protectedProcedure
    .input(z.object({
      doc_id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(outsourcedLabDocs)
        .set({
          status: 'rejected',
          rejection_reason: input.reason,
          updated_at: new Date(),
        })
        .where(eq(outsourcedLabDocs.id, input.doc_id))
        .returning();

      return updated;
    }),

  // ----------------------------------------------------------
  // 12. REPORT STATS — Dashboard counts
  // ----------------------------------------------------------
  reportStats: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Reports
      const [totalReports] = await db.select({ total: count() })
        .from(labReports)
        .where(eq(labReports.hospital_id, input.hospital_id));

      const [pendingVerification] = await db.select({ total: count() })
        .from(labReports)
        .where(and(
          eq(labReports.hospital_id, input.hospital_id),
          eq(labReports.status, 'generated'),
        ));

      const [reportsToday] = await db.select({ total: count() })
        .from(labReports)
        .where(and(
          eq(labReports.hospital_id, input.hospital_id),
          gte(labReports.generated_at, today),
        ));

      const [criticalReports] = await db.select({ total: count() })
        .from(labReports)
        .where(and(
          eq(labReports.hospital_id, input.hospital_id),
          eq(labReports.has_critical, true),
          or(eq(labReports.status, 'generated'), eq(labReports.status, 'verified')),
        ));

      // Outsourced
      const [totalOutsourced] = await db.select({ total: count() })
        .from(outsourcedLabDocs)
        .where(eq(outsourcedLabDocs.hospital_id, input.hospital_id));

      const [pendingEntry] = await db.select({ total: count() })
        .from(outsourcedLabDocs)
        .where(and(
          eq(outsourcedLabDocs.hospital_id, input.hospital_id),
          eq(outsourcedLabDocs.status, 'pending_entry'),
        ));

      return {
        total_reports: totalReports?.total ?? 0,
        pending_verification: pendingVerification?.total ?? 0,
        reports_today: reportsToday?.total ?? 0,
        critical_reports: criticalReports?.total ?? 0,
        total_outsourced: totalOutsourced?.total ?? 0,
        pending_entry: pendingEntry?.total ?? 0,
      };
    }),
});
