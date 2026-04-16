'use client';

import { useState, useEffect, useCallback } from 'react';

// Default hospital — will be configurable later via URL param
const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';
const REFRESH_INTERVAL = 30000; // 30 seconds

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

interface Snapshot {
  census_current: number;
  census_target: number;
  occupancy_pct: string;
  pending_admissions_count: number;
  pending_admissions_overdue_count: number;
  pending_discharges_count: number;
  pending_discharges_overdue_count: number;
  critical_alerts_count: number;
  critical_alerts_unacked_count: number;
  staffing_summary: Record<string, { target: number; current: number; status: string }>;
  overdue_tasks_count: number;
  overdue_tasks_by_type: Record<string, number>;
  incidents_24h_count: number;
  incidents_critical_count: number;
}

interface Alert {
  id: string;
  alert_type: string;
  alert_title: string;
  severity_level: number;
  status: string;
  raised_at: string;
  acknowledged_at: string | null;
}

const occupancyColor = (pct: number) => {
  if (pct <= 80) return { bg: 'bg-green-600', text: 'text-green-50', label: 'NORMAL' };
  if (pct <= 95) return { bg: 'bg-amber-500', text: 'text-amber-50', label: 'HIGH' };
  return { bg: 'bg-red-600', text: 'text-red-50', label: 'CRITICAL' };
};

const severityBg = (level: number) => {
  if (level === 1) return 'bg-red-600 text-white';
  if (level === 2) return 'bg-orange-500 text-white';
  if (level === 3) return 'bg-yellow-400 text-yellow-900';
  return 'bg-green-500 text-white';
};

