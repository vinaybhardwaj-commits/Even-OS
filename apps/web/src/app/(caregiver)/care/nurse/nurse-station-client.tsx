'use client';

import { useState, useEffect, useCallback } from 'react';
import { PatientCard, AlertBanner, EmptyState } from '@/components/caregiver';

// ── tRPC helpers ────────────────────────────────────────────────────────────
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
  if (json.error) throw new Error(json.error.message || 'Mutation failed');
  return json.result?.data?.json;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface CurrentShift {
  roster_id: string;
  instance_id: string;
  ward_id: string;
  shift_date: string;
  template_name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
  charge_nurse_id: string | null;
}

interface PatientRow {
  assignment: {
    id: string;
    shift_instance_id: string;
    nurse_id: string;
    patient_id: string;
    encounter_id: string;
    ward_id: string;
    bed_label: string | null;
    status: string;
    notes: string | null;
  };
  patient_name: string;
  patient_uhid: string;
  patient_gender: string | null;
  patient_dob: string | null;
  encounter_status: string;
  encounter_class: string;
  chief_complaint: string | null;
  admission_at: string | null;
  diet_type: string | null;
  ward_name: string;
}

interface WardRow extends PatientRow {
  nurse_name: string;
  nurse_email: string;
}

interface UnassignedPatient {
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  patient_gender: string | null;
  patient_dob: string | null;
  encounter_id: string;
  encounter_class: string;
  chief_complaint: string | null;
  admission_at: string | null;
  diet_type: string | null;
  current_location_id: string | null;
}

interface ShiftStats {
  total_assigned: number;
  nurse_loads: { nurse_id: string; nurse_name: string; patient_count: number }[];
  pending_handoffs: number;
}

interface RosteredNurse {
  id: string;
  user_id: string;
  role_during_shift: string;
  status: string;
  user_name?: string;
}

