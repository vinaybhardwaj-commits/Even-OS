import { pgTable, pgEnum, uuid, text, varchar, integer, boolean, timestamp, date, numeric, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════════
// ENUMS — Infection Surveillance & Antibiotic Stewardship (S8c)
// ═══════════════════════════════════════════════════════════════

export const haiTypeEnum = pgEnum('hai_type', [
  'CLABSI', 'CAUTI', 'VAP', 'SSI', 'MRSA', 'C_diff', 'other',
]);

export const haiOutcomeEnum = pgEnum('hai_outcome', [
  'resolved', 'ongoing', 'death',
]);

export const abxJustificationReasonEnum = pgEnum('abx_justification_reason', [
  'confirmed_mdr_organism', 'empiric_febrile_neutropenia',
  'high_risk_without_coverage', 'other',
]);

export const abxApprovalStatusEnum = pgEnum('abx_approval_status', [
  'pending', 'approved', 'denied',
]);

export const cultureStatusAtOrderEnum = pgEnum('culture_status_at_order', [
  'not_sent', 'pending', 'positive', 'negative', 'unknown',
]);

// ═══════════════════════════════════════════════════════════════
// INFECTION SURVEILLANCE (HAI Events)
// ═══════════════════════════════════════════════════════════════

export const infectionSurveillance = pgTable('infection_surveillance', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  patientId: uuid('is_patient_id').notNull(),
  encounterId: uuid('is_encounter_id'),
  infectionType: haiTypeEnum('infection_type').notNull(),
  organism: varchar('organism', { length: 255 }),
  organismDisplayName: varchar('organism_display_name', { length: 255 }),
  susceptibilityJson: text('susceptibility_json'), // JSON string
  antibioticTreatedWith: varchar('antibiotic_treated_with', { length: 255 }),
  deviceInvolved: varchar('device_involved', { length: 50 }),
  deviceInsertionDate: timestamp('device_insertion_date'),
  deviceRemovalDate: timestamp('device_removal_date'),
  onsetDate: timestamp('onset_date').notNull(),
  identifiedDate: timestamp('identified_date').defaultNow().notNull(),
  treatmentAntibiotic: varchar('treatment_antibiotic', { length: 255 }),
  treatmentDurationDays: integer('treatment_duration_days'),
  outcome: haiOutcomeEnum('is_outcome'),
  recordedByUserId: uuid('is_recorded_by_user_id').notNull(),
  recordedAt: timestamp('is_recorded_at').defaultNow().notNull(),
  notes: text('is_notes'),
  createdAt: timestamp('is_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// INFECTION RATES (Computed HAI Rates)
// ═══════════════════════════════════════════════════════════════

export const infectionRates = pgTable('infection_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  infectionType: haiTypeEnum('ir_infection_type').notNull(),
  numerator: integer('ir_numerator'),
  denominator: integer('ir_denominator'),
  ratePer1000: numeric('rate_per_1000', { precision: 10, scale: 2 }),
  denominatorSufficiency: varchar('denominator_sufficiency', { length: 50 }),
  computedAt: timestamp('ir_computed_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// ANTIBIOTIC USAGE LOG (Stewardship Tracking)
// ═══════════════════════════════════════════════════════════════

export const antibioticUsageLog = pgTable('antibiotic_usage_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  patientId: uuid('aul_patient_id').notNull(),
  encounterId: uuid('aul_encounter_id').notNull(),
  medicationOrderId: uuid('medication_order_id').notNull(),
  antibioticName: varchar('antibiotic_name', { length: 255 }).notNull(),
  isRestricted: boolean('is_restricted').default(false),
  restrictionApprovalId: uuid('restriction_approval_id'),
  doseMg: numeric('dose_mg', { precision: 12, scale: 2 }),
  frequencyPerDay: integer('frequency_per_day'),
  route: varchar('aul_route', { length: 50 }),
  startDate: timestamp('aul_start_date').notNull(),
  endDate: timestamp('aul_end_date'),
  durationDays: integer('aul_duration_days'),
  cultureStatusAtOrder: cultureStatusAtOrderEnum('culture_status_at_order'),
  organismIfKnown: varchar('organism_if_known', { length: 255 }),
  susceptibleToAntibiotic: boolean('susceptible_to_antibiotic'),
  justificationText: text('justification_text'),
  dddStandardMg: numeric('ddd_standard_mg', { precision: 12, scale: 2 }),
  dddCount: numeric('ddd_count', { precision: 10, scale: 2 }),
  prescribedByUserId: uuid('aul_prescribed_by_user_id').notNull(),
  prescribedAt: timestamp('aul_prescribed_at').defaultNow().notNull(),
  createdAt: timestamp('aul_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// ANTIBIOTIC APPROVALS (Restricted Antibiotic Workflow)
// ═══════════════════════════════════════════════════════════════

export const antibioticApprovals = pgTable('antibiotic_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  medicationOrderId: uuid('aa_medication_order_id').notNull(),
  antibioticName: varchar('aa_antibiotic_name', { length: 255 }).notNull(),
  justificationReason: abxJustificationReasonEnum('justification_reason').notNull(),
  justificationText: text('aa_justification_text'),
  cultureStatus: varchar('aa_culture_status', { length: 50 }),
  cultureResultText: text('culture_result_text'),
  status: abxApprovalStatusEnum('aa_status').default('pending'),
  approvalValidUntil: timestamp('approval_valid_until'),
  requiresReapprovalAt: timestamp('requires_reapproval_at'),
  approvedByUserId: uuid('aa_approved_by_user_id'),
  approvedAt: timestamp('aa_approved_at'),
  approvalNotes: text('approval_notes'),
  denialReason: text('denial_reason'),
  suggestedAlternative: varchar('suggested_alternative', { length: 255 }),
  requestedAt: timestamp('aa_requested_at').defaultNow().notNull(),
  requestedByUserId: uuid('aa_requested_by_user_id').notNull(),
});

// ═══════════════════════════════════════════════════════════════
// ANTIBIOGRAM RESULTS (Resistance Patterns)
// ═══════════════════════════════════════════════════════════════

export const antibiogramResults = pgTable('antibiogram_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  periodStart: date('ag_period_start').notNull(),
  periodEnd: date('ag_period_end').notNull(),
  organism: varchar('ag_organism', { length: 255 }).notNull(),
  antibiotic: varchar('ag_antibiotic', { length: 255 }).notNull(),
  countSusceptible: integer('count_susceptible').default(0),
  countIntermediate: integer('count_intermediate').default(0),
  countResistant: integer('count_resistant').default(0),
  pctSusceptible: numeric('pct_susceptible', { precision: 5, scale: 2 }),
  pctIntermediate: numeric('pct_intermediate', { precision: 5, scale: 2 }),
  pctResistant: numeric('pct_resistant', { precision: 5, scale: 2 }),
  computedAt: timestamp('ag_computed_at').defaultNow().notNull(),
});
