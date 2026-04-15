'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ─────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Failed');
  return json.result?.data?.json;
}

// ── Types ────────────────────────────────────────────────────
interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  department: string;
  roles: string[];
}

interface Ward {
  id: string;
  name: string;
  code?: string;
}

interface ShiftInstance {
  id: string;
  template_id: string;
  ward_id: string;
  shift_date: string;
  status: string;
  template_name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
}

interface RosterEntry {
  id: string;
  user_id: string;
  role_during_shift: string;
  status: string;
  user_name: string;
  user_email: string;
  user_department: string;
}

type ViewMode = 'week_person' | 'day_ward';

// ── Helpers ──────────────────────────────────────────────────
function getWeekDates(baseDate: string): string[] {
  const d = new Date(baseDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    dates.push(dd.toISOString().split('T')[0]);
  }
  return dates;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

const SHIFT_COLORS: Record<string, string> = {
  morning: '#F59E0B',
  evening: '#3B82F6',
  night: '#6366F1',
  general: '#10B981',
  custom: '#EC4899',
};

// ── Component ────────────────────────────────────────────────
export default function DutyRosterClient({
  userId, userName, userRole,
}: {
  userId: string;
  userName: string;
  userRole: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('week_person');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Data
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [weekDate, setWeekDate] = useState(getToday());
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [selectedWard, setSelectedWard] = useState('');

  // Week view data: Map<user_id, Map<date, shift_info[]>>
  const [weekRoster, setWeekRoster] = useState<Record<string, Record<string, { shift_name: string; start_time: string; end_time: string; color: string; ward_name: string; role: string; roster_id: string }[]>>>({});

  // Day view data: Map<ward_id, { shift_name, entries[] }[]>
  const [dayRoster, setDayRoster] = useState<Record<string, { instance: ShiftInstance; entries: RosterEntry[] }[]>>({});

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ instanceId: string; wardName: string; shiftName: string; date: string } | null>(null);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('nurse');

  // Auto-clear messages
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(''); setSuccess(''); }, 4000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  // Load staff and wards
  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [staffData, wardData] = await Promise.all([
        trpcQuery('auth.listStaff', { limit: 300 }),
        trpcQuery('shifts.getWards'),
      ]);
      setStaff(staffData || []);
      setWards(wardData || []);
      if (wardData?.length > 0 && !selectedWard) {
        setSelectedWard(wardData[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBase(); }, [loadBase]);

  // Load week roster
  const loadWeekRoster = useCallback(async () => {
    const dates = getWeekDates(weekDate);
    const roster: typeof weekRoster = {};

    for (const ward of wards) {
      try {
        const instances = await trpcQuery('shifts.listInstances', {
          ward_id: ward.id,
          start_date: dates[0],
          end_date: dates[6],
        });
        if (!instances) continue;

        for (const inst of instances) {
          const rosterData = await trpcQuery('shifts.getRoster', { shift_instance_id: inst.id });
          if (!rosterData) continue;

          for (const entry of rosterData) {
            if (!roster[entry.user_id]) roster[entry.user_id] = {};
            if (!roster[entry.user_id][inst.shift_date]) roster[entry.user_id][inst.shift_date] = [];
            roster[entry.user_id][inst.shift_date].push({
              shift_name: inst.shift_name,
              start_time: inst.start_time,
              end_time: inst.end_time,
              color: inst.color || SHIFT_COLORS[inst.shift_name] || '#888',
              ward_name: ward.name,
              role: entry.role_during_shift,
              roster_id: entry.id,
            });
          }
        }
      } catch { /* skip ward on error */ }
    }
    setWeekRoster(roster);
  }, [weekDate, wards]);

  useEffect(() => {
    if (viewMode === 'week_person' && wards.length > 0) loadWeekRoster();
  }, [viewMode, loadWeekRoster, wards]);

  // Load day roster
  const loadDayRoster = useCallback(async () => {
    const dayData: typeof dayRoster = {};
    for (const ward of wards) {
      try {
        const instances = await trpcQuery('shifts.listInstances', {
          ward_id: ward.id,
          start_date: selectedDate,
          end_date: selectedDate,
        });
        if (!instances || instances.length === 0) continue;

        const wardEntries: typeof dayData[string] = [];
        for (const inst of instances) {
          const rosterData = await trpcQuery('shifts.getRoster', { shift_instance_id: inst.id });
          wardEntries.push({ instance: inst, entries: rosterData || [] });
        }
        dayData[ward.id] = wardEntries;
      } catch { /* skip */ }
    }
    setDayRoster(dayData);
  }, [selectedDate, wards]);

  useEffect(() => {
    if (viewMode === 'day_ward' && wards.length > 0) loadDayRoster();
  }, [viewMode, loadDayRoster, wards]);

  // Get unique departments
  const departments = [...new Set(staff.map(s => s.department).filter(Boolean))].sort();

  // Filter staff
  const filteredStaff = staff.filter(s => {
    if (deptFilter && s.department !== deptFilter) return false;
    if (roleFilter && !s.roles?.includes(roleFilter)) return false;
    return true;
  });

  const weekDates = getWeekDates(weekDate);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Loading duty roster…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
              <h1 className="text-2xl font-bold">Duty Roster Manager</h1>
            </div>
            <p className="text-blue-200 text-sm mt-1">View and manage staff schedules across all departments</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="bg-blue-800 rounded-lg p-1 flex">
              <button
                onClick={() => setViewMode('week_person')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'week_person' ? 'bg-white text-blue-900' : 'text-blue-200 hover:text-white'
                }`}
              >
                Week by Person
              </button>
              <button
                onClick={() => setViewMode('day_ward')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'day_ward' ? 'bg-white text-blue-900' : 'text-blue-200 hover:text-white'
                }`}
              >
                Day by Ward
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="mx-6 mt-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>}

      <div className="p-6">
        {/* ── WEEK BY PERSON VIEW ─────────────────────────────────── */}
        {viewMode === 'week_person' && (
          <div>
            {/* Controls */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Week of</label>
                <input type="date" value={weekDate} onChange={e => setWeekDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Department</label>
                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm">
                  <option value="">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="text-sm text-gray-500 ml-auto">
                {filteredStaff.length} staff · {Object.keys(weekRoster).length} with shifts this week
              </div>
            </div>

            {/* Week grid */}
            <div className="bg-white rounded-xl border shadow-sm overflow-auto">
              <table className="w-full border-collapse" style={{ minWidth: '900px' }}>
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 border-b w-48 sticky left-0 bg-gray-50">
                      Staff Member
                    </th>
                    {weekDates.map(d => (
                      <th key={d} className={`text-center px-2 py-3 text-xs font-semibold border-b ${
                        d === getToday() ? 'text-blue-700 bg-blue-50' : 'text-gray-600'
                      }`}>
                        {formatDateShort(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.map(person => {
                    const personShifts = weekRoster[person.id] || {};
                    const hasAnyShift = Object.keys(personShifts).length > 0;
                    return (
                      <tr key={person.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 sticky left-0 bg-white">
                          <div className="text-sm font-medium text-gray-800">{person.full_name}</div>
                          <div className="text-xs text-gray-400">{person.department} · {(person.roles || ['staff'])[0]?.replace(/_/g, ' ')}</div>
                        </td>
                        {weekDates.map(d => {
                          const shifts = personShifts[d] || [];
                          return (
                            <td key={d} className={`px-1 py-1 text-center align-top ${d === getToday() ? 'bg-blue-50/50' : ''}`}>
                              {shifts.length > 0 ? shifts.map((s, i) => (
                                <div key={i} className="mb-1 px-2 py-1 rounded text-xs font-medium"
                                  style={{ background: s.color + '20', color: s.color, borderLeft: `3px solid ${s.color}` }}
                                  title={`${s.ward_name} · ${formatTime(s.start_time)}–${formatTime(s.end_time)} · ${s.role}`}
                                >
                                  {s.shift_name === 'morning' ? 'AM' : s.shift_name === 'evening' ? 'PM' : s.shift_name === 'night' ? 'N' : s.shift_name.charAt(0).toUpperCase()}
                                  <div className="text-[10px] opacity-70">{s.ward_name.split(' ')[0]}</div>
                                </div>
                              )) : (
                                <div className="text-gray-200 text-xs">—</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {filteredStaff.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-gray-400">No staff found matching filters</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DAY BY WARD VIEW ────────────────────────────────────── */}
        {viewMode === 'day_ward' && (
          <div>
            {/* Controls */}
            <div className="flex items-center gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date</label>
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={() => setSelectedDate(getToday())}
                className="mt-5 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100">
                Today
              </button>
            </div>

            {/* Ward cards */}
            <div className="space-y-6">
              {wards.map(ward => {
                const wardShifts = dayRoster[ward.id] || [];
                return (
                  <div key={ward.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b">
                      <h3 className="font-semibold text-gray-800">{ward.name}</h3>
                    </div>
                    <div className="p-4">
                      {wardShifts.length === 0 ? (
                        <div className="text-center py-6 text-gray-400 text-sm">
                          No shifts scheduled for this ward on {formatDateShort(selectedDate)}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {wardShifts.map(({ instance, entries }) => (
                            <div key={instance.id} className="border rounded-lg overflow-hidden">
                              <div className="px-3 py-2 text-sm font-medium text-white"
                                style={{ background: instance.color || SHIFT_COLORS[instance.shift_name] || '#888' }}>
                                {instance.template_name || instance.shift_name}
                                <span className="opacity-75 ml-2 text-xs">
                                  {formatTime(instance.start_time)}–{formatTime(instance.end_time)}
                                </span>
                              </div>
                              <div className="p-3">
                                {entries.length === 0 ? (
                                  <div className="text-xs text-gray-400 py-2">No staff assigned</div>
                                ) : (
                                  <div className="space-y-2">
                                    {entries.map(e => (
                                      <div key={e.id} className="flex items-center justify-between">
                                        <div>
                                          <div className="text-sm font-medium text-gray-800">{e.user_name}</div>
                                          <div className="text-xs text-gray-400">{e.role_during_shift.replace(/_/g, ' ')}</div>
                                        </div>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                          e.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                          e.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                                          'bg-gray-100 text-gray-600'
                                        }`}>
                                          {e.status}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button
                                  onClick={() => {
                                    setAssignTarget({
                                      instanceId: instance.id,
                                      wardName: ward.name,
                                      shiftName: instance.template_name || instance.shift_name,
                                      date: selectedDate,
                                    });
                                    setShowAssign(true);
                                    setAssignUserId('');
                                    setAssignRole('nurse');
                                  }}
                                  className="mt-3 w-full text-xs text-blue-600 hover:text-blue-800 py-1 border border-blue-200 rounded hover:bg-blue-50 transition-colors"
                                >
                                  + Assign Staff
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {wards.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  No wards found. Ensure locations are configured.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── ASSIGN MODAL ─────────────────────────────────────────── */}
      {showAssign && assignTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAssign(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Assign Staff</h3>
            <p className="text-sm text-gray-500 mb-4">
              {assignTarget.wardName} · {assignTarget.shiftName} · {formatDateShort(assignTarget.date)}
            </p>

            <label className="text-xs text-gray-600 font-medium block mb-1">Staff Member</label>
            <select value={assignUserId} onChange={e => setAssignUserId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3">
              <option value="">— Select staff —</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.full_name} ({s.department})</option>
              ))}
            </select>

            <label className="text-xs text-gray-600 font-medium block mb-1">Role During Shift</label>
            <select value={assignRole} onChange={e => setAssignRole(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mb-4">
              <option value="nurse">Nurse</option>
              <option value="charge_nurse">Charge Nurse</option>
              <option value="rmo">RMO</option>
              <option value="attending">Attending</option>
              <option value="registrar">Registrar</option>
              <option value="attending_oncall">Attending (On-Call)</option>
              <option value="technician">Technician</option>
            </select>

            <div className="flex gap-3">
              <button
                disabled={!assignUserId}
                onClick={async () => {
                  try {
                    await trpcMutate('shifts.assignStaff', {
                      shift_instance_id: assignTarget.instanceId,
                      user_id: assignUserId,
                      role_during_shift: assignRole,
                    });
                    setSuccess('Staff assigned');
                    setShowAssign(false);
                    if (viewMode === 'day_ward') loadDayRoster();
                    else loadWeekRoster();
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium text-white ${
                  assignUserId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'
                }`}
              >
                Assign
              </button>
              <button onClick={() => setShowAssign(false)}
                className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
