import {
  pgTable, text, uuid, integer, numeric, timestamp, boolean, jsonb,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { inventoryItems } from './66-codes';
import { serviceCodes } from './68-service-codes';

// =============================================================================
// CODES MODULE — Phase 4 (Charge Tiers Refactor)
// =============================================================================
// Unified `code_charge_tiers` replaces 7 legacy charge tables:
//   - 01-master-data.ts charge_master              (legacy v1)
//   - 62-billing-v3.ts charge_master_item          (BV3.1)
//   - 62-billing-v3.ts charge_master_price         (BV3.1)
//   - 62-billing-v3.ts charge_master_package       (BV3.1)
//   - 62-billing-v3.ts charge_master_room          (BV3.1)
//   - 62-billing-v3.ts charge_master_tariff_import (BV3.1)
//   - 62-billing-v3.ts charge_master_hospital_setting (BV3.1)
//
// Per Q6 — 4-sub-phase rollout (compressed to 2 sub-phases since not parallel
// to Pharmacy refactor):
//   4a (this commit): schema shadow + 21 rule seeds + backfill from existing
//                     charge_master_price/_package/_room → reads via codes.chargeTiers
//   4b (later):       writes-switch + tariff-editor write UX + reconciliation
//                     against billing-v2 sample
//   Phase 4-Pharmacy:  legacy table archive (when Pharmacy module refactor sprints fire)
//
// Polymorphic FK pattern (A2 lock): two nullable FKs (item_id / service_id)
// with CHECK exactly-one. Real DB-layer constraint on referential integrity
// instead of app-layer discriminator.
// =============================================================================

// ---------- 1. code_charge_tiers — the unified canonical price table ----------

export const codeChargeTiers = pgTable('code_charge_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  /**
   * Polymorphic code reference — exactly one of item_id / service_id is set.
   * CHECK constraint enforces this in migration SQL.
   *   - item_id  → inventory_items (drugs, consumables, items)
   *   - service_id → service_codes (procedures, labs, imaging, packages, rooms, fees)
   */
  item_id: uuid('item_id').references(() => inventoryItems.id, { onDelete: 'cascade' }),
  service_id: uuid('service_id').references(() => serviceCodes.id, { onDelete: 'cascade' }),

  /**
   * code_kind discriminator — denormalized from item/service for query speed.
   * Set by trigger or app-layer; CHECK enum: 'item' | 'service'.
   */
  code_kind: text('code_kind').notNull(),

  /**
   * class_code — bv3.1.E enum + extensions:
   *   GENERAL / SEMI_PVT / PVT / ICU / SUITE / HDU / ER / OPD / _PACKAGE / _ANY
   * CHECK enum enforced in migration SQL.
   */
  class_code: text('class_code').notNull(),

  /**
   * Empanelment override — null = standard tariff; FK to empanelment_id when
   * this row represents a corporate/insurance/TPA override price.
   */
  empanelment_id: uuid('empanelment_id'),

  /** Effective dating — historical bills resolve via effective_from <= bill_date <= effective_to. */
  effective_from: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  /** NULL = currently active. UPDATE sets effective_to and INSERTs a new row to preserve history. */
  effective_to: timestamp('effective_to', { withTimezone: true }),

  /** Price in INR. */
  price_inr: numeric('price_inr', { precision: 14, scale: 2 }).notNull(),

  /**
   * Open-billing flag (BV3 legacy). When true, suite-class patients get
   * itemized billing instead of fixed package price.
   */
  is_open_billing: boolean('is_open_billing').notNull().default(false),

  /** For package codes: count of member services in the package. 0 for non-packages. */
  package_member_count: integer('package_member_count').notNull().default(0),

  /** GST percentage applicable. */
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),

  /** Provenance — 'charge_master_price' / 'charge_master_package' / 'charge_master_room' / 'tariff_import' / 'manual'. */
  source: text('source').notNull().default('manual'),
  source_ref: jsonb('source_ref'),
  notes: text('notes'),

  audit_user_id: uuid('audit_user_id').references(() => users.id, { onDelete: 'set null' }),
  audit_timestamp: timestamp('audit_timestamp', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  itemIdx: index('idx_code_charge_tiers_item').on(t.item_id),
  serviceIdx: index('idx_code_charge_tiers_service').on(t.service_id),
  // Hot path: current price for (code, class).
  currentItemIdx: index('idx_code_charge_tiers_current_item').on(t.item_id, t.class_code),
  currentServiceIdx: index('idx_code_charge_tiers_current_service').on(t.service_id, t.class_code),
  classIdx: index('idx_code_charge_tiers_class').on(t.class_code),
  empanelmentIdx: index('idx_code_charge_tiers_empanelment').on(t.empanelment_id),
  hospitalIdx: index('idx_code_charge_tiers_hospital').on(t.hospital_id),
}));

