'use client';

import { useState, useEffect, useCallback } from 'react';

/* ================================================================= */
/*  Types                                                            */
/* ================================================================= */

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

type TabType = 'pending_collection' | 'in_transit' | 'processing' | 'pending_verification' | 'critical_values' | 'outsourced';

interface WorklistSummary {
  pending_collection: number;
  in_transit: number;
  processing: number;
  pending_verification: number;
  verified_today: number;
  critical_values: number;
  outsourced_pending: number;
}

interface Order {
  id: string;
  order_number: string;
  urgency?: string;
  panel_name?: string;
  panel_code?: string;
  patient_name?: string;
  patient_uhid?: string;
  ordered_at?: string;
  collected_at?: string;
  received_at?: string;
  resulted_at?: string;
  status?: string;
  clinical_notes?: string;
  ordered_by_name?: string;
  is_critical?: boolean;
  result_count?: number;
}

interface CriticalValue {
  result_id: string;
  order_id: string;
  order_number: string;
  patient_name: string;
  patient_uhid: string;
  test_name: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  flag: string;
  ref_range_low: number | null;
  ref_range_high: number | null;
  critical_low: number | null;
  critical_high: number | null;
  resulted_at: string;
}

interface ExternalOrder {
  id: string;
  lab_name: string;
  patient_name: string;
  patient_uhid: string;
  order_number: string;
  panel_name: string;
  status: string;
  dispatch_date: string | null;
  dispatch_tracking: string | null;
  tat_promised_hours: number | null;
}

/* ================================================================= */
/*  Helpers                                                          */
/* ================================================================= */

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtHoursAgo(d: string | null | undefined) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const hrs = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hrs === 0) return `${mins}m ago`;
  return `${hrs}h ${mins}m ago`;
}

function urgencyColor(u: string | undefined) {
  if (!u) return '#6b7280';
  if (u === 'stat') return '#dc2626';
  if (u === 'asap') return '#f97316';
  if (u === 'urgent') return '#f59e0b';
  return '#3b82f6';
}

function statusColor(s: string | undefined) {
  if (!s) return '#6b7280';
  if (s === 'pending_dispatch') return '#f59e0b';
  if (s === 'dispatched') return '#3b82f6';
  if (s === 'received_by_lab') return '#8b5cf6';
  if (s === 'processing') return '#a855f7';
  if (s === 'results_received') return '#06b6d4';
  if (s === 'results_entered') return '#22c55e';
  if (s === 'verified') return '#16a34a';
  return '#6b7280';
}

async function trpcQuery(path: string, input?: unknown) {
  const res = await fetch('/api/trpc/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).message || res.statusText);
  }
  const data = await res.json();
  return data.result?.data;
}

/* ================================================================= */
/*  Main Component                                                   */
/* ================================================================= */

