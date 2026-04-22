import {
  pgTable, text, boolean, timestamp, integer, jsonb,
  index, uuid, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';
import { billingAccounts } from './09-billing';

// ============================================================
// BILLING v3 — FOUNDATION SCHEMA (BV3.1)
//
// Additive, greenfield schema. Sits alongside v2 (09-billing.ts,
// 39-bill-adjustments.ts, 01-master-data.ts#charge_master).
// v2 keeps running until BV3.10 migration flip.
//
// Convention notes for future editors:
//   - Status / role / enum-shaped fields are modeled as `text` with
//     a CHECK constraint in the SQL migration (see 61-tasks.ts).
//     pgEnum is avoided so future values can be added without a
//     Drizzle schema migration.
//   - Money is numeric(14, 2). Matches billingAccounts.total_charges.
//   - Timestamps are timestamptz + defaultNow().
//   - hospital_id is text → hospitals.hospital_id (codebase-wide
//     convention — NOT hospitals.id uuid).
//
// Full scoping: Daily Dash EHRC/BV3.1-FOUNDATION-SCHEMA-SCOPE.md
// Full PRD:    Daily Dash EHRC/BILLING-V3-PRD.md (v0.2, 22 Apr 2026)
// ============================================================


// ============================================================
// 1. charge_master_item
//    The atomic billable. Replaces v2's charge_master.
//    `status='pending_finance'` scaffolds codes that exist but
//    have no price yet (see BV3-PRD §4 rows 16 + 18).
//    `approver_role` records which role green-lit the code
//    (CMS or GM — Decision Q6=C).
//    `triggers_collection_fee=true` on a charge_master_item is the
//    signal that LHA01038 should auto-post alongside it when the
//    parent is a home_collection / opd_walkin lab order
//    (Decision Q1=C, wired in BV3.5).
// ============================================================
export const chargeMasterItem = pgTable('charge_master_item', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  charge_code: text('charge_code').notNull(),        // e.g. 'LHA01038', 'ADM00007', 'AMB-0-5KM'
  charge_name: text('charge_name').notNull(),
  category: text('category').notNull(),              // free-form for v3: 'lab'|'consult'|'procedure'|'room'|'pharmacy'|'mlc'|'ambulance'|'admin'|...
  dept_code: text('dept_code').notNull(),            // ties the code to an Even-OS dept ('LAB','IPD','ER','MLC',...)
  // Status — see CHECK in migration SQL:
  //   'active'          — usable for charge posting
  //   'pending_finance' — exists, no price yet; manual/auto-post blocked until price lands
  //   'inactive'        — retired, kept for historical references only
  status: text('status').notNull().default('pending_finance'),
  // Approval — see CHECK in migration SQL. Tracks who signed off on the code existing:
  //   'cms'  — Chief Medical Superintendent green-lit it
  //   'gm'   — General Manager green-lit it
  //   null   — legacy (seed rows from v2 migration, approval backfilled later)
  approver_role: text('approver_role'),
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  // Collection-fee trigger flag (Decision Q1=C).
  // When TRUE and a lab order is home_collection / opd_walkin, BV3.5 auto-poster
  // adds a charge_master_item with charge_code='LHA01038' to the patient account.
  triggers_collection_fee: boolean('triggers_collection_fee').notNull().default(false),
  description: text('description'),
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Unique per (hospital, charge_code). Codes are global per-hospital.
  chargeCodeHospitalIdx: uniqueIndex('idx_charge_master_item_code_hospital').on(table.hospital_id, table.charge_code),
  categoryIdx: index('idx_charge_master_item_category').on(table.category),
  deptCodeIdx: index('idx_charge_master_item_dept_code').on(table.dept_code),
  statusIdx: index('idx_charge_master_item_status').on(table.status),
  hospitalIdIdx: index('idx_charge_master_item_hospital_id').on(table.hospital_id),
  // Partial: lookup the LHA01038-style trigger rows cheaply.
  collectionFeeIdx: index('idx_charge_master_item_collection_fee').on(table.triggers_collection_fee),
}));

