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
type AdminTab = 'all' | 'system' | 'department' | 'usage' | 'suggestions';

const CATEGORIES = [
  'discharge', 'operative', 'handoff', 'admission', 'assessment',
  'consent', 'nursing', 'progress', 'consultation', 'referral', 'custom',
];

const CATEGORY_ICONS: Record<string, string> = {
  discharge: '🏥', operative: '🔪', handoff: '📝', admission: '📋',
  assessment: '📊', consent: '✍️', nursing: '💉', progress: '📈',
  consultation: '🩺', referral: '📬', custom: '⚙️',
};

const SCOPE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  system: { label: '🌐 System', bg: '#e3f2fd', color: '#1565c0' },
  department: { label: '🏥 Dept', bg: '#f3e5f5', color: '#7b1fa2' },
  personal: { label: '🔒 Personal', bg: '#fff3e0', color: '#e65100' },
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function TemplatesAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('all');
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [usageStats, setUsageStats] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('discharge');
  const [newScope, setNewScope] = useState('system');
  const [creating, setCreating] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const scopeFilter = activeTab === 'system' ? 'system' : activeTab === 'department' ? 'department' : 'all';
      const [tpls, stats, suggs] = await Promise.all([
        trpcQuery('templateManagement.list', {
          scope: scopeFilter,
          category: filterCategory || undefined,
          search: search || undefined,
        }),
        trpcQuery('templateManagement.usageStats'),
        trpcQuery('templateManagement.listSuggestions', { status: 'pending' }),
      ]);
      setTemplates(Array.isArray(tpls) ? tpls : []);
      setUsageStats(Array.isArray(stats) ? stats : []);
      setSuggestions(Array.isArray(suggs) ? suggs : []);
    } catch (err) {
      console.error('Templates load error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, filterCategory, search]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Select template → load versions ───────────────────────────────────
  const selectTemplate = async (tpl: any) => {
    setSelectedTemplate(tpl);
    const v = await trpcQuery('templateManagement.listVersions', { template_id: tpl.id });
    setVersions(Array.isArray(v) ? v : []);
  };

  // ── Create template ───────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await trpcMutate('templateManagement.create', {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        category: newCategory as any,
        scope: newScope as any,
        fields: [
          { id: crypto.randomUUID(), type: 'section_header', label: 'Section 1', order: 1 },
          { id: crypto.randomUUID(), type: 'textarea', label: 'Content', required: true, placeholder: 'Enter content...', order: 2 },
        ],
      });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      await loadData();
    } catch (err) {
      alert('Failed to create template');
    } finally {
      setCreating(false);
    }
  };

  // ── Deactivate ────────────────────────────────────────────────────────
  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this template? It will no longer appear in template pickers.')) return;
    try {
      await trpcMutate('templateManagement.deactivate', { id });
      setSelectedTemplate(null);
      await loadData();
    } catch (err) { alert('Failed to deactivate'); }
  };

  // ── Review suggestion ─────────────────────────────────────────────────
  const reviewSuggestion = async (id: string, action: 'accept' | 'reject') => {
    try {
      await trpcMutate('templateManagement.reviewSuggestion', { id, action });
      await loadData();
    } catch (err) { alert('Failed to review suggestion'); }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><p>Loading templates…</p></div>;
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: '20px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>📋 Clinical Templates</h1>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0' }}>
            {templates.length} templates · {suggestions.length} pending suggestions
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          padding: '8px 20px', fontSize: 14, fontWeight: 600,
          background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
        }}>+ New Template</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e0e0e0' }}>
        {([
          { key: 'all' as AdminTab, label: `All (${templates.length})` },
          { key: 'system' as AdminTab, label: '🌐 System' },
          { key: 'department' as AdminTab, label: '🏥 Department' },
          { key: 'usage' as AdminTab, label: '📊 Usage Stats' },
          { key: 'suggestions' as AdminTab, label: `💡 Suggestions (${suggestions.length})` },
        ]).map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setLoading(true); }} style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888',
            cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Filters (for template tabs) */}
      {['all', 'system', 'department'].includes(activeTab) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search templates…"
            style={{ padding: '6px 12px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6, width: 250 }}
          />
          <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setLoading(true); }}
            style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
          </select>
        </div>
      )}

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedTemplate ? '1fr 400px' : '1fr', gap: 16 }}>

        {/* Main list */}
        <div>
          {/* ═══ TEMPLATE LIST ═══ */}
          {['all', 'system', 'department'].includes(activeTab) && (
            templates.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No templates found.</p>
            ) : (
              templates.map((tpl: any) => {
                const scope = SCOPE_BADGES[tpl.template_scope] || SCOPE_BADGES.personal;
                const isSelected = selectedTemplate?.id === tpl.id;
                return (
                  <div key={tpl.id} onClick={() => selectTemplate(tpl)} style={{
                    background: isSelected ? '#e3f2fd' : '#fff',
                    border: `1px solid ${isSelected ? '#90caf9' : '#e0e0e0'}`,
                    borderRadius: 8, padding: '12px 16px', marginBottom: 8, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 18 }}>{CATEGORY_ICONS[tpl.template_category] || '📋'}</span>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{tpl.template_name}</span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: scope.bg, color: scope.color, fontWeight: 600 }}>
                          {scope.label}
                        </span>
                        {tpl.template_is_locked && <span style={{ fontSize: 11 }}>🔒</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        {tpl.template_description || 'No description'}
                        <span style={{ color: '#999' }}> · v{tpl.template_version} · {tpl.template_usage_count} uses</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12, color: '#999' }}>
                      {tpl.template_category}
                    </div>
                  </div>
                );
              })
            )
          )}

          {/* ═══ USAGE STATS ═══ */}
          {activeTab === 'usage' && (
            usageStats.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No usage data yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>Template</th>
                    <th style={{ padding: '8px 12px' }}>Category</th>
                    <th style={{ padding: '8px 12px' }}>Uses</th>
                    <th style={{ padding: '8px 12px' }}>Unique Users</th>
                    <th style={{ padding: '8px 12px' }}>Avg Fill Time</th>
                    <th style={{ padding: '8px 12px' }}>Version</th>
                  </tr>
                </thead>
                <tbody>
                  {usageStats.map((s: any) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{s.template_name}</td>
                      <td style={{ padding: '8px 12px' }}>{CATEGORY_ICONS[s.template_category]} {s.template_category}</td>
                      <td style={{ padding: '8px 12px' }}>{s.template_usage_count}</td>
                      <td style={{ padding: '8px 12px' }}>{s.unique_users}</td>
                      <td style={{ padding: '8px 12px' }}>{s.avg_completion_seconds > 0 ? `${Math.round(s.avg_completion_seconds / 60)}m` : '—'}</td>
                      <td style={{ padding: '8px 12px' }}>v{s.template_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* ═══ AI SUGGESTIONS ═══ */}
          {activeTab === 'suggestions' && (
            suggestions.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No pending AI suggestions.</p>
            ) : (
              suggestions.map((s: any) => (
                <div key={s.id} style={{
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                  padding: '12px 16px', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        💡 {s.ctas_suggestion_type?.replace(/_/g, ' ')} — {s.template_name}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        Confidence: {Math.round((s.ctas_confidence_score || 0) * 100)}%
                        · Category: {s.template_category}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => reviewSuggestion(s.id, 'accept')} style={{
                        padding: '4px 12px', fontSize: 12, fontWeight: 600, background: '#e8f5e9',
                        color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: 6, cursor: 'pointer',
                      }}>✅ Accept</button>
                      <button onClick={() => reviewSuggestion(s.id, 'reject')} style={{
                        padding: '4px 12px', fontSize: 12, fontWeight: 600, background: '#ffebee',
                        color: '#c62828', border: '1px solid #ef9a9a', borderRadius: 6, cursor: 'pointer',
                      }}>❌ Reject</button>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* ═══ RIGHT PANEL: Template Detail ═══ */}
        {selectedTemplate && (
          <aside style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, overflow: 'auto', maxHeight: 'calc(100vh - 200px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Template Detail</h3>
              <button onClick={() => setSelectedTemplate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>

            <div style={{ fontSize: 13 }}>
              <p><strong>Name:</strong> {selectedTemplate.template_name}</p>
              <p><strong>Category:</strong> {CATEGORY_ICONS[selectedTemplate.template_category]} {selectedTemplate.template_category}</p>
              <p><strong>Scope:</strong> {SCOPE_BADGES[selectedTemplate.template_scope]?.label}</p>
              <p><strong>Version:</strong> v{selectedTemplate.template_version}</p>
              <p><strong>Uses:</strong> {selectedTemplate.template_usage_count}</p>
              <p><strong>Created by:</strong> {selectedTemplate.creator_name || 'System'}</p>
              <p><strong>Fields:</strong> {(selectedTemplate.template_fields || []).length} fields</p>
              {selectedTemplate.template_is_locked && <p style={{ color: '#e65100' }}>🔒 Locked (admin edit only)</p>}
            </div>

            {/* Fields preview */}
            <h4 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Fields</h4>
            {(selectedTemplate.template_fields || []).map((f: any, i: number) => (
              <div key={f.id || i} style={{
                padding: '6px 10px', marginBottom: 4, borderRadius: 6,
                background: f.type === 'section_header' ? '#f0f4ff' : '#fafafa',
                fontSize: 12, display: 'flex', justifyContent: 'space-between',
              }}>
                <span style={{ fontWeight: f.type === 'section_header' ? 700 : 400 }}>
                  {f.label} {f.required && <span style={{ color: '#c62828' }}>*</span>}
                </span>
                <span style={{ color: '#999' }}>{f.type}</span>
              </div>
            ))}

            {/* Version history */}
            <h4 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Version History</h4>
            {versions.length === 0 ? (
              <p style={{ fontSize: 12, color: '#999' }}>No versions</p>
            ) : (
              versions.map((v: any) => (
                <div key={v.id} style={{ padding: '6px 10px', marginBottom: 4, borderRadius: 6, background: '#fafafa', fontSize: 12 }}>
                  <strong>v{v.ctv_version_number}</strong> — {v.ctv_change_summary || 'No description'}
                  <div style={{ color: '#999' }}>{v.changed_by_name} · {new Date(v.ctv_created_at).toLocaleDateString('en-IN')}</div>
                </div>
              ))
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
              <button onClick={() => handleDeactivate(selectedTemplate.id)} style={{
                flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
                background: '#ffebee', color: '#c62828', border: '1px solid #ef9a9a',
                borderRadius: 6, cursor: 'pointer',
              }}>Deactivate</button>
            </div>
          </aside>
        )}
      </div>

      {/* ═══ CREATE MODAL ═══ */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }} onClick={() => setShowCreate(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 500, width: '90%' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>+ New Clinical Template</h3>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Name *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="e.g., Post-CABG Discharge Summary"
              style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6, marginBottom: 12 }} />

            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Description</label>
            <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Brief description of this template's purpose…"
              rows={2}
              style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6, marginBottom: 12, fontFamily: 'system-ui' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Category</label>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Scope</label>
                <select value={newScope} onChange={e => setNewScope(e.target.value)}
                  style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}>
                  <option value="system">🌐 System (all users)</option>
                  <option value="department">🏥 Department</option>
                  <option value="personal">🔒 Personal</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreate} disabled={creating || !newName.trim()} style={{
                flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600,
                background: creating || !newName.trim() ? '#ccc' : '#1565c0',
                color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
              }}>{creating ? 'Creating…' : 'Create Template'}</button>
              <button onClick={() => setShowCreate(false)} style={{
                flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600,
                background: '#e0e0e0', color: '#333', border: 'none', borderRadius: 8, cursor: 'pointer',
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
