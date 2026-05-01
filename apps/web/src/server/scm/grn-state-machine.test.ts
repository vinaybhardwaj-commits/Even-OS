import { describe, expect, it } from 'vitest';
import {
  GRN_STATES,
  ALLOWED_GRN_TRANSITIONS,
  isTerminalGrnState,
  canGrnTransition,
  validateGrnTransition,
  type InspectionChecklist,
  allChecksPassed,
  failedChecks,
  checklistOverallPass,
} from './grn-state-machine';

describe('GRN state machine shape', () => {
  it('has 6 states', () => {
    expect(GRN_STATES).toHaveLength(6);
  });
});

describe('GRN transitions', () => {
  it('happy path: draft → inspection_in_progress → submitted → accepted', () => {
    expect(canGrnTransition('draft', 'inspection_in_progress')).toBe(true);
    expect(canGrnTransition('inspection_in_progress', 'submitted')).toBe(true);
    expect(canGrnTransition('submitted', 'accepted')).toBe(true);
    expect(canGrnTransition('submitted', 'partially_accepted')).toBe(true);
    expect(canGrnTransition('submitted', 'rejected')).toBe(true);
  });
  it('terminal states have no outgoing transitions', () => {
    for (const t of ['accepted', 'partially_accepted', 'rejected'] as const) {
      expect(isTerminalGrnState(t)).toBe(true);
    }
  });
  it('cannot skip inspection', () => {
    expect(canGrnTransition('draft', 'submitted')).toBe(false);
    expect(canGrnTransition('draft', 'accepted')).toBe(false);
  });
  it('exhaustive 6×6 matches matrix', () => {
    let count = 0;
    for (const f of GRN_STATES) for (const t of GRN_STATES) {
      const expected = ALLOWED_GRN_TRANSITIONS[f].includes(t);
      expect(canGrnTransition(f, t)).toBe(expected);
      if (expected) count++;
    }
    expect(count).toBe(5); // 1+1+3+0+0+0
  });
});

describe('KPMG 10-item inspection checklist', () => {
  const allTrue: InspectionChecklist = {
    visual_quantity_tally_pass: true,
    invoice_match_pass: true,
    damage_check_pass: true,
    po_invoice_receipt_pass: true,
    packaging_integrity_pass: true,
    mfr_brand_batch_expiry_markings_pass: true,
    shelf_life_180_days_pass: true,
    broken_bottles_pass: true,
    iv_fluid_fungus_pass: true,
    cold_chain_indicators_pass: true,
  };
  const oneFail: InspectionChecklist = { ...allTrue, shelf_life_180_days_pass: false };

  it('allChecksPassed true when every item is true', () => {
    expect(allChecksPassed(allTrue)).toBe(true);
  });
  it('allChecksPassed false when any item fails', () => {
    expect(allChecksPassed(oneFail)).toBe(false);
  });
  it('failedChecks returns the failing item names', () => {
    expect(failedChecks(oneFail)).toEqual(['shelf_life_180_days_pass']);
  });
  it('checklistOverallPass mirrors allChecksPassed', () => {
    expect(checklistOverallPass(allTrue)).toBe(true);
    expect(checklistOverallPass(oneFail)).toBe(false);
  });
});
