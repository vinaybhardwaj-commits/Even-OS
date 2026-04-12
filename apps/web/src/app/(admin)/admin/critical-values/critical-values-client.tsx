'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// tRPC fetch helpers (no @/lib/trpc-client — doesn't exist)
// ============================================================
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  return json.result?.data;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Mutation failed');
  return json.result?.data;
}

// ============================================================
// Types
// ============================================================
type TabType = 'active' | 'verification' | 'compliance' | 'detail';

interface CriticalAlert {
  id: string;
  patient_id: string;
  test_code: string;
  test_name: string;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  flag: string;
  status: string;
  alert_sent_at: string | null;
  ack_at: string | null;
  ack_by: string | null;
  created_at: string;
  updated_at: string;
  escalation_chain: Array<{
    level: number;
    role: string;
    user_id: string;
    escalated_at: string;
    acknowledged_at: string | null;
  }> | null;
  ward: string | null;
  ordering_clinician_id: string | null;
  lab_order_id: string;
  lab_result_id: string;
  notes: string | null;
  released_at: string | null;
  released_by: string | null;
  read_back_text: string | null;
  read_back_value: string | null;
  read_back_matched: boolean | null;
  read_back_at: string | null;
  critical_low: string | null;
  critical_high: string | null;
  alert_method: string | null;
  ack_method: string | null;
}

interface UnverifiedResult {
  result_id: string;
  order_id: string;
  test_code: string;
  test_name: string;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  flag: string | null;
  is_critical: boolean;
  resulted_at: string;
  order_number: string;
  urgency: string;
  panel_name: string | null;
  uhid: string;
  patient_name: string;
}

interface ComplianceData {
  period: { from: string; to: string };
  total_alerts: number;
  acknowledged_within_15min: number;
  ack_within_15min_pct: number;
  escalated: number;
  released: number;
  avg_ack_time_seconds: number;
  avg_ack_time_minutes: number;
}

interface Stats {
  pending_alerts: number;
  alerts_24h: number;
  released_24h: number;
}

// ============================================================
// Formatters
// ============================================================
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusColor(s: string): string {
  const colors: Record<string, string> = {
    pending: '#f59e0b',
    sent: '#3b82f6',
    acknowledged: '#10b981',
    read_back_done: '#06b6d4',
    released: '#22c55e',
    escalated_l1: '#f97316',
    escalated_l2: '#ef4444',
    escalated_l3: '#dc2626',
    expired: '#6b7280',
  };
  return colors[s] || '#6b7280';
}

function statusLabel(s: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending',
    sent: 'Alert Sent',
    acknowledged: 'Acknowledged',
    read_back_done: 'Read-Back Done',
    released: 'Released',
    escalated_l1: 'Escalated L1',
    escalated_l2: 'Escalated L2',
    escalated_l3: 'Escalated L3',
    expired: 'Expired',
  };
  return labels[s] || s;
}

function flagLabel(f: string): string {
  if (f === 'critical_low') return 'CRITICAL LOW';
  if (f === 'critical_high') return 'CRITICAL HIGH';
  return f.toUpperCase();
}

function urgencyLabel(u: string): string {
  const labels: Record<string, string> = {
    stat: 'STAT',
    asap: 'ASAP',
    urgent: 'Urgent',
    routine: 'Routine',
  };
  return labels[u] || u;
}

