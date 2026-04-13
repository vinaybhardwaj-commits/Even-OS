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

const syncStatusStyle: Record<string, string> = {
  success: 'bg-green-50 text-green-700',
  failure: 'bg-red-50 text-red-700',
  partial: 'bg-amber-50 text-amber-700',
  skipped_duplicate: 'bg-purple-50 text-purple-700',
};

export function LsqSyncClient() {
  const [logs, setLogs] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
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

  const loadDetail = async (id: string) => {
    try {
      const detail = await trpcQuery('integrations.getLsqSyncLog', { id });
      setSelected(detail);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const successRate = summary.total ? ((parseInt(summary.success_count || '0') / parseInt(summary.total)) * 100).toFixed(1) : '—';

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
              <span className="text-gray-900">LSQ Sync</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">LeadSquared Sync Monitor</h1>
            <p className="text-sm text-gray-500">Track sync health, debug dedup, view history</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Summary */}
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
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="skipped_duplicate">Duplicate</option>
          </select>
        </div>

        {/* Sync Events */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading sync logs...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No sync logs found.</div>
            <p className="text-sm text-gray-400">LSQ sync events will appear here once the cron job processes data.</p>
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
                    <td className="px-4 py-3 text-gray-600">{log.patient_uhid}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.lsq_lead_id || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${syncStatusStyle[log.sync_status] || 'bg-gray-50 text-gray-600'}`}>
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
                <div><span className="text-gray-500">UHID:</span> <span className="font-medium">{selected.patient_uhid}</span></div>
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
