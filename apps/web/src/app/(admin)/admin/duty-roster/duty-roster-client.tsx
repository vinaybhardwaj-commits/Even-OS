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
interface StaffMember { id: string; full_name: string; email: string; department: string; roles: string[] }
interface Ward { id: string; name: string }
interface ShiftInstance { id: string; template_id: string; ward_id: string; shift_date: string; status: string; template_name: string; shift_name: string; start_time: string; end_time: string; color: string | null }
interface RosterEntry { id: string; user_id: string; role_during_shift: string; status: string; user_name: string; user_email: string; user_department: string }
interface ShiftTemplate { id: string; name: string; shift_name: string; start_time: string; end_time: string; color: string | null }

type ViewMode = 'week_person' | 'day_ward' | 'person_schedule';

// Roles that have NO duty timings — filter from roster views
const NO_DUTY_ROLES = ['super_admin', 'hospital_admin', 'medical_director', 'gm', 'ceo', 'system_super_admin'];

// ── Helpers ──────────────────────────────────────────────────
function getWeekDates(baseDate: string): string[] {
  const d = new Date(baseDate); const day = d.getDay();
  const monday = new Date(d); monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => { const dd = new Date(monday); dd.setDate(monday.getDate() + i); return dd.toISOString().split('T')[0]; });
}
function getMonthDates(year: number, month: number): string[] {
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}
function formatDateShort(d: string) { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
function formatTime(t: string) { const [h, m] = t.split(':'); const hr = parseInt(h); return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`; }
function getToday() { return new Date().toISOString().split('T')[0]; }
const SC: Record<string, string> = { morning: '#F59E0B', evening: '#3B82F6', night: '#6366F1', general: '#10B981', custom: '#EC4899' };

export default function DutyRosterClient({ userId, userName, userRole }: { userId: string; userName: string; userRole: string }) {
  const [view, setView] = useState<ViewMode>('week_person');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [weekDate, setWeekDate] = useState(getToday());
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [deptFilter, setDeptFilter] = useState('');
  // Week roster: user_id → date → shifts[]
  const [weekRoster, setWeekRoster] = useState<Record<string, Record<string, { shift_name: string; color: string; ward_name: string; instance_id: string; roster_id: string }[]>>>({});
  // Day roster: ward_id → { instance, entries[] }[]
  const [dayRoster, setDayRoster] = useState<Record<string, { instance: ShiftInstance; entries: RosterEntry[] }[]>>({});
  // Person schedule
  const [selectedPerson, setSelectedPerson] = useState('');
  const [personMonth, setPersonMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [personShifts, setPersonShifts] = useState<Record<string, { shift_name: string; color: string; ward_name: string }[]>>({});
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignCtx, setAssignCtx] = useState<{ personId?: string; personName?: string; date?: string; instanceId?: string; wardName?: string; shiftName?: string; dates?: string[] } | null>(null);
  const [assignWard, setAssignWard] = useState('');
  const [assignTemplate, setAssignTemplate] = useState('');
  const [assignRole, setAssignRole] = useState('nurse');
  const [assignUserId, setAssignUserId] = useState('');

  useEffect(() => { if (error || success) { const t = setTimeout(() => { setError(''); setSuccess(''); }, 4000); return () => clearTimeout(t); } }, [error, success]);

  // Filter staff — exclude admin/executive roles
  const dutyStaff = staff.filter(s => !s.roles?.some(r => NO_DUTY_ROLES.includes(r)));
  const filteredStaff = dutyStaff.filter(s => !deptFilter || s.department === deptFilter);
  const departments = [...new Set(dutyStaff.map(s => s.department).filter(Boolean))].sort();

  // Load base data
  const loadBase = useCallback(async () => {
    setLoading(true);
    const [s, w, t] = await Promise.all([
      trpcQuery('auth.listStaff', { limit: 500 }).catch(() => []),
      trpcQuery('shifts.getWards').catch(() => []),
      trpcQuery('shifts.getTemplates', { active_only: true }).catch(() => []),
    ]);
    setStaff(s || []); setWards(w || []); setTemplates(t || []);
    setLoading(false);
  }, []);
  useEffect(() => { loadBase(); }, [loadBase]);

  // Load week roster
  const loadWeek = useCallback(async () => {
    if (wards.length === 0) return;
    const dates = getWeekDates(weekDate);
    const roster: typeof weekRoster = {};
    for (const ward of wards) {
      const instances = await trpcQuery('shifts.listInstances', { ward_id: ward.id, start_date: dates[0], end_date: dates[6] }).catch(() => null);
      if (!instances) continue;
      for (const inst of instances) {
        const entries = await trpcQuery('shifts.getRoster', { shift_instance_id: inst.id }).catch(() => null);
        if (!entries) continue;
        for (const e of entries) {
          if (!roster[e.user_id]) roster[e.user_id] = {};
          if (!roster[e.user_id][inst.shift_date]) roster[e.user_id][inst.shift_date] = [];
          roster[e.user_id][inst.shift_date].push({ shift_name: inst.shift_name, color: inst.color || SC[inst.shift_name] || '#888', ward_name: ward.name, instance_id: inst.id, roster_id: e.id });
        }
      }
    }
    setWeekRoster(roster);
  }, [weekDate, wards]);
  useEffect(() => { if (view === 'week_person' && wards.length > 0) loadWeek(); }, [view, loadWeek, wards]);

  // Load day roster
  const loadDay = useCallback(async () => {
    if (wards.length === 0) return;
    const d: typeof dayRoster = {};
    for (const ward of wards) {
      const instances = await trpcQuery('shifts.listInstances', { ward_id: ward.id, start_date: selectedDate, end_date: selectedDate }).catch(() => null);
      if (!instances || !instances.length) continue;
      const we: typeof d[string] = [];
      for (const inst of instances) {
        const entries = await trpcQuery('shifts.getRoster', { shift_instance_id: inst.id }).catch(() => null);
        we.push({ instance: inst, entries: entries || [] });
      }
      d[ward.id] = we;
    }
    setDayRoster(d);
  }, [selectedDate, wards]);
  useEffect(() => { if (view === 'day_ward' && wards.length > 0) loadDay(); }, [view, loadDay, wards]);

  // Load person schedule
  const loadPersonSchedule = useCallback(async () => {
    if (!selectedPerson || wards.length === 0) return;
    const dates = getMonthDates(personMonth.year, personMonth.month);
    const shifts: typeof personShifts = {};
    for (const ward of wards) {
      const instances = await trpcQuery('shifts.listInstances', { ward_id: ward.id, start_date: dates[0], end_date: dates[dates.length - 1] }).catch(() => null);
      if (!instances) continue;
      for (const inst of instances) {
        const entries = await trpcQuery('shifts.getRoster', { shift_instance_id: inst.id }).catch(() => null);
        if (!entries) continue;
        for (const e of entries) {
          if (e.user_id === selectedPerson) {
            if (!shifts[inst.shift_date]) shifts[inst.shift_date] = [];
            shifts[inst.shift_date].push({ shift_name: inst.shift_name, color: inst.color || SC[inst.shift_name] || '#888', ward_name: ward.name });
          }
        }
      }
    }
    setPersonShifts(shifts);
  }, [selectedPerson, personMonth, wards]);
  useEffect(() => { if (view === 'person_schedule' && selectedPerson) loadPersonSchedule(); }, [view, loadPersonSchedule, selectedPerson]);

  // Assign handler
  async function handleAssign() {
    try {
      if (assignCtx?.instanceId) {
        // Direct instance assignment (Day by Ward)
        await trpcMutate('shifts.assignStaff', { shift_instance_id: assignCtx.instanceId, user_id: assignUserId || assignCtx.personId, role_during_shift: assignRole });
        setSuccess('Staff assigned');
      } else if (assignCtx?.dates && assignCtx.dates.length > 0 && assignWard && assignTemplate) {
        // Batch: generate instances then assign
        for (const date of assignCtx.dates) {
          const genResult = await trpcMutate('shifts.generateInstances', { start_date: date, end_date: date, ward_ids: [assignWard], template_ids: [assignTemplate] });
          // Find the instance that was created
          const instances = await trpcQuery('shifts.listInstances', { ward_id: assignWard, start_date: date, end_date: date });
          const inst = instances?.find((i: any) => i.template_id === assignTemplate);
          if (inst) {
            await trpcMutate('shifts.assignStaff', { shift_instance_id: inst.id, user_id: assignCtx.personId || assignUserId, role_during_shift: assignRole });
          }
        }
        setSuccess(`Assigned ${assignCtx.dates.length} shift(s)`);
      } else if (assignCtx?.personId && assignCtx?.date && assignWard && assignTemplate) {
        // Single day for a person (Week view click)
        const genResult = await trpcMutate('shifts.generateInstances', { start_date: assignCtx.date, end_date: assignCtx.date, ward_ids: [assignWard], template_ids: [assignTemplate] });
        const instances = await trpcQuery('shifts.listInstances', { ward_id: assignWard, start_date: assignCtx.date, end_date: assignCtx.date });
        const inst = instances?.find((i: any) => i.template_id === assignTemplate);
        if (inst) {
          await trpcMutate('shifts.assignStaff', { shift_instance_id: inst.id, user_id: assignCtx.personId, role_during_shift: assignRole });
        }
        setSuccess('Shift assigned');
      }
      setShowAssign(false);
      setSelectedDays(new Set());
      // Reload
      if (view === 'week_person') loadWeek();
      else if (view === 'day_ward') loadDay();
      else if (view === 'person_schedule') loadPersonSchedule();
    } catch (e: any) { setError(e.message); }
  }

  const weekDates = getWeekDates(weekDate);
  const monthDates = getMonthDates(personMonth.year, personMonth.month);
  const firstDayOfWeek = new Date(monthDates[0] + 'T00:00:00').getDay();
  const padDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Monday start

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400">Loading duty roster…</div></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3">
              <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
              <h1 className="text-2xl font-bold">Duty Roster Manager</h1>
            </div>
            <p className="text-blue-200 text-sm mt-1">Manage staff schedules — assign, view, and modify shifts</p>
          </div>
          <div className="bg-blue-800 rounded-lg p-1 flex">
            {(['week_person', 'day_ward', 'person_schedule'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-white text-blue-900' : 'text-blue-200 hover:text-white'}`}>
                {v === 'week_person' ? 'Week by Person' : v === 'day_ward' ? 'Day by Ward' : 'Person Schedule'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="mx-6 mt-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>}

      <div className="p-6">
        {/* ── WEEK BY PERSON ───────────────────────────────────── */}
        {view === 'week_person' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">Click any empty cell to assign a shift for that person on that day.</p>
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div><label className="text-xs text-gray-500 block mb-1">Week of</label>
                <input type="date" value={weekDate} onChange={e => setWeekDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Department</label>
                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                  <option value="">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select></div>
              <div className="text-sm text-gray-500 ml-auto">{filteredStaff.length} staff · {Object.keys(weekRoster).length} with shifts</div>
            </div>
            <div className="bg-white rounded-xl border shadow-sm overflow-auto">
              <table className="w-full border-collapse" style={{ minWidth: '900px' }}>
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 border-b w-48 sticky left-0 bg-gray-50 z-10">Staff Member</th>
                    {weekDates.map(d => (
                      <th key={d} className={`text-center px-2 py-3 text-xs font-semibold border-b ${d === getToday() ? 'text-blue-700 bg-blue-50' : 'text-gray-600'}`}>
                        {formatDateShort(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.map(person => {
                    const ps = weekRoster[person.id] || {};
                    return (
                      <tr key={person.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 sticky left-0 bg-white z-10">
                          <div className="text-sm font-medium text-gray-800">{person.full_name}</div>
                          <div className="text-xs text-gray-400">{person.department} · {(person.roles || ['staff'])[0]?.replace(/_/g, ' ')}</div>
                        </td>
                        {weekDates.map(d => {
                          const shifts = ps[d] || [];
                          return (
                            <td key={d} className={`px-1 py-1 text-center align-top cursor-pointer hover:bg-blue-50/50 ${d === getToday() ? 'bg-blue-50/30' : ''}`}
                              onClick={() => {
                                if (shifts.length === 0) {
                                  setAssignCtx({ personId: person.id, personName: person.full_name, date: d });
                                  setAssignUserId(person.id);
                                  setAssignWard(wards[0]?.id || '');
                                  setAssignTemplate(templates[0]?.id || '');
                                  setAssignRole((person.roles || ['nurse'])[0] || 'nurse');
                                  setShowAssign(true);
                                }
                              }}>
                              {shifts.length > 0 ? shifts.map((s, i) => (
                                <div key={i} className="mb-1 px-2 py-1 rounded text-xs font-medium"
                                  style={{ background: s.color + '20', color: s.color, borderLeft: `3px solid ${s.color}` }}
                                  title={`${s.ward_name} · ${s.shift_name}`}>
                                  {s.shift_name === 'morning' ? 'AM' : s.shift_name === 'evening' ? 'PM' : s.shift_name === 'night' ? 'N' : s.shift_name.charAt(0).toUpperCase()}
                                  <div className="text-[10px] opacity-70">{s.ward_name.split(' ')[0]}</div>
                                </div>
                              )) : (
                                <div className="text-gray-200 text-xs py-2 hover:text-blue-400">+</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DAY BY WARD ─────────────────────────────────────── */}
        {view === 'day_ward' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">View all wards for a specific day. Use &quot;+ Assign Staff&quot; to add people to shifts.</p>
            <div className="flex items-center gap-4 mb-4">
              <div><label className="text-xs text-gray-500 block mb-1">Date</label>
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" /></div>
              <button onClick={() => setSelectedDate(getToday())} className="mt-5 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100">Today</button>
            </div>
            <div className="space-y-6">
              {wards.map(ward => {
                const ws = dayRoster[ward.id] || [];
                return (
                  <div key={ward.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b"><h3 className="font-semibold text-gray-800">{ward.name}</h3></div>
                    <div className="p-4">
                      {ws.length === 0 ? (
                        <div className="text-center py-6 text-gray-400 text-sm">No shifts scheduled for {formatDateShort(selectedDate)}</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {ws.map(({ instance, entries }) => (
                            <div key={instance.id} className="border rounded-lg overflow-hidden">
                              <div className="px-3 py-2 text-sm font-medium text-white" style={{ background: instance.color || SC[instance.shift_name] || '#888' }}>
                                {instance.template_name || instance.shift_name}
                                <span className="opacity-75 ml-2 text-xs">{formatTime(instance.start_time)}–{formatTime(instance.end_time)}</span>
                              </div>
                              <div className="p-3">
                                {entries.length === 0 ? <div className="text-xs text-gray-400 py-2">No staff assigned</div> : (
                                  <div className="space-y-2">{entries.map(e => (
                                    <div key={e.id} className="flex items-center justify-between">
                                      <div><div className="text-sm font-medium text-gray-800">{e.user_name}</div>
                                        <div className="text-xs text-gray-400">{e.role_during_shift.replace(/_/g, ' ')}</div></div>
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${e.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{e.status}</span>
                                    </div>
                                  ))}</div>
                                )}
                                <button onClick={() => { setAssignCtx({ instanceId: instance.id, wardName: ward.name, shiftName: instance.template_name, date: selectedDate }); setAssignUserId(''); setAssignRole('nurse'); setShowAssign(true); }}
                                  className="mt-3 w-full text-xs text-blue-600 hover:text-blue-800 py-1 border border-blue-200 rounded hover:bg-blue-50">+ Assign Staff</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PERSON SCHEDULE ─────────────────────────────────── */}
        {view === 'person_schedule' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">Select a staff member, then click days on the calendar to assign shifts. Select multiple days and assign in bulk.</p>
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div className="min-w-[250px]"><label className="text-xs text-gray-500 block mb-1">Staff Member</label>
                <select value={selectedPerson} onChange={e => { setSelectedPerson(e.target.value); setSelectedDays(new Set()); }}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">— Select a person —</option>
                  {dutyStaff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.department})</option>)}
                </select></div>
              <div className="flex items-center gap-2 mt-5">
                <button onClick={() => setPersonMonth(p => ({ year: p.month === 0 ? p.year - 1 : p.year, month: p.month === 0 ? 11 : p.month - 1 }))} className="px-2 py-1 border rounded hover:bg-gray-100">◀</button>
                <span className="text-sm font-medium w-32 text-center">{new Date(personMonth.year, personMonth.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
                <button onClick={() => setPersonMonth(p => ({ year: p.month === 11 ? p.year + 1 : p.year, month: p.month === 11 ? 0 : p.month + 1 }))} className="px-2 py-1 border rounded hover:bg-gray-100">▶</button>
              </div>
              {selectedDays.size > 0 && (
                <button onClick={() => {
                  const person = dutyStaff.find(s => s.id === selectedPerson);
                  setAssignCtx({ personId: selectedPerson, personName: person?.full_name, dates: [...selectedDays] });
                  setAssignUserId(selectedPerson);
                  setAssignWard(wards[0]?.id || '');
                  setAssignTemplate(templates[0]?.id || '');
                  setAssignRole((person?.roles || ['nurse'])[0] || 'nurse');
                  setShowAssign(true);
                }} className="mt-5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium">
                  Assign {selectedDays.size} day{selectedDays.size > 1 ? 's' : ''}
                </button>
              )}
              {selectedDays.size > 0 && (
                <button onClick={() => setSelectedDays(new Set())} className="mt-5 px-3 py-2 text-gray-500 text-sm hover:text-gray-700">Clear</button>
              )}
            </div>

            {!selectedPerson ? (
              <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">👤</div>Select a staff member above to view and manage their schedule</div>
            ) : (
              <div className="bg-white rounded-xl border shadow-sm p-4">
                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d} className="text-center text-xs font-semibold text-gray-500 py-2">{d}</div>
                  ))}
                  {/* Pad days */}
                  {Array.from({ length: padDays }).map((_, i) => <div key={`pad-${i}`} />)}
                  {/* Month days */}
                  {monthDates.map(d => {
                    const shifts = personShifts[d] || [];
                    const isToday = d === getToday();
                    const isSelected = selectedDays.has(d);
                    const isPast = d < getToday();
                    return (
                      <div key={d}
                        onClick={() => {
                          if (isPast) return;
                          const next = new Set(selectedDays);
                          if (next.has(d)) next.delete(d); else next.add(d);
                          setSelectedDays(next);
                        }}
                        className={`min-h-[70px] rounded-lg border p-1.5 cursor-pointer transition-colors ${
                          isSelected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' :
                          isToday ? 'border-blue-300 bg-blue-50/50' :
                          isPast ? 'bg-gray-50 opacity-60 cursor-default' :
                          'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30'
                        }`}>
                        <div className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-700' : 'text-gray-600'}`}>
                          {parseInt(d.split('-')[2])}
                        </div>
                        {shifts.map((s, i) => (
                          <div key={i} className="text-[10px] px-1 py-0.5 rounded mb-0.5 font-medium"
                            style={{ background: s.color + '20', color: s.color }}>
                            {s.shift_name === 'morning' ? 'AM' : s.shift_name === 'evening' ? 'PM' : s.shift_name === 'night' ? 'Night' : s.shift_name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── ASSIGN MODAL ──────────────────────────────────────── */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAssign(false)}>
          <div className="bg-white rounded-xl p-6 w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Assign Shift</h3>
            <p className="text-sm text-gray-500 mb-4">
              {assignCtx?.personName && <span className="font-medium text-gray-700">{assignCtx.personName}</span>}
              {assignCtx?.date && <span> · {formatDateShort(assignCtx.date)}</span>}
              {assignCtx?.dates && <span> · {assignCtx.dates.length} days selected</span>}
              {assignCtx?.wardName && <span> · {assignCtx.wardName}</span>}
              {assignCtx?.shiftName && <span> · {assignCtx.shiftName}</span>}
            </p>

            {/* If Day by Ward — just need user + role */}
            {assignCtx?.instanceId ? (
              <>
                <label className="text-xs text-gray-600 font-medium block mb-1">Staff Member</label>
                <select value={assignUserId} onChange={e => setAssignUserId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-3">
                  <option value="">— Select —</option>
                  {dutyStaff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.department})</option>)}
                </select>
              </>
            ) : (
              <>
                <label className="text-xs text-gray-600 font-medium block mb-1">Ward</label>
                <select value={assignWard} onChange={e => setAssignWard(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-3">
                  {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <label className="text-xs text-gray-600 font-medium block mb-1">Shift Template</label>
                <select value={assignTemplate} onChange={e => setAssignTemplate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-3">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({formatTime(t.start_time)}–{formatTime(t.end_time)})</option>)}
                </select>
              </>
            )}
            <label className="text-xs text-gray-600 font-medium block mb-1">Role During Shift</label>
            <select value={assignRole} onChange={e => setAssignRole(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mb-4">
              {['nurse', 'charge_nurse', 'rmo', 'attending', 'registrar', 'attending_oncall', 'technician'].map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>

            <div className="flex gap-3">
              <button onClick={handleAssign}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">Assign</button>
              <button onClick={() => { setShowAssign(false); setSelectedDays(new Set()); }}
                className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
