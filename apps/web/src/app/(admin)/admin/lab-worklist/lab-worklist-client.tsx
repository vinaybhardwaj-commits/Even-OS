'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// tRPC fetch helpers
// ============================================================
async function trpcQuery(path: string, input?: any) {
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

async function trpcMutate(path: string, input?: any) {
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

// ============================================================
// Types
// ============================================================
type TabType = 'worklist' | 'specimens' | 'results' | 'barcode' | 'analytics';

interface LabOrder {
  id: string;
  lo_order_number: string;
  lo_patient_id: string;
  lo_status: string;
  lo_urgency: string;
  lo_panel_name: string;
  lo_ordered_at: string;
  lo_is_critical: boolean;
  patient_name: string;
}

interface Specimen {
  id: string;
  sp_barcode: string | null;
  sp_order_id: string;
  sp_status: string;
  sp_collected_at: string | null;
  sp_received_at: string | null;
  sp_rejection_reason: string | null;
  patient_name: string;
}

interface BarcodeLookup {
  specimen_id: string;
  sp_barcode: string;
  sp_status: string;
  sp_sample_type: string;
  sp_collected_at: string | null;
  sp_received_at: string | null;
  order_id: string;
  lo_order_number: string;
  lo_status: string;
  lo_urgency: string;
  lo_panel_name: string;
  lo_clinical_notes: string | null;
  lo_ordered_at: string;
  lo_is_critical: boolean;
  patient_id: string;
  uhid: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  ordered_by_name: string | null;
  results: Array<{
    id: string;
    lr_test_code: string;
    lr_test_name: string;
    value_numeric: string | null;
    value_text: string | null;
    lr_unit: string | null;
    lr_flag: string | null;
    lr_is_critical: boolean;
    lr_resulted_at: string;
  }>;
}

interface LabStats {
  pending_orders: number;
  collected: number;
  received: number;
  processing: number;
  awaiting_verification: number;
  verified_today: number;
  critical_pending: number;
  stat_pending: number;
}

// ============================================================
// Formatters
// ============================================================
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDateFull(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function urgencyBadge(u: string): { bg: string; color: string; label: string } {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    stat: { bg: '#7f1d1d', color: '#fca5a5', label: 'STAT' },
    asap: { bg: '#78350f', color: '#fcd34d', label: 'ASAP' },
    urgent: { bg: '#713f12', color: '#fde68a', label: 'Urgent' },
    routine: { bg: '#1e293b', color: '#94a3b8', label: 'Routine' },
  };
  return map[u] || map.routine;
}

function statusBadge(s: string): { bg: string; color: string } {
  const map: Record<string, { bg: string; color: string }> = {
    ordered: { bg: '#1e3a5f', color: '#93c5fd' },
    collected: { bg: '#14532d', color: '#86efac' },
    received: { bg: '#164e63', color: '#67e8f9' },
    processing: { bg: '#4a1d96', color: '#c4b5fd' },
    resulted: { bg: '#78350f', color: '#fcd34d' },
    verified: { bg: '#14532d', color: '#22c55e' },
    cancelled: { bg: '#374151', color: '#9ca3af' },
    pending_collection: { bg: '#1e3a5f', color: '#93c5fd' },
    in_transit: { bg: '#164e63', color: '#67e8f9' },
    received_lab: { bg: '#14532d', color: '#86efac' },
    completed: { bg: '#14532d', color: '#22c55e' },
    rejected: { bg: '#7f1d1d', color: '#fca5a5' },
  };
  return map[s] || { bg: '#374151', color: '#9ca3af' };
}

function flagColor(f: string | null): string {
  if (!f) return '#94a3b8';
  const colors: Record<string, string> = {
    normal: '#22c55e',
    low: '#f59e0b',
    high: '#f59e0b',
    critical_low: '#ef4444',
    critical_high: '#ef4444',
    abnormal: '#f59e0b',
  };
  return colors[f] || '#94a3b8';
}

// ============================================================
// Component
// ============================================================
export default function LabWorklistClient() {
  const [activeTab, setActiveTab] = useState<TabType>('worklist');
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [stats, setStats] = useState<LabStats | null>(null);
  const [barcodeLookup, setBarcodeLookup] = useState<BarcodeLookup | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>(undefined);
  const [specimenStatusFilter, setSpecimenStatusFilter] = useState<string | undefined>(undefined);

  // Load data
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('labRadiology.listLabOrders', {
        status: statusFilter,
        urgency: urgencyFilter,
        limit: 50,
        offset: 0,
      });
      setOrders(data || []);
    } catch { setError('Failed to load orders'); }
    setLoading(false);
  }, [statusFilter, urgencyFilter]);

  const loadSpecimens = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('labRadiology.listSpecimens', {
        status: specimenStatusFilter,
        limit: 50,
        offset: 0,
      });
      setSpecimens(data || []);
    } catch { setError('Failed to load specimens'); }
    setLoading(false);
  }, [specimenStatusFilter]);

  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('labRadiology.labStats');
      setStats(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadStats();
    if (activeTab === 'worklist') loadOrders();
    if (activeTab === 'specimens') loadSpecimens();
  }, [activeTab, loadOrders, loadSpecimens, loadStats]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => { loadStats(); if (activeTab === 'worklist') loadOrders(); }, 30000);
    return () => clearInterval(interval);
  }, [activeTab, loadOrders, loadStats]);

  // Barcode lookup
  const handleBarcodeLookup = async () => {
    if (!barcodeInput.trim()) return;
    setBarcodeError(null);
    setBarcodeLookup(null);
    try {
      const data = await trpcQuery('labRadiology.getByBarcode', { barcode: barcodeInput.trim() });
      setBarcodeLookup(data);
    } catch {
      setBarcodeError(`No specimen found for barcode "${barcodeInput}"`);
    }
  };

  // Collect specimen
  const handleCollect = async (orderId: string) => {
    try {
      await trpcMutate('labRadiology.collectSpecimen', {
        sp_order_id: orderId,
        sp_collected_by: 'current-user', // In production, this would be ctx.user.sub
      });
      loadOrders();
      loadStats();
    } catch { setError('Failed to collect specimen'); }
  };

  // Receive specimen
  const handleReceive = async (orderId: string) => {
    try {
      await trpcMutate('labRadiology.receiveSpecimen', {
        sp_order_id: orderId,
        sp_received_by: 'current-user',
      });
      loadOrders();
      loadStats();
    } catch { setError('Failed to receive specimen'); }
  };

  // Verify order (batch)
  const handleVerifyOrder = async (orderId: string) => {
    try {
      await trpcMutate('labRadiology.verifyResults', {
        id: orderId,
        verified_by: 'current-user',
      });
      loadOrders();
      loadStats();
    } catch { setError('Failed to verify results'); }
  };

  // Tab styling
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
          <a href="/dashboard" style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px' }}>← Dashboard</a>
          <h1 style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 700 }}>Lab Worklist</h1>
          <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '13px' }}>Orders, specimens, results, verification</p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {[
              { label: 'Pending', value: stats.pending_orders, color: '#3b82f6' },
              { label: 'Awaiting Verify', value: stats.awaiting_verification, color: '#f59e0b' },
              { label: 'Critical', value: stats.critical_pending, color: stats.critical_pending > 0 ? '#ef4444' : '#22c55e' },
              { label: 'STAT', value: stats.stat_pending, color: stats.stat_pending > 0 ? '#f59e0b' : '#22c55e' },
              { label: 'Verified Today', value: stats.verified_today, color: '#22c55e' },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center', minWidth: '60px' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{ background: '#7f1d1d', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#fca5a5', fontSize: '13px' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #334155', paddingLeft: '24px', flexWrap: 'wrap' }}>
        <button onClick={() => setActiveTab('worklist')} style={tabStyle('worklist')}>Worklist</button>
        <button onClick={() => setActiveTab('specimens')} style={tabStyle('specimens')}>Specimens</button>
        <button onClick={() => setActiveTab('barcode')} style={tabStyle('barcode')}>Barcode Lookup</button>
        <button onClick={() => setActiveTab('analytics')} style={tabStyle('analytics')}>Analytics</button>
      </div>

      <div style={{ padding: '24px' }}>
        {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading...</div>}

        {/* ============================================================ */}
        {/* TAB 1: Lab Worklist (Orders) */}
        {/* ============================================================ */}
        {activeTab === 'worklist' && !loading && (
          <div>
            {/* Filters */}
            <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Status:</span>
              {['all', 'ordered', 'collected', 'received', 'processing', 'resulted', 'verified'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s === 'all' ? undefined : s)}
                  style={{
                    padding: '5px 12px', borderRadius: '14px',
                    border: (s === 'all' && !statusFilter) || statusFilter === s ? '1px solid #3b82f6' : '1px solid #475569',
                    background: (s === 'all' && !statusFilter) || statusFilter === s ? '#1e3a5f' : 'transparent',
                    color: (s === 'all' && !statusFilter) || statusFilter === s ? '#93c5fd' : '#94a3b8',
                    fontSize: '11px', cursor: 'pointer',
                  }}
                >
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
              <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '12px' }}>Priority:</span>
              {['all', 'stat', 'asap', 'urgent', 'routine'].map((u) => (
                <button
                  key={u}
                  onClick={() => setUrgencyFilter(u === 'all' ? undefined : u)}
                  style={{
                    padding: '5px 12px', borderRadius: '14px',
                    border: (u === 'all' && !urgencyFilter) || urgencyFilter === u ? '1px solid #3b82f6' : '1px solid #475569',
                    background: (u === 'all' && !urgencyFilter) || urgencyFilter === u ? '#1e3a5f' : 'transparent',
                    color: (u === 'all' && !urgencyFilter) || urgencyFilter === u ? '#93c5fd' : '#94a3b8',
                    fontSize: '11px', cursor: 'pointer',
                  }}
                >
                  {u === 'all' ? 'All' : u.toUpperCase()}
                </button>
              ))}
            </div>

            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔬</div>
                <p>No lab orders matching filters</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['Priority', 'Order #', 'Patient', 'Panel', 'Status', 'Ordered', 'Actions'].map((h) => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const ub = urgencyBadge(o.lo_urgency);
                      const sb = statusBadge(o.lo_status);
                      return (
                        <tr key={o.id} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: ub.bg, color: ub.color }}>{ub.label}</span>
                            {o.lo_is_critical && <span style={{ marginLeft: '4px', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', background: '#7f1d1d', color: '#fca5a5', fontWeight: 700 }}>CRITICAL</span>}
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'monospace' }}>{o.lo_order_number}</td>
                          <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500 }}>{o.patient_name}</td>
                          <td style={{ padding: '12px', fontSize: '13px' }}>{o.lo_panel_name}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: sb.bg, color: sb.color }}>
                              {o.lo_status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{fmtDate(o.lo_ordered_at)}</td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {o.lo_status === 'ordered' && (
                                <button onClick={() => handleCollect(o.id)} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#1d4ed8', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Collect</button>
                              )}
                              {o.lo_status === 'collected' && (
                                <button onClick={() => handleReceive(o.id)} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#0891b2', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Receive</button>
                              )}
                              {o.lo_status === 'resulted' && (
                                <button onClick={() => handleVerifyOrder(o.id)} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#16a34a', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Verify</button>
                              )}
                              {o.lo_is_critical && (
                                <a href="/admin/critical-values" style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #ef4444', color: '#ef4444', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>Alerts</a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: Specimens */}
        {/* ============================================================ */}
        {activeTab === 'specimens' && !loading && (
          <div>
            <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['all', 'pending_collection', 'collected', 'in_transit', 'received_lab', 'processing', 'completed', 'rejected'].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpecimenStatusFilter(s === 'all' ? undefined : s)}
                  style={{
                    padding: '5px 12px', borderRadius: '14px',
                    border: (s === 'all' && !specimenStatusFilter) || specimenStatusFilter === s ? '1px solid #3b82f6' : '1px solid #475569',
                    background: (s === 'all' && !specimenStatusFilter) || specimenStatusFilter === s ? '#1e3a5f' : 'transparent',
                    color: (s === 'all' && !specimenStatusFilter) || specimenStatusFilter === s ? '#93c5fd' : '#94a3b8',
                    fontSize: '11px', cursor: 'pointer',
                  }}
                >
                  {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>

            {specimens.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧪</div>
                <p>No specimens matching filters</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['Barcode', 'Patient', 'Status', 'Collected', 'Received', 'Rejection Reason'].map((h) => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {specimens.map((sp) => {
                      const sb = statusBadge(sp.sp_status);
                      return (
                        <tr key={sp.id} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'monospace' }}>{sp.sp_barcode || '—'}</td>
                          <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500 }}>{sp.patient_name}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: sb.bg, color: sb.color }}>
                              {sp.sp_status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{fmtDate(sp.sp_collected_at)}</td>
                          <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{fmtDate(sp.sp_received_at)}</td>
                          <td style={{ padding: '12px', fontSize: '12px', color: sp.sp_rejection_reason ? '#fca5a5' : '#64748b' }}>{sp.sp_rejection_reason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: Barcode Lookup */}
        {/* ============================================================ */}
        {activeTab === 'barcode' && (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Specimen Barcode Lookup</h3>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <input
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBarcodeLookup(); }}
                placeholder="Scan or enter specimen barcode..."
                autoFocus
                style={{
                  flex: 1, maxWidth: '400px', padding: '12px 16px', borderRadius: '8px',
                  border: '1px solid #475569', background: '#1e293b', color: '#e2e8f0',
                  fontSize: '16px', fontFamily: 'monospace',
                }}
              />
              <button
                onClick={handleBarcodeLookup}
                style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', background: '#1d4ed8', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                Lookup
              </button>
            </div>

            {barcodeError && (
              <div style={{ background: '#7f1d1d', padding: '16px', borderRadius: '8px', marginBottom: '24px', color: '#fca5a5', fontSize: '14px' }}>{barcodeError}</div>
            )}

            {barcodeLookup && (
              <div style={{ display: 'grid', gap: '16px' }}>
                {/* Patient Card */}
                <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                  <h4 style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '12px' }}>Patient</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Name</div>
                      <div style={{ fontSize: '16px', fontWeight: 600 }}>{barcodeLookup.first_name} {barcodeLookup.last_name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>UHID</div>
                      <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>{barcodeLookup.uhid}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Gender</div>
                      <div style={{ fontSize: '14px' }}>{barcodeLookup.gender || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>DOB</div>
                      <div style={{ fontSize: '14px' }}>{barcodeLookup.date_of_birth ? new Date(barcodeLookup.date_of_birth).toLocaleDateString('en-IN') : '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Order Card */}
                <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: barcodeLookup.lo_is_critical ? '1px solid #ef4444' : '1px solid #334155' }}>
                  <h4 style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '12px' }}>Order</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Order #</div>
                      <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>{barcodeLookup.lo_order_number}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Panel</div>
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>{barcodeLookup.lo_panel_name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Priority</div>
                      <div><span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700, background: urgencyBadge(barcodeLookup.lo_urgency).bg, color: urgencyBadge(barcodeLookup.lo_urgency).color }}>{urgencyBadge(barcodeLookup.lo_urgency).label}</span></div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Status</div>
                      <div><span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: statusBadge(barcodeLookup.lo_status).bg, color: statusBadge(barcodeLookup.lo_status).color }}>{barcodeLookup.lo_status.replace(/_/g, ' ')}</span></div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Ordered By</div>
                      <div style={{ fontSize: '14px' }}>{barcodeLookup.ordered_by_name || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Ordered At</div>
                      <div style={{ fontSize: '14px' }}>{fmtDateFull(barcodeLookup.lo_ordered_at)}</div>
                    </div>
                  </div>
                  {barcodeLookup.lo_clinical_notes && (
                    <div style={{ marginTop: '12px', padding: '10px', background: '#0f172a', borderRadius: '8px', fontSize: '13px', color: '#cbd5e1' }}>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>Clinical Notes:</span> {barcodeLookup.lo_clinical_notes}
                    </div>
                  )}
                </div>

                {/* Specimen Card */}
                <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                  <h4 style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '12px' }}>Specimen</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Barcode</div>
                      <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>{barcodeLookup.sp_barcode}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Sample Type</div>
                      <div style={{ fontSize: '14px' }}>{barcodeLookup.sp_sample_type}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Status</div>
                      <div><span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: statusBadge(barcodeLookup.sp_status).bg, color: statusBadge(barcodeLookup.sp_status).color }}>{barcodeLookup.sp_status.replace(/_/g, ' ')}</span></div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Collected</div>
                      <div style={{ fontSize: '14px' }}>{fmtDateFull(barcodeLookup.sp_collected_at)}</div>
                    </div>
                  </div>
                </div>

                {/* Results */}
                {barcodeLookup.results.length > 0 && (
                  <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' }}>
                    <h4 style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '12px' }}>Results ({barcodeLookup.results.length})</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #334155' }}>
                          {['Test', 'Value', 'Flag', 'Resulted'].map((h) => (
                            <th key={h} style={{ padding: '8px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {barcodeLookup.results.map((r) => (
                          <tr key={r.id} style={{ borderBottom: '1px solid #1e293b' }}>
                            <td style={{ padding: '8px', fontSize: '13px' }}>{r.lr_test_name}</td>
                            <td style={{ padding: '8px', fontSize: '13px', fontWeight: 600, color: r.lr_is_critical ? '#ef4444' : '#e2e8f0' }}>
                              {r.value_numeric || r.value_text || '—'} {r.lr_unit || ''}
                            </td>
                            <td style={{ padding: '8px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, color: flagColor(r.lr_flag) }}>
                                {r.lr_flag ? r.lr_flag.replace(/_/g, ' ').toUpperCase() : '—'}
                              </span>
                            </td>
                            <td style={{ padding: '8px', fontSize: '12px', color: '#94a3b8' }}>{fmtDate(r.lr_resulted_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 4: Analytics */}
        {/* ============================================================ */}
        {activeTab === 'analytics' && (
          <AnalyticsTab />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Analytics Sub-Component (separate to avoid re-renders)
// ============================================================
function AnalyticsTab() {
  const [tatStats, setTatStats] = useState<Array<{
    panel_name: string;
    avg_tat: number;
    target_tat: number;
    total_orders: number;
    pct_within_target: number;
  }>>([]);
  const [workload, setWorkload] = useState<Array<{
    lo_status: string;
    lp_department: string;
    order_count: number;
  }>>([]);
  const [rejectionStats, setRejectionStats] = useState<Array<{
    sp_rejection_reason: string;
    rejection_count: number;
    pct_of_total: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [tat, wl, rej] = await Promise.all([
          trpcQuery('labRadiology.labTATStats', { days: 30 }),
          trpcQuery('labRadiology.labWorkload', {}),
          trpcQuery('labRadiology.specimenRejectionRate', { days: 30 }),
        ]);
        setTatStats(tat || []);
        setWorkload(wl || []);
        setRejectionStats(rej || []);
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading analytics...</div>;

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      {/* TAT Performance */}
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '24px', border: '1px solid #334155' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>TAT Performance (30 days)</h3>
        {tatStats.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '13px' }}>No verified orders in the last 30 days</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Panel', 'Avg TAT (min)', 'Target (min)', 'Orders', '% Within Target'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tatStats.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500 }}>{s.panel_name}</td>
                  <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600, color: Number(s.avg_tat) > Number(s.target_tat) ? '#ef4444' : '#22c55e' }}>{Math.round(Number(s.avg_tat))}</td>
                  <td style={{ padding: '12px', fontSize: '13px', color: '#94a3b8' }}>{s.target_tat}</td>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{s.total_orders}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: '8px', background: '#374151', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(Number(s.pct_within_target), 100)}%`, height: '100%', background: Number(s.pct_within_target) >= 90 ? '#22c55e' : Number(s.pct_within_target) >= 70 ? '#f59e0b' : '#ef4444', borderRadius: '4px' }} />
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: Number(s.pct_within_target) >= 90 ? '#22c55e' : Number(s.pct_within_target) >= 70 ? '#f59e0b' : '#ef4444' }}>{Math.round(Number(s.pct_within_target))}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Today's Workload */}
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '24px', border: '1px solid #334155' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Today's Workload by Department</h3>
        {workload.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '13px' }}>No orders today</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {workload.map((w, i) => {
              const sb = statusBadge(w.lo_status);
              return (
                <div key={i} style={{ background: '#0f172a', borderRadius: '8px', padding: '16px', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>{w.lp_department || 'General'}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: sb.bg, color: sb.color }}>{w.lo_status}</span>
                    <span style={{ fontSize: '20px', fontWeight: 700 }}>{w.order_count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Specimen Rejection Rate */}
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '24px', border: '1px solid #334155' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Specimen Rejection Rate (30 days)</h3>
        {rejectionStats.length === 0 ? (
          <p style={{ color: '#22c55e', fontSize: '13px' }}>✓ No rejected specimens in the last 30 days</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Reason', 'Count', '% of Total'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rejectionStats.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px', fontSize: '13px' }}>{r.sp_rejection_reason || 'Unspecified'}</td>
                  <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>{r.rejection_count}</td>
                  <td style={{ padding: '12px', fontSize: '13px', color: '#f59e0b' }}>{Number(r.pct_of_total).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
