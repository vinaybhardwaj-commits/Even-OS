import { describe, expect, it } from 'vitest';
import {
  findTransition,
  denialReason,
  assertCanTransition,
  concessionApprovalLevel,
  BILL_TRANSITIONS,
} from './bill-state-machine';

describe('findTransition', () => {
  it('finds send_for_review from draft', () => {
    const r = findTransition('send_for_review', 'draft');
    expect(r.to).toBe('pending_review');
  });
  it('finds finalize from pending_review', () => {
    const r = findTransition('finalize', 'pending_review');
    expect(r.to).toBe('finalized');
  });
  it('finds settle_payment from finalized', () => {
    const r = findTransition('settle_payment', 'finalized');
    expect(r.to).toBe('settled');
  });
  it('throws on invalid transition', () => {
    expect(() => findTransition('finalize', 'draft')).toThrow();
    expect(() => findTransition('archive', 'draft')).toThrow();
  });
});

describe('denialReason RBAC', () => {
  it('super_admin bypass', () => {
    const r = findTransition('finalize', 'pending_review');
    expect(denialReason(r, 'super_admin')).toBeNull();
  });
  it('hospital_admin bypass', () => {
    const r = findTransition('finalize', 'pending_review');
    expect(denialReason(r, 'hospital_admin')).toBeNull();
  });
  it('billing_manager allowed for finalize', () => {
    const r = findTransition('finalize', 'pending_review');
    expect(denialReason(r, 'billing_manager')).toBeNull();
  });
  it('cashier denied for finalize', () => {
    const r = findTransition('finalize', 'pending_review');
    expect(denialReason(r, 'cashier')).toMatch(/not in allowed list/);
  });
  it('archive system-only — only super_admin allowed', () => {
    const r = findTransition('archive', 'closed');
    expect(denialReason(r, 'super_admin')).toBeNull();
    expect(denialReason(r, 'hospital_admin')).toBeNull();
    expect(denialReason(r, 'billing_manager')).toMatch(/super_admin/);
  });
});

describe('assertCanTransition reason enforcement', () => {
  it('reverse requires reason', () => {
    expect(() => assertCanTransition({
      action: 'reverse', fromState: 'finalized', callerSystemRole: 'gm', reason: '',
    })).toThrow(/requires reason/);
  });
  it('reverse with reason succeeds', () => {
    const r = assertCanTransition({
      action: 'reverse', fromState: 'finalized', callerSystemRole: 'gm', reason: 'duplicate post',
    });
    expect(r.action).toBe('reverse');
  });
  it('finalize does not require reason', () => {
    const r = assertCanTransition({
      action: 'finalize', fromState: 'pending_review', callerSystemRole: 'gm',
    });
    expect(r.action).toBe('finalize');
  });
});

describe('concessionApprovalLevel (Q8 thresholds)', () => {
  it('returns self when concession <= self_limit', () => {
    expect(concessionApprovalLevel({
      concession_amount: 100, bill_total_before_concession: 5000,
      self_limit_percent: 5, gm_limit_percent: 20,
    })).toBe('self');
  });
  it('returns gm when self < concession <= gm_limit', () => {
    expect(concessionApprovalLevel({
      concession_amount: 750, bill_total_before_concession: 5000,
      self_limit_percent: 5, gm_limit_percent: 20,
    })).toBe('gm');
  });
  it('returns cfo when concession > gm_limit', () => {
    expect(concessionApprovalLevel({
      concession_amount: 1500, bill_total_before_concession: 5000,
      self_limit_percent: 5, gm_limit_percent: 20,
    })).toBe('cfo');
  });
  it('boundary: exactly self_limit_percent → self', () => {
    expect(concessionApprovalLevel({
      concession_amount: 250, bill_total_before_concession: 5000,
      self_limit_percent: 5, gm_limit_percent: 20,
    })).toBe('self');
  });
  it('boundary: exactly gm_limit_percent → gm', () => {
    expect(concessionApprovalLevel({
      concession_amount: 1000, bill_total_before_concession: 5000,
      self_limit_percent: 5, gm_limit_percent: 20,
    })).toBe('gm');
  });
});

describe('BILL_TRANSITIONS shape', () => {
  it('exposes the 6 standard state transitions + amendment branch', () => {
    const actions = BILL_TRANSITIONS.map((t) => t.action);
    expect(actions).toContain('create');
    expect(actions).toContain('send_for_review');
    expect(actions).toContain('finalize');
    expect(actions).toContain('settle_payment');
    expect(actions).toContain('close');
    expect(actions).toContain('archive');
    expect(actions).toContain('reverse');
    expect(actions).toContain('reissue');
  });
});
