'use client';

import { useState, useEffect, useCallback } from 'react';

type DischargeTemplate = {
  id: string; name: string; clinical_fields: string[]; text_sections: { title: string; default_text: string }[];
  is_active: boolean; created_at: string; updated_at: string;
};

type FieldOption = { key: string; label: string };

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

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

export function DischargeTemplatesClient() {
  const [items, setItems] = useState<DischargeTemplate[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0 });
  const [availableFields, setAvailableFields] = useState<FieldOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    name: '',
    clinical_fields: [] as string[],
    text_sections: [] as { title: string; default_text: string }[],
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listData, statsData, fields] = await Promise.all([
        trpcQuery('dischargeTemplates.list', { pageSize: 100 }),
        trpcQuery('dischargeTemplates.stats'),
        trpcQuery('dischargeTemplates.availableFields'),
      ]);
      setItems(listData.items);
      setStats(statsData);
      setAvailableFields(fields);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setError('');
    try {
      if (editingId) {
        await trpcMutate('dischargeTemplates.update', { id: editingId, ...form });
        setSuccess('Template updated');
      } else {
        await trpcMutate('dischargeTemplates.create', form);
        setSuccess('Template created');
      }
      setShowForm(false); setEditingId(null);
      setForm({ name: '', clinical_fields: [], text_sections: [] });
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleEdit = (item: DischargeTemplate) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      clinical_fields: item.clinical_fields || [],
      text_sections: item.text_sections || [],
    });
    setShowForm(true);
  };

  const handleToggle = async (id: string) => {
    try {
      await trpcMutate('dischargeTemplates.deactivate', { id });
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const toggleField = (key: string) => {
    setForm(f => ({
      ...f,
      clinical_fields: f.clinical_fields.includes(key)
        ? f.clinical_fields.filter(k => k !== key)
        : [...f.clinical_fields, key],
    }));
  };

  const addTextSection = () => {
    setForm(f => ({
      ...f,
      text_sections: [...f.text_sections, { title: '', default_text: '' }],
    }));
  };

  const removeTextSection = (idx: number) => {
    setForm(f => ({
      ...f,
      text_sections: f.text_sections.filter((_, i) => i !== idx),
    }));
  };

  const updateTextSection = (idx: number, field: 'title' | 'default_text', value: string) => {
    setForm(f => ({
      ...f,
      text_sections: f.text_sections.map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex items-center gap-3">
        <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
        <h1 className="text-xl font-bold">Discharge Templates</h1>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Total Templates</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
            <p className="text-xs text-green-600 uppercase">Active</p>
            <p className="text-3xl font-bold text-green-800 mt-1">{stats.active}</p>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error} <button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success} <button onClick={() => setSuccess('')} className="ml-2 underline">dismiss</button></div>}

        <div className="flex justify-end mb-4">
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', clinical_fields: [], text_sections: [] }); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">+ New Template</button>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading ? (
            <div className="col-span-2 text-center text-gray-400 py-8">Loading...</div>
          ) : items.length === 0 ? (
            <div className="col-span-2 text-center text-gray-400 py-8">No discharge templates. Create one to get started.</div>
          ) : items.map(item => (
            <div key={item.id} className={`bg-white rounded-lg border border-gray-200 shadow-sm p-4 ${!item.is_active ? 'opacity-50' : ''}`}>
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-sm font-bold text-gray-800">{item.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="mb-3">
                <p className="text-xs text-gray-500 font-medium mb-1">Clinical Fields ({(item.clinical_fields as string[])?.length || 0})</p>
                <div className="flex flex-wrap gap-1">
                  {(item.clinical_fields as string[])?.map(f => (
                    <span key={f} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">
                      {f.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>

              {(item.text_sections as any[])?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-500 font-medium mb-1">Text Sections ({(item.text_sections as any[]).length})</p>
                  <div className="flex flex-wrap gap-1">
                    {(item.text_sections as any[]).map((s: any, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">{s.title}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <button onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-800 text-xs">Edit</button>
                <button onClick={() => handleToggle(item.id)}
                  className={`text-xs ${item.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}`}>
                  {item.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 m-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-4">{editingId ? 'Edit Template' : 'New Discharge Template'}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Template Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>

                {/* Clinical Fields Picker */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Clinical Fields * (select which fields appear in discharge summary)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {availableFields.map(f => (
                      <label key={f.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors
                        ${form.clinical_fields.includes(f.key) ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={form.clinical_fields.includes(f.key)}
                          onChange={() => toggleField(f.key)} className="rounded" />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Text Sections */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-medium text-gray-600">Custom Text Sections</label>
                    <button onClick={addTextSection} className="text-xs text-blue-600 hover:text-blue-800">+ Add Section</button>
                  </div>
                  {form.text_sections.length === 0 ? (
                    <p className="text-xs text-gray-400">No custom sections. Click "Add Section" to create one.</p>
                  ) : (
                    <div className="space-y-3">
                      {form.text_sections.map((section, idx) => (
                        <div key={idx} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                          <div className="flex gap-2 mb-2">
                            <input value={section.title} onChange={e => updateTextSection(idx, 'title', e.target.value)}
                              placeholder="Section title" className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm" />
                            <button onClick={() => removeTextSection(idx)} className="text-red-400 hover:text-red-600 text-xs px-2">Remove</button>
                          </div>
                          <textarea value={section.default_text} onChange={e => updateTextSection(idx, 'default_text', e.target.value)}
                            placeholder="Default text (optional)" rows={2}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={!form.name || form.clinical_fields.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
                  {editingId ? 'Save Changes' : 'Create Template'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
