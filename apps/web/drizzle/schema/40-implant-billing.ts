import {
  pgTable, text, boolean, timestamp, integer, jsonb,
  index, uuid, numeric, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { relations } from 'drizzle-orm';

// ============================================================
// IMPLANT MASTER — Catalog of available implants
// ============================================================

export const implantMaster = pgTable('implant_master', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // Identification
  implant_name: text('implant_name').notNull(),
  implant_code: text('implant_code'),                    // Internal code (e.g., KP-001)
  category: text('category').notNull(),  // orthopedic, cardiac, ophthalmic, dental, spinal, vascular, neurological, ent, gi, other
  sub_category: text('sub_category'),                   // E.g., 'knee_prosthesis', 'hip_prosthesis'

  // Manufacturer & regulatory
  manufacturer: text('manufacturer'),
  brand: text('brand'),
  model_number: text('model_number'),
  regulatory_approval: text('regulatory_approval'),      // E.g., 'CDSCO approved', 'CE certified'

  // Tax & pricing
  hsn_code: text('hsn_code'),                           // GST HSN code
  gst_rate: numeric('gst_rate', { precision: 5, scale: 2 }),  // GST percentage (e.g., 5.00, 12.00)
  procurement_cost: numeric('procurement_cost', { precision: 14, scale: 2 }).notNull(),  // Cost price (INR)
  billing_price: numeric('billing_price', { precision: 14, scale: 2 }).notNull(),        // Billable price (INR)
  mrp: numeric('mrp', { precision: 14, scale: 2 }),    // Maximum Retail Price

  // Storage & shelf life
  requires_serial_tracking: boolean('requires_serial_tracking').default(true),
  shelf_life_months: integer('shelf_life_months'),
  storage_instructions: text('storage_instructions'),   // E.g., 'Room temperature', 'Refrigerated'

  // Status
  is_active: boolean('is_active').default(true),
  notes: text('notes'),

  // Audit
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_im_hospital').on(t.hospital_id),
  categoryIdx: index('idx_im_category').on(t.category),
  implantCodeIdx: index('idx_im_code').on(t.implant_code),
  isActiveIdx: index('idx_im_active').on(t.is_active),
}));

// ============================================================
// IMPLANT USAGE — Per-surgery implant tracking & billing
// ============================================================

export const implantUsage = pgTable('implant_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  implant_id: uuid('implant_id').notNull().references(() => implantMaster.id, { onDelete: 'restrict' }),

  // Link to clinical & financial context
  encounter_id: uuid('encounter_id'),                   // The admission
  patient_id: uuid('patient_id'),                       // The patient
  surgery_id: uuid('surgery_id'),                       // OT schedule reference
  bill_id: uuid('bill_id'),                             // Auto-created billing line item

  // Implant instance tracking
  serial_number: text('serial_number'),
  batch_number: text('batch_number'),
  lot_number: text('lot_number'),
  expiry_date: date('expiry_date'),

  // Usage details
  quantity: integer('quantity').default(1).notNull(),
  unit_cost: numeric('unit_cost', { precision: 14, scale: 2 }).notNull(),  // Actual cost at time of use
  billing_amount: numeric('billing_amount', { precision: 14, scale: 2 }).notNull(),  // Amount billed

  // Clinical context
  surgeon_id: uuid('surgeon_id').references(() => users.id, { onDelete: 'set null' }),
  surgeon_name: text('surgeon_name'),
  implant_site: text('implant_site'),                   // Anatomical location (e.g., 'left knee', 'right hip')
  implant_date: timestamp('implant_date').notNull(),

  // Removal tracking (if applicable)
  removal_date: timestamp('removal_date'),
  removal_reason: text('removal_reason'),               // E.g., 'infection', 'patient_request', 'revision'

  // Notes
  notes: text('notes'),

  // Audit
  recorded_by: uuid('recorded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_iu_hospital').on(t.hospital_id),
  implantIdIdx: index('idx_iu_implant_id').on(t.implant_id),
  encounterIdx: index('idx_iu_encounter').on(t.encounter_id),
  patientIdx: index('idx_iu_patient').on(t.patient_id),
  surgeryIdx: index('idx_iu_surgery').on(t.surgery_id),
  serialIdx: index('idx_iu_serial').on(t.serial_number),
}));

// ============================================================
// Relations
// ============================================================

export const implantUsageRelations = relations(implantUsage, ({ one }) => ({
  implant: one(implantMaster, {
    fields: [implantUsage.implant_id],
    references: [implantMaster.id],
    relationName: 'usages',
  }),
}));

export const implantMasterRelations = relations(implantMaster, ({ many }) => ({
  usages: many(implantUsage, {
    relationName: 'usages',
  }),
}));
