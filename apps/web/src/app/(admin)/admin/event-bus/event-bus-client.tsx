'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

const categoryColors: Record<string, string> = {
  clinical: 'bg-blue-50 text-blue-700',
  billing: 'bg-green-50 text-green-700',
  admin: 'bg-purple-50 text-purple-700',
  communication: 'bg-amber-50 text-amber-700',
};

export function EventBusClient() {
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [grouped, setGrouped] = useState<Record<string, any[]>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newSub, setNewSub] = useState({
    topic_name: '', topic_category: 'clinical' as string,
    subscriber_module: '', subscriber_endpoint: '',
    handler_type: 'internal_callback' as string,
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const input: any = {};
      if (catFilter) input.topic_category = catFilter;
      const data = await trpcQuery('integrations.listSubscriptions', input);
      setSubscriptions(data?.subscriptions || []);
      setGrouped(data?.grouped || {});
      setTotal(data?.total || 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [catFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    try {
      await trpcMutate('integrations.createSubscription', newSub);
      setShowCreate(false);
      setNewSub({ topic_name: '', topic_category: 'clinical', subscriber_module: '', subscriber_endpoint: '', handler_type: 'internal_callback' });
      loadData();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    try {
      await trpcMutate('integrations.updateSubscription', { id, is_active: !currentActive });
      loadData();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <Link href="/admin/integrations" className="hover:text-gray-700">Integrations</Link>
              <span>/</span>
              <span className="text-gray-900">Event Bus</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Event Bus Monitor</h1>
            <p className="text-sm text-gray-500">Topics, subscribers, and event routing</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            + New Subscription
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Summary */}
        <div className="bg-white border rounded-2xl p-5 mb-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{Object.keys(grouped).length}</div>
              <div className="text-xs text-gray-500">Active Topics</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{total}</div>
              <div className="text-xs text-gray-500">Subscribers</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{subscriptions.filter((s: any) => s.is_active).length}</div>
              <div className="text-xs text-gray-500">Active</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{subscriptions.filter((s: any) => parseInt(s.consecutive_failures || '0') > 0).length}</div>
              <div className="text-xs text-gray-500">With Failures</div>
            </div>
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 mb-4">
          {['', 'clinical', 'billing', 'admin', 'communication'].map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)}
              className={`px-3 py-1.5 text-sm rounded-full border ${catFilter === cat ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'}`}>
              {cat || 'All'}
            </button>
          ))}
        </div>

        {/* Topics & Subscriptions */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading subscriptions...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No event bus subscriptions.</div>
            <p className="text-sm text-gray-400">Run the integrations migration to seed default subscriptions.</p>
          </div>
        ) : (
          Object.entries(grouped).sort().map(([topic, subs]) => (
            <div key={topic} className="bg-white border rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <h3 className="font-semibold text-gray-900">{topic}</h3>
                {subs[0] && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[subs[0].topic_category] || 'bg-gray-50 text-gray-600'}`}>
                    {subs[0].topic_category}
                  </span>
                )}
                <span className="text-xs text-gray-400">{subs.length} subscriber{subs.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {subs.map((sub: any) => (
                  <div key={sub.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium">{sub.subscriber_module}</div>
                      <div className="text-xs text-gray-400 font-mono">{sub.subscriber_endpoint}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{sub.handler_type}</span>
                      {parseInt(sub.consecutive_failures || '0') > 0 && (
                        <span className="text-xs text-red-600">{sub.consecutive_failures} failures</span>
                      )}
                      <button
                        onClick={() => toggleActive(sub.id, sub.is_active)}
                        className={`px-2 py-1 text-xs rounded ${sub.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                      >
                        {sub.is_active ? 'Active' : 'Paused'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-white rounded-2xl w-[500px] p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">New Subscription</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Topic Name</label>
                  <input value={newSub.topic_name} onChange={e => setNewSub(s => ({ ...s, topic_name: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="order.created" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Category</label>
                  <select value={newSub.topic_category} onChange={e => setNewSub(s => ({ ...s, topic_category: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="clinical">Clinical</option>
                    <option value="billing">Billing</option>
                    <option value="admin">Admin</option>
                    <option value="communication">Communication</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Subscriber Module</label>
                  <input value={newSub.subscriber_module} onChange={e => setNewSub(s => ({ ...s, subscriber_module: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="integrations" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Endpoint</label>
                  <input value={newSub.subscriber_endpoint} onChange={e => setNewSub(s => ({ ...s, subscriber_endpoint: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="/api/v1/integrations/webhooks/..." />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Handler Type</label>
                  <select value={newSub.handler_type} onChange={e => setNewSub(s => ({ ...s, handler_type: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="internal_callback">Internal Callback</option>
                    <option value="webhook_http">Webhook HTTP</option>
                    <option value="message_queue">Message Queue</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleCreate} disabled={!newSub.topic_name || !newSub.subscriber_module}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
