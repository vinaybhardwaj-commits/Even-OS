import {
  pgTable, text, boolean, timestamp, integer, jsonb,
  index, uuid, numeric, uniqueIndex, date, primaryKey,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { drugMaster } from './01-master-data';
import { vendors } from './12-pharmacy';

// ============================================================
// SCM CORE — FOUNDATION SCHEMA (PRD #2 Phase 1)
//
// Multi-tenancy: 4 hospitals from day 1 (EHRC + EHBR + EHIN + Brookfield)
// per V's 30 Apr 2026 December big-bang lock. Every per-hospital row
// has hospital_id text NOT NULL → hospitals.hospital_id.
//
// Codes integration: items.code_id is nullable polymorphic FK reserved for
// Codes Module Phase 1 ship (Codes Q3). Until then, items live standalone
// with optional drug_master backfill via items.external_drug_id.
//
// Billing v3 integration: stock_movements.source_emit_event_id links to
// charge_items emit (Billing v3 Q1 + Q14 dual-posting pattern). The
// charge_items table itself ships in Billing v3 Phase 1 (62-billing-v3.ts
// already has the schema; migration not applied).
//
// SoD enforcement (KPMG): purchase_requisitions.created_by user role must
// be mutually-exclusive with purchase_orders.created_by user role
// (po_create ⊕ pr_create ⊕ grn_create). Enforced at app layer via
// middleware (Phase 1.5+); schema captures the relational shape.
//
// Convention notes (matching 62-billing-v3.ts):
//   - Status / kind / role fields modeled as `text` with CHECK constraints
//     in the SQL migration (avoids pgEnum schema-migration friction)
//   - Money is numeric(14, 2). Quantity is numeric(12, 3).
//   - Timestamps are timestamptz + defaultNow()
//   - hospital_id is text → hospitals.hospital_id (codebase convention)
//   - Reversal pattern (self-FK + opposite-signed quantity) for ledger tables
//   - Audit columns (created_by, created_at, updated_at) on every table
//
// Cross-PRD references:
//   - prds/SCM_Core/__decisions.md (Q1-Q12 locked)
//   - prds/SCM_Core/__build_plan.md (Phase 1.1 deliverable; this file)
//   - prds/__DEFERRED_REGISTRY.md (DR-0019 to DR-0036 SCM v1.5/v2 items)
// ============================================================

// ============================================================
// 1. ITEMS — Universal item master
//    Replaces drug-only pharmacy_inventory.drug_id pattern with
//    polymorphic kind + Codes Layer 1 FK (when ready).
//    `hospital_id` nullable: items can be network-shared (Codes Q8)
//    with per-hospital overrides via items_per_hospital_overrides.
// ============================================================
export const items = pgTable('items', {
  id: uuid('id').defaultRandom().primaryKey(),

  hospital_id: text('hospital_id').references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  // null = network-shared per Codes Q8 multi-tenancy pattern

  code: text('code').notNull(),                       // SOP format: M-N-PH-00001 etc.
  display_name: text('display_name').notNull(),

  // Polymorphic kind (extensible via app-layer registry)
  kind: text('kind').notNull(),
  // CHECK kind IN ('drug','consumable','implant','reagent','linen','cssd_pack','equipment_spare','general')

  // SOP v1.2 taxonomy fields (Codes Q10 ratification)
  storage_class: text('storage_class'),               // N=Normal T=Temp-controlled O=Other C=Cold-Chain
  classification_code: text('classification_code'),   // PH/SG/CH/RG/IM/LC/.../etc

  // Item display name composition (per SOP §5.4)
  generic_name: text('generic_name'),
  form: text('form'),                                 // tab/cap/syrup/inj
  strength: text('strength'),
  brand: text('brand'),
  pack_size: text('pack_size'),

  unit_of_measure: text('unit_of_measure').notNull(), // tab/ml/mg/vial/box

  // GST classification (Indian tax)
  hsn_code: text('hsn_code'),
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }),

  manufacturer: text('manufacturer'),
  preferred_vendor_id: uuid('preferred_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),

  // ====== Codes integration (Codes Q3) ======
  // Nullable until Codes Phase 1 ships the codes table.
  // After Codes Phase 1, every item must have code_id; backfilled
  // via Phase 1.3 backfill-items-from-pharmacy.ts script.
  code_id: uuid('code_id'),
  code_kind: text('code_kind'),                       // 'drug'|'item_consumable'|...

  // ====== Drug master backfill (transitional) ======
  external_drug_id: uuid('external_drug_id').references(() => drugMaster.id, { onDelete: 'set null' }),
  external_drug_master_synced_at: timestamp('external_drug_master_synced_at', { withTimezone: true }),

  // ====== Reorder defaults (overridable per inventory location) ======
  default_reorder_level: numeric('default_reorder_level', { precision: 12, scale: 3 }),
  default_reorder_quantity: numeric('default_reorder_quantity', { precision: 12, scale: 3 }),
  default_max_stock_level: numeric('default_max_stock_level', { precision: 12, scale: 3 }),
  auto_reorder_enabled: boolean('auto_reorder_enabled').notNull().default(false),

  // ====== KPMG material classification (Q9) ======
  material_classification_id: uuid('material_classification_id'), // FK to material_classifications.id (defined below)
  handling_rules_apply: jsonb('handling_rules_apply'),
  // Array of: cold_chain | lasa | high_alert | narcotic | consigned | bulky | returned_cut_strip

  // ====== Lifecycle (Codes Q3 5-state machine + Q12 deprecation) ======
  status: text('status').notNull().default('pending_master_data_review'),
  // CHECK status IN ('pending_clinical_review','pending_master_data_review','pending_cms_gm_review',
  //                  'active','deprecated_grace','deprecated','archived','rejected')

  deprecated_at: timestamp('deprecated_at', { withTimezone: true }),
  deprecated_by: uuid('deprecated_by').references(() => users.id, { onDelete: 'set null' }),
  deprecation_reason: text('deprecation_reason'),
  deprecation_urgency_tier: text('deprecation_urgency_tier'),
  // CHECK urgency_tier IN ('routine','urgent','emergency') -- Codes Q12

  // Audit (Codes Q3 + Pharmacy v2 Q2 RBAC roles)
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_items_hospital').on(table.hospital_id),
  codeIdx: uniqueIndex('idx_items_code').on(table.code),
  kindIdx: index('idx_items_kind').on(table.kind),
  statusIdx: index('idx_items_status').on(table.status),
  codeIdIdx: index('idx_items_code_id').on(table.code_id),
  externalDrugIdx: index('idx_items_external_drug').on(table.external_drug_id),
  hospitalKindStatusIdx: index('idx_items_hospital_kind_status').on(table.hospital_id, table.kind, table.status),
}));

