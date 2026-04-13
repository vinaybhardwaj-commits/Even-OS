'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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

const severityConfig: Record<number, { label: string; color: string; bg: string; pulse?: boolean }> = {
  1: { label: 'Critical', color: 'text-red-700', bg: 'bg-red-100', pulse: true },
  2: { label: 'High', color: 'text-orange-700', bg: 'bg-orange-100' },
  3: { label: 'Medium', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  4: { label: 'Low', color: 'text-green-700', bg: 'bg-green-100' },
};

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: 'text-red-700', bg: 'bg-red-50' },
  acknowledged: { label: 'Acknowledged', color: 'text-blue-700', bg: 'bg-blue-50' },
  in_progress: { label: 'In Progress', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  resolved: { label: 'Resolved', color: 'text-green-700', bg: 'bg-green-50' },
  dismissed: { label: 'Dismissed', color: 'text-gray-700', bg: 'bg-gray-100' },
};

// Default hospital ID (first EHRC hospital — will be dynamic later)
const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';

interface Alert {
  id: string;
  hospital_id: string;
  alert_type: string;
  alert_source: string;
  alert_code: string | null;
  alert_title: string;
  alert_description: string | null;
  patient_id: string | null;
  severity_level: number;
  urgency_score: number | null;
  status: string;
  raised_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  escalation_attempts: number;
  escalated_to_ceo: boolean;
  dismissal_reason: string | null;
}

interface AlertCounts {
  open_count: string;
  acknowledged_count: string;
  critical_unresolved: string;
  high_unresolved: string;
}

