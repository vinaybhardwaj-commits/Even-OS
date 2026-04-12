'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface LsqStats {
  total_leads_mapped: number;
  leads_with_patients: number;
  total_sync_runs: number;
  successful_syncs: number;
  failed_syncs: number;
  last_successful_sync: string | null;
  total_api_calls: number;
  avg_api_latency_ms: number;
  patients_from_lsq: number;
  api_configured: boolean;
}

interface SyncRun {
  id: string;
  sync_at: string;
  lead_count_total: number;
  lead_count_new: number;
  lead_count_updated: number;
  lead_count_skipped: number;
  lead_count_error: number;
  status: string;
  error_message: string | null;
}

interface ApiCall {
  id: string;
  api_endpoint: string;
  request_method: string;
  response_status: number;
  latency_ms: number;
  error: string | null;
  logged_at: string;
}

interface LeadMapping {
  id: string;
  lsq_lead_id: string;
  sync_status: string;
  synced_at: string;
  patient_id: string | null;
  uhid: string | null;
  name_full: string | null;
  phone: string | null;
  patient_category: string | null;
}

// ─── tRPC helper ─────────────────────────────────────────
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input?: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input ? JSON.stringify(input) : '{}',
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export default function LsqSyncClient() {
  const [tab, setTab] = useState<'overview' | 'sync_runs' | 'api_calls' | 'lead_map'>('overview');
  const [stats, setStats] = useState<LsqStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync runs
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [syncRunsTotal, setSyncRunsTotal] = useState(0);
  const [syncPage, setSyncPage] = useState(1);
  const [loadingSyncRuns, setLoadingSyncRuns] = useState(false);

  // API calls
  const [apiCalls, setApiCalls] = useState<ApiCall[]>([]);
  const [apiCallsTotal, setApiCallsTotal] = useState(0);
  const [apiPage, setApiPage] = useState(1);
  const [loadingApiCalls, setLoadingApiCalls] = useState(false);

  // Lead mappings
  const [leadMappings, setLeadMappings] = useState<LeadMapping[]>([]);
  const [leadTotal, setLeadTotal] = useState(0);
  const [leadPage, setLeadPage] = useState(1);
  const [loadingLeads, setLoadingLeads] = useState(false);

  // Sync trigger
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string>('');

  // ─── Fetch stats ────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('lsq.stats');
      setStats(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ─── Fetch sync runs ───────────────────────────────────
  const fetchSyncRuns = useCallback(async () => {
    setLoadingSyncRuns(true);
    try {
      const data = await trpcQuery('lsq.listSyncRuns', { page: syncPage, pageSize: 25 });
      setSyncRuns(data.items || []);
      setSyncRunsTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoadingSyncRuns(false);
    }
  }, [syncPage]);

  useEffect(() => { if (tab === 'sync_runs') fetchSyncRuns(); }, [tab, fetchSyncRuns]);

  // ─── Fetch API calls ───────────────────────────────────
  const fetchApiCalls = useCallback(async () => {
    setLoadingApiCalls(true);
    try {
      const data = await trpcQuery('lsq.listApiCalls', { page: apiPage, pageSize: 50 });
      setApiCalls(data.items || []);
      setApiCallsTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoadingApiCalls(false);
    }
  }, [apiPage]);

  useEffect(() => { if (tab === 'api_calls') fetchApiCalls(); }, [tab, fetchApiCalls]);

  // ─── Fetch lead mappings ───────────────────────────────
  const fetchLeadMappings = useCallback(async () => {
    setLoadingLeads(true);
    try {
      const data = await trpcQuery('lsq.listLeadMappings', { page: leadPage, pageSize: 25 });
      setLeadMappings(data.items || []);
      setLeadTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoadingLeads(false);
    }
  }, [leadPage]);

  useEffect(() => { if (tab === 'lead_map') fetchLeadMappings(); }, [tab, fetchLeadMappings]);

  // ─── Trigger sync ──────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult('');
    try {
      const result = await trpcMutate('lsq.triggerSync');
      setSyncResult(`Sync ${result.status}: ${result.new_count} new, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);
      fetchStats();
      if (tab === 'sync_runs') fetchSyncRuns();
    } catch (err: unknown) {
      setSyncResult(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = { success: 'bg-green-100 text-green-700', partial: 'bg-yellow-100 text-yellow-700', failed: 'bg-red-100 text-red-700', synced: 'bg-blue-100 text-blue-700', processed: 'bg-green-100 text-green-700', merged: 'bg-purple-100 text-purple-700' };
    return colors[s] || 'bg-gray-100 text-gray-600';
  };

  const syncRunsPages = Math.ceil(syncRunsTotal / 25);
  const apiCallsPages = Math.ceil(apiCallsTotal / 50);
  const leadPages = Math.ceil(leadTotal / 25);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LeadSquared Sync</h1>
          <p className="text-sm text-gray-500 mt-1">CRM lead import, sync history &amp; API traceability</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium text-sm"
        >
          {syncing ? '&#8635; Syncing...' : '&#8635; Trigger Sync'}
        </button>
      </div>

      {syncResult && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          syncResult.includes('failed') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'
        }`}>{syncResult}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(['overview', 'sync_runs', 'api_calls', 'lead_map'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'overview' ? 'Overview' : t === 'sync_runs' ? 'Sync Runs' : t === 'api_calls' ? 'API Calls' : 'Lead Map'}
          </button>
        ))}
      </div>

      {/* ─── OVERVIEW TAB ──────────────────────────────────── */}
      {tab === 'overview' && (
        <div>
          {loading ? (
            <div className="p-12 text-center text-gray-400">Loading...</div>
          ) : stats ? (
            <>
              {/* API Config Status */}
              <div className={`mb-6 p-4 rounded-lg border ${stats.api_configured ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                <p className={`text-sm font-medium ${stats.api_configured ? 'text-green-800' : 'text-yellow-800'}`}>
                  {stats.api_configured ? '&#10003; LSQ API keys configured' : '&#9888; LSQ API keys not configured — set LSQ_ACCESS_KEY and LSQ_SECRET_KEY in Vercel env vars'}
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 font-medium uppercase">Patients from LSQ</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{stats.patients_from_lsq}</p>
                </div>
                <div className="bg-white rounded-lg border border-blue-200 p-4">
                  <p className="text-xs text-blue-600 font-medium uppercase">Leads Mapped</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">{stats.total_leads_mapped}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{stats.leads_with_patients} with patients</p>
                </div>
                <div className="bg-white rounded-lg border border-green-200 p-4">
                  <p className="text-xs text-green-600 font-medium uppercase">Sync Runs</p>
                  <p className="text-2xl font-bold text-green-700 mt-1">{stats.total_sync_runs}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{stats.successful_syncs} OK / {stats.failed_syncs} failed</p>
                </div>
                <div className="bg-white rounded-lg border border-purple-200 p-4">
                  <p className="text-xs text-purple-600 font-medium uppercase">API Calls</p>
                  <p className="text-2xl font-bold text-purple-700 mt-1">{stats.total_api_calls}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Avg: {stats.avg_api_latency_ms}ms</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 font-medium uppercase">Last Sync</p>
                  <p className="text-sm font-bold text-gray-700 mt-1">{formatDate(stats.last_successful_sync)}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-gray-400">Failed to load stats</div>
          )}
        </div>
      )}

      {/* ─── SYNC RUNS TAB ─────────────────────────────────── */}
      {tab === 'sync_runs' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {loadingSyncRuns ? (
            <div className="p-12 text-center text-gray-400">Loading...</div>
          ) : syncRuns.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No sync runs yet — click "Trigger Sync" to start</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <th className="px-6 py-3">Time</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Total</th>
                      <th className="px-6 py-3">New</th>
                      <th className="px-6 py-3">Updated</th>
                      <th className="px-6 py-3">Skipped</th>
                      <th className="px-6 py-3">Errors</th>
                      <th className="px-6 py-3">Error Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {syncRuns.map(run => (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-gray-600 text-xs">{formatDate(run.sync_at)}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(run.status)}`}>{run.status}</span>
                        </td>
                        <td className="px-6 py-3 text-gray-700 font-medium">{run.lead_count_total}</td>
                        <td className="px-6 py-3 text-green-600">{run.lead_count_new}</td>
                        <td className="px-6 py-3 text-blue-600">{run.lead_count_updated}</td>
                        <td className="px-6 py-3 text-gray-500">{run.lead_count_skipped}</td>
                        <td className="px-6 py-3 text-red-600">{run.lead_count_error}</td>
                        <td className="px-6 py-3 text-red-500 text-xs max-w-[200px] truncate">{run.error_message || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {syncRunsPages > 1 && (
                <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
                  <span>{syncRunsTotal} runs</span>
                  <div className="flex gap-2">
                    <button onClick={() => setSyncPage(p => Math.max(1, p - 1))} disabled={syncPage === 1} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">&#8592;</button>
                    <span className="px-3 py-1">Page {syncPage}/{syncRunsPages}</span>
                    <button onClick={() => setSyncPage(p => Math.min(syncRunsPages, p + 1))} disabled={syncPage === syncRunsPages} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">&#8594;</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── API CALLS TAB ─────────────────────────────────── */}
      {tab === 'api_calls' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {loadingApiCalls ? (
            <div className="p-12 text-center text-gray-400">Loading...</div>
          ) : apiCalls.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No API calls logged yet</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <th className="px-6 py-3">Time</th>
                      <th className="px-6 py-3">Method</th>
                      <th className="px-6 py-3">Endpoint</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Latency</th>
                      <th className="px-6 py-3">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {apiCalls.map(call => (
                      <tr key={call.id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-gray-600 text-xs">{formatDate(call.logged_at)}</td>
                        <td className="px-6 py-3">
                          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">{call.request_method}</span>
                        </td>
                        <td className="px-6 py-3 text-gray-700 font-mono text-xs max-w-[300px] truncate">{call.api_endpoint}</td>
                        <td className="px-6 py-3">
                          <span className={`text-xs font-medium ${call.response_status >= 200 && call.response_status < 300 ? 'text-green-600' : call.response_status > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {call.response_status || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-600 text-xs">{call.latency_ms}ms</td>
                        <td className="px-6 py-3 text-red-500 text-xs max-w-[200px] truncate">{call.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {apiCallsPages > 1 && (
                <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
                  <span>{apiCallsTotal} calls</span>
                  <div className="flex gap-2">
                    <button onClick={() => setApiPage(p => Math.max(1, p - 1))} disabled={apiPage === 1} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">&#8592;</button>
                    <span className="px-3 py-1">Page {apiPage}/{apiCallsPages}</span>
                    <button onClick={() => setApiPage(p => Math.min(apiCallsPages, p + 1))} disabled={apiPage === apiCallsPages} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">&#8594;</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── LEAD MAP TAB ──────────────────────────────────── */}
      {tab === 'lead_map' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {loadingLeads ? (
            <div className="p-12 text-center text-gray-400">Loading...</div>
          ) : leadMappings.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No lead mappings yet — run a sync first</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <th className="px-6 py-3">LSQ Lead ID</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Patient</th>
                      <th className="px-6 py-3">UHID</th>
                      <th className="px-6 py-3">Phone</th>
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3">Last Synced</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {leadMappings.map(m => (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-mono text-xs text-gray-700">{m.lsq_lead_id}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(m.sync_status)}`}>{m.sync_status}</span>
                        </td>
                        <td className="px-6 py-3 text-gray-900 font-medium">{m.name_full || '—'}</td>
                        <td className="px-6 py-3 font-mono text-xs text-gray-600">{m.uhid || '—'}</td>
                        <td className="px-6 py-3 text-gray-600">{m.phone || '—'}</td>
                        <td className="px-6 py-3">
                          {m.patient_category ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.patient_category === 'insured' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                              {m.patient_category}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-3 text-gray-500 text-xs">{formatDate(m.synced_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {leadPages > 1 && (
                <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm text-gray-600">
                  <span>{leadTotal} leads</span>
                  <div className="flex gap-2">
                    <button onClick={() => setLeadPage(p => Math.max(1, p - 1))} disabled={leadPage === 1} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">&#8592;</button>
                    <span className="px-3 py-1">Page {leadPage}/{leadPages}</span>
                    <button onClick={() => setLeadPage(p => Math.min(leadPages, p + 1))} disabled={leadPage === leadPages} className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">&#8594;</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
