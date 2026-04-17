import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  encounterCharges, invoices, payments, tpaClaims,
  encounters, patients, chargeMaster, clinicalOrders, billingAccounts, insurers,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, sum, count } from 'drizzle-orm';
import { generateBillWithRules, applyRuleResults, formatBillForTPA } from '@/lib/billing/bill-generator';

const invoiceStatusValues = ['draft', 'pending', 'partially_paid', 'paid', 'cancelled', 'written_off'] as const;
const paymentMethodValues = ['cash', 'card', 'upi', 'neft', 'cheque', 'insurance_settlement', 'other'] as const;
const claimStatusValues = ['draft', 'submitted', 'query_raised', 'approved', 'partially_approved', 'rejected', 'settled'] as const;

// Helper: Round to 2 decimal places
function roundToTwo(num: number | string | null | undefined): string {
  if (!num) return '0.00';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return (Math.round(n * 100) / 100).toFixed(2);
}

// Helper: Calculate net amount
function calculateNetAmount(quantity: number, unitPrice: string | number, discountPercent: number = 0, gstPercent: number = 0): string {
  const uPrice = typeof unitPrice === 'string' ? parseFloat(unitPrice) : unitPrice;
  const afterDiscount = quantity * uPrice * (1 - discountPercent / 100);
  const withGst = afterDiscount * (1 + gstPercent / 100);
  return roundToTwo(withGst);
}

