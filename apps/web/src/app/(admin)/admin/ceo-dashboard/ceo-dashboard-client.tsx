'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';
const REFRESH_INTERVAL = 900000; // 15 minutes

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
  previous_day_value: string | null;
  previous_week_value: string | null;
  previous_month_value: string | null;
  ytd_value: string | null;
}

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
    default: return Math.round(num).toLocaleString('en-IN') + (unit && unit !== 'count' ? ` ${unit}` : '');
  }
}

const statusColor: Record<string, { bg: string; text: string; border: string }> = {
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  neutral: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
};

export function CeoDashboardClient() {
  const [kpis, setKpis] = useState<KpiValue[]>([]);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scorecardDate, setScorecardDate] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [kpiData, snap] = await Promise.all([
        trpcQuery('dashboards.getLatestKpiScorecard', { hospital_id: HOSPITAL_ID, tier: 4 }),
        trpcQuery('dashboards.getLatestSnapshot', { hospital_id: HOSPITAL_ID, interval: 'daily' }),
      ]);
      setKpis(kpiData?.items || []);
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

  // Separate financial KPIs and operational KPIs
  const financialKpis = kpis.filter(k => k.category === 'finance' || k.category === 'billing');
  const operationalKpis = kpis.filter(k => k.category !== 'finance' && k.category !== 'billing');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <span className="text-gray-900">CEO Dashboard</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Network Executive Dashboard</h1>
            <p className="text-sm text-gray-500">
              Tier 4 — Performance date: {scorecardDate || '—'} | Refreshes every 15min
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/gm-dashboard" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">GM View</Link>
            <Link href="/admin/mod-dashboard" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">MOD View</Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Financial Headline Metrics */}
        {snapshot && (
          <div className="bg-white border rounded-2xl p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Financial Snapshot</h2>
            <div className="grid grid-cols-5 gap-4 dash-grid-5">
              {[
                { label: 'Revenue MTD', value: snapshot.revenue_month_to_date, format: 'currency' },
                { label: 'Budget', value: snapshot.revenue_budget, format: 'currency' },
                { label: 'EBITDA', value: snapshot.ebitda, format: 'currency' },
                { label: 'EBITDA Margin', value: snapshot.ebitda_margin_pct, format: 'percentage' },
                { label: 'Admissions YTD', value: snapshot.admission_volume_ytd, format: 'integer' },
              ].map((m, i) => (
                <div key={i}>
                  <div className="text-xs text-gray-500">{m.label}</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">
                    {formatValue(String(m.value ?? ''), m.format, null)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KPI Grid */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading executive KPIs...</div>
        ) : kpis.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No Tier 4 KPI values recorded for yesterday.</div>
            <p className="text-sm text-gray-400">
              Seed KPIs have been created. Record daily values to populate this dashboard.
            </p>
          </div>
        ) : (
          <>
            {/* Financial KPIs */}
            {financialKpis.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Revenue & Claims</h2>
                <div className="grid grid-cols-3 gap-4 dash-grid-3">
                  {financialKpis.map(kpi => {
                    const colors = statusColor[kpi.status || 'neutral'];
                    return (
                      <div key={kpi.kpi_code} className={`rounded-xl p-5 border ${colors.border} ${colors.bg}`}>
                        <div className="text-xs text-gray-500 mb-1">{kpi.kpi_name}</div>
                        <div className={`text-3xl font-bold ${colors.text}`}>
                          {formatValue(kpi.actual_value, kpi.display_format, kpi.unit)}
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs">
                          <span className="text-gray-400">
                            Target: {formatValue(kpi.target_value || kpi.definition_target, kpi.display_format, kpi.unit)}
                          </span>
                          {kpi.trend_direction && (
                            <span className={`font-medium ${
                              kpi.trend_direction === 'up' ? 'text-green-600' :
                              kpi.trend_direction === 'down' ? 'text-red-600' : 'text-gray-400'
                            }`}>
                              {kpi.trend_direction === 'up' ? '↑' : kpi.trend_direction === 'down' ? '↓' : '→'}
                              {kpi.trend_pct ? ` ${parseFloat(kpi.trend_pct).toFixed(1)}%` : ''}
                            </span>
                          )}
                        </div>
                        {/* Comparison row */}
                        {(kpi.previous_week_value || kpi.previous_month_value) && (
                          <div className="flex gap-4 mt-2 pt-2 border-t border-gray-200/50 text-xs text-gray-400">
                            {kpi.previous_week_value && (
                              <span>Last week: {formatValue(kpi.previous_week_value, kpi.display_format, kpi.unit)}</span>
                            )}
                            {kpi.previous_month_value && (
                              <span>Last month: {formatValue(kpi.previous_month_value, kpi.display_format, kpi.unit)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Operational KPIs */}
            {operationalKpis.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Quality & Operations</h2>
                <div className="grid grid-cols-4 gap-3 dash-grid-4">
                  {operationalKpis.map(kpi => {
                    const colors = statusColor[kpi.status || 'neutral'];
                    return (
                      <div key={kpi.kpi_code} className={`rounded-xl p-4 border ${colors.border} ${colors.bg}`}>
                        <div className="text-xs text-gray-500">{kpi.kpi_name}</div>
                        <div className={`text-xl font-bold mt-1 ${colors.text}`}>
                          {formatValue(kpi.actual_value, kpi.display_format, kpi.unit)}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">
                            vs {formatValue(kpi.target_value || kpi.definition_target, kpi.display_format, kpi.unit)}
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
            )}
          </>
        )}

        {/* Hospital Comparison Placeholder */}
        <div className="bg-white border rounded-2xl p-6 mt-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Hospital Comparison</h2>
          <div className="text-center py-8 text-gray-400 text-sm">
            Multi-site comparison available when additional hospitals are onboarded.
            <br />Currently showing: EHRC Race Course Road (single site).
          </div>
        </div>
      </div>
    </div>
  );
}
