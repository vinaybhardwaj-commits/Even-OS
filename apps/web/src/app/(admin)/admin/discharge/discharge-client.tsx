'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface DischargeQueueItem {
  encounter_id: string;
  admission_at: string;
  chief_complaint: string;
  admission_type: string;
  pre_auth_status: string;
  uhid: string;
  patient_name: string;
  phone: string;
  patient_category: string;
  bed_code: string;
  ward_name: string;
  order_id: string;
  discharge_reason: string;
  order_status: string;
  ordered_at: string;
  milestones_done: number;
  milestones_total: number;
}

interface Milestone {
  id: string;
  milestone: string;
  sequence: number;
  completed_at: string | null;
  completed_by_user_id: string | null;
  notes: string | null;
}

interface DischargeStatus {
  milestones: Milestone[];
  order: { id: string; reason: string; summary: string | null; status: string; ordered_at: string } | null;
  completed: number;
  total: number;
  all_complete: boolean;
}

interface ActiveAdmission {
  encounter_id: string;
  admission_type: string;
  chief_complaint: string;
  admission_at: string;
  pre_auth_status: string;
  patient_name: string;
  uhid: string;
  phone: string;
  patient_category: string;
  bed_code: string;
  ward_name: string;
}

// ─── tRPC helper ─────────────────────────────────────────
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

// Milestone labels
const MILESTONE_LABELS: Record<string, string> = {
  clinical_clearance: 'Clinical Clearance',
  financial_settlement: 'Financial Settlement',
  discharge_summary: 'Discharge Summary',
  medication_reconciliation: 'Medication Reconciliation',
  patient_education: 'Patient Education',
  documents_ready: 'Documents Ready',
  bed_cleaned: 'Bed Cleaned',
  followup_scheduled: 'Follow-up Scheduled',
};