type TabKey = 'patients' | 'meds' | 'tasks' | 'handoff' | 'more';

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(dob: string | null): number {
  if (!dob) return 0;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function genderShort(g: string | null): 'M' | 'F' | 'O' {
  if (!g) return 'O';
  return g === 'male' ? 'M' : g === 'female' ? 'F' : 'O';
}

function mapAcuity(encounterClass: string): 'critical' | 'high' | 'medium' | 'low' {
  if (encounterClass === 'ED') return 'critical';
  if (encounterClass === 'IMP') return 'medium';
  return 'low';
}

function daysSinceAdmission(admissionAt: string | null): string {
  if (!admissionAt) return '';
  const diff = Math.floor((Date.now() - new Date(admissionAt).getTime()) / 86400000);
  return `Day ${diff + 1}`;
}

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

const IS_ASSIGNER = ['charge_nurse', 'nursing_supervisor', 'hospital_admin', 'super_admin', 'medical_director', 'unit_head'];

// ── Component ────────────────────────────────────────────────────────────────

export default function NurseStationClient({
  userId, userName, userRole, hospitalId,
}: {
  userId: string;
  userName: string;
  userRole: string;
  hospitalId: string;
}) {
  // State
  const [currentShift, setCurrentShift] = useState<CurrentShift | null>(null);
  const [myPatients, setMyPatients] = useState<PatientRow[]>([]);
  const [wardAssignments, setWardAssignments] = useState<WardRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedPatient[]>([]);
  const [stats, setStats] = useState<ShiftStats | null>(null);
  const [rosteredNurses, setRosteredNurses] = useState<RosteredNurse[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('patients');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedUnassigned, setSelectedUnassigned] = useState<UnassignedPatient | null>(null);
  const [assignNurseId, setAssignNurseId] = useState('');
  const [assignBedLabel, setAssignBedLabel] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<PatientRow | null>(null);
  const [reassignNurseId, setReassignNurseId] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const canAssign = IS_ASSIGNER.includes(userRole);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get current shift
      const shift = await trpcQuery('shifts.getCurrentShift');
      setCurrentShift(shift);

      if (shift?.instance_id) {
        // 2. Load my patients
        const patients = await trpcQuery('patientAssignments.myPatients', {
          shift_instance_id: shift.instance_id,
        });
        setMyPatients(patients || []);

        // 3. If charge nurse / assigner — also load ward assignments, unassigned, stats, roster
        if (canAssign && shift.ward_id) {
          const [ward, unassignedRes, statsRes, rosterRes] = await Promise.all([
            trpcQuery('patientAssignments.wardAssignments', {
              ward_id: shift.ward_id,
              shift_instance_id: shift.instance_id,
            }),
            trpcQuery('patientAssignments.unassignedPatients', {
              ward_id: shift.ward_id,
              shift_instance_id: shift.instance_id,
            }),
            trpcQuery('patientAssignments.stats', {
              shift_instance_id: shift.instance_id,
              ward_id: shift.ward_id,
            }),
            trpcQuery('shifts.getRoster', {
              shift_instance_id: shift.instance_id,
            }),
          ]);
          setWardAssignments(ward || []);
          setUnassigned(unassignedRes || []);
          setStats(statsRes || null);
          setRosteredNurses(rosterRes || []);
        }
      }
    } catch (err) {
      console.error('Error loading nurse station data:', err);
    } finally {
      setLoading(false);
    }
  }, [canAssign]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Assign handler ─────────────────────────────────────────────────────
  const handleAssign = async () => {
    if (!selectedUnassigned || !assignNurseId || !currentShift) return;
    setAssigning(true);
    setError('');
    try {
      await trpcMutate('patientAssignments.assign', {
        shift_instance_id: currentShift.instance_id,
        nurse_id: assignNurseId,
        patient_id: selectedUnassigned.patient_id,
        encounter_id: selectedUnassigned.encounter_id,
        ward_id: currentShift.ward_id,
        bed_label: assignBedLabel || undefined,
      });
      setShowAssignModal(false);
      setSelectedUnassigned(null);
      setAssignNurseId('');
      setAssignBedLabel('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  };

  // ── Reassign handler ──────────────────────────────────────────────────
  const handleReassign = async () => {
    if (!reassignTarget || !reassignNurseId || !reassignReason) return;
    setAssigning(true);
    setError('');
    try {
      await trpcMutate('patientAssignments.reassign', {
        assignment_id: reassignTarget.assignment.id,
        new_nurse_id: reassignNurseId,
        reason: reassignReason,
      });
      setShowReassignModal(false);
      setReassignTarget(null);
      setReassignNurseId('');
      setReassignReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Reassignment failed');
    } finally {
      setAssigning(false);
    }
  };

  // ── No shift state ────────────────────────────────────────────────────
  if (!loading && !currentShift) {
    return (
      <div className="caregiver-theme min-h-screen" style={{ backgroundColor: 'var(--care-bg)' }}>
        <div className="max-w-2xl mx-auto px-4 py-12">
          <EmptyState
            title="No Active Shift"
            message="You're not rostered on any shift right now. Check your schedule or contact your charge nurse."
            action={{ label: 'View Schedule', onClick: () => { window.location.href = '/care/schedule'; } }}
          />
        </div>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="caregiver-theme min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--care-bg)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p style={{ color: 'var(--care-text-secondary)' }}>Loading your patients...</p>
        </div>
      </div>
    );
  }

  // ── Bottom tab bar config ─────────────────────────────────────────────
  const tabs = [
    { key: 'patients' as TabKey, label: 'My Patients', icon: '🏥', badge: myPatients.length || undefined },
    { key: 'meds' as TabKey, label: 'Meds', icon: '💊' },
    { key: 'tasks' as TabKey, label: 'Tasks', icon: '✅' },
    { key: 'handoff' as TabKey, label: 'Handoff', icon: '🔄', badge: stats?.pending_handoffs || undefined },
    { key: 'more' as TabKey, label: 'More', icon: '⋯' },
  ];

  return (
    <div className="caregiver-theme min-h-screen pb-16 md:pb-0" style={{ backgroundColor: 'var(--care-bg)' }}>

      {/* ── Shift Header Bar ───────────────────────────────────────────── */}
      {currentShift && (
        <div className="sticky top-12 z-20 border-b px-4 py-2 flex items-center justify-between gap-3"
          style={{
            backgroundColor: 'var(--care-surface)',
            borderColor: 'var(--care-border)',
          }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: currentShift.color || 'var(--care-primary)' }} />
            <div className="min-w-0">
              <span className="font-semibold text-sm" style={{ color: 'var(--care-text)' }}>
                {currentShift.template_name}
              </span>
              <span className="text-xs ml-2" style={{ color: 'var(--care-text-muted)' }}>
                {formatTime(currentShift.start_time)} – {formatTime(currentShift.end_time)}
              </span>
            </div>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs flex-shrink-0" style={{ color: 'var(--care-text-secondary)' }}>
              <span>{stats.total_assigned} patients</span>
              <span>{stats.nurse_loads.length} nurses</span>
              {stats.pending_handoffs > 0 && (
                <span className="px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--care-warning)' }}>
                  {stats.pending_handoffs} handoffs pending
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Desktop Layout ─────────────────────────────────────────────── */}
      <div className="hidden md:flex max-w-7xl mx-auto px-4 py-4 gap-4">

        {/* Main Patient Grid */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold" style={{ color: 'var(--care-text)' }}>
              {canAssign ? 'Ward Assignments' : 'My Patients'}
            </h2>
            {canAssign && unassigned.length > 0 && (
              <span className="text-xs px-2 py-1 rounded-full font-medium"
                style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                {unassigned.length} unassigned
              </span>
            )}
          </div>

          {/* Unassigned patients alert */}
          {canAssign && unassigned.length > 0 && (
            <div className="mb-3">
              <AlertBanner
                variant="warning"
                title={`${unassigned.length} patient${unassigned.length > 1 ? 's' : ''} in this ward ${unassigned.length > 1 ? 'are' : 'is'} not assigned to any nurse for this shift.`}
              />
            </div>
          )}

          {/* Unassigned row (charge nurse only) */}
          {canAssign && unassigned.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--care-text-secondary)' }}>
                Unassigned Patients
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {unassigned.map((p) => (
                  <div key={p.patient_id}
                    className="rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors hover:border-blue-400"
                    style={{ borderColor: 'var(--care-warning)', backgroundColor: '#FFFBEB' }}
                    onClick={() => {
                      setSelectedUnassigned(p);
                      setShowAssignModal(true);
                    }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm" style={{ color: 'var(--care-text)' }}>{p.patient_name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100" style={{ color: 'var(--care-text-muted)' }}>
                        {p.patient_uhid}
                      </span>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--care-text-secondary)' }}>
                      {calcAge(p.patient_dob)} {genderShort(p.patient_gender)}
                      {p.chief_complaint && ` · ${p.chief_complaint}`}
                      {p.admission_at && ` · ${daysSinceAdmission(p.admission_at)}`}
                    </div>
                    <div className="mt-2 text-xs font-medium" style={{ color: 'var(--care-primary)' }}>
                      Click to assign →
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assigned patients grid */}
          {canAssign ? (
            /* Charge nurse sees all ward assignments grouped by nurse */
            wardAssignments.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--care-text-secondary)' }}>
                  Assigned Patients
                </h3>
                {/* Group by nurse */}
                {stats?.nurse_loads.map((load) => {
                  const nursePatients = wardAssignments.filter(w => w.assignment.nurse_id === load.nurse_id);
                  if (nursePatients.length === 0) return null;
                  return (
                    <div key={load.nurse_id} className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: 'var(--care-primary)' }}>
                          {load.nurse_name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--care-text)' }}>
                          {load.nurse_name}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--care-surface-hover)', color: 'var(--care-text-muted)' }}>
                          {load.patient_count} patient{load.patient_count > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 ml-8">
                        {nursePatients.map((row) => (
                          <PatientCard
                            key={row.assignment.id}
                            patient={{
                              uhid: row.patient_uhid,
                              name: row.patient_name,
                              age: calcAge(row.patient_dob),
                              gender: genderShort(row.patient_gender),
                              bed: row.assignment.bed_label || '',
                              ward: row.ward_name,
                              diagnosis: row.chief_complaint || '',
                              acuity: mapAcuity(row.encounter_class),
                            }}
                            compact
                            onClick={() => {
                              setReassignTarget(row as any);
                              setShowReassignModal(true);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No Assignments Yet"
                message="No patients have been assigned for this shift. Assign patients from the unassigned list above."
              />
            )
          ) : (
            /* Regular nurse sees only their patients */
            myPatients.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {myPatients.map((row) => (
                  <PatientCard
                    key={row.assignment.id}
                    patient={{
                      uhid: row.patient_uhid,
                      name: row.patient_name,
                      age: calcAge(row.patient_dob),
                      gender: genderShort(row.patient_gender),
                      bed: row.assignment.bed_label || '',
                      ward: row.ward_name,
                      diagnosis: row.chief_complaint || '',
                      acuity: mapAcuity(row.encounter_class),
                    }}
                    onClick={() => {/* TODO: open patient detail in NS.2 */}}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No Patients Assigned"
                message="You don't have any patients assigned for this shift. Your charge nurse will assign patients shortly."
              />
            )
          )}
        </div>

        {/* Sidebar — Task Summary + Alerts */}
        <div className="w-80 flex-shrink-0 space-y-4">
          {/* Nurse Load Card */}
          {stats && stats.nurse_loads.length > 0 && (
            <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--care-text)' }}>
                Nurse Workload
              </h3>
              <div className="space-y-2">
                {stats.nurse_loads.map((n) => (
                  <div key={n.nurse_id} className="flex items-center justify-between">
                    <span className="text-sm truncate" style={{ color: 'var(--care-text-secondary)' }}>
                      {n.nurse_name}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      n.patient_count >= 6 ? 'bg-red-100 text-red-700' :
                      n.patient_count >= 4 ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {n.patient_count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Tasks (placeholder) */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--care-text)' }}>
              Pending Tasks
            </h3>
            <p className="text-xs" style={{ color: 'var(--care-text-muted)' }}>
              Task tracking will be available in NS.3.
            </p>
          </div>

          {/* Alert Feed (placeholder) */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--care-text)' }}>
              Alerts
            </h3>
            <p className="text-xs" style={{ color: 'var(--care-text-muted)' }}>
              Clinical alerts and notifications coming in NS.2.
            </p>
          </div>
        </div>
      </div>

      {/* ── Phone Layout ───────────────────────────────────────────────── */}
      <div className="md:hidden px-4 py-3">
        {activeTab === 'patients' && (
          <div>
            {/* Unassigned alert on phone */}
            {canAssign && unassigned.length > 0 && (
              <div className="mb-3">
                <AlertBanner
                  variant="warning"
                  title={`${unassigned.length} unassigned patient${unassigned.length > 1 ? 's' : ''}`}
                />
              </div>
            )}

            {/* Unassigned cards (phone) */}
            {canAssign && unassigned.map((p) => (
              <div key={p.patient_id}
                className="rounded-lg border-2 border-dashed p-3 mb-3 cursor-pointer"
                style={{ borderColor: 'var(--care-warning)', backgroundColor: '#FFFBEB' }}
                onClick={() => {
                  setSelectedUnassigned(p);
                  setShowAssignModal(true);
                }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm" style={{ color: 'var(--care-text)' }}>{p.patient_name}</span>
                  <span className="text-xs" style={{ color: 'var(--care-text-muted)' }}>{p.patient_uhid}</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--care-text-secondary)' }}>
                  {calcAge(p.patient_dob)} {genderShort(p.patient_gender)}
                  {p.chief_complaint && ` · ${p.chief_complaint}`}
                </div>
                <div className="mt-1 text-xs font-medium" style={{ color: 'var(--care-primary)' }}>
                  Tap to assign →
                </div>
              </div>
            ))}

            {/* My patients - single column */}
            {(canAssign ? wardAssignments : myPatients).length > 0 ? (
              <div className="space-y-3">
                {(canAssign ? wardAssignments : myPatients).map((row: any) => (
                  <PatientCard
                    key={row.assignment.id}
                    patient={{
                      uhid: row.patient_uhid,
                      name: row.patient_name,
                      age: calcAge(row.patient_dob),
                      gender: genderShort(row.patient_gender),
                      bed: row.assignment.bed_label || '',
                      ward: row.ward_name,
                      diagnosis: row.chief_complaint || '',
                      acuity: mapAcuity(row.encounter_class),
                    }}
                    onClick={() => {
                      if (canAssign) {
                        setReassignTarget(row);
                        setShowReassignModal(true);
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No Patients"
                message={canAssign
                  ? "No patients assigned yet. Tap unassigned patients above to assign them."
                  : "Your charge nurse will assign patients to you shortly."
                }
              />
            )}
          </div>
        )}

        {activeTab === 'meds' && (
          <EmptyState title="Medications" message="eMAR and medication administration will be available in NS.4." />
        )}

        {activeTab === 'tasks' && (
          <EmptyState title="Tasks" message="Task tracking will be available in NS.3." />
        )}

        {activeTab === 'handoff' && (
          <EmptyState title="Shift Handoff" message="SBAR handoff notes will be available in NS.5." />
        )}

        {activeTab === 'more' && (
          <div className="space-y-3">
            <a href="/care/schedule" className="flex items-center gap-3 p-3 rounded-lg border"
              style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
              <span className="text-xl">📅</span>
              <span className="text-sm font-medium" style={{ color: 'var(--care-text)' }}>My Schedule</span>
            </a>
            <a href="/care/home" className="flex items-center gap-3 p-3 rounded-lg border"
              style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
              <span className="text-xl">🏠</span>
              <span className="text-sm font-medium" style={{ color: 'var(--care-text)' }}>Caregiver Home</span>
            </a>
            <a href="/admin" className="flex items-center gap-3 p-3 rounded-lg border"
              style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
              <span className="text-xl">⚙️</span>
              <span className="text-sm font-medium" style={{ color: 'var(--care-text)' }}>Admin Panel</span>
            </a>
          </div>
        )}
      </div>

      {/* ── Bottom Tab Bar (phone only, in-page tabs) ─────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t safe-area-bottom"
        style={{ height: 'var(--care-bottombar-h)', borderColor: 'var(--care-border)' }}>
        <div className="flex h-full">
          {tabs.map(t => {
            const isActive = t.key === activeTab;
            return (
              <button key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                  isActive ? 'font-semibold' : ''
                }`}
                style={{ color: isActive ? 'var(--care-primary)' : 'var(--care-text-muted)' }}>
                <div className="relative">
                  <span className="text-lg">{t.icon}</span>
                  {t.badge && t.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                      {t.badge > 9 ? '9+' : t.badge}
                    </span>
                  )}
                </div>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Assign Modal ─────────────────────────────────────────────── */}
      {showAssignModal && selectedUnassigned && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Assign Patient</h3>
              <p className="text-sm text-gray-500 mt-1">
                {selectedUnassigned.patient_name} ({selectedUnassigned.patient_uhid})
              </p>
            </div>
            <div className="p-4 space-y-3">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Nurse *</label>
                <select
                  value={assignNurseId}
                  onChange={(e) => setAssignNurseId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select nurse...</option>
                  {rosteredNurses.map((n: any) => (
                    <option key={n.user_id || n.id} value={n.user_id}>
                      {n.user_name || n.user_id} ({n.role_during_shift})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bed Label</label>
                <input
                  type="text"
                  value={assignBedLabel}
                  onChange={(e) => setAssignBedLabel(e.target.value)}
                  placeholder="e.g. ICU-3B"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button
                onClick={() => { setShowAssignModal(false); setError(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >Cancel</button>
              <button
                onClick={handleAssign}
                disabled={!assignNurseId || assigning}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: 'var(--care-primary)' }}
              >{assigning ? 'Assigning...' : 'Assign Patient'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reassign Modal ───────────────────────────────────────────── */}
      {showReassignModal && reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Reassign Patient</h3>
              <p className="text-sm text-gray-500 mt-1">
                {reassignTarget.patient_name} ({reassignTarget.patient_uhid})
              </p>
            </div>
            <div className="p-4 space-y-3">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reassign to Nurse *</label>
                <select
                  value={reassignNurseId}
                  onChange={(e) => setReassignNurseId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select nurse...</option>
                  {rosteredNurses
                    .filter((n: any) => n.user_id !== reassignTarget.assignment.nurse_id)
                    .map((n: any) => (
                      <option key={n.user_id || n.id} value={n.user_id}>
                        {n.user_name || n.user_id} ({n.role_during_shift})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                <textarea
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  placeholder="Why is this patient being reassigned?"
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button
                onClick={() => { setShowReassignModal(false); setError(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >Cancel</button>
              <button
                onClick={handleReassign}
                disabled={!reassignNurseId || !reassignReason || assigning}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: 'var(--care-warning)' }}
              >{assigning ? 'Reassigning...' : 'Reassign Patient'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