// ============================================================
// 2. INVENTORY — Universal multi-location, multi-batch
//    One row per (hospital_id, item_id, location, batch_number)
// ============================================================
export const inventory = pgTable('inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),

  location: text('location').notNull(),
  // Free-form initially; v1.5 introduces locations master per per-hospital
  // Examples: main_pharmacy, satellite_pharmacy_a, ward_3, icu_stock,
  // ot_stock, cssd_store, lab_cold_storage, ris_contrast_store

  batch_number: text('batch_number'),
  manufacturer: text('manufacturer'),
  expiry_date: date('expiry_date'),

  quantity_on_hand: numeric('quantity_on_hand', { precision: 12, scale: 3 }).notNull().default('0'),
  quantity_reserved: numeric('quantity_reserved', { precision: 12, scale: 3 }).notNull().default('0'),
  quantity_in_transit: numeric('quantity_in_transit', { precision: 12, scale: 3 }).notNull().default('0'),
  // quantity_available is computed in views, not stored, to avoid drift

  unit_cost: numeric('unit_cost', { precision: 12, scale: 2 }),       // weighted average; updated on GRN
  mrp: numeric('mrp', { precision: 12, scale: 2 }),

  // Per-location reorder overrides (otherwise items.default_*)
  reorder_level: numeric('reorder_level', { precision: 12, scale: 3 }),
  reorder_quantity: numeric('reorder_quantity', { precision: 12, scale: 3 }),
  max_stock_level: numeric('max_stock_level', { precision: 12, scale: 3 }),

  last_movement_at: timestamp('last_movement_at', { withTimezone: true }),
  last_restocked_at: timestamp('last_restocked_at', { withTimezone: true }),

  is_active: boolean('is_active').notNull().default(true),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_inventory_hospital').on(table.hospital_id),
  itemIdx: index('idx_inventory_item').on(table.item_id),
  locationIdx: index('idx_inventory_location').on(table.hospital_id, table.location),
  batchIdx: index('idx_inventory_batch').on(table.item_id, table.batch_number),
  expiryIdx: index('idx_inventory_expiry').on(table.expiry_date),
  // Negative inventory blocked by CHECK constraint in migration
  // CHECK (quantity_on_hand >= 0 AND quantity_reserved >= 0 AND quantity_in_transit >= 0)
  uniqueLocationBatch: uniqueIndex('uq_inventory_location_batch')
    .on(table.hospital_id, table.item_id, table.location, table.batch_number),
}));

