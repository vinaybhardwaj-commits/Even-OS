'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface LLMHealth {
  status: 'online' | 'offline' | 'degraded';
  latency_ms: number;
  model?: string;
}

interface ModuleCard {
  moduleId: string;
  moduleName: string;
  cardCount: number;
  lastRun: string | null;
  enabled: boolean;
}

interface JobStatus {
  jobName: string;
  lastRun: string | null;
  status: 'completed' | 'partial' | 'skipped' | 'running' | 'error';
  nextRun?: string;
}

interface CardMetrics {
  totalActive: number;
  expiredPending: number;
  feedbackHelpful: number;
  feedbackNotHelpful: number;
  feedbackNoFeedback: number;
}

// ─── tRPC Helpers ─────────────────────────────────────────
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

// ─── Job Runner ───────────────────────────────────────────
async function runJob(jobName: string) {
  const res = await fetch(`/api/ai/jobs/${jobName}`, {
    method: 'POST',
    headers: { 'x-admin-key': 'helloeven1981!' },
  });
  if (!res.ok) throw new Error(`Job failed: ${res.statusText}`);
  return await res.json();
}

// ─── Status Badge ─────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const bgColor = {
    online: 'bg-green-900',
    offline: 'bg-red-900',
    degraded: 'bg-yellow-900',
    completed: 'bg-green-900',
    partial: 'bg-yellow-900',
    skipped: 'bg-gray-700',
    running: 'bg-blue-900',
    error: 'bg-red-900',
  }[status] || 'bg-gray-700';

  const textColor = {
    online: 'text-green-300',
    offline: 'text-red-300',
    degraded: 'text-yellow-300',
    completed: 'text-green-300',
    partial: 'text-yellow-300',
    skipped: 'text-gray-300',
    running: 'text-blue-300',
    error: 'text-red-300',
  }[status] || 'text-gray-300';

  return (
    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${bgColor} ${textColor}`}>
      {status}
    </span>
  );
}

// ─── Format Timestamp ─────────────────────────────────────
function formatTime(isoString: string | null) {
  if (!isoString) return 'Never';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return 'Invalid';
  }
}

function formatDate(isoString: string | null) {
  if (!isoString) return 'Never';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-IN');
  } catch {
    return 'Invalid';
  }
}

// ─── Main Component ──────────────────────────────────────
export default function AISettingsClient() {
  // LLM Health
  const [llmHealth, setLLMHealth] = useState<LLMHealth | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [timeout, setTimeout] = useState(30000);

  // Module state
  const [modules, setModules] = useState<ModuleCard[]>([]);
  const [moduleLoading, setModuleLoading] = useState(true);

  // Job state
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [jobLoading, setJobLoading] = useState(true);
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());

  // Card metrics
  const [metrics, setMetrics] = useState<CardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // UI state
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ─── Fetch Health ──────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    try {
      const data = await trpcQuery('evenAI.getAIHealth');
      if (data) {
        setLLMHealth({
          status: data.status || 'offline',
          latency_ms: data.latency_ms || 0,
          model: data.model,
        });
        setBaseUrl(data.baseUrl || process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || 'http://localhost:11434');
        setTimeout(data.timeout || 30000);
      }
    } catch (err) {
      console.error('Failed to fetch LLM health:', err);
      setError('Failed to load LLM health');
    }
  }, []);

  // ─── Fetch Observatory / Metrics ─────────────────────
  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const data = await trpcQuery('evenAI.getObservatory', { hours: 24 });
      if (data) {
        setMetrics({
          totalActive: data.totalCards || 0,
          expiredPending: data.expiredCards || 0,
          feedbackHelpful: data.helpfulCount || 0,
          feedbackNotHelpful: data.unhelpfulCount || 0,
          feedbackNoFeedback: data.noFeedbackCount || 0,
        });
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  // ─── Fetch Modules ─────────────────────────────────────
  const fetchModules = useCallback(async () => {
    setModuleLoading(true);
    try {
      const data = await trpcQuery('evenAI.listModules');
      if (data && Array.isArray(data)) {
        setModules(
          data.map((m: any) => ({
            moduleId: m.id,
            moduleName: m.name,
            cardCount: m.cardCount || 0,
            lastRun: m.lastRun,
            enabled: m.enabled !== false,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch modules:', err);
    } finally {
      setModuleLoading(false);
    }
  }, []);

  // ─── Fetch Jobs ────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    setJobLoading(true);
    try {
      const data = await trpcQuery('evenAI.listJobs');
      if (data && Array.isArray(data)) {
        setJobs(
          data.map((j: any) => ({
            jobName: j.name,
            lastRun: j.lastRun,
            status: j.status || 'skipped',
            nextRun: j.nextRun,
          }))
        );
      } else {
        // Default job list if query fails
        const defaultJobs = [
          'bed-intelligence',
          'morning-briefing',
          'pharmacy-alerts',
          'clinical-scan',
          'shift-handoff',
          'claim-predictions',
          'nabh-audit',
          'quality-monitor',
          'expire-cards',
          'process-queue',
        ];
        setJobs(defaultJobs.map((name) => ({ jobName: name, lastRun: null, status: 'skipped' })));
      }
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      // Fallback to default jobs
      const defaultJobs = [
        'bed-intelligence',
        'morning-briefing',
        'pharmacy-alerts',
        'clinical-scan',
        'shift-handoff',
        'claim-predictions',
        'nabh-audit',
        'quality-monitor',
        'expire-cards',
        'process-queue',
      ];
      setJobs(defaultJobs.map((name) => ({ jobName: name, lastRun: null, status: 'skipped' })));
    } finally {
      setJobLoading(false);
    }
  }, []);

  // ─── Handle Job Execution ──────────────────────────────
  const handleRunJob = useCallback(
    async (jobName: string) => {
      const newRunning = new Set(runningJobs);
      newRunning.add(jobName);
      setRunningJobs(newRunning);
      setError('');
      setSuccessMsg('');

      try {
        const result = await runJob(jobName);
        setSuccessMsg(`${jobName} executed: ${result.status || 'completed'}`);
        // Refresh jobs after short delay
        window.setTimeout(() => { void fetchJobs(); }, 1000);
      } catch (err) {
        setError(`Failed to run ${jobName}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        newRunning.delete(jobName);
        setRunningJobs(newRunning);
      }
    },
    [runningJobs, fetchJobs]
  );

  // ─── Handle Card Cleanup ───────────────────────────────
  const handleExpireCards = useCallback(async () => {
    await handleRunJob('expire-cards');
  }, [handleRunJob]);

  const handleProcessQueue = useCallback(async () => {
    await handleRunJob('process-queue');
  }, [handleRunJob]);

  // ─── Initial Load ──────────────────────────────────────
  useEffect(() => {
    fetchHealth();
    fetchMetrics();
    fetchModules();
    fetchJobs();

    // Refresh health every 30s
    const healthInterval = setInterval(fetchHealth, 30000);
    return () => clearInterval(healthInterval);
  }, [fetchHealth, fetchMetrics, fetchModules, fetchJobs]);

  // ─── Render ────────────────────────────────────────────

  return (
    <div
      style={{
        background: '#0f1419',
        color: '#e0e0e0',
        minHeight: '100vh',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            AI Settings
          </h1>
          <p style={{ color: '#a0a0a0', fontSize: '0.875rem' }}>
            Manage LLM configuration, modules, background jobs, and card lifecycle
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div
            style={{
              background: '#7f1d1d',
              border: '1px solid #ef4444',
              color: '#fecaca',
              padding: '1rem',
              borderRadius: '0.5rem',
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}
        {successMsg && (
          <div
            style={{
              background: '#064e3b',
              border: '1px solid #10b981',
              color: '#a7f3d0',
              padding: '1rem',
              borderRadius: '0.5rem',
              marginBottom: '1rem',
            }}
          >
            {successMsg}
          </div>
        )}

        {/* LLM Configuration Panel */}
        <div
          style={{
            background: '#16213e',
            border: '1px solid #0f3460',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            LLM Configuration
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
            {/* Model & Status */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                Model
              </label>
              <div style={{ fontSize: '1rem', fontWeight: '500' }}>
                {llmHealth?.model || 'Qwen 2.5 14B'}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                Status
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <StatusBadge status={llmHealth?.status || 'offline'} />
                <span style={{ fontSize: '0.875rem', color: '#a0a0a0' }}>
                  ({llmHealth?.latency_ms || 0}ms)
                </span>
              </div>
            </div>

            {/* Base URL */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                Base URL
              </label>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  color: '#a0a0a0',
                }}
              >
                {baseUrl}
              </div>
            </div>

            {/* Timeout */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                Timeout
              </label>
              <div style={{ fontSize: '0.875rem', color: '#a0a0a0' }}>
                {timeout}ms
              </div>
            </div>
          </div>
        </div>

        {/* Module Toggles */}
        <div
          style={{
            background: '#16213e',
            border: '1px solid #0f3460',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            AI Module Status
          </h2>

          {moduleLoading ? (
            <div style={{ color: '#a0a0a0' }}>Loading modules...</div>
          ) : modules.length === 0 ? (
            <div style={{ color: '#a0a0a0' }}>No modules configured</div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '1rem',
              }}
            >
              {modules.map((mod) => (
                <div
                  key={mod.moduleId}
                  style={{
                    background: '#0f1419',
                    border: `1px solid ${mod.enabled ? '#0f3460' : '#1f2937'}`,
                    borderRadius: '0.5rem',
                    padding: '1rem',
                  }}
                >
                  <div style={{ marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '0.25rem' }}>
                      {mod.moduleName}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: '#7C3AED' }}>
                      {mod.cardCount} cards
                    </div>
                  </div>

                  <div style={{ fontSize: '0.8rem', color: '#a0a0a0', marginBottom: '0.75rem' }}>
                    Last run: {formatTime(mod.lastRun)}
                  </div>

                  <button
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: mod.enabled ? '#7C3AED' : '#4b5563',
                      color: '#fff',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      opacity: 0.8,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                  >
                    {mod.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Job Management */}
        <div
          style={{
            background: '#16213e',
            border: '1px solid #0f3460',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            Background Jobs
          </h2>

          {jobLoading ? (
            <div style={{ color: '#a0a0a0' }}>Loading jobs...</div>
          ) : jobs.length === 0 ? (
            <div style={{ color: '#a0a0a0' }}>No jobs available</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #0f3460' }}>
                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a0a0a0', fontWeight: '600' }}>
                      Job Name
                    </th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a0a0a0', fontWeight: '600' }}>
                      Last Run
                    </th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a0a0a0', fontWeight: '600' }}>
                      Status
                    </th>
                    <th style={{ textAlign: 'right', padding: '0.75rem', color: '#a0a0a0', fontWeight: '600' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.jobName} style={{ borderBottom: '1px solid #0f3460' }}>
                      <td style={{ padding: '0.75rem', fontFamily: 'monospace', color: '#7C3AED' }}>
                        {job.jobName}
                      </td>
                      <td style={{ padding: '0.75rem', color: '#a0a0a0' }}>
                        {formatTime(job.lastRun)}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <StatusBadge status={job.status} />
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                        <button
                          onClick={() => handleRunJob(job.jobName)}
                          disabled={runningJobs.has(job.jobName)}
                          style={{
                            padding: '0.4rem 0.8rem',
                            background: runningJobs.has(job.jobName) ? '#4b5563' : '#7C3AED',
                            color: '#fff',
                            fontSize: '0.8rem',
                            fontWeight: '500',
                            border: 'none',
                            borderRadius: '0.375rem',
                            cursor: runningJobs.has(job.jobName) ? 'not-allowed' : 'pointer',
                            opacity: runningJobs.has(job.jobName) ? 0.5 : 0.8,
                          }}
                          onMouseEnter={(e) => {
                            if (!runningJobs.has(job.jobName)) e.currentTarget.style.opacity = '1';
                          }}
                          onMouseLeave={(e) => {
                            if (!runningJobs.has(job.jobName)) e.currentTarget.style.opacity = '0.8';
                          }}
                        >
                          {runningJobs.has(job.jobName) ? 'Running...' : 'Run Now'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Card Management */}
        <div
          style={{
            background: '#16213e',
            border: '1px solid #0f3460',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            Card Management
          </h2>

          {metricsLoading ? (
            <div style={{ color: '#a0a0a0' }}>Loading metrics...</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {/* Total Active Cards */}
                <div
                  style={{
                    background: '#0f1419',
                    border: '1px solid #0f3460',
                    borderRadius: '0.5rem',
                    padding: '1rem',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Total Active Cards
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#10b981' }}>
                    {metrics?.totalActive || 0}
                  </div>
                </div>

                {/* Expired Pending */}
                <div
                  style={{
                    background: '#0f1419',
                    border: '1px solid #0f3460',
                    borderRadius: '0.5rem',
                    padding: '1rem',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Expired Pending Cleanup
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
                    {metrics?.expiredPending || 0}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={handleExpireCards}
                  disabled={runningJobs.has('expire-cards')}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: runningJobs.has('expire-cards') ? '#4b5563' : '#f59e0b',
                    color: '#000',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: runningJobs.has('expire-cards') ? 'not-allowed' : 'pointer',
                    opacity: runningJobs.has('expire-cards') ? 0.5 : 0.85,
                  }}
                  onMouseEnter={(e) => {
                    if (!runningJobs.has('expire-cards')) e.currentTarget.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    if (!runningJobs.has('expire-cards')) e.currentTarget.style.opacity = '0.85';
                  }}
                >
                  {runningJobs.has('expire-cards') ? 'Expiring...' : 'Expire Old Cards'}
                </button>

                <button
                  onClick={handleProcessQueue}
                  disabled={runningJobs.has('process-queue')}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: runningJobs.has('process-queue') ? '#4b5563' : '#7C3AED',
                    color: '#fff',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: runningJobs.has('process-queue') ? 'not-allowed' : 'pointer',
                    opacity: runningJobs.has('process-queue') ? 0.5 : 0.85,
                  }}
                  onMouseEnter={(e) => {
                    if (!runningJobs.has('process-queue')) e.currentTarget.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    if (!runningJobs.has('process-queue')) e.currentTarget.style.opacity = '0.85';
                  }}
                >
                  {runningJobs.has('process-queue') ? 'Processing...' : 'Process Queue'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Feedback Summary */}
        <div
          style={{
            background: '#16213e',
            border: '1px solid #0f3460',
            borderRadius: '0.5rem',
            padding: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>
            Feedback Summary
          </h2>

          {metricsLoading ? (
            <div style={{ color: '#a0a0a0' }}>Loading feedback metrics...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              {/* Helpful */}
              <div
                style={{
                  background: '#0f1419',
                  border: '1px solid #0f3460',
                  borderRadius: '0.5rem',
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Helpful
                </div>
                <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#10b981' }}>
                  {metrics?.feedbackHelpful || 0}
                </div>
              </div>

              {/* Not Helpful */}
              <div
                style={{
                  background: '#0f1419',
                  border: '1px solid #0f3460',
                  borderRadius: '0.5rem',
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Not Helpful
                </div>
                <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#ef4444' }}>
                  {metrics?.feedbackNotHelpful || 0}
                </div>
              </div>

              {/* No Feedback */}
              <div
                style={{
                  background: '#0f1419',
                  border: '1px solid #0f3460',
                  borderRadius: '0.5rem',
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  No Feedback
                </div>
                <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#a0a0a0' }}>
                  {metrics?.feedbackNoFeedback || 0}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
