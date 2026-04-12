'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type BedInfo = {
  id: string;
  code: string;
  name: string;
  bed_status: 'available' | 'occupied' | 'reserved' | 'blocked' | 'housekeeping';
  patient_uhid?: string;
  patient_name?: string;
  patient_gender?: string;
  encounter_id?: string;
  encounter_class?: string;
  admission_at?: string;
  diagnosis?: string;
};

type Ward = {
  ward_id: string;
  ward_code: string;
  ward_name: string;
  ward_capacity: number;
  beds: BedInfo[];
};

type Stats = {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  blocked: number;
  housekeeping: number;
};

type WardOption = {
  id: string;
  code: string;
  name: string;
  capacity: number;
};

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

function getGenderIcon(gender?: string): string {
  if (!gender) return '';
  if (gender.toLowerCase() === 'male' || gender.toLowerCase() === 'm') return '♂';
  if (gender.toLowerCase() === 'female' || gender.toLowerCase() === 'f') return '♀';
  return '◯';
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function truncateText(text: string | undefined, maxLength: number): string {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}

type ActionPanel = {
  bed_id: string;
  bed_code: string;
  bed_status: string;
} | null;

export function BedBoardClient() {
  const [wards, setWards] = useState<Ward[]>([]);
  const [wardOptions, setWardOptions] = useState<WardOption[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    available: 0,
    occupied: 0,
    reserved: 0,
    blocked: 0,
    housekeeping: 0,
  });
  const [selectedWard, setSelectedWard] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionPanel, setActionPanel] = useState<ActionPanel>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const pollInterval = useRef<NodeJS.Timeout>();

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const [boardData, statsData, wardsData] = await Promise.all([
        trpcQuery('bed.board', selectedWard !== 'all' ? { ward_code: selectedWard } : undefined),
        trpcQuery('bed.stats'),
        trpcQuery('bed.listWards'),
      ]);

      setWards(boardData.wards || []);
      setStats(statsData);
      setWardOptions(wardsData);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message);
    }
  }, [selectedWard]);

  useEffect(() => {
    fetchData();
    pollInterval.current = setInterval(fetchData, 30000);
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [fetchData]);

  const handleBedClick = (bed: BedInfo) => {
    if (bed.bed_status !== 'occupied') {
      setActionPanel({
        bed_id: bed.id,
        bed_code: bed.code,
        bed_status: bed.bed_status,
      });
      setActionReason('');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!actionPanel) return;

    setActionLoading(true);
    try {
      await trpcMutate('bed.updateStatus', {
        bed_id: actionPanel.bed_id,
        status: newStatus,
        reason: actionReason || undefined,
      });
      setSuccess(`Bed ${actionPanel.bed_code} marked as ${newStatus}`);
      setActionPanel(null);
      setActionReason('');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const filteredWards =
    selectedWard === 'all' ? wards : wards.filter(w => w.ward_code === selectedWard);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">
            &larr; Dashboard
          </a>
          <h1 className="text-xl font-bold">Bed Board</h1>
        </div>
        {lastUpdated && (
          <div className="text-xs text-blue-100">
            Last updated: {lastUpdated.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </div>
        )}
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <div className="bg-white rounded-lg p-4 border border-blue-200 shadow-sm">
            <p className="text-xs text-blue-600 uppercase tracking-wide font-semibold">Total</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
            <p className="text-xs text-green-600 uppercase tracking-wide font-semibold">Available</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{stats.available}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-red-200 shadow-sm">
            <p className="text-xs text-red-600 uppercase tracking-wide font-semibold">Occupied</p>
            <p className="text-2xl font-bold text-red-700 mt-1">{stats.occupied}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-yellow-200 shadow-sm">
            <p className="text-xs text-yellow-600 uppercase tracking-wide font-semibold">Reserved</p>
            <p className="text-2xl font-bold text-yellow-700 mt-1">{stats.reserved}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-300 shadow-sm">
            <p className="text-xs text-gray-600 uppercase tracking-wide font-semibold">
              Blocked/HK
            </p>
            <p className="text-2xl font-bold text-gray-700 mt-1">
              {stats.blocked + stats.housekeeping}
            </p>
          </div>
        </div>

        {/* Ward Filter & Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex items-center gap-3">
            <label htmlFor="ward-select" className="text-sm font-medium text-gray-700">
              Filter Ward:
            </label>
            <select
              id="ward-select"
              value={selectedWard}
              onChange={e => setSelectedWard(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-900"
            >
              <option value="all">All Wards</option>
              {wardOptions.map(ward => (
                <option key={ward.id} value={ward.code}>
                  {ward.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* Ward Sections */}
        {filteredWards.map(ward => (
          <div key={ward.ward_id} className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{ward.ward_name}</h2>
              <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-1 rounded">
                {ward.beds.length} / {ward.ward_capacity}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {ward.beds.map(bed => {
                const isActive = actionPanel?.bed_id === bed.id;
                let bgClass = 'bg-gray-100 border-gray-300';
                let statusLabelClass = 'text-gray-600';

                if (bed.bed_status === 'available') {
                  bgClass = 'bg-green-50 border-green-300';
                  statusLabelClass = 'text-green-700 font-medium';
                } else if (bed.bed_status === 'occupied') {
                  bgClass = 'bg-red-50 border-red-300';
                } else if (bed.bed_status === 'reserved') {
                  bgClass = 'bg-yellow-50 border-yellow-300';
                  statusLabelClass = 'text-yellow-700 font-medium';
                } else if (bed.bed_status === 'blocked') {
                  bgClass = 'bg-gray-200 border-gray-400';
                  statusLabelClass = 'text-gray-700 font-medium';
                } else if (bed.bed_status === 'housekeeping') {
                  bgClass = 'bg-purple-50 border-purple-300';
                  statusLabelClass = 'text-purple-700 font-medium';
                }

                return (
                  <div
                    key={bed.id}
                    className={`relative border-2 rounded-lg p-3 transition-all ${bgClass} ${
                      bed.bed_status !== 'occupied' ? 'cursor-pointer hover:shadow-md' : ''
                    } ${isActive ? 'ring-2 ring-blue-500' : ''}`}
                    onClick={() => handleBedClick(bed)}
                  >
                    {/* Bed Code */}
                    <div className="text-lg font-bold text-gray-900 mb-2">{bed.code}</div>

                    {/* Status or Patient Info */}
                    {bed.bed_status === 'occupied' && bed.patient_name ? (
                      <div className="space-y-1 text-xs">
                        <div className="font-semibold text-gray-900 truncate">
                          {bed.patient_name}
                        </div>
                        <div className="text-gray-600">UHID: {bed.patient_uhid}</div>
                        {bed.patient_gender && (
                          <div className="text-gray-600">
                            {getGenderIcon(bed.patient_gender)} {bed.patient_gender}
                          </div>
                        )}
                        {bed.admission_at && (
                          <div className="text-gray-600">Admitted: {formatDate(bed.admission_at)}</div>
                        )}
                        {bed.diagnosis && (
                          <div className="text-gray-600 line-clamp-2">
                            {truncateText(bed.diagnosis, 30)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`text-center py-4 ${statusLabelClass}`}>
                        {bed.bed_status === 'available' ? 'Available' : ''}
                        {bed.bed_status === 'reserved' ? 'Reserved' : ''}
                        {bed.bed_status === 'blocked' ? 'Blocked' : ''}
                        {bed.bed_status === 'housekeeping' ? 'Housekeeping' : ''}
                      </div>
                    )}

                    {/* Action Panel */}
                    {isActive && bed.bed_status !== 'occupied' && (
                      <div className="absolute inset-0 bg-white border-2 border-blue-500 rounded-lg p-3 flex flex-col gap-2 z-10">
                        <div className="text-xs font-semibold text-gray-700 mb-1">
                          Change Status
                        </div>

                        <textarea
                          placeholder="Reason (optional)"
                          value={actionReason}
                          onChange={e => setActionReason(e.target.value)}
                          maxLength={200}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-900 resize-none h-12"
                        />

                        <div className="grid grid-cols-2 gap-1">
                          {bed.bed_status !== 'available' && (
                            <button
                              onClick={() => handleStatusChange('available')}
                              disabled={actionLoading}
                              className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              Available
                            </button>
                          )}
                          {bed.bed_status !== 'reserved' && (
                            <button
                              onClick={() => handleStatusChange('reserved')}
                              disabled={actionLoading}
                              className="px-2 py-1 text-xs font-medium bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                            >
                              Reserve
                            </button>
                          )}
                          {bed.bed_status !== 'blocked' && (
                            <button
                              onClick={() => handleStatusChange('blocked')}
                              disabled={actionLoading}
                              className="px-2 py-1 text-xs font-medium bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                            >
                              Block
                            </button>
                          )}
                          {bed.bed_status !== 'housekeeping' && (
                            <button
                              onClick={() => handleStatusChange('housekeeping')}
                              disabled={actionLoading}
                              className="px-2 py-1 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                            >
                              Housekeeping
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => setActionPanel(null)}
                          className="px-2 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filteredWards.length === 0 && !loading && (
          <div className="text-center py-8 text-gray-500">
            No wards found for the selected filter.
          </div>
        )}
      </main>
    </div>
  );
}
