import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, real, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — Enhanced Billing & Revenue Cycle (Module 11)
// ============================================================

export const accountTypeEnum = pgEnum('account_type', [
  'self_pay', 'insurance', 'corporate', 'government',
]);

export const depositStatusEnum = pgEnum('deposit_status', [
  'collected', 'applied', 'refunded', 'partial_refund',
]);

export const invoiceTypeEnum = pgEnum('invoice_type', [
  'estimate', 'interim', 'final', 'credit_note',
]);

export const chargeSourceEnum = pgEnum('charge_source', [
  'auto_medication', 'auto_service', 'auto_procedure', 'auto_room',
  'auto_package', 'manual', 'order_set',
]);

export const packageStatusEnum = pgEnum('package_status', [
  'draft', 'active', 'exceeded', 'closed',
]);

export const roomChargeTypeEnum = pgEnum('room_charge_type', [
  'full_day', 'admission_day', 'discharge_day', 'prorated',
]);

export const billingConfigKeyEnum = pgEnum('billing_config_key', [
  'refund_tier_1', 'refund_tier_2', 'refund_tier_3', 'refund_tier_4',
  'enhancement_threshold', 'auto_room_charge_time', 'gst_inclusive',
  'default_payment_terms_days', 'deposit_minimum_pct',
]);

// ============================================================
// BILLING ACCOUNTS (patient financial account per encounter)
// ============================================================

export const billingAccounts = pgTable('billing_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('ba_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('ba_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  account_type: accountTypeEnum('account_type').default('self_pay').notNull(),

  // Insurance details (if applicable)
  insurer_name: text('insurer_name'),
  tpa_name: text('ba_tpa_name'),
  policy_number: varchar('ba_policy_number', { length: 100 }),
  member_id: varchar('ba_member_id', { length: 100 }),
  sum_insured: numeric('sum_insured', { precision: 14, scale: 2 }),
  room_rent_eligibility: numeric('room_rent_eligibility', { precision: 12, scale: 2 }),
  co_pay_percent: numeric('co_pay_percent', { precision: 5, scale: 2 }).default('0'),
  proportional_deduction_pct: numeric('proportional_deduction_pct', { precision: 5, scale: 2 }).default('0'),

  // Running totals
  total_charges: numeric('total_charges', { precision: 14, scale: 2 }).default('0'),
  total_deposits: numeric('total_deposits', { precision: 14, scale: 2 }).default('0'),
  total_payments: numeric('total_payments', { precision: 14, scale: 2 }).default('0'),
  total_approved: numeric('total_approved', { precision: 14, scale: 2 }).default('0'),
  balance_due: numeric('ba_balance_due', { precision: 14, scale: 2 }).default('0'),

  // Estimate
  estimated_total: numeric('estimated_total', { precision: 14, scale: 2 }),
  patient_liability_estimate: numeric('patient_liability_estimate', { precision: 14, scale: 2 }),

  is_active: boolean('ba_is_active').default(true),
  created_by: uuid('ba_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('ba_created_at').defaultNow().notNull(),
  updated_at: timestamp('ba_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_ba_patient').on(t.patient_id),
  hospitalIdx: index('idx_ba_hospital').on(t.hospital_id),
  encounterIdx: index('idx_ba_encounter').on(t.encounter_id),
  accountTypeIdx: index('idx_ba_type').on(t.account_type),
}));

// ============================================================
// DEPOSITS (advance payments / security deposits)
// ============================================================

export const deposits = pgTable('deposits', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('dep_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('dep_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  account_id: uuid('dep_account_id').references(() => billingAccounts.id, { onDelete: 'set null' }),

  amount: numeric('dep_amount', { precision: 12, scale: 2 }).notNull(),
  status: depositStatusEnum('dep_status').default('collected').notNull(),

  payment_method: varchar('dep_payment_method', { length: 30 }).notNull(),  // cash, card, upi, neft, cheque
  reference_number: varchar('dep_reference_number', { length: 100 }),
  receipt_number: varchar('receipt_number', { length: 30 }),

  collected_at: timestamp('collected_at').defaultNow().notNull(),
  applied_at: timestamp('applied_at'),
  applied_to_invoice_id: uuid('applied_to_invoice_id'),
  refunded_at: timestamp('dep_refunded_at'),
  refund_amount: numeric('refund_amount', { precision: 12, scale: 2 }),

  collected_by: uuid('collected_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  notes: text('dep_notes'),

  created_at: timestamp('dep_created_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_dep_patient').on(t.patient_id),
  hospitalIdx: index('idx_dep_hospital').on(t.hospital_id),
  encounterIdx: index('idx_dep_encounter').on(t.encounter_id),
  accountIdx: index('idx_dep_account').on(t.account_id),
  statusIdx: index('idx_dep_status').on(t.status),
}));

// ============================================================
// INVOICE LINE ITEMS (detail within invoice)
// ============================================================

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  invoice_id: uuid('ili_invoice_id').notNull(),  // FK to invoices (can't import circular)

  charge_code: varchar('ili_charge_code', { length: 50 }),
  description: text('ili_description').notNull(),
  category: varchar('ili_category', { length: 50 }),     // room, procedure, lab, pharmacy, consultation, nursing
  service_date: timestamp('ili_service_date'),

  quantity: integer('ili_quantity').default(1).notNull(),
  unit_price: numeric('ili_unit_price', { precision: 12, scale: 2 }).notNull(),
  discount_percent: numeric('ili_discount_pct', { precision: 5, scale: 2 }).default('0'),
  discount_amount: numeric('ili_discount_amt', { precision: 12, scale: 2 }).default('0'),
  gst_percent: numeric('ili_gst_pct', { precision: 5, scale: 2 }).default('0'),
  gst_amount: numeric('ili_gst_amt', { precision: 12, scale: 2 }).default('0'),
  net_amount: numeric('ili_net_amount', { precision: 12, scale: 2 }).notNull(),

  // Source reference (what generated this line)
  source_type: chargeSourceEnum('ili_source_type'),
  source_id: uuid('ili_source_id'),   // encounter_charges.id, medication_request.id, etc.

  hsn_code: varchar('ili_hsn_code', { length: 20 }),
  is_non_payable: boolean('is_non_payable').default(false),  // marked by insurer as not covered

  created_at: timestamp('ili_created_at').defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index('idx_ili_invoice').on(t.invoice_id),
  hospitalIdx: index('idx_ili_hospital').on(t.hospital_id),
  categoryIdx: index('idx_ili_category').on(t.category),
  sourceIdx: index('idx_ili_source').on(t.source_type, t.source_id),
}));

