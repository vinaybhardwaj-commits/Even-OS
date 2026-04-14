'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConfirmModal, EmptyState } from '@/components/caregiver';

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
type PharmTab = 'verify' | 'dispense' | 'inventory' | 'narcotics';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function PharmacyClient({ userId, userRole, userName }: Props) {
  const [activeTab, setActiveTab] = useState<PharmTab>('verify');
  const [loading, setLoading] = useState(true);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [dispensingQueue, setDispensingQueue] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [narcoticsData, setNarcoticsData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [actionModal, setActionModal] = useState<{ type: 'verify' | 'reject' | 'clarify'; order: any } | null>(null);
  const [actionText, setActionText] = useState('');
  const [processing, setProcessing] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [pending, dispensing, inv, al, narcsReport, st] = await Promise.all([
        trpcQuery('pharmacy.pendingDispensing', {}),
        trpcQuery('pharmacy.listDispensingRecords', {}),
        trpcQuery('pharmacy.listInventory', {}),
        trpcQuery('pharmacy.listAlerts', { resolved_only: false }),
        trpcQuery('pharmacy.narcoticsReport'),
        trpcQuery('pharmacy.pharmacyStats'),
      ]);
      setPendingOrders(Array.isArray(pending) ? pending : []);
      setDispensingQueue(Array.isArray(dispensing) ? dispensing : []);
      setInventory(Array.isArray(inv) ? inv : []);
      setAlerts(Array.isArray(al) ? al : []);
      setNarcoticsData(Array.isArray(narcsReport) ? narcsReport : []);
      setStats(st);
    } catch (err) {
      console.error('Pharmacy load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Actions ───────────────────────────────────────────────────────────
  const verifyOrder = async (order: any) => {
    setProcessing(true);
    try {
      await trpcMutate('pharmacy.dispenseMedication', {
        medication_order_id: order.id,
        dr_inventory_id: order.pi_id || order.inventory_id || order.id,
        quantity_dispensed: order.mo_quantity || 1,
        dr_notes: `Verified and dispensed by ${userName}`,
      });
      setActionModal(null);
      await loadData();
    } catch (err) {
      alert('Failed to verify/dispense order');
    } finally {
      setProcessing(false);
    }
  };

  const rejectOrder = async (order: any) => {
    if (!actionText.trim()) { alert('Reason is required.'); return; }
    setProcessing(true);
    try {
      // Use returnMedication to log a rejection
      await trpcMutate('pharmacy.returnMedication', {
        dr_id: order.id,
        quantity_returned: order.mo_quantity || 1,
      });
      setActionModal(null);
      setActionText('');
      await loadData();
    } catch (err) {
      alert('Failed to reject order');
    } finally {
      setProcessing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading pharmacy…</p></div>;
  }

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>💊 Pharmacy Station</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {pendingOrders.length} pending · {alerts.length} alerts
          </p>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <span>📦 {stats.total_items || 0} items</span>
            <span>⚠️ {stats.low_stock_count || 0} low stock</span>
          </div>
        )}
      </header>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        {([
          { key: 'verify' as PharmTab, label: `✅ Verify (${pendingOrders.length})` },
          { key: 'dispense' as PharmTab, label: `📦 Dispensed (${dispensingQueue.length})` },
          { key: 'inventory' as PharmTab, label: `📊 Inventory` },
          { key: 'narcotics' as PharmTab, label: `🔒 Narcotics (${narcoticsData.length})` },
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 'calc(100vh - 120px)' }}>

        {/* Main panel */}
        <div style={{ padding: '16px 20px 100px', overflow: 'auto' }}>

          {/* ═══ VERIFY TAB ═══ */}
          {activeTab === 'verify' && (
            pendingOrders.length === 0 ? (
              <EmptyState title="All Verified" message="No orders pending verification." icon="✅" />
            ) : (
              pendingOrders.map((order: any, i: number) => (
                <div key={order.id || i} onClick={() => setSelectedOrder(order)} style={{
                  background: selectedOrder?.id === order.id ? '#e3f2fd' : '#fff',
                  border: `1px solid ${selectedOrder?.id === order.id ? '#90caf9' : '#e0e0e0'}`,
                  borderLeft: order.mo_priority === 'stat' ? '4px solid #c62828' : '4px solid #e0e0e0',
                  borderRadius: 8, padding: '12px 16px', marginBottom: 8, cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>
                        {order.drug_name || order.dm_drug_name || 'Unknown drug'}
                        {order.dm_strength && <span style={{ color: '#666', fontWeight: 400 }}> {order.dm_strength}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        {order.name_full || order.patient_name || 'Unknown patient'}
                        {order.mo_route && ` · ${order.mo_route}`}
                        {order.mo_frequency && ` · ${order.mo_frequency}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={(e) => { e.stopPropagation(); setActionModal({ type: 'verify', order }); }}
                        style={actionBtn('#2e7d32')}>✅ Verify</button>
                      <button onClick={(e) => { e.stopPropagation(); setActionModal({ type: 'reject', order }); setActionText(''); }}
                        style={actionBtn('#c62828')}>❌ Reject</button>
                    </div>
                  </div>
                  {order.mo_priority === 'stat' && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c62828', background: '#ffebee', padding: '2px 8px', borderRadius: 4, marginTop: 4, display: 'inline-block' }}>
                      🔴 STAT
                    </span>
                  )}
                </div>
              ))
            )
          )}

          {/* ═══ DISPENSE TAB ═══ */}
          {activeTab === 'dispense' && (
            dispensingQueue.length === 0 ? (
              <EmptyState title="No Dispensing Records" message="No recent dispensing activity." icon="📦" />
            ) : (
              dispensingQueue.map((rec: any, i: number) => (
                <div key={rec.id || i} style={{
                  background: '#fff', border: '1px solid #e0e0e0',
                  borderRadius: 8, padding: '10px 14px', marginBottom: 6, fontSize: 13,
                }}>
                  <div style={{ fontWeight: 600 }}>{rec.drug_name || rec.dm_drug_name || 'Drug'}</div>
                  <div style={{ color: '#666', marginTop: 2 }}>
                    {rec.patient_name || rec.name_full || ''} · Qty: {rec.dr_quantity || rec.quantity || ''}
                    · {rec.dr_status || rec.status || ''}
                  </div>
                </div>
              ))
            )
          )}

          {/* ═══ INVENTORY TAB ═══ */}
          {activeTab === 'inventory' && (
            inventory.length === 0 ? (
              <EmptyState title="No Inventory Data" message="Inventory is empty." icon="📊" />
            ) : (
              <div>
                {inventory.map((item: any, i: number) => {
                  const isLow = (item.pi_quantity || 0) <= (item.pi_reorder_level || 0);
                  return (
                    <div key={item.id || i} style={{
                      background: isLow ? '#fff3e0' : '#fff',
                      border: `1px solid ${isLow ? '#ffcc80' : '#e0e0e0'}`,
                      borderRadius: 8, padding: '10px 14px', marginBottom: 6,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{item.drug_name || item.dm_drug_name || 'Item'}</div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                          {item.pi_batch_number && `Batch: ${item.pi_batch_number} · `}
                          {item.pi_expiry_date && `Exp: ${new Date(item.pi_expiry_date).toLocaleDateString('en-IN')}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 18, fontWeight: 700,
                          color: isLow ? '#e65100' : '#2e7d32',
                        }}>{item.pi_quantity || 0}</div>
                        <div style={{ fontSize: 10, color: '#999' }}>
                          Reorder: {item.pi_reorder_level || 0}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ═══ NARCOTICS TAB ═══ */}
          {activeTab === 'narcotics' && (
            narcoticsData.length === 0 ? (
              <EmptyState title="No Narcotics Data" message="No controlled substances tracked." icon="🔒" />
            ) : (
              narcoticsData.map((item: any, i: number) => (
                <div key={item.id || i} style={{
                  background: '#fff', border: '1px solid #e0e0e0',
                  borderRadius: 8, padding: '10px 14px', marginBottom: 6,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>🔒 {item.drug_name || 'Controlled Substance'}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        Class: {item.nr_class || 'N/A'} · {item.nr_batch_number || ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#7b1fa2' }}>
                        {item.nr_balance || item.balance || 0}
                      </div>
                      <div style={{ fontSize: 10, color: '#999' }}>Balance</div>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* Right panel: CDS Alerts */}
        <aside style={{
          borderLeft: '1px solid #e0e0e0', background: '#fff',
          padding: 16, overflow: 'auto',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>⚠️ Alerts ({alerts.length})</h3>
          {alerts.length === 0 ? (
            <p style={{ fontSize: 12, color: '#999' }}>No active alerts.</p>
          ) : (
            alerts.map((alert: any, i: number) => (
              <div key={alert.id || i} style={{
                padding: '8px 10px', marginBottom: 6, borderRadius: 6,
                background: alert.sa_severity === 'critical' ? '#ffebee' : '#fff8e1',
                border: `1px solid ${alert.sa_severity === 'critical' ? '#ef9a9a' : '#ffe082'}`,
                fontSize: 12,
              }}>
                <div style={{ fontWeight: 600 }}>
                  {alert.sa_severity === 'critical' ? '🔴' : '🟡'} {alert.sa_alert_type || alert.alert_type || 'Alert'}
                </div>
                <div style={{ color: '#555', marginTop: 2 }}>{alert.sa_message || alert.message || ''}</div>
                {alert.sa_drug_name && <div style={{ color: '#888', marginTop: 2 }}>Drug: {alert.sa_drug_name}</div>}
              </div>
            ))
          )}

          {/* Selected order detail */}
          {selectedOrder && (
            <div style={{ marginTop: 16, borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>📋 Order Detail</h3>
              <div style={{ fontSize: 13 }}>
                <p><strong>Drug:</strong> {selectedOrder.drug_name || selectedOrder.dm_drug_name}</p>
                <p><strong>Patient:</strong> {selectedOrder.name_full || selectedOrder.patient_name}</p>
                <p><strong>Route:</strong> {selectedOrder.mo_route || 'N/A'}</p>
                <p><strong>Frequency:</strong> {selectedOrder.mo_frequency || 'N/A'}</p>
                <p><strong>Quantity:</strong> {selectedOrder.mo_quantity || 'N/A'}</p>
                <p><strong>Priority:</strong> {selectedOrder.mo_priority || 'routine'}</p>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ═══ ACTION MODALS ═══ */}
      {actionModal?.type === 'verify' && (
        <ConfirmModal
          open={true}
          title="Verify & Dispense?"
          message={`Confirm verification of ${actionModal.order.drug_name || actionModal.order.dm_drug_name} for ${actionModal.order.name_full || actionModal.order.patient_name}?`}
          onConfirm={() => verifyOrder(actionModal.order)}
          onCancel={() => setActionModal(null)}
        />
      )}

      {actionModal?.type === 'reject' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }} onClick={() => setActionModal(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 480, width: '90%' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>❌ Reject Order</h3>
            <textarea value={actionText} onChange={e => setActionText(e.target.value)}
              placeholder="Reason for rejection (required)…" rows={3}
              style={{ width: '100%', padding: 10, fontSize: 14, borderRadius: 8, border: '1px solid #d0d0d0', fontFamily: 'system-ui' }}
              autoFocus />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => rejectOrder(actionModal.order)} disabled={processing}
                style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, background: processing ? '#ccc' : '#c62828', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {processing ? 'Rejecting…' : 'Reject'}
              </button>
              <button onClick={() => setActionModal(null)}
                style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, background: '#e0e0e0', color: '#333', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'pharmacy', label: 'Pharmacy', icon: '💊', href: '/care/pharmacy' },
          { key: 'home', label: 'Home', icon: '⌂', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'pharmacy' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'pharmacy' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function actionBtn(color: string): React.CSSProperties {
  return {
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    background: `${color}15`, color, border: `1px solid ${color}40`,
    borderRadius: 6, cursor: 'pointer',
  };
}
