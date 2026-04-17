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
type AdminTab = 'catalog' | 'usage' | 'record' | 'stats';

const CATEGORIES = [
  'orthopedic', 'cardiac', 'ophthalmic', 'dental', 'spinal',
  'vascular', 'neurological', 'ent', 'gi', 'other',
];

const CATEGORY_COLORS: Record<string, string> = {
  orthopedic: '#e3f2fd', cardiac: '#fce4ec', ophthalmic: '#f3e5f5',
  dental: '#fff3e0', spinal: '#e0f2f1', vascular: '#f1f8e9',
  neurological: '#fce4ec', ent: '#e1f5fe', gi: '#ede7f6', other: '#f5f5f5',
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Format helpers ──────────────────────────────────────────────────────────
function formatINR(value: string | number | null | undefined): string {
  if (!value) return '₹ 0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num >= 10000000) return `₹ ${(num / 10000000).toFixed(2)} Cr`;
  if (num >= 100000) return `₹ ${(num / 100000).toFixed(2)} L`;
  if (num >= 1000) return `₹ ${(num / 1000).toFixed(2)} K`;
  return `₹ ${num.toFixed(2)}`;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ImplantsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('catalog');
  const [loading, setLoading] = useState(true);
  const [implants, setImplants] = useState<any[]>([]);
  const [usageRecords, setUsageRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedImplant, setSelectedImplant] = useState<any>(null);
  const [showCreateImplant, setShowCreateImplant] = useState(false);

  // Implant create form
  const [formValues, setFormValues] = useState({
    implant_code: '',
    implant_name: '',
    category: 'orthopedic',
    sub_category: '',
    manufacturer: '',
    brand: '',
    model_number: '',
    hsn_code: '',
    gst_rate: '',
    procurement_cost: '',
    billing_price: '',
    mrp: '',
    requires_serial_tracking: true,
    shelf_life_months: '',
    storage_instructions: '',
    regulatory_approval: '',
    notes: '',
  });

  // Usage record form
  const [usageForm, setUsageForm] = useState({
    implant_id: '',
    encounter_id: '',
    patient_id: '',
    surgery_id: '',
    serial_number: '',
    batch_number: '',
    lot_number: '',
    expiry_date: '',
    quantity: '1',
    surgeon_id: '',
    surgeon_name: '',
    implant_site: '',
    implant_date: new Date().toISOString().slice(0, 16),
    removal_date: '',
    removal_reason: '',
    notes: '',
  });

  const [creating, setCreating] = useState(false);
  const [recordingUsage, setRecordingUsage] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [implantList, usageList, statsData] = await Promise.all([
        trpcQuery('implants.listMaster', {
          category: filterCategory || undefined,
          search: search || undefined,
          pageSize: 100,
        }),
        trpcQuery('implants.listUsage', { pageSize: 100 }),
        trpcQuery('implants.stats'),
      ]);
      setImplants(implantList?.items || []);
      setUsageRecords(usageList?.items || []);
      setStats(statsData || {});
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, search]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Create Implant ────────────────────────────────────────────────
  const handleCreateImplant = async () => {
    try {
      setCreating(true);
      const payload = {
        ...formValues,
        procurement_cost: formValues.procurement_cost || '0',
        billing_price: formValues.billing_price || '0',
        shelf_life_months: formValues.shelf_life_months ? parseInt(formValues.shelf_life_months) : undefined,
        gst_rate: formValues.gst_rate || undefined,
        mrp: formValues.mrp || undefined,
      };
      await trpcMutate('implants.createMaster', payload);
      alert('Implant created');
      setFormValues({
        implant_code: '', implant_name: '', category: 'orthopedic', sub_category: '',
        manufacturer: '', brand: '', model_number: '', hsn_code: '', gst_rate: '',
        procurement_cost: '', billing_price: '', mrp: '', requires_serial_tracking: true,
        shelf_life_months: '', storage_instructions: '', regulatory_approval: '', notes: '',
      });
      setShowCreateImplant(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  // ── Record Usage ──────────────────────────────────────────────────
  const handleRecordUsage = async () => {
    try {
      if (!usageForm.implant_id) { alert('Please select an implant'); return; }
      if (!usageForm.implant_date) { alert('Please select implant date'); return; }
      setRecordingUsage(true);
      const payload = {
        ...usageForm,
        quantity: parseInt(usageForm.quantity),
        encounter_id: usageForm.encounter_id || undefined,
        patient_id: usageForm.patient_id || undefined,
        surgery_id: usageForm.surgery_id || undefined,
        surgeon_id: usageForm.surgeon_id || undefined,
        expiry_date: usageForm.expiry_date || undefined,
        removal_date: usageForm.removal_date || undefined,
      };
      await trpcMutate('implants.recordUsage', payload);
      alert('Usage recorded');
      setUsageForm({
        implant_id: '', encounter_id: '', patient_id: '', surgery_id: '',
        serial_number: '', batch_number: '', lot_number: '', expiry_date: '',
        quantity: '1', surgeon_id: '', surgeon_name: '', implant_site: '',
        implant_date: new Date().toISOString().slice(0, 16),
        removal_date: '', removal_reason: '', notes: '',
      });
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRecordingUsage(false);
    }
  };

  // ── Toggle Active ─────────────────────────────────────────────────
  const handleToggleActive = async (id: string) => {
    try {
      await trpcMutate('implants.toggleActive', { id });
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const styles = {
    container: { padding: '20px', fontFamily: 'system-ui, sans-serif', backgroundColor: '#fafafa', minHeight: '100vh' },
    header: { marginBottom: '30px' },
    title: { fontSize: '28px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' },
    breadcrumb: { fontSize: '13px', color: '#666', marginBottom: '20px' },
    tabs: { display: 'flex', gap: '2px', marginBottom: '24px', borderBottom: '1px solid #e0e0e0' },
    tab: (active: boolean) => ({
      padding: '12px 20px',
      fontSize: '14px',
      fontWeight: active ? 600 : 500,
      color: active ? '#1565c0' : '#666',
      backgroundColor: active ? '#e3f2fd' : 'transparent',
      border: 'none',
      cursor: 'pointer',
      borderBottom: active ? '3px solid #1565c0' : 'none',
      transition: 'all 0.2s',
    }),
    section: { backgroundColor: '#fff', padding: '20px', borderRadius: '8px', marginBottom: '20px' },
    sectionTitle: { fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: '#1a1a1a' },
    filterBar: { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const, alignItems: 'center' },
    input: { padding: '8px 12px', fontSize: '13px', border: '1px solid #d0d0d0', borderRadius: '4px', fontFamily: 'inherit' },
    select: { padding: '8px 12px', fontSize: '13px', border: '1px solid #d0d0d0', borderRadius: '4px', fontFamily: 'inherit', cursor: 'pointer' },
    button: { padding: '8px 16px', fontSize: '13px', fontWeight: 600, backgroundColor: '#1565c0', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
    buttonSecondary: { padding: '8px 16px', fontSize: '13px', fontWeight: 600, backgroundColor: '#f0f0f0', color: '#333', border: '1px solid #d0d0d0', borderRadius: '4px', cursor: 'pointer' },
    table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
    thead: { backgroundColor: '#f5f5f5', borderBottom: '2px solid #e0e0e0' },
    th: { padding: '12px', textAlign: 'left' as const, fontWeight: 600, color: '#333' },
    td: { padding: '12px', borderBottom: '1px solid #e0e0e0' },
    rowEven: { backgroundColor: '#fafafa' },
    rowOdd: { backgroundColor: '#fff' },
    badge: (bg: string, color: string) => ({ display: 'inline-block', padding: '4px 8px', backgroundColor: bg, color, borderRadius: '3px', fontSize: '12px', fontWeight: 500 }),
    form: { display: 'grid', gap: '16px', marginTop: '16px' },
    formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
    label: { fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '4px', display: 'block' },
    detailPanel: { backgroundColor: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '16px', marginBottom: '16px' },
    statCard: { backgroundColor: '#f5f5f5', border: '1px solid #e0e0e0', padding: '16px', borderRadius: '6px', marginBottom: '12px' },
    statValue: { fontSize: '20px', fontWeight: 700, color: '#1565c0', marginTop: '4px' },
    statLabel: { fontSize: '12px', color: '#666', marginTop: '2px' },
  };

  if (loading) {
    return (
      <div style={styles.container as any}>
        <div style={styles.header as any}>
          <div style={styles.title}>Implant Billing</div>
        </div>
        <div style={styles.section as any}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container as any}>
      {/* Header */}
      <div style={styles.header as any}>
        <div style={styles.breadcrumb as any}>
          {breadcrumbs.map((b, i) => (
            <span key={i}>
              {b.href ? <a href={b.href} style={{ color: '#1565c0', textDecoration: 'none' }}>{b.label}</a> : b.label}
              {i < breadcrumbs.length - 1 && ' / '}
            </span>
          ))}
        </div>
        <div style={styles.title}>Implant Billing</div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs as any}>
        {(['catalog', 'usage', 'record', 'stats'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={styles.tab(activeTab === tab) as any}
          >
            {tab === 'catalog' && 'Catalog'}
            {tab === 'usage' && 'Usage Records'}
            {tab === 'record' && 'Record Usage'}
            {tab === 'stats' && 'Analytics'}
          </button>
        ))}
      </div>

      {/* TAB 1: IMPLANT CATALOG */}
      {activeTab === 'catalog' && (
        <>
          <div style={styles.section as any}>
            <div style={styles.sectionTitle}>Implant Catalog</div>
            <div style={styles.filterBar as any}>
              <input
                type="text"
                placeholder="Search by name, code, manufacturer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...styles.input, flex: 1 } as any}
              />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                style={styles.select as any}
              >
                <option value="">All Categories</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <button onClick={() => setShowCreateImplant(true)} style={styles.button as any}>
                + Add Implant
              </button>
            </div>

            {/* Create Implant Form */}
            {showCreateImplant && (
              <div style={styles.detailPanel as any}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Add New Implant</div>
                <div style={styles.form as any}>
                  <div style={styles.formRow as any}>
                    <div>
                      <label style={styles.label as any}>Implant Name *</label>
                      <input
                        type="text"
                        value={formValues.implant_name}
                        onChange={(e) => setFormValues({ ...formValues, implant_name: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                    <div>
                      <label style={styles.label as any}>Code</label>
                      <input
                        type="text"
                        value={formValues.implant_code}
                        onChange={(e) => setFormValues({ ...formValues, implant_code: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                  </div>
                  <div style={styles.formRow as any}>
                    <div>
                      <label style={styles.label as any}>Category *</label>
                      <select
                        value={formValues.category}
                        onChange={(e) => setFormValues({ ...formValues, category: e.target.value })}
                        style={styles.select as any}
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={styles.label as any}>Sub Category</label>
                      <input
                        type="text"
                        value={formValues.sub_category}
                        onChange={(e) => setFormValues({ ...formValues, sub_category: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                  </div>
                  <div style={styles.formRow as any}>
                    <div>
                      <label style={styles.label as any}>Manufacturer</label>
                      <input
                        type="text"
                        value={formValues.manufacturer}
                        onChange={(e) => setFormValues({ ...formValues, manufacturer: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                    <div>
                      <label style={styles.label as any}>Brand</label>
                      <input
                        type="text"
                        value={formValues.brand}
                        onChange={(e) => setFormValues({ ...formValues, brand: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                  </div>
                  <div style={styles.formRow as any}>
                    <div>
                      <label style={styles.label as any}>Procurement Cost ₹ *</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formValues.procurement_cost}
                        onChange={(e) => setFormValues({ ...formValues, procurement_cost: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                    <div>
                      <label style={styles.label as any}>Billing Price ₹ *</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formValues.billing_price}
                        onChange={(e) => setFormValues({ ...formValues, billing_price: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                  </div>
                  <div style={styles.formRow as any}>
                    <div>
                      <label style={styles.label as any}>GST Rate %</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formValues.gst_rate}
                        onChange={(e) => setFormValues({ ...formValues, gst_rate: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                    <div>
                      <label style={styles.label as any}>MRP ₹</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formValues.mrp}
                        onChange={(e) => setFormValues({ ...formValues, mrp: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                  </div>
                  <div style={styles.formRow as any}>
                    <div>
                      <label style={styles.label as any}>HSN Code</label>
                      <input
                        type="text"
                        value={formValues.hsn_code}
                        onChange={(e) => setFormValues({ ...formValues, hsn_code: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                    <div>
                      <label style={styles.label as any}>Shelf Life (months)</label>
                      <input
                        type="number"
                        value={formValues.shelf_life_months}
                        onChange={(e) => setFormValues({ ...formValues, shelf_life_months: e.target.value })}
                        style={styles.input as any}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={styles.label as any}>Storage Instructions</label>
                    <input
                      type="text"
                      value={formValues.storage_instructions}
                      onChange={(e) => setFormValues({ ...formValues, storage_instructions: e.target.value })}
                      style={styles.input as any}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleCreateImplant} disabled={creating} style={styles.button as any}>
                      {creating ? 'Creating...' : 'Create'}
                    </button>
                    <button onClick={() => setShowCreateImplant(false)} style={styles.buttonSecondary as any}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Implants Table */}
            <table style={styles.table as any}>
              <thead style={styles.thead as any}>
                <tr>
                  <th style={styles.th as any}>Name</th>
                  <th style={styles.th as any}>Code</th>
                  <th style={styles.th as any}>Category</th>
                  <th style={styles.th as any}>Manufacturer</th>
                  <th style={styles.th as any}>Cost</th>
                  <th style={styles.th as any}>Billing</th>
                  <th style={styles.th as any}>Active</th>
                  <th style={styles.th as any}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {implants.map((imp, idx) => (
                  <tr key={imp.id} style={idx % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                    <td style={styles.td as any}>
                      <button
                        onClick={() => setSelectedImplant(imp)}
                        style={{ background: 'none', border: 'none', color: '#1565c0', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}
                      >
                        {imp.implant_name}
                      </button>
                    </td>
                    <td style={styles.td as any}>{imp.implant_code || '—'}</td>
                    <td style={styles.td as any}>
                      <span style={styles.badge(CATEGORY_COLORS[imp.category] || '#f5f5f5', '#333') as any}>
                        {imp.category}
                      </span>
                    </td>
                    <td style={styles.td as any}>{imp.manufacturer || '—'}</td>
                    <td style={styles.td as any}>{formatINR(imp.procurement_cost)}</td>
                    <td style={styles.td as any}>{formatINR(imp.billing_price)}</td>
                    <td style={styles.td as any}>
                      <button
                        onClick={() => handleToggleActive(imp.id)}
                        style={{
                          ...styles.badge(imp.is_active ? '#c8e6c9' : '#ffcccc', imp.is_active ? '#2e7d32' : '#c62828'),
                          cursor: 'pointer',
                          border: 'none',
                        } as any}
                      >
                        {imp.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={styles.td as any}>
                      <button
                        onClick={() => setSelectedImplant(imp)}
                        style={{ ...styles.buttonSecondary, padding: '4px 8px' } as any}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Detail Panel */}
            {selectedImplant && (
              <div style={styles.detailPanel as any}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{selectedImplant.implant_name}</div>
                  <button onClick={() => setSelectedImplant(null)} style={styles.buttonSecondary as any}>
                    Close
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px' }}>
                  <div><strong>Code:</strong> {selectedImplant.implant_code || '—'}</div>
                  <div><strong>Category:</strong> {selectedImplant.category}</div>
                  <div><strong>Manufacturer:</strong> {selectedImplant.manufacturer || '—'}</div>
                  <div><strong>Brand:</strong> {selectedImplant.brand || '—'}</div>
                  <div><strong>Cost:</strong> {formatINR(selectedImplant.procurement_cost)}</div>
                  <div><strong>Billing:</strong> {formatINR(selectedImplant.billing_price)}</div>
                  <div><strong>GST:</strong> {selectedImplant.gst_rate ? `${selectedImplant.gst_rate}%` : '—'}</div>
                  <div><strong>MRP:</strong> {formatINR(selectedImplant.mrp)}</div>
                  <div><strong>Serial Tracking:</strong> {selectedImplant.requires_serial_tracking ? 'Yes' : 'No'}</div>
                  <div><strong>Shelf Life:</strong> {selectedImplant.shelf_life_months ? `${selectedImplant.shelf_life_months} months` : '—'}</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* TAB 2: USAGE RECORDS */}
      {activeTab === 'usage' && (
        <div style={styles.section as any}>
          <div style={styles.sectionTitle}>Implant Usage Records</div>
          <table style={styles.table as any}>
            <thead style={styles.thead as any}>
              <tr>
                <th style={styles.th as any}>Implant</th>
                <th style={styles.th as any}>Patient ID</th>
                <th style={styles.th as any}>Surgery ID</th>
                <th style={styles.th as any}>Serial #</th>
                <th style={styles.th as any}>Qty</th>
                <th style={styles.th as any}>Billing Amt</th>
                <th style={styles.th as any}>Surgeon</th>
                <th style={styles.th as any}>Date</th>
              </tr>
            </thead>
            <tbody>
              {usageRecords.map((rec, idx) => (
                <tr key={rec.id} style={idx % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                  <td style={styles.td as any}>{implants.find(i => i.id === rec.implant_id)?.implant_name || '—'}</td>
                  <td style={styles.td as any}>{rec.patient_id ? rec.patient_id.slice(0, 8) : '—'}</td>
                  <td style={styles.td as any}>{rec.surgery_id ? rec.surgery_id.slice(0, 8) : '—'}</td>
                  <td style={styles.td as any}>{rec.serial_number || '—'}</td>
                  <td style={styles.td as any}>{rec.quantity}</td>
                  <td style={styles.td as any}>{formatINR(rec.billing_amount)}</td>
                  <td style={styles.td as any}>{rec.surgeon_name || '—'}</td>
                  <td style={styles.td as any}>{formatDate(rec.implant_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: RECORD USAGE */}
      {activeTab === 'record' && (
        <div style={styles.section as any}>
          <div style={styles.sectionTitle}>Record Implant Usage</div>
          <div style={styles.form as any}>
            <div style={styles.formRow as any}>
              <div>
                <label style={styles.label as any}>Implant *</label>
                <select
                  value={usageForm.implant_id}
                  onChange={(e) => setUsageForm({ ...usageForm, implant_id: e.target.value })}
                  style={styles.select as any}
                >
                  <option value="">Select Implant</option>
                  {implants.filter(i => i.is_active).map((imp) => (
                    <option key={imp.id} value={imp.id}>
                      {imp.implant_name} - {formatINR(imp.billing_price)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={styles.label as any}>Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={usageForm.quantity}
                  onChange={(e) => setUsageForm({ ...usageForm, quantity: e.target.value })}
                  style={styles.input as any}
                />
              </div>
            </div>

            {usageForm.implant_id && (
              <div style={{ padding: '12px', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '13px' }}>
                <strong>Estimated Billing Amount:</strong> {formatINR(
                  (parseFloat(implants.find(i => i.id === usageForm.implant_id)?.billing_price || '0') * parseInt(usageForm.quantity)).toFixed(2)
                )}
              </div>
            )}

            <div style={styles.formRow as any}>
              <div>
                <label style={styles.label as any}>Encounter ID</label>
                <input
                  type="text"
                  value={usageForm.encounter_id}
                  onChange={(e) => setUsageForm({ ...usageForm, encounter_id: e.target.value })}
                  placeholder="UUID"
                  style={styles.input as any}
                />
              </div>
              <div>
                <label style={styles.label as any}>Patient ID</label>
                <input
                  type="text"
                  value={usageForm.patient_id}
                  onChange={(e) => setUsageForm({ ...usageForm, patient_id: e.target.value })}
                  placeholder="UUID"
                  style={styles.input as any}
                />
              </div>
            </div>

            <div style={styles.formRow as any}>
              <div>
                <label style={styles.label as any}>Surgery ID</label>
                <input
                  type="text"
                  value={usageForm.surgery_id}
                  onChange={(e) => setUsageForm({ ...usageForm, surgery_id: e.target.value })}
                  placeholder="UUID"
                  style={styles.input as any}
                />
              </div>
              <div>
                <label style={styles.label as any}>Serial Number</label>
                <input
                  type="text"
                  value={usageForm.serial_number}
                  onChange={(e) => setUsageForm({ ...usageForm, serial_number: e.target.value })}
                  style={styles.input as any}
                />
              </div>
            </div>

            <div style={styles.formRow as any}>
              <div>
                <label style={styles.label as any}>Batch Number</label>
                <input
                  type="text"
                  value={usageForm.batch_number}
                  onChange={(e) => setUsageForm({ ...usageForm, batch_number: e.target.value })}
                  style={styles.input as any}
                />
              </div>
              <div>
                <label style={styles.label as any}>Expiry Date</label>
                <input
                  type="date"
                  value={usageForm.expiry_date}
                  onChange={(e) => setUsageForm({ ...usageForm, expiry_date: e.target.value })}
                  style={styles.input as any}
                />
              </div>
            </div>

            <div style={styles.formRow as any}>
              <div>
                <label style={styles.label as any}>Surgeon Name</label>
                <input
                  type="text"
                  value={usageForm.surgeon_name}
                  onChange={(e) => setUsageForm({ ...usageForm, surgeon_name: e.target.value })}
                  style={styles.input as any}
                />
              </div>
              <div>
                <label style={styles.label as any}>Implant Site</label>
                <input
                  type="text"
                  value={usageForm.implant_site}
                  onChange={(e) => setUsageForm({ ...usageForm, implant_site: e.target.value })}
                  placeholder="e.g. left knee"
                  style={styles.input as any}
                />
              </div>
            </div>

            <div style={styles.formRow as any}>
              <div>
                <label style={styles.label as any}>Implant Date & Time *</label>
                <input
                  type="datetime-local"
                  value={usageForm.implant_date}
                  onChange={(e) => setUsageForm({ ...usageForm, implant_date: e.target.value })}
                  style={styles.input as any}
                />
              </div>
              <div>
                <label style={styles.label as any}>Removal Date (if applicable)</label>
                <input
                  type="datetime-local"
                  value={usageForm.removal_date}
                  onChange={(e) => setUsageForm({ ...usageForm, removal_date: e.target.value })}
                  style={styles.input as any}
                />
              </div>
            </div>

            <div>
              <label style={styles.label as any}>Notes</label>
              <input
                type="text"
                value={usageForm.notes}
                onChange={(e) => setUsageForm({ ...usageForm, notes: e.target.value })}
                style={styles.input as any}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleRecordUsage} disabled={recordingUsage} style={styles.button as any}>
                {recordingUsage ? 'Recording...' : 'Record Usage'}
              </button>
              <button onClick={() => setUsageForm({
                implant_id: '', encounter_id: '', patient_id: '', surgery_id: '',
                serial_number: '', batch_number: '', lot_number: '', expiry_date: '',
                quantity: '1', surgeon_id: '', surgeon_name: '', implant_site: '',
                implant_date: new Date().toISOString().slice(0, 16),
                removal_date: '', removal_reason: '', notes: '',
              })} style={styles.buttonSecondary as any}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ANALYTICS */}
      {activeTab === 'stats' && (
        <div style={styles.section as any}>
          <div style={styles.sectionTitle}>Implant Analytics</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={styles.statCard as any}>
              <div style={styles.statLabel as any}>Total Implants in Catalog</div>
              <div style={styles.statValue as any}>{stats?.totalImplants || 0}</div>
            </div>
            <div style={styles.statCard as any}>
              <div style={styles.statLabel as any}>Catalog Value</div>
              <div style={styles.statValue as any}>{formatINR(stats?.catalogValue)}</div>
            </div>
            <div style={styles.statCard as any}>
              <div style={styles.statLabel as any}>Billed This Month</div>
              <div style={styles.statValue as any}>{formatINR(stats?.billedThisMonth)}</div>
            </div>
          </div>

          <div style={{ ...styles.section, marginBottom: '20px' } as any}>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>By Category</div>
            <div style={{ display: 'grid', gap: '8px' }}>
              {stats?.byCategory?.map((cat: any) => (
                <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{cat.category}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>{cat.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...styles.section, marginBottom: '0' } as any}>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Top Implants (Last 90 days)</div>
            <table style={styles.table as any}>
              <thead style={styles.thead as any}>
                <tr>
                  <th style={styles.th as any}>Implant</th>
                  <th style={styles.th as any}>Category</th>
                  <th style={styles.th as any}>Times Used</th>
                  <th style={styles.th as any}>Total Billed</th>
                </tr>
              </thead>
              <tbody>
                {stats?.topUsage?.map((imp: any, idx: number) => (
                  <tr key={idx} style={idx % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                    <td style={styles.td as any}>{imp.implant_name || '—'}</td>
                    <td style={styles.td as any}>{imp.category || '—'}</td>
                    <td style={styles.td as any}>{imp.usage_count}</td>
                    <td style={styles.td as any}>{formatINR(imp.total_billed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
