import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  uniqueIndex, index, uuid, pgEnum, numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';

// ============================================================
// ENUMS — Master Data
// ============================================================

export const chargeCategoryEnum = pgEnum('charge_category', [
  'room', 'procedure', 'lab', 'pharmacy', 'consultation', 'nursing', 'other',
]);

export const drugCategoryEnum = pgEnum('drug_category', [
  'tablet', 'capsule', 'injection', 'syrup', 'cream', 'ointment', 'drops', 'inhaler', 'patch', 'suppository', 'powder', 'other',
]);

export const drugRouteEnum = pgEnum('drug_route', [
  'oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'sublingual', 'rectal', 'ophthalmic', 'otic', 'nasal', 'transdermal', 'other',
]);

export const consentCategoryEnum = pgEnum('consent_category', [
  'surgical', 'anesthesia', 'transfusion', 'research', 'general', 'procedure', 'other',
]);

export const approvalTypeEnum = pgEnum('approval_type', [
  'discount', 'write_off', 'override', 'refund', 'credit_note', 'other',
]);

export const orderItemTypeEnum = pgEnum('order_item_type', [
  'medication', 'lab', 'radiology', 'procedure', 'other',
]);

export const masterDataEntityTypeEnum = pgEnum('master_data_entity_type', [
  'charge_master', 'drug_master', 'order_set', 'consent_template',
  'discharge_template', 'gst_rate', 'approval_hierarchy', 'nabh_indicator',
]);

// ============================================================
// CHARGE MASTER (73,000+ items)
// ============================================================

export const chargeMaster = pgTable('charge_master', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  charge_code: text('charge_code').notNull(),
  charge_name: text('charge_name').notNull(),
  category: chargeCategoryEnum('category').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  unit: text('unit').notNull().default('per unit'),
  description: text('description'),
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  is_active: boolean('is_active').notNull().default(true),
  effective_date: timestamp('effective_date', { withTimezone: true }),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chargeCodeHospitalIdx: uniqueIndex('idx_charge_master_code_hospital').on(table.charge_code, table.hospital_id),
  categoryIdx: index('idx_charge_master_category').on(table.category),
  isActiveIdx: index('idx_charge_master_is_active').on(table.is_active),
  nameSearchIdx: index('idx_charge_master_name').on(table.charge_name),
  hospitalIdIdx: index('idx_charge_master_hospital_id').on(table.hospital_id),
  effectiveDateIdx: index('idx_charge_master_effective_date').on(table.effective_date),
}));

// ============================================================
// DRUG MASTER (5,000+ items)
// ============================================================

export const drugMaster = pgTable('drug_master', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  drug_code: text('drug_code').notNull(),
  drug_name: text('drug_name').notNull(),
  generic_name: text('generic_name'),
  category: drugCategoryEnum('category').notNull(),
  strength: text('strength'),         // e.g., "500mg", "10ml"
  unit: text('unit'),                 // e.g., "tablet", "vial", "bottle"
  route: drugRouteEnum('route'),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  manufacturer: text('manufacturer'),
  hsn_code: text('hsn_code'),          // Harmonized System of Nomenclature
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  is_active: boolean('is_active').notNull().default(true),
  effective_date: timestamp('effective_date', { withTimezone: true }),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  drugCodeHospitalIdx: uniqueIndex('idx_drug_master_code_hospital').on(table.drug_code, table.hospital_id),
  categoryIdx: index('idx_drug_master_category').on(table.category),
  isActiveIdx: index('idx_drug_master_is_active').on(table.is_active),
  nameSearchIdx: index('idx_drug_master_name').on(table.drug_name),
  genericNameIdx: index('idx_drug_master_generic_name').on(table.generic_name),
  hospitalIdIdx: index('idx_drug_master_hospital_id').on(table.hospital_id),
  effectiveDateIdx: index('idx_drug_master_effective_date').on(table.effective_date),
}));

// ============================================================
// ORDER SETS (reusable order templates)
// ============================================================

export const orderSets = pgTable('order_sets', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),          // e.g., "Cardiology", "ICU", "Post-Op"
  is_active: boolean('is_active').notNull().default(true),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_order_sets_hospital_id').on(table.hospital_id),
  isActiveIdx: index('idx_order_sets_is_active').on(table.is_active),
  nameIdx: index('idx_order_sets_name').on(table.name),
}));

