'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { EmptyState } from '@/components/caregiver';

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
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type OtTab = 'board' | 'myCases' | 'checklist' | 'anaesthesia' | 'equipment';

const CASE_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  scheduled: { bg: '#e3f2fd', text: '#1565c0' },
  'in-prep': { bg: '#fff3e0', text: '#e65100' },
  'in-progress': { bg: '#e8f5e9', text: '#2e7d32' },
  completed: { bg: '#f5f5f5', text: '#666' },
  cancelled: { bg: '#ffebee', text: '#c62828' },
};

// Pre-op readiness step mapping (journey steps 4.1–4.5)
const PREOP_JOURNEY_STEPS = [
  { num: '4.1', key: 'investigations', label: 'Investigations' },
  { num: '4.2', key: 'pac_clearance', label: 'PAC' },
  { num: '4.3', key: 'financial', label: 'Finance' },
  { num: '4.4', key: 'checklist', label: 'Checklist' },
  { num: '4.5', key: 'ot_confirmed', label: 'Confirmed' },
];

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

interface JourneyStep {
  id: string;
  patient_id: string;
  encounter_id: string;
  phase: string;
  step_number: string;
  step_name: string;
  status: string;
  owner_role: string;
  started_at: string | null;
  completed_at?: string | null;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function OtClient({ userId, userRole, userName }: Props) {
  const isSurgeon = userRole === 'surgeon' || userRole === 'visiting_consultant';
  const isAnaesthetist = userRole === 'anaesthetist';
  const isOtNurse = userRole === 'ot_nurse' || userRole === 'ot_coordinator';
  const isCoordinator = userRole === 'ip_coordinator' || userRole === 'ot_coordinator' || userRole === 'admin' || userRole === 'super_admin';

  const [activeTab, setActiveTab] = useState<OtTab>('board');
  const [loading, setLoading] = useState(true);
  const [todayBoard, setTodayBoard] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [checklist, setChecklist] = useState<any>(null);
  const [anaesthesia, setAnaesthesia] = useState<any>(null);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [checklistPhase, setChecklistPhase] = useState<'sign_in' | 'time_out' | 'sign_out'>('sign_in');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Journey steps for pre-op readiness
  const [preopJourneySteps, setPreopJourneySteps] = useState<JourneyStep[]>([]);

  // ── Pre-op readiness per patient (from journey steps 4.1-4.5) ─────────
  const preopReadinessMap = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const step of preopJourneySteps) {
      if (!map[step.patient_id]) {
        map[step.patient_id] = {};
      }
      map[step.patient_id][step.step_number] = step.status;
    }
    return map;
  }, [preopJourneySteps]);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [boardResp, rmsResp, journeyResp] = await Promise.all([
        trpcQuery('otManagement.todayBoard'),
        trpcQuery('otManagement.listRooms'),
        // Fetch all pre-op journey steps (4.1-4.5) for the hospital
        trpcQuery('journeyEngine.getPhaseOverview', { phase: 'PHASE_4_PRE_OP' }),
      ]);
      const boardRooms = boardResp?.board || boardResp || [];
      const flatCases = Array.isArray(boardRooms)
        ? boardRooms.flatMap((room: any) => (room.cases || []).map((c: any) => ({ ...c, room_name: room.room_name, room_id: room.room_id })))
        : [];
      setTodayBoard(flatCases);
      setRooms(Array.isArray(rmsResp?.rooms) ? rmsResp.rooms : Array.isArray(rmsResp) ? rmsResp : []);

      // Journey pre-op steps
      const steps = Array.isArray(journeyResp) ? journeyResp
        : journeyResp?.steps || journeyResp?.items || [];
      setPreopJourneySteps(steps.filter((s: any) =>
        ['4.1', '4.2', '4.3', '4.4', '4.5'].includes(s.step_number)
      ));
    } catch (err) {
      console.error('OT load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Load case detail ──────────────────────────────────────────────────
  const selectCase = useCallback(async (c: any) => {
    setSelectedCase(c);
    const caseId = c.id || c.schedule_id;
    if (!caseId) return;
    try {
      const [clSignIn, clTimeOut, clSignOut, an, eq] = await Promise.all([
        trpcQuery('otManagement.getChecklist', { schedule_id: caseId, phase: 'sign_in' }),
        trpcQuery('otManagement.getChecklist', { schedule_id: caseId, phase: 'time_out' }),
        trpcQuery('otManagement.getChecklist', { schedule_id: caseId, phase: 'sign_out' }),
        trpcQuery('otManagement.getAnesthesiaRecord', { schedule_id: caseId }),
        trpcQuery('otManagement.listEquipmentLog', { schedule_id: caseId }),
      ]);
      const cl = { sign_in: clSignIn, time_out: clTimeOut, sign_out: clSignOut };
      setChecklist(cl);
      setAnaesthesia(an);
      setEquipment(Array.isArray(eq) ? eq : []);
    } catch { /* ignore */ }
  }, []);

  // ── WHO Checklist save ────────────────────────────────────────────────
  const saveChecklistPhase = async (phase: string, data: Record<string, boolean>) => {
    if (!selectedCase) return;
    setSaving(true);
    try {
      await trpcMutate('otManagement.saveChecklist', {
        schedule_id: selectedCase.id || selectedCase.schedule_id,
        phase,
        ...data,
      });
      await selectCase(selectedCase);
    } catch (err) {
      alert('Failed to save checklist');
    } finally {
      setSaving(false);
    }
  };

  // ── Confirm & Notify All ──────────────────────────────────────────────
  const handleConfirmAll = async () => {
    setConfirming(true);
    try {
      // Complete step 4.5 (OT Case List Confirmation) for all patients on the board
      const step45 = preopJourneySteps.filter(s =>
        s.step_number === '4.5' && s.status !== 'completed'
      );
      for (const step of step45) {
        try {
          await trpcMutate('journeyEngine.completeStep', {
            step_id: step.id,
            completed_notes: `OT Case List confirmed by ${userName}. All teams notified.`,
          });
        } catch { /* individual failures don't block others */ }
      }
      setConfirmed(true);
      await loadData();
      setTimeout(() => setConfirmed(false), 5000);
    } catch (err) {
      alert('Failed to confirm OT list');
    } finally {
      setConfirming(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const myCases = todayBoard.filter((c: any) =>
    c.surgeon_id === userId || c.anaesthetist_id === userId || c.ot_nurse_id === userId
  );

  const timeStr = (dt: string | null) => {
    if (!dt) return '';
    return new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  // Get pre-op readiness for a case's patient
  const getReadiness = (patientId: string, stepNum: string): 'complete' | 'in_progress' | 'pending' | 'none' => {
    const patientSteps = preopReadinessMap[patientId];
    if (!patientSteps || !patientSteps[stepNum]) return 'none';
    if (patientSteps[stepNum] === 'completed') return 'complete';
    if (patientSteps[stepNum] === 'in_progress') return 'in_progress';
    return 'pending';
  };

  const readinessIcon = (status: string) => {
    if (status === 'complete') return '🟢';
    if (status === 'in_progress') return '🔵';
    if (status === 'pending') return '🟡';
    return '⚪';
  };

  const readinessColor = (status: string) => {
    if (status === 'complete') return { bg: '#e8f5e9', text: '#2e7d32' };
    if (status === 'in_progress') return { bg: '#e3f2fd', text: '#1565c0' };
    if (status === 'pending') return { bg: '#fff3e0', text: '#e65100' };
    return { bg: '#f5f5f5', text: '#999' };
  };

  // Count how many of 5 pre-op steps are complete per patient
  const preopScore = (patientId: string): number => {
    return PREOP_JOURNEY_STEPS.filter(s => getReadiness(patientId, s.num) === 'complete').length;
  };

  // ── Determine available tabs based on role ────────────────────────────
  const tabs: { key: OtTab; label: string }[] = [
    { key: 'board', label: `📋 OT Board (${todayBoard.length})` },
    { key: 'myCases', label: `🩺 My Cases (${myCases.length})` },
  ];
  if (isOtNurse || isSurgeon) tabs.push({ key: 'checklist', label: '✅ WHO Checklist' });
  if (isAnaesthetist) tabs.push({ key: 'anaesthesia', label: '💉 Anaesthesia' });
  if (isOtNurse) tabs.push({ key: 'equipment', label: '🔧 Equipment' });

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading OT…</p></div>;
  }

  // Count fully ready cases (all 5 steps complete)
  const fullyReady = todayBoard.filter(c => preopScore(c.patient_id) === 5).length;
  const partialReady = todayBoard.filter(c => {
    const score = preopScore(c.patient_id);
    return score > 0 && score < 5;
  }).length;

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>🏥 OT Hub</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {todayBoard.length} cases today · {rooms.length} rooms · {fullyReady} ready · {partialReady} partial
            {isSurgeon && ' · Surgeon View'}
            {isAnaesthetist && ' · Anaesthetist View'}
            {isOtNurse && ' · OT Nurse View'}
          </p>
        </div>

        {/* Confirm & Notify All — visible to coordinators */}
        {isCoordinator && todayBoard.length > 0 && (
          <button
            onClick={handleConfirmAll}
            disabled={confirming || confirmed}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 700, borderRadius: 8,
              border: 'none', cursor: confirming ? 'default' : 'pointer',
              background: confirmed ? '#e8f5e9' : confirming ? '#e0e0e0' : '#1565c0',
              color: confirmed ? '#2e7d32' : '#fff',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {confirmed ? '✅ Confirmed & Notified' : confirming ? '⏳ Confirming...' : '📢 Confirm & Notify All'}
          </button>
        )}
      </header>

      {/* Pre-op readiness summary bar */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 24px', background: '#fff',
        borderBottom: '1px solid #eee', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#555', marginRight: 8 }}>PRE-OP READINESS:</span>
        {PREOP_JOURNEY_STEPS.map(step => {
          const completeCount = todayBoard.filter(c => getReadiness(c.patient_id, step.num) === 'complete').length;
          return (
            <div key={step.num} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, background: '#fafafa',
              border: '1px solid #e0e0e0', fontSize: 11,
            }}>
              <span style={{ fontWeight: 700, color: '#1565c0' }}>{step.num}</span>
              <span style={{ color: '#666' }}>{step.label}</span>
              <span style={{
                fontWeight: 700,
                color: completeCount === todayBoard.length && todayBoard.length > 0 ? '#2e7d32' : '#e65100',
              }}>
                {completeCount}/{todayBoard.length}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888',
            cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedCase ? '1fr 380px' : '1fr', minHeight: 'calc(100vh - 170px)' }}>

        {/* Main panel */}
        <div style={{ padding: '16px 20px 100px', overflow: 'auto' }}>

          {/* ═══ OT BOARD ═══ */}
          {activeTab === 'board' && (
            todayBoard.length === 0 ? (
              <EmptyState title="No Cases Today" message="No surgeries scheduled for today." icon="🏥" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                {todayBoard.map((c: any, i: number) => {
                  const status = c.status || c.os_status || 'scheduled';
                  const colors = CASE_STATUS_COLORS[status] || CASE_STATUS_COLORS.scheduled;
                  const patientId = c.patient_id;
                  const score = preopScore(patientId);
                  return (
                    <div key={c.id || i} onClick={() => selectCase(c)} style={{
                      background: '#fff', border: `1px solid ${selectedCase?.id === c.id ? '#90caf9' : '#e0e0e0'}`,
                      borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
                      borderLeft: `4px solid ${colors.text}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: colors.bg, color: colors.text }}>
                          {status.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 12, color: '#888' }}>
                          {c.room_name || c.os_room || 'OT'} · {timeStr(c.start_time || c.os_start_time)}
                        </span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>
                        {c.patient_name || 'Patient'}
                      </div>
                      <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
                        {c.procedure_name || c.os_procedure || 'Procedure'}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                        Surgeon: {c.surgeon_name || 'TBD'}
                        {c.anaesthetist_name && ` · Anaesth: ${c.anaesthetist_name}`}
                      </div>

                      {/* Journey-driven pre-op readiness traffic light */}
                      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                        {PREOP_JOURNEY_STEPS.map(step => {
                          const s = getReadiness(patientId, step.num);
                          const rc = readinessColor(s);
                          return (
                            <span key={step.num} title={`Step ${step.num}: ${step.label} — ${s}`} style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: rc.bg, color: rc.text, fontWeight: 600,
                            }}>
                              {readinessIcon(s)} {step.label}
                            </span>
                          );
                        })}
                      </div>

                      {/* Overall readiness score */}
                      <div style={{
                        marginTop: 6, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <div style={{
                          flex: '0 0 60px', height: 4, borderRadius: 2,
                          background: '#e0e0e0', overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%', borderRadius: 2,
                            width: `${(score / 5) * 100}%`,
                            background: score === 5 ? '#4caf50' : score >= 3 ? '#ff9800' : '#f44336',
                          }} />
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          color: score === 5 ? '#2e7d32' : score >= 3 ? '#e65100' : '#c62828',
                        }}>
                          {score}/5 ready
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ═══ MY CASES ═══ */}
          {activeTab === 'myCases' && (
            myCases.length === 0 ? (
              <EmptyState title="No Cases Assigned" message="You have no surgeries assigned today." icon="🩺" />
            ) : (
              myCases.map((c: any, i: number) => {
                const status = c.status || c.os_status || 'scheduled';
                const colors = CASE_STATUS_COLORS[status] || CASE_STATUS_COLORS.scheduled;
                const score = preopScore(c.patient_id);
                return (
                  <div key={c.id || i} onClick={() => selectCase(c)} style={{
                    background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
                    padding: '14px 18px', marginBottom: 10, cursor: 'pointer',
                    borderLeft: `4px solid ${colors.text}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{c.patient_name || 'Patient'}</div>
                        <div style={{ fontSize: 14, color: '#555', marginTop: 2 }}>{c.procedure_name || c.os_procedure}</div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                          {c.room_name || c.os_room} · {timeStr(c.start_time || c.os_start_time)} – {timeStr(c.end_time || c.os_end_time)}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {PREOP_JOURNEY_STEPS.map(step => {
                            const s = getReadiness(c.patient_id, step.num);
                            const rc = readinessColor(s);
                            return (
                              <span key={step.num} style={{
                                fontSize: 10, padding: '1px 5px', borderRadius: 4,
                                background: rc.bg, color: rc.text,
                              }}>
                                {readinessIcon(s)} {step.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                          background: colors.bg, color: colors.text,
                        }}>{status}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          color: score === 5 ? '#2e7d32' : '#e65100',
                        }}>
                          {score}/5 ready
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}

          {/* ═══ WHO CHECKLIST ═══ */}
          {activeTab === 'checklist' && (
            !selectedCase ? (
              <EmptyState title="Select a Case" message="Click a case from the board to manage its WHO checklist." icon="✅" />
            ) : (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                  ✅ WHO Surgical Safety Checklist — {selectedCase.patient_name}
                </h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {(['sign_in', 'time_out', 'sign_out'] as const).map(phase => (
                    <button key={phase} onClick={() => setChecklistPhase(phase)} style={{
                      flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600, borderRadius: 8,
                      border: checklistPhase === phase ? '2px solid #1565c0' : '1px solid #e0e0e0',
                      background: checklistPhase === phase ? '#e3f2fd' : '#fff',
                      color: checklistPhase === phase ? '#1565c0' : '#666',
                      cursor: 'pointer',
                    }}>
                      {phase === 'sign_in' ? '1. Sign In' : phase === 'time_out' ? '2. Time Out' : '3. Sign Out'}
                    </button>
                  ))}
                </div>
                <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16 }}>
                  {getChecklistItems(checklistPhase).map(item => {
                    const val = checklist?.[checklistPhase]?.[item.key] || checklist?.[item.key] || false;
                    return (
                      <div key={item.key} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 0', borderBottom: '1px solid #f0f0f0',
                      }}>
                        <input
                          type="checkbox"
                          checked={!!val}
                          onChange={() => {
                            const data = { ...(checklist?.[checklistPhase] || {}), [item.key]: !val };
                            saveChecklistPhase(checklistPhase, data);
                          }}
                          style={{ width: 20, height: 20 }}
                        />
                        <span style={{ fontSize: 14 }}>{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {/* ═══ ANAESTHESIA ═══ */}
          {activeTab === 'anaesthesia' && (
            !selectedCase ? (
              <EmptyState title="Select a Case" message="Click a case to view anaesthesia records." icon="💉" />
            ) : (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                  💉 Anaesthesia Record — {selectedCase.patient_name}
                </h3>
                {anaesthesia ? (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                      <div><strong>ASA Class:</strong> {anaesthesia.ar_asa_class || anaesthesia.asa_grade || 'Not assessed'}</div>
                      <div><strong>Airway:</strong> {anaesthesia.airway_assessment || 'N/A'}</div>
                      <div><strong>Anaesthesia Type:</strong> {anaesthesia.ar_anesthesia_type || anaesthesia.planned_technique || 'N/A'}</div>
                      <div><strong>Fasting Hours:</strong> {anaesthesia.fasting_hours ?? 'N/A'}</div>
                      <div><strong>Aldrete Score:</strong> {anaesthesia.aldrete_score ?? 'Not scored'}</div>
                      <div><strong>Recovery Status:</strong> {anaesthesia.ar_recovery_status || anaesthesia.recovery_status || 'N/A'}</div>
                    </div>
                    {(anaesthesia.agents_used || anaesthesia.drugs_administered) && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Agents Used:</div>
                        {(Array.isArray(anaesthesia.agents_used || anaesthesia.drugs_administered) ? (anaesthesia.agents_used || anaesthesia.drugs_administered) : []).map((d: any, i: number) => (
                          <div key={i} style={{ fontSize: 12, color: '#555', padding: '2px 0' }}>
                            {d.drug || d.agent || d.name || d} — {d.dose || ''} {d.route || ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyState title="No Record" message="Anaesthesia record not yet created for this case." icon="💉" />
                )}
              </div>
            )
          )}

          {/* ═══ EQUIPMENT ═══ */}
          {activeTab === 'equipment' && (
            !selectedCase ? (
              <EmptyState title="Select a Case" message="Click a case to view equipment log." icon="🔧" />
            ) : (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                  🔧 Equipment & Instruments — {selectedCase.patient_name}
                </h3>
                {equipment.length === 0 ? (
                  <EmptyState title="No Equipment Logged" message="No instruments or equipment logged for this case." icon="🔧" />
                ) : (
                  equipment.map((eq: any, i: number) => (
                    <div key={eq.id || i} style={{
                      background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                      padding: '10px 14px', marginBottom: 6, fontSize: 13,
                    }}>
                      <div style={{ fontWeight: 600 }}>{eq.equipment_name || eq.el_name}</div>
                      <div style={{ color: '#666', marginTop: 2 }}>
                        {eq.serial_number || eq.el_serial || ''} · {eq.status || eq.el_status || ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          )}
        </div>

        {/* Right: case detail panel */}
        {selectedCase && (
          <aside style={{
            borderLeft: '1px solid #e0e0e0', background: '#fff',
            padding: 16, overflow: 'auto',
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📋 Case Detail</h3>
            <div style={{ fontSize: 13 }}>
              <p><strong>Patient:</strong> {selectedCase.patient_name}</p>
              <p><strong>Procedure:</strong> {selectedCase.procedure_name || selectedCase.os_procedure}</p>
              <p><strong>Room:</strong> {selectedCase.room_name || selectedCase.os_room}</p>
              <p><strong>Time:</strong> {timeStr(selectedCase.start_time || selectedCase.os_start_time)} – {timeStr(selectedCase.end_time || selectedCase.os_end_time)}</p>
              <p><strong>Surgeon:</strong> {selectedCase.surgeon_name || 'TBD'}</p>
              <p><strong>Anaesthetist:</strong> {selectedCase.anaesthetist_name || 'TBD'}</p>
              <p><strong>Status:</strong> {selectedCase.status || selectedCase.os_status || 'scheduled'}</p>
            </div>

            {/* Pre-op readiness detail */}
            <div style={{ marginTop: 12, padding: 10, background: '#fafafa', borderRadius: 8, border: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: '#555' }}>PRE-OP READINESS</div>
              {PREOP_JOURNEY_STEPS.map(step => {
                const s = getReadiness(selectedCase.patient_id, step.num);
                const rc = readinessColor(s);
                return (
                  <div key={step.num} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 0', fontSize: 12,
                  }}>
                    <span style={{ color: '#555' }}>{step.num} {step.label}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                      background: rc.bg, color: rc.text, fontSize: 10,
                    }}>
                      {readinessIcon(s)} {s === 'none' ? 'N/A' : s}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Quick actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              <button onClick={() => setActiveTab('checklist')}
                style={{ padding: '8px 0', fontSize: 13, fontWeight: 600, background: '#e3f2fd', color: '#1565c0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                ✅ WHO Checklist
              </button>
              {isAnaesthetist && (
                <button onClick={() => setActiveTab('anaesthesia')}
                  style={{ padding: '8px 0', fontSize: 13, fontWeight: 600, background: '#f3e5f5', color: '#7b1fa2', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  💉 Anaesthesia Record
                </button>
              )}
              {isOtNurse && (
                <button onClick={() => setActiveTab('equipment')}
                  style={{ padding: '8px 0', fontSize: 13, fontWeight: 600, background: '#fff3e0', color: '#e65100', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  🔧 Equipment Log
                </button>
              )}
              <a href={`/care/patient/${selectedCase.patient_id}`} style={{
                padding: '8px 0', fontSize: 13, fontWeight: 600, background: '#f5f5f5', color: '#555',
                border: 'none', borderRadius: 6, textDecoration: 'none', textAlign: 'center', display: 'block',
              }}>
                📊 Patient Chart
              </a>
            </div>

            <button onClick={() => setSelectedCase(null)}
              style={{ marginTop: 16, width: '100%', padding: '8px 0', fontSize: 13, background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              ✕ Close
            </button>
          </aside>
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'ot', label: 'OT Hub', icon: '🏥', href: '/care/ot' },
          { key: 'home', label: 'Home', icon: '⌂', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'ot' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'ot' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── WHO Checklist items ────────────────────────────────────────────────────
function getChecklistItems(phase: string): { key: string; label: string }[] {
  if (phase === 'sign_in') return [
    { key: 'patient_identity', label: 'Patient identity confirmed' },
    { key: 'site_marked', label: 'Surgical site marked' },
    { key: 'consent_signed', label: 'Consent form signed' },
    { key: 'anaesthesia_check', label: 'Anaesthesia safety check complete' },
    { key: 'pulse_oximeter', label: 'Pulse oximeter functioning' },
    { key: 'allergies_known', label: 'Known allergies reviewed' },
    { key: 'airway_assessed', label: 'Difficult airway / aspiration risk assessed' },
    { key: 'blood_loss_risk', label: 'Risk of >500ml blood loss planned for' },
  ];
  if (phase === 'time_out') return [
    { key: 'team_introduced', label: 'All team members introduced by name and role' },
    { key: 'patient_name_confirmed', label: 'Patient name, procedure, and site confirmed' },
    { key: 'antibiotic_given', label: 'Antibiotic prophylaxis given within 60 min' },
    { key: 'imaging_displayed', label: 'Essential imaging displayed' },
    { key: 'critical_steps', label: 'Anticipated critical events discussed' },
    { key: 'sterility_confirmed', label: 'Sterility confirmed (including indicators)' },
    { key: 'equipment_issues', label: 'Any equipment issues addressed' },
  ];
  return [
    { key: 'procedure_recorded', label: 'Procedure name recorded' },
    { key: 'instrument_count', label: 'Instrument, sponge, and needle counts correct' },
    { key: 'specimen_labelled', label: 'Specimen labelled correctly' },
    { key: 'equipment_issues_noted', label: 'Equipment problems addressed' },
    { key: 'recovery_concerns', label: 'Key concerns for recovery communicated' },
    { key: 'vte_prophylaxis', label: 'VTE prophylaxis ordered if applicable' },
  ];
}
