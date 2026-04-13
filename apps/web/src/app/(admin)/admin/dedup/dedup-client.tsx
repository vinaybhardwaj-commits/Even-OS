'use client';

import { useState, useEffect, useCallback } from 'react';

interface Patient {
  id: string;
  uhid: string;
  name_full: string;
  phone: string;
  dob: string;
  gender: string;
  patient_category: string;
  status: string;
}

interface DedupQueueItem {
  id: string;
  match_method: string;
  match_score: number;
  status: 'pending' | 'merged' | 'dismissed';
  created_at: string;
  resolution_note?: string;
  resolved_at?: string;
  patient_a: Patient;
  patient_b: Patient;
}

interface QueueStats {
  pending: number;
  merged: number;
  dismissed: number;
}

const ITEMS_PER_PAGE = 10;

async function trpcQuery(path: string, input: any) {
  const params = new URLSearchParams({ input: JSON.stringify(input) });
  const res = await fetch(`/api/trpc/${path}?${params}`, {
    method: 'GET',
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutation(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${color}`}
    >
      <div className="text-sm font-medium text-gray-600">{label}</div>
      <div className="text-2xl font-bold text-blue-900">
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}

function MergeModal({
  queueItem,
  onConfirm,
  onCancel,
  isLoading,
}: {
  queueItem: DedupQueueItem;
  onConfirm: (keepPatientId: string, note: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [keepPatient, setKeepPatient] = useState<string>(queueItem.patient_a.id);
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-4">Confirm Merge</h3>
        <p className="text-gray-700 mb-4">
          Which patient record would you like to keep?
        </p>

        <div className="space-y-3 mb-4">
          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="radio"
              name="keepPatient"
              value={queueItem.patient_a.id}
              checked={keepPatient === queueItem.patient_a.id}
              onChange={(e) => setKeepPatient(e.target.value)}
              disabled={isLoading}
            />
            <div className="flex-1">
              <div className="font-medium text-gray-900">
                {queueItem.patient_a.name_full}
              </div>
              <div className="text-sm text-gray-600">
                UHID: {queueItem.patient_a.uhid}
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="radio"
              name="keepPatient"
              value={queueItem.patient_b.id}
              checked={keepPatient === queueItem.patient_b.id}
              onChange={(e) => setKeepPatient(e.target.value)}
              disabled={isLoading}
            />
            <div className="flex-1">
              <div className="font-medium text-gray-900">
                {queueItem.patient_b.name_full}
              </div>
              <div className="text-sm text-gray-600">
                UHID: {queueItem.patient_b.uhid}
              </div>
            </div>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Optional note
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isLoading}
            maxLength={500}
            rows={3}
            className="w-full px-3 py-2 border rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Why are these duplicates? Any additional context..."
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(keepPatient, note)}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50"
          >
            {isLoading ? 'Merging...' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PatientRow({ patient }: { patient: Patient }) {
  const dob = new Date(patient.dob);
  const age = Math.floor(
    (new Date().getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );

  return (
    <div className="flex-1">
      <div className="font-medium text-blue-900">{patient.name_full}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600 mt-1">
        <div>UHID: {patient.uhid}</div>
        <div>Phone: {patient.phone}</div>
        <div>DOB: {dob.toLocaleDateString('en-IN')} ({age}y)</div>
        <div>Category: {patient.patient_category}</div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const percentage = Math.round(score * 100);
  let bgColor = 'bg-gray-100';
  let textColor = 'text-gray-800';

  if (score > 0.9) {
    bgColor = 'bg-red-100';
    textColor = 'text-red-800';
  } else if (score > 0.7) {
    bgColor = 'bg-yellow-100';
    textColor = 'text-yellow-800';
  }

  return (
    <span className={`${bgColor} ${textColor} px-3 py-1 rounded-full text-sm font-medium`}>
      {percentage}%
    </span>
  );
}

export function DedupClient() {
  const [status, setStatus] = useState<'pending' | 'merged' | 'dismissed'>('pending');
  const [items, setItems] = useState<DedupQueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats>({ pending: 0, merged: 0, dismissed: 0 });
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeModal, setMergeModal] = useState<{
    item: DedupQueueItem;
    isLoading: boolean;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [statsData, itemsData] = await Promise.all([
        trpcQuery('dedup.queueStats', {}),
        trpcQuery('dedup.listQueue', { status, page, pageSize: ITEMS_PER_PAGE }),
      ]);

      setStats(statsData || { pending: 0, merged: 0, dismissed: 0 });
      setItems(itemsData?.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dedup queue');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = (newStatus: 'pending' | 'merged' | 'dismissed') => {
    setStatus(newStatus);
    setPage(0);
  };

  const handleMergeClick = (item: DedupQueueItem) => {
    if (status === 'pending') {
      setMergeModal({ item, isLoading: false });
    }
  };

  const handleMergeConfirm = async (keepPatientId: string, note: string) => {
    if (!mergeModal) return;

    try {
      setMergeModal({ ...mergeModal, isLoading: true });
      await trpcMutation('dedup.merge', {
        duplicate_id: mergeModal.item.id,
        keep_patient_id: keepPatientId,
        note: note || undefined,
      });
      setMergeModal(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Merge failed');
      setMergeModal({ ...mergeModal, isLoading: false });
    }
  };

  const handleDismiss = async (item: DedupQueueItem) => {
    const note = prompt('Optional note for dismissal:');
    if (note === null) return;

    try {
      setActionLoading(item.id);
      await trpcMutation('dedup.dismiss', {
        duplicate_id: item.id,
        note: note || undefined,
      });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Dismiss failed');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil((stats[status] || 0) / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3 mb-2">
            <a
              href="/admin"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              ← Dashboard
            </a>
          </div>
          <h1 className="text-3xl font-bold text-blue-900">Dedup Queue</h1>
        </div>
      </div>

      {/* Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Pending"
            value={stats.pending}
            color="bg-yellow-50 border-yellow-200"
          />
          <StatCard
            label="Merged"
            value={stats.merged}
            color="bg-green-50 border-green-200"
          />
          <StatCard
            label="Dismissed"
            value={stats.dismissed}
            color="bg-gray-100 border-gray-300"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-8">
            {(['pending', 'merged', 'dismissed'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleStatusChange(tab)}
                className={`px-1 py-4 font-medium border-b-2 transition ${
                  status === tab
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block text-gray-600">Loading...</div>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-600">
              No {status} duplicate pairs to review
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition"
                >
                  <div className="p-4 sm:p-6">
                    {/* Top row: score, method, date */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 pb-4 border-b border-gray-200">
                      <div className="flex flex-wrap items-center gap-3">
                        <ScoreBadge score={item.match_score} />
                        <span className="text-sm text-gray-600">
                          {item.match_method}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        {new Date(item.created_at).toLocaleDateString('en-IN')}
                      </div>
                    </div>

                    {/* Two patients side by side */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
                      <PatientRow patient={item.patient_a} />
                      <div className="hidden sm:flex items-center justify-center">
                        <span className="text-gray-400">↔</span>
                      </div>
                      <PatientRow patient={item.patient_b} />
                    </div>

                    {/* Resolution info if resolved */}
                    {item.status !== 'pending' && item.resolution_note && (
                      <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                        <div className="font-medium text-gray-700">Note:</div>
                        <div className="text-gray-600">{item.resolution_note}</div>
                      </div>
                    )}

                    {/* Action buttons */}
                    {status === 'pending' && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleMergeClick(item)}
                          disabled={actionLoading !== null}
                          className="flex-1 sm:flex-none px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 font-medium"
                        >
                          Merge
                        </button>
                        <button
                          onClick={() => handleDismiss(item)}
                          disabled={actionLoading !== null}
                          className="flex-1 sm:flex-none px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium"
                        >
                          {actionLoading === item.id ? 'Dismissing...' : 'Dismiss'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0 || isLoading}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  ←
                </button>
                <span className="text-gray-600 text-sm">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page === totalPages - 1 || isLoading}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Merge modal */}
      {mergeModal && (
        <MergeModal
          queueItem={mergeModal.item}
          isLoading={mergeModal.isLoading}
          onConfirm={handleMergeConfirm}
          onCancel={() => setMergeModal(null)}
        />
      )}
    </div>
  );
}
