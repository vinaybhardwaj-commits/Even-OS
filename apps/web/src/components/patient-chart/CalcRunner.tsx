'use client';

/**
 * CalcRunner — PC.2b1 (18 Apr 2026)
 *
 * Renders a single clinical calculator's input form, collects values,
 * submits to calculators.run, and shows the deterministic result card.
 *
 * Guards baked in:
 *   - Numeric score is ALWAYS computed server-side (calculators.run).
 *     LLM never touches the number (PRD §53).
 *   - Prose comes later: result.prose_status starts 'pending' in v1.
 *     PC.2c wires the Qwen worker.
 *   - "📋 from chart" badge on any input that pre-filled from the chart;
 *     clinician can edit the value directly (override always wins).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveChartValue,
  type ChartContext,
} from '@/lib/calculators/resolve-chart-value';

// Shape returned by calculators.getById / loadCalcBundle on the server.
interface InputRow {
  id: string;
  key: string;
  label: string;
  helper_text: string | null;
  type: 'boolean' | 'number' | 'select' | 'date';
  unit: string | null;
  options: unknown | null; // JSONB — may be [{value,label}, ...] or null
  chart_source_path: string | null;
  required: boolean;
  display_order: number;
}

interface BandRow {
  id: string;
  band_key: string;
  label: string;
  min_score: string | number;
  max_score: string | number | null;
  color: 'green' | 'yellow' | 'red' | 'grey';
  interpretation_default: string | null;
  display_order: number;
}

interface CalcRow {
  id: string;
  slug: string;
  name: string;
  specialty: string;
  short_description: string | null;
  long_description: string | null;
  version: string;
  source_citation: string | null;
}

export interface CalcBundle {
  calc: CalcRow;
  inputs: InputRow[];
  scoring: unknown[]; // runner doesn't use scoring rows (server evaluates)
  bands: BandRow[];
}

interface RunResponse {
  result_id: string;
  score: number | string;
  band_key: string;
  band: BandRow | null;
}

// ── tRPC helpers (BriefTab convention) ─────────────────────────────────────
async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`Mutation failed: ${res.status}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.message || json.error?.json?.message || 'Mutation error';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

const BAND_COLORS: Record<BandRow['color'], { bg: string; fg: string; border: string }> = {
  green:  { bg: '#dcfce7', fg: '#166534', border: '#86efac' },
  yellow: { bg: '#fef9c3', fg: '#854d0e', border: '#fde047' },
  red:    { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
  grey:   { bg: '#f3f4f6', fg: '#374151', border: '#d1d5db' },
};

// Safely pull {value, label} pairs out of the JSONB options column.
function parseSelectOptions(raw: unknown): Array<{ value: string; label: string }> {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  const out: Array<{ value: string; label: string }> = [];
  for (const o of raw as any[]) {
    if (!o) continue;
    if (typeof o === 'string') {
      out.push({ value: o, label: o });
    } else if (typeof o === 'object') {
      const v = o.value ?? o.key ?? o.id;
      const l = o.label ?? o.text ?? o.name ?? v;
      if (v !== undefined) out.push({ value: String(v), label: String(l) });
    }
  }
  return out;
}

interface Props {
  bundle: CalcBundle;
  patientId: string;
  encounterId?: string | null;
  chartContext: ChartContext;
}

export default function CalcRunner({ bundle, patientId, encounterId, chartContext }: Props) {
  const { calc, inputs, bands } = bundle;

  // Pre-seed values from the chart resolver; clinician can override any field.
  const initial = useMemo(() => {
    const out: Record<string, { value: any; source: string | null }> = {};
    for (const inp of inputs) {
      const r = resolveChartValue(inp.chart_source_path, chartContext);
      if (r !== null) {
        out[inp.key] = { value: r.value, source: r.source };
      } else {
        if (inp.type === 'boolean') out[inp.key] = { value: false, source: null };
        else if (inp.type === 'number') out[inp.key] = { value: '', source: null };
        else out[inp.key] = { value: '', source: null };
      }
    }
    return out;
    // re-seed whenever a new calc is picked or chart changes materially
  }, [calc.id, chartContext]);

  const [values, setValues] = useState<Record<string, { value: any; source: string | null }>>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  // PC.2b2 polish — scroll result card into view after submit so the
  // clinician doesn't miss the score below the fold.
  const resultRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!result) return;
    const node = resultRef.current;
    if (!node || typeof node.scrollIntoView !== 'function') return;
    const t = setTimeout(() => {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 40);
    return () => clearTimeout(t);
  }, [result]);

  // ── PC.2b3 — chart actions on the result card (Add-to-Note / Add-to-Plan / Share-to-Comms) ──
  // All three mutations need encounter_id. The buttons disable themselves when it's absent.
  type ActionKey = 'note' | 'plan' | 'comms';
  const [actionBusy, setActionBusy] = useState<ActionKey | null>(null);
  const [actionDone, setActionDone] = useState<Partial<Record<ActionKey, number>>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const markDone = (k: ActionKey) => {
    setActionDone(prev => ({ ...prev, [k]: Date.now() }));
    // clear "✓ Added" badge after 2.4s
    setTimeout(() => {
      setActionDone(prev => {
        const { [k]: _drop, ...rest } = prev;
        return rest;
      });
    }, 2400);
  };

  // Build a clinician-readable snippet with attribution (PRD lock #20).
  const buildSnippet = (): string => {
    if (!result) return '';
    const bandLabel = result.band?.label || result.band_key;
    const interp = result.band?.interpretation_default || '';
    const lines = [
      `${calc.name} — Score ${String(result.score)} (${bandLabel})`,
      interp ? interp : null,
      `Calculator result: ${result.result_id}`,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const handleAddToNote = async () => {
    if (!result || !encounterId) return;
    setActionBusy('note'); setActionError(null);
    try {
      const snippet = buildSnippet();
      await trpcMutate('clinicalNotes.createProgressNote', {
        patient_id: patientId,
        encounter_id: encounterId,
        assessment: snippet,
        status: 'draft',
      });
      markDone('note');
    } catch (e: any) {
      setActionError(e?.message || 'Failed to add to note.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleAddToPlan = async () => {
    if (!result || !encounterId) return;
    setActionBusy('plan'); setActionError(null);
    try {
      const bandLabel = result.band?.label || result.band_key;
      const interp = result.band?.interpretation_default || '';
      await trpcMutate('conditions.create', {
        patient_id: patientId,
        encounter_id: encounterId,
        condition_name: `${calc.name} risk: ${bandLabel}`,
        clinical_status: 'active',
        verification_status: 'provisional',
        notes: `Score ${String(result.score)} (${bandLabel}).${interp ? ' ' + interp : ''} Calculator result: ${result.result_id}`,
      });
      markDone('plan');
    } catch (e: any) {
      setActionError(e?.message || 'Failed to add to plan.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleShareToComms = async () => {
    if (!result || !encounterId) return;
    setActionBusy('comms'); setActionError(null);
    try {
      const snippet = buildSnippet();
      const isRed = result.band?.color === 'red';
      await trpcMutate('chat.sendMessage', {
        channelId: `patient-${encounterId}`,
        content: snippet,
        messageType: 'chat',
        priority: isRed ? 'high' : 'normal',
        metadata: { source: 'calc-runner', calc_id: calc.id, calc_result_id: result.result_id },
      });
      markDone('comms');
    } catch (e: any) {
      setActionError(e?.message || 'Failed to share to comms.');
    } finally {
      setActionBusy(null);
    }
  };

  const setVal = (key: string, v: any) => {
    setValues(prev => ({ ...prev, [key]: { value: v, source: null } })); // overriding clears the badge
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, any> = {};
      for (const inp of inputs) {
        const slot = values[inp.key];
        if (slot === undefined) continue;
        const raw = slot.value;
        if (inp.type === 'number') {
          payload[inp.key] = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        } else {
          payload[inp.key] = raw;
        }
      }
      const res: RunResponse = await trpcMutate('calculators.run', {
        calc_id: calc.id,
        patient_id: patientId,
        encounter_id: encounterId || null,
        inputs: payload,
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to run calculator.');
    } finally {
      setRunning(false);
    }
  };

  const handleReset = () => {
    setValues(initial);
    setResult(null);
    setError(null);
  };

  const bandColorKey: BandRow['color'] = result?.band?.color ?? 'grey';
  const bandColors = BAND_COLORS[bandColorKey];

  return (
    <div style={{ padding: '20px 24px', maxWidth: 720 }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#002054' }}>{calc.name}</h2>
          {calc.specialty ? (
            <span style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              color: '#666', background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, letterSpacing: 0.3,
            }}>{calc.specialty}</span>
          ) : null}
          {calc.version ? (
            <span style={{ fontSize: 11, color: '#999' }}>v{calc.version}</span>
          ) : null}
        </div>
        {calc.short_description ? (
          <p style={{ fontSize: 14, color: '#475569', margin: '6px 0 0' }}>{calc.short_description}</p>
        ) : null}
      </div>

      {/* ── Inputs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {inputs.slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)).map(inp => {
          const slot = values[inp.key] || { value: '', source: null };
          const hasSource = !!slot.source;
          const selectOptions = inp.type === 'select' ? parseSelectOptions(inp.options) : [];
          return (
            <div key={inp.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: hasSource ? '#eff6ff' : '#ffffff',
              border: `1px solid ${hasSource ? '#bfdbfe' : '#e5e7eb'}`,
              borderRadius: 8,
              gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{inp.label}</div>
                {hasSource ? (
                  <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 2 }}>
                    📋 from chart · {slot.source}
                  </div>
                ) : inp.helper_text ? (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{inp.helper_text}</div>
                ) : null}
              </div>
              <div>
                {inp.type === 'boolean' ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setVal(inp.key, true)}
                      style={{
                        padding: '6px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                        border: slot.value === true ? '1px solid #0055FF' : '1px solid #d1d5db',
                        background: slot.value === true ? '#0055FF' : '#fff',
                        color: slot.value === true ? '#fff' : '#374151',
                      }}
                    >Yes</button>
                    <button
                      onClick={() => setVal(inp.key, false)}
                      style={{
                        padding: '6px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                        border: slot.value === false ? '1px solid #64748b' : '1px solid #d1d5db',
                        background: slot.value === false ? '#64748b' : '#fff',
                        color: slot.value === false ? '#fff' : '#374151',
                      }}
                    >No</button>
                  </div>
                ) : inp.type === 'select' ? (
                  <select
                    value={String(slot.value ?? '')}
                    onChange={e => setVal(inp.key, e.target.value)}
                    style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', minWidth: 160 }}
                  >
                    <option value="">—</option>
                    {selectOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : inp.type === 'number' ? (
                  <input
                    type="number"
                    value={slot.value ?? ''}
                    onChange={e => setVal(inp.key, e.target.value)}
                    style={{ width: 110, padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, textAlign: 'right' }}
                    placeholder={inp.unit || ''}
                  />
                ) : (
                  <input
                    type={inp.type === 'date' ? 'date' : 'text'}
                    value={String(slot.value ?? '')}
                    onChange={e => setVal(inp.key, e.target.value)}
                    style={{ width: 180, padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Run / Reset ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8,
            background: running ? '#94a3b8' : '#0055FF', color: '#fff',
            border: 'none', cursor: running ? 'not-allowed' : 'pointer',
          }}
        >{running ? 'Running…' : 'Run calculator'}</button>
        <button
          onClick={handleReset}
          disabled={running}
          style={{
            padding: '10px 18px', fontSize: 14, fontWeight: 500, borderRadius: 8,
            background: '#fff', color: '#475569', border: '1px solid #cbd5e1',
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >Reset to chart</button>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error ? (
        <div style={{
          padding: '10px 12px', borderRadius: 6, marginBottom: 14,
          background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13,
        }}>
          {error}
        </div>
      ) : null}

      {/* ── Result card ─────────────────────────────────────────────────── */}
      {result ? (
        <div ref={resultRef} style={{
          padding: '16px 18px', borderRadius: 10, marginTop: 4,
          background: bandColors.bg, border: `1px solid ${bandColors.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 13, color: bandColors.fg, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Result
            </div>
            <div style={{ fontSize: 11, color: bandColors.fg }}>
              Deterministic · LLM never touches the score
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 8 }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: bandColors.fg, lineHeight: 1 }}>{String(result.score)}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: bandColors.fg }}>
                {result.band?.label || result.band_key}
              </div>
              {result.band?.interpretation_default ? (
                <div style={{ fontSize: 13, color: bandColors.fg, marginTop: 2 }}>{result.band.interpretation_default}</div>
              ) : null}
            </div>
          </div>
          <div style={{
            fontSize: 12, color: bandColors.fg, padding: '6px 10px', borderRadius: 6,
            background: 'rgba(255,255,255,0.6)', marginTop: 10,
          }}>
            Narrative interpretation generating… PC.2c will enable auto-written prose.
          </div>

          {/* ── PC.2b3 — chart actions (Add-to-Note / Add-to-Plan / Share-to-Comms) ── */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['note','plan','comms'] as const).map(key => {
              const label = key === 'note' ? '+ Add to Note' : key === 'plan' ? '+ Add to Plan' : '📤 Share to Comms';
              const handler = key === 'note' ? handleAddToNote : key === 'plan' ? handleAddToPlan : handleShareToComms;
              const busy = actionBusy === key;
              const done = !!actionDone[key];
              const disabled = !encounterId || busy || actionBusy !== null;
              return (
                <button
                  key={key}
                  onClick={handler}
                  disabled={disabled}
                  title={!encounterId ? 'Action unavailable — this patient has no active encounter.' : ''}
                  style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    background: done ? '#16a34a' : busy ? '#94a3b8' : 'rgba(255,255,255,0.9)',
                    color: done ? '#fff' : busy ? '#fff' : bandColors.fg,
                    border: `1px solid ${done ? '#16a34a' : bandColors.border}`,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: !encounterId ? 0.6 : 1,
                  }}
                >
                  {done ? '✓ Added' : busy ? 'Working…' : label}
                </button>
              );
            })}
            {actionError ? (
              <span style={{ fontSize: 12, color: '#991b1b', marginLeft: 4 }}>{actionError}</span>
            ) : null}
            {!encounterId ? (
              <span style={{ fontSize: 11, color: bandColors.fg, marginLeft: 4, opacity: 0.8 }}>
                No active encounter — actions unavailable.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── Footer citation ─────────────────────────────────────────────── */}
      {calc.source_citation ? (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 20 }}>
          Source: {calc.source_citation}
        </div>
      ) : null}

      {/* ── Bands reference (collapsible feel via subtle styling) ───────── */}
      {bands && bands.length > 0 ? (
        <details style={{ marginTop: 18 }}>
          <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>Band cutoffs</summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {bands.slice().sort((a, b) => Number(a.min_score) - Number(b.min_score)).map(b => {
              const c = BAND_COLORS[b.color] || BAND_COLORS.grey;
              return (
                <div key={b.id} style={{
                  display: 'flex', gap: 10, alignItems: 'center',
                  padding: '4px 8px', borderRadius: 4, background: c.bg, border: `1px solid ${c.border}`,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: c.fg, minWidth: 80 }}>
                    {Number(b.min_score)}{b.max_score === null || b.max_score === undefined ? '+' : ` – ${Number(b.max_score)}`}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: c.fg }}>{b.label}</span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
