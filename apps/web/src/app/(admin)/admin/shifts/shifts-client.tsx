'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ──────────────────────────────────────────────────────────
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

// ── Types ──────────────────────────────────────────────────────────────────
interface ShiftTemplate {
  id: string;
  name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  ward_type: string;
  is_default: boolean;
  is_active: boolean;
  color: string | null;
}

interface ShiftInstance {
  id: string;
  template_id: string;
  ward_id: string;
  shift_date: string;
  status: string;
  charge_nurse_id: string | null;
  template_name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
  notes: string | null;
}

interface RosterEntry {
  id: string;
  user_id: string;
  role_during_shift: string;
  status: string;
  assigned_at: string;
  user_name: string;
  user_email: string;
  user_department: string;
  notes: string | null;
}

interface Ward {
  id: string;
  name: string;
  capacity: number | null;
}

interface StaffingTarget {
  id: string;
  ward_type: string;
  role: string;
  min_ratio: number;
  optimal_ratio: number;
  amber_threshold_pct: number;
  notes: string | null;
  is_active: boolean;
}

interface Stats {
  active_templates: number;
  today_instances: number;
  today_rostered: number;
  pending_leave_requests: number;
  pending_swap_requests: number;
  flagged_overtime: number;
}

// ── Tab type ──────────────────────────────────────────────────────────────
type TabKey = 'templates' | 'daily' | 'monthly' | 'staffing';

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

const WARD_TYPES = ['icu', 'general', 'step_down', 'ot', 'er', 'all'] as const;
const SHIFT_NAMES = ['morning', 'evening', 'night', 'general', 'custom'] as const;
const ROSTER_ROLES = ['nurse', 'charge_nurse', 'rmo', 'consultant', 'intern', 'technician'] as const;