export const billingRouter = router({

  // ─── ADD CHARGE ────────────────────────────────────────────
  addCharge: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      charge_master_id: z.string().uuid().optional(),
      charge_code: z.string().max(50).optional(),
      charge_name: z.string().min(1).max(255),
      category: z.string().max(50),
      quantity: z.number().int().min(1).default(1),
      unit_price: z.string().or(z.number()),
      discount_percent: z.number().min(0).max(100).default(0),
      gst_percent: z.number().min(0).max(100).default(0),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is in-progress
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });

      // 2. Calculate net amount
      const netAmount = calculateNetAmount(input.quantity, input.unit_price, input.discount_percent, input.gst_percent);

      // 3. Create charge
      const [charge] = await db.insert(encounterCharges).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        charge_master_id: input.charge_master_id ? (input.charge_master_id as any) : null,
        charge_code: input.charge_code || null,
        charge_name: input.charge_name,
        category: input.category,
        quantity: input.quantity,
        unit_price: roundToTwo(input.unit_price) as any,
        discount_percent: roundToTwo(input.discount_percent) as any,
        gst_percent: roundToTwo(input.gst_percent) as any,
        net_amount: netAmount as any,
        service_date: new Date(),
        notes: input.notes || null,
        created_by_user_id: ctx.user.sub,
      }).returning();

      // 4. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'encounter_charges',
        row_id: charge.id,
        new_values: {
          encounter_id: input.encounter_id,
          charge_name: input.charge_name,
          quantity: input.quantity,
          net_amount: netAmount,
        },
      });

      return {
        charge_id: charge.id,
        encounter_id: charge.encounter_id,
        net_amount: charge.net_amount,
        created_at: charge.created_at,
      };
    }),

  // ─── LIST CHARGES ──────────────────────────────────────────
  listCharges: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      // Verify encounter exists
      const [encounter] = await db.select({ id: encounters.id })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });

      // Fetch charges
      const charges = await db.select({
        id: encounterCharges.id,
        charge_code: encounterCharges.charge_code,
        charge_name: encounterCharges.charge_name,
        category: encounterCharges.category,
        quantity: encounterCharges.quantity,
        unit_price: encounterCharges.unit_price,
        discount_percent: encounterCharges.discount_percent,
        gst_percent: encounterCharges.gst_percent,
        net_amount: encounterCharges.net_amount,
        service_date: encounterCharges.service_date,
        notes: encounterCharges.notes,
        created_at: encounterCharges.created_at,
      })
        .from(encounterCharges)
        .where(and(
          eq(encounterCharges.encounter_id, input.encounter_id as any),
          eq(encounterCharges.hospital_id, hospitalId),
        ))
        .orderBy(desc(encounterCharges.service_date))
        .limit(input.limit)
        .offset(offset);

      // Calculate totals
      const totalsResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(net_amount), 0) as total_amount,
          COALESCE(SUM(discount_percent * quantity * unit_price / 100), 0) as total_discount,
          COALESCE(SUM(gst_percent * quantity * unit_price * (1 - discount_percent / 100) / 100), 0) as total_gst
        FROM encounter_charges
        WHERE encounter_id = ${input.encounter_id}::uuid
          AND hospital_id = ${hospitalId}
      `);

      const totals = ((totalsResult as any).rows || totalsResult)[0] || { total_amount: '0', total_discount: '0', total_gst: '0' };

      // Count total
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM encounter_charges
        WHERE encounter_id = ${input.encounter_id}::uuid
          AND hospital_id = ${hospitalId}
      `);

      const total = parseInt(((countResult as any).rows || countResult)[0]?.total || '0', 10);

      return {
        charges,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          pages: Math.ceil(total / input.limit),
        },
        summary: {
          subtotal: roundToTwo(totals.total_amount),
          total_discount: roundToTwo(totals.total_discount),
          total_gst: roundToTwo(totals.total_gst),
          grand_total: roundToTwo(
            (typeof totals.total_amount === 'string' ? parseFloat(totals.total_amount) : totals.total_amount) +
            (typeof totals.total_gst === 'string' ? parseFloat(totals.total_gst) : totals.total_gst)
          ),
        },
      };
    }),

  // ─── GENERATE INVOICE ──────────────────────────────────────
  generateInvoice: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });

      // 2. Check no invoice already finalized
      const [existingInvoice] = await db.select({ id: invoices.id })
        .from(invoices)
        .where(and(
          eq(invoices.encounter_id, input.encounter_id as any),
          eq(invoices.hospital_id, hospitalId),
        ))
        .orderBy(desc(invoices.created_at))
        .limit(1);

      if (existingInvoice) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Invoice already exists for this encounter' });
      }

      // 3. Sum all charges for encounter
      const chargesResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(net_amount), 0) as subtotal,
          COALESCE(SUM(discount_percent * quantity * unit_price / 100), 0) as discount_total,
          COALESCE(SUM(gst_percent * quantity * unit_price * (1 - discount_percent / 100) / 100), 0) as gst_total
        FROM encounter_charges
        WHERE encounter_id = ${input.encounter_id}::uuid
          AND hospital_id = ${hospitalId}
      `);

      const chargeData = ((chargesResult as any).rows || chargesResult)[0];
      if (!chargeData) {
        throw new TRPCError({ code: 'CONFLICT', message: 'No charges found for this encounter' });
      }

      const subtotal = typeof chargeData.subtotal === 'string' ? parseFloat(chargeData.subtotal) : chargeData.subtotal;
      const discountTotal = typeof chargeData.discount_total === 'string' ? parseFloat(chargeData.discount_total) : chargeData.discount_total;
      const gstTotal = typeof chargeData.gst_total === 'string' ? parseFloat(chargeData.gst_total) : chargeData.gst_total;
      const grandTotal = subtotal + gstTotal - discountTotal;

      // 4. Generate invoice number atomically (format: INV-XXXXXX)
      const invoiceNumberResult = await db.execute(sql`
        INSERT INTO invoice_sequences (hospital_id, prefix, next_value)
        VALUES (${hospitalId}, 'INV', 1)
        ON CONFLICT (hospital_id, prefix) DO UPDATE
        SET next_value = next_value + 1
        RETURNING hospital_id, prefix, next_value - 1 as current_value
      `);

      const invoiceSeq = ((invoiceNumberResult as any).rows || invoiceNumberResult)[0];
      const invoiceNumber = `${invoiceSeq.prefix}-${String(invoiceSeq.current_value).padStart(6, '0')}`;

      // 5. Create invoice
      const [invoice] = await db.insert(invoices).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        invoice_number: invoiceNumber,
        invoice_status: 'pending',
        subtotal: roundToTwo(subtotal) as any,
        discount_total: roundToTwo(discountTotal) as any,
        gst_total: roundToTwo(gstTotal) as any,
        grand_total: roundToTwo(grandTotal) as any,
        amount_paid: '0' as any,
        balance_due: roundToTwo(grandTotal) as any,
        generated_at: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        notes: input.notes || null,
        created_by_user_id: ctx.user.sub,
      }).returning();

      // 6. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'invoices',
        row_id: invoice.id,
        new_values: {
          invoice_number: invoiceNumber,
          encounter_id: input.encounter_id,
          grand_total: roundToTwo(grandTotal),
        },
      });

      return {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        grand_total: invoice.grand_total,
        balance_due: invoice.balance_due,
        generated_at: invoice.generated_at,
      };
    }),

  // ─── GET INVOICE ────────────────────────────────────────────
  getInvoice: protectedProcedure
    .input(z.object({
      invoice_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Fetch invoice with patient info
      const [invoice] = await db.select({
        id: invoices.id,
        invoice_number: invoices.invoice_number,
        invoice_status: invoices.invoice_status,
        subtotal: invoices.subtotal,
        discount_total: invoices.discount_total,
        gst_total: invoices.gst_total,
        grand_total: invoices.grand_total,
        amount_paid: invoices.amount_paid,
        balance_due: invoices.balance_due,
        generated_at: invoices.generated_at,
        due_date: invoices.due_date,
        finalized_at: invoices.finalized_at,
        notes: invoices.notes,
        created_at: invoices.created_at,
        patient_id: invoices.patient_id,
        encounter_id: invoices.encounter_id,
      })
        .from(invoices)
        .where(and(
          eq(invoices.id, input.invoice_id as any),
          eq(invoices.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });

      // Fetch patient
      const [patient] = await db.select({
        uhid: patients.uhid,
        name_full: patients.name_full,
      })
        .from(patients)
        .where(eq(patients.id, invoice.patient_id))
        .limit(1);

      // Fetch charges for this invoice's encounter
      const charges = await db.select({
        id: encounterCharges.id,
        charge_code: encounterCharges.charge_code,
        charge_name: encounterCharges.charge_name,
        category: encounterCharges.category,
        quantity: encounterCharges.quantity,
        unit_price: encounterCharges.unit_price,
        discount_percent: encounterCharges.discount_percent,
        gst_percent: encounterCharges.gst_percent,
        net_amount: encounterCharges.net_amount,
        service_date: encounterCharges.service_date,
      })
        .from(encounterCharges)
        .where(and(
          eq(encounterCharges.encounter_id, invoice.encounter_id),
          eq(encounterCharges.hospital_id, hospitalId),
        ))
        .orderBy(desc(encounterCharges.service_date));

      // Fetch payments for this invoice
      const paymentsList = await db.select({
        id: payments.id,
        amount: payments.amount,
        payment_method: payments.payment_method,
        reference_number: payments.reference_number,
        payment_date: payments.payment_date,
        notes: payments.notes,
      })
        .from(payments)
        .where(and(
          eq(payments.invoice_id, input.invoice_id as any),
          eq(payments.hospital_id, hospitalId),
        ))
        .orderBy(desc(payments.payment_date));

      return {
        invoice,
        patient,
        charges,
        payments: paymentsList,
      };
    }),

  // ─── LIST INVOICES ────────────────────────────────────────
  listInvoices: protectedProcedure
    .input(z.object({
      status: z.enum(invoiceStatusValues).optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      const statusFilter = input.status ? sql`AND inv.invoice_status = ${input.status}` : sql``;

      const result = await db.execute(sql`
        SELECT
          inv.id, inv.invoice_number, inv.invoice_status,
          inv.subtotal, inv.discount_total, inv.gst_total, inv.grand_total,
          inv.amount_paid, inv.balance_due,
          inv.generated_at, inv.due_date, inv.finalized_at,
          p.uhid, p.name_full as patient_name
        FROM invoices inv
        JOIN patients p ON inv.patient_id = p.id
        WHERE inv.hospital_id = ${hospitalId}
          ${statusFilter}
        ORDER BY inv.generated_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM invoices
        WHERE hospital_id = ${hospitalId}
          ${statusFilter}
      `);

      const total = parseInt(((countResult as any).rows || countResult)[0]?.total || '0', 10);

      return {
        invoices: (result as any).rows || result,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          pages: Math.ceil(total / input.limit),
        },
      };
    }),

  // ─── RECORD PAYMENT ────────────────────────────────────────
  recordPayment: protectedProcedure
    .input(z.object({
      invoice_id: z.string().uuid(),
      amount: z.string().or(z.number()),
      payment_method: z.enum(paymentMethodValues),
      reference_number: z.string().max(100).optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Fetch invoice
      const [invoice] = await db.select({
        id: invoices.id,
        grand_total: invoices.grand_total,
        amount_paid: invoices.amount_paid,
        balance_due: invoices.balance_due,
        encounter_id: invoices.encounter_id,
        patient_id: invoices.patient_id,
      })
        .from(invoices)
        .where(and(
          eq(invoices.id, input.invoice_id as any),
          eq(invoices.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });

      const paymentAmount = typeof input.amount === 'string' ? parseFloat(input.amount) : input.amount;
      const currentPaid = typeof invoice.amount_paid === 'string' ? parseFloat(invoice.amount_paid) : (invoice.amount_paid || 0);
      const newAmountPaid = currentPaid + paymentAmount;
      const grandTotal = typeof invoice.grand_total === 'string' ? parseFloat(invoice.grand_total) : (invoice.grand_total || 0);
      const newBalanceDue = Math.max(0, grandTotal - newAmountPaid);

      // 2. Determine new status
      let newStatus: 'partially_paid' | 'paid' = 'partially_paid';
      if (newAmountPaid >= grandTotal) {
        newStatus = 'paid';
      }

      // 3. Record payment
      const [payment] = await db.insert(payments).values({
        hospital_id: hospitalId,
        invoice_id: input.invoice_id,
        encounter_id: invoice.encounter_id,
        patient_id: invoice.patient_id,
        amount: roundToTwo(paymentAmount) as any,
        payment_method: input.payment_method,
        reference_number: input.reference_number || null,
        payment_date: new Date(),
        notes: input.notes || null,
        received_by_user_id: ctx.user.sub,
      }).returning();

      // 4. Update invoice
      await db.update(invoices)
        .set({
          amount_paid: roundToTwo(newAmountPaid) as any,
          balance_due: roundToTwo(newBalanceDue) as any,
          invoice_status: newStatus,
          finalized_at: newStatus === 'paid' ? new Date() : null,
          updated_at: new Date(),
        })
        .where(eq(invoices.id, input.invoice_id as any));

      // 5. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'payments',
        row_id: payment.id,
        new_values: {
          invoice_id: input.invoice_id,
          amount: roundToTwo(paymentAmount),
          payment_method: input.payment_method,
        },
      });

      return {
        payment_id: payment.id,
        amount_paid: roundToTwo(newAmountPaid),
        balance_due: roundToTwo(newBalanceDue),
        invoice_status: newStatus,
      };
    }),

  // ─── CREATE TPA CLAIM ──────────────────────────────────────
  createTpaClaim: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      invoice_id: z.string().uuid().optional(),
      tpa_name: z.string().max(255).optional(),
      insurance_company: z.string().max(255),
      policy_number: z.string().max(100).optional(),
      member_id: z.string().max(100).optional(),
      claimed_amount: z.string().or(z.number()),
      pre_auth_number: z.string().max(100).optional(),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists
      const [encounter] = await db.select({ id: encounters.id, patient_id: encounters.patient_id })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });

      // 2. Create claim
      const [claim] = await db.insert(tpaClaims).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        invoice_id: input.invoice_id ? (input.invoice_id as any) : null,
        claim_status: 'draft',
        tpa_name: input.tpa_name || null,
        insurance_company: input.insurance_company,
        policy_number: input.policy_number || null,
        member_id: input.member_id || null,
        claimed_amount: roundToTwo(input.claimed_amount) as any,
        pre_auth_number: input.pre_auth_number || null,
        notes: input.notes || null,
        created_by_user_id: ctx.user.sub,
      }).returning();

      // 3. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'tpa_claims',
        row_id: claim.id,
        new_values: {
          encounter_id: input.encounter_id,
          insurance_company: input.insurance_company,
          claimed_amount: roundToTwo(input.claimed_amount),
        },
      });

      return {
        claim_id: claim.id,
        claim_status: claim.claim_status,
        created_at: claim.created_at,
      };
    }),

  // ─── UPDATE CLAIM STATUS ──────────────────────────────────
  updateClaimStatus: protectedProcedure
    .input(z.object({
      claim_id: z.string().uuid(),
      new_status: z.enum(claimStatusValues),
      approved_amount: z.string().or(z.number()).optional(),
      settled_amount: z.string().or(z.number()).optional(),
      rejection_reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Fetch claim
      const [claim] = await db.select({ id: tpaClaims.id })
        .from(tpaClaims)
        .where(and(
          eq(tpaClaims.id, input.claim_id as any),
          eq(tpaClaims.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!claim) throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' });

      // 2. Build update object with appropriate timestamps
      const updateObj: any = {
        claim_status: input.new_status,
        updated_at: new Date(),
      };

      if (input.new_status === 'submitted') {
        updateObj.submitted_at = new Date();
      } else if (input.new_status === 'approved' || input.new_status === 'partially_approved') {
        updateObj.approved_at = new Date();
        if (input.approved_amount) {
          updateObj.approved_amount = roundToTwo(input.approved_amount);
        }
      } else if (input.new_status === 'settled') {
        updateObj.settled_at = new Date();
        if (input.settled_amount) {
          updateObj.settled_amount = roundToTwo(input.settled_amount);
        }
      } else if (input.new_status === 'rejected') {
        updateObj.rejected_at = new Date();
        updateObj.rejection_reason = input.rejection_reason || null;
      }

      // 3. Update claim
      await db.update(tpaClaims)
        .set(updateObj)
        .where(eq(tpaClaims.id, input.claim_id as any));

      // 4. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'tpa_claims',
        row_id: input.claim_id,
        new_values: {
          claim_status: input.new_status,
          ...(input.approved_amount && { approved_amount: roundToTwo(input.approved_amount) }),
          ...(input.settled_amount && { settled_amount: roundToTwo(input.settled_amount) }),
        },
      });

      return {
        claim_id: input.claim_id,
        claim_status: input.new_status,
        updated_at: new Date(),
      };
    }),

  // ─── LIST TPA CLAIMS ──────────────────────────────────────
  listTpaClaims: protectedProcedure
    .input(z.object({
      status: z.enum(claimStatusValues).optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      const statusFilter = input.status ? sql`AND tc.claim_status = ${input.status}` : sql``;

      const result = await db.execute(sql`
        SELECT
          tc.id, tc.claim_number, tc.claim_status,
          tc.tpa_name, tc.insurance_company,
          tc.policy_number, tc.member_id,
          tc.claimed_amount, tc.approved_amount, tc.settled_amount,
          tc.submitted_at, tc.approved_at, tc.settled_at, tc.rejected_at,
          tc.rejection_reason,
          p.uhid, p.name_full as patient_name
        FROM tpa_claims tc
        JOIN patients p ON tc.patient_id = p.id
        WHERE tc.hospital_id = ${hospitalId}
          ${statusFilter}
        ORDER BY tc.created_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM tpa_claims
        WHERE hospital_id = ${hospitalId}
          ${statusFilter}
      `);

      const total = parseInt(((countResult as any).rows || countResult)[0]?.total || '0', 10);

      return {
        claims: (result as any).rows || result,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          pages: Math.ceil(total / input.limit),
        },
      };
    }),

  // ─── BILLING STATS ────────────────────────────────────────
  billingStats: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;

      // Get today and current month dates
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      // Total charges amount
      const chargesResult = await db.execute(sql`
        SELECT COALESCE(SUM(net_amount), 0) as total
        FROM encounter_charges
        WHERE hospital_id = ${hospitalId}
      `);

      // Total invoiced
      const invoicedResult = await db.execute(sql`
        SELECT COALESCE(SUM(grand_total), 0) as total
        FROM invoices
        WHERE hospital_id = ${hospitalId}
          AND invoice_status != 'cancelled'
      `);

      // Total paid
      const paidResult = await db.execute(sql`
        SELECT COALESCE(SUM(amount_paid), 0) as total
        FROM invoices
        WHERE hospital_id = ${hospitalId}
          AND invoice_status IN ('paid', 'partially_paid')
      `);

      // Total outstanding
      const outstandingResult = await db.execute(sql`
        SELECT COALESCE(SUM(balance_due), 0) as total
        FROM invoices
        WHERE hospital_id = ${hospitalId}
          AND invoice_status IN ('pending', 'partially_paid')
      `);

      // Claim counts by status
      const claimsResult = await db.execute(sql`
        SELECT claim_status, COUNT(*) as count
        FROM tpa_claims
        WHERE hospital_id = ${hospitalId}
        GROUP BY claim_status
      `);

      // Revenue today
      const todayResult = await db.execute(sql`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE hospital_id = ${hospitalId}
          AND payment_date >= ${today}
      `);

      // Revenue this month
      const monthResult = await db.execute(sql`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE hospital_id = ${hospitalId}
          AND payment_date >= ${monthStart}
      `);

      // Build claim breakdown
      const claimsByStatus: Record<string, number> = {};
      ((claimsResult as any).rows || claimsResult).forEach((row: any) => {
        claimsByStatus[row.claim_status] = parseInt(row.count, 10);
      });

      return {
        total_charges_amount: roundToTwo(((chargesResult as any).rows || chargesResult)[0]?.total),
        total_invoiced: roundToTwo(((invoicedResult as any).rows || invoicedResult)[0]?.total),
        total_paid: roundToTwo(((paidResult as any).rows || paidResult)[0]?.total),
        total_outstanding: roundToTwo(((outstandingResult as any).rows || outstandingResult)[0]?.total),
        claim_count_by_status: claimsByStatus,
        revenue_today: roundToTwo(((todayResult as any).rows || todayResult)[0]?.total),
        revenue_this_month: roundToTwo(((monthResult as any).rows || monthResult)[0]?.total),
      };
    }),

  // ─── GENERATE BILL WITH RULES (V2) ────────────────────────
  generateBillV2: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      apply_rules: z.boolean().default(true),
      save_applications: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Generate bill with rule evaluation
      const billSummary = await generateBillWithRules(
        input.encounter_id,
        hospitalId,
        ctx.user.sub,
      );

      // 2. Optionally save rule applications
      let applicationsCount = 0;
      if (input.save_applications && billSummary.rule_results.length > 0) {
        applicationsCount = await applyRuleResults(
          input.encounter_id,
          {
            insurer_id: billSummary.insurer_id || '',
            total_original: billSummary.gross_total,
            total_adjusted: billSummary.insurer_payable,
            total_deduction: billSummary.total_deductions,
            rule_results: billSummary.rule_results,
            item_totals: new Map(),
          },
          hospitalId,
          ctx.user.sub,
        );

        // Audit
        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'rule_applications',
          row_id: input.encounter_id,
          new_values: {
            encounter_id: input.encounter_id,
            rules_applied: billSummary.rule_results.length,
            total_deductions: billSummary.total_deductions,
          },
        });
      }

      return {
        bill_summary: billSummary,
        applications_saved: applicationsCount,
      };
    }),

  // ─── GET BILL SUMMARY ──────────────────────────────────────
  getBillSummary: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify encounter exists
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!encounter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });
      }

      // Generate bill summary
      const billSummary = await generateBillWithRules(
        input.encounter_id,
        hospitalId,
        ctx.user.sub,
      );

      // Load patient info
      const [patient] = await db.select({
        name_full: patients.name_full,
        uhid: patients.uhid,
      })
        .from(patients)
        .where(eq(patients.id, encounter.patient_id as any))
        .limit(1);

      return {
        bill_summary: billSummary,
        patient_name: patient?.name_full,
        patient_uhid: patient?.uhid,
      };
    }),

  // ─── PREVIEW RULE DEDUCTIONS ──────────────────────────────
  previewRuleDeductions: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      insurer_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify encounter exists
      const [encounter] = await db.select({ id: encounters.id })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!encounter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });
      }

      // Generate bill preview (read-only, no save)
      const billSummary = await generateBillWithRules(
        input.encounter_id,
        hospitalId,
        ctx.user.sub,
      );

      return {
        encounter_id: input.encounter_id,
        preview: {
          gross_total: billSummary.gross_total,
          total_rule_deductions: billSummary.total_deductions,
          insurer_payable: billSummary.insurer_payable,
          patient_liability: billSummary.patient_liability,
          rules_applied: billSummary.rules_applied,
          rule_details: billSummary.rule_results.map((r) => ({
            rule_name: r.rule_name,
            rule_type: r.rule_type,
            deduction_amount: r.deduction_amount,
            explanation: r.explanation,
          })),
        },
      };
    }),

});
