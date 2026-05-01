/**
 * Indent SLA arithmetic — Phase 2 (per A9 lock 1 May 2026).
 *
 * Maps (priority, material_classification) → due offset from raise time.
 *
 * Base SLAs by priority:
 *   routine    24h
 *   urgent     4h
 *   stat       1h
 *   emergency  30 min
 *
 * Material-classification multipliers (KPMG-aligned):
 *   standard   2.0×  (relaxed for non-clinical items)
 *   emergency  1.0×  (strict; emergency items move on the priority's base)
 *   vital      0.5×  (tightened; vital items get half the time)
 *
 * Worked examples:
 *   stat priority + vital classification    = 1h × 0.5 = 30 minutes
 *   routine priority + standard             = 24h × 2.0 = 48 hours
 *   emergency priority + vital              = 30min × 0.5 = 15 minutes
 *   urgent priority + emergency             = 4h × 1.0 = 4 hours
 *
 * Pure-logic. Caller passes the raise timestamp; helper returns the
 * sla_due_at timestamp to stamp on the indent row.
 */

import type { IndentPriority } from './indent-state-machine';
import type { MaterialClassification } from './kpmg-approval-matrix';

const BASE_SLA_MS: Record<IndentPriority, number> = {
  routine: 24 * 60 * 60 * 1000,
  urgent: 4 * 60 * 60 * 1000,
  stat: 1 * 60 * 60 * 1000,
  emergency: 30 * 60 * 1000,
};

const CLASSIFICATION_MULTIPLIER: Record<MaterialClassification, number> = {
  standard: 2.0,
  emergency: 1.0,
  vital: 0.5,
};

/**
 * Compute the SLA-due timestamp from raise time + priority + material class.
 */
export function computeSlaDueAt(args: {
  raised_at: Date;
  priority: IndentPriority;
  material_classification: MaterialClassification | null | undefined;
}): Date {
  const { raised_at, priority, material_classification } = args;
  const base = BASE_SLA_MS[priority] ?? BASE_SLA_MS.routine;
  const mult = CLASSIFICATION_MULTIPLIER[material_classification ?? 'standard'] ?? 2.0;
  return new Date(raised_at.getTime() + base * mult);
}

/**
 * SLA breach check given current time + due time + current state.
 * Terminal-but-good states (received, closed) are NEVER breached even if
 * due_at is in the past — by then the indent is done.
 */
export function isSlaBreached(args: {
  now: Date;
  sla_due_at: Date | null;
  state: string;
}): boolean {
  const { now, sla_due_at, state } = args;
  if (!sla_due_at) return false;
  if (state === 'received' || state === 'closed') return false;
  if (state === 'rejected' || state === 'cancelled') return false;
  return now.getTime() > sla_due_at.getTime();
}

/**
 * Time remaining (ms) until SLA breach. Negative = past due.
 */
export function slaTimeRemainingMs(args: {
  now: Date;
  sla_due_at: Date | null;
}): number | null {
  if (!args.sla_due_at) return null;
  return args.sla_due_at.getTime() - args.now.getTime();
}

/**
 * Human-friendly bucket for color coding in admin queue.
 */
export type SlaBucket = 'breached' | 'critical' | 'warning' | 'ok' | 'no_sla';

export function slaBucket(args: {
  now: Date;
  sla_due_at: Date | null;
  state: string;
}): SlaBucket {
  if (!args.sla_due_at) return 'no_sla';
  if (isSlaBreached(args)) return 'breached';
  const remainingMs = slaTimeRemainingMs(args);
  if (remainingMs == null) return 'no_sla';

  const totalMs = args.sla_due_at.getTime() - new Date(args.sla_due_at.getTime() - remainingMs).getTime();
  // Don't have raised_at here — bucket purely by remaining time:
  const minutes = remainingMs / 60_000;
  if (minutes <= 30) return 'critical';
  if (minutes <= 120) return 'warning';
  return 'ok';
}
