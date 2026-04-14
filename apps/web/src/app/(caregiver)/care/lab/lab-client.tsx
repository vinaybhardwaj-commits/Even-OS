'use client';

import { useState, useEffect, useCallback } from 'react';
import { EmptyState } from '@/components/caregiver';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
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
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type LabTab = 'worklist' | 'specimens' | 'results' | 'criticals';

const PIPELINE_STEPS = ['ordered', 'collected', 'received', 'resulted', 'verified'] as const;
const STEP_COLORS: Record<string, string> = {
  ordered: '#e3f2fd', collected: '#fff3e0', received: '#f3e5f5',
  resulted: '#e8f5e9', verified: '#e0f2f1',
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function LabClient({ userId, userRole, userName }: Props) {
  const [activeTab, setActiveTab] = useState<LabTab>('worklist');
  const [loading, setLoading] = useState(true);
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [specimens, setSpecimens] = useState<any[]>([]);
  const [criticals, setCriticals] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [resultsForm, setResultsForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [orders, specs, crits, st] = await Promise.all([
        trpcQuery('labRadiology.listLabOrders', { limit: 50 }),
        trpcQuery('labRadiology.listSpecimens', { limit: 50 }),
        trpcQuery('labRadiology.criticalValueLog', { limit: 20 }),
        trpcQuery('labRadiology.labStats'),
      ]);
      setLabOrders(Array.isArray(orders) ? orders : []);
      setSpecimens(Array.isArray(specs) ? specs : []);
      setCriticals(Array.isArray(crits) ? crits : []);
      setStats(st);
    } catch (err) {
      console.error('Lab load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Specimen actions ──────────────────────────────────────────────────
  const collectSpecimen = async (orderId: string) => {
    setSaving(true);
    try {
      await trpcMutate('labRadiology.collectSpecimen', { order_id: orderId });
      await loadData();
    } catch (err) { alert('Failed to collect specimen'); }
    finally { setSaving(false); }
  };

  const receiveSpecimen = async (orderId: string) => {
    setSaving(true);
    try {
      await trpcMutate('labRadiology.receiveSpecimen', { order_id: orderId });
      await loadData();
    } catch (err) { alert('Failed to receive specimen'); }
    finally { setSaving(false); }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const timeAgo = (dt: string | null) => {
    if (!dt) return '';
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  const pendingOrders = labOrders.filter((o: any) => ['ordered', 'collected', 'received'].includes(o.status || o.lo_status));
  const statOrders = pendingOrders.filter((o: any) => (o.priority || o.lo_priority) === 'stat');
  const routineOrders = pendingOrders.filter((o: any) => (o.priority || o.lo_priority) !== 'stat');

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading lab…</p></div>;
  }

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>🧪 Lab Station</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {pendingOrders.length} pending · {statOrders.length} STAT · {criticals.length} critical values
          </p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <span>📊 TAT avg: {stats.avg_tat_minutes ? `${Math.round(stats.avg_tat_minutes)}m` : 'N/A'}</span>
          </div>
        )}
      </header>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        {([
          { key: 'worklist' as LabTab, label: `📋 Worklist (${pendingOrders.length})` },
          { key: 'specimens' as LabTab, label: `🧫 Specimens (${specimens.length})` },
          { key: 'results' as LabTab, label: `📊 Results` },
          { key: 'criticals' as LabTab, label: `🔴 Critical (${criticals.length})` },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888',
            cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 24px 100px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ═══ WORKLIST TAB ═══ */}
        {activeTab === 'worklist' && (
          <>
            {/* STAT orders first */}
            {statOrders.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#c62828', padding: '4px 10px', background: '#ffebee', borderRadius: '6px 6px 0 0', borderLeft: '3px solid #ef9a9a' }}>
                  🔴 STAT ({statOrders.length})
                </div>
                {statOrders.map((order: any, i: number) => (
                  <OrderCard key={order.id || i} order={order} onCollect={collectSpecimen} onReceive={receiveSpecimen} saving={saving} timeAgo={timeAgo} />
                ))}
              </div>
            )}

            {/* Routine orders */}
            {routineOrders.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#666', padding: '4px 10px', background: '#f5f5f5', borderRadius: '6px 6px 0 0' }}>
                  🟡 Routine ({routineOrders.length})
                </div>
                {routineOrders.map((order: any, i: number) => (
                  <OrderCard key={order.id || i} order={order} onCollect={collectSpecimen} onReceive={receiveSpecimen} saving={saving} timeAgo={timeAgo} />
                ))}
              </div>
            )}

            {pendingOrders.length === 0 && (
              <EmptyState title="All Clear" message="No pending lab orders." icon="✅" />
            )}
          </>
        )}

        {/* ═══ SPECIMENS TAB ═══ */}
        {activeTab === 'specimens' && (
          specimens.length === 0 ? (
            <EmptyState title="No Specimens" message="No specimen tracking data available." icon="🧫" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {specimens.map((spec: any, i: number) => {
                const status = spec.status || spec.sp_status || 'ordered';
                return (
                  <div key={spec.id || i} style={{
                    background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                    padding: '10px 14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{spec.test_name || spec.sp_type || 'Specimen'}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                        background: STEP_COLORS[status] || '#f5f5f5',
                      }}>{status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      {spec.patient_name || ''} · {spec.barcode || spec.sp_barcode || ''}
                    </div>
                    {/* Pipeline progress */}
                    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
                      {PIPELINE_STEPS.map(step => {
                        const idx = PIPELINE_STEPS.indexOf(step);
                        const currentIdx = PIPELINE_STEPS.indexOf(status as any);
                        const isComplete = idx <= currentIdx;
                        return (
                          <div key={step} style={{
                            flex: 1, height: 4, borderRadius: 2,
                            background: isComplete ? '#4caf50' : '#e0e0e0',
                          }} />
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Ordered</span><span>Verified</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ═══ RESULTS TAB ═══ */}
        {activeTab === 'results' && (
          <div>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>Recently completed results</p>
            {labOrders.filter((o: any) => ['resulted', 'verified', 'completed'].includes(o.status || o.lo_status)).length === 0 ? (
              <EmptyState title="No Results" message="No completed results yet." icon="📊" />
            ) : (
              labOrders.filter((o: any) => ['resulted', 'verified', 'completed'].includes(o.status || o.lo_status)).map((order: any, i: number) => (
                <div key={order.id || i} style={{
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                  padding: '10px 14px', marginBottom: 6,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{order.test_name || order.lo_test_name}</span>
                      <div style={{ fontSize: 12, color: '#666' }}>{order.patient_name || ''}</div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      background: (order.status || order.lo_status) === 'verified' ? '#e8f5e9' : '#fff3e0',
                      color: (order.status || order.lo_status) === 'verified' ? '#2e7d32' : '#e65100',
                    }}>{order.status || order.lo_status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ═══ CRITICALS TAB ═══ */}
        {activeTab === 'criticals' && (
          criticals.length === 0 ? (
            <EmptyState title="No Critical Values" message="No unacknowledged critical values." icon="✅" />
          ) : (
            criticals.map((cv: any, i: number) => (
              <div key={cv.id || i} style={{
                background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 8,
                padding: '12px 16px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#c62828' }}>
                      🔴 {cv.test_name || cv.cv_test_name || 'Critical Value'}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      Result: <strong>{cv.result_value || cv.cv_value || 'N/A'}</strong>
                      {cv.reference_range && <span style={{ color: '#888' }}> (Ref: {cv.reference_range})</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                      {cv.patient_name || ''} · {timeAgo(cv.created_at || cv.cv_detected_at)}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                    background: cv.cv_acknowledged ? '#e8f5e9' : '#fff3e0',
                    color: cv.cv_acknowledged ? '#2e7d32' : '#e65100',
                  }}>
                    {cv.cv_acknowledged ? '✅ Acknowledged' : '⏰ Pending'}
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'lab', label: 'Lab', icon: '🧪', href: '/care/lab' },
          { key: 'home', label: 'Home', icon: '⌂', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'lab' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'lab' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function OrderCard({ order, onCollect, onReceive, saving, timeAgo }: {
  order: any; onCollect: (id: string) => void; onReceive: (id: string) => void;
  saving: boolean; timeAgo: (dt: string | null) => string;
}) {
  const status = order.status || order.lo_status || 'ordered';
  return (
    <div style={{
      background: '#fff', border: '1px solid #e0e0e0', borderTop: 'none',
      padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{order.test_name || order.lo_test_name}</div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {order.patient_name || ''} · Ordered {timeAgo(order.ordered_at || order.lo_ordered_at)}
          {order.ordering_doctor && ` · by Dr. ${order.ordering_doctor}`}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
          background: STEP_COLORS[status] || '#f5f5f5',
        }}>{status}</span>
        {status === 'ordered' && (
          <button onClick={() => onCollect(order.id)} disabled={saving}
            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80', borderRadius: 6, cursor: 'pointer' }}>
            🧫 Collect
          </button>
        )}
        {status === 'collected' && (
          <button onClick={() => onReceive(order.id)} disabled={saving}
            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: '#f3e5f5', color: '#7b1fa2', border: '1px solid #ce93d8', borderRadius: 6, cursor: 'pointer' }}>
            📥 Receive
          </button>
        )}
      </div>
    </div>
  );
}
