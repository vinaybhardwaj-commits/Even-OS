'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const REFRESH_INTERVAL = 60000; // 60s

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

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

const statusBadge: Record<string, { icon: string; color: string; bg: string }> = {
  active: { icon: '✓', color: 'text-green-700', bg: 'bg-green-50' },
  degraded: { icon: '⚠', color: 'text-amber-700', bg: 'bg-amber-50' },
  error: { icon: '✗', color: 'text-red-700', bg: 'bg-red-50' },
  inactive: { icon: '○', color: 'text-gray-500', bg: 'bg-gray-50' },
  stub: { icon: '◯', color: 'text-gray-400', bg: 'bg-gray-50' },
};

export function IntegrationsDashboardClient() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [volume, setVolume] = useState<any>({});
  const [recentErrors, setRecentErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [epData, healthData] = await Promise.all([
        trpcQuery('integrations.listEndpoints', {}),
        trpcQuery('integrations.getIntegrationHealth', {}),
      ]);
      setEndpoints(epData?.endpoints || []);
      setSummary(epData?.summary || {});
      setVolume(healthData?.volume || {});
      setRecentErrors(healthData?.recent_errors || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await trpcMutate('integrations.testEndpoint', { id });
      alert(result.success ? `Connected — ${result.latency_ms}ms` : `Failed: ${result.message}`);
      loadData();
    } catch (e: any) {
      alert(`Test failed: ${e.message}`);
    } finally {
      setTesting(null);
    }
  };

  const timeSince = (ts: string | null) => {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <span className="text-gray-900">Integrations</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Integration Dashboard</h1>
            <p className="text-sm text-gray-500">Module 15 — External systems health, messages, and audit</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/hl7-messages" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">HL7 Messages</Link>
            <Link href="/admin/lsq-sync" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">LSQ Sync</Link>
            <Link href="/admin/event-bus" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">Event Bus</Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Health Summary */}
        <div className="bg-white border rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Integration Health Summary</h2>
          <div className="grid grid-cols-5 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{summary.total || 0}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{summary.active || 0}</div>
              <div className="text-xs text-gray-500">Active</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-600">{summary.degraded || 0}</div>
              <div className="text-xs text-gray-500">Degraded</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{summary.error || 0}</div>
              <div className="text-xs text-gray-500">Error</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-400">{summary.stub || 0}</div>
              <div className="text-xs text-gray-500">Stub</div>
            </div>
          </div>
        </div>

        {/* Message Volume */}
        <div className="bg-white border rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Message Volume (24h)</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-700">{volume.inbound_24h || 0}</div>
              <div className="text-xs text-blue-600">Inbound</div>
            </div>
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{volume.outbound_24h || 0}</div>
              <div className="text-xs text-green-600">Outbound</div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-700">{volume.errors_24h || 0}</div>
              <div className="text-xs text-red-600">Errors</div>
            </div>
          </div>
        </div>

        {/* Endpoints Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading endpoints...</div>
        ) : (
          <div className="bg-white border rounded-2xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">System</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Last Heartbeat</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Owner</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {endpoints.map((ep: any) => {
                  const badge = statusBadge[ep.status] || statusBadge.inactive;
                  return (
                    <tr key={ep.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{ep.display_name || ep.system_name}</div>
                        <div className="text-xs text-gray-400">{ep.system_name}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ep.protocol}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.color}`}>
                          {badge.icon} {ep.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{timeSince(ep.last_heartbeat_at)}</td>
                      <td className="px-4 py-3 text-gray-500">{ep.owner_team || '—'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleTest(ep.id)}
                          disabled={testing === ep.id}
                          className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                          {testing === ep.id ? 'Testing...' : 'Test'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent Errors */}
        {recentErrors.length > 0 && (
          <div className="bg-white border rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Errors</h2>
            <div className="space-y-2">
              {recentErrors.map((err: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg text-sm">
                  <span className="text-red-600 font-mono text-xs whitespace-nowrap">
                    {new Date(err.created_at).toLocaleTimeString()}
                  </span>
                  <span className="text-red-800">
                    <span className="font-medium">{err.system_name || 'Unknown'}:</span> {err.error_message || err.event_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
