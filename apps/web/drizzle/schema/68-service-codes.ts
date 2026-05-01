import {
  pgTable, text, uuid, integer, numeric, timestamp, boolean, jsonb,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';

// =============================================================================
// CODES MODULE — Phase 3 (Service Codes)
// =============================================================================
// Greenfield catalog of service-type orderables (procedures, consultations,
// labs, imaging, packs, room/bed days, fees). Symmetric to inventory_items
// (Phase 1's items catalog). 33 fields per Sample_Service Item Master CSV
// (deduplicated to 31 unique fields; 'chargeable' + 'isValidityPeriodRequired'
// appear twice in the source CSV).
//
// Code format (Q2-locked): S-[ServiceType2]-[Department3-5]-[Serial4]
//   examples: S-PR-OT-0001, S-LB-LBI-0001, S-IM-RAD-0001, S-RM-IPD-0001
//
// Approval workflow: same 5-state CHECK enum as inventory_items.status (Phase
// 2). New rows default 'draft'; backfilled rows from existing charge_master_*
// data go in 'active' via Phase 3.5 backfill script (one historical-bootstrap
// audit row per row).
//
// Cross-coordinates:
//   - Q4 module-by-module FK refactor lands in Phase 6 (each downstream PRD
//     adds `code_id → service_codes.id WHERE service_type=...` FK).
//   - Q2 format mirrors inventory_items M-/L-/A-/G-/E- prefix pattern.
//   - 29-department taxonomy extracted from Billing Manual §7 page 8 + 9
//     service types per Q2.
// =============================================================================

// ---------- service_lookup_types (9 fixed values) ----------

export const serviceLookupTypes = pgTable('service_lookup_types', {
  /** 2-char service type code (PR, CN, LB, IM, PK, BD, RM, FE, XX) */
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceLookupType = typeof serviceLookupTypes.$inferSelect;


// ---------- service_lookup_departments (29 from Billing Manual §7 page 8) ----------

export const serviceLookupDepartments = pgTable('service_lookup_departments', {
  /** 3-5 char department code (ADM, AMB, EMR, LHA, ..., NEPH) */
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  /** Bucket category from Billing Manual: 'admin', 'lab', 'imaging', 'surgical', 'medical', 'support' */
  category: text('category').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceLookupDepartment = typeof serviceLookupDepartments.$inferSelect;


// ---------- service_lookup_subdepartments (handles GAS-S vs GAS-M, NEU-S vs NEU-P, etc.) ----------

export const serviceLookupSubdepartments = pgTable('service_lookup_subdepartments', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Parent dept_code FK */
  department_code: text('department_code').notNull().references(() => serviceLookupDepartments.code, { onDelete: 'cascade' }),
  /** Optional sub-code suffix (e.g. 'S' for Surgical, 'M' for Medical, 'P' for Procedures) */
  sub_code: text('sub_code'),
  label: text('label').notNull(),
  description: text('description'),
  is_active: boolean('is_active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  deptSubIdx: uniqueIndex('idx_service_lookup_subdepartments_dept_sub').on(t.department_code, t.sub_code),
}));

export type ServiceLookupSubdepartment = typeof serviceLookupSubdepartments.$inferSelect;


// ---------- service_serial_counters (atomic monotonic per (type,dept) bucket) ----------

export const serviceSerialCounters = pgTable('service_serial_counters', {
  /** Bucket key: '<service_type_code>-<department_code>' (e.g. 'PR-OT', 'LB-LBI') */
  bucket: text('bucket').primaryKey(),
  /** Last issued serial number; next allocation = last_serial + 1 */
  last_serial: integer('last_serial').notNull().default(0),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceSerialCounter = typeof serviceSerialCounters.$inferSelect;


// ---------- service_codes (the canonical catalog; ~39 columns) ----------

export const serviceCodes = pgTable('service_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // ── Format identity ────────────────────────────────────────────────────
  /** S-XX-DEPT-9999 — globally unique within hospital */
  service_code: text('service_code').notNull(),
  /** 2-char FK */
  service_type_code: text('service_type_code').notNull().references(() => serviceLookupTypes.code, { onDelete: 'restrict' }),
  /** 3-5 char FK */
  department_code: text('department_code').notNull().references(() => serviceLookupDepartments.code, { onDelete: 'restrict' }),
  /** Optional subdepartment FK (S/M/P suffix etc.) */
  subdepartment_id: uuid('subdepartment_id').references(() => serviceLookupSubdepartments.id, { onDelete: 'set null' }),
  /** Per-bucket monotonic serial */
  serial: integer('serial').notNull(),

  // ── Names + classification (PRD CSV fields, snake_case) ────────────────
  service_name: text('service_name').notNull(),
  /** Free-form alternate code from legacy systems (KX, charge_master pre-Phase-3) */
  legacy_code: text('legacy_code'),
  department_name: text('department_name'),  // denormalized at insert-time; stable through dept renames
  subdepartment_name: text('subdepartment_name'),

  // ── Operational flags ──────────────────────────────────────────────────
  is_prescription_required: boolean('is_prescription_required').notNull().default(false),
  is_orderable: boolean('is_orderable').notNull().default(true),
  /** Whether this service generates a charge when ordered. */
  is_chargeable: boolean('is_chargeable').notNull().default(true),
  is_searchable: boolean('is_searchable').notNull().default(true),
  /** Validity period applies (e.g. consult valid for 30 days) */
  is_validity_period_required: boolean('is_validity_period_required').notNull().default(false),
  validity_period_days: integer('validity_period_days'),

  // ── Approval workflow (mirrors inventory_items.status) ─────────────────
  /** CHECK enum: draft / pending_clinical_review / pending_master_data_review / pending_cms_gm_review / active / rejected */
  status: text('status').notNull().default('draft'),

  // ── Patient / clinical applicability ───────────────────────────────────
  /** patient_type enum: 'all' | 'ipd' | 'opd' | 'er' | 'daycare' (CHECK) */
  patient_type: text('patient_type').notNull().default('all'),
  /** gender enum: 'all' | 'male' | 'female' | 'other' (CHECK) */
  gender: text('gender').notNull().default('all'),

  // ── Tax + cost ─────────────────────────────────────────────────────────
  is_tax_applicable: boolean('is_tax_applicable').notNull().default(false),
  /** When is_tax_applicable=true, the unit tax amount (in INR). */
  unit_tax_amount: numeric('unit_tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  /** Tax type: 'GST' | 'CESS' | 'IGST' | 'SGST' | 'CGST' | 'NA' (CHECK) */
  tax_type: text('tax_type').notNull().default('NA'),
  /** GST rate percentage (e.g. 5, 12, 18, 28). 0 when NA. */
  tax_value_percent: numeric('tax_value_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  /** Whether internal hospital-cost calculation applies. */
  is_hospital_cost_applicable: boolean('is_hospital_cost_applicable').notNull().default(false),

  // ── UX text ────────────────────────────────────────────────────────────
  nurse_remark: text('nurse_remark'),
  patient_billing_remark: text('patient_billing_remark'),

  // ── Ordering routing ───────────────────────────────────────────────────
  ordering_department: text('ordering_department'),
  ordering_specialty: text('ordering_specialty'),
  is_reason_for_request_mandatory: boolean('is_reason_for_request_mandatory').notNull().default(false),

  // ── Package fields ─────────────────────────────────────────────────────
  /** package_type: 'opd' | 'ipd' | 'health_check' | 'NA' (CHECK) */
  package_type: text('package_type').notNull().default('NA'),
  package_subtype: text('package_subtype'),
  show_online: boolean('show_online').notNull().default(false),
  part_of_package: boolean('part_of_package').notNull().default(false),
  is_editable_price: boolean('is_editable_price').notNull().default(false),

  // ── Order quantity defaults ────────────────────────────────────────────
  /** order_frequency: 'STAT' | 'BID' | 'TID' | 'QID' | 'DAILY' | 'PRN' | 'NA' (CHECK) */
  order_frequency: text('order_frequency').notNull().default('NA'),
  order_quantity_default: integer('order_quantity_default').notNull().default(1),

  // ── Misc flags ─────────────────────────────────────────────────────────
  is_cosmetic: boolean('is_cosmetic').notNull().default(false),

  // ── Provenance / audit ─────────────────────────────────────────────────
  /** 'manual' | 'kx_import' | 'charge_master_backfill' | 'csv_import' */
  source: text('source').notNull().default('manual'),
  /** Optional jsonb pointer back to source row (e.g. charge_master_item.id) for lineage */
  source_ref: jsonb('source_ref'),
  notes: text('notes'),

  // ── Audit fields ───────────────────────────────────────────────────────
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Globally unique full code per hospital
  serviceCodeHospitalIdx: uniqueIndex('idx_service_codes_code_hospital').on(t.hospital_id, t.service_code),
  // Bucket lookup
  bucketIdx: index('idx_service_codes_bucket').on(t.service_type_code, t.department_code),
  // Operational filters
  statusIdx: index('idx_service_codes_status').on(t.status),
  hospitalIdx: index('idx_service_codes_hospital').on(t.hospital_id),
  serviceTypeIdx: index('idx_service_codes_service_type').on(t.service_type_code),
  departmentIdx: index('idx_service_codes_department').on(t.department_code),
  // Search anchor
  nameIdx: index('idx_service_codes_name').on(t.service_name),
}));

export type ServiceCode = typeof serviceCodes.$inferSelect;
export type NewServiceCode = typeof serviceCodes.$inferInsert;


// ---------- Constants ----------

export const SERVICE_TYPE_CODES = ['PR','CN','LB','IM','PK','BD','RM','FE','XX'] as const;
export type ServiceTypeCode = typeof SERVICE_TYPE_CODES[number];

/**
 * Canonical 29-department taxonomy from Billing Manual §7 page 8.
 * Some codes are shared across surgical/medical pairs (GAS, NEU, ONS) —
 * the subdepartment table disambiguates with an S/M/P suffix.
 */
export const SERVICE_DEPARTMENT_CODES = [
  // Admin
  'ADM', 'AMB',
  // Emergency + medico-legal
  'EMR', 'MLC',
  // Lab (6 sub-areas, each with its own dept code)
  'LHA', 'LBI', 'LHI', 'LCI', 'LBB', 'LMI',
  // Diagnostics
  'CAD', 'RAD',
  // Surgical specialties
  'ENT', 'ENTSB', 'GAS', 'GEN', 'NEU', 'OBG', 'ONS', 'OPTO', 'ORT',
  'PAS', 'PLS', 'URO', 'VAS',
  // Support
  'PHY', 'NEPH',
] as const;

export type ServiceDepartmentCode = typeof SERVICE_DEPARTMENT_CODES[number];
