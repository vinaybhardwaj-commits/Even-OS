'use client';

/**
 * LabsTab — Real-data labs view for the patient chart.
 *
 * Replaces the hardcoded CBC/RFT/Coagulation mock the chart shipped with.
 * Fetches from labRadiology.patientLabsWithTrends and renders:
 *   - latest value per test with flag + reference range
 *   - inline sparkline when 2+ numeric values exist
 *   - click row to expand: full recharts LineChart with reference-range band
 *     and last 30 values + tabular history
 *   - "Order New Labs" button (doctors only) — delegates to parent via prop
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceArea, ReferenceLine, CartesianGrid,
} from 'recharts';

const DOCTOR_ROLES = [
  'resident', 'senior_resident', 'intern', 'visiting_consultant',
  'hospitalist', 'specialist_cardiologist', 'specialist_neurologist',
  'specialist_orthopedic', 'surgeon', 'anaesthetist',
  'department_head', 'medical_director',
];

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

interface LabResult {
  id: string;
  order_id: string;
  value_numeric: number | null;
  value_text: string | null;
  value_coded: string | null;
  flag: 'low' | 'high' | 'critical_low' | 'critical_high' | 'normal' | 'abnormal' | null;
  is_critical: boolean;
  resulted_at: string;
  panel_name: string | null;
}

interface LabTest {
  test_code: string;
  test_name: string;
  unit: string | null;
  ref_range_text: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  latest_panel: string | null;
  results: LabResult[]; // DESC by resulted_at
}

interface LabOrder {
  id: string;
  lo_order_number: string;
  lo_status: string;
  lo_urgency: string;
  lo_panel_name: string;
  lo_ordered_at: string;
  lo_is_critical: boolean;
}

interface Props {
  patientId: string;
  userRole: string;
  onOrderLabs?: () => void; // parent opens order panel
}

// ── Helpers ─────────────────────────────────────────────────
function flagColor(flag: string | null, isCritical: boolean): string {
  if (isCritical) return '#dc2626';
  if (flag === 'critical_low' || flag === 'critical_high') return '#dc2626';
  if (flag === 'low' || flag === 'high' || flag === 'abnormal') return '#f59e0b';
  return '#16a34a';
}
function flagLabel(flag: string | null): string {
  if (!flag || flag === 'normal') return 'N';
  if (flag === 'low' || flag === 'critical_low') return 'L';
  if (flag === 'high' || flag === 'critical_high') return 'H';
  return 'A';
}
function formatDate(ts: string): string {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function panelGroup(test: LabTest): string {
  return test.latest_panel || 'Other';
}

// ── Inline SVG Sparkline ────────────────────────────────────
function Sparkline({ values, low, high }: { values: number[]; low: number | null; high: number | null }) {
  if (values.length < 2) return null;
  const w = 80, h = 24, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1];
  const trendColor = (low !== null && last < low) || (high !== null && last > high) ? '#f59e0b' : '#3b82f6';
  return (
    <svg width={w} height={h} style={{ verticalAlign: 'middle' }}>
      <polyline fill="none" stroke={trendColor} strokeWidth="1.5" points={points} />
      <circle cx={points.split(' ').slice(-1)[0].split(',')[0]} cy={points.split(' ').slice(-1)[0].split(',')[1]} r="2" fill={trendColor} />
    </svg>
  );
}

// ── Main component ──────────────────────────────────────────
export default function LabsTab({ patientId, userRole, onOrderLabs }: Props) {
  const [loading, setLoading] = useState(true);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const canOrder = DOCTOR_ROLES.includes(userRole);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await trpcQuery('labRadiology.patientLabsWithTrends', { patient_id: patientId });
      setTests(data?.tests || []);
      setOrders(data?.orders || []);
      setLoading(false);
    })();
  }, [patientId]);

  // Group tests by panel for display
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? tests.filter(t => t.test_name.toLowerCase().includes(q) || t.test_code.toLowerCase().includes(q))
      : tests;
    const map: Record<string, LabTest[]> = {};
    for (const t of filtered) {
      const g = panelGroup(t);
      if (!map[g]) map[g] = [];
      map[g].push(t);
    }
    return map;
  }, [tests, search]);

  const pendingOrders = orders.filter(o => ['ordered', 'collected', 'received', 'processing'].includes(o.lo_status));

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
        <div style={{ fontSize: 28 }}>🧪</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>Loading labs…</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh' }}>
      {/* Header row: Search + Order button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter tests (e.g. Haemoglobin, CBC)…"
          style={{
            flex: 1, maxWidth: 380,
            padding: '8px 12px', fontSize: 13,
            border: '1px solid #d0d5dd', borderRadius: 8, outline: 'none',
          }}
        />
        {canOrder && onOrderLabs && (
          <button
            onClick={onOrderLabs}
            style={{
              padding: '10px 16px', background: '#0055FF', color: 'white',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >🔬 Order New Labs</button>
        )}
      </div>

      {/* Pending orders pill strip */}
      {pendingOrders.length > 0 && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e',
        }}>
          <strong>{pendingOrders.length}</strong> order{pendingOrders.length !== 1 ? 's' : ''} pending results:
          {' '}
          {pendingOrders.slice(0, 3).map((o, i) => (
            <span key={o.id}>
              {i > 0 ? ', ' : ''}
              <span>{o.lo_panel_name}</span>
              {' '}
              <span style={{ opacity: 0.7, fontSize: 11 }}>({o.lo_status})</span>
            </span>
          ))}
          {pendingOrders.length > 3 && <span> + {pendingOrders.length - 3} more</span>}
        </div>
      )}

      {/* Grouped tests */}
      {tests.length === 0 ? (
        <div style={{
          background: 'white', padding: 48, borderRadius: 12, textAlign: 'center',
          border: '1px solid #e5e7eb',
        }}>
          <div style={{ fontSize: 36 }}>🧪</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8, color: '#111' }}>No lab results yet</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {canOrder ? 'Click Order New Labs to start.' : 'No doctor has ordered labs for this patient yet.'}
          </div>
        </div>
      ) : (
        Object.entries(grouped).map(([panel, ts]) => (
          <div key={panel} style={{ marginBottom: 16, background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111' }}>{panel}</h4>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{ts.length} test{ts.length !== 1 ? 's' : ''}</div>
            </div>
            {ts.map(t => {
              const latest = t.results[0];
              const prev = t.results[1];
              const numericValues = t.results
                .filter(r => r.value_numeric !== null)
                .map(r => r.value_numeric as number)
                .reverse(); // oldest → newest
              const isExpanded = expandedTest === t.test_code;
              const color = flagColor(latest?.flag || null, latest?.is_critical || false);

              return (
                <div key={t.test_code} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <div
                    onClick={() => setExpandedTest(isExpanded ? null : t.test_code)}
                    style={{
                      padding: '12px 20px', cursor: 'pointer',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(180px, 2fr) 80px 110px 90px 60px 24px',
                      alignItems: 'center', gap: 12,
                      background: isExpanded ? '#eff6ff' : 'white',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{t.test_name}</div>
                      <div style={{ fontSize: 10, color: '#9ca3af' }}>{t.test_code}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: 'monospace' }}>
                        {latest?.value_numeric !== null && latest?.value_numeric !== undefined
                          ? latest.value_numeric.toFixed(2).replace(/\.?0+$/, '')
                          : (latest?.value_text || latest?.value_coded || '—')}
                      </span>
                      {t.unit && <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 2 }}>{t.unit}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center' }}>
                      {t.ref_range_text || (t.ref_range_low !== null && t.ref_range_high !== null ? `${t.ref_range_low}–${t.ref_range_high}` : '—')}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      {numericValues.length >= 2 && (
                        <Sparkline values={numericValues} low={t.ref_range_low} high={t.ref_range_high} />
                      )}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <span style={{
                        padding: '2px 6px', fontSize: 10, fontWeight: 700, borderRadius: 4,
                        background: color + '22', color,
                      }}>{flagLabel(latest?.flag || null)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>{isExpanded ? '▾' : '▸'}</div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '0 20px 20px 20px', background: '#fafbfc' }}>
                      {/* Trend chart */}
                      {numericValues.length >= 2 ? (
                        <div style={{ marginTop: 12, padding: 12, background: 'white', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#475467', textTransform: 'uppercase' as const, marginBottom: 8 }}>Trend · last {numericValues.length} results</div>
                          <div style={{ width: '100%', height: 180 }}>
                            <ResponsiveContainer>
                              <LineChart
                                data={t.results.slice().reverse().map((r, idx) => ({
                                  idx,
                                  value: r.value_numeric,
                                  label: formatDate(r.resulted_at),
                                  flag: r.flag,
                                }))}
                                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                              >
                                <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
                                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} domain={['auto', 'auto']} />
                                <Tooltip
                                  contentStyle={{ fontSize: 12, padding: '6px 10px' }}
                                  formatter={(v: any) => [`${v} ${t.unit || ''}`, t.test_name]}
                                />
                                {t.ref_range_low !== null && t.ref_range_high !== null && (
                                  <ReferenceArea y1={t.ref_range_low} y2={t.ref_range_high} fill="#22c55e" fillOpacity={0.1} />
                                )}
                                {t.ref_range_low !== null && <ReferenceLine y={t.ref_range_low} stroke="#94a3b8" strokeDasharray="3 3" />}
                                {t.ref_range_high !== null && <ReferenceLine y={t.ref_range_high} stroke="#94a3b8" strokeDasharray="3 3" />}
                                <Line type="monotone" dataKey="value" stroke="#0055FF" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 12, padding: 12, fontSize: 12, color: '#6b7280', fontStyle: 'italic' as const }}>
                          Only {numericValues.length} numeric result so far — trend chart needs at least 2.
                        </div>
                      )}

                      {/* History table */}
                      <div style={{ marginTop: 12, padding: 12, background: 'white', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#475467', textTransform: 'uppercase' as const, marginBottom: 8 }}>History</div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: '#6b7280', textAlign: 'left' as const, borderBottom: '1px solid #f3f4f6' }}>
                              <th style={{ padding: '6px 8px' }}>Date</th>
                              <th style={{ padding: '6px 8px' }}>Value</th>
                              <th style={{ padding: '6px 8px' }}>Flag</th>
                              <th style={{ padding: '6px 8px' }}>Panel</th>
                            </tr>
                          </thead>
                          <tbody>
                            {t.results.slice(0, 10).map(r => (
                              <tr key={r.id} style={{ borderBottom: '1px solid #fafbfc' }}>
                                <td style={{ padding: '6px 8px', color: '#475467' }}>{formatDate(r.resulted_at)}</td>
                                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600 }}>
                                  {r.value_numeric !== null ? r.value_numeric : (r.value_text || r.value_coded || '—')}
                                  {t.unit && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 3 }}>{t.unit}</span>}
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <span style={{
                                    padding: '1px 6px', fontSize: 10, fontWeight: 700, borderRadius: 4,
                                    background: flagColor(r.flag || null, r.is_critical) + '22',
                                    color: flagColor(r.flag || null, r.is_critical),
                                  }}>{flagLabel(r.flag || null)}</span>
                                </td>
                                <td style={{ padding: '6px 8px', color: '#6b7280' }}>{r.panel_name || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {prev && latest.value_numeric !== null && prev.value_numeric !== null && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
                            Δ from previous: <strong style={{ color: latest.value_numeric > prev.value_numeric ? '#f59e0b' : '#16a34a' }}>
                              {(latest.value_numeric - prev.value_numeric).toFixed(2).replace(/\.?0+$/, '')}
                              {' '}
                              ({((latest.value_numeric - prev.value_numeric) / prev.value_numeric * 100).toFixed(1)}%)
                            </strong>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