// ============================================================
// 3. STOCK MOVEMENTS — Universal append-only ledger
//    Every receipt, issue, return, adjustment, transfer, write-off.
//    Reversal pattern (self-FK + opposite-signed quantity).
//    Source provenance (source_module + source_ref_id) per Billing v3 Q1.
// ============================================================
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  inventory_id: uuid('inventory_id').references(() => inventory.id, { onDelete: 'set null' }),
  // nullable to preserve history if inventory row hard-deleted (rare)
  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  item_name: text('item_name').notNull(),                // denormalized at write-time

  movement_type: text('movement_type').notNull(),
  // CHECK movement_type IN (
  //   'grn_receive', 'issue', 'return', 'adjustment_increase', 'adjustment_decrease',
  //   'transfer_out', 'transfer_in',
  //   'write_off_expiry', 'write_off_damage', 'write_off_theft', 'write_off_other',
  //   'reversal'
  // )

  quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(), // signed
  previous_balance: numeric('previous_balance', { precision: 12, scale: 3 }).notNull(),
  new_balance: numeric('new_balance', { precision: 12, scale: 3 }).notNull(),

  batch_number: text('batch_number'),
  location: text('location').notNull(),

  // ====== Source provenance (Billing v3 Q1 pattern) ======
  source_module: text('source_module').notNull(),
  // CHECK source_module IN ('scm','pharmacy','ot','lims','ris','facilities','manual')
  source_ref_id: uuid('source_ref_id'),                 // grn.id / issue.id / dispense.id / etc.
  source_emit_event_id: uuid('source_emit_event_id'),   // links to charge_items.id (Billing v3 Q14 dual-posting)

  // ====== Charge integration (Pharmacy v2 Q6 + Billing v3 Q14 cost-allocation) ======
  charge_item_id: uuid('charge_item_id'),                // FK once Billing v3 Phase 1 ships charge_items table
  cost_center_code: text('cost_center_code'),

  unit_cost: numeric('unit_cost', { precision: 12, scale: 2 }),
  total_value: numeric('total_value', { precision: 14, scale: 2 }),

  // ====== Reversal pattern ======
  reverses_movement_id: uuid('reverses_movement_id'),    // self-FK; ALTER TABLE in migration
  reversal_reason: text('reversal_reason'),

  // ====== Vendor + GRN refs (for grn_receive movements) ======
  vendor_id: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  grn_id: uuid('grn_id'),                                // FK to goods_receipt_notes.id (defined below)

  reason: text('reason'),
  notes: text('notes'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // No updated_at: append-only ledger
}, (table) => ({
  hospitalIdx: index('idx_stock_movements_hospital').on(table.hospital_id),
  inventoryIdx: index('idx_stock_movements_inventory').on(table.inventory_id),
  itemIdx: index('idx_stock_movements_item').on(table.item_id),
  typeIdx: index('idx_stock_movements_type').on(table.movement_type),
  sourceIdx: index('idx_stock_movements_source').on(table.source_module, table.source_ref_id),
  emitEventIdx: index('idx_stock_movements_emit_event').on(table.source_emit_event_id),
  reversesIdx: index('idx_stock_movements_reverses').on(table.reverses_movement_id),
  hospitalCreatedAtIdx: index('idx_stock_movements_hospital_created_at').on(table.hospital_id, table.created_at),
}));

// ============================================================
// 4. PURCHASE REQUISITIONS — Pre-PO step (KPMG SoD)
//    Distinct from purchase_orders. Created_by must NOT also have
//    po_create permission (enforced at RBAC middleware in Phase 1.6).
// ============================================================
export const purchaseRequisitions = pgTable('purchase_requisitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  pr_number: text('pr_number').notNull(),               // PR-2026-EHRC-00001
  requisition_type: text('requisition_type').notNull(),
  // CHECK type IN ('inventory_replenishment','capex','service','consumable_emergency','consignment','tender_based')

  status: text('status').notNull().default('draft'),
  // CHECK status IN ('draft','submitted','pr_approved','pr_rejected','pr_converted_to_po','cancelled')

  requested_for_location: text('requested_for_location'),
  priority: text('priority').notNull().default('routine'),
  // CHECK priority IN ('routine','urgent','emergency','stat')

  material_classification: text('material_classification'),
  // CHECK material_classification IN ('standard','emergency','vital') -- KPMG Q9

  estimated_total_amount: numeric('estimated_total_amount', { precision: 14, scale: 2 }),
  needed_by: date('needed_by'),

  // ====== KPMG approval matrix tier (Codes Q3 + SCM Phase 9 Q9) ======
  approver_role: text('approver_role'),
  // CHECK approver_role IN ('hod','procurement_head','finance_in_charge','facility_director')
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('approved_at', { withTimezone: true }),

  rejected_by: uuid('rejected_by').references(() => users.id, { onDelete: 'set null' }),
  rejected_at: timestamp('rejected_at', { withTimezone: true }),
  rejection_reason: text('rejection_reason'),

  // PR → PO conversion (one-to-many possible)
  converted_to_po_ids: uuid('converted_to_po_ids').array(),
  converted_at: timestamp('converted_at', { withTimezone: true }),

  notes: text('notes'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_pr_hospital').on(table.hospital_id),
  prNumberIdx: uniqueIndex('idx_pr_number').on(table.hospital_id, table.pr_number),
  statusIdx: index('idx_pr_status').on(table.status),
  typeIdx: index('idx_pr_type').on(table.requisition_type),
  classificationIdx: index('idx_pr_classification').on(table.material_classification),
}));

export const purchaseRequisitionItems = pgTable('purchase_requisition_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  pr_id: uuid('pr_id').notNull().references(() => purchaseRequisitions.id, { onDelete: 'cascade' }),

  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  item_name: text('item_name').notNull(),

  quantity_requested: numeric('quantity_requested', { precision: 12, scale: 3 }).notNull(),
  estimated_unit_cost: numeric('estimated_unit_cost', { precision: 12, scale: 2 }),
  estimated_total: numeric('estimated_total', { precision: 14, scale: 2 }),

  notes: text('notes'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  prIdx: index('idx_pri_pr').on(table.pr_id),
  itemIdx: index('idx_pri_item').on(table.item_id),
  hospitalIdx: index('idx_pri_hospital').on(table.hospital_id),
}));