export type CodeChargeTier = typeof codeChargeTiers.$inferSelect;


// ---------- 2. code_charge_rules — declarative rule engine ----------

export const codeChargeRules = pgTable('code_charge_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  /**
   * rule_type CHECK enum: 'surcharge' | 'discount' | 'formula' | 'restriction' | 'audit_trigger'
   */
  rule_type: text('rule_type').notNull(),
  rule_name: text('rule_name').notNull(),
  /** Free-form description for ops. */
  description: text('description'),
  /**
   * applies_to_code_kind: 'item' | 'service' | 'procedure' | 'consultation' | 'bed' | 'package' | 'all'
   */
  applies_to_code_kind: text('applies_to_code_kind').notNull().default('all'),
  /**
   * Declarative formula spec — interpreted by BV3 Phase 4 bill builder.
   * Shape varies per rule_type; example:
   *   { type: 'progressive_pct', tiers: [100, 60, 60] }
   *   { type: 'flat_pct', value: 15, applies_to: 'professional_charges' }
   *   { type: 'time_window', from_hour: 21, to_hour: 8, multiplier: 1.5 }
   */
  formula_json: jsonb('formula_json').notNull(),
  /** Lower priority fires first when multiple rules match. */
  priority: integer('priority').notNull().default(100),
  effective_from: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effective_to: timestamp('effective_to', { withTimezone: true }),
  is_active: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalRuleIdx: uniqueIndex('idx_code_charge_rules_hospital_name').on(t.hospital_id, t.rule_name),
  ruleTypeIdx: index('idx_code_charge_rules_type').on(t.rule_type),
  isActiveIdx: index('idx_code_charge_rules_active').on(t.is_active),
}));

export type CodeChargeRule = typeof codeChargeRules.$inferSelect;


// ---------- 3. code_charge_empanelments — corporate/TPA/insurance overrides ----------

export const codeChargeEmpanelments = pgTable('code_charge_empanelments', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  empanelment_name: text('empanelment_name').notNull(),
  /** empanelment_type CHECK: 'tpa' | 'corporate' | 'insurance' | 'govt_scheme' | 'self' */
  empanelment_type: text('empanelment_type').notNull(),
  agreement_number: text('agreement_number'),
  effective_from: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effective_to: timestamp('effective_to', { withTimezone: true }),
  contact_person: text('contact_person'),
  contact_phone: text('contact_phone'),
  contact_email: text('contact_email'),
  is_active: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameHospitalIdx: uniqueIndex('idx_code_charge_empanelments_name_hospital').on(t.hospital_id, t.empanelment_name),
  typeIdx: index('idx_code_charge_empanelments_type').on(t.empanelment_type),
  isActiveIdx: index('idx_code_charge_empanelments_active').on(t.is_active),
}));

export type CodeChargeEmpanelment = typeof codeChargeEmpanelments.$inferSelect;


// ---------- 4. charge_tier_imports — staging for tariff PDF imports ----------

export const chargeTierImports = pgTable('charge_tier_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  /** import_kind CHECK: 'rooms' | 'packages' | 'investigations' | 'mixed' */
  import_kind: text('import_kind').notNull(),
  source_filename: text('source_filename').notNull(),
  source_bytes: integer('source_bytes'),
  /** Staged rows pre-MDO-review. Shape: { service_code, class_code, price, ... } */
  staged_rows: jsonb('staged_rows').notNull().default('[]'),
  rows_total: integer('rows_total').notNull().default(0),
  rows_applied: integer('rows_applied').notNull().default(0),
  rows_rejected: integer('rows_rejected').notNull().default(0),
  /** status CHECK: 'pending_review' | 'approved' | 'partial' | 'rejected' | 'applied' */
  status: text('status').notNull().default('pending_review'),
  uploaded_by: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  reviewed_by: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  applied_at: timestamp('applied_at', { withTimezone: true }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalCreatedIdx: index('idx_charge_tier_imports_hospital_created').on(t.hospital_id, t.created_at),
  statusIdx: index('idx_charge_tier_imports_status').on(t.status),
}));

export type ChargeTierImport = typeof chargeTierImports.$inferSelect;


// ---------- Constants ----------

export const CHARGE_TIER_CLASSES = ['GENERAL','SEMI_PVT','PVT','ICU','SUITE','HDU','ER','OPD','_PACKAGE','_ANY'] as const;
export type ChargeTierClass = typeof CHARGE_TIER_CLASSES[number];

export const CODE_CHARGE_RULE_TYPES = ['surcharge','discount','formula','restriction','audit_trigger'] as const;
export type CodeChargeRuleType = typeof CODE_CHARGE_RULE_TYPES[number];

export const EMPANELMENT_TYPES = ['tpa','corporate','insurance','govt_scheme','self'] as const;
export type EmpanelmentType = typeof EMPANELMENT_TYPES[number];
