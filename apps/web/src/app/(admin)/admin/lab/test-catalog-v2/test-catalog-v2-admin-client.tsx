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
type AdminTab = 'extensions' | 'rules' | 'lookup' | 'stats';

const STATUS_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: 'Draft', bg: '#f5f5f5', color: '#333' },
  pending_approval: { label: 'Pending', bg: '#fff3cd', color: '#856404' },
  approved: { label: 'Approved', bg: '#d4edda', color: '#155724' },
  archived: { label: 'Archived', bg: '#f8d7da', color: '#721c24' },
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function TestCatalogV2AdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('extensions');
  const [loading, setLoading] = useState(true);

  // Extensions tab
  const [extensions, setExtensions] = useState<any[]>([]);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedExtension, setSelectedExtension] = useState<any>(null);
  const [showExtForm, setShowExtForm] = useState(false);
  const [extForm, setExtForm] = useState<any>({
    source_type: 'in_house',
    methodology: '',
    equipment: '',
    specimen_volume: '',
    special_instructions: '',
    reporting_format: 'standard',
    turnaround_priority: 'routine_4h',
    requires_consent: false,
  });

  // Rules tab
  const [selectedComponent, setSelectedComponent] = useState<string>('');
  const [components, setComponents] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<any>({
    rule_name: '',
    age_min_years: '',
    age_max_years: '',
    gender: 'all',
    pregnancy_status: '',
    clinical_context: '',
    ref_range_low: '',
    ref_range_high: '',
    ref_range_text: '',
    unit: '',
    critical_low: '',
    critical_high: '',
    panic_low: '',
    panic_high: '',
    interpretation_guide: '',
    priority: 100,
  });

  // Lookup tab
  const [lookupComponent, setLookupComponent] = useState<string>('');
  const [lookupAge, setLookupAge] = useState<string>('');
  const [lookupGender, setLookupGender] = useState<string>('male');
  const [lookupPregnancy, setLookupPregnancy] = useState<string>('');
  const [lookupContext, setLookupContext] = useState<string>('');
  const [lookupResult, setLookupResult] = useState<any>(null);

  // Stats
  const [stats, setStats] = useState<any>(null);

  // ── Load extensions ───────────────────────────────────────────────────────
  const loadExtensions = useCallback(async () => {
    try {
      const data = await trpcQuery('testCatalogV2.listExtensions', {
        source_type: sourceTypeFilter === 'all' ? undefined : sourceTypeFilter,
        approval_status: approvalStatusFilter === 'all' ? undefined : approvalStatusFilter,
        search: searchTerm || undefined,
      });
      setExtensions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Load extensions error:', err);
    }
  }, [sourceTypeFilter, approvalStatusFilter, searchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadExtensions();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadExtensions]);

  // ── Load stats ─────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    const data = await trpcQuery('testCatalogV2.stats');
    setStats(data);
  }, []);

  // ── Load components for rules dropdown ─────────────────────────────────
  useEffect(() => {
    (async () => {
      const data = await trpcQuery('labRadiology.listComponents', { panel_id: undefined, limit: 1000 });
      setComponents(Array.isArray(data) ? data : []);
    })();
  }, []);

  // ── Load rules when component selected ──────────────────────────────────
  useEffect(() => {
    if (!selectedComponent) {
      setRules([]);
      return;
    }
    (async () => {
      const data = await trpcQuery('testCatalogV2.listRangeRules', { component_id: selectedComponent });
      setRules(Array.isArray(data) ? data : []);
    })();
  }, [selectedComponent]);

  // ── Create extension ──────────────────────────────────────────────────
  const handleCreateExtension = async () => {
    if (!selectedExtension?.panel_id && !extForm.panel_id) {
      alert('Select a panel');
      return;
    }
    try {
      await trpcMutate('testCatalogV2.createExtension', {
        panel_id: extForm.panel_id || selectedExtension?.panel_id,
        source_type: extForm.source_type,
        methodology: extForm.methodology || undefined,
        equipment: extForm.equipment || undefined,
        specimen_volume: extForm.specimen_volume || undefined,
        special_instructions: extForm.special_instructions || undefined,
        reporting_format: extForm.reporting_format,
        turnaround_priority: extForm.turnaround_priority,
        requires_consent: extForm.requires_consent,
      });
      setShowExtForm(false);
      setExtForm({
        source_type: 'in_house',
        methodology: '',
        equipment: '',
        specimen_volume: '',
        special_instructions: '',
        reporting_format: 'standard',
        turnaround_priority: 'routine_4h',
        requires_consent: false,
      });
      await loadExtensions();
    } catch (err) {
      alert('Failed to create extension: ' + (err as any).message);
    }
  };

  // ── Update extension ──────────────────────────────────────────────────
  const handleUpdateExtension = async (id: string) => {
    try {
      await trpcMutate('testCatalogV2.updateExtension', {
        id,
        source_type: extForm.source_type,
        methodology: extForm.methodology || undefined,
        equipment: extForm.equipment || undefined,
        specimen_volume: extForm.specimen_volume || undefined,
        special_instructions: extForm.special_instructions || undefined,
        reporting_format: extForm.reporting_format,
        turnaround_priority: extForm.turnaround_priority,
        requires_consent: extForm.requires_consent,
      });
      setSelectedExtension(null);
      setShowExtForm(false);
      await loadExtensions();
    } catch (err) {
      alert('Failed to update extension: ' + (err as any).message);
    }
  };

  // ── Approval actions ───────────────────────────────────────────────────
  const handleSubmitForApproval = async (id: string) => {
    try {
      await trpcMutate('testCatalogV2.submitForApproval', { id });
      await loadExtensions();
    } catch (err) {
      alert('Failed to submit: ' + (err as any).message);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await trpcMutate('testCatalogV2.approveExtension', { id });
      await loadExtensions();
    } catch (err) {
      alert('Failed to approve: ' + (err as any).message);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('Archive this extension?')) return;
    try {
      await trpcMutate('testCatalogV2.archiveExtension', { id });
      await loadExtensions();
    } catch (err) {
      alert('Failed to archive: ' + (err as any).message);
    }
  };

  // ── Create rule ───────────────────────────────────────────────────────
  const handleCreateRule = async () => {
    if (!selectedComponent) {
      alert('Select a component');
      return;
    }
    try {
      await trpcMutate('testCatalogV2.createRangeRule', {
        component_id: selectedComponent,
        rule_name: ruleForm.rule_name,
        age_min_years: ruleForm.age_min_years ? parseInt(ruleForm.age_min_years) : undefined,
        age_max_years: ruleForm.age_max_years ? parseInt(ruleForm.age_max_years) : undefined,
        gender: ruleForm.gender,
        pregnancy_status: ruleForm.pregnancy_status || undefined,
        clinical_context: ruleForm.clinical_context || undefined,
        ref_range_low: ruleForm.ref_range_low || undefined,
        ref_range_high: ruleForm.ref_range_high || undefined,
        ref_range_text: ruleForm.ref_range_text || undefined,
        unit: ruleForm.unit || undefined,
        critical_low: ruleForm.critical_low || undefined,
        critical_high: ruleForm.critical_high || undefined,
        panic_low: ruleForm.panic_low || undefined,
        panic_high: ruleForm.panic_high || undefined,
        interpretation_guide: ruleForm.interpretation_guide || undefined,
        priority: ruleForm.priority,
      });
      setShowRuleForm(false);
      setRuleForm({
        rule_name: '',
        age_min_years: '',
        age_max_years: '',
        gender: 'all',
        pregnancy_status: '',
        clinical_context: '',
        ref_range_low: '',
        ref_range_high: '',
        ref_range_text: '',
        unit: '',
        critical_low: '',
        critical_high: '',
        panic_low: '',
        panic_high: '',
        interpretation_guide: '',
        priority: 100,
      });
      const data = await trpcQuery('testCatalogV2.listRangeRules', { component_id: selectedComponent });
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      alert('Failed to create rule: ' + (err as any).message);
    }
  };

  // ── Update rule ───────────────────────────────────────────────────────
  const handleUpdateRule = async (id: string) => {
    try {
      await trpcMutate('testCatalogV2.updateRangeRule', {
        id,
        rule_name: ruleForm.rule_name,
        age_min_years: ruleForm.age_min_years ? parseInt(ruleForm.age_min_years) : undefined,
        age_max_years: ruleForm.age_max_years ? parseInt(ruleForm.age_max_years) : undefined,
        gender: ruleForm.gender,
        pregnancy_status: ruleForm.pregnancy_status || undefined,
        clinical_context: ruleForm.clinical_context || undefined,
        ref_range_low: ruleForm.ref_range_low || undefined,
        ref_range_high: ruleForm.ref_range_high || undefined,
        ref_range_text: ruleForm.ref_range_text || undefined,
        unit: ruleForm.unit || undefined,
        critical_low: ruleForm.critical_low || undefined,
        critical_high: ruleForm.critical_high || undefined,
        panic_low: ruleForm.panic_low || undefined,
        panic_high: ruleForm.panic_high || undefined,
        interpretation_guide: ruleForm.interpretation_guide || undefined,
        priority: ruleForm.priority,
      });
      setSelectedRule(null);
      setShowRuleForm(false);
      const data = await trpcQuery('testCatalogV2.listRangeRules', { component_id: selectedComponent });
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      alert('Failed to update rule: ' + (err as any).message);
    }
  };

  // ── Delete rule ────────────────────────────────────────────────────────
  const handleDeleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    try {
      await trpcMutate('testCatalogV2.deleteRangeRule', { id });
      const data = await trpcQuery('testCatalogV2.listRangeRules', { component_id: selectedComponent });
      setRules(Array.isArray(data) ? data : []);
    } catch (err) {
      alert('Failed to delete rule: ' + (err as any).message);
    }
  };

  // ── Lookup ─────────────────────────────────────────────────────────────
  const handleLookup = async () => {
    if (!lookupComponent || !lookupAge) {
      alert('Enter component and age');
      return;
    }
    try {
      const result = await trpcQuery('testCatalogV2.lookupRange', {
        component_id: lookupComponent,
        age_years: parseInt(lookupAge),
        gender: lookupGender,
        pregnancy_status: lookupPregnancy || undefined,
        clinical_context: lookupContext || undefined,
      });
      setLookupResult(result);
    } catch (err) {
      alert('Lookup failed: ' + (err as any).message);
    }
  };

  // ── Load initial data ──────────────────────────────────────────────────
  useEffect(() => {
    setLoading(false);
    loadStats();
  }, [loadStats]);

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  // ── Render Tabs ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fafafa', paddingTop: '1rem' }}>
      {/* Header */}
      <div style={{ padding: '0 2rem 2rem', borderBottom: '1px solid #ddd', backgroundColor: '#fff' }}>
        <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#666' }}>
          {breadcrumbs.map((bc, i) => (
            <span key={i}>
              {bc.href ? <a href={bc.href} style={{ color: '#0066cc', textDecoration: 'none' }}>{bc.label}</a> : bc.label}
              {i < breadcrumbs.length - 1 && ' / '}
            </span>
          ))}
        </div>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '600' }}>Test Catalog v2</h1>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '1rem', padding: '1rem 2rem', backgroundColor: '#fff', borderBottom: '1px solid #ddd' }}>
        {(['extensions', 'rules', 'lookup', 'stats'] as AdminTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              backgroundColor: activeTab === tab ? '#0066cc' : 'transparent',
              color: activeTab === tab ? '#fff' : '#333',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: activeTab === tab ? '600' : '500',
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '2rem' }}>
        {/* ── EXTENSIONS TAB ── */}
        {activeTab === 'extensions' && (
          <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' as const }}>
              <select
                value={sourceTypeFilter}
                onChange={(e) => setSourceTypeFilter(e.target.value)}
                style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="all">All Source Types</option>
                <option value="in_house">In-House</option>
                <option value="outsourced">Outsourced</option>
                <option value="either">Either</option>
              </select>
              <select
                value={approvalStatusFilter}
                onChange={(e) => setApprovalStatusFilter(e.target.value)}
                style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">Pending</option>
                <option value="approved">Approved</option>
                <option value="archived">Archived</option>
              </select>
              <input
                type="text"
                placeholder="Search panel/methodology..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', flex: 1, minWidth: '200px' }}
              />
              <button
                onClick={() => {
                  setShowExtForm(!showExtForm);
                  if (!showExtForm) setSelectedExtension(null);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {showExtForm ? 'Cancel' : 'Create'}
              </button>
            </div>

            {/* Create/Edit Form */}
            {showExtForm && (
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', marginBottom: '1.5rem', border: '1px solid #ddd' }}>
                <h3 style={{ marginTop: 0 }}>
                  {selectedExtension ? 'Edit Extension' : 'Create Extension'}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Source Type</label>
                    <select
                      value={extForm.source_type}
                      onChange={(e) => setExtForm({ ...extForm, source_type: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="in_house">In-House</option>
                      <option value="outsourced">Outsourced</option>
                      <option value="either">Either</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Methodology</label>
                    <input
                      type="text"
                      placeholder="e.g., HPLC, PCR"
                      value={extForm.methodology}
                      onChange={(e) => setExtForm({ ...extForm, methodology: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Equipment</label>
                    <input
                      type="text"
                      placeholder="e.g., Beckman Coulter DxH 800"
                      value={extForm.equipment}
                      onChange={(e) => setExtForm({ ...extForm, equipment: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Specimen Volume</label>
                    <input
                      type="text"
                      placeholder="e.g., 3ml EDTA"
                      value={extForm.specimen_volume}
                      onChange={(e) => setExtForm({ ...extForm, specimen_volume: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Special Instructions</label>
                    <textarea
                      placeholder="Fasting requirements, handling, etc."
                      value={extForm.special_instructions}
                      onChange={(e) => setExtForm({ ...extForm, special_instructions: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', minHeight: '80px' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Reporting Format</label>
                    <select
                      value={extForm.reporting_format}
                      onChange={(e) => setExtForm({ ...extForm, reporting_format: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="standard">Standard</option>
                      <option value="narrative">Narrative</option>
                      <option value="cumulative">Cumulative</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Turnaround Time</label>
                    <select
                      value={extForm.turnaround_priority}
                      onChange={(e) => setExtForm({ ...extForm, turnaround_priority: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="routine_4h">Routine (4h)</option>
                      <option value="urgent_2h">Urgent (2h)</option>
                      <option value="stat_1h">STAT (1h)</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={extForm.requires_consent}
                      onChange={(e) => setExtForm({ ...extForm, requires_consent: e.target.checked })}
                      style={{ cursor: 'pointer' }}
                    />
                    <label style={{ cursor: 'pointer', fontSize: '0.875rem' }}>Requires Consent</label>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    onClick={() => {
                      if (selectedExtension) {
                        handleUpdateExtension(selectedExtension.id);
                      } else {
                        handleCreateExtension();
                      }
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#0066cc',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {selectedExtension ? 'Update' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowExtForm(false);
                      setSelectedExtension(null);
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#666',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Extensions Table */}
            <div style={{ backgroundColor: '#fff', borderRadius: '4px', overflow: 'hidden', border: '1px solid #ddd' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Panel</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Source</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Methodology</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((ext: any, i: number) => {
                    const statusBadge = STATUS_BADGES[ext.approval_status] || STATUS_BADGES.draft;
                    return (
                      <tr
                        key={ext.id}
                        onClick={() => {
                          setSelectedExtension(ext);
                          setExtForm({
                            source_type: ext.source_type,
                            methodology: ext.methodology || '',
                            equipment: ext.equipment || '',
                            specimen_volume: ext.specimen_volume || '',
                            special_instructions: ext.special_instructions || '',
                            reporting_format: ext.reporting_format || 'standard',
                            turnaround_priority: ext.turnaround_priority || 'routine_4h',
                            requires_consent: ext.requires_consent || false,
                          });
                          setShowExtForm(true);
                        }}
                        style={{
                          borderBottom: '1px solid #eee',
                          cursor: 'pointer',
                          backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa',
                        }}
                      >
                        <td style={{ padding: '0.75rem' }}>{ext.panel_name || 'N/A'}</td>
                        <td style={{ padding: '0.75rem' }}>{ext.source_type}</td>
                        <td style={{ padding: '0.75rem' }}>{ext.methodology || '-'}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.25rem 0.75rem',
                              backgroundColor: statusBadge.bg,
                              color: statusBadge.color,
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: '500',
                            }}
                          >
                            {statusBadge.label}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {ext.approval_status === 'draft' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSubmitForApproval(ext.id);
                                }}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  backgroundColor: '#ffc107',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  color: '#000',
                                }}
                              >
                                Submit
                              </button>
                            )}
                            {ext.approval_status === 'pending_approval' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApprove(ext.id);
                                }}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  backgroundColor: '#28a745',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  color: '#fff',
                                }}
                              >
                                Approve
                              </button>
                            )}
                            {ext.approval_status !== 'archived' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleArchive(ext.id);
                                }}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.75rem',
                                  backgroundColor: '#dc3545',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer',
                                  color: '#fff',
                                }}
                              >
                                Archive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {extensions.length === 0 && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                  No extensions found
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── RANGE RULES TAB ── */}
        {activeTab === 'rules' && (
          <div>
            {/* Component selector */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
              <div style={{ flex: 1, minWidth: '250px' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Select Component</label>
                <select
                  value={selectedComponent}
                  onChange={(e) => setSelectedComponent(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                >
                  <option value="">-- Choose component --</option>
                  {components.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name || 'Unnamed'}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => {
                  setShowRuleForm(!showRuleForm);
                  if (!showRuleForm) setSelectedRule(null);
                }}
                disabled={!selectedComponent}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: selectedComponent ? '#28a745' : '#ccc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: selectedComponent ? 'pointer' : 'not-allowed',
                }}
              >
                {showRuleForm ? 'Cancel' : 'Create Rule'}
              </button>
            </div>

            {/* Rule Form */}
            {showRuleForm && selectedComponent && (
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', marginBottom: '1.5rem', border: '1px solid #ddd' }}>
                <h3 style={{ marginTop: 0 }}>{selectedRule ? 'Edit Rule' : 'Create Range Rule'}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Rule Name</label>
                    <input
                      type="text"
                      placeholder="e.g., Adult Male, Pediatric Female"
                      value={ruleForm.rule_name}
                      onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Age Min (years)</label>
                    <input
                      type="number"
                      value={ruleForm.age_min_years}
                      onChange={(e) => setRuleForm({ ...ruleForm, age_min_years: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Age Max (years)</label>
                    <input
                      type="number"
                      value={ruleForm.age_max_years}
                      onChange={(e) => setRuleForm({ ...ruleForm, age_max_years: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Gender</label>
                    <select
                      value={ruleForm.gender}
                      onChange={(e) => setRuleForm({ ...ruleForm, gender: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="all">All</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Pregnancy Status</label>
                    <select
                      value={ruleForm.pregnancy_status}
                      onChange={(e) => setRuleForm({ ...ruleForm, pregnancy_status: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="">-- None --</option>
                      <option value="not_pregnant">Not Pregnant</option>
                      <option value="trimester_1">Trimester 1</option>
                      <option value="trimester_2">Trimester 2</option>
                      <option value="trimester_3">Trimester 3</option>
                      <option value="postpartum">Postpartum</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Clinical Context</label>
                    <select
                      value={ruleForm.clinical_context}
                      onChange={(e) => setRuleForm({ ...ruleForm, clinical_context: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="">-- None --</option>
                      <option value="fasting">Fasting</option>
                      <option value="post_prandial">Post-Prandial</option>
                      <option value="exercise">Exercise</option>
                      <option value="altitude">Altitude</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Ref Range Low</label>
                    <input
                      type="text"
                      value={ruleForm.ref_range_low}
                      onChange={(e) => setRuleForm({ ...ruleForm, ref_range_low: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Ref Range High</label>
                    <input
                      type="text"
                      value={ruleForm.ref_range_high}
                      onChange={(e) => setRuleForm({ ...ruleForm, ref_range_high: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Unit</label>
                    <input
                      type="text"
                      placeholder="g/dL, mg/dL, etc."
                      value={ruleForm.unit}
                      onChange={(e) => setRuleForm({ ...ruleForm, unit: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Critical Low</label>
                    <input
                      type="text"
                      value={ruleForm.critical_low}
                      onChange={(e) => setRuleForm({ ...ruleForm, critical_low: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Critical High</label>
                    <input
                      type="text"
                      value={ruleForm.critical_high}
                      onChange={(e) => setRuleForm({ ...ruleForm, critical_high: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Priority</label>
                    <input
                      type="number"
                      value={ruleForm.priority}
                      onChange={(e) => setRuleForm({ ...ruleForm, priority: parseInt(e.target.value) || 100 })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', fontSize: '0.875rem' }}>Interpretation Guide</label>
                    <textarea
                      value={ruleForm.interpretation_guide}
                      onChange={(e) => setRuleForm({ ...ruleForm, interpretation_guide: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', minHeight: '80px' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    onClick={() => {
                      if (selectedRule) {
                        handleUpdateRule(selectedRule.id);
                      } else {
                        handleCreateRule();
                      }
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#0066cc',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {selectedRule ? 'Update' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowRuleForm(false);
                      setSelectedRule(null);
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#666',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Rules Table */}
            {selectedComponent && (
              <div style={{ backgroundColor: '#fff', borderRadius: '4px', overflow: 'hidden', border: '1px solid #ddd' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Rule Name</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Age Range</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Gender</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Ref Range</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Critical Range</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Priority</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule: any, i: number) => (
                      <tr
                        key={rule.id}
                        onClick={() => {
                          setSelectedRule(rule);
                          setRuleForm({
                            rule_name: rule.rule_name,
                            age_min_years: rule.age_min_years || '',
                            age_max_years: rule.age_max_years || '',
                            gender: rule.gender,
                            pregnancy_status: rule.pregnancy_status || '',
                            clinical_context: rule.clinical_context || '',
                            ref_range_low: rule.ref_range_low || '',
                            ref_range_high: rule.ref_range_high || '',
                            ref_range_text: rule.ref_range_text || '',
                            unit: rule.unit || '',
                            critical_low: rule.critical_low || '',
                            critical_high: rule.critical_high || '',
                            panic_low: rule.panic_low || '',
                            panic_high: rule.panic_high || '',
                            interpretation_guide: rule.interpretation_guide || '',
                            priority: rule.priority,
                          });
                          setShowRuleForm(true);
                        }}
                        style={{
                          borderBottom: '1px solid #eee',
                          cursor: 'pointer',
                          backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa',
                        }}
                      >
                        <td style={{ padding: '0.75rem' }}>{rule.rule_name}</td>
                        <td style={{ padding: '0.75rem' }}>
                          {rule.age_min_years || 0} - {rule.age_max_years || 'Any'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>{rule.gender}</td>
                        <td style={{ padding: '0.75rem' }}>
                          {rule.ref_range_text || `${rule.ref_range_low} - ${rule.ref_range_high} ${rule.unit || ''}`}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {rule.critical_low || rule.critical_high ? `${rule.critical_low} - ${rule.critical_high}` : '-'}
                        </td>
                        <td style={{ padding: '0.75rem' }}>{rule.priority}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRule(rule.id);
                            }}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.75rem',
                              backgroundColor: '#dc3545',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              color: '#fff',
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rules.length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                    No rules for this component
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── LOOKUP SIMULATOR TAB ── */}
        {activeTab === 'lookup' && (
          <div>
            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd', marginBottom: '1.5rem' }}>
              <h3 style={{ marginTop: 0 }}>Lookup Reference Range</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Component</label>
                  <select
                    value={lookupComponent}
                    onChange={(e) => setLookupComponent(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                  >
                    <option value="">-- Select component --</option>
                    {components.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name || 'Unnamed'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Age (years)</label>
                  <input
                    type="number"
                    value={lookupAge}
                    onChange={(e) => setLookupAge(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Gender</label>
                  <select
                    value={lookupGender}
                    onChange={(e) => setLookupGender(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Pregnancy Status</label>
                  <select
                    value={lookupPregnancy}
                    onChange={(e) => setLookupPregnancy(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                  >
                    <option value="">-- None --</option>
                    <option value="not_pregnant">Not Pregnant</option>
                    <option value="trimester_1">Trimester 1</option>
                    <option value="trimester_2">Trimester 2</option>
                    <option value="trimester_3">Trimester 3</option>
                    <option value="postpartum">Postpartum</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Clinical Context</label>
                  <select
                    value={lookupContext}
                    onChange={(e) => setLookupContext(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                  >
                    <option value="">-- None --</option>
                    <option value="fasting">Fasting</option>
                    <option value="post_prandial">Post-Prandial</option>
                    <option value="exercise">Exercise</option>
                    <option value="altitude">Altitude</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleLookup}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#0066cc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600',
                }}
              >
                Find Best Match
              </button>
            </div>

            {/* Lookup Result */}
            {lookupResult && (
              <div style={{ backgroundColor: '#d4edda', padding: '1.5rem', borderRadius: '4px', border: '1px solid #c3e6cb' }}>
                <h3 style={{ marginTop: 0, color: '#155724' }}>Matched Rule: {lookupResult.rule_name}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', color: '#155724' }}>
                  <div>
                    <strong>Reference Range:</strong>
                    <div>
                      {lookupResult.ref_range_text || `${lookupResult.ref_range_low} - ${lookupResult.ref_range_high}`}
                      {lookupResult.unit && ` ${lookupResult.unit}`}
                    </div>
                  </div>
                  <div>
                    <strong>Critical Values:</strong>
                    <div>
                      Low: {lookupResult.critical_low || 'N/A'} / High: {lookupResult.critical_high || 'N/A'}
                    </div>
                  </div>
                  {lookupResult.interpretation_guide && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <strong>Interpretation:</strong>
                      <div>{lookupResult.interpretation_guide}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STATS TAB ── */}
        {activeTab === 'stats' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>Total Extensions</div>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#0066cc' }}>
                  {stats?.extensions?.total || 0}
                </div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>In-House</div>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#28a745' }}>
                  {stats?.extensions?.in_house || 0}
                </div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>Outsourced</div>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#ffc107' }}>
                  {stats?.extensions?.outsourced || 0}
                </div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>Approved</div>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#155724' }}>
                  {stats?.extensions?.approved || 0}
                </div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>Pending</div>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#856404' }}>
                  {stats?.extensions?.pending_approval || 0}
                </div>
              </div>
              <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>Total Rules</div>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#0066cc' }}>
                  {stats?.rules?.total || 0}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
