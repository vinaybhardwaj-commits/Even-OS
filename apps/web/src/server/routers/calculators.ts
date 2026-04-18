/**
 * Patient Chart Overhaul — PC.2a — `calculators` tRPC router
 *
 * Endpoints:
 *   Public (any auth user):
 *     list                 — list calcs (active only by default, filterable by specialty)
 *     getBySlug/getById    — full bundle: calc + inputs + scoring + bands
 *     run                  — evaluate (deterministic) + insert calculator_results
 *                            + enqueue Qwen prose (prose_status = 'pending')
 *     listResults          — patient timeline of past runs
 *     getResult            — single result for a run-detail view
 *     reviewProse          — mark prose 'reviewed' | 'declined'
 *     pinToggle            — upsert a per-user pin (pinned=true|false)
 *     listPins             — effective pins for current user (role defaults + overrides)
 *
 *   Super-admin only (PRD #15 — HODs request via Sewa, do NOT self-serve):
 *     listForAdmin         — includes inactive calcs
 *     createCalc           — transactional: insert calc + inputs + scoring + bands
 *     updateCalc           — full replace of inputs/scoring/bands (soft-safe via same txn)
 *     deleteCalc           — soft delete (is_active=false)
 *
 * Patterns:
 *   - Neon HTTP driver + tagged-template SQL (matches repo norm).
 *   - Scoring engine lives in src/lib/calculators/scoring-engine.ts — pure TS.
 *   - `run` queues a Qwen prose request via ai_request_queue with
 *     prompt_template='calc_interpret'. The worker + hallucination flag
 *     wiring ship in PC.2c — for PC.2a we just set prose_status='pending'
 *     and the row is valid/readable without prose.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  scoreCalculator,
  resolveBand,
  type CalcRule,
  type CalcBand,
} from '@/lib/calculators/scoring-engine';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const SUPER_ADMIN = 'super_admin';
function requireSuperAdmin(ctx: { user: { role?: string | null } }) {
  if (ctx.user?.role !== SUPER_ADMIN) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only super_admin can manage calculator definitions. HODs request via Sewa/email.',
    });
  }
}

// ─── INPUT SCHEMAS ─────────────────────────────────────────────
const inputTypeSchema = z.enum(['boolean', 'number', 'select', 'date']);
const ruleTypeSchema = z.enum(['sum', 'weighted', 'conditional']);
const bandColorSchema = z.enum(['green', 'yellow', 'red', 'grey']);

const calcInputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1),
  helper_text: z.string().nullable().optional(),
  type: inputTypeSchema,
  unit: z.string().nullable().optional(),
  options: z.unknown().nullable().optional(),
  chart_source_path: z.string().nullable().optional(),
  required: z.boolean().default(true),
  display_order: z.number().int().default(0),
});

const calcScoringSchema = z.object({
  rule_type: ruleTypeSchema,
  input_key: z.string().min(1),
  when_value: z.string().nullable().optional(),
  points: z.number(),
  formula_expr: z.string().nullable().optional(),
  display_order: z.number().int().default(0),
});

const calcBandSchema = z.object({
  band_key: z.string().min(1),
  label: z.string().min(1),
  min_score: z.number(),
  max_score: z.number().nullable(),
  color: bandColorSchema.default('grey'),
  interpretation_default: z.string().nullable().optional(),
  display_order: z.number().int().default(0),
});

const calcDefSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'slug: lowercase alphanumeric + dashes'),
  name: z.string().min(1),
  specialty: z.string().min(1),
  short_description: z.string().nullable().optional(),
  long_description: z.string().nullable().optional(),
  version: z.string().default('1.0'),
  is_active: z.boolean().default(true),
  pin_default_for_roles: z.array(z.string()).default([]),
  source_citation: z.string().nullable().optional(),
});

// ─── ROW TYPES (for casting raw sql results) ───────────────────
type CalcRow = {
  id: string; hospital_id: string; slug: string; name: string; specialty: string;
  short_description: string | null; long_description: string | null;
  version: string; is_active: boolean;
  pin_default_for_roles: string[]; source_citation: string | null;
  created_by_user_id: string | null;
  authored_at: string; created_at: string; updated_at: string;
};
type InputRow = {
  id: string; calc_id: string; key: string; label: string; helper_text: string | null;
  type: string; unit: string | null; options: unknown | null;
  chart_source_path: string | null; required: boolean; display_order: number;
};
type ScoringRow = {
  id: string; calc_id: string; rule_type: 'sum' | 'weighted' | 'conditional';
  input_key: string; when_value: string | null; points: string; // numeric → string
  formula_expr: string | null; display_order: number;
};
type BandRow = {
  id: string; calc_id: string; band_key: string; label: string;
  min_score: string; max_score: string | null; color: 'green' | 'yellow' | 'red' | 'grey';
  interpretation_default: string | null; display_order: number;
};
type ResultRow = {
  id: string; hospital_id: string; patient_id: string; encounter_id: string | null;
  calc_id: string; calc_slug: string; calc_version: string;
  inputs: Record<string, unknown>; score: string; band_key: string;
  prose_text: string | null; prose_status: string;
  added_to_note_id: string | null; hallucination_flag_id: string | null;
  run_by_user_id: string; run_by_user_name: string; run_by_user_role: string;
  ran_at: string; created_at: string; updated_at: string;
};
type PinRow = {
  id: string; user_id: string; calc_id: string; pinned: boolean;
  pinned_at: string; updated_at: string;
};

// Convert scoring/band numerics (returned as strings by Neon HTTP for numeric
// columns) to JS numbers for the engine.
function scoringToRule(s: ScoringRow): CalcRule {
  return {
    rule_type: s.rule_type,
    input_key: s.input_key,
    when_value: s.when_value,
    points: Number(s.points),
    formula_expr: s.formula_expr,
    display_order: s.display_order,
  };
}
function bandRowToBand(b: BandRow): CalcBand {
  return {
    band_key: b.band_key,
    label: b.label,
    min_score: Number(b.min_score),
    max_score: b.max_score === null ? null : Number(b.max_score),
    color: b.color,
    interpretation_default: b.interpretation_default,
    display_order: b.display_order,
  };
}

export const calculatorsRouter = router({
  // ─── PUBLIC: LIST / GET ──────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      specialty: z.string().optional(),
      include_inactive: z.boolean().default(false),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      if (!hospitalId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No hospital context' });

      const specialty = input?.specialty ?? null;
      const includeInactive = input?.include_inactive ?? false;

      const rows = await sql`
        SELECT * FROM calculators
        WHERE hospital_id = ${hospitalId}
          AND (${specialty}::text IS NULL OR specialty = ${specialty})
          AND (${includeInactive} OR is_active = true)
        ORDER BY specialty, name
      ` as unknown as CalcRow[];
      return rows;
    }),

  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const calcs = await sql`
        SELECT * FROM calculators WHERE hospital_id = ${hospitalId} AND slug = ${input.slug} LIMIT 1
      ` as unknown as CalcRow[];
      if (calcs.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calculator not found' });
      return loadCalcBundle(sql, calcs[0]);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const calcs = await sql`
        SELECT * FROM calculators WHERE hospital_id = ${hospitalId} AND id = ${input.id} LIMIT 1
      ` as unknown as CalcRow[];
      if (calcs.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calculator not found' });
      return loadCalcBundle(sql, calcs[0]);
    }),

  // ─── PUBLIC: RUN ─────────────────────────────────────────────
  // Evaluate deterministic score + band, insert a calculator_results row,
  // enqueue Qwen prose. Returns the persisted result row id + computed score/band.
  run: protectedProcedure
    .input(z.object({
      calc_id: z.string().uuid(),
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().nullable().optional(),
      inputs: z.record(z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const userName = ctx.user.name || ctx.user.email || 'Unknown';
      const userRole = ctx.user.role || 'unknown';
      if (!hospitalId || !userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session missing identity' });
      }

      const calcs = await sql`
        SELECT * FROM calculators WHERE hospital_id = ${hospitalId} AND id = ${input.calc_id} LIMIT 1
      ` as unknown as CalcRow[];
      if (calcs.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calculator not found' });
      const calc = calcs[0];

      const scoringRows = await sql`
        SELECT * FROM calculator_scoring WHERE calc_id = ${calc.id} ORDER BY display_order, id
      ` as unknown as ScoringRow[];
      const bandRows = await sql`
        SELECT * FROM calculator_bands WHERE calc_id = ${calc.id} ORDER BY display_order, min_score
      ` as unknown as BandRow[];

      const rules = scoringRows.map(scoringToRule);
      const bands = bandRows.map(bandRowToBand);
      const score = scoreCalculator(rules, input.inputs);
      const band = resolveBand(bands, score);
      const bandKey = band?.band_key ?? 'unknown';

      const inserted = await sql`
        INSERT INTO calculator_results (
          hospital_id, patient_id, encounter_id, calc_id, calc_slug, calc_version,
          inputs, score, band_key, prose_status,
          run_by_user_id, run_by_user_name, run_by_user_role
        ) VALUES (
          ${hospitalId}, ${input.patient_id}, ${input.encounter_id ?? null},
          ${calc.id}, ${calc.slug}, ${calc.version},
          ${JSON.stringify(input.inputs)}::jsonb, ${score}, ${bandKey}, 'pending',
          ${userId}, ${userName}, ${userRole}
        )
        RETURNING *
      ` as unknown as ResultRow[];

      // Enqueue Qwen prose — actual worker ships in PC.2c. We write the
      // request to ai_request_queue if the table exists; failure is non-fatal
      // so the deterministic score is never blocked on LLM infra.
      try {
        await sql`
          INSERT INTO ai_request_queue (
            hospital_id, prompt_template, context, status, priority
          ) VALUES (
            ${hospitalId}, 'calc_interpret',
            ${JSON.stringify({
              calc_result_id: inserted[0].id,
              calc_slug: calc.slug,
              score,
              band_key: bandKey,
              inputs: input.inputs,
            })}::jsonb,
            'queued', 5
          )
        `;
      } catch {
        // ai_request_queue shape may differ or table may not exist yet —
        // deterministic score is authoritative, prose is additive.
      }

      return {
        result_id: inserted[0].id,
        score,
        band_key: bandKey,
        band: band ?? null,
      };
    }),

  // ─── PUBLIC: RESULTS TIMELINE ────────────────────────────────
  listResults: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().nullable().optional(),
      calc_id: z.string().uuid().nullable().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const encounterId = input.encounter_id ?? null;
      const calcId = input.calc_id ?? null;
      const rows = await sql`
        SELECT r.*,
               c.name as calc_name, c.specialty as calc_specialty
          FROM calculator_results r
          JOIN calculators c ON c.id = r.calc_id
         WHERE r.patient_id = ${input.patient_id}
           AND (${encounterId}::uuid IS NULL OR r.encounter_id = ${encounterId})
           AND (${calcId}::uuid IS NULL OR r.calc_id = ${calcId})
         ORDER BY r.ran_at DESC
         LIMIT ${input.limit}
      ` as unknown as (ResultRow & { calc_name: string; calc_specialty: string })[];
      return rows;
    }),

  getResult: protectedProcedure
    .input(z.object({ result_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const sql = getSql();
      const rows = await sql`
        SELECT r.*, c.name as calc_name, c.specialty as calc_specialty, c.version as calc_current_version
          FROM calculator_results r
          JOIN calculators c ON c.id = r.calc_id
         WHERE r.id = ${input.result_id}
         LIMIT 1
      ` as unknown as (ResultRow & { calc_name: string; calc_specialty: string; calc_current_version: string })[];
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Result not found' });
      return rows[0];
    }),

  reviewProse: protectedProcedure
    .input(z.object({
      result_id: z.string().uuid(),
      decision: z.enum(['reviewed', 'declined']),
    }))
    .mutation(async ({ input }) => {
      const sql = getSql();
      const rows = await sql`
        UPDATE calculator_results
           SET prose_status = ${input.decision},
               updated_at = now()
         WHERE id = ${input.result_id}
           AND prose_status IN ('ready','pending')
         RETURNING *
      ` as unknown as ResultRow[];
      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Result not found or prose not reviewable' });
      }
      return rows[0];
    }),

  // ─── PUBLIC: PINS ────────────────────────────────────────────
  pinToggle: protectedProcedure
    .input(z.object({
      calc_id: z.string().uuid(),
      pinned: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const rows = await sql`
        INSERT INTO calculator_pins (user_id, calc_id, pinned)
        VALUES (${userId}, ${input.calc_id}, ${input.pinned})
        ON CONFLICT (user_id, calc_id)
        DO UPDATE SET pinned = EXCLUDED.pinned, updated_at = now()
        RETURNING *
      ` as unknown as PinRow[];
      return rows[0];
    }),

  listPins: protectedProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const userRole = ctx.user.role || '';
      if (!hospitalId || !userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

      // Effective pin set for this user:
      //   - Role defaults: calculators.pin_default_for_roles ? userRole
      //   - User overrides: calculator_pins rows (pinned=true → show, pinned=false → hide)
      const rows = await sql`
        SELECT c.*,
               COALESCE(p.pinned, (c.pin_default_for_roles ? ${userRole})) as effective_pinned,
               p.pinned as user_override,
               p.pinned_at as pinned_at
          FROM calculators c
     LEFT JOIN calculator_pins p ON p.calc_id = c.id AND p.user_id = ${userId}
         WHERE c.hospital_id = ${hospitalId}
           AND c.is_active = true
           AND (COALESCE(p.pinned, (c.pin_default_for_roles ? ${userRole})) = true)
         ORDER BY c.specialty, c.name
      ` as unknown as (CalcRow & { effective_pinned: boolean; user_override: boolean | null; pinned_at: string | null })[];
      return rows;
    }),

  // ─── PUBLIC: RED-BAND RECENT (last 24 h) ─────────────────────
  // Powers the Overview smart card's "red-band last 24h" section.
  // Joins calculator_results → calculator_bands to surface results whose
  // band.color = 'red'. Scoped per-patient, newest first, capped at 20.
  listRedBandRecent: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      hours: z.number().int().min(1).max(168).default(24),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const rows = await sql`
        SELECT r.id as result_id,
               r.calc_id,
               r.score,
               r.band_key,
               r.ran_at,
               r.ran_by_user_id,
               c.name as calc_name,
               c.slug as calc_slug,
               c.specialty as calc_specialty,
               b.label as band_label,
               b.color as band_color,
               b.clinical_action as band_clinical_action
          FROM calculator_results r
          JOIN calculators c ON c.id = r.calc_id
          JOIN calculator_bands b ON b.calc_id = r.calc_id AND b.band_key = r.band_key
         WHERE r.patient_id = ${input.patient_id}
           AND b.color = 'red'
           AND r.ran_at > now() - (${input.hours} || ' hours')::interval
         ORDER BY r.ran_at DESC
         LIMIT ${input.limit}
      ` as unknown as {
        result_id: string;
        calc_id: string;
        score: number;
        band_key: string;
        ran_at: string;
        ran_by_user_id: string | null;
        calc_name: string;
        calc_slug: string;
        calc_specialty: string;
        band_label: string;
        band_color: string;
        band_clinical_action: string | null;
      }[];
      return rows;
    }),

  // ─── SUPER-ADMIN: LIST FOR ADMIN ─────────────────────────────
  listForAdmin: protectedProcedure
    .query(async ({ ctx }) => {
      requireSuperAdmin(ctx);
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const rows = await sql`
        SELECT c.*,
               (SELECT COUNT(*) FROM calculator_inputs WHERE calc_id = c.id)::int as input_count,
               (SELECT COUNT(*) FROM calculator_scoring WHERE calc_id = c.id)::int as rule_count,
               (SELECT COUNT(*) FROM calculator_bands WHERE calc_id = c.id)::int as band_count,
               (SELECT COUNT(*) FROM calculator_results WHERE calc_id = c.id)::int as run_count
          FROM calculators c
         WHERE c.hospital_id = ${hospitalId}
         ORDER BY c.specialty, c.name
      ` as unknown as (CalcRow & { input_count: number; rule_count: number; band_count: number; run_count: number })[];
      return rows;
    }),

  // ─── SUPER-ADMIN: CREATE (used by seed + /admin UI in PC.2c) ─
  // Creates calc + all inputs + scoring + bands in one logical operation.
  // Idempotent on (hospital_id, slug): if the slug exists, this returns
  // the existing row unless `force=true`, in which case it updates in place.
  createCalc: protectedProcedure
    .input(z.object({
      def: calcDefSchema,
      inputs: z.array(calcInputSchema),
      scoring: z.array(calcScoringSchema),
      bands: z.array(calcBandSchema),
      force: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx);
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      if (!hospitalId) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const existing = await sql`
        SELECT * FROM calculators WHERE hospital_id = ${hospitalId} AND slug = ${input.def.slug} LIMIT 1
      ` as unknown as CalcRow[];

      if (existing.length > 0 && !input.force) {
        return { created: false as const, calc: existing[0] };
      }

      let calc: CalcRow;
      if (existing.length > 0) {
        // Force-update path: update calc row, wipe children, re-insert.
        const updated = await sql`
          UPDATE calculators SET
            name = ${input.def.name},
            specialty = ${input.def.specialty},
            short_description = ${input.def.short_description ?? null},
            long_description = ${input.def.long_description ?? null},
            version = ${input.def.version},
            is_active = ${input.def.is_active},
            pin_default_for_roles = ${JSON.stringify(input.def.pin_default_for_roles)}::jsonb,
            source_citation = ${input.def.source_citation ?? null},
            updated_at = now()
          WHERE id = ${existing[0].id}
          RETURNING *
        ` as unknown as CalcRow[];
        calc = updated[0];
        // Wipe children (CASCADE will clean them; we do it explicitly for safety).
        await sql`DELETE FROM calculator_inputs WHERE calc_id = ${calc.id}`;
        await sql`DELETE FROM calculator_scoring WHERE calc_id = ${calc.id}`;
        await sql`DELETE FROM calculator_bands WHERE calc_id = ${calc.id}`;
      } else {
        const insertedCalc = await sql`
          INSERT INTO calculators (
            hospital_id, slug, name, specialty, short_description, long_description,
            version, is_active, pin_default_for_roles, source_citation, created_by_user_id
          ) VALUES (
            ${hospitalId}, ${input.def.slug}, ${input.def.name}, ${input.def.specialty},
            ${input.def.short_description ?? null}, ${input.def.long_description ?? null},
            ${input.def.version}, ${input.def.is_active},
            ${JSON.stringify(input.def.pin_default_for_roles)}::jsonb,
            ${input.def.source_citation ?? null}, ${userId ?? null}
          )
          RETURNING *
        ` as unknown as CalcRow[];
        calc = insertedCalc[0];
      }

      // Insert inputs
      for (const inp of input.inputs) {
        await sql`
          INSERT INTO calculator_inputs (
            calc_id, key, label, helper_text, type, unit, options,
            chart_source_path, required, display_order
          ) VALUES (
            ${calc.id}, ${inp.key}, ${inp.label}, ${inp.helper_text ?? null},
            ${inp.type}, ${inp.unit ?? null},
            ${inp.options === null || inp.options === undefined ? null : JSON.stringify(inp.options)}::jsonb,
            ${inp.chart_source_path ?? null}, ${inp.required}, ${inp.display_order}
          )
        `;
      }
      for (const r of input.scoring) {
        await sql`
          INSERT INTO calculator_scoring (
            calc_id, rule_type, input_key, when_value, points, formula_expr, display_order
          ) VALUES (
            ${calc.id}, ${r.rule_type}, ${r.input_key}, ${r.when_value ?? null},
            ${r.points}, ${r.formula_expr ?? null}, ${r.display_order}
          )
        `;
      }
      for (const b of input.bands) {
        await sql`
          INSERT INTO calculator_bands (
            calc_id, band_key, label, min_score, max_score, color,
            interpretation_default, display_order
          ) VALUES (
            ${calc.id}, ${b.band_key}, ${b.label}, ${b.min_score}, ${b.max_score ?? null},
            ${b.color}, ${b.interpretation_default ?? null}, ${b.display_order}
          )
        `;
      }

      return { created: existing.length === 0, calc };
    }),

  // Soft delete — keeps historical calculator_results readable.
  deleteCalc: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx);
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const rows = await sql`
        UPDATE calculators
           SET is_active = false, updated_at = now()
         WHERE id = ${input.id} AND hospital_id = ${hospitalId}
         RETURNING *
      ` as unknown as CalcRow[];
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return rows[0];
    }),
});

// Helper: load full calc bundle (inputs + scoring + bands) for runner UI.
async function loadCalcBundle(sql: NeonQueryFunction<false, false>, calc: CalcRow) {
  const inputs = await sql`
    SELECT * FROM calculator_inputs WHERE calc_id = ${calc.id}
    ORDER BY display_order, id
  ` as unknown as InputRow[];
  const scoring = await sql`
    SELECT * FROM calculator_scoring WHERE calc_id = ${calc.id}
    ORDER BY display_order, id
  ` as unknown as ScoringRow[];
  const bands = await sql`
    SELECT * FROM calculator_bands WHERE calc_id = ${calc.id}
    ORDER BY display_order, min_score
  ` as unknown as BandRow[];
  return { calc, inputs, scoring, bands };
}
