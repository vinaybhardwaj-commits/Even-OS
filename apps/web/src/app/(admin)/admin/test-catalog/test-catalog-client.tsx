'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// tRPC fetch helpers
// ============================================================
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  return json.result?.data;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Mutation failed');
  return json.result?.data;
}

// ============================================================
// Types
// ============================================================
type TabType = 'catalog' | 'accession' | 'import' | 'history';

interface Panel {
  id: string;
  panel_code: string;
  panel_name: string;
  department: string | null;
  sample_type: string | null;
  loinc_code: string | null;
  tat_minutes: number | null;
  is_active: boolean;
  components: Component[];
}

interface Component {
  id: string;
  test_code: string;
  test_name: string;
  loinc_code: string | null;
  unit: string | null;
  reference_range_low: string | null;
  reference_range_high: string | null;
  reference_range_text: string | null;
  critical_low: string | null;
  critical_high: string | null;
  data_type: string | null;
  sort_order: number | null;
  is_active: boolean;
  age_gender_ranges: AgeGenderRange[];
}

interface AgeGenderRange {
  id: string;
  age_min_years: number;
  age_max_years: number;
  gender: string;
  ref_range_low: string | null;
  ref_range_high: string | null;
  ref_range_text: string | null;
  critical_low: string | null;
  critical_high: string | null;
}

interface AccessionConfig {
  id: string;
  config_name: string;
  department: string | null;
  prefix: string;
  prefix_type: string;
  date_format: string;
  sequence_digits: number;
  separator: string;
  current_date_key: string | null;
  current_sequence: number;
}

interface VersionEntry {
  id: string;
  panel_id: string | null;
  component_id: string | null;
  change_type: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_by: string;
  reason: string | null;
  created_at: string;
}

interface CatalogStats {
  panels: number;
  components: number;
  with_critical_ranges: number;
  age_gender_rules: number;
  accession_configs: number;
  recent_changes_7d: number;
}

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  name: string;
}

// ============================================================
// Main Client Component
// ============================================================
export default function TestCatalogClient({ user }: { user: User }) {
  const [tab, setTab] = useState<TabType>('catalog');
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('testCatalog.catalogStats', { hospital_id: user.hospital_id });
      setStats(data);
    } catch { /* ignore */ }
  }, [user.hospital_id]);

  useEffect(() => {
    loadStats().finally(() => setLoading(false));
  }, [loadStats]);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'catalog', label: 'Test Catalog' },
    { key: 'accession', label: 'Accession Config' },
    { key: 'import', label: 'Bulk Import' },
    { key: 'history', label: 'Change History' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Test Catalog &amp; Accession</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0' }}>
              Manage lab test definitions, reference ranges, and accession number formats
            </p>
          </div>
          <a href="/dashboard" style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}>
            ← Dashboard
          </a>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', padding: '16px 24px' }}>
          {[
            { label: 'Panels', value: stats.panels, color: '#3b82f6' },
            { label: 'Tests', value: stats.components, color: '#10b981' },
            { label: 'Critical Ranges', value: stats.with_critical_ranges, color: '#ef4444' },
            { label: 'Age/Gender Rules', value: stats.age_gender_rules, color: '#f59e0b' },
            { label: 'Accession Configs', value: stats.accession_configs, color: '#8b5cf6' },
            { label: 'Changes (7d)', value: stats.recent_changes_7d, color: '#06b6d4' },
          ].map((s) => (
            <div key={s.label} style={{
              background: '#1e293b', borderRadius: '8px', padding: '12px 16px',
              borderLeft: `3px solid ${s.color}`,
            }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>{s.label}</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #334155', padding: '0 24px' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              background: 'transparent', border: 'none',
              color: tab === t.key ? '#60a5fa' : '#94a3b8',
              borderBottom: tab === t.key ? '2px solid #60a5fa' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: '24px' }}>
        {tab === 'catalog' && <CatalogTab user={user} onUpdate={loadStats} />}
        {tab === 'accession' && <AccessionTab user={user} onUpdate={loadStats} />}
        {tab === 'import' && <ImportTab user={user} onUpdate={loadStats} />}
        {tab === 'history' && <HistoryTab user={user} />}
      </div>
    </div>
  );
}