export type ChargeMasterItem = typeof chargeMasterItem.$inferSelect;
export type NewChargeMasterItem = typeof chargeMasterItem.$inferInsert;


// ============================================================
// 2. charge_master_price
//    Row-per-class pricing with temporal validity (effective_from /
//    effective_to). Supports re-pricing without destructive updates.
//    PRD §4 row 3: 7 tariff columns — OPD, GENERAL, SEMI_PVT, PVT,
//    SUITE, ICU, HDU. `class_code` is text (free-form) to let
//    package-only or facility-only charges exist without a class
//    (class_code = '_ANY').
// ============================================================
export const chargeMasterPrice = pgTable('charge_master_price', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  item_id: uuid('item_id').notNull().references(() => chargeMasterItem.id, { onDelete: 'cascade' }),
  // class_code — the tariff column. Values: OPD | GENERAL | SEMI_PVT | PVT | SUITE | ICU | HDU | _ANY
  // Enforced by CHECK in migration SQL.
  class_code: text('class_code').notNull(),
  price: numeric('price', { precision: 14, scale: 2 }).notNull(),
  // Price includes GST? false means GST is added on top at bill-gen time.
  is_gst_inclusive: boolean('is_gst_inclusive').notNull().default(false),
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  effective_from: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  // NULL = currently active. Set on re-price.
  effective_to: timestamp('effective_to', { withTimezone: true }),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Unique: one active price per (item, class, effective_from).
  itemClassEffectiveIdx: uniqueIndex('idx_charge_master_price_item_class_effective').on(table.item_id, table.class_code, table.effective_from),
  // Partial index for the hot path: "current price for (item, class)".
  // Condition added in migration SQL: WHERE effective_to IS NULL.
  currentPriceIdx: index('idx_charge_master_price_current').on(table.item_id, table.class_code),
  hospitalIdIdx: index('idx_charge_master_price_hospital').on(table.hospital_id),
}));

export type ChargeMasterPrice = typeof chargeMasterPrice.$inferSelect;


// ============================================================
// 3. charge_master_package
//    Package = bundle of charge_master_items with a fixed price.
//    `suite_open_billing=true` allows open-item billing when the
//    patient is in a SUITE class regardless of the package — rare
//    but required for concierge tier (PRD §4 row 6).
// ============================================================
export const chargeMasterPackage = pgTable('charge_master_package', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  package_code: text('package_code').notNull(),
  package_name: text('package_name').notNull(),
  package_price: numeric('package_price', { precision: 14, scale: 2 }).notNull(),
  // Status — CHECK in migration: 'active'|'draft'|'retired'
  status: text('status').notNull().default('draft'),
  // Suite-class override: when true, patients in SUITE class get open-item
  // billing even under this package. Default true.
  suite_open_billing: boolean('suite_open_billing').notNull().default(true),
  // jsonb: array of { charge_code, qty, included: bool } describing the bundle.
  // Kept as jsonb (not a child table) to match 09-billing.ts#package_components style
  // at the edit boundary — packages rarely change structure post-publish.
  inclusions: jsonb('inclusions').notNull().default('[]'),
  // jsonb: array of { charge_code, reason } describing what's explicitly excluded
  // (exclusions drive cashier warnings at posting time).
  exclusions: jsonb('exclusions').notNull().default('[]'),
  effective_from: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effective_to: timestamp('effective_to', { withTimezone: true }),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  packageCodeHospitalIdx: uniqueIndex('idx_charge_master_package_code_hospital').on(table.hospital_id, table.package_code),
  statusIdx: index('idx_charge_master_package_status').on(table.status),
  hospitalIdIdx: index('idx_charge_master_package_hospital').on(table.hospital_id),
}));

export type ChargeMasterPackage = typeof chargeMasterPackage.$inferSelect;


