-- Patient Chart Overhaul — PC.2c1 — Named-formula registry for calculators
--
-- PC.2a shipped the `sum | weighted | conditional` rule engine (pure TS,
-- deterministic, server-side). That engine is deliberately conservative —
-- no ln(), log(), exp() — so calculators that require non-linear math
-- (MELD 3.0, eGFR CKD-EPI 2021, etc.) cannot be expressed as pure rules.
--
-- Instead of expanding the DSL (which would grow surface area and risk),
-- we add a `formula_ref` column: when set, `runCalculator()` dispatches to
-- a named, pure-TS function in `src/lib/calculators/formulas/*.ts`. Rules
-- + bands still apply (for display attribution + band resolution); the
-- score is computed by the formula. All formulas stay server-side and
-- LLM-untouchable, preserving PRD §53.
--
-- See apps/web/src/lib/calculators/scoring-engine.ts (FORMULAS registry).

ALTER TABLE calculators
  ADD COLUMN IF NOT EXISTS formula_ref text NULL;

COMMENT ON COLUMN calculators.formula_ref IS
  'Optional named-formula key. When set, scoring engine dispatches to lib/calculators/formulas[formula_ref] instead of running rule-based scoring. Used for non-linear calculators like MELD 3.0.';
