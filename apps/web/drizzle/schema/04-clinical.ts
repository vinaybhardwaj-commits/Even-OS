import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  uniqueIndex, index, uuid, pgEnum, numeric,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { chargeMaster, consentTemplates } from './01-master-data';
import { patients, encounters, locations } from './03-registration';

// ============================================================
// ENUMS — Clinical / Orders / Billing
// ============================================================

export const orderTypeEnum = pgEnum('order_type', ['lab', 'radiology', 'pharmacy', 'procedure', 'diet', 'nursing']);
export const orderStatusEnum = pgEnum('order_status', ['draft', 'ordered', 'in_progress', 'completed', 'cancelled']);
export const orderPriorityEnum = pgEnum('order_priority', ['routine', 'urgent', 'stat']);

export const consentStatusEnum = pgEnum('consent_status', ['pending', 'signed', 'refused', 'revoked']);

export const formStatusEnum = pgEnum('form_status', ['draft', 'submitted', 'reviewed', 'locked']);
export const formTemplateStatusEnum = pgEnum('form_template_status', ['active', 'draft', 'archived']);

export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'pending', 'partially_paid', 'paid', 'cancelled', 'written_off']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'card', 'upi', 'neft', 'cheque', 'insurance_settlement', 'other']);
export const claimStatusEnum = pgEnum('claim_status', ['draft', 'submitted', 'query_raised', 'approved', 'partially_approved', 'rejected', 'settled']);

// ============================================================
// CLINICAL ORDERS (lab, radiology, pharmacy, etc.)
// ============================================================

export const clinicalOrders = pgTable('clinical_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  order_type: orderTypeEnum('order_type').notNull(),
  order_status: orderStatusEnum('order_status').default('ordered').notNull(),
  priority: orderPriorityEnum('priority').default('routine').notNull(),

  // Order details
  order_code: varchar('order_code', { length: 50 }),   // internal code or LOINC
  order_name: text('order_name').notNull(),             // e.g. "CBC", "Chest X-ray", "Paracetamol 500mg"
  description: text('description'),
  quantity: integer('quantity').default(1).notNull(),
  frequency: varchar('frequency', { length: 100 }),     // e.g. "BD", "TDS", "Once"
  duration_days: integer('duration_days'),
  instructions: text('instructions'),                   // special instructions

  // Drug-specific (pharmacy orders)
  drug_id: uuid('drug_id'),                             // FK to drugMaster if applicable
  route: varchar('route', { length: 50 }),              // oral, iv, im, sc, topical
  dosage: varchar('dosage', { length: 100 }),           // "500mg", "5ml"

  // Linked charge
  charge_master_id: uuid('charge_master_id').references(() => chargeMaster.id),
  unit_price: numeric('unit_price', { precision: 12, scale: 2 }),

  // Results (for lab/radiology)
  result_text: text('result_text'),
  result_json: jsonb('result_json'),
  result_at: timestamp('result_at', { withTimezone: true }),

  // Ordering practitioner
  ordered_by_user_id: uuid('ordered_by_user_id').notNull().references(() => users.id),
  ordered_at: timestamp('ordered_at', { withTimezone: true }).defaultNow().notNull(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  cancel_reason: text('cancel_reason'),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('clinical_orders_encounter_idx').on(table.encounter_id),
  patientIdx: index('clinical_orders_patient_idx').on(table.patient_id),
  statusIdx: index('clinical_orders_status_idx').on(table.order_status),
  typeIdx: index('clinical_orders_type_idx').on(table.order_type),
}));

// ============================================================
// VITAL SIGNS
// ============================================================

