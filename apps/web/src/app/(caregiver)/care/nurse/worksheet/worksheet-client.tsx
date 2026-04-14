'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Constants ───────────────────────────────────────────────────────────────
const TASK_TYPES = [
  { key: 'vitals', label: 'Vitals', icon: '💓', frequency: 'q4h' },
  { key: 'meds', label: 'Meds', icon: '💊', frequency: 'scheduled' },
  { key: 'io', label: 'I/O', icon: '💧', frequency: 'q1h' },
  { key: 'assess', label: 'Assess', icon: '📋', frequency: 'q8h' },
  { key: 'turns', label: 'Turns', icon: '🔄', frequency: 'q2h' },
  { key: 'handoff', label: 'Handoff', icon: '📝', frequency: 'end' },
] as const;

type TaskKey = typeof TASK_TYPES[number]['key'];

type TaskStatus = 'done' | 'overdue' | 'due' | 'pending' | 'na';

const STATUS_ICON: Record<TaskStatus, string> = {
  done: '✅',
  overdue: '🔴',
  due: '⏰',
  pending: '·',
  na: '—',
};

const STATUS_BG: Record<TaskStatus, string> = {
  done: '#e8f5e9',
  overdue: '#ffebee',
  due: '#fff3e0',
  pending: '#f5f5f5',
  na: '#fafafa',
};

// ── Types ───────────────────────────────────────────────────────────────────
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

interface TaskCellData {
  status: TaskStatus;
  detail: string;
}