export function AlertQueueClient() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(['open', 'acknowledged']);
  const [severityFilter, setSeverityFilter] = useState<number[]>([]);
  const [actionModal, setActionModal] = useState<{ alert: Alert; action: string } | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [escalateRole, setEscalateRole] = useState('gm');
  const [escalateMessage, setEscalateMessage] = useState('');

  const loadAlerts = async () => {
    try {
      setLoading(true);
      const input: any = {
        hospital_id: HOSPITAL_ID,
        limit: 50,
      };
      if (statusFilter.length > 0) input.status = statusFilter;
      if (severityFilter.length > 0) input.severity = severityFilter;
      const data = await trpcQuery('dashboards.listAlerts', input);
      setAlerts(data.items || []);
      setCounts(data.counts || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAlerts(); }, [statusFilter, severityFilter]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadAlerts, 30000);
    return () => clearInterval(interval);
  }, [statusFilter, severityFilter]);

  const handleAcknowledge = async (alert: Alert) => {
    try {
      await trpcMutate('dashboards.acknowledgeAlert', {
        id: alert.id,
        hospital_id: alert.hospital_id,
      });
      loadAlerts();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleResolve = async (alert: Alert) => {
    try {
      await trpcMutate('dashboards.resolveAlert', {
        id: alert.id,
        hospital_id: alert.hospital_id,
      });
      loadAlerts();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDismiss = async () => {
    if (!actionModal || !dismissReason) return;
    try {
      await trpcMutate('dashboards.dismissAlert', {
        id: actionModal.alert.id,
        hospital_id: actionModal.alert.hospital_id,
        reason: dismissReason,
      });
      setActionModal(null);
      setDismissReason('');
      loadAlerts();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleEscalate = async () => {
    if (!actionModal) return;
    try {
      await trpcMutate('dashboards.escalateAlert', {
        id: actionModal.alert.id,
        hospital_id: actionModal.alert.hospital_id,
        escalate_to_role: escalateRole,
        message: escalateMessage || undefined,
      });
      setActionModal(null);
      setEscalateRole('gm');
      setEscalateMessage('');
      loadAlerts();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const timeSince = (dateStr: string) => {
    const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  const toggleStatus = (s: string) => {
    setStatusFilter(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const toggleSeverity = (s: number) => {
    setSeverityFilter(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <span className="text-gray-900">Alert Queue</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Alert Queue</h1>
          </div>
          <div className="text-sm text-gray-500">Auto-refreshes every 30s</div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-600 hover:underline">dismiss</button>
          </div>
        )}

        {/* Summary Cards */}
        {counts && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Open</div>
              <div className="text-2xl font-bold text-red-600">{counts.open_count}</div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Acknowledged</div>
              <div className="text-2xl font-bold text-blue-600">{counts.acknowledged_count}</div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Critical Unresolved</div>
              <div className="text-2xl font-bold text-red-700">{counts.critical_unresolved}</div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">High Unresolved</div>
              <div className="text-2xl font-bold text-orange-600">{counts.high_unresolved}</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div>
            <span className="text-xs text-gray-500 mr-2">Status:</span>
            {['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'].map(s => {
              const cfg = statusConfig[s];
              return (
                <button key={s} onClick={() => toggleStatus(s)}
                  className={`px-2 py-1 rounded text-xs mr-1 ${
                    statusFilter.includes(s)
                      ? `${cfg.bg} ${cfg.color} font-medium`
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <div>
            <span className="text-xs text-gray-500 mr-2">Severity:</span>
            {[1, 2, 3, 4].map(s => {
              const cfg = severityConfig[s];
              return (
                <button key={s} onClick={() => toggleSeverity(s)}
                  className={`px-2 py-1 rounded text-xs mr-1 ${
                    severityFilter.includes(s)
                      ? `${cfg.bg} ${cfg.color} font-medium`
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Alert List */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading alerts...</div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No alerts matching filters.</div>
        ) : (
          <div className="bg-white border rounded-lg divide-y">
            {alerts.map(alert => {
              const sev = severityConfig[alert.severity_level] || severityConfig[4];
              const stat = statusConfig[alert.status] || statusConfig.open;
              return (
                <div key={alert.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sev.bg} ${sev.color}`}>
                          {sev.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs ${stat.bg} ${stat.color}`}>
                          {stat.label}
                        </span>
                        {alert.escalation_attempts > 0 && (
                          <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">
                            Escalated x{alert.escalation_attempts}
                          </span>
                        )}
                        <span className="font-medium text-gray-900">{alert.alert_title}</span>
                      </div>
                      {alert.alert_description && (
                        <p className="text-sm text-gray-500 mt-1">{alert.alert_description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-400">
                        <span>Type: {alert.alert_type}</span>
                        <span>Source: {alert.alert_source}</span>
                        <span>Raised: {timeSince(alert.raised_at)}</span>
                        {alert.acknowledged_at && <span>Acked: {timeSince(alert.acknowledged_at)}</span>}
                        {alert.resolved_at && <span>Resolved: {timeSince(alert.resolved_at)}</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    {['open', 'acknowledged'].includes(alert.status) && (
                      <div className="flex items-center gap-2 ml-4">
                        {alert.status === 'open' && (
                          <button onClick={() => handleAcknowledge(alert)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                            Acknowledge
                          </button>
                        )}
                        <button onClick={() => handleResolve(alert)}
                          className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
                          Resolve
                        </button>
                        <button onClick={() => setActionModal({ alert, action: 'escalate' })}
                          className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">
                          Escalate
                        </button>
                        <button onClick={() => setActionModal({ alert, action: 'dismiss' })}
                          className="px-3 py-1.5 border text-gray-600 rounded text-xs hover:bg-gray-50">
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Escalate / Dismiss Modal */}
        {actionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              {actionModal.action === 'dismiss' ? (
                <>
                  <h2 className="text-lg font-bold mb-4">Dismiss Alert</h2>
                  <p className="text-sm text-gray-600 mb-3">
                    Dismissing: <strong>{actionModal.alert.alert_title}</strong>
                  </p>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason (required)</label>
                  <textarea
                    value={dismissReason}
                    onChange={e => setDismissReason(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    rows={3}
                    placeholder="Why is this alert being dismissed?"
                  />
                  <div className="flex justify-end gap-3 mt-4">
                    <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
                    <button onClick={handleDismiss} disabled={!dismissReason}
                      className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm disabled:opacity-50">
                      Dismiss Alert
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold mb-4">Escalate Alert</h2>
                  <p className="text-sm text-gray-600 mb-3">
                    Escalating: <strong>{actionModal.alert.alert_title}</strong>
                  </p>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Escalate To</label>
                  <select value={escalateRole} onChange={e => setEscalateRole(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm mb-3">
                    <option value="gm">GM</option>
                    <option value="medical_director">Medical Director</option>
                    <option value="ceo">CEO</option>
                  </select>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
                  <textarea
                    value={escalateMessage}
                    onChange={e => setEscalateMessage(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    rows={2}
                    placeholder="Additional context..."
                  />
                  <div className="flex justify-end gap-3 mt-4">
                    <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
                    <button onClick={handleEscalate}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm">
                      Escalate
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
