'use client';

/**
 * CalculatorsTab — PC.2b1 (18 Apr 2026)
 *
 * The 14th tab on the patient chart. Split-view list + runner:
 *   - Left column (~320px): specialty filter + search + calc list grouped
 *     by specialty with collapsible headers.
 *   - Right column: on selection, fetches loadCalcBundle via
 *     calculators.getById and renders <CalcRunner/>.
 *
 * Per V's locked decision (PC.2b design):
 *   "Inline on tab (split view) — no slider/modal churn."
 *
 * Safety notes:
 *   - Numeric score is ALWAYS computed server-side. LLM never touches
 *     the number (PRD §53). Enforced by CalcRunner + calculators.run.
 *   - 📋 from-chart prefill is advisory; clinician always owns final value.
 *   - Role gating happens on server (protectedProcedure). Pin defaults
 *     (role-preferred calcs) ship in PC.2b2.
 */

import { useEffect, useMemo, useState } from 'react';
import CalcRunner, { type CalcBundle } from './CalcRunner';
import type { ChartContext } from '@/lib/calculators/resolve-chart-value';

// ── tRPC helper (BriefTab convention) ──────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    let msg = `${path} ${res.status}`;
    try { const j = await res.json(); if (j?.error?.message) msg = j.error.message; } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

// ── Types (mirror calculators router CalcRow / loadCalcBundle) ─────────────
interface CalcListRow {
  id: string;
  slug: string;
  name: string;
  specialty: string;
  short_description: string | null;
  version: string;
  is_active?: boolean;
  pin_default_for_roles?: string[] | null;
}

interface Props {
  patientId: string;
  encounterId?: string | null;
  userRole: string;
  userName?: string;
  chartContext: ChartContext;
  /** PC.2b2 — if set on mount (or change), that calc is auto-selected. */
  initialCalcId?: string | null;
  /** PC.2b2 — called once the initialCalcId has been applied so parent can clear it. */
  onInitialCalcConsumed?: () => void;
}

interface PinRow {
  calc_id: string;
  pinned: boolean;
  source: 'role_default' | 'user_pin';
}

// ── Display helpers ────────────────────────────────────────────────────────
const SPECIALTY_LABELS: Record<string, string> = {
  cardiology: 'Cardiology',
  emergency: 'Emergency',
  vascular: 'Vascular',
  pulmonary: 'Pulmonary',
  neurology: 'Neurology',
  critical_care: 'Critical Care',
  hepatology: 'Hepatology',
  nephrology: 'Nephrology',
  endocrinology: 'Endocrinology',
  obstetrics: 'Obstetrics',
  pediatrics: 'Pediatrics',
  orthopedics: 'Orthopedics',
  general: 'General',
};

