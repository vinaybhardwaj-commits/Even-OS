'use client';

/**
 * Patient Chart Overhaul — PC.2c1 — Super-admin Calculators CRUD
 *
 * Single-page surface for super_admin to author / edit / (de)activate
 * calculator definitions (the 6 PC.2a tables). HODs do NOT self-serve;
 * router gates all mutations on role === 'super_admin'.
 *
 * Surface:
 *   - List (left, 340px)    — all calcs, ↓ pill shows (inactive) row
 *   - Editor (right, flex)  — def form + 3 JSON editors (inputs / scoring / bands)
 *                             + "Named formula" dropdown for non-linear calcs
 *
 * Why JSON editors for children: the fixture file already encodes the
 * canonical shape. Typing a per-row form UI across 4 shapes would be a
 * 2,000-line sprint with low admin-use throughput. JSON is the authoring
 * surface super_admins already use for fixtures — this just lets them do
 * it without a redeploy. HODs still file Sewa tickets (PRD #15).
 *
 * Ships with PC.2c1. The UX polish pass (per-row forms, drag-reorder) is
 * deferred to PC.2c2/2c3 if demand shows up.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Types (mirror router / fixture) ───────────────────────────
type CalcListRow = {
  id: string; hospital_id: string; slug: string; name: string; specialty: string;
  short_description: string | null; long_description: string | null;
  version: string; is_active: boolean;
  pin_default_for_roles: string[]; source_citation: string | null;
  formula_ref: string | null;
  created_by_user_id: string | null;
  authored_at: string; created_at: string; updated_at: string;
  input_count: number; rule_count: number; band_count: number; run_count: number;
};

type InputRow = {
  id?: string; calc_id?: string;
  key: string; label: string; helper_text: string | null;
  type: 'boolean' | 'number' | 'select' | 'date';
  unit: string | null; options: unknown;
  chart_source_path: string | null;
  required: boolean; display_order: number;
};
type ScoringRow = {
  id?: string; calc_id?: string;
  rule_type: 'sum' | 'weighted' | 'conditional';
  input_key: string; when_value: string | null;
  points: number | string;
  formula_expr: string | null;
  display_order: number;
};
type BandRow = {
  id?: string; calc_id?: string;
  band_key: string; label: string;
  min_score: number | string; max_score: number | string | null;
  color: 'green' | 'yellow' | 'red' | 'grey';
  interpretation_default: string | null;
  display_order: number;
};

type Bundle = {
  calc: CalcListRow;
  inputs: InputRow[];
  scoring: ScoringRow[];
  bands: BandRow[];
};

// ─── tRPC helpers (match charge-master pattern) ────────────────
async function trpcQuery(path: string, input?: unknown) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}
async function trpcMutate(path: string, input?: unknown) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ─── Defaults ──────────────────────────────────────────────────
const EMPTY_DEF = {
  slug: '',
  name: '',
  specialty: 'cardiology',
  short_description: '',
  long_description: '',
  version: '1.0',
  is_active: true,
  pin_default_for_roles: [] as string[],
  source_citation: '',
  formula_ref: null as string | null,
};

function prettyJson(v: unknown) {
  return JSON.stringify(v ?? [], null, 2);
}

// ─── Component ─────────────────────────────────────────────────
export function CalculatorsAdminClient() {
  const [list, setList] = useState<CalcListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // selection + editor state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [def, setDef] = useState(EMPTY_DEF);
  const [inputsJson, setInputsJson] = useState('[]');
  const [scoringJson, setScoringJson] = useState('[]');
  const [bandsJson, setBandsJson] = useState('[]');
  const [saving, setSaving] = useState(false);
  const [formulas, setFormulas] = useState<string[]>([]);

  // ─── Data ────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await trpcQuery('calculators.listForAdmin')) as CalcListRow[];
      setList(rows ?? []);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFormulas = useCallback(async () => {
    try {
      const f = (await trpcQuery('calculators.listFormulas')) as string[];
      setFormulas(f ?? []);
    } catch {
      setFormulas([]);
    }
  }, []);

  useEffect(() => { fetchList(); fetchFormulas(); }, [fetchList, fetchFormulas]);

  const loadBundle = useCallback(async (id: string) => {
    try {
      const b = (await trpcQuery('calculators.adminGetById', { id })) as Bundle;
      setIsNew(false);
      setSelectedId(id);
      setDef({
        slug: b.calc.slug,
        name: b.calc.name,
        specialty: b.calc.specialty,
        short_description: b.calc.short_description ?? '',
        long_description: b.calc.long_description ?? '',
        version: b.calc.version,
        is_active: b.calc.is_active,
        pin_default_for_roles: b.calc.pin_default_for_roles ?? [],
        source_citation: b.calc.source_citation ?? '',
        formula_ref: b.calc.formula_ref ?? null,
      });
      setInputsJson(prettyJson(b.inputs.map(stripMeta)));
      setScoringJson(prettyJson(b.scoring.map(stripMeta)));
      setBandsJson(prettyJson(b.bands.map(stripMeta)));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, []);

  function stripMeta<T extends { id?: string; calc_id?: string }>(r: T): Omit<T, 'id' | 'calc_id'> {
    const { id: _id, calc_id: _c, ...rest } = r;
    void _id; void _c;
    return rest;
  }

  function handleNew() {
    setIsNew(true);
    setSelectedId(null);
    setDef({ ...EMPTY_DEF });
    setInputsJson('[]');
    setScoringJson('[]');
    setBandsJson('[]');
    setErr(''); setOk('');
  }

  async function handleSave() {
    setSaving(true); setErr(''); setOk('');
    try {
      let inputs: unknown, scoring: unknown, bands: unknown;
      try { inputs = JSON.parse(inputsJson); } catch { throw new Error('Inputs JSON is invalid'); }
      try { scoring = JSON.parse(scoringJson); } catch { throw new Error('Scoring JSON is invalid'); }
      try { bands = JSON.parse(bandsJson); } catch { throw new Error('Bands JSON is invalid'); }
      if (!Array.isArray(inputs)) throw new Error('Inputs must be an array');
      if (!Array.isArray(scoring)) throw new Error('Scoring must be an array');
      if (!Array.isArray(bands)) throw new Error('Bands must be an array');
      if (!def.slug || !def.name || !def.specialty) throw new Error('slug / name / specialty are required');

      const payload = {
        def: {
          slug: def.slug,
          name: def.name,
          specialty: def.specialty,
          short_description: def.short_description || null,
          long_description: def.long_description || null,
          version: def.version || '1.0',
          is_active: def.is_active,
          pin_default_for_roles: def.pin_default_for_roles,
          source_citation: def.source_citation || null,
          formula_ref: def.formula_ref || null,
        },
        inputs, scoring, bands,
        force: true, // admin save is always a full replace of children
      };
      const res = await trpcMutate('calculators.createCalc', payload) as { created: boolean; calc: CalcListRow };
      setOk(res.created ? 'Calculator created.' : 'Calculator updated.');
      await fetchList();
      if (res.calc?.id) await loadBundle(res.calc.id);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row: CalcListRow) {
    setErr(''); setOk('');
    try {
      await trpcMutate('calculators.adminToggleActive', { id: row.id, is_active: !row.is_active });
      await fetchList();
      if (selectedId === row.id) await loadBundle(row.id);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }

  const specialties = useMemo(() => {
    const set = new Set<string>(list.map((r) => r.specialty));
    return Array.from(set).sort();
  }, [list]);

  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const visibleList = useMemo(() => {
    if (!specialtyFilter) return list;
    return list.filter((r) => r.specialty === specialtyFilter);
  }, [list, specialtyFilter]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🧮 Calculators (super-admin)</h1>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {list.length} calculators · {list.filter((l) => l.is_active).length} active
        </div>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0 }}>
        HODs do not self-serve — they request via Sewa/email. Only super_admin can create / edit / deactivate.
      </p>

      {err && <div style={banner('#fef2f2', '#991b1b')}>{err}</div>}
      {ok && <div style={banner('#ecfdf5', '#065f46')}>{ok}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, marginTop: 12 }}>
        {/* ─── LEFT: LIST ─────────────────────────────── */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
            <select
              value={specialtyFilter}
              onChange={(e) => setSpecialtyFilter(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
            >
              <option value="">All specialties</option>
              {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={handleNew} style={btn('primary')}>+ New</button>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
            {loading && <div style={{ padding: 14, color: '#6b7280', fontSize: 13 }}>Loading…</div>}
            {!loading && visibleList.length === 0 && (
              <div style={{ padding: 14, color: '#6b7280', fontSize: 13 }}>No calculators.</div>
            )}
            {visibleList.map((row) => (
              <button
                key={row.id}
                onClick={() => loadBundle(row.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                  borderBottom: '1px solid #f3f4f6',
                  background: selectedId === row.id ? '#eff6ff' : '#fff',
                  cursor: 'pointer', border: 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: row.is_active ? '#111827' : '#9ca3af' }}>
                    {row.name}
                  </div>
                  {!row.is_active && (
                    <span style={{ fontSize: 11, color: '#991b1b', background: '#fef2f2', padding: '1px 6px', borderRadius: 3 }}>
                      inactive
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {row.specialty} · v{row.version} · {row.input_count} inputs · {row.run_count} runs
                  {row.formula_ref ? <span style={{ marginLeft: 4, color: '#2563eb' }}>· ƒ {row.formula_ref}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ─── RIGHT: EDITOR ──────────────────────────── */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 16 }}>
          {!isNew && !selectedId && (
            <div style={{ color: '#6b7280', fontSize: 14 }}>
              Select a calculator on the left, or click <b>+ New</b> to author one from scratch.
            </div>
          )}

          {(isNew || selectedId) && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{isNew ? 'New calculator' : def.name || '(unnamed)'}</h2>
                {!isNew && selectedId && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => {
                        const row = list.find((r) => r.id === selectedId);
                        if (row) handleToggleActive(row);
                      }}
                      style={btn('secondary')}
                    >
                      {list.find((r) => r.id === selectedId)?.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>

              {/* ─── DEF FIELDS ───────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Slug (a-z, 0-9, dashes)">
                  <input
                    value={def.slug}
                    onChange={(e) => setDef({ ...def, slug: e.target.value })}
                    placeholder="e.g. meld-3-0"
                    style={inp()}
                  />
                </Field>
                <Field label="Name">
                  <input
                    value={def.name}
                    onChange={(e) => setDef({ ...def, name: e.target.value })}
                    placeholder="e.g. MELD 3.0"
                    style={inp()}
                  />
                </Field>
                <Field label="Specialty">
                  <input
                    value={def.specialty}
                    onChange={(e) => setDef({ ...def, specialty: e.target.value })}
                    placeholder="cardiology / hepatology / ..."
                    style={inp()}
                  />
                </Field>
                <Field label="Version">
                  <input
                    value={def.version}
                    onChange={(e) => setDef({ ...def, version: e.target.value })}
                    style={inp()}
                  />
                </Field>
                <Field label="Short description">
                  <input
                    value={def.short_description}
                    onChange={(e) => setDef({ ...def, short_description: e.target.value })}
                    style={inp()}
                  />
                </Field>
                <Field label="Pin default for roles (comma-separated)">
                  <input
                    value={def.pin_default_for_roles.join(', ')}
                    onChange={(e) => setDef({
                      ...def,
                      pin_default_for_roles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })}
                    placeholder="doctor, consultant, ..."
                    style={inp()}
                  />
                </Field>
                <Field label="Named formula (for non-linear calcs)">
                  <select
                    value={def.formula_ref ?? ''}
                    onChange={(e) => setDef({ ...def, formula_ref: e.target.value || null })}
                    style={inp()}
                  >
                    <option value="">(none — use scoring rules)</option>
                    {formulas.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Active">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={def.is_active}
                      onChange={(e) => setDef({ ...def, is_active: e.target.checked })}
                    />
                    is_active
                  </label>
                </Field>
              </div>
              <Field label="Long description">
                <textarea
                  value={def.long_description}
                  onChange={(e) => setDef({ ...def, long_description: e.target.value })}
                  rows={3}
                  style={{ ...inp(), resize: 'vertical', fontFamily: 'inherit' }}
                />
              </Field>
              <Field label="Source citation">
                <input
                  value={def.source_citation}
                  onChange={(e) => setDef({ ...def, source_citation: e.target.value })}
                  placeholder="DOI / PMID / url / paper cite"
                  style={inp()}
                />
              </Field>

              {/* ─── JSON EDITORS ─────────────────────── */}
              <JsonEditor label="Inputs"  help="Array of calculator_inputs rows (see fixture shape)." value={inputsJson}  onChange={setInputsJson} />
              <JsonEditor label="Scoring" help={def.formula_ref ? 'Ignored — scoring dispatches to the named formula.' : 'Array of calculator_scoring rules.'} value={scoringJson} onChange={setScoringJson} />
              <JsonEditor label="Bands"   help="Array of calculator_bands rows (min_score / max_score / color)." value={bandsJson}  onChange={setBandsJson} />

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  disabled={saving}
                  onClick={handleSave}
                  style={btn(saving ? 'disabled' : 'primary')}
                >
                  {saving ? 'Saving…' : isNew ? 'Create calculator' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Presentational helpers ────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginTop: 10 }}>
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      {children}
    </label>
  );
}
function JsonEditor({
  label, help, value, onChange,
}: { label: string; help?: string; value: string; onChange: (v: string) => void }) {
  let parsed: unknown = null;
  let count = 0;
  let err = '';
  try {
    parsed = JSON.parse(value);
    if (Array.isArray(parsed)) count = parsed.length;
    else err = 'Top-level value is not an array.';
  } catch (e) {
    err = (e as Error).message;
  }
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label} {err ? null : <span style={{ color: '#6b7280', fontWeight: 400 }}>— {count} rows</span>}</div>
        <div style={{ fontSize: 11, color: err ? '#991b1b' : '#6b7280' }}>{err || help || ''}</div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(6, Math.min(20, value.split('\n').length + 1))}
        style={{
          width: '100%', padding: 10, border: `1px solid ${err ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: 6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12, marginTop: 4, background: err ? '#fef2f2' : '#fafafa',
        }}
        spellCheck={false}
      />
    </div>
  );
}

function inp(): React.CSSProperties {
  return { width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 };
}
function btn(variant: 'primary' | 'secondary' | 'disabled'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
  };
  if (variant === 'primary')   return { ...base, background: '#2563eb', color: '#fff' };
  if (variant === 'disabled')  return { ...base, background: '#cbd5e1', color: '#fff', cursor: 'not-allowed' };
  return { ...base, background: '#fff', color: '#111827', borderColor: '#d1d5db' };
}
function banner(bg: string, fg: string): React.CSSProperties {
  return { padding: 10, background: bg, color: fg, borderRadius: 6, fontSize: 13, marginTop: 8 };
}
