import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// PHARMACY-CLINICAL — vendors + dispensing + narcotics only
//
// (Module 09 — Pharmacy v2 PRD #1)
//
// SCM-related tables (pharmacy_inventory, stock_movements, purchase_orders,
// purchase_order_items, stock_alerts) MOVED to 63-scm-core.ts (universal SCM)
// per V's 30 Apr 2026 Q4 Path A lock — multi-tenancy + canonical names from
// day 1, no _v2 prefix.
//
// Vendors stays here for now (used by both Pharmacy clinical + SCM); Phase 1.4
// router refactor may relocate to 63-scm-core.ts depending on cross-PRD review.
// ============================================================

export const dispensingStatusEnum = pgEnum('dispensing_status', [
  'pending', 'partially_dispensed', 'dispensed', 'returned', 'cancelled',
] );

export const narcoticsClassEnum2 = pgEnum('narcotics_class_v2', [
  'schedule_h', 'schedule_h1', 'schedule_x', 'narcotic', 'psychotropic',
] );

// ============================================================
// VENDOR MASTER
// ============================================================

export const vendors = pgTable('vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  vendor_code: varchar('vendor_code', { length: 30 }).notNull(),
  vendor_name: text('vendor_name').notNull(),
  contact_person: text('contact_person'),
  phone: varchar('vendor_phone', { length: 20 }),
  email: varchar('vendor_email', { length: 100 }),
  address: text('vendor_address'),
  gst_number: varchar('vendor_gst', { length: 20 }),
  drug_license_number: varchar('drug_license', { length: 50 }),
  license_expiry: date('license_expiry'),
  payment_terms_days: integer('payment_terms_days').default(30),
  is_active: boolean('vendor_is_active').default(true).notNull(),

  created_at: timestamp('vendor_created_at').defaultNow().notNull(),
  updated_at: timestamp('vendor_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_vendor_hospital').on(t.hospital_id),
  codeIdx: uniqueIndex('idx_vendor_code').on(t.hospital_id, t.vendor_code),
}));


// ============================================================
// DISPENSING RECORDS (linked to medication orders)
// ============================================================

export const dispensingRecords = pgTable('dispensing_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('dr_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('dr_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  medication_order_id: uuid('medication_order_id'),  // references medication_requests.id
  inventory_id: uuid('dr_inventory_id').references(() => pharmacyInventory.id, { onDelete: 'set null' }),

  drug_id: uuid('dr_drug_id').notNull(),
  drug_name: text('dr_drug_name').notNull(),
  batch_number: varchar('dr_batch_number', { length: 50 }),

  quantity_ordered: integer('quantity_ordered').notNull(),
  quantity_dispensed: integer('quantity_dispensed').notNull(),
  quantity_returned: integer('quantity_returned').default(0),

  unit_price: numeric('dr_unit_price', { precision: 12, scale: 2 }),
  total_amount: numeric('dr_total_amount', { precision: 12, scale: 2 }),

  status: dispensingStatusEnum('dr_status').default('pending').notNull(),

  dispensed_by: uuid('dispensed_by').references(() => users.id, { onDelete: 'set null' }),
  dispensed_at: timestamp('dispensed_at'),
  returned_at: timestamp('dr_returned_at'),
  returned_by: uuid('dr_returned_by').references(() => users.id, { onDelete: 'set null' }),

  notes: text('dr_notes'),
  created_at: timestamp('dr_created_at').defaultNow().notNull(),
  updated_at: timestamp('dr_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_dr_hospital').on(t.hospital_id),
  patientIdx: index('idx_dr_patient').on(t.patient_id),
  encounterIdx: index('idx_dr_encounter').on(t.encounter_id),
  orderIdx: index('idx_dr_order').on(t.medication_order_id),
  statusIdx: index('idx_dr_status').on(t.status),
  drugIdx: index('idx_dr_drug').on(t.drug_id),
}));


// ============================================================
// NARCOTICS REGISTER (Schedule H1/X/Narcotic — witness required)
// ============================================================

export const narcoticsRegister = pgTable('narcotics_register', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  drug_id: uuid('nr_drug_id').notNull(),
  drug_name: text('nr_drug_name').notNull(),
  narcotics_class: narcoticsClassEnum2('nr_class').notNull(),
  batch_number: varchar('nr_batch_number', { length: 50 }),

  // Movement
  movement_type: varchar('nr_movement_type', { length: 20 }).notNull(),  // receipt, issue, return, adjustment, destruction
  quantity: integer('nr_quantity').notNull(),
  running_balance: integer('nr_running_balance').notNull(),

  // Patient (for issues)
  patient_id: uuid('nr_patient_id').references(() => patients.id, { onDelete: 'set null' }),
  encounter_id: uuid('nr_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  dispensing_id: uuid('nr_dispensing_id').references(() => dispensingRecords.id, { onDelete: 'set null' }),

  // Accountability
  performed_by: uuid('nr_performed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  witnessed_by: uuid('nr_witnessed_by').references(() => users.id, { onDelete: 'set null' }),
  witness_verified: boolean('witness_verified').default(false),

  // Source/destination
  source: text('nr_source'),  // vendor name, ward, etc.
  destination: text('nr_destination'),
  reference_number: varchar('nr_reference', { length: 100 }),

  notes: text('nr_notes'),
  recorded_at: timestamp('nr_recorded_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_nr_hospital').on(t.hospital_id),
  drugIdx: index('idx_nr_drug').on(t.drug_id),
  classIdx: index('idx_nr_class').on(t.narcotics_class),
  dateIdx: index('idx_nr_date').on(t.recorded_at),
  patientIdx: index('idx_nr_patient').on(t.patient_id),
}));
