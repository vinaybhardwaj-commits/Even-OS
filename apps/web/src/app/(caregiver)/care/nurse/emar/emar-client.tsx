'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PatientIdentityStrip, ConfirmModal, EmptyState } from '@/components/caregiver';

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

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function isOverdue(scheduledDatetime: string): boolean {
  return new Date(scheduledDatetime) < new Date();
}

type MedStatus = 'pending' | 'completed' | 'held' | 'not_done' | 'in_progress';

function statusColor(status: MedStatus, scheduled: string): string {
  if (status === 'completed') return '#22C55E';  // green
  if (status === 'held') return '#9CA3AF';        // gray
  if (status === 'not_done') return '#F97316';     // orange
  if (status === 'pending' && isOverdue(scheduled)) return '#DC2626'; // red (overdue)
  return '#3B82F6'; // blue (due)
}

function statusLabel(status: MedStatus, scheduled: string): string {
  if (status === 'completed') return 'Given';
  if (status === 'held') return 'Held';
  if (status === 'not_done') return 'Refused';
  if (status === 'pending' && isOverdue(scheduled)) return 'Overdue';
  return 'Due';
}

// ── Hold/Refuse reasons ─────────────────────────────────────────────────────

const HOLD_REASONS = [
  'NPO / Nil by mouth',
  'Lab values - awaiting result',
  'Vital signs out of range',
  'Patient in procedure',
  'Prescriber instruction',
  'Pharmacy hold',
  'Other',
];

const REFUSE_REASONS = [
  'Patient refused',
  'Patient vomiting',
  'Patient absent from ward',
  'Patient NPO',
  'Patient sleeping (non-critical)',
  'Other',
];

// ── Types ───────────────────────────────────────────────────────────────────

interface MedSlot {
  request_id: string;
  drug_name: string;
  dose_quantity: number;
  dose_unit: string;
  route: string;
  time_slot: string;
  scheduled_datetime: string;
  administration: {
    id: string;
    status: MedStatus;
    administered_datetime: string;
    dose_given: number;
    route: string;
  } | null;
}

interface TimeSlotGroup {
  time_slot: string;
  medications: MedSlot[];
}

interface PatientMeds {
  patient_id: string;
  encounter_id: string;
  assignment_id: string;
  patient_name: string;
  patient_uhid: string;
  patient_dob: string;
  patient_gender: string;
  bed_label: string;
  ward_name: string;
  admission_at: string | null;
  schedule: TimeSlotGroup[];
}

interface CdsAlert {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  details: any;
  outcome: string | null;
}

