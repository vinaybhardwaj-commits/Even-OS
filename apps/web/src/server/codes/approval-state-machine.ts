// =============================================================================
// Codes — approval state machine
// =============================================================================
// 5-state lifecycle per Q3:
//
//   draft
//     ↓ submit
//   pending_clinical_review (skipped for non-clinical kinds)
//     ↓ clinical_approve
//   pending_master_data_review (always required)
//     ↓ mdo_approve (high-impact → pending_cms_gm_review; else → active)
//   pending_cms_gm_review (high-impact only — Phase 3+ implements)
//     ↓ cms_gm_approve
//   active
//
//   Any non-active state can → rejected (with feedback note)
//   rejected → draft (loop-back, preserves work)
//
// Phase 2 implements:
//   - drug 2-stage path: draft → pending_clinical_review (pharmacy_supervisor)
//                              → pending_master_data_review (master_data_officer)
//                              → active
//   - consumable 1-stage path: draft → pending_master_data_review → active
//
// Phase 3+ adds CMS/GM stage for high-impact codes.
// =============================================================================

import type { CodesRole } from '@db/schema';

export type ApprovalState =
  | 'draft'
  | 'pending_clinical_review'
  | 'pending_master_data_review'
  | 'pending_cms_gm_review'
  | 'active'
  | 'rejected';

export const APPROVAL_STATES: readonly ApprovalState[] = [
  'draft',
  'pending_clinical_review',
  'pending_master_data_review',
  'pending_cms_gm_review',
  'active',
  'rejected',
] as const;

export type CodeKind =
  | 'drug'
  | 'implant'
  | 'consumable'
  | 'procedure'
  | 'lab_test'
  | 'imaging_study'
  | 'pack'
  | 'charge_tier'
  | 'lookup'
  | 'deprecation';

export const CODE_KINDS: readonly CodeKind[] = [
  'drug', 'implant', 'consumable', 'procedure', 'lab_test',
  'imaging_study', 'pack', 'charge_tier', 'lookup', 'deprecation',
] as const;

/** Transition action verbs the router exposes. */
export type TransitionAction =
  | 'submit'           // draft → pending_*review (first stage applicable to kind)
  | 'clinical_approve' // pending_clinical_review → pending_master_data_review
  | 'mdo_approve'      // pending_master_data_review → pending_cms_gm_review (high-impact) | active
  | 'cms_gm_approve'   // pending_cms_gm_review → active
  | 'reject'           // any pending_* → rejected (with feedback)
  | 'resubmit'         // rejected → draft (preserves work)
  | 'system_bootstrap';// __bootstrap → active (one-time historical migration)

/**
 * Authoritative transition table. Each entry lists the from-states this
 * action can be taken on, the resulting to-state, and which roles may invoke
 * it. super_admin / hospital_admin bypass role check (consistent with SCM
 * pattern); the bypass is applied by the assertCanTransition() helper.
 */
export interface TransitionRule {
  action: TransitionAction;
  from: ApprovalState | '__bootstrap';
  /**
   * to-state may be a single value or a function of routing context (e.g. mdo
   * approve resolves to pending_cms_gm_review when kind+code is high-impact,
   * else to active). For Phase 2 all routes resolve to a single state because
   * high-impact gating ships in Phase 3+.
   */
  to: ApprovalState | ((ctx: TransitionResolutionContext) => ApprovalState);
  /** Roles that may perform this action; super_admin / hospital_admin always allowed. */
  allowedRoles: CodesRole[];
  /** Whether a feedback_note is required (true for reject). */
  requiresFeedback?: boolean;
}

export interface TransitionResolutionContext {
  kind: CodeKind;
  /** True when the routing config says this kind requires CMS/GM and the item meets high-impact thresholds. Phase 2 always false. */
  isHighImpact: boolean;
}

export const APPROVAL_TRANSITIONS: TransitionRule[] = [
  // From draft: submit → first-applicable-stage. Resolved per code-kind by router.
  // We keep the machine declarative; the router computes target via routingNextStage().
  {
    action: 'submit',
    from: 'draft',
    to: () => {
      // Default. Real router-side logic uses routingNextStage(kind).
      throw new Error('submit transition target must be resolved by router via routingNextStage(kind)');
    },
    allowedRoles: ['pharmacy_supervisor', 'master_data_officer'], // creator submits; super_admin bypass too
  },
  // Clinical Stage 1 → MDO Stage 2
  {
    action: 'clinical_approve',
    from: 'pending_clinical_review',
    to: 'pending_master_data_review',
    allowedRoles: ['pharmacy_supervisor', 'cath_lab_lead', 'lab_lead', 'radiology_lead'],
  },
  // MDO Stage 2 → CMS/GM Stage 3 (high-impact) | active
  {
    action: 'mdo_approve',
    from: 'pending_master_data_review',
    to: (ctx) => (ctx.isHighImpact ? 'pending_cms_gm_review' : 'active'),
    allowedRoles: ['master_data_officer'],
  },
  // CMS/GM Stage 3 → active (Phase 3+)
  {
    action: 'cms_gm_approve',
    from: 'pending_cms_gm_review',
    to: 'active',
    allowedRoles: ['cms_gm_approver'],
  },
  // Reject from any pending_*review (with feedback) — caller passes from
  ...(['pending_clinical_review', 'pending_master_data_review', 'pending_cms_gm_review'] as ApprovalState[]).map(
    (from): TransitionRule => ({
      action: 'reject',
      from,
      to: 'rejected',
      allowedRoles: ['pharmacy_supervisor', 'master_data_officer', 'cath_lab_lead', 'lab_lead', 'radiology_lead', 'cms_gm_approver'],
      requiresFeedback: true,
    }),
  ),
  // Resubmit from rejected → draft (preserves work, clears feedback)
  {
    action: 'resubmit',
    from: 'rejected',
    to: 'draft',
    allowedRoles: ['pharmacy_supervisor', 'master_data_officer'], // creator usually
  },
  // System bootstrap (Phase 2.1.b — historical migration)
  {
    action: 'system_bootstrap',
    from: '__bootstrap',
    to: 'active',
    allowedRoles: [], // only super_admin can invoke
  },
];

