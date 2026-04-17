import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS — Insurer Master (A.1)
// ============================================================

export const insurerTypeEnum = pgEnum('insurer_type', [
  'insurance_company', 'tpa', 'government', 'corporate', 'trust',
]);

export const networkTierEnum = pgEnum('network_tier', [
  'preferred', 'standard', 'non_network',
]);

// ============================================================
// INSURERS — Master table replacing hardcoded tpa_name_enum
// ============================================================

export const insurers = pgTable('insurers', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  insurer_code: text('insurer_code').notNull(),
  insurer_name: text('insurer_name').notNull(),
  insurer_type: insurerTypeEnum('insurer_type').notNull(),

  // Contact details
  contact_person: text('contact_person'),
  contact_phone: text('contact_phone'),
  contact_email: text('contact_email'),
  address: text('address'),

  // Financial
  gst_number: text('gst_number'),
  network_tier: networkTierEnum('network_tier').default('standard'),

  // Status
  is_active: boolean('is_active').notNull().default(true),
  notes: text('notes'),

  // Audit
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_insurers_hospital').on(t.hospital_id),
  codeIdx: uniqueIndex('idx_insurers_code').on(t.hospital_id, t.insurer_code),
  typeIdx: index('idx_insurers_type').on(t.insurer_type),
  activeIdx: index('idx_insurers_active').on(t.hospital_id, t.is_active),
}));

// ============================================================
// INSURER ↔ TPA MAPPINGS
// Many insurers use the same TPA for claims processing.
// TPA is also stored as an insurer record with type='tpa'.
// ============================================================

export const insurerTpaMappings = pgTable('insurer_tpa_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  insurer_id: uuid('insurer_id').notNull().references(() => insurers.id, { onDelete: 'cascade' }),
  tpa_id: uuid('tpa_id').notNull().references(() => insurers.id, { onDelete: 'cascade' }),

  effective_from: date('effective_from').notNull(),
  effective_to: date('effective_to'),
  is_active: boolean('is_active').notNull().default(true),

  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  insurerIdx: index('idx_itm_insurer').on(t.insurer_id),
  tpaIdx: index('idx_itm_tpa').on(t.tpa_id),
  hospitalIdx: index('idx_itm_hospital').on(t.hospital_id),
}));

// ============================================================
// Relations
// ============================================================

export const insurerRelations = relations(insurers, ({ many }) => ({
  tpaMappings: many(insurerTpaMappings, { relationName: 'insurerToTpa' }),
  tpaFor: many(insurerTpaMappings, { relationName: 'tpaForInsurer' }),
}));

export const insurerTpaMappingRelations = relations(insurerTpaMappings, ({ one }) => ({
  insurer: one(insurers, { fields: [insurerTpaMappings.insurer_id], references: [insurers.id], relationName: 'insurerToTpa' }),
  tpa: one(insurers, { fields: [insurerTpaMappings.tpa_id], references: [insurers.id], relationName: 'tpaForInsurer' }),
}));