// ============================================================
// 5. PURCHASE ORDERS — Universal (replaces drug-only pharmacy purchase_orders)
//    Extended states (per build plan §11 Phase 3): partially_received added.
//    Tier-routed approval per KPMG matrix (≤₹50K HOD / ₹50K-2L Procurement Head /
//    ₹2L-10L Finance / ≥₹10L Facility Director).
// ============================================================
export const purchaseOrders = pgTable('purchase_orders', {
  // Note: table name 'purchase_orders' to avoid collision with existing
  // 12-pharmacy.ts purchase_orders during migration. Phase 8 cutover renames
  // this to 'purchase_orders' after dropping the legacy pharmacy variant.
  // (Reconsidering Path A no-_v2 lock — table renames are deferred not avoided
  //  because the name collision needs resolution. Documented in build plan.)
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  po_number: text('po_number').notNull(),
  pr_id: uuid('pr_id').references(() => purchaseRequisitions.id, { onDelete: 'set null' }),
  // nullable: direct POs (rare, requires high-tier approval) bypass PR

  vendor_id: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'restrict' }),

  status: text('status').notNull().default('draft'),
  // CHECK status IN ('draft','approved','sent_to_vendor','partially_received','received','closed','cancelled')

  total_items: integer('total_items').notNull().default(0),
  total_amount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),

  expected_delivery: date('expected_delivery'),
  delivery_address: text('delivery_address'),

  // KPMG approval tier
  approver_role: text('approver_role'),
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  cms_gm_approved_by: uuid('cms_gm_approved_by').references(() => users.id, { onDelete: 'set null' }),
  cms_gm_approved_at: timestamp('cms_gm_approved_at', { withTimezone: true }),
  // ≥₹10L requires Facility Director / GM co-approval; columns capture both

  // Vendor communication
  sent_to_vendor_at: timestamp('sent_to_vendor_at', { withTimezone: true }),
  vendor_acknowledged_at: timestamp('vendor_acknowledged_at', { withTimezone: true }),

  // Receipt tracking
  first_received_at: timestamp('first_received_at', { withTimezone: true }),
  fully_received_at: timestamp('fully_received_at', { withTimezone: true }),
  closed_at: timestamp('closed_at', { withTimezone: true }),

  notes: text('notes'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_po_hospital').on(table.hospital_id),
  poNumberIdx: uniqueIndex('idx_po_number').on(table.hospital_id, table.po_number),
  vendorIdx: index('idx_po_vendor').on(table.vendor_id),
  statusIdx: index('idx_po_status').on(table.status),
  prIdx: index('idx_po_pr').on(table.pr_id),
}));

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  po_id: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),

  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  item_name: text('item_name').notNull(),

  quantity_ordered: numeric('quantity_ordered', { precision: 12, scale: 3 }).notNull(),
  quantity_received: numeric('quantity_received', { precision: 12, scale: 3 }).notNull().default('0'),

  unit_cost: numeric('unit_cost', { precision: 12, scale: 2 }).notNull(),
  total_cost: numeric('total_cost', { precision: 14, scale: 2 }),

  // Per-line specifics
  expected_batch_count: integer('expected_batch_count'),
  preferred_manufacturer: text('preferred_manufacturer'),
  notes: text('notes'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  poIdx: index('idx_poi_po').on(table.po_id),
  itemIdx: index('idx_poi_item').on(table.item_id),
  hospitalIdx: index('idx_poi_hospital').on(table.hospital_id),
}));

// ============================================================
// 6. GOODS RECEIPT NOTES — receive against PO (KPMG 10-item checklist)
//    Multi-batch, multi-line. Triggers stock_movements (grn_receive)
//    + 3-way match against vendor_invoices.
// ============================================================
export const goodsReceiptNotes = pgTable('goods_receipt_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  grn_number: text('grn_number').notNull(),
  po_id: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'restrict' }),
  vendor_id: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'restrict' }),

  status: text('status').notNull().default('draft'),
  // CHECK status IN ('draft','inspection_in_progress','submitted','accepted','partially_accepted','rejected')

  // Vendor invoice reference (3-way match)
  vendor_invoice_number: text('vendor_invoice_number'),
  vendor_invoice_date: date('vendor_invoice_date'),
  vendor_invoice_amount: numeric('vendor_invoice_amount', { precision: 14, scale: 2 }),

  // 3-way match (Phase 3)
  three_way_match_status: text('three_way_match_status'),
  // CHECK status IN ('pending','matched','variance_flagged','variance_approved','variance_rejected')
  variance_amount: numeric('variance_amount', { precision: 14, scale: 2 }),
  variance_approved_by: uuid('variance_approved_by').references(() => users.id, { onDelete: 'set null' }),
  variance_approved_at: timestamp('variance_approved_at', { withTimezone: true }),

  // KPMG 10-item inspection checklist results
  inspection_checklist_id: uuid('inspection_checklist_id'),  // FK to inspection_checklist_results.id
  inspection_passed: boolean('inspection_passed'),

  received_at: timestamp('received_at', { withTimezone: true }),
  payment_terms_days: integer('payment_terms_days'),  // copied from vendor at GRN time
  payment_due_date: date('payment_due_date'),

  notes: text('notes'),

  // Audit (SoD: created_by must NOT have po_create or pr_create permission)
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_grn_hospital').on(table.hospital_id),
  grnNumberIdx: uniqueIndex('idx_grn_number').on(table.hospital_id, table.grn_number),
  poIdx: index('idx_grn_po').on(table.po_id),
  vendorIdx: index('idx_grn_vendor').on(table.vendor_id),
  statusIdx: index('idx_grn_status').on(table.status),
  matchStatusIdx: index('idx_grn_match_status').on(table.three_way_match_status),
}));

