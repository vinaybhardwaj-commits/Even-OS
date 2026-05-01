/**
 * Item lifecycle state machine — Codes Q3 5-state lock + Q12 deprecation.
 *
 * Phase 1.7. Extracted from inline definition in scm/items.ts so the
 * transition matrix is unit-testable independent of the tRPC procedure.
 *
 * The router (items.ts → itemTransitionStatusProcedure) imports
 * `validateItemTransition` and uses the matrix below to decide whether
 * a requested transition is allowed.
 *
 * Contract (Codes Q3):
 *   pending_clinical_review     → pending_master_data_review | rejected
 *   pending_master_data_review  → pending_cms_gm_review      | rejected
 *   pending_cms_gm_review       → active                     | rejected
 *   active                      → deprecated_grace
 *   deprecated_grace            → deprecated
 *   deprecated                  → archived
 *   archived | rejected         → (terminal)
 *
 * Codes Q12: transitioning to `deprecated_grace` requires a reason
 * AND an urgency_tier ('routine' | 'urgent' | 'emergency').
 */

export type ItemStatus =
  | 'pending_clinical_review'
  | 'pending_master_data_review'
  | 'pending_cms_gm_review'
  | 'active'
  | 'deprecated_grace'
  | 'deprecated'
  | 'archived'
  | 'rejected';

export type DeprecationUrgencyTier = 'routine' | 'urgent' | 'emergency';

export const ITEM_STATUSES: ItemStatus[] = [
  'pending_clinical_review',
  'pending_master_data_review',
  'pending_cms_gm_review',
  'active',
  'deprecated_grace',
  'deprecated',
  'archived',
  'rejected',
];

/**
 * Allowed transition map. Keys are current status; values are statuses
 * that are reachable from that key. A status whose entry is [] is
 * terminal — no transitions allowed.
 */
export const ALLOWED_ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending_clinical_review: ['pending_master_data_review', 'rejected'],
  pending_master_data_review: ['pending_cms_gm_review', 'rejected'],
  pending_cms_gm_review: ['active', 'rejected'],
  active: ['deprecated_grace'],
  deprecated_grace: ['deprecated'],
  deprecated: ['archived'],
  archived: [],
  rejected: [],
};

/**
 * Statuses that are terminal — no outgoing transitions allowed.
 */
export function isTerminalStatus(status: ItemStatus): boolean {
  return ALLOWED_ITEM_TRANSITIONS[status].length === 0;
}

/**
 * Pure check: returns true if `from → to` is an allowed transition.
 */
export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return ALLOWED_ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validate a requested transition. Returns {ok: true} or
 * {ok: false, reason}. The router converts a non-ok result into a
 * TRPCError BAD_REQUEST.
 *
 * Codes Q12: deprecation_grace transitions REQUIRE both a reason
 * and an urgency_tier.
 */
export interface TransitionValidationOk {
  ok: true;
}
export interface TransitionValidationErr {
  ok: false;
  reason: string;
}
export type TransitionValidationResult = TransitionValidationOk | TransitionValidationErr;

export function validateItemTransition(args: {
  from: ItemStatus;
  to: ItemStatus;
  reason?: string;
  urgency_tier?: DeprecationUrgencyTier;
}): TransitionValidationResult {
  const { from, to, reason, urgency_tier } = args;

  if (!canTransition(from, to)) {
    return { ok: false, reason: `Invalid transition: ${from} → ${to}` };
  }

  // Codes Q12: deprecation requires reason + urgency_tier
  if (to === 'deprecated_grace') {
    if (!reason || !reason.trim()) {
      return { ok: false, reason: 'Deprecation requires a reason' };
    }
    if (!urgency_tier) {
      return { ok: false, reason: 'Deprecation requires an urgency_tier (routine|urgent|emergency)' };
    }
  }

  return { ok: true };
}
