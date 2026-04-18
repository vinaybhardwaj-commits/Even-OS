/**
 * Patient Chart Overhaul — PC.2a — MDCalc-style clinical calculators
 *
 * Six tables that together model a clinical calculator: its definition
 * (`calculators`), its inputs (`calculator_inputs`), its scoring rules
 * (`calculator_scoring`), its result bands (`calculator_bands`), a log of
 * runs per patient (`calculator_results`), and per-user pinning so the
 * Overview smart card can show each user's favourites (`calculator_pins`).
 *
 * Shape rationale — see PRD v2.0 §26 locks and the guards in §53:
 *   - Scoring is DETERMINISTIC and runs server-side in pure TS. The only
 *     LLM-authored artefact is the prose interpretation, which lives on
 *     `calculator_results.prose_text` and flows through the same review
 *     gate as Patient Brief (`prose_status` field below).
 *   - Every chart-fed input is stored with its `chart_source_path` so the
 *     runner UI can render "📋 from chart" badges with source attribution.
 *   - `hospital_id` lives on every new table (PRD #25 multi-tenant future).
 *   - No native-binary deps; all reasoning is in-repo TS + existing Neon
 *     HTTP driver. Qwen interpretation rides the existing `ai_request_queue`
 *     and `hallucination_flags` infra (added in PC.2c, not this migration).
 *
 * Authoring mode (PRD #15): super_admin authors calculators via fixture
 * seed (PC.2a) or the `/admin/calculators` UI (PC.2c). HODs request new
 * calcs via Sewa/email — they do NOT self-serve. The tRPC router in
 * PC.2a.4 gates `createCalc / updateCalc / deleteCalc` on
 * `ctx.user.role === 'super_admin'` to enforce this.
 */

import {
  pgTable, text, timestamp, uuid, integer, numeric, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ─── 1. calculators ─────────────────────────────────────────────
// The calculator definition. One row per published calc (CHA2DS2-VASc,
// HAS-BLED, etc.). `slug` is the stable machine key; `version` supports
// future band/input tweaks without trashing old `calculator_results`.
export const calculators = pgTable(
  'calculators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    /** Machine key. e.g. 'cha2ds2-vasc', 'has-bled', 'heart-score'. */
    slug: text('slug').notNull(),
    /** Display name. e.g. 'CHA₂DS₂-VASc Score for AF Stroke Risk'. */
    name: text('name').notNull(),
    /** Specialty filter — free-form. e.g. 'cardiology', 'hepatology'. */
    specialty: text('specialty').notNull(),
    /** One-line description shown in list + header. */
    shortDescription: text('short_description'),
    /** Free-form markdown / longer context; optional. */
    longDescription: text('long_description'),
    /** Version string. Bump when inputs/scoring/bands change materially. */
    version: text('version').notNull().default('1.0'),
    /** Active flag — deactivated calcs still list for historical results. */
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Roles that should see this calc pinned by default on Overview.
     * e.g. ['consultant','senior_resident'] for cardiology calcs.
     * Users can then un-pin via `calculator_pins`.
     */
    pinDefaultForRoles: jsonb('pin_default_for_roles')
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Source citation — doi / PMID / url — for attribution. */
    sourceCitation: text('source_citation'),
    /**
     * PC.2c1 — Named-formula key. When set, scoring engine dispatches to
     * `lib/calculators/formulas[formula_ref]` instead of rule-based scoring.
     * Used for non-linear calcs that need ln/log/exp (e.g. MELD 3.0).
     * See scoring-engine.ts FORMULAS registry.
     */
    formulaRef: text('formula_ref'),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    authoredAt: timestamp('authored_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Slug is globally unique across a hospital so `/admin/calculators?slug=...`
    // and `calculators.getBySlug` both work.
    uniqSlug: uniqueIndex('uniq_calculator_slug').on(t.hospitalId, t.slug),
    bySpecialty: index('idx_calculators_specialty').on(t.specialty),
    byActive: index('idx_calculators_active').on(t.isActive),
  }),
);

// ─── 2. calculator_inputs ───────────────────────────────────────
// Input fields. Rendered in `display_order`. `type` controls the UI widget;
// `options` holds select choices (label + value). `chart_source_path` is
// a dot-path into the chart projection used to pre-fill "📋 from chart".
export const calculatorInputs = pgTable(
  'calculator_inputs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    calcId: uuid('calc_id')
      .notNull()
      .references(() => calculators.id, { onDelete: 'cascade' }),
    /** Machine key inside this calc. e.g. 'age', 'chf', 'htn', 'sex'. */
    key: text('key').notNull(),
    /** Human label shown in the form. */
    label: text('label').notNull(),
    /** Optional help tooltip. */
    helperText: text('helper_text'),
    /** 'boolean' | 'number' | 'select' | 'date'. */
    type: text('type').notNull(),
    /** For 'number': unit label. For 'date': display format hint. */
    unit: text('unit'),
    /**
     * For 'select': array of { label, value } objects.
     * For 'number': { min?, max?, step? } bounds object.
     * For 'boolean': null.
     */
    options: jsonb('options').$type<unknown>(),
    /**
     * Dot-path into the chart projection for pre-fill.
     * e.g. 'patient.age', 'conditions.has("chf")', 'vitals.sbp'.
     * Null = user-entered only.
     */
    chartSourcePath: text('chart_source_path'),
    required: boolean('required').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One key per calc.
    uniqKey: uniqueIndex('uniq_calculator_input_key').on(t.calcId, t.key),
    byCalc: index('idx_calculator_inputs_calc').on(t.calcId),
    byOrder: index('idx_calculator_inputs_order').on(t.calcId, t.displayOrder),
  }),
);

