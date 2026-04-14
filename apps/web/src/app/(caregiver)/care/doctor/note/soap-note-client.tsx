'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Quick-insert chips ──────────────────────────────────────────────────────
const S_CHIPS = ['Feels warm', 'Chills', 'No appetite', 'Pain ↑', 'Improving', 'Stable', 'Worsening', 'New issue', 'No new complaints'];
const A_CHIPS = ['Improving', 'Stable', 'Worsening', 'New issue', 'Awaiting labs', 'Awaiting imaging'];
const P_CHIPS = ['Stable, continue current plan', 'Increase monitoring to Q4H', 'Escalate to consultant', 'Plan discharge tomorrow', 'Send for CT scan'];

// ── Types ───────────────────────────────────────────────────────────────────
interface PatientBatch {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  patient_gender: string | null;
  patient_dob: string | null;
  bed_label: string | null;
  ward_name: string | null;
  chief_complaint: string | null;
  primary_diagnosis: string | null;
  news2_score: number;
  admission_datetime: string | null;
}

interface SoapDraft {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function SoapNoteClient({ userId, userRole, userName }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Mode: single (from URL params) or batch (post-rounds)
  const paramEncounter = searchParams.get('encounter');
  const paramPatient = searchParams.get('patient');

  const [mode, setMode] = useState<'single' | 'batch'>(paramEncounter ? 'single' : 'batch');
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientBatch[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, SoapDraft>>({});
  const [objectiveData, setObjectiveData] = useState<string>('');
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());

  // ── Load patient list ─────────────────────────────────────────────────
  const loadPatients = useCallback(async () => {
    try {
      if (mode === 'single' && paramEncounter && paramPatient) {
        // Load just one patient
        const pts = await trpcQuery('doctorDashboard.myPatients');
        const match = (pts || []).find((p: any) => p.encounter_id === paramEncounter);
        if (match) {
          setPatients([match]);
        } else {
          // Still show the page, just empty
          setPatients([]);
        }
      } else {
        // Batch: all my patients
        const pts = await trpcQuery('doctorDashboard.myPatients');
        setPatients(pts || []);
      }
    } catch (err) {
      console.error('Load patients error:', err);
    } finally {
      setLoading(false);
    }
  }, [mode, paramEncounter, paramPatient]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  // ── Auto-populate Objective when patient changes ──────────────────────
  const currentPatient = patients[currentIdx] || null;

  const loadObjective = useCallback(async () => {
    if (!currentPatient) return;
    setObjectiveLoading(true);
    try {
      const ctx = await trpcQuery('doctorDashboard.patientContext', {
        patient_id: currentPatient.patient_id,
        encounter_id: currentPatient.encounter_id,
      });
      if (!ctx) { setObjectiveData(''); return; }

      // Build auto-populated objective text
      const lines: string[] = [];

      // Vitals
      if (ctx.vitals?.length > 0) {
        const vitalMap: Record<string, string> = {};
        const vitalLabels: Record<string, string> = {
          vital_temperature: 'T', vital_pulse: 'HR', vital_bp_systolic: 'SBP',
          vital_bp_diastolic: 'DBP', vital_spo2: 'SpO2', vital_rr: 'RR',
        };
        ctx.vitals.forEach((v: any) => {
          const label = vitalLabels[v.observation_type] || v.observation_type;
          if (!vitalMap[label]) vitalMap[label] = `${v.value_quantity || v.value_text}${v.unit ? ' ' + v.unit : ''}`;
        });
        const ts = ctx.vitals[0]?.effective_datetime
          ? new Date(ctx.vitals[0].effective_datetime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          : '';
        lines.push(`Vitals (${ts}): ${Object.entries(vitalMap).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
      }

      // NEWS2
      if (currentPatient.news2_score > 0) {
        lines.push(`NEWS2: ${currentPatient.news2_score}.`);
      }

      // Labs
      const labResults = ctx.labs?.filter((l: any) => l.result_value) || [];
      if (labResults.length > 0) {
        const labStrs = labResults.slice(0, 6).map((l: any) => {
          let s = `${l.test_code || l.test_name}: ${l.result_value}${l.result_unit ? ' ' + l.result_unit : ''}`;
          if (l.is_abnormal) s += '↑';
          if (l.reference_range) s += ` (N: ${l.reference_range})`;
          return s;
        });
        lines.push(`Labs (today): ${labStrs.join(', ')}.`);
      }

      // I/O from handoff auto-populate (approximate)
      const ioData = await trpcQuery('shiftHandoffs.autoPopulate', {
        patient_id: currentPatient.patient_id,
        encounter_id: currentPatient.encounter_id,
        shift_instance_id: 'none', // Will return partial data
      }).catch(() => null);
      if (ioData && (ioData.io_intake > 0 || ioData.io_output > 0)) {
        lines.push(`I/O (24h): In ${ioData.io_intake} mL, Out ${ioData.io_output} mL, Balance ${ioData.io_intake - ioData.io_output >= 0 ? '+' : ''}${ioData.io_intake - ioData.io_output} mL.`);
      }

      setObjectiveData(lines.join('\n'));

      // Pre-populate draft objective if empty
      const eid = currentPatient.encounter_id;
      if (!drafts[eid]?.objective) {
        setDrafts(prev => ({
          ...prev,
          [eid]: { ...getDraft(eid, prev), objective: lines.join('\n') },
        }));
      }
    } catch { /* ignore */ }
    finally { setObjectiveLoading(false); }
  }, [currentPatient]);

  useEffect(() => { loadObjective(); }, [loadObjective]);

  // ── Draft management ──────────────────────────────────────────────────
  const getDraft = (eid: string, d?: Record<string, SoapDraft>): SoapDraft => {
    const src = d || drafts;
    return src[eid] || { subjective: '', objective: '', assessment: '', plan: '' };
  };

  const updateDraft = (field: keyof SoapDraft, value: string) => {
    if (!currentPatient) return;
    const eid = currentPatient.encounter_id;
    setDrafts(prev => ({
      ...prev,
      [eid]: { ...getDraft(eid, prev), [field]: value },
    }));
  };

  const insertChip = (field: keyof SoapDraft, chip: string) => {
    if (!currentPatient) return;
    const eid = currentPatient.encounter_id;
    const draft = getDraft(eid);
    const current = draft[field];
    const newVal = current ? `${current}\n${chip}.` : `${chip}.`;
    updateDraft(field, newVal);
  };

  // ── Save SOAP note ────────────────────────────────────────────────────
  const saveSoap = async () => {
    if (!currentPatient) return;
    const draft = getDraft(currentPatient.encounter_id);
    if (!draft.subjective.trim() && !draft.assessment.trim() && !draft.plan.trim()) {
      alert('Please fill in at least S, A, or P before saving.');
      return;
    }
    setSaving(true);
    try {
      await trpcMutate('clinicalNotes.createSoap', {
        patient_id: currentPatient.patient_id,
        encounter_id: currentPatient.encounter_id,
        subjective: draft.subjective.trim() || 'N/A',
        objective: draft.objective.trim() || 'N/A',
        assessment: draft.assessment.trim() || 'N/A',
        plan: draft.plan.trim() || 'N/A',
        required_signer_id: userId,
      });

      setSavedNotes(prev => new Set(prev).add(currentPatient.encounter_id));
    } catch (err) {
      alert('Failed to save SOAP note');
    } finally {
      setSaving(false);
    }
  };

  // ── Batch navigation ──────────────────────────────────────────────────
  const goNext = () => {
    if (currentIdx < patients.length - 1) setCurrentIdx(currentIdx + 1);
  };
  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading…</p></div>;
  }

  if (patients.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
        <EmptyState title="No Patients" message="No active patients to write notes for." icon="📝" />
        <button onClick={() => router.push('/care/doctor')} style={{ marginTop: 12, padding: '8px 20px', fontSize: 14, background: '#1565c0', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const draft = getDraft(currentPatient?.encounter_id || '');
  const isSaved = savedNotes.has(currentPatient?.encounter_id || '');

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* ── Header with batch navigation ─────────────────────────────── */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/care/doctor')}
            style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer' }}>← </button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              📝 {mode === 'batch' ? 'Post-Rounds Notes' : 'SOAP Note'}
            </h1>
            {mode === 'batch' && (
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
                Patient {currentIdx + 1} of {patients.length}
                {' · '}{savedNotes.size} saved
              </p>
            )}
          </div>
        </div>
        {mode === 'batch' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 3 }}>
              {patients.map((p, i) => (
                <div key={i} onClick={() => setCurrentIdx(i)} style={{
                  width: 10, height: 10, borderRadius: '50%', cursor: 'pointer',
                  background: savedNotes.has(p.encounter_id) ? '#4caf50' : i === currentIdx ? '#1565c0' : '#ddd',
                }} />
              ))}
            </div>
            <button onClick={goPrev} disabled={currentIdx === 0}
              style={{ padding: '4px 10px', fontSize: 13, background: currentIdx === 0 ? '#eee' : '#e3f2fd', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              ← Prev
            </button>
            <button onClick={goNext} disabled={currentIdx === patients.length - 1}
              style={{ padding: '4px 10px', fontSize: 13, background: currentIdx === patients.length - 1 ? '#eee' : '#e3f2fd', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Next →
            </button>
          </div>
        )}
      </header>

      {/* ── Patient identity ──────────────────────────────────────────── */}
      {currentPatient && (
        <div style={{
          background: isSaved ? '#e8f5e9' : '#f5f7ff', padding: '10px 20px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {currentPatient.bed_label && (
                <span style={{ fontSize: 12, fontWeight: 700, background: '#1565c0', color: '#fff', borderRadius: 4, padding: '2px 8px' }}>
                  {currentPatient.bed_label}
                </span>
              )}
              <span style={{ fontSize: 16, fontWeight: 700 }}>{currentPatient.patient_name}</span>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
              {currentPatient.patient_uhid} · {currentPatient.chief_complaint || currentPatient.primary_diagnosis || ''}
            </div>
          </div>
          {isSaved && (
            <span style={{ fontSize: 13, fontWeight: 600, color: '#2e7d32' }}>✅ Saved</span>
          )}
        </div>
      )}

      {/* ── SOAP Form ─────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px 120px', maxWidth: 900, margin: '0 auto' }}>

        {/* S — Subjective */}
        <SoapSection label="S" title="Subjective" color="#1565c0">
          <ChipRow chips={S_CHIPS} onInsert={(chip) => insertChip('subjective', chip)} />
          <textarea
            value={draft.subjective}
            onChange={e => updateDraft('subjective', e.target.value)}
            placeholder="Patient's complaints, symptoms, history…"
            rows={3}
            style={textareaStyle}
          />
        </SoapSection>

        {/* O — Objective (auto-populated) */}
        <SoapSection label="O" title="Objective" color="#2e7d32" badge={objectiveLoading ? 'Loading…' : 'Auto-populated'}>
          <textarea
            value={draft.objective}
            onChange={e => updateDraft('objective', e.target.value)}
            placeholder="Vitals, labs, I/O balance, exam findings…"
            rows={5}
            style={textareaStyle}
          />
          <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0' }}>
            Auto-populated from system data. Edit freely or add exam findings.
          </p>
        </SoapSection>

        {/* A — Assessment */}
        <SoapSection label="A" title="Assessment" color="#e65100">
          <ChipRow chips={A_CHIPS} onInsert={(chip) => insertChip('assessment', chip)} />
          <textarea
            value={draft.assessment}
            onChange={e => updateDraft('assessment', e.target.value)}
            placeholder="Diagnosis, clinical impression, interpretation…"
            rows={3}
            style={textareaStyle}
          />
        </SoapSection>

        {/* P — Plan */}
        <SoapSection label="P" title="Plan" color="#7b1fa2">
          <ChipRow chips={P_CHIPS} onInsert={(chip) => insertChip('plan', chip)} />
          <textarea
            value={draft.plan}
            onChange={e => updateDraft('plan', e.target.value)}
            placeholder="Treatment plan, orders, follow-up…"
            rows={3}
            style={textareaStyle}
          />
        </SoapSection>

        {/* Save + navigate */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={saveSoap}
            disabled={saving || isSaved}
            style={{
              flex: 1, padding: '12px 0', fontSize: 15, fontWeight: 700,
              background: isSaved ? '#a5d6a7' : saving ? '#ccc' : '#1565c0',
              color: '#fff', border: 'none', borderRadius: 10, cursor: isSaved ? 'default' : 'pointer',
            }}
          >
            {isSaved ? '✅ Note Saved' : saving ? 'Saving…' : '💾 Save SOAP Note'}
          </button>
          {mode === 'batch' && currentIdx < patients.length - 1 && (
            <button
              onClick={() => { if (!isSaved) saveSoap().then(goNext); else goNext(); }}
              style={{
                padding: '12px 24px', fontSize: 15, fontWeight: 700,
                background: '#7b1fa2', color: '#fff', border: 'none',
                borderRadius: 10, cursor: 'pointer',
              }}
            >
              {isSaved ? 'Next Patient →' : 'Save & Next →'}
            </button>
          )}
        </div>
      </div>

      {/* ── Bottom Tab Bar ──────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'home', label: 'Patients', icon: '🩺', href: '/care/doctor' },
          { key: 'rounds', label: 'Rounds', icon: '📋', href: '/care/doctor/rounds' },
          { key: 'notes', label: 'Notes', icon: '📝', href: '/care/doctor/note' },
          { key: 'cosign', label: 'Co-Sign', icon: '✍️', href: '/care/doctor/cosign' },
          { key: 'more', label: 'More', icon: '⋯', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'notes' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'notes' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function SoapSection({ label, title, color, badge, children }: {
  label: string; title: string; color: string; badge?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          display: 'inline-block', width: 28, height: 28, borderRadius: '50%',
          background: color, color: '#fff', textAlign: 'center', lineHeight: '28px',
          fontSize: 14, fontWeight: 700,
        }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{title}</span>
        {badge && <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>({badge})</span>}
      </div>
      {children}
    </div>
  );
}

function ChipRow({ chips, onInsert }: { chips: string[]; onInsert: (chip: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
      {chips.map(chip => (
        <button key={chip} onClick={() => onInsert(chip)} style={{
          padding: '3px 10px', fontSize: 11, background: '#f0f4ff', color: '#1565c0',
          border: '1px solid #bbdefb', borderRadius: 12, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}>{chip}</button>
      ))}
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: '100%', padding: 10, fontSize: 14, borderRadius: 8,
  border: '1px solid #d0d0d0', resize: 'vertical', fontFamily: 'system-ui',
  minHeight: 60,
};
