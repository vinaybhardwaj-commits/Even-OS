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
