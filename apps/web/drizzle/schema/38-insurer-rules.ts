import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { insurers } from './37-insurers';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS — Insurer Rules Engine (A.2)
// ============================================================

export const ruleTypeEnum = pgEnum('rule_type', [
  'room_rent_cap',           // Max room rent per day (absolute or %)
  'proportional_deduction',  // If room exceeds cap, proportionally deduct all charges
  'co_pay',                  // Patient co-payment percentage
  'item_exclusion',          // Exclude specific items from coverage
  'sub_limit',               // Sub-limit on a category (e.g., max ₹50K for diagnostics)
  'package_rate',            // Fixed package rate for a procedure
  'waiting_period',          // Disease/condition waiting period (not billable within X days)
  'disease_cap',             // Max coverage per disease/diagnosis
  'network_tier_pricing',    // Different rates based on hospital network tier
  'category_cap',            // Cap on a billing category (room, pharmacy, lab, etc.)
]);

export const ruleStatusEnum = pgEnum('rule_status', [
  'active', 'draft', 'archived',
]);

// ============================================================
// INSURER RULES — JSONB conditions + parameters
// ============================================================

export const insurerRules = pgTable('insurer_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  insurer_id: uuid('insurer_id').notNull().references(() => insurers.id, { onDelete: 'cascade' }),

  // Rule metadata
  rule_name: text('rule_name').notNull(),
  rule_type: ruleTypeEnum('rule_type').notNull(),
  description: text('description'),
  priority: integer('priority').notNull().default(100), // Lower = higher priority

  // JSONB conditions — when this rule applies
  // e.g., { "room_type": "single_ac", "plan_type": "gold" }
  conditions: jsonb('conditions').notNull().default({}),

  // JSONB parameters — what the rule does (type-specific)
  // room_rent_cap:          { "max_per_day": 5000, "cap_type": "absolute" }
  // proportional_deduction: { "eligible_amount": 3000, "apply_to": "all" }
  // co_pay:                 { "percentage": 10, "apply_to": "all" }
  // item_exclusion:         { "excluded_codes": ["COSM01", "COSM02"], "category": "cosmetic" }
  // sub_limit:              { "category": "diagnostics", "max_amount": 50000 }
  // package_rate:           { "procedure_code": "KNEE_REPL", "package_amount": 250000 }
  // waiting_period:         { "disease_code": "DM2", "days": 365 }
  // disease_cap:            { "disease_code": "CARDIAC", "max_amount": 500000 }
  // network_tier_pricing:   { "preferred": 1.0, "standard": 0.9, "non_network": 0.7 }
  // category_cap:           { "category": "pharmacy", "max_amount": 100000 }
  parameters: jsonb('parameters').notNull().default({}),

  // Versioning
  version: integer('version').notNull().default(1),
  parent_rule_id: uuid('parent_rule_id'), // Previous version of this rule

  // Status
  status: ruleStatusEnum('status').notNull().default('active'),
  effective_from: timestamp('effective_from'),
  effective_to: timestamp('effective_to'),

  // Audit
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_ir_hospital').on(t.hospital_id),
  insurerIdx: index('idx_ir_insurer').on(t.insurer_id),
  typeIdx: index('idx_ir_type').on(t.rule_type),
  statusIdx: index('idx_ir_status').on(t.status),
  priorityIdx: index('idx_ir_priority').on(t.insurer_id, t.priority),
  parentIdx: index('idx_ir_parent').on(t.parent_rule_id),
}));

// ============================================================
// RULE APPLICATIONS — Audit trail of every rule evaluation
// ============================================================

export const ruleApplications = pgTable('rule_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // What was evaluated
  rule_id: uuid('rule_id').notNull().references(() => insurerRules.id, { onDelete: 'restrict' }),
  insurer_id: uuid('insurer_id').notNull().references(() => insurers.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id'), // The admission/encounter being billed
  patient_id: uuid('patient_id'),
  bill_id: uuid('bill_id'), // Reference to billing_accounts or invoices

  // Financial impact
  original_amount: numeric('original_amount', { precision: 14, scale: 2 }).notNull(),
  adjusted_amount: numeric('adjusted_amount', { precision: 14, scale: 2 }).notNull(),
  deduction_amount: numeric('deduction_amount', { precision: 14, scale: 2 }).notNull(),

  // Explanation for human review
  explanation: text('explanation').notNull(),

  // Full evaluation context snapshot
  evaluation_context: jsonb('evaluation_context').default({}),

  // Was this a simulation or real application?
  is_simulation: boolean('is_simulation').notNull().default(false),

  // Audit
  applied_by: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
  applied_at: timestamp('applied_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_ra_hospital').on(t.hospital_id),
  ruleIdx: index('idx_ra_rule').on(t.rule_id),
  insurerIdx: index('idx_ra_insurer').on(t.insurer_id),
  encounterIdx: index('idx_ra_encounter').on(t.encounter_id),
  patientIdx: index('idx_ra_patient').on(t.patient_id),
  billIdx: index('idx_ra_bill').on(t.bill_id),
  simIdx: index('idx_ra_simulation').on(t.is_simulation),
}));

// ============================================================
// Relations
// ============================================================

export const insurerRuleRelations = relations(insurerRules, ({ one, many }) => ({
  insurer: one(insurers, { fields: [insurerRules.insurer_id], references: [insurers.id] }),
  parentRule: one(insurerRules, { fields: [insurerRules.parent_rule_id], references: [insurerRules.id], relationName: 'ruleVersions' }),
  childVersions: many(insurerRules, { relationName: 'ruleVersions' }),
  applications: many(ruleApplications),
}));

export const ruleApplicationRelations = relations(ruleApplications, ({ one }) => ({
  rule: one(insurerRules, { fields: [ruleApplications.rule_id], references: [insurerRules.id] }),
  insurer: one(insurers, { fields: [ruleApplications.insurer_id], references: [insurers.id] }),
}));
