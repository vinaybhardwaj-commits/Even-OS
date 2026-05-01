// =============================================================================
// Codes — approval SLA helpers
// =============================================================================
// Working-days math for SLA expiry + escalation. Per Q3:
//   - Soft-escalate at 50% elapsed → BellDrawer ping to current approver
//   - Hard-escalate at 100% → notify CMS/GM regardless of stage
//   - Never auto-approve (clinical safety bias)
//   - Never auto-reject (preserve work)
//
// "Working days" = Mon-Fri only. Indian public holidays out of scope for
// Phase 2; a `holidays` table can be wired later if Finance compliance
// demands it. SLA math errs on the side of being TOO eager (i.e. an SLA that
// straddles a public holiday will appear closer to expiry than reality, which
// is a safe failure mode — escalates more, not less).
// =============================================================================

/**
 * Add `n` working days (Mon-Fri) to a starting date. Sat/Sun skipped.
 */
export function addWorkingDays(start: Date, n: number): Date {
  if (n <= 0) return new Date(start);
  const result = new Date(start);
  let added = 0;
  while (added < n) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) added++; // Sun=0, Sat=6
  }
  return result;
}

/**
 * Compute remaining percentage of an SLA window. Returns:
 *   100 — at start (none elapsed)
 *     0 — exactly at deadline
 *   <0 — past deadline (overdue)
 */
export function slaRemainingPct(
  startedAt: Date,
  slaWorkingDays: number,
  now: Date = new Date(),
): number {
  if (slaWorkingDays <= 0) return 100;
  const deadline = addWorkingDays(startedAt, slaWorkingDays);
  const totalMs = deadline.getTime() - startedAt.getTime();
  if (totalMs <= 0) return 100;
  const elapsedMs = now.getTime() - startedAt.getTime();
  const remainingMs = totalMs - elapsedMs;
  return Math.max(-100, Math.min(100, (remainingMs / totalMs) * 100));
}

/** Severity bucket for rendering an SLA chip in the UI. */
export type SlaSeverity = 'green' | 'amber' | 'red' | 'overdue';

/** Map a remaining-pct value to a severity for UI color cues. */
export function slaSeverity(remainingPct: number): SlaSeverity {
  if (remainingPct < 0) return 'overdue';
  if (remainingPct <= 0) return 'red';            // hard-escalate at 100% elapsed
  if (remainingPct <= 50) return 'amber';         // soft-escalate at 50% elapsed
  return 'green';
}

/**
 * Compose SLA fields for a queue row.
 */
export function describeSla(
  startedAt: Date,
  slaWorkingDays: number,
  now: Date = new Date(),
): {
  deadline: Date;
  remaining_pct: number;
  severity: SlaSeverity;
  soft_escalate: boolean;
  hard_escalate: boolean;
} {
  const deadline = addWorkingDays(startedAt, slaWorkingDays);
  const remaining_pct = slaRemainingPct(startedAt, slaWorkingDays, now);
  const severity = slaSeverity(remaining_pct);
  return {
    deadline,
    remaining_pct,
    severity,
    soft_escalate: remaining_pct <= 50 && remaining_pct > 0,
    hard_escalate: remaining_pct <= 0,
  };
}