interface PatientTasks {
  patient: PatientRow;
  tasks: Record<TaskKey, TaskCellData>;
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function WorksheetClient({ userId, userRole, userName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [shiftLabel, setShiftLabel] = useState('');
  const [patientTasks, setPatientTasks] = useState<PatientTasks[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);

  // ── Load shift + patients + task statuses ─────────────────────────────
  const loadData = useCallback(async () => {
    try {
      // 1. Get current shift
      const shift = await trpcQuery('shifts.getCurrentShift');
      if (!shift?.id) {
        setLoading(false);
        return;
      }
      setShiftId(shift.id);
      setShiftLabel(`${shift.shift_type?.toUpperCase() || 'SHIFT'} — ${new Date(shift.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} to ${new Date(shift.end_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);

      // 2. Get my patients
      const patients: PatientRow[] = await trpcQuery('patientAssignments.myPatients', {
        shift_instance_id: shift.id,
      });
      if (!patients || patients.length === 0) {
        setPatientTasks([]);
        setLoading(false);
        setLastRefresh(new Date());
        return;
      }

      // 3. For each patient, compute task statuses
      const now = new Date();
      const shiftStart = new Date(shift.start_time);
      const hoursSinceShiftStart = Math.max(0, (now.getTime() - shiftStart.getTime()) / 3600000);

      const enriched: PatientTasks[] = await Promise.all(
        patients.map(async (p) => {
          const tasks: Record<TaskKey, TaskCellData> = {
            vitals: { status: 'pending', detail: '' },
            meds: { status: 'pending', detail: '' },
            io: { status: 'pending', detail: '' },
            assess: { status: 'pending', detail: '' },
            turns: { status: 'pending', detail: '' },
            handoff: { status: 'pending', detail: '' },
          };

          // Fetch vitals + meds + handoff status in parallel
          const [autoData, emarData, handoffData] = await Promise.all([
            trpcQuery('shiftHandoffs.autoPopulate', {
              patient_id: p.assignment.patient_id,
              encounter_id: p.assignment.encounter_id,
              shift_instance_id: shift.id,
            }),
            trpcQuery('medicationOrders.emarSchedule', {
              patient_id: p.assignment.patient_id,
              encounter_id: p.assignment.encounter_id,
            }),
            trpcQuery('shiftHandoffs.read', {
              shift_instance_id: shift.id,
              direction: 'outgoing',
            }),
          ]);

          // ── Vitals ──
          if (autoData) {
            const vitalsCount = autoData.vitals_count || 0;
            const expectedSets = Math.max(1, Math.floor(hoursSinceShiftStart / 4) + 1);
            if (vitalsCount >= expectedSets) {
              tasks.vitals = { status: 'done', detail: `${vitalsCount} sets` };
            } else if (vitalsCount > 0) {
              tasks.vitals = { status: 'due', detail: `${vitalsCount}/${expectedSets}` };
            } else if (hoursSinceShiftStart > 1) {
              tasks.vitals = { status: 'overdue', detail: 'None recorded' };
            }
          }

          // ── Meds ──
          if (autoData) {
            const { med_given, med_total, med_compliance } = autoData;
            if (med_total === 0) {
              tasks.meds = { status: 'na', detail: 'No meds' };
            } else if (med_compliance >= 100) {
              tasks.meds = { status: 'done', detail: `${med_given}/${med_total}` };
            } else if (med_compliance >= 70) {
              tasks.meds = { status: 'due', detail: `${med_given}/${med_total}` };
            } else {
              tasks.meds = { status: 'overdue', detail: `${med_given}/${med_total}` };
            }
          }

          // ── I/O ──
          if (autoData) {
            const { io_intake, io_output } = autoData;
            if (io_intake > 0 || io_output > 0) {
              tasks.io = { status: 'done', detail: `+${io_intake}/-${io_output}ml` };
            } else if (hoursSinceShiftStart > 2) {
              tasks.io = { status: 'due', detail: 'No entries' };
            }
          }

          // ── Assessments ──
          if (autoData?.flagged_assessments && autoData.flagged_assessments.length > 0) {
            tasks.assess = { status: 'overdue', detail: `${autoData.flagged_assessments.length} flagged` };
          } else if (autoData?.news2_score != null) {
            const risk = autoData.news2_risk || 'low';
            tasks.assess = {
              status: risk === 'high' || risk === 'medium' ? 'due' : 'done',
              detail: `NEWS2: ${autoData.news2_score}`,
            };
          }

          // ── Turns (estimated from shift hours) ──
          const turnsExpected = Math.max(0, Math.floor(hoursSinceShiftStart / 2));
          if (turnsExpected === 0) {
            tasks.turns = { status: 'pending', detail: 'Not yet due' };
          } else {
            // We don't have a turns table — show as due reminder
            tasks.turns = { status: 'due', detail: `q2h (${turnsExpected} due)` };
          }

          // ── Handoff ──
          const myHandoffs = Array.isArray(handoffData) ? handoffData : [];
          const patientHandoff = myHandoffs.find(
            (h: any) => h.handoff?.patient_id === p.assignment.patient_id
          );
          if (patientHandoff) {
            tasks.handoff = { status: 'done', detail: patientHandoff.handoff?.priority || 'submitted' };
          } else {
            // Only mark overdue if shift is >75% done
            const shiftEnd = new Date(shift.end_time);
            const shiftDuration = shiftEnd.getTime() - shiftStart.getTime();
            const elapsed = now.getTime() - shiftStart.getTime();
            if (elapsed / shiftDuration > 0.75) {
              tasks.handoff = { status: 'due', detail: 'Not started' };
            }
          }

          return { patient: p, tasks };
        })
      );

      // Sort: patients with overdue tasks first
      enriched.sort((a, b) => {
        const countOverdue = (pt: PatientTasks) =>
          Object.values(pt.tasks).filter(t => t.status === 'overdue').length;
        return countOverdue(b) - countOverdue(a);
      });

      setPatientTasks(enriched);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Worksheet load error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60_000); // refresh every 60s
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Tap cell → navigate ───────────────────────────────────────────────
  const handleCellTap = (patientId: string, taskKey: TaskKey) => {
    switch (taskKey) {
      case 'vitals':
      case 'io':
      case 'assess':
        router.push(`/care/nurse/bedside?tab=${taskKey === 'assess' ? 'assess' : taskKey}`);
        break;
      case 'meds':
        router.push('/care/nurse/emar');
        break;
      case 'handoff':
        router.push('/care/nurse/handoff');
        break;
      default:
        break;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontFamily: 'system-ui' }}>
        <p style={{ color: '#666' }}>Loading worksheet…</p>
      </div>
    );
  }

  if (!shiftId) {
    return (
      <div style={{ padding: 24, textAlign: 'center', fontFamily: 'system-ui' }}>
        <p style={{ fontSize: 40 }}>📋</p>
        <p style={{ fontWeight: 600, marginTop: 8 }}>No Active Shift</p>
        <p style={{ color: '#666', fontSize: 14 }}>Start a shift to see your worksheet.</p>
      </div>
    );
  }

  const totalTasks = patientTasks.length * TASK_TYPES.length;
  const doneTasks = patientTasks.reduce(
    (sum, pt) => sum + Object.values(pt.tasks).filter(t => t.status === 'done').length,
    0
  );
  const overdueTasks = patientTasks.reduce(
    (sum, pt) => sum + Object.values(pt.tasks).filter(t => t.status === 'overdue').length,
    0
  );
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div style={{ fontFamily: 'system-ui', background: '#f8f9fa', minHeight: '100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>📋 My Worksheet</h1>
            <p style={{ fontSize: 12, color: '#666', margin: '2px 0 0' }}>{shiftLabel}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: progressPct >= 80 ? '#2e7d32' : progressPct >= 50 ? '#f57f17' : '#c62828' }}>
              {progressPct}%
            </span>
            <p style={{ fontSize: 11, color: '#999', margin: 0 }}>complete</p>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 8, height: 6, background: '#e0e0e0', borderRadius: 3 }}>
          <div style={{
            height: '100%', borderRadius: 3,
            width: `${progressPct}%`,
            background: progressPct >= 80 ? '#4caf50' : progressPct >= 50 ? '#ff9800' : '#f44336',
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            👥 {patientTasks.length} patients
          </span>
          <span style={{ fontSize: 12, color: '#2e7d32' }}>
            ✅ {doneTasks} done
          </span>
          {overdueTasks > 0 && (
            <span style={{ fontSize: 12, color: '#c62828', fontWeight: 600 }}>
              🔴 {overdueTasks} overdue
            </span>
          )}
          <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>
            ↻ {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* ── Task Grid ──────────────────────────────────────────────────── */}
      {patientTasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 36 }}>📋</p>
          <p style={{ fontWeight: 600 }}>No Patients Assigned</p>
          <p style={{ color: '#888', fontSize: 14 }}>You have no active patient assignments this shift.</p>
        </div>
      ) : (
        <div style={{ padding: '8px 8px 100px' }}>
          {/* Column headers (sticky) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `120px repeat(${TASK_TYPES.length}, 1fr)`,
            gap: 2, position: 'sticky', top: 106, zIndex: 10,
            background: '#f8f9fa', paddingBottom: 4,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#666', padding: '4px 6px' }}>Patient</div>
            {TASK_TYPES.map(t => (
              <div key={t.key} style={{
                fontSize: 11, fontWeight: 600, color: '#666',
                textAlign: 'center', padding: '4px 2px',
              }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span>
                <br />
                {t.label}
              </div>
            ))}
          </div>

          {/* Patient rows */}
          {patientTasks.map((pt) => {
            const isExpanded = expandedPatient === pt.patient.assignment.patient_id;
            const hasOverdue = Object.values(pt.tasks).some(t => t.status === 'overdue');

            return (
              <div key={pt.patient.assignment.id} style={{ marginBottom: 4 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `120px repeat(${TASK_TYPES.length}, 1fr)`,
                  gap: 2, background: '#fff', borderRadius: 8,
                  border: hasOverdue ? '1px solid #ef9a9a' : '1px solid #e0e0e0',
                  overflow: 'hidden',
                }}>
                  {/* Patient name cell */}
                  <div
                    onClick={() => setExpandedPatient(isExpanded ? null : pt.patient.assignment.patient_id)}
                    style={{
                      padding: '8px 6px', cursor: 'pointer',
                      borderRight: '1px solid #e0e0e0',
                      background: hasOverdue ? '#fff5f5' : '#fafafa',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                      {pt.patient.assignment.bed_label && (
                        <span style={{
                          display: 'inline-block', fontSize: 10, fontWeight: 700,
                          background: '#1565c0', color: '#fff', borderRadius: 3,
                          padding: '1px 4px', marginRight: 4,
                        }}>
                          {pt.patient.assignment.bed_label}
                        </span>
                      )}
                      {pt.patient.patient_name?.split(' ')[0]}
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      {pt.patient.patient_uhid}
                    </div>
                  </div>

                  {/* Task cells */}
                  {TASK_TYPES.map(t => {
                    const cell = pt.tasks[t.key];
                    return (
                      <div
                        key={t.key}
                        onClick={() => handleCellTap(pt.patient.assignment.patient_id, t.key)}
                        style={{
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          padding: '8px 2px', cursor: 'pointer',
                          background: STATUS_BG[cell.status],
                          transition: 'background 0.2s',
                          minHeight: 48,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>{STATUS_ICON[cell.status]}</span>
                        {cell.detail && (
                          <span style={{ fontSize: 9, color: '#666', marginTop: 2, textAlign: 'center', lineHeight: 1.1 }}>
                            {cell.detail}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Expanded detail row */}
                {isExpanded && (
                  <div style={{
                    background: '#fff', borderRadius: '0 0 8px 8px',
                    border: '1px solid #e0e0e0', borderTop: 0,
                    padding: '8px 12px', fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#555' }}>
                      <span>🏥 {pt.patient.ward_name}</span>
                      <span>📋 {pt.patient.chief_complaint || 'No chief complaint'}</span>
                      {pt.patient.diet_type && <span>🍽️ {pt.patient.diet_type}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => router.push(`/care/nurse/bedside?tab=vitals`)}
                        style={{
                          flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600,
                          background: '#e3f2fd', color: '#1565c0', border: 'none',
                          borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        Open Bedside
                      </button>
                      <button
                        onClick={() => router.push('/care/nurse/handoff')}
                        style={{
                          flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600,
                          background: '#f3e5f5', color: '#7b1fa2', border: 'none',
                          borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        Handoff
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bottom Tab Bar ──────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff',
        borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'bedside', label: 'Bedside', icon: '🛏️', href: '/care/nurse/bedside' },
          { key: 'emar', label: 'eMAR', icon: '💊', href: '/care/nurse/emar' },
          { key: 'worksheet', label: 'Worksheet', icon: '📋', href: '/care/nurse/worksheet' },
          { key: 'handoff', label: 'Handoff', icon: '📝', href: '/care/nurse/handoff' },
          { key: 'station', label: 'Station', icon: '🏥', href: '/care/nurse' },
        ].map(tab => (
          <a
            key={tab.key}
            href={tab.href}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', padding: '4px 0',
              textDecoration: 'none', fontSize: 10,
              color: tab.key === 'worksheet' ? '#1565c0' : '#888',
              fontWeight: tab.key === 'worksheet' ? 700 : 400,
            }}
          >
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}
