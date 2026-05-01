/**
 * Goods Receipt Note state machine — Phase 3 SCM Core PRD §11.
 *
 * 6 states + 7 allowed transitions:
 *
 *                       draft
 *                         ↓
 *               inspection_in_progress
 *                         ↓
 *                     submitted
 *                  ↙      ↓      ↘
 *           rejected  accepted  partially_accepted
 *
 * - rejected / accepted / partially_accepted are terminal
 *   (they trigger 3-way match against PO + invoice)
 * - draft → inspection_in_progress: KPMG 10-item inspection started
 * - inspection_in_progress → submitted: inspection complete
 * - submitted → accepted: all lines pass; full inventory write
 * - submitted → partially_accepted: some lines rejected; partial inventory write
 * - submitted → rejected: all lines rejected; no inventory write
 *
 * Pure-logic module.
 */

export type GrnState =
  | 'draft'
  | 'inspection_in_progress'
  | 'submitted'
  | 'accepted'
  | 'partially_accepted'
  | 'rejected';

export const GRN_STATES: GrnState[] = [
  'draft',
  'inspection_in_progress',
  'submitted',
  'accepted',
  'partially_accepted',
  'rejected',
];

export const ALLOWED_GRN_TRANSITIONS: Record<GrnState, GrnState[]> = {
  draft: ['inspection_in_progress'],
  inspection_in_progress: ['submitted'],
  submitted: ['accepted', 'partially_accepted', 'rejected'],
  accepted: [],
  partially_accepted: [],
  rejected: [],
};

export function isTerminalGrnState(state: GrnState): boolean {
  return ALLOWED_GRN_TRANSITIONS[state].length === 0;
}

export function canGrnTransition(from: GrnState, to: GrnState): boolean {
  return ALLOWED_GRN_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface GrnTransitionResult {
  ok: boolean;
  reason?: string;
}

export function validateGrnTransition(args: {
  from: GrnState;
  to: GrnState;
}): GrnTransitionResult {
  const { from, to } = args;
  if (!canGrnTransition(from, to)) {
    return { ok: false, reason: `Invalid transition: ${from} → ${to}` };
  }
  return { ok: true };
}

// ---------- KPMG 10-item inspection checklist helper ----------

export interface InspectionChecklist {
  visual_quantity_tally_pass: boolean;
  invoice_match_pass: boolean;
  damage_check_pass: boolean;
  po_invoice_receipt_pass: boolean;
  packaging_integrity_pass: boolean;
  mfr_brand_batch_expiry_markings_pass: boolean;
  shelf_life_180_days_pass: boolean;
  broken_bottles_pass: boolean;
  iv_fluid_fungus_pass: boolean;
  cold_chain_indicators_pass: boolean;
}

const CHECKLIST_ITEMS: Array<keyof InspectionChecklist> = [
  'visual_quantity_tally_pass',
  'invoice_match_pass',
  'damage_check_pass',
  'po_invoice_receipt_pass',
  'packaging_integrity_pass',
  'mfr_brand_batch_expiry_markings_pass',
  'shelf_life_180_days_pass',
  'broken_bottles_pass',
  'iv_fluid_fungus_pass',
  'cold_chain_indicators_pass',
];

export function allChecksPassed(checklist: InspectionChecklist): boolean {
  return CHECKLIST_ITEMS.every((k) => checklist[k] === true);
}

export function failedChecks(checklist: InspectionChecklist): string[] {
  return CHECKLIST_ITEMS.filter((k) => checklist[k] !== true);
}

export function checklistOverallPass(checklist: InspectionChecklist): boolean {
  return allChecksPassed(checklist);
}
