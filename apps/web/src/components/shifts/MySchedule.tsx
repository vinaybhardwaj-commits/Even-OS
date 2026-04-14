'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helper ───────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Query failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Mutation failed');
  return json.result?.data?.json;
}

// ── Types ─────────────────────────────────────────────────────────────────
interface ScheduleEntry {
  roster_id: string;
  roster_status: string;
  role_during_shift: string;
  instance_id: string;
  instance_status: string;
  ward_id: string;
  shift_date: string;
  template_name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
  charge_nurse_id: string | null;
  notes: string | null;
}

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function getWeekRange(offset: number) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() + (offset * 7)); // Sunday
  const end = new Date(start);
  end.setDate(end.getDate() + 6); // Saturday
  return {
    start_date: start.toISOString().split('T')[0],
    end_date: end.toISOString().split('T')[0],
    label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEAVE_TYPES = ['sick', 'casual', 'privilege', 'emergency', 'compensatory', 'maternity', 'other'] as const;

/**
 * MySchedule — weekly schedule view for caregivers.
 * Shows rostered shifts, leave status, and allows leave requests.
 */
export default function MySchedule() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'casual' as string, start_date: '', end_date: '', reason: '',
  });

  const week = getWeekRange(weekOffset);

  const loadSchedule = useCallback(async () => {
    try {
      setLoading(true);
      const data = await trpcQuery('shifts.getMyShifts', {
        start_date: week.start_date,
        end_date: week.end_date,
      });
      setEntries(data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [week.start_date, week.end_date]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  async function submitLeave() {
    try {
      await trpcMutate('shifts.submitLeave', leaveForm);
      setSuccess('Leave request submitted');
      setShowLeaveModal(false);
      setLeaveForm({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(''); setSuccess(''); }, 4000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  // Group by date
  const today = new Date().toISOString().split('T')[0];
  const startDate = new Date(week.start_date);
  const days: Array<{ date: string; dayName: string; shifts: ScheduleEntry[] }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    days.push({
      date: dateStr,
      dayName: DAYS[d.getDay()],
      shifts: entries.filter(e => e.shift_date === dateStr),
    });
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setWeekOffset(p => p - 1)}
          className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">← Prev</button>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-800">My Schedule</h2>
          <p className="text-sm text-gray-500">{week.label}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setWeekOffset(0)}
            className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200">This Week</button>
          <button onClick={() => setWeekOffset(p => p + 1)}
            className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">Next →</button>
        </div>
      </div>

      {/* Messages */}
      {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>}

      {/* Request Leave button */}
      <div className="mb-4 flex justify-end">
        <button onClick={() => setShowLeaveModal(true)}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">
          Request Leave
        </button>
      </div>

      {/* Week grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading schedule...</div>
      ) : (
        <div className="space-y-2">
          {days.map(day => {
            const isToday = day.date === today;
            return (
              <div key={day.date}
                className={`bg-white rounded-xl border p-4 ${isToday ? 'ring-2 ring-blue-400 border-blue-200' : ''}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xs font-bold uppercase tracking-wider ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>
                    {day.dayName}
                  </span>
                  <span className={`text-sm ${isToday ? 'text-blue-800 font-semibold' : 'text-gray-600'}`}>
                    {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  {isToday && <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">TODAY</span>}
                </div>

                {day.shifts.length === 0 ? (
                  <div className="text-sm text-gray-300 pl-2">No shift scheduled</div>
                ) : (
                  <div className="space-y-1.5">
                    {day.shifts.map(shift => (
                      <div key={shift.roster_id} className="flex items-center gap-3 pl-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: shift.color || '#3B82F6' }} />
                        <span className="font-medium text-sm text-gray-800">{shift.template_name}</span>
                        <span className="text-xs text-gray-500">
                          {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded capitalize">
                          {shift.role_during_shift}
                        </span>
                        {shift.roster_status === 'swapped' && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded">Swapped</span>
                        )}
                        {shift.notes && (
                          <span className="text-xs text-gray-400 italic truncate max-w-[150px]">{shift.notes}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Leave Request Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Request Leave</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Leave Type</label>
                <select value={leaveForm.leave_type}
                  onChange={e => setLeaveForm(p => ({ ...p, leave_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={leaveForm.start_date}
                    onChange={e => setLeaveForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={leaveForm.end_date}
                    onChange={e => setLeaveForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reason (optional)</label>
                <textarea value={leaveForm.reason}
                  onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm h-20" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowLeaveModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={submitLeave}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600"
                disabled={!leaveForm.start_date || !leaveForm.end_date}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
