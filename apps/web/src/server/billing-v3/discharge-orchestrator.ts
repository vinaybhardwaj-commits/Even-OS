// =============================================================================
// BV3 Phase 4 — Discharge billing closure orchestrator (Q10)
// =============================================================================
// 6-step orchestration with idempotent step tracking + server-side gates.
//
// Steps (per Q10):
//   1. charge_reconciliation     — read charge_items, flag missing emits
//   2. bill_build                — call billsBuild from billing-v3-bills
//   3. settlement_presentation   — bill PDF on tablet (Phase 4 ships stub)
//   4. payment_collection        — claim file or cash collection (Phase 5/6)
//   5. document_pack             — DEFERRED (PDF assembly non-trivial)
//   6. bill_close                — bill.close() finalizes the orchestration
//
// Server-side gates: cannot start step N+1 unless step N is 'complete' or
// 'skipped'. Idempotent: re-runs check status; resume from interrupted.
// =============================================================================

import { db } from '@/lib/db';
import {
  dischargeBillingSteps, dischargeBillingAudit,
  DISCHARGE_STEPS, type DischargeStep, type DischargeStepStatus,
  bills, chargeItems,
} from '@db/schema';
import { and, eq, count } from 'drizzle-orm';

export const DISCHARGE_STEP_DEFAULTS: { step: DischargeStep; status: DischargeStepStatus }[] = [
  { step: 'charge_reconciliation', status: 'pending' },
  { step: 'bill_build', status: 'pending' },
  { step: 'settlement_presentation', status: 'pending' },
  { step: 'payment_collection', status: 'pending' },
  // step 5 is auto-skipped per Phase 4 scope
  { step: 'document_pack', status: 'skipped' },
  { step: 'bill_close', status: 'pending' },
];

/**
 * Initialize discharge orchestration for an encounter. Idempotent — if rows
 * already exist, returns the current state. Otherwise inserts 6 default-pending
 * step rows.
 */
export async function ensureOrchestration(args: {
  hospital_id: string;
  encounter_id: string;
  actor_user_id?: string;
  actor_role?: string;
}): Promise<{ steps: any[]; created: boolean }> {
  // Check if orchestration already exists
  const existing = await db.select().from(dischargeBillingSteps)
    .where(eq(dischargeBillingSteps.encounter_id, args.encounter_id));
  if (existing.length > 0) {
    return { steps: existing, created: false };
  }

  // Initialize 6 step rows
  const inserts = DISCHARGE_STEP_DEFAULTS.map((d) => ({
    hospital_id: args.hospital_id,
    encounter_id: args.encounter_id,
    step: d.step,
    status: d.status,
  }));
  await db.insert(dischargeBillingSteps).values(inserts);

  await db.insert(dischargeBillingAudit).values({
    hospital_id: args.hospital_id,
    encounter_id: args.encounter_id,
    step: 'charge_reconciliation',
    action: 'start',
    actor_user_id: args.actor_user_id ?? null,
    actor_role: args.actor_role ?? null,
    notes: 'Orchestration initialized',
  });

  const created = await db.select().from(dischargeBillingSteps)
    .where(eq(dischargeBillingSteps.encounter_id, args.encounter_id));
  return { steps: created, created: true };
}

/** Get the current step row by name. */
async function getStep(encounter_id: string, step: DischargeStep) {
  const [row] = await db.select().from(dischargeBillingSteps)
    .where(and(
      eq(dischargeBillingSteps.encounter_id, encounter_id),
      eq(dischargeBillingSteps.step, step),
    ))
    .limit(1);
  return row;
}

async function setStepStatus(args: {
  encounter_id: string;
  step: DischargeStep;
  status: DischargeStepStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  bill_id?: string;
}) {
  const updateFields: any = {
    status: args.status,
    updated_at: new Date(),
  };
  if (args.status === 'in_progress' || args.status === 'pending') {
    updateFields.started_at = new Date();
    updateFields.attempts = (await db.select({ a: dischargeBillingSteps.attempts })
      .from(dischargeBillingSteps)
      .where(and(
        eq(dischargeBillingSteps.encounter_id, args.encounter_id),
        eq(dischargeBillingSteps.step, args.step),
      ))
      .limit(1))[0]?.a ?? 0;
    updateFields.attempts += 1;
  }
  if (args.status === 'complete' || args.status === 'error' || args.status === 'skipped') {
    updateFields.completed_at = new Date();
  }
  if (args.result !== undefined) updateFields.result = args.result as any;
  if (args.error !== undefined) updateFields.error_message = args.error;
  if (args.bill_id !== undefined) updateFields.bill_id = args.bill_id;

  await db.update(dischargeBillingSteps)
    .set(updateFields)
    .where(and(
      eq(dischargeBillingSteps.encounter_id, args.encounter_id),
      eq(dischargeBillingSteps.step, args.step),
    ));
}

