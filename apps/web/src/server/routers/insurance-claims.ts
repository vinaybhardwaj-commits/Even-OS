import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ─── ENUMS ─────────────────────────────────────────────
const claimStatusEnum = [
  'draft',
  'pre_auth_pending',
  'pre_auth_approved',
  'pre_auth_rejected',
  'admitted',
  'enhancement_pending',
  'enhancement_approved',
  'enhancement_rejected',
  'discharge_pending',
  'query_raised',
  'under_review',
  'approved',
  'partially_approved',
  'rejected',
  'settled',
  'closed',
] as const;

const tpaEnum = [
  'medi_assist',
  'paramount',
  'vidal',
  'heritage',
  'raksha',
  'md_india',
  'good_health',
  'ericson',
  'safeway',
  'other',
] as const;

const eventTypeEnum = [
  'created',
  'pre_auth_submitted',
  'pre_auth_approved',
  'pre_auth_rejected',
  'enhancement_submitted',
  'enhancement_approved',
  'enhancement_rejected',
  'discharge_submitted',
  'query_raised',
  'query_responded',
  'under_review',
  'approved',
  'partially_approved',
  'rejected',
  'deduction_applied',
  'settled',
  'closed',
  'escalated',
  'note_added',
] as const;

const preAuthStatusEnum = ['draft', 'submitted', 'approved', 'rejected', 'expired', 'cancelled'] as const;

const enhancementStatusEnum = ['draft', 'submitted', 'approved', 'partially_approved', 'rejected'] as const;

const deductionCategoryEnum = [
  'non_payable',
  'proportional_deduction',
  'co_pay',
  'sub_limit_excess',
  'room_rent_excess',
  'policy_exclusion',
  'waiting_period',
  'other',
] as const;

// ─── HELPERS ────────────────────────────────────────────
function roundToTwo(num: number | string | null | undefined): string {
  if (!num) return '0.00';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return (Math.round(n * 100) / 100).toFixed(2);
}

// Generate claim number: IC-YYYYMMDD-NNNN
async function generateClaimNumber(hospitalId: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');

  const result = await getSql()`
    SELECT COUNT(*) as cnt FROM insurance_claims
    WHERE hospital_id = ${hospitalId}
    AND ic_created_at >= DATE(NOW())
  `;

  const count = (result[0] as any).cnt + 1;
  const seq = String(count).padStart(4, '0');
  return `IC-${dateStr}-${seq}`;
}

