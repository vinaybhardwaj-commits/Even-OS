/**
 * Unit tests for KPMG approval matrix (Phase 2 v1 simple).
 */
import { describe, expect, it } from 'vitest';
import {
  type MaterialClassification,
  MATERIAL_CLASSIFICATIONS,
  requiredApproversForClassification,
  resolveApproverChain,
  areAllApprovalsDone,
  hasRejection,
} from './kpmg-approval-matrix';

describe('MATERIAL_CLASSIFICATIONS', () => {
  it('has the 3 expected classifications matching schema seed', () => {
    expect(MATERIAL_CLASSIFICATIONS).toEqual(['standard', 'emergency', 'vital']);
  });
});

describe('requiredApproversForClassification — Phase 2 v1 (simple)', () => {
  it('standard → procurement_head only', () => {
    expect(requiredApproversForClassification('standard')).toEqual(['procurement_head']);
  });

  it('emergency → finance_in_charge only', () => {
    expect(requiredApproversForClassification('emergency')).toEqual(['finance_in_charge']);
  });

  it('vital → facility_director only (highest tier)', () => {
    expect(requiredApproversForClassification('vital')).toEqual(['facility_director']);
  });

  it('every classification returns at least one approver', () => {
    for (const c of MATERIAL_CLASSIFICATIONS) {
      expect(requiredApproversForClassification(c).length).toBeGreaterThan(0);
    }
  });
});

describe('resolveApproverChain', () => {
  it('null → defaults to standard', () => {
    expect(resolveApproverChain(null)).toEqual(['procurement_head']);
  });

  it('undefined → defaults to standard', () => {
    expect(resolveApproverChain(undefined)).toEqual(['procurement_head']);
  });

  it('vital → facility_director', () => {
    expect(resolveApproverChain('vital')).toEqual(['facility_director']);
  });
});

describe('areAllApprovalsDone', () => {
  it('empty approvals + 0 required → true (vacuous)', () => {
    expect(areAllApprovalsDone([], 0)).toBe(true);
  });

  it('one approval done + one required → true', () => {
    expect(areAllApprovalsDone([{ decision: 'approved' }], 1)).toBe(true);
  });

  it('one approval pending + one required → false', () => {
    expect(areAllApprovalsDone([{ decision: null }], 1)).toBe(false);
  });

  it('mixed approved + pending → false until pending decided', () => {
    expect(areAllApprovalsDone([{ decision: 'approved' }, { decision: null }], 2)).toBe(false);
  });

  it('all 4 tiers approved + 4 required → true (Phase 9 KPMG full chain)', () => {
    const approvals = [
      { decision: 'approved' },
      { decision: 'approved' },
      { decision: 'approved' },
      { decision: 'approved' },
    ];
    expect(areAllApprovalsDone(approvals, 4)).toBe(true);
  });

  it('rejection counts as NOT approved', () => {
    expect(areAllApprovalsDone([{ decision: 'rejected' }], 1)).toBe(false);
  });
});

describe('hasRejection', () => {
  it('no decisions → false', () => {
    expect(hasRejection([])).toBe(false);
  });

  it('only approvals → false', () => {
    expect(hasRejection([{ decision: 'approved' }, { decision: 'approved' }])).toBe(false);
  });

  it('any rejection → true (whole-indent rejection model)', () => {
    expect(hasRejection([{ decision: 'approved' }, { decision: 'rejected' }])).toBe(true);
    expect(hasRejection([{ decision: 'rejected' }])).toBe(true);
  });

  it('pending rows do not count as rejections', () => {
    expect(hasRejection([{ decision: null }, { decision: null }])).toBe(false);
  });
});
