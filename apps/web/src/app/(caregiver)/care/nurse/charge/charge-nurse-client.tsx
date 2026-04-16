'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConfirmModal } from '@/components/caregiver';

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
  if (json.error) throw new Error(json.error?.message || 'Mutation failed');
  return json.result?.data?.json;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function calcAge(dob: string | null): number {
  if (!dob) return 0;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type Acuity = 'critical' | 'high' | 'medium' | 'low';
function acuityColor(a: Acuity): string {
  return a === 'critical' ? '#DC2626' : a === 'high' ? '#F97316' : a === 'medium' ? '#F59E0B' : '#22C55E';
}

// ── Types ───────────────────────────────────────────────────────────────────

interface Assignment {
  assignment: {
    id: string;
    patient_id: string;
    encounter_id: string;
    nurse_id: string;
    ward_id: string;
    bed_label: string | null;
    shift_instance_id: string;
    status: string;
    acuity: string;
  };
  patient_name: string;
  patient_uhid: string;
  patient_gender: string;
  patient_dob: string;
  encounter_status: string;
  encounter_class: string;
  chief_complaint: string | null;
  admission_at: string | null;
  nurse_name: string;
  nurse_email: string;
  ward_name: string;
}

interface UnassignedPatient {
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  patient_gender: string;
  patient_dob: string;
  encounter_id: string;
  chief_complaint: string | null;
  admission_at: string | null;
}

interface NurseLoad {
  nurse_id: string;
  nurse_name: string;
  patient_count: number;
}

interface EscalationItem {
  id: string;
  type: 'news2' | 'overdue_med' | 'overdue_assessment' | 'pending_cosign';
  severity: 'critical' | 'warning' | 'info';
  patient_id: string;
  patient_name: string;
  bed_label: string;
  message: string;
  timestamp: string;
}

interface ShiftInfo {
  instance_id: string;
  ward_id: string;
  ward_name: string;
  template_name: string;
  start_time: string;
  end_time: string;
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHARGE NURSE CLIENT — Ward Command Center
// ═══════════════════════════════════════════════════════════════════════════

export default function ChargeNurseClient({ userId, userRole, userName }: Props) {
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedPatient[]>([]);
  const [nurseLoads, setNurseLoads] = useState<NurseLoad[]>([]);
  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [pendingHandoffs, setPendingHandoffs] = useState(0);
  const [loading, setLoading] = useState(true);

  // Assign modal
  const [assignTarget, setAssignTarget] = useState<UnassignedPatient | null>(null);
  const [selectedNurse, setSelectedNurse] = useState('');
  const [selectedBed, setSelectedBed] = useState('');

  // Reassign modal
  const [reassignTarget, setReassignTarget] = useState<Assignment | null>(null);
  const [reassignNurse, setReassignNurse] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  // Roster
  const [rosterNurses, setRosterNurses] = useState<{ user_id: string; user_name: string; role_during_shift: string }[]>([]);

  // ── Load Data ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Get current shift. getCurrentShift returns an array (a user may have
      // up to 3 shifts today); for charge-nurse view pick the first rostered
      // shift. Admins/super_admins typically have no roster entries → empty
      // array → render the "No Active Shift" empty state below.
      const shiftArr = await trpcQuery('shifts.getCurrentShift', {});
      const shiftData = Array.isArray(shiftArr) && shiftArr.length > 0 ? shiftArr[0] : null;
      if (!shiftData) {
        setShift(null);
        setLoading(false);
        return;
      }
      setShift(shiftData);

      // Load all data in parallel
      const [wardAssign, unassignedPx, statsData, escalationData, roster] = await Promise.all([
        trpcQuery('patientAssignments.wardAssignments', {
          ward_id: shiftData.ward_id,
          shift_instance_id: shiftData.instance_id,
        }),
        trpcQuery('patientAssignments.unassignedPatients', {
          ward_id: shiftData.ward_id,
          shift_instance_id: shiftData.instance_id,
        }),
        trpcQuery('patientAssignments.stats', {
          shift_instance_id: shiftData.instance_id,
          ward_id: shiftData.ward_id,
        }),
        trpcQuery('patientAssignments.escalationFeed', {
          ward_id: shiftData.ward_id,
        }),
        trpcQuery('shifts.getRoster', {
          shift_instance_id: shiftData.instance_id,
        }),
      ]);

      setAssignments(wardAssign || []);
      setUnassigned(unassignedPx || []);
      setNurseLoads(statsData?.nurse_loads || []);
      setPendingHandoffs(statsData?.pending_handoffs || 0);
      setEscalations(escalationData || []);
      setRosterNurses(roster || []);
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(loadData, 30_000);
    return () => clearInterval(timer);
  }, [loadData]);

  // ── Assign Patient ─────────────────────────────────────────────────────

  const confirmAssign = async () => {
    if (!assignTarget || !selectedNurse || !shift) return;
    try {
      await trpcMutate('patientAssignments.assign', {
        shift_instance_id: shift.instance_id,
        nurse_id: selectedNurse,
        patient_id: assignTarget.patient_id,
        encounter_id: assignTarget.encounter_id,
        ward_id: shift.ward_id,
        bed_label: selectedBed || undefined,
      });
      setAssignTarget(null);
      setSelectedNurse('');
      setSelectedBed('');
      await loadData();
    } catch (e) {
      alert(`Assignment failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // ── Reassign Patient ───────────────────────────────────────────────────

  const confirmReassign = async () => {
    if (!reassignTarget || !reassignNurse || !reassignReason) return;
    try {
      await trpcMutate('patientAssignments.reassign', {
        assignment_id: reassignTarget.assignment.id,
        new_nurse_id: reassignNurse,
        reason: reassignReason,
      });
      setReassignTarget(null);
      setReassignNurse('');
      setReassignReason('');
      await loadData();
    } catch (e) {
      alert(`Reassignment failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // ── Group assignments by nurse ─────────────────────────────────────────

  const nurseGroups = (() => {
    const groups: Record<string, { nurse_name: string; nurse_id: string; patients: Assignment[] }> = {};
    for (const a of assignments) {
      const nid = a.assignment.nurse_id;
      if (!groups[nid]) groups[nid] = { nurse_name: a.nurse_name, nurse_id: nid, patients: [] };
      groups[nid].patients.push(a);
    }
    return Object.values(groups).sort((a, b) => b.patients.length - a.patients.length);
  })();

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="caregiver-theme" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🏥</div>
        <p style={{ color: '#6B7280' }}>Loading ward command center...</p>
      </div>
    );
  }

  if (!shift) {
    const isAdmin = ['super_admin', 'hospital_admin', 'admin', 'nursing_supervisor'].includes(userRole);
    return (
      <div className="caregiver-theme" style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
        <div style={{
          background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
          padding: '32px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', margin: '0 0 8px' }}>
            No Active Shift
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: '0 0 20px' }}>
            {isAdmin ? (
              <>
                You&apos;re viewing the Ward Command Center as <b>{userRole.replace(/_/g, ' ')}</b>, but no shift is rostered for you today.<br />
                The Ward Command Center is a per-ward, per-shift view. Ask the Nursing Supervisor to generate today&apos;s shift instances and assign a charge nurse, or use the admin tools below.
              </>
            ) : (
              <>You&apos;re not rostered on any shift right now. If this is unexpected, contact your nursing supervisor or admin.</>
            )}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/care/nurse" style={{
              padding: '10px 20px', borderRadius: 8, background: '#3B82F6', color: '#fff',
              fontWeight: 600, fontSize: 14, textDecoration: 'none',
            }}>
              ← Back to Nurse Home
            </a>
            {isAdmin && (
              <>
                <a href="/admin/shifts" style={{
                  padding: '10px 20px', borderRadius: 8, background: '#fff', color: '#374151',
                  fontWeight: 600, fontSize: 14, textDecoration: 'none', border: '1px solid #D1D5DB',
                }}>
                  Open Shift Admin
                </a>
                <a href="/admin/bed-board" style={{
                  padding: '10px 20px', borderRadius: 8, background: '#fff', color: '#374151',
                  fontWeight: 600, fontSize: 14, textDecoration: 'none', border: '1px solid #D1D5DB',
                }}>
                  Open Bed Board
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const MAX_PATIENTS_PER_NURSE = 6;

  return (
    <div className="caregiver-theme" style={{ padding: '16px 16px 80px', maxWidth: 1400, margin: '0 auto' }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', margin: 0 }}>
            🏥 Ward Command Center
          </h1>
          <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
            {shift.ward_name} &middot; {shift.template_name} &middot; {userName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/care/nurse" style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB',
            background: '#fff', textDecoration: 'none', color: '#374151', fontSize: 13, fontWeight: 600,
          }}>
            ← Nurse Station
          </a>
        </div>
      </div>

      {/* ═══ SUMMARY ROW ═══ */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Patients', value: assignments.length, color: '#3B82F6' },
          { label: 'Unassigned', value: unassigned.length, color: unassigned.length > 0 ? '#DC2626' : '#22C55E' },
          { label: 'Nurses', value: nurseGroups.length, color: '#8B5CF6' },
          { label: 'Escalations', value: escalations.filter(e => e.severity === 'critical').length, color: '#DC2626' },
          { label: 'Handoffs', value: pendingHandoffs, color: '#F59E0B' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 100px', background: '#fff', borderRadius: 8, padding: '8px 12px',
            border: `2px solid ${s.color}20`, textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ═══ THREE-PANEL LAYOUT ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 300px', gap: 16 }}>

        {/* ── LEFT: STAFFING PANEL ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', fontWeight: 700, fontSize: 14, color: '#1E293B' }}>
            👩‍⚕️ Staffing ({nurseGroups.length})
          </div>
          <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            {nurseGroups.map(g => {
              const overloaded = g.patients.length > MAX_PATIENTS_PER_NURSE;
              return (
                <div key={g.nurse_id} style={{
                  padding: '10px 14px', borderBottom: '1px solid #F3F4F6',
                  background: overloaded ? '#FEF2F2' : '#fff',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1E293B' }}>
                    {g.nurse_name}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color: overloaded ? '#DC2626' : '#6B7280',
                    }}>
                      {g.patients.length} patients
                      {overloaded && ' ⚠️'}
                    </span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {g.patients.map(p => {
                        const a = (p.assignment.acuity || 'medium') as Acuity;
                        return (
                          <div key={p.assignment.id} style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: acuityColor(a),
                          }} title={`${p.patient_name} - ${a}`} />
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
            {rosterNurses.filter(r => !nurseGroups.find(g => g.nurse_id === r.user_id)).map(r => (
              <div key={r.user_id} style={{ padding: '10px 14px', borderBottom: '1px solid #F3F4F6', opacity: 0.5 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#6B7280' }}>{r.user_name}</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>0 patients</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: BED GRID ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          <div style={{
            padding: '12px 14px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#1E293B' }}>
              🛏️ Bed Grid ({assignments.length} occupied)
            </span>
          </div>

          {/* Unassigned patients banner */}
          {unassigned.length > 0 && (
            <div style={{ padding: '10px 14px', background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#DC2626', marginBottom: 8 }}>
                🔴 {unassigned.length} Unassigned Patient{unassigned.length > 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unassigned.map(p => (
                  <button
                    key={p.patient_id}
                    onClick={() => { setAssignTarget(p); setSelectedNurse(''); setSelectedBed(''); }}
                    style={{
                      padding: '6px 12px', borderRadius: 8, border: '1px solid #FECACA',
                      background: '#fff', cursor: 'pointer', fontSize: 12, textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.patient_name}</div>
                    <div style={{ color: '#6B7280', fontSize: 11 }}>{p.patient_uhid}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bed cards grid */}
          <div style={{
            padding: 14, display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
            maxHeight: 'calc(100vh - 340px)', overflowY: 'auto',
          }}>
            {assignments.map(a => {
              const acuity = (a.assignment.acuity || 'medium') as Acuity;
              return (
                <div
                  key={a.assignment.id}
                  onClick={() => {
                    setReassignTarget(a);
                    setReassignNurse('');
                    setReassignReason('');
                  }}
                  style={{
                    border: `2px solid ${acuityColor(acuity)}40`,
                    borderRadius: 10, padding: 10, cursor: 'pointer',
                    background: '#fff', transition: 'box-shadow 0.2s',
                    position: 'relative',
                  }}
                >
                  {/* Bed label chip */}
                  <div style={{
                    position: 'absolute', top: -6, right: 8,
                    background: acuityColor(acuity), color: '#fff',
                    padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                  }}>
                    {a.assignment.bed_label || '—'}
                  </div>

                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1E293B', marginTop: 4, marginBottom: 2 }}>
                    {a.patient_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>
                    {a.patient_uhid} &middot; {a.patient_gender === 'male' ? 'M' : a.patient_gender === 'female' ? 'F' : 'O'}/{calcAge(a.patient_dob)}y
                  </div>
                  {a.chief_complaint && (
                    <div style={{ fontSize: 11, color: '#4B5563', marginTop: 4, fontStyle: 'italic' }}>
                      {a.chief_complaint.length > 30 ? a.chief_complaint.slice(0, 30) + '...' : a.chief_complaint}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 4, fontWeight: 500 }}>
                    👩‍⚕️ {a.nurse_name.split(' ')[0]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: ESCALATION FEED ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', fontWeight: 700, fontSize: 14, color: '#1E293B' }}>
            🚨 Escalations ({escalations.length})
          </div>
          <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            {escalations.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
                ✅ No active escalations
              </div>
            )}
            {escalations.map(e => (
              <a
                key={e.id}
                href={`/care/nurse/bedside?patient=${e.patient_id}`}
                style={{
                  display: 'block', padding: '10px 14px', borderBottom: '1px solid #F3F4F6',
                  textDecoration: 'none', color: 'inherit',
                  borderLeft: `4px solid ${e.severity === 'critical' ? '#DC2626' : e.severity === 'warning' ? '#F59E0B' : '#3B82F6'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: '#1E293B' }}>
                      {e.bed_label && `[${e.bed_label}] `}{e.patient_name}
                    </div>
                    <div style={{ fontSize: 12, color: '#4B5563', marginTop: 2 }}>
                      {e.type === 'news2' && '⚠️ '}
                      {e.type === 'overdue_med' && '💊 '}
                      {e.type === 'overdue_assessment' && '📋 '}
                      {e.type === 'pending_cosign' && '✍️ '}
                      {e.message}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap', marginLeft: 8 }}>
                    {timeAgo(e.timestamp)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ASSIGN MODAL ═══ */}
      {assignTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px', color: '#1E293B' }}>
              Assign Patient
            </h2>
            <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{assignTarget.patient_name}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>
                {assignTarget.patient_uhid} &middot; {assignTarget.chief_complaint || 'No complaint'}
              </div>
            </div>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Assign to Nurse
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
              {rosterNurses.map(n => {
                const load = nurseLoads.find(l => l.nurse_id === n.user_id);
                const cnt = load?.patient_count || 0;
                const overloaded = cnt >= MAX_PATIENTS_PER_NURSE;
                return (
                  <button
                    key={n.user_id}
                    onClick={() => setSelectedNurse(n.user_id)}
                    style={{
                      padding: '8px 12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      border: selectedNurse === n.user_id ? '2px solid #3B82F6' : '1px solid #D1D5DB',
                      background: selectedNurse === n.user_id ? '#EFF6FF' : overloaded ? '#FEF2F2' : '#fff',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: selectedNurse === n.user_id ? 600 : 400, fontSize: 13 }}>
                      {n.user_name}
                    </span>
                    <span style={{ fontSize: 12, color: overloaded ? '#DC2626' : '#6B7280' }}>
                      {cnt} pts {overloaded ? '⚠️' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Bed Label (optional)
            </label>
            <input
              value={selectedBed}
              onChange={e => setSelectedBed(e.target.value)}
              placeholder="e.g., B-12"
              style={{
                width: '100%', height: 40, border: '1px solid #D1D5DB', borderRadius: 8,
                padding: '0 12px', fontSize: 14, marginBottom: 16, boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAssignTarget(null)} style={{
                flex: 1, height: 44, borderRadius: 8, border: '1px solid #D1D5DB',
                background: '#fff', cursor: 'pointer', fontWeight: 600,
              }}>Cancel</button>
              <button onClick={confirmAssign} disabled={!selectedNurse} style={{
                flex: 1, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: selectedNurse ? '#3B82F6' : '#D1D5DB', color: '#fff', fontWeight: 700,
              }}>Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ REASSIGN MODAL ═══ */}
      {reassignTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px', color: '#1E293B' }}>
              Reassign Patient
            </h2>
            <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{reassignTarget.patient_name}</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>
                {reassignTarget.patient_uhid} &middot; Bed {reassignTarget.assignment.bed_label || '—'}
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
              Currently assigned to: <strong>{reassignTarget.nurse_name}</strong>
            </div>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Reassign to
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 180, overflowY: 'auto' }}>
              {rosterNurses.filter(n => n.user_id !== reassignTarget.assignment.nurse_id).map(n => {
                const load = nurseLoads.find(l => l.nurse_id === n.user_id);
                const cnt = load?.patient_count || 0;
                return (
                  <button
                    key={n.user_id}
                    onClick={() => setReassignNurse(n.user_id)}
                    style={{
                      padding: '8px 12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                      border: reassignNurse === n.user_id ? '2px solid #3B82F6' : '1px solid #D1D5DB',
                      background: reassignNurse === n.user_id ? '#EFF6FF' : '#fff',
                      display: 'flex', justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontWeight: reassignNurse === n.user_id ? 600 : 400, fontSize: 13 }}>{n.user_name}</span>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>{cnt} pts</span>
                  </button>
                );
              })}
            </div>

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Reason for Reassignment
            </label>
            <input
              value={reassignReason}
              onChange={e => setReassignReason(e.target.value)}
              placeholder="e.g., Workload balancing, nurse break"
              style={{
                width: '100%', height: 40, border: '1px solid #D1D5DB', borderRadius: 8,
                padding: '0 12px', fontSize: 14, marginBottom: 16, boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setReassignTarget(null)} style={{
                flex: 1, height: 44, borderRadius: 8, border: '1px solid #D1D5DB',
                background: '#fff', cursor: 'pointer', fontWeight: 600,
              }}>Cancel</button>
              <button onClick={confirmReassign} disabled={!reassignNurse || !reassignReason} style={{
                flex: 1, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: (reassignNurse && reassignReason) ? '#F59E0B' : '#D1D5DB', color: '#fff', fontWeight: 700,
              }}>Reassign</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BOTTOM TAB BAR ═══ */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #E5E7EB',
        display: 'flex', justifyContent: 'space-around', padding: '8px 0',
        zIndex: 900,
      }}>
        <a href="/care/nurse" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}>
          <div style={{ fontSize: 20 }}>🏥</div>Patients
        </a>
        <a href="/care/nurse/charge" style={{ textAlign: 'center', textDecoration: 'none', color: '#3B82F6', fontSize: 11, fontWeight: 600 }}>
          <div style={{ fontSize: 20 }}>📋</div>Command
        </a>
        <a href="/care/nurse/emar" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}>
          <div style={{ fontSize: 20 }}>💊</div>eMAR
        </a>
        <a href="/care/schedule" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}>
          <div style={{ fontSize: 20 }}>📅</div>Schedule
        </a>
      </div>
    </div>
  );
}