export default function DischargeClient() {
  // Tab: 'queue' = discharge queue, 'initiate' = start new discharge
  const [tab, setTab] = useState<'queue' | 'initiate'>('queue');

  // Queue state
  const [queue, setQueue] = useState<DischargeQueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Initiate discharge state
  const [admissions, setAdmissions] = useState<ActiveAdmission[]>([]);
  const [loadingAdmissions, setLoadingAdmissions] = useState(false);
  const [showInitiate, setShowInitiate] = useState(false);
  const [initiateEncounter, setInitiateEncounter] = useState<ActiveAdmission | null>(null);
  const [dischargeReason, setDischargeReason] = useState<string>('recovered');
  const [dischargeSummary, setDischargeSummary] = useState('');
  const [initiating, setInitiating] = useState(false);

  // Milestone view
  const [showMilestones, setShowMilestones] = useState(false);
  const [milestoneEncounterId, setMilestoneEncounterId] = useState('');
  const [milestonePatientName, setMilestonePatientName] = useState('');
  const [dischargeStatus, setDischargeStatus] = useState<DischargeStatus | null>(null);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [milestoneNote, setMilestoneNote] = useState('');
  const [completingMilestone, setCompletingMilestone] = useState('');

  // Complete discharge
  const [completingDischarge, setCompletingDischarge] = useState(false);

  // General
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ─── Fetch discharge queue ──────────────────────────────
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('encounter.dischargeQueue', { page: 1, pageSize: 50 });
      setQueue(data.items || []);
      setQueueTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Fetch active admissions (for initiate tab) ─────────
  const fetchAdmissions = useCallback(async () => {
    setLoadingAdmissions(true);
    try {
      const data = await trpcQuery('encounter.listActive', { page: 1, pageSize: 100 });
      setAdmissions(data.items || []);
    } catch {
      // silent
    } finally {
      setLoadingAdmissions(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'queue') fetchQueue();
    else fetchAdmissions();
  }, [tab, fetchQueue, fetchAdmissions]);

  // ─── Initiate discharge ─────────────────────────────────
  const handleInitiate = async () => {
    if (!initiateEncounter) return;
    setInitiating(true);
    setError('');
    try {
      await trpcMutate('encounter.initiateDischarge', {
        encounter_id: initiateEncounter.encounter_id,
        reason: dischargeReason,
        summary: dischargeSummary.trim() || undefined,
      });
      setShowInitiate(false);
      setSuccess('Discharge initiated — patient added to discharge queue');
      setTab('queue');
      setTimeout(() => setSuccess(''), 3000);
      fetchQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to initiate discharge');
    } finally {
      setInitiating(false);
    }
  };

  // ─── View / manage milestones ───────────────────────────
  const openMilestones = async (encounterId: string, patientName: string) => {
    setMilestoneEncounterId(encounterId);
    setMilestonePatientName(patientName);
    setShowMilestones(true);
    setLoadingMilestones(true);
    setError('');
    try {
      const data = await trpcQuery('encounter.dischargeStatus', { encounter_id: encounterId });
      setDischargeStatus(data);
    } catch {
      setDischargeStatus(null);
    } finally {
      setLoadingMilestones(false);
    }
  };

  const handleCompleteMilestone = async (milestoneId: string) => {
    setCompletingMilestone(milestoneId);
    try {
      await trpcMutate('encounter.completeMilestone', {
        milestone_id: milestoneId,
        notes: milestoneNote.trim() || undefined,
      });
      setMilestoneNote('');
      // Refresh
      const data = await trpcQuery('encounter.dischargeStatus', { encounter_id: milestoneEncounterId });
      setDischargeStatus(data);
      fetchQueue(); // Update progress in queue too
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete milestone');
    } finally {
      setCompletingMilestone('');
    }
  };

  // ─── Complete discharge ─────────────────────────────────
  const handleCompleteDischarge = async (force: boolean = false) => {
    setCompletingDischarge(true);
    setError('');
    try {
      await trpcMutate('encounter.completeDischarge', {
        encounter_id: milestoneEncounterId,
        force,
      });
      setShowMilestones(false);
      setSuccess('Patient discharged successfully');
      setTimeout(() => setSuccess(''), 3000);
      fetchQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete discharge');
    } finally {
      setCompletingDischarge(false);
    }
  };

  // ─── Cancel discharge ───────────────────────────────────
  const handleCancelDischarge = async () => {
    const cancelReason = prompt('Reason for cancelling discharge:');
    if (!cancelReason) return;
    try {
      await trpcMutate('encounter.cancelDischarge', {
        encounter_id: milestoneEncounterId,
        reason: cancelReason,
      });
      setShowMilestones(false);
      setSuccess('Discharge cancelled');
      setTimeout(() => setSuccess(''), 3000);
      fetchQueue();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel discharge');
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const reasonLabel = (r: string) => {
    const labels: Record<string, string> = { recovered: 'Recovered', referred: 'Referred', self_discharge: 'Self-Discharge', death: 'Death', lama: 'LAMA' };
    return labels[r] || r;
  };
  const reasonColor = (r: string) => {
    const colors: Record<string, string> = { recovered: 'bg-green-100 text-green-700', referred: 'bg-blue-100 text-blue-700', self_discharge: 'bg-yellow-100 text-yellow-700', death: 'bg-gray-100 text-gray-700', lama: 'bg-red-100 text-red-700' };
    return colors[r] || 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Discharge Management</h1>
          <p className="text-sm text-gray-500 mt-1">Initiate, track milestones &amp; complete patient discharges</p>
        </div>
      </div>

      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('queue')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'queue' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Discharge Queue ({queueTotal})
        </button>
        <button
          onClick={() => setTab('initiate')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'initiate' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Initiate Discharge
        </button>
      </div>

      {/* ─── DISCHARGE QUEUE TAB ───────────────────────────── */}
      {tab === 'queue' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {loading ? (
            <div className="p-12 text-center text-gray-400">Loading...</div>
          ) : queue.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No pending discharges</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {queue.map(q => (
                <div key={q.encounter_id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{q.patient_name}</p>
                        <span className="text-xs font-mono text-gray-500">{q.uhid}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${reasonColor(q.discharge_reason)}`}>
                          {reasonLabel(q.discharge_reason)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Bed: <span className="font-mono">{q.bed_code}</span> &middot; {q.ward_name}
                        &middot; Admitted: {formatDate(q.admission_at)}
                        &middot; Discharge ordered: {formatDate(q.ordered_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => openMilestones(q.encounter_id, q.patient_name)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100"
                    >
                      Manage &#8594;
                    </button>
                  </div>
                  {/* Milestone progress bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>Milestones: {q.milestones_done}/{q.milestones_total}</span>
                      <span>{q.milestones_total > 0 ? Math.round((q.milestones_done / q.milestones_total) * 100) : 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${q.milestones_done === q.milestones_total ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${q.milestones_total > 0 ? (q.milestones_done / q.milestones_total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── INITIATE DISCHARGE TAB ────────────────────────── */}
      {tab === 'initiate' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Active Admissions</h2>
            <p className="text-xs text-gray-500 mt-0.5">Select a patient to initiate discharge</p>
          </div>

          {loadingAdmissions ? (
            <div className="p-12 text-center text-gray-400">Loading...</div>
          ) : admissions.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No active admissions</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Patient</th>
                    <th className="px-6 py-3">UHID</th>
                    <th className="px-6 py-3">Bed</th>
                    <th className="px-6 py-3">Ward</th>
                    <th className="px-6 py-3">Complaint</th>
                    <th className="px-6 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {admissions.map(a => (
                    <tr key={a.encounter_id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900">{a.patient_name}</td>
                      <td className="px-6 py-3 text-gray-600 font-mono text-xs">{a.uhid}</td>
                      <td className="px-6 py-3 text-gray-600 font-mono">{a.bed_code || '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{a.ward_name || '—'}</td>
                      <td className="px-6 py-3 text-gray-600 max-w-[200px] truncate">{a.chief_complaint}</td>
                      <td className="px-6 py-3">
                        <button
                          onClick={() => { setInitiateEncounter(a); setShowInitiate(true); setDischargeReason('recovered'); setDischargeSummary(''); setError(''); }}
                          className="px-3 py-1 text-xs bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 font-medium"
                        >
                          Initiate Discharge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── INITIATE DISCHARGE MODAL ────────────────────── */}
      {showInitiate && initiateEncounter && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Initiate Discharge</h2>
                <p className="text-sm text-gray-500">{initiateEncounter.patient_name} ({initiateEncounter.uhid})</p>
              </div>
              <button onClick={() => setShowInitiate(false)} className="text-gray-400 hover:text-gray-600 text-xl">&#10005;</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Discharge Reason</label>
                <select value={dischargeReason} onChange={e => setDischargeReason(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="recovered">Recovered</option>
                  <option value="referred">Referred to another facility</option>
                  <option value="self_discharge">Self-Discharge (AMA)</option>
                  <option value="lama">LAMA (Left Against Medical Advice)</option>
                  <option value="death">Death</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Discharge Summary</label>
                <textarea
                  value={dischargeSummary}
                  onChange={e => setDischargeSummary(e.target.value)}
                  maxLength={5000}
                  rows={4}
                  placeholder="Clinical summary, final diagnosis, treatment given, follow-up instructions..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <button onClick={() => setShowInitiate(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={handleInitiate}
                disabled={initiating}
                className="px-5 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-40 transition-colors"
              >
                {initiating ? 'Initiating...' : 'Initiate Discharge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MILESTONE MANAGEMENT MODAL ──────────────────── */}
      {showMilestones && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Discharge Milestones</h2>
                <p className="text-sm text-gray-500">{milestonePatientName}</p>
              </div>
              <button onClick={() => { setShowMilestones(false); setError(''); }} className="text-gray-400 hover:text-gray-600 text-xl">&#10005;</button>
            </div>

            <div className="px-6 py-5">
              {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

              {loadingMilestones ? (
                <div className="p-8 text-center text-gray-400">Loading...</div>
              ) : !dischargeStatus ? (
                <div className="p-8 text-center text-gray-400">Failed to load discharge status</div>
              ) : (
                <>
                  {/* Discharge order info */}
                  {dischargeStatus.order && (
                    <div className="mb-5 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-orange-800">Discharge Order — {reasonLabel(dischargeStatus.order.reason)}</p>
                          <p className="text-xs text-orange-600 mt-0.5">Ordered: {formatDate(dischargeStatus.order.ordered_at)}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${reasonColor(dischargeStatus.order.reason)}`}>
                          {dischargeStatus.order.status}
                        </span>
                      </div>
                      {dischargeStatus.order.summary && (
                        <p className="text-xs text-orange-700 mt-2 whitespace-pre-wrap">{dischargeStatus.order.summary}</p>
                      )}
                    </div>
                  )}

                  {/* Progress */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                      <span className="font-medium">Progress: {dischargeStatus.completed}/{dischargeStatus.total} milestones</span>
                      {dischargeStatus.all_complete && <span className="text-green-600 font-bold">&#10003; All Complete</span>}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${dischargeStatus.all_complete ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${dischargeStatus.total > 0 ? (dischargeStatus.completed / dischargeStatus.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Milestone list */}
                  <div className="space-y-2">
                    {dischargeStatus.milestones.map(m => (
                      <div key={m.id} className={`p-4 rounded-lg border ${m.completed_at ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              m.completed_at ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                            }`}>{m.sequence}</span>
                            <span className={`text-sm font-medium ${m.completed_at ? 'text-green-800' : 'text-gray-700'}`}>
                              {MILESTONE_LABELS[m.milestone] || m.milestone}
                            </span>
                          </div>
                          {m.completed_at ? (
                            <span className="text-xs text-green-600">&#10003; {formatDate(m.completed_at)}</span>
                          ) : (
                            <button
                              onClick={() => handleCompleteMilestone(m.id)}
                              disabled={completingMilestone === m.id}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium"
                            >
                              {completingMilestone === m.id ? '...' : 'Complete'}
                            </button>
                          )}
                        </div>
                        {m.notes && <p className="text-xs text-gray-500 mt-1 ml-8 italic">{m.notes}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Note input for milestones */}
                  <div className="mt-4">
                    <input
                      type="text"
                      value={milestoneNote}
                      onChange={e => setMilestoneNote(e.target.value)}
                      placeholder="Optional note for next milestone..."
                      maxLength={1000}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer actions */}
            {dischargeStatus && dischargeStatus.order && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between sticky bottom-0 bg-white rounded-b-2xl">
                <button
                  onClick={handleCancelDischarge}
                  className="px-4 py-2 text-sm text-red-600 hover:text-red-800 font-medium"
                >
                  Cancel Discharge
                </button>
                <div className="flex gap-2">
                  {!dischargeStatus.all_complete && (
                    <button
                      onClick={() => handleCompleteDischarge(true)}
                      disabled={completingDischarge}
                      className="px-4 py-2 text-sm text-orange-600 border border-orange-300 rounded-lg hover:bg-orange-50 font-medium disabled:opacity-40"
                    >
                      {completingDischarge ? '...' : 'Force Discharge'}
                    </button>
                  )}
                  <button
                    onClick={() => handleCompleteDischarge(false)}
                    disabled={completingDischarge || !dischargeStatus.all_complete}
                    className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
                  >
                    {completingDischarge ? 'Discharging...' : '&#10003; Complete Discharge'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
