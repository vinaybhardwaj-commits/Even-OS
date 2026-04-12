'use client';

import { useState, useEffect, useCallback } from 'react';

type ConsentTemplate = {
  id: string; name: string; category: string; template_text: string;
  version: number; status: string; created_at: string; updated_at: string;
};

const CATEGORIES = ['surgical', 'anesthesia', 'transfusion', 'research', 'general', 'procedure', 'other'] as const;

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export function ConsentTemplatesClient() {
  const [items, setItems] = useState<ConsentTemplate[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, draft: 0, archived: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const emptyForm = { name: '', category: 'general' as string, template_text: '', status: 'draft' as string };
  const [form, setForm] = useState(emptyForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const input: any = { page, pageSize: 25, status: statusFilter };
      if (category) input.category = category;

      const [listData, statsData] = await Promise.all([
        trpcQuery('consentTemplates.list', input),
        trpcQuery('consentTemplates.stats'),
      ]);
      setItems(listData.items);
      setTotal(listData.total);
      setTotalPages(listData.totalPages);
      setStats(statsData);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [page, category, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setError('');
    try {
      if (editingId) {
        await trpcMutate('consentTemplates.update', { id: editingId, ...form });
        setSuccess('Template updated' + (form.template_text ? ' (version bumped)' : ''));
      } else {
        await trpcMutate('consentTemplates.create', form);
        setSuccess('Template created');
      }
      setShowForm(false); setEditingId(null); setForm(emptyForm);
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleEdit = (item: ConsentTemplate) => {
    setEditingId(item.id);
    setForm({ name: item.name, category: item.category, template_text: item.template_text, status: item.status });
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex items-center gap-3">
        <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
        <h1 className="text-xl font-bold">Consent Templates</h1>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Total</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
            <p className="text-xs text-green-600 uppercase">Active</p>
            <p className="text-3xl font-bold text-green-800 mt-1">{stats.active}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-yellow-200 shadow-sm">
            <p className="text-xs text-yellow-600 uppercase">Draft</p>
            <p className="text-3xl font-bold text-yellow-800 mt-1">{stats.draft}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Archived</p>
            <p className="text-3xl font-bold text-gray-600 mt-1">{stats.archived}</p>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error} <button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success} <button onClick={() => setSuccess('')} className="ml-2 underline">dismiss</button></div>}

        {/* Toolbar */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-center">
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">+ New Template</button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Version</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Preview</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No consent templates found.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-xs font-medium">{item.category}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-mono">v{item.version}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium
                      ${item.status === 'active' ? 'bg-green-50 text-green-700' :
                        item.status === 'draft' ? 'bg-yellow-50 text-yellow-700' :
                        'bg-gray-100 text-gray-600'}`}>{item.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                    {item.template_text.substring(0, 80)}{item.template_text.length > 80 ? '...' : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-800 text-xs">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
              <p className="text-sm text-gray-500">Page {page} of {totalPages} ({total} templates)</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100">Prev</button>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100">Next</button>
              </div>
            </div>
          )}
        </div>

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 m-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-4">{editingId ? 'Edit Template' : 'New Consent Template'}</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Template Name *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
                      <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                      <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        {editingId && <option value="archived">Archived</option>}
                      </select>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Template Text * {editingId && <span className="text-gray-400">(changing text bumps version)</span>}
                  </label>
                  <textarea value={form.template_text} onChange={e => setForm(f => ({ ...f, template_text: e.target.value }))}
                    rows={12} placeholder="Enter consent text... HTML supported."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={!form.name || !form.template_text}
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
