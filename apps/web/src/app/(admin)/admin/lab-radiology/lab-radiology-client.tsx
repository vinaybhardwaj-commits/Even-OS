'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── TYPES ────────────────────────────────────────────────────
type User = { sub: string; hospital_id: string; role: string; email: string; name: string; department?: string };

interface LabOrder {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  panel_id: string;
  panel_name: string;
  urgency: 'stat' | 'urgent' | 'routine';
  status: 'ordered' | 'collected' | 'received' | 'processing' | 'result_entered' | 'verified' | 'reported';
  ordered_by: string;
  ordered_at: string;
  tat_target_hours: number;
  clinical_notes: string | null;
  specimen_barcode: string | null;
}

interface LabResult {
  id: string;
  order_id: string;
  order_number: string;
  test_code: string;
  test_name: string;
  value: string | number | null;
  unit: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
  is_critical: boolean;
  is_abnormal: boolean;
  result_at: string;
  verified_at: string | null;
  verified_by: string | null;
}

interface RadiologyOrder {
  id: string;
  order_number: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  modality: 'xray' | 'ct' | 'mri' | 'ultrasound' | 'other';
  study_description: string;
  urgency: 'stat' | 'urgent' | 'routine';
  status: 'scheduled' | 'in_progress' | 'completed' | 'reported' | 'verified';
  scheduled_at: string | null;
  completed_at: string | null;
  ordered_at: string;
  ordered_by: string;
  dicom_study_uid?: string | null;
  accession_number_dicom?: string | null;
}

interface Specimen {
  id: string;
  barcode: string;
  order_id: string;
  patient_id: string;
  patient_name: string;
  sample_type: string;
  status: 'pending' | 'collected' | 'in_transit' | 'received' | 'rejected';
  collected_by: string | null;
  collected_at: string | null;
  location: string;
  rejection_reason: string | null;
}

interface TestPanel {
  id: string;
  panel_code: string;
  panel_name: string;
  department: string;
  sample_type: string;
  tat_target_hours: number;
  price: number;
  component_count: number;
  components?: PanelComponent[];
}

interface PanelComponent {
  id: string;
  test_code: string;
  test_name: string;
  unit: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
}

interface TATStats {
  panel_name: string;
  target_tat_hours: number;
  actual_avg_tat_hours: number;
  within_target_percent: number;
  total_orders: number;
}

interface CriticalValue {
  id: string;
  order_number: string;
  patient_name: string;
  test_name: string;
  value: string | number;
  reference_range: string;
  flagged_at: string;
  notified: boolean;
  notified_to: string | null;
}

interface LabWorkloadItem {
  department: string;
  date: string;
  order_count: number;
  critical_count: number;
}

interface RadiologyWorkloadItem {
  modality: string;
  date: string;
  study_count: number;
  pending_count: number;
}

interface SpecimenRejectionStat {
  sample_type: string;
  total_specimens: number;
  rejected_count: number;
  rejection_rate_percent: number;
  top_rejection_reason: string;
}

