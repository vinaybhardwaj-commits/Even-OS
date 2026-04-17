import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { vendorContracts, vendorInvoices } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, ilike, or, gte, lte } from 'drizzle-orm';

const contractTypes = ['supply','service','lease','amc','consulting','outsourced_lab','catering','housekeeping','laundry','other'] as const;
const contractStatuses = ['draft','active','expiring_soon','expired','terminated'] as const;
const paymentTerms = ['net_15','net_30','net_45','net_60','advance','milestone'] as const;
const paymentFrequencies = ['one_time','monthly','quarterly','annual','per_invoice'] as const;
const invoiceStatuses = ['received','verified','approved','scheduled','paid','disputed','cancelled'] as const;

export const vendorApRouter = router({

  // ═══════════════════════════════════════════════
  // CONTRACTS
  // ═══════════════════════════════════════════════

  listContracts: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      contract_type: z.enum(contractTypes).optional(),
      status: z.enum(contractStatuses).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, contract_type, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(vendorContracts.hospital_id, ctx.user.hospital_id)];
      if (contract_type) conditions.push(eq(vendorContracts.contract_type, contract_type));
      if (status) conditions.push(eq(vendorContracts.status, status));
      if (search) {
        conditions.push(or(
          ilike(vendorContracts.vendor_name, `%${search}%`),
          ilike(vendorContracts.contract_number, `%${search}%`),
          ilike(vendorContracts.vendor_code, `%${search}%`),
        )!);
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(vendorContracts).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(vendorContracts)
        .where(where)
        .orderBy(desc(vendorContracts.updated_at))
        .limit(pageSize)
        .offset(offset);

      // Flag expiring contracts
      const today = new Date().toISOString().split('T')[0];
      const items = rows.map(r => {
        const daysToExpiry = r.end_date ? Math.ceil((new Date(r.end_date).getTime() - Date.now()) / (1000 * 86400)) : null;
        return { ...r, days_to_expiry: daysToExpiry, is_expiring: daysToExpiry !== null && daysToExpiry <= 30 && daysToExpiry > 0 };
      });

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  getContract: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(vendorContracts)
        .where(and(eq(vendorContracts.id, input.id), eq(vendorContracts.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contract not found' });

      // Get invoice summary for this contract
      const invoiceSummary = await db.select({
        total_invoices: sql<number>`count(*)`,
        total_amount: sql<number>`COALESCE(SUM(${vendorInvoices.amount}), 0)`,
        total_paid: sql<number>`COALESCE(SUM(CASE WHEN ${vendorInvoices.status} = 'paid' THEN ${vendorInvoices.net_payable} ELSE 0 END), 0)`,
        pending_amount: sql<number>`COALESCE(SUM(CASE WHEN ${vendorInvoices.status} NOT IN ('paid','cancelled') THEN ${vendorInvoices.net_payable} ELSE 0 END), 0)`,
      })
        .from(vendorInvoices)
        .where(eq(vendorInvoices.contract_id, input.id));

      return {
        ...rows[0],
        invoice_summary: {
          total_invoices: Number(invoiceSummary[0]?.total_invoices ?? 0),
          total_amount: Number(invoiceSummary[0]?.total_amount ?? 0),
          total_paid: Number(invoiceSummary[0]?.total_paid ?? 0),
          pending_amount: Number(invoiceSummary[0]?.pending_amount ?? 0),
        },
      };
    }),

  createContract: adminProcedure
    .input(z.object({
      vendor_name: z.string().min(1),
      vendor_code: z.string().optional(),
      vendor_gstin: z.string().optional(),
      vendor_pan: z.string().optional(),
      vendor_contact: z.string().optional(),
      vendor_email: z.string().optional(),
      vendor_phone: z.string().optional(),
      vendor_address: z.string().optional(),
      contract_number: z.string().min(1),
      contract_type: z.enum(contractTypes),
      description: z.string().optional(),
      start_date: z.string(),
      end_date: z.string().optional(),
      auto_renewal: z.boolean().default(false),
      renewal_notice_days: z.number().default(30),
      payment_terms: z.enum(paymentTerms),
      payment_frequency: z.enum(paymentFrequencies).optional(),
      contract_value: z.string().optional().transform(v => v ? parseFloat(v) : null),
      monthly_value: z.string().optional().transform(v => v ? parseFloat(v) : null),
      gst_percent: z.string().optional().transform(v => v ? parseFloat(v) : null),
      tds_applicable: z.boolean().default(false),
      tds_percent: z.string().optional().transform(v => v ? parseFloat(v) : null),
      tds_section: z.string().optional(),
      default_expense_account_id: z.string().uuid().optional(),
      status: z.enum(contractStatuses).default('active'),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(vendorContracts).values({
        hospital_id: ctx.user.hospital_id,
        vendor_name: input.vendor_name,
        vendor_code: input.vendor_code || null,
        vendor_gstin: input.vendor_gstin || null,
        vendor_pan: input.vendor_pan || null,
        vendor_contact: input.vendor_contact || null,
        vendor_email: input.vendor_email || null,
        vendor_phone: input.vendor_phone || null,
        vendor_address: input.vendor_address || null,
        contract_number: input.contract_number,
        contract_type: input.contract_type,
        description: input.description || null,
        start_date: input.start_date,
        end_date: input.end_date || null,
        auto_renewal: input.auto_renewal,
        renewal_notice_days: input.renewal_notice_days,
        payment_terms: input.payment_terms,
        payment_frequency: input.payment_frequency || null,
        contract_value: input.contract_value !== null ? String(input.contract_value) : null,
        monthly_value: input.monthly_value !== null ? String(input.monthly_value) : null,
        gst_percent: input.gst_percent !== null ? String(input.gst_percent) : null,
        tds_applicable: input.tds_applicable,
        tds_percent: input.tds_percent !== null ? String(input.tds_percent) : null,
        tds_section: input.tds_section || null,
        default_expense_account_id: input.default_expense_account_id || null,
        status: input.status,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'vendor_contracts',
        row_id: inserted[0].id,
        new_values: { vendor_name: input.vendor_name, contract_number: input.contract_number },
        reason: 'Vendor contract created',
      });

      return inserted[0];
    }),

  updateContract: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      vendor_name: z.string().optional(),
      vendor_code: z.string().nullable().optional(),
      vendor_gstin: z.string().nullable().optional(),
      vendor_pan: z.string().nullable().optional(),
      vendor_contact: z.string().nullable().optional(),
      vendor_email: z.string().nullable().optional(),
      vendor_phone: z.string().nullable().optional(),
      vendor_address: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      end_date: z.string().nullable().optional(),
      auto_renewal: z.boolean().optional(),
      renewal_notice_days: z.number().optional(),
      payment_terms: z.enum(paymentTerms).optional(),
      payment_frequency: z.enum(paymentFrequencies).nullable().optional(),
      contract_value: z.string().nullable().optional().transform(v => v ? parseFloat(v) : v === null ? null : undefined),
      monthly_value: z.string().nullable().optional().transform(v => v ? parseFloat(v) : v === null ? null : undefined),
      gst_percent: z.string().nullable().optional().transform(v => v ? parseFloat(v) : v === null ? null : undefined),
      tds_applicable: z.boolean().optional(),
      tds_percent: z.string().nullable().optional().transform(v => v ? parseFloat(v) : v === null ? null : undefined),
      tds_section: z.string().nullable().optional(),
      default_expense_account_id: z.string().uuid().nullable().optional(),
      status: z.enum(contractStatuses).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const existing = await db.select().from(vendorContracts)
        .where(and(eq(vendorContracts.id, id), eq(vendorContracts.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!existing.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contract not found' });

      const updateObj: any = { updated_at: new Date() };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) {
          if (['contract_value', 'monthly_value', 'gst_percent', 'tds_percent'].includes(key)) {
            updateObj[key] = val !== null ? String(val) : null;
          } else {
            updateObj[key] = val;
          }
        }
      }

      const updated = await db.update(vendorContracts).set(updateObj).where(eq(vendorContracts.id, id)).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'vendor_contracts', row_id: id,
        new_values: updateObj, reason: 'Vendor contract updated',
      });

      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // INVOICES
  // ═══════════════════════════════════════════════

  listInvoices: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      contract_id: z.string().uuid().optional(),
      status: z.enum(invoiceStatuses).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      overdue_only: z.boolean().default(false),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, contract_id, status, date_from, date_to, overdue_only, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(vendorInvoices.hospital_id, ctx.user.hospital_id)];
      if (contract_id) conditions.push(eq(vendorInvoices.contract_id, contract_id));
      if (status) conditions.push(eq(vendorInvoices.status, status));
      if (date_from) conditions.push(gte(vendorInvoices.invoice_date, date_from));
      if (date_to) conditions.push(lte(vendorInvoices.invoice_date, date_to));
      if (overdue_only) {
        const today = new Date().toISOString().split('T')[0];
        conditions.push(lte(vendorInvoices.due_date, today));
        conditions.push(sql`${vendorInvoices.status} NOT IN ('paid','cancelled')`);
      }
      if (search) {
        conditions.push(or(
          ilike(vendorInvoices.vendor_name, `%${search}%`),
          ilike(vendorInvoices.invoice_number, `%${search}%`),
          ilike(vendorInvoices.our_reference, `%${search}%`),
        )!);
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(vendorInvoices).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(vendorInvoices)
        .where(where)
        .orderBy(desc(vendorInvoices.invoice_date))
        .limit(pageSize)
        .offset(offset);

      const today = new Date().toISOString().split('T')[0];
      const items = rows.map(r => {
        const isOverdue = r.due_date < today && !['paid', 'cancelled'].includes(r.status);
        const daysOverdue = isOverdue ? Math.ceil((Date.now() - new Date(r.due_date).getTime()) / (1000 * 86400)) : 0;
        return { ...r, is_overdue: isOverdue, days_overdue: daysOverdue };
      });

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  getInvoice: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(vendorInvoices)
        .where(and(eq(vendorInvoices.id, input.id), eq(vendorInvoices.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
      return rows[0];
    }),

  createInvoice: adminProcedure
    .input(z.object({
      contract_id: z.string().uuid().optional(),
      vendor_name: z.string().min(1),
      invoice_number: z.string().min(1),
      our_reference: z.string().optional(),
      invoice_date: z.string(),
      due_date: z.string(),
      amount: z.number().min(0),
      gst_amount: z.number().min(0).default(0),
      tds_amount: z.number().min(0).default(0),
      expense_account_id: z.string().uuid().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const netPayable = input.amount + input.gst_amount - input.tds_amount;

      const inserted = await db.insert(vendorInvoices).values({
        hospital_id: ctx.user.hospital_id,
        contract_id: input.contract_id || null,
        vendor_name: input.vendor_name,
        invoice_number: input.invoice_number,
        our_reference: input.our_reference || null,
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        amount: String(input.amount),
        gst_amount: String(input.gst_amount),
        tds_amount: String(input.tds_amount),
        net_payable: String(netPayable),
        status: 'received',
        expense_account_id: input.expense_account_id || null,
        notes: input.notes || null,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'vendor_invoices', row_id: inserted[0].id,
        new_values: { vendor_name: input.vendor_name, invoice_number: input.invoice_number, net_payable: netPayable },
        reason: 'Vendor invoice recorded',
      });

      return inserted[0];
    }),

  // TDS auto-calculator
  calculateTds: protectedProcedure
    .input(z.object({ contract_id: z.string().uuid(), amount: z.number() }))
    .query(async ({ ctx, input }) => {
      const contract = await db.select()
        .from(vendorContracts)
        .where(and(eq(vendorContracts.id, input.contract_id), eq(vendorContracts.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!contract.length) return { tds_applicable: false, tds_amount: 0, tds_percent: 0, tds_section: null };

      const c = contract[0];
      if (!c.tds_applicable) return { tds_applicable: false, tds_amount: 0, tds_percent: 0, tds_section: null };

      const tdsPercent = Number(c.tds_percent || 0);
      const gstPercent = Number(c.gst_percent || 0);
      const gstAmount = input.amount * gstPercent / 100;
      const tdsAmount = input.amount * tdsPercent / 100;
      const netPayable = input.amount + gstAmount - tdsAmount;

      return {
        tds_applicable: true,
        tds_percent: tdsPercent,
        tds_section: c.tds_section,
        tds_amount: Math.round(tdsAmount * 100) / 100,
        gst_amount: Math.round(gstAmount * 100) / 100,
        net_payable: Math.round(netPayable * 100) / 100,
      };
    }),

  // Invoice workflow transitions
  verifyInvoice: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await db.select().from(vendorInvoices)
        .where(and(eq(vendorInvoices.id, input.id), eq(vendorInvoices.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!inv.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv[0].status !== 'received') throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot verify a ${inv[0].status} invoice` });

      const updated = await db.update(vendorInvoices)
        .set({ status: 'verified', verified_by: ctx.user.sub, verified_at: new Date() })
        .where(eq(vendorInvoices.id, input.id)).returning();

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'vendor_invoices', row_id: input.id, new_values: { status: 'verified' }, reason: 'Invoice verified' });
      return updated[0];
    }),

  approveInvoice: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await db.select().from(vendorInvoices)
        .where(and(eq(vendorInvoices.id, input.id), eq(vendorInvoices.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!inv.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv[0].status !== 'verified') throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot approve a ${inv[0].status} invoice` });

      const updated = await db.update(vendorInvoices)
        .set({ status: 'approved', approved_by: ctx.user.sub, approved_at: new Date() })
        .where(eq(vendorInvoices.id, input.id)).returning();

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'vendor_invoices', row_id: input.id, new_values: { status: 'approved' }, reason: 'Invoice approved' });
      return updated[0];
    }),

  schedulePayment: adminProcedure
    .input(z.object({ id: z.string().uuid(), payment_scheduled_date: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await db.select().from(vendorInvoices)
        .where(and(eq(vendorInvoices.id, input.id), eq(vendorInvoices.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!inv.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv[0].status !== 'approved') throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot schedule payment for a ${inv[0].status} invoice` });

      const updated = await db.update(vendorInvoices)
        .set({ status: 'scheduled', payment_scheduled_date: input.payment_scheduled_date })
        .where(eq(vendorInvoices.id, input.id)).returning();

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'vendor_invoices', row_id: input.id, new_values: { status: 'scheduled', payment_scheduled_date: input.payment_scheduled_date }, reason: 'Payment scheduled' });
      return updated[0];
    }),

  markPaid: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      payment_method: z.string().min(1),
      payment_reference: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inv = await db.select().from(vendorInvoices)
        .where(and(eq(vendorInvoices.id, input.id), eq(vendorInvoices.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!inv.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!['approved', 'scheduled'].includes(inv[0].status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot mark ${inv[0].status} invoice as paid` });
      }

      const updated = await db.update(vendorInvoices)
        .set({
          status: 'paid',
          paid_at: new Date(),
          payment_method: input.payment_method,
          payment_reference: input.payment_reference || null,
        })
        .where(eq(vendorInvoices.id, input.id)).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'vendor_invoices', row_id: input.id,
        new_values: { status: 'paid', payment_method: input.payment_method },
        reason: `Invoice paid via ${input.payment_method}`,
      });

      return updated[0];
    }),

  disputeInvoice: adminProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.update(vendorInvoices)
        .set({ status: 'disputed', notes: input.reason })
        .where(and(eq(vendorInvoices.id, input.id), eq(vendorInvoices.hospital_id, ctx.user.hospital_id)))
        .returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'vendor_invoices', row_id: input.id, new_values: { status: 'disputed' }, reason: input.reason });
      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // DASHBOARDS / SUMMARIES
  // ═══════════════════════════════════════════════

  apSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const today = new Date().toISOString().split('T')[0];

      const statusCounts = await db.select({
        status: vendorInvoices.status,
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(SUM(${vendorInvoices.net_payable}), 0)`,
      })
        .from(vendorInvoices)
        .where(eq(vendorInvoices.hospital_id, ctx.user.hospital_id))
        .groupBy(vendorInvoices.status);

      const overdue = await db.select({
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(SUM(${vendorInvoices.net_payable}), 0)`,
      })
        .from(vendorInvoices)
        .where(and(
          eq(vendorInvoices.hospital_id, ctx.user.hospital_id),
          lte(vendorInvoices.due_date, today),
          sql`${vendorInvoices.status} NOT IN ('paid','cancelled')`,
        ));

      const expiringContracts = await db.select({ count: sql<number>`count(*)` })
        .from(vendorContracts)
        .where(and(
          eq(vendorContracts.hospital_id, ctx.user.hospital_id),
          eq(vendorContracts.status, 'active'),
          lte(vendorContracts.end_date, sql`CURRENT_DATE + interval '30 days'`),
          gte(vendorContracts.end_date, sql`CURRENT_DATE`),
        ));

      return {
        by_status: statusCounts.map(s => ({ status: s.status, count: Number(s.count), total: Number(s.total) })),
        overdue: { count: Number(overdue[0]?.count ?? 0), total: Number(overdue[0]?.total ?? 0) },
        expiring_contracts: Number(expiringContracts[0]?.count ?? 0),
      };
    }),

  paymentSchedule: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [
        eq(vendorInvoices.hospital_id, ctx.user.hospital_id),
        sql`${vendorInvoices.status} IN ('approved','scheduled')`,
      ];
      if (input.date_from) conditions.push(gte(vendorInvoices.due_date, input.date_from));
      if (input.date_to) conditions.push(lte(vendorInvoices.due_date, input.date_to));

      const rows = await db.select()
        .from(vendorInvoices)
        .where(and(...conditions))
        .orderBy(asc(vendorInvoices.due_date))
        .limit(100);

      const totalPayable = rows.reduce((sum, r) => sum + Number(r.net_payable), 0);

      return { items: rows, total_payable: totalPayable };
    }),
});
