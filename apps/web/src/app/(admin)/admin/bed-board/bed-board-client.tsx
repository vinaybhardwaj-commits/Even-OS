'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ─── Types (match bed router response) ───────────────────────
type Bed = {
  id: string;
  code: string;
  name: string;
  bed_status: 'available' | 'occupied' | 'reserved' | 'blocked' | 'housekeeping' | 'terminal_cleaning' | 'maintenance';
  patient_id?: string;
  patient_uhid?: string;
  patient_name?: string;
  patient_gender?: string;
  encounter_id?: string;
  encounter_class?: string;
  admission_at?: string;
  diagnosis?: string;
  chief_complaint?: string;
  expected_los_days?: number;
  journey_type?: string;
};

type Room = {
  id: string;
  code: string;
  name: string;
  room_type: string;
  room_tag: string;
  capacity: number;
  infrastructure_flags: any;
  beds: Bed[];
};

type Ward = {
  id: string;
  code: string;
  name: string;
  ward_type: string;
  capacity: number;
  infrastructure_flags: any;
  rooms: Room[];
};

type Floor = {
  id: string;
  code: string;
  name: string;
  floor_number: number;
  wards: Ward[];
};

type StatusCounts = {
  available: number;
  occupied: number;
  reserved: number;
  blocked: number;
  housekeeping: number;
  terminal_cleaning: number;
  maintenance: number;
  total: number;
};

type WardSummary = {
  ward_code: string;
  ward_name: string;
  ward_type: string;
  floor_number: number;
  total: number;
  available: number;
  occupied: number;
};

type Stats = {
  global: StatusCounts;
  floor: StatusCounts | null;
  wards: WardSummary[];
};

type FloorSummary = {
  id: string;
  code: string;
  name: string;
  floor_number: number;
  total_beds: number;
  available_beds: number;
  occupied_beds: number;
};

type BedHistoryEntry = {
  id: string;
  status: string;
  reason: string | null;
  changed_at: string;
  changed_by_user_id: string | null;
};

