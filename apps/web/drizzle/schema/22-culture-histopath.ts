import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients } from './03-registration';
import { labOrders, specimens } from './13-lab-radiology';

// ============================================================
// ENUMS — Culture & Sensitivity + Histopathology (L.5)
// ============================================================

export const cultureStatusEnum = pgEnum('culture_status', [
  'inoculated', 'growing', 'organism_identified', 'sensitivity_in_progress',
  'sensitivity_complete', 'no_growth', 'cancelled',
]);

export const sensitivityResultEnum = pgEnum('sensitivity_result', [
  'S', 'I', 'R',  // Susceptible, Intermediate, Resistant
]);

export const histopathStageEnum = pgEnum('histopath_stage', [
  'accessioned', 'grossing', 'processing', 'embedding', 'sectioning',
  'staining', 'microscopy', 'diagnosis', 'reported', 'amended',
]);

export const histopathSpecimenTypeEnum = pgEnum('histopath_specimen_type', [
  'biopsy', 'excision', 'resection', 'cytology', 'fnac',
  'frozen_section', 'autopsy', 'other',
]);

// ============================================================
// CULTURE ORDERS — Microbiology culture tracking
// ============================================================

export const cultureOrders = pgTable('culture_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  order_id: uuid('co_order_id').notNull().references(() => labOrders.id, { onDelete: 'cascade' }),
  specimen_id: uuid('co_specimen_id').references(() => specimens.id, { onDelete: 'set null' }),
  patient_id: uuid('co_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  culture_number: varchar('co_culture_number', { length: 50 }).notNull(),
  status: cultureStatusEnum('co_status').default('inoculated').notNull(),

  // Specimen details
  specimen_source: varchar('co_specimen_source', { length: 100 }),  // blood, urine, wound, sputum, csf, etc.
  collection_date: timestamp('co_collection_date'),

  // Inoculation
  media_used: jsonb('co_media_used'),  // Array of media types: blood agar, MacConkey, chocolate agar, etc.
  inoculated_by: uuid('co_inoculated_by').references(() => users.id, { onDelete: 'set null' }),
  inoculated_at: timestamp('co_inoculated_at').defaultNow(),

  // Incubation tracking
  incubation_temp: varchar('co_incubation_temp', { length: 20 }),  // 37°C, 25°C, etc.
  incubation_atmosphere: varchar('co_incubation_atm', { length: 30 }),  // aerobic, anaerobic, CO2
  incubation_hours: integer('co_incubation_hours').default(24),

  // No growth declaration
  no_growth_declared_at: timestamp('co_no_growth_at'),
  no_growth_declared_by: uuid('co_no_growth_by').references(() => users.id, { onDelete: 'set null' }),
  final_no_growth_hours: integer('co_final_no_growth_hours'),  // 48h for routine, 5 days for blood

  // Notes
  clinical_notes: text('co_clinical_notes'),

  created_at: timestamp('co_created_at').defaultNow().notNull(),
  updated_at: timestamp('co_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_co_hospital').on(t.hospital_id),
  orderIdx: index('idx_co_order').on(t.order_id),
  patientIdx: index('idx_co_patient').on(t.patient_id),
  statusIdx: index('idx_co_status').on(t.status),
  cultureNumIdx: index('idx_co_culture_number').on(t.hospital_id, t.culture_number),
}));

// ============================================================
// ORGANISM IDENTIFICATIONS — Organisms found in culture
// ============================================================

export const organismIdentifications = pgTable('organism_identifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  culture_id: uuid('oi_culture_id').notNull().references(() => cultureOrders.id, { onDelete: 'cascade' }),

  // Organism info
  organism_name: text('oi_organism_name').notNull(),
  snomed_code: varchar('oi_snomed_code', { length: 30 }),
  gram_stain: varchar('oi_gram_stain', { length: 30 }),  // gram_positive, gram_negative, yeast, acid_fast
  morphology: varchar('oi_morphology', { length: 50 }),  // cocci, bacilli, coccobacilli, etc.

  // Identification method
  identification_method: varchar('oi_id_method', { length: 50 }),  // biochemical, MALDI-TOF, molecular, manual
  colony_count: varchar('oi_colony_count', { length: 50 }),  // >10^5 CFU/mL, few, moderate, heavy
  is_significant: boolean('oi_is_significant').default(true),
  is_contaminant: boolean('oi_is_contaminant').default(false),

  identified_by: uuid('oi_identified_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  identified_at: timestamp('oi_identified_at').defaultNow().notNull(),
  notes: text('oi_notes'),

  created_at: timestamp('oi_created_at').defaultNow().notNull(),
}, (t) => ({
  cultureIdx: index('idx_oi_culture').on(t.culture_id),
  hospitalIdx: index('idx_oi_hospital').on(t.hospital_id),
  organismIdx: index('idx_oi_organism').on(t.organism_name),
}));

// ============================================================
// ANTIBIOTIC SENSITIVITY — S/I/R results per organism
// ============================================================

