'use client';

import { useState, useEffect } from 'react';

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

const CATEGORY_ICONS: Record<string, string> = {
  discharge: '🏥', operative: '🔪', handoff: '📝', admission: '📋',
  assessment: '📊', consent: '✍️', nursing: '💉', progress: '📈',
  consultation: '🩺', referral: '📬', custom: '⚙️',
};

interface TemplatePickerProps {
  open: boolean;
  category?: string;
  onSelect: (template: any) => void;
  onClose: () => void;
}

export default function TemplatePicker({ open, category, onSelect, onClose }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const data = await trpcQuery('templateManagement.list', {
        category: category || undefined,
        search: search || undefined,
      });
      setTemplates(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, [open, category, search]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
      display: 'flex', justifyContent: 'flex-end', zIndex: 50,
    }} onClick={onClose}>
      <div style={{
        width: 400, maxWidth: '90vw', height: '100%', background: '#fff',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', overflow: 'auto', padding: 0,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📋 Choose Template</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '8px 20px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }} />
        </div>
        <div style={{ padding: '0 20px 20px' }}>
          {loading ? <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>Loading…</p> : (
            templates.length === 0 ? <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>No templates found.</p> : (
              templates.map((tpl: any) => (
                <div key={tpl.id} onClick={() => onSelect(tpl)} style={{
                  padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8,
                  marginTop: 8, cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 18 }}>{CATEGORY_ICONS[tpl.template_category] || '📋'}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{tpl.template_name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {tpl.template_category} · {(tpl.template_fields || []).length} fields · v{tpl.template_version}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}