export const goodsReceiptNoteItems = pgTable('goods_receipt_note_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  grn_id: uuid('grn_id').notNull().references(() => goodsReceiptNotes.id, { onDelete: 'cascade' }),
  po_item_id: uuid('po_item_id').notNull().references(() => purchaseOrderItems.id, { onDelete: 'restrict' }),

  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  item_name: text('item_name').notNull(),

  quantity_received: numeric('quantity_received', { precision: 12, scale: 3 }).notNull(),
  quantity_accepted: numeric('quantity_accepted', { precision: 12, scale: 3 }).notNull(),
  quantity_rejected: numeric('quantity_rejected', { precision: 12, scale: 3 }).notNull().default('0'),

  // Batch capture (KPMG required)
  batch_number: text('batch_number').notNull(),
  manufacturer: text('manufacturer'),
  expiry_date: date('expiry_date').notNull(),
  // KPMG: shelf-life ≥ 180 days check; rejects flagged here

  unit_cost: numeric('unit_cost', { precision: 12, scale: 2 }).notNull(),
  total_cost: numeric('total_cost', { precision: 14, scale: 2 }).notNull(),

  // Per-item rejection reason (if any)
  rejection_reason: text('rejection_reason'),

  // Inventory write tracking (set on grn submission)
  inventory_id: uuid('inventory_id').references(() => inventory.id, { onDelete: 'set null' }),
  stock_movement_id: uuid('stock_movement_id').references(() => stockMovements.id, { onDelete: 'set null' }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  grnIdx: index('idx_grni_grn').on(table.grn_id),
  poItemIdx: index('idx_grni_po_item').on(table.po_item_id),
  itemIdx: index('idx_grni_item').on(table.item_id),
  hospitalIdx: index('idx_grni_hospital').on(table.hospital_id),
  batchIdx: index('idx_grni_batch').on(table.item_id, table.batch_number),
}));

// ============================================================
// 7. INSPECTION CHECKLIST RESULTS (KPMG 10-item)
// ============================================================
export const inspectionChecklistResults = pgTable('inspection_checklist_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  grn_id: uuid('grn_id').references(() => goodsReceiptNotes.id, { onDelete: 'cascade' }),

  // KPMG Medical OPEX F: 10-item checklist
  visual_quantity_tally_pass: boolean('visual_quantity_tally_pass'),
  invoice_match_pass: boolean('invoice_match_pass'),
  damage_check_pass: boolean('damage_check_pass'),
  po_invoice_receipt_pass: boolean('po_invoice_receipt_pass'),
  packaging_integrity_pass: boolean('packaging_integrity_pass'),
  mfr_brand_batch_expiry_markings_pass: boolean('mfr_brand_batch_expiry_markings_pass'),
  shelf_life_180_days_pass: boolean('shelf_life_180_days_pass'),
  broken_bottles_pass: boolean('broken_bottles_pass'),
  iv_fluid_fungus_pass: boolean('iv_fluid_fungus_pass'),
  cold_chain_indicators_pass: boolean('cold_chain_indicators_pass'),

  overall_pass: boolean('overall_pass').notNull(),
  failure_notes: text('failure_notes'),

  inspected_by: uuid('inspected_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  inspected_at: timestamp('inspected_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  grnIdx: index('idx_inspection_grn').on(table.grn_id),
  hospitalIdx: index('idx_inspection_hospital').on(table.hospital_id),
}));

