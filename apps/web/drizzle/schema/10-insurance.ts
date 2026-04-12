import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';
import { billingAccounts } from './09-billing';

// ============================================================
// ENUMS — Insurance & TPA Claims (Module 11b)
// ============================================================

export const insuranceClaimStatusEnum = pgEnum('insurance_claim_status', [
  'draft', 'pre_auth_pending', 'pre_auth_approved', 'pre_auth_rejected',
  'admitted', 'enhancement_pending', 'enhancement_approved', 'enhancement_rejected',
  'discharge_pending', 'query_raised', 'under_review', 'approved',
  'partially_approved', 'rejected', 'settled', 'closed',
]);

export const insuranceClaimEventTypeEnum = pgEnum('insurance_claim_event_type', [
  'created', 'pre_auth_submitted', 'pre_auth_approved', 'pre_auth_rejected',
  'enhancement_submitted', 'enhancement_approved', 'enhancement_rejected',
  'discharge_submitted', 'query_raised', 'query_responded',
  'under_review', 'approved', 'partially_approved', 'rejected',
  'deduction_applied', 'settled', 'closed', 'escalated', 'note_added',
]);

export const preAuthRequestStatusEnum = pgEnum('pre_auth_request_status', [
  'draft', 'submitted', 'approved', 'rejected', 'expired', 'cancelled',
]);

export const enhancementRequestStatusEnum = pgEnum('enhancement_request_status', [
  'draft', 'submitted', 'approved', 'partially_approved', 'rejected',
]);

export const deductionCategoryEnum = pgEnum('deduction_category', [
  'non_payable', 'proportional_deduction', 'co_pay', 'sub_limit_excess',
  'room_rent_excess', 'policy_exclusion', 'waiting_period', 'other',
]);

export const tpaEnum = pgEnum('tpa_name_enum', [
  'medi_assist', 'paramount', 'vidal', 'heritage', 'raksha',
  'md_india', 'good_health', 'ericson', 'safeway', 'other',
]);

// ============================================================
// INSURANCE CLAIMS (master claim record per admission)
// ============================================================

export const insuranceClaims = pgTable('insurance_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('ic_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('ic_encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  account_id: uuid('ic_account_id').references(() => billingAccounts.id, { onDelete: 'set null' }),

  // Claim identifiers
  claim_number: varchar('claim_number', { length: 50 }),
  tpa_claim_ref: varchar('tpa_claim_ref', { length: 100 }),

  // Insurance details (snapshot at claim creation)
  insurer_name: text('ic_insurer_name').notNull(),
  tpa: tpaEnum('ic_tpa'),
  policy_number: varchar('ic_policy_number', { length: 100 }),
  member_id: varchar('ic_member_id', { length: 100 }),
  sum_insured: numeric('ic_sum_insured', { precision: 14, scale: 2 }),
  room_rent_eligibility: numeric('ic_room_rent_elig', { precision: 12, scale: 2 }),
  co_pay_percent: numeric('ic_co_pay_pct', { precision: 5, scale: 2 }).default('0'),

  // Status
  status: insuranceClaimStatusEnum('ic_status').default('draft').notNull(),

  // Amounts
  total_bill_amount: numeric('total_bill_amount', { precision: 14, scale: 2 }).default('0'),
  pre_auth_amount: numeric('ic_pre_auth_amount', { precision: 14, scale: 2 }).default('0'),
  enhancement_total: numeric('enhancement_total', { precision: 14, scale: 2 }).default('0'),
  approved_amount: numeric('ic_approved_amount', { precision: 14, scale: 2 }).default('0'),
  total_deductions: numeric('ic_total_deductions', { precision: 14, scale: 2 }).default('0'),
  settled_amount: numeric('settled_amount', { precision: 14, scale: 2 }).default('0'),
  patient_liability: numeric('patient_liability', { precision: 14, scale: 2 }).default('0'),

  // Diagnosis & procedure (for TPA submission)
  primary_diagnosis: text('primary_diagnosis'),
  icd_code: varchar('ic_icd_code', { length: 20 }),
  procedure_name: text('ic_procedure_name'),
  procedure_code: varchar('ic_procedure_code', { length: 20 }),

  // Dates
  admission_date: timestamp('ic_admission_date'),
  discharge_date: timestamp('ic_discharge_date'),
  submitted_at: timestamp('ic_submitted_at'),
  settled_at: timestamp('ic_settled_at'),

  // Metadata
  assigned_to: uuid('ic_assigned_to').references(() => users.id, { onDelete: 'set null' }),
  priority: varchar('ic_priority', { length: 10 }).default('normal'),  // low, normal, high, urgent
  notes: text('ic_notes'),

  created_by: uuid('ic_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('ic_created_at').defaultNow().notNull(),
  updated_at: timestamp('ic_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_ic_patient').on(t.patient_id),
  hospitalIdx: index('idx_ic_hospital').on(t.hospital_id),
  encounterIdx: index('idx_ic_encounter').on(t.encounter_id),
  statusIdx: index('idx_ic_status').on(t.status),
  claimNumberIdx: uniqueIndex('idx_ic_claim_number').on(t.hospital_id, t.claim_number),
  tpaIdx: index('idx_ic_tpa').on(t.tpa),
  assignedIdx: index('idx_ic_assigned').on(t.assigned_to),
}));

// ============================================================
// CLAIM EVENTS (audit trail / timeline for each claim)
// ============================================================

