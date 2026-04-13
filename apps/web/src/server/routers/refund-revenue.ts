import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// SCHEMAS
const RefundReasonEnum = z.enum([
  'excess_deposit',
  'insurance_settlement',
  'billing_error',
  'cancelled_procedure',
  'patient_request',
  'duplicate_payment',
  'other',
]);

const RefundStatusEnum = z.enum([
  'requested',
  'pending_approval',
  'approved',
  'rejected',
  'processed',
  'cancelled',
]);

const InvoiceStatusEnum = z.enum([
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'cancelled',
  'credit_note',
]);

const PaymentMethodEnum = z.enum([
  'cash',
  'cheque',
  'bank_transfer',
  'credit_card',
  'debit_card',
  'neft',
  'rtgs',
  'imps',
  'insurance_settlement',
  'other',
]);

const PaymentStatusEnum = z.enum([
  'pending',
  'completed',
  'failed',
  'reversed',
]);

// HELPERS
function generateRefundNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `RF-${date}-${rand}`;
}

function generateInvoiceNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `INV-${date}-${rand}`;
}

function computeApprovalTier(amount: number, config: Record<string, number>): number {
  const tier4 = config['refund_tier_4'] ?? 0;
  const tier3 = config['refund_tier_3'] ?? 0;
  const tier2 = config['refund_tier_2'] ?? 0;
  const tier1 = config['refund_tier_1'] ?? 0;

  if (amount >= tier4) return 4;
  if (amount >= tier3) return 3;
  if (amount >= tier2) return 2;
  return 1;
}