export const vitalSigns = pgTable('vital_signs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  // Core vitals
  temperature_c: numeric('temperature_c', { precision: 4, scale: 1 }),    // e.g. 37.2
  pulse_bpm: integer('pulse_bpm'),                                         // e.g. 72
  resp_rate: integer('resp_rate'),                                         // breaths/min
  bp_systolic: integer('bp_systolic'),                                     // mmHg
  bp_diastolic: integer('bp_diastolic'),                                   // mmHg
  spo2_percent: numeric('spo2_percent', { precision: 4, scale: 1 }),      // e.g. 98.5
  blood_glucose: numeric('blood_glucose', { precision: 5, scale: 1 }),     // mg/dL
  weight_kg: numeric('weight_kg', { precision: 5, scale: 1 }),
  height_cm: numeric('height_cm', { precision: 5, scale: 1 }),

  // Pain & consciousness
  pain_score: integer('pain_score'),                                       // 0-10 NRS
  gcs_score: integer('gcs_score'),                                         // 3-15 Glasgow Coma Scale
  avpu: varchar('avpu', { length: 1 }),                                    // A/V/P/U

  notes: text('notes'),
  recorded_by_user_id: uuid('recorded_by_user_id').notNull().references(() => users.id),
  recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('vital_signs_encounter_idx').on(table.encounter_id),
  recordedAtIdx: index('vital_signs_recorded_at_idx').on(table.recorded_at),
}));

// ============================================================
// NURSING NOTES
// ============================================================

export const nursingNotes = pgTable('nursing_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  note_type: varchar('note_type', { length: 50 }).default('general').notNull(), // general, handover, procedure, medication
  content: text('content').notNull(),
  recorded_by_user_id: uuid('recorded_by_user_id').notNull().references(() => users.id),
  recorded_at: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('nursing_notes_encounter_idx').on(table.encounter_id),
}));

// ============================================================
// PATIENT CONSENTS (signed against consent_templates)
// ============================================================

export const patientConsents = pgTable('patient_consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  template_id: uuid('template_id').notNull().references(() => consentTemplates.id, { onDelete: 'restrict' }),

  consent_status: consentStatusEnum('consent_status').default('pending').notNull(),
  signed_by_name: text('signed_by_name'),               // signee name (patient or guardian)
  relationship: varchar('relationship', { length: 50 }), // self, parent, spouse, guardian
  signature_data: text('signature_data'),                 // base64 signature image or "verbal"
  signed_at: timestamp('signed_at', { withTimezone: true }),

  refused_reason: text('refused_reason'),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  revoke_reason: text('revoke_reason'),

  witnessed_by_user_id: uuid('witnessed_by_user_id').references(() => users.id),
  created_by_user_id: uuid('created_by_user_id').notNull().references(() => users.id),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('patient_consents_encounter_idx').on(table.encounter_id),
  patientIdx: index('patient_consents_patient_idx').on(table.patient_id),
}));

// ============================================================
// CLINICAL FORM TEMPLATES (structured intake/assessment forms)
// ============================================================

export const clinicalFormTemplates = pgTable('clinical_form_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  name: text('name').notNull(),
  category: varchar('category', { length: 50 }).notNull(), // intake, assessment, screening, discharge, followup
  description: text('description'),
  version: integer('version').default(1).notNull(),
  status: formTemplateStatusEnum('status').default('active').notNull(),

  // Form schema as JSON (array of field definitions)
  fields_schema: jsonb('fields_schema').notNull(), // [{ key, label, type, required, options?, validation? }]

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  created_by: uuid('created_by').references(() => users.id),
}, (table) => ({
  hospitalIdx: index('clinical_form_templates_hospital_idx').on(table.hospital_id),
}));

// ============================================================
// CLINICAL FORM SUBMISSIONS
// ============================================================

export const clinicalForms = pgTable('clinical_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  template_id: uuid('template_id').notNull().references(() => clinicalFormTemplates.id, { onDelete: 'restrict' }),

  form_status: formStatusEnum('form_status').default('draft').notNull(),
  form_data: jsonb('form_data').notNull(), // { field_key: value } pairs

  submitted_by_user_id: uuid('submitted_by_user_id').notNull().references(() => users.id),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  reviewed_by_user_id: uuid('reviewed_by_user_id').references(() => users.id),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  locked_at: timestamp('locked_at', { withTimezone: true }),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('clinical_forms_encounter_idx').on(table.encounter_id),
  templateIdx: index('clinical_forms_template_idx').on(table.template_id),
}));

// ============================================================
// ENCOUNTER CHARGES (line items — links encounter to charge master)
// ============================================================

