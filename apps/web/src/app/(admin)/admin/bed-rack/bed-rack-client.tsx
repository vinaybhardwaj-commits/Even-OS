'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────
type BedLite = { id: string; code: string; name: string; bed_status: string };
type RoomLite = { id: string; code: string; name: string; room_type: string | null; room_tag: string | null; beds: BedLite[] };
type WardLite = { id: string; code: string; name: string; ward_type: string | null; rooms: RoomLite[]; bed_ids: string[] };
type FloorLite = { id: string; code: string; name: string; floor_number: number; wards: WardLite[] };

type Segment = {
  bed_id: string;
  status: string;
  reason: string | null;
  start: string;
  end: string;
  duration_mins: number;
  full_duration_mins: number;
  exceeded_sla: boolean;
  encounter_id?: string;
  admission_at?: string;
  expected_los_days?: number;
  journey_type?: string;
  chief_complaint?: string;
  patient_id?: string;
  patient_uhid?: string;
  patient_name?: string;
  patient_gender?: string;
};

type RackPayload = {
  hierarchy: FloorLite[];
  segments: Segment[];
  from: string;
  to: string;
};

type PresetKey = 'today' | '3d' | '7d' | '14d' | '30d' | 'custom';

// ─── tRPC helpers ────────────────────────────────────────────
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

// ─── Constants ───────────────────────────────────────────────
const BAR_HEIGHT = 22;
const ROW_PADDING = 4;
const LABEL_WIDTH = 200;
const FLOOR_ROW_HEIGHT = 30;
const WARD_ROW_HEIGHT = 26;
const ROOM_ROW_HEIGHT = 22;

// Status → bar color
const STATUS_COLOR: Record<string, string> = {
  occupied:          'bg-blue-500',
  terminal_cleaning: 'bg-purple-500',
  housekeeping:      'bg-orange-400',
  maintenance:       'bg-gray-400',
  reserved:          'bg-amber-400',
  blocked:           'bg-red-500',
  available:         'bg-green-100',
};

const STATUS_LABEL: Record<string, string> = {
  occupied: 'Occupied',
  terminal_cleaning: 'Terminal cleaning',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  reserved: 'Reserved',
  blocked: 'Blocked',
  available: 'Available',
};

// ─── Utilities ───────────────────────────────────────────────
function nowIso() { return new Date().toISOString(); }

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function computeWindow(preset: PresetKey, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  if (preset === 'today') {
    return { from: startOfDay(now).toISOString(), to };
  }
  if (preset === 'custom' && customFrom && customTo) {
    return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() };
  }
  const days = preset === '3d' ? 3 : preset === '14d' ? 14 : preset === '30d' ? 30 : 7;
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  return { from, to };
}

function fmtShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtHours(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtDays(mins: number): string {
  const d = mins / (60 * 24);
  if (d < 1) return fmtHours(mins);
  return `${d.toFixed(1)}d`;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export function BedRackClient({ userRole }: { userRole: string }) {
  const [preset, setPreset] = useState<PresetKey>('7d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [wardFilter, setWardFilter] = useState<string | null>(null);

  const [payload, setPayload] = useState<RackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hoverSeg, setHoverSeg] = useState<Segment | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const window = useMemo(
    () => computeWindow(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const input: any = { from: window.from, to: window.to };
      if (floorFilter) input.floor_number = floorFilter;
      if (wardFilter) input.ward_code = wardFilter;
      const data = await trpcQuery('bed.rackTimeline', input);
      setPayload(data);
      // Auto-expand floors on first successful load
      if (expanded.size === 0 && data?.hierarchy?.length > 0) {
        const s = new Set<string>();
        for (const f of data.hierarchy as FloorLite[]) s.add(f.id);
        setExpanded(s);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load rack timeline');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window.from, window.to, floorFilter, wardFilter]);

  useEffect(() => { load(); }, [load]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Group segments by bed
  const segsByBed = useMemo(() => {
    const map = new Map<string, Segment[]>();
    if (!payload) return map;
    for (const s of payload.segments) {
      const arr = map.get(s.bed_id);
      if (arr) arr.push(s); else map.set(s.bed_id, [s]);
    }
    return map;
  }, [payload]);

  // Summary stats
  const stats = useMemo(() => {
    if (!payload) return null;
    let occMins = 0, cleanMins = 0, hkMins = 0, maintMins = 0, reservedMins = 0, blockedMins = 0;
    let slaBreaches = 0, slaMinsTotal = 0, slaCount = 0;
    let losTotal = 0, losCount = 0;
    for (const s of payload.segments) {
      if (s.status === 'occupied') {
        occMins += s.duration_mins;
        if (s.admission_at) {
          const los = (new Date(s.end).getTime() - new Date(s.admission_at).getTime()) / 60000;
          if (los > 0) { losTotal += los; losCount++; }
        }
      } else if (s.status === 'terminal_cleaning') {
        cleanMins += s.duration_mins;
        slaMinsTotal += s.full_duration_mins;
        slaCount++;
        if (s.exceeded_sla) slaBreaches++;
      } else if (s.status === 'housekeeping') {
        hkMins += s.duration_mins;
      } else if (s.status === 'maintenance') {
        maintMins += s.duration_mins;
      } else if (s.status === 'reserved') {
        reservedMins += s.duration_mins;
      } else if (s.status === 'blocked') {
        blockedMins += s.duration_mins;
      }
    }
    const totalBeds = payload.hierarchy.reduce((n, f) => n + f.wards.reduce((m, w) => m + w.bed_ids.length, 0), 0);
    const windowHours = (new Date(payload.to).getTime() - new Date(payload.from).getTime()) / 3600000;
    const bedHoursAvailable = totalBeds * windowHours;
    const occupancyPct = bedHoursAvailable > 0 ? (occMins / 60) / bedHoursAvailable * 100 : 0;
    const avgTurnover = slaCount > 0 ? slaMinsTotal / slaCount : 0;
    const avgLos = losCount > 0 ? losTotal / losCount : 0;
    return {
      totalBeds,
      occupancyPct,
      occHours: occMins / 60,
      cleanHours: cleanMins / 60,
      hkHours: hkMins / 60,
      maintHours: maintMins / 60,
      reservedHours: reservedMins / 60,
      blockedHours: blockedMins / 60,
      slaBreaches,
      slaCount,
      avgTurnoverMins: avgTurnover,
      avgLosMins: avgLos,
    };
  }, [payload]);

  // Occupancy trend (per ward, bucketed)
  const trend = useMemo(() => {
    if (!payload) return null;
    const fromMs = new Date(payload.from).getTime();
    const toMs = new Date(payload.to).getTime();
    const windowMs = toMs - fromMs;
    const windowHours = windowMs / 3600000;
    // Choose bucket size: 1h if ≤7d, 4h if ≤14d, 8h if ≤30d, 1d if > 30d
    const bucketHours = windowHours <= 24 ? 1 : windowHours <= 168 ? 2 : windowHours <= 336 ? 4 : 12;
    const bucketMs = bucketHours * 3600000;
    const numBuckets = Math.ceil(windowMs / bucketMs);

    // Precompute occupied segments only
    const occSegs = payload.segments.filter(s => s.status === 'occupied');

    type WardTrend = { ward_id: string; ward_name: string; total: number; points: { at: string; pct: number; occupied: number }[] };
    const wards: WardTrend[] = [];
    for (const f of payload.hierarchy) {
      for (const w of f.wards) {
        const total = w.bed_ids.length;
        if (total === 0) continue;
        const bedSet = new Set(w.bed_ids);
        const points: { at: string; pct: number; occupied: number }[] = [];
        for (let i = 0; i < numBuckets; i++) {
          const ts = fromMs + i * bucketMs + bucketMs / 2;
          let occupied = 0;
          for (const s of occSegs) {
            if (!bedSet.has(s.bed_id)) continue;
            if (new Date(s.start).getTime() <= ts && new Date(s.end).getTime() >= ts) {
              occupied++;
            }
          }
          points.push({
            at: new Date(ts).toISOString(),
            pct: total > 0 ? (occupied / total) * 100 : 0,
            occupied,
          });
        }
        wards.push({ ward_id: w.id, ward_name: w.name, total, points });
      }
    }

    // Hospital aggregate
    const totalBeds = payload.hierarchy.reduce((n, f) => n + f.wards.reduce((m, w) => m + w.bed_ids.length, 0), 0);
    const hospitalPoints: { at: string; pct: number; occupied: number }[] = [];
    if (totalBeds > 0) {
      for (let i = 0; i < numBuckets; i++) {
        const ts = fromMs + i * bucketMs + bucketMs / 2;
        let occupied = 0;
        for (const s of occSegs) {
          if (new Date(s.start).getTime() <= ts && new Date(s.end).getTime() >= ts) occupied++;
        }
        hospitalPoints.push({
          at: new Date(ts).toISOString(),
          pct: (occupied / totalBeds) * 100,
          occupied,
        });
      }
    }

    // SLA breach timeline marks
    const slaMarks = payload.segments
      .filter(s => s.status === 'terminal_cleaning' && s.exceeded_sla)
      .map(s => ({ at: s.start, duration_mins: s.full_duration_mins }));

    return { bucketHours, numBuckets, wards, hospitalPoints, totalBeds, slaMarks };
  }, [payload]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <Link href="/admin/bed-board" className="hover:text-gray-700">← Bed Board</Link>
                <span>/</span>
                <span className="text-gray-900">Rack Chart</span>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mt-1">Bed Rack — Timeline View</h1>
              <p className="text-sm text-gray-600 mt-1">Gantt-style history of every bed over the selected window. Shows occupancy, turnover, and housekeeping gaps with SLA breaches flagged.</p>
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <div className="flex items-center gap-1 bg-gray-100 rounded-md p-0.5">
              {(['today', '3d', '7d', '14d', '30d'] as PresetKey[]).map(p => (
                <button
                  key={p}
                  onClick={() => { setPreset(p); }}
                  className={`px-3 py-1 text-xs font-medium rounded ${preset === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {p === 'today' ? 'Today' : p.toUpperCase()}
                </button>
              ))}
              <button
                onClick={() => setPreset('custom')}
                className={`px-3 py-1 text-xs font-medium rounded ${preset === 'custom' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >Custom</button>
            </div>

            {preset === 'custom' && (
              <div className="flex items-center gap-2 text-xs">
                <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-2 py-1 border border-gray-300 rounded" />
                <span className="text-gray-500">→</span>
                <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-2 py-1 border border-gray-300 rounded" />
              </div>
            )}

            <div className="h-5 w-px bg-gray-200" />

            <select
              value={floorFilter ?? ''}
              onChange={e => setFloorFilter(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="text-xs px-2 py-1.5 border border-gray-300 rounded"
            >
              <option value="">All floors</option>
              <option value="1">Floor 1</option>
              <option value="2">Floor 2</option>
              <option value="3">Floor 3</option>
              <option value="4">Floor 4</option>
            </select>

            {payload && (
              <select
                value={wardFilter ?? ''}
                onChange={e => setWardFilter(e.target.value || null)}
                className="text-xs px-2 py-1.5 border border-gray-300 rounded"
              >
                <option value="">All wards</option>
                {payload.hierarchy.flatMap(f => f.wards).map(w => (
                  <option key={w.id} value={w.code}>{w.code} — {w.name}</option>
                ))}
              </select>
            )}

            <div className="text-xs text-gray-500 ml-auto">
              {payload ? `${fmtShort(payload.from)} → ${fmtShort(payload.to)}` : ''}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 text-xs text-gray-600 flex-wrap">
            <span className="font-medium text-gray-700">Legend:</span>
            {(['occupied', 'terminal_cleaning', 'housekeeping', 'maintenance', 'reserved', 'blocked', 'available'] as const).map(s => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={`inline-block w-3 h-3 rounded-sm ${STATUS_COLOR[s]} ${s === 'available' ? 'border border-green-300' : ''}`} />
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="inline-block w-3 h-3 bg-red-600 rounded-sm" />
              SLA breach (≥2h clean)
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading rack timeline…</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
        ) : !payload ? null : (
          <>
            {/* Summary cards */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
                <StatCard label="Beds" value={String(stats.totalBeds)} sub="active in view" />
                <StatCard label="Occupancy" value={`${stats.occupancyPct.toFixed(1)}%`} sub={`${fmtHours(stats.occHours * 60)} occupied`} tone="blue" />
                <StatCard label="Avg LOS" value={stats.avgLosMins ? fmtDays(stats.avgLosMins) : '—'} sub="per admission" />
                <StatCard label="Turnovers" value={String(stats.slaCount)} sub="terminal cleans" tone="purple" />
                <StatCard label="Avg turnover" value={stats.avgTurnoverMins ? fmtHours(stats.avgTurnoverMins) : '—'} sub={`vs 2h SLA`} />
                <StatCard label="SLA breaches" value={String(stats.slaBreaches)} sub="≥ 2h cleans" tone={stats.slaBreaches > 0 ? 'red' : 'default'} />
              </div>
            )}

            {/* Occupancy trend */}
            {trend && trend.hospitalPoints.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-gray-800">Hospital Occupancy %</div>
                  <div className="text-xs text-gray-500">Bucket: {trend.bucketHours}h · SLA breach ticks below</div>
                </div>
                <OccupancyTrendChart
                  windowFrom={payload.from}
                  windowTo={payload.to}
                  hospitalPoints={trend.hospitalPoints}
                  slaMarks={trend.slaMarks}
                />
              </div>
            )}

            {/* Rack chart */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {payload.hierarchy.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-500">No beds in the selected filter.</div>
              ) : (
                <RackChart
                  payload={payload}
                  segsByBed={segsByBed}
                  expanded={expanded}
                  toggle={toggle}
                  setHoverSeg={setHoverSeg}
                  setHoverPos={setHoverPos}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Hover tooltip */}
      {hoverSeg && hoverPos && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 max-w-xs"
          style={{ left: Math.min(hoverPos.x + 12, globalThis.innerWidth - 280), top: hoverPos.y + 12 }}
        >
          <div className="font-semibold">{STATUS_LABEL[hoverSeg.status] || hoverSeg.status}</div>
          <div className="text-gray-300">{fmtShort(hoverSeg.start)} → {fmtShort(hoverSeg.end)}</div>
          <div className="text-gray-300">Duration: {fmtHours(hoverSeg.duration_mins)}</div>
          {hoverSeg.exceeded_sla && (
            <div className="text-red-300 mt-1">⚠ Full duration {fmtHours(hoverSeg.full_duration_mins)} — exceeded 2h SLA</div>
          )}
          {hoverSeg.patient_name && (
            <div className="mt-1 pt-1 border-t border-gray-700">
              <div>{hoverSeg.patient_name}</div>
              <div className="text-gray-400">UHID {hoverSeg.patient_uhid}</div>
              {hoverSeg.chief_complaint && <div className="text-gray-400 italic">"{hoverSeg.chief_complaint}"</div>}
            </div>
          )}
          {hoverSeg.reason && (
            <div className="mt-1 pt-1 border-t border-gray-700 text-gray-300">Reason: {hoverSeg.reason}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SUMMARY CARDS
// ═══════════════════════════════════════════════════════════

function StatCard({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'blue' | 'purple' | 'red' }) {
  const tones = {
    default: 'bg-white border-gray-200',
    blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200',
    red: 'bg-red-50 border-red-200',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// OCCUPANCY TREND CHART (hand-rolled SVG)
// ═══════════════════════════════════════════════════════════

function OccupancyTrendChart({
  windowFrom,
  windowTo,
  hospitalPoints,
  slaMarks,
}: {
  windowFrom: string;
  windowTo: string;
  hospitalPoints: { at: string; pct: number; occupied: number }[];
  slaMarks: { at: string; duration_mins: number }[];
}) {
  const W = 1500;
  const H = 140;
  const PAD_L = 40;
  const PAD_R = 20;
  const PAD_T = 10;
  const PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const fromMs = new Date(windowFrom).getTime();
  const toMs = new Date(windowTo).getTime();
  const span = toMs - fromMs;

  const xOf = (iso: string) => PAD_L + ((new Date(iso).getTime() - fromMs) / span) * innerW;
  const yOf = (pct: number) => PAD_T + innerH - (pct / 100) * innerH;

  // Build polyline path
  const path = hospitalPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.at).toFixed(1)} ${yOf(p.pct).toFixed(1)}`).join(' ');

  // X-axis ticks — ~6 ticks across the window
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => fromMs + (span * i) / tickCount);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
      {/* Y-axis grid lines */}
      {[0, 25, 50, 75, 100].map(p => (
        <g key={p}>
          <line x1={PAD_L} y1={yOf(p)} x2={W - PAD_R} y2={yOf(p)} stroke="#f3f4f6" strokeWidth={1} />
          <text x={PAD_L - 6} y={yOf(p) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{p}%</text>
        </g>
      ))}
      {/* Filled area under curve */}
      {hospitalPoints.length > 0 && (
        <path
          d={`${path} L ${xOf(hospitalPoints[hospitalPoints.length - 1].at).toFixed(1)} ${yOf(0).toFixed(1)} L ${xOf(hospitalPoints[0].at).toFixed(1)} ${yOf(0).toFixed(1)} Z`}
          fill="rgba(59,130,246,0.1)"
        />
      )}
      {/* Line */}
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth={2} />

      {/* SLA breach ticks (below baseline) */}
      {slaMarks.map((m, i) => (
        <g key={i}>
          <line
            x1={xOf(m.at)} y1={PAD_T + innerH}
            x2={xOf(m.at)} y2={PAD_T + innerH + 6}
            stroke="#dc2626" strokeWidth={2}
          />
        </g>
      ))}

      {/* X-axis labels */}
      {ticks.map((t, i) => (
        <text
          key={i}
          x={PAD_L + (innerW * i) / tickCount}
          y={H - 8}
          textAnchor="middle"
          fontSize={10}
          fill="#6b7280"
        >
          {new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit' })}
        </text>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// RACK CHART (Floor → Ward → Room → Bed with timeline bars)
// ═══════════════════════════════════════════════════════════

function RackChart({
  payload,
  segsByBed,
  expanded,
  toggle,
  setHoverSeg,
  setHoverPos,
}: {
  payload: RackPayload;
  segsByBed: Map<string, Segment[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  setHoverSeg: (s: Segment | null) => void;
  setHoverPos: (p: { x: number; y: number } | null) => void;
}) {
  const fromMs = new Date(payload.from).getTime();
  const toMs = new Date(payload.to).getTime();
  const span = toMs - fromMs;

  // Determine tick strategy (top time ruler)
  const windowHours = span / 3600000;
  const tickCount = windowHours <= 24 ? 12 : windowHours <= 168 ? 7 : windowHours <= 336 ? 14 : 15;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => fromMs + (span * i) / tickCount);

  function pctFromLeft(iso: string): number {
    return ((new Date(iso).getTime() - fromMs) / span) * 100;
  }
  function pctWidth(startIso: string, endIso: string): number {
    return Math.max(0.15, ((new Date(endIso).getTime() - new Date(startIso).getTime()) / span) * 100);
  }

  function segBg(s: Segment): string {
    if (s.status === 'terminal_cleaning' && s.exceeded_sla) return 'bg-red-600';
    return STATUS_COLOR[s.status] || 'bg-gray-200';
  }

  // Render: floor rows, ward rows, room rows, bed rows (latter three collapsible via expanded set)
  return (
    <div className="relative">
      {/* Sticky time ruler */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="flex items-stretch">
          <div className="shrink-0 text-xs font-semibold text-gray-600 px-3 py-2" style={{ width: LABEL_WIDTH }}>
            Floor / Ward / Room / Bed
          </div>
          <div className="relative flex-1 h-8">
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-gray-200 text-[10px] text-gray-500 pl-1"
                style={{ left: `${(100 * i) / tickCount}%` }}
              >
                {new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit' })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tree rows */}
      {payload.hierarchy.map(floor => {
        const floorOpen = expanded.has(floor.id);
        const totalBeds = floor.wards.reduce((n, w) => n + w.bed_ids.length, 0);
        return (
          <div key={floor.id}>
            {/* Floor header */}
            <div
              className="flex items-stretch border-b border-gray-100 bg-gray-50 hover:bg-gray-100 cursor-pointer"
              onClick={() => toggle(floor.id)}
            >
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-gray-900" style={{ width: LABEL_WIDTH, height: FLOOR_ROW_HEIGHT }}>
                <span className="text-gray-400 text-xs w-3">{floorOpen ? '▼' : '▶'}</span>
                <span>Floor {floor.floor_number}</span>
                <span className="text-xs text-gray-500 font-normal">{totalBeds} beds</span>
              </div>
              <div className="flex-1 relative" />
            </div>

            {floorOpen && floor.wards.map(ward => {
              const wardOpen = expanded.has(ward.id);
              return (
                <div key={ward.id}>
                  {/* Ward header */}
                  <div
                    className="flex items-stretch border-b border-gray-100 bg-white hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggle(ward.id)}
                  >
                    <div className="shrink-0 flex items-center gap-2 pl-6 pr-3 py-1 text-xs font-medium text-gray-800" style={{ width: LABEL_WIDTH, height: WARD_ROW_HEIGHT }}>
                      <span className="text-gray-400 text-[10px] w-3">{wardOpen ? '▼' : '▶'}</span>
                      <span>{ward.code}</span>
                      <span className="text-[10px] text-gray-500">{ward.name}</span>
                    </div>
                    <div className="flex-1 relative" />
                  </div>

                  {wardOpen && ward.rooms.map(room => {
                    // Rooms are expanded by default; user can collapse via "collapsed:" marker
                    const showBeds = !expanded.has(`collapsed:${room.id}`);
                    return (
                      <div key={room.id}>
                        {/* Room header */}
                        <div
                          className="flex items-stretch border-b border-gray-100 bg-gray-50/50 hover:bg-gray-100/70 cursor-pointer"
                          onClick={() => toggle(`collapsed:${room.id}`)}
                        >
                          <div className="shrink-0 flex items-center gap-2 pl-10 pr-3 py-0.5 text-xs text-gray-700" style={{ width: LABEL_WIDTH, height: ROOM_ROW_HEIGHT }}>
                            <span className="text-gray-400 text-[10px] w-3">{showBeds ? '▼' : '▶'}</span>
                            <span className="font-mono text-[11px]">{room.code}</span>
                            {room.room_type && <span className="text-[10px] text-gray-500">{room.room_type.replace('_', ' ')}</span>}
                          </div>
                          <div className="flex-1 relative" />
                        </div>

                        {showBeds && room.beds.map(bed => {
                          const segs = segsByBed.get(bed.id) || [];
                          const rowHeight = BAR_HEIGHT + ROW_PADDING * 2;
                          return (
                            <div key={bed.id} className="flex items-stretch border-b border-gray-100 hover:bg-blue-50/30">
                              <div className="shrink-0 flex items-center gap-2 pl-14 pr-3 text-xs text-gray-700 font-mono" style={{ width: LABEL_WIDTH, height: rowHeight }}>
                                <span className="truncate">{bed.code}</span>
                              </div>
                              <div className="flex-1 relative" style={{ height: rowHeight }}>
                                {/* Vertical time gridlines */}
                                {ticks.map((_, i) => (
                                  <div
                                    key={i}
                                    className="absolute top-0 h-full border-l border-gray-100"
                                    style={{ left: `${(100 * i) / tickCount}%` }}
                                  />
                                ))}
                                {/* Segment bars */}
                                {segs.map((s, i) => (
                                  <div
                                    key={i}
                                    className={`absolute ${segBg(s)} rounded-sm cursor-pointer hover:ring-2 hover:ring-blue-400 ${s.status === 'available' ? 'border border-green-300' : ''}`}
                                    style={{
                                      left: `${pctFromLeft(s.start)}%`,
                                      width: `${pctWidth(s.start, s.end)}%`,
                                      top: ROW_PADDING,
                                      height: BAR_HEIGHT,
                                    }}
                                    onMouseEnter={(e) => { setHoverSeg(s); setHoverPos({ x: e.clientX, y: e.clientY }); }}
                                    onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                                    onMouseLeave={() => { setHoverSeg(null); setHoverPos(null); }}
                                  >
                                    {/* Inline label when bar is wide enough */}
                                    {s.patient_name && pctWidth(s.start, s.end) > 6 && (
                                      <span className="absolute inset-0 text-[10px] text-white font-medium truncate px-1.5 leading-[22px]">
                                        {s.patient_name}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
