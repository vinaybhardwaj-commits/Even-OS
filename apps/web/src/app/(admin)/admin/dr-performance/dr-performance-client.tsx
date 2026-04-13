'use client';

import { useState, useEffect } from 'react';

interface DRDrill {
  id: string;
  drill_type: string;
  scenario_name: string;
  started_at: string;
  completed_at?: string;
  target_rto_minutes?: number;
  actual_rto_minutes?: number;
  target_rpo_minutes?: number;
  actual_rpo_minutes?: number;
  passed?: boolean;
  notes?: string;
}

interface PerformanceBaseline {
  id: string;
  test_name: string;
  test_type: string;
  concurrent_users?: number;
  avg_response_ms?: number;
  p99_response_ms?: number;
  error_rate?: number;
  throughput_rps?: number;
  tested_at: string;
}

interface HealthSnapshot {
  id: string;
  snapshot_type: string;
  api_uptime_pct?: number;
  avg_response_ms?: number;
  p99_response_ms?: number;
  error_rate_pct?: number;
  active_sessions?: number;
  db_pool_utilization_pct?: number;
  memory_usage_mb?: number;
  cpu_usage_pct?: number;
  disk_usage_pct?: number;
  cache_hit_rate_pct?: number;
  snapshot_at: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export default function DrPerformanceClient() {
  const [drills, setDrills] = useState<DRDrill[]>([]);
  const [baselines, setBaselines] = useState<PerformanceBaseline[]>([]);
  const [latestHealth, setLatestHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dr');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [drillsData, baselinesData, healthData] = await Promise.all([
        trpcQuery('hardening.listDrills', { limit: 20 }),
        trpcQuery('hardening.listPerformanceBaselines', { limit: 20 }),
        trpcQuery('hardening.getLatestHealthSnapshot'),
      ]);
      setDrills(drillsData.drills || []);
      setBaselines(baselinesData.baselines || []);
      setLatestHealth(healthData);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function capturHealthSnapshot() {
    try {
      await trpcMutate('hardening.captureHealthSnapshot', { snapshot_type: 'manual' });
      loadData();
    } catch (err) {
      console.error('Error capturing snapshot:', err);
    }
  }

  const formatDate = (date: string) => new Date(date).toLocaleDateString();
  const formatTime = (date: string) => new Date(date).toLocaleTimeString();

  if (loading) return <div style={{ padding: '1rem' }}>Loading...</div>;

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* System Health Card */}
      {latestHealth && (
        <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600' }}>Current System Health</h3>
              <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                Last updated: {formatDate(latestHealth.snapshot_at)} at {formatTime(latestHealth.snapshot_at)}
              </p>
            </div>
            <button
              onClick={capturHealthSnapshot}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                background: '#2563eb',
                color: '#fff',
                borderRadius: '0.375rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Capture Snapshot
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>API Uptime</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.api_uptime_pct}%</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Avg Response</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.avg_response_ms}ms</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>P99 Response</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.p99_response_ms}ms</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Error Rate</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.error_rate_pct}%</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Active Sessions</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.active_sessions}</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>DB Pool</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.db_pool_utilization_pct}%</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Memory</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.memory_usage_mb}MB</p>
            </div>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '0.375rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>CPU</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{latestHealth.cpu_usage_pct}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>
          {['dr', 'perf'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.75rem 1rem',
                fontSize: '0.875rem',
                fontWeight: activeTab === tab ? '600' : '400',
                color: activeTab === tab ? '#1f2937' : '#6b7280',
                borderBottom: activeTab === tab ? '2px solid #2563eb' : 'none',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {tab === 'dr' ? 'DR Drills' : 'Performance'}
            </button>
          ))}
        </div>

        <div style={{ marginTop: '1rem' }}>
          {/* DR Drills Tab */}
          {activeTab === 'dr' && (
            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>DR Drill History</h3>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>Track disaster recovery drill results and metrics</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.875rem' }}>
                  <thead style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Scenario</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Start Date</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>RTO Target/Actual</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drills.map(drill => (
                      <tr key={drill.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '0.5rem' }}>
                          <span style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{drill.drill_type}</span>
                        </td>
                        <td style={{ padding: '0.5rem', fontWeight: '600' }}>{drill.scenario_name}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>{formatDate(drill.started_at)}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
                          {drill.target_rto_minutes ? (
                            <span>
                              {drill.target_rto_minutes}m
                              {drill.actual_rto_minutes && ` / ${drill.actual_rto_minutes}m`}
                            </span>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>N/A</span>
                          )}
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          {drill.passed === undefined ? (
                            <span style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem' }}>Ongoing</span>
                          ) : drill.passed ? (
                            <span style={{ padding: '0.25rem 0.5rem', background: '#dcfce7', color: '#166534', borderRadius: '0.25rem', fontSize: '0.75rem' }}>Passed</span>
                          ) : (
                            <span style={{ padding: '0.25rem 0.5rem', background: '#fee2e2', color: '#7f1d1d', borderRadius: '0.25rem', fontSize: '0.75rem' }}>Failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {drills.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                  No DR drills recorded yet
                </div>
              )}
            </div>
          )}

          {/* Performance Baselines Tab */}
          {activeTab === 'perf' && (
            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>Performance Test Results</h3>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>Load and stress test baselines for system capacity</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.875rem' }}>
                  <thead style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Test Name</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Users</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Avg/P99 Response</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Error Rate</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baselines.map(baseline => (
                      <tr key={baseline.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '0.5rem', fontWeight: '600' }}>{baseline.test_name}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <span style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{baseline.test_type}</span>
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          {baseline.concurrent_users || 'N/A'}
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
                          {baseline.avg_response_ms}ms / {baseline.p99_response_ms}ms
                        </td>
                        <td style={{ padding: '0.5rem', ...(baseline.error_rate && baseline.error_rate > 0.5 ? { color: '#dc2626', fontWeight: '600' } : {}) }}>
                          {baseline.error_rate?.toFixed(2)}%
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>{formatDate(baseline.tested_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {baselines.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                  No performance baselines recorded yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