// ============================================================
// 4. charge_master_room
//    Per-class room tariff and billing-unit rules. 9 room classes,
//    1 row per class per hospital.
//    `billing_unit` — CHECK: 'day' | '6hr' | '2hr'. Most IPD rows
//    will be 'day'; ICU/HDU/observation rooms may be '6hr' or '2hr'.
// ============================================================
export const chargeMasterRoom = pgTable('charge_master_room', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  // room_class — CHECK:
  //   DAY_CARE | GENERAL | TWIN_SHARING | PRIVATE | SUITE | ICU | HDU | LABOR_OBS | ER_OBS
  room_class: text('room_class').notNull(),
  room_class_label: text('room_class_label').notNull(),   // human-readable for admin UI
  // billing_unit — CHECK: 'day' | '6hr' | '2hr'
  billing_unit: text('billing_unit').notNull().default('day'),
  tariff: numeric('tariff', { precision: 14, scale: 2 }).notNull().default('0'),
  is_gst_inclusive: boolean('is_gst_inclusive').notNull().default(false),
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  // Indian IPD convention: if patient upgrades from class A to class B mid-stay,
  // apply `upgrade_differential_percent` to the differential.  Default 0 (straight swap).
  upgrade_differential_percent: numeric('upgrade_differential_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  roomClassHospitalIdx: uniqueIndex('idx_charge_master_room_class_hospital').on(table.hospital_id, table.room_class),
  hospitalIdIdx: index('idx_charge_master_room_hospital').on(table.hospital_id),
}));

export type ChargeMasterRoom = typeof chargeMasterRoom.$inferSelect;


// ============================================================
// 5. charge_master_tariff_import
//    Audit trail for bulk CSV/XLSX uploads from Finance.
//    Written to on every Charge Master Importer run (BV3.2).
// ============================================================
export const chargeMasterTariffImport = pgTable('charge_master_tariff_import', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  // import_kind — CHECK: 'items' | 'prices' | 'packages' | 'rooms' | 'policies'
  import_kind: text('import_kind').notNull(),
  source_filename: text('source_filename').notNull(),
  source_bytes: integer('source_bytes'),
  rows_total: integer('rows_total').notNull().default(0),
  rows_inserted: integer('rows_inserted').notNull().default(0),
  rows_updated: integer('rows_updated').notNull().default(0),
  rows_skipped: integer('rows_skipped').notNull().default(0),
  rows_errored: integer('rows_errored').notNull().default(0),
  error_summary: jsonb('error_summary'),  // array of { row, reason }
  // status — CHECK: 'pending'|'running'|'success'|'partial'|'failed'
  status: text('status').notNull().default('pending'),
  started_at: timestamp('started_at', { withTimezone: true }),
  finished_at: timestamp('finished_at', { withTimezone: true }),
  uploaded_by: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalCreatedIdx: index('idx_charge_master_tariff_import_hospital_created').on(table.hospital_id, table.created_at),
  statusIdx: index('idx_charge_master_tariff_import_status').on(table.status),
}));

export type ChargeMasterTariffImport = typeof chargeMasterTariffImport.$inferSelect;


