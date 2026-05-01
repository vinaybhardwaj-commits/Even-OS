/**
 * KPMG approval matrix — Phase 2 v1 (simple) + Phase 9 ABSORPTION (full chain).
 *
 * v1 Phase 2 scope (per A10 lock 1 May 2026):
 *   - Single approver tier per material classification
 *   - standard         → procurement_head
 *   - emergency        → finance_in_charge
 *   - vital            → facility_director (highest tier)
 *
 * Phase 9 KPMG ABSORPTION (deferred):
 *   - Full chain HOD → Non-Med Head → Finance → FD
 *   - Tier-vs-amount thresholds (≤₹50K HOD, ₹50K-2L Procurement Head, etc.)
 *   - Co-approval for ≥₹10L (Facility Director + CMS/GM)
 *
 * Pure-logic module. Reusable for PO approvals once Phase 3 ships
 * (the concept of "what tier(s) must sign off?" is the same).
 */

import type { ApproverRole } from '../../../drizzle/schema/65-scm-indents-rbac';

export type MaterialClassification = 'standard' | 'emergency' | 'vital';

export const MATERIAL_CLASSIFICATIONS: MaterialClassification[] = [
  'standard',
  'emergency',
  'vital',
];

/**
 * Phase 2 v1 — single tier per classification.
 */
const SIMPLE_MATRIX: Record<MaterialClassification, ApproverRole[]> = {
  standard: ['procurement_head'],
  emergency: ['finance_in_charge'],
  vital: ['facility_director'],
};

/**
 * Returns the ordered list of approver roles required to approve an indent
 * with the given material classification. The indent transitions
 * pending → approved only when ALL required tiers have signed off.
 *
 * Order matters: tier_order in indent_approvals rows mirrors index here.
 */
export function requiredApproversForClassification(
  classification: MaterialClassification,
): ApproverRole[] {
  return SIMPLE_MATRIX[classification] ?? ['procurement_head'];
}

/**
 * Convenience: given an indent's material_classification (which may be
 * NULL on the indent itself if classification is at the item level),
 * resolve via fallback to 'standard'.
 */
export function resolveApproverChain(
  classification: MaterialClassification | null | undefined,
): ApproverRole[] {
  return requiredApproversForClassification(classification ?? 'standard');
}

/**
 * Are all required approvals decided='approved'?
 *
 * Caller passes the actual indent_approvals rows. This is a pure check
 * over the array shape so it's unit-testable.
 */
export function areAllApprovalsDone(
  approvals: Array<{ decision: string | null }>,
  required_count: number,
): boolean {
  const approvedCount = approvals.filter((a) => a.decision === 'approved').length;
  return approvedCount >= required_count;
}

/**
 * Has any approver rejected? If yes, the whole indent transitions
 * pending → rejected.
 */
export function hasRejection(approvals: Array<{ decision: string | null }>): boolean {
  return approvals.some((a) => a.decision === 'rejected');
}

// ============================================================
// PO TIER THRESHOLDS (Phase 3) — KPMG approval matrix per amount
//
// Locked from PRD §10 + KPMG synthesis:
//   ≤ ₹50,000             HOD signs alone
//   ₹50,000 - ₹2L         Procurement Head signs alone
//   ₹2L - ₹10L            Finance In-Charge signs alone
//   ≥ ₹10L                Facility Director + CMS/GM co-approval
//
// Used by both:
//   - scm.purchaseOrders.approve (Phase 3.4 enforcement, was deferred from 1.6)
//   - scm.purchaseRequisitions.approve (Phase 3.2)
//
// Returns the ORDERED list of approver roles required for the amount.
// One-tier results have a single role; ≥₹10L returns two
// (Facility Director + CMS — but CMS is captured as a separate field
// `cms_gm_approved_by` on the purchase_orders row, not via
// indent_approvals chain).
// ============================================================

const PO_TIER_THRESHOLDS = {
  hod_max: 50_000,
  procurement_head_max: 200_000,
  finance_max: 1_000_000,
  // ≥ ₹10L → facility_director (with CMS/GM co-approval captured separately)
};

export function requiredApproversForPoAmount(amount: number): ApproverRole[] {
  if (!Number.isFinite(amount) || amount < 0) return ['procurement_head'];
  if (amount <= PO_TIER_THRESHOLDS.hod_max) return ['hod'];
  if (amount <= PO_TIER_THRESHOLDS.procurement_head_max) return ['procurement_head'];
  if (amount <= PO_TIER_THRESHOLDS.finance_max) return ['finance_in_charge'];
  return ['facility_director'];
}

/**
 * Convenience: map approver_role tier captured on a PO/PR row to whether
 * it satisfies the amount tier. Used by scm.purchaseOrders.approve to
 * enforce that the user holds the right tier.
 *
 *   amount = ₹40K, approver_role = 'hod' → ok
 *   amount = ₹40K, approver_role = 'procurement_head' → ok (higher tiers can sign for lower)
 *   amount = ₹3L, approver_role = 'hod' → false (under-tier)
 */
const TIER_RANK: Record<ApproverRole, number> = {
  hod: 1,
  non_med_head: 2,
  procurement_head: 2,
  finance_in_charge: 3,
  facility_director: 4,
};

export function approverTierSatisfiesAmount(args: {
  amount: number;
  approver_role: ApproverRole;
}): boolean {
  const required = requiredApproversForPoAmount(args.amount)[0];
  const requiredRank = TIER_RANK[required];
  const userRank = TIER_RANK[args.approver_role] ?? 0;
  return userRank >= requiredRank;
}

/**
 * Does the amount require CMS/GM co-approval per KPMG matrix (≥₹10L)?
 */
export function requiresCmsCoApproval(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 1_000_000;
}
