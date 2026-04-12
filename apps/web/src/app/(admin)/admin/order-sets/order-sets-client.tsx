'use client';

import { useState, useEffect, useCallback } from 'react';

type OrderSet = {
  id: string; name: string; description: string | null; category: string | null;
  is_active: boolean; created_at: string; updated_at: string;
};
type OrderSetItem = {
  id: string; item_type: string; item_name: string; frequency: string | null;
  duration: string | null; instructions: string | null; sort_order: number;
};
type OrderSetDetail = OrderSet & { items: OrderSetItem[] };

const ITEM_TYPES = ['medication', 'lab', 'radiology', 'procedure', 'other'] as const;

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

export function OrderSetsClient() {
  const [sets, setSets] = useState<OrderSet[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0, totalItems: 0 });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSet, setSelectedSet] = useState<OrderSetDetail | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({ name: '', description: '', category: '' });
  const [itemForm, setItemForm] = useState({ item_type: 'medication' as string, item_name: '', frequency: '', duration: '', instructions: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listData, statsData] = await Promise.all([
        trpcQuery('orderSets.list', { pageSize: 100 }),
        trpcQuery('orderSets.stats'),
      ]);
      setSets(listData.items);
      setStats(statsData);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openDetail = async (id: string) => {
    try {
      const detail = await trpcQuery('orderSets.get', { id });
      setSelectedSet(detail);
    } catch (err: any) { setError(err.message); }
  };

  const handleCreate = async () => {
    setError('');
    try {
      const payload: any = { name: form.name };
      if (form.description) payload.description = form.description;
      if (form.category) payload.category = form.category;
      await trpcMutate('orderSets.create', payload);
      setSuccess('Order set created');
      setShowCreate(false);
      setForm({ name: '', description: '', category: '' });
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleAddItem = async () => {
    if (!selectedSet) return;
    setError('');
    try {
      const payload: any = {
        order_set_id: selectedSet.id,
        item_type: itemForm.item_type,
        item_name: itemForm.item_name,
      };
      if (itemForm.frequency) payload.frequency = itemForm.frequency;
      if (itemForm.duration) payload.duration = itemForm.duration;
      if (itemForm.instructions) payload.instructions = itemForm.instructions;
      await trpcMutate('orderSets.addItem', payload);
      setItemForm({ item_type: 'medication', item_name: '', frequency: '', duration: '', instructions: '' });
      openDetail(selectedSet.id); // Refresh
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedSet) return;
    try {
      await trpcMutate('orderSets.removeItem', { item_id: itemId, order_set_id: selectedSet.id });
      openDetail(selectedSet.id);
      fetchData();
    } catch (err: any) { setError(err.message); }
  };

  const handleToggle = async (id: string) => {
    try {
      await trpcMutate('orderSets.deactivate', { id });
      fetchData();
      if (selectedSet?.id === id) openDetail(id);
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex items-center gap-3">
        <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
        <h1 className="text-xl font-bold">Order Sets</h1>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Total Sets</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
            <p className="text-xs text-green-600 uppercase">Active</p>
            <p className="text-3xl font-bold text-green-800 mt-1">{stats.active}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-purple-200 shadow-sm">
            <p className="text-xs text-purple-600 uppercase">Total Items</p>
            <p className="text-3xl font-bold text-purple-800 mt-1">{stats.totalItems}</p>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error} <button onClick={() => setError('')} className="ml-2 underline">dismiss</button></div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success} <button onClick={() => setSuccess('')} className="ml-2 underline">dismiss</button></div>}

        <div className="flex gap-6">
          {/* Left: Set list */}
          <div className="w-1/3">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Sets</h2>
              <button onClick={() => setShowCreate(true)}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">+ New Set</button>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
              {loading ? (
                <div className="p-4 text-center text-gray-400 text-sm">Loading...</div>
              ) : sets.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-sm">No order sets yet</div>
              ) : sets.map(set => (
                <div key={set.id}
                  onClick={() => openDetail(set.id)}
                  className={`p-3 cursor-pointer hover:bg-blue-50 transition-colors ${selectedSet?.id === set.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''} ${!set.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{set.name}</p>
                      {set.category && <span className="text-xs text-gray-500">{set.category}</span>}
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${set.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {set.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {set.description && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{set.description}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Detail + Items */}
          <div className="w-2/3">
            {selectedSet ? (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{selectedSet.name}</h2>
                    {selectedSet.description && <p className="text-sm text-gray-500">{selectedSet.description}</p>}
                    {selectedSet.category && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded mt-1 inline-block">{selectedSet.category}</span>}
                  </div>
                  <button onClick={() => handleToggle(selectedSet.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedSet.is_active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                    {selectedSet.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>

                {/* Items list */}
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Items ({selectedSet.items.length})</h3>
                  {selectedSet.items.length === 0 ? (
                    <p className="text-sm text-gray-400 mb-4">No items yet. Add orders below.</p>
                  ) : (
                    <div className="space-y-2 mb-4">
                      {selectedSet.items.map((item, idx) => (
                        <div key={item.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                          <span className="text-xs font-mono text-gray-400 w-6">{idx + 1}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase
                            ${item.item_type === 'medication' ? 'bg-blue-50 text-blue-700' :
                              item.item_type === 'lab' ? 'bg-yellow-50 text-yellow-700' :
                              item.item_type === 'radiology' ? 'bg-purple-50 text-purple-700' :
                              'bg-gray-100 text-gray-600'}`}>
                            {item.item_type}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-800">{item.item_name}</p>
                            <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                              {item.frequency && <span>Freq: {item.frequency}</span>}
                              {item.duration && <span>Dur: {item.duration}</span>}
                            </div>
                            {item.instructions && <p className="text-xs text-gray-400 mt-0.5">{item.instructions}</p>}
                          </div>
                          <button onClick={() => handleRemoveItem(item.id)}
                            className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add item form */}
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="text-xs font-semibold text-gray-600 mb-2">Add Item</h4>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <select value={itemForm.item_type} onChange={e => setItemForm(f => ({ ...f, item_type: e.target.value }))}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                        {ITEM_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                      </select>
                      <input value={itemForm.item_name} onChange={e => setItemForm(f => ({ ...f, item_name: e.target.value }))}
                        placeholder="Item name *" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <input value={itemForm.frequency} onChange={e => setItemForm(f => ({ ...f, frequency: e.target.value }))}
                        placeholder="Frequency (e.g. TID)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      <input value={itemForm.duration} onChange={e => setItemForm(f => ({ ...f, duration: e.target.value }))}
                        placeholder="Duration (e.g. 5 days)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      <input value={itemForm.instructions} onChange={e => setItemForm(f => ({ ...f, instructions: e.target.value }))}
                        placeholder="Instructions" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <button onClick={handleAddItem} disabled={!itemForm.item_name}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
                      Add Item
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center text-gray-400">
                Select an order set to view and manage its items
              </div>
            )}
          </div>
        </div>

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 m-4" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-4">Create Order Set</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. Cardiology, ICU, Post-Op" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleCreate} disabled={!form.name}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40">Create</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
