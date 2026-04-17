'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type AdminTab = 'insurers' | 'mappings' | 'stats';
type InsurerType = 'insurance_company' | 'tpa' | 'government' | 'corporate' | 'trust';
type NetworkTier = 'preferred' | 'standard' | 'non_network';

interface Insurer {
  id: string;
  insurer_code: string;
  insurer_name: string;
  insurer_type: InsurerType;
  contact_person?: string;
  contact_phone?: string;
  contact_email?: string;
  address?: string;
  gst_number?: string;
  network_tier: NetworkTier;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface TpaMapping {
  id: string;
  insurer_id: string;
  tpa_id: string;
  insurer_name: string;
  tpa_name: string;
  effective_from: string;
  effective_to?: string;
  is_active: boolean;
}

interface Stats {
  total_insurers: number;
  by_type: Record<InsurerType, number>;
  by_tier: Record<NetworkTier, number>;
  active_count: number;
  inactive_count: number;
}

const INSURER_TYPE_LABELS: Record<InsurerType, { label: string; color: string; bg: string }> = {
  insurance_company: { label: 'Insurance', color: '#1565c0', bg: '#e3f2fd' },
  tpa: { label: 'TPA', color: '#7b1fa2', bg: '#f3e5f5' },
  government: { label: 'Govt', color: '#059669', bg: '#d1fae5' },
  corporate: { label: 'Corporate', color: '#d97706', bg: '#fef3c7' },
  trust: { label: 'Trust', color: '#0891b2', bg: '#cffafe' },
};

const NETWORK_TIER_LABELS: Record<NetworkTier, { label: string; color: string; bg: string }> = {
  preferred: { label: 'Preferred', color: '#059669', bg: '#d1fae5' },
  standard: { label: 'Standard', color: '#2563eb', bg: '#dbeafe' },
  non_network: { label: 'Non-Network', color: '#666', bg: '#f3f4f6' },
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function InsurersAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('insurers');
  const [loading, setLoading] = useState(true);
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [mappings, setMappings] = useState<TpaMapping[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [searchInsurer, setSearchInsurer] = useState('');
  const [filterType, setFilterType] = useState<InsurerType | ''>('');
  const [filterTier, setFilterTier] = useState<NetworkTier | ''>('');
  const [filterActive, setFilterActive] = useState<'active' | 'all'>('active');

  // Detail panel
  const [selectedInsurer, setSelectedInsurer] = useState<Insurer | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<Insurer>>({});

  // Mapping modal
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [tpaList, setTpaList] = useState<Insurer[]>([]);
  const [mappingForm, setMappingForm] = useState({
    insurer_id: '',
    tpa_id: '',
    effective_from: '',
    effective_to: '',
  });

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (activeTab === 'insurers') {
        const data = await trpcQuery('insurers.list', {
          search: searchInsurer || undefined,
          insurer_type: filterType || undefined,
          network_tier: filterTier || undefined,
          is_active: filterActive === 'active' ? 'true' : 'all',
        });
        setInsurers(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
      } else if (activeTab === 'mappings') {
        const data = await trpcQuery('insurers.listAllMappings');
        setMappings(Array.isArray(data) ? data : []);
      } else if (activeTab === 'stats') {
        const data = await trpcQuery('insurers.stats');
        setStats(data ? {
          total_insurers: data.total,
          active_count: data.active,
          inactive_count: data.inactive,
          by_type: data.byType,
          by_tier: data.byTier,
        } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchInsurer, filterType, filterTier, filterActive]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Select insurer for detail panel
  const selectInsurer = (insurer: Insurer) => {
    setSelectedInsurer(insurer);
    setEditMode(false);
    setFormData(insurer);
  };

  // Create/Update insurer
  const handleSaveInsurer = async () => {
    try {
      setError(null);

      // Validation
      if (!formData.insurer_code?.trim()) {
        setError('Insurer code is required');
        return;
      }
      if (!formData.insurer_name?.trim()) {
        setError('Insurer name is required');
        return;
      }
      if (!formData.insurer_type) {
        setError('Insurer type is required');
        return;
      }

      // Code validation: uppercase with underscores only
      if (!/^[A-Z0-9_]+$/.test(formData.insurer_code)) {
        setError('Code must be uppercase with underscores only');
        return;
      }

      if (selectedInsurer?.id) {
        // Update
        await trpcMutate('insurers.update', {
          id: selectedInsurer.id,
          insurer_name: formData.insurer_name,
          insurer_type: formData.insurer_type,
          contact_person: formData.contact_person || undefined,
          contact_phone: formData.contact_phone || undefined,
          contact_email: formData.contact_email || undefined,
          address: formData.address || undefined,
          gst_number: formData.gst_number || undefined,
          network_tier: formData.network_tier || 'standard',
          notes: formData.notes || undefined,
        });
        setSuccess('Insurer updated successfully');
      } else {
        // Create
        await trpcMutate('insurers.create', {
          insurer_code: formData.insurer_code,
          insurer_name: formData.insurer_name,
          insurer_type: formData.insurer_type,
          contact_person: formData.contact_person || undefined,
          contact_phone: formData.contact_phone || undefined,
          contact_email: formData.contact_email || undefined,
          address: formData.address || undefined,
          gst_number: formData.gst_number || undefined,
          network_tier: formData.network_tier || 'standard',
          notes: formData.notes || undefined,
        });
        setSuccess('Insurer created successfully');
        setFormData({});
      }

      setEditMode(false);
      setSelectedInsurer(null);
      await loadData();

      // Auto-dismiss success
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save insurer');
    }
  };

  // Deactivate insurer
  const handleDeactivateInsurer = async (insurer: Insurer) => {
    if (!confirm(`Deactivate ${insurer.insurer_name}?`)) return;

    try {
      setError(null);
      await trpcMutate('insurers.toggleActive', { id: insurer.id });
      setSuccess('Insurer deactivated');
      setSelectedInsurer(null);
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate insurer');
    }
  };

  // Toggle insurer active status
  const handleToggleActive = async (insurer: Insurer) => {
    try {
      setError(null);
      await trpcMutate('insurers.toggleActive', { id: insurer.id });
      setSuccess(insurer.is_active ? 'Insurer deactivated' : 'Insurer activated');
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle insurer status');
    }
  };

  // Load TPAs for mapping modal
  const openMappingModal = async () => {
    try {
      const data = await trpcQuery('insurers.listTpas');
      setTpaList(Array.isArray(data) ? data : []);
      setShowMappingModal(true);
    } catch (err) {
      setError('Failed to load TPA list');
    }
  };

  // Save mapping
  const handleSaveMapping = async () => {
    try {
      setError(null);

      if (!mappingForm.insurer_id) {
        setError('Select an insurer');
        return;
      }
      if (!mappingForm.tpa_id) {
        setError('Select a TPA');
        return;
      }
      if (!mappingForm.effective_from) {
        setError('Effective from date is required');
        return;
      }

      await trpcMutate('insurers.addTpaMapping', {
        insurer_id: mappingForm.insurer_id,
        tpa_id: mappingForm.tpa_id,
        effective_from: mappingForm.effective_from,
        effective_to: mappingForm.effective_to || undefined,
      });

      setSuccess('Mapping created successfully');
      setShowMappingModal(false);
      setMappingForm({ insurer_id: '', tpa_id: '', effective_from: '', effective_to: '' });
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping');
    }
  };

  // Remove mapping
  const handleRemoveMapping = async (mapping: TpaMapping) => {
    if (!confirm(`Remove mapping between ${mapping.insurer_name} and ${mapping.tpa_name}?`)) return;

    try {
      setError(null);
      await trpcMutate('insurers.removeTpaMapping', { id: mapping.id });
      setSuccess('Mapping removed');
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove mapping');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading && insurers.length === 0 && mappings.length === 0 && !stats) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>Loading insurers…</div>;
  }

  const filteredInsurers = insurers.filter(i =>
    (i.insurer_name.toLowerCase().includes(searchInsurer.toLowerCase()) ||
      i.insurer_code.toLowerCase().includes(searchInsurer.toLowerCase())) &&
    (!filterType || i.insurer_type === filterType) &&
    (!filterTier || i.network_tier === filterTier) &&
    (filterActive === 'all' || i.is_active)
  );

  return (
    <div style={{ fontFamily: 'system-ui', padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Success toast */}
      {success && (
        <div style={{
          position: 'fixed', top: 20, left: 20, right: 20, padding: '12px 16px',
          background: '#d1fae5', color: '#059669', borderRadius: 8, fontSize: 14, fontWeight: 600,
          zIndex: 1000, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          {success}
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div style={{
          marginBottom: 16, padding: '12px 16px', background: '#fee2e2', color: '#dc2626',
          borderRadius: 8, fontSize: 14, fontWeight: 600,
        }}>
          {error}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Insurer Master</h1>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0' }}>
            {insurers.length} insurers
          </p>
        </div>
        {activeTab === 'insurers' && (
          <button
            onClick={() => {
              setSelectedInsurer(null);
              setEditMode(true);
              setFormData({
                insurer_code: '',
                insurer_name: '',
                insurer_type: 'insurance_company',
                network_tier: 'standard',
                is_active: true,
              });
            }}
            style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            + Add Insurer
          </button>
        )}
        {activeTab === 'mappings' && (
          <button onClick={openMappingModal} style={{
            padding: '8px 20px', fontSize: 14, fontWeight: 600,
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
          }}>
            + Add Mapping
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e0e0e0' }}>
        {(['insurers', 'mappings', 'stats'] as AdminTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setSelectedInsurer(null);
              setEditMode(false);
            }}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none',
              borderBottom: activeTab === tab ? '3px solid #2563eb' : '3px solid transparent',
              background: 'transparent', color: activeTab === tab ? '#2563eb' : '#888',
              cursor: 'pointer', textTransform: 'capitalize',
            }}
          >
            {tab === 'insurers' && `Insurers (${insurers.length})`}
            {tab === 'mappings' && `TPA Mappings (${mappings.length})`}
            {tab === 'stats' && 'Stats'}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* INSURERS TAB */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'insurers' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={searchInsurer}
              onChange={e => setSearchInsurer(e.target.value)}
              placeholder="Search code or name…"
              style={{ padding: '6px 12px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6, width: 200 }}
            />
            <select
              value={filterType}
              onChange={e => setFilterType((e.target.value as InsurerType) || '')}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}
            >
              <option value="">All Types</option>
              {Object.entries(INSURER_TYPE_LABELS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select
              value={filterTier}
              onChange={e => setFilterTier((e.target.value as NetworkTier) || '')}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}
            >
              <option value="">All Tiers</option>
              {Object.entries(NETWORK_TIER_LABELS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select
              value={filterActive}
              onChange={e => setFilterActive(e.target.value as 'active' | 'all')}
              style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}
            >
              <option value="active">Active Only</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Table + Detail Panel */}
          <div style={{ display: 'grid', gridTemplateColumns: selectedInsurer && (editMode || true) ? '1fr 420px' : '1fr', gap: 16 }}>
            {/* Table */}
            <div>
              {filteredInsurers.length === 0 ? (
                <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No insurers found.</p>
              ) : (
                <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #e0e0e0' }}>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Code</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Name</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Type</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Tier</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Phone</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#333' }}>Active</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInsurers.map((insurer, idx) => (
                        <tr
                          key={insurer.id}
                          onClick={() => selectInsurer(insurer)}
                          style={{
                            background: selectedInsurer?.id === insurer.id ? '#e3f2fd' : idx % 2 === 0 ? '#f8f9fa' : '#fff',
                            borderBottom: '1px solid #e0e0e0',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={e => {
                            if (selectedInsurer?.id !== insurer.id) {
                              (e.currentTarget as HTMLElement).style.background = '#f0f0f0';
                            }
                          }}
                          onMouseLeave={e => {
                            if (selectedInsurer?.id !== insurer.id) {
                              (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#f8f9fa' : '#fff';
                            }
                          }}
                        >
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#333' }}>{insurer.insurer_code}</td>
                          <td style={{ padding: '12px 16px', color: '#333' }}>{insurer.insurer_name}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background: INSURER_TYPE_LABELS[insurer.insurer_type].bg,
                              color: INSURER_TYPE_LABELS[insurer.insurer_type].color,
                            }}>
                              {INSURER_TYPE_LABELS[insurer.insurer_type].label}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background: NETWORK_TIER_LABELS[insurer.network_tier].bg,
                              color: NETWORK_TIER_LABELS[insurer.network_tier].color,
                            }}>
                              {NETWORK_TIER_LABELS[insurer.network_tier].label}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#666' }}>{insurer.contact_phone || '—'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={insurer.is_active}
                              onChange={e => {
                                e.stopPropagation();
                                handleToggleActive(insurer);
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                selectInsurer(insurer);
                                setEditMode(true);
                              }}
                              style={{
                                marginRight: 8,
                                padding: '4px 8px',
                                fontSize: 12,
                                background: '#2563eb',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer',
                              }}
                            >
                              Edit
                            </button>
                            {insurer.insurer_type === 'insurance_company' && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  selectInsurer(insurer);
                                  openMappingModal();
                                }}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 12,
                                  background: '#059669',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                }}
                              >
                                Manage TPAs
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Detail Panel */}
            {selectedInsurer && (
              <div style={{
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                padding: 16,
                background: '#fff',
                maxHeight: '600px',
                overflowY: 'auto',
              }}>
                {editMode ? (
                  <div>
                    <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
                      {selectedInsurer.id ? 'Edit Insurer' : 'New Insurer'}
                    </h3>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Code *</label>
                      <input
                        type="text"
                        value={formData.insurer_code || ''}
                        onChange={e => setFormData({ ...formData, insurer_code: e.target.value.toUpperCase() })}
                        placeholder="e.g., HDFC_HEALTH"
                        disabled={!!selectedInsurer.id}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: 13,
                          border: '1px solid #d0d0d0',
                          borderRadius: 4,
                          boxSizing: 'border-box',
                          opacity: selectedInsurer.id ? 0.6 : 1,
                        }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Name *</label>
                      <input
                        type="text"
                        value={formData.insurer_name || ''}
                        onChange={e => setFormData({ ...formData, insurer_name: e.target.value })}
                        placeholder="e.g., HDFC ERGO Health"
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Type *</label>
                      <select
                        value={formData.insurer_type || 'insurance_company'}
                        onChange={e => setFormData({ ...formData, insurer_type: e.target.value as InsurerType })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      >
                        {Object.entries(INSURER_TYPE_LABELS).map(([key, { label }]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Network Tier</label>
                      <select
                        value={formData.network_tier || 'standard'}
                        onChange={e => setFormData({ ...formData, network_tier: e.target.value as NetworkTier })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      >
                        {Object.entries(NETWORK_TIER_LABELS).map(([key, { label }]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Contact Person</label>
                      <input
                        type="text"
                        value={formData.contact_person || ''}
                        onChange={e => setFormData({ ...formData, contact_person: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Phone</label>
                      <input
                        type="text"
                        value={formData.contact_phone || ''}
                        onChange={e => setFormData({ ...formData, contact_phone: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Email</label>
                      <input
                        type="email"
                        value={formData.contact_email || ''}
                        onChange={e => setFormData({ ...formData, contact_email: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Address</label>
                      <textarea
                        value={formData.address || ''}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box', minHeight: 60 }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>GST Number</label>
                      <input
                        type="text"
                        value={formData.gst_number || ''}
                        onChange={e => setFormData({ ...formData, gst_number: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Notes</label>
                      <textarea
                        value={formData.notes || ''}
                        onChange={e => setFormData({ ...formData, notes: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box', minHeight: 60 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={handleSaveInsurer}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          background: '#059669',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditMode(false);
                          setSelectedInsurer(null);
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          background: '#e5e7eb',
                          color: '#333',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>{selectedInsurer.insurer_name}</h3>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Code:</strong> {selectedInsurer.insurer_code}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Type:</strong>{' '}
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: INSURER_TYPE_LABELS[selectedInsurer.insurer_type].bg,
                          color: INSURER_TYPE_LABELS[selectedInsurer.insurer_type].color,
                          fontSize: 11,
                          fontWeight: 600,
                        }}>
                          {INSURER_TYPE_LABELS[selectedInsurer.insurer_type].label}
                        </span>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Tier:</strong>{' '}
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: NETWORK_TIER_LABELS[selectedInsurer.network_tier].bg,
                          color: NETWORK_TIER_LABELS[selectedInsurer.network_tier].color,
                          fontSize: 11,
                          fontWeight: 600,
                        }}>
                          {NETWORK_TIER_LABELS[selectedInsurer.network_tier].label}
                        </span>
                      </div>
                      {selectedInsurer.contact_person && (
                        <div style={{ marginBottom: 8 }}>
                          <strong>Contact:</strong> {selectedInsurer.contact_person}
                        </div>
                      )}
                      {selectedInsurer.contact_phone && (
                        <div style={{ marginBottom: 8 }}>
                          <strong>Phone:</strong> {selectedInsurer.contact_phone}
                        </div>
                      )}
                      {selectedInsurer.contact_email && (
                        <div style={{ marginBottom: 8 }}>
                          <strong>Email:</strong> {selectedInsurer.contact_email}
                        </div>
                      )}
                      {selectedInsurer.gst_number && (
                        <div style={{ marginBottom: 8 }}>
                          <strong>GST:</strong> {selectedInsurer.gst_number}
                        </div>
                      )}
                      {selectedInsurer.address && (
                        <div style={{ marginBottom: 8 }}>
                          <strong>Address:</strong> {selectedInsurer.address}
                        </div>
                      )}
                      {selectedInsurer.notes && (
                        <div style={{ marginBottom: 8 }}>
                          <strong>Notes:</strong> {selectedInsurer.notes}
                        </div>
                      )}
                      <div style={{ marginBottom: 8 }}>
                        <strong>Status:</strong> {selectedInsurer.is_active ? '✅ Active' : '❌ Inactive'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => {
                          setEditMode(true);
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          background: '#2563eb',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeactivateInsurer(selectedInsurer)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: 13,
                          fontWeight: 600,
                          background: '#dc2626',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TPA MAPPINGS TAB */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'mappings' && (
        <div>
          {mappings.length === 0 ? (
            <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No mappings found.</p>
          ) : (
            <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #e0e0e0' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Insurer</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>TPA</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Effective From</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Effective To</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#333' }}>Active</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping, idx) => (
                    <tr key={mapping.id} style={{
                      background: idx % 2 === 0 ? '#f8f9fa' : '#fff',
                      borderBottom: '1px solid #e0e0e0',
                    }}>
                      <td style={{ padding: '12px 16px', color: '#333', fontWeight: 500 }}>{mapping.insurer_name}</td>
                      <td style={{ padding: '12px 16px', color: '#333', fontWeight: 500 }}>{mapping.tpa_name}</td>
                      <td style={{ padding: '12px 16px', color: '#666' }}>{new Date(mapping.effective_from).toLocaleDateString('en-IN')}</td>
                      <td style={{ padding: '12px 16px', color: '#666' }}>{mapping.effective_to ? new Date(mapping.effective_to).toLocaleDateString('en-IN') : '—'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {mapping.is_active ? '✅' : '❌'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          onClick={() => handleRemoveMapping(mapping)}
                          style={{
                            padding: '4px 8px',
                            fontSize: 12,
                            background: '#dc2626',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STATS TAB */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'stats' && stats && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 16, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8 }}>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>Total Insurers</p>
              <p style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#333' }}>{stats.total_insurers}</p>
            </div>
            <div style={{ padding: 16, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8 }}>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>Active</p>
              <p style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#059669' }}>{stats.active_count}</p>
            </div>
            <div style={{ padding: 16, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8 }}>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>Inactive</p>
              <p style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#dc2626' }}>{stats.inactive_count}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ padding: 16, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px', color: '#333' }}>By Type</h3>
              {Object.entries(stats.by_type).map(([type, count]) => (
                <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: '#666' }}>{INSURER_TYPE_LABELS[type as InsurerType].label}</span>
                  <span style={{ fontWeight: 600, color: '#333' }}>{count}</span>
                </div>
              ))}
            </div>

            <div style={{ padding: 16, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px', color: '#333' }}>By Tier</h3>
              {Object.entries(stats.by_tier).map(([tier, count]) => (
                <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: '#666' }}>{NETWORK_TIER_LABELS[tier as NetworkTier].label}</span>
                  <span style={{ fontWeight: 600, color: '#333' }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MAPPING MODAL */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {showMappingModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999,
        }}>
          <div style={{
            background: '#fff', borderRadius: 8, padding: 24, maxWidth: 500, width: '90%',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Add TPA Mapping</h2>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Insurer *</label>
              <select
                value={mappingForm.insurer_id}
                onChange={e => setMappingForm({ ...mappingForm, insurer_id: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
              >
                <option value="">Select an insurer…</option>
                {insurers.filter(i => i.insurer_type === 'insurance_company' && i.is_active).map(i => (
                  <option key={i.id} value={i.id}>{i.insurer_name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>TPA *</label>
              <select
                value={mappingForm.tpa_id}
                onChange={e => setMappingForm({ ...mappingForm, tpa_id: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
              >
                <option value="">Select a TPA…</option>
                {tpaList.filter(t => t.is_active).map(t => (
                  <option key={t.id} value={t.id}>{t.insurer_name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Effective From *</label>
              <input
                type="date"
                value={mappingForm.effective_from}
                onChange={e => setMappingForm({ ...mappingForm, effective_from: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Effective To</label>
              <input
                type="date"
                value={mappingForm.effective_to}
                onChange={e => setMappingForm({ ...mappingForm, effective_to: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 4, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSaveMapping}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Save Mapping
              </button>
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setMappingForm({ insurer_id: '', tpa_id: '', effective_from: '', effective_to: '' });
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#e5e7eb',
                  color: '#333',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