function prettySpecialty(s: string): string {
  return SPECIALTY_LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupBySpecialty(rows: CalcListRow[]): Map<string, CalcListRow[]> {
  const m = new Map<string, CalcListRow[]>();
  for (const r of rows) {
    const key = r.specialty ?? 'general';
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(r);
  }
  for (const list of m.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return m;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function CalculatorsTab({
  patientId,
  encounterId,
  userRole,
  userName,
  chartContext,
  initialCalcId,
  onInitialCalcConsumed,
}: Props) {
  const [list, setList] = useState<CalcListRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<CalcBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Mobile disclosure — below 900px the list takes the top of the tab and
  // picking a calc scrolls the runner into view.
  const [mobileRunnerOpen, setMobileRunnerOpen] = useState(false);

  // ── Pin state (PC.2b2) ───────────────────────────────────────────────────
  // Map calc_id → pinned boolean. Seeded from calculators.listPins which
  // merges per-user overrides on top of role defaults.
  const [pinMap, setPinMap] = useState<Record<string, boolean>>({});
  const [pinBusy, setPinBusy] = useState<Record<string, boolean>>({});
  const [pinsLoaded, setPinsLoaded] = useState(false);
  // Tracks last-applied initialCalcId so we don't re-apply on re-render.
  const [initialApplied, setInitialApplied] = useState<string | null>(null);

  // ── Load calc list once on mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    trpcQuery('calculators.list', {})
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data)) {
          setList([]);
          setListError('Calculator list unavailable');
          return;
        }
        setList(data as CalcListRow[]);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setListError(e?.message ?? 'Failed to load calculators');
        setList([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load pins once on mount (PC.2b2) ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    trpcQuery('calculators.listPins', {}).then((data) => {
      if (cancelled) return;
      const map: Record<string, boolean> = {};
      if (Array.isArray(data)) {
        for (const r of data as PinRow[]) {
          if (r && typeof r.calc_id === 'string' && typeof r.pinned === 'boolean') {
            map[r.calc_id] = r.pinned;
          }
        }
      }
      setPinMap(map);
      setPinsLoaded(true);
    }).catch(() => {
      if (!cancelled) {
        setPinMap({});
        setPinsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Auto-select initialCalcId once the list loads (PC.2b2 deep-link) ─────
  useEffect(() => {
    if (!initialCalcId) return;
    if (!list || list.length === 0) return;
    if (initialApplied === initialCalcId) return;
    const found = list.find((c) => c.id === initialCalcId);
    if (found) {
      setSelectedId(found.id);
      setInitialApplied(initialCalcId);
      setMobileRunnerOpen(true);
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          document.getElementById('calc-runner-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
      if (onInitialCalcConsumed) onInitialCalcConsumed();
    }
  }, [initialCalcId, list, initialApplied, onInitialCalcConsumed]);

  // ── Load bundle on selection ───────────────────────────────────────────── ─────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setBundle(null);
      setBundleError(null);
      return;
    }
    let cancelled = false;
    setBundleLoading(true);
    setBundleError(null);
    setBundle(null);
    trpcQuery('calculators.getById', { id: selectedId })
      .then((data) => {
        if (cancelled) return;
        if (!data || typeof data !== 'object') {
          setBundleError('Calculator details unavailable');
          return;
        }
        setBundle(data as CalcBundle);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setBundleError(e?.message ?? 'Failed to load calculator');
      })
      .finally(() => {
        if (!cancelled) setBundleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── Derived list state ───────────────────────────────────────────────────
  const specialties = useMemo(() => {
    const set = new Set<string>();
    for (const r of list ?? []) set.add(r.specialty ?? 'general');
    return Array.from(set).sort();
  }, [list]);

  const filtered = useMemo(() => {
    const all = list ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (specialty !== 'all' && (r.specialty ?? 'general') !== specialty) return false;
      if (!q) return true;
      const hay = `${r.name} ${r.slug} ${r.short_description ?? ''} ${r.specialty ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [list, search, specialty]);

  const grouped = useMemo(() => groupBySpecialty(filtered), [filtered]);

  const selected = useMemo(() => {
    if (!list || !selectedId) return null;
    return list.find((c) => c.id === selectedId) ?? null;
  }, [list, selectedId]);

  // ── Render helpers ───────────────────────────────────────────────────────
  function toggleCollapsed(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function togglePin(calcId: string) {
    if (pinBusy[calcId]) return;
    const current = !!pinMap[calcId];
    const next = !current;
    // Optimistic flip
    setPinMap((prev) => ({ ...prev, [calcId]: next }));
    setPinBusy((prev) => ({ ...prev, [calcId]: true }));
    try {
      await trpcMutate('calculators.pinToggle', { calc_id: calcId, pinned: next });
    } catch (e: any) {
      // Rollback on failure — surface via console; UI returns to prior state.
      console.error('calculators.pinToggle failed', e);
      setPinMap((prev) => ({ ...prev, [calcId]: current }));
    } finally {
      setPinBusy((prev) => {
        const copy = { ...prev };
        delete copy[calcId];
        return copy;
      });
    }
  }

  function onPick(id: string) {
    setSelectedId(id);
    setMobileRunnerOpen(true);
    // Best-effort scroll runner into view on narrow screens.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches) {
      setTimeout(() => {
        document.getElementById('calc-runner-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      {/* Header strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🧮 Clinical Calculators</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
            Deterministic scoring. LLM never touches the number — only prose (PC.2c).
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {listLoading ? 'Loading…' : `${list?.length ?? 0} calculators available`}
        </div>
      </div>

      {/* Split layout */}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'minmax(260px, 320px) 1fr',
          alignItems: 'start',
        }}
        className="calc-tab-split"
      >
        {/* LEFT: filter + search + list */}
        <aside
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxHeight: 'calc(100vh - 220px)',
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              placeholder="Search calculators…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: '8px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none',
              }}
            />
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              style={{
                padding: '8px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 13,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="all">All specialties</option>
              {specialties.map((s) => (
                <option key={s} value={s}>
                  {prettySpecialty(s)}
                </option>
              ))}
            </select>
          </div>

          {listError && (
            <div
              style={{
                padding: '8px 10px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 6,
                fontSize: 12,
                color: '#991b1b',
              }}
            >
              {listError}
            </div>
          )}

          {listLoading && (
            <div style={{ padding: 12, fontSize: 13, color: '#64748b' }}>Loading calculators…</div>
          )}

          {!listLoading && (list?.length ?? 0) === 0 && !listError && (
            <div style={{ padding: 12, fontSize: 13, color: '#64748b' }}>
              No calculators configured for this hospital yet.
            </div>
          )}

          {!listLoading && filtered.length === 0 && (list?.length ?? 0) > 0 && (
            <div style={{ padding: 12, fontSize: 13, color: '#64748b' }}>
              No calculators match your filters.
            </div>
          )}

          {/* Grouped list */}
          {!listLoading &&
            Array.from(grouped.entries()).map(([specKey, calcs]) => {
              const isCollapsed = !!collapsed[specKey];
              return (
                <div key={specKey} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(specKey)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 8px',
                      border: 'none',
                      background: '#f1f5f9',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#334155',
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                    }}
                  >
                    <span>{prettySpecialty(specKey)}</span>
                    <span style={{ color: '#64748b' }}>
                      {isCollapsed ? '▸' : '▾'} {calcs.length}
                    </span>
                  </button>
                  {!isCollapsed &&
                    calcs.map((c) => {
                      const active = c.id === selectedId;
                      const pinned = !!pinMap[c.id];
                      const busy = !!pinBusy[c.id];
                      return (
                        <div
                          key={c.id}
                          style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'stretch',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onPick(c.id)}
                            title={c.short_description ?? c.name}
                            style={{
                              flex: 1,
                              textAlign: 'left',
                              padding: '8px 36px 8px 10px',
                              border: `1px solid ${active ? '#3b82f6' : '#e2e8f0'}`,
                              background: active ? '#eff6ff' : '#fff',
                              borderRadius: 6,
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              minWidth: 0,
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                              {c.name}
                            </div>
                            {c.short_description && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#64748b',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                }}
                              >
                                {c.short_description}
                              </div>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(c.id);
                            }}
                            disabled={busy || !pinsLoaded}
                            title={pinned ? 'Unpin from Overview' : 'Pin to Overview'}
                            aria-label={pinned ? `Unpin ${c.name}` : `Pin ${c.name}`}
                            style={{
                              position: 'absolute',
                              top: 6,
                              right: 6,
                              width: 26,
                              height: 26,
                              padding: 0,
                              border: 'none',
                              background: 'transparent',
                              cursor: busy || !pinsLoaded ? 'default' : 'pointer',
                              color: pinned ? '#f59e0b' : '#94a3b8',
                              fontSize: 15,
                              lineHeight: '26px',
                              textAlign: 'center',
                              opacity: busy ? 0.5 : 1,
                              borderRadius: 4,
                            }}
                          >
                            {pinned ? '★' : '☆'}
                          </button>
                        </div>
                      );
                    })}
                </div>
              );
            })}
        </aside>

        {/* RIGHT: runner pane */}
        <section
          id="calc-runner-pane"
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 16,
            minHeight: 360,
          }}
        >
          {!selectedId && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: 8,
                padding: '48px 16px',
                color: '#64748b',
              }}
            >
              <div style={{ fontSize: 36 }}>🧮</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                Select a calculator from the list
              </div>
              <div style={{ fontSize: 12, maxWidth: 420 }}>
                Inputs will pre-fill from the chart when possible (<span style={{ whiteSpace: 'nowrap' }}>📋 from chart</span>).
                Override anything before submitting — the clinician always owns the final value.
              </div>
            </div>
          )}

          {selectedId && bundleLoading && (
            <div style={{ padding: 32, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
              Loading calculator…
            </div>
          )}

          {selectedId && bundleError && !bundleLoading && (
            <div
              style={{
                padding: 16,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 6,
                fontSize: 13,
                color: '#991b1b',
              }}
            >
              {bundleError}
              {selected && (
                <div style={{ marginTop: 4, fontSize: 12, color: '#7f1d1d' }}>
                  {selected.name} ({selected.slug})
                </div>
              )}
            </div>
          )}

          {selectedId && bundle && !bundleLoading && !bundleError && (
            <CalcRunner
              key={bundle.calc.id}
              bundle={bundle}
              patientId={patientId}
              encounterId={encounterId ?? null}
              chartContext={chartContext}
            />
          )}
        </section>
      </div>

      {/* Responsive collapse — stack on narrow screens */}
      <style jsx>{`
        @media (max-width: 899px) {
          :global(.calc-tab-split) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
