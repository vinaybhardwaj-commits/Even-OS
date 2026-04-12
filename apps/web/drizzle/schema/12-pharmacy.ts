import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — Pharmacy & Dispensing (Module 09)
// ============================================================

export const dispensingStatusEnum = pgEnum('dispensing_status', [
  'pending', 'partially_dispensed', 'dispensed', 'returned', 'cancelled',
]);

export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'receipt', 'issue', 'return_to_stock', 'adjustment_plus', 'adjustment_minus',
  'transfer_in', 'transfer_out', 'expiry_write_off', 'damage_write_off',
]);

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled',
]);

export const narcoticsClassEnum2 = pgEnum('narcotics_class_v2', [
  'schedule_h', 'schedule_h1', 'schedule_x', 'narcotic', 'psychotropic',
]);

export const stockAlertTypeEnum = pgEnum('stock_alert_type', [
  'low_stock', 'out_of_stock', 'expiring_soon', 'expired', 'reorder',
]);

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
// PHARMACY INVENTORY (stock per drug per location)
// ============================================================

export const pharmacyInventory = pgTable('pharmacy_inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  drug_id: uuid('pi_drug_id').notNull(),  // references drug_master.id
  location: varchar('pi_location', { length: 50 }).notNull(),  // main_pharmacy, icu_stock, ot_stock, ward_1, etc.

  batch_number: varchar('batch_number', { length: 50 }),
  manufacturer: text('pi_manufacturer'),
  expiry_date: date('expiry_date'),

  quantity_on_hand: integer('quantity_on_hand').default(0).notNull(),
  quantity_reserved: integer('quantity_reserved').default(0).notNull(),  // allocated but not dispensed
  quantity_available: integer('quantity_available').default(0).notNull(),  // on_hand - reserved

  unit_cost: numeric('unit_cost', { precision: 12, scale: 2 }),
  mrp: numeric('pi_mrp', { precision: 12, scale: 2 }),

  reorder_level: integer('reorder_level').default(10),
  reorder_quantity: integer('reorder_quantity').default(50),
  max_stock_level: integer('max_stock_level'),

  is_active: boolean('pi_is_active').default(true).notNull(),
  last_restocked_at: timestamp('last_restocked_at'),

  created_at: timestamp('pi_created_at').defaultNow().notNull(),
  updated_at: timestamp('pi_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_pi_hospital').on(t.hospital_id),
  drugIdx: index('idx_pi_drug').on(t.drug_id),
  locationIdx: index('idx_pi_location').on(t.location),
  drugLocationIdx: uniqueIndex('idx_pi_drug_loc_batch').on(t.hospital_id, t.drug_id, t.location, t.batch_number),
  expiryIdx: index('idx_pi_expiry').on(t.expiry_date),
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

// ============================================================
// STOCK MOVEMENTS (all inventory changes)
// ============================================================

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  inventory_id: uuid('sm_inventory_id').references(() => pharmacyInventory.id, { onDelete: 'set null' }),
  drug_id: uuid('sm_drug_id').notNull(),
  drug_name: text('sm_drug_name').notNull(),

  movement_type: stockMovementTypeEnum('sm_type').notNull(),
  quantity: integer('sm_quantity').notNull(),
  previous_balance: integer('previous_balance').notNull(),
  new_balance: integer('new_balance').notNull(),

  batch_number: varchar('sm_batch_number', { length: 50 }),
  location: varchar('sm_location', { length: 50 }),

  // Reference
  reference_type: varchar('sm_ref_type', { length: 30 }),  // dispensing, purchase_order, transfer, adjustment
  reference_id: uuid('sm_ref_id'),
  vendor_id: uuid('sm_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),

  unit_cost: numeric('sm_unit_cost', { precision: 12, scale: 2 }),
  total_value: numeric('sm_total_value', { precision: 14, scale: 2 }),

  reason: text('sm_reason'),
  performed_by: uuid('sm_performed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  performed_at: timestamp('sm_performed_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_sm_hospital').on(t.hospital_id),
  drugIdx: index('idx_sm_drug').on(t.drug_id),
  inventoryIdx: index('idx_sm_inventory').on(t.inventory_id),
  typeIdx: index('idx_sm_type').on(t.movement_type),
  dateIdx: index('idx_sm_date').on(t.performed_at),
  vendorIdx: index('idx_sm_vendor').on(t.vendor_id),
}));

// ============================================================
// PURCHASE ORDERS
// ============================================================

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  po_number: varchar('po_number', { length: 50 }).notNull(),
  vendor_id: uuid('po_vendor_id').notNull().references(() => vendors.id, { onDelete: 'restrict' }),
  status: purchaseOrderStatusEnum('po_status').default('draft').notNull(),

  total_items: integer('po_total_items').default(0),
  total_amount: numeric('po_total_amount', { precision: 14, scale: 2 }).default('0'),

  expected_delivery: date('expected_delivery'),
  received_at: timestamp('po_received_at'),
  notes: text('po_notes'),

  created_by: uuid('po_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  approved_by: uuid('po_approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('po_approved_at'),

  created_at: timestamp('po_created_at').defaultNow().notNull(),
  updated_at: timestamp('po_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_po_hospital').on(t.hospital_id),
  vendorIdx: index('idx_po_vendor').on(t.vendor_id),
  statusIdx: index('idx_po_status').on(t.status),
  numberIdx: uniqueIndex('idx_po_number').on(t.hospital_id, t.po_number),
}));

// ============================================================
// PURCHASE ORDER LINE ITEMS
// ============================================================

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  po_id: uuid('poi_po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),

  drug_id: uuid('poi_drug_id').notNull(),
  drug_name: text('poi_drug_name').notNull(),

  quantity_ordered: integer('poi_qty_ordered').notNull(),
  quantity_received: integer('poi_qty_received').default(0),
  unit_cost: numeric('poi_unit_cost', { precision: 12, scale: 2 }).notNull(),
  total_cost: numeric('poi_total_cost', { precision: 14, scale: 2 }),

  batch_number: varchar('poi_batch_number', { length: 50 }),
  expiry_date: date('poi_expiry_date'),
  manufacturer: text('poi_manufacturer'),

  created_at: timestamp('poi_created_at').defaultNow().notNull(),
}, (t) => ({
  poIdx: index('idx_poi_po').on(t.po_id),
  drugIdx: index('idx_poi_drug').on(t.drug_id),
  hospitalIdx: index('idx_poi_hospital').on(t.hospital_id),
}));

// ============================================================
// STOCK ALERTS
// ============================================================

export const stockAlerts = pgTable('stock_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  drug_id: uuid('sa_drug_id').notNull(),
  drug_name: text('sa_drug_name').notNull(),
  location: varchar('sa_location', { length: 50 }),

  alert_type: stockAlertTypeEnum('sa_alert_type').notNull(),
  severity: varchar('sa_severity', { length: 10 }).default('medium'),  // low, medium, high, critical
  message: text('sa_message').notNull(),

  current_stock: integer('sa_current_stock'),
  threshold: integer('sa_threshold'),
  expiry_date: date('sa_expiry_date'),

  is_resolved: boolean('sa_is_resolved').default(false),
  resolved_by: uuid('sa_resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolved_at: timestamp('sa_resolved_at'),

  created_at: timestamp('sa_created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_sa_hospital').on(t.hospital_id),
  drugIdx: index('idx_sa_drug').on(t.drug_id),
  typeIdx: index('idx_sa_type').on(t.alert_type),
  resolvedIdx: index('idx_sa_resolved').on(t.is_resolved),
}));