export const claimEvents = pgTable('claim_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  claim_id: uuid('ce_claim_id').notNull().references(() => insuranceClaims.id, { onDelete: 'cascade' }),

  event_type: insuranceClaimEventTypeEnum('ce_event_type').notNull(),
  from_status: insuranceClaimStatusEnum('ce_from_status'),
  to_status: insuranceClaimStatusEnum('ce_to_status'),

  amount: numeric('ce_amount', { precision: 14, scale: 2 }),
  description: text('ce_description'),
  metadata: jsonb('ce_metadata'),

  performed_by: uuid('ce_performed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  performed_at: timestamp('ce_performed_at').defaultNow().notNull(),
}, (t) => ({
  claimIdx: index('idx_ce_claim').on(t.claim_id),
  hospitalIdx: index('idx_ce_hospital').on(t.hospital_id),
  eventTypeIdx: index('idx_ce_type').on(t.event_type),
  performedAtIdx: index('idx_ce_performed_at').on(t.performed_at),
}));

// ============================================================
// PRE-AUTH REQUESTS
// ============================================================

export const preAuthRequests = pgTable('pre_auth_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  claim_id: uuid('par_claim_id').notNull().references(() => insuranceClaims.id, { onDelete: 'cascade' }),

  status: preAuthRequestStatusEnum('par_status').default('draft').notNull(),

  requested_amount: numeric('par_requested_amount', { precision: 14, scale: 2 }).notNull(),
  approved_amount: numeric('par_approved_amount', { precision: 14, scale: 2 }),

  // Clinical justification
  diagnosis: text('par_diagnosis'),
  proposed_treatment: text('par_proposed_treatment'),
  expected_los_days: integer('expected_los_days'),
  estimated_cost: numeric('par_estimated_cost', { precision: 14, scale: 2 }),
  room_type_requested: varchar('room_type_requested', { length: 50 }),

  // TPA response
  tpa_auth_number: varchar('tpa_auth_number', { length: 100 }),
  rejection_reason: text('par_rejection_reason'),
  conditions: text('par_conditions'),  // conditions attached to approval

  submitted_at: timestamp('par_submitted_at'),
  responded_at: timestamp('par_responded_at'),
  expires_at: timestamp('par_expires_at'),

  submitted_by: uuid('par_submitted_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('par_created_at').defaultNow().notNull(),
  updated_at: timestamp('par_updated_at').defaultNow().notNull(),
}, (t) => ({
  claimIdx: index('idx_par_claim').on(t.claim_id),
  hospitalIdx: index('idx_par_hospital').on(t.hospital_id),
  statusIdx: index('idx_par_status').on(t.status),
}));

// ============================================================
// ENHANCEMENT REQUESTS (mid-stay cost escalations)
// ============================================================

export const enhancementRequests = pgTable('enhancement_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  claim_id: uuid('er_claim_id').notNull().references(() => insuranceClaims.id, { onDelete: 'cascade' }),

  status: enhancementRequestStatusEnum('er_status').default('draft').notNull(),
  sequence_number: integer('er_sequence_number').default(1).notNull(),  // 1st, 2nd, 3rd enhancement

  previous_approved: numeric('previous_approved', { precision: 14, scale: 2 }).notNull(),
  additional_requested: numeric('additional_requested', { precision: 14, scale: 2 }).notNull(),
  new_total_requested: numeric('new_total_requested', { precision: 14, scale: 2 }).notNull(),
  approved_amount: numeric('er_approved_amount', { precision: 14, scale: 2 }),

  // Justification
  reason: text('er_reason').notNull(),
  clinical_justification: text('clinical_justification'),
  revised_diagnosis: text('revised_diagnosis'),
  revised_procedure: text('revised_procedure'),

  // TPA response
  tpa_reference: varchar('er_tpa_reference', { length: 100 }),
  rejection_reason: text('er_rejection_reason'),

  submitted_at: timestamp('er_submitted_at'),
  responded_at: timestamp('er_responded_at'),

  submitted_by: uuid('er_submitted_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('er_created_at').defaultNow().notNull(),
  updated_at: timestamp('er_updated_at').defaultNow().notNull(),
}, (t) => ({
  claimIdx: index('idx_er_claim').on(t.claim_id),
  hospitalIdx: index('idx_er_hospital').on(t.hospital_id),
  statusIdx: index('idx_er_status').on(t.status),
}));

// ============================================================
// TPA DEDUCTIONS (line-level deductions applied by TPA)
// ============================================================

export const tpaDeductions = pgTable('tpa_deductions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  claim_id: uuid('td_claim_id').notNull().references(() => insuranceClaims.id, { onDelete: 'cascade' }),

  category: deductionCategoryEnum('td_category').notNull(),
  description: text('td_description').notNull(),
  amount: numeric('td_amount', { precision: 12, scale: 2 }).notNull(),

  // Reference to the invoice line that was deducted
  invoice_line_id: uuid('td_invoice_line_id'),
  charge_code: varchar('td_charge_code', { length: 50 }),

  // Dispute tracking
  is_disputed: boolean('is_disputed').default(false),
  dispute_reason: text('dispute_reason'),
  dispute_resolved: boolean('dispute_resolved').default(false),
  resolved_amount: numeric('resolved_amount', { precision: 12, scale: 2 }),

  applied_by: uuid('td_applied_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('td_created_at').defaultNow().notNull(),
}, (t) => ({
  claimIdx: index('idx_td_claim').on(t.claim_id),
  hospitalIdx: index('idx_td_hospital').on(t.hospital_id),
  categoryIdx: index('idx_td_category').on(t.category),
}));