// ============================================================
// CATALOG TAB — Browse panels and components
// ============================================================
function CatalogTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPanel, setExpandedPanel] = useState<string | null>(null);
  const [editingComponent, setEditingComponent] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState('');
  const [search, setSearch] = useState('');

  // Add component form
  const [showAddForm, setShowAddForm] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    test_code: '', test_name: '', unit: '', loinc_code: '',
    reference_range_low: '', reference_range_high: '', reference_range_text: '',
    critical_low: '', critical_high: '', data_type: 'numeric',
  });

  // Edit form
  const [editForm, setEditForm] = useState({
    unit: '', reference_range_low: '', reference_range_high: '',
    critical_low: '', critical_high: '', reason: '',
  });

  const loadPanels = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = { hospital_id: user.hospital_id };
      if (deptFilter) input.department = deptFilter;
      const data = await trpcQuery('testCatalog.getAll', input);
      setPanels(data?.panels ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, deptFilter]);

  useEffect(() => { loadPanels(); }, [loadPanels]);

  const handleAddComponent = async (panelId: string) => {
    try {
      await trpcMutate('testCatalog.create', {
        hospital_id: user.hospital_id,
        panel_id: panelId,
        ...addForm,
      });
      setShowAddForm(null);
      setAddForm({ test_code: '', test_name: '', unit: '', loinc_code: '', reference_range_low: '', reference_range_high: '', reference_range_text: '', critical_low: '', critical_high: '', data_type: 'numeric' });
      loadPanels();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add component');
    }
  };

  const handleUpdateComponent = async (componentId: string) => {
    try {
      const input: Record<string, unknown> = { component_id: componentId };
      if (editForm.unit) input.unit = editForm.unit;
      if (editForm.reference_range_low) input.reference_range_low = editForm.reference_range_low;
      if (editForm.reference_range_high) input.reference_range_high = editForm.reference_range_high;
      if (editForm.critical_low) input.critical_low = editForm.critical_low;
      if (editForm.critical_high) input.critical_high = editForm.critical_high;
      if (editForm.reason) input.reason = editForm.reason;

      await trpcMutate('testCatalog.update', input);
      setEditingComponent(null);
      loadPanels();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDeactivate = async (componentId: string) => {
    if (!confirm('Deactivate this test component?')) return;
    try {
      await trpcMutate('testCatalog.deactivate', { component_id: componentId });
      loadPanels();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate');
    }
  };

  // Filter panels by search
  const filtered = panels.filter((p) => {
    if (!search) return true;
    const s = search.toLowerCase();
    if (p.panel_name.toLowerCase().includes(s) || p.panel_code.toLowerCase().includes(s)) return true;
    return p.components.some((c) => c.test_name.toLowerCase().includes(s) || c.test_code.toLowerCase().includes(s));
  });

  const departments = [...new Set(panels.map((p) => p.department).filter(Boolean))];

  if (loading) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading catalog...</div>;

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search tests or panels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: '6px',
            background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px',
          }}
        />
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: '6px',
            background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px',
          }}
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d!}>{d}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>
          No panels found. Create panels via the Lab &amp; Radiology module first.
        </div>
      ) : (
        filtered.map((panel) => (
          <div key={panel.id} style={{
            background: '#1e293b', borderRadius: '8px', marginBottom: '12px',
            border: '1px solid #334155', overflow: 'hidden',
          }}>
            {/* Panel Header */}
            <div
              onClick={() => setExpandedPanel(expandedPanel === panel.id ? null : panel.id)}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{panel.panel_name}</span>
                <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '12px' }}>
                  {panel.panel_code}
                </span>
                {panel.department && (
                  <span style={{
                    background: '#334155', padding: '2px 8px', borderRadius: '10px',
                    fontSize: '11px', marginLeft: '12px', color: '#94a3b8',
                  }}>
                    {panel.department}
                  </span>
                )}
                <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '12px' }}>
                  {panel.components.length} test{panel.components.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {panel.sample_type && (
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {panel.sample_type}
                  </span>
                )}
                {panel.tat_minutes && (
                  <span style={{ fontSize: '11px', color: '#f59e0b' }}>
                    TAT: {panel.tat_minutes}min
                  </span>
                )}
                <span style={{ color: '#64748b', fontSize: '16px' }}>
                  {expandedPanel === panel.id ? '▼' : '▶'}
                </span>
              </div>
            </div>

            {/* Expanded: Components */}
            {expandedPanel === panel.id && (
              <div style={{ borderTop: '1px solid #334155' }}>
                {/* Component Table Header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '100px 1fr 60px 100px 100px 100px 100px 80px',
                  padding: '8px 20px', fontSize: '11px', color: '#64748b',
                  textTransform: 'uppercase', fontWeight: 600, background: '#0f172a',
                }}>
                  <div>Code</div>
                  <div>Test Name</div>
                  <div>Unit</div>
                  <div>Ref Low</div>
                  <div>Ref High</div>
                  <div>Crit Low</div>
                  <div>Crit High</div>
                  <div>Actions</div>
                </div>

                {panel.components.map((comp) => (
                  <div key={comp.id}>
                    {editingComponent === comp.id ? (
                      /* Edit Row */
                      <div style={{
                        padding: '12px 20px', background: '#1a2332', borderBottom: '1px solid #334155',
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                          <input placeholder="Unit" value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} style={inputStyle} />
                          <input placeholder="Ref Low" value={editForm.reference_range_low} onChange={(e) => setEditForm({ ...editForm, reference_range_low: e.target.value })} style={inputStyle} />
                          <input placeholder="Ref High" value={editForm.reference_range_high} onChange={(e) => setEditForm({ ...editForm, reference_range_high: e.target.value })} style={inputStyle} />
                          <input placeholder="Reason for change" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} style={inputStyle} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
                          <input placeholder="Critical Low" value={editForm.critical_low} onChange={(e) => setEditForm({ ...editForm, critical_low: e.target.value })} style={inputStyle} />
                          <input placeholder="Critical High" value={editForm.critical_high} onChange={(e) => setEditForm({ ...editForm, critical_high: e.target.value })} style={inputStyle} />
                          <button onClick={() => handleUpdateComponent(comp.id)} style={{ ...btnStyle, background: '#10b981' }}>Save</button>
                          <button onClick={() => setEditingComponent(null)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      /* Display Row */
                      <div style={{
                        display: 'grid', gridTemplateColumns: '100px 1fr 60px 100px 100px 100px 100px 80px',
                        padding: '10px 20px', fontSize: '13px', borderBottom: '1px solid #1e293b',
                        alignItems: 'center',
                      }}>
                        <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#60a5fa' }}>{comp.test_code}</div>
                        <div>{comp.test_name}</div>
                        <div style={{ color: '#94a3b8' }}>{comp.unit ?? '—'}</div>
                        <div style={{ color: '#10b981' }}>{comp.reference_range_low ?? '—'}</div>
                        <div style={{ color: '#10b981' }}>{comp.reference_range_high ?? '—'}</div>
                        <div style={{ color: comp.critical_low ? '#ef4444' : '#64748b' }}>
                          {comp.critical_low ?? '—'}
                        </div>
                        <div style={{ color: comp.critical_high ? '#ef4444' : '#64748b' }}>
                          {comp.critical_high ?? '—'}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            onClick={() => {
                              setEditingComponent(comp.id);
                              setEditForm({
                                unit: comp.unit ?? '',
                                reference_range_low: comp.reference_range_low ?? '',
                                reference_range_high: comp.reference_range_high ?? '',
                                critical_low: comp.critical_low ?? '',
                                critical_high: comp.critical_high ?? '',
                                reason: '',
                              });
                            }}
                            style={{ ...smallBtnStyle, background: '#3b82f6' }}
                          >
                            Edit
                          </button>
                          <button onClick={() => handleDeactivate(comp.id)} style={{ ...smallBtnStyle, background: '#ef4444' }}>
                            Del
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Age/Gender Ranges (if any) */}
                    {comp.age_gender_ranges.length > 0 && expandedPanel === panel.id && (
                      <div style={{ padding: '4px 20px 8px 120px', background: '#0f172a' }}>
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Age/Gender-Specific Ranges:</div>
                        {comp.age_gender_ranges.map((r) => (
                          <div key={r.id} style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#94a3b8', padding: '2px 0' }}>
                            <span style={{ color: '#f59e0b' }}>
                              {r.gender === 'all' ? 'All' : r.gender === 'male' ? 'M' : 'F'} {r.age_min_years}-{r.age_max_years === 999 ? '∞' : r.age_max_years}y
                            </span>
                            <span>Ref: {r.ref_range_low ?? '—'} – {r.ref_range_high ?? '—'}</span>
                            {(r.critical_low || r.critical_high) && (
                              <span style={{ color: '#ef4444' }}>
                                Crit: {r.critical_low ?? '—'} – {r.critical_high ?? '—'}
                              </span>
                            )}
                            {r.ref_range_text && <span>{r.ref_range_text}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Component Button / Form */}
                {showAddForm === panel.id ? (
                  <div style={{ padding: '12px 20px', background: '#1a2332', borderTop: '1px solid #334155' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#60a5fa' }}>Add New Test</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <input placeholder="Test Code" value={addForm.test_code} onChange={(e) => setAddForm({ ...addForm, test_code: e.target.value })} style={inputStyle} />
                      <input placeholder="Test Name" value={addForm.test_name} onChange={(e) => setAddForm({ ...addForm, test_name: e.target.value })} style={inputStyle} />
                      <input placeholder="Unit" value={addForm.unit} onChange={(e) => setAddForm({ ...addForm, unit: e.target.value })} style={inputStyle} />
                      <input placeholder="LOINC Code" value={addForm.loinc_code} onChange={(e) => setAddForm({ ...addForm, loinc_code: e.target.value })} style={inputStyle} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <input placeholder="Ref Low" value={addForm.reference_range_low} onChange={(e) => setAddForm({ ...addForm, reference_range_low: e.target.value })} style={inputStyle} />
                      <input placeholder="Ref High" value={addForm.reference_range_high} onChange={(e) => setAddForm({ ...addForm, reference_range_high: e.target.value })} style={inputStyle} />
                      <input placeholder="Critical Low" value={addForm.critical_low} onChange={(e) => setAddForm({ ...addForm, critical_low: e.target.value })} style={inputStyle} />
                      <input placeholder="Critical High" value={addForm.critical_high} onChange={(e) => setAddForm({ ...addForm, critical_high: e.target.value })} style={inputStyle} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleAddComponent(panel.id)} style={{ ...btnStyle, background: '#10b981' }}>Add Test</button>
                      <button onClick={() => setShowAddForm(null)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '8px 20px', borderTop: '1px solid #334155' }}>
                    <button
                      onClick={() => setShowAddForm(panel.id)}
                      style={{ ...btnStyle, background: '#1e40af', fontSize: '12px' }}
                    >
                      + Add Test Component
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================
// ACCESSION TAB — Manage accession number configurations
// ============================================================
function AccessionTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [configs, setConfigs] = useState<AccessionConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    config_name: '', department: '', prefix: '',
    prefix_type: 'department' as string,
    date_format: 'YYYYMMDD', sequence_digits: 4, separator: '-',
  });
  const [previewNumber, setPreviewNumber] = useState('');

  const loadConfigs = useCallback(async () => {
    try {
      const data = await trpcQuery('testCatalog.listAccessionConfigs', { hospital_id: user.hospital_id });
      setConfigs(data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  // Preview accession number format
  useEffect(() => {
    if (!form.prefix) { setPreviewNumber(''); return; }
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const yy = yyyy.slice(-2);
    let dateKey = '';
    switch (form.date_format) {
      case 'YYYYMMDD': dateKey = `${yyyy}${mm}${dd}`; break;
      case 'YYMMDD': dateKey = `${yy}${mm}${dd}`; break;
      case 'YYMM': dateKey = `${yy}${mm}`; break;
      default: dateKey = `${yyyy}${mm}${dd}`;
    }
    const seq = '1'.padStart(form.sequence_digits, '0');
    setPreviewNumber(`${form.prefix}${form.separator}${dateKey}${form.separator}${seq}`);
  }, [form.prefix, form.date_format, form.sequence_digits, form.separator]);

  const handleCreate = async () => {
    try {
      await trpcMutate('testCatalog.createAccessionConfig', {
        hospital_id: user.hospital_id,
        config_name: form.config_name,
        department: form.department || undefined,
        prefix: form.prefix,
        prefix_type: form.prefix_type,
        date_format: form.date_format,
        sequence_digits: form.sequence_digits,
        separator: form.separator,
      });
      setShowAdd(false);
      setForm({ config_name: '', department: '', prefix: '', prefix_type: 'department', date_format: 'YYYYMMDD', sequence_digits: 4, separator: '-' });
      loadConfigs();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleGenerate = async (configId: string) => {
    try {
      const result = await trpcMutate('testCatalog.generateAccession', { config_id: configId });
      alert(`Generated: ${result.accession_number}`);
      loadConfigs();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Accession Number Configurations</h2>
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...btnStyle, background: '#1e40af' }}>
          {showAdd ? 'Cancel' : '+ New Config'}
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <input placeholder="Config Name (e.g., Hematology)" value={form.config_name} onChange={(e) => setForm({ ...form, config_name: e.target.value })} style={inputStyle} />
            <input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} style={inputStyle} />
            <input placeholder="Prefix (e.g., HEM)" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <select value={form.prefix_type} onChange={(e) => setForm({ ...form, prefix_type: e.target.value })} style={inputStyle}>
              <option value="department">Department</option>
              <option value="panel">Panel</option>
              <option value="specimen_type">Specimen Type</option>
              <option value="custom">Custom</option>
            </select>
            <select value={form.date_format} onChange={(e) => setForm({ ...form, date_format: e.target.value })} style={inputStyle}>
              <option value="YYYYMMDD">YYYYMMDD</option>
              <option value="YYMMDD">YYMMDD</option>
              <option value="YYMM">YYMM</option>
            </select>
            <select value={form.sequence_digits} onChange={(e) => setForm({ ...form, sequence_digits: Number(e.target.value) })} style={inputStyle}>
              <option value={3}>3 digits</option>
              <option value={4}>4 digits</option>
              <option value={5}>5 digits</option>
              <option value={6}>6 digits</option>
            </select>
            <input placeholder="Separator" value={form.separator} onChange={(e) => setForm({ ...form, separator: e.target.value })} style={inputStyle} />
          </div>
          {previewNumber && (
            <div style={{ marginBottom: '12px', padding: '8px 12px', background: '#0f172a', borderRadius: '6px', fontFamily: 'monospace', fontSize: '16px', color: '#10b981' }}>
              Preview: {previewNumber}
            </div>
          )}
          <button onClick={handleCreate} style={{ ...btnStyle, background: '#10b981' }}>Create Config</button>
        </div>
      )}

      {/* Config List */}
      {configs.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>
          No accession configs yet. Create one to start generating accession numbers.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {configs.map((cfg) => (
            <div key={cfg.id} style={{
              background: '#1e293b', borderRadius: '8px', padding: '16px',
              border: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{cfg.config_name}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  Format: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>
                    {cfg.prefix}{cfg.separator}{cfg.date_format}{cfg.separator}{'0'.repeat(cfg.sequence_digits)}
                  </span>
                  {cfg.department && <span style={{ marginLeft: '12px' }}>Dept: {cfg.department}</span>}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                  Current: {cfg.current_date_key ?? 'Not started'} #{cfg.current_sequence}
                </div>
              </div>
              <button onClick={() => handleGenerate(cfg.id)} style={{ ...btnStyle, background: '#8b5cf6' }}>
                Generate Next
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// IMPORT TAB — Bulk CSV import
// ============================================================
function ImportTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [selectedPanel, setSelectedPanel] = useState('');
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[]; total: number } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    trpcQuery('testCatalog.getAll', { hospital_id: user.hospital_id }).then((data) => {
      setPanels(data?.panels ?? []);
    });
  }, [user.hospital_id]);

  const handleImport = async () => {
    if (!selectedPanel || !csvText.trim()) {
      alert('Select a panel and paste CSV data');
      return;
    }

    setImporting(true);
    try {
      // Parse CSV
      const lines = csvText.trim().split('\n');
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const rows = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        const row: Record<string, string> = {};
        header.forEach((h, idx) => { row[h] = values[idx] ?? ''; });

        rows.push({
          test_code: row['test_code'] || row['code'] || '',
          test_name: row['test_name'] || row['name'] || '',
          loinc_code: row['loinc_code'] || row['loinc'] || undefined,
          unit: row['unit'] || undefined,
          reference_range_low: row['ref_low'] || row['reference_range_low'] || undefined,
          reference_range_high: row['ref_high'] || row['reference_range_high'] || undefined,
          reference_range_text: row['ref_text'] || row['reference_range_text'] || undefined,
          critical_low: row['critical_low'] || row['crit_low'] || undefined,
          critical_high: row['critical_high'] || row['crit_high'] || undefined,
          data_type: row['data_type'] || 'numeric',
        });
      }

      const data = await trpcMutate('testCatalog.bulkImport', {
        hospital_id: user.hospital_id,
        panel_id: selectedPanel,
        rows,
      });
      setResult(data);
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    }
    setImporting(false);
  };

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Bulk CSV Import</h2>

      <div style={{ background: '#1e293b', borderRadius: '8px', padding: '16px', border: '1px solid #334155', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px' }}>
          CSV format: test_code, test_name, unit, ref_low, ref_high, critical_low, critical_high, loinc_code, data_type
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Target Panel</label>
          <select value={selectedPanel} onChange={(e) => setSelectedPanel(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
            <option value="">Select panel...</option>
            {panels.map((p) => (
              <option key={p.id} value={p.id}>{p.panel_name} ({p.panel_code})</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>CSV Data</label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={'test_code,test_name,unit,ref_low,ref_high,critical_low,critical_high\nHB,Hemoglobin,g/dL,12.0,17.5,7.0,20.0\nWBC,White Blood Cells,/cumm,4000,11000,2000,30000'}
            rows={10}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: '6px',
              background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
              fontSize: '12px', fontFamily: 'monospace', resize: 'vertical',
            }}
          />
        </div>

        <button
          onClick={handleImport}
          disabled={importing}
          style={{ ...btnStyle, background: importing ? '#475569' : '#10b981' }}
        >
          {importing ? 'Importing...' : 'Import CSV'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div style={{
          background: '#1e293b', borderRadius: '8px', padding: '16px', border: '1px solid #334155',
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Import Results</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div style={{ padding: '8px', background: '#0f172a', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>{result.created}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Created</div>
            </div>
            <div style={{ padding: '8px', background: '#0f172a', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#3b82f6' }}>{result.updated}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Updated</div>
            </div>
            <div style={{ padding: '8px', background: '#0f172a', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>{result.errors.length}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Errors</div>
            </div>
            <div style={{ padding: '8px', background: '#0f172a', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#94a3b8' }}>{result.total}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Total Rows</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div style={{ background: '#0f172a', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}>
              {result.errors.map((e, i) => (
                <div key={i} style={{ color: '#ef4444', padding: '2px 0' }}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// HISTORY TAB — Change audit trail
// ============================================================
function HistoryTab({ user }: { user: User }) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [selectedPanel, setSelectedPanel] = useState('');

  useEffect(() => {
    trpcQuery('testCatalog.getAll', { hospital_id: user.hospital_id, active_only: false }).then((data) => {
      setPanels(data?.panels ?? []);
    });
  }, [user.hospital_id]);

  useEffect(() => {
    if (!selectedPanel) { setVersions([]); setLoading(false); return; }
    setLoading(true);
    trpcQuery('testCatalog.getVersionHistory', { panel_id: selectedPanel, limit: 50 })
      .then((data) => setVersions(data ?? []))
      .finally(() => setLoading(false));
  }, [selectedPanel]);

  const changeTypeColors: Record<string, string> = {
    created: '#10b981',
    range_updated: '#3b82f6',
    critical_range_updated: '#ef4444',
    deactivated: '#64748b',
    reactivated: '#f59e0b',
    unit_changed: '#8b5cf6',
    loinc_updated: '#06b6d4',
    specimen_changed: '#d946ef',
    method_changed: '#f97316',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Version History</h2>
        <select value={selectedPanel} onChange={(e) => setSelectedPanel(e.target.value)} style={{ ...inputStyle, minWidth: '250px' }}>
          <option value="">Select panel to view history...</option>
          {panels.map((p) => <option key={p.id} value={p.id}>{p.panel_name}</option>)}
        </select>
      </div>

      {!selectedPanel && (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>
          Select a panel to view its change history.
        </div>
      )}

      {loading && selectedPanel && (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading...</div>
      )}

      {!loading && selectedPanel && versions.length === 0 && (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>No changes recorded for this panel.</div>
      )}

      {versions.map((v) => (
        <div key={v.id} style={{
          background: '#1e293b', borderRadius: '8px', padding: '12px 16px',
          marginBottom: '8px', border: '1px solid #334155',
          borderLeft: `3px solid ${changeTypeColors[v.change_type] ?? '#64748b'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{
                fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                background: changeTypeColors[v.change_type] ?? '#64748b', color: '#fff',
              }}>
                {v.change_type.replace(/_/g, ' ')}
              </span>
              {v.reason && <span style={{ fontSize: '12px', color: '#94a3b8' }}>{v.reason}</span>}
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {new Date(v.created_at).toLocaleString()}
            </span>
          </div>
          {(v.previous_values || v.new_values) && (
            <div style={{ display: 'flex', gap: '24px', marginTop: '8px', fontSize: '12px' }}>
              {v.previous_values && (
                <div>
                  <span style={{ color: '#64748b' }}>Before: </span>
                  <span style={{ color: '#ef4444', fontFamily: 'monospace' }}>
                    {Object.entries(v.previous_values).filter(([, val]) => val != null).map(([k, val]) => `${k}=${val}`).join(', ')}
                  </span>
                </div>
              )}
              {v.new_values && (
                <div>
                  <span style={{ color: '#64748b' }}>After: </span>
                  <span style={{ color: '#10b981', fontFamily: 'monospace' }}>
                    {Object.entries(v.new_values).filter(([, val]) => val != null).map(([k, val]) => `${k}=${val}`).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Shared Styles
// ============================================================
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: '4px',
  background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: '6px', border: 'none',
  color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: '4px', border: 'none',
  color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
};