export const insuranceClaimsRouter = router({
  // ═══════════════════════════════════════════════════════════════
  // 1. CREATE CLAIM
  // ═══════════════════════════════════════════════════════════════
  createClaim: protectedProcedure
    .input(
      z.object({
        patient_id: z.string().uuid(),
        encounter_id: z.string().uuid(),
        account_id: z.string().uuid(),
        insurer_name: z.string().min(1).max(255),
        tpa: z.enum(tpaEnum),
        policy_number: z.string().min(1).max(100),
        member_id: z.string().min(1).max(100),
        sum_insured: z.string().regex(/^\d+(\.\d{1,2})?$/),
        room_rent_elig: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        co_pay_pct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        primary_diagnosis: z.string().max(500).optional(),
        icd_code: z.string().max(50).optional(),
        procedure_name: z.string().max(255).optional(),
        procedure_code: z.string().max(50).optional(),
        admission_date: z.string().datetime().optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Verify patient exists
        const patientCheck = await getSql()`
          SELECT id FROM patients
          WHERE id = ${input.patient_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        if (!patientCheck || patientCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Patient not found',
          });
        }

        // Verify encounter exists
        const encounterCheck = await getSql()`
          SELECT id FROM encounters
          WHERE id = ${input.encounter_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        if (!encounterCheck || encounterCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Encounter not found',
          });
        }

        // Verify account exists
        const accountCheck = await getSql()`
          SELECT id FROM billing_accounts
          WHERE id = ${input.account_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        if (!accountCheck || accountCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Billing account not found',
          });
        }

        // Generate claim number
        const claimNumber = await generateClaimNumber(hospitalId);

        // Create claim
        const claimResult = await getSql()`
          INSERT INTO insurance_claims (
            hospital_id, ic_patient_id, ic_encounter_id, ic_account_id,
            claim_number, ic_insurer_name, ic_tpa, ic_policy_number,
            ic_member_id, ic_sum_insured, ic_room_rent_elig, ic_co_pay_pct,
            primary_diagnosis, ic_icd_code, ic_procedure_name, ic_procedure_code,
            ic_admission_date, ic_status, ic_notes, ic_created_by,
            ic_created_at, ic_updated_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}, ${input.encounter_id},
            ${input.account_id}, ${claimNumber}, ${input.insurer_name},
            ${input.tpa}, ${input.policy_number}, ${input.member_id},
            ${input.sum_insured}, ${input.room_rent_elig || null},
            ${input.co_pay_pct || null}, ${input.primary_diagnosis || null},
            ${input.icd_code || null}, ${input.procedure_name || null},
            ${input.procedure_code || null}, ${input.admission_date || null},
            'draft', ${input.notes || null}, ${userId}, NOW(), NOW()
          )
          RETURNING id, claim_number, ic_status
        `;

        const claim = (claimResult[0] as any);
        if (!claim) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create claim',
          });
        }

        // Create 'created' event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_description, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${claim.id}, 'created', 'draft',
            'Claim created', ${userId}, NOW()
          )
        `;

        return {
          claim_id: claim.id,
          claim_number: claim.claim_number,
          status: claim.ic_status,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error creating claim',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 2. GET CLAIM
  // ═══════════════════════════════════════════════════════════════
  getClaim: protectedProcedure
    .input(z.object({ claim_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ic.id, ic.hospital_id, ic.ic_patient_id as patient_id,
            ic.ic_encounter_id as encounter_id, ic.ic_account_id as account_id,
            ic.claim_number, ic.tpa_claim_ref, ic.ic_insurer_name as insurer_name,
            ic.ic_tpa as tpa, ic.ic_policy_number as policy_number,
            ic.ic_member_id as member_id, ic.ic_sum_insured as sum_insured,
            ic.ic_room_rent_elig as room_rent_elig, ic.ic_co_pay_pct as co_pay_pct,
            ic.ic_status as status, ic.total_bill_amount, ic.ic_pre_auth_amount as pre_auth_amount,
            ic.enhancement_total, ic.ic_approved_amount as approved_amount,
            ic.ic_total_deductions as total_deductions, ic.settled_amount,
            ic.patient_liability, ic.primary_diagnosis, ic.ic_icd_code as icd_code,
            ic.ic_procedure_name as procedure_name, ic.ic_procedure_code as procedure_code,
            ic.ic_admission_date as admission_date, ic.ic_discharge_date as discharge_date,
            ic.ic_submitted_at as submitted_at, ic.ic_settled_at as settled_at,
            ic.ic_assigned_to as assigned_to, ic.ic_priority as priority,
            ic.ic_notes as notes, ic.ic_created_by as created_by,
            ic.ic_created_at as created_at, ic.ic_updated_at as updated_at,
            p.patient_name, u.user_full_name as assigned_user_name
          FROM insurance_claims ic
          JOIN patients p ON ic.ic_patient_id = p.id
          LEFT JOIN users u ON ic.ic_assigned_to = u.id
          WHERE ic.id = ${input.claim_id} AND ic.hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!result || result.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Claim not found',
          });
        }

        return result[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching claim',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 3. LIST CLAIMS
  // ═══════════════════════════════════════════════════════════════
  listClaims: protectedProcedure
    .input(
      z.object({
        status: z.enum(claimStatusEnum).optional(),
        tpa: z.enum(tpaEnum).optional(),
        patient_id: z.string().uuid().optional(),
        assigned_to: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ic.id, ic.claim_number, ic.ic_insurer_name as insurer_name,
            ic.ic_tpa as tpa, ic.ic_status as status,
            ic.total_bill_amount, ic.ic_pre_auth_amount as pre_auth_amount,
            ic.ic_approved_amount as approved_amount, ic.settled_amount,
            ic.ic_created_at as created_at, ic.ic_updated_at as updated_at,
            p.patient_name, u.user_full_name as assigned_user_name
          FROM insurance_claims ic
          JOIN patients p ON ic.ic_patient_id = p.id
          LEFT JOIN users u ON ic.ic_assigned_to = u.id
          WHERE ic.hospital_id = ${hospitalId}
          AND (${input.status ?? null}::text IS NULL OR ic.ic_status = ${input.status ?? null})
          AND (${input.tpa ?? null}::text IS NULL OR ic.ic_tpa = ${input.tpa ?? null})
          AND (${input.patient_id ?? null}::uuid IS NULL OR ic.ic_patient_id = ${input.patient_id ?? null})
          AND (${input.assigned_to ?? null}::uuid IS NULL OR ic.ic_assigned_to = ${input.assigned_to ?? null})
          ORDER BY ic.ic_created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing claims',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 4. UPDATE CLAIM STATUS
  // ═══════════════════════════════════════════════════════════════
  updateClaimStatus: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        new_status: z.enum(claimStatusEnum),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get current claim
        const claimResult = await getSql()`
          SELECT id, ic_status FROM insurance_claims
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!claimResult || claimResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Claim not found',
          });
        }

        const oldStatus = (claimResult[0] as any).ic_status;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = ${input.new_status}, ic_updated_at = NOW()
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_from_status, ce_to_status,
            ce_description, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'created', ${oldStatus},
            ${input.new_status}, ${input.notes || null}, ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, new_status: input.new_status };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating claim status',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 5. ASSIGN CLAIM
  // ═══════════════════════════════════════════════════════════════
  assignClaim: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        assign_to_user_id: z.string().uuid(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Verify user exists
        const userCheck = await getSql()`
          SELECT id FROM users WHERE id = ${input.assign_to_user_id} LIMIT 1
        `;
        if (!userCheck || userCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
          });
        }

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_assigned_to = ${input.assign_to_user_id},
              ic_priority = ${input.priority || 'medium'},
              ic_updated_at = NOW()
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type,
            ce_description, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'created',
            ${'Assigned to user ' + input.assign_to_user_id}, ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, assigned_to: input.assign_to_user_id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error assigning claim',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 6. SUBMIT PRE-AUTH
  // ═══════════════════════════════════════════════════════════════
  submitPreAuth: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        requested_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        diagnosis: z.string().max(500).optional(),
        proposed_treatment: z.string().max(500).optional(),
        expected_los_days: z.number().int().min(1).optional(),
        room_type_requested: z.string().max(100).optional(),
        estimated_cost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get claim
        const claimResult = await getSql()`
          SELECT id, ic_status FROM insurance_claims
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!claimResult || claimResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Claim not found',
          });
        }

        // Create pre-auth request
        const preAuthResult = await getSql()`
          INSERT INTO pre_auth_requests (
            hospital_id, par_claim_id, par_status, par_requested_amount,
            par_diagnosis, par_proposed_treatment, expected_los_days,
            room_type_requested, par_estimated_cost, par_submitted_at,
            par_submitted_by, par_created_at, par_updated_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'submitted',
            ${input.requested_amount}, ${input.diagnosis || null},
            ${input.proposed_treatment || null}, ${input.expected_los_days || null},
            ${input.room_type_requested || null}, ${input.estimated_cost || null},
            NOW(), ${userId}, NOW(), NOW()
          )
          RETURNING id
        `;

        // Update claim status
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'pre_auth_pending', ic_updated_at = NOW()
          WHERE id = ${input.claim_id}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'pre_auth_submitted',
            'pre_auth_pending', ${input.requested_amount}::numeric,
            ${userId}, NOW()
          )
        `;

        return {
          claim_id: input.claim_id,
          pre_auth_id: (preAuthResult[0] as any).id,
          status: 'pre_auth_pending',
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error submitting pre-auth',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 7. APPROVE PRE-AUTH
  // ═══════════════════════════════════════════════════════════════
  approvePreAuth: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        approved_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        auth_number: z.string().max(100).optional(),
        conditions: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get pre-auth
        const preAuthResult = await getSql()`
          SELECT id FROM pre_auth_requests
          WHERE par_claim_id = ${input.claim_id} AND hospital_id = ${hospitalId}
          ORDER BY par_created_at DESC
          LIMIT 1
        `;

        if (!preAuthResult || preAuthResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Pre-auth request not found',
          });
        }

        const preAuthId = (preAuthResult[0] as any).id;

        // Update pre-auth
        await getSql()`
          UPDATE pre_auth_requests
          SET par_status = 'approved', par_approved_amount = ${input.approved_amount},
              tpa_auth_number = ${input.auth_number || null},
              par_conditions = ${input.conditions || null},
              par_responded_at = NOW(), par_updated_at = NOW()
          WHERE id = ${preAuthId}
        `;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'pre_auth_approved',
              ic_pre_auth_amount = ${input.approved_amount},
              ic_updated_at = NOW()
          WHERE id = ${input.claim_id}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'pre_auth_approved',
            'pre_auth_approved', ${input.approved_amount}::numeric,
            ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, status: 'pre_auth_approved' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error approving pre-auth',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 8. REJECT PRE-AUTH
  // ═══════════════════════════════════════════════════════════════
  rejectPreAuth: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        rejection_reason: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get pre-auth
        const preAuthResult = await getSql()`
          SELECT id FROM pre_auth_requests
          WHERE par_claim_id = ${input.claim_id} AND hospital_id = ${hospitalId}
          ORDER BY par_created_at DESC
          LIMIT 1
        `;

        if (!preAuthResult || preAuthResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Pre-auth request not found',
          });
        }

        const preAuthId = (preAuthResult[0] as any).id;

        // Update pre-auth
        await getSql()`
          UPDATE pre_auth_requests
          SET par_status = 'rejected', par_rejection_reason = ${input.rejection_reason},
              par_responded_at = NOW(), par_updated_at = NOW()
          WHERE id = ${preAuthId}
        `;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'pre_auth_rejected', ic_updated_at = NOW()
          WHERE id = ${input.claim_id}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_description, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'pre_auth_rejected',
            'pre_auth_rejected', ${input.rejection_reason}, ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, status: 'pre_auth_rejected' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error rejecting pre-auth',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 9. GET PRE-AUTH
  // ═══════════════════════════════════════════════════════════════
  getPreAuth: protectedProcedure
    .input(z.object({ claim_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, par_claim_id as claim_id, par_status as status,
            par_requested_amount as requested_amount,
            par_approved_amount as approved_amount, par_diagnosis as diagnosis,
            par_proposed_treatment as proposed_treatment,
            expected_los_days, room_type_requested, par_estimated_cost as estimated_cost,
            tpa_auth_number, par_rejection_reason as rejection_reason,
            par_conditions as conditions, par_submitted_at as submitted_at,
            par_responded_at as responded_at, par_expires_at as expires_at,
            par_submitted_by as submitted_by, par_created_at as created_at,
            par_updated_at as updated_at
          FROM pre_auth_requests
          WHERE par_claim_id = ${input.claim_id} AND hospital_id = ${hospitalId}
          ORDER BY par_created_at DESC
          LIMIT 1
        `;

        if (!result || result.length === 0) {
          return null;
        }

        return result[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching pre-auth',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 10. SUBMIT ENHANCEMENT
  // ═══════════════════════════════════════════════════════════════
  submitEnhancement: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        additional_requested: z.string().regex(/^\d+(\.\d{1,2})?$/),
        reason: z.string().min(1).max(500),
        clinical_justification: z.string().max(1000).optional(),
        revised_diagnosis: z.string().max(500).optional(),
        revised_procedure: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get claim with current approved amount
        const claimResult = await getSql()`
          SELECT id, ic_pre_auth_amount FROM insurance_claims
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!claimResult || claimResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Claim not found',
          });
        }

        const previousApproved = (claimResult[0] as any).ic_pre_auth_amount || '0';
        const newTotal = (parseFloat(previousApproved) + parseFloat(input.additional_requested)).toString();

        // Get sequence number
        const seqResult = await getSql()`
          SELECT COALESCE(MAX(er_sequence_number), 0) + 1 as next_seq
          FROM enhancement_requests
          WHERE er_claim_id = ${input.claim_id}
        `;
        const sequenceNumber = (seqResult[0] as any).next_seq;

        // Create enhancement request
        const enhancementResult = await getSql()`
          INSERT INTO enhancement_requests (
            hospital_id, er_claim_id, er_status, er_sequence_number,
            previous_approved, additional_requested, new_total_requested,
            er_reason, clinical_justification, revised_diagnosis,
            revised_procedure, er_submitted_at, er_submitted_by,
            er_created_at, er_updated_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'submitted', ${sequenceNumber},
            ${previousApproved}, ${input.additional_requested},
            ${newTotal}, ${input.reason},
            ${input.clinical_justification || null}, ${input.revised_diagnosis || null},
            ${input.revised_procedure || null}, NOW(), ${userId},
            NOW(), NOW()
          )
          RETURNING id
        `;

        // Update claim status
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'enhancement_pending', enhancement_total = ${newTotal},
              ic_updated_at = NOW()
          WHERE id = ${input.claim_id}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'enhancement_submitted',
            'enhancement_pending', ${input.additional_requested}::numeric,
            ${userId}, NOW()
          )
        `;

        return {
          claim_id: input.claim_id,
          enhancement_id: (enhancementResult[0] as any).id,
          sequence_number: sequenceNumber,
          status: 'enhancement_pending',
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error submitting enhancement',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 11. APPROVE ENHANCEMENT
  // ═══════════════════════════════════════════════════════════════
  approveEnhancement: protectedProcedure
    .input(
      z.object({
        enhancement_id: z.string().uuid(),
        approved_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        tpa_reference: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get enhancement request
        const enhancementResult = await getSql()`
          SELECT er_claim_id, er_status FROM enhancement_requests
          WHERE id = ${input.enhancement_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!enhancementResult || enhancementResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Enhancement request not found',
          });
        }

        const claimId = (enhancementResult[0] as any).er_claim_id;

        // Update enhancement
        await getSql()`
          UPDATE enhancement_requests
          SET er_status = 'approved', er_approved_amount = ${input.approved_amount},
              er_tpa_reference = ${input.tpa_reference || null},
              er_responded_at = NOW(), er_updated_at = NOW()
          WHERE id = ${input.enhancement_id}
        `;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'enhancement_approved',
              ic_approved_amount = ic_pre_auth_amount + ${input.approved_amount}::numeric,
              ic_updated_at = NOW()
          WHERE id = ${claimId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${claimId}, 'enhancement_approved',
            'enhancement_approved', ${input.approved_amount}::numeric,
            ${userId}, NOW()
          )
        `;

        return { claim_id: claimId, status: 'enhancement_approved' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error approving enhancement',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 12. REJECT ENHANCEMENT
  // ═══════════════════════════════════════════════════════════════
  rejectEnhancement: protectedProcedure
    .input(
      z.object({
        enhancement_id: z.string().uuid(),
        rejection_reason: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get enhancement request
        const enhancementResult = await getSql()`
          SELECT er_claim_id FROM enhancement_requests
          WHERE id = ${input.enhancement_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!enhancementResult || enhancementResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Enhancement request not found',
          });
        }

        const claimId = (enhancementResult[0] as any).er_claim_id;

        // Update enhancement
        await getSql()`
          UPDATE enhancement_requests
          SET er_status = 'rejected', er_rejection_reason = ${input.rejection_reason},
              er_responded_at = NOW(), er_updated_at = NOW()
          WHERE id = ${input.enhancement_id}
        `;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'enhancement_rejected', ic_updated_at = NOW()
          WHERE id = ${claimId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_description, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${claimId}, 'enhancement_rejected',
            'enhancement_rejected', ${input.rejection_reason}, ${userId}, NOW()
          )
        `;

        return { claim_id: claimId, status: 'enhancement_rejected' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error rejecting enhancement',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 13. LIST ENHANCEMENTS
  // ═══════════════════════════════════════════════════════════════
  listEnhancements: protectedProcedure
    .input(z.object({ claim_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, er_claim_id as claim_id, er_status as status,
            er_sequence_number as sequence_number, previous_approved,
            additional_requested, new_total_requested, er_approved_amount as approved_amount,
            er_reason as reason, clinical_justification, revised_diagnosis,
            revised_procedure, er_tpa_reference as tpa_reference,
            er_rejection_reason as rejection_reason, er_submitted_at as submitted_at,
            er_responded_at as responded_at, er_created_at as created_at,
            er_updated_at as updated_at
          FROM enhancement_requests
          WHERE er_claim_id = ${input.claim_id} AND hospital_id = ${hospitalId}
          ORDER BY er_sequence_number ASC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing enhancements',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 14. SUBMIT DISCHARGE
  // ═══════════════════════════════════════════════════════════════
  submitDischarge: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        total_bill_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        discharge_date: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'discharge_pending', total_bill_amount = ${input.total_bill_amount},
              ic_discharge_date = ${input.discharge_date || null},
              ic_updated_at = NOW()
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'discharge_submitted',
            'discharge_pending', ${input.total_bill_amount}::numeric,
            ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, status: 'discharge_pending' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error submitting discharge',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 15. APPROVE CLAIM
  // ═══════════════════════════════════════════════════════════════
  approveClaim: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        approved_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        is_partial: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const status = input.is_partial ? 'partially_approved' : 'approved';

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = ${status}, ic_approved_amount = ${input.approved_amount},
              ic_updated_at = NOW()
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, ${status === 'partially_approved' ? 'partially_approved' : 'approved'},
            ${status}, ${input.approved_amount}::numeric, ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, status };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error approving claim',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 16. ADD DEDUCTION
  // ═══════════════════════════════════════════════════════════════
  addDeduction: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        category: z.enum(deductionCategoryEnum),
        description: z.string().min(1).max(500),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        invoice_line_id: z.string().uuid().optional(),
        charge_code: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Create deduction
        const deductionResult = await getSql()`
          INSERT INTO tpa_deductions (
            hospital_id, td_claim_id, td_category, td_description, td_amount,
            td_invoice_line_id, td_charge_code, is_disputed, td_applied_by, td_created_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, ${input.category},
            ${input.description}, ${input.amount}, ${input.invoice_line_id || null},
            ${input.charge_code || null}, false, ${userId}, NOW()
          )
          RETURNING id
        `;

        // Update claim total deductions
        await getSql()`
          UPDATE insurance_claims
          SET ic_total_deductions = COALESCE(ic_total_deductions, 0) + ${input.amount}::numeric,
              ic_updated_at = NOW()
          WHERE id = ${input.claim_id}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_amount,
            ce_description, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'deduction_applied',
            ${input.amount}::numeric, ${input.category}, ${userId}, NOW()
          )
        `;

        return {
          claim_id: input.claim_id,
          deduction_id: (deductionResult[0] as any).id,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error adding deduction',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 17. DISPUTE DEDUCTION
  // ═══════════════════════════════════════════════════════════════
  disputeDeduction: protectedProcedure
    .input(
      z.object({
        deduction_id: z.string().uuid(),
        dispute_reason: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Update deduction
        await getSql()`
          UPDATE tpa_deductions
          SET is_disputed = true, dispute_reason = ${input.dispute_reason}
          WHERE id = ${input.deduction_id} AND hospital_id = ${hospitalId}
        `;

        return { deduction_id: input.deduction_id, is_disputed: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error disputing deduction',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 18. RESOLVE DISPUTE
  // ═══════════════════════════════════════════════════════════════
  resolveDispute: protectedProcedure
    .input(
      z.object({
        deduction_id: z.string().uuid(),
        resolved_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get deduction
        const deductionResult = await getSql()`
          SELECT td_claim_id, td_amount FROM tpa_deductions
          WHERE id = ${input.deduction_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!deductionResult || deductionResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Deduction not found',
          });
        }

        const deduction = deductionResult[0] as any;
        const claimId = deduction.td_claim_id;
        const originalAmount = parseFloat(deduction.td_amount);
        const adjustmentAmount = originalAmount - parseFloat(input.resolved_amount);

        // Update deduction
        await getSql()`
          UPDATE tpa_deductions
          SET dispute_resolved = true, resolved_amount = ${input.resolved_amount}
          WHERE id = ${input.deduction_id}
        `;

        // Adjust claim total deductions
        await getSql()`
          UPDATE insurance_claims
          SET ic_total_deductions = COALESCE(ic_total_deductions, 0) - ${adjustmentAmount}::numeric,
              ic_updated_at = NOW()
          WHERE id = ${claimId}
        `;

        return {
          deduction_id: input.deduction_id,
          dispute_resolved: true,
          resolved_amount: input.resolved_amount,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error resolving dispute',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 19. LIST DEDUCTIONS
  // ═══════════════════════════════════════════════════════════════
  listDeductions: protectedProcedure
    .input(z.object({ claim_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, td_claim_id as claim_id, td_category as category,
            td_description as description, td_amount as amount,
            td_invoice_line_id as invoice_line_id, td_charge_code as charge_code,
            is_disputed, dispute_reason, dispute_resolved,
            resolved_amount, td_applied_by as applied_by, td_created_at as created_at
          FROM tpa_deductions
          WHERE td_claim_id = ${input.claim_id} AND hospital_id = ${hospitalId}
          ORDER BY td_created_at DESC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing deductions',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 20. SETTLE CLAIM
  // ═══════════════════════════════════════════════════════════════
  settleClaim: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        settled_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        patient_liability: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Update claim
        await getSql()`
          UPDATE insurance_claims
          SET ic_status = 'settled', settled_amount = ${input.settled_amount},
              patient_liability = ${input.patient_liability || null},
              ic_settled_at = NOW(), ic_updated_at = NOW()
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_to_status,
            ce_amount, ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'settled', 'settled',
            ${input.settled_amount}::numeric, ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id, status: 'settled' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error settling claim',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 21. ADD CLAIM NOTE
  // ═══════════════════════════════════════════════════════════════
  addClaimNote: protectedProcedure
    .input(
      z.object({
        claim_id: z.string().uuid(),
        note: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Update claim notes
        const claimResult = await getSql()`
          SELECT ic_notes FROM insurance_claims
          WHERE id = ${input.claim_id} AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!claimResult || claimResult.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Claim not found',
          });
        }

        const existingNotes = (claimResult[0] as any).ic_notes || '';
        const newNotes = existingNotes ? `${existingNotes}\n\n${input.note}` : input.note;

        await getSql()`
          UPDATE insurance_claims
          SET ic_notes = ${newNotes}, ic_updated_at = NOW()
          WHERE id = ${input.claim_id}
        `;

        // Create event
        await getSql()`
          INSERT INTO claim_events (
            hospital_id, ce_claim_id, ce_event_type, ce_description,
            ce_performed_by, ce_performed_at
          ) VALUES (
            ${hospitalId}, ${input.claim_id}, 'note_added',
            ${input.note}, ${userId}, NOW()
          )
        `;

        return { claim_id: input.claim_id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error adding claim note',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 22. GET CLAIM TIMELINE
  // ═══════════════════════════════════════════════════════════════
  getClaimTimeline: protectedProcedure
    .input(z.object({ claim_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ce.id, ce.ce_claim_id as claim_id, ce.ce_event_type as event_type,
            ce.ce_from_status as from_status, ce.ce_to_status as to_status,
            ce.ce_amount as amount, ce.ce_description as description,
            ce.ce_metadata as metadata, ce.ce_performed_by as performed_by,
            ce.ce_performed_at as performed_at, u.user_full_name as performer_name
          FROM claim_events ce
          LEFT JOIN users u ON ce.ce_performed_by = u.id
          WHERE ce.ce_claim_id = ${input.claim_id} AND ce.hospital_id = ${hospitalId}
          ORDER BY ce.ce_performed_at DESC
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching claim timeline',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 23. CLAIM STATS
  // ═══════════════════════════════════════════════════════════════
  claimStats: protectedProcedure
    .input(
      z.object({
        start_date: z.string().datetime().optional(),
        end_date: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            COUNT(CASE WHEN ic_status = 'draft' THEN 1 END) as draft_count,
            COUNT(CASE WHEN ic_status = 'pre_auth_pending' THEN 1 END) as pre_auth_pending_count,
            COUNT(CASE WHEN ic_status = 'pre_auth_approved' THEN 1 END) as pre_auth_approved_count,
            COUNT(CASE WHEN ic_status = 'pre_auth_rejected' THEN 1 END) as pre_auth_rejected_count,
            COUNT(CASE WHEN ic_status IN ('approved', 'partially_approved') THEN 1 END) as approved_count,
            COUNT(CASE WHEN ic_status = 'settled' THEN 1 END) as settled_count,
            COUNT(CASE WHEN ic_status = 'rejected' THEN 1 END) as rejected_count,
            COALESCE(SUM(CASE WHEN ic_status != 'rejected' THEN ic_pre_auth_amount ELSE 0 END), 0) as total_pre_auth,
            COALESCE(SUM(CASE WHEN ic_status != 'rejected' THEN ic_approved_amount ELSE 0 END), 0) as total_approved,
            COALESCE(SUM(CASE WHEN ic_status = 'settled' THEN settled_amount ELSE 0 END), 0) as total_settled,
            COALESCE(SUM(CASE WHEN ic_status != 'rejected' THEN ic_total_deductions ELSE 0 END), 0) as total_deductions
          FROM insurance_claims
          WHERE hospital_id = ${hospitalId}
          AND (${input.start_date ?? null}::timestamp IS NULL OR ic_created_at >= ${input.start_date ?? null})
          AND (${input.end_date ?? null}::timestamp IS NULL OR ic_created_at <= ${input.end_date ?? null})
        `;

        return result[0] || {};
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching claim stats',
        });
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 24. TPA PERFORMANCE
  // ═══════════════════════════════════════════════════════════════
  tpaPerformance: protectedProcedure.query(async ({ ctx }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          ic_tpa as tpa,
          COUNT(*) as total_claims,
          COUNT(CASE WHEN ic_status = 'pre_auth_approved' THEN 1 END) as approved_count,
          ROUND(
            COUNT(CASE WHEN ic_status = 'pre_auth_approved' THEN 1 END)::numeric /
            NULLIF(COUNT(*), 0) * 100, 2
          ) as approval_rate_pct,
          COALESCE(AVG(ic_total_deductions), 0) as avg_deduction,
          COALESCE(
            ROUND(AVG(ic_total_deductions)::numeric / NULLIF(AVG(total_bill_amount), 0) * 100, 2),
            0
          ) as avg_deduction_pct,
          MAX(ic_updated_at) as last_activity
        FROM insurance_claims
        WHERE hospital_id = ${hospitalId}
        GROUP BY ic_tpa
        ORDER BY total_claims DESC
      `;

      return result || [];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching TPA performance',
      });
    }
  }),

  // ═══════════════════════════════════════════════════════════════
  // 25. CLAIMS BY TPA
  // ═══════════════════════════════════════════════════════════════
  claimsByTPA: protectedProcedure
    .input(
      z.object({
        tpa: z.enum(tpaEnum),
        status: z.enum(claimStatusEnum).optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ic.id, ic.claim_number, ic.ic_insurer_name as insurer_name,
            ic.ic_tpa as tpa, ic.ic_status as status,
            ic.total_bill_amount, ic.ic_pre_auth_amount as pre_auth_amount,
            ic.ic_approved_amount as approved_amount, ic.settled_amount,
            ic.ic_created_at as created_at, ic.ic_updated_at as updated_at,
            p.patient_name, u.user_full_name as assigned_user_name
          FROM insurance_claims ic
          JOIN patients p ON ic.ic_patient_id = p.id
          LEFT JOIN users u ON ic.ic_assigned_to = u.id
          WHERE ic.hospital_id = ${hospitalId}
          AND ic.ic_tpa = ${input.tpa}
          AND (${input.status ?? null}::text IS NULL OR ic.ic_status = ${input.status ?? null})
          ORDER BY ic.ic_created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `;

        return result || [];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching claims by TPA',
        });
      }
    }),
});
