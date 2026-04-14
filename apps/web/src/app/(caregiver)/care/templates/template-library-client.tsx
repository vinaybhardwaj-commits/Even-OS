'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/caregiver';

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: input }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

const CATEGORY_ICONS: Record<string, string> = {
  discharge: '🏥', operative: '🔪', handoff: '📝', admission: '📋',
  assessment: '📊', consent: '✍️', nursing: '💉', progress: '📈',
  consultation: '🩺', referral: '📬', custom: '⚙️',
};

const SCOPE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  system: { label: '🌐 System', bg: '#e3f2fd', color: '#1565c0' },
  department: { label: '🏥 Dept', bg: '#f3e5f5', color: '#7b1fa2' },
  personal: { label: '🔒 Mine', bg: '#fff3e0', color: '#e65100' },
};

type LibTab = 'my' | 'department' | 'system' | 'all';

interface Props { userId: string; userRole: string; userName: string; }

export default function TemplateLibraryClient({ userId, userRole, userName }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LibTab>('all');
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const scope = activeTab === 'my' ? 'personal' : activeTab === 'all' ? 'all' : activeTab;
      const data = await trpcQuery('templateManagement.list', {
        scope,
        category: filterCat || undefined,
        search: search || undefined,
      });
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [activeTab, search, filterCat]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFork = async (tpl: any) => {
    try {
      const result = await trpcMutate('templateManagement.fork', { id: tpl.id });
      if (result?.id) {
        alert('Template forked to your personal library!');
        setActiveTab('my');
      }
    } catch { alert('Failed to fork'); }
  };

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>📋 Template Library</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>{templates.length} templates available</p>
        </div>
        <button onClick={() => router.push('/care/templates/builder')} style={{
          padding: '8px 20px', fontSize: 14, fontWeight: 600, background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
        }}>+ New Template</button>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        {([
          { key: 'all' as LibTab, label: 'All Templates' },
          { key: 'my' as LibTab, label: '🔒 My Templates' },
          { key: 'department' as LibTab, label: '🏥 Department' },
          { key: 'system' as LibTab, label: '🌐 System' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888', cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 24px', background: '#fff', borderBottom: '1px solid #eee' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…"
          style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}>
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_ICONS).map(([k, v]) => <option key={k} value={k}>{v} {k}</option>)}
        </select>
      </div>

      {/* Template grid */}
      <div style={{ padding: '16px 24px 100px' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading…</p>
        ) : templates.length === 0 ? (
          <EmptyState title="No Templates Found" message="Try a different filter, or create a new template." icon="📋" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {templates.map((tpl: any) => {
              const scope = SCOPE_BADGES[tpl.template_scope] || SCOPE_BADGES.personal;
              return (
                <div key={tpl.id} style={{
                  background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '14px 18px',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 24 }}>{CATEGORY_ICONS[tpl.template_category] || '📋'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{tpl.template_name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 4, background: scope.bg, color: scope.color, fontWeight: 600 }}>{scope.label}</span>
                        {' · '}{tpl.template_category} · v{tpl.template_version}
                      </div>
                    </div>
                  </div>
                  {tpl.template_description && (
                    <p style={{ fontSize: 12, color: '#666', margin: 0 }}>{tpl.template_description}</p>
                  )}
                  <div style={{ fontSize: 11, color: '#999' }}>
                    {(tpl.template_fields || []).length} fields · {tpl.template_usage_count} uses
                    {tpl.creator_name && ` · by ${tpl.creator_name}`}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button onClick={() => router.push(`/care/templates/builder?id=${tpl.id}`)}
                      style={cardBtn('#1565c0')}>
                      {tpl.template_scope === 'personal' && tpl.template_owner_id === userId ? '✏️ Edit' : '👁 View'}
                    </button>
                    {tpl.template_scope !== 'personal' && (
                      <button onClick={() => handleFork(tpl)} style={cardBtn('#7b1fa2')}>🔀 Fork</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom tab */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex',
        background: '#fff', borderTop: '1px solid #e0e0e0', zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'templates', label: 'Templates', icon: '📋', href: '/care/templates' },
          { key: 'builder', label: 'Builder', icon: '🔨', href: '/care/templates/builder' },
          { key: 'home', label: 'Home', icon: '⌂', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'templates' ? '#1565c0' : '#888', fontWeight: tab.key === 'templates' ? 700 : 400,
          }}><span style={{ fontSize: 20 }}>{tab.icon}</span>{tab.label}</a>
        ))}
      </div>
    </div>
  );
}

function cardBtn(color: string): React.CSSProperties {
  return { padding: '5px 12px', fontSize: 12, fontWeight: 600, background: `${color}15`, color, border: `1px solid ${color}40`, borderRadius: 6, cursor: 'pointer' };
}
