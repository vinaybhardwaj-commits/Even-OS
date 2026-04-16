'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';
const REFRESH_INTERVAL = 300000; // 5 minutes

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

interface KpiValue {
  kpi_name: string;
  kpi_code: string;
  actual_value: string;
  target_value: string | null;
  variance_pct: string | null;
  status: string;
  trend_direction: string | null;
  trend_pct: string | null;
  unit: string | null;
  display_format: string | null;
  category: string | null;
  definition_target: string | null;
}

const statusColor: Record<string, { bg: string; text: string; border: string }> = {
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  neutral: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
};

const trendArrow: Record<string, string> = {
  up: '↑',
  down: '↓',
  stable: '→',
};

const categoryLabels: Record<string, string> = {
  census: 'Census & Occupancy',
  finance: 'Revenue & Finance',
  quality: 'Quality',
  staffing: 'Staffing',
  infection: 'Infection Control',
  los: 'Length of Stay',
  billing: 'Billing & Claims',
  compliance: 'NABH Compliance',
  incidents: 'Incidents',
};

function formatValue(val: string | null, format: string | null, unit: string | null): string {
  if (!val) return '—';
  const num = parseFloat(val);
  if (isNaN(num)) return val;

  switch (format) {
    case 'currency': {
      if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
      if (num >= 100000) return `₹${(num / 100000).toFixed(2)} L`;
      if (num >= 1000) return `₹${(num / 1000).toFixed(1)} K`;
      return `₹${num.toLocaleString('en-IN')}`;
    }
    case 'percentage': return `${num.toFixed(1)}%`;
    case 'decimal_2': return num.toFixed(2) + (unit ? ` ${unit}` : '');
    case 'integer':
    default: return Math.round(num).toLocaleString('en-IN') + (unit && unit !== 'count' ? ` ${unit}` : '');
  }
}

export function GmDashboardClient() {
  const [scorecard, setScorecard] = useState<KpiValue[]>([]);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scorecardDate, setScorecardDate] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [kpiData, snap] = await Promise.all([
        trpcQuery('dashboards.getLatestKpiScorecard', { hospital_id: HOSPITAL_ID, tier: 3 }),
        trpcQuery('dashboards.getLatestSnapshot', { hospital_id: HOSPITAL_ID, interval: 'daily' }),
      ]);
      setScorecard(kpiData?.items || []);
      setScorecardDate(kpiData?.date || '');
      setSnapshot(snap);
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

  // Group scorecard by category
  const grouped = scorecard.reduce<Record<string, KpiValue[]>>((acc, kpi) => {
    const cat = kpi.category || 'uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(kpi);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <span className="text-gray-900">GM Dashboard</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">GM Performance Dashboard</h1>
            <p className="text-sm text-gray-500">
              Tier 3 — Yesterday&apos;s performance ({scorecardDate || '—'}) | Refreshes every 5min
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/mod-dashboard" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">MOD View</Link>
            <Link href="/admin/wall-view" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">Wall View</Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Quick Snapshot Row (from daily snapshot) */}
        {snapshot && (
          <div className="grid grid-cols-5 gap-3 mb-6 dash-grid-5">
            {[
              { label: 'Admissions', value: snapshot.admissions_yesterday, format: 'integer' },
              { label: 'Discharges', value: snapshot.discharges_yesterday, format: 'integer' },
              { label: 'Revenue', value: snapshot.revenue_yesterday, format: 'currency' },
              { label: 'Avg LOS', value: snapshot.los_avg_current, format: 'decimal_2', unit: 'days' },
              { label: 'NABH', value: snapshot.nabh_compliance_pct, format: 'percentage' },
            ].map((m, i) => (
              <div key={i} className="bg-white border rounded-xl p-4">
                <div className="text-xs text-gray-500">{m.label}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">
                  {formatValue(String(m.value ?? ''), m.format, m.unit || null)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* KPI Scorecard by Category */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading scorecard...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No KPI values recorded for yesterday.</div>
            <p className="text-sm text-gray-400">
              Run the migration at <code className="bg-gray-100 px-1 rounded">/api/migrations/dashboards</code> first,
              then record daily values via the dashboards.recordKpiValue endpoint.
            </p>
          </div>
        ) : (
          Object.entries(grouped).sort().map(([cat, items]) => (
            <div key={cat} className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {categoryLabels[cat] || cat}
              </h2>
              <div className="grid grid-cols-3 gap-3 dash-grid-3">
                {items.map(kpi => {
                  const colors = statusColor[kpi.status || 'neutral'];
                  return (
                    <div key={kpi.kpi_code} className={`rounded-xl p-4 border ${colors.border} ${colors.bg}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{kpi.kpi_name}</span>
                        {kpi.trend_direction && (
                          <span className={`text-xs font-medium ${
                            kpi.trend_direction === 'up' ? 'text-green-600' :
                            kpi.trend_direction === 'down' ? 'text-red-600' : 'text-gray-400'
                          }`}>
                            {trendArrow[kpi.trend_direction] || ''} {kpi.trend_pct ? `${parseFloat(kpi.trend_pct).toFixed(1)}%` : ''}
                          </span>
                        )}
                      </div>
                      <div className={`text-2xl font-bold mt-1 ${colors.text}`}>
                        {formatValue(kpi.actual_value, kpi.display_format, kpi.unit)}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-400">
                          Target: {formatValue(kpi.target_value || kpi.definition_target, kpi.display_format, kpi.unit)}
                        </span>
                        {kpi.variance_pct && (
                          <span className={`text-xs font-medium ${colors.text}`}>
                            {parseFloat(kpi.variance_pct) >= 0 ? '+' : ''}{parseFloat(kpi.variance_pct).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