// ============================================================
// 6. charge_master_hospital_setting
//    One row per hospital. Holds all 11 business-rule defaults +
//    cashier-waiver thresholds + mortuary auto-accrual hours.
//    PRD §4 rows 8-11, 17-22.
// ============================================================
export const chargeMasterHospitalSetting = pgTable('charge_master_hospital_setting', {
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }).primaryKey(),
  // Rule 1 — consultation cap: no more than N consultations billed per encounter per day.
  consultation_cap_per_day: integer('consultation_cap_per_day').notNull().default(3),
  // Rule 2 — on-call doctor surcharge % over base consultation
  on_call_surcharge_percent: numeric('on_call_surcharge_percent', { precision: 5, scale: 2 }).notNull().default('25'),
  // Rule 3 — HR (hospital rate) multiplier for admitted patients vs OPD consult
  hr_multiplier_percent: numeric('hr_multiplier_percent', { precision: 5, scale: 2 }).notNull().default('100'),
  // Rule 4 — Emergency (ER) consultation flat surcharge %
  emergency_surcharge_percent: numeric('emergency_surcharge_percent', { precision: 5, scale: 2 }).notNull().default('50'),
  // Rule 5 — HR + EM stacking rule. 'multiply' | 'add' | 'cap_at_higher'. CHECK.
  hr_em_stacking_rule: text('hr_em_stacking_rule').notNull().default('cap_at_higher'),
  // Rule 6 — multi-surgery % paid to primary surgeon on 2nd / 3rd / 4th+ proc in same OT
  multi_surgery_2nd_percent: numeric('multi_surgery_2nd_percent', { precision: 5, scale: 2 }).notNull().default('50'),
  multi_surgery_3rd_percent: numeric('multi_surgery_3rd_percent', { precision: 5, scale: 2 }).notNull().default('25'),
  multi_surgery_4th_plus_percent: numeric('multi_surgery_4th_plus_percent', { precision: 5, scale: 2 }).notNull().default('25'),
  // Rule 7 — assistant surgeon as % of primary
  assistant_surgeon_percent: numeric('assistant_surgeon_percent', { precision: 5, scale: 2 }).notNull().default('25'),
  // Rule 8 — OT charge as % of primary surgeon fee
  ot_percent_of_surgeon: numeric('ot_percent_of_surgeon', { precision: 5, scale: 2 }).notNull().default('40'),
  // Rule 9 — discharge timing. 'admission_day_only' | 'discharge_day_only' | 'both' | 'none'. CHECK.
  discharge_day_billing: text('discharge_day_billing').notNull().default('admission_day_only'),

  // Cashier waiver thresholds (Decision Q8=E).
  cashier_waiver_self_limit_percent: integer('cashier_waiver_self_limit_percent').notNull().default(5),
  cashier_waiver_gm_limit_percent: integer('cashier_waiver_gm_limit_percent').notNull().default(20),
  // Above gm_limit requires CFO approval; no ceiling here — CFO can approve any.

  // Mortuary auto-accrual interval (Decision Q5=C).
  mortuary_auto_accrual_hours: integer('mortuary_auto_accrual_hours').notNull().default(12),

  // Edit trail
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ChargeMasterHospitalSetting = typeof chargeMasterHospitalSetting.$inferSelect;


// ============================================================
// 7. discount_policy
//    Counterparty-driven discount rules. Empty at BV3.1 launch
//    (Decision Q7=B + Q8=E); populated in BV3.2+ and by CFO pre-launch.
//    Scope: which payer_types + service_types + tariff_classes the
//    policy applies to. Empty arrays (`{}`) mean "all".
// ============================================================
export const discountPolicy = pgTable('discount_policy', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  policy_code: text('policy_code').notNull(),
  policy_name: text('policy_name').notNull(),
  counterparty_id: uuid('counterparty_id'),   // FK to counterparty table (seeded BV3.2)
  // scope arrays — empty means "all". Drizzle types as text[] via .array().
  payer_types: text('payer_types').array().notNull().default([] as any),       // e.g. ['insurance','corporate']; empty = all
  service_types: text('service_types').array().notNull().default([] as any),   // empty = all
  tariff_classes: text('tariff_classes').array().notNull().default([] as any), // empty = all
  // Discount math
  discount_type: text('discount_type').notNull().default('percent'),  // CHECK: 'percent'|'flat'
  discount_value: numeric('discount_value', { precision: 14, scale: 2 }).notNull().default('0'),
  // Guardrails
  max_cap_amount: numeric('max_cap_amount', { precision: 14, scale: 2 }),
  is_active: boolean('is_active').notNull().default(false),  // starts FALSE — CFO activates each post-launch
  effective_from: timestamp('effective_from', { withTimezone: true }),
  effective_to: timestamp('effective_to', { withTimezone: true }),
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  policyCodeHospitalIdx: uniqueIndex('idx_discount_policy_code_hospital').on(table.hospital_id, table.policy_code),
  counterpartyIdx: index('idx_discount_policy_counterparty').on(table.counterparty_id),
  activeIdx: index('idx_discount_policy_active').on(table.is_active),
  hospitalIdIdx: index('idx_discount_policy_hospital').on(table.hospital_id),
}));