export const encounterCharges = pgTable('encounter_charges', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  charge_master_id: uuid('charge_master_id').references(() => chargeMaster.id),
  order_id: uuid('order_id').references(() => clinicalOrders.id), // optional link to originating order

  charge_code: varchar('charge_code', { length: 50 }),
  charge_name: text('charge_name').notNull(),
  category: varchar('category', { length: 50 }),          // room, procedure, lab, pharmacy, consultation, nursing

  quantity: integer('quantity').default(1).notNull(),
  unit_price: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  discount_percent: numeric('discount_percent', { precision: 5, scale: 2 }).default('0'),
  gst_percent: numeric('gst_percent', { precision: 5, scale: 2 }).default('0'),
  net_amount: numeric('net_amount', { precision: 12, scale: 2 }).notNull(),  // qty * unit_price * (1 - discount%) * (1 + gst%)

  service_date: timestamp('service_date', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),

  created_by_user_id: uuid('created_by_user_id').notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('encounter_charges_encounter_idx').on(table.encounter_id),
  patientIdx: index('encounter_charges_patient_idx').on(table.patient_id),
}));

// ============================================================
// INVOICES
// ============================================================

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  invoice_number: varchar('invoice_number', { length: 30 }).notNull(),
  invoice_status: invoiceStatusEnum('invoice_status').default('draft').notNull(),

  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  discount_total: numeric('discount_total', { precision: 12, scale: 2 }).default('0'),
  gst_total: numeric('gst_total', { precision: 12, scale: 2 }).default('0'),
  grand_total: numeric('grand_total', { precision: 12, scale: 2 }).notNull(),
  amount_paid: numeric('amount_paid', { precision: 12, scale: 2 }).default('0'),
  balance_due: numeric('balance_due', { precision: 12, scale: 2 }).notNull(),

  generated_at: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  due_date: timestamp('due_date', { withTimezone: true }),
  finalized_at: timestamp('finalized_at', { withTimezone: true }),

  notes: text('notes'),
  created_by_user_id: uuid('created_by_user_id').notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('invoices_encounter_idx').on(table.encounter_id),
  numberIdx: uniqueIndex('invoices_number_hospital_idx').on(table.hospital_id, table.invoice_number),
}));

// ============================================================
// PAYMENTS
// ============================================================

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  invoice_id: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  payment_method: paymentMethodEnum('payment_method').notNull(),
  reference_number: varchar('reference_number', { length: 100 }),  // txn ID, cheque no, etc.
  payment_date: timestamp('payment_date', { withTimezone: true }).defaultNow().notNull(),

  notes: text('notes'),
  received_by_user_id: uuid('received_by_user_id').notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  invoiceIdx: index('payments_invoice_idx').on(table.invoice_id),
}));

// ============================================================
// TPA / INSURANCE CLAIMS
// ============================================================

export const tpaClaims = pgTable('tpa_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  invoice_id: uuid('invoice_id').references(() => invoices.id),

  claim_status: claimStatusEnum('claim_status').default('draft').notNull(),
  claim_number: varchar('claim_number', { length: 50 }),

  tpa_name: text('tpa_name'),
  insurance_company: text('insurance_company'),
  policy_number: varchar('policy_number', { length: 100 }),
  member_id: varchar('member_id', { length: 100 }),

  claimed_amount: numeric('claimed_amount', { precision: 12, scale: 2 }).notNull(),
  approved_amount: numeric('approved_amount', { precision: 12, scale: 2 }),
  settled_amount: numeric('settled_amount', { precision: 12, scale: 2 }),

  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  settled_at: timestamp('settled_at', { withTimezone: true }),
  rejected_at: timestamp('rejected_at', { withTimezone: true }),
  rejection_reason: text('rejection_reason'),

  // Documents / refs
  pre_auth_number: varchar('pre_auth_number', { length: 100 }),
  discharge_summary_ref: text('discharge_summary_ref'),

  notes: text('notes'),
  created_by_user_id: uuid('created_by_user_id').notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  encounterIdx: index('tpa_claims_encounter_idx').on(table.encounter_id),
  statusIdx: index('tpa_claims_status_idx').on(table.claim_status),
}));