export default function LabWorklistAdminClient({
  userId,
  userRole,
  userName,
  breadcrumbs,
}: {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}) {
  const [tab, setTab] = useState<TabType>('pending_collection');
  const [summary, setSummary] = useState<WorklistSummary>({
    pending_collection: 0,
    in_transit: 0,
    processing: 0,
    pending_verification: 0,
    verified_today: 0,
    critical_values: 0,
    outsourced_pending: 0,
  });

  const [pendingCollectionData, setPendingCollectionData] = useState<Order[]>([]);
  const [inTransitData, setInTransitData] = useState<Order[]>([]);
  const [processingData, setProcessingData] = useState<Order[]>([]);
  const [pendingVerificationData, setPendingVerificationData] = useState<Order[]>([]);
  const [criticalValuesData, setCriticalValuesData] = useState<CriticalValue[]>([]);
  const [outsourcedData, setOutsourcedData] = useState<ExternalOrder[]>([]);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResult, setBarcodeResult] = useState<any>(null);
  const [barcodeError, setBarcodeError] = useState('');

  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, pc, it, p, pv, cv, op] = await Promise.all([
        trpcQuery('labWorklist.worklistSummary', {}),
        trpcQuery('labWorklist.pendingCollection', {}),
        trpcQuery('labWorklist.inTransit', {}),
        trpcQuery('labWorklist.processing', {}),
        trpcQuery('labWorklist.pendingVerification', {}),
        trpcQuery('labWorklist.criticalValues', {}),
        trpcQuery('labWorklist.outsourcedPending', {}),
      ]);

      setSummary(s || {});
      setPendingCollectionData(pc || []);
      setInTransitData(it || []);
      setProcessingData(p || []);
      setPendingVerificationData(pv || []);
      setCriticalValuesData(cv || []);
      setOutsourcedData(op || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch worklist data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleBarcodeSearch = async () => {
    if (!barcodeInput.trim()) {
      setBarcodeError('Please enter an order number');
      return;
    }
    setBarcodeError('');
    try {
      const result = await trpcQuery('labWorklist.lookupByBarcode', {
        order_number: barcodeInput.trim(),
      });
      setBarcodeResult(result);
    } catch (err) {
      setBarcodeError((err as Error).message || 'Order not found');
      setBarcodeResult(null);
    }
  };

  /* -------- Summary Cards -------- */
  const summaryCards = [
    { label: 'Pending Collection', value: summary.pending_collection, color: '#f59e0b' },
    { label: 'In Transit', value: summary.in_transit, color: '#3b82f6' },
    { label: 'Processing', value: summary.processing, color: '#8b5cf6' },
    { label: 'Pending Verification', value: summary.pending_verification, color: '#a855f7' },
    { label: 'Verified Today', value: summary.verified_today, color: '#22c55e' },
    { label: 'Critical', value: summary.critical_values, color: '#dc2626' },
    { label: 'Outsourced', value: summary.outsourced_pending, color: '#f97316' },
  ];

  const tabs: { key: TabType; label: string }[] = [
    { key: 'pending_collection', label: 'Pending Collection' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'processing', label: 'Processing' },
    { key: 'pending_verification', label: 'Pending Verification' },
    { key: 'critical_values', label: 'Critical Values' },
    { key: 'outsourced', label: 'Outsourced' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: 24 }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {breadcrumbs.map((bc, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {idx > 0 && <span style={{ color: '#64748b' }}>/</span>}
                {bc.href ? (
                  <a href={bc.href} style={{ color: '#3b82f6', textDecoration: 'none' }}>
                    {bc.label}
                  </a>
                ) : (
                  <span>{bc.label}</span>
                )}
              </div>
            ))}
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>Lab Worklist Dashboard</h1>
          <p style={{ color: '#94a3b8' }}>Real-time workflow tracking for lab orders</p>
        </div>

        {/* Summary Cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {summaryCards.map((card) => (
            <div
              key={card.label}
              onClick={() => setTab(card.label.toLowerCase().replace(' ', '_') as TabType)}
              style={{
                flex: '1 1 calc(14.28% - 10px)',
                minWidth: 140,
                background: '#1e293b',
                border: `1px solid ${card.color}33`,
                borderRadius: 8,
                padding: 16,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = card.color;
                (e.currentTarget as HTMLDivElement).style.background = card.color + '11';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = card.color + '33';
                (e.currentTarget as HTMLDivElement).style.background = '#1e293b';
              }}
            >
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>{card.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Barcode Lookup & Last Updated */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              Barcode Lookup
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Enter order number"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSearch()}
                style={{
                  flex: 1,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '10px 12px',
                  color: '#e2e8f0',
                  fontSize: 14,
                }}
              />
              <button
                onClick={handleBarcodeSearch}
                style={{
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Search
              </button>
            </div>
            {barcodeError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{barcodeError}</div>}
          </div>

          <div style={{ fontSize: 12, color: '#64748b' }}>
            Last updated: {lastUpdated ? fmtDateTime(lastUpdated.toISOString()) : 'Never'}
          </div>
        </div>

        {/* Barcode Result Modal */}
        {barcodeResult && (
          <div
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>
                Order {barcodeResult.order_number}
              </h3>
              <button
                onClick={() => setBarcodeResult(null)}
                style={{
                  background: 'transparent',
                  color: '#94a3b8',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontSize: 13 }}>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Patient</div>
                <div>{barcodeResult.patient_name} ({barcodeResult.patient_uhid})</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Panel</div>
                <div>{barcodeResult.panel_name}</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Status</div>
                <div>{barcodeResult.status}</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Urgency</div>
                <div style={{ color: urgencyColor(barcodeResult.urgency), fontWeight: 600 }}>
                  {barcodeResult.urgency?.toUpperCase()}
                </div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Ordered</div>
                <div>{fmtDateTime(barcodeResult.ordered_at)}</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Collected</div>
                <div>{fmtDateTime(barcodeResult.collected_at)}</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Received</div>
                <div>{fmtDateTime(barcodeResult.received_at)}</div>
              </div>
              <div>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>Verified</div>
                <div>{fmtDateTime(barcodeResult.verified_at)}</div>
              </div>
            </div>
            {barcodeResult.clinical_notes && (
              <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 6 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Clinical Notes</div>
                <div style={{ fontSize: 13 }}>{barcodeResult.clinical_notes}</div>
              </div>
            )}
            {barcodeResult.results && barcodeResult.results.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8, fontWeight: 600 }}>Results</div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  {barcodeResult.results.map((r: any) => (
                    <div key={r.id} style={{ fontSize: 13, paddingBottom: 8, borderBottom: '1px solid #334155', marginBottom: 8 }}>
                      <div style={{ fontWeight: 600 }}>{r.test_name}</div>
                      <div>
                        Value: {r.value_numeric || r.value_text || '—'} {r.unit || ''}
                        {r.flag && r.flag !== 'normal' && (
                          <span style={{ color: '#ef4444', marginLeft: 8 }}>({r.flag})</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #334155', marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: tab === t.key ? '#3b82f6' : '#94a3b8',
                  padding: '12px 0',
                  paddingBottom: 11,
                  borderBottom: tab === t.key ? '2px solid #3b82f6' : 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {tab === 'pending_collection' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Order #</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Patient</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Panel</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Urgency</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Ordered</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>By</th>
                </tr>
              </thead>
              <tbody>
                {pendingCollectionData.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No orders pending collection
                    </td>
                  </tr>
                ) : (
                  pendingCollectionData.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{o.order_number}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {o.patient_name} ({o.patient_uhid})
                      </td>
                      <td style={{ padding: '10px 8px' }}>{o.panel_name}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{ background: urgencyColor(o.urgency) + '22', color: urgencyColor(o.urgency), padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                          {(o.urgency || 'routine').toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>{fmtDateTime(o.ordered_at)}</td>
                      <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{o.ordered_by_name}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'in_transit' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Order #</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Patient</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Panel</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Collected</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Time in Transit</th>
                </tr>
              </thead>
              <tbody>
                {inTransitData.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No orders in transit
                    </td>
                  </tr>
                ) : (
                  inTransitData.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{o.order_number}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {o.patient_name} ({o.patient_uhid})
                      </td>
                      <td style={{ padding: '10px 8px' }}>{o.panel_name}</td>
                      <td style={{ padding: '10px 8px' }}>{fmtDateTime(o.collected_at)}</td>
                      <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{fmtHoursAgo(o.collected_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'processing' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Order #</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Patient</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Panel</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Received</th>
                </tr>
              </thead>
              <tbody>
                {processingData.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No orders processing
                    </td>
                  </tr>
                ) : (
                  processingData.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{o.order_number}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {o.patient_name} ({o.patient_uhid})
                      </td>
                      <td style={{ padding: '10px 8px' }}>{o.panel_name}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{ background: '#334155', color: '#cbd5e1', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
                          {(o.status || 'processing').charAt(0).toUpperCase() + (o.status || 'processing').slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>{fmtDateTime(o.received_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'pending_verification' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Order #</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Patient</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Panel</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Results</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Resulted</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Critical</th>
                </tr>
              </thead>
              <tbody>
                {pendingVerificationData.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No orders pending verification
                    </td>
                  </tr>
                ) : (
                  pendingVerificationData.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{o.order_number}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {o.patient_name} ({o.patient_uhid})
                      </td>
                      <td style={{ padding: '10px 8px' }}>{o.panel_name}</td>
                      <td style={{ padding: '10px 8px' }}>{o.result_count || 0} tests</td>
                      <td style={{ padding: '10px 8px' }}>{fmtDateTime(o.resulted_at)}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {o.is_critical ? (
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>Yes</span>
                        ) : (
                          <span style={{ color: '#64748b' }}>No</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'critical_values' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Order #</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Patient</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Test</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Value</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Critical Range</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Resulted</th>
                </tr>
              </thead>
              <tbody>
                {criticalValuesData.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No critical values
                    </td>
                  </tr>
                ) : (
                  criticalValuesData.map((c) => (
                    <tr
                      key={c.result_id}
                      style={{
                        borderBottom: '1px solid #334155',
                        background: '#7f1d1d22',
                        borderLeft: '3px solid #dc2626',
                      }}
                    >
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{c.order_number}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {c.patient_name} ({c.patient_uhid})
                      </td>
                      <td style={{ padding: '10px 8px' }}>{c.test_name}</td>
                      <td style={{ padding: '10px 8px', color: '#dc2626', fontWeight: 600 }}>
                        {c.value_numeric ?? c.value_text} {c.unit}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 12, color: '#94a3b8' }}>
                        {c.critical_low && c.critical_high
                          ? `< ${c.critical_low} or > ${c.critical_high}`
                          : c.critical_low
                          ? `< ${c.critical_low}`
                          : c.critical_high
                          ? `> ${c.critical_high}`
                          : '—'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>{fmtDateTime(c.resulted_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'outsourced' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Order #</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Patient</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Lab</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Panel</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: 600 }}>Tracking</th>
                </tr>
              </thead>
              <tbody>
                {outsourcedData.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                      No outsourced orders pending
                    </td>
                  </tr>
                ) : (
                  outsourcedData.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>{o.order_number}</td>
                      <td style={{ padding: '10px 8px' }}>
                        {o.patient_name} ({o.patient_uhid})
                      </td>
                      <td style={{ padding: '10px 8px' }}>{o.lab_name}</td>
                      <td style={{ padding: '10px 8px' }}>{o.panel_name}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            background: statusColor(o.status) + '22',
                            color: statusColor(o.status),
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {(o.status || 'pending').charAt(0).toUpperCase() + (o.status || 'pending').slice(1)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', color: '#94a3b8' }}>{o.dispatch_tracking || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
