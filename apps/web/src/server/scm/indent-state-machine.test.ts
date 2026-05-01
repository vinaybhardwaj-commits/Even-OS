/**
 * Unit tests for SCM indent state machine + per-line validation.
 *
 * Phase 2.1. Pure logic; no DB.
 */
import { describe, expect, it } from 'vitest';
import {
  type IndentState,
  INDENT_STATES,
  ALLOWED_INDENT_TRANSITIONS,
  isTerminalIndentState,
  canIndentTransition,
  validateIndentTransition,
  validateLineApproval,
  validateLineIssue,
  validateLineAcknowledge,
} from './indent-state-machine';

describe('INDENT_STATES + ALLOWED_INDENT_TRANSITIONS shape', () => {
  it('contains exactly the 8 expected states', () => {
    expect(INDENT_STATES).toHaveLength(8);
    expect(new Set(INDENT_STATES)).toEqual(
      new Set(['pending', 'approved', 'issued', 'in_transit', 'received', 'closed', 'rejected', 'cancelled'])
    );
  });

  it('every state has an entry in transitions map', () => {
    for (const s of INDENT_STATES) {
      expect(ALLOWED_INDENT_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('all transition targets are valid states', () => {
    for (const from of INDENT_STATES) {
      for (const to of ALLOWED_INDENT_TRANSITIONS[from]) {
        expect(INDENT_STATES).toContain(to);
      }
    }
  });
});

describe('isTerminalIndentState', () => {
  it('rejected, cancelled, closed are terminal', () => {
    expect(isTerminalIndentState('rejected')).toBe(true);
    expect(isTerminalIndentState('cancelled')).toBe(true);
    expect(isTerminalIndentState('closed')).toBe(true);
  });

  it('pending, approved, issued, in_transit, received are NOT terminal', () => {
    expect(isTerminalIndentState('pending')).toBe(false);
    expect(isTerminalIndentState('approved')).toBe(false);
    expect(isTerminalIndentState('issued')).toBe(false);
    expect(isTerminalIndentState('in_transit')).toBe(false);
    expect(isTerminalIndentState('received')).toBe(false);
  });
});

describe('canIndentTransition — happy path', () => {
  it('pending → approved | rejected | cancelled', () => {
    expect(canIndentTransition('pending', 'approved')).toBe(true);
    expect(canIndentTransition('pending', 'rejected')).toBe(true);
    expect(canIndentTransition('pending', 'cancelled')).toBe(true);
  });

  it('approved → issued | cancelled', () => {
    expect(canIndentTransition('approved', 'issued')).toBe(true);
    expect(canIndentTransition('approved', 'cancelled')).toBe(true);
  });

  it('issued → in_transit', () => {
    expect(canIndentTransition('issued', 'in_transit')).toBe(true);
  });

  it('in_transit → received', () => {
    expect(canIndentTransition('in_transit', 'received')).toBe(true);
  });

  it('received → closed', () => {
    expect(canIndentTransition('received', 'closed')).toBe(true);
  });
});

describe('canIndentTransition — forbidden paths', () => {
  it('cannot skip approval', () => {
    expect(canIndentTransition('pending', 'issued')).toBe(false);
    expect(canIndentTransition('pending', 'received')).toBe(false);
  });

  it('cannot resurrect from terminal states', () => {
    expect(canIndentTransition('rejected', 'pending')).toBe(false);
    expect(canIndentTransition('rejected', 'approved')).toBe(false);
    expect(canIndentTransition('cancelled', 'approved')).toBe(false);
    expect(canIndentTransition('closed', 'received')).toBe(false);
    expect(canIndentTransition('closed', 'pending')).toBe(false);
  });

  it('cannot reject after approved (must cancel from approved)', () => {
    expect(canIndentTransition('approved', 'rejected')).toBe(false);
  });

  it('cannot cancel after issued (stock already moved)', () => {
    expect(canIndentTransition('issued', 'cancelled')).toBe(false);
    expect(canIndentTransition('in_transit', 'cancelled')).toBe(false);
    expect(canIndentTransition('received', 'cancelled')).toBe(false);
  });

  it('cannot un-issue', () => {
    expect(canIndentTransition('issued', 'approved')).toBe(false);
    expect(canIndentTransition('in_transit', 'issued')).toBe(false);
  });

  it('exhaustive 8×8 product matches the matrix', () => {
    let allowedCount = 0;
    for (const from of INDENT_STATES) {
      for (const to of INDENT_STATES) {
        const expected = ALLOWED_INDENT_TRANSITIONS[from].includes(to);
        expect(canIndentTransition(from, to)).toBe(expected);
        if (expected) allowedCount++;
      }
    }
    // pending(3) + approved(2) + issued(1) + in_transit(1) + received(1) = 8
    expect(allowedCount).toBe(8);
  });
});

describe('validateIndentTransition — context guards', () => {
  it('rejection requires reason', () => {
    expect(validateIndentTransition({ from: 'pending', to: 'rejected' }).ok).toBe(false);
    expect(validateIndentTransition({ from: 'pending', to: 'rejected', reason: '' }).ok).toBe(false);
    expect(validateIndentTransition({ from: 'pending', to: 'rejected', reason: '   ' }).ok).toBe(false);
    expect(validateIndentTransition({ from: 'pending', to: 'rejected', reason: 'duplicate request' }).ok).toBe(true);
  });

  it('cancellation requires cancellation_reason', () => {
    expect(validateIndentTransition({ from: 'pending', to: 'cancelled' }).ok).toBe(false);
    expect(validateIndentTransition({ from: 'pending', to: 'cancelled', cancellation_reason: 'no longer needed' }).ok).toBe(true);
    expect(validateIndentTransition({ from: 'approved', to: 'cancelled', cancellation_reason: 'patient discharged' }).ok).toBe(true);
  });

  it('happy path transitions need no extra context', () => {
    expect(validateIndentTransition({ from: 'pending', to: 'approved' }).ok).toBe(true);
    expect(validateIndentTransition({ from: 'approved', to: 'issued' }).ok).toBe(true);
    expect(validateIndentTransition({ from: 'issued', to: 'in_transit' }).ok).toBe(true);
    expect(validateIndentTransition({ from: 'in_transit', to: 'received' }).ok).toBe(true);
    expect(validateIndentTransition({ from: 'received', to: 'closed' }).ok).toBe(true);
  });

  it('error message contains both states for invalid transitions', () => {
    const result = validateIndentTransition({ from: 'pending', to: 'received' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('pending');
      expect(result.reason).toContain('received');
    }
  });
});

describe('validateLineApproval', () => {
  it('quantity_approved = quantity_requested → ok', () => {
    expect(validateLineApproval({ quantity_requested: 10, quantity_approved: 10 }).ok).toBe(true);
  });

  it('partial approval (less than requested) → ok', () => {
    expect(validateLineApproval({ quantity_requested: 10, quantity_approved: 5 }).ok).toBe(true);
  });

  it('zero approval (effectively excluding line) → ok', () => {
    expect(validateLineApproval({ quantity_requested: 10, quantity_approved: 0 }).ok).toBe(true);
  });

  it('over-approval → not ok', () => {
    const result = validateLineApproval({ quantity_requested: 10, quantity_approved: 15 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('cannot exceed');
    }
  });

  it('negative approval → not ok', () => {
    expect(validateLineApproval({ quantity_requested: 10, quantity_approved: -1 }).ok).toBe(false);
  });

  it('NaN approval → not ok', () => {
    expect(validateLineApproval({ quantity_requested: 10, quantity_approved: NaN }).ok).toBe(false);
  });
});

describe('validateLineIssue', () => {
  it('first issue partial of approved → ok', () => {
    expect(validateLineIssue({ quantity_approved: 10, quantity_already_issued: 0, quantity_to_issue: 5 }).ok).toBe(true);
  });

  it('full issue → ok', () => {
    expect(validateLineIssue({ quantity_approved: 10, quantity_already_issued: 0, quantity_to_issue: 10 }).ok).toBe(true);
  });

  it('cumulative ≤ approved across calls → ok', () => {
    expect(validateLineIssue({ quantity_approved: 10, quantity_already_issued: 5, quantity_to_issue: 5 }).ok).toBe(true);
  });

  it('cumulative > approved → not ok', () => {
    const result = validateLineIssue({ quantity_approved: 10, quantity_already_issued: 5, quantity_to_issue: 6 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('would exceed approved');
    }
  });

  it('zero or negative quantity → not ok', () => {
    expect(validateLineIssue({ quantity_approved: 10, quantity_already_issued: 0, quantity_to_issue: 0 }).ok).toBe(false);
    expect(validateLineIssue({ quantity_approved: 10, quantity_already_issued: 0, quantity_to_issue: -5 }).ok).toBe(false);
  });
});

describe('validateLineAcknowledge', () => {
  it('partial acknowledgement → ok', () => {
    expect(validateLineAcknowledge({ quantity_issued: 10, quantity_already_acknowledged: 0, quantity_to_acknowledge: 5 }).ok).toBe(true);
  });

  it('full acknowledgement → ok', () => {
    expect(validateLineAcknowledge({ quantity_issued: 10, quantity_already_acknowledged: 0, quantity_to_acknowledge: 10 }).ok).toBe(true);
  });

  it('cumulative > issued → not ok', () => {
    const result = validateLineAcknowledge({ quantity_issued: 10, quantity_already_acknowledged: 5, quantity_to_acknowledge: 6 });
    expect(result.ok).toBe(false);
  });

  it('zero acknowledgement → not ok', () => {
    expect(validateLineAcknowledge({ quantity_issued: 10, quantity_already_acknowledged: 0, quantity_to_acknowledge: 0 }).ok).toBe(false);
  });
});

describe('Phase 2 acceptance — full lifecycle', () => {
  it('happy path journey: pending → approved → issued → in_transit → received → closed', () => {
    const journey: Array<[IndentState, IndentState]> = [
      ['pending', 'approved'],
      ['approved', 'issued'],
      ['issued', 'in_transit'],
      ['in_transit', 'received'],
      ['received', 'closed'],
    ];
    for (const [from, to] of journey) {
      expect(validateIndentTransition({ from, to }).ok, `${from} → ${to} should be allowed`).toBe(true);
    }
  });

  it('rejection from pending → terminal', () => {
    expect(validateIndentTransition({ from: 'pending', to: 'rejected', reason: 'item not stocked' }).ok).toBe(true);
    expect(isTerminalIndentState('rejected')).toBe(true);
  });

  it('cancellation from approved (after sign-off, before issue) → terminal', () => {
    expect(validateIndentTransition({ from: 'approved', to: 'cancelled', cancellation_reason: 'patient transferred' }).ok).toBe(true);
    expect(isTerminalIndentState('cancelled')).toBe(true);
  });
});
