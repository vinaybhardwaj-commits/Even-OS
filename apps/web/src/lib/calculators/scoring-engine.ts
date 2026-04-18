/**
 * Patient Chart Overhaul — PC.2a — Deterministic calculator scoring engine
 *
 * PRD v2.0 §53 guard: scoring is deterministic, server-side, pure TS. The
 * LLM never touches the numeric score — only the prose interpretation. This
 * file is the sole author of `calculator_results.score` + `band_key`.
 *
 * Rule model (mirrors `calculator_scoring.rule_type`):
 *
 *   'sum'         — If inputs[input_key] equals when_value, add points.
 *                   Booleans compared as strings ("true"/"false").
 *                   When when_value is NULL, the rule fires if inputs[input_key]
 *                   is truthy — the boolean shorthand.
 *                   Select options compared to their `value` field.
 *   'weighted'    — Multiply inputs[input_key] (as number) by points.
 *                   No when_value used. Useful for MELD/Child-Pugh-style
 *                   coefficient scoring.
 *   'conditional' — Evaluate formula_expr with inputs as the context. Only
 *                   a tiny, safe comparison subset is accepted:
 *                       <key> <op> <literal>
 *                   where op ∈ {==, !=, <, <=, >, >=}. Adds points on true.
 *                   NO arbitrary JS. Any parse failure = skip the rule.
 *
 * Band resolution:
 *   - Find the band where min_score <= score, and max_score IS NULL OR
 *     score <= max_score. First match wins when bands overlap (they
 *     shouldn't — the authoring UI enforces). Rounded per band precision
 *     of 3 decimals (matches numeric(10,3) in the schema).
 *   - If no band matches, returns 'unknown' band so the runner still renders.
 */

export type CalcRule = {
  rule_type: 'sum' | 'weighted' | 'conditional';
  input_key: string;
  when_value: string | null;
  points: number;
  formula_expr: string | null;
  display_order?: number;
};

export type CalcBand = {
  band_key: string;
  label: string;
  min_score: number;
  max_score: number | null;
  color: 'green' | 'yellow' | 'red' | 'grey';
  interpretation_default: string | null;
  display_order?: number;
};

export type CalcInputs = Record<string, unknown>;

function toComparable(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Tiny safe expression evaluator. Accepts exactly one binary comparison.
// Examples it accepts:
//   "age >= 75"
//   "sex == 'female'"
//   "creatinine < 1.5"
// Anything else -> false.
const EXPR_RE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*('([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s*$/;

export function evalFormula(expr: string, inputs: CalcInputs): boolean {
  const m = expr.match(EXPR_RE);
  if (!m) return false;
  const [, key, op, , sq, dq, num] = m;
  const lhs = inputs[key];
  let rhs: string | number;
  if (num !== undefined) rhs = Number(num);
  else rhs = sq ?? dq ?? '';

  if (typeof rhs === 'number') {
    const lhsN = toNumber(lhs);
    if (lhsN === null) return false;
    switch (op) {
      case '==': return lhsN === rhs;
      case '!=': return lhsN !== rhs;
      case '<':  return lhsN < rhs;
      case '<=': return lhsN <= rhs;
      case '>':  return lhsN > rhs;
      case '>=': return lhsN >= rhs;
      default: return false;
    }
  } else {
    const lhsS = toComparable(lhs);
    switch (op) {
      case '==': return lhsS === rhs;
      case '!=': return lhsS !== rhs;
      default: return false; // string ordering disallowed to keep intent clear
    }
  }
}

export function scoreCalculator(rules: CalcRule[], inputs: CalcInputs): number {
  let score = 0;
  for (const r of rules) {
    if (r.rule_type === 'sum') {
      // when_value === null means "input must be truthy" — the boolean
      // shorthand. Lets CHA2DS2-VASc / HAS-BLED / Wells / qSOFA author
      // a simple +N-on-true rule without the `when_value: 'true'` boilerplate.
      if (r.when_value === null) {
        if (inputs[r.input_key] === true || toComparable(inputs[r.input_key]) === 'true') {
          score += Number(r.points);
        }
        continue;
      }
      const got = toComparable(inputs[r.input_key]);
      if (got === r.when_value) score += Number(r.points);
    } else if (r.rule_type === 'weighted') {
      const n = toNumber(inputs[r.input_key]);
      if (n === null) continue;
      score += n * Number(r.points);
    } else if (r.rule_type === 'conditional') {
      if (!r.formula_expr) continue;
      if (evalFormula(r.formula_expr, inputs)) score += Number(r.points);
    }
  }
  // Round to 3 decimals to match numeric(10,3) precision.
  return Math.round(score * 1000) / 1000;
}

export function resolveBand(bands: CalcBand[], score: number): CalcBand | null {
  // Sort by min_score ascending to give deterministic "first match wins".
  const sorted = [...bands].sort((a, b) => a.min_score - b.min_score);
  for (const b of sorted) {
    const minOk = score >= b.min_score;
    const maxOk = b.max_score === null || score <= b.max_score;
    if (minOk && maxOk) return b;
  }
  return null;
}

export function runCalculator(
  rules: CalcRule[],
  bands: CalcBand[],
  inputs: CalcInputs,
): { score: number; band: CalcBand | null } {
  const score = scoreCalculator(rules, inputs);
  const band = resolveBand(bands, score);
  return { score, band };
}