/**
 * Find the matching transition rule for (action, fromState). Throws if invalid.
 */
export function findTransition(
  action: TransitionAction,
  fromState: ApprovalState | '__bootstrap',
): TransitionRule {
  const rule = APPROVAL_TRANSITIONS.find((r) => r.action === action && r.from === fromState);
  if (!rule) {
    throw new Error(
      `No transition: action=${action}, from=${fromState}. ` +
        `Either the state doesn't accept this action, or the action name is wrong.`,
    );
  }
  return rule;
}

/**
 * Resolve a transition to its concrete to-state. Pass the resolution context
 * for actions whose target depends on routing (e.g. mdo_approve high-impact).
 */
export function resolveTo(
  rule: TransitionRule,
  ctx: TransitionResolutionContext,
): ApprovalState {
  return typeof rule.to === 'function' ? rule.to(ctx) : rule.to;
}

/**
 * Decide whether a given role may perform a given transition. super_admin /
 * hospital_admin bypass always allowed. The systemBootstrap action requires
 * super_admin specifically.
 *
 * Returns null if allowed; returns an error message string if denied.
 */
export function denialReason(
  rule: TransitionRule,
  callerCodesRoles: CodesRole[],
  callerSystemRole: string,
): string | null {
  if (rule.action === 'system_bootstrap') {
    if (callerSystemRole !== 'super_admin') {
      return `system_bootstrap requires super_admin (got ${callerSystemRole})`;
    }
    return null;
  }
  if (callerSystemRole === 'super_admin' || callerSystemRole === 'hospital_admin') return null;
  for (const r of callerCodesRoles) {
    if (rule.allowedRoles.includes(r)) return null;
  }
  return `caller has none of the required codes_role values [${rule.allowedRoles.join(', ')}] for action ${rule.action}`;
}

/**
 * Routing-driven first-stage resolver. Given a code kind + routing config,
 * compute which state a 'submit' action should land in. Drug → clinical;
 * consumable → MDO directly; etc.
 */
export interface RoutingConfig {
  code_kind: CodeKind;
  clinical_role: CodesRole | null;
  requires_cms_gm_for_high_impact: boolean;
  sla_clinical_working_days: number;
  sla_mdo_working_days: number;
  sla_cms_gm_working_days: number;
}

export function routingNextStage(routing: RoutingConfig): ApprovalState {
  if (routing.clinical_role !== null && routing.sla_clinical_working_days > 0) {
    return 'pending_clinical_review';
  }
  return 'pending_master_data_review';
}

/**
 * Top-level guard used by the codes.approvals router. Throws an Error with a
 * descriptive message if the caller can't perform the action; otherwise
 * returns the resolved next state.
 */
export function assertCanTransitionAndResolve(args: {
  action: TransitionAction;
  fromState: ApprovalState | '__bootstrap';
  routing: RoutingConfig;
  isHighImpact: boolean;
  callerCodesRoles: CodesRole[];
  callerSystemRole: string;
  feedbackNote?: string | null;
}): { rule: TransitionRule; toState: ApprovalState } {
  const rule = findTransition(args.action, args.fromState);
  const denied = denialReason(rule, args.callerCodesRoles, args.callerSystemRole);
  if (denied) {
    throw new Error(`Approval transition denied: ${denied}`);
  }
  if (rule.requiresFeedback && (!args.feedbackNote || args.feedbackNote.trim().length === 0)) {
    throw new Error(`Approval transition requires feedback_note (action=${args.action})`);
  }
  // 'submit' resolves through routing instead of the static rule.to
  let toState: ApprovalState;
  if (args.action === 'submit') {
    toState = routingNextStage(args.routing);
  } else {
    toState = resolveTo(rule, { kind: args.routing.code_kind, isHighImpact: args.isHighImpact });
  }
  return { rule, toState };
}
