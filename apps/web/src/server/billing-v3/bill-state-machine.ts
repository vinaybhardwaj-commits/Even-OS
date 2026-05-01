// =============================================================================
// BV3 Phase 4 — Bill state machine
// =============================================================================
// 6-state machine per Q4 + amendment branch:
//
//   draft → pending_review → finalized → settled → closed → archived
//
//   amendment branch (post-finalize):
//     finalized → reverse + reissue creates a new bill in 'draft' with
//                 replaces_bill_id; original bill flagged amended=true
//
// Server-side enforcement: state transitions go through assertCanTransition;
// no procedure may direct-update state. Mirrors SCM/indent-state-machine.ts
// pattern.
// =============================================================================

import type { BillState, BillTransitionAction, ConcessionApprovalLevel } from '@db/schema';

export type { BillState, BillTransitionAction, ConcessionApprovalLevel };

interface TransitionRule {
  action: BillTransitionAction | 'create';
  from: BillState | '__new';
  to: BillState;
  /**
   * Acceptable system roles. super_admin / hospital_admin always allowed
   * (override pattern).
   */
  allowedRoles: string[];
  /** Whether action requires reason text. */
  requiresReason?: boolean;
}

export const BILL_TRANSITIONS: TransitionRule[] = [
  // create — initial state
  {
    action: 'create',
    from: '__new',
    to: 'draft',
    allowedRoles: ['billing_manager', 'billing_executive', 'billing_exec', 'cashier', 'gm', 'cfo'],
  },
  // draft → pending_review
  {
    action: 'send_for_review',
    from: 'draft',
    to: 'pending_review',
    allowedRoles: ['billing_manager', 'billing_executive', 'billing_exec', 'cashier'],
  },
  // pending_review → finalized
  {
    action: 'finalize',
    from: 'pending_review',
    to: 'finalized',
    allowedRoles: ['billing_manager', 'gm', 'cfo'],
  },
  // finalized → settled
  {
    action: 'settle_payment',
    from: 'finalized',
    to: 'settled',
    allowedRoles: ['billing_manager', 'billing_executive', 'billing_exec', 'cashier', 'accounts_manager'],
  },
  // settled → closed
  {
    action: 'close',
    from: 'settled',
    to: 'closed',
    allowedRoles: ['billing_manager', 'accounts_manager'],
  },
  // closed → archived (nightly job; system role only)
  {
    action: 'archive',
    from: 'closed',
    to: 'archived',
    allowedRoles: [], // system-only; super_admin can run manually
  },
  // amendment: finalized → reversed (the original)
  // We don't change the state to a literal 'reversed'; we set amended=true and
  // create a NEW draft bill via reissue. Phase 4 ships this as a single
  // compound action 'reverse_and_reissue' implemented in the router.
  {
    action: 'reverse',
    from: 'finalized',
    to: 'finalized',  // state unchanged; amended flag flipped
    allowedRoles: ['billing_manager', 'gm', 'cfo'],
    requiresReason: true,
  },
  // reissue creates a NEW bill in draft — handled in router; logically
  // a 'create' but with replaces_bill_id linkage.
  {
    action: 'reissue',
    from: '__new',
    to: 'draft',
    allowedRoles: ['billing_manager', 'gm', 'cfo'],
    requiresReason: true,
  },
];

export function findTransition(
  action: BillTransitionAction | 'create',
  fromState: BillState | '__new',
): TransitionRule {
  const rule = BILL_TRANSITIONS.find((r) => r.action === action && r.from === fromState);
  if (!rule) {
    throw new Error(`No transition: action=${action}, from=${fromState}`);
  }
  return rule;
}

export function denialReason(
  rule: TransitionRule,
  callerSystemRole: string,
): string | null {
  if (callerSystemRole === 'super_admin' || callerSystemRole === 'hospital_admin') return null;
  if (rule.allowedRoles.length === 0) {
    // System-only action (e.g. archive). Only super_admin allowed.
    return `${rule.action} requires super_admin (got ${callerSystemRole})`;
  }
  if (rule.allowedRoles.includes(callerSystemRole)) return null;
  return `caller role '${callerSystemRole}' not in allowed list [${rule.allowedRoles.join(', ')}] for action ${rule.action}`;
}

/**
 * Compute concession approval level required, given concession amount + bill
 * subtotal + thresholds from charge_master_hospital_setting.
 *
 * Returns:
 *   - 'self' if concession % <= self_limit_percent (default 5)
 *   - 'gm'   if concession % <= gm_limit_percent (default 20)
 *   - 'cfo'  if concession exceeds both
 */
export function concessionApprovalLevel(args: {
  concession_amount: number;
  bill_total_before_concession: number;
  self_limit_percent: number;
  gm_limit_percent: number;
}): ConcessionApprovalLevel {
  if (args.bill_total_before_concession <= 0) return 'self'; // edge case
  const pct = (args.concession_amount / args.bill_total_before_concession) * 100;
  if (pct <= args.self_limit_percent) return 'self';
  if (pct <= args.gm_limit_percent) return 'gm';
  return 'cfo';
}

export function assertCanTransition(args: {
  action: BillTransitionAction | 'create';
  fromState: BillState | '__new';
  callerSystemRole: string;
  reason?: string | null;
}): TransitionRule {
  const rule = findTransition(args.action, args.fromState);
  const denied = denialReason(rule, args.callerSystemRole);
  if (denied) throw new Error(`Bill transition denied: ${denied}`);
  if (rule.requiresReason && (!args.reason || args.reason.trim().length === 0)) {
    throw new Error(`Bill transition requires reason for action=${args.action}`);
  }
  return rule;
}