/**
 * Server-side gate: ensure all PRECEDING steps are complete or skipped before
 * the named step can advance.
 */
export async function assertGate(encounter_id: string, step: DischargeStep): Promise<void> {
  const stepIdx = DISCHARGE_STEPS.indexOf(step);
  if (stepIdx <= 0) return; // step 1 has no predecessors
  const required = DISCHARGE_STEPS.slice(0, stepIdx);
  const rows = await db.select().from(dischargeBillingSteps)
    .where(eq(dischargeBillingSteps.encounter_id, encounter_id));
  for (const r of rows) {
    if (required.includes(r.step as DischargeStep)) {
      if (r.status !== 'complete' && r.status !== 'skipped') {
        throw new Error(
          `Cannot advance to ${step}: prerequisite '${r.step}' is in status='${r.status}' (must be complete or skipped)`,
        );
      }
    }
  }
}

/**
 * Step 1 — Charge reconciliation. Reads charge_items for encounter; reports
 * count + flags. Marks step complete unless errors. Phase 4: simple count
 * + missing-room-day flag.
 */
export async function runChargeReconciliation(args: {
  hospital_id: string;
  encounter_id: string;
  actor_user_id: string;
  actor_role: string;
}): Promise<{ charge_items_count: number; warnings: string[] }> {
  await ensureOrchestration({ ...args });
  await assertGate(args.encounter_id, 'charge_reconciliation');
  await setStepStatus({ encounter_id: args.encounter_id, step: 'charge_reconciliation', status: 'in_progress' });

  // Count charge_items for this encounter
  const items = await db.select({
    id: chargeItems.id,
    source_module: chargeItems.source_module,
    status: chargeItems.status,
  })
    .from(chargeItems)
    .where(and(
      eq(chargeItems.hospital_id, args.hospital_id),
      eq(chargeItems.encounter_id, args.encounter_id),
    ));

  const warnings: string[] = [];
  if (items.length === 0) {
    warnings.push('No charge_items found for this encounter — bill build will fail');
  } else {
    const sourceModules = new Set(items.map((i) => i.source_module));
    if (!sourceModules.has('admission')) {
      warnings.push('No admission charge — verify ADM00007 was emitted');
    }
    if (!sourceModules.has('room')) {
      warnings.push('No room/bed charge — verify midnight-cron is running');
    }
  }

  await setStepStatus({
    encounter_id: args.encounter_id,
    step: 'charge_reconciliation',
    status: 'complete',
    result: { charge_items_count: items.length, warnings, source_modules: [...new Set(items.map((i) => i.source_module))] },
  });

  await db.insert(dischargeBillingAudit).values({
    hospital_id: args.hospital_id,
    encounter_id: args.encounter_id,
    step: 'charge_reconciliation',
    action: 'complete',
    actor_user_id: args.actor_user_id,
    actor_role: args.actor_role,
    details: { count: items.length, warnings } as any,
  });

  return { charge_items_count: items.length, warnings };
}

/**
 * Get current orchestration status (step list + currentStep).
 */
export async function getStatus(encounter_id: string): Promise<{
  steps: any[];
  current_step: DischargeStep | null;
  is_complete: boolean;
}> {
  const steps = await db.select().from(dischargeBillingSteps)
    .where(eq(dischargeBillingSteps.encounter_id, encounter_id));
  if (steps.length === 0) {
    return { steps: [], current_step: null, is_complete: false };
  }
  // Sort by canonical order
  steps.sort((a, b) =>
    DISCHARGE_STEPS.indexOf(a.step as DischargeStep) - DISCHARGE_STEPS.indexOf(b.step as DischargeStep));
  const current = steps.find((s) => s.status === 'in_progress' || s.status === 'pending');
  const is_complete = steps.every((s) => s.status === 'complete' || s.status === 'skipped');
  return {
    steps,
    current_step: current ? (current.step as DischargeStep) : null,
    is_complete,
  };
}

/** Mark a step complete (manual advance — used for stubs steps 3/4/6 wiring). */
export async function manualCompleteStep(args: {
  hospital_id: string;
  encounter_id: string;
  step: DischargeStep;
  result?: Record<string, unknown>;
  bill_id?: string;
  actor_user_id: string;
  actor_role: string;
}): Promise<void> {
  await assertGate(args.encounter_id, args.step);
  await setStepStatus({
    encounter_id: args.encounter_id,
    step: args.step,
    status: 'complete',
    result: args.result ?? null,
    bill_id: args.bill_id,
  });
  await db.insert(dischargeBillingAudit).values({
    hospital_id: args.hospital_id,
    encounter_id: args.encounter_id,
    step: args.step,
    action: 'complete',
    actor_user_id: args.actor_user_id,
    actor_role: args.actor_role,
    details: (args.result ?? null) as any,
  });
}