interface Props {
  userId: string;
  userRole: string;
  userName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// eMAR CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export default function EmarClient({ userId, userRole }: Props) {
  // ── State ──────────────────────────────────────────────────────────────
  const [patients, setPatients] = useState<PatientMeds[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Give flow
  const [giveTarget, setGiveTarget] = useState<{ patient: PatientMeds; med: MedSlot } | null>(null);
  const [showGiveConfirm, setShowGiveConfirm] = useState(false);

  // Hold flow
  const [holdTarget, setHoldTarget] = useState<{ patient: PatientMeds; med: MedSlot } | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [showHoldModal, setShowHoldModal] = useState(false);

  // Refuse flow
  const [refuseTarget, setRefuseTarget] = useState<{ patient: PatientMeds; med: MedSlot } | null>(null);
  const [refuseReason, setRefuseReason] = useState('');
  const [showRefuseModal, setShowRefuseModal] = useState(false);

  // CDS alerts
  const [cdsAlerts, setCdsAlerts] = useState<CdsAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [showCdsBlock, setShowCdsBlock] = useState(false);

  // Undo toast
  const [undoAction, setUndoAction] = useState<{ type: string; med: MedSlot; patient: PatientMeds } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Med Round
  const [roundActive, setRoundActive] = useState(false);
  const [roundIdx, setRoundIdx] = useState(0);
  const [roundCompleted, setRoundCompleted] = useState<Set<string>>(new Set());
  const [roundSkipped, setRoundSkipped] = useState<Set<string>>(new Set());

  // ── Data Loading ───────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Get my assigned patients
      const myPatients = await trpcQuery('patientAssignments.myPatients', {});
      if (!myPatients || myPatients.length === 0) {
        setPatients([]);
        setLoading(false);
        return;
      }

      // For each patient, fetch eMAR schedule
      const patientMeds: PatientMeds[] = [];
      for (const p of myPatients) {
        const schedule = await trpcQuery('medicationOrders.emarSchedule', {
          encounter_id: p.assignment.encounter_id,
          date: selectedDate,
        });

        patientMeds.push({
          patient_id: p.assignment.patient_id,
          encounter_id: p.assignment.encounter_id,
          assignment_id: p.assignment.id,
          patient_name: p.patient_name,
          patient_uhid: p.patient_uhid,
          patient_dob: p.patient_dob,
          patient_gender: p.patient_gender,
          bed_label: p.assignment.bed_label || '',
          ward_name: p.ward_name,
          admission_at: p.admission_at,
          schedule: schedule || [],
        });
      }

      // Sort by bed label for consistent ordering
      patientMeds.sort((a, b) => a.bed_label.localeCompare(b.bed_label, undefined, { numeric: true }));
      setPatients(patientMeds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load eMAR');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 60s
  useEffect(() => {
    const timer = setInterval(loadData, 60_000);
    return () => clearInterval(timer);
  }, [loadData]);

  // ── CDS Alert Check ────────────────────────────────────────────────────

  const checkCdsAlerts = useCallback(async (med: MedSlot, patient: PatientMeds): Promise<CdsAlert[]> => {
    try {
      const detail = await trpcQuery('medicationOrders.getDetail', { id: med.request_id });
      if (detail?.cds_alerts && detail.cds_alerts.length > 0) {
        const activeAlerts = detail.cds_alerts.filter((a: CdsAlert) => !a.outcome);
        return activeAlerts;
      }
      return [];
    } catch {
      return [];
    }
  }, []);

  // ── Give Flow ──────────────────────────────────────────────────────────

  const initiateGive = async (patient: PatientMeds, med: MedSlot) => {
    // Check CDS alerts first
    const alerts = await checkCdsAlerts(med, patient);
    if (alerts.length > 0) {
      setCdsAlerts(alerts);
      setDismissedAlerts(new Set());
      setGiveTarget({ patient, med });
      setShowCdsBlock(true);
      return;
    }
    setGiveTarget({ patient, med });
    setShowGiveConfirm(true);
  };

  const dismissAlert = (alertId: string) => {
    const next = new Set(dismissedAlerts);
    next.add(alertId);
    setDismissedAlerts(next);
    // If all dismissed, proceed to confirm
    if (next.size >= cdsAlerts.length) {
      setShowCdsBlock(false);
      setShowGiveConfirm(true);
    }
  };

  const confirmGive = async () => {
    if (!giveTarget) return;
    const { patient, med } = giveTarget;
    try {
      await trpcMutate('medicationOrders.emarRecord', {
        medication_request_id: med.request_id,
        encounter_id: patient.encounter_id,
        patient_id: patient.patient_id,
        scheduled_datetime: med.scheduled_datetime,
        dose_given: med.dose_quantity,
        dose_unit: med.dose_unit,
        route: med.route,
      });

      // Show undo toast
      setUndoAction({ type: 'give', med, patient });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoAction(null), 30_000);

      setShowGiveConfirm(false);
      setGiveTarget(null);

      // In Med Round, auto-advance
      if (roundActive) {
        setRoundCompleted(prev => new Set([...prev, `${patient.patient_id}_${med.request_id}_${med.time_slot}`]));
        advanceRound();
      }

      await loadData();
    } catch (e) {
      alert(`Failed to give medication: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // ── Hold Flow ──────────────────────────────────────────────────────────

  const initiateHold = (patient: PatientMeds, med: MedSlot) => {
    setHoldTarget({ patient, med });
    setHoldReason('');
    setShowHoldModal(true);
  };

  const confirmHold = async () => {
    if (!holdTarget || !holdReason) return;
    const { patient, med } = holdTarget;
    try {
      await trpcMutate('medicationOrders.emarHold', {
        medication_request_id: med.request_id,
        encounter_id: patient.encounter_id,
        patient_id: patient.patient_id,
        scheduled_datetime: med.scheduled_datetime,
        hold_reason: holdReason,
      });

      setShowHoldModal(false);
      setHoldTarget(null);
      await loadData();
    } catch (e) {
      alert(`Failed to hold medication: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // ── Refuse Flow ────────────────────────────────────────────────────────

  const initiateRefuse = (patient: PatientMeds, med: MedSlot) => {
    setRefuseTarget({ patient, med });
    setRefuseReason('');
    setShowRefuseModal(true);
  };

  const confirmRefuse = async () => {
    if (!refuseTarget || !refuseReason) return;
    const { patient, med } = refuseTarget;
    try {
      await trpcMutate('medicationOrders.emarRefuse', {
        medication_request_id: med.request_id,
        encounter_id: patient.encounter_id,
        patient_id: patient.patient_id,
        scheduled_datetime: med.scheduled_datetime,
        not_done_reason: refuseReason,
      });

      setShowRefuseModal(false);
      setRefuseTarget(null);
      await loadData();
    } catch (e) {
      alert(`Failed to record refusal: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  // ── Med Round Mode ─────────────────────────────────────────────────────

  const getDueMeds = useCallback((): { patient: PatientMeds; med: MedSlot }[] => {
    const due: { patient: PatientMeds; med: MedSlot }[] = [];
    for (const p of patients) {
      for (const slot of p.schedule) {
        for (const med of slot.medications) {
          const status = med.administration?.status || 'pending';
          if (status === 'pending') {
            due.push({ patient: p, med });
          }
        }
      }
    }
    // Sort by bed label then time
    due.sort((a, b) => {
      const bedCmp = a.patient.bed_label.localeCompare(b.patient.bed_label, undefined, { numeric: true });
      if (bedCmp !== 0) return bedCmp;
      return a.med.time_slot.localeCompare(b.med.time_slot);
    });
    return due;
  }, [patients]);

  const startMedRound = () => {
    setRoundActive(true);
    setRoundIdx(0);
    setRoundCompleted(new Set());
    setRoundSkipped(new Set());
  };

  const advanceRound = () => {
    const due = getDueMeds();
    const nextIdx = roundIdx + 1;
    if (nextIdx >= due.length) {
      // Round complete
      setRoundActive(false);
      return;
    }
    setRoundIdx(nextIdx);
  };

  const skipMed = () => {
    const due = getDueMeds();
    const current = due[roundIdx];
    if (current) {
      setRoundSkipped(prev => new Set([...prev, `${current.patient.patient_id}_${current.med.request_id}_${current.med.time_slot}`]));
    }
    advanceRound();
  };

  const endRound = () => {
    setRoundActive(false);
  };

  // ── Summary stats ──────────────────────────────────────────────────────

  const stats = (() => {
    let total = 0, given = 0, overdue = 0, held = 0, refused = 0;
    for (const p of patients) {
      for (const slot of p.schedule) {
        for (const med of slot.medications) {
          total++;
          const st = med.administration?.status || 'pending';
          if (st === 'completed') given++;
          else if (st === 'held') held++;
          else if (st === 'not_done') refused++;
          else if (st === 'pending' && isOverdue(med.scheduled_datetime)) overdue++;
        }
      }
    }
    return { total, given, overdue, held, refused, pending: total - given - held - refused };
  })();

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="caregiver-theme" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>💊</div>
        <p style={{ color: '#6B7280' }}>Loading eMAR...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="caregiver-theme" style={{ padding: 24 }}>
        <div style={{ background: '#FEE2E2', padding: 16, borderRadius: 8, color: '#DC2626' }}>
          {error}
          <button onClick={loadData} style={{ marginLeft: 12, textDecoration: 'underline' }}>Retry</button>
        </div>
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="caregiver-theme" style={{ padding: 24 }}>
        <EmptyState title="No Patients Assigned" message="You don't have any patients assigned for this shift." icon="💊" />
      </div>
    );
  }

  const dueMeds = getDueMeds();
  const roundCurrent = roundActive ? dueMeds[roundIdx] : null;

  return (
    <div className="caregiver-theme" style={{ padding: '16px 16px 100px', maxWidth: 1200, margin: '0 auto' }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', margin: 0 }}>💊 eMAR</h1>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ height: 40, border: '1px solid #D1D5DB', borderRadius: 8, padding: '0 12px', fontSize: 14 }}
          />
          {!roundActive ? (
            <button
              onClick={startMedRound}
              disabled={dueMeds.length === 0}
              style={{
                height: 40, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: dueMeds.length > 0 ? '#3B82F6' : '#D1D5DB',
                color: '#fff', fontWeight: 600, fontSize: 14,
              }}
            >
              Start Med Round ({dueMeds.length})
            </button>
          ) : (
            <button
              onClick={endRound}
              style={{
                height: 40, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#DC2626', color: '#fff', fontWeight: 600, fontSize: 14,
              }}
            >
              End Round
            </button>
          )}
        </div>
      </div>

      {/* ═══ SUMMARY BAR ═══ */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Total', value: stats.total, color: '#6B7280' },
          { label: 'Given', value: stats.given, color: '#22C55E' },
          { label: 'Overdue', value: stats.overdue, color: '#DC2626' },
          { label: 'Pending', value: stats.pending, color: '#3B82F6' },
          { label: 'Held', value: stats.held, color: '#9CA3AF' },
          { label: 'Refused', value: stats.refused, color: '#F97316' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 80px', background: '#fff', borderRadius: 8, padding: '8px 12px',
            border: `2px solid ${s.color}20`, textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ═══ MED ROUND PROGRESS ═══ */}
      {roundActive && (
        <div style={{ background: '#EFF6FF', borderRadius: 8, padding: 12, marginBottom: 16, border: '1px solid #BFDBFE' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: '#1E40AF' }}>
              Med Round: {roundIdx + 1} of {dueMeds.length}
            </span>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              {roundCompleted.size} given &middot; {roundSkipped.size} skipped
            </span>
          </div>
          <div style={{ background: '#DBEAFE', borderRadius: 4, height: 8 }}>
            <div style={{
              width: `${((roundCompleted.size + roundSkipped.size) / Math.max(dueMeds.length, 1)) * 100}%`,
              background: '#3B82F6', borderRadius: 4, height: 8, transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* ═══ MED ROUND FOCUS VIEW ═══ */}
      {roundActive && roundCurrent && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
          border: '2px solid #3B82F6', boxShadow: '0 4px 12px rgba(59,130,246,0.15)',
        }}>
          <PatientIdentityStrip
            patient={{
              name: roundCurrent.patient.patient_name,
              uhid: roundCurrent.patient.patient_uhid,
              age: calcAge(roundCurrent.patient.patient_dob),
              gender: roundCurrent.patient.patient_gender === 'male' ? 'M' : roundCurrent.patient.patient_gender === 'female' ? 'F' : 'O',
              bed: roundCurrent.patient.bed_label,
              ward: roundCurrent.patient.ward_name,
              admission_date: roundCurrent.patient.admission_at || undefined,
            }}
          />
          <div style={{
            marginTop: 16, padding: 16, background: '#F8FAFC', borderRadius: 8,
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1E293B' }}>
              {roundCurrent.med.drug_name}
            </div>
            <div style={{ fontSize: 18, color: '#6B7280', marginTop: 4 }}>
              {roundCurrent.med.dose_quantity} {roundCurrent.med.dose_unit} &middot; {roundCurrent.med.route} &middot; {formatTime(roundCurrent.med.scheduled_datetime)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => initiateGive(roundCurrent.patient, roundCurrent.med)}
              style={{
                flex: 1, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#22C55E', color: '#fff', fontWeight: 700, fontSize: 16,
              }}
            >
              Give
            </button>
            <button
              onClick={() => initiateHold(roundCurrent.patient, roundCurrent.med)}
              style={{
                flex: 1, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#9CA3AF', color: '#fff', fontWeight: 600, fontSize: 14,
              }}
            >
              Hold
            </button>
            <button
              onClick={() => initiateRefuse(roundCurrent.patient, roundCurrent.med)}
              style={{
                flex: 1, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#F97316', color: '#fff', fontWeight: 600, fontSize: 14,
              }}
            >
              Refuse
            </button>
            <button
              onClick={skipMed}
              style={{
                width: 48, height: 48, borderRadius: 8, border: '1px solid #D1D5DB', cursor: 'pointer',
                background: '#fff', fontSize: 16,
              }}
            >
              ⏭
            </button>
          </div>
        </div>
      )}

      {/* ═══ PATIENT MEDICATION TIMELINE ═══ */}
      {!roundActive && patients.map(p => (
        <PatientMedCard
          key={p.patient_id}
          patient={p}
          onGive={(med) => initiateGive(p, med)}
          onHold={(med) => initiateHold(p, med)}
          onRefuse={(med) => initiateRefuse(p, med)}
        />
      ))}

      {/* ═══ CDS ALERT BLOCKER ═══ */}
      {showCdsBlock && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 500, width: '100%' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#DC2626', margin: '0 0 16px' }}>
              ⚠️ Clinical Decision Support Alerts
            </h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>
              You must review and dismiss each alert individually before administering this medication.
            </p>
            {cdsAlerts.map(alert => (
              <div key={alert.id} style={{
                padding: 12, borderRadius: 8, marginBottom: 8,
                border: `1px solid ${alert.severity === 'critical' ? '#DC2626' : alert.severity === 'warning' ? '#F59E0B' : '#3B82F6'}`,
                background: dismissedAlerts.has(alert.id) ? '#F0FDF4' : '#FFF',
                opacity: dismissedAlerts.has(alert.id) ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵'}{' '}
                      {alert.alert_type.replace(/_/g, ' ').toUpperCase()}
                    </div>
                    <div style={{ fontSize: 13, color: '#4B5563', marginTop: 4 }}>{alert.message}</div>
                  </div>
                  {!dismissedAlerts.has(alert.id) && (
                    <button
                      onClick={() => dismissAlert(alert.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB',
                        background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              onClick={() => { setShowCdsBlock(false); setGiveTarget(null); }}
              style={{
                marginTop: 12, width: '100%', height: 40, borderRadius: 8, border: '1px solid #D1D5DB',
                background: '#fff', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═══ GIVE CONFIRM MODAL ═══ */}
      {showGiveConfirm && giveTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <PatientIdentityStrip
              patient={{
                name: giveTarget.patient.patient_name,
                uhid: giveTarget.patient.patient_uhid,
                age: calcAge(giveTarget.patient.patient_dob),
                gender: giveTarget.patient.patient_gender === 'male' ? 'M' : giveTarget.patient.patient_gender === 'female' ? 'F' : 'O',
                bed: giveTarget.patient.bed_label,
                ward: giveTarget.patient.ward_name,
              }}
            />
            <div style={{ marginTop: 16, padding: 16, background: '#F0FDF4', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#166534' }}>
                {giveTarget.med.drug_name}
              </div>
              <div style={{ fontSize: 20, color: '#15803D', marginTop: 4 }}>
                {giveTarget.med.dose_quantity} {giveTarget.med.dose_unit}
              </div>
              <div style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>
                {giveTarget.med.route} &middot; Scheduled {formatTime(giveTarget.med.scheduled_datetime)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => { setShowGiveConfirm(false); setGiveTarget(null); }}
                style={{
                  flex: 1, height: 48, borderRadius: 8, border: '1px solid #D1D5DB',
                  background: '#fff', cursor: 'pointer', fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmGive}
                style={{
                  flex: 1, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: '#22C55E', color: '#fff', fontWeight: 700, fontSize: 16,
                }}
              >
                Confirm Give
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ HOLD MODAL ═══ */}
      {showHoldModal && holdTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', margin: '0 0 16px' }}>
              Hold: {holdTarget.med.drug_name}
            </h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 12 }}>
              Select a reason for holding this dose:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {HOLD_REASONS.map(reason => (
                <button
                  key={reason}
                  onClick={() => setHoldReason(reason)}
                  style={{
                    padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                    border: holdReason === reason ? '2px solid #3B82F6' : '1px solid #D1D5DB',
                    background: holdReason === reason ? '#EFF6FF' : '#fff',
                    fontWeight: holdReason === reason ? 600 : 400, fontSize: 14,
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => { setShowHoldModal(false); setHoldTarget(null); }}
                style={{
                  flex: 1, height: 48, borderRadius: 8, border: '1px solid #D1D5DB',
                  background: '#fff', cursor: 'pointer', fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmHold}
                disabled={!holdReason}
                style={{
                  flex: 1, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: holdReason ? '#9CA3AF' : '#E5E7EB',
                  color: '#fff', fontWeight: 700, fontSize: 16,
                }}
              >
                Confirm Hold
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ REFUSE MODAL ═══ */}
      {showRefuseModal && refuseTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', margin: '0 0 16px' }}>
              Refuse: {refuseTarget.med.drug_name}
            </h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 12 }}>
              Select a reason:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {REFUSE_REASONS.map(reason => (
                <button
                  key={reason}
                  onClick={() => setRefuseReason(reason)}
                  style={{
                    padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                    border: refuseReason === reason ? '2px solid #F97316' : '1px solid #D1D5DB',
                    background: refuseReason === reason ? '#FFF7ED' : '#fff',
                    fontWeight: refuseReason === reason ? 600 : 400, fontSize: 14,
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => { setShowRefuseModal(false); setRefuseTarget(null); }}
                style={{
                  flex: 1, height: 48, borderRadius: 8, border: '1px solid #D1D5DB',
                  background: '#fff', cursor: 'pointer', fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmRefuse}
                disabled={!refuseReason}
                style={{
                  flex: 1, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: refuseReason ? '#F97316' : '#E5E7EB',
                  color: '#fff', fontWeight: 700, fontSize: 16,
                }}
              >
                Confirm Refuse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ UNDO TOAST ═══ */}
      {undoAction && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: '#1E293B', color: '#fff', padding: '12px 20px', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 12, zIndex: 999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: 400,
        }}>
          <span style={{ fontSize: 14 }}>
            ✅ {undoAction.med.drug_name} marked as given
          </span>
          <button
            onClick={() => { setUndoAction(null); /* TODO: implement undo API */ }}
            style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid #fff',
              background: 'transparent', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* ═══ INLINE BOTTOM TAB BAR ═══ */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #E5E7EB',
        display: 'flex', justifyContent: 'space-around', padding: '8px 0',
        zIndex: 900,
      }}>
        <a href="/care/nurse" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}>
          <div style={{ fontSize: 20 }}>🏥</div>Patients
        </a>
        <a href="/care/nurse/emar" style={{ textAlign: 'center', textDecoration: 'none', color: '#3B82F6', fontSize: 11, fontWeight: 600 }}>
          <div style={{ fontSize: 20 }}>💊</div>eMAR
        </a>
        <a href="/care/nurse/bedside" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}>
          <div style={{ fontSize: 20 }}>🛏️</div>Bedside
        </a>
        <a href="/care/schedule" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}>
          <div style={{ fontSize: 20 }}>📅</div>Schedule
        </a>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATIENT MEDICATION CARD (used in timeline view)
// ═══════════════════════════════════════════════════════════════════════════

function PatientMedCard({
  patient,
  onGive,
  onHold,
  onRefuse,
}: {
  patient: PatientMeds;
  onGive: (med: MedSlot) => void;
  onHold: (med: MedSlot) => void;
  onRefuse: (med: MedSlot) => void;
}) {
  const totalMeds = patient.schedule.reduce((acc, s) => acc + s.medications.length, 0);
  if (totalMeds === 0) return null;

  return (
    <div style={{
      background: '#fff', borderRadius: 12, marginBottom: 12,
      border: '1px solid #E5E7EB', overflow: 'hidden',
    }}>
      {/* Patient header */}
      <div style={{
        padding: '10px 14px', background: '#F8FAFC',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <span style={{ fontWeight: 600, color: '#1E293B', fontSize: 14 }}>
            {patient.bed_label && `[${patient.bed_label}] `}{patient.patient_name}
          </span>
          <span style={{ color: '#6B7280', fontSize: 12, marginLeft: 8 }}>
            {patient.patient_uhid}
          </span>
        </div>
        <span style={{ fontSize: 12, color: '#6B7280' }}>{totalMeds} meds</span>
      </div>

      {/* Time slots */}
      {patient.schedule.map(slot => (
        <div key={slot.time_slot}>
          <div style={{
            padding: '6px 14px', background: '#F1F5F9', fontSize: 12,
            fontWeight: 600, color: '#475569', borderBottom: '1px solid #E5E7EB',
          }}>
            ⏰ {slot.time_slot}
          </div>
          {slot.medications.map(med => {
            const st = (med.administration?.status || 'pending') as MedStatus;
            const color = statusColor(st, med.scheduled_datetime);
            const label = statusLabel(st, med.scheduled_datetime);
            const isActionable = st === 'pending';

            return (
              <div
                key={`${med.request_id}_${med.time_slot}`}
                style={{
                  padding: '10px 14px', borderBottom: '1px solid #F3F4F6',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderLeft: `4px solid ${color}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1E293B' }}>
                    {med.drug_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>
                    {med.dose_quantity} {med.dose_unit} &middot; {med.route}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {!isActionable && (
                    <span style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: `${color}15`, color,
                    }}>
                      {label}
                    </span>
                  )}
                  {isActionable && (
                    <>
                      <button
                        onClick={() => onGive(med)}
                        style={{
                          padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: '#22C55E', color: '#fff', fontWeight: 600, fontSize: 12,
                          touchAction: 'manipulation',
                        }}
                      >
                        Give
                      </button>
                      <button
                        onClick={() => onHold(med)}
                        style={{
                          padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB', cursor: 'pointer',
                          background: '#fff', fontSize: 12, touchAction: 'manipulation',
                        }}
                      >
                        Hold
                      </button>
                      <button
                        onClick={() => onRefuse(med)}
                        style={{
                          padding: '6px 10px', borderRadius: 6, border: '1px solid #D1D5DB', cursor: 'pointer',
                          background: '#fff', fontSize: 12, touchAction: 'manipulation',
                        }}
                      >
                        Refuse
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
