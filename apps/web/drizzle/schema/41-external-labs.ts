import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb, date,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { labPanels, labOrders } from './13-lab-radiology';

// ============================================================
// ENUMS — External Lab Master (Module B.1)
// ============================================================

export const contractTypeEnum = pgEnum('contract_type', [
  'monthly', 'per_test', 'annual', 'panel_rate',
]);

export const dispatchMethodEnum = pgEnum('dispatch_method', [
  'courier', 'pickup', 'digital',
]);

export const externalLabOrderStatusEnum = pgEnum('external_lab_order_status', [
  'pending_dispatch', 'dispatched', 'received_by_lab', 'processing',
  'results_received', 'results_entered', 'verified', 'cancelled', 'rejected',
]);

// ============================================================
// EXTERNAL LABS — Catalog of partner diagnostic labs
// ============================================================

export const externalLabs = pgTable('external_labs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // Lab identification
  lab_name: text('lab_name').notNull(),
  lab_code: varchar('lab_code', { length: 20 }),

  // Address
  address: text('address'),
  city: varchar('city', { length: 50 }),
  state: varchar('state', { length: 50 }),
  pincode: varchar('pincode', { length: 10 }),

  // Contact
  contact_person: text('contact_person'),
  contact_phone: varchar('contact_phone', { length: 20 }),
  contact_email: text('contact_email'),

  // Accreditations
  nabl_accredited: boolean('nabl_accredited').default(false).notNull(),
  nabl_certificate_number: varchar('nabl_certificate_number', { length: 50 }),
  nabl_valid_until: date('nabl_valid_until'),

  cap_accredited: boolean('cap_accredited').default(false).notNull(),

  // Contract
  contract_type: contractTypeEnum('contract_type'),
  contract_start: date('contract_start'),
  contract_end: date('contract_end'),
  default_tat_hours: integer('default_tat_hours').default(48).notNull(),
  payment_terms: text('payment_terms'),  // e.g., "Net 30"

  // Notes
  notes: text('notes'),
  is_active: boolean('is_active').default(true).notNull(),

  // Audit
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_el_hospital').on(t.hospital_id),
  labCodeIdx: index('idx_el_lab_code').on(t.lab_code),
  isActiveIdx: index('idx_el_is_active').on(t.is_active),
}));

// ============================================================
// EXTERNAL LAB PRICING — Per-test pricing per external lab
// ============================================================

export const externalLabPricing = pgTable('external_lab_pricing', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  external_lab_id: uuid('external_lab_id').notNull().references(() => externalLabs.id, { onDelete: 'cascade' }),
  panel_id: uuid('panel_id').references(() => labPanels.id, { onDelete: 'restrict' }),

  // Test identification (redundant for quick lookup)
  test_code: varchar('test_code', { length: 50 }).notNull(),
  test_name: text('test_name').notNull(),

  // Pricing
  cost_price: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),  // Hospital pays lab
  patient_price: numeric('patient_price', { precision: 12, scale: 2 }).notNull(),  // Billed to patient

  // Preference & TAT
  is_preferred: boolean('is_preferred').default(false).notNull(),
  tat_hours: integer('tat_hours'),  // Test-specific TAT (overrides lab default)

  // Effective dates
  effective_from: date('effective_from'),
  effective_to: date('effective_to'),

  // Notes
  notes: text('notes'),
  is_active: boolean('is_active').default(true).notNull(),

  // Audit
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_elp_hospital').on(t.hospital_id),
  labIdx: index('idx_elp_lab').on(t.external_lab_id),
  panelIdx: index('idx_elp_panel').on(t.panel_id),
  isActiveIdx: index('idx_elp_is_active').on(t.is_active),
  uniqueLabPanelIdx: uniqueIndex('idx_elp_unique_lab_panel').on(
    t.hospital_id,
    t.external_lab_id,
    t.panel_id,
  ),
}));

// ============================================================
// EXTERNAL LAB ORDERS — Full lifecycle tracking for outsourced orders
// ============================================================

export const externalLabOrders = pgTable('external_lab_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  lab_order_id: uuid('lab_order_id').notNull().references(() => labOrders.id, { onDelete: 'restrict' }),
  external_lab_id: uuid('external_lab_id').notNull().references(() => externalLabs.id, { onDelete: 'restrict' }),
  external_lab_pricing_id: uuid('external_lab_pricing_id').references(() => externalLabPricing.id, { onDelete: 'set null' }),

  // Patient context
  patient_id: uuid('patient_id').notNull(),
  encounter_id: uuid('encounter_id'),

  // Status lifecycle
  status: externalLabOrderStatusEnum('status').default('pending_dispatch').notNull(),

  // Dispatch
  dispatch_date: timestamp('dispatch_date'),
  dispatch_method: dispatchMethodEnum('dispatch_method'),
  dispatch_tracking: varchar('dispatch_tracking', { length: 100 }),  // Courier tracking number
  dispatched_by: uuid('dispatched_by').references(() => users.id, { onDelete: 'set null' }),

  // Lab processing
  received_at: timestamp('received_at'),  // When external lab received
  processing_at: timestamp('processing_at'),  // When processing started
  results_received_at: timestamp('results_received_at'),  // When results came back

  // Results entry
  results_entered_at: timestamp('results_entered_at'),
  results_entered_by: uuid('results_entered_by').references(() => users.id, { onDelete: 'set null' }),

  // Verification
  verified_at: timestamp('verified_at'),
  verified_by: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),

  // TAT tracking
  tat_promised_hours: integer('tat_promised_hours'),
  tat_actual_hours: numeric('tat_actual_hours', { precision: 8, scale: 2 }),
  tat_breach: boolean('tat_breach').default(false).notNull(),

  // Financial
  cost_amount: numeric('cost_amount', { precision: 12, scale: 2 }),  // Actual cost to hospital
  billing_amount: numeric('billing_amount', { precision: 12, scale: 2 }),  // Amount billed to patient

  // Documents & Notes
  document_url: text('document_url'),  // External lab report PDF
  rejection_reason: text('rejection_reason'),
  notes: text('notes'),

  // Audit
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_elo_hospital').on(t.hospital_id),
  labOrderIdx: index('idx_elo_lab_order').on(t.lab_order_id),
  labIdx: index('idx_elo_lab').on(t.external_lab_id),
  patientIdx: index('idx_elo_patient').on(t.patient_id),
  statusIdx: index('idx_elo_status').on(t.status),
  tatBreachIdx: index('idx_elo_tat_breach').on(t.tat_breach),
}));