// ============================================================
// ORDER SET ITEMS (individual items within an order set)
// ============================================================

export const orderSetItems = pgTable('order_set_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  order_set_id: uuid('order_set_id').notNull().references(() => orderSets.id, { onDelete: 'cascade' }),
  item_type: orderItemTypeEnum('item_type').notNull(),
  reference_id: uuid('reference_id'),    // FK to charge_master or drug_master
  item_name: text('item_name').notNull(), // Denormalized for display
  frequency: text('frequency'),          // e.g., "TID", "BD", "STAT"
  duration: text('duration'),            // e.g., "5 days", "Until discharge"
  instructions: text('instructions'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderSetIdIdx: index('idx_order_set_items_order_set_id').on(table.order_set_id),
  itemTypeIdx: index('idx_order_set_items_item_type').on(table.item_type),
}));

// ============================================================
// CONSENT TEMPLATES (with version history)
// ============================================================

export const consentTemplates = pgTable('consent_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: consentCategoryEnum('category').notNull(),
  template_text: text('template_text').notNull(), // Rich text / HTML
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('active'), // active, draft, archived
  effective_date: timestamp('effective_date', { withTimezone: true }),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_consent_templates_hospital_id').on(table.hospital_id),
  categoryIdx: index('idx_consent_templates_category').on(table.category),
  nameVersionIdx: index('idx_consent_templates_name_version').on(table.name, table.version),
}));

// ============================================================
// DISCHARGE TEMPLATES (configurable discharge summary sections)
// ============================================================

export const dischargeTemplates = pgTable('discharge_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  clinical_fields: jsonb('clinical_fields').notNull().default([]),  // Array of field names: ["diagnosis", "medications", "follow_up", etc.]
  text_sections: jsonb('text_sections').notNull().default([]),     // Array of {title, default_text}
  is_active: boolean('is_active').notNull().default(true),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_discharge_templates_hospital_id').on(table.hospital_id),
  isActiveIdx: index('idx_discharge_templates_is_active').on(table.is_active),
}));

// ============================================================
// GST RATES (by category with effective dating)
// ============================================================

export const gstRates = pgTable('gst_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  category: text('category').notNull(),       // e.g., "room", "medication", "procedure"
  percentage: numeric('percentage', { precision: 5, scale: 2 }).notNull(),
  effective_date: timestamp('effective_date', { withTimezone: true }).notNull(),
  description: text('description'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  categoryHospitalDateIdx: index('idx_gst_rates_category_hospital_date').on(
    table.category, table.hospital_id, table.effective_date
  ),
  hospitalIdIdx: index('idx_gst_rates_hospital_id').on(table.hospital_id),
}));

// ============================================================
// APPROVAL HIERARCHIES (discount/write-off thresholds)
// ============================================================

export const approvalHierarchies = pgTable('approval_hierarchies', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  approval_type: approvalTypeEnum('approval_type').notNull(),
  levels: jsonb('levels').notNull().default([]), // Array of {threshold_min, threshold_max, approver_role, description}
  is_active: boolean('is_active').notNull().default(true),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  typeHospitalIdx: uniqueIndex('idx_approval_hierarchies_type_hospital').on(table.approval_type, table.hospital_id),
  hospitalIdIdx: index('idx_approval_hierarchies_hospital_id').on(table.hospital_id),
}));

// ============================================================
// NABH INDICATORS (quality indicators, 100+ seeded)
// ============================================================

export const nabhIndicators = pgTable('nabh_indicators', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  indicator_code: text('indicator_code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),          // e.g., "infection_control", "patient_safety", "medication_safety"
  calculation_type: text('calculation_type').notNull().default('manual'), // 'auto' or 'manual'
  target_value: numeric('target_value', { precision: 8, scale: 2 }),
  unit: text('unit'),                            // e.g., "%", "per 1000 patient days"
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  codeHospitalIdx: uniqueIndex('idx_nabh_indicators_code_hospital').on(table.indicator_code, table.hospital_id),
  categoryIdx: index('idx_nabh_indicators_category').on(table.category),
  hospitalIdIdx: index('idx_nabh_indicators_hospital_id').on(table.hospital_id),
}));

// ============================================================
// MASTER DATA VERSION HISTORY (immutable audit trail)
// ============================================================