// ============================================================
// Component
// ============================================================
export default function CriticalValuesClient() {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [unverified, setUnverified] = useState<UnverifiedResult[]>([]);
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<(CriticalAlert & { ack_by_name?: string; ordering_clinician_name?: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  // Acknowledge modal state
  const [showAckModal, setShowAckModal] = useState(false);
  const [ackAlertId, setAckAlertId] = useState<string | null>(null);
  const [ackReadBack, setAckReadBack] = useState('');
  const [ackReadBackValue, setAckReadBackValue] = useState('');
  const [ackMethod, setAckMethod] = useState<'pin' | 'password'>('password');

  // Load data
  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('criticalValues.list', { status: statusFilter, limit: 50, offset: 0 });
      setAlerts(data?.alerts || []);
    } catch { setError('Failed to load alerts'); }
    setLoading(false);
  }, [statusFilter]);

  const loadUnverified = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('criticalValues.unverifiedQueue', { limit: 50, offset: 0 });
      setUnverified(data?.results || []);
    } catch { setError('Failed to load verification queue'); }
    setLoading(false);
  }, []);

  const loadCompliance = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('criticalValues.complianceReport', {});
      setCompliance(data);
    } catch { setError('Failed to load compliance data'); }
    setLoading(false);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('criticalValues.stats');
      setStats(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadStats();
    if (activeTab === 'active') loadAlerts();
    if (activeTab === 'verification') loadUnverified();
    if (activeTab === 'compliance') loadCompliance();
  }, [activeTab, loadAlerts, loadUnverified, loadCompliance, loadStats]);

  // Auto-refresh active alerts every 30s
  useEffect(() => {
    if (activeTab !== 'active') return;
    const interval = setInterval(() => { loadAlerts(); loadStats(); }, 30000);
    return () => clearInterval(interval);
  }, [activeTab, loadAlerts, loadStats]);

  // View alert detail
  const viewDetail = async (alertId: string) => {
    try {
      const data = await trpcQuery('criticalValues.getDetail', { alert_id: alertId });
      setSelectedAlert(data);
      setActiveTab('detail');
    } catch { setError('Failed to load alert detail'); }
  };

  // Acknowledge
  const handleAcknowledge = async () => {
    if (!ackAlertId) return;
    try {
      const result = await trpcMutate('criticalValues.acknowledge', {
        alert_id: ackAlertId,
        ack_method: ackMethod,
        read_back_text: ackReadBack,
        read_back_value: ackReadBackValue ? parseFloat(ackReadBackValue) : undefined,
      });
      if (result?.success) {
        setShowAckModal(false);
        setAckReadBack('');
        setAckReadBackValue('');
        loadAlerts();
        loadStats();
      } else {
        setError(result?.error || 'Read-back mismatch');
      }
    } catch { setError('Failed to acknowledge'); }
  };

  // Release
  const handleRelease = async (alertId: string) => {
    try {
      await trpcMutate('criticalValues.release', { alert_id: alertId });
      loadAlerts();
      loadStats();
      if (selectedAlert?.id === alertId) {
        viewDetail(alertId);
      }
    } catch { setError('Failed to release'); }
  };

  // Verify result
  const handleVerify = async (resultId: string, orderId: string, action: 'accept' | 'reject' | 'flag', reason?: string) => {
    try {
      await trpcMutate('criticalValues.verifyResult', {
        lab_result_id: resultId,
        lab_order_id: orderId,
        action,
        comment: action === 'accept' ? 'Verified and accepted' : undefined,
        rejection_reason: reason,
      });
      loadUnverified();
    } catch { setError('Failed to verify result'); }
  };

  // ============================================================
  // TAB STYLES
  // ============================================================
  const tabStyle = (tab: TabType) => ({
    padding: '10px 20px',
    cursor: 'pointer' as const,
    background: activeTab === tab ? '#1e293b' : 'transparent',
    color: activeTab === tab ? '#fff' : '#94a3b8',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
    fontSize: '14px',
    fontWeight: activeTab === tab ? 600 : 400,
  });

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' }}>
        <div>
          <a href="/dashboard" style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px' }}>
            &#8592; Dashboard
          </a>
          <h1 style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 700 }}>
            Critical Value Communication
          </h1>
          <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '13px' }}>
            NABH Flagship — Alert, Read-Back, Escalation, Release
          </p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: stats.pending_alerts > 0 ? '#ef4444' : '#22c55e' }}>
                {stats.pending_alerts}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Pending</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#3b82f6' }}>
                {stats.alerts_24h}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>24h Alerts</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e' }}>
                {stats.released_24h}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>24h Released</div>
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{ background: '#7f1d1d', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#fca5a5', fontSize: '13px' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '16px' }}>&#10005;</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #334155', paddingLeft: '24px' }}>
        <button onClick={() => setActiveTab('active')} style={tabStyle('active')}>
          Active Alerts {stats && stats.pending_alerts > 0 ? `(${stats.pending_alerts})` : ''}
        </button>
        <button onClick={() => setActiveTab('verification')} style={tabStyle('verification')}>
          Verification Queue
        </button>
        <button onClick={() => setActiveTab('compliance')} style={tabStyle('compliance')}>
          NABH Compliance
        </button>
        {selectedAlert && (
          <button onClick={() => setActiveTab('detail')} style={tabStyle('detail')}>
            Alert Detail
          </button>
        )}
      </div>

      <div style={{ padding: '24px' }}>
        {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading...</div>}

        {/* ============================================================ */}
        {/* TAB 1: Active Alerts */}
        {/* ============================================================ */}
        {activeTab === 'active' && !loading && (
          <div>
            {/* Status filter */}
            <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['all', 'pending', 'sent', 'escalated_l1', 'escalated_l2', 'escalated_l3', 'read_back_done', 'released'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '16px',
                    border: statusFilter === s ? '1px solid #3b82f6' : '1px solid #475569',
                    background: statusFilter === s ? '#1e3a5f' : 'transparent',
                    color: statusFilter === s ? '#93c5fd' : '#94a3b8',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {s === 'all' ? 'All' : statusLabel(s)}
                </button>
              ))}
            </div>

            {alerts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#10003;</div>
                <p>No critical value alerts</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['Status', 'Flag', 'Test', 'Value', 'Time', 'Acknowledged', 'Actions'].map((h) => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((a) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer' }} onClick={() => viewDetail(a.id)}>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: `${statusColor(a.status)}20`,
                            color: statusColor(a.status),
                          }}>
                            {statusLabel(a.status)}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: '#7f1d1d',
                            color: '#fca5a5',
                          }}>
                            {flagLabel(a.flag)}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500 }}>{a.test_name}</td>
                        <td style={{ padding: '12px', fontSize: '13px', fontWeight: 700, color: '#ef4444' }}>
                          {a.value_numeric || a.value_text || '—'} {a.unit || ''}
                        </td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{fmtDate(a.created_at)}</td>
                        <td style={{ padding: '12px', fontSize: '12px' }}>
                          {a.ack_at ? (
                            <span style={{ color: '#22c55e' }}>{fmtDate(a.ack_at)}</span>
                          ) : (
                            <span style={{ color: '#ef4444' }}>Not yet</span>
                          )}
                        </td>
                        <td style={{ padding: '12px' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {(a.status === 'sent' || a.status.startsWith('escalated')) && (
                              <button
                                onClick={() => { setAckAlertId(a.id); setShowAckModal(true); }}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: '#dc2626',
                                  color: '#fff',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                Acknowledge
                              </button>
                            )}
                            {a.status === 'read_back_done' && (
                              <button
                                onClick={() => handleRelease(a.id)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: '#16a34a',
                                  color: '#fff',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                Release
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: Verification Queue */}
        {/* ============================================================ */}
        {activeTab === 'verification' && !loading && (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
              Results Awaiting Verification ({unverified.length})
            </h3>
            {unverified.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#10003;</div>
                <p>All results verified</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['Priority', 'Patient', 'UHID', 'Test', 'Value', 'Panel', 'Resulted', 'Actions'].map((h) => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {unverified.map((r) => (
                      <tr key={r.result_id} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: r.urgency === 'stat' ? '#7f1d1d' : r.urgency === 'urgent' ? '#78350f' : '#1e293b',
                            color: r.urgency === 'stat' ? '#fca5a5' : r.urgency === 'urgent' ? '#fcd34d' : '#94a3b8',
                          }}>
                            {urgencyLabel(r.urgency)}
                          </span>
                          {r.is_critical && (
                            <span style={{ marginLeft: '4px', padding: '3px 6px', borderRadius: '4px', fontSize: '10px', background: '#7f1d1d', color: '#fca5a5', fontWeight: 700 }}>
                              CRITICAL
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500 }}>{r.patient_name}</td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{r.uhid}</td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>{r.test_name}</td>
                        <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600, color: r.is_critical ? '#ef4444' : r.flag === 'abnormal' ? '#f59e0b' : '#e2e8f0' }}>
                          {r.value_numeric || r.value_text || '—'} {r.unit || ''}
                        </td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{r.panel_name || '—'}</td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{fmtDate(r.resulted_at)}</td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={() => handleVerify(r.result_id, r.order_id, 'accept')}
                              style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#16a34a', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('Rejection reason:');
                                if (reason) handleVerify(r.result_id, r.order_id, 'reject', reason);
                              }}
                              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleVerify(r.result_id, r.order_id, 'flag')}
                              style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #f59e0b', background: 'transparent', color: '#f59e0b', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                            >
                              Flag
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: NABH Compliance */}
        {/* ============================================================ */}
        {activeTab === 'compliance' && !loading && compliance && (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px' }}>
              NABH Critical Value Compliance Report
            </h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '24px' }}>
              Period: {fmtDate(compliance.period.from)} to {fmtDate(compliance.period.to)}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
              {/* KPI Cards */}
              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Total Alerts</div>
                <div style={{ fontSize: '32px', fontWeight: 700 }}>{compliance.total_alerts}</div>
              </div>
              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: `1px solid ${compliance.ack_within_15min_pct >= 90 ? '#16a34a' : compliance.ack_within_15min_pct >= 70 ? '#f59e0b' : '#ef4444'}` }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Acknowledged Within 15 min</div>
                <div style={{ fontSize: '32px', fontWeight: 700, color: compliance.ack_within_15min_pct >= 90 ? '#22c55e' : compliance.ack_within_15min_pct >= 70 ? '#f59e0b' : '#ef4444' }}>
                  {compliance.ack_within_15min_pct}%
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{compliance.acknowledged_within_15min} of {compliance.total_alerts}</div>
              </div>
              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Avg Acknowledgment Time</div>
                <div style={{ fontSize: '32px', fontWeight: 700 }}>{compliance.avg_ack_time_minutes} min</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Target: under 15 min</div>
              </div>
              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Escalations</div>
                <div style={{ fontSize: '32px', fontWeight: 700, color: Number(compliance.escalated) > 0 ? '#f59e0b' : '#22c55e' }}>{compliance.escalated}</div>
              </div>
              <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Released (Complete Cycle)</div>
                <div style={{ fontSize: '32px', fontWeight: 700, color: '#22c55e' }}>{compliance.released}</div>
              </div>
            </div>

            {/* NABH Standard Reference */}
            <div style={{ background: '#172554', borderRadius: '12px', padding: '20px', border: '1px solid #1e40af' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#93c5fd' }}>NABH Standard Reference</h4>
              <div style={{ fontSize: '13px', lineHeight: '1.8', color: '#cbd5e1' }}>
                <p style={{ margin: '0 0 8px' }}>COP.8.e: Critical results of diagnostic tests shall be communicated immediately to the concerned clinician.</p>
                <p style={{ margin: '0 0 8px' }}>The laboratory must have a defined list of critical values, a communication protocol with read-back verification, and documentation of the entire notification chain.</p>
                <p style={{ margin: '0' }}>Target: 100% acknowledgment within 15 minutes. Escalation protocol required for non-response.</p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 4: Alert Detail */}
        {/* ============================================================ */}
        {activeTab === 'detail' && selectedAlert && (
          <div>
            <button onClick={() => setActiveTab('active')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '13px', marginBottom: '16px' }}>
              &#8592; Back to Alerts
            </button>

            {/* Alert Header */}
            <div style={{ background: '#7f1d1d', borderRadius: '12px', padding: '24px', marginBottom: '24px', border: '1px solid #991b1b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, background: `${statusColor(selectedAlert.status)}30`, color: statusColor(selectedAlert.status) }}>
                    {statusLabel(selectedAlert.status)}
                  </span>
                  <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '12px 0 4px', color: '#fca5a5' }}>
                    {flagLabel(selectedAlert.flag)}: {selectedAlert.test_name}
                  </h2>
                  <p style={{ fontSize: '32px', fontWeight: 800, color: '#fff', margin: '0' }}>
                    {selectedAlert.value_numeric || selectedAlert.value_text || '—'} {selectedAlert.unit || ''}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: '#fca5a5' }}>Created: {fmtDate(selectedAlert.created_at)}</div>
                  {selectedAlert.ordering_clinician_name && (
                    <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '4px' }}>Ordering: {selectedAlert.ordering_clinician_name}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '24px', border: '1px solid #334155' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Workflow Timeline</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Created */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6', marginTop: '4px', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Alert Created</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>{fmtDate(selectedAlert.created_at)}</div>
                  </div>
                </div>
                {/* Sent */}
                {selectedAlert.alert_sent_at && (
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', marginTop: '4px', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Notifications Sent</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{fmtDate(selectedAlert.alert_sent_at)}</div>
                    </div>
                  </div>
                )}
                {/* Escalation chain */}
                {selectedAlert.escalation_chain && selectedAlert.escalation_chain.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', marginTop: '4px', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#fca5a5' }}>Escalated to L{e.level} ({e.role})</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{fmtDate(e.escalated_at)}</div>
                    </div>
                  </div>
                ))}
                {/* Acknowledged */}
                {selectedAlert.ack_at && (
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', marginTop: '4px', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>Acknowledged</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {fmtDate(selectedAlert.ack_at)} by {selectedAlert.ack_by_name || selectedAlert.ack_by || 'Unknown'}
                      </div>
                      {selectedAlert.read_back_matched !== null && (
                        <div style={{ fontSize: '12px', color: selectedAlert.read_back_matched ? '#22c55e' : '#ef4444', marginTop: '4px' }}>
                          Read-back: {selectedAlert.read_back_matched ? 'Matched' : 'MISMATCH'}
                          {selectedAlert.read_back_text && ` — "${selectedAlert.read_back_text}"`}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                {(selectedAlert.status === 'sent' || selectedAlert.status.startsWith('escalated')) && (
                  <button
                    onClick={() => { setAckAlertId(selectedAlert.id); setShowAckModal(true); }}
                    style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Acknowledge + Read-Back
                  </button>
                )}
                {selectedAlert.status === 'read_back_done' && (
                  <button
                    onClick={() => handleRelease(selectedAlert.id)}
                    style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#16a34a', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Release to EHR
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* Acknowledge Modal */}
      {/* ============================================================ */}
      {showAckModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(127,29,29,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '32px', maxWidth: '480px', width: '100%', border: '2px solid #dc2626' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fca5a5', marginBottom: '4px' }}>
              Critical Value Acknowledgment
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
              Read back the critical value to confirm. Value must match within 0.5% tolerance.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Read-Back Value (numeric)
              </label>
              <input
                type="number"
                step="any"
                value={ackReadBackValue}
                onChange={(e) => setAckReadBackValue(e.target.value)}
                placeholder="Enter the value you were told"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Read-Back Text (test name + value confirmation)
              </label>
              <input
                type="text"
                value={ackReadBack}
                onChange={(e) => setAckReadBack(e.target.value)}
                placeholder="e.g. Potassium 2.1 mEq/L confirmed"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Authentication Method
              </label>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setAckMethod('password')}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: ackMethod === 'password' ? '2px solid #3b82f6' : '1px solid #475569',
                    background: ackMethod === 'password' ? '#1e3a5f' : 'transparent',
                    color: '#e2e8f0', fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  Password
                </button>
                <button
                  onClick={() => setAckMethod('pin')}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: ackMethod === 'pin' ? '2px solid #3b82f6' : '1px solid #475569',
                    background: ackMethod === 'pin' ? '#1e3a5f' : 'transparent',
                    color: '#e2e8f0', fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  PIN
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowAckModal(false); setAckReadBack(''); setAckReadBackValue(''); }}
                style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAcknowledge}
                disabled={!ackReadBack}
                style={{
                  padding: '10px 20px', borderRadius: '8px', border: 'none',
                  background: ackReadBack ? '#dc2626' : '#475569',
                  color: '#fff', fontSize: '14px', fontWeight: 600, cursor: ackReadBack ? 'pointer' : 'not-allowed',
                }}
              >
                Confirm Acknowledgment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