export function WallViewClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsToRefresh, setSecondsToRefresh] = useState(30);

  const loadData = useCallback(async () => {
    try {
      const [snapshotData, alertData] = await Promise.all([
        trpcQuery('dashboards.getLatestSnapshot', { hospital_id: HOSPITAL_ID, interval: 'hourly' }),
        trpcQuery('dashboards.listAlerts', {
          hospital_id: HOSPITAL_ID,
          status: ['open', 'acknowledged'],
          severity: [1, 2],
          limit: 12,
        }),
      ]);
      setSnapshot(snapshotData);
      setAlerts(alertData?.items || []);
      setLastUpdated(new Date());
      setSecondsToRefresh(30);
    } catch (e) {
      console.error('[WALL VIEW] Data load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsToRefresh(prev => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const timeSince = (dateStr: string) => {
    const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.round(mins / 60)}h`;
  };

  const occPct = snapshot ? parseFloat(snapshot.occupancy_pct || '0') : 0;
  const occColor = occupancyColor(occPct);

  if (loading && !snapshot) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-2xl">Loading Wall View...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 overflow-hidden">
      {/* Top Header — Census + Occupancy */}
      <div className="grid grid-cols-4 gap-4 mb-4 dash-grid-4">
        {/* Census */}
        <div className={`rounded-2xl p-6 ${occColor.bg}`}>
          <div className="text-sm font-medium opacity-80">CENSUS</div>
          <div className="text-5xl font-bold mt-1">
            {snapshot?.census_current ?? '—'}
            <span className="text-2xl font-normal opacity-70">/{snapshot?.census_target ?? '—'}</span>
          </div>
          <div className="text-sm mt-1 opacity-80">{occColor.label} — {occPct.toFixed(1)}% occupancy</div>
        </div>

        {/* Critical Alerts */}
        <div className={`rounded-2xl p-6 ${
          (snapshot?.critical_alerts_unacked_count || 0) > 0 ? 'bg-red-700 animate-pulse' : 'bg-slate-800'
        }`}>
          <div className="text-sm font-medium opacity-80">CRITICAL ALERTS</div>
          <div className="text-5xl font-bold mt-1">{snapshot?.critical_alerts_count ?? 0}</div>
          <div className="text-sm mt-1 opacity-80">
            {snapshot?.critical_alerts_unacked_count ?? 0} unacknowledged
          </div>
        </div>

        {/* Pending Admissions */}
        <div className={`rounded-2xl p-6 ${
          (snapshot?.pending_admissions_overdue_count || 0) > 0 ? 'bg-orange-600' : 'bg-slate-800'
        }`}>
          <div className="text-sm font-medium opacity-80">PENDING ADMISSIONS</div>
          <div className="text-5xl font-bold mt-1">{snapshot?.pending_admissions_count ?? 0}</div>
          <div className="text-sm mt-1 opacity-80">
            {snapshot?.pending_admissions_overdue_count ?? 0} overdue (&gt;30min)
          </div>
        </div>

        {/* Pending Discharges */}
        <div className={`rounded-2xl p-6 ${
          (snapshot?.pending_discharges_overdue_count || 0) > 0 ? 'bg-orange-600' : 'bg-slate-800'
        }`}>
          <div className="text-sm font-medium opacity-80">PENDING DISCHARGES</div>
          <div className="text-5xl font-bold mt-1">{snapshot?.pending_discharges_count ?? 0}</div>
          <div className="text-sm mt-1 opacity-80">
            {snapshot?.pending_discharges_overdue_count ?? 0} overdue (&gt;60min)
          </div>
        </div>
      </div>

      {/* Middle Row — Alerts + Staffing */}
      <div className="grid grid-cols-3 gap-4 mb-4 dash-grid-3">
        {/* Alert Cards — 2 columns wide */}
        <div className="col-span-2 bg-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-slate-400">ACTIVE ALERTS (Critical + High)</div>
            <div className="text-xs text-slate-500">{alerts.length} total</div>
          </div>
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-lg">No active critical/high alerts</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 dash-grid-3">
              {alerts.slice(0, 12).map(alert => (
                <div key={alert.id} className={`rounded-xl p-3 ${
                  alert.severity_level === 1 && !alert.acknowledged_at
                    ? 'bg-red-900/50 border border-red-500 animate-pulse'
                    : alert.severity_level === 1
                    ? 'bg-red-900/30 border border-red-700'
                    : 'bg-orange-900/30 border border-orange-700'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${severityBg(alert.severity_level)}`}>
                      {alert.severity_level === 1 ? 'CRIT' : 'HIGH'}
                    </span>
                    {alert.acknowledged_at && (
                      <span className="text-[10px] text-green-400">ACK</span>
                    )}
                  </div>
                  <div className="text-sm font-medium truncate">{alert.alert_title}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {alert.alert_type} — {timeSince(alert.raised_at)} ago
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Staffing Panel */}
        <div className="bg-slate-800 rounded-2xl p-5">
          <div className="text-sm font-medium text-slate-400 mb-3">STAFFING</div>
          {snapshot?.staffing_summary ? (
            <div className="space-y-2">
              {Object.entries(snapshot.staffing_summary).map(([ward, data]) => {
                const ratio = data.current / Math.max(data.target, 1);
                const color = ratio >= 1 ? 'text-green-400' : ratio >= 0.8 ? 'text-amber-400' : 'text-red-400';
                return (
                  <div key={ward} className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">{ward.toUpperCase()}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${color}`}>{data.current}</span>
                      <span className="text-slate-500">/ {data.target}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-slate-500 text-sm">No staffing data available</div>
          )}
        </div>
      </div>

      {/* Bottom Row — Overdue Tasks + Incidents + Refresh */}
      <div className="grid grid-cols-4 gap-4 dash-grid-4">
        {/* Overdue Tasks */}
        <div className="bg-slate-800 rounded-2xl p-5">
          <div className="text-sm font-medium text-slate-400 mb-2">OVERDUE TASKS</div>
          <div className={`text-4xl font-bold ${
            (snapshot?.overdue_tasks_count || 0) > 0 ? 'text-amber-400' : 'text-green-400'
          }`}>
            {snapshot?.overdue_tasks_count ?? 0}
          </div>
          {snapshot?.overdue_tasks_by_type && Object.keys(snapshot.overdue_tasks_by_type).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(snapshot.overdue_tasks_by_type).map(([type, count]) => (
                <div key={type} className="flex justify-between text-xs">
                  <span className="text-slate-400">{type.replace(/_/g, ' ')}</span>
                  <span className="text-slate-300">{count as number}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Incidents 24h */}
        <div className="bg-slate-800 rounded-2xl p-5">
          <div className="text-sm font-medium text-slate-400 mb-2">INCIDENTS (24H)</div>
          <div className={`text-4xl font-bold ${
            (snapshot?.incidents_critical_count || 0) > 0 ? 'text-red-400' : 'text-slate-300'
          }`}>
            {snapshot?.incidents_24h_count ?? 0}
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {snapshot?.incidents_critical_count ?? 0} critical
          </div>
        </div>

        {/* Additional metrics placeholders */}
        <div className="bg-slate-800 rounded-2xl p-5">
          <div className="text-sm font-medium text-slate-400 mb-2">PHARMACY OOS</div>
          <div className="text-4xl font-bold text-slate-300">—</div>
          <div className="text-sm text-slate-500 mt-1">Data from Tier 2</div>
        </div>

        {/* Refresh indicator */}
        <div className="bg-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="text-sm font-medium text-slate-400">EVEN HOSPITAL</div>
            <div className="text-xs text-slate-500 mt-1">Race Course Road</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">
              Last updated: {lastUpdated?.toLocaleTimeString('en-IN') || '—'}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: `${(secondsToRefresh / 30) * 100}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 min-w-[24px]">{secondsToRefresh}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
