import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  ensureOrchestration, runChargeReconciliation, manualCompleteStep, getStatus,
} from '@/server/billing-v3/discharge-orchestrator';
import { DISCHARGE_STEPS } from '@db/schema';

// =============================================================================
// billingV3.discharge.* — Phase 4 router
// =============================================================================
// Wraps server/billing-v3/discharge-orchestrator with admission control.
// Caregiver + admin roles can advance steps; super_admin can reset.
// =============================================================================

const ALLOWED_ROLES = [
  'super_admin', 'hospital_admin', 'admin',
  'billing_manager', 'billing_executive', 'billing_exec',
  'cashier', 'ip_coordinator', 'gm', 'cfo', 'accounts_manager',
];

function assertAllowed(role: string) {
  if (!ALLOWED_ROLES.includes(role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Role '${role}' not allowed for discharge orchestration`,
    });
  }
}

export const dischargeStartProcedure = protectedProcedure
  .input(z.object({ encounter_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    assertAllowed(ctx.user.role);
    return ensureOrchestration({
      hospital_id: ctx.user.hospital_id,
      encounter_id: input.encounter_id,
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
    });
  });

export const dischargeStatusProcedure = protectedProcedure
  .input(z.object({ encounter_id: z.string().uuid() }))
  .query(async ({ input }) => getStatus(input.encounter_id));

export const dischargeRunReconciliationProcedure = protectedProcedure
  .input(z.object({ encounter_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    assertAllowed(ctx.user.role);
    return runChargeReconciliation({
      hospital_id: ctx.user.hospital_id,
      encounter_id: input.encounter_id,
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
    });
  });

/** Advance a step manually — used for stubs (settlement_presentation, payment_collection, bill_close). */
export const dischargeAdvanceStepProcedure = protectedProcedure
  .input(z.object({
    encounter_id: z.string().uuid(),
    step: z.enum(DISCHARGE_STEPS),
    result: z.record(z.any()).optional(),
    bill_id: z.string().uuid().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    assertAllowed(ctx.user.role);
    await manualCompleteStep({
      hospital_id: ctx.user.hospital_id,
      encounter_id: input.encounter_id,
      step: input.step,
      result: input.result,
      bill_id: input.bill_id,
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
    });
    return getStatus(input.encounter_id);
  });

export const billingV3DischargeRouter = router({
  start: dischargeStartProcedure,
  status: dischargeStatusProcedure,
  runReconciliation: dischargeRunReconciliationProcedure,
  advanceStep: dischargeAdvanceStepProcedure,
});
