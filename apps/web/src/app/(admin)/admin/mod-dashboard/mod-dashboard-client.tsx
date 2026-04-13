'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';
const REFRESH_INTERVAL = 60000; // 60 seconds

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

interface Alert {
  id: string;
  alert_type: string;
  alert_title: string;
  alert_description: string | null;
  severity_level: number;
  status: string;
  raised_at: string;
  acknowledged_at: string | null;
  escalation_attempts: number;
}

interface AlertCounts {
  open_count: string;
  acknowledged_count: string;
  critical_unresolved: string;
  high_unresolved: string;
}

const severityLabel: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'Critical', color: 'text-red-700', bg: 'bg-red-100' },
  2: { label: 'High', color: 'text-orange-700', bg: 'bg-orange-100' },
  3: { label: 'Medium', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  4: { label: 'Low', color: 'text-green-700', bg: 'bg-green-100' },
};

export function ModDashboardClient() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'alerts' | 'incidents' | 'ot' | 'pharmacy' | 'billing'>('alerts');

  const loadData = useCallback(async () => {
    try {
      const [alertData, snapshotData] = await Promise.all([
        trpcQuery('dashboards.listAlerts', {
          hospital_id: HOSPITAL_ID,
          status: ['open', 'acknowledged', 'in_progress'],
          limit: 50,
        }),
        trpcQuery('dashboards.getLatestSnapshot', {
          hospital_id: HOSPITAL_ID,
          interval: 'hourly',
        }),
      ]);
      setAlerts(alertData?.items || []);
      setCounts(alertData?.counts || null);
      setSnapshot(snapshotData);
      setLastUpdated(new Date());
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

  const handleAck = async (alert: Alert) => {
    try {
      await trpcMutate('dashboards.acknowledgeAlert', { id: alert.id, hospital_id: HOSPITAL_ID });
      loadData();
    } catch (e: any) { setError(e.message); }
  };

  const handleResolve = async (alert: Alert) => {
    try {
      await trpcMutate('dashboards.resolveAlert', { id: alert.id, hospital_id: HOSPITAL_ID });
      loadData();
    } catch (e: any) { setError(e.message); }
  };

  const timeSince = (dateStr: string) => {
    const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  const occPct = snapshot ? parseFloat(snapshot.occupancy_pct || '0') : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <span className="text-gray-900">MOD Dashboard</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Medical Officer on Duty</h1>
            <p className="text-sm text-gray-500">
              Tier 2 — Refreshes every 60s | Last: {lastUpdated?.toLocaleTimeString('en-IN') || '—'}
            </p>
          </div>
          <Link href="/admin/wall-view" className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
            Open Wall View
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Compact Tier 1 Summary */}
        <div className="grid grid-cols-6 gap-3 mb-6">
          <div className={`rounded-xl p-4 text-white ${
            occPct <= 80 ? 'bg-green-600' : occPct <= 95 ? 'bg-amber-500' : 'bg-red-600'
          }`}>
            <div className="text-xs opacity-80">Census</div>
            <div className="text-2xl font-bold">{snapshot?.census_current ?? '—'}</div>
            <div className="text-xs opacity-80">{occPct.toFixed(0)}% occ</div>
          </div>
          <div className={`rounded-xl p-4 ${
            parseInt(counts?.critical_unresolved || '0') > 0 ? 'bg-red-600 text-white' : 'bg-white border'
          }`}>
            <div className={`text-xs ${parseInt(counts?.critical_unresolved || '0') > 0 ? 'opacity-80' : 'text-gray-500'}`}>Critical</div>
            <div className="text-2xl font-bold">{counts?.critical_unresolved || 0}</div>
            <div className={`text-xs ${parseInt(counts?.critical_unresolved || '0') > 0 ? 'opacity-80' : 'text-gray-400'}`}>unresolved</div>
          </div>
          <div className="rounded-xl p-4 bg-white border">
            <div className="text-xs text-gray-500">Open Alerts</div>
            <div className="text-2xl font-bold text-gray-900">{counts?.open_count || 0}</div>
            <div className="text-xs text-gray-400">+ {counts?.acknowledged_count || 0} acked</div>
          </div>
          <div className="rounded-xl p-4 bg-white border">
            <div className="text-xs text-gray-500">Admissions</div>
            <div className="text-2xl font-bold text-gray-900">{snapshot?.pending_admissions_count ?? '—'}</div>
            <div className="text-xs text-gray-400">{snapshot?.pending_admissions_overdue_count ?? 0} overdue</div>
          </div>
          <div className="rounded-xl p-4 bg-white border">
            <div className="text-xs text-gray-500">Discharges</div>
            <div className="text-2xl font-bold text-gray-900">{snapshot?.pending_discharges_count ?? '—'}</div>
            <div className="text-xs text-gray-400">{snapshot?.pending_discharges_overdue_count ?? 0} overdue</div>
          </div>
          <div className="rounded-xl p-4 bg-white border">
            <div className="text-xs text-gray-500">Incidents 24h</div>
            <div className="text-2xl font-bold text-gray-900">{snapshot?.incidents_24h_count ?? '—'}</div>
            <div className="text-xs text-gray-400">{snapshot?.incidents_critical_count ?? 0} critical</div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b mb-6">
          {[
            { key: 'alerts', label: 'Alert Queue', count: parseInt(counts?.open_count || '0') + parseInt(counts?.acknowledged_count || '0') },
            { key: 'incidents', label: 'Incidents', count: snapshot?.incident_queue_open || 0 },
            { key: 'ot', label: 'OT Schedule', count: null },
            { key: 'pharmacy', label: 'Pharmacy', count: snapshot?.pharmacy_oos_count || 0 },
            { key: 'billing', label: 'Billing Holds', count: snapshot?.billing_holds_count || 0 },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count !== null && tab.count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'alerts' && (
          <div>
            {loading ? (
              <div className="text-center py-12 text-gray-500">Loading alerts...</div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No active alerts. All clear.</div>
            ) : (
              <div className="bg-white border rounded-lg divide-y">
                {alerts.map(alert => {
                  const sev = severityLabel[alert.severity_level] || severityLabel[4];
                  return (
                    <div key={alert.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${sev.bg} ${sev.color}`}>
                            {sev.label}
                          </span>
                          {alert.escalation_attempts > 0 && (
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                              Escalated
                            </span>
                          )}
                          <span className="font-medium text-gray-900 text-sm">{alert.alert_title}</span>
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-gray-400">
                          <span>{alert.alert_type}</span>
                          <span>Raised {timeSince(alert.raised_at)}</span>
                          {alert.acknowledged_at && <span className="text-green-600">Acked {timeSince(alert.acknowledged_at)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {alert.status === 'open' && (
                          <button onClick={() => handleAck(alert)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                            Ack
                          </button>
                        )}
                        <button onClick={() => handleResolve(alert)}
                          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
                          Resolve
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'incidents' && (
          <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
            Incident queue connects to Module 13 (Quality). {snapshot?.incident_queue_open || 0} open incidents.
            <br />
            <Link href="/admin/incident-reporting" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
              View Incident Reports →
            </Link>
          </div>
        )}

        {activeTab === 'ot' && (
          <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
            OT schedule connects to Module 10 (OT Management).
            <br />
            <Link href="/admin/ot-management" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
              View OT Schedule →
            </Link>
          </div>
        )}

        {activeTab === 'pharmacy' && (
          <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
            Pharmacy alerts connect to Module 7 (Pharmacy). {snapshot?.pharmacy_oos_count || 0} items out of stock.
            <br />
            <Link href="/admin/pharmacy" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
              View Pharmacy →
            </Link>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
            Billing holds connect to Module 11 (Billing). {snapshot?.billing_holds_count || 0} active holds.
            <br />
            <Link href="/admin/billing" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
              View Billing →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
