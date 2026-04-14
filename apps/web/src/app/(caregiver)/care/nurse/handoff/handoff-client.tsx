'use client';

import { useState, useEffect, useCallback } from 'react';
import { PatientIdentityStrip, EmptyState } from '@/components/caregiver';

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

function calcAge(dob: string | null): number {
  if (!dob) return 0;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ShiftInfo {
  instance_id: string;
  ward_id: string;
  ward_name: string;
  template_name: string;
}

interface PatientAssignment {
  assignment: {
    id: string;
    patient_id: string;
    encounter_id: string;
    bed_label: string | null;
    shift_instance_id: string;
  };
  patient_name: string;
  patient_uhid: string;
  patient_gender: string;
  patient_dob: string;
  ward_name: string;
  admission_at: string | null;
}

interface AutoSummary {
  auto_summary: string;
  vitals_count: number;
  news2_score: number | null;
  news2_risk: string | null;
  med_given: number;
  med_total: number;
  med_compliance: number;
  io_intake: number;
  io_output: number;
  io_balance: number;
  flagged_assessments: string[];
}

interface HandoffEntry {
  handoff: {
    id: string;
    patient_id: string;
    situation: string | null;
    background: string | null;
    assessment: string | null;
    recommendation: string | null;
    priority: string;
    status: string;
    pending_tasks: any;
    created_at: string;
  };
  patient_name: string;
  patient_uhid: string;
  patient_gender: string;
  patient_dob: string;
  nurse_name: string;
  bed_label: string | null;
}

interface WardSummary {
  total_patients: number;
  handoffs_submitted: number;
  critical_count: number;
  watch_count: number;
  pending: number;
  nurse_summary: { nurse_name: string; handoff_count: number; critical: number; watch: number }[];
}

interface PendingTask {
  task: string;
  due_by?: string;
  priority?: string;
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDOFF CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export default function HandoffClient({ userId, userRole, userName }: Props) {
  const [mode, setMode] = useState<'write' | 'read' | 'ward'>('write');
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Write mode
  const [myPatients, setMyPatients] = useState<PatientAssignment[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientAssignment | null>(null);
  const [autoSummary, setAutoSummary] = useState<AutoSummary | null>(null);
  const [situation, setSituation] = useState('');
  const [background, setBackground] = useState('');
  const [assessment, setAssessment] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [priority, setPriority] = useState<'routine' | 'watch' | 'critical'>('routine');
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [newTask, setNewTask] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  // Read mode
  const [handoffs, setHandoffs] = useState<HandoffEntry[]>([]);

  // Ward summary
  const [wardSummary, setWardSummary] = useState<WardSummary | null>(null);

  const IS_CHARGE = ['charge_nurse', 'nursing_supervisor', 'hospital_admin', 'super_admin'].includes(userRole);

  // ── Load ───────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const shiftData = await trpcQuery('shifts.getCurrentShift', {});
    if (!shiftData) { setShift(null); setLoading(false); return; }
    setShift(shiftData);

    if (mode === 'write') {
      const patients = await trpcQuery('patientAssignments.myPatients', {});
      setMyPatients(patients || []);
    } else if (mode === 'read') {
      const data = await trpcQuery('shiftHandoffs.read', {
        shift_instance_id: shiftData.instance_id,
        direction: 'incoming',
      });
      setHandoffs(data || []);
    } else if (mode === 'ward' && IS_CHARGE) {
      const [handoffData, summaryData] = await Promise.all([
        trpcQuery('shiftHandoffs.read', {
          shift_instance_id: shiftData.instance_id,
          direction: 'outgoing',
        }),
        trpcQuery('shiftHandoffs.wardSummary', {
          shift_instance_id: shiftData.instance_id,
          ward_id: shiftData.ward_id,
        }),
      ]);
      setHandoffs(handoffData || []);
      setWardSummary(summaryData || null);
    }
    setLoading(false);
  }, [mode, IS_CHARGE]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Auto-populate when selecting patient ───────────────────────────────

  const selectPatient = async (p: PatientAssignment) => {
    setSelectedPatient(p);
    setSituation(''); setBackground(''); setAssessment(''); setRecommendation('');
    setPriority('routine'); setPendingTasks([]);
    const auto = await trpcQuery('shiftHandoffs.autoPopulate', {
      patient_id: p.assignment.patient_id,
      encounter_id: p.assignment.encounter_id,
      shift_instance_id: p.assignment.shift_instance_id,
    });
    setAutoSummary(auto);
    // Pre-fill situation with auto-summary
    if (auto?.auto_summary) setSituation(auto.auto_summary);
    // Pre-set priority if flagged
    if (auto?.news2_score && auto.news2_score >= 7) setPriority('critical');
    else if (auto?.news2_score && auto.news2_score >= 5) setPriority('watch');
  };

  // ── Submit handoff ─────────────────────────────────────────────────────

  const submitHandoff = async () => {
    if (!selectedPatient || !shift) return;
    setSaving(true);
    try {
      await trpcMutate('shiftHandoffs.write', {
        patient_id: selectedPatient.assignment.patient_id,
        encounter_id: selectedPatient.assignment.encounter_id,
        outgoing_shift_id: shift.instance_id,
        situation: situation || undefined,
        background: background || undefined,
        assessment: assessment || undefined,
        recommendation: recommendation || undefined,
        priority,
        pending_tasks: pendingTasks.length > 0 ? pendingTasks : undefined,
      });
      setSubmitCount(prev => prev + 1);
      setSelectedPatient(null);
      setAutoSummary(null);
    } catch (e) {
      alert(`Failed to submit: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    setPendingTasks(prev => [...prev, { task: newTask.trim() }]);
    setNewTask('');
  };

  const removeTask = (idx: number) => {
    setPendingTasks(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Priority color ─────────────────────────────────────────────────────

  const prioColor = (p: string) => p === 'critical' ? '#DC2626' : p === 'watch' ? '#F59E0B' : '#22C55E';

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="caregiver-theme" style={{ padding: 24, textAlign: 'center', color: '#6B7280' }}>Loading handoff...</div>;
  }

  if (!shift) {
    return <div className="caregiver-theme" style={{ padding: 24 }}>
      <EmptyState title="No Active Shift" message="You're not rostered on any shift right now." icon="📋" />
    </div>;
  }

  return (
    <div className="caregiver-theme" style={{ padding: '16px 16px 80px', maxWidth: 900, margin: '0 auto' }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', margin: 0 }}>📝 Shift Handoff</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          {['write', 'read', ...(IS_CHARGE ? ['ward'] : [])].map(m => (
            <button key={m} onClick={() => setMode(m as any)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: mode === m ? '#3B82F6' : '#F1F5F9',
              color: mode === m ? '#fff' : '#4B5563', fontWeight: 600, fontSize: 13,
            }}>
              {m === 'write' ? '✏️ Write' : m === 'read' ? '📖 Read' : '📊 Ward'}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ WRITE MODE ═══ */}
      {mode === 'write' && !selectedPatient && (
        <div>
          <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 12 }}>
            Select a patient to write their handoff. {submitCount > 0 && <span style={{ color: '#22C55E', fontWeight: 600 }}>✅ {submitCount} submitted</span>}
          </p>
          {myPatients.length === 0 ? (
            <EmptyState title="No Patients" message="You don't have patients assigned this shift." icon="📋" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myPatients.map(p => (
                <button key={p.assignment.id} onClick={() => selectPatient(p)} style={{
                  padding: 12, borderRadius: 10, border: '1px solid #E5E7EB', background: '#fff',
                  cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {p.assignment.bed_label && `[${p.assignment.bed_label}] `}{p.patient_name}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>{p.patient_uhid}</div>
                  </div>
                  <span style={{ fontSize: 20 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ WRITE FORM ═══ */}
      {mode === 'write' && selectedPatient && (
        <div>
          <button onClick={() => { setSelectedPatient(null); setAutoSummary(null); }} style={{
            marginBottom: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #D1D5DB',
            background: '#fff', cursor: 'pointer', fontSize: 13,
          }}>← Back to patient list</button>

          <PatientIdentityStrip patient={{
            name: selectedPatient.patient_name,
            uhid: selectedPatient.patient_uhid,
            age: calcAge(selectedPatient.patient_dob),
            gender: selectedPatient.patient_gender === 'male' ? 'M' : selectedPatient.patient_gender === 'female' ? 'F' : 'O',
            bed: selectedPatient.assignment.bed_label || '',
            ward: selectedPatient.ward_name,
            admission_date: selectedPatient.admission_at || undefined,
          }} />

          {/* Auto-populated metrics */}
          {autoSummary && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <MetricChip label="Vitals" value={`${autoSummary.vitals_count}`} />
              <MetricChip label="NEWS2" value={autoSummary.news2_score !== null ? `${autoSummary.news2_score}` : '—'}
                color={autoSummary.news2_score && autoSummary.news2_score >= 7 ? '#DC2626' : autoSummary.news2_score && autoSummary.news2_score >= 5 ? '#F59E0B' : undefined} />
              <MetricChip label="Meds" value={`${autoSummary.med_compliance}%`}
                color={autoSummary.med_compliance < 80 ? '#DC2626' : undefined} />
              <MetricChip label="I/O" value={`${autoSummary.io_balance >= 0 ? '+' : ''}${autoSummary.io_balance}ml`} />
              {autoSummary.flagged_assessments.length > 0 && (
                <MetricChip label="Flags" value={`${autoSummary.flagged_assessments.length}`} color="#DC2626" />
              )}
            </div>
          )}

          {/* Priority selector */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Priority</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['routine', 'watch', 'critical'] as const).map(p => (
                <button key={p} onClick={() => setPriority(p)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  border: priority === p ? `2px solid ${prioColor(p)}` : '1px solid #D1D5DB',
                  background: priority === p ? `${prioColor(p)}10` : '#fff',
                  color: priority === p ? prioColor(p) : '#6B7280',
                }}>
                  {p === 'critical' ? '🔴' : p === 'watch' ? '🟡' : '🟢'} {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* SBAR fields */}
          {[
            { key: 'situation', label: 'S — Situation', value: situation, set: setSituation, hint: 'What is going on with the patient right now?' },
            { key: 'background', label: 'B — Background', value: background, set: setBackground, hint: 'Relevant history and context' },
            { key: 'assessment', label: 'A — Assessment', value: assessment, set: setAssessment, hint: 'Your clinical assessment' },
            { key: 'recommendation', label: 'R — Recommendation', value: recommendation, set: setRecommendation, hint: 'What needs to happen next' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{f.label}</label>
              <textarea
                value={f.value}
                onChange={e => f.set(e.target.value)}
                placeholder={f.hint}
                rows={3}
                style={{
                  width: '100%', border: '1px solid #D1D5DB', borderRadius: 8, padding: '8px 12px',
                  fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          {/* Pending tasks */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Pending Tasks</label>
            {pendingTasks.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 13, padding: '4px 8px', background: '#F8FAFC', borderRadius: 6 }}>• {t.task}</span>
                <button onClick={() => removeTask(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 16 }}>×</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTask()}
                placeholder="Add a pending task..."
                style={{ flex: 1, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, padding: '0 10px', fontSize: 13 }}
              />
              <button onClick={addTask} style={{
                padding: '0 12px', borderRadius: 6, border: 'none', background: '#3B82F6',
                color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              }}>Add</button>
            </div>
          </div>

          {/* Submit */}
          <button onClick={submitHandoff} disabled={saving} style={{
            width: '100%', height: 48, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#3B82F6', color: '#fff', fontWeight: 700, fontSize: 16,
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? 'Submitting...' : 'Submit Handoff'}
          </button>
        </div>
      )}

      {/* ═══ READ MODE ═══ */}
      {mode === 'read' && (
        <div>
          {handoffs.length === 0 ? (
            <EmptyState title="No Handoffs" message="No handoff notes available for this shift." icon="📝" />
          ) : (
            <div className="handoff-print-area">
              {handoffs.map(h => (
                <HandoffCard key={h.handoff.id} entry={h} />
              ))}
            </div>
          )}
          {handoffs.length > 0 && (
            <button onClick={() => window.print()} style={{
              marginTop: 16, padding: '10px 20px', borderRadius: 8, border: '1px solid #D1D5DB',
              background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}>
              🖨️ Print Handoff Sheet
            </button>
          )}
        </div>
      )}

      {/* ═══ WARD SUMMARY MODE ═══ */}
      {mode === 'ward' && IS_CHARGE && (
        <div>
          {wardSummary && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <MetricChip label="Patients" value={`${wardSummary.total_patients}`} />
              <MetricChip label="Submitted" value={`${wardSummary.handoffs_submitted}`} color="#22C55E" />
              <MetricChip label="Pending" value={`${wardSummary.pending}`} color={wardSummary.pending > 0 ? '#DC2626' : undefined} />
              <MetricChip label="Critical" value={`${wardSummary.critical_count}`} color={wardSummary.critical_count > 0 ? '#DC2626' : undefined} />
              <MetricChip label="Watch" value={`${wardSummary.watch_count}`} color={wardSummary.watch_count > 0 ? '#F59E0B' : undefined} />
            </div>
          )}

          {wardSummary && wardSummary.nurse_summary.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 14, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#1E293B' }}>Nurse Summary</div>
              {wardSummary.nurse_summary.map((n, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{n.nurse_name}</span>
                  <span style={{ color: '#6B7280' }}>
                    {n.handoff_count} handoffs
                    {n.critical > 0 && <span style={{ color: '#DC2626', marginLeft: 6 }}>🔴 {n.critical}</span>}
                    {n.watch > 0 && <span style={{ color: '#F59E0B', marginLeft: 6 }}>🟡 {n.watch}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="handoff-print-area">
            {handoffs.map(h => (
              <HandoffCard key={h.handoff.id} entry={h} />
            ))}
          </div>

          {handoffs.length > 0 && (
            <button onClick={() => window.print()} style={{
              marginTop: 16, padding: '10px 20px', borderRadius: 8, border: '1px solid #D1D5DB',
              background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}>
              🖨️ Print Ward Summary
            </button>
          )}
        </div>
      )}

      {/* ═══ BOTTOM TAB BAR ═══ */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #E5E7EB',
        display: 'flex', justifyContent: 'space-around', padding: '8px 0', zIndex: 900,
      }}>
        <a href="/care/nurse" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}><div style={{ fontSize: 20 }}>🏥</div>Patients</a>
        <a href="/care/nurse/handoff" style={{ textAlign: 'center', textDecoration: 'none', color: '#3B82F6', fontSize: 11, fontWeight: 600 }}><div style={{ fontSize: 20 }}>📝</div>Handoff</a>
        <a href="/care/nurse/worksheet" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}><div style={{ fontSize: 20 }}>📋</div>Worksheet</a>
        <a href="/care/schedule" style={{ textAlign: 'center', textDecoration: 'none', color: '#6B7280', fontSize: 11 }}><div style={{ fontSize: 20 }}>📅</div>Schedule</a>
      </div>

      {/* ═══ PRINT STYLES ═══ */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .handoff-print-area, .handoff-print-area * { visibility: visible; }
          .handoff-print-area {
            position: absolute; left: 0; top: 0; width: 100%;
          }
          .caregiver-theme > div:last-child { display: none !important; }
          button { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ── Metric Chip ──────────────────────────────────────────────────────────

function MetricChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      padding: '6px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E5E7EB',
      display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13,
    }}>
      <span style={{ color: '#6B7280' }}>{label}:</span>
      <span style={{ fontWeight: 700, color: color || '#1E293B' }}>{value}</span>
    </div>
  );
}

// ── Handoff Card ─────────────────────────────────────────────────────────

function HandoffCard({ entry }: { entry: HandoffEntry }) {
  const h = entry.handoff;
  const prioColor = h.priority === 'critical' ? '#DC2626' : h.priority === 'watch' ? '#F59E0B' : '#22C55E';
  const tasks: PendingTask[] = (() => {
    try { return typeof h.pending_tasks === 'string' ? JSON.parse(h.pending_tasks) : (h.pending_tasks || []); }
    catch { return []; }
  })();

  return (
    <div style={{
      background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', marginBottom: 12,
      borderLeft: `4px solid ${prioColor}`, overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {entry.bed_label && `[${entry.bed_label}] `}{entry.patient_name}
          </span>
          <span style={{ color: '#6B7280', fontSize: 12, marginLeft: 8 }}>{entry.patient_uhid}</span>
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: `${prioColor}15`, color: prioColor }}>
          {h.priority}
        </span>
      </div>
      <div style={{ padding: 14 }}>
        {h.situation && <SbarField label="S — Situation" text={h.situation} />}
        {h.background && <SbarField label="B — Background" text={h.background} />}
        {h.assessment && <SbarField label="A — Assessment" text={h.assessment} />}
        {h.recommendation && <SbarField label="R — Recommendation" text={h.recommendation} />}
        {tasks.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Pending Tasks</div>
            {tasks.map((t, i) => (
              <div key={i} style={{ fontSize: 13, color: '#4B5563', paddingLeft: 12 }}>• {t.task}</div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>
          By {entry.nurse_name} &middot; {new Date(h.created_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function SbarField({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#4B5563', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}