// ── Component ─────────────────────────────────────────────────────────────
export default function ShiftsClient() {
  const [tab, setTab] = useState<TabKey>('templates');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Data
  const [stats, setStats] = useState<Stats | null>(null);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [instances, setInstances] = useState<ShiftInstance[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [staffingTargets, setStaffingTargets] = useState<StaffingTarget[]>([]);

  // UI state
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [selectedWard, setSelectedWard] = useState('');
  const [selectedInstance, setSelectedInstance] = useState<ShiftInstance | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showStaffingModal, setShowStaffingModal] = useState(false);
  const [monthYear, setMonthYear] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Template form
  const [templateForm, setTemplateForm] = useState({
    name: '', shift_name: 'custom' as string, start_time: '08:00', end_time: '16:00',
    duration_hours: 8, ward_type: 'all' as string, color: '#3B82F6',
  });

  // Generate form
  const [generateForm, setGenerateForm] = useState({
    start_date: getToday(), end_date: '', ward_ids: [] as string[],
  });

  // Assign form
  const [assignForm, setAssignForm] = useState({
    user_id: '', role_during_shift: 'nurse', notes: '',
  });
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: string; full_name: string; email: string }>>([]);

  // Staffing form
  const [staffingForm, setStaffingForm] = useState({
    ward_type: 'general' as string, role: 'nurse', min_ratio: 0.5, optimal_ratio: 0.33,
    amber_threshold_pct: 20, notes: '',
  });

  // ── Load data ───────────────────────────────────────────────────────────
  const loadCore = useCallback(async () => {
    try {
      setLoading(true);
      const [tmpl, wds, st, tgts] = await Promise.all([
        trpcQuery('shifts.getTemplates', { active_only: false }),
        trpcQuery('shifts.getWards'),
        trpcQuery('shifts.stats'),
        trpcQuery('shifts.getStaffingTargets'),
      ]);
      setTemplates(tmpl || []);
      setWards(wds || []);
      setStats(st);
      setStaffingTargets(tgts || []);
      if (wds?.length > 0 && !selectedWard) {
        setSelectedWard(wds[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedWard]);

  useEffect(() => { loadCore(); }, [loadCore]);

  // Load instances when date/ward changes
  const loadInstances = useCallback(async () => {
    if (!selectedWard || !selectedDate) return;
    try {
      const data = await trpcQuery('shifts.listInstances', {
        ward_id: selectedWard,
        start_date: selectedDate,
        end_date: selectedDate,
      });
      setInstances(data || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [selectedDate, selectedWard]);

  useEffect(() => {
    if (tab === 'daily') loadInstances();
  }, [tab, loadInstances]);

  // Load roster when instance selected
  const loadRoster = useCallback(async (instanceId: string) => {
    try {
      const data = await trpcQuery('shifts.getRoster', { shift_instance_id: instanceId });
      setRoster(data || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────

  async function seedDefaults() {
    try {
      const result = await trpcMutate('shifts.seedDefaults');
      if (result.seeded) {
        setSuccess(`Seeded ${result.count} default shift templates`);
        await loadCore();
      } else {
        setError(result.message);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function createTemplate() {
    try {
      await trpcMutate('shifts.createTemplate', templateForm);
      setSuccess('Template created');
      setShowTemplateModal(false);
      setTemplateForm({ name: '', shift_name: 'custom', start_time: '08:00', end_time: '16:00', duration_hours: 8, ward_type: 'all', color: '#3B82F6' });
      await loadCore();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleTemplate(template: ShiftTemplate) {
    try {
      await trpcMutate('shifts.updateTemplate', { id: template.id, is_active: !template.is_active });
      setSuccess(`Template ${template.is_active ? 'deactivated' : 'activated'}`);
      await loadCore();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function generateInstances() {
    try {
      if (generateForm.ward_ids.length === 0) {
        setError('Select at least one ward');
        return;
      }
      const result = await trpcMutate('shifts.generateInstances', generateForm);
      setSuccess(`Generated ${result.created} instances (${result.skipped} already existed)`);
      setShowGenerateModal(false);
      await loadInstances();
      await loadCore();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function assignStaff() {
    if (!selectedInstance) return;
    try {
      await trpcMutate('shifts.assignStaff', {
        shift_instance_id: selectedInstance.id,
        user_id: assignForm.user_id,
        role_during_shift: assignForm.role_during_shift,
        notes: assignForm.notes || undefined,
      });
      setSuccess('Staff assigned');
      setShowAssignModal(false);
      setAssignForm({ user_id: '', role_during_shift: 'nurse', notes: '' });
      await loadRoster(selectedInstance.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeStaff(rosterId: string) {
    if (!selectedInstance) return;
    if (!confirm('Remove this staff member from the shift?')) return;
    try {
      await trpcMutate('shifts.removeStaff', { roster_id: rosterId });
      setSuccess('Staff removed');
      await loadRoster(selectedInstance.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function upsertStaffing() {
    try {
      const result = await trpcMutate('shifts.upsertStaffingTarget', staffingForm);
      setSuccess(`Staffing target ${result.action}`);
      setShowStaffingModal(false);
      await loadCore();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function openAssignModal() {
    setShowAssignModal(true);
    try {
      const data = await trpcQuery('users.list', { pageSize: 100 });
      setAvailableUsers(data?.users || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ── Monthly calendar data ──────────────────────────────────────────────
  const [monthInstances, setMonthInstances] = useState<ShiftInstance[]>([]);

  useEffect(() => {
    if (tab !== 'monthly' || !selectedWard) return;
    const { year, month } = monthYear;
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const daysInMonth = getDaysInMonth(year, month);
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    trpcQuery('shifts.listInstances', { ward_id: selectedWard, start_date: startDate, end_date: endDate })
      .then(data => setMonthInstances(data || []))
      .catch(e => setError(e.message));
  }, [tab, selectedWard, monthYear]);

  // Auto-clear messages
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(''); setSuccess(''); }, 4000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading shift management...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Shift & Workforce Management</h1>
            <p className="text-blue-200 text-sm mt-1">Templates, rosters, staffing ratios, overtime</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            {stats && (
              <>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.active_templates}</div>
                  <div className="text-blue-300">Templates</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.today_instances}</div>
                  <div className="text-blue-300">Today&apos;s Shifts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.today_rostered}</div>
                  <div className="text-blue-300">Rostered Staff</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-300">{stats.pending_leave_requests}</div>
                  <div className="text-blue-300">Pending Leave</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-300">{stats.pending_swap_requests}</div>
                  <div className="text-blue-300">Pending Swaps</div>
                </div>
                {stats.flagged_overtime > 0 && (
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-300">{stats.flagged_overtime}</div>
                    <div className="text-blue-300">OT Flagged</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="mx-6 mt-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>}

      {/* Tabs */}
      <div className="border-b bg-white px-6">
        <div className="flex gap-1">
          {([
            { key: 'templates' as TabKey, label: 'Shift Templates' },
            { key: 'daily' as TabKey, label: 'Daily Roster' },
            { key: 'monthly' as TabKey, label: 'Monthly Calendar' },
            { key: 'staffing' as TabKey, label: 'Staffing Targets' },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">

        {/* ── Templates Tab ──────────────────────────────────────────── */}
        {tab === 'templates' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Shift Templates</h2>
              <div className="flex gap-2">
                {templates.length === 0 && (
                  <button onClick={seedDefaults}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                    Seed Default Shifts
                  </button>
                )}
                <button onClick={() => setShowTemplateModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                  + New Template
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {templates.map(t => (
                <div key={t.id} className={`bg-white rounded-xl border p-4 ${!t.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: t.color || '#3B82F6' }} />
                    <h3 className="font-semibold text-gray-800">{t.name}</h3>
                    {t.is_default && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Default</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                    <div>
                      <span className="text-gray-400">Type:</span> {t.shift_name}
                    </div>
                    <div>
                      <span className="text-gray-400">Duration:</span> {t.duration_hours}h
                    </div>
                    <div>
                      <span className="text-gray-400">Start:</span> {formatTime(t.start_time)}
                    </div>
                    <div>
                      <span className="text-gray-400">End:</span> {formatTime(t.end_time)}
                    </div>
                    <div>
                      <span className="text-gray-400">Ward:</span> {t.ward_type}
                    </div>
                    <div>
                      <span className="text-gray-400">Status:</span>{' '}
                      <span className={t.is_active ? 'text-green-600' : 'text-red-600'}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t flex gap-2">
                    <button onClick={() => toggleTemplate(t)}
                      className={`px-3 py-1 text-xs rounded ${t.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                      {t.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
              {templates.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-400">
                  No shift templates yet. Seed defaults or create a new one.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Daily Roster Tab ───────────────────────────────────────── */}
        {tab === 'daily' && (
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date</label>
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ward</label>
                <select value={selectedWard} onChange={e => setSelectedWard(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm min-w-[200px]">
                  {wards.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                  {wards.length === 0 && <option value="">No wards found</option>}
                </select>
              </div>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setShowGenerateModal(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                  Generate Shifts
                </button>
                <button onClick={loadInstances}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">
                  Refresh
                </button>
              </div>
            </div>

            {instances.length === 0 ? (
              <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                No shift instances for this date/ward. Generate shifts first.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Shift cards */}
                <div className="lg:col-span-1 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Shifts</h3>
                  {instances.map(inst => (
                    <button key={inst.id}
                      onClick={() => { setSelectedInstance(inst); loadRoster(inst.id); }}
                      className={`w-full text-left bg-white rounded-xl border p-4 transition-all ${
                        selectedInstance?.id === inst.id ? 'ring-2 ring-blue-500 border-blue-300' : 'hover:border-gray-300'
                      }`}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: inst.color || '#3B82F6' }} />
                        <span className="font-semibold text-gray-800">{inst.template_name}</span>
                        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                          inst.status === 'active' ? 'bg-green-100 text-green-700' :
                          inst.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                          inst.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{inst.status}</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {formatTime(inst.start_time)} — {formatTime(inst.end_time)}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Roster panel */}
                <div className="lg:col-span-2">
                  {selectedInstance ? (
                    <div className="bg-white rounded-xl border">
                      <div className="p-4 border-b flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-800">{selectedInstance.template_name} Roster</h3>
                          <p className="text-sm text-gray-500">
                            {selectedInstance.shift_date} · {formatTime(selectedInstance.start_time)} — {formatTime(selectedInstance.end_time)}
                          </p>
                        </div>
                        <button onClick={openAssignModal}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                          + Assign Staff
                        </button>
                      </div>
                      <div className="p-4">
                        {roster.length === 0 ? (
                          <p className="text-gray-400 text-center py-8">No staff assigned yet</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500 border-b">
                                <th className="pb-2">Name</th>
                                <th className="pb-2">Role</th>
                                <th className="pb-2">Status</th>
                                <th className="pb-2">Department</th>
                                <th className="pb-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {roster.map(r => (
                                <tr key={r.id} className="border-b last:border-0">
                                  <td className="py-2">
                                    <div className="font-medium text-gray-800">{r.user_name}</div>
                                    <div className="text-xs text-gray-400">{r.user_email}</div>
                                  </td>
                                  <td className="py-2">
                                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                                      {r.role_during_shift}
                                    </span>
                                  </td>
                                  <td className="py-2">
                                    <span className={`text-xs ${
                                      r.status === 'confirmed' ? 'text-green-600' :
                                      r.status === 'absent' ? 'text-red-600' :
                                      r.status === 'cancelled' ? 'text-gray-400 line-through' :
                                      'text-gray-600'
                                    }`}>{r.status}</span>
                                  </td>
                                  <td className="py-2 text-gray-500">{r.user_department}</td>
                                  <td className="py-2">
                                    {r.status !== 'cancelled' && (
                                      <button onClick={() => removeStaff(r.id)}
                                        className="text-red-500 hover:text-red-700 text-xs">Remove</button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                      Select a shift to view its roster
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Monthly Calendar Tab ────────────────────────────────────── */}
        {tab === 'monthly' && (
          <div>
            <div className="flex items-center gap-4 mb-4">
              <button onClick={() => setMonthYear(p => {
                const d = new Date(p.year, p.month - 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })} className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">←</button>
              <h2 className="text-lg font-semibold text-gray-800">
                {new Date(monthYear.year, monthYear.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h2>
              <button onClick={() => setMonthYear(p => {
                const d = new Date(p.year, p.month + 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })} className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300">→</button>
              <div className="ml-4">
                <select value={selectedWard} onChange={e => setSelectedWard(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm min-w-[200px]">
                  {wards.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Calendar grid */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-500 border-b">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="py-2">{d}</div>
                ))}
              </div>
              {(() => {
                const { year, month } = monthYear;
                const daysInMonth = getDaysInMonth(year, month);
                const firstDay = new Date(year, month, 1).getDay();
                const cells: React.ReactNode[] = [];

                // Empty cells before first day
                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} className="p-2 border-b border-r min-h-[80px] bg-gray-50" />);
                }

                // Day cells
                for (let day = 1; day <= daysInMonth; day++) {
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayInstances = monthInstances.filter(i => i.shift_date === dateStr);
                  const isToday = dateStr === getToday();

                  cells.push(
                    <div key={day} className={`p-2 border-b border-r min-h-[80px] ${isToday ? 'bg-blue-50' : ''}`}>
                      <div className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-700 font-bold' : 'text-gray-600'}`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayInstances.map(inst => (
                          <div key={inst.id}
                            className="text-[10px] px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80"
                            style={{ backgroundColor: (inst.color || '#3B82F6') + '20', color: inst.color || '#3B82F6' }}
                            onClick={() => { setTab('daily'); setSelectedDate(dateStr); setSelectedInstance(inst); loadRoster(inst.id); }}
                            title={`${inst.template_name} ${formatTime(inst.start_time)}-${formatTime(inst.end_time)}`}>
                            {inst.template_name}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                // Pad remaining cells
                const totalCells = cells.length;
                const remaining = (7 - (totalCells % 7)) % 7;
                for (let i = 0; i < remaining; i++) {
                  cells.push(<div key={`pad-${i}`} className="p-2 border-b border-r min-h-[80px] bg-gray-50" />);
                }

                // Render rows
                const rows: React.ReactNode[] = [];
                for (let i = 0; i < cells.length; i += 7) {
                  rows.push(
                    <div key={`row-${i}`} className="grid grid-cols-7">
                      {cells.slice(i, i + 7)}
                    </div>
                  );
                }
                return rows;
              })()}
            </div>
          </div>
        )}

        {/* ── Staffing Targets Tab ────────────────────────────────────── */}
        {tab === 'staffing' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">NABH Staffing Targets</h2>
                <p className="text-sm text-gray-500">Nurse:patient ratios by ward type</p>
              </div>
              <button onClick={() => setShowStaffingModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                + Add Target
              </button>
            </div>

            {staffingTargets.length === 0 ? (
              <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
                No staffing targets defined yet. Add NABH-compliant ratios.
              </div>
            ) : (
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3">Ward Type</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Min Ratio</th>
                      <th className="px-4 py-3">Optimal Ratio</th>
                      <th className="px-4 py-3">Amber Threshold</th>
                      <th className="px-4 py-3">Meaning</th>
                      <th className="px-4 py-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffingTargets.map(t => (
                      <tr key={t.id} className="border-t">
                        <td className="px-4 py-3 font-medium text-gray-800 capitalize">{t.ward_type.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-gray-600">{t.role}</td>
                        <td className="px-4 py-3">
                          <span className="text-red-600 font-mono">{t.min_ratio}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-green-600 font-mono">{t.optimal_ratio}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-amber-600">{t.amber_threshold_pct}%</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          Min: 1 {t.role} per {t.min_ratio > 0 ? Math.round(1 / t.min_ratio) : '∞'} pts ·
                          Optimal: 1 per {t.optimal_ratio > 0 ? Math.round(1 / t.optimal_ratio) : '∞'} pts
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{t.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">New Shift Template</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Name</label>
                <input value={templateForm.name} onChange={e => setTemplateForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. ICU Night" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Shift Type</label>
                  <select value={templateForm.shift_name} onChange={e => setTemplateForm(p => ({ ...p, shift_name: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {SHIFT_NAMES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Ward Type</label>
                  <select value={templateForm.ward_type} onChange={e => setTemplateForm(p => ({ ...p, ward_type: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {WARD_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start Time</label>
                  <input type="time" value={templateForm.start_time}
                    onChange={e => setTemplateForm(p => ({ ...p, start_time: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End Time</label>
                  <input type="time" value={templateForm.end_time}
                    onChange={e => setTemplateForm(p => ({ ...p, end_time: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Duration (h)</label>
                  <input type="number" value={templateForm.duration_hours}
                    onChange={e => setTemplateForm(p => ({ ...p, duration_hours: Number(e.target.value) }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" min={1} max={24} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Color</label>
                <input type="color" value={templateForm.color}
                  onChange={e => setTemplateForm(p => ({ ...p, color: e.target.value }))}
                  className="w-12 h-8 border rounded cursor-pointer" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowTemplateModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={createTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                disabled={!templateForm.name.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Instances Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Generate Shift Instances</h3>
            <p className="text-sm text-gray-500 mb-4">
              Creates one shift per template × ward × day. Duplicates are skipped automatically.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start Date</label>
                  <input type="date" value={generateForm.start_date}
                    onChange={e => setGenerateForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End Date</label>
                  <input type="date" value={generateForm.end_date}
                    onChange={e => setGenerateForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Wards</label>
                <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
                  {wards.map(w => (
                    <label key={w.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                      <input type="checkbox"
                        checked={generateForm.ward_ids.includes(w.id)}
                        onChange={e => {
                          setGenerateForm(p => ({
                            ...p,
                            ward_ids: e.target.checked
                              ? [...p.ward_ids, w.id]
                              : p.ward_ids.filter(id => id !== w.id),
                          }));
                        }} />
                      {w.name}
                    </label>
                  ))}
                  {wards.length === 0 && <p className="text-gray-400 text-xs">No wards found. Create locations first.</p>}
                </div>
                <button onClick={() => setGenerateForm(p => ({ ...p, ward_ids: wards.map(w => w.id) }))}
                  className="text-xs text-blue-600 hover:underline mt-1">Select all</button>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={generateInstances}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                disabled={generateForm.ward_ids.length === 0 || !generateForm.end_date}>Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Staff Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Assign Staff to Shift</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Staff Member</label>
                <select value={assignForm.user_id} onChange={e => setAssignForm(p => ({ ...p, user_id: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select...</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Role During Shift</label>
                <select value={assignForm.role_during_shift}
                  onChange={e => setAssignForm(p => ({ ...p, role_during_shift: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
                <input value={assignForm.notes} onChange={e => setAssignForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Covering for leave" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={assignStaff}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                disabled={!assignForm.user_id}>Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* Staffing Target Modal */}
      {showStaffingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Staffing Target</h3>
            <p className="text-sm text-gray-500 mb-4">
              Set nurse:patient ratios. A min_ratio of 0.5 = 1 nurse per 2 patients.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Ward Type</label>
                  <select value={staffingForm.ward_type}
                    onChange={e => setStaffingForm(p => ({ ...p, ward_type: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {WARD_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Role</label>
                  <select value={staffingForm.role}
                    onChange={e => setStaffingForm(p => ({ ...p, role: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Min Ratio</label>
                  <input type="number" step="0.01" value={staffingForm.min_ratio}
                    onChange={e => setStaffingForm(p => ({ ...p, min_ratio: Number(e.target.value) }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Optimal Ratio</label>
                  <input type="number" step="0.01" value={staffingForm.optimal_ratio}
                    onChange={e => setStaffingForm(p => ({ ...p, optimal_ratio: Number(e.target.value) }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Amber %</label>
                  <input type="number" value={staffingForm.amber_threshold_pct}
                    onChange={e => setStaffingForm(p => ({ ...p, amber_threshold_pct: Number(e.target.value) }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <input value={staffingForm.notes}
                  onChange={e => setStaffingForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. NABH standard" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowStaffingModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
              <button onClick={upsertStaffing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save Target</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