// ─── tRPC fetch helpers ──────────────────────────────────────
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

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ─── Utility helpers ─────────────────────────────────────────
function getGenderIcon(gender?: string): string {
  if (!gender) return '';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return '♂';
  if (g === 'female' || g === 'f') return '♀';
  return '◯';
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatDateTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function daysSince(isoString?: string): number {
  if (!isoString) return 0;
  const ms = Date.now() - new Date(isoString).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// ─── Status styling ──────────────────────────────────────────
const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; label: string; dot: string }> = {
  available:         { bg: 'bg-green-50',   border: 'border-green-300',   text: 'text-green-800',   label: 'Available',         dot: 'bg-green-500' },
  occupied:          { bg: 'bg-blue-50',    border: 'border-blue-400',    text: 'text-blue-900',    label: 'Occupied',          dot: 'bg-blue-500' },
  reserved:          { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-800',   label: 'Reserved',          dot: 'bg-amber-500' },
  blocked:           { bg: 'bg-red-50',     border: 'border-red-300',     text: 'text-red-800',     label: 'Blocked',           dot: 'bg-red-500' },
  housekeeping:      { bg: 'bg-orange-50',  border: 'border-orange-300',  text: 'text-orange-800',  label: 'Housekeeping',      dot: 'bg-orange-500' },
  terminal_cleaning: { bg: 'bg-purple-50',  border: 'border-purple-300',  text: 'text-purple-800',  label: 'Terminal Cleaning', dot: 'bg-purple-500' },
  maintenance:       { bg: 'bg-gray-100',   border: 'border-gray-400',    text: 'text-gray-700',    label: 'Maintenance',       dot: 'bg-gray-500' },
};

const ROOM_TAG_STYLES: Record<string, { label: string; className: string }> = {
  none:      { label: '',          className: '' },
  day_care:  { label: 'Day Care',  className: 'bg-teal-100 text-teal-800' },
  maternity: { label: 'Maternity', className: 'bg-pink-100 text-pink-800' },
  isolation: { label: 'Isolation', className: 'bg-red-100 text-red-800' },
};

const WARD_TYPE_LABELS: Record<string, string> = {
  general: 'General Ward',
  icu: 'ICU',
  nicu: 'NICU',
  pacu: 'PACU',
  dialysis: 'Dialysis',
  day_care: 'Day Care',
  maternity: 'Maternity',
  step_down: 'Step-Down',
};

const ADMIN_ROLES = new Set(['super_admin', 'hospital_admin', 'gm']);

// ─── Main Client Component ───────────────────────────────────
interface BedBoardClientProps {
  userRole: string;
}

export function BedBoardClient({ userRole }: BedBoardClientProps) {
  const isAdmin = ADMIN_ROLES.has(userRole);

  const [floorsList, setFloorsList] = useState<FloorSummary[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [boardData, setBoardData] = useState<Floor[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [drawerBed, setDrawerBed] = useState<{ bed: Bed; room: Room; ward: Ward; floor: Floor } | null>(null);
  const [drawerReason, setDrawerReason] = useState('');
  const [drawerAction, setDrawerAction] = useState<'status' | 'tag' | 'history' | null>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerHistory, setDrawerHistory] = useState<BedHistoryEntry[]>([]);

  // AI Bed Intelligence
  const [showAI, setShowAI] = useState(false);
  const [aiPredictions, setAiPredictions] = useState<any[]>([]);
  const [aiForecast, setAiForecast] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const pollInterval = useRef<NodeJS.Timeout>();

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const boardInput = selectedFloor === 'all' ? undefined : { floor_number: selectedFloor };
      const statsInput = selectedFloor === 'all' ? undefined : { floor_number: selectedFloor };
      const [board, statsData, floorsData] = await Promise.all([
        trpcQuery('bed.board', boardInput),
        trpcQuery('bed.stats', statsInput),
        trpcQuery('bed.listFloors'),
      ]);
      setBoardData(board?.floors || []);
      setStats(statsData);
      setFloorsList(floorsData || []);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load bed board');
      setLoading(false);
    }
  }, [selectedFloor]);

  useEffect(() => {
    fetchData();
    if (pollInterval.current) clearInterval(pollInterval.current);
    pollInterval.current = setInterval(fetchData, 10000);
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [fetchData]);

  // Refresh drawer state after fetch
  useEffect(() => {
    if (!drawerBed) return;
    for (const floor of boardData) {
      for (const ward of floor.wards) {
        for (const room of ward.rooms) {
          for (const bed of room.beds) {
            if (bed.id === drawerBed.bed.id) {
              setDrawerBed({ bed, room, ward, floor });
              return;
            }
          }
        }
      }
    }
  }, [boardData]);

  const handleBedClick = (bed: Bed, room: Room, ward: Ward, floor: Floor) => {
    setDrawerBed({ bed, room, ward, floor });
    setDrawerReason('');
    setDrawerAction(null);
    setDrawerHistory([]);
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      await trpcMutate('bed.updateStatus', {
        bed_id: drawerBed.bed.id,
        status: newStatus,
        reason: drawerReason || undefined,
      });
      setSuccess(`Bed ${drawerBed.bed.code} → ${STATUS_STYLES[newStatus]?.label || newStatus}`);
      setDrawerAction(null);
      setDrawerReason('');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Status update failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleTagRoom = async (tag: 'none' | 'day_care' | 'maternity' | 'isolation') => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      await trpcMutate('bed.tagRoom', {
        room_id: drawerBed.room.id,
        tag,
        reason: drawerReason || undefined,
      });
      setSuccess(`Room ${drawerBed.room.code} tag → ${tag === 'none' ? 'cleared' : tag}`);
      setDrawerAction(null);
      setDrawerReason('');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Tag update failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleLoadHistory = async () => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      const history = await trpcQuery('bed.history', { bed_id: drawerBed.bed.id, limit: 20 });
      setDrawerHistory(history || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    } finally {
      setDrawerBusy(false);
    }
  };

  const loadAIData = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const [preds, forecast] = await Promise.all([
        trpcQuery('evenAI.getBedPredictions', {}),
        trpcQuery('evenAI.getOccupancyForecast', { days: 7 }),
      ]);
      setAiPredictions(preds?.predictions || []);
      setAiForecast(forecast?.forecast || null);
    } catch (err: any) {
      setAiError(err.message || 'Failed to load AI predictions');
    } finally {
      setAiLoading(false);
    }
  };

  const runPredictions = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      await trpcMutate('evenAI.runBedPredictions', {});
      await loadAIData();
    } catch (err: any) {
      setAiError(err.message || 'Failed to run predictions');
      setAiLoading(false);
    }
  };

  // Flatten to the wards we should render (on selected floor, or all floors stacked)
  const displayedFloors = useMemo(() => {
    if (selectedFloor === 'all') return boardData;
    return boardData.filter(f => f.floor_number === selectedFloor);
  }, [boardData, selectedFloor]);

  const displayedStats = stats?.floor || stats?.global || null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">
            &larr; Dashboard
          </a>
          <h1 className="text-xl font-bold">Bed Board</h1>
          <span className="text-xs text-blue-200">3-tier · Floor → Ward → Room → Bed</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-blue-100">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Live · 10s
          </span>
          {lastUpdated && (
            <span>
              {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </header>

      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Floor Tabs */}
        <div className="mb-5">
          <div className="flex items-center gap-2 border-b border-gray-200">
            <button
              onClick={() => setSelectedFloor('all')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                selectedFloor === 'all'
                  ? 'border-blue-900 text-blue-900'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              All Floors
              <span className="ml-2 text-xs text-gray-500">
                {stats?.global.total || 0} beds
              </span>
            </button>
            {floorsList.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedFloor(f.floor_number)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  selectedFloor === f.floor_number
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {f.name}
                <span className="ml-2 text-xs text-gray-500">
                  {f.occupied_beds}/{f.total_beds}
                </span>
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-50 rounded disabled:opacity-50 mb-1"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {displayedStats && (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
            <StatCard label="Total" value={displayedStats.total} tone="blue" />
            <StatCard label="Available" value={displayedStats.available} tone="green" />
            <StatCard label="Occupied" value={displayedStats.occupied} tone="blue-solid" />
            <StatCard label="Reserved" value={displayedStats.reserved} tone="amber" />
            <StatCard label="Blocked" value={displayedStats.blocked} tone="red" />
            <StatCard label="HK" value={displayedStats.housekeeping} tone="orange" />
            <StatCard label="Terminal" value={displayedStats.terminal_cleaning} tone="purple" />
            <StatCard label="Maint." value={displayedStats.maintenance} tone="gray" />
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 font-medium">×</button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* AI Panel Toggle */}
        <div className="mb-6">
          <button
            onClick={() => { setShowAI(!showAI); if (!showAI && aiPredictions.length === 0) loadAIData(); }}
            className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 flex items-center gap-2"
          >
            🤖 {showAI ? 'Hide' : 'Show'} AI Bed Intelligence
          </button>

          {showAI && (
            <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-violet-900">AI Bed Intelligence</h2>
                <button
                  onClick={runPredictions}
                  disabled={aiLoading}
                  className="px-3 py-1 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {aiLoading ? 'Running…' : 'Run Predictions'}
                </button>
              </div>

              {aiError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">{aiError}</div>}
              {aiLoading && <p className="text-violet-700 text-xs">Loading AI predictions…</p>}

              {aiForecast && (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold text-violet-800 mb-2">Occupancy Forecast (7 days)</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Current Occupancy</p>
                      <p className="text-lg font-bold text-violet-900">{aiForecast.current?.occupancy_pct?.toFixed(0) || 0}%</p>
                    </div>
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Occupied / Total</p>
                      <p className="text-lg font-bold text-violet-900">{aiForecast.current?.occupied || 0} / {aiForecast.current?.total_beds || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Pred. Discharges Today</p>
                      <p className="text-lg font-bold text-green-700">{aiForecast.predicted_discharges?.[0]?.count || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Pred. Discharges (7d)</p>
                      <p className="text-lg font-bold text-green-700">
                        {aiForecast.predicted_discharges?.reduce((s: number, d: any) => s + (d.count || 0), 0) || 0}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {aiPredictions.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-violet-800 mb-2">Discharge Predictions ({aiPredictions.length})</h3>
                  <div className="bg-white rounded border border-violet-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-violet-100 text-violet-900">
                          <th className="text-left p-2">Bed</th>
                          <th className="text-left p-2">Patient</th>
                          <th className="text-left p-2">Predicted</th>
                          <th className="text-left p-2">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiPredictions.slice(0, 20).map((pred: any, idx: number) => (
                          <tr key={idx} className="border-t border-violet-50">
                            <td className="p-2 font-medium">{pred.bed_number || pred.bed_id?.slice(0, 8)}</td>
                            <td className="p-2">{pred.patient_name || 'N/A'}</td>
                            <td className="p-2">{pred.predicted_discharge_at ? formatDateTime(pred.predicted_discharge_at) : 'N/A'}</td>
                            <td className="p-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                (pred.confidence || 0) >= 0.8 ? 'bg-green-100 text-green-800'
                                : (pred.confidence || 0) >= 0.5 ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                                {((pred.confidence || 0) * 100).toFixed(0)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!aiLoading && aiPredictions.length === 0 && !aiError && (
                <p className="text-violet-700 text-xs">No predictions yet. Click &quot;Run Predictions&quot;.</p>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mb-5 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-gray-500 font-medium">Bed Status:</span>
          {Object.entries(STATUS_STYLES).map(([status, s]) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.dot}`} />
              <span className="text-gray-700">{s.label}</span>
            </span>
          ))}
        </div>

        {/* Floor Canvas */}
        {loading && boardData.length === 0 ? (
          <div className="text-center py-12 text-gray-500">Loading bed board…</div>
        ) : displayedFloors.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No active beds for this floor.</div>
        ) : (
          <div className="space-y-6">
            {displayedFloors.map(floor => (
              <FloorSection
                key={floor.id}
                floor={floor}
                onBedClick={handleBedClick}
                activeBedId={drawerBed?.bed.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Right-side Drawer */}
      {drawerBed && (
        <BedDrawer
          data={drawerBed}
          isAdmin={isAdmin}
          busy={drawerBusy}
          reason={drawerReason}
          setReason={setDrawerReason}
          action={drawerAction}
          setAction={setDrawerAction}
          history={drawerHistory}
          onLoadHistory={handleLoadHistory}
          onUpdateStatus={handleUpdateStatus}
          onTagRoom={handleTagRoom}
          onClose={() => {
            setDrawerBed(null);
            setDrawerAction(null);
            setDrawerReason('');
            setDrawerHistory([]);
          }}
        />
      )}
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'blue-solid' | 'green' | 'amber' | 'red' | 'orange' | 'purple' | 'gray';
}) {
  const tones: Record<string, { border: string; text: string; label: string }> = {
    blue:         { border: 'border-blue-200',   text: 'text-blue-900',    label: 'text-blue-600' },
    'blue-solid': { border: 'border-blue-300',   text: 'text-blue-800',    label: 'text-blue-700' },
    green:        { border: 'border-green-200',  text: 'text-green-700',   label: 'text-green-600' },
    amber:        { border: 'border-amber-200',  text: 'text-amber-700',   label: 'text-amber-600' },
    red:          { border: 'border-red-200',    text: 'text-red-700',     label: 'text-red-600' },
    orange:       { border: 'border-orange-200', text: 'text-orange-700',  label: 'text-orange-600' },
    purple:       { border: 'border-purple-200', text: 'text-purple-700',  label: 'text-purple-600' },
    gray:         { border: 'border-gray-200',   text: 'text-gray-700',    label: 'text-gray-600' },
  };
  const t = tones[tone];
  return (
    <div className={`bg-white rounded-lg p-3 border ${t.border} shadow-sm`}>
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${t.label}`}>{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${t.text}`}>{value}</p>
    </div>
  );
}

// ─── FloorSection ────────────────────────────────────────────
function FloorSection({
  floor,
  onBedClick,
  activeBedId,
}: {
  floor: Floor;
  onBedClick: (bed: Bed, room: Room, ward: Ward, floor: Floor) => void;
  activeBedId?: string;
}) {
  const floorTotalBeds = floor.wards.reduce((sum, w) => sum + w.rooms.reduce((s, r) => s + r.beds.length, 0), 0);
  const floorOccupied = floor.wards.reduce((sum, w) =>
    sum + w.rooms.reduce((s, r) => s + r.beds.filter(b => b.bed_status === 'occupied').length, 0), 0
  );

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3 pb-2 border-b-2 border-gray-300">
        <h2 className="text-xl font-bold text-gray-900">{floor.name}</h2>
        <span className="text-xs text-gray-500">
          {floor.wards.length} ward{floor.wards.length !== 1 ? 's' : ''} · {floorOccupied}/{floorTotalBeds} occupied
        </span>
      </div>

      <div className="space-y-4">
        {floor.wards.map(ward => (
          <WardSection
            key={ward.id}
            ward={ward}
            floor={floor}
            onBedClick={onBedClick}
            activeBedId={activeBedId}
          />
        ))}
      </div>
    </section>
  );
}

// ─── WardSection ─────────────────────────────────────────────
function WardSection({
  ward,
  floor,
  onBedClick,
  activeBedId,
}: {
  ward: Ward;
  floor: Floor;
  onBedClick: (bed: Bed, room: Room, ward: Ward, floor: Floor) => void;
  activeBedId?: string;
}) {
  const totalBeds = ward.rooms.reduce((s, r) => s + r.beds.length, 0);
  const occupied = ward.rooms.reduce((s, r) => s + r.beds.filter(b => b.bed_status === 'occupied').length, 0);
  const available = ward.rooms.reduce((s, r) => s + r.beds.filter(b => b.bed_status === 'available').length, 0);
  const wardTypeLabel = WARD_TYPE_LABELS[ward.ward_type] || ward.ward_type;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-semibold text-gray-900">{ward.name}</h3>
          <span className="text-xs text-gray-500">{wardTypeLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium">{available} avail</span>
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">{occupied} occ</span>
          <span className="text-gray-500">of {totalBeds}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {ward.rooms.map(room => (
          <RoomCard
            key={room.id}
            room={room}
            ward={ward}
            floor={floor}
            onBedClick={onBedClick}
            activeBedId={activeBedId}
          />
        ))}
      </div>
    </div>
  );
}

// ─── RoomCard ────────────────────────────────────────────────
function RoomCard({
  room,
  ward,
  floor,
  onBedClick,
  activeBedId,
}: {
  room: Room;
  ward: Ward;
  floor: Floor;
  onBedClick: (bed: Bed, room: Room, ward: Ward, floor: Floor) => void;
  activeBedId?: string;
}) {
  const capacity = Math.max(room.beds.length, room.capacity || 1);
  // Proportional width: semi-private (2 beds) is wider than private/suite (1 bed)
  const widthClass = capacity === 2 ? 'w-[22rem]' : 'w-[10.5rem]';
  const roomTypeLabel: Record<string, string> = {
    private: 'Private',
    semi_private: 'Semi-Private',
    suite: 'Suite',
    icu_room: 'ICU',
    nicu_room: 'NICU',
    pacu_bay: 'PACU Bay',
    dialysis_station: 'Dialysis',
    general: 'General',
  };
  const label = roomTypeLabel[room.room_type] || room.room_type;
  const tag = ROOM_TAG_STYLES[room.room_tag || 'none'] || ROOM_TAG_STYLES.none;

  return (
    <div className={`${widthClass} border border-gray-300 rounded-lg bg-gray-50 p-2 shadow-sm`}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800">{room.code}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
        {tag.label && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${tag.className}`}>
            {tag.label}
          </span>
        )}
      </div>

      <div className={`grid gap-2 ${capacity === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {room.beds.map(bed => (
          <BedCell
            key={bed.id}
            bed={bed}
            isActive={activeBedId === bed.id}
            onClick={() => onBedClick(bed, room, ward, floor)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── BedCell ─────────────────────────────────────────────────
function BedCell({
  bed,
  isActive,
  onClick,
}: {
  bed: Bed;
  isActive: boolean;
  onClick: () => void;
}) {
  const style = STATUS_STYLES[bed.bed_status] || STATUS_STYLES.available;
  const isOccupied = bed.bed_status === 'occupied';

  return (
    <button
      onClick={onClick}
      className={`text-left relative border-2 rounded-md p-2 min-h-[100px] transition-all hover:shadow-md ${
        style.bg
      } ${style.border} ${isActive ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-900">{bed.code}</span>
        <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      </div>

      {isOccupied && bed.patient_name ? (
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold text-gray-900 truncate">
            {bed.patient_name}
          </div>
          <div className="text-[10px] text-gray-600 truncate">
            {getGenderIcon(bed.patient_gender)} {bed.patient_uhid}
          </div>
          {bed.admission_at && (
            <div className="text-[10px] text-gray-500">
              Day {daysSince(bed.admission_at) + 1}
            </div>
          )}
          {bed.diagnosis && (
            <div className="text-[10px] text-gray-600 line-clamp-2 leading-tight">
              {bed.diagnosis}
            </div>
          )}
        </div>
      ) : (
        <div className={`text-center py-3 text-xs font-medium ${style.text}`}>
          {style.label}
        </div>
      )}
    </button>
  );
}

// ─── BedDrawer (Right-side panel) ────────────────────────────
function BedDrawer({
  data,
  isAdmin,
  busy,
  reason,
  setReason,
  action,
  setAction,
  history,
  onLoadHistory,
  onUpdateStatus,
  onTagRoom,
  onClose,
}: {
  data: { bed: Bed; room: Room; ward: Ward; floor: Floor };
  isAdmin: boolean;
  busy: boolean;
  reason: string;
  setReason: (s: string) => void;
  action: 'status' | 'tag' | 'history' | null;
  setAction: (a: 'status' | 'tag' | 'history' | null) => void;
  history: BedHistoryEntry[];
  onLoadHistory: () => void;
  onUpdateStatus: (status: string) => void;
  onTagRoom: (tag: 'none' | 'day_care' | 'maternity' | 'isolation') => void;
  onClose: () => void;
}) {
  const { bed, room, ward, floor } = data;
  const style = STATUS_STYLES[bed.bed_status] || STATUS_STYLES.available;
  const isOccupied = bed.bed_status === 'occupied';
  const currentTag = room.room_tag || 'none';

  const statusOptions: Array<{ status: string; label: string; color: string }> = [
    { status: 'available',         label: 'Mark Available',         color: 'bg-green-600 hover:bg-green-700' },
    { status: 'reserved',          label: 'Reserve',                color: 'bg-amber-600 hover:bg-amber-700' },
    { status: 'blocked',           label: 'Block',                  color: 'bg-red-600 hover:bg-red-700' },
    { status: 'housekeeping',      label: 'Housekeeping',           color: 'bg-orange-600 hover:bg-orange-700' },
    { status: 'terminal_cleaning', label: 'Terminal Cleaning',      color: 'bg-purple-600 hover:bg-purple-700' },
    { status: 'maintenance',       label: 'Maintenance',            color: 'bg-gray-600 hover:bg-gray-700' },
  ].filter(o => o.status !== bed.bed_status);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-30" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-40 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`p-4 border-b-2 ${style.border} ${style.bg}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl font-bold text-gray-900">{bed.code}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
                  {style.label}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                {floor.name} · {ward.name} · Room {room.code}
              </div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl leading-none">×</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Patient Info (if occupied) */}
          {isOccupied && bed.patient_name ? (
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Patient</h3>
              <div className="space-y-1.5">
                <div>
                  <div className="text-base font-semibold text-gray-900">
                    {getGenderIcon(bed.patient_gender)} {bed.patient_name}
                  </div>
                  <div className="text-xs text-gray-600">UHID: {bed.patient_uhid}</div>
                </div>
                {bed.admission_at && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Admitted:</span>{' '}
                    {formatDateTime(bed.admission_at)}
                    <span className="text-gray-500 ml-1">(Day {daysSince(bed.admission_at) + 1})</span>
                  </div>
                )}
                {bed.encounter_class && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Class:</span> {bed.encounter_class}
                  </div>
                )}
                {bed.expected_los_days != null && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Expected LOS:</span> {bed.expected_los_days} day(s)
                  </div>
                )}
                {bed.chief_complaint && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Complaint:</span> {bed.chief_complaint}
                  </div>
                )}
                {bed.diagnosis && bed.diagnosis !== bed.chief_complaint && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Diagnosis:</span> {bed.diagnosis}
                  </div>
                )}
                {bed.encounter_id && (
                  <a
                    href={`/admin/encounters/${bed.encounter_id}`}
                    className="inline-block mt-2 text-xs text-blue-700 hover:text-blue-900 font-medium"
                  >
                    View encounter →
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Status</h3>
              <div className="text-sm text-gray-700">
                Bed is currently <span className="font-semibold">{style.label.toLowerCase()}</span>.
              </div>
            </div>
          )}

          {/* Room Info */}
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Room</h3>
            <div className="text-sm text-gray-800">
              <div><span className="text-gray-500">Type:</span> {room.room_type.replace('_', '-')}</div>
              <div><span className="text-gray-500">Capacity:</span> {room.capacity} bed{room.capacity !== 1 ? 's' : ''}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gray-500">Tag:</span>
                {currentTag === 'none' ? (
                  <span className="text-gray-400 italic">none</span>
                ) : (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${ROOM_TAG_STYLES[currentTag]?.className || ''}`}>
                    {ROOM_TAG_STYLES[currentTag]?.label || currentTag}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 space-y-3">
            {action === null && (
              <>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Actions</h3>

                {/* Primary action — transfer/assign placeholders (BM.3) */}
                {isOccupied ? (
                  <button
                    disabled
                    title="Coming in BM.3"
                    className="w-full px-3 py-2 text-sm font-medium bg-gray-200 text-gray-500 rounded border border-gray-300 cursor-not-allowed"
                  >
                    Transfer Patient <span className="text-[10px]">(BM.3)</span>
                  </button>
                ) : bed.bed_status === 'available' ? (
                  <button
                    disabled
                    title="Coming in BM.3"
                    className="w-full px-3 py-2 text-sm font-medium bg-gray-200 text-gray-500 rounded border border-gray-300 cursor-not-allowed"
                  >
                    Assign Patient <span className="text-[10px]">(BM.3)</span>
                  </button>
                ) : null}

                {!isOccupied && (
                  <button
                    onClick={() => setAction('status')}
                    className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Change Status
                  </button>
                )}

                <button
                  onClick={() => setAction('tag')}
                  className="w-full px-3 py-2 text-sm font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Tag Room
                </button>

                <button
                  onClick={() => { setAction('history'); onLoadHistory(); }}
                  className="w-full px-3 py-2 text-sm font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  View History
                </button>
              </>
            )}

            {action === 'status' && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase">Change Status</h3>
                  <button onClick={() => setAction(null)} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
                </div>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  maxLength={200}
                  rows={2}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="space-y-1.5">
                  {statusOptions.map(opt => (
                    <button
                      key={opt.status}
                      onClick={() => onUpdateStatus(opt.status)}
                      disabled={busy}
                      className={`w-full px-3 py-2 text-sm font-medium text-white rounded disabled:opacity-50 ${opt.color}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {action === 'tag' && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase">Tag Room</h3>
                  <button onClick={() => setAction(null)} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
                </div>
                <p className="text-xs text-gray-600">
                  Room tags are temporary (e.g., Day Care auto-clears on discharge). Applies to all beds in {room.code}.
                </p>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  maxLength={200}
                  rows={2}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  {(['none', 'day_care', 'maternity', 'isolation'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => onTagRoom(t)}
                      disabled={busy || t === currentTag}
                      className={`px-3 py-2 text-xs font-medium rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                        t === currentTag
                          ? 'bg-gray-100 text-gray-500 border-gray-300'
                          : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {t === 'none' ? 'Clear Tag' : ROOM_TAG_STYLES[t].label}
                      {t === currentTag && ' (current)'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {action === 'history' && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase">Status History</h3>
                  <button onClick={() => setAction(null)} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
                </div>
                {busy && history.length === 0 ? (
                  <p className="text-xs text-gray-500">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-gray-500">No history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map(h => {
                      const s = STATUS_STYLES[h.status] || STATUS_STYLES.available;
                      return (
                        <div key={h.id} className="text-xs border-l-2 pl-2 py-1" style={{ borderColor: 'currentColor' }}>
                          <div className="flex items-center justify-between">
                            <span className={`font-semibold ${s.text}`}>{s.label}</span>
                            <span className="text-gray-500">{formatDateTime(h.changed_at)}</span>
                          </div>
                          {h.reason && <div className="text-gray-600 mt-0.5">{h.reason}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Admin-only quick links */}
            {isAdmin && action === null && (
              <div className="pt-3 mt-3 border-t border-gray-200">
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Admin</h3>
                <div className="space-y-1.5">
                  <a
                    href="/admin/bed-structure"
                    className="block w-full px-3 py-2 text-xs font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 text-center"
                  >
                    Edit Layout <span className="text-gray-400">(BM.4)</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