// ============================================================
// 8. INDENTS — Caregiver department requisitions (Phase 2 PRD)
//    State machine: pending→approved→issued→in_transit→received→closed
//    + rejected/cancelled branches.
// ============================================================
export const indents = pgTable('indents', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  indent_number: text('indent_number').notNull(),
  raised_by: uuid('raised_by').notNull().references(() => users.id, { onDelete: 'restrict' }),

  source_location: text('source_location').notNull(),         // fulfilling location (e.g., main_pharmacy)
  destination_location: text('destination_location').notNull(),  // requesting location (e.g., icu_stock)

  state: text('state').notNull().default('pending'),
  // CHECK state IN ('pending','approved','issued','in_transit','received','closed','rejected','cancelled')

  priority: text('priority').notNull().default('routine'),
  // CHECK priority IN ('routine','urgent','stat','emergency')

  encounter_id: uuid('encounter_id'),  // optional; for patient-attributable indents
  patient_id: uuid('patient_id'),      // optional; for patient-specific indents

  reason: text('reason'),
  notes: text('notes'),

  // SLA tracking
  sla_due_at: timestamp('sla_due_at', { withTimezone: true }),
  sla_breached_at: timestamp('sla_breached_at', { withTimezone: true }),

  // State transitions
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  issued_by: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
  issued_at: timestamp('issued_at', { withTimezone: true }),
  acknowledged_by: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
  acknowledged_at: timestamp('acknowledged_at', { withTimezone: true }),
  closed_at: timestamp('closed_at', { withTimezone: true }),

  rejected_by: uuid('rejected_by').references(() => users.id, { onDelete: 'set null' }),
  rejected_at: timestamp('rejected_at', { withTimezone: true }),
  rejection_reason: text('rejection_reason'),

  cancelled_by: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  cancellation_reason: text('cancellation_reason'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_indents_hospital').on(table.hospital_id),
  numberIdx: uniqueIndex('idx_indents_number').on(table.hospital_id, table.indent_number),
  raisedByIdx: index('idx_indents_raised_by').on(table.raised_by),
  stateIdx: index('idx_indents_state').on(table.state),
  destinationIdx: index('idx_indents_destination').on(table.hospital_id, table.destination_location),
  priorityIdx: index('idx_indents_priority').on(table.priority),
  slaIdx: index('idx_indents_sla').on(table.sla_due_at),
}));

export const indentItems = pgTable('indent_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  indent_id: uuid('indent_id').notNull().references(() => indents.id, { onDelete: 'cascade' }),

  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  item_name: text('item_name').notNull(),

  quantity_requested: numeric('quantity_requested', { precision: 12, scale: 3 }).notNull(),
  quantity_approved: numeric('quantity_approved', { precision: 12, scale: 3 }),
  quantity_issued: numeric('quantity_issued', { precision: 12, scale: 3 }).notNull().default('0'),
  quantity_acknowledged: numeric('quantity_acknowledged', { precision: 12, scale: 3 }).notNull().default('0'),

  // Issue source (which inventory rows fulfilled this line)
  source_inventory_id: uuid('source_inventory_id').references(() => inventory.id, { onDelete: 'set null' }),
  stock_movement_out_id: uuid('stock_movement_out_id').references(() => stockMovements.id, { onDelete: 'set null' }),
  stock_movement_in_id: uuid('stock_movement_in_id').references(() => stockMovements.id, { onDelete: 'set null' }),

  // Charge integration (Billing v3 Q14 + Phase 4)
  charge_item_id: uuid('charge_item_id'),  // FK to charge_items once Billing v3 ships

  notes: text('notes'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  indentIdx: index('idx_indent_items_indent').on(table.indent_id),
  itemIdx: index('idx_indent_items_item').on(table.item_id),
  hospitalIdx: index('idx_indent_items_hospital').on(table.hospital_id),
}));

export const indentStateLog = pgTable('indent_state_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  indent_id: uuid('indent_id').notNull().references(() => indents.id, { onDelete: 'cascade' }),

  from_state: text('from_state'),
  to_state: text('to_state').notNull(),
  actor_user_id: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  actor_role: text('actor_role'),
  reason: text('reason'),
  notes: text('notes'),

  transitioned_at: timestamp('transitioned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  indentIdx: index('idx_indent_state_log_indent').on(table.indent_id),
  hospitalIdx: index('idx_indent_state_log_hospital').on(table.hospital_id),
}));

// ============================================================
// 9. ASSET REGISTER (Phase 5 PRD)
//    Equipment as serial-numbered assets. Linked to vendor_contracts
//    (existing 46-vendor-ap.ts) for AMC contract type.
// ============================================================
export const assetRegister = pgTable('asset_register', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  asset_code: text('asset_code').notNull(),  // ASSET-EHRC-OT-00001
  display_name: text('display_name').notNull(),
  category: text('category').notNull(),
  // CHECK category IN ('imaging','surgical','monitoring','sterilization','it','furniture','utility','other')

  // Procurement linkage
  item_id: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  // nullable: assets that aren't in items master (legacy capex items)
  vendor_id: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  po_id: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  grn_id: uuid('grn_id').references(() => goodsReceiptNotes.id, { onDelete: 'set null' }),

  // Asset specifics
  serial_number: text('serial_number'),
  make: text('make'),
  model: text('model'),
  manufacturer: text('manufacturer'),

  // Lifecycle dates
  installed_date: date('installed_date'),
  warranty_until: date('warranty_until'),
  service_contract_until: date('service_contract_until'),
  service_contract_id: uuid('service_contract_id'),  // FK to vendor_contracts.id (46-vendor-ap.ts)

  // Location + assignment
  current_location: text('current_location'),
  assigned_to_user_id: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  assigned_to_department: text('assigned_to_department'),

  // Status
  status: text('status').notNull().default('active'),
  // CHECK status IN ('active','under_maintenance','retired','disposed','scrapped','condemned')

  // Depreciation (Phase 5)
  cost_at_acquisition: numeric('cost_at_acquisition', { precision: 14, scale: 2 }),
  current_book_value: numeric('current_book_value', { precision: 14, scale: 2 }),
  useful_life_years: integer('useful_life_years'),
  depreciation_method: text('depreciation_method'),
  // CHECK method IN ('straight_line','reducing_balance','none')

  // Lifecycle
  retired_at: timestamp('retired_at', { withTimezone: true }),
  retired_by: uuid('retired_by').references(() => users.id, { onDelete: 'set null' }),
  retirement_reason: text('retirement_reason'),

  notes: text('notes'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_asset_hospital').on(table.hospital_id),
  assetCodeIdx: uniqueIndex('idx_asset_code').on(table.hospital_id, table.asset_code),
  serialIdx: index('idx_asset_serial').on(table.serial_number),
  categoryIdx: index('idx_asset_category').on(table.category),
  statusIdx: index('idx_asset_status').on(table.status),
  locationIdx: index('idx_asset_location').on(table.hospital_id, table.current_location),
}));

