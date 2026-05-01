/**
 * Indent state machine — Phase 2 SCM Core PRD §10 AC2 + schema CHECK.
 *
 * 8 states + 9 allowed transitions:
 *
 *                    pending
 *                  ↙   ↓   ↘
 *            rejected approved cancelled
 *                       ↓
 *                     issued
 *                       ↓
 *                  in_transit
 *                       ↓
 *                    received
 *                       ↓
 *                     closed
 *
 * - rejected / cancelled / closed are terminal
 * - pending → approved happens only when ALL required indent_approvals
 *   rows have decision='approved' (multi-tier KPMG matrix per A1 Path C)
 * - approved → issued: SCM admin issues stock; pairs ledger entries
 *   transfer_out (source) + transfer_in (dest) with quantity_in_transit
 *   tracking the gap (A3 Path B)
 * - issued → in_transit: stock left source; auto-flips on issue
 * - in_transit → received: raiser acknowledges receipt; flips
 *   quantity_in_transit → quantity_on_hand at destination
 * - received → closed: optional finalization (e.g., for reconciliation)
 *
 * Pure-logic module. No DB access. Mirrors item-lifecycle.ts pattern
 * from Phase 1.7 so the matrix is unit-testable without tRPC.
 */

export type IndentState =
  | 'pending'
  | 'approved'
  | 'issued'
  | 'in_transit'
  | 'received'
  | 'closed'
  | 'rejected'
  | 'cancelled';

export type IndentPriority = 'routine' | 'urgent' | 'stat' | 'emergency';

export const INDENT_STATES: IndentState[] = [
  'pending',
  'approved',
  'issued',
  'in_transit',
  'received',
  'closed',
  'rejected',
  'cancelled',
];

export const INDENT_PRIORITIES: IndentPriority[] = [
  'routine',
  'urgent',
  'stat',
  'emergency',
];

/**
 * Allowed transition map. Keys are current state; values are reachable
 * states. Empty array = terminal.
 */
export const ALLOWED_INDENT_TRANSITIONS: Record<IndentState, IndentState[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['issued', 'cancelled'],
  issued: ['in_transit'],
  in_transit: ['received'],
  received: ['closed'],
  closed: [],
  rejected: [],
  cancelled: [],
};

export function isTerminalIndentState(state: IndentState): boolean {
  return ALLOWED_INDENT_TRANSITIONS[state].length === 0;
}

export function canIndentTransition(from: IndentState, to: IndentState): boolean {
  return ALLOWED_INDENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------- Validation result types ----------

export interface IndentTransitionOk {
  ok: true;
}
export interface IndentTransitionErr {
  ok: false;
  reason: string;
}
export type IndentTransitionResult = IndentTransitionOk | IndentTransitionErr;

/**
 * Validate a requested indent transition with optional context.
 *
 * Specific business rules enforced:
 *   - reject requires reason
 *   - cancel requires reason
 *   - approve cannot be called directly; it's the result of all required
 *     indent_approvals rows being decided='approved' (router enforces this)
 *   - issue requires source_inventory_id + quantity_to_issue per line
 *     (router enforces this; this module just validates state)
 */
export function validateIndentTransition(args: {
  from: IndentState;
  to: IndentState;
  reason?: string;
  cancellation_reason?: string;
}): IndentTransitionResult {
  const { from, to, reason, cancellation_reason } = args;

  if (!canIndentTransition(from, to)) {
    return { ok: false, reason: `Invalid transition: ${from} → ${to}` };
  }

  if (to === 'rejected' && (!reason || !reason.trim())) {
    return { ok: false, reason: 'Rejection requires a reason' };
  }

  if (to === 'cancelled' && (!cancellation_reason || !cancellation_reason.trim())) {
    return { ok: false, reason: 'Cancellation requires a reason' };
  }

  return { ok: true };
}

/**
 * Per-line approval constraint:
 *   quantity_approved must be ≥ 0 and ≤ quantity_requested.
 *   quantity_approved = 0 effectively excludes that line from issue.
 */
export function validateLineApproval(args: {
  quantity_requested: number;
  quantity_approved: number;
}): IndentTransitionResult {
  const { quantity_requested, quantity_approved } = args;

  if (!Number.isFinite(quantity_approved) || quantity_approved < 0) {
    return { ok: false, reason: 'quantity_approved must be ≥ 0' };
  }
  if (quantity_approved > quantity_requested) {
    return {
      ok: false,
      reason: `quantity_approved (${quantity_approved}) cannot exceed quantity_requested (${quantity_requested})`,
    };
  }
  return { ok: true };
}

/**
 * Per-line issue constraint:
 *   quantity_to_issue must be ≥ 0 and ≤ quantity_approved
 *   (cumulative across multiple issue calls — router checks against
 *    quantity_issued + quantity_to_issue ≤ quantity_approved).
 */
export function validateLineIssue(args: {
  quantity_approved: number;
  quantity_already_issued: number;
  quantity_to_issue: number;
}): IndentTransitionResult {
  const { quantity_approved, quantity_already_issued, quantity_to_issue } = args;

  if (!Number.isFinite(quantity_to_issue) || quantity_to_issue <= 0) {
    return { ok: false, reason: 'quantity_to_issue must be > 0' };
  }
  const cumulative = quantity_already_issued + quantity_to_issue;
  if (cumulative > quantity_approved) {
    return {
      ok: false,
      reason: `cumulative issued (${cumulative}) would exceed approved quantity (${quantity_approved})`,
    };
  }
  return { ok: true };
}

/**
 * Per-line acknowledge constraint:
 *   quantity_to_acknowledge must be > 0 and ≤
 *   (quantity_issued − quantity_already_acknowledged).
 */
export function validateLineAcknowledge(args: {
  quantity_issued: number;
  quantity_already_acknowledged: number;
  quantity_to_acknowledge: number;
}): IndentTransitionResult {
  const { quantity_issued, quantity_already_acknowledged, quantity_to_acknowledge } = args;

  if (!Number.isFinite(quantity_to_acknowledge) || quantity_to_acknowledge <= 0) {
    return { ok: false, reason: 'quantity_to_acknowledge must be > 0' };
  }
  const cumulative = quantity_already_acknowledged + quantity_to_acknowledge;
  if (cumulative > quantity_issued) {
    return {
      ok: false,
      reason: `cumulative acknowledged (${cumulative}) would exceed issued quantity (${quantity_issued})`,
    };
  }
  return { ok: true };
}
