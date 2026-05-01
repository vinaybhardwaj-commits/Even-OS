/**
 * Tests for the PO tier helpers in kpmg-approval-matrix.ts (Phase 3 extension).
 */
import { describe, expect, it } from 'vitest';
import {
  requiredApproversForPoAmount,
  approverTierSatisfiesAmount,
  requiresCmsCoApproval,
} from './kpmg-approval-matrix';

describe('requiredApproversForPoAmount — KPMG matrix per PRD §10', () => {
  it('≤ ₹50K → HOD', () => {
    expect(requiredApproversForPoAmount(0)).toEqual(['hod']);
    expect(requiredApproversForPoAmount(25_000)).toEqual(['hod']);
    expect(requiredApproversForPoAmount(50_000)).toEqual(['hod']);
  });
  it('₹50K-₹2L → Procurement Head', () => {
    expect(requiredApproversForPoAmount(50_001)).toEqual(['procurement_head']);
    expect(requiredApproversForPoAmount(150_000)).toEqual(['procurement_head']);
    expect(requiredApproversForPoAmount(200_000)).toEqual(['procurement_head']);
  });
  it('₹2L-₹10L → Finance In-Charge', () => {
    expect(requiredApproversForPoAmount(200_001)).toEqual(['finance_in_charge']);
    expect(requiredApproversForPoAmount(500_000)).toEqual(['finance_in_charge']);
    expect(requiredApproversForPoAmount(1_000_000)).toEqual(['finance_in_charge']);
  });
  it('≥ ₹10L → Facility Director (CMS co-approval separate)', () => {
    expect(requiredApproversForPoAmount(1_000_001)).toEqual(['facility_director']);
    expect(requiredApproversForPoAmount(50_000_000)).toEqual(['facility_director']);
  });
  it('NaN/negative → defaults to procurement_head safe', () => {
    expect(requiredApproversForPoAmount(NaN)).toEqual(['procurement_head']);
    expect(requiredApproversForPoAmount(-1)).toEqual(['procurement_head']);
  });
});

describe('approverTierSatisfiesAmount — higher tiers can sign for lower', () => {
  it('hod can approve ≤₹50K', () => {
    expect(approverTierSatisfiesAmount({ amount: 50_000, approver_role: 'hod' })).toBe(true);
  });
  it('procurement_head can approve ₹50K + ₹50K-₹2L', () => {
    expect(approverTierSatisfiesAmount({ amount: 50_000, approver_role: 'procurement_head' })).toBe(true);
    expect(approverTierSatisfiesAmount({ amount: 150_000, approver_role: 'procurement_head' })).toBe(true);
  });
  it('hod cannot approve ₹3L (under-tier)', () => {
    expect(approverTierSatisfiesAmount({ amount: 300_000, approver_role: 'hod' })).toBe(false);
  });
  it('facility_director can approve any amount', () => {
    expect(approverTierSatisfiesAmount({ amount: 50_000, approver_role: 'facility_director' })).toBe(true);
    expect(approverTierSatisfiesAmount({ amount: 50_000_000, approver_role: 'facility_director' })).toBe(true);
  });
  it('finance_in_charge cannot approve ₹15L (under-tier)', () => {
    expect(approverTierSatisfiesAmount({ amount: 1_500_000, approver_role: 'finance_in_charge' })).toBe(false);
  });
});

describe('requiresCmsCoApproval', () => {
  it('false for amounts < ₹10L', () => {
    expect(requiresCmsCoApproval(900_000)).toBe(false);
    expect(requiresCmsCoApproval(0)).toBe(false);
  });
  it('true for amounts ≥ ₹10L', () => {
    expect(requiresCmsCoApproval(1_000_000)).toBe(true);
    expect(requiresCmsCoApproval(50_000_000)).toBe(true);
  });
});
