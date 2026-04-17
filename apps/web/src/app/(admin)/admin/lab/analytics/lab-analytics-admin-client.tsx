'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type AdminTab = 'overview' | 'tat' | 'external' | 'qc' | 'workload';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function LabAnalyticsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);

  // Overview
  const [summary, setSummary] = useState<any>(null);

  // TAT Analysis
  const [tatData, setTatData] = useState<any[]>([]);
  const [tatLoading, setTatLoading] = useState(false);
  const [tatDateFrom, setTatDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [tatDateTo, setTatDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [tatDepartment, setTatDepartment] = useState('');

  // External Lab Scorecard
  const [externalData, setExternalData] = useState<any[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalDateFrom, setExternalDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [externalDateTo, setExternalDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  // QC Trending
  const [qcData, setQcData] = useState<any>(null);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcComponentId, setQcComponentId] = useState('');
  const [qcLotId, setQcLotId] = useState('');

  // Workload
  const [workloadData, setWorkloadData] = useState<any[]>([]);
  const [workloadLoading, setWorkloadLoading] = useState(false);
  const [workloadDateFrom, setWorkloadDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [workloadDateTo, setWorkloadDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  // Daily trends
  const [trendData, setTrendData] = useState<any[]>([]);

  // ── Load overview summary ─────────────────────────────────────────────
  const loadSummary = useCallback(async () => {
    try {
      const data = await trpcQuery('labAnalytics.dashboardSummary');
      setSummary(data);
    } catch (err) {
      console.error('Summary load error:', err);
    }
  }, []);

  // ── Load TAT Analysis ─────────────────────────────────────────────────
  const loadTatAnalysis = useCallback(async () => {
    setTatLoading(true);
    try {
      const data = await trpcQuery('labAnalytics.tatAnalysis', {
        date_from: tatDateFrom,
        date_to: tatDateTo,
        department: tatDepartment || undefined,
      });
      setTatData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('TAT Analysis error:', err);
      setTatData([]);
    } finally {
      setTatLoading(false);
    }
  }, [tatDateFrom, tatDateTo, tatDepartment]);

  // ── Load External Lab Scorecard ───────────────────────────────────────
  const loadExternalScorecard = useCallback(async () => {
    setExternalLoading(true);
    try {
      const data = await trpcQuery('labAnalytics.externalLabScorecard', {
        date_from: externalDateFrom,
        date_to: externalDateTo,
      });
      setExternalData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('External Lab error:', err);
      setExternalData([]);
    } finally {
      setExternalLoading(false);
    }
  }, [externalDateFrom, externalDateTo]);

  // ── Load QC Trending ──────────────────────────────────────────────────
  const loadQcTrending = useCallback(async () => {
    if (!qcComponentId || !qcLotId) return;
    setQcLoading(true);
    try {
      const data = await trpcQuery('labAnalytics.qcTrending', {
        component_id: qcComponentId,
        lot_id: qcLotId,
      });
      setQcData(data);
    } catch (err) {
      console.error('QC Trending error:', err);
      setQcData(null);
    } finally {
      setQcLoading(false);
    }
  }, [qcComponentId, qcLotId]);

  // ── Load Workload ─────────────────────────────────────────────────────
  const loadWorkload = useCallback(async () => {
    setWorkloadLoading(true);
    try {
      const data = await trpcQuery('labAnalytics.workloadDistribution', {
        date_from: workloadDateFrom,
        date_to: workloadDateTo,
      });
      setWorkloadData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Workload error:', err);
      setWorkloadData([]);
    } finally {
      setWorkloadLoading(false);
    }
  }, [workloadDateFrom, workloadDateTo]);

  // ── Load daily trends ─────────────────────────────────────────────────
  const loadTrends = useCallback(async () => {
    try {
      const data = await trpcQuery('labAnalytics.dailyTrends', { days: 30 });
      setTrendData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Daily Trends error:', err);
      setTrendData([]);
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await loadSummary();
      await loadTrends();
      setLoading(false);
    };
    init();
  }, [loadSummary, loadTrends]);

  // ── Load when tab changes ─────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'tat') loadTatAnalysis();
    else if (activeTab === 'external') loadExternalScorecard();
    else if (activeTab === 'workload') loadWorkload();
  }, [activeTab, loadTatAnalysis, loadExternalScorecard, loadWorkload]);

  // ── Color helpers ─────────────────────────────────────────────────────
  const getComplianceColor = (pct: number): string => {
    if (pct >= 90) return '#10b981';
    if (pct >= 70) return '#eab308';
    return '#ef4444';
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1f2937' }}>
      {/* Header */}
      <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ marginBottom: '10px' }}>
          {breadcrumbs.map((bc, idx) => (
            <span key={idx}>
              {bc.href ? (
                <a href={bc.href} style={{ color: '#0ea5e9', textDecoration: 'none' }}>
                  {bc.label}
                </a>
              ) : (
                <span>{bc.label}</span>
              )}
              {idx < breadcrumbs.length - 1 && <span style={{ margin: '0 8px' }}>/</span>}
            </span>
          ))}
        </div>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: 0 }}>Lab Analytics</h1>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>
      ) : (
        <>
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
              gap: '4px',
              padding: '0 20px',
            }}
          >
            {(['overview', 'tat', 'external', 'qc', 'workload'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '12px 16px',
                  border: 'none',
                  backgroundColor: activeTab === tab ? '#fff' : 'transparent',
                  borderBottom: activeTab === tab ? '2px solid #0ea5e9' : 'transparent',
                  cursor: 'pointer',
                  fontWeight: activeTab === tab ? '600' : '400',
                  textTransform: 'capitalize',
                  fontSize: '14px',
                }}
              >
                {tab === 'overview' && '📊 Overview'}
                {tab === 'tat' && '⏱️ TAT Analysis'}
                {tab === 'external' && '🏥 External Labs'}
                {tab === 'qc' && '✓ QC Trending'}
                {tab === 'workload' && '👥 Workload'}
              </button>
            ))}
          </div>

          {/* Tab: Overview */}
          {activeTab === 'overview' && (
            <div style={{ padding: '20px' }}>
              {summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div style={{ padding: '16px', backgroundColor: '#ecfdf5', borderRadius: '8px', border: '1px solid #d1fae5' }}>
                    <div style={{ fontSize: '12px', color: '#047857', textTransform: 'uppercase' }}>Today Orders</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.total_orders_today}</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: '#fef3c7', borderRadius: '8px', border: '1px solid #fde68a' }}>
                    <div style={{ fontSize: '12px', color: '#92400e', textTransform: 'uppercase' }}>Pending</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.pending_today}</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: '#dbeafe', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: '12px', color: '#1e40af', textTransform: 'uppercase' }}>Completed</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.completed_today}</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: '#f3e8ff', borderRadius: '8px', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontSize: '12px', color: '#6b21a8', textTransform: 'uppercase' }}>Avg TAT</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.avg_tat_today_minutes}m</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: '#f5f3ff', borderRadius: '8px', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontSize: '12px', color: '#6b21a8', textTransform: 'uppercase' }}>QC Pass Rate</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.qc_pass_rate_this_month}%</div>
                  </div>
                  <div style={{ padding: '16px', backgroundColor: '#fee2e2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                    <div style={{ fontSize: '12px', color: '#991b1b', textTransform: 'uppercase' }}>External Pending</div>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.external_orders_pending}</div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: '40px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>30-Day Trends</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Ordered</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Completed</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendData.slice(-10).map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '10px' }}>{row.date}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.ordered}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.completed}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.rejected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab: TAT Analysis */}
          {activeTab === 'tat' && (
            <div style={{ padding: '20px' }}>
              <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>From</label>
                  <input
                    type="date"
                    value={tatDateFrom}
                    onChange={(e) => setTatDateFrom(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>To</label>
                  <input
                    type="date"
                    value={tatDateTo}
                    onChange={(e) => setTatDateTo(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Department</label>
                  <input
                    type="text"
                    placeholder="e.g., hematology"
                    value={tatDepartment}
                    onChange={(e) => setTatDepartment(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
              </div>

              {tatLoading ? (
                <div>Loading...</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Test / Panel</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Orders</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Avg TAT (min)</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Promised (min)</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Compliance %</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Breaches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tatData.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '10px' }}>{row.panel_name}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.order_count}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.avg_tat_minutes}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.promised_tat_minutes}</td>
                        <td
                          style={{
                            padding: '10px',
                            textAlign: 'right',
                            backgroundColor: getComplianceColor(row.compliance_pct),
                            color: '#fff',
                            fontWeight: '600',
                            borderRadius: '4px',
                          }}
                        >
                          {row.compliance_pct}%
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.breach_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab: External Labs */}
          {activeTab === 'external' && (
            <div style={{ padding: '20px' }}>
              <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>From</label>
                  <input
                    type="date"
                    value={externalDateFrom}
                    onChange={(e) => setExternalDateFrom(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>To</label>
                  <input
                    type="date"
                    value={externalDateTo}
                    onChange={(e) => setExternalDateTo(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
              </div>

              {externalLoading ? (
                <div>Loading...</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Lab Name</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Orders</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>TAT Compliance %</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Breaches</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Avg TAT (h)</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Cost</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Billing</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {externalData.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '10px' }}>{row.lab_name}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>{row.order_count}</td>
                          <td
                            style={{
                              padding: '10px',
                              textAlign: 'right',
                              backgroundColor: getComplianceColor(row.tat_compliance_pct),
                              color: '#fff',
                              fontWeight: '600',
                              borderRadius: '4px',
                            }}
                          >
                            {row.tat_compliance_pct}%
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>{row.breach_count}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>{row.avg_tat_hours.toFixed(1)}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>₹{Math.round(row.total_cost)}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>₹{Math.round(row.total_billing)}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>{row.margin_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Tab: QC Trending */}
          {activeTab === 'qc' && (
            <div style={{ padding: '20px' }}>
              <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Component ID</label>
                  <input
                    type="text"
                    placeholder="UUID"
                    value={qcComponentId}
                    onChange={(e) => setQcComponentId(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', minWidth: '250px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Lot ID</label>
                  <input
                    type="text"
                    placeholder="UUID"
                    value={qcLotId}
                    onChange={(e) => setQcLotId(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', minWidth: '250px' }}
                  />
                </div>
                <button
                  onClick={loadQcTrending}
                  disabled={qcLoading || !qcComponentId || !qcLotId}
                  style={{
                    marginTop: '20px',
                    padding: '8px 16px',
                    backgroundColor: '#0ea5e9',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    opacity: qcLoading || !qcComponentId || !qcLotId ? 0.5 : 1,
                  }}
                >
                  {qcLoading ? 'Loading...' : 'Load'}
                </button>
              </div>

              {qcData && (
                <div>
                  <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: '13px' }}>
                      <strong>Target Mean:</strong> {qcData.target_mean}
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      <strong>Target SD:</strong> {qcData.target_sd}
                    </div>
                  </div>

                  <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px' }}>Last 30 Runs (Levey-Jennings)</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Run Date</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Measured Value</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Z-Score</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>Status</th>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Tech</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qcData.runs && qcData.runs.map((run: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '8px' }}>{new Date(run.run_date).toLocaleDateString()}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{run.measured_value.toFixed(2)}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{run.z_score.toFixed(2)}</td>
                          <td
                            style={{
                              padding: '8px',
                              textAlign: 'center',
                              backgroundColor:
                                run.result_status === 'pass'
                                  ? '#dcfce7'
                                  : run.result_status === 'warning'
                                  ? '#fef08a'
                                  : '#fee2e2',
                              borderRadius: '4px',
                              fontWeight: '600',
                            }}
                          >
                            {run.result_status}
                          </td>
                          <td style={{ padding: '8px' }}>{run.tech_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {qcData.westgard_violation_summary && Object.keys(qcData.westgard_violation_summary).length > 0 && (
                    <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#fef3c7', borderRadius: '4px', border: '1px solid #fcd34d' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>Westgard Violations</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                        {Object.entries(qcData.westgard_violation_summary).map(([rule, count]: [string, any]) => (
                          <div key={rule} style={{ fontSize: '12px' }}>
                            <strong>{rule}:</strong> {count}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab: Workload */}
          {activeTab === 'workload' && (
            <div style={{ padding: '20px' }}>
              <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>From</label>
                  <input
                    type="date"
                    value={workloadDateFrom}
                    onChange={(e) => setWorkloadDateFrom(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>To</label>
                  <input
                    type="date"
                    value={workloadDateTo}
                    onChange={(e) => setWorkloadDateTo(e.target.value)}
                    style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                  />
                </div>
              </div>

              {workloadLoading ? (
                <div>Loading...</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Technician</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Total Orders</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Days Active</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>Avg per Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workloadData.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '10px' }}>{row.tech_name}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.total_orders}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.unique_days}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{row.avg_per_day}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
