'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Drug = {
  id: string; drug_code: string; drug_name: string; generic_name: string | null;
  category: string; strength: string | null; unit: string | null; route: string | null;
  price: string; manufacturer: string | null; hsn_code: string | null;
  gst_percentage: string; is_active: boolean; created_at: string; updated_at: string;
};

type Stats = { total: number; active: number; inactive: number };

const CATEGORIES = ['tablet', 'capsule', 'injection', 'syrup', 'cream', 'ointment', 'drops', 'inhaler', 'patch', 'suppository', 'powder', 'other'] as const;
const ROUTES = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'sublingual', 'rectal', 'ophthalmic', 'otic', 'nasal', 'transdermal', 'other'] as const;

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

export function DrugMasterClient() {
  const [items, setItems] = useState<Drug[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const searchTimeout = useRef<NodeJS.Timeout>();

  const emptyForm = {
    drug_code: '', drug_name: '', generic_name: '', category: 'tablet' as string,
    strength: '', unit: '', route: '' as string, price: '', manufacturer: '',
    hsn_code: '', gst_percentage: '0',
  };
  const [form, setForm] = useState(emptyForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const input: any = { page, pageSize: 25, status: statusFilter };
      if (search) input.search = search;
      if (category) input.category = category;
      if (routeFilter) input.route = routeFilter;

      const [listData, statsData] = await Promise.all([
        trpcQuery('drugMaster.list', input),
        trpcQuery('drugMaster.stats'),
      ]);

      setItems(listData.items);
      setTotal(listData.total);
      setTotalPages(listData.totalPages);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, category, routeFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (val: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setSearch(val); setPage(1); }, 300);
  };

  const handleCreate = async () => {
    setError(''); setSuccess('');
    try {
      const payload: any = { ...form };
      // Remove empty optional fields
      if (!payload.generic_name) delete payload.generic_name;
      if (!payload.strength) delete payload.strength;
      if (!payload.unit) delete payload.unit;
      if (!payload.route) delete payload.route;
      if (!payload.manufacturer) delete payload.manufacturer;
      if (!payload.hsn_code) delete payload.hsn_code;

      if (editingId) {
        payload.id = editingId;
        delete payload.drug_code; // Can't change code
        await trpcMutate('drugMaster.update', payload);
        setSuccess('Drug updated');
      } else {
        await trpcMutate('drugMaster.create', payload);
        setSuccess('Drug created');
      }
      setShowForm(false); setEditingId(null); setForm(emptyForm);
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleEdit = (item: Drug) => {
    setEditingId(item.id);
    setForm({
      drug_code: item.drug_code, drug_name: item.drug_name,
      generic_name: item.generic_name || '', category: item.category,
      strength: item.strength || '', unit: item.unit || '',
      route: item.route || '', price: item.price,
      manufacturer: item.manufacturer || '', hsn_code: item.hsn_code || '',
      gst_percentage: item.gst_percentage,
    });
    setShowForm(true);
  };

  const handleToggle = async (id: string) => {
    try {
      await trpcMutate('drugMaster.deactivate', { id });
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleCSVImport = async (file: File, mode: 'skip_duplicates' | 'update_duplicates') => {
    setError(''); setSuccess('');
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

      const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const codeIdx = header.indexOf('drug_code');
      const nameIdx = header.indexOf('drug_name');
      const catIdx = header.indexOf('category');
      const priceIdx = header.indexOf('price');

      if (codeIdx === -1 || nameIdx === -1 || catIdx === -1 || priceIdx === -1) {
        throw new Error('CSV must have columns: drug_code, drug_name, category, price');
      }

      const getIdx = (name: string) => header.indexOf(name);

      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        const cat = cols[catIdx]?.toLowerCase() || 'other';
        const rt = cols[getIdx('route')]?.toLowerCase();
        const row: any = {
          drug_code: cols[codeIdx] || '',
          drug_name: cols[nameIdx] || '',
          category: (CATEGORIES.includes(cat as any) ? cat : 'other') as any,
          price: cols[priceIdx] || '0',
          gst_percentage: cols[getIdx('gst_percentage')] || '0',
        };
        if (getIdx('generic_name') >= 0 && cols[getIdx('generic_name')]) row.generic_name = cols[getIdx('generic_name')];
        if (getIdx('strength') >= 0 && cols[getIdx('strength')]) row.strength = cols[getIdx('strength')];
        if (getIdx('unit') >= 0 && cols[getIdx('unit')]) row.unit = cols[getIdx('unit')];
        if (rt && ROUTES.includes(rt as any)) row.route = rt;
        if (getIdx('manufacturer') >= 0 && cols[getIdx('manufacturer')]) row.manufacturer = cols[getIdx('manufacturer')];
        if (getIdx('hsn_code') >= 0 && cols[getIdx('hsn_code')]) row.hsn_code = cols[getIdx('hsn_code')];
        return row;
      }).filter((r: any) => r.drug_code && r.drug_name);

      if (rows.length === 0) throw new Error('No valid rows found');

      const batchSize = 1000;
      let totalImported = 0, totalUpdated = 0, totalSkipped = 0;
      const allErrors: any[] = [];

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const result = await trpcMutate('drugMaster.bulkImport', { rows: batch, mode });
        totalImported += result.imported;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        allErrors.push(...result.errors);
      }

      setSuccess(`Import complete: ${totalImported} imported, ${totalUpdated} updated, ${totalSkipped} skipped, ${allErrors.length} errors`);
      setShowImport(false);
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Drug Master</h1>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Drugs</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{stats.total.toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
            <p className="text-xs text-green-600 uppercase tracking-wide">Active</p>
            <p className="text-3xl font-bold text-green-800 mt-1">{stats.active.toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-red-200 shadow-sm">
            <p className="text-xs text-red-600 uppercase tracking-wide">Inactive</p>
            <p className="text-3xl font-bold text-red-800 mt-1">{stats.inactive.toLocaleString('en-IN')}</p>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error} <button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success} <button onClick={() => setSuccess('')} className="ml-2 underline">dismiss</button></div>}

        {/* Toolbar */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input type="text" placeholder="Search by name, code, or generic name..."
              onChange={e => handleSearch(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Forms</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
            <select value={routeFilter} onChange={e => { setRouteFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Routes</option>
              {ROUTES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">+ Add Drug</button>
            <button onClick={() => setShowImport(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">CSV Import</button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Code</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Drug Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Generic</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Form</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Strength</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Route</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No drugs found. Add one or import from CSV.</td></tr>
                ) : items.map(item => (
                  <tr key={item.id} className={`hover:bg-gray-50 ${!item.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{item.drug_code}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{item.drug_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{item.generic_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium">{item.category}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">{item.strength || '—'}</td>
                    <td className="px-4 py-3 text-xs uppercase">{item.route || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-800 text-xs mr-3">Edit</button>
                      <button onClick={() => handleToggle(item.id)} className={`text-xs ${item.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}`}>
                        {item.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, total)} of {total.toLocaleString('en-IN')}
              </p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100">Prev</button>
                <span className="px-3 py-1 text-sm text-gray-600">Page {page} of {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-100">Next</button>
              </div>
            </div>
          )}
        </div>

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-4">{editingId ? 'Edit Drug' : 'Add New Drug'}</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Drug Code *</label>
                    <input value={form.drug_code} onChange={e => setForm(f => ({ ...f, drug_code: e.target.value }))}
                      disabled={!!editingId} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Form/Category *</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Drug Name *</label>
                  <input value={form.drug_name} onChange={e => setForm(f => ({ ...f, drug_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Generic Name</label>
                  <input value={form.generic_name} onChange={e => setForm(f => ({ ...f, generic_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Strength</label>
                    <input value={form.strength} onChange={e => setForm(f => ({ ...f, strength: e.target.value }))}
                      placeholder="e.g. 500mg" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                    <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                      placeholder="e.g. tablet" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Route</label>
                    <select value={form.route} onChange={e => setForm(f => ({ ...f, route: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                      <option value="">—</option>
                      {ROUTES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Price *</label>
                    <input value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                      placeholder="0.00" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">GST %</label>
                    <input value={form.gst_percentage} onChange={e => setForm(f => ({ ...f, gst_percentage: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">HSN Code</label>
                    <input value={form.hsn_code} onChange={e => setForm(f => ({ ...f, hsn_code: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
                  <input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Create Drug'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import Modal */}
        {showImport && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowImport(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 m-4" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-4">Import Drugs from CSV</h2>
              <p className="text-sm text-gray-500 mb-4">
                Required columns: <code className="bg-gray-100 px-1 rounded">drug_code, drug_name, category, price</code>.
                Optional: <code className="bg-gray-100 px-1 rounded">generic_name, strength, unit, route, manufacturer, hsn_code, gst_percentage</code>.
              </p>
              <ImportForm onImport={handleCSVImport} onClose={() => setShowImport(false)} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ImportForm({ onImport, onClose }: { onImport: (file: File, mode: 'skip_duplicates' | 'update_duplicates') => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'skip_duplicates' | 'update_duplicates'>('skip_duplicates');

  return (
    <div className="space-y-3">
      <input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] || null)}
        className="w-full text-sm border border-gray-300 rounded-lg p-2" />
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Duplicate Handling</label>
        <select value={mode} onChange={e => setMode(e.target.value as any)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="skip_duplicates">Skip duplicates</option>
          <option value="update_duplicates">Update duplicates</option>
        </select>
      </div>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
        <button onClick={() => file && onImport(file, mode)} disabled={!file}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40">Import</button>
      </div>
    </div>
  );
}