// ============================================================
// 10. PM SCHEDULES — Preventive Maintenance (Phase 5)
// ============================================================
export const pmSchedules = pgTable('pm_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  asset_id: uuid('asset_id').notNull().references(() => assetRegister.id, { onDelete: 'cascade' }),

  cadence_type: text('cadence_type').notNull(),
  // CHECK cadence_type IN ('calendar_days','calendar_weeks','calendar_months','calendar_years','usage_hours','hybrid')
  cadence_value: integer('cadence_value').notNull(),

  task_name: text('task_name').notNull(),
  task_description: text('task_description'),
  expected_duration_minutes: integer('expected_duration_minutes'),

  assigned_to_role: text('assigned_to_role'),
  // CHECK role IN ('biomed_tech','vendor_engineer','facility_engineer','it_admin')

  vendor_contract_id: uuid('vendor_contract_id'),  // optional; vendor handles via AMC

  next_due_at: timestamp('next_due_at', { withTimezone: true }),
  last_completed_at: timestamp('last_completed_at', { withTimezone: true }),

  is_active: boolean('is_active').notNull().default(true),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  assetIdx: index('idx_pm_sched_asset').on(table.asset_id),
  nextDueIdx: index('idx_pm_sched_next_due').on(table.next_due_at),
  hospitalIdx: index('idx_pm_sched_hospital').on(table.hospital_id),
}));

// ============================================================
// 11. PM TASKS — Generated from schedules (Phase 5)
// ============================================================
export const pmTasks = pgTable('pm_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  schedule_id: uuid('schedule_id').notNull().references(() => pmSchedules.id, { onDelete: 'restrict' }),
  asset_id: uuid('asset_id').notNull().references(() => assetRegister.id, { onDelete: 'restrict' }),

  status: text('status').notNull().default('pending'),
  // CHECK status IN ('pending','assigned','in_progress','completed','skipped','overdue')

  due_at: timestamp('due_at', { withTimezone: true }).notNull(),
  assigned_to_user_id: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  skipped_at: timestamp('skipped_at', { withTimezone: true }),
  skip_reason: text('skip_reason'),

  outcome: text('outcome'),
  // CHECK outcome IN ('passed','failed','requires_followup','asset_retired')
  outcome_notes: text('outcome_notes'),
  parts_replaced: jsonb('parts_replaced'),  // array of {item_id, quantity, lot_number}

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  scheduleIdx: index('idx_pm_tasks_schedule').on(table.schedule_id),
  assetIdx: index('idx_pm_tasks_asset').on(table.asset_id),
  statusIdx: index('idx_pm_tasks_status').on(table.status),
  dueAtIdx: index('idx_pm_tasks_due_at').on(table.due_at),
  hospitalIdx: index('idx_pm_tasks_hospital').on(table.hospital_id),
}));

// ============================================================
// 12. MATERIAL CLASSIFICATIONS (KPMG v1; Codes Q9 reference)
// ============================================================
export const materialClassifications = pgTable('material_classifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  // Nullable: network-shared classifications

  classification: text('classification').notNull(),
  // CHECK classification IN ('standard','emergency','vital')

  display_name: text('display_name').notNull(),
  description: text('description'),

  // Lead times + approval cadence per classification
  approval_lead_time_days: integer('approval_lead_time_days'),
  procurement_lead_time_days: integer('procurement_lead_time_days'),
  reorder_buffer_multiplier: numeric('reorder_buffer_multiplier', { precision: 5, scale: 2 }),

  // Vital items: maintained by Medical HOD + Store In-charge + Inventory In-charge
  maintained_by_roles: text('maintained_by_roles').array(),

  is_active: boolean('is_active').notNull().default(true),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  classificationIdx: index('idx_mat_class_classification').on(table.classification),
  hospitalIdx: index('idx_mat_class_hospital').on(table.hospital_id),
}));

