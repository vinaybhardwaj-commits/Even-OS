'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
interface ActiveAdmission {
  encounter_id: string;
  encounter_class: string;
  admission_type: string;
  chief_complaint: string;
  admission_at: string;
  patient_id: string;
  uhid: string;
  patient_name: string;
  phone: string;
  bed_code: string;
  bed_name: string;
  ward_code: string;
  ward_name: string;
}

interface AvailableBed {
  id: string;
  code: string;
  name: string;
  bed_status: string;
  ward_code: string;
  ward_name: string;
}

interface TransferRecord {
  id: string;
  transfer_type: string;
  reason: string | null;
  transfer_at: string;
  from_bed_code: string;
  from_bed_name: string;
  from_ward_name: string;
  to_bed_code: string;
  to_bed_name: string;
  to_ward_name: string;
  transferred_by: string;
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

export default function TransfersClient() {
  // List state
  const [admissions, setAdmissions] = useState<ActiveAdmission[]>([]);
  const [loading, setLoading] = useState(true);

  // Transfer modal state
  const [showTransfer, setShowTransfer] = useState(false);
  const [selectedEncounter, setSelectedEncounter] = useState<ActiveAdmission | null>(null);
  const [transferType, setTransferType] = useState<string>('bed');
  const [reason, setReason] = useState('');
  const [selectedBedId, setSelectedBedId] = useState('');
  const [availableBeds, setAvailableBeds] = useState<AvailableBed[]>([]);
  const [bedWardFilter, setBedWardFilter] = useState('');
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Transfer history drawer
  const [showHistory, setShowHistory] = useState(false);
  const [historyEncounter, setHistoryEncounter] = useState<ActiveAdmission | null>(null);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ─── Fetch active admissions ────────────────────────────
  const fetchAdmissions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('encounter.listActive', { page: 1, pageSize: 100 });
      setAdmissions(data.items || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAdmissions(); }, [fetchAdmissions]);

  // ─── Open transfer modal ────────────────────────────────
  const openTransfer = async (a: ActiveAdmission) => {
    setSelectedEncounter(a);
    setShowTransfer(true);
    setTransferType('bed');
    setReason('');
    setSelectedBedId('');
    setBedWardFilter('');
    setError('');
    setSuccess('');
    await fetchBeds('');
  };

  const fetchBeds = async (wardCode: string) => {
    setLoadingBeds(true);
    try {
      const data = await trpcQuery('encounter.availableBeds', wardCode ? { ward_code: wardCode } : {});
      setAvailableBeds(data || []);
    } catch {
      setAvailableBeds([]);
    } finally {
      setLoadingBeds(false);
    }
  };