// ─── 3. calculator_scoring ──────────────────────────────────────
// Scoring rules. Each row is a single (input → points) relationship the
// server evaluates deterministically. `rule_type`:
//   - 'sum'         → if input equals `when_value`, add `points`.
//   - 'weighted'    → multiply input numeric value by `points` (weight).
//   - 'conditional' → evaluate `formula_expr` (small safe DSL).
// The engine is deliberately conservative — no arbitrary JS eval.
export const calculatorScoring = pgTable(
  'calculator_scoring',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    calcId: uuid('calc_id')
      .notNull()
      .references(() => calculators.id, { onDelete: 'cascade' }),
    ruleType: text('rule_type').notNull(), // 'sum' | 'weighted' | 'conditional'
    inputKey: text('input_key').notNull(),
    /** Value that triggers `points` to be added (for 'sum'). e.g. 'true', '65+'. */
    whenValue: text('when_value'),
    /** Points to add (negative allowed). For 'weighted', the coefficient. */
    points: numeric('points', { precision: 10, scale: 3 }).notNull(),
    /** Small-DSL formula for 'conditional'. e.g. 'age >= 75'. */
    formulaExpr: text('formula_expr'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCalc: index('idx_calculator_scoring_calc').on(t.calcId),
    byInput: index('idx_calculator_scoring_input').on(t.calcId, t.inputKey),
  }),
);

// ─── 4. calculator_bands ────────────────────────────────────────
// Result bands — translate numeric score to a risk band + default prose.
// e.g. CHA2DS2-VASc: 0 → low (no anticoag), 1 → moderate (consider), 2+ → high.
export const calculatorBands = pgTable(
  'calculator_bands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    calcId: uuid('calc_id')
      .notNull()
      .references(() => calculators.id, { onDelete: 'cascade' }),
    /** Machine key. e.g. 'low', 'moderate', 'high'. */
    bandKey: text('band_key').notNull(),
    /** Display label. */
    label: text('label').notNull(),
    /** Inclusive bounds. max_score nullable = "+" open-ended upper band. */
    minScore: numeric('min_score', { precision: 10, scale: 3 }).notNull(),
    maxScore: numeric('max_score', { precision: 10, scale: 3 }),
    /** UI color hint: 'green' | 'yellow' | 'red' | 'grey'. */
    color: text('color').notNull().default('grey'),
    /** Default prose when Qwen is unavailable / declined. */
    interpretationDefault: text('interpretation_default'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqBand: uniqueIndex('uniq_calculator_band_key').on(t.calcId, t.bandKey),
    byCalc: index('idx_calculator_bands_calc').on(t.calcId),
  }),
);

// ─── 5. calculator_results ──────────────────────────────────────
// One row per calc run. Immutable audit — if a user re-runs with different
// inputs, a new row is written. `prose_status` tracks the review gate:
//   'pending'   → Qwen request queued
//   'ready'     → prose generated, awaiting "I've reviewed"
//   'reviewed'  → user accepted prose; safe to Add-to-Note
//   'declined'  → user rejected prose; default band text stands in
//   'added'     → prose was committed to a note/plan (note_id stored)
export const calculatorResults = pgTable(
  'calculator_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    encounterId: uuid('encounter_id')
      .references(() => encounters.id, { onDelete: 'cascade' }),
    calcId: uuid('calc_id')
      .notNull()
      .references(() => calculators.id, { onDelete: 'restrict' }),
    /** Frozen at runtime so re-reading old results survives calc version bumps. */
    calcSlug: text('calc_slug').notNull(),
    calcVersion: text('calc_version').notNull(),
    /** Full input map (keys match calculator_inputs.key). JSON so it survives schema drift. */
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
    /** Final numeric score. */
    score: numeric('score', { precision: 10, scale: 3 }).notNull(),
    /** Resolved band at run time. */
    bandKey: text('band_key').notNull(),
    /** Optional LLM prose (see prose_status). */
    proseText: text('prose_text'),
    proseStatus: text('prose_status').notNull().default('pending'),
    /** If prose (or raw score) was added to a note, the note id lives here. */
    addedToNoteId: uuid('added_to_note_id'),
    /** Hallucination-flag id from `hallucination_flags` when prose is flagged. */
    hallucinationFlagId: uuid('hallucination_flag_id'),
    runByUserId: uuid('run_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    runByUserName: text('run_by_user_name').notNull(),
    runByUserRole: text('run_by_user_role').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPatient: index('idx_calculator_results_patient').on(t.patientId),
    byEncounter: index('idx_calculator_results_encounter').on(t.encounterId),
    byCalc: index('idx_calculator_results_calc').on(t.calcId),
    byRunner: index('idx_calculator_results_runner').on(t.runByUserId),
    byRanAt: index('idx_calculator_results_ran_at').on(t.ranAt),
  }),
);

// ─── 6. calculator_pins ─────────────────────────────────────────
// Per-user pinned calcs. Drives the Overview smart card and the "⭐" toggle
// in the runner UI. Default pins are seeded from `calculators.pin_default_for_roles`
// on first-use; once a user explicitly pins/unpins anything, their set is authoritative.
export const calculatorPins = pgTable(
  'calculator_pins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    calcId: uuid('calc_id')
      .notNull()
      .references(() => calculators.id, { onDelete: 'cascade' }),
    /** True = pinned; False = explicitly unpinned (overrides role default). */
    pinned: boolean('pinned').notNull().default(true),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqPin: uniqueIndex('uniq_calculator_pin_user_calc').on(t.userId, t.calcId),
    byUser: index('idx_calculator_pins_user').on(t.userId),
  }),
);