// ============================================================
// 13. VENDOR PERFORMANCE METRICS (Phase 3 daily job populates)
// ============================================================
export const vendorPerformanceMetrics = pgTable('vendor_performance_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  vendor_id: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),

  measurement_period_start: date('measurement_period_start').notNull(),
  measurement_period_end: date('measurement_period_end').notNull(),

  // Metrics
  total_pos: integer('total_pos').notNull().default(0),
  on_time_deliveries: integer('on_time_deliveries').notNull().default(0),
  late_deliveries: integer('late_deliveries').notNull().default(0),
  on_time_pct: numeric('on_time_pct', { precision: 5, scale: 2 }),

  total_grn_lines: integer('total_grn_lines').notNull().default(0),
  rejected_grn_lines: integer('rejected_grn_lines').notNull().default(0),
  rejection_rate_pct: numeric('rejection_rate_pct', { precision: 5, scale: 2 }),

  total_three_way_match_variances: integer('total_three_way_match_variances').notNull().default(0),

  payment_disputes_raised: integer('payment_disputes_raised').notNull().default(0),
  license_compliant: boolean('license_compliant').notNull().default(true),

  // Composite score (0-100)
  performance_score: numeric('performance_score', { precision: 5, scale: 2 }),

  // Ranking among vendors at this hospital
  hospital_rank: integer('hospital_rank'),

  computed_at: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  vendorIdx: index('idx_vpm_vendor').on(table.vendor_id),
  hospitalIdx: index('idx_vpm_hospital').on(table.hospital_id),
  periodIdx: index('idx_vpm_period').on(table.measurement_period_start, table.measurement_period_end),
  scoreIdx: index('idx_vpm_score').on(table.performance_score),
}));

// ============================================================
// 14. AUTO-REORDER DRAFTS (Phase 7)
// ============================================================
export const autoReorderDrafts = pgTable('auto_reorder_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  item_id: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  inventory_id: uuid('inventory_id').notNull().references(() => inventory.id, { onDelete: 'restrict' }),

  current_quantity: numeric('current_quantity', { precision: 12, scale: 3 }).notNull(),
  reorder_level: numeric('reorder_level', { precision: 12, scale: 3 }).notNull(),
  suggested_quantity: numeric('suggested_quantity', { precision: 12, scale: 3 }).notNull(),
  suggested_vendor_id: uuid('suggested_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  suggested_unit_cost: numeric('suggested_unit_cost', { precision: 12, scale: 2 }),

  status: text('status').notNull().default('pending_review'),
  // CHECK status IN ('pending_review','approved','modified','rejected','converted_to_pr','converted_to_po')

  reviewed_by: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  review_notes: text('review_notes'),

  // Conversion outcome
  pr_id: uuid('pr_id').references(() => purchaseRequisitions.id, { onDelete: 'set null' }),
  po_id: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),

  generated_at: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),  // auto-cleared after N days if unreviewed
}, (table) => ({
  itemIdx: index('idx_aro_item').on(table.item_id),
  inventoryIdx: index('idx_aro_inventory').on(table.inventory_id),
  statusIdx: index('idx_aro_status').on(table.status),
  hospitalIdx: index('idx_aro_hospital').on(table.hospital_id),
}));

// ============================================================
// END SCM CORE FOUNDATION SCHEMA
//
// Total tables: 14 in this commit (additional KPMG IFC v1.5 tables —
// gate_passes, condemnation_committee_actions, tender_processes,
// service_procurement_contracts, consignment_items,
// emergency_procurement_register, physical_stock_verifications,
// narcotics_excise_register — deferred per __DEFERRED_REGISTRY.md
// DR-0028 through DR-0036; not in Phase 1 scope per V's Q3 Path C lock).
//
// Migration SQL (0060_scm_foundation.sql) will be authored as phase-1.2
// commit, including:
//   - CREATE TABLE statements for all 14 tables above
//   - CHECK constraints for text-based status / kind / role / etc. fields
//   - ALTER TABLE statements for self-FK on stock_movements.reverses_movement_id
//   - Index DDL (Drizzle's index() helpers above generate these)
//   - Initial seed data for material_classifications (3 rows: standard/emergency/vital)
//   - DROP TABLE statements for the legacy pharmacy tables being subsumed
//     (pharmacy_inventory, purchase_orders [pharmacy version], purchase_order_items,
//      stock_movements [pharmacy version], stock_alerts) — only if no production
//     data; verified pre-migration via inventory check
//
// Phase 1.3+ commits cover:
//   - Backfill script: drug_master → items (with kind='drug', external_drug_id)
//   - Router split (extract-and-re-export per Q2 Path C):
//       scm/index.ts, scm/vendors.ts, scm/items.ts, scm/inventory.ts
//       pharmacy.ts → pharmacy-clinical.ts (narcotics + dispensing only)
//   - Admin pages: /admin/scm/{dashboard,items,vendors,roles}
//   - 7 new RBAC roles seeded; SoD permission middleware
//   - Audit + event log wiring for all SCM mutations
//   - Tests against the new schema using Phase 0 test infrastructure
// ============================================================
