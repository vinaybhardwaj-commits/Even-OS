'use client';

import { useState, useEffect, useRef } from 'react';

// Types
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  model_name: string;
  latency_ms: number;
  last_inference_at: string;
  cards_today: number;
  queue_depth: number;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  module: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: 'success' | 'error' | 'timeout';
  prompt_text: string;
  response_text: string;
}

interface LatencyBucket {
  hour: string;
  p50_ms: number;
  p95_ms: number;
}

interface ModuleStats {
  module: string;
  count: number;
}

interface StatusCount {
  status: 'success' | 'error' | 'timeout';
  count: number;
}

interface TemplateRule {
  id: string;
  module: string;
  rule_name: string;
  trigger: string;
  active: boolean;
  fire_count: number;
  last_fired_at: string | null;
  condition_config: Record<string, any>;
  card_template: Record<string, any>;
}

interface ClaimRubric {
  id: string;
  tpa_name: string;
  category: string;
  rule_type: string;
  confidence: number;
  source: string;
  active: boolean;
  rule_data: Record<string, any>;
}

interface ObservatoryData {
  health: HealthStatus;
  latency_24h: LatencyBucket[];
  stats: {
    by_module: ModuleStats[];
    by_status: StatusCount[];
    feedback_distribution: Record<string, number>;
    response_rate: number;
  };
}

// TRPC helpers
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

