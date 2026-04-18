-- Patient Chart Overhaul — PC.2a — MDCalc-style clinical calculators
-- Six tables: calculators (definitions), calculator_inputs (fields),
-- calculator_scoring (rules), calculator_bands (risk bands),
-- calculator_results (immutable runs per patient), calculator_pins
-- (per-user favourites). Scoring is deterministic server-side; only
-- prose is LLM-authored and gated by `prose_status`.
--
-- See apps/web/drizzle/schema/54-calculators.ts for full column docs.

-- ─── 1. calculators ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calculators (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                 text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  slug                        text NOT NULL,
  name                        text NOT NULL,
  specialty                   text NOT NULL,
  short_description           text NULL,
  long_description            text NULL,
  version                     text NOT NULL DEFAULT '1.0',
  is_active                   boolean NOT NULL DEFAULT true,
  pin_default_for_roles       jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_citation             text NULL,
  created_by_user_id          uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  authored_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_calculator_slug
  ON calculators (hospital_id, slug);

CREATE INDEX IF NOT EXISTS idx_calculators_specialty
  ON calculators (specialty);

CREATE INDEX IF NOT EXISTS idx_calculators_active
  ON calculators (is_active);

-- ─── 2. calculator_inputs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calculator_inputs (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calc_id                     uuid NOT NULL REFERENCES calculators(id) ON DELETE CASCADE,
  key                         text NOT NULL,
  label                       text NOT NULL,
  helper_text                 text NULL,
  type                        text NOT NULL, -- 'boolean' | 'number' | 'select' | 'date'
  unit                        text NULL,
  options                     jsonb NULL,
  chart_source_path           text NULL,
  required                    boolean NOT NULL DEFAULT true,
  display_order               integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_calculator_input_key
  ON calculator_inputs (calc_id, key);

CREATE INDEX IF NOT EXISTS idx_calculator_inputs_calc
  ON calculator_inputs (calc_id);

CREATE INDEX IF NOT EXISTS idx_calculator_inputs_order
  ON calculator_inputs (calc_id, display_order);

-- ─── 3. calculator_scoring ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS calculator_scoring (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calc_id                     uuid NOT NULL REFERENCES calculators(id) ON DELETE CASCADE,
  rule_type                   text NOT NULL, -- 'sum' | 'weighted' | 'conditional'
  input_key                   text NOT NULL,
  when_value                  text NULL,
  points                      numeric(10,3) NOT NULL,
  formula_expr                text NULL,
  display_order               integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calculator_scoring_calc
  ON calculator_scoring (calc_id);

CREATE INDEX IF NOT EXISTS idx_calculator_scoring_input
  ON calculator_scoring (calc_id, input_key);

-- ─── 4. calculator_bands ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calculator_bands (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calc_id                     uuid NOT NULL REFERENCES calculators(id) ON DELETE CASCADE,
  band_key                    text NOT NULL,
  label                       text NOT NULL,
  min_score                   numeric(10,3) NOT NULL,
  max_score                   numeric(10,3) NULL, -- NULL = open-ended upper band
  color                       text NOT NULL DEFAULT 'grey', -- 'green' | 'yellow' | 'red' | 'grey'
  interpretation_default      text NULL,
  display_order               integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_calculator_band_key
  ON calculator_bands (calc_id, band_key);

CREATE INDEX IF NOT EXISTS idx_calculator_bands_calc
  ON calculator_bands (calc_id);

-- ─── 5. calculator_results ───────────────────────────────────────
-- Immutable audit. One row per run. Frozen calc_slug + calc_version so
-- historical reads survive calc version bumps. prose_status enforces the
-- "I've reviewed" gate before prose enters a note.
CREATE TABLE IF NOT EXISTS calculator_results (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                 text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  patient_id                  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id                uuid NULL REFERENCES encounters(id) ON DELETE CASCADE,
  calc_id                     uuid NOT NULL REFERENCES calculators(id) ON DELETE RESTRICT,
  calc_slug                   text NOT NULL,
  calc_version                text NOT NULL,
  inputs                      jsonb NOT NULL,
  score                       numeric(10,3) NOT NULL,
  band_key                    text NOT NULL,
  prose_text                  text NULL,
  prose_status                text NOT NULL DEFAULT 'pending',
  -- 'pending' | 'ready' | 'reviewed' | 'declined' | 'added'
  added_to_note_id            uuid NULL,
  hallucination_flag_id       uuid NULL,
  run_by_user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_by_user_name            text NOT NULL,
  run_by_user_role            text NOT NULL,
  ran_at                      timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calculator_results_patient
  ON calculator_results (patient_id);

CREATE INDEX IF NOT EXISTS idx_calculator_results_encounter
  ON calculator_results (encounter_id);

CREATE INDEX IF NOT EXISTS idx_calculator_results_calc
  ON calculator_results (calc_id);

CREATE INDEX IF NOT EXISTS idx_calculator_results_runner
  ON calculator_results (run_by_user_id);

CREATE INDEX IF NOT EXISTS idx_calculator_results_ran_at
  ON calculator_results (ran_at);

-- ─── 6. calculator_pins ──────────────────────────────────────────
-- Per-user pinned calcs. Pinned=false = explicit un-pin overriding the
-- role default derived from calculators.pin_default_for_roles.
CREATE TABLE IF NOT EXISTS calculator_pins (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calc_id                     uuid NOT NULL REFERENCES calculators(id) ON DELETE CASCADE,
  pinned                      boolean NOT NULL DEFAULT true,
  pinned_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_calculator_pin_user_calc
  ON calculator_pins (user_id, calc_id);

CREATE INDEX IF NOT EXISTS idx_calculator_pins_user
  ON calculator_pins (user_id);
