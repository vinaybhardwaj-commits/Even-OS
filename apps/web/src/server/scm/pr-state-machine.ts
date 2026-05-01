/**
 * Purchase Requisition state machine — Phase 3 SCM Core PRD §11.
 *
 * 6 states + 7 allowed transitions:
 *
 *                    draft
 *                      ↓
 *                  submitted
 *                  ↙   ↓   ↘
 *           rejected  pr_approved  cancelled
 *                       ↓
 *                pr_converted_to_po
 *
 * - rejected / cancelled / pr_converted_to_po are terminal
 * - draft → submitted: PR creator finalizes the requisition
 * - submitted → pr_approved: KPMG matrix tier signs off
 * - submitted → rejected/cancelled: terminal failure paths
 * - pr_approved → pr_converted_to_po: PO creator converts (one-to-many)
 *
 * Pure-logic module. Mirrors indent-state-machine.ts pattern.
 */

export type PrState =
  | 'draft'
  | 'submitted'
  | 'pr_approved'
  | 'pr_rejected'
  | 'pr_converted_to_po'
  | 'cancelled';

export const PR_STATES: PrState[] = [
  'draft',
  'submitted',
  'pr_approved',
  'pr_rejected',
  'pr_converted_to_po',
  'cancelled',
];

export const ALLOWED_PR_TRANSITIONS: Record<PrState, PrState[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['pr_approved', 'pr_rejected', 'cancelled'],
  pr_approved: ['pr_converted_to_po', 'cancelled'],
  pr_rejected: [],
  pr_converted_to_po: [],
  cancelled: [],
};

export function isTerminalPrState(state: PrState): boolean {
  return ALLOWED_PR_TRANSITIONS[state].length === 0;
}

export function canPrTransition(from: PrState, to: PrState): boolean {
  return ALLOWED_PR_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface PrTransitionResult {
  ok: boolean;
  reason?: string;
}

export function validatePrTransition(args: {
  from: PrState;
  to: PrState;
  rejection_reason?: string;
  cancellation_reason?: string;
}): PrTransitionResult {
  const { from, to, rejection_reason, cancellation_reason } = args;
  if (!canPrTransition(from, to)) {
    return { ok: false, reason: `Invalid transition: ${from} → ${to}` };
  }
  if (to === 'pr_rejected' && (!rejection_reason || !rejection_reason.trim())) {
    return { ok: false, reason: 'Rejection requires a reason' };
  }
  if (to === 'cancelled' && (!cancellation_reason || !cancellation_reason.trim())) {
    return { ok: false, reason: 'Cancellation requires a reason' };
  }
  return { ok: true };
}