export function AIObservatoryClient() {
  const [tab, setTab] = useState<'overview' | 'audit-log' | 'template-rules' | 'claim-rubrics'>('overview');
  const [data, setData] = useState<ObservatoryData | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [templateRules, setTemplateRules] = useState<TemplateRule[]>([]);
  const [claimRubrics, setClaimRubrics] = useState<ClaimRubric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState<AuditLogEntry | null>(null);
  const [tpaFilter, setTpaFilter] = useState('');
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [editingRubric, setEditingRubric] = useState<ClaimRubric | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load all data
  const loadData = async () => {
    try {
      setError(null);
      setLoading(true);
      const [obs, audit, rules, rubrics] = await Promise.all([
        trpcQuery('evenAI.getObservatory', { hours: 24 }),
        trpcQuery('evenAI.getAuditLog', { limit: 50 }),
        trpcQuery('evenAI.getTemplateRules'),
        trpcQuery('evenAI.getClaimRubrics'),
      ]);
      setData(obs);
      setAuditLog(audit || []);
      setTemplateRules(rules || []);
      setClaimRubrics(rubrics || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(loadData, 30000);
    }
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [autoRefresh]);

  const handleToggleRule = async (ruleId: string, currentActive: boolean) => {
    try {
      await trpcMutate('evenAI.updateTemplateRule', {
        id: ruleId,
        updates: { active: !currentActive },
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    }
  };

  const handleUpdateRubric = async () => {
    if (!editingRubric) return;
    try {
      await trpcMutate('evenAI.updateClaimRubric', {
        id: editingRubric.id,
        updates: { rule_data: editingRubric.rule_data },
      });
      setEditingRubric(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rubric');
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-IN');
  };

  const formatLatency = (ms: number) => {
    if (ms < 3000) return { color: 'text-green-600', label: `${ms}ms` };
    if (ms < 10000) return { color: 'text-yellow-600', label: `${ms}ms` };
    return { color: 'text-red-600', label: `${ms}ms` };
  };

  const formatTokens = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const uniqueTPAs = [...new Set(claimRubrics.map(r => r.tpa_name))];
  const filteredRubrics = tpaFilter
    ? claimRubrics.filter(r => r.tpa_name === tpaFilter)
    : claimRubrics;

  const skeletonLoading = (
    <div className="space-y-4">
      <div className="h-32 bg-gray-200 rounded-xl animate-pulse" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-40 bg-gray-200 rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );

  if (loading && !data) return <div className="space-y-4">{skeletonLoading}</div>;

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-between items-center bg-white rounded-lg p-4 border border-gray-200">
        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="w-4 h-4"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={loadData}
            className="px-3 py-1 text-sm bg-violet-600 text-white rounded hover:bg-violet-700"
          >
            Refresh now
          </button>
        </div>
        <span className="text-xs text-gray-500">
          Last updated: {new Date().toLocaleTimeString('en-IN')}
        </span>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 bg-white rounded-lg p-4 border border-gray-200">
        {['overview', 'audit-log', 'template-rules', 'claim-rubrics'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`px-4 py-2 text-sm font-medium rounded transition ${
              tab === t
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t === 'overview' && 'Overview'}
            {t === 'audit-log' && 'Audit Log'}
            {t === 'template-rules' && 'Template Rules'}
            {t === 'claim-rubrics' && 'Claim Rubrics'}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && data && (
        <div className="space-y-6">
          {/* Section 1: Status Panel */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Health Status</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={`inline-block w-3 h-3 rounded-full ${
                      data.health.status === 'healthy'
                        ? 'bg-green-500'
                        : data.health.status === 'degraded'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  />
                  <span className="font-semibold text-gray-800">{data.health.status.toUpperCase()}</span>
                </div>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>
                    <span className="font-medium">Model:</span> {data.health.model_name}
                  </p>
                  <p>
                    <span className="font-medium">Latency:</span> {data.health.latency_ms}ms
                  </p>
                  <p>
                    <span className="font-medium">Last Inference:</span>{' '}
                    {formatTime(data.health.last_inference_at)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-violet-50 rounded-lg p-3">
                  <p className="text-xs text-violet-600 font-semibold">CARDS TODAY</p>
                  <p className="text-2xl font-bold text-violet-700 mt-1">{data.health.cards_today}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs text-blue-600 font-semibold">QUEUE DEPTH</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">{data.health.queue_depth}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Latency Chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-800 mb-4">24-Hour Latency Distribution</h2>
            <div className="relative h-64 flex items-end gap-1 px-4">
              {/* Red threshold line at 10s */}
              <div
                className="absolute top-0 left-0 right-0 border-t-2 border-red-500 opacity-50"
                style={{ top: `${((10000 / 15000) * 100).toFixed(1)}%` }}
              >
                <span className="absolute -top-5 left-4 text-xs text-red-600 font-semibold">
                  10s threshold
                </span>
              </div>

              {/* Bars */}
              {data.latency_24h.map((bucket, i) => {
                const maxLatency = Math.max(...data.latency_24h.map(b => b.p95_ms), 15000);
                const p50Height = (bucket.p50_ms / maxLatency) * 100;
                const p95Height = (bucket.p95_ms / maxLatency) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="flex items-end justify-center gap-0.5 h-full w-full">
                      <div
                        className="bg-green-400 rounded-t w-1/3"
                        style={{ height: `${p50Height}%` }}
                        title={`p50: ${bucket.p50_ms}ms`}
                      />
                      <div
                        className="bg-orange-400 rounded-t w-1/3"
                        style={{ height: `${p95Height}%` }}
                        title={`p95: ${bucket.p95_ms}ms`}
                      />
                    </div>
                    <span className="text-xs text-gray-500 text-center whitespace-nowrap">
                      {new Date(bucket.hour).getHours()}:00
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-center gap-6 text-xs">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 bg-green-400 rounded" /> P50
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 bg-orange-400 rounded" /> P95
              </span>
            </div>
          </div>

          {/* Section 4: Insight Analytics */}
          <div className="grid grid-cols-2 gap-6">
            {/* By Module */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-4">Requests by Module</h3>
              <div className="space-y-3">
                {data.stats.by_module.map(m => {
                  const maxCount = Math.max(...data.stats.by_module.map(x => x.count), 10);
                  const pct = (m.count / maxCount) * 100;
                  return (
                    <div key={m.module}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{m.module}</span>
                        <span className="text-gray-600">{m.count}</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By Status */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-4">Requests by Status</h3>
              <div className="space-y-3">
                {data.stats.by_status.map(s => {
                  const colors: Record<string, string> = {
                    success: 'bg-green-500',
                    error: 'bg-red-500',
                    timeout: 'bg-yellow-500',
                  };
                  const labels: Record<string, string> = {
                    success: 'Success',
                    error: 'Error',
                    timeout: 'Timeout',
                  };
                  const maxCount = Math.max(...data.stats.by_status.map(x => x.count), 10);
                  const pct = (s.count / maxCount) * 100;
                  return (
                    <div key={s.status}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{labels[s.status]}</span>
                        <span className="text-gray-600">{s.count}</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${colors[s.status]} rounded-full`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Feedback Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-4">Feedback Distribution</h3>
              <div className="space-y-2">
                {Object.entries(data.stats.feedback_distribution).map(([key, count]) => {
                  const total = Object.values(data.stats.feedback_distribution).reduce(
                    (a, b) => a + b,
                    0
                  );
                  const pct = ((count as number) / total) * 100;
                  return (
                    <div key={key} className="text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-700 font-medium capitalize">{key}</span>
                        <span className="text-gray-600">
                          {count} ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Response Rate */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col justify-center">
              <h3 className="font-bold text-gray-800 mb-4">Response Rate</h3>
              <div className="text-center">
                <p className="text-4xl font-bold text-violet-600">
                  {(data.stats.response_rate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500 mt-2">Successful inferences in last 24h</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT LOG TAB */}
      {tab === 'audit-log' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-800 mb-4">AI Audit Log</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Time</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Module</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Tokens</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Latency</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLog.map(entry => {
                  const latencyStyle = formatLatency(entry.latency_ms);
                  const statusColors: Record<string, string> = {
                    success: 'bg-green-100 text-green-700',
                    error: 'bg-red-100 text-red-700',
                    timeout: 'bg-yellow-100 text-yellow-700',
                  };
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600 text-xs whitespace-nowrap">
                        {formatTime(entry.timestamp)}
                      </td>
                      <td className="px-4 py-2 text-gray-800 font-medium">{entry.module}</td>
                      <td className="px-4 py-2 text-gray-600 text-xs">
                        {formatTokens(entry.prompt_tokens)} → {formatTokens(entry.completion_tokens)}
                      </td>
                      <td className={`px-4 py-2 font-semibold text-xs ${latencyStyle.color}`}>
                        {latencyStyle.label}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-1 rounded-full font-medium ${
                            statusColors[entry.status]
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => setSelectedPrompt(entry)}
                          className="text-violet-600 hover:text-violet-700 text-xs font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {auditLog.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      No audit entries
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TEMPLATE RULES TAB */}
      {tab === 'template-rules' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Template Rules</h2>
          <div className="space-y-4">
            {templateRules.map(rule => (
              <div key={rule.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-800">{rule.rule_name}</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {rule.module} • {rule.trigger}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Fired</p>
                      <p className="font-semibold text-gray-800">{rule.fire_count}</p>
                    </div>
                    {rule.last_fired_at && (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Last</p>
                        <p className="text-xs text-gray-700">{formatTime(rule.last_fired_at)}</p>
                      </div>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.active}
                        onChange={() => handleToggleRule(rule.id, rule.active)}
                        className="w-4 h-4"
                      />
                      <span className="text-xs text-gray-600 font-medium">Active</span>
                    </label>
                  </div>
                </div>

                {expandedRule === rule.id && (
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-2 text-xs">
                    <div>
                      <p className="font-semibold text-gray-700 mb-1">Condition Config:</p>
                      <pre className="bg-gray-50 p-2 rounded text-xs overflow-x-auto text-gray-600">
                        {JSON.stringify(rule.condition_config, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-700 mb-1">Card Template:</p>
                      <pre className="bg-gray-50 p-2 rounded text-xs overflow-x-auto text-gray-600">
                        {JSON.stringify(rule.card_template, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                <button
                  onClick={() =>
                    setExpandedRule(expandedRule === rule.id ? null : rule.id)
                  }
                  className="text-xs text-violet-600 hover:text-violet-700 font-medium mt-3"
                >
                  {expandedRule === rule.id ? 'Hide' : 'Show'} details
                </button>
              </div>
            ))}
            {templateRules.length === 0 && (
              <p className="text-center text-gray-400 py-8">No template rules</p>
            )}
          </div>
        </div>
      )}

      {/* CLAIM RUBRICS TAB */}
      {tab === 'claim-rubrics' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Claim Rubric Manager</h2>

          {/* TPA Filter */}
          <div className="mb-4">
            <select
              value={tpaFilter}
              onChange={e => setTpaFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All TPAs</option>
              {uniqueTPAs.map(tpa => (
                <option key={tpa} value={tpa}>
                  {tpa}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">TPA</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Category</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Rule Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Confidence</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Source</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Active</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRubrics.map(rubric => (
                  <tr key={rubric.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800 font-medium">{rubric.tpa_name}</td>
                    <td className="px-4 py-2 text-gray-700">{rubric.category}</td>
                    <td className="px-4 py-2 text-gray-600 text-xs">{rubric.rule_type}</td>
                    <td className="px-4 py-2 text-gray-600 text-xs font-semibold">
                      {(rubric.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{rubric.source}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          rubric.active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {rubric.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setEditingRubric(rubric)}
                        className="text-violet-600 hover:text-violet-700 text-xs font-medium"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredRubrics.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      No matching rubrics
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}

      {/* Prompt/Response Modal */}
      {selectedPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="sticky top-0 bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Prompt & Response</h3>
              <button
                onClick={() => setSelectedPrompt(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h4 className="font-semibold text-gray-800 mb-2 text-sm">Prompt</h4>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto text-gray-600 whitespace-pre-wrap break-words">
                  {selectedPrompt.prompt_text}
                </pre>
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 mb-2 text-sm">Response</h4>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto text-gray-600 whitespace-pre-wrap break-words">
                  {selectedPrompt.response_text}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Rubric Modal */}
      {editingRubric && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Edit Rubric</h3>
              <button
                onClick={() => setEditingRubric(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2 font-medium">
                  {editingRubric.tpa_name} • {editingRubric.category}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rule Data (JSON)
                </label>
                <textarea
                  value={JSON.stringify(editingRubric.rule_data, null, 2)}
                  onChange={e => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setEditingRubric({
                        ...editingRubric,
                        rule_data: parsed,
                      });
                    } catch {
                      // Invalid JSON, just update the text
                    }
                  }}
                  className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditingRubric(null)}
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateRubric}
                  className="px-4 py-2 text-sm bg-violet-600 text-white rounded hover:bg-violet-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
