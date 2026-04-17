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
type AdminTab = 'labs' | 'pricing' | 'orders' | 'stats';

const CONTRACT_TYPES = ['monthly', 'per_test', 'annual', 'panel_rate'];
const DISPATCH_METHODS = ['courier', 'pickup', 'digital'];
const ORDER_STATUSES = [
  'pending_dispatch', 'dispatched', 'received_by_lab', 'processing',
  'results_received', 'results_entered', 'verified', 'cancelled', 'rejected'
];

const STATUS_COLORS: Record<string, string> = {
  pending_dispatch: '#ffa500',
  dispatched: '#4169e1',
  received_by_lab: '#4169e1',
  processing: '#ffa500',
  results_received: '#ffa500',
  results_entered: '#ffa500',
  verified: '#228b22',
  cancelled: '#808080',
  rejected: '#dc143c',
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ExternalLabsAdminClient({
  userId, userRole, userName, breadcrumbs,
}: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('labs');
  const [loading, setLoading] = useState(true);

  // Labs state
  const [labs, setLabs] = useState<any[]>([]);
  const [labsTotal, setLabsTotal] = useState(0);
  const [labsPage, setLabsPage] = useState(0);
  const [labSearch, setLabSearch] = useState('');
  const [labCityFilter, setLabCityFilter] = useState('');
  const [labNablFilter, setLabNablFilter] = useState(false);
  const [selectedLab, setSelectedLab] = useState<any>(null);
  const [showLabForm, setShowLabForm] = useState(false);
  const [editingLab, setEditingLab] = useState<any>(null);

  // Pricing state
  const [pricing, setPricing] = useState<any[]>([]);
  const [pricingTotal, setPricingTotal] = useState(0);
  const [pricingPage, setPricingPage] = useState(0);
  const [selectedPricingLab, setSelectedPricingLab] = useState('');
  const [showPricingForm, setShowPricingForm] = useState(false);
  const [editingPricing, setEditingPricing] = useState<any>(null);

  // Orders state
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(0);
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [orderLabFilter, setOrderLabFilter] = useState('');
  const [orderTatBreachFilter, setOrderTatBreachFilter] = useState<boolean | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  // Stats state
  const [stats, setStats] = useState<any>(null);

  // Lab form state
  const [labForm, setLabForm] = useState({
    lab_name: '',
    lab_code: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    contact_person: '',
    contact_phone: '',
    contact_email: '',
    nabl_accredited: false,
    nabl_certificate_number: '',
    nabl_valid_until: '',
    cap_accredited: false,
    contract_type: '',
    contract_start: '',
    contract_end: '',
    default_tat_hours: 48,
    payment_terms: '',
    notes: '',
  });

  // Pricing form state
  const [pricingForm, setPricingForm] = useState({
    test_code: '',
    test_name: '',
    cost_price: '',
    patient_price: '',
    is_preferred: false,
    tat_hours: '',
    effective_from: '',
    effective_to: '',
    notes: '',
  });

  // ── Load labs ─────────────────────────────────────────────────────────
  const loadLabs = useCallback(async () => {
    try {
      const data = await trpcQuery('externalLabs.listLabs', {
        skip: labsPage * 20,
        take: 20,
        search: labSearch || undefined,
        city: labCityFilter || undefined,
        nabl_accredited: labNablFilter ? true : undefined,
      });
      setLabs(data?.data || []);
      setLabsTotal(data?.total || 0);
    } catch (err) {
      console.error('Load labs error:', err);
    }
  }, [labsPage, labSearch, labCityFilter, labNablFilter]);

  // ── Load pricing ──────────────────────────────────────────────────────
  const loadPricing = useCallback(async () => {
    if (!selectedPricingLab) return;
    try {
      const data = await trpcQuery('externalLabs.listPricing', {
        skip: pricingPage * 20,
        take: 20,
        external_lab_id: selectedPricingLab,
      });
      setPricing(data?.data || []);
      setPricingTotal(data?.total || 0);
    } catch (err) {
      console.error('Load pricing error:', err);
    }
  }, [pricingPage, selectedPricingLab]);

  // ── Load orders ───────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    try {
      const data = await trpcQuery('externalLabs.listOrders', {
        skip: ordersPage * 20,
        take: 20,
        status: orderStatusFilter || undefined,
        external_lab_id: orderLabFilter || undefined,
        tat_breach: orderTatBreachFilter,
      });
      setOrders(data?.data || []);
      setOrdersTotal(data?.total || 0);
    } catch (err) {
      console.error('Load orders error:', err);
    }
  }, [ordersPage, orderStatusFilter, orderLabFilter, orderTatBreachFilter]);

  // ── Load stats ────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('externalLabs.stats', {});
      setStats(data);
    } catch (err) {
      console.error('Load stats error:', err);
    }
  }, []);

  // ── Main load effect ──────────────────────────────────────────────────
  useEffect(() => {
    setLoading(false);
    if (activeTab === 'labs') loadLabs();
    else if (activeTab === 'pricing' && selectedPricingLab) loadPricing();
    else if (activeTab === 'orders') loadOrders();
    else if (activeTab === 'stats') loadStats();
  }, [activeTab, loadLabs, loadPricing, loadOrders, loadStats, selectedPricingLab]);

  // ── Create/update lab ─────────────────────────────────────────────────
  const handleSaveLab = async () => {
    try {
      if (editingLab) {
        await trpcMutate('externalLabs.updateLab', {
          id: editingLab.id,
          ...labForm,
          default_tat_hours: parseInt(String(labForm.default_tat_hours), 10),
        });
      } else {
        await trpcMutate('externalLabs.createLab', {
          ...labForm,
          default_tat_hours: parseInt(String(labForm.default_tat_hours), 10),
        });
      }
      setShowLabForm(false);
      setEditingLab(null);
      setLabForm({
        lab_name: '', lab_code: '', address: '', city: '', state: '', pincode: '',
        contact_person: '', contact_phone: '', contact_email: '',
        nabl_accredited: false, nabl_certificate_number: '', nabl_valid_until: '',
        cap_accredited: false, contract_type: '', contract_start: '', contract_end: '',
        default_tat_hours: 48, payment_terms: '', notes: '',
      });
      await loadLabs();
    } catch (err) {
      alert(`Error: ${(err as any).message}`);
    }
  };

  // ── Toggle lab active ─────────────────────────────────────────────────
  const handleToggleLab = async (lab: any) => {
    try {
      await trpcMutate('externalLabs.toggleActive', {
        id: lab.id,
        is_active: !lab.is_active,
      });
      await loadLabs();
    } catch (err) {
      alert(`Error: ${(err as any).message}`);
    }
  };

  // ── Edit lab ──────────────────────────────────────────────────────────
  const handleEditLab = (lab: any) => {
    setEditingLab(lab);
    setLabForm({
      lab_name: lab.lab_name,
      lab_code: lab.lab_code || '',
      address: lab.address || '',
      city: lab.city || '',
      state: lab.state || '',
      pincode: lab.pincode || '',
      contact_person: lab.contact_person || '',
      contact_phone: lab.contact_phone || '',
      contact_email: lab.contact_email || '',
      nabl_accredited: lab.nabl_accredited,
      nabl_certificate_number: lab.nabl_certificate_number || '',
      nabl_valid_until: lab.nabl_valid_until ? lab.nabl_valid_until.split('T')[0] : '',
      cap_accredited: lab.cap_accredited,
      contract_type: lab.contract_type || '',
      contract_start: lab.contract_start ? lab.contract_start.split('T')[0] : '',
      contract_end: lab.contract_end ? lab.contract_end.split('T')[0] : '',
      default_tat_hours: lab.default_tat_hours,
      payment_terms: lab.payment_terms || '',
      notes: lab.notes || '',
    });
    setShowLabForm(true);
  };

  // ── Save pricing ──────────────────────────────────────────────────────
  const handleSavePricing = async () => {
    try {
      if (!selectedPricingLab) return;
      await trpcMutate('externalLabs.setPricing', {
        id: editingPricing?.id,
        external_lab_id: selectedPricingLab,
        ...pricingForm,
        tat_hours: pricingForm.tat_hours ? parseInt(pricingForm.tat_hours, 10) : undefined,
      });
      setShowPricingForm(false);
      setEditingPricing(null);
      setPricingForm({
        test_code: '', test_name: '', cost_price: '', patient_price: '',
        is_preferred: false, tat_hours: '', effective_from: '', effective_to: '', notes: '',
      });
      await loadPricing();
    } catch (err) {
      alert(`Error: ${(err as any).message}`);
    }
  };

  // ── Edit pricing ──────────────────────────────────────────────────────
  const handleEditPricing = (p: any) => {
    setEditingPricing(p);
    setPricingForm({
      test_code: p.test_code,
      test_name: p.test_name,
      cost_price: String(p.cost_price),
      patient_price: String(p.patient_price),
      is_preferred: p.is_preferred,
      tat_hours: p.tat_hours ? String(p.tat_hours) : '',
      effective_from: p.effective_from ? p.effective_from.split('T')[0] : '',
      effective_to: p.effective_to ? p.effective_to.split('T')[0] : '',
      notes: p.notes || '',
    });
    setShowPricingForm(true);
  };

  // ── Remove pricing ────────────────────────────────────────────────────
  const handleRemovePricing = async (pricingId: string) => {
    if (!confirm('Remove this pricing entry?')) return;
    try {
      await trpcMutate('externalLabs.removePricing', { id: pricingId });
      await loadPricing();
    } catch (err) {
      alert(`Error: ${(err as any).message}`);
    }
  };

  // ── Update order status ───────────────────────────────────────────────
  const handleUpdateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      await trpcMutate('externalLabs.updateOrderStatus', {
        id: orderId,
        status: newStatus,
      });
      await loadOrders();
    } catch (err) {
      alert(`Error: ${(err as any).message}`);
    }
  };

  // ── Format currency ──────────────────────────────────────────────────
  const formatCurrency = (value: string | number | null | undefined) => {
    if (!value) return '₹0';
    const num = parseFloat(String(value));
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };

  // ── Render breadcrumbs ────────────────────────────────────────────────
  const renderBreadcrumbs = () => (
    <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
      {breadcrumbs.map((bc, i) => (
        <span key={i}>
          {bc.href ? <a href={bc.href} style={{ color: '#0066cc', textDecoration: 'none' }}>{bc.label}</a> : bc.label}
          {i < breadcrumbs.length - 1 && ' > '}
        </span>
      ))}
    </div>
  );

  // ── Render tabs ───────────────────────────────────────────────────────
  const renderTabs = () => (
    <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: '20px' }}>
      {(['labs', 'pricing', 'orders', 'stats'] as AdminTab[]).map((tab) => (
        <button
          key={tab}
          onClick={() => {
            setActiveTab(tab);
            if (tab === 'labs') setLabsPage(0);
            else if (tab === 'pricing') setPricingPage(0);
            else if (tab === 'orders') setOrdersPage(0);
          }}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: activeTab === tab ? '#0066cc' : '#f0f0f0',
            color: activeTab === tab ? 'white' : '#333',
            cursor: 'pointer',
            fontWeight: activeTab === tab ? 'bold' : 'normal',
            marginRight: '5px',
          }}
        >
          {tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      ))}
    </div>
  );

  // ── Render labs tab ───────────────────────────────────────────────────
  const renderLabsTab = () => (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by name, code, contact..."
          value={labSearch}
          onChange={(e) => { setLabSearch(e.target.value); setLabsPage(0); }}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', flex: 1, minWidth: '150px' }}
        />
        <input
          type="text"
          placeholder="Filter by city..."
          value={labCityFilter}
          onChange={(e) => { setLabCityFilter(e.target.value); setLabsPage(0); }}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', flex: 1, minWidth: '150px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <input
            type="checkbox"
            checked={labNablFilter}
            onChange={(e) => { setLabNablFilter(e.target.checked); setLabsPage(0); }}
          />
          NABL Only
        </label>
        <button
          onClick={() => {
            setEditingLab(null);
            setLabForm({
              lab_name: '', lab_code: '', address: '', city: '', state: '', pincode: '',
              contact_person: '', contact_phone: '', contact_email: '',
              nabl_accredited: false, nabl_certificate_number: '', nabl_valid_until: '',
              cap_accredited: false, contract_type: '', contract_start: '', contract_end: '',
              default_tat_hours: 48, payment_terms: '', notes: '',
            });
            setShowLabForm(true);
          }}
          style={{
            padding: '8px 16px', background: '#28a745', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
          }}
        >
          Add Lab
        </button>
      </div>

      {showLabForm && (
        <div style={{
          border: '1px solid #ddd', padding: '15px', marginBottom: '20px', borderRadius: '4px', background: '#f9f9f9',
        }}>
          <h3>{editingLab ? 'Edit Lab' : 'Add New Lab'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '10px', marginBottom: '15px' }}>
            {['lab_name', 'lab_code', 'address', 'city', 'state', 'pincode', 'contact_person', 'contact_phone', 'contact_email', 'nabl_certificate_number', 'contract_start', 'contract_end', 'default_tat_hours', 'payment_terms', 'notes'].map((field) => (
              <div key={field}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
                  {field.replace(/_/g, ' ').toUpperCase()}
                </label>
                {field === 'default_tat_hours' ? (
                  <input
                    type="number"
                    value={String(labForm[field as keyof typeof labForm] || '')}
                    onChange={(e) => setLabForm({ ...labForm, [field]: parseInt(e.target.value) || 0 } as any)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                  />
                ) : field === 'nabl_certificate_number' || field === 'contract_start' || field === 'contract_end' ? (
                  <input
                    type={field.includes('contract') ? 'date' : 'text'}
                    value={String(labForm[field as keyof typeof labForm] || '')}
                    onChange={(e) => setLabForm({ ...labForm, [field]: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                  />
                ) : field === 'notes' ? (
                  <textarea
                    value={String(labForm[field as keyof typeof labForm] || '')}
                    onChange={(e) => setLabForm({ ...labForm, [field]: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', minHeight: '80px' }}
                  />
                ) : (
                  <input
                    type="text"
                    value={String(labForm[field as keyof typeof labForm] || '')}
                    onChange={(e) => setLabForm({ ...labForm, [field]: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                  />
                )}
              </div>
            ))}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>CONTRACT TYPE</label>
              <select
                value={labForm.contract_type}
                onChange={(e) => setLabForm({ ...labForm, contract_type: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              >
                <option value="">Select...</option>
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
                <input
                  type="checkbox"
                  checked={labForm.nabl_accredited}
                  onChange={(e) => setLabForm({ ...labForm, nabl_accredited: e.target.checked })}
                />
                NABL Accredited
              </label>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
                <input
                  type="checkbox"
                  checked={labForm.cap_accredited}
                  onChange={(e) => setLabForm({ ...labForm, cap_accredited: e.target.checked })}
                />
                CAP Accredited
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleSaveLab}
              style={{
                padding: '10px 20px', background: '#0066cc', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
              }}
            >
              Save
            </button>
            <button
              onClick={() => { setShowLabForm(false); setEditingLab(null); }}
              style={{
                padding: '10px 20px', background: '#6c757d', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <table style={{
        width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px',
      }}>
        <thead>
          <tr style={{ background: '#f0f0f0', borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Name</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Code</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>City</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>NABL</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>CAP</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Contract</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>TAT (hrs)</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Active</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {labs.map((lab, i) => (
            <tr key={lab.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f9f9f9', borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '10px' }}>{lab.lab_name}</td>
              <td style={{ padding: '10px' }}>{lab.lab_code || '-'}</td>
              <td style={{ padding: '10px' }}>{lab.city || '-'}</td>
              <td style={{ padding: '10px' }}>{lab.nabl_accredited ? 'Yes' : 'No'}</td>
              <td style={{ padding: '10px' }}>{lab.cap_accredited ? 'Yes' : 'No'}</td>
              <td style={{ padding: '10px' }}>{lab.contract_type || '-'}</td>
              <td style={{ padding: '10px' }}>{lab.default_tat_hours}</td>
              <td style={{ padding: '10px' }}>
                <button
                  onClick={() => handleToggleLab(lab)}
                  style={{
                    padding: '4px 8px', background: lab.is_active ? '#28a745' : '#dc3545',
                    color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
                  }}
                >
                  {lab.is_active ? 'Active' : 'Inactive'}
                </button>
              </td>
              <td style={{ padding: '10px' }}>
                <button
                  onClick={() => handleEditLab(lab)}
                  style={{
                    padding: '4px 8px', background: '#0066cc', color: 'white',
                    border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', marginRight: '5px',
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setSelectedLab(lab)}
                  style={{
                    padding: '4px 8px', background: '#6c757d', color: 'white',
                    border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
                  }}
                >
                  Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <span style={{ fontSize: '13px', color: '#666' }}>Showing {labs.length} of {labsTotal} labs</span>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={() => setLabsPage(Math.max(0, labsPage - 1))}
            disabled={labsPage === 0}
            style={{ padding: '5px 10px', border: '1px solid #ddd', cursor: labsPage === 0 ? 'not-allowed' : 'pointer' }}
          >
            Prev
          </button>
          <span style={{ padding: '5px 10px' }}>Page {labsPage + 1}</span>
          <button
            onClick={() => setLabsPage(labsPage + 1)}
            disabled={labsPage * 20 + labs.length >= labsTotal}
            style={{ padding: '5px 10px', border: '1px solid #ddd', cursor: labsPage * 20 + labs.length >= labsTotal ? 'not-allowed' : 'pointer' }}
          >
            Next
          </button>
        </div>
      </div>

      {selectedLab && (
        <div style={{
          border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9',
        }}>
          <h3>{selectedLab.lab_name}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '13px' }}>
            <div><strong>Address:</strong> {selectedLab.address || '-'}</div>
            <div><strong>City:</strong> {selectedLab.city || '-'}</div>
            <div><strong>Contact Person:</strong> {selectedLab.contact_person || '-'}</div>
            <div><strong>Phone:</strong> {selectedLab.contact_phone || '-'}</div>
            <div><strong>Email:</strong> {selectedLab.contact_email || '-'}</div>
            <div><strong>Contract Type:</strong> {selectedLab.contract_type || '-'}</div>
            <div><strong>Contract Start:</strong> {selectedLab.contract_start ? new Date(selectedLab.contract_start).toLocaleDateString() : '-'}</div>
            <div><strong>Contract End:</strong> {selectedLab.contract_end ? new Date(selectedLab.contract_end).toLocaleDateString() : '-'}</div>
            {selectedLab.notes && <div style={{ gridColumn: '1 / -1' }}><strong>Notes:</strong> {selectedLab.notes}</div>}
          </div>
          <button
            onClick={() => setSelectedLab(null)}
            style={{
              marginTop: '10px', padding: '8px 16px', background: '#6c757d', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );

  // ── Render pricing tab ────────────────────────────────────────────────
  const renderPricingTab = () => (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <select
          value={selectedPricingLab}
          onChange={(e) => { setSelectedPricingLab(e.target.value); setPricingPage(0); }}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', flex: 1, minWidth: '150px' }}
        >
          <option value="">Select lab...</option>
          {labs.map((lab) => (
            <option key={lab.id} value={lab.id}>{lab.lab_name}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (!selectedPricingLab) {
              alert('Select a lab first');
              return;
            }
            setEditingPricing(null);
            setPricingForm({
              test_code: '', test_name: '', cost_price: '', patient_price: '',
              is_preferred: false, tat_hours: '', effective_from: '', effective_to: '', notes: '',
            });
            setShowPricingForm(true);
          }}
          style={{
            padding: '8px 16px', background: '#28a745', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
          }}
        >
          Add Pricing
        </button>
      </div>

      {showPricingForm && selectedPricingLab && (
        <div style={{
          border: '1px solid #ddd', padding: '15px', marginBottom: '20px', borderRadius: '4px', background: '#f9f9f9',
        }}>
          <h3>{editingPricing ? 'Edit Pricing' : 'Add Pricing'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '15px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>TEST CODE *</label>
              <input
                type="text"
                value={pricingForm.test_code}
                onChange={(e) => setPricingForm({ ...pricingForm, test_code: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>TEST NAME *</label>
              <input
                type="text"
                value={pricingForm.test_name}
                onChange={(e) => setPricingForm({ ...pricingForm, test_name: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>COST PRICE (₹)</label>
              <input
                type="number"
                step="0.01"
                value={pricingForm.cost_price}
                onChange={(e) => setPricingForm({ ...pricingForm, cost_price: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>PATIENT PRICE (₹)</label>
              <input
                type="number"
                step="0.01"
                value={pricingForm.patient_price}
                onChange={(e) => setPricingForm({ ...pricingForm, patient_price: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>TAT (hours)</label>
              <input
                type="number"
                value={pricingForm.tat_hours}
                onChange={(e) => setPricingForm({ ...pricingForm, tat_hours: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
                <input
                  type="checkbox"
                  checked={pricingForm.is_preferred}
                  onChange={(e) => setPricingForm({ ...pricingForm, is_preferred: e.target.checked })}
                />
                Preferred Lab
              </label>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>EFFECTIVE FROM</label>
              <input
                type="date"
                value={pricingForm.effective_from}
                onChange={(e) => setPricingForm({ ...pricingForm, effective_from: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>EFFECTIVE TO</label>
              <input
                type="date"
                value={pricingForm.effective_to}
                onChange={(e) => setPricingForm({ ...pricingForm, effective_to: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>NOTES</label>
              <textarea
                value={pricingForm.notes}
                onChange={(e) => setPricingForm({ ...pricingForm, notes: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', minHeight: '60px' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleSavePricing}
              style={{
                padding: '10px 20px', background: '#0066cc', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
              }}
            >
              Save
            </button>
            <button
              onClick={() => { setShowPricingForm(false); setEditingPricing(null); }}
              style={{
                padding: '10px 20px', background: '#6c757d', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedPricingLab && (
        <>
          <table style={{
            width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px',
          }}>
            <thead>
              <tr style={{ background: '#f0f0f0', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Test Code</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Test Name</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Cost Price</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Patient Price</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Margin</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>TAT</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Preferred</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pricing.map((p, i) => {
                const margin = parseFloat(p.patient_price) - parseFloat(p.cost_price);
                return (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f9f9f9', borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '10px' }}>{p.test_code}</td>
                    <td style={{ padding: '10px' }}>{p.test_name}</td>
                    <td style={{ padding: '10px' }}>{formatCurrency(p.cost_price)}</td>
                    <td style={{ padding: '10px' }}>{formatCurrency(p.patient_price)}</td>
                    <td style={{ padding: '10px', color: margin > 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(margin)}</td>
                    <td style={{ padding: '10px' }}>{p.tat_hours ? `${p.tat_hours}h` : '-'}</td>
                    <td style={{ padding: '10px' }}>{p.is_preferred ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '10px' }}>
                      <button
                        onClick={() => handleEditPricing(p)}
                        style={{
                          padding: '4px 8px', background: '#0066cc', color: 'white',
                          border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', marginRight: '5px',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemovePricing(p.id)}
                        style={{
                          padding: '4px 8px', background: '#dc3545', color: 'white',
                          border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#666' }}>Showing {pricing.length} of {pricingTotal} entries</span>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                onClick={() => setPricingPage(Math.max(0, pricingPage - 1))}
                disabled={pricingPage === 0}
                style={{ padding: '5px 10px', border: '1px solid #ddd', cursor: pricingPage === 0 ? 'not-allowed' : 'pointer' }}
              >
                Prev
              </button>
              <span style={{ padding: '5px 10px' }}>Page {pricingPage + 1}</span>
              <button
                onClick={() => setPricingPage(pricingPage + 1)}
                disabled={pricingPage * 20 + pricing.length >= pricingTotal}
                style={{ padding: '5px 10px', border: '1px solid #ddd', cursor: pricingPage * 20 + pricing.length >= pricingTotal ? 'not-allowed' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ── Render orders tab ─────────────────────────────────────────────────
  const renderOrdersTab = () => (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <select
          value={orderStatusFilter}
          onChange={(e) => { setOrderStatusFilter(e.target.value); setOrdersPage(0); }}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', flex: 1, minWidth: '150px' }}
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={orderLabFilter}
          onChange={(e) => { setOrderLabFilter(e.target.value); setOrdersPage(0); }}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', flex: 1, minWidth: '150px' }}
        >
          <option value="">All labs</option>
          {labs.map((lab) => (
            <option key={lab.id} value={lab.id}>{lab.lab_name}</option>
          ))}
        </select>
        <select
          value={orderTatBreachFilter === null ? '' : String(orderTatBreachFilter)}
          onChange={(e) => { setOrderTatBreachFilter(e.target.value === '' ? null : e.target.value === 'true'); setOrdersPage(0); }}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', flex: 1, minWidth: '150px' }}
        >
          <option value="">All</option>
          <option value="true">TAT Breach Only</option>
          <option value="false">No Breach</option>
        </select>
      </div>

      <table style={{
        width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px',
      }}>
        <thead>
          <tr style={{ background: '#f0f0f0', borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Order</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Status</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Dispatched</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>TAT (hrs)</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Breach</th>
            <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order, i) => {
            const lab = labs.find((l) => l.id === order.external_lab_id);
            return (
              <tr key={order.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f9f9f9', borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '10px' }}>{order.id.substring(0, 8)}...</td>
                <td style={{ padding: '10px' }}>
                  <span style={{
                    padding: '4px 8px', background: STATUS_COLORS[order.status], color: 'white',
                    borderRadius: '3px', fontSize: '11px',
                  }}>
                    {order.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td style={{ padding: '10px' }}>{order.dispatch_date ? new Date(order.dispatch_date).toLocaleDateString() : '-'}</td>
                <td style={{ padding: '10px' }}>{order.tat_actual_hours ? `${order.tat_actual_hours}h` : `${order.tat_promised_hours}h (promised)`}</td>
                <td style={{ padding: '10px', color: order.tat_breach ? '#dc3545' : '#28a745' }}>
                  {order.tat_breach ? 'YES' : 'NO'}
                </td>
                <td style={{ padding: '10px' }}>
                  <button
                    onClick={() => setSelectedOrder(order)}
                    style={{
                      padding: '4px 8px', background: '#6c757d', color: 'white',
                      border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
                    }}
                  >
                    Details
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <span style={{ fontSize: '13px', color: '#666' }}>Showing {orders.length} of {ordersTotal} orders</span>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={() => setOrdersPage(Math.max(0, ordersPage - 1))}
            disabled={ordersPage === 0}
            style={{ padding: '5px 10px', border: '1px solid #ddd', cursor: ordersPage === 0 ? 'not-allowed' : 'pointer' }}
          >
            Prev
          </button>
          <span style={{ padding: '5px 10px' }}>Page {ordersPage + 1}</span>
          <button
            onClick={() => setOrdersPage(ordersPage + 1)}
            disabled={ordersPage * 20 + orders.length >= ordersTotal}
            style={{ padding: '5px 10px', border: '1px solid #ddd', cursor: ordersPage * 20 + orders.length >= ordersTotal ? 'not-allowed' : 'pointer' }}
          >
            Next
          </button>
        </div>
      </div>

      {selectedOrder && (
        <div style={{
          border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9',
        }}>
          <h3>Order Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '13px', marginBottom: '15px' }}>
            <div><strong>Order ID:</strong> {selectedOrder.id}</div>
            <div><strong>Status:</strong> {selectedOrder.status.replace(/_/g, ' ')}</div>
            <div><strong>Dispatched:</strong> {selectedOrder.dispatch_date ? new Date(selectedOrder.dispatch_date).toLocaleDateString() : '-'}</div>
            <div><strong>TAT Promised:</strong> {selectedOrder.tat_promised_hours}h</div>
            <div><strong>TAT Actual:</strong> {selectedOrder.tat_actual_hours ? `${selectedOrder.tat_actual_hours}h` : '-'}</div>
            <div><strong>TAT Breach:</strong> {selectedOrder.tat_breach ? 'YES' : 'NO'}</div>
            {selectedOrder.notes && <div style={{ gridColumn: '1 / -1' }}><strong>Notes:</strong> {selectedOrder.notes}</div>}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', marginRight: '10px' }}>
              Update Status:
            </label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) handleUpdateOrderStatus(selectedOrder.id, e.target.value);
              }}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
            >
              <option value="">Select new status...</option>
              {ORDER_STATUSES.filter((s) => s !== selectedOrder.status).map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setSelectedOrder(null)}
            style={{
              padding: '8px 16px', background: '#6c757d', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );

  // ── Render stats tab ──────────────────────────────────────────────────
  const renderStatsTab = () => (
    <div>
      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
            <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Total Active Labs</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#0066cc' }}>{stats.total_labs}</div>
            </div>
            <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Orders This Month</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745' }}>{stats.orders_this_month}</div>
            </div>
            <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>TAT Compliance</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: stats.tat_compliance_percent >= 95 ? '#28a745' : '#ffa500' }}>
                {stats.tat_compliance_percent}%
              </div>
            </div>
            <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>TAT Breaches</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: stats.breach_count > 0 ? '#dc3545' : '#28a745' }}>
                {stats.breach_count}
              </div>
            </div>
            <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Avg Cost Per Order</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#0066cc' }}>{formatCurrency(stats.avg_cost)}</div>
            </div>
            <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Completed Orders</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#0066cc' }}>{stats.completed_orders}</div>
            </div>
          </div>

          <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px', background: '#f9f9f9' }}>
            <h3>Top Labs by Volume</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f0f0f0', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold' }}>Lab</th>
                  <th style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>Orders</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_labs && stats.top_labs.map((item: any, i: number) => {
                  const lab = labs.find((l) => l.id === item.lab_id);
                  return (
                    <tr key={item.lab_id} style={{ borderBottom: '1px solid #ddd', background: i % 2 === 0 ? '#ffffff' : '#f9f9f9' }}>
                      <td style={{ padding: '10px' }}>{lab?.lab_name || 'Unknown'}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{item.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '20px', fontSize: '14px', color: '#666' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {renderBreadcrumbs()}

      <h1 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
        External Lab Master
      </h1>

      {renderTabs()}

      {activeTab === 'labs' && renderLabsTab()}
      {activeTab === 'pricing' && renderPricingTab()}
      {activeTab === 'orders' && renderOrdersTab()}
      {activeTab === 'stats' && renderStatsTab()}
    </div>
  );
}
