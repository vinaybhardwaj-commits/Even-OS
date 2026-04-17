'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface DispatchQueueItem {
  id: string;
  lab_order_id: string;
  order_number: string;
  panel_name: string;
  urgency: string;
  patient_name: string;
  patient_uhid: string;
  external_lab_id: string;
  created_at: string;
}

interface TrackingItem {
  id: string;
  status: string;
  order_number: string;
  panel_name: string;
  patient_name: string;
  patient_uhid: string;
  lab_name: string;
  dispatch_date: string | null;
  received_at: string | null;
  processing_at: string | null;
  results_received_at: string | null;
  tat_promised_hours: number | null;
  tat_breach: boolean;
}

interface BreachItem {
  id: string;
  lab_name: string;
  order_number: string;
  patient_name: string;
  dispatch_date: string | null;
  results_received_at: string | null;
  tat_promised_hours: number | null;
  tat_actual_hours: string | null;
}

interface CostSummaryItem {
  lab_name: string;
  order_count: number;
  total_cost: string;
  total_billing: string;
  margin: number;
  margin_pct: number;
}

// ─── tRPC helper ─────────────────────────────────────────
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

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

export default function OutsourcedWorkflowClient({
  userId, userRole, userName, breadcrumbs,
}: Props) {
  // ─── Tab state ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('dispatch');

  // ─── Dispatch Queue state ──────────────────────────────
  const [queueData, setQueueData] = useState<DispatchQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedQueue, setSelectedQueue] = useState<string[]>([]);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchLab, setDispatchLab] = useState('');
  const [dispatchMethod, setDispatchMethod] = useState<'courier' | 'pickup' | 'digital'>('courier');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [dispatchError, setDispatchError] = useState('');
  const [dispatchSuccess, setDispatchSuccess] = useState('');

  // ─── Tracking Dashboard state ──────────────────────────
  const [trackingData, setTrackingData] = useState<TrackingItem[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState('');

  // ─── TAT Breaches state ────────────────────────────────
  const [breachData, setBreachData] = useState<BreachItem[]>([]);
  const [breachLoading, setBreachLoading] = useState(false);

  // ─── Cost Summary state ────────────────────────────────
  const [costData, setCostData] = useState<CostSummaryItem[]>([]);
  const [costLoading, setCostLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // ─── General error/success ──────────────────────────────
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ─── Fetch dispatch queue ──────────────────────────────
  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const data = await trpcQuery('outsourcedWorkflow.dispatchQueue', { skip: 0, take: 100 });
      setQueueData(data.data || []);
      setSelectedQueue([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setQueueLoading(false);
    }
  }, []);

  // ─── Fetch tracking dashboard ──────────────────────────
  const fetchTracking = useCallback(async () => {
    setTrackingLoading(true);
    try {
      const data = await trpcQuery('outsourcedWorkflow.trackingDashboard', {
        status: trackingStatus || undefined,
      });
      setTrackingData(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tracking');
    } finally {
      setTrackingLoading(false);
    }
  }, [trackingStatus]);

  // ─── Fetch TAT breaches ────────────────────────────────
  const fetchBreaches = useCallback(async () => {
    setBreachLoading(true);
    try {
      const data = await trpcQuery('outsourcedWorkflow.tatBreachReport', { skip: 0, take: 100 });
      setBreachData(data.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load breaches');
    } finally {
      setBreachLoading(false);
    }
  }, []);

  // ─── Fetch cost summary ────────────────────────────────
  const fetchCosts = useCallback(async () => {
    setCostLoading(true);
    try {
      const data = await trpcQuery('outsourcedWorkflow.costSummary', {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setCostData(data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load costs');
    } finally {
      setCostLoading(false);
    }
  }, [dateFrom, dateTo]);

  // ─── Initial load ──────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'dispatch') fetchQueue();
  }, [activeTab, fetchQueue]);

  useEffect(() => {
    if (activeTab === 'tracking') fetchTracking();
  }, [activeTab, trackingStatus, fetchTracking]);

  useEffect(() => {
    if (activeTab === 'breaches') fetchBreaches();
  }, [activeTab, fetchBreaches]);

  useEffect(() => {
    if (activeTab === 'costs') fetchCosts();
  }, [activeTab, dateFrom, dateTo, fetchCosts]);

  // ─── Handle dispatch ───────────────────────────────────
  const handleDispatch = async () => {
    if (selectedQueue.length === 0 || !dispatchLab || !dispatchMethod) {
      setDispatchError('Select orders, lab, and dispatch method');
      return;
    }

    setDispatchError('');
    setDispatchSuccess('');

    try {
      await trpcMutate('outsourcedWorkflow.dispatchOrders', {
        order_ids: selectedQueue,
        external_lab_id: dispatchLab,
        dispatch_method: dispatchMethod,
        dispatch_tracking: trackingNumber || undefined,
      });

      setDispatchSuccess(`Dispatched ${selectedQueue.length} order(s)`);
      setTimeout(() => {
        setShowDispatchModal(false);
        setDispatchSuccess('');
        fetchQueue();
      }, 1500);
    } catch (err: unknown) {
      setDispatchError(err instanceof Error ? err.message : 'Dispatch failed');
    }
  };

  // ─── Format date ───────────────────────────────────────
  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const formatCurrency = (val: string | number | undefined) => {
    if (!val) return '₹0';
    const n = typeof val === 'string' ? parseFloat(val) : val;
    return `₹${n.toFixed(2)}`;
  };

  // ─── Color by status ───────────────────────────────────
  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      dispatched: '#f59e0b',
      received_by_lab: '#3b82f6',
      processing: '#8b5cf6',
      results_received: '#10b981',
      results_entered: '#06b6d4',
      verified: '#6366f1',
      cancelled: '#ef4444',
    };
    return colors[status] || '#6b7280';
  };

  const statusBg = (status: string) => {
    const colors: Record<string, string> = {
      dispatched: '#fef3c7',
      received_by_lab: '#dbeafe',
      processing: '#ede9fe',
      results_received: '#d1fae5',
      results_entered: '#cffafe',
      verified: '#e0e7ff',
      cancelled: '#fee2e2',
    };
    return colors[status] || '#f3f4f6';
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'system-ui' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          {breadcrumbs.map((bc, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {i > 0 && <span style={{ color: '#9ca3af' }}>/</span>}
              {bc.href ? (
                <a href={bc.href} style={{ color: '#3b82f6', cursor: 'pointer', textDecoration: 'none' }}>
                  {bc.label}
                </a>
              ) : (
                <span style={{ color: '#374151' }}>{bc.label}</span>
              )}
            </div>
          ))}
        </div>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#111827', margin: 0 }}>
          Outsourced Lab Workflow
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>
          Manage lab orders sent to external labs, track progress, and verify results
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', backgroundColor: '#fee2e2', color: '#991b1b',
          marginBottom: '16px', fontSize: '14px',
        }}
        >
          {error}
        </div>
      )}
      {success && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', backgroundColor: '#dcfce7', color: '#166534',
          marginBottom: '16px', fontSize: '14px',
        }}
        >
          {success}
        </div>
      )}
      {dispatchSuccess && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', backgroundColor: '#dcfce7', color: '#166534',
          marginBottom: '16px', fontSize: '14px',
        }}
        >
          {dispatchSuccess}
        </div>
      )}
      {dispatchError && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', backgroundColor: '#fee2e2', color: '#991b1b',
          marginBottom: '16px', fontSize: '14px',
        }}
        >
          {dispatchError}
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          {[
            { key: 'dispatch', label: 'Dispatch Queue' },
            { key: 'tracking', label: 'Tracking' },
            { key: 'breaches', label: 'TAT Breaches' },
            { key: 'costs', label: 'Cost Analysis' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '12px 16px',
                borderBottom: activeTab === tab.key ? '3px solid #3b82f6' : '3px solid transparent',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === tab.key ? '600' : '500',
                color: activeTab === tab.key ? '#1f2937' : '#6b7280',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB: DISPATCH QUEUE */}
      {activeTab === 'dispatch' && (
        <div>
          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden',
          }}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#1f2937', margin: 0 }}>
                  Orders Pending Dispatch
                </h2>
                <button
                  onClick={() => {
                    setShowDispatchModal(true);
                    setDispatchError('');
                  }}
                  disabled={selectedQueue.length === 0}
                  style={{
                    padding: '8px 16px', backgroundColor: selectedQueue.length > 0 ? '#3b82f6' : '#d1d5db',
                    color: '#fff', border: 'none', borderRadius: '6px', cursor: selectedQueue.length > 0 ? 'pointer' : 'not-allowed',
                    fontSize: '14px', fontWeight: '500',
                  }}
                >
                  Dispatch Selected ({selectedQueue.length})
                </button>
              </div>
            </div>

            {queueLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
            ) : queueData.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No orders pending dispatch</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedQueue.length === queueData.length}
                          onChange={(e) => setSelectedQueue(e.target.checked ? queueData.map(q => q.id) : [])}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Order #
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Patient
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Panel
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Urgency
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Ordered
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueData.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#fff' }}>
                        <td style={{ padding: '12px' }}>
                          <input
                            type="checkbox"
                            checked={selectedQueue.includes(item.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedQueue([...selectedQueue, item.id]);
                              } else {
                                setSelectedQueue(selectedQueue.filter(id => id !== item.id));
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#1f2937', fontWeight: '500' }}>
                          {item.order_number}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#374151' }}>
                          {item.patient_name}
                          <br />
                          <span style={{ fontSize: '12px', color: '#9ca3af' }}>{item.patient_uhid}</span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#374151' }}>{item.panel_name}</td>
                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>
                          <span style={{
                            padding: '4px 8px', borderRadius: '4px',
                            backgroundColor: item.urgency === 'stat' ? '#fee2e2' : item.urgency === 'urgent' ? '#fef3c7' : '#dbeafe',
                            color: item.urgency === 'stat' ? '#991b1b' : item.urgency === 'urgent' ? '#92400e' : '#1e40af',
                          }}
                          >
                            {item.urgency}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px', color: '#6b7280' }}>
                          {formatDate(item.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: TRACKING */}
      {activeTab === 'tracking' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '8px' }}>
              Filter by Status
            </label>
            <select
              value={trackingStatus}
              onChange={(e) => setTrackingStatus(e.target.value)}
              style={{
                padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px',
                fontFamily: 'inherit',
              }}
            >
              <option value="">All Statuses</option>
              <option value="dispatched">Dispatched</option>
              <option value="received_by_lab">Received by Lab</option>
              <option value="processing">Processing</option>
              <option value="results_received">Results Received</option>
            </select>
          </div>

          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden',
          }}
          >
            {trackingLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
            ) : trackingData.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No orders in transit</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Status
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Order #
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Patient
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Lab
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Dispatched
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Results Received
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        TAT
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackingData.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '600',
                            backgroundColor: statusBg(item.status), color: statusColor(item.status),
                          }}
                          >
                            {item.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#1f2937', fontWeight: '500' }}>
                          {item.order_number}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#374151' }}>
                          {item.patient_name}
                          <br />
                          <span style={{ fontSize: '12px', color: '#9ca3af' }}>{item.patient_uhid}</span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#374151' }}>{item.lab_name}</td>
                        <td style={{ padding: '12px', fontSize: '13px', color: '#6b7280' }}>
                          {formatDate(item.dispatch_date)}
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px', color: '#6b7280' }}>
                          {formatDate(item.results_received_at)}
                        </td>
                        <td style={{
                          padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600',
                          color: item.tat_breach ? '#dc2626' : '#059669',
                        }}
                        >
                          {item.tat_breach ? '⚠ Breach' : '✓ OK'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: TAT BREACHES */}
      {activeTab === 'breaches' && (
        <div>
          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden',
          }}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#fef2f2' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#991b1b', margin: 0 }}>
                TAT Breaches Detected
              </h2>
            </div>

            {breachLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
            ) : breachData.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No TAT breaches</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Lab
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Order #
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Patient
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Promised TAT (hrs)
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Actual TAT (hrs)
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Overdue (hrs)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {breachData.map((item) => {
                      const actual = item.tat_actual_hours ? parseFloat(item.tat_actual_hours) : 0;
                      const promised = item.tat_promised_hours || 0;
                      const overdue = Math.max(0, actual - promised);
                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#fef2f2' }}>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#374151', fontWeight: '500' }}>
                            {item.lab_name}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#1f2937', fontWeight: '500' }}>
                            {item.order_number}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#374151' }}>
                            {item.patient_name}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#374151' }}>
                            {promised}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#991b1b', fontWeight: '600' }}>
                            {actual.toFixed(1)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#dc2626', fontWeight: '600' }}>
                            +{overdue.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: COST ANALYSIS */}
      {activeTab === 'costs' && (
        <div>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '8px' }}>
                Date From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{
                  padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '8px' }}>
                Date To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{
                  padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden',
          }}
          >
            {costLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
            ) : costData.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No cost data available</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{
                        padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Lab Name
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Orders
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Cost to Hospital
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Billed to Patient
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Margin
                      </th>
                      <th style={{
                        padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280',
                      }}
                      >
                        Margin %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {costData.map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px', fontSize: '14px', color: '#1f2937', fontWeight: '500' }}>
                          {item.lab_name}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#374151' }}>
                          {item.order_count}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#374151' }}>
                          {formatCurrency(item.total_cost)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#374151' }}>
                          {formatCurrency(item.total_billing)}
                        </td>
                        <td style={{
                          padding: '12px', textAlign: 'right', fontSize: '14px', fontWeight: '600',
                          color: item.margin >= 0 ? '#059669' : '#dc2626',
                        }}
                        >
                          {formatCurrency(item.margin)}
                        </td>
                        <td style={{
                          padding: '12px', textAlign: 'right', fontSize: '14px', fontWeight: '600',
                          color: item.margin_pct >= 0 ? '#059669' : '#dc2626',
                        }}
                        >
                          {item.margin_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DISPATCH MODAL */}
      {showDispatchModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}
        >
          <div style={{
            backgroundColor: '#fff', borderRadius: '8px', maxWidth: '500px', width: '90%', padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937', marginBottom: '16px', margin: 0 }}>
              Dispatch Orders
            </h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '8px' }}>
                External Lab
              </label>
              <select
                value={dispatchLab}
                onChange={(e) => setDispatchLab(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                  fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              >
                <option value="">Select Lab</option>
                {/* TODO: fetch labs from API */}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '8px' }}>
                Dispatch Method
              </label>
              <select
                value={dispatchMethod}
                onChange={(e) => setDispatchMethod(e.target.value as any)}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                  fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              >
                <option value="courier">Courier</option>
                <option value="pickup">Pickup</option>
                <option value="digital">Digital</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', display: 'block', marginBottom: '8px' }}>
                Tracking Number (Optional)
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="e.g., AWB12345"
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                  fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>

            {dispatchError && (
              <div style={{
                padding: '12px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px',
                fontSize: '14px', marginBottom: '16px',
              }}
              >
                {dispatchError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDispatchModal(false)}
                style={{
                  padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDispatch}
                style={{
                  padding: '8px 16px', backgroundColor: '#3b82f6', color: '#fff', border: 'none',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500',
                }}
              >
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