// ============================================================
// ROOM CHARGE LOG (daily auto-generated room charges)
// ============================================================

export const roomChargeLog = pgTable('room_charge_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('rcl_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('rcl_encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  account_id: uuid('rcl_account_id').references(() => billingAccounts.id),

  charge_date: timestamp('charge_date').notNull(),
  charge_type: roomChargeTypeEnum('room_charge_type').default('full_day').notNull(),

  bed_id: uuid('rcl_bed_id'),
  ward_name: varchar('ward_name', { length: 100 }),
  room_category: varchar('room_category', { length: 50 }),  // general, semi-private, private, deluxe, ICU, NICU

  base_rate: numeric('base_rate', { precision: 12, scale: 2 }).notNull(),
  nursing_charge: numeric('nursing_charge', { precision: 12, scale: 2 }).default('0'),
  total_charge: numeric('rcl_total_charge', { precision: 12, scale: 2 }).notNull(),

  // Eligibility check
  room_rent_eligible: numeric('room_rent_eligible', { precision: 12, scale: 2 }),
  is_over_eligible: boolean('is_over_eligible').default(false),
  proportional_deduction_risk: numeric('prop_deduction_risk', { precision: 5, scale: 2 }),

  encounter_charge_id: uuid('rcl_encounter_charge_id'),  // link to generated charge
  generated_by_system: boolean('generated_by_system').default(true),

  created_at: timestamp('rcl_created_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_rcl_patient').on(t.patient_id),
  hospitalIdx: index('idx_rcl_hospital').on(t.hospital_id),
  encounterIdx: index('idx_rcl_encounter').on(t.encounter_id),
  chargeDateIdx: index('idx_rcl_date').on(t.charge_date),
}));

// ============================================================
// PACKAGE APPLICATIONS (package applied to admission)
// ============================================================

export const packageApplications = pgTable('package_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('pa_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('pa_encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  account_id: uuid('pa_account_id').references(() => billingAccounts.id),

  package_name: text('package_name').notNull(),
  package_code: varchar('package_code', { length: 50 }),
  status: packageStatusEnum('pa_status').default('active').notNull(),

  package_price: numeric('package_price', { precision: 14, scale: 2 }).notNull(),
  actual_cost: numeric('actual_cost', { precision: 14, scale: 2 }).default('0'),
  variance_amount: numeric('variance_amount', { precision: 14, scale: 2 }).default('0'),  // actual - package

  includes_room: boolean('includes_room').default(true),
  includes_pharmacy: boolean('includes_pharmacy').default(true),
  includes_investigations: boolean('includes_investigations').default(true),
  max_los_days: integer('max_los_days'),

  applied_at: timestamp('applied_at').defaultNow().notNull(),
  closed_at: timestamp('pa_closed_at'),
  applied_by: uuid('applied_by').notNull().references(() => users.id, { onDelete: 'restrict' }),

  created_at: timestamp('pa_created_at').defaultNow().notNull(),
  updated_at: timestamp('pa_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_pa_patient').on(t.patient_id),
  hospitalIdx: index('idx_pa_hospital').on(t.hospital_id),
  encounterIdx: index('idx_pa_encounter').on(t.encounter_id),
  statusIdx: index('idx_pa_status').on(t.status),
}));

// ============================================================
// PACKAGE COMPONENTS (line items within a package)
// ============================================================

export const packageComponents = pgTable('package_components', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  package_application_id: uuid('pc_package_app_id').notNull().references(() => packageApplications.id, { onDelete: 'cascade' }),

  component_name: text('component_name').notNull(),
  category: varchar('pc_category', { length: 50 }),     // room, procedure, lab, pharmacy, consultation
  budgeted_amount: numeric('budgeted_amount', { precision: 12, scale: 2 }).notNull(),
  actual_amount: numeric('pc_actual_amount', { precision: 12, scale: 2 }).default('0'),
  variance: numeric('pc_variance', { precision: 12, scale: 2 }).default('0'),

  is_included: boolean('pc_is_included').default(true),
  max_quantity: integer('max_quantity'),
  used_quantity: integer('used_quantity').default(0),

  created_at: timestamp('pc_created_at').defaultNow().notNull(),
}, (t) => ({
  packageIdx: index('idx_pc_package').on(t.package_application_id),
  hospitalIdx: index('idx_pc_hospital').on(t.hospital_id),
}));

// ============================================================
// BILLING CONFIG (hospital-level settings)
// ============================================================

export const billingConfig = pgTable('billing_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  config_key: billingConfigKeyEnum('config_key').notNull(),
  config_value: text('config_value').notNull(),
  description: text('bc_description'),

  updated_by: uuid('bc_updated_by').references(() => users.id),
  created_at: timestamp('bc_created_at').defaultNow().notNull(),
  updated_at: timestamp('bc_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalKeyIdx: uniqueIndex('idx_bc_hospital_key').on(t.hospital_id, t.config_key),
}));
