import { describe, expect, it } from 'vitest';
import {
  computeVariancePct,
  classifyVariance,
  performThreeWayMatch,
  paymentBlocked,
} from './three-way-match';

describe('computeVariancePct', () => {
  it('all equal → 0', () => {
    expect(computeVariancePct({ po_total: 1000, grn_value: 1000, invoice_value: 1000 })).toBe(0);
  });
  it('PO 1000, GRN 1010, invoice 1010 → 1%', () => {
    const v = computeVariancePct({ po_total: 1000, grn_value: 1010, invoice_value: 1010 });
    expect(v).toBeCloseTo(0.01, 5);
  });
  it('PO 1000, invoice 1100 → 10%', () => {
    const v = computeVariancePct({ po_total: 1000, grn_value: 1000, invoice_value: 1100 });
    expect(v).toBeCloseTo(0.10, 5);
  });
  it('po_total = 0 → returns 0 (skip)', () => {
    expect(computeVariancePct({ po_total: 0, grn_value: 100, invoice_value: 100 })).toBe(0);
  });
  it('symmetric: max-deviation across the 3', () => {
    const v = computeVariancePct({ po_total: 100, grn_value: 95, invoice_value: 110 });
    // dev3 = |110-95|/100 = 15% — that's the max
    expect(v).toBeCloseTo(0.15, 5);
  });
});

describe('classifyVariance — locked thresholds (B2)', () => {
  it('≤2% → auto_match', () => {
    expect(classifyVariance(0)).toBe('auto_match');
    expect(classifyVariance(0.01)).toBe('auto_match');
    expect(classifyVariance(0.02)).toBe('auto_match');
  });
  it('>2-10% → variance_flag', () => {
    expect(classifyVariance(0.021)).toBe('variance_flag');
    expect(classifyVariance(0.05)).toBe('variance_flag');
    expect(classifyVariance(0.10)).toBe('variance_flag');
  });
  it('>10% → variance_block', () => {
    expect(classifyVariance(0.101)).toBe('variance_block');
    expect(classifyVariance(0.50)).toBe('variance_block');
  });
});

describe('performThreeWayMatch', () => {
  it('matched when all equal', () => {
    const r = performThreeWayMatch({ po_total: 1000, grn_value: 1000, invoice_value: 1000 });
    expect(r.bucket).toBe('auto_match');
    expect(r.status).toBe('matched');
    expect(r.variance_amount).toBe(0);
  });
  it('flagged for 5% variance', () => {
    const r = performThreeWayMatch({ po_total: 1000, grn_value: 1000, invoice_value: 1050 });
    expect(r.bucket).toBe('variance_flag');
    expect(r.status).toBe('variance_flagged');
  });
  it('blocked for 15% variance (still flagged status until human review)', () => {
    const r = performThreeWayMatch({ po_total: 1000, grn_value: 1000, invoice_value: 1150 });
    expect(r.bucket).toBe('variance_block');
    expect(r.status).toBe('variance_flagged');
    expect(r.variance_amount).toBe(150);
  });
});

describe('paymentBlocked', () => {
  it('matched + bucket=auto_match → not blocked', () => {
    expect(paymentBlocked({ bucket: 'auto_match', status: 'matched' })).toBe(false);
  });
  it('flagged + bucket=variance_flag → blocked until variance_approved', () => {
    expect(paymentBlocked({ bucket: 'variance_flag', status: 'variance_flagged' })).toBe(true);
    expect(paymentBlocked({ bucket: 'variance_flag', status: 'variance_approved' })).toBe(false);
  });
  it('flagged + bucket=variance_block → blocked', () => {
    expect(paymentBlocked({ bucket: 'variance_block', status: 'variance_flagged' })).toBe(true);
  });
  it('variance_block + variance_approved → unblocked (FD/V signed off)', () => {
    expect(paymentBlocked({ bucket: 'variance_block', status: 'variance_approved' })).toBe(false);
  });
});
