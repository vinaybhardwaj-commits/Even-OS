/**
 * 3-way match logic — Phase 3 SCM Core PRD §11.
 *
 * Compares PO total ≈ GRN value ≈ vendor invoice value. Computes variance
 * percentage and buckets the result per V's lock (B2):
 *
 *   ≤ 2%     auto_match     → no review needed
 *   > 2-10%  variance_flag  → flag for variance approval (Finance In-Charge)
 *   > 10%    variance_block → block payment until V/Finance Director signs off
 *
 * Pure-logic module. Variance is symmetric — uses largest absolute deviation
 * across the 3 numbers as the basis.
 */

export type ThreeWayMatchStatus =
  | 'pending'
  | 'matched'
  | 'variance_flagged'
  | 'variance_approved'
  | 'variance_rejected';

/** Variance bucket per the auto-pass band rule. */
export type VarianceBucket = 'auto_match' | 'variance_flag' | 'variance_block';

const VARIANCE_AUTO_PCT = 0.02;   // ≤2% auto-match
const VARIANCE_BLOCK_PCT = 0.10;  // >10% blocks payment

/**
 * Compute the variance percentage as the max-deviation among (PO, GRN, invoice)
 * normalized by the PO total (the "expected" amount).
 *
 * Returns 0 if PO total is 0 or NaN; consumer treats that as "skip match".
 */
export function computeVariancePct(args: {
  po_total: number;
  grn_value: number;
  invoice_value: number;
}): number {
  const { po_total, grn_value, invoice_value } = args;
  if (!Number.isFinite(po_total) || po_total <= 0) return 0;
  const dev1 = Math.abs(grn_value - po_total) / po_total;
  const dev2 = Math.abs(invoice_value - po_total) / po_total;
  const dev3 = Math.abs(invoice_value - grn_value) / po_total;
  return Math.max(dev1, dev2, dev3);
}

/**
 * Classify a variance pct into a bucket per the locked thresholds.
 */
export function classifyVariance(variancePct: number): VarianceBucket {
  if (variancePct <= VARIANCE_AUTO_PCT) return 'auto_match';
  if (variancePct <= VARIANCE_BLOCK_PCT) return 'variance_flag';
  return 'variance_block';
}

/**
 * Compose: compute the 3-way match result given PO + GRN + invoice values.
 */
export interface ThreeWayMatchResult {
  variance_pct: number;
  variance_amount: number;
  bucket: VarianceBucket;
  status: ThreeWayMatchStatus;
}

export function performThreeWayMatch(args: {
  po_total: number;
  grn_value: number;
  invoice_value: number;
}): ThreeWayMatchResult {
  const variancePct = computeVariancePct(args);
  const bucket = classifyVariance(variancePct);

  // Variance amount = max abs deviation of (GRN vs invoice) — the relevant
  // discrepancy for accounts payable
  const varianceAmount = Math.abs(args.invoice_value - args.grn_value);

  let status: ThreeWayMatchStatus;
  if (bucket === 'auto_match') status = 'matched';
  else status = 'variance_flagged';
  // 'variance_approved' / 'variance_rejected' are downstream after human review;
  // 'variance_block' bucket also produces 'variance_flagged' here but UI gates
  // payment until variance_approved.

  return {
    variance_pct: variancePct,
    variance_amount: varianceAmount,
    bucket,
    status,
  };
}

/**
 * Block payment? Returns true if the bucket is variance_block (>10% deviation).
 * Even if status is 'variance_approved', the block-bucket needs a Facility
 * Director / V sign-off explicitly.
 */
export function paymentBlocked(args: {
  bucket: VarianceBucket;
  status: ThreeWayMatchStatus;
}): boolean {
  if (args.status === 'variance_approved') return false;
  if (args.bucket === 'variance_block' && args.status !== 'variance_approved') return true;
  if (args.bucket === 'variance_flag' && args.status !== 'variance_approved') return true;
  return false;
}
