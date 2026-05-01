/**
 * Unit tests for the SCM item lifecycle state machine.
 *
 * Phase 1.7. Covers Codes Q3 5-state machine + Q12 deprecation contract.
 *
 * No DB needed.
 */
import { describe, expect, it } from 'vitest';
import {
  type ItemStatus,
  ITEM_STATUSES,
  ALLOWED_ITEM_TRANSITIONS,
  isTerminalStatus,
  canTransition,
  validateItemTransition,
} from './item-lifecycle';

describe('ITEM_STATUSES + ALLOWED_ITEM_TRANSITIONS shape', () => {
  it('ITEM_STATUSES contains exactly the 8 expected states', () => {
    expect(ITEM_STATUSES).toHaveLength(8);
    expect(new Set(ITEM_STATUSES)).toEqual(
      new Set([
        'pending_clinical_review',
        'pending_master_data_review',
        'pending_cms_gm_review',
        'active',
        'deprecated_grace',
        'deprecated',
        'archived',
        'rejected',
      ])
    );
  });

  it('ALLOWED_ITEM_TRANSITIONS has an entry for every status', () => {
    for (const s of ITEM_STATUSES) {
      expect(ALLOWED_ITEM_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('all transition targets are valid statuses', () => {
    for (const from of ITEM_STATUSES) {
      for (const to of ALLOWED_ITEM_TRANSITIONS[from]) {
        expect(ITEM_STATUSES).toContain(to);
      }
    }
  });
});

describe('isTerminalStatus', () => {
  it('archived is terminal', () => {
    expect(isTerminalStatus('archived')).toBe(true);
  });

  it('rejected is terminal', () => {
    expect(isTerminalStatus('rejected')).toBe(true);
  });

  it('active is NOT terminal (can deprecate)', () => {
    expect(isTerminalStatus('active')).toBe(false);
  });

  it('intermediate statuses are NOT terminal', () => {
    expect(isTerminalStatus('pending_clinical_review')).toBe(false);
    expect(isTerminalStatus('pending_master_data_review')).toBe(false);
    expect(isTerminalStatus('pending_cms_gm_review')).toBe(false);
    expect(isTerminalStatus('deprecated_grace')).toBe(false);
    expect(isTerminalStatus('deprecated')).toBe(false);
  });
});

describe('canTransition — Codes Q3 5-state machine', () => {
  it('approval chain: pending_clinical_review → pending_master_data_review → pending_cms_gm_review → active', () => {
    expect(canTransition('pending_clinical_review', 'pending_master_data_review')).toBe(true);
    expect(canTransition('pending_master_data_review', 'pending_cms_gm_review')).toBe(true);
    expect(canTransition('pending_cms_gm_review', 'active')).toBe(true);
  });

  it('rejection allowed at every pending step', () => {
    expect(canTransition('pending_clinical_review', 'rejected')).toBe(true);
    expect(canTransition('pending_master_data_review', 'rejected')).toBe(true);
    expect(canTransition('pending_cms_gm_review', 'rejected')).toBe(true);
  });

  it('deprecation chain: active → deprecated_grace → deprecated → archived', () => {
    expect(canTransition('active', 'deprecated_grace')).toBe(true);
    expect(canTransition('deprecated_grace', 'deprecated')).toBe(true);
    expect(canTransition('deprecated', 'archived')).toBe(true);
  });

  it('cannot skip approval steps (no shortcut to active)', () => {
    expect(canTransition('pending_clinical_review', 'active')).toBe(false);
    expect(canTransition('pending_clinical_review', 'pending_cms_gm_review')).toBe(false);
    expect(canTransition('pending_master_data_review', 'active')).toBe(false);
  });

  it('cannot resurrect from terminal states', () => {
    expect(canTransition('archived', 'active')).toBe(false);
    expect(canTransition('archived', 'deprecated_grace')).toBe(false);
    expect(canTransition('rejected', 'pending_clinical_review')).toBe(false);
    expect(canTransition('rejected', 'active')).toBe(false);
  });

  it('cannot deprecate from a non-active state', () => {
    expect(canTransition('pending_clinical_review', 'deprecated_grace')).toBe(false);
    expect(canTransition('pending_master_data_review', 'deprecated_grace')).toBe(false);
    expect(canTransition('pending_cms_gm_review', 'deprecated_grace')).toBe(false);
  });

  it('cannot reject after active (must go through deprecation)', () => {
    expect(canTransition('active', 'rejected')).toBe(false);
  });

  it('exhaustive 8×8 product: only documented transitions allowed', () => {
    let allowedCount = 0;
    for (const from of ITEM_STATUSES) {
      for (const to of ITEM_STATUSES) {
        const expected = ALLOWED_ITEM_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(expected);
        if (expected) allowedCount++;
      }
    }
    // 2 + 2 + 2 + 1 + 1 + 1 + 0 + 0 = 9 allowed transitions in the matrix
    expect(allowedCount).toBe(9);
  });
});

describe('validateItemTransition — Codes Q12 deprecation gates', () => {
  it('valid transition returns ok:true', () => {
    const result = validateItemTransition({
      from: 'pending_clinical_review',
      to: 'pending_master_data_review',
    });
    expect(result.ok).toBe(true);
  });

  it('invalid transition returns ok:false with a descriptive reason', () => {
    const result = validateItemTransition({
      from: 'pending_clinical_review',
      to: 'active',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Invalid transition');
      expect(result.reason).toContain('pending_clinical_review');
      expect(result.reason).toContain('active');
    }
  });

  it('deprecation requires reason', () => {
    const result = validateItemTransition({
      from: 'active',
      to: 'deprecated_grace',
      urgency_tier: 'routine',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('reason');
    }
  });

  it('deprecation requires reason (whitespace-only is rejected)', () => {
    const result = validateItemTransition({
      from: 'active',
      to: 'deprecated_grace',
      reason: '   ',
      urgency_tier: 'routine',
    });
    expect(result.ok).toBe(false);
  });

  it('deprecation requires urgency_tier', () => {
    const result = validateItemTransition({
      from: 'active',
      to: 'deprecated_grace',
      reason: 'phasing out branded variant',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('urgency_tier');
    }
  });

  it('deprecation succeeds with both reason + urgency_tier', () => {
    expect(
      validateItemTransition({
        from: 'active',
        to: 'deprecated_grace',
        reason: 'phasing out branded variant',
        urgency_tier: 'routine',
      }).ok
    ).toBe(true);

    expect(
      validateItemTransition({
        from: 'active',
        to: 'deprecated_grace',
        reason: 'manufacturer recall',
        urgency_tier: 'urgent',
      }).ok
    ).toBe(true);

    expect(
      validateItemTransition({
        from: 'active',
        to: 'deprecated_grace',
        reason: 'patient safety hazard',
        urgency_tier: 'emergency',
      }).ok
    ).toBe(true);
  });

  it('non-deprecation transitions do NOT need reason / urgency_tier', () => {
    expect(
      validateItemTransition({
        from: 'pending_cms_gm_review',
        to: 'active',
      }).ok
    ).toBe(true);
    expect(
      validateItemTransition({
        from: 'deprecated',
        to: 'archived',
      }).ok
    ).toBe(true);
    expect(
      validateItemTransition({
        from: 'pending_clinical_review',
        to: 'rejected',
      }).ok
    ).toBe(true);
  });
});

describe('Phase 1.7 acceptance — full lifecycle journeys', () => {
  it('happy path: new item drug → review chain → active → deprecate → archive', () => {
    // The journey of a typical drug from creation to archival
    const journey: Array<[ItemStatus, ItemStatus]> = [
      ['pending_master_data_review', 'pending_cms_gm_review'],
      ['pending_cms_gm_review', 'active'],
      ['active', 'deprecated_grace'],
      ['deprecated_grace', 'deprecated'],
      ['deprecated', 'archived'],
    ];
    for (const [from, to] of journey) {
      const ok = validateItemTransition({
        from,
        to,
        reason: to === 'deprecated_grace' ? 'phase out' : undefined,
        urgency_tier: to === 'deprecated_grace' ? 'routine' : undefined,
      }).ok;
      expect(ok, `transition ${from} → ${to} should be allowed`).toBe(true);
    }
  });

  it('clinician-rejection path: pending_clinical_review → rejected (terminal)', () => {
    expect(canTransition('pending_clinical_review', 'rejected')).toBe(true);
    expect(isTerminalStatus('rejected')).toBe(true);
  });

  it('emergency deprecation: active → deprecated_grace with urgency=emergency', () => {
    const ok = validateItemTransition({
      from: 'active',
      to: 'deprecated_grace',
      reason: 'critical safety issue',
      urgency_tier: 'emergency',
    }).ok;
    expect(ok).toBe(true);
  });
});
