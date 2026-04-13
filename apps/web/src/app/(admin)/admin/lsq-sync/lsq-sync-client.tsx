'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

/**
 * tRPC query helper — handles superjson error extraction properly.
 * tRPC v10 with superjson returns errors at json.error.json.message,
 * NOT json.error.message.
 */
async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

/**
 * tRPC mutation helper (POST)
 */
async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input !== undefined ? { json: input } : {}),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

const syncStatusStyle: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  failure: 'bg-red-50 text-red-700 border-red-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  skipped_duplicate: 'bg-purple-50 text-purple-700 border-purple-200',
};

export function LsqSyncClient() {
  const [logs, setLogs] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const input: any = { limit: 100 };
      if (typeFilter) input.sync_type = typeFilter;
      if (statusFilter) input.sync_status = statusFilter;
      const data = await trpcQuery('integrations.listLsqSyncLogs', input);
      setLogs(data?.logs || []);
      setSummary(data?.summary || {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const triggerSync = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      setError('');
      const result = await trpcMutate('lsq.triggerSync');
      setSyncResult(result);
      // Reload data after sync completes
      await loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const loadDetail = async (id: string) => {
    try {
      const detail = await trpcQuery('integrations.getLsqSyncLog', { id });
      setSelected(detail);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const successRate = summary.total && parseInt(summary.total) > 0
    ? ((parseInt(summary.success_count || '0') / parseInt(summary.total)) * 100).toFixed(1)
    : '—';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <Link href="/admin/integrations" className="hover:text-gray-700">Integrations</Link>
              <span>/</span>
              <span className="text-gray-900">LSQ Sync</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">LeadSquared Sync Monitor</h1>
            <p className="text-sm text-gray-500">Track sync health, debug dedup, view history &middot; Auto-syncs every hour</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {syncing ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Syncing...
                </>
              ) : (
                'Trigger Sync Now'
              )}
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-2 text-red-600 hover:underline text-xs">dismiss</button>
          </div>
        )}

        {/* Sync Result Banner */}
        {syncResult && (
          <div className={`mb-4 p-3 border rounded-lg text-sm ${
            syncResult.status === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
            syncResult.status === 'partial' ? 'bg-amber-50 border-amber-200 text-amber-800' :
            'bg-red-50 border-red-200 text-red-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                Sync {syncResult.status === 'success' ? 'completed' : syncResult.status === 'partial' ? 'partial' : 'failed'}
                {syncResult.status !== 'failed' && ` — ${syncResult.new_count || 0} new, ${syncResult.updated || 0} updated, ${syncResult.skipped || 0} skipped`}
                {(syncResult.errors || 0) > 0 && `, ${syncResult.errors} errors`}
              </span>
              <button onClick={() => setSyncResult(null)} className="text-xs hover:underline">dismiss</button>
            </div>
            {syncResult.error_message && <p className="mt-1 text-xs opacity-80">{syncResult.error_message}</p>}
          </div>
        )}

        {/* Summary Cards */}
        <div className="bg-white border rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">LSQ Sync Status (24h)</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{summary.total || 0}</div>
              <div className="text-xs text-gray-500">Total Synced</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{successRate}%</div>
              <div className="text-xs text-gray-500">Success Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{summary.failure_count || 0}</div>
              <div className="text-xs text-gray-500">Failures</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{summary.dup_count || 0}</div>
              <div className="text-xs text-gray-500">Duplicates</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Types</option>
            <option value="opd_inquiry">OPD Inquiry</option>
            <option value="admission">Admission</option>
            <option value="pre_auth">Pre-Auth</option>
            <option value="follow_up">Follow-Up</option>
            <option value="generic_update">Generic Update</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="partial">Partial</option>
            <option value="skipped_duplicate">Duplicate</option>
          </select>
        </div>

        {/* Sync Events Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading sync logs...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No sync logs found.</div>
            <p className="text-sm text-gray-400 mb-4">Click &quot;Trigger Sync Now&quot; to run the first sync, or wait for the hourly auto-sync.</p>
          </div>
        ) : (
          <div className="bg-white border rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">UHID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">LSQ Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Dedup</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => loadDetail(log.id)}>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 font-medium">{log.sync_type}</td>
                    <td className="px-4 py-3 text-gray-600">{log.patient_uhid || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.lsq_lead_id || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${syncStatusStyle[log.sync_status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {log.sync_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.dedup_match_uhid || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail Modal */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
            <div className="bg-white rounded-2xl w-[640px] max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Sync Detail</h3>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                <div><span className="text-gray-500">Batch:</span> <span className="font-mono text-xs">{selected.sync_batch_id || '—'}</span></div>
                <div><span className="text-gray-500">Type:</span> <span className="font-medium">{selected.sync_type}</span></div>
                <div><span className="text-gray-500">UHID:</span> <span className="font-medium">{selected.patient_uhid || '—'}</span></div>
                <div><span className="text-gray-500">LSQ Lead:</span> <span className="font-mono text-xs">{selected.lsq_lead_id || '—'}</span></div>
                <div><span className="text-gray-500">Status:</span> <span className="font-medium">{selected.sync_status}</span></div>
                <div><span className="text-gray-500">HTTP:</span> <span>{selected.http_status_code || '—'}</span></div>
              </div>
              {selected.dedup_match_uhid && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm mb-4">
                  <span className="font-medium text-purple-800">Dedup Match:</span> {selected.dedup_match_uhid} — Action: {selected.dedup_action || 'none'}
                </div>
              )}
              {selected.error_message && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 mb-4">
                  {selected.error_message}
                </div>
              )}
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Event Data</h4>
                <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-x-auto max-h-40">
                  {JSON.stringify(selected.event_data, null, 2)}
                </pre>
              </div>
              {selected.lsq_response && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-2">LSQ Response</h4>
                  <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-x-auto max-h-40">
                    {JSON.stringify(selected.lsq_response, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