export const masterDataVersionHistory = pgTable('master_data_version_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  entity_type: masterDataEntityTypeEnum('entity_type').notNull(),
  entity_id: uuid('entity_id').notNull(),
  version: integer('version').notNull(),
  old_data: jsonb('old_data'),
  new_data: jsonb('new_data').notNull(),
  changed_fields: jsonb('changed_fields'),    // Array of field names that changed
  actor_id: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actor_email: text('actor_email'),
  reason: text('reason'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entityIdx: index('idx_mdvh_entity').on(table.entity_type, table.entity_id),
  versionIdx: index('idx_mdvh_version').on(table.entity_id, table.version),
  timestampIdx: index('idx_mdvh_timestamp').on(table.timestamp),
  hospitalIdIdx: index('idx_mdvh_hospital_id').on(table.hospital_id),
  actorIdIdx: index('idx_mdvh_actor_id').on(table.actor_id),
}));

// ============================================================
// RELATIONS
// ============================================================

export const chargeMasterRelations = relations(chargeMaster, ({ one }) => ({
  hospital: one(hospitals, { fields: [chargeMaster.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [chargeMaster.created_by], references: [users.id], relationName: 'charge_created_by' }),
  updatedBy: one(users, { fields: [chargeMaster.updated_by], references: [users.id], relationName: 'charge_updated_by' }),
}));

export const drugMasterRelations = relations(drugMaster, ({ one }) => ({
  hospital: one(hospitals, { fields: [drugMaster.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [drugMaster.created_by], references: [users.id], relationName: 'drug_created_by' }),
  updatedBy: one(users, { fields: [drugMaster.updated_by], references: [users.id], relationName: 'drug_updated_by' }),
}));

export const orderSetsRelations = relations(orderSets, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [orderSets.hospital_id], references: [hospitals.hospital_id] }),
  items: many(orderSetItems),
  createdBy: one(users, { fields: [orderSets.created_by], references: [users.id], relationName: 'orderset_created_by' }),
  updatedBy: one(users, { fields: [orderSets.updated_by], references: [users.id], relationName: 'orderset_updated_by' }),
}));

export const orderSetItemsRelations = relations(orderSetItems, ({ one }) => ({
  orderSet: one(orderSets, { fields: [orderSetItems.order_set_id], references: [orderSets.id] }),
}));

export const consentTemplatesRelations = relations(consentTemplates, ({ one }) => ({
  hospital: one(hospitals, { fields: [consentTemplates.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [consentTemplates.created_by], references: [users.id], relationName: 'consent_created_by' }),
  updatedBy: one(users, { fields: [consentTemplates.updated_by], references: [users.id], relationName: 'consent_updated_by' }),
}));

export const dischargeTemplatesRelations = relations(dischargeTemplates, ({ one }) => ({
  hospital: one(hospitals, { fields: [dischargeTemplates.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [dischargeTemplates.created_by], references: [users.id], relationName: 'discharge_created_by' }),
  updatedBy: one(users, { fields: [dischargeTemplates.updated_by], references: [users.id], relationName: 'discharge_updated_by' }),
}));

export const gstRatesRelations = relations(gstRates, ({ one }) => ({
  hospital: one(hospitals, { fields: [gstRates.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [gstRates.created_by], references: [users.id], relationName: 'gst_created_by' }),
}));

export const approvalHierarchiesRelations = relations(approvalHierarchies, ({ one }) => ({
  hospital: one(hospitals, { fields: [approvalHierarchies.hospital_id], references: [hospitals.hospital_id] }),
  updatedBy: one(users, { fields: [approvalHierarchies.updated_by], references: [users.id], relationName: 'approval_updated_by' }),
}));

export const nabhIndicatorsRelations = relations(nabhIndicators, ({ one }) => ({
  hospital: one(hospitals, { fields: [nabhIndicators.hospital_id], references: [hospitals.hospital_id] }),
}));

export const masterDataVersionHistoryRelations = relations(masterDataVersionHistory, ({ one }) => ({
  hospital: one(hospitals, { fields: [masterDataVersionHistory.hospital_id], references: [hospitals.hospital_id] }),
  actor: one(users, { fields: [masterDataVersionHistory.actor_id], references: [users.id] }),
}));
