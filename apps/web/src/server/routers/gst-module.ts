import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { gstReturns, itcLedger, gstReconciliation, journalEntries, journalEntryLines, chartOfAccounts } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, gte, lte } from 'drizzle-orm';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function periodDates(month: number, year: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

export const gstModuleRouter = router({

  // ═══════════════════════════════════════════════
  // GSTR-1 GENERATION (Outward Supplies)
  // ═══════════════════════════════════════════════

  generateGstr1: protectedProcedure
    .input(z.object({ month: z.number().min(1).max(12), year: z.number().min(2020) }))
    .query(async ({ ctx, input }) => {
      const { start, end } = periodDates(input.month, input.year);

      // Get all revenue entries from posted JEs in this period
      const revenueEntries = await db.select({
        je_id: journalEntries.id,
        entry_number: journalEntries.entry_number,
        entry_date: journalEntries.entry_date,
        narration: journalEntries.narration,
        reference_type: journalEntries.reference_type,
        reference_id: journalEntries.reference_id,
        account_code: chartOfAccounts.account_code,
        account_name: chartOfAccounts.account_name,
        credit: journalEntryLines.credit_amount,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(and(
          eq(journalEntries.hospital_id, ctx.user.hospital_id),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entry_date, start),
          lte(journalEntries.entry_date, end),
          eq(chartOfAccounts.account_type, 'revenue'),
          sql`${journalEntryLines.credit_amount} > 0`,
        ))
        .orderBy(asc(journalEntries.entry_date));

      // Classify B2B (insurance / with GSTIN) vs B2C (self-pay / no GSTIN)
      // Convention: reference_type = 'insurance_claim' → B2B, otherwise → B2C
      const b2b: any[] = [];
      const b2c: any[] = [];
      const hsnMap: Record<string, { hsn: string; taxable: number; cgst: number; sgst: number; igst: number; count: number }> = {};

      for (const r of revenueEntries) {
        const taxableValue = Number(r.credit);
        const gstRate = 18; // Default GST rate for healthcare services
        const halfRate = gstRate / 2;
        const cgst = Math.round(taxableValue * halfRate / 100 * 100) / 100;
        const sgst = cgst;
        const igst = 0; // Intra-state assumed for hospital
        const totalTax = cgst + sgst + igst;
        const hsn = '9993'; // Default healthcare SAC

        const entry = {
          entry_number: r.entry_number,
          entry_date: r.entry_date,
          description: r.narration || '',
          account: r.account_name,
          hsn_code: hsn,
          gst_rate: gstRate,
          taxable_value: taxableValue,
          cgst, sgst, igst,
          total_tax: totalTax,
          invoice_value: taxableValue + totalTax,
        };

        if (r.reference_type === 'insurance_claim' || r.reference_type === 'tpa_settlement') {
          b2b.push({ ...entry, type: 'B2B', gstin: 'TPA GSTIN (from claim)' });
        } else {
          // B2C: self-pay invoices under ₹2.5L
          b2c.push({ ...entry, type: 'B2C' });
        }

        // HSN summary
        if (!hsnMap[hsn]) hsnMap[hsn] = { hsn, taxable: 0, cgst: 0, sgst: 0, igst: 0, count: 0 };
        hsnMap[hsn].taxable += taxableValue;
        hsnMap[hsn].cgst += cgst;
        hsnMap[hsn].sgst += sgst;
        hsnMap[hsn].igst += igst;
        hsnMap[hsn].count++;
      }

      const hsnSummary = Object.values(hsnMap).sort((a, b) => b.taxable - a.taxable);

      const totalTaxable = [...b2b, ...b2c].reduce((s, e) => s + e.taxable_value, 0);
      const totalCgst = [...b2b, ...b2c].reduce((s, e) => s + e.cgst, 0);
      const totalSgst = [...b2b, ...b2c].reduce((s, e) => s + e.sgst, 0);
      const totalIgst = [...b2b, ...b2c].reduce((s, e) => s + e.igst, 0);
      const totalTax = totalCgst + totalSgst + totalIgst;

      return {
        period: { month: input.month, year: input.year, label: `${MONTHS[input.month]} ${input.year}` },
        b2b: { items: b2b, count: b2b.length, total_taxable: b2b.reduce((s, e) => s + e.taxable_value, 0) },
        b2c: { items: b2c, count: b2c.length, total_taxable: b2c.reduce((s, e) => s + e.taxable_value, 0) },
        hsn_summary: hsnSummary,
        totals: { taxable: totalTaxable, cgst: totalCgst, sgst: totalSgst, igst: totalIgst, total_tax: totalTax },
      };
    }),

  // ═══════════════════════════════════════════════
  // GSTR-3B GENERATION (Summary Return)
  // ═══════════════════════════════════════════════

  generateGstr3b: protectedProcedure
    .input(z.object({ month: z.number().min(1).max(12), year: z.number().min(2020) }))
    .query(async ({ ctx, input }) => {
      const { start, end } = periodDates(input.month, input.year);

      // Output tax: from revenue JEs
      const outputTax = await db.select({
        total_credit: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(and(
          eq(journalEntries.hospital_id, ctx.user.hospital_id),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entry_date, start),
          lte(journalEntries.entry_date, end),
          eq(chartOfAccounts.account_type, 'revenue'),
          sql`${journalEntryLines.credit_amount} > 0`,
        ));

      const outwardTaxable = Number(outputTax[0]?.total_credit ?? 0);
      const avgGstRate = 18; // Default rate
      const outwardCgst = Math.round(outwardTaxable * (avgGstRate / 2) / 100 * 100) / 100;
      const outwardSgst = outwardCgst;
      const outwardTotal = outwardCgst + outwardSgst;

      // ITC: from itc_ledger for this period
      const itcData = await db.select({
        total_cgst: sql<number>`COALESCE(SUM(${itcLedger.cgst}), 0)`,
        total_sgst: sql<number>`COALESCE(SUM(${itcLedger.sgst}), 0)`,
        total_igst: sql<number>`COALESCE(SUM(${itcLedger.igst}), 0)`,
        total_cess: sql<number>`COALESCE(SUM(${itcLedger.cess}), 0)`,
        total_itc: sql<number>`COALESCE(SUM(${itcLedger.total_itc}), 0)`,
        count: sql<number>`count(*)`,
      })
        .from(itcLedger)
        .where(and(
          eq(itcLedger.hospital_id, ctx.user.hospital_id),
          eq(itcLedger.claim_month, input.month),
          eq(itcLedger.claim_year, input.year),
          eq(itcLedger.status, 'available'),
        ));

      const itcCgst = Number(itcData[0]?.total_cgst ?? 0);
      const itcSgst = Number(itcData[0]?.total_sgst ?? 0);
      const itcIgst = Number(itcData[0]?.total_igst ?? 0);
      const itcTotal = Number(itcData[0]?.total_itc ?? 0);

      const netCgst = Math.max(0, outwardCgst - itcCgst);
      const netSgst = Math.max(0, outwardSgst - itcSgst);
      const netPayable = netCgst + netSgst;

      return {
        period: { month: input.month, year: input.year, label: `${MONTHS[input.month]} ${input.year}` },
        outward_supplies: {
          taxable_value: outwardTaxable,
          cgst: outwardCgst,
          sgst: outwardSgst,
          igst: 0,
          total: outwardTotal,
        },
        itc_available: {
          cgst: itcCgst,
          sgst: itcSgst,
          igst: itcIgst,
          cess: Number(itcData[0]?.total_cess ?? 0),
          total: itcTotal,
          invoice_count: Number(itcData[0]?.count ?? 0),
        },
        net_payable: {
          cgst: netCgst,
          sgst: netSgst,
          igst: 0,
          total: netPayable,
        },
        interest: 0,
        late_fee: 0,
      };
    }),

  // ═══════════════════════════════════════════════
  // SAVE RETURN
  // ═══════════════════════════════════════════════

  saveReturn: adminProcedure
    .input(z.object({
      return_type: z.enum(['gstr_1', 'gstr_3b']),
      month: z.number().min(1).max(12),
      year: z.number(),
      data: z.any(),
      total_taxable_value: z.number().optional(),
      total_cgst: z.number().optional(),
      total_sgst: z.number().optional(),
      total_igst: z.number().optional(),
      total_tax: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(gstReturns).values({
        hospital_id: ctx.user.hospital_id,
        return_type: input.return_type,
        period_month: input.month,
        period_year: input.year,
        period_label: `${MONTHS[input.month]} ${input.year}`,
        data: input.data,
        total_taxable_value: input.total_taxable_value != null ? String(input.total_taxable_value) : null,
        total_cgst: input.total_cgst != null ? String(input.total_cgst) : null,
        total_sgst: input.total_sgst != null ? String(input.total_sgst) : null,
        total_igst: input.total_igst != null ? String(input.total_igst) : null,
        total_tax: input.total_tax != null ? String(input.total_tax) : null,
        generated_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'gst_returns', row_id: inserted[0].id,
        new_values: { return_type: input.return_type, period: `${input.month}/${input.year}` },
        reason: `${input.return_type.toUpperCase()} saved`,
      });
      return inserted[0];
    }),

  listReturns: protectedProcedure
    .input(z.object({
      return_type: z.enum(['gstr_1', 'gstr_3b']).optional(),
      year: z.number().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(gstReturns.hospital_id, ctx.user.hospital_id)];
      if (input.return_type) conditions.push(eq(gstReturns.return_type, input.return_type));
      if (input.year) conditions.push(eq(gstReturns.period_year, input.year));

      const rows = await db.select()
        .from(gstReturns)
        .where(and(...conditions))
        .orderBy(desc(gstReturns.period_year), desc(gstReturns.period_month))
        .limit(50);
      return rows;
    }),

  updateReturnStatus: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['draft', 'generated', 'reviewed', 'filed', 'revised'] as const),
      filed_date: z.string().optional(),
      filed_arn: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateObj: any = { status: input.status, updated_at: new Date() };
      if (input.filed_date) updateObj.filed_date = input.filed_date;
      if (input.filed_arn) updateObj.filed_arn = input.filed_arn;

      const updated = await db.update(gstReturns).set(updateObj)
        .where(and(eq(gstReturns.id, input.id), eq(gstReturns.hospital_id, ctx.user.hospital_id)))
        .returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'gst_returns', row_id: input.id, new_values: updateObj, reason: `Return ${input.status}` });
      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // ITC LEDGER
  // ═══════════════════════════════════════════════

  listItc: protectedProcedure
    .input(z.object({
      month: z.number().min(1).max(12).optional(),
      year: z.number().optional(),
      status: z.enum(['available', 'claimed', 'reversed', 'ineligible'] as const).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { month, year, status, page, pageSize } = input;
      const conditions: any[] = [eq(itcLedger.hospital_id, ctx.user.hospital_id)];
      if (month) conditions.push(eq(itcLedger.claim_month, month));
      if (year) conditions.push(eq(itcLedger.claim_year, year));
      if (status) conditions.push(eq(itcLedger.status, status));

      const countResult = await db.select({ count: sql<number>`count(*)` }).from(itcLedger).where(and(...conditions));
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(itcLedger)
        .where(and(...conditions))
        .orderBy(desc(itcLedger.invoice_date))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      // Totals
      const totals = await db.select({
        total_itc: sql<number>`COALESCE(SUM(${itcLedger.total_itc}), 0)`,
        total_cgst: sql<number>`COALESCE(SUM(${itcLedger.cgst}), 0)`,
        total_sgst: sql<number>`COALESCE(SUM(${itcLedger.sgst}), 0)`,
      }).from(itcLedger).where(and(...conditions));

      return {
        items: rows, total, page, pageSize,
        totals: { itc: Number(totals[0]?.total_itc ?? 0), cgst: Number(totals[0]?.total_cgst ?? 0), sgst: Number(totals[0]?.total_sgst ?? 0) },
      };
    }),

  createItc: adminProcedure
    .input(z.object({
      vendor_invoice_id: z.string().uuid().optional(),
      vendor_name: z.string().min(1),
      vendor_gstin: z.string().optional(),
      invoice_number: z.string().min(1),
      invoice_date: z.string(),
      taxable_value: z.number().min(0),
      cgst: z.number().min(0).default(0),
      sgst: z.number().min(0).default(0),
      igst: z.number().min(0).default(0),
      cess: z.number().min(0).default(0),
      hsn_code: z.string().optional(),
      gst_rate: z.number().optional(),
      claim_month: z.number().min(1).max(12),
      claim_year: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const totalItc = input.cgst + input.sgst + input.igst + input.cess;

      const inserted = await db.insert(itcLedger).values({
        hospital_id: ctx.user.hospital_id,
        vendor_invoice_id: input.vendor_invoice_id || null,
        vendor_name: input.vendor_name,
        vendor_gstin: input.vendor_gstin || null,
        invoice_number: input.invoice_number,
        invoice_date: input.invoice_date,
        taxable_value: String(input.taxable_value),
        cgst: String(input.cgst),
        sgst: String(input.sgst),
        igst: String(input.igst),
        cess: String(input.cess),
        total_itc: String(totalItc),
        hsn_code: input.hsn_code || null,
        gst_rate: input.gst_rate != null ? String(input.gst_rate) : null,
        claim_month: input.claim_month,
        claim_year: input.claim_year,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'itc_ledger', row_id: inserted[0].id,
        new_values: { vendor_name: input.vendor_name, total_itc: totalItc },
        reason: 'ITC entry created',
      });
      return inserted[0];
    }),

  updateItcStatus: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['available', 'claimed', 'reversed', 'ineligible'] as const),
      reversal_reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateObj: any = { status: input.status };
      if (input.reversal_reason) updateObj.reversal_reason = input.reversal_reason;

      const updated = await db.update(itcLedger).set(updateObj)
        .where(and(eq(itcLedger.id, input.id), eq(itcLedger.hospital_id, ctx.user.hospital_id)))
        .returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });
      return updated[0];
    }),

  itcSummary: protectedProcedure
    .input(z.object({ year: z.number() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select({
        month: itcLedger.claim_month,
        status: itcLedger.status,
        total: sql<number>`COALESCE(SUM(${itcLedger.total_itc}), 0)`,
        count: sql<number>`count(*)`,
      })
        .from(itcLedger)
        .where(and(eq(itcLedger.hospital_id, ctx.user.hospital_id), eq(itcLedger.claim_year, input.year)))
        .groupBy(itcLedger.claim_month, itcLedger.status)
        .orderBy(asc(itcLedger.claim_month));

      return rows.map(r => ({ month: r.month, month_name: MONTHS[r.month], status: r.status, total: Number(r.total), count: Number(r.count) }));
    }),

  // ═══════════════════════════════════════════════
  // RECONCILIATION
  // ═══════════════════════════════════════════════

  createReconciliation: adminProcedure
    .input(z.object({
      month: z.number().min(1).max(12),
      year: z.number(),
      books_taxable: z.number(),
      books_tax: z.number(),
      return_taxable: z.number().optional(),
      return_tax: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const taxableDiff = input.return_taxable != null ? input.books_taxable - input.return_taxable : null;
      const taxDiff = input.return_tax != null ? input.books_tax - input.return_tax : null;
      const reconStatus = taxableDiff != null && taxDiff != null
        ? (Math.abs(taxableDiff) < 1 && Math.abs(taxDiff) < 1 ? 'matched' : 'mismatch')
        : 'pending';

      const inserted = await db.insert(gstReconciliation).values({
        hospital_id: ctx.user.hospital_id,
        period_month: input.month,
        period_year: input.year,
        books_taxable: String(input.books_taxable),
        books_tax: String(input.books_tax),
        return_taxable: input.return_taxable != null ? String(input.return_taxable) : null,
        return_tax: input.return_tax != null ? String(input.return_tax) : null,
        taxable_diff: taxableDiff != null ? String(taxableDiff) : null,
        tax_diff: taxDiff != null ? String(taxDiff) : null,
        status: reconStatus,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'gst_reconciliation', row_id: inserted[0].id,
        new_values: { period: `${input.month}/${input.year}`, status: reconStatus },
        reason: 'GST reconciliation created',
      });
      return inserted[0];
    }),

  listReconciliations: protectedProcedure
    .input(z.object({ year: z.number().optional() }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(gstReconciliation.hospital_id, ctx.user.hospital_id)];
      if (input.year) conditions.push(eq(gstReconciliation.period_year, input.year));

      const rows = await db.select()
        .from(gstReconciliation)
        .where(and(...conditions))
        .orderBy(desc(gstReconciliation.period_year), desc(gstReconciliation.period_month))
        .limit(24);
      return rows;
    }),

  resolveReconciliation: adminProcedure
    .input(z.object({ id: z.string().uuid(), resolution_notes: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.update(gstReconciliation).set({
        status: 'resolved', resolution_notes: input.resolution_notes, updated_at: new Date(),
      }).where(and(eq(gstReconciliation.id, input.id), eq(gstReconciliation.hospital_id, ctx.user.hospital_id))).returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });
      return updated[0];
    }),
});
