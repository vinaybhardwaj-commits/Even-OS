import {
  pgTable, text, uuid, integer, numeric, timestamp, index, uniqueIndex, boolean, jsonb,
} from 'drizzle-orm/pg-core';

// ============================================================
// CODES MODULE — Phase 1 (Cannibalize CodeCreator)
//
// Mirrors CodeCreator's src/db/schema.ts. Tables ALREADY EXIST in the
// Even OS Neon DB (CodeCreator wrote them); this file just gives Even OS
// Drizzle types so the new appRouter.codes.* router and tRPC clients
// can JOIN against `inventory_*` tables type-safely.
//
// 11 inventory_* tables, 4,925+ rows live in production as of 30 Apr 2026.
// 8 placeholder test rows in inventory_items will be cleaned up in 1.5.
//
// Lifecycle: Phase 6 (PRD §11) introduces a `codes` view/table that
// supersedes this raw layout. For Phase 1 we work with the canonical
// inventory_* tables exactly as CodeCreator left them.
//
// SOP source: EVEN-HOS-004 v1.1 (Yash Sharma, 12 Jun 2025).
// ============================================================

// ---------- Lookups (editable in /admin/codes/settings) ----------

export const inventoryLookupCategories = pgTable('inventory_lookup_categories', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLookupStorageCodes = pgTable('inventory_lookup_storage_codes', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLookupClassificationCodes = pgTable('inventory_lookup_classification_codes', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLookupItemTypes = pgTable('inventory_lookup_item_types', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLookupForms = pgTable('inventory_lookup_forms', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLookupStrengthUnits = pgTable('inventory_lookup_strength_units', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLookupIssueUnits = pgTable('inventory_lookup_issue_units', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Core: inventory_items (4,825 rows) ----------

export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  item_code: text('item_code').notNull(),
  category_code: text('category_code').notNull(),
  storage_code: text('storage_code').notNull(),
  classification_code: text('classification_code').notNull(),
  serial: integer('serial').notNull(),
  item_type: text('item_type').notNull(),
  item_display_name: text('item_display_name').notNull(),
  item_name: text('item_name'),
  generic_name_chain: text('generic_name_chain'),
  form: text('form'),
  strength_chain: text('strength_chain'),
  strength_unit: text('strength_unit'),
  brand: text('brand'),
  pack_size: integer('pack_size'),
  manufacturer: text('manufacturer'),
  hsn_code: text('hsn_code'),
  tax_detail: text('tax_detail'),
  price_type: text('price_type').default('mrp'),
  issue_unit: text('issue_unit'),
  conversion: numeric('conversion', { precision: 10, scale: 2 }).default('1.0'),
  purchase_unit: text('purchase_unit'),
  close_for_sale: text('close_for_sale').default('N'),
  item_category: text('item_category'),
  item_sub_category: text('item_sub_category'),
  /** 'imported_legacy' | 'codecreator' */
  source: text('source').notNull(),
  /**
   * Approval workflow state (Phase 2 — SOP §5.6 enforcement). One of:
   *   draft | pending_clinical_review | pending_master_data_review |
   *   pending_cms_gm_review | active | rejected
   *
   * - Existing rows (pre-Phase-2) backfilled to 'active' via Phase 2.1.b
   *   bootstrap (one historical codes_approval_history row per item).
   * - NEW rows default to 'draft' (per A2: no super_admin bypass).
   * - CPOE / billing blocked on status != 'active' (per Q3 server-side gate).
   *
   * CHECK constraint enforced in 0064_codes_approval_workflow.sql.
   */
  status: text('status').notNull().default('draft'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  itemCodeUq: uniqueIndex('inventory_items_item_code_uq').on(t.item_code),
  bucketIdx: index('inventory_items_bucket_idx').on(t.category_code, t.storage_code, t.classification_code),
  // Functional unique on lower(item_display_name) + GIN search index live in
  // CodeCreator's 0001_inventory_tables.sql migration (already applied to prod).
}));

// ---------- Compositions ----------

export const inventoryCompositions = pgTable('inventory_compositions', {
  id: uuid('id').primaryKey().defaultRandom(),
  item_id: uuid('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  generic_name: text('generic_name').notNull(),
  strength_value: numeric('strength_value', { precision: 10, scale: 3 }).notNull(),
  strength_unit: text('strength_unit').notNull(),
  position: integer('position').notNull(),
});

// ---------- Per-bucket monotonic serial counters ----------

export const inventorySerialCounters = pgTable('inventory_serial_counters', {
  /** e.g. 'M-N-PH', 'L-T-LC' */
  bucket: text('bucket').primaryKey(),
  last_serial: integer('last_serial').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Bad-codes review queue ----------

export const inventoryBadCodesReview = pgTable('inventory_bad_codes_review', {
  id: uuid('id').primaryKey().defaultRandom(),
  original_row_data: jsonb('original_row_data').notNull(),
  original_item_code: text('original_item_code'),
  /**
   * 'malformed_code' | 'duplicate_code' | 'unknown_classification' |
   * 'unknown_storage' | 'unknown_category' | 'hsn_in_code_column' |
   * 'extra_segments' | 'duplicate_display_name'
   */
  flag_reason: text('flag_reason').notNull(),
  flag_detail: text('flag_detail'),
  notes: text('notes'),
  /** 'open' | 'ignored' | 'fixed' */
  status: text('status').notNull().default('open'),
  imported_at: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Lookup-kind metadata (matches CodeCreator src/lib/lookup-kinds.ts) ----------

export type LookupKind =
  | 'categories'
  | 'storage_codes'
  | 'classification_codes'
  | 'item_types'
  | 'forms'
  | 'strength_units'
  | 'issue_units';

export const LOOKUP_KINDS: ReadonlyArray<{
  kind: LookupKind;
  table: string;
  label: string;
  hasDescription: boolean;
  codePattern: RegExp;
  codeHint: string;
}> = [
  { kind: 'categories',           table: 'inventory_lookup_categories',           label: 'Categories',           hasDescription: true,  codePattern: /^[A-Z]$/,    codeHint: 'Single uppercase letter (e.g. M, E, G, L, A)' },
  { kind: 'storage_codes',        table: 'inventory_lookup_storage_codes',        label: 'Storage codes',        hasDescription: true,  codePattern: /^[A-Z]$/,    codeHint: 'Single uppercase letter (e.g. N, T, C, O)' },
  { kind: 'classification_codes', table: 'inventory_lookup_classification_codes', label: 'Classification codes', hasDescription: true,  codePattern: /^[A-Z]{2}$/, codeHint: 'Two uppercase letters (e.g. PH, SG, IM, LC)' },
  { kind: 'item_types',           table: 'inventory_lookup_item_types',           label: 'Item types',           hasDescription: false, codePattern: /^.{1,50}$/,  codeHint: 'Short label (1-50 chars)' },
  { kind: 'forms',                table: 'inventory_lookup_forms',                label: 'Forms (dosage)',       hasDescription: false, codePattern: /^.{1,40}$/,  codeHint: 'e.g. Tablet, Syrup, Lozenge' },
  { kind: 'strength_units',       table: 'inventory_lookup_strength_units',       label: 'Strength units',       hasDescription: false, codePattern: /^.{1,10}$/,  codeHint: 'e.g. mg, ml, IU, mcg' },
  { kind: 'issue_units',          table: 'inventory_lookup_issue_units',          label: 'Issue units',          hasDescription: false, codePattern: /^.{1,30}$/,  codeHint: 'e.g. NOS, Each, Strip, Bottle' },
];

export function getLookupKindMeta(kind: string) {
  return LOOKUP_KINDS.find((k) => k.kind === kind);
}
