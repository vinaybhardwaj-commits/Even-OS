'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface OrderStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}

interface Order {
  id: string;
  encounter_id: string;
  order_type: string;
  order_name: string;
  priority: string;
  status: string;
  quantity: number;
  frequency: string | null;
  instructions: string | null;
  ordered_at: string;
  description: string | null;
}

interface Vital {
  id: string;
  encounter_id: string;
  temperature: number | null;
  pulse: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  spo2: number | null;
  respiratory_rate: number | null;
  blood_glucose: number | null;
  weight: number | null;
  height: number | null;
  pain_score: number | null;
  gcs_score: number | null;
  notes: string | null;
  recorded_at: string;
  recorded_by: string;
}

interface Note {
  id: string;
  encounter_id: string;
  note_type: string;
  content: string;
  recorded_at: string;
  recorded_by: string;
}

// ─── Helpers ─────────────────────────────────────────────
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

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Types for encounter selector ────────────────────────
interface ActiveEncounter {
  encounter_id: string;
  patient_id: string;
  uhid: string;
  patient_name: string;
  bed_name: string | null;
  ward_name: string | null;
  encounter_class: string;
  admission_at: string;
}

// ─── Main Component ──────────────────────────────────────
export default function OrdersClient() {
  // Tab state
  const [activeTab, setActiveTab] = useState<'orders' | 'vitals' | 'notes'>('orders');

  // ──────────── ENCOUNTER SELECTOR ───────────────────────
  const [encounters, setEncounters] = useState<ActiveEncounter[]>([]);
  const [selectedEncounterId, setSelectedEncounterId] = useState('');
  const [loadingEncounters, setLoadingEncounters] = useState(true);

  // ──────────── ORDERS ────────────────────────────────────
  const [orderStats, setOrderStats] = useState<OrderStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTypeFilter, setOrderTypeFilter] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderFormData, setOrderFormData] = useState({
    encounter_id: '',
    order_type: 'lab',
    priority: 'routine',
    order_name: '',
    description: '',
    quantity: 1,
    frequency: 'once',
    instructions: '',
  });

  // ──────────── VITALS ────────────────────────────────────
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [vitalPage, setVitalPage] = useState(1);
  const [vitalEncounterId, setVitalEncounterId] = useState('');
  const [loadingVitals, setLoadingVitals] = useState(true);

  const [showCreateVitalModal, setShowCreateVitalModal] = useState(false);
  const [creatingVital, setCreatingVital] = useState(false);
  const [vitalFormData, setVitalFormData] = useState({
    encounter_id: '',
    temperature: '',
    pulse: '',
    systolic_bp: '',
    diastolic_bp: '',
    spo2: '',
    respiratory_rate: '',
    blood_glucose: '',
    weight: '',
    height: '',
    pain_score: '',
    gcs_score: '',
    notes: '',
  });

  // ──────────── NOTES ─────────────────────────────────────
  const [notes, setNotes] = useState<Note[]>([]);
  const [notePage, setNotePage] = useState(1);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteFormData, setNoteFormData] = useState({
    encounter_id: '',
    note_type: 'general',
    content: '',
  });

  // Common error/success
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ─── Load active encounters on mount ───────────────────
  useEffect(() => {
    (async () => {
      setLoadingEncounters(true);
      try {
        const data = await trpcQuery('encounter.listActive', { page: 1, pageSize: 100 });
        setEncounters(data?.items || []);
      } catch {
        // Non-fatal — just means no encounters available
        setEncounters([]);
      } finally {
        setLoadingEncounters(false);
      }
    })();
  }, []);

  // ─── Load stats on mount (no encounter_id needed) ──────
  useEffect(() => {
    (async () => {
      try {
        const statsData = await trpcQuery('clinicalOrders.orderStats');
        setOrderStats(statsData);
      } catch { /* ignore */ }
    })();
  }, []);

  // ─── Load data on tab change (only if encounter selected) ──
  useEffect(() => {
    if (!selectedEncounterId) return;
    if (activeTab === 'orders') fetchOrders();
    else if (activeTab === 'vitals') fetchVitals();
    else if (activeTab === 'notes') fetchNotes();
  }, [activeTab, selectedEncounterId, orderPage, orderTypeFilter, orderStatusFilter, vitalPage, vitalEncounterId, notePage]);

  // ─── ORDERS: Fetch ──────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (!selectedEncounterId) return;
    setLoadingOrders(true);
    setError('');
    try {
      const listData = await trpcQuery('clinicalOrders.listOrders', {
        encounter_id: selectedEncounterId,
        page: orderPage,
        pageSize: 20,
        ...(orderTypeFilter ? { type: orderTypeFilter } : {}),
        ...(orderStatusFilter ? { status: orderStatusFilter } : {}),
      });
      setOrders(listData.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoadingOrders(false);
    }
  }, [selectedEncounterId, orderPage, orderTypeFilter, orderStatusFilter]);

  // ─── ORDERS: Create ─────────────────────────────────────
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderFormData.encounter_id || !orderFormData.order_name) {
      setError('Encounter ID and Order Name are required');
      return;
    }

    setCreatingOrder(true);
    setError('');
    try {
      await trpcMutate('clinicalOrders.createOrder', {
        encounter_id: orderFormData.encounter_id,
        order_type: orderFormData.order_type,
        priority: orderFormData.priority,
        order_name: orderFormData.order_name,
        description: orderFormData.description || null,
        quantity: parseInt(orderFormData.quantity.toString()) || 1,
        frequency: orderFormData.frequency || null,
        instructions: orderFormData.instructions || null,
        status: 'pending',
      });
      setSuccess('Order created successfully');
      setShowCreateOrderModal(false);
      setOrderFormData({
        encounter_id: '',
        order_type: 'lab',
        priority: 'routine',
        order_name: '',
        description: '',
        quantity: 1,
        frequency: 'once',
        instructions: '',
      });
      fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setCreatingOrder(false);
    }
  };

  // ─── VITALS: Fetch ──────────────────────────────────────
  const fetchVitals = useCallback(async () => {
    setLoadingVitals(true);
    setError('');
    try {
      const data = await trpcQuery('clinicalVitals.listVitals', {
        page: vitalPage,
        pageSize: 20,
        ...(vitalEncounterId ? { encounter_id: vitalEncounterId } : {}),
      });
      setVitals(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vitals');
    } finally {
      setLoadingVitals(false);
    }
  }, [vitalPage, vitalEncounterId]);

  // ─── VITALS: Create ─────────────────────────────────────
  const handleCreateVital = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vitalFormData.encounter_id) {
      setError('Encounter ID is required');
      return;
    }

    setCreatingVital(true);
    setError('');
    try {
      await trpcMutate('clinicalVitals.recordVital', {
        encounter_id: vitalFormData.encounter_id,
        temperature: vitalFormData.temperature ? parseFloat(vitalFormData.temperature) : null,
        pulse: vitalFormData.pulse ? parseInt(vitalFormData.pulse) : null,
        systolic_bp: vitalFormData.systolic_bp ? parseInt(vitalFormData.systolic_bp) : null,
        diastolic_bp: vitalFormData.diastolic_bp ? parseInt(vitalFormData.diastolic_bp) : null,
        spo2: vitalFormData.spo2 ? parseInt(vitalFormData.spo2) : null,
        respiratory_rate: vitalFormData.respiratory_rate ? parseInt(vitalFormData.respiratory_rate) : null,
        blood_glucose: vitalFormData.blood_glucose ? parseInt(vitalFormData.blood_glucose) : null,
        weight: vitalFormData.weight ? parseFloat(vitalFormData.weight) : null,
        height: vitalFormData.height ? parseFloat(vitalFormData.height) : null,
        pain_score: vitalFormData.pain_score ? parseInt(vitalFormData.pain_score) : null,
        gcs_score: vitalFormData.gcs_score ? parseInt(vitalFormData.gcs_score) : null,
        notes: vitalFormData.notes || null,
      });
      setSuccess('Vital recorded successfully');
      setShowCreateVitalModal(false);
      setVitalFormData({
        encounter_id: '',
        temperature: '',
        pulse: '',
        systolic_bp: '',
        diastolic_bp: '',
        spo2: '',
        respiratory_rate: '',
        blood_glucose: '',
        weight: '',
        height: '',
        pain_score: '',
        gcs_score: '',
        notes: '',
      });
      fetchVitals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record vital');
    } finally {
      setCreatingVital(false);
    }
  };

  // ─── NOTES: Fetch ───────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    setLoadingNotes(true);
    setError('');
    try {
      const data = await trpcQuery('clinicalNotes.listNotes', {
        page: notePage,
        pageSize: 20,
      });
      setNotes(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoadingNotes(false);
    }
  }, [notePage]);

  // ─── NOTES: Create ──────────────────────────────────────
  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteFormData.encounter_id || !noteFormData.content) {
      setError('Encounter ID and Content are required');
      return;
    }

    setCreatingNote(true);
    setError('');
    try {
      await trpcMutate('clinicalNotes.createNote', {
        encounter_id: noteFormData.encounter_id,
        note_type: noteFormData.note_type,
        content: noteFormData.content,
      });
      setSuccess('Note created successfully');
      setShowCreateNoteModal(false);
      setNoteFormData({
        encounter_id: '',
        note_type: 'general',
        content: '',
      });
      fetchNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    } finally {
      setCreatingNote(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────

  const themeStyles = {
    container: {
      background: '#1a1a2e',
      color: '#e0e0e0',
      minHeight: '100vh',
      padding: '20px',
    },
    card: {
      background: '#16213e',
      border: '1px solid #0f3460',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px',
    },
    button: {
      background: '#0f3460',
      color: '#e0e0e0',
      border: 'none',
      padding: '8px 16px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
    },
    buttonPrimary: {
      background: '#00d4ff',
      color: '#1a1a2e',
      fontWeight: '600',
    },
    input: {
      background: '#0f3460',
      color: '#e0e0e0',
      border: '1px solid #16213e',
      padding: '8px 12px',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
    },
    badge: {
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '600',
      marginRight: '4px',
    },
    statBox: {
      flex: 1,
      background: '#0f3460',
      padding: '16px',
      borderRadius: '6px',
      textAlign: 'center' as const,
    },
    modal: {
      position: 'fixed' as const,
      inset: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    },
    modalContent: {
      background: '#16213e',
      border: '2px solid #0f3460',
      borderRadius: '8px',
      padding: '24px',
      maxHeight: '90vh',
      overflowY: 'auto' as const,
      maxWidth: '500px',
      width: '90%',
    },
    tab: {
      padding: '12px 24px',
      background: 'transparent',
      border: 'none',
      color: '#e0e0e0',
      cursor: 'pointer',
      borderBottom: '2px solid transparent',
      fontSize: '14px',
      fontWeight: '500',
      marginRight: '8px',
    },
  };

  const getPriorityColor = (priority: string): string => {
    if (priority === 'stat') return '#ff4444';
    if (priority === 'urgent') return '#ff9900';
    return '#44ff44';
  };

  const getStatusColor = (status: string): string => {
    if (status === 'completed') return '#44ff44';
    if (status === 'in_progress') return '#00ccff';
    return '#ffaa00';
  };

  const getNoteTypeColor = (noteType: string): string => {
    const colors: Record<string, string> = {
      general: '#00d4ff',
      handover: '#ff6b9d',
      procedure: '#ffd93d',
      medication: '#6bcf7f',
    };
    return colors[noteType] || '#00d4ff';
  };

  return (
    <div style={themeStyles.container}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>Orders & Vitals</h1>
        <p style={{ fontSize: '14px', color: '#999' }}>Manage clinical orders, vital signs, and clinical notes</p>
      </div>

      {/* Alert Messages */}
      {error && (
        <div
          style={{
            background: '#8b0000',
            color: '#ffcccc',
            padding: '12px 16px',
            borderRadius: '4px',
            marginBottom: '16px',
            fontSize: '14px',
          }}
        >
          ✕ {error}
        </div>
      )}
      {success && (
        <div
          style={{
            background: '#006600',
            color: '#ccffcc',
            padding: '12px 16px',
            borderRadius: '4px',
            marginBottom: '16px',
            fontSize: '14px',
          }}
        >
          ✔ {success}
        </div>
      )}

      {/* Encounter Selector */}
      <div style={{
        background: '#0a1929',
        border: '1px solid #0f3460',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px',
      }}>
        <label style={{ display: 'block', fontSize: '12px', color: '#999', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Select Patient Encounter
        </label>
        {loadingEncounters ? (
          <div style={{ color: '#888', fontSize: '14px' }}>Loading active encounters…</div>
        ) : encounters.length === 0 ? (
          <div style={{ color: '#ffaa00', fontSize: '14px' }}>No active encounters found. Admit a patient first.</div>
        ) : (
          <select
            value={selectedEncounterId}
            onChange={(e) => {
              setSelectedEncounterId(e.target.value);
              setOrders([]);
              setVitals([]);
              setNotes([]);
              setOrderPage(1);
              setVitalPage(1);
              setNotePage(1);
            }}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#0d2137',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              color: '#e0e0e0',
              fontSize: '14px',
            }}
          >
            <option value="">— Select a patient encounter —</option>
            {encounters.map((enc) => (
              <option key={enc.encounter_id} value={enc.encounter_id}>
                {enc.uhid} — {enc.patient_name || 'Unknown'} {enc.bed_name ? `(${enc.ward_name || ''} / ${enc.bed_name})` : ''} — {enc.encounter_class}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #0f3460', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('orders')}
          style={{
            ...themeStyles.tab,
            borderBottomColor: activeTab === 'orders' ? '#00d4ff' : 'transparent',
            color: activeTab === 'orders' ? '#00d4ff' : '#e0e0e0',
          }}
        >
          &#x1F4CB; Orders
        </button>
        <button
          onClick={() => setActiveTab('vitals')}
          style={{
            ...themeStyles.tab,
            borderBottomColor: activeTab === 'vitals' ? '#00d4ff' : 'transparent',
            color: activeTab === 'vitals' ? '#00d4ff' : '#e0e0e0',
          }}
        >
          &#x1F4A1; Vitals
        </button>
        <button
          onClick={() => setActiveTab('notes')}
          style={{
            ...themeStyles.tab,
            borderBottomColor: activeTab === 'notes' ? '#00d4ff' : 'transparent',
            color: activeTab === 'notes' ? '#00d4ff' : '#e0e0e0',
          }}
        >
          &#x1F4DD; Notes
        </button>
      </div>

      {/* ORDERS TAB */}
      {activeTab === 'orders' && (
        <div>
          {/* Stats Row */}
          {orderStats && (
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <div style={themeStyles.statBox}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#00d4ff' }}>{orderStats.total}</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>Total Orders</div>
              </div>
              <div style={themeStyles.statBox}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#ffaa00' }}>{orderStats.pending}</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>Pending</div>
              </div>
              <div style={themeStyles.statBox}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#00ccff' }}>{orderStats.in_progress}</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>In Progress</div>
              </div>
              <div style={themeStyles.statBox}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#44ff44' }}>{orderStats.completed}</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>Completed</div>
              </div>
            </div>
          )}

          {/* Gate: require encounter selection */}
          {!selectedEncounterId && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#888' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#x1F50D;</div>
              <div style={{ fontSize: '16px' }}>Select a patient encounter above to view orders</div>
            </div>
          )}

          {/* Controls — only show if encounter selected */}
          {selectedEncounterId && (<><div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowCreateOrderModal(true)}
              style={{ ...themeStyles.button, ...themeStyles.buttonPrimary }}
            >
              &#x2795; Create Order
            </button>
            <select
              value={orderTypeFilter}
              onChange={(e) => {
                setOrderTypeFilter(e.target.value);
                setOrderPage(1);
              }}
              style={{ ...themeStyles.input, flex: 1, minWidth: '150px' }}
            >
              <option value="">All Types</option>
              <option value="lab">Lab</option>
              <option value="radiology">Radiology</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="procedure">Procedure</option>
              <option value="diet">Diet</option>
              <option value="nursing">Nursing</option>
            </select>
            <select
              value={orderStatusFilter}
              onChange={(e) => {
                setOrderStatusFilter(e.target.value);
                setOrderPage(1);
              }}
              style={{ ...themeStyles.input, flex: 1, minWidth: '150px' }}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {/* Orders Table */}
          {loadingOrders ? (
            <div style={{ ...themeStyles.card, textAlign: 'center' }}>Loading orders...</div>
          ) : orders.length === 0 ? (
            <div style={{ ...themeStyles.card, textAlign: 'center' }}>No orders found</div>
          ) : (
            <div style={themeStyles.card}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #0f3460' }}>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Order Name
                      </th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Priority
                      </th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Status
                      </th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Ordered At
                      </th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} style={{ borderBottom: '1px solid #0f3460' }}>
                        <td style={{ padding: '12px', fontSize: '14px' }}>{order.order_name}</td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          <span
                            style={{
                              ...themeStyles.badge,
                              background: '#0f3460',
                              color: '#00d4ff',
                            }}
                          >
                            {order.order_type}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          <span
                            style={{
                              ...themeStyles.badge,
                              background: getPriorityColor(order.priority),
                              color: '#1a1a2e',
                            }}
                          >
                            {order.priority}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          <span
                            style={{
                              ...themeStyles.badge,
                              background: getStatusColor(order.status),
                              color: '#1a1a2e',
                            }}
                          >
                            {order.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#999' }}>
                          {formatDate(order.ordered_at)}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <button
                            style={{ ...themeStyles.button, fontSize: '12px', marginRight: '4px' }}
                            onClick={() => alert('Update Status not yet implemented')}
                          >
                            Update
                          </button>
                          <button
                            style={{ ...themeStyles.button, fontSize: '12px' }}
                            onClick={() => alert('Add Result not yet implemented')}
                          >
                            Result
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={() => setOrderPage(Math.max(1, orderPage - 1))}
                  disabled={orderPage === 1}
                  style={{
                    ...themeStyles.button,
                    opacity: orderPage === 1 ? 0.5 : 1,
                    cursor: orderPage === 1 ? 'default' : 'pointer',
                  }}
                >
                  &#x276E; Prev
                </button>
                <span style={{ padding: '8px 12px', fontSize: '14px' }}>Page {orderPage}</span>
                <button
                  onClick={() => setOrderPage(orderPage + 1)}
                  style={themeStyles.button}
                >
                  Next &#x276F;
                </button>
              </div>
            </div>
          )}
          </>)}
        </div>
      )}

      {/* VITALS TAB */}
      {activeTab === 'vitals' && (
        <div>
          {/* Search & Controls */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowCreateVitalModal(true)}
              style={{ ...themeStyles.button, ...themeStyles.buttonPrimary }}
            >
              &#x2795; Record Vital
            </button>
            <input
              type="text"
              placeholder="Search by Encounter ID..."
              value={vitalEncounterId}
              onChange={(e) => {
                setVitalEncounterId(e.target.value);
                setVitalPage(1);
              }}
              style={{ ...themeStyles.input, flex: 1, minWidth: '200px' }}
            />
          </div>

          {/* Vitals Table */}
          {loadingVitals ? (
            <div style={{ ...themeStyles.card, textAlign: 'center' }}>Loading vitals...</div>
          ) : vitals.length === 0 ? (
            <div style={{ ...themeStyles.card, textAlign: 'center' }}>No vital records found</div>
          ) : (
            <div style={themeStyles.card}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #0f3460' }}>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Recorded At
                      </th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>Temp</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>Pulse</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>BP</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>SpO2</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>RR</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Glucose
                      </th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>Pain</th>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', fontWeight: '600' }}>
                        Recorded By
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitals.map((vital) => (
                      <tr key={vital.id} style={{ borderBottom: '1px solid #0f3460' }}>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#999' }}>
                          {formatDate(vital.recorded_at)}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.temperature ? `${vital.temperature}°C` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.pulse ? `${vital.pulse} bpm` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.systolic_bp && vital.diastolic_bp
                            ? `${vital.systolic_bp}/${vital.diastolic_bp}`
                            : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.spo2 ? `${vital.spo2}%` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.respiratory_rate ? `${vital.respiratory_rate}` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.blood_glucose ? `${vital.blood_glucose}` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          {vital.pain_score !== null ? `${vital.pain_score}/10` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontSize: '12px', color: '#999' }}>
                          {vital.recorded_by}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={() => setVitalPage(Math.max(1, vitalPage - 1))}
                  disabled={vitalPage === 1}
                  style={{
                    ...themeStyles.button,
                    opacity: vitalPage === 1 ? 0.5 : 1,
                    cursor: vitalPage === 1 ? 'default' : 'pointer',
                  }}
                >
                  &#x276E; Prev
                </button>
                <span style={{ padding: '8px 12px', fontSize: '14px' }}>Page {vitalPage}</span>
                <button
                  onClick={() => setVitalPage(vitalPage + 1)}
                  style={themeStyles.button}
                >
                  Next &#x276F;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* NOTES TAB */}
      {activeTab === 'notes' && (
        <div>
          {/* Controls */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <button
              onClick={() => setShowCreateNoteModal(true)}
              style={{ ...themeStyles.button, ...themeStyles.buttonPrimary }}
            >
              &#x2795; Add Note
            </button>
          </div>

          {/* Notes List */}
          {loadingNotes ? (
            <div style={{ ...themeStyles.card, textAlign: 'center' }}>Loading notes...</div>
          ) : notes.length === 0 ? (
            <div style={{ ...themeStyles.card, textAlign: 'center' }}>No notes found</div>
          ) : (
            <div>
              {notes.map((note) => (
                <div key={note.id} style={themeStyles.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                    <div>
                      <span
                        style={{
                          ...themeStyles.badge,
                          background: getNoteTypeColor(note.note_type),
                          color: '#1a1a2e',
                        }}
                      >
                        {note.note_type.replace('_', ' ')}
                      </span>
                      <span style={{ fontSize: '12px', color: '#999', marginLeft: '12px' }}>
                        Encounter: {note.encounter_id}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: '#999' }}>
                      {formatDate(note.recorded_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: '14px', lineHeight: '1.6', marginBottom: '8px' }}>
                    {note.content}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    By {note.recorded_by}
                  </div>
                </div>
              ))}

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={() => setNotePage(Math.max(1, notePage - 1))}
                  disabled={notePage === 1}
                  style={{
                    ...themeStyles.button,
                    opacity: notePage === 1 ? 0.5 : 1,
                    cursor: notePage === 1 ? 'default' : 'pointer',
                  }}
                >
                  &#x276E; Prev
                </button>
                <span style={{ padding: '8px 12px', fontSize: '14px' }}>Page {notePage}</span>
                <button
                  onClick={() => setNotePage(notePage + 1)}
                  style={themeStyles.button}
                >
                  Next &#x276F;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE ORDER MODAL */}
      {showCreateOrderModal && (
        <div style={themeStyles.modal}>
          <div style={themeStyles.modalContent}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '700' }}>Create Order</h2>
            <form onSubmit={handleCreateOrder}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Encounter ID *
                </label>
                <input
                  type="text"
                  value={orderFormData.encounter_id}
                  onChange={(e) =>
                    setOrderFormData({ ...orderFormData, encounter_id: e.target.value })
                  }
                  style={themeStyles.input}
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Order Type *
                </label>
                <select
                  value={orderFormData.order_type}
                  onChange={(e) =>
                    setOrderFormData({ ...orderFormData, order_type: e.target.value })
                  }
                  style={themeStyles.input}
                >
                  <option value="lab">Lab</option>
                  <option value="radiology">Radiology</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="procedure">Procedure</option>
                  <option value="diet">Diet</option>
                  <option value="nursing">Nursing</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Priority *
                </label>
                <select
                  value={orderFormData.priority}
                  onChange={(e) =>
                    setOrderFormData({ ...orderFormData, priority: e.target.value })
                  }
                  style={themeStyles.input}
                >
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">Stat</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Order Name *
                </label>
                <input
                  type="text"
                  value={orderFormData.order_name}
                  onChange={(e) =>
                    setOrderFormData({ ...orderFormData, order_name: e.target.value })
                  }
                  style={themeStyles.input}
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Description
                </label>
                <textarea
                  value={orderFormData.description}
                  onChange={(e) =>
                    setOrderFormData({ ...orderFormData, description: e.target.value })
                  }
                  style={{ ...themeStyles.input, minHeight: '80px', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ marginBottom: '12px', display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={orderFormData.quantity}
                    onChange={(e) =>
                      setOrderFormData({ ...orderFormData, quantity: parseInt(e.target.value) || 1 })
                    }
                    style={themeStyles.input}
                    min="1"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Frequency
                  </label>
                  <input
                    type="text"
                    value={orderFormData.frequency}
                    onChange={(e) =>
                      setOrderFormData({ ...orderFormData, frequency: e.target.value })
                    }
                    placeholder="e.g. once, daily"
                    style={themeStyles.input}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Instructions
                </label>
                <textarea
                  value={orderFormData.instructions}
                  onChange={(e) =>
                    setOrderFormData({ ...orderFormData, instructions: e.target.value })
                  }
                  style={{ ...themeStyles.input, minHeight: '60px', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateOrderModal(false)}
                  style={themeStyles.button}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingOrder}
                  style={{
                    ...themeStyles.button,
                    ...themeStyles.buttonPrimary,
                    opacity: creatingOrder ? 0.6 : 1,
                  }}
                >
                  {creatingOrder ? 'Creating...' : 'Create Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE VITAL MODAL */}
      {showCreateVitalModal && (
        <div style={themeStyles.modal}>
          <div style={themeStyles.modalContent}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '700' }}>Record Vital Signs</h2>
            <form onSubmit={handleCreateVital}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Encounter ID *
                </label>
                <input
                  type="text"
                  value={vitalFormData.encounter_id}
                  onChange={(e) =>
                    setVitalFormData({ ...vitalFormData, encounter_id: e.target.value })
                  }
                  style={themeStyles.input}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Temperature (°C)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={vitalFormData.temperature}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, temperature: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Pulse (bpm)
                  </label>
                  <input
                    type="number"
                    value={vitalFormData.pulse}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, pulse: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    BP Systolic
                  </label>
                  <input
                    type="number"
                    value={vitalFormData.systolic_bp}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, systolic_bp: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    BP Diastolic
                  </label>
                  <input
                    type="number"
                    value={vitalFormData.diastolic_bp}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, diastolic_bp: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    SpO2 (%)
                  </label>
                  <input
                    type="number"
                    value={vitalFormData.spo2}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, spo2: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Respiratory Rate
                  </label>
                  <input
                    type="number"
                    value={vitalFormData.respiratory_rate}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, respiratory_rate: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Blood Glucose
                  </label>
                  <input
                    type="number"
                    value={vitalFormData.blood_glucose}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, blood_glucose: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={vitalFormData.weight}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, weight: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={vitalFormData.height}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, height: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    Pain Score (0-10)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={vitalFormData.pain_score}
                    onChange={(e) =>
                      setVitalFormData({ ...vitalFormData, pain_score: e.target.value })
                    }
                    style={themeStyles.input}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  GCS Score (3-15)
                </label>
                <input
                  type="number"
                  min="3"
                  max="15"
                  value={vitalFormData.gcs_score}
                  onChange={(e) =>
                    setVitalFormData({ ...vitalFormData, gcs_score: e.target.value })
                  }
                  style={themeStyles.input}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Notes
                </label>
                <textarea
                  value={vitalFormData.notes}
                  onChange={(e) =>
                    setVitalFormData({ ...vitalFormData, notes: e.target.value })
                  }
                  style={{ ...themeStyles.input, minHeight: '60px', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateVitalModal(false)}
                  style={themeStyles.button}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingVital}
                  style={{
                    ...themeStyles.button,
                    ...themeStyles.buttonPrimary,
                    opacity: creatingVital ? 0.6 : 1,
                  }}
                >
                  {creatingVital ? 'Recording...' : 'Record Vital'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE NOTE MODAL */}
      {showCreateNoteModal && (
        <div style={themeStyles.modal}>
          <div style={themeStyles.modalContent}>
            <h2 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '700' }}>Add Note</h2>
            <form onSubmit={handleCreateNote}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Encounter ID *
                </label>
                <input
                  type="text"
                  value={noteFormData.encounter_id}
                  onChange={(e) =>
                    setNoteFormData({ ...noteFormData, encounter_id: e.target.value })
                  }
                  style={themeStyles.input}
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Note Type *
                </label>
                <select
                  value={noteFormData.note_type}
                  onChange={(e) =>
                    setNoteFormData({ ...noteFormData, note_type: e.target.value })
                  }
                  style={themeStyles.input}
                >
                  <option value="general">General</option>
                  <option value="handover">Handover</option>
                  <option value="procedure">Procedure</option>
                  <option value="medication">Medication</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                  Content *
                </label>
                <textarea
                  value={noteFormData.content}
                  onChange={(e) =>
                    setNoteFormData({ ...noteFormData, content: e.target.value })
                  }
                  style={{ ...themeStyles.input, minHeight: '120px', fontFamily: 'inherit' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateNoteModal(false)}
                  style={themeStyles.button}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingNote}
                  style={{
                    ...themeStyles.button,
                    ...themeStyles.buttonPrimary,
                    opacity: creatingNote ? 0.6 : 1,
                  }}
                >
                  {creatingNote ? 'Creating...' : 'Create Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