// ─── HELPERS ────────────────────────────────────────────────────
function formatCurrency(amount: string | number | undefined | null): string {
  if (amount === undefined || amount === null) return '₹ 0.00';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₹ 0.00';
  return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateString: string | undefined | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatNumber(num: string | number | undefined | null): number {
  if (num === undefined || num === null) return 0;
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return isNaN(n) ? 0 : n;
}

function getUrgencyColor(urgency: string): string {
  switch (urgency) {
    case 'stat': return '#ef4444';
    case 'urgent': return '#f59e0b';
    case 'routine': return '#9ca3af';
    default: return '#6b7280';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'ordered': case 'pending': case 'scheduled': return '#3b82f6';
    case 'collected': case 'in_transit': case 'in_progress': return '#eab308';
    case 'received': case 'processing': return '#f59e0b';
    case 'result_entered': case 'completed': return '#10b981';
    case 'verified': case 'reported': return '#06b6d4';
    case 'rejected': return '#ef4444';
    default: return '#6b7280';
  }
}

// ─── tRPC HELPERS ────────────────────────────────────────────────
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

// ─── MAIN COMPONENT ────────────────────────────────────────────
export default function LabRadiologyClient({ user }: { user: User }) {
  // ─── TAB STATE ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'lab-orders' | 'lab-results' | 'radiology' | 'specimens' | 'panels' | 'analytics'>('lab-orders');

  // ─── LAB ORDERS TAB ────────────────────────────────────
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [labOrdersLoading, setLabOrdersLoading] = useState(true);
  const [labOrdersError, setLabOrdersError] = useState('');
  const [labOrdersSuccess, setLabOrdersSuccess] = useState('');

  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [processingOrdersCount, setProcessingOrdersCount] = useState(0);
  const [awaitingVerificationCount, setAwaitingVerificationCount] = useState(0);
  const [criticalResultsTodayCount, setCriticalResultsTodayCount] = useState(0);

  const [showNewLabOrderForm, setShowNewLabOrderForm] = useState(false);
  const [newLabOrder, setNewLabOrder] = useState({ patientId: '', panelId: '', urgency: 'routine', clinicalNotes: '' });

  // ─── LAB RESULTS TAB ───────────────────────────────────
  const [labResults, setLabResults] = useState<LabResult[]>([]);
  const [labResultsLoading, setLabResultsLoading] = useState(true);
  const [labResultsError, setLabResultsError] = useState('');
  const [labResultsSuccess, setLabResultsSuccess] = useState('');

  const [showResultForm, setShowResultForm] = useState(false);
  const [selectedOrderForResults, setSelectedOrderForResults] = useState<LabOrder | null>(null);
  const [resultFormValues, setResultFormValues] = useState<Record<string, string>>({});

  // ─── RADIOLOGY TAB ────────────────────────────────────
  const [radiologyOrders, setRadiologyOrders] = useState<RadiologyOrder[]>([]);
  const [radiologyLoading, setRadiologyLoading] = useState(true);
  const [radiologyError, setRadiologyError] = useState('');
  const [radiologySuccess, setRadiologySuccess] = useState('');

  const [radiologyModality, setRadiologyModality] = useState<'all' | 'xray' | 'ct' | 'mri' | 'ultrasound' | 'other'>('all');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedRadiologyOrder, setSelectedRadiologyOrder] = useState<RadiologyOrder | null>(null);

  // ─── SPECIMENS TAB ────────────────────────────────────
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [specimensLoading, setSpecimensLoading] = useState(true);
  const [specimenSearch, setSpecimenSearch] = useState('');

  // ─── PANELS TAB ───────────────────────────────────────
  const [panels, setPanels] = useState<TestPanel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(true);
  const [panelsDeptFilter, setPanelsDeptFilter] = useState('all');
  const [showAddPanelForm, setShowAddPanelForm] = useState(false);

  // ─── ANALYTICS TAB ────────────────────────────────────
  const [tatStats, setTatStats] = useState<TATStats[]>([]);
  const [criticalValues, setCriticalValues] = useState<CriticalValue[]>([]);
  const [labWorkload, setLabWorkload] = useState<LabWorkloadItem[]>([]);
  const [radiologyWorkload, setRadiologyWorkload] = useState<RadiologyWorkloadItem[]>([]);
  const [specimenRejectionStats, setSpecimenRejectionStats] = useState<SpecimenRejectionStat[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // ─── FETCH DATA FUNCTIONS ────────────────────────────
  const fetchLabOrders = useCallback(async () => {
    setLabOrdersLoading(true);
    setLabOrdersError('');
    try {
      const data = await trpcQuery('labRadiology.listLabOrders', { page: 1, pageSize: 50 });
      setLabOrders(data.items || []);

      const pending = (data.items || []).filter((o: LabOrder) => o.status === 'ordered').length;
      const processing = (data.items || []).filter((o: LabOrder) => o.status === 'processing').length;
      const awaiting = (data.items || []).filter((o: LabOrder) => o.status === 'result_entered').length;
      const critical = (data.items || []).filter((o: LabOrder) => {
        const today = new Date().toDateString();
        return new Date(o.ordered_at).toDateString() === today && o.status === 'verified';
      }).length;

      setPendingOrdersCount(pending);
      setProcessingOrdersCount(processing);
      setAwaitingVerificationCount(awaiting);
      setCriticalResultsTodayCount(critical);
    } catch (err) {
      setLabOrdersError(err instanceof Error ? err.message : 'Failed to load lab orders');
    } finally {
      setLabOrdersLoading(false);
    }
  }, []);

  const fetchLabResults = useCallback(async () => {
    setLabResultsLoading(true);
    setLabResultsError('');
    try {
      const data = await trpcQuery('labRadiology.listLabResults', { page: 1, pageSize: 100 });
      setLabResults(data.items || []);
    } catch (err) {
      setLabResultsError(err instanceof Error ? err.message : 'Failed to load lab results');
    } finally {
      setLabResultsLoading(false);
    }
  }, []);

  const fetchRadiologyOrders = useCallback(async () => {
    setRadiologyLoading(true);
    setRadiologyError('');
    try {
      const data = await trpcQuery('labRadiology.listRadiologyOrders', { page: 1, pageSize: 50 });
      setRadiologyOrders(data.items || []);
    } catch (err) {
      setRadiologyError(err instanceof Error ? err.message : 'Failed to load radiology orders');
    } finally {
      setRadiologyLoading(false);
    }
  }, []);

  const fetchSpecimens = useCallback(async () => {
    setSpecimensLoading(true);
    try {
      const data = await trpcQuery('labRadiology.listSpecimens', { page: 1, pageSize: 100 });
      setSpecimens(data.items || []);
    } catch (err) {
      // silent
    } finally {
      setSpecimensLoading(false);
    }
  }, []);

  const fetchPanels = useCallback(async () => {
    setPanelsLoading(true);
    try {
      const data = await trpcQuery('labRadiology.listPanels', { page: 1, pageSize: 100 });
      setPanels(data.items || []);
    } catch (err) {
      // silent
    } finally {
      setPanelsLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [tatData, criticalData, labWkld, radWkld, specRej] = await Promise.all([
        trpcQuery('labRadiology.labTATStats'),
        trpcQuery('labRadiology.criticalValueLog'),
        trpcQuery('labRadiology.labWorkload'),
        trpcQuery('labRadiology.radiologyWorkload'),
        trpcQuery('labRadiology.specimenRejectionRate'),
      ]);
      setTatStats(tatData.items || []);
      setCriticalValues(criticalData.items || []);
      setLabWorkload(labWkld.items || []);
      setRadiologyWorkload(radWkld.items || []);
      setSpecimenRejectionStats(specRej.items || []);
    } catch (err) {
      // silent
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // ─── INITIAL LOAD ────────────────────────────────────
  useEffect(() => {
    fetchLabOrders();
  }, [fetchLabOrders]);

  useEffect(() => {
    if (activeTab === 'lab-results') fetchLabResults();
  }, [activeTab, fetchLabResults]);

  useEffect(() => {
    if (activeTab === 'radiology') fetchRadiologyOrders();
  }, [activeTab, fetchRadiologyOrders]);

  useEffect(() => {
    if (activeTab === 'specimens') fetchSpecimens();
  }, [activeTab, fetchSpecimens]);

  useEffect(() => {
    if (activeTab === 'panels') fetchPanels();
  }, [activeTab, fetchPanels]);

  useEffect(() => {
    if (activeTab === 'analytics') fetchAnalytics();
  }, [activeTab, fetchAnalytics]);

  // ─── ACTION HANDLERS ────────────────────────────────
  const handleCreateLabOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLabOrdersError('');
    setLabOrdersSuccess('');
    try {
      await trpcMutate('labRadiology.createLabOrder', {
        patient_id: newLabOrder.patientId,
        panel_id: newLabOrder.panelId,
        urgency: newLabOrder.urgency,
        clinical_notes: newLabOrder.clinicalNotes || null,
      });
      setLabOrdersSuccess('Lab order created successfully');
      setNewLabOrder({ patientId: '', panelId: '', urgency: 'routine', clinicalNotes: '' });
      setShowNewLabOrderForm(false);
      fetchLabOrders();
    } catch (err) {
      setLabOrdersError(err instanceof Error ? err.message : 'Failed to create lab order');
    }
  };

  const handleEnterResults = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderForResults) return;
    setLabResultsError('');
    setLabResultsSuccess('');
    try {
      await trpcMutate('labRadiology.enterResults', {
        order_id: selectedOrderForResults.id,
        values: resultFormValues,
      });
      setLabResultsSuccess('Results entered successfully');
      setShowResultForm(false);
      setSelectedOrderForResults(null);
      setResultFormValues({});
      fetchLabResults();
    } catch (err) {
      setLabResultsError(err instanceof Error ? err.message : 'Failed to enter results');
    }
  };

  const handleCollectSpecimen = async (orderId: string) => {
    setLabOrdersError('');
    setLabOrdersSuccess('');
    try {
      await trpcMutate('labRadiology.collectSpecimen', { order_id: orderId });
      setLabOrdersSuccess('Specimen collected');
      fetchLabOrders();
    } catch (err) {
      setLabOrdersError(err instanceof Error ? err.message : 'Failed to collect specimen');
    }
  };

  const handleReceiveSpecimen = async (orderId: string) => {
    setLabOrdersError('');
    setLabOrdersSuccess('');
    try {
      await trpcMutate('labRadiology.receiveSpecimen', { order_id: orderId });
      setLabOrdersSuccess('Specimen received');
      fetchLabOrders();
    } catch (err) {
      setLabOrdersError(err instanceof Error ? err.message : 'Failed to receive specimen');
    }
  };

  const handleScheduleRadiology = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRadiologyOrder) return;
    setRadiologyError('');
    setRadiologySuccess('');
    try {
      const formData = new FormData(e.currentTarget as HTMLFormElement);
      await trpcMutate('labRadiology.scheduleStudy', {
        order_id: selectedRadiologyOrder.id,
        room: formData.get('room'),
        scheduled_at: formData.get('scheduled_at'),
      });
      setRadiologySuccess('Study scheduled successfully');
      setShowScheduleModal(false);
      setSelectedRadiologyOrder(null);
      fetchRadiologyOrders();
    } catch (err) {
      setRadiologyError(err instanceof Error ? err.message : 'Failed to schedule study');
    }
  };

  // ─── RENDER ────────────────────────────────────────
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', color: '#111827', margin: '0 0 8px 0' }}>Lab &amp; Radiology</h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>Manage laboratory and radiology services</p>
      </div>

      {/* TAB NAVIGATION */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
        {[
          { id: 'lab-orders' as const, label: 'Lab Orders', color: '#2563eb' },
          { id: 'lab-results' as const, label: 'Lab Results', color: '#2563eb' },
          { id: 'radiology' as const, label: 'Radiology', color: '#a855f7' },
          { id: 'specimens' as const, label: 'Specimens', color: '#2563eb' },
          { id: 'panels' as const, label: 'Test Panels', color: '#2563eb' },
          { id: 'analytics' as const, label: 'Analytics', color: '#6366f1' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 16px',
              fontSize: '14px',
              fontWeight: '500',
              color: activeTab === tab.id ? tab.color : '#6b7280',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 200ms',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== TAB 1: LAB ORDERS ===== */}
      {activeTab === 'lab-orders' && (
        <div>
          {/* STAT CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>Pending Orders</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#2563eb' }}>{pendingOrdersCount}</div>
            </div>
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>In Processing</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>{processingOrdersCount}</div>
            </div>
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>Awaiting Verification</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#ef4444' }}>{awaitingVerificationCount}</div>
            </div>
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>Critical Results Today</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#dc2626' }}>{criticalResultsTodayCount}</div>
            </div>
          </div>

          {/* NEW LAB ORDER BUTTON */}
          <div style={{ marginBottom: '24px' }}>
            <button
              onClick={() => setShowNewLabOrderForm(!showNewLabOrderForm)}
              style={{
                padding: '10px 16px',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              + New Lab Order
            </button>
          </div>

          {/* NEW LAB ORDER FORM */}
          {showNewLabOrderForm && (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#111827' }}>New Lab Order</h3>
              <form onSubmit={handleCreateLabOrder}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Patient ID</label>
                    <input
                      type="text"
                      value={newLabOrder.patientId}
                      onChange={(e) => setNewLabOrder({ ...newLabOrder, patientId: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Panel</label>
                    <select
                      value={newLabOrder.panelId}
                      onChange={(e) => setNewLabOrder({ ...newLabOrder, panelId: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                      required
                    >
                      <option value="">Select panel</option>
                      {panels.map(p => (
                        <option key={p.id} value={p.id}>{p.panel_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Urgency</label>
                    <select
                      value={newLabOrder.urgency}
                      onChange={(e) => setNewLabOrder({ ...newLabOrder, urgency: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                    >
                      <option value="routine">Routine</option>
                      <option value="urgent">Urgent</option>
                      <option value="stat">Stat</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Clinical Notes</label>
                  <textarea
                    value={newLabOrder.clinicalNotes}
                    onChange={(e) => setNewLabOrder({ ...newLabOrder, clinicalNotes: e.target.value })}
                    style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box', minHeight: '80px', fontFamily: 'inherit' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
                    Create Order
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewLabOrderForm(false)}
                    style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* LAB ORDERS TABLE */}
          {labOrdersLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading orders...</div>
          ) : labOrdersError ? (
            <div style={{ padding: '16px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px' }}>{labOrdersError}</div>
          ) : (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Order #</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Patient</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Panel</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Urgency</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Ordered By</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>TAT (h)</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {labOrders.map((order, idx) => (
                    <tr key={order.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                      <td style={{ padding: '12px', color: '#111827' }}>{order.order_number}</td>
                      <td style={{ padding: '12px', color: '#111827' }}>{order.patient_name}</td>
                      <td style={{ padding: '12px', color: '#111827' }}>{order.panel_name}</td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          backgroundColor: getUrgencyColor(order.urgency),
                          color: '#fff',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '500',
                          textTransform: 'uppercase',
                        }}>
                          {order.urgency}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          backgroundColor: getStatusColor(order.status),
                          color: '#fff',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '500',
                        }}>
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#111827' }}>{order.ordered_by}</td>
                      <td style={{ padding: '12px', color: '#111827' }}>{order.tat_target_hours}</td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {order.status === 'ordered' && (
                            <button
                              onClick={() => handleCollectSpecimen(order.id)}
                              style={{
                                padding: '6px 10px',
                                backgroundColor: '#3b82f6',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Collect
                            </button>
                          )}
                          {order.status === 'collected' && (
                            <button
                              onClick={() => handleReceiveSpecimen(order.id)}
                              style={{
                                padding: '6px 10px',
                                backgroundColor: '#10b981',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Receive
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

          {labOrdersSuccess && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '6px', fontSize: '14px' }}>
              ✓ {labOrdersSuccess}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 2: LAB RESULTS ===== */}
      {activeTab === 'lab-results' && (
        <div>
          <div style={{ marginBottom: '24px' }}>
            <button
              onClick={() => setShowResultForm(!showResultForm)}
              style={{
                padding: '10px 16px',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              + Enter Results
            </button>
          </div>

          {showResultForm && (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#111827' }}>Enter Lab Results</h3>
              <form onSubmit={handleEnterResults}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Select Order</label>
                  <select
                    value={selectedOrderForResults?.id || ''}
                    onChange={(e) => {
                      const order = labOrders.find(o => o.id === e.target.value);
                      setSelectedOrderForResults(order || null);
                      setResultFormValues({});
                    }}
                    style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                  >
                    <option value="">Select an order</option>
                    {labOrders.filter(o => o.status === 'received' || o.status === 'processing').map(o => (
                      <option key={o.id} value={o.id}>{o.order_number} - {o.patient_name}</option>
                    ))}
                  </select>
                </div>

                {selectedOrderForResults && (
                  <div>
                    <div style={{ marginBottom: '16px', fontSize: '14px', color: '#6b7280' }}>
                      Panel: <strong>{selectedOrderForResults.panel_name}</strong>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Test Value (example)</label>
                        <input
                          type="text"
                          placeholder="Enter test value"
                          style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
                    Submit Results
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowResultForm(false); setSelectedOrderForResults(null); }}
                    style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {labResultsLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading results...</div>
          ) : labResultsError ? (
            <div style={{ padding: '16px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px' }}>{labResultsError}</div>
          ) : (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Order #</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Patient</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Test</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Value</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Reference Range</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Result Date</th>
                  </tr>
                </thead>
                <tbody>
                  {labResults.map((result, idx) => {
                    const low = formatNumber(result.reference_range_low);
                    const high = formatNumber(result.reference_range_high);
                    const val = formatNumber(result.value);
                    const isOutOfRange = result.is_abnormal;
                    const isCritical = result.is_critical;
                    return (
                      <tr key={result.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: isCritical ? '#fef2f2' : idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ padding: '12px', color: '#111827' }}>{result.order_number}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>—</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{result.test_name}</td>
                        <td style={{ padding: '12px', color: isCritical ? '#dc2626' : isOutOfRange ? '#ea580c' : '#111827', fontWeight: isCritical ? '700' : '400' }}>
                          {val} {result.unit}
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px' }}>
                          {low} - {high}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: isCritical ? '#dc2626' : isOutOfRange ? '#ea580c' : '#10b981',
                            color: '#fff',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '500',
                          }}>
                            {isCritical ? 'CRITICAL' : isOutOfRange ? 'ABNORMAL' : 'NORMAL'}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{formatDate(result.result_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {labResultsSuccess && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '6px', fontSize: '14px' }}>
              ✓ {labResultsSuccess}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 3: RADIOLOGY ===== */}
      {activeTab === 'radiology' && (
        <div>
          {/* MODALITY FILTERS */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {['all', 'xray', 'ct', 'mri', 'ultrasound', 'other'].map(mod => (
              <button
                key={mod}
                onClick={() => setRadiologyModality(mod as any)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: radiologyModality === mod ? '#a855f7' : '#e5e7eb',
                  color: radiologyModality === mod ? '#fff' : '#374151',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {mod === 'all' ? 'All' : mod.toUpperCase()}
              </button>
            ))}
          </div>

          {radiologyLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading radiology orders...</div>
          ) : radiologyError ? (
            <div style={{ padding: '16px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px' }}>{radiologyError}</div>
          ) : (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Order #</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Patient</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Modality</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Study</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Urgency</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Scheduled</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {radiologyOrders
                    .filter(o => radiologyModality === 'all' || o.modality === radiologyModality)
                    .map((order, idx) => (
                      <tr key={order.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ padding: '12px', color: '#111827' }}>{order.order_number}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{order.patient_name}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ display: 'inline-block', padding: '4px 8px', backgroundColor: '#e9d5ff', color: '#6b21a8', borderRadius: '4px', fontSize: '12px', fontWeight: '500', textTransform: 'uppercase' }}>
                            {order.modality}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#111827', fontSize: '13px' }}>{order.study_description}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: getStatusColor(order.status),
                            color: '#fff',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '500',
                          }}>
                            {order.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: getUrgencyColor(order.urgency),
                            color: '#fff',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '500',
                            textTransform: 'uppercase',
                          }}>
                            {order.urgency}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px' }}>{formatDate(order.scheduled_at)}</td>
                        <td style={{ padding: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {order.status === 'scheduled' && (
                            <button
                              onClick={() => { setSelectedRadiologyOrder(order); setShowScheduleModal(true); }}
                              style={{
                                padding: '6px 10px',
                                backgroundColor: '#a855f7',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Schedule
                            </button>
                          )}
                          {order.dicom_study_uid && (
                            <button
                              onClick={() => {
                                const ohifUrl = process.env.NEXT_PUBLIC_OHIF_VIEWER_URL || 'https://viewer.ohif.org';
                                const viewerUrl = `${ohifUrl}/viewer/${order.dicom_study_uid}`;
                                window.open(viewerUrl, '_blank');
                              }}
                              style={{
                                padding: '6px 10px',
                                backgroundColor: '#0891b2',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                              title="View in OHIF DICOM viewer"
                            >
                              ☐ View DICOM
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* SCHEDULE MODAL */}
          {showScheduleModal && selectedRadiologyOrder && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
              <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', maxWidth: '500px', width: '90%' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#111827' }}>Schedule Study</h3>
                <form onSubmit={handleScheduleRadiology}>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Room</label>
                    <input
                      type="text"
                      name="room"
                      placeholder="e.g., Room 101"
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                      required
                    />
                  </div>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      name="scheduled_at"
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#a855f7', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
                      Schedule
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowScheduleModal(false); setSelectedRadiologyOrder(null); }}
                      style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
                    >
                      Close
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {radiologySuccess && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '6px', fontSize: '14px' }}>
              ✓ {radiologySuccess}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 4: SPECIMENS ===== */}
      {activeTab === 'specimens' && (
        <div>
          <div style={{ marginBottom: '24px' }}>
            <input
              type="text"
              placeholder="Search by barcode or patient..."
              value={specimenSearch}
              onChange={(e) => setSpecimenSearch(e.target.value)}
              style={{ width: '100%', maxWidth: '300px', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }}
            />
          </div>

          {specimensLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading specimens...</div>
          ) : (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Barcode</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Patient</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Sample Type</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Collected By</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {specimens
                    .filter(s => specimenSearch === '' || s.barcode.toLowerCase().includes(specimenSearch.toLowerCase()) || s.patient_name.toLowerCase().includes(specimenSearch.toLowerCase()))
                    .map((spec, idx) => (
                      <tr key={spec.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ padding: '12px', color: '#111827', fontFamily: 'monospace', fontSize: '13px' }}>{spec.barcode}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{spec.patient_name}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{spec.sample_type}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: getStatusColor(spec.status),
                            color: '#fff',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '500',
                          }}>
                            {spec.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px' }}>{spec.collected_by || '—'}</td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px' }}>{spec.location}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 5: TEST PANELS ===== */}
      {activeTab === 'panels' && (
        <div>
          <div style={{ marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button
              onClick={() => setShowAddPanelForm(!showAddPanelForm)}
              style={{
                padding: '10px 16px',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              + Add Panel
            </button>
            <select
              value={panelsDeptFilter}
              onChange={(e) => setPanelsDeptFilter(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
            >
              <option value="all">All Departments</option>
              <option value="pathology">Pathology</option>
              <option value="biochemistry">Biochemistry</option>
              <option value="hematology">Hematology</option>
            </select>
          </div>

          {showAddPanelForm && (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#111827' }}>Add Test Panel</h3>
              <form onSubmit={(e) => { e.preventDefault(); /* implement */ }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Panel Code</label>
                    <input type="text" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Panel Name</label>
                    <input type="text" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Department</label>
                    <select style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }}>
                      <option>Pathology</option>
                      <option>Biochemistry</option>
                      <option>Hematology</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Sample Type</label>
                    <input type="text" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>TAT (hours)</label>
                    <input type="number" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#374151' }}>Price (₹)</label>
                    <input type="number" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' }} required />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
                    Create Panel
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddPanelForm(false)}
                    style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {panelsLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading panels...</div>
          ) : (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Code</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Name</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Department</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Sample Type</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>TAT (h)</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Price</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Components</th>
                  </tr>
                </thead>
                <tbody>
                  {panels
                    .filter(p => panelsDeptFilter === 'all' || p.department.toLowerCase() === panelsDeptFilter.toLowerCase())
                    .map((panel, idx) => (
                      <tr key={panel.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{panel.panel_code}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{panel.panel_name}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{panel.department}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{panel.sample_type}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{panel.tat_target_hours}</td>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{formatCurrency(panel.price)}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{panel.component_count} tests</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 6: ANALYTICS ===== */}
      {activeTab === 'analytics' && (
        <div>
          {analyticsLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading analytics...</div>
          ) : (
            <>
              {/* TAT PERFORMANCE */}
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#111827', marginTop: '32px' }}>TAT Performance</h3>
              <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '32px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Panel</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Target TAT (h)</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Actual Avg (h)</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}># Orders</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>% Within Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tatStats.map((stat, idx) => {
                      const percentage = stat.within_target_percent;
                      const bgColor = percentage >= 95 ? '#dcfce7' : percentage >= 80 ? '#fef3c7' : '#fee2e2';
                      const textColor = percentage >= 95 ? '#166534' : percentage >= 80 ? '#92400e' : '#991b1b';
                      return (
                        <tr key={stat.panel_name} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                          <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{stat.panel_name}</td>
                          <td style={{ padding: '12px', color: '#6b7280' }}>{stat.target_tat_hours}</td>
                          <td style={{ padding: '12px', color: '#111827' }}>{stat.actual_avg_tat_hours.toFixed(1)}</td>
                          <td style={{ padding: '12px', color: '#111827' }}>{stat.total_orders}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ display: 'inline-block', padding: '4px 8px', backgroundColor: bgColor, color: textColor, borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                              {percentage.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* CRITICAL VALUE LOG */}
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#111827', marginTop: '32px' }}>Critical Values</h3>
              <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '32px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Order #</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Patient</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Test</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Value</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Ref Range</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Flagged At</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Notified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criticalValues.map((cv, idx) => (
                      <tr key={cv.id} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#fef2f2' }}>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{cv.order_number}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{cv.patient_name}</td>
                        <td style={{ padding: '12px', color: '#111827' }}>{cv.test_name}</td>
                        <td style={{ padding: '12px', color: '#dc2626', fontWeight: '700' }}>{cv.value}</td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px' }}>{cv.reference_range}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{formatDateTime(cv.flagged_at)}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: cv.notified ? '#dcfce7' : '#fee2e2',
                            color: cv.notified ? '#166534' : '#991b1b',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '500',
                          }}>
                            {cv.notified ? '✓ Yes' : '✗ No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* LAB WORKLOAD */}
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#111827', marginTop: '32px' }}>Lab Workload</h3>
              <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '32px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Department</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Date</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Orders</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Critical</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labWorkload.map((item, idx) => (
                      <tr key={`${item.department}-${item.date}`} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ padding: '12px', color: '#111827' }}>{item.department}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{formatDate(item.date)}</td>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{item.order_count}</td>
                        <td style={{ padding: '12px', color: item.critical_count > 0 ? '#dc2626' : '#6b7280', fontWeight: item.critical_count > 0 ? '700' : '400' }}>{item.critical_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* RADIOLOGY WORKLOAD */}
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#111827', marginTop: '32px' }}>Radiology Workload</h3>
              <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '32px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Modality</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Date</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Studies</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {radiologyWorkload.map((item, idx) => (
                      <tr key={`${item.modality}-${item.date}`} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ padding: '12px', color: '#111827' }}>{item.modality}</td>
                        <td style={{ padding: '12px', color: '#6b7280' }}>{formatDate(item.date)}</td>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{item.study_count}</td>
                        <td style={{ padding: '12px', color: item.pending_count > 0 ? '#f59e0b' : '#6b7280', fontWeight: item.pending_count > 0 ? '700' : '400' }}>{item.pending_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* SPECIMEN REJECTION RATE */}
              <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#111827', marginTop: '32px' }}>Specimen Rejection Rate</h3>
              <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Sample Type</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Total</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Rejected</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Rejection Rate</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Top Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specimenRejectionStats.map((stat, idx) => {
                      const rate = stat.rejection_rate_percent;
                      const bgColor = rate < 2 ? '#dcfce7' : rate < 5 ? '#fef3c7' : '#fee2e2';
                      const textColor = rate < 2 ? '#166534' : rate < 5 ? '#92400e' : '#991b1b';
                      return (
                        <tr key={stat.sample_type} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                          <td style={{ padding: '12px', color: '#111827' }}>{stat.sample_type}</td>
                          <td style={{ padding: '12px', color: '#111827', fontWeight: '500' }}>{stat.total_specimens}</td>
                          <td style={{ padding: '12px', color: '#111827' }}>{stat.rejected_count}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ display: 'inline-block', padding: '4px 8px', backgroundColor: bgColor, color: textColor, borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                              {stat.rejection_rate_percent.toFixed(2)}%
                            </span>
                          </td>
                          <td style={{ padding: '12px', color: '#6b7280', fontSize: '13px' }}>{stat.top_rejection_reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