export const refundRevenueRouter = router({
  // ============ REFUND WORKFLOW ============

  requestRefund: protectedProcedure
    .input(
      z.object({
        patient_id: z.string(),
        encounter_id: z.string().optional(),
        account_id: z.string().optional(),
        claim_id: z.string().optional(),
        reason: RefundReasonEnum,
        reason_detail: z.string().optional(),
        amount: z.number().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch billing config to compute approval tier
      const configRows = await getSql()`
        SELECT config_key, config_value
        FROM billing_config
        WHERE hospital_id = ${ctx.user.hospital_id}
      `;
      const config: Record<string, number> = {};
      configRows.forEach((row: any) => {
        config[row.config_key] = parseFloat(row.config_value);
      });

      const approvalTier = computeApprovalTier(input.amount, config);
      const refundNumber = generateRefundNumber();

      const rows = await getSql()`
        INSERT INTO refund_requests (
          hospital_id, rr_patient_id, rr_encounter_id, rr_account_id, rr_claim_id,
          refund_number, rr_status, rr_reason, rr_reason_detail, rr_amount,
          approval_tier, rr_requested_by, rr_created_at, rr_updated_at
        )
        VALUES (
          ${ctx.user.hospital_id}, ${input.patient_id},
          ${input.encounter_id ?? null}, ${input.account_id ?? null},
          ${input.claim_id ?? null}, ${refundNumber}, 'requested',
          ${input.reason}, ${input.reason_detail ?? null}, ${input.amount},
          ${approvalTier}, ${ctx.user.sub}, NOW(), NOW()
        )
        RETURNING id, refund_number, rr_status, approval_tier, rr_created_at
      `;

      return rows[0];
    }),

  getRefund: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT
          r.id, r.refund_number, r.rr_patient_id, r.rr_encounter_id, r.rr_account_id,
          r.rr_claim_id, r.rr_status, r.rr_reason, r.rr_reason_detail, r.rr_amount,
          r.rr_approved_amount, r.approval_tier, r.rr_approved_by, r.rr_approved_at,
          r.rr_rejection_reason, r.rr_payment_method, r.rr_payment_reference,
          r.rr_processed_at, r.rr_requested_by, r.rr_created_at, r.rr_updated_at,
          p.name_full, req_user.full_name AS requested_by_name,
          app_user.full_name AS approved_by_name
        FROM refund_requests r
        LEFT JOIN patients p ON r.rr_patient_id = p.id
        LEFT JOIN users req_user ON r.rr_requested_by = req_user.id
        LEFT JOIN users app_user ON r.rr_approved_by = app_user.id
        WHERE r.id = ${input.id} AND r.hospital_id = ${ctx.user.hospital_id}
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Refund request not found',
        });
      }

      return rows[0];
    }),

  listRefunds: protectedProcedure
    .input(
      z.object({
        status: z.enum(['requested', 'pending_approval', 'approved', 'rejected', 'processed', 'cancelled']).optional(),
        reason: RefundReasonEnum.optional(),
        patient_id: z.string().optional(),
        limit: z.number().int().positive().max(500).default(50),
        offset: z.number().int().nonnegative().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT
          r.id, r.refund_number, r.rr_patient_id, r.rr_status, r.rr_reason, r.rr_amount,
          r.rr_approved_amount, r.approval_tier, r.rr_created_at, p.name_full
        FROM refund_requests r
        LEFT JOIN patients p ON r.rr_patient_id = p.id
        WHERE r.hospital_id = ${ctx.user.hospital_id}
          AND (${input.status ?? null}::text IS NULL OR r.rr_status = ${input.status ?? null})
          AND (${input.reason ?? null}::text IS NULL OR r.rr_reason = ${input.reason ?? null})
          AND (${input.patient_id ?? null}::text IS NULL OR r.rr_patient_id = ${input.patient_id ?? null})
        ORDER BY r.rr_created_at DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      return rows;
    }),

  approveRefund: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        approved_amount: z.number().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await getSql()`
        UPDATE refund_requests
        SET rr_status = 'approved', rr_approved_amount = ${input.approved_amount},
            rr_approved_by = ${ctx.user.sub}, rr_approved_at = NOW(), rr_updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
        RETURNING id, rr_status, rr_approved_amount
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Refund request not found',
        });
      }

      return rows[0];
    }),

  rejectRefund: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        rejection_reason: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await getSql()`
        UPDATE refund_requests
        SET rr_status = 'rejected', rr_rejection_reason = ${input.rejection_reason},
            rr_approved_by = ${ctx.user.sub}, rr_approved_at = NOW(), rr_updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
        RETURNING id, rr_status, rr_rejection_reason
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Refund request not found',
        });
      }

      return rows[0];
    }),

  processRefund: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        payment_method: PaymentMethodEnum,
        payment_reference: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await getSql()`
        UPDATE refund_requests
        SET rr_status = 'processed', rr_payment_method = ${input.payment_method},
            rr_payment_reference = ${input.payment_reference}, rr_processed_at = NOW(),
            rr_updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
        RETURNING id, rr_status, rr_payment_method, rr_processed_at
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Refund request not found',
        });
      }

      return rows[0];
    }),

  cancelRefund: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await getSql()`
        UPDATE refund_requests
        SET rr_status = 'cancelled', rr_updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
        RETURNING id, rr_status
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Refund request not found',
        });
      }

      return rows[0];
    }),

  refundStats: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        rr_status,
        rr_reason,
        COUNT(*) as count,
        SUM(rr_amount) as total_amount,
        SUM(COALESCE(rr_approved_amount, 0)) as total_approved
      FROM refund_requests
      WHERE hospital_id = ${ctx.user.hospital_id}
      GROUP BY rr_status, rr_reason
    `;

    return rows;
  }),

  // ============ INVOICE MANAGEMENT ============

  createInvoice: protectedProcedure
    .input(
      z.object({
        encounter_id: z.string(),
        patient_id: z.string(),
        type: z.enum(['standard', 'credit_note', 'debit_note']).default('standard'),
        account_id: z.string().optional(),
        claim_id: z.string().optional(),
        subtotal: z.number().nonnegative(),
        discount_total: z.number().nonnegative().default(0),
        gst_total: z.number().nonnegative().default(0),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const invoiceNumber = generateInvoiceNumber();
      const grandTotal = input.subtotal - input.discount_total + input.gst_total;

      const rows = await getSql()`
        INSERT INTO invoices (
          hospital_id, encounter_id, patient_id, invoice_number, inv_type,
          invoice_status, subtotal, discount_total, gst_total, grand_total,
          amount_paid, balance_due, inv_account_id, inv_claim_id, notes,
          created_by_user_id, created_at, updated_at
        )
        VALUES (
          ${ctx.user.hospital_id}, ${input.encounter_id}, ${input.patient_id},
          ${invoiceNumber}, ${input.type}, 'draft', ${input.subtotal},
          ${input.discount_total}, ${input.gst_total}, ${grandTotal}, 0,
          ${grandTotal}, ${input.account_id ?? null}, ${input.claim_id ?? null},
          ${input.notes ?? null}, ${ctx.user.sub}, NOW(), NOW()
        )
        RETURNING id, invoice_number, grand_total, invoice_status
      `;

      return rows[0];
    }),

  getInvoice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT
          i.id, i.invoice_number, i.encounter_id, i.patient_id, i.inv_type,
          i.invoice_status, i.subtotal, i.discount_total, i.gst_total, i.grand_total,
          i.amount_paid, i.balance_due, i.generated_at, i.due_date, i.finalized_at,
          i.notes, i.created_by_user_id, i.inv_account_id, i.inv_claim_id,
          i.created_at, i.updated_at, p.name_full, u.full_name
        FROM invoices i
        LEFT JOIN patients p ON i.patient_id = p.id
        LEFT JOIN users u ON i.created_by_user_id = u.id
        WHERE i.id = ${input.id} AND i.hospital_id = ${ctx.user.hospital_id}
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice not found',
        });
      }

      return rows[0];
    }),

  listInvoices: protectedProcedure
    .input(
      z.object({
        status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'credit_note']).optional(),
        type: z.enum(['standard', 'credit_note', 'debit_note']).optional(),
        patient_id: z.string().optional(),
        encounter_id: z.string().optional(),
        limit: z.number().int().positive().max(500).default(50),
        offset: z.number().int().nonnegative().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT
          i.id, i.invoice_number, i.patient_id, i.encounter_id, i.inv_type,
          i.invoice_status, i.grand_total, i.amount_paid, i.balance_due,
          i.created_at, p.name_full
        FROM invoices i
        LEFT JOIN patients p ON i.patient_id = p.id
        WHERE i.hospital_id = ${ctx.user.hospital_id}
          AND (${input.status ?? null}::text IS NULL OR i.invoice_status = ${input.status ?? null})
          AND (${input.type ?? null}::text IS NULL OR i.inv_type = ${input.type ?? null})
          AND (${input.patient_id ?? null}::text IS NULL OR i.patient_id = ${input.patient_id ?? null})
          AND (${input.encounter_id ?? null}::text IS NULL OR i.encounter_id = ${input.encounter_id ?? null})
        ORDER BY i.created_at DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      return rows;
    }),

  issueInvoice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await getSql()`
        UPDATE invoices
        SET invoice_status = 'issued', generated_at = NOW(), updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
        RETURNING id, invoice_status, generated_at
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice not found',
        });
      }

      return rows[0];
    }),

  recordPayment: protectedProcedure
    .input(
      z.object({
        invoice_id: z.string(),
        amount: z.number().positive(),
        payment_method: PaymentMethodEnum,
        reference_number: z.string().optional(),
        notes: z.string().optional(),
        receipt_number: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get invoice details
      const invoiceRows = await getSql()`
        SELECT patient_id, encounter_id, inv_account_id, amount_paid, balance_due, grand_total
        FROM invoices
        WHERE id = ${input.invoice_id} AND hospital_id = ${ctx.user.hospital_id}
      `;

      if (!invoiceRows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice not found',
        });
      }

      const invoice = invoiceRows[0];
      const newAmountPaid = (invoice.amount_paid ?? 0) + input.amount;
      const newBalance = (invoice.grand_total ?? 0) - newAmountPaid;
      let newStatus = 'partially_paid';
      if (newBalance <= 0) {
        newStatus = 'paid';
      }

      // Create payment record
      const paymentRows = await getSql()`
        INSERT INTO payments (
          hospital_id, invoice_id, encounter_id, patient_id, amount,
          payment_method, reference_number, payment_date, notes,
          received_by_user_id, pay_account_id, pay_receipt_number, pay_status,
          created_at
        )
        VALUES (
          ${ctx.user.hospital_id}, ${input.invoice_id}, ${invoice.encounter_id},
          ${invoice.patient_id}, ${input.amount}, ${input.payment_method},
          ${input.reference_number ?? null}, NOW(), ${input.notes ?? null},
          ${ctx.user.sub}, ${invoice.inv_account_id ?? null},
          ${input.receipt_number ?? null}, 'completed', NOW()
        )
        RETURNING id, amount, payment_date
      `;

      // Update invoice
      await getSql()`
        UPDATE invoices
        SET amount_paid = ${newAmountPaid}, balance_due = ${Math.max(0, newBalance)},
            invoice_status = ${newStatus}, finalized_at = CASE WHEN ${newStatus} = 'paid' THEN NOW() ELSE finalized_at END,
            updated_at = NOW()
        WHERE id = ${input.invoice_id}
      `;

      return paymentRows[0];
    }),

  listPayments: protectedProcedure
    .input(
      z.object({
        invoice_id: z.string().optional(),
        patient_id: z.string().optional(),
        limit: z.number().int().positive().max(500).default(50),
        offset: z.number().int().nonnegative().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT
          p.id, p.invoice_id, p.patient_id, p.amount, p.payment_method,
          p.reference_number, p.payment_date, p.pay_receipt_number, p.pay_status,
          u.full_name, i.invoice_number
        FROM payments p
        LEFT JOIN users u ON p.received_by_user_id = u.id
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.hospital_id = ${ctx.user.hospital_id}
          AND (${input.invoice_id ?? null}::text IS NULL OR p.invoice_id = ${input.invoice_id ?? null})
          AND (${input.patient_id ?? null}::text IS NULL OR p.patient_id = ${input.patient_id ?? null})
        ORDER BY p.payment_date DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      return rows;
    }),

  cancelInvoice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await getSql()`
        UPDATE invoices
        SET invoice_status = 'cancelled', updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
        RETURNING id, invoice_status
      `;

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice not found',
        });
      }

      return rows[0];
    }),

  // ============ REVENUE INTELLIGENCE ============

  revenueSummary: protectedProcedure.query(async ({ ctx }) => {
    const today = new Date().toISOString().slice(0, 10);

    const todayRows = await getSql()`
      SELECT
        SUM(CASE WHEN inv_type = 'standard' THEN grand_total ELSE 0 END) as total_charges,
        SUM(CASE WHEN invoice_status IN ('paid', 'partially_paid') THEN amount_paid ELSE 0 END) as total_collections,
        (SELECT COALESCE(SUM(dep_amount), 0) FROM deposits WHERE hospital_id = ${ctx.user.hospital_id} AND dep_status = 'active') as total_deposits,
        (SELECT COALESCE(SUM(rr_approved_amount), 0) FROM refund_requests WHERE hospital_id = ${ctx.user.hospital_id} AND rr_status = 'processed' AND DATE(rr_processed_at) = ${today}::date) as total_refunds
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id}
        AND DATE(created_at) = ${today}::date
    `;

    const today_data = todayRows[0] ?? {
      total_charges: 0,
      total_collections: 0,
      total_deposits: 0,
      total_refunds: 0,
    };

    const yesterday = new Date(new Date().getTime() - 86400000)
      .toISOString()
      .slice(0, 10);

    const yesterdayRows = await getSql()`
      SELECT
        SUM(CASE WHEN inv_type = 'standard' THEN grand_total ELSE 0 END) as total_charges,
        SUM(CASE WHEN invoice_status IN ('paid', 'partially_paid') THEN amount_paid ELSE 0 END) as total_collections
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id}
        AND DATE(created_at) = ${yesterday}::date
    `;

    const yesterday_data = yesterdayRows[0] ?? {
      total_charges: 0,
      total_collections: 0,
    };

    const net_revenue =
      (today_data.total_charges ?? 0) +
      (today_data.total_collections ?? 0) -
      (today_data.total_refunds ?? 0);

    return {
      today: {
        total_charges: today_data.total_charges ?? 0,
        total_collections: today_data.total_collections ?? 0,
        total_deposits: today_data.total_deposits ?? 0,
        total_refunds: today_data.total_refunds ?? 0,
        net_revenue,
      },
      yesterday: {
        total_charges: yesterday_data.total_charges ?? 0,
        total_collections: yesterday_data.total_collections ?? 0,
      },
    };
  }),

  revenueTimeline: protectedProcedure
    .input(
      z.object({
        date_from: z.string(),
        date_to: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT
          DATE(created_at) as date,
          SUM(CASE WHEN inv_type = 'standard' THEN grand_total ELSE 0 END) as total_charges,
          SUM(CASE WHEN invoice_status IN ('paid', 'partially_paid') THEN amount_paid ELSE 0 END) as total_collections
        FROM invoices
        WHERE hospital_id = ${ctx.user.hospital_id}
          AND DATE(created_at) >= ${input.date_from}::date
          AND DATE(created_at) <= ${input.date_to}::date
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `;

      return rows;
    }),

  outstandingAnalysis: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        'insurance' as payer_type,
        SUM(balance_due) as outstanding,
        COUNT(*) as invoice_count,
        NULL as days_old
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id}
        AND balance_due > 0
        AND inv_claim_id IS NOT NULL
      UNION ALL
      SELECT
        'patient' as payer_type,
        SUM(balance_due) as outstanding,
        COUNT(*) as invoice_count,
        NULL as days_old
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id}
        AND balance_due > 0
        AND inv_claim_id IS NULL
    `;

    // Compute aging buckets
    const agingRows = await getSql()`
      SELECT
        CASE
          WHEN DATE(NOW()) - DATE(created_at) <= 30 THEN '0-30'
          WHEN DATE(NOW()) - DATE(created_at) <= 60 THEN '31-60'
          WHEN DATE(NOW()) - DATE(created_at) <= 90 THEN '61-90'
          ELSE '90+'
        END as aging_bucket,
        COUNT(*) as count,
        SUM(balance_due) as amount
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id} AND balance_due > 0
      GROUP BY aging_bucket
    `;

    return {
      by_payer: rows,
      by_aging: agingRows,
    };
  }),

  collectionEfficiency: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        DATE(created_at) as date,
        SUM(CASE WHEN inv_type = 'standard' THEN grand_total ELSE 0 END) as total_charges,
        SUM(CASE WHEN invoice_status IN ('paid', 'partially_paid') THEN amount_paid ELSE 0 END) as total_collections,
        ROUND(
          100.0 * SUM(CASE WHEN invoice_status IN ('paid', 'partially_paid') THEN amount_paid ELSE 0 END) /
          NULLIF(SUM(CASE WHEN inv_type = 'standard' THEN grand_total ELSE 0 END), 0),
          2
        ) as efficiency_pct
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `;

    return rows;
  }),

  tpaSettlementAnalysis: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        ic.ic_tpa,
        COUNT(DISTINCT ic.id) as claim_count,
        ROUND(AVG(EXTRACT(DAY FROM (ic.settled_amount IS NOT NULL::timestamp - ic.id::timestamp))), 2) as avg_settlement_days,
        ROUND(
          100.0 * SUM(ic.ic_total_deductions) / NULLIF(SUM(ic.ic_approved_amount), 0),
          2
        ) as avg_deduction_pct,
        SUM(CASE WHEN ic.ic_status != 'settled' THEN ic.ic_approved_amount ELSE 0 END) as outstanding_amount
      FROM insurance_claims ic
      WHERE ic.hospital_id = ${ctx.user.hospital_id}
      GROUP BY ic.ic_tpa
    `;

    return rows;
  }),

  departmentRevenue: protectedProcedure.query(async ({ ctx }) => {
    // Note: assumes invoice_line_items table with ili_category
    const rows = await getSql()`
      SELECT
        COALESCE(ili.ili_category, 'uncategorized') as category,
        COUNT(DISTINCT ili.id) as item_count,
        SUM(ili.ili_amount) as revenue,
        SUM(ili.ili_discount) as discount,
        ROUND(AVG(ili.ili_amount), 2) as avg_item_value
      FROM invoice_line_items ili
      INNER JOIN invoices i ON ili.invoice_id = i.id
      WHERE i.hospital_id = ${ctx.user.hospital_id}
      GROUP BY COALESCE(ili.ili_category, 'uncategorized')
      ORDER BY revenue DESC
    `;

    return rows;
  }),

  insurerPerformance: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        ic.ic_tpa as insurer,
        COUNT(DISTINCT ic.id) as claim_count,
        SUM(ic.ic_approved_amount) as approved_amount,
        SUM(ic.ic_total_deductions) as total_deductions,
        SUM(ic.ic_approved_amount) - COALESCE(SUM(ic.ic_total_deductions), 0) as net_settlement,
        ROUND(
          AVG(EXTRACT(DAY FROM (NOW() - ic.id::timestamp))),
          2
        ) as avg_turnaround_days
      FROM insurance_claims ic
      WHERE ic.hospital_id = ${ctx.user.hospital_id}
      GROUP BY ic.ic_tpa
      ORDER BY claim_count DESC
    `;

    return rows;
  }),

  refundAnalysis: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        rr_reason,
        COUNT(*) as refund_count,
        SUM(rr_amount) as total_amount,
        SUM(COALESCE(rr_approved_amount, 0)) as approved_amount,
        ROUND(
          100.0 * COUNT(CASE WHEN rr_status = 'approved' THEN 1 END) / NULLIF(COUNT(*), 0),
          2
        ) as approval_rate_pct,
        ROUND(
          AVG(EXTRACT(DAY FROM (rr_processed_at - rr_created_at))),
          2
        ) as avg_processing_days
      FROM refund_requests
      WHERE hospital_id = ${ctx.user.hospital_id}
      GROUP BY rr_reason
      ORDER BY total_amount DESC
    `;

    return rows;
  }),

  generateSnapshot: protectedProcedure.mutation(async ({ ctx }) => {
    const today = new Date().toISOString().slice(0, 10);

    // Compute all metrics
    const metricsRows = await getSql()`
      SELECT
        SUM(CASE WHEN inv_type = 'standard' THEN grand_total ELSE 0 END)::numeric as total_charges,
        SUM(CASE WHEN invoice_status IN ('paid', 'partially_paid') THEN amount_paid ELSE 0 END)::numeric as total_collections,
        (SELECT COALESCE(SUM(dep_amount), 0) FROM deposits WHERE hospital_id = ${ctx.user.hospital_id})::numeric as total_deposits,
        (SELECT COALESCE(SUM(rr_approved_amount), 0) FROM refund_requests WHERE hospital_id = ${ctx.user.hospital_id} AND rr_status = 'processed')::numeric as total_refunds,
        (SELECT COUNT(*) FROM insurance_claims WHERE hospital_id = ${ctx.user.hospital_id})::numeric as claims_submitted,
        (SELECT COUNT(*) FROM insurance_claims WHERE hospital_id = ${ctx.user.hospital_id} AND ic_status = 'approved')::numeric as claims_approved,
        (SELECT COALESCE(SUM(ic_approved_amount), 0) FROM insurance_claims WHERE hospital_id = ${ctx.user.hospital_id})::numeric as total_approved_amt,
        (SELECT COALESCE(SUM(ic_total_deductions), 0) FROM insurance_claims WHERE hospital_id = ${ctx.user.hospital_id})::numeric as total_deductions,
        (SELECT COUNT(*) FROM bed WHERE hospital_id = ${ctx.user.hospital_id} AND bed_status = 'occupied')::numeric as occupied_beds,
        (SELECT COUNT(*) FROM bed WHERE hospital_id = ${ctx.user.hospital_id})::numeric as total_beds,
        (SELECT COUNT(*) FROM encounter WHERE hospital_id = ${ctx.user.hospital_id} AND DATE(created_at) = ${today}::date)::numeric as encounters_today,
        (SELECT COALESCE(SUM(balance_due), 0) FROM invoices WHERE hospital_id = ${ctx.user.hospital_id})::numeric as total_outstanding
      FROM invoices
      WHERE hospital_id = ${ctx.user.hospital_id}
    `;

    const metrics = metricsRows[0] ?? {};

    const net_revenue =
      (metrics.total_charges ?? 0) -
      (metrics.total_deductions ?? 0) -
      (metrics.total_refunds ?? 0);
    const deduction_pct =
      metrics.total_deductions && metrics.total_approved_amt
        ? (100.0 * metrics.total_deductions) / metrics.total_approved_amt
        : 0;
    const avg_bill_per_patient =
      metrics.encounters_today && metrics.encounters_today > 0
        ? metrics.total_charges / metrics.encounters_today
        : 0;

    const rows = await getSql()`
      INSERT INTO revenue_snapshots (
        hospital_id, snapshot_date, rs_total_charges, rs_total_collections,
        rs_total_deposits, rs_total_refunds, net_revenue, claims_submitted,
        claims_approved, rs_total_approved_amt, rs_total_deductions,
        deduction_pct, occupied_beds, rs_total_beds, avg_bill_per_patient,
        total_outstanding, rs_created_at
      )
      VALUES (
        ${ctx.user.hospital_id}, ${today}::date, ${metrics.total_charges ?? 0},
        ${metrics.total_collections ?? 0}, ${metrics.total_deposits ?? 0},
        ${metrics.total_refunds ?? 0}, ${net_revenue}, ${metrics.claims_submitted ?? 0},
        ${metrics.claims_approved ?? 0}, ${metrics.total_approved_amt ?? 0},
        ${metrics.total_deductions ?? 0}, ${deduction_pct}, ${metrics.occupied_beds ?? 0},
        ${metrics.total_beds ?? 0}, ${avg_bill_per_patient}, ${metrics.total_outstanding ?? 0},
        NOW()
      )
      RETURNING id, snapshot_date, net_revenue
    `;

    return rows[0];
  }),

  payerMix: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getSql()`
      SELECT
        ba.ba_patient_id,
        COUNT(DISTINCT i.id) as invoice_count,
        SUM(i.grand_total) as revenue,
        'self_pay' as payer_type
      FROM billing_accounts ba
      LEFT JOIN invoices i ON ba.id = i.inv_account_id
      WHERE ba.hospital_id = ${ctx.user.hospital_id}
        AND ba.ba_is_active = true
      GROUP BY ba.ba_patient_id
      UNION ALL
      SELECT
        NULL as ba_patient_id,
        COUNT(DISTINCT i.id) as invoice_count,
        SUM(i.grand_total) as revenue,
        'insurance' as payer_type
      FROM invoices i
      WHERE i.hospital_id = ${ctx.user.hospital_id}
        AND i.inv_claim_id IS NOT NULL
      GROUP BY i.inv_claim_id
    `;

    return rows;
  }),
});