export type DiscountPolicy = typeof discountPolicy.$inferSelect;


// ============================================================
// 8. discount_application
//    Every discount event. Three flavors differentiated by
//    is_cashier_waiver + discount_policy_id:
//      - Policy-driven: discount_policy_id set, is_cashier_waiver=false
//      - Cashier waiver: discount_policy_id NULL, is_cashier_waiver=true,
//        waiver_reason required (Decision Q8=E)
//      - Override: discount_policy_id NULL, is_cashier_waiver=false —
//        reserved for future bespoke discounts (BV3.9 insurance claim
//        enhancement-gap waivers).
// ============================================================
export const discountApplication = pgTable('discount_application', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  billing_account_id: uuid('billing_account_id').notNull().references(() => billingAccounts.id, { onDelete: 'cascade' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  discount_policy_id: uuid('discount_policy_id').references(() => discountPolicy.id, { onDelete: 'restrict' }),
  // Amount recorded at time-of-application (policies can change later; this is frozen).
  discount_amount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull(),
  discount_type_applied: text('discount_type_applied').notNull(),   // 'percent' | 'flat'
  discount_percent_applied: numeric('discount_percent_applied', { precision: 5, scale: 2 }),
  // Cashier waiver flags (Decision Q8=E)
  is_cashier_waiver: boolean('is_cashier_waiver').notNull().default(false),
  waiver_reason: text('waiver_reason'),                              // required iff is_cashier_waiver=true (enforced by CHECK)
  // waiver_approval_role — CHECK: 'cashier_self' | 'gm' | 'cfo' | null
  waiver_approval_role: text('waiver_approval_role'),
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  applied_by: uuid('applied_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  applied_at: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  // Reversibility
  is_reversed: boolean('is_reversed').notNull().default(false),
  reversed_at: timestamp('reversed_at', { withTimezone: true }),
  reversed_by: uuid('reversed_by').references(() => users.id, { onDelete: 'set null' }),
  reversal_reason: text('reversal_reason'),
}, (table) => ({
  billingAccountIdx: index('idx_discount_application_billing_account').on(table.billing_account_id),
  patientIdx: index('idx_discount_application_patient').on(table.patient_id),
  policyIdx: index('idx_discount_application_policy').on(table.discount_policy_id),
  waiverIdx: index('idx_discount_application_waiver').on(table.is_cashier_waiver),
  hospitalAppliedAtIdx: index('idx_discount_application_hospital_applied_at').on(table.hospital_id, table.applied_at),
}));

export type DiscountApplication = typeof discountApplication.$inferSelect;


// ============================================================
// 9. billing_charge
//    The atomic line item on a patient account in v3. Replaces
//    v2's invoice_line_items. Every cashier post, auto-post, and
//    reversal lands here.
//
//    source_module values — CHECK:
//      'manual'        — cashier typed it in
//      'lab'           — BV3.5 lab auto-post (incl. LHA01038 collection fee)
//      'pharmacy'      — BV3.5 pharmacy auto-post
//      'ot'            — OT checklist finalize
//      'room'          — daily/6hr/2hr bed tariff accrual
//      'package'       — package expansion
//      'er_obs'        — ER_OBS hourly accrual (Decision Q4=C)
//      'mortuary'      — mortuary auto-accrual every 12h (Decision Q5=C)
//      'admission'     — ADM00007, ADM00014, admission bundle
//      'adjustment'    — negative line from a waiver/discount
//
//    status values — CHECK:
//      'provisional'   — posted but not yet finalized (e.g. ADM00014 pre-disposition)
//      'posted'        — final, included on bill
//      'reversed'      — offset by a reversal line
//      'void'          — never visible on bill (admin error reversal)
// ============================================================
export const billingCharge = pgTable('billing_charge', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  billing_account_id: uuid('billing_account_id').notNull().references(() => billingAccounts.id, { onDelete: 'cascade' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  // The v3 charge code that identifies what was billed.
  charge_code: text('charge_code').notNull(),
  charge_name: text('charge_name').notNull(),  // denormalized at post-time, survives code renames
  // Optional link back to canonical item — null for packages / free-form charges
  charge_master_item_id: uuid('charge_master_item_id').references(() => chargeMasterItem.id, { onDelete: 'set null' }),
  package_id: uuid('package_id').references(() => chargeMasterPackage.id, { onDelete: 'set null' }),
  // Source / provenance
  source_module: text('source_module').notNull(),
  source_ref_id: uuid('source_ref_id'),    // e.g. lab_order.id, ot_case.id — not FK (cross-module)
  room_class_at_post: text('room_class_at_post'),  // frozen from encounter.room_class at post-time
  // Quantity + price
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
  unit_price: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  line_total: numeric('line_total', { precision: 14, scale: 2 }).notNull(),   // quantity * unit_price, frozen
  // GST (applied at post-time; inclusive or additive depending on item)
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  gst_amount: numeric('gst_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  is_gst_inclusive: boolean('is_gst_inclusive').notNull().default(false),
  // Status
  status: text('status').notNull().default('posted'),
  // If this is a reversal, which line did it reverse?
  reverses_charge_id: uuid('reverses_charge_id'),    // self-FK added in migration SQL via ALTER
  // Audit
  posted_by: uuid('posted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  posted_at: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  billingAccountIdx: index('idx_billing_charge_billing_account').on(table.billing_account_id),
  patientIdx: index('idx_billing_charge_patient').on(table.patient_id),
  encounterIdx: index('idx_billing_charge_encounter').on(table.encounter_id),
  chargeMasterItemIdx: index('idx_billing_charge_item').on(table.charge_master_item_id),
  sourceModuleIdx: index('idx_billing_charge_source_module').on(table.source_module),
  statusIdx: index('idx_billing_charge_status').on(table.status),
  hospitalPostedAtIdx: index('idx_billing_charge_hospital_posted_at').on(table.hospital_id, table.posted_at),
  sourceRefIdx: index('idx_billing_charge_source_ref').on(table.source_ref_id),
}));

export type BillingCharge = typeof billingCharge.$inferSelect;
export type NewBillingCharge = typeof billingCharge.$inferInsert;


// ============================================================
// 10. billing_account_payer
//     Links a billing_account to its payer(s). Supports multi-payer
//     accounts (primary insurance + corporate top-up + self-pay
//     residual). Seeded empty; populated when encounter is admitted
//     and a payer is attached.
//     NB: v2 stores payer details inline on billing_accounts; v3
//     normalizes them out. Overlap at BV3.10 cutover — both read paths
//     exist during the migration window.
// ============================================================
export const billingAccountPayer = pgTable('billing_account_payer', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  billing_account_id: uuid('billing_account_id').notNull().references(() => billingAccounts.id, { onDelete: 'cascade' }),
  // payer_kind — CHECK: 'self'|'insurance'|'corporate'|'government'|'ngo'|'counterparty_other'
  payer_kind: text('payer_kind').notNull(),
  counterparty_id: uuid('counterparty_id'),   // nullable; set for insurance/corporate/etc.
  policy_number: text('policy_number'),
  member_id: text('member_id'),
  // Share of liability for this payer (0-100). Primary usually 100, with self as residual.
  share_percent: numeric('share_percent', { precision: 5, scale: 2 }).notNull().default('100'),
  priority: integer('priority').notNull().default(1),   // 1 = primary
  is_active: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  billingAccountIdx: index('idx_billing_account_payer_billing_account').on(table.billing_account_id),
  counterpartyIdx: index('idx_billing_account_payer_counterparty').on(table.counterparty_id),
  payerKindIdx: index('idx_billing_account_payer_kind').on(table.payer_kind),
  hospitalIdIdx: index('idx_billing_account_payer_hospital').on(table.hospital_id),
}));

export type BillingAccountPayer = typeof billingAccountPayer.$inferSelect;