  useEffect(() => {
    if (showTransfer) fetchBeds(bedWardFilter);
  }, [bedWardFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Submit transfer ────────────────────────────────────
  const handleTransfer = async () => {
    if (!selectedEncounter || !selectedBedId) return;
    setSubmitting(true);
    setError('');
    try {
      await trpcMutate('encounter.transfer', {
        encounter_id: selectedEncounter.encounter_id,
        to_bed_id: selectedBedId,
        transfer_type: transferType,
        reason: reason.trim() || undefined,
      });
      setSuccess(`Patient transferred to ${availableBeds.find(b => b.id === selectedBedId)?.code}`);
      setTimeout(() => {
        setShowTransfer(false);
        setSuccess('');
        fetchAdmissions();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── View transfer history ──────────────────────────────
  const viewHistory = async (a: ActiveAdmission) => {
    setHistoryEncounter(a);
    setShowHistory(true);
    setLoadingHistory(true);
    try {
      const data = await trpcQuery('encounter.getTransferHistory', { encounter_id: a.encounter_id });
      setTransfers(data || []);
    } catch {
      setTransfers([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bed Transfers</h1>
        <p className="text-sm text-gray-500 mt-1">Transfer admitted patients between beds and wards</p>
      </div>

      {/* Active Admissions for Transfer */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Active Admissions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Select a patient to transfer to a different bed</p>
        </div>

        {loading ? (
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
                  <th className="px-6 py-3">Current Bed</th>
                  <th className="px-6 py-3">Ward</th>
                  <th className="px-6 py-3">Admitted</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {admissions.map(a => (
                  <tr key={a.encounter_id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{a.patient_name}</td>
                    <td className="px-6 py-3 text-gray-600 font-mono text-xs">{a.uhid}</td>
                    <td className="px-6 py-3 text-gray-600 font-mono">{a.bed_code || '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{a.ward_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{formatDate(a.admission_at)}</td>
                    <td className="px-6 py-3 flex gap-2">
                      <button onClick={() => openTransfer(a)} className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">
                        &#8644; Transfer
                      </button>
                      <button onClick={() => viewHistory(a)} className="px-3 py-1 text-xs bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 font-medium">
                        &#128337; History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── TRANSFER MODAL ──────────────────────────────── */}
      {showTransfer && selectedEncounter && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Transfer Patient</h2>
                <p className="text-sm text-gray-500">{selectedEncounter.patient_name} ({selectedEncounter.uhid}) — Current bed: <span className="font-mono font-bold">{selectedEncounter.bed_code}</span></p>
              </div>
              <button onClick={() => setShowTransfer(false)} className="text-gray-400 hover:text-gray-600 text-xl">&#10005;</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
              {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Transfer Type</label>
                  <select value={transferType} onChange={e => setTransferType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="bed">Bed Transfer</option>
                    <option value="ward">Ward Transfer</option>
                    <option value="floor">Floor Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Filter Beds by Ward</label>
                  <input
                    type="text"
                    placeholder="Ward code..."
                    value={bedWardFilter}
                    onChange={e => setBedWardFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="e.g., Upgrade to private room, ICU transfer"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Select Destination Bed</label>
                {loadingBeds ? (
                  <div className="p-6 text-center text-gray-400">Loading beds...</div>
                ) : availableBeds.length === 0 ? (
                  <div className="p-6 text-center text-gray-400">No available beds{bedWardFilter ? ` in ward "${bedWardFilter}"` : ''}</div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                    {availableBeds.map(bed => (
                      <button
                        key={bed.id}
                        onClick={() => setSelectedBedId(bed.id)}
                        className={`p-2.5 rounded-lg border text-left transition-colors text-sm ${
                          selectedBedId === bed.id
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        <p className="font-mono font-bold text-gray-900">{bed.code}</p>
                        <p className="text-xs text-gray-500">{bed.ward_name}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <button onClick={() => setShowTransfer(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={handleTransfer}
                disabled={!selectedBedId || submitting}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {submitting ? 'Transferring...' : '&#8644; Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TRANSFER HISTORY DRAWER ─────────────────────── */}
      {showHistory && historyEncounter && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Transfer History</h2>
                <p className="text-sm text-gray-500">{historyEncounter.patient_name} ({historyEncounter.uhid})</p>
              </div>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-xl">&#10005;</button>
            </div>

            <div className="px-6 py-5">
              {loadingHistory ? (
                <div className="p-8 text-center text-gray-400">Loading...</div>
              ) : transfers.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No transfers recorded for this admission</div>
              ) : (
                <div className="space-y-3">
                  {transfers.map(t => (
                    <div key={t.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono font-bold text-gray-700">{t.from_bed_code}</span>
                        <span className="text-gray-400">&#8594;</span>
                        <span className="font-mono font-bold text-blue-700">{t.to_bed_code}</span>
                        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
                          t.transfer_type === 'ward' ? 'bg-purple-100 text-purple-700' :
                          t.transfer_type === 'floor' ? 'bg-orange-100 text-orange-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{t.transfer_type}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {t.from_ward_name} &#8594; {t.to_ward_name} &middot; {formatDate(t.transfer_at)} &middot; by {t.transferred_by}
                      </p>
                      {t.reason && <p className="text-xs text-gray-600 mt-1 italic">{t.reason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