export const antibioticSensitivities = pgTable('antibiotic_sensitivities', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  organism_id: uuid('as_organism_id').notNull().references(() => organismIdentifications.id, { onDelete: 'cascade' }),

  antibiotic_name: text('as_antibiotic_name').notNull(),
  antibiotic_code: varchar('as_antibiotic_code', { length: 20 }),
  antibiotic_class: varchar('as_antibiotic_class', { length: 50 }),  // penicillin, cephalosporin, aminoglycoside, etc.

  // Result
  result: sensitivityResultEnum('as_result').notNull(),
  mic_value: varchar('as_mic_value', { length: 20 }),  // Minimum Inhibitory Concentration
  zone_diameter_mm: integer('as_zone_diameter'),  // Disk diffusion zone size

  // CLSI/EUCAST breakpoints used
  breakpoint_standard: varchar('as_breakpoint_std', { length: 20 }),  // CLSI, EUCAST
  breakpoint_year: varchar('as_breakpoint_year', { length: 10 }),

  tested_by: uuid('as_tested_by').references(() => users.id, { onDelete: 'set null' }),
  tested_at: timestamp('as_tested_at').defaultNow().notNull(),
  notes: text('as_notes'),

  created_at: timestamp('as_created_at').defaultNow().notNull(),
}, (t) => ({
  organismIdx: index('idx_as_organism').on(t.organism_id),
  hospitalIdx: index('idx_as_hospital').on(t.hospital_id),
  antibioticIdx: index('idx_as_antibiotic').on(t.antibiotic_name),
  resultIdx: index('idx_as_result').on(t.result),
}));

// ============================================================
// HISTOPATHOLOGY CASES — Multi-stage pathology workflow
// ============================================================

export const histopathCases = pgTable('histopath_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  order_id: uuid('hp_order_id').references(() => labOrders.id, { onDelete: 'set null' }),
  patient_id: uuid('hp_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  case_number: varchar('hp_case_number', { length: 50 }).notNull(),
  specimen_type: histopathSpecimenTypeEnum('hp_specimen_type').notNull(),
  stage: histopathStageEnum('hp_stage').default('accessioned').notNull(),

  // Specimen info
  specimen_description: text('hp_specimen_desc'),
  specimen_site: varchar('hp_specimen_site', { length: 100 }),
  laterality: varchar('hp_laterality', { length: 20 }),  // left, right, bilateral
  number_of_pieces: integer('hp_num_pieces').default(1),
  clinical_history: text('hp_clinical_history'),
  clinical_diagnosis: text('hp_clinical_diagnosis'),

  // Grossing
  gross_description: text('hp_gross_description'),
  gross_photos: jsonb('hp_gross_photos'),  // Array of { url, caption }
  gross_by: uuid('hp_gross_by').references(() => users.id, { onDelete: 'set null' }),
  gross_at: timestamp('hp_gross_at'),
  cassette_count: integer('hp_cassette_count'),

  // Microscopy
  microscopy_findings: text('hp_microscopy_findings'),
  special_stains: jsonb('hp_special_stains'),  // Array of { stain_name, result }
  ihc_markers: jsonb('hp_ihc_markers'),  // Array of { marker, result: positive/negative/equivocal }
  microscopy_by: uuid('hp_microscopy_by').references(() => users.id, { onDelete: 'set null' }),
  microscopy_at: timestamp('hp_microscopy_at'),

  // Diagnosis
  diagnosis_text: text('hp_diagnosis_text'),
  icd10_code: varchar('hp_icd10_code', { length: 20 }),
  icd10_description: text('hp_icd10_desc'),
  tumor_grade: varchar('hp_tumor_grade', { length: 30 }),
  tumor_stage: varchar('hp_tumor_stage', { length: 30 }),
  margin_status: varchar('hp_margin_status', { length: 30 }),  // clear, involved, close
  synoptic_report: jsonb('hp_synoptic_report'),  // Structured CAP synoptic elements

  // Pathologist
  pathologist_id: uuid('hp_pathologist_id').references(() => users.id, { onDelete: 'set null' }),
  diagnosed_at: timestamp('hp_diagnosed_at'),
  reported_at: timestamp('hp_reported_at'),

  // Amendment
  amendment_text: text('hp_amendment_text'),
  amended_by: uuid('hp_amended_by').references(() => users.id, { onDelete: 'set null' }),
  amended_at: timestamp('hp_amended_at'),

  // Turnaround
  accessioned_at: timestamp('hp_accessioned_at').defaultNow(),
  tat_hours: integer('hp_tat_hours'),

  created_at: timestamp('hp_created_at').defaultNow().notNull(),
  updated_at: timestamp('hp_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_hp_hospital').on(t.hospital_id),
  patientIdx: index('idx_hp_patient').on(t.patient_id),
  orderIdx: index('idx_hp_order').on(t.order_id),
  stageIdx: index('idx_hp_stage').on(t.stage),
  caseNumIdx: index('idx_hp_case_number').on(t.hospital_id, t.case_number),
  specimenTypeIdx: index('idx_hp_specimen_type').on(t.specimen_type),
}));
