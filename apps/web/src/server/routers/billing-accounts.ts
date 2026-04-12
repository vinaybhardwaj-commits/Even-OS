import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const accountTypeEnum = ['self_pay', 'insurance', 'corporate', 'government'] as const;
const depositStatusEnum = ['collected', 'applied', 'refunded', 'partial_refund'] as const;
const paymentMethodEnum = ['cash', 'card', 'upi', 'neft', 'cheque'] as const;
const roomChargeTypeEnum = ['full_day', 'admission_day', 'discharge_day', 'prorated'] as const;
const packageStatusEnum = ['draft', 'active', 'exceeded', 'closed'] as const;

// Helper: Round to 2 decimal places
function roundToTwo(num: number | string | null | undefined): string {
  if (!num) return '0.00';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return (Math.round(n * 100) / 100).toFixed(2);
}

export const billingAccountsRouter = router({

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNTS (1-5)
  // ═══════════════════════════════════════════════════════════════

  // 1. CREATE ACCOUNT
  createAccount: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      account_type: z.enum(accountTypeEnum).default('self_pay'),
      insurer_name: z.string().optional(),
      tpa_name: z.string().optional(),
      policy_number: z.string().max(100).optional(),
      member_id: z.string().max(100).optional(),
      sum_insured: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      room_rent_eligibility: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      co_pay_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      estimated_total: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      patient_liability_estimate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Verify patient exists in hospital
        const patientCheck = await sql`
          SELECT id FROM patients
          WHERE id = ${input.patient_id}
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!patientCheck || patientCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Patient not found in this hospital',
          });
        }

        // Verify encounter if provided
        if (input.encounter_id) {
          const encounterCheck = await sql`
            SELECT id FROM encounters
            WHERE id = ${input.encounter_id}
            AND hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}
            LIMIT 1
          `;

          if (!encounterCheck || encounterCheck.length === 0) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Encounter not found for this patient',
            });
          }
        }

        // Insert billing account
        const result = await sql`
          INSERT INTO billing_accounts (
            hospital_id, ba_patient_id, ba_encounter_id, account_type,
            insurer_name, ba_tpa_name, ba_policy_number, ba_member_id,
            sum_insured, room_rent_eligibility, co_pay_percent,
            estimated_total, patient_liability_estimate,
            ba_is_active, ba_created_by, ba_created_at, ba_updated_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}, ${input.encounter_id || null},
            ${input.account_type}, ${input.insurer_name || null},
            ${input.tpa_name || null}, ${input.policy_number || null},
            ${input.member_id || null}, ${input.sum_insured || null},
            ${input.room_rent_eligibility || null}, ${input.co_pay_percent || null},
            ${input.estimated_total || null}, ${input.patient_liability_estimate || null},
            true, ${userId}, NOW(), NOW()
          )
          RETURNING id, account_type, ba_created_at
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create billing account',
          });
        }

        return {
          account_id: rows[0].id,
          account_type: rows[0].account_type,
          created_at: rows[0].ba_created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error creating billing account',
        });
      }
    }),

  // 2. GET ACCOUNT
  getAccount: protectedProcedure
    .input(z.object({ account_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            ba.id, ba.hospital_id, ba.ba_patient_id as patient_id,
            ba.ba_encounter_id as encounter_id, ba.account_type,
            ba.insurer_name, ba.ba_tpa_name as tpa_name,
            ba.ba_policy_number as policy_number, ba.ba_member_id as member_id,
            ba.sum_insured, ba.room_rent_eligibility, ba.co_pay_percent,
            ba.total_charges, ba.total_deposits, ba.total_payments,
            ba.total_approved, ba.ba_balance_due as balance_due,
            ba.estimated_total, ba.patient_liability_estimate,
            ba.ba_is_active as is_active, ba.ba_created_at as created_at,
            ba.ba_updated_at as updated_at,
            p.patient_name,
            e.encounter_type, e.admission_date, e.discharge_date
          FROM billing_accounts ba
          JOIN patients p ON ba.ba_patient_id = p.id
          LEFT JOIN encounters e ON ba.ba_encounter_id = e.id
          WHERE ba.id = ${input.account_id}
          AND ba.hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!result || result.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Billing account not found',
          });
        }

        return result[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching billing account',
        });
      }
    }),

  // 3. LIST ACCOUNTS
  listAccounts: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
      account_type: z.enum(accountTypeEnum).optional(),
      is_active: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            ba.id, ba.ba_patient_id as patient_id, ba.ba_encounter_id as encounter_id,
            ba.account_type, ba.insurer_name, ba.total_charges, ba.total_deposits,
            ba.total_payments, ba.ba_balance_due as balance_due, ba.ba_is_active as is_active,
            ba.ba_created_at as created_at, p.patient_name
          FROM billing_accounts ba
          JOIN patients p ON ba.ba_patient_id = p.id
          WHERE ba.hospital_id = ${hospitalId}
            AND (${input.patient_id ?? null}::uuid IS NULL OR ba.ba_patient_id = ${input.patient_id ?? null})
            AND (${input.encounter_id ?? null}::uuid IS NULL OR ba.ba_encounter_id = ${input.encounter_id ?? null})
            AND (${input.account_type ?? null}::text IS NULL OR ba.account_type = ${input.account_type ?? null})
            AND (${input.is_active ?? null}::boolean IS NULL OR ba.ba_is_active = ${input.is_active ?? null})
          ORDER BY ba.ba_created_at DESC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing billing accounts',
        });
      }
    }),

  // 4. GET RUNNING BILL
  getRunningBill: protectedProcedure
    .input(z.object({ account_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get account with encounter
        const accountResult = await sql`
          SELECT ba.id, ba.ba_encounter_id as encounter_id, ba.total_deposits,
                 ba.total_payments, ba.total_approved
          FROM billing_accounts
          WHERE id = ${input.account_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!accountResult || accountResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Billing account not found',
          });
        }

        const account = (accountResult as any)[0];
        const encounterId = account.encounter_id;

        // Get charges by category
        const chargesResult = await sql`
          SELECT
            category,
            COUNT(*) as count,
            SUM(CAST(net_amount AS NUMERIC)) as total
          FROM encounter_charges
          WHERE encounter_id = ${encounterId} AND hospital_id = ${hospitalId}
          GROUP BY category
          ORDER BY category
        `;

        const charges_by_category = ((chargesResult || []) as any).map((row: any) => ({
          category: row.category,
          count: parseInt(row.count),
          total: parseFloat(row.total || 0),
        }));

        // Get total charges
        const totalChargesResult = await sql`
          SELECT COALESCE(SUM(CAST(net_amount AS NUMERIC)), 0) as total
          FROM encounter_charges
          WHERE encounter_id = ${encounterId} AND hospital_id = ${hospitalId}
        `;

        const totalCharges = parseFloat((totalChargesResult as any)[0]?.total || 0);

        // Get room charges
        const roomChargesResult = await sql`
          SELECT
            SUM(CAST(rcl_total_charge AS NUMERIC)) as total,
            COUNT(*) as days
          FROM room_charge_log
          WHERE rcl_encounter_id = ${encounterId} AND hospital_id = ${hospitalId}
        `;

        const roomInfo = (roomChargesResult as any)[0] || { total: 0, days: 0 };

        // Get package info
        const packageResult = await sql`
          SELECT
            package_name, package_code, package_price, actual_cost,
            variance_amount, pa_status as status
          FROM package_applications
          WHERE pa_encounter_id = ${encounterId} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        const package_info = packageResult && packageResult.length > 0 ? (packageResult as any)[0] : null;

        // Calculate GST (18% default)
        const gstPercent = 18;
        const subtotal = totalCharges;
        const gst_total = (subtotal * gstPercent) / 100;
        const grand_total = subtotal + gst_total;

        const deposits = parseFloat(account.total_deposits || 0);
        const payments = parseFloat(account.total_payments || 0);
        const approved = parseFloat(account.total_approved || 0);
        const balance_due = grand_total - deposits - payments;

        return {
          charges_by_category,
          subtotal: roundToTwo(subtotal),
          gst_total: roundToTwo(gst_total),
          grand_total: roundToTwo(grand_total),
          deposits: roundToTwo(deposits),
          payments: roundToTwo(payments),
          approved: roundToTwo(approved),
          balance_due: roundToTwo(balance_due),
          room_charges: {
            total: roundToTwo(roomInfo.total || 0),
            days: parseInt(roomInfo.days || 0),
          },
          package_info,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching running bill',
        });
      }
    }),

  // 5. UPDATE ACCOUNT TOTALS
  updateAccountTotals: protectedProcedure
    .input(z.object({ account_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get account with encounter
        const accountResult = await sql`
          SELECT ba.id, ba.ba_encounter_id as encounter_id
          FROM billing_accounts
          WHERE id = ${input.account_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!accountResult || accountResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Billing account not found',
          });
        }

        const account = (accountResult as any)[0];
        const encounterId = account.encounter_id;

        // Calculate totals
        const chargesResult = await sql`
          SELECT COALESCE(SUM(CAST(net_amount AS NUMERIC)), 0) as total
          FROM encounter_charges
          WHERE encounter_id = ${encounterId} AND hospital_id = ${hospitalId}
        `;

        const depositsResult = await sql`
          SELECT COALESCE(SUM(CAST(dep_amount AS NUMERIC)), 0) as total
          FROM deposits
          WHERE dep_account_id = ${input.account_id} AND hospital_id = ${hospitalId}
          AND dep_status IN ('collected', 'applied', 'partial_refund')
        `;

        const paymentsResult = await sql`
          SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total
          FROM payments
          WHERE account_id = ${input.account_id} AND hospital_id = ${hospitalId}
        `;

        const total_charges = parseFloat((chargesResult as any)[0]?.total || 0);
        const total_deposits = parseFloat((depositsResult as any)[0]?.total || 0);
        const total_payments = parseFloat((paymentsResult as any)[0]?.total || 0);
        const balance_due = total_charges - total_payments - total_deposits;

        // Update account
        await sql`
          UPDATE billing_accounts
          SET
            total_charges = ${total_charges},
            total_deposits = ${total_deposits},
            total_payments = ${total_payments},
            ba_balance_due = ${balance_due},
            ba_updated_at = NOW()
          WHERE id = ${input.account_id}
        `;

        return {
          total_charges: roundToTwo(total_charges),
          total_deposits: roundToTwo(total_deposits),
          total_payments: roundToTwo(total_payments),
          balance_due: roundToTwo(balance_due),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating account totals',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // DEPOSITS (6-10)
  // ═══════════════════════════════════════════════════════════════

  // 6. COLLECT DEPOSIT
  collectDeposit: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      account_id: z.string().uuid().optional(),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      payment_method: z.enum(paymentMethodEnum),
      reference_number: z.string().optional(),
      receipt_number: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Insert deposit
        const result = await sql`
          INSERT INTO deposits (
            hospital_id, dep_patient_id, dep_encounter_id, dep_account_id,
            dep_amount, dep_status, dep_payment_method, dep_reference_number,
            receipt_number, collected_at, collected_by, dep_notes, dep_created_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}, ${input.encounter_id || null},
            ${input.account_id || null}, ${input.amount}, 'collected',
            ${input.payment_method}, ${input.reference_number || null},
            ${input.receipt_number || null}, NOW(), ${userId},
            ${input.notes || null}, NOW()
          )
          RETURNING id, dep_amount, collected_at
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to record deposit',
          });
        }

        // Update account totals if account_id provided
        if (input.account_id) {
          await sql`
            UPDATE billing_accounts
            SET ba_updated_at = NOW()
            WHERE id = ${input.account_id}
          `;
        }

        return {
          deposit_id: rows[0].id,
          amount: rows[0].dep_amount,
          collected_at: rows[0].collected_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error collecting deposit',
        });
      }
    }),

  // 7. APPLY DEPOSIT
  applyDeposit: protectedProcedure
    .input(z.object({
      deposit_id: z.string().uuid(),
      invoice_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Verify deposit exists
        const depositCheck = await sql`
          SELECT id FROM deposits
          WHERE id = ${input.deposit_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!depositCheck || depositCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Deposit not found',
          });
        }

        // Update deposit
        await sql`
          UPDATE deposits
          SET
            dep_status = 'applied',
            applied_at = NOW(),
            applied_to_invoice_id = ${input.invoice_id}
          WHERE id = ${input.deposit_id}
        `;

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error applying deposit',
        });
      }
    }),

  // 8. REFUND DEPOSIT
  refundDeposit: protectedProcedure
    .input(z.object({
      deposit_id: z.string().uuid(),
      refund_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get deposit
        const depositResult = await sql`
          SELECT id, dep_amount, dep_account_id
          FROM deposits
          WHERE id = ${input.deposit_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!depositResult || depositResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Deposit not found',
          });
        }

        const deposit = (depositResult as any)[0];
        const originalAmount = parseFloat(deposit.dep_amount || 0);
        const refundAmount = parseFloat(input.refund_amount);
        const newStatus = refundAmount >= originalAmount ? 'refunded' : 'partial_refund';

        // Update deposit
        await sql`
          UPDATE deposits
          SET
            dep_status = ${newStatus},
            dep_refunded_at = NOW(),
            refund_amount = ${input.refund_amount}
          WHERE id = ${input.deposit_id}
        `;

        return { success: true, status: newStatus };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error refunding deposit',
        });
      }
    }),

  // 9. LIST DEPOSITS
  listDeposits: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
      account_id: z.string().uuid().optional(),
      status: z.enum(depositStatusEnum).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            d.id, d.dep_amount as amount, d.dep_status as status,
            d.dep_payment_method as payment_method, d.dep_reference_number as reference_number,
            d.collected_at, u.user_full_name as collector_name, d.dep_notes as notes
          FROM deposits d
          LEFT JOIN users u ON d.collected_by = u.id
          WHERE d.hospital_id = ${hospitalId}
            AND (${input.patient_id ?? null}::uuid IS NULL OR d.dep_patient_id = ${input.patient_id ?? null})
            AND (${input.encounter_id ?? null}::uuid IS NULL OR d.dep_encounter_id = ${input.encounter_id ?? null})
            AND (${input.account_id ?? null}::uuid IS NULL OR d.dep_account_id = ${input.account_id ?? null})
            AND (${input.status ?? null}::text IS NULL OR d.dep_status = ${input.status ?? null})
          ORDER BY d.collected_at DESC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing deposits',
        });
      }
    }),

  // 10. DEPOSIT SUMMARY
  depositSummary: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN dep_status IN ('collected', 'applied', 'partial_refund') THEN CAST(dep_amount AS NUMERIC) ELSE 0 END), 0) as total_collected,
            COALESCE(SUM(CASE WHEN dep_status = 'applied' THEN CAST(dep_amount AS NUMERIC) ELSE 0 END), 0) as total_applied,
            COALESCE(SUM(CASE WHEN dep_status IN ('refunded', 'partial_refund') THEN CAST(refund_amount AS NUMERIC) ELSE 0 END), 0) as total_refunded
          FROM deposits
          WHERE dep_encounter_id = ${input.encounter_id} AND hospital_id = ${hospitalId}
        `;

        const summary = (result as any)[0] || {};
        const total_collected = parseFloat(summary.total_collected || 0);
        const total_applied = parseFloat(summary.total_applied || 0);
        const total_refunded = parseFloat(summary.total_refunded || 0);
        const net_available = total_collected - total_applied;

        return {
          total_collected: roundToTwo(total_collected),
          total_applied: roundToTwo(total_applied),
          total_refunded: roundToTwo(total_refunded),
          net_available: roundToTwo(net_available),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error calculating deposit summary',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // ROOM CHARGES (11-13)
  // ═══════════════════════════════════════════════════════════════

  // 11. ADD ROOM CHARGE
  addRoomCharge: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      patient_id: z.string().uuid(),
      charge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
      charge_type: z.enum(roomChargeTypeEnum),
      bed_id: z.string().uuid().optional(),
      ward_name: z.string().optional(),
      room_category: z.string().optional(),
      base_rate: z.string().regex(/^\d+(\.\d{1,2})?$/),
      nursing_charge: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      room_rent_eligible: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      is_over_eligible: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const baseRate = parseFloat(input.base_rate);
        const nursingCharge = parseFloat(input.nursing_charge || '0');
        const total_charge = baseRate + nursingCharge;

        // Insert room charge log
        const result = await sql`
          INSERT INTO room_charge_log (
            hospital_id, rcl_patient_id, rcl_encounter_id, rcl_account_id,
            charge_date, room_charge_type, rcl_bed_id, ward_name, room_category,
            base_rate, nursing_charge, rcl_total_charge,
            room_rent_eligible, is_over_eligible, generated_by_system,
            rcl_created_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}, ${input.encounter_id}, null,
            ${input.charge_date}, ${input.charge_type}, ${input.bed_id || null},
            ${input.ward_name || null}, ${input.room_category || null},
            ${input.base_rate}, ${input.nursing_charge || 0}, ${total_charge},
            ${input.room_rent_eligible || null}, ${input.is_over_eligible || false},
            true, NOW()
          )
          RETURNING id, rcl_total_charge as total_charge
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to add room charge',
          });
        }

        return {
          room_charge_id: rows[0].id,
          total_charge: rows[0].total_charge,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error adding room charge',
        });
      }
    }),

  // 12. LIST ROOM CHARGES
  listRoomCharges: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            id, charge_date, room_charge_type, ward_name, room_category,
            base_rate, nursing_charge, rcl_total_charge as total_charge,
            room_rent_eligible, is_over_eligible
          FROM room_charge_log
          WHERE rcl_encounter_id = ${input.encounter_id} AND hospital_id = ${hospitalId}
          ORDER BY charge_date ASC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing room charges',
        });
      }
    }),

  // 13. ROOM CHARGE STATS
  roomChargeStats: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            COUNT(*) as room_days,
            COALESCE(SUM(CAST(rcl_total_charge AS NUMERIC)), 0) as total_charges,
            COALESCE(AVG(CAST(base_rate AS NUMERIC)), 0) as avg_daily_rate,
            COALESCE(SUM(CASE WHEN is_over_eligible THEN 1 ELSE 0 END), 0) as days_over_eligible,
            COALESCE(SUM(CAST(prop_deduction_risk AS NUMERIC)), 0) as total_deduction_risk
          FROM room_charge_log
          WHERE rcl_encounter_id = ${input.encounter_id} AND hospital_id = ${hospitalId}
        `;

        const stats = (result as any)[0] || {};

        return {
          total_room_days: parseInt(stats.room_days || 0),
          total_room_charges: roundToTwo(stats.total_charges || 0),
          avg_daily_rate: roundToTwo(stats.avg_daily_rate || 0),
          days_over_eligible: parseInt(stats.days_over_eligible || 0),
          total_deduction_risk: roundToTwo(stats.total_deduction_risk || 0),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error calculating room charge stats',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // PACKAGES (14-17)
  // ═══════════════════════════════════════════════════════════════

  // 14. APPLY PACKAGE
  applyPackage: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      account_id: z.string().uuid().optional(),
      package_name: z.string().min(1),
      package_code: z.string().optional(),
      package_price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      includes_room: z.boolean().optional(),
      includes_pharmacy: z.boolean().optional(),
      includes_investigations: z.boolean().optional(),
      max_los_days: z.number().int().positive().optional(),
      components: z.array(z.object({
        component_name: z.string(),
        category: z.string(),
        budgeted_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        max_quantity: z.number().int().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Insert package application
        const packageResult = await sql`
          INSERT INTO package_applications (
            hospital_id, pa_patient_id, pa_encounter_id, pa_account_id,
            package_name, package_code, pa_status, package_price,
            includes_room, includes_pharmacy, includes_investigations,
            max_los_days, applied_at, applied_by, pa_created_at, pa_updated_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}, ${input.encounter_id}, ${input.account_id || null},
            ${input.package_name}, ${input.package_code || null}, 'active',
            ${input.package_price}, ${input.includes_room || true},
            ${input.includes_pharmacy || true}, ${input.includes_investigations || true},
            ${input.max_los_days || null}, NOW(), ${userId}, NOW(), NOW()
          )
          RETURNING id
        `;

        const packageRows = (packageResult as any);
        if (!packageRows || packageRows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to apply package',
          });
        }

        const packageAppId = packageRows[0].id;

        // Insert components if provided
        if (input.components && input.components.length > 0) {
          for (const component of input.components) {
            await sql`
              INSERT INTO package_components (
                hospital_id, pc_package_app_id, component_name, pc_category,
                budgeted_amount, pc_is_included, max_quantity, pc_created_at
              ) VALUES (
                ${hospitalId}, ${packageAppId}, ${component.component_name},
                ${component.category}, ${component.budgeted_amount}, true,
                ${component.max_quantity || null}, NOW()
              )
            `;
          }
        }

        return { package_application_id: packageAppId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error applying package',
        });
      }
    }),

  // 15. UPDATE PACKAGE COST
  updatePackageCost: protectedProcedure
    .input(z.object({ package_application_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get package encounter
        const packageResult = await sql`
          SELECT pa_encounter_id, package_price FROM package_applications
          WHERE id = ${input.package_application_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!packageResult || packageResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Package not found',
          });
        }

        const package_data = (packageResult as any)[0];
        const encounterId = package_data.pa_encounter_id;
        const packagePrice = parseFloat(package_data.package_price);

        // Get components and calculate actual cost
        const componentsResult = await sql`
          SELECT pc.id, pc.pc_category as category, pc.budgeted_amount
          FROM package_components pc
          WHERE pc.pc_package_app_id = ${input.package_application_id}
        `;

        const components = (componentsResult as any) || [];
        let totalActualCost = 0;

        for (const component of components) {
          const chargesResult = await sql`
            SELECT COALESCE(SUM(CAST(net_amount AS NUMERIC)), 0) as actual
            FROM encounter_charges
            WHERE encounter_id = ${encounterId} AND category = ${component.category}
          `;

          const actual = parseFloat((chargesResult as any)[0]?.actual || 0);
          totalActualCost += actual;

          const variance = actual - parseFloat(component.budgeted_amount);

          await sql`
            UPDATE package_components
            SET
              pc_actual_amount = ${actual},
              pc_variance = ${variance}
            WHERE id = ${component.id}
          `;
        }

        const variance_amount = totalActualCost - packagePrice;
        const status = totalActualCost > packagePrice ? 'exceeded' : 'active';

        await sql`
          UPDATE package_applications
          SET
            actual_cost = ${totalActualCost},
            variance_amount = ${variance_amount},
            pa_status = ${status},
            pa_updated_at = NOW()
          WHERE id = ${input.package_application_id}
        `;

        return {
          actual_cost: roundToTwo(totalActualCost),
          variance_amount: roundToTwo(variance_amount),
          status,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating package cost',
        });
      }
    }),

  // 16. GET PACKAGE DETAIL
  getPackageDetail: protectedProcedure
    .input(z.object({ package_application_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const packageResult = await sql`
          SELECT
            id, package_name, package_code, pa_status as status,
            package_price, actual_cost, variance_amount,
            includes_room, includes_pharmacy, includes_investigations,
            max_los_days, applied_at
          FROM package_applications
          WHERE id = ${input.package_application_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!packageResult || packageResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Package not found',
          });
        }

        const package_data = (packageResult as any)[0];

        const componentsResult = await sql`
          SELECT
            component_name, pc_category as category, budgeted_amount,
            pc_actual_amount as actual_amount, pc_variance as variance,
            max_quantity, used_quantity
          FROM package_components
          WHERE pc_package_app_id = ${input.package_application_id}
          ORDER BY pc_category
        `;

        return {
          ...package_data,
          components: componentsResult || [],
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching package details',
        });
      }
    }),

  // 17. LIST PACKAGES
  listPackages: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            pa.id, pa.package_name, pa.package_code, pa.pa_status as status,
            pa.package_price, pa.actual_cost, pa.variance_amount,
            pa.applied_at, p.patient_name
          FROM package_applications pa
          JOIN patients p ON pa.pa_patient_id = p.id
          WHERE pa.hospital_id = ${hospitalId}
            AND (${input.encounter_id ?? null}::uuid IS NULL OR pa.pa_encounter_id = ${input.encounter_id ?? null})
          ORDER BY pa.applied_at DESC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing packages',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // BILLING CONFIG & INVOICE LINE ITEMS (18-20)
  // ═══════════════════════════════════════════════════════════════

  // 18. GET BILLING CONFIG
  getBillingConfig: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            id, config_key, config_value, bc_description as description,
            bc_created_at as created_at, bc_updated_at as updated_at
          FROM billing_config
          WHERE hospital_id = ${hospitalId}
          ORDER BY config_key
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching billing config',
        });
      }
    }),

  // 19. UPDATE CONFIG
  updateConfig: protectedProcedure
    .input(z.object({
      config_key: z.string(),
      config_value: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Check if exists
        const existsResult = await sql`
          SELECT id FROM billing_config
          WHERE hospital_id = ${hospitalId} AND config_key = ${input.config_key}
          LIMIT 1
        `;

        if (existsResult && existsResult.length > 0) {
          // Update
          await sql`
            UPDATE billing_config
            SET
              config_value = ${input.config_value},
              bc_updated_by = ${userId},
              bc_updated_at = NOW()
            WHERE hospital_id = ${hospitalId} AND config_key = ${input.config_key}
          `;
        } else {
          // Insert
          await sql`
            INSERT INTO billing_config (
              hospital_id, config_key, config_value, bc_updated_by,
              bc_created_at, bc_updated_at
            ) VALUES (
              ${hospitalId}, ${input.config_key}, ${input.config_value},
              ${userId}, NOW(), NOW()
            )
          `;
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating config',
        });
      }
    }),

  // 20. GENERATE INVOICE LINE ITEMS
  generateInvoiceLineItems: protectedProcedure
    .input(z.object({ invoice_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get invoice's encounter
        const invoiceResult = await sql`
          SELECT encounter_id FROM invoices
          WHERE id = ${input.invoice_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!invoiceResult || invoiceResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Invoice not found',
          });
        }

        const encounterId = (invoiceResult as any)[0].encounter_id;

        // Get all charges for encounter
        const chargesResult = await sql`
          SELECT
            id, charge_code, charge_name, category, quantity,
            unit_price, discount_percent, gst_percent, net_amount
          FROM encounter_charges
          WHERE encounter_id = ${encounterId} AND hospital_id = ${hospitalId}
        `;

        const charges = (chargesResult as any) || [];
        let lineItemCount = 0;

        for (const charge of charges) {
          const quantity = charge.quantity || 1;
          const unitPrice = parseFloat(charge.unit_price || 0);
          const discountPercent = parseFloat(charge.discount_percent || 0);
          const gstPercent = parseFloat(charge.gst_percent || 0);

          const discountAmount = (quantity * unitPrice * discountPercent) / 100;
          const subtotalAfterDiscount = quantity * unitPrice - discountAmount;
          const gstAmount = (subtotalAfterDiscount * gstPercent) / 100;
          const netAmount = subtotalAfterDiscount + gstAmount;

          await sql`
            INSERT INTO invoice_line_items (
              hospital_id, ili_invoice_id, ili_charge_code, ili_description,
              ili_category, ili_service_date, ili_quantity, ili_unit_price,
              ili_discount_pct, ili_discount_amt, ili_gst_pct, ili_gst_amt,
              ili_net_amount, ili_source_type, ili_source_id, ili_created_at
            ) VALUES (
              ${hospitalId}, ${input.invoice_id}, ${charge.charge_code || null},
              ${charge.charge_name}, ${charge.category}, NOW(),
              ${quantity}, ${charge.unit_price}, ${discountPercent},
              ${discountAmount}, ${gstPercent}, ${gstAmount},
              ${netAmount}, 'manual', ${charge.id}, NOW()
            )
          `;

          lineItemCount++;
        }

        return { line_items_created: lineItemCount };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error generating invoice line items',
        });
      }
    }),
});
