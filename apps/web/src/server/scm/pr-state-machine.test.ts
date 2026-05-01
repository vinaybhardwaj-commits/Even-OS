import { describe, expect, it } from 'vitest';
import {
  PR_STATES,
  ALLOWED_PR_TRANSITIONS,
  isTerminalPrState,
  canPrTransition,
  validatePrTransition,
} from './pr-state-machine';

describe('PR state machine shape', () => {
  it('has 6 states', () => {
    expect(PR_STATES).toHaveLength(6);
    expect(new Set(PR_STATES)).toEqual(new Set(['draft', 'submitted', 'pr_approved', 'pr_rejected', 'pr_converted_to_po', 'cancelled']));
  });
  it('all targets are valid states', () => {
    for (const f of PR_STATES) for (const t of ALLOWED_PR_TRANSITIONS[f]) expect(PR_STATES).toContain(t);
  });
});

describe('isTerminalPrState', () => {
  it('terminal: pr_rejected, pr_converted_to_po, cancelled', () => {
    expect(isTerminalPrState('pr_rejected')).toBe(true);
    expect(isTerminalPrState('pr_converted_to_po')).toBe(true);
    expect(isTerminalPrState('cancelled')).toBe(true);
  });
  it('non-terminal: draft, submitted, pr_approved', () => {
    expect(isTerminalPrState('draft')).toBe(false);
    expect(isTerminalPrState('submitted')).toBe(false);
    expect(isTerminalPrState('pr_approved')).toBe(false);
  });
});

describe('canPrTransition — happy paths', () => {
  it('draft → submitted, draft → cancelled', () => {
    expect(canPrTransition('draft', 'submitted')).toBe(true);
    expect(canPrTransition('draft', 'cancelled')).toBe(true);
  });
  it('submitted → pr_approved | pr_rejected | cancelled', () => {
    expect(canPrTransition('submitted', 'pr_approved')).toBe(true);
    expect(canPrTransition('submitted', 'pr_rejected')).toBe(true);
    expect(canPrTransition('submitted', 'cancelled')).toBe(true);
  });
  it('pr_approved → pr_converted_to_po | cancelled', () => {
    expect(canPrTransition('pr_approved', 'pr_converted_to_po')).toBe(true);
    expect(canPrTransition('pr_approved', 'cancelled')).toBe(true);
  });
});

describe('canPrTransition — forbidden paths', () => {
  it('cannot skip submission', () => {
    expect(canPrTransition('draft', 'pr_approved')).toBe(false);
    expect(canPrTransition('draft', 'pr_converted_to_po')).toBe(false);
  });
  it('cannot resurrect from terminal', () => {
    expect(canPrTransition('pr_rejected', 'pr_approved')).toBe(false);
    expect(canPrTransition('cancelled', 'pr_approved')).toBe(false);
    expect(canPrTransition('pr_converted_to_po', 'pr_approved')).toBe(false);
  });
  it('cannot reject after approve (cancel only)', () => {
    expect(canPrTransition('pr_approved', 'pr_rejected')).toBe(false);
  });
  it('exhaustive 6×6 matches matrix', () => {
    let count = 0;
    for (const f of PR_STATES) for (const t of PR_STATES) {
      const expected = ALLOWED_PR_TRANSITIONS[f].includes(t);
      expect(canPrTransition(f, t)).toBe(expected);
      if (expected) count++;
    }
    expect(count).toBe(7); // 2+3+2+0+0+0
  });
});

describe('validatePrTransition guards', () => {
  it('rejection requires reason', () => {
    expect(validatePrTransition({ from: 'submitted', to: 'pr_rejected' }).ok).toBe(false);
    expect(validatePrTransition({ from: 'submitted', to: 'pr_rejected', rejection_reason: 'budget cut' }).ok).toBe(true);
  });
  it('cancellation requires reason', () => {
    expect(validatePrTransition({ from: 'draft', to: 'cancelled' }).ok).toBe(false);
    expect(validatePrTransition({ from: 'draft', to: 'cancelled', cancellation_reason: 'duplicate' }).ok).toBe(true);
  });
  it('happy paths need no extras', () => {
    expect(validatePrTransition({ from: 'draft', to: 'submitted' }).ok).toBe(true);
    expect(validatePrTransition({ from: 'submitted', to: 'pr_approved' }).ok).toBe(true);
    expect(validatePrTransition({ from: 'pr_approved', to: 'pr_converted_to_po' }).ok).toBe(true);
  });
});
