'use client';

import { useState, useEffect, useCallback } from 'react';
import { PatientIdentityStrip, AlertBanner, ConfirmModal, EmptyState, AssessmentForms } from '@/components/caregiver';

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

// ── Types ────────────────────────────────────────────────────────────────────
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

interface VitalsFormData {
  temperature: string;
  pulse: string;
  bp_systolic: string;
  bp_diastolic: string;
  spo2: string;
  rr: string;
  pain_score: string;
}

interface IOEntry {
  type: 'intake_iv' | 'intake_oral' | 'output_urine' | 'output_drain' | 'output_emesis';
  amount: string;
  notes: string;
}

interface NEWS2Result {
  total_score: number;
  risk_level: string;
  temperature_score: number;
  systolic_score: number;
  spo2_score: number;
  pulse_score: number;
  rr_score: number;
}

type BedsideTab = 'vitals' | 'io' | 'meds' | 'assess' | 'notes' | 'history';

// ── NEWS2 Client-Side Calculator ─────────────────────────────────────────────
function calcNEWS2(v: VitalsFormData): NEWS2Result {
  const temp = parseFloat(v.temperature) || 0;
  const sys = parseInt(v.bp_systolic) || 0;
  const spo2 = parseFloat(v.spo2) || 0;
  const pulse = parseInt(v.pulse) || 0;
  const rr = parseInt(v.rr) || 0;

  let ts = 0, ss = 0, o2 = 0, ps = 0, rs = 0;

  if (temp > 0) {
    if (temp <= 35.0) ts = 3;
    else if (temp <= 36.0) ts = 1;
    else if (temp <= 38.0) ts = 0;
    else if (temp <= 39.0) ts = 1;
    else ts = 2;
  }
  if (sys > 0) {
    if (sys <= 90) ss = 3;
    else if (sys <= 100) ss = 2;
    else if (sys <= 110) ss = 1;
    else if (sys <= 219) ss = 0;
    else ss = 3;
  }
  if (spo2 > 0) {
    if (spo2 <= 91) o2 = 3;
    else if (spo2 <= 93) o2 = 2;
    else if (spo2 <= 95) o2 = 1;
    else o2 = 0;
  }
  if (pulse > 0) {
    if (pulse <= 40) ps = 3;
    else if (pulse <= 50) ps = 1;
    else if (pulse <= 90) ps = 0;
    else if (pulse <= 110) ps = 1;
    else if (pulse <= 130) ps = 2;
    else ps = 3;
  }
  if (rr > 0) {
    if (rr <= 8) rs = 3;
    else if (rr <= 11) rs = 1;
    else if (rr <= 20) rs = 0;
    else if (rr <= 24) rs = 2;
    else rs = 3;
  }

  const total = ts + ss + o2 + ps + rs;
  const risk = total <= 4 ? 'low' : total <= 6 ? 'medium' : 'high';

  return {
    total_score: total,
    risk_level: risk,
    temperature_score: ts,
    systolic_score: ss,
    spo2_score: o2,
    pulse_score: ps,
    rr_score: rs,
  };
}

function news2Color(score: number): string {
  if (score >= 7) return '#DC2626'; // red
  if (score >= 5) return '#F59E0B'; // amber
  if (score >= 1) return '#22C55E'; // green
  return '#6B7280'; // gray
}

function news2Label(score: number): string {
  if (score >= 7) return 'HIGH — Escalate NOW';
  if (score >= 5) return 'MEDIUM — Flag & Monitor';
  if (score >= 1) return 'LOW — Routine';
  return 'No score';
}

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

function daysSince(d: string | null): number {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000) + 1;
}

const EMPTY_VITALS: VitalsFormData = {
  temperature: '', pulse: '', bp_systolic: '', bp_diastolic: '',
  spo2: '', rr: '', pain_score: '',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function BedsideClient({
  userId, userName, userRole, hospitalId,
}: {
  userId: string;
  userName: string;
  userRole: string;
  hospitalId: string;
}) {
  // State
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<BedsideTab>('vitals');
  const [vitals, setVitals] = useState<VitalsFormData>({ ...EMPTY_VITALS });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [recentVitals, setRecentVitals] = useState<any[]>([]);

  // I/O state
  const [ioEntry, setIOEntry] = useState<IOEntry>({ type: 'intake_iv', amount: '', notes: '' });
  const [ioSaving, setIOSaving] = useState(false);
  const [recentIO, setRecentIO] = useState<any[]>([]);

  // Vitals Round state
  const [roundMode, setRoundMode] = useState(false);
  const [roundCompleted, setRoundCompleted] = useState<Set<string>>(new Set());
  const [roundSkipped, setRoundSkipped] = useState<Set<string>>(new Set());
  const [showEndRound, setShowEndRound] = useState(false);

  const currentPatient = patients[currentIdx] || null;

  // Load patients
  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const shift = await trpcQuery('shifts.getCurrentShift');
      if (shift?.instance_id) {
        const data = await trpcQuery('patientAssignments.myPatients', {
          shift_instance_id: shift.instance_id,
        });
        setPatients(data || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  // Load recent vitals for current patient
  const loadRecentVitals = useCallback(async () => {
    if (!currentPatient) return;
    const data = await trpcQuery('observations.latestVitals', {
      patient_id: currentPatient.assignment.patient_id,
      encounter_id: currentPatient.assignment.encounter_id,
    });
    setRecentVitals(data || []);
  }, [currentPatient]);

  // Load recent I/O for current patient
  const loadRecentIO = useCallback(async () => {
    if (!currentPatient) return;
    const data = await trpcQuery('observations.ioBalance', {
      patient_id: currentPatient.assignment.patient_id,
      encounter_id: currentPatient.assignment.encounter_id,
    });
    setRecentIO(data ? [data] : []);
  }, [currentPatient]);

  useEffect(() => {
    loadRecentVitals();
    loadRecentIO();
    setVitals({ ...EMPTY_VITALS });
    setSaveSuccess(false);
    setSaveError('');
    // Auto-refresh vitals/IO every 30s
    const iv = setInterval(() => { loadRecentVitals(); loadRecentIO(); }, 30_000);
    return () => clearInterval(iv);
  }, [currentIdx, loadRecentVitals, loadRecentIO]);

  // ── Navigation ─────────────────────────────────────────────────────────
  const goNext = () => {
    if (currentIdx < patients.length - 1) setCurrentIdx(currentIdx + 1);
  };
  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  // ── Vitals save ────────────────────────────────────────────────────────
  const handleSaveVitals = async () => {
    if (!currentPatient) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const payload: any = {
        patient_id: currentPatient.assignment.patient_id,
        encounter_id: currentPatient.assignment.encounter_id,
        effective_datetime: new Date().toISOString(),
      };
      if (vitals.temperature) payload.temperature = parseFloat(vitals.temperature);
      if (vitals.pulse) payload.pulse = parseInt(vitals.pulse);
      if (vitals.bp_systolic) payload.bp_systolic = parseInt(vitals.bp_systolic);
      if (vitals.bp_diastolic) payload.bp_diastolic = parseInt(vitals.bp_diastolic);
      if (vitals.spo2) payload.spo2 = parseFloat(vitals.spo2);
      if (vitals.rr) payload.rr = parseInt(vitals.rr);
      if (vitals.pain_score) payload.pain_score = parseInt(vitals.pain_score);

      await trpcMutate('observations.createVitals', payload);
      setSaveSuccess(true);
      setVitals({ ...EMPTY_VITALS });
      await loadRecentVitals();

      // Vitals round: mark completed + auto-advance
      if (roundMode) {
        setRoundCompleted(prev => new Set([...prev, currentPatient.assignment.patient_id]));
        setTimeout(() => {
          if (currentIdx < patients.length - 1) {
            setCurrentIdx(currentIdx + 1);
          }
        }, 800);
      }
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save vitals');
    } finally {
      setSaving(false);
    }
  };

  // ── I/O save ───────────────────────────────────────────────────────────
  const handleSaveIO = async () => {
    if (!currentPatient || !ioEntry.amount) return;
    setIOSaving(true);
    try {
      await trpcMutate('observations.recordIO', {
        patient_id: currentPatient.assignment.patient_id,
        encounter_id: currentPatient.assignment.encounter_id,
        io_type: ioEntry.type,
        value: parseFloat(ioEntry.amount),
        notes: ioEntry.notes || undefined,
      });
      setIOEntry({ type: 'intake_iv', amount: '', notes: '' });
      await loadRecentIO();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save I/O');
    } finally {
      setIOSaving(false);
    }
  };

  // ── Round mode ─────────────────────────────────────────────────────────
  const startRound = () => {
    setRoundMode(true);
    setRoundCompleted(new Set());
    setRoundSkipped(new Set());
    setCurrentIdx(0);
    setActiveTab('vitals');
  };

  const skipPatient = () => {
    if (currentPatient) {
      setRoundSkipped(prev => new Set([...prev, currentPatient.assignment.patient_id]));
    }
    if (currentIdx < patients.length - 1) {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const endRound = () => {
    setRoundMode(false);
    setShowEndRound(false);
  };

  const roundProgress = patients.length > 0
    ? Math.round(((roundCompleted.size + roundSkipped.size) / patients.length) * 100)
    : 0;

  // ── NEWS2 live preview ─────────────────────────────────────────────────
  const hasAnyVital = Object.values(vitals).some(v => v !== '');
  const news2 = hasAnyVital ? calcNEWS2(vitals) : null;

  // ── Loading / empty states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="caregiver-theme min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--care-bg)' }}>
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <div className="caregiver-theme min-h-screen" style={{ backgroundColor: 'var(--care-bg)' }}>
        <div className="max-w-2xl mx-auto px-4 py-12">
          <EmptyState
            title="No Patients Assigned"
            message="You need patient assignments to use the bedside view."
            action={{ label: 'Back to Nurse Station', onClick: () => { window.location.href = '/care/nurse'; } }}
          />
        </div>
      </div>
    );
  }

  // ── Tabs config ────────────────────────────────────────────────────────
  const TABS: { key: BedsideTab; label: string; icon: string }[] = [
    { key: 'vitals', label: 'Vitals', icon: '💓' },
    { key: 'io', label: 'I/O', icon: '💧' },
    { key: 'meds', label: 'Meds', icon: '💊' },
    { key: 'assess', label: 'Assess', icon: '📋' },
    { key: 'notes', label: 'Notes', icon: '📝' },
    { key: 'history', label: 'History', icon: '📊' },
  ];

  return (
    <div className="caregiver-theme min-h-screen" style={{ backgroundColor: 'var(--care-bg)' }}>

      {/* ── Vitals Round Progress Bar ──────────────────────────────── */}
      {roundMode && (
        <div className="sticky top-12 z-30 px-4 py-2 border-b flex items-center gap-3"
          style={{ backgroundColor: '#EFF6FF', borderColor: 'var(--care-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--care-primary)' }}>
            Vitals Round
          </span>
          <div className="flex-1 h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${roundProgress}%`, backgroundColor: 'var(--care-primary)' }} />
          </div>
          <span className="text-xs font-medium" style={{ color: 'var(--care-text-secondary)' }}>
            {roundCompleted.size + roundSkipped.size}/{patients.length}
          </span>
          <button onClick={() => setShowEndRound(true)}
            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-medium hover:bg-red-200">
            End Round
          </button>
        </div>
      )}

      {/* ── Patient Identity Strip ────────────────────────────────── */}
      {currentPatient && (
        <PatientIdentityStrip
          patient={{
            name: currentPatient.patient_name,
            uhid: currentPatient.patient_uhid,
            age: calcAge(currentPatient.patient_dob),
            gender: currentPatient.patient_gender === 'male' ? 'M' : currentPatient.patient_gender === 'female' ? 'F' : 'O',
            bed: currentPatient.assignment.bed_label || '',
            ward: currentPatient.ward_name,
            admission_date: currentPatient.admission_at || undefined,
          }}
          onBack={() => { window.location.href = '/care/nurse'; }}
        />
      )}

      {/* ── Patient Navigation (◀ ▶ + patient indicator) ─────────── */}
      <div className="sticky z-20 border-b px-4 py-2 flex items-center justify-between gap-2"
        style={{
          top: roundMode ? '5.5rem' : '6.5rem',
          backgroundColor: 'var(--care-surface)',
          borderColor: 'var(--care-border)',
        }}>
        <button onClick={goPrev} disabled={currentIdx === 0}
          className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg disabled:opacity-30 touch-manipulation"
          style={{ borderColor: 'var(--care-border)' }}>
          ◀
        </button>
        <div className="flex items-center gap-2 overflow-x-auto">
          {patients.map((p, i) => {
            const isCompleted = roundCompleted.has(p.assignment.patient_id);
            const isSkipped = roundSkipped.has(p.assignment.patient_id);
            return (
              <button key={p.assignment.id} onClick={() => setCurrentIdx(i)}
                className={`min-w-[2.5rem] h-8 rounded-lg text-xs font-medium flex items-center justify-center px-2 transition-all touch-manipulation ${
                  i === currentIdx ? 'ring-2 ring-offset-1' : ''
                }`}
                style={{
                  backgroundColor: isCompleted ? '#DCFCE7' : isSkipped ? '#FEF3C7' : i === currentIdx ? 'var(--care-primary)' : 'var(--care-surface-hover)',
                  color: i === currentIdx && !isCompleted && !isSkipped ? 'white' : 'var(--care-text)',
                }}>
                {p.assignment.bed_label || `P${i + 1}`}
                {isCompleted && ' ✓'}
                {isSkipped && ' ⏭'}
              </button>
            );
          })}
        </div>
        <button onClick={goNext} disabled={currentIdx === patients.length - 1}
          className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg disabled:opacity-30 touch-manipulation"
          style={{ borderColor: 'var(--care-border)' }}>
          ▶
        </button>
      </div>

      {/* ── Tab Navigation ────────────────────────────────────────── */}
      <div className="border-b overflow-x-auto px-4" style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
        <div className="flex gap-1 min-w-max py-1">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors touch-manipulation ${
                activeTab === tab.key ? 'shadow-sm' : ''
              }`}
              style={{
                backgroundColor: activeTab === tab.key ? 'var(--care-primary)' : 'transparent',
                color: activeTab === tab.key ? 'white' : 'var(--care-text-secondary)',
              }}>
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Start Vitals Round Button ─────────────────────────────── */}
      {!roundMode && activeTab === 'vitals' && (
        <div className="px-4 pt-3">
          <button onClick={startRound}
            className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: 'var(--care-primary)' }}>
            Start Vitals Round ({patients.length} patients)
          </button>
        </div>
      )}

      {/* ── Tab Content ───────────────────────────────────────────── */}
      <div className="px-4 py-4 max-w-3xl mx-auto">

        {/* ═══ VITALS TAB ═══ */}
        {activeTab === 'vitals' && currentPatient && (
          <div className="space-y-4">
            {saveSuccess && (
              <AlertBanner variant="success" title="Vitals saved successfully" dismissible />
            )}
            {saveError && (
              <AlertBanner variant="critical" title={saveError} dismissible />
            )}

            {/* NEWS2 Live Preview */}
            {news2 && (
              <div className="rounded-xl p-4 border-2 transition-all"
                style={{
                  borderColor: news2Color(news2.total_score),
                  backgroundColor: news2.total_score >= 7 ? '#FEF2F2' : news2.total_score >= 5 ? '#FFFBEB' : '#F0FDF4',
                }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase" style={{ color: news2Color(news2.total_score) }}>
                      NEWS2 Score
                    </div>
                    <div className="text-3xl font-bold" style={{ color: news2Color(news2.total_score) }}>
                      {news2.total_score}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold ${news2.total_score >= 7 ? 'animate-pulse' : ''}`}
                      style={{ color: news2Color(news2.total_score) }}>
                      {news2Label(news2.total_score)}
                    </div>
                    <div className="flex gap-2 mt-1">
                      {[
                        { label: 'T', score: news2.temperature_score },
                        { label: 'BP', score: news2.systolic_score },
                        { label: 'O₂', score: news2.spo2_score },
                        { label: 'HR', score: news2.pulse_score },
                        { label: 'RR', score: news2.rr_score },
                      ].map(s => (
                        <div key={s.label} className="text-center">
                          <div className="text-[10px]" style={{ color: 'var(--care-text-muted)' }}>{s.label}</div>
                          <div className={`text-xs font-bold ${
                            s.score >= 3 ? 'text-red-600' : s.score >= 2 ? 'text-amber-600' : s.score >= 1 ? 'text-yellow-600' : 'text-green-600'
                          }`}>{s.score}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Vitals Form — 2-column grid on tablet, 1-column on phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Temperature */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  Temperature (°C)
                </label>
                <input type="number" step="0.1" min="30" max="45" inputMode="decimal"
                  value={vitals.temperature} onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                  placeholder="36.5"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              {/* Pulse */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  Pulse (bpm)
                </label>
                <input type="number" min="20" max="250" inputMode="numeric"
                  value={vitals.pulse} onChange={(e) => setVitals({ ...vitals, pulse: e.target.value })}
                  placeholder="72"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              {/* BP Systolic */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  BP Systolic (mmHg)
                </label>
                <input type="number" min="40" max="300" inputMode="numeric"
                  value={vitals.bp_systolic} onChange={(e) => setVitals({ ...vitals, bp_systolic: e.target.value })}
                  placeholder="120"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              {/* BP Diastolic */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  BP Diastolic (mmHg)
                </label>
                <input type="number" min="20" max="200" inputMode="numeric"
                  value={vitals.bp_diastolic} onChange={(e) => setVitals({ ...vitals, bp_diastolic: e.target.value })}
                  placeholder="80"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              {/* SpO2 */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  SpO₂ (%)
                </label>
                <input type="number" step="0.1" min="50" max="100" inputMode="decimal"
                  value={vitals.spo2} onChange={(e) => setVitals({ ...vitals, spo2: e.target.value })}
                  placeholder="98"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              {/* RR */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  Resp Rate (breaths/min)
                </label>
                <input type="number" min="4" max="60" inputMode="numeric"
                  value={vitals.rr} onChange={(e) => setVitals({ ...vitals, rr: e.target.value })}
                  placeholder="16"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              {/* Pain Score */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>
                  Pain Score (0–10)
                </label>
                <div className="flex gap-1.5">
                  {Array.from({ length: 11 }, (_, i) => (
                    <button key={i} onClick={() => setVitals({ ...vitals, pain_score: String(i) })}
                      className={`flex-1 h-10 rounded-lg text-sm font-bold transition-colors touch-manipulation ${
                        vitals.pain_score === String(i) ? 'text-white shadow-md' : ''
                      }`}
                      style={{
                        backgroundColor: vitals.pain_score === String(i)
                          ? (i <= 3 ? '#22C55E' : i <= 6 ? '#F59E0B' : '#DC2626')
                          : 'var(--care-surface-hover)',
                        color: vitals.pain_score === String(i) ? 'white' : 'var(--care-text)',
                      }}>
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <button onClick={handleSaveVitals} disabled={!hasAnyVital || saving}
              className={`w-full h-14 rounded-xl text-white font-bold text-lg transition-all touch-manipulation disabled:opacity-50 ${
                news2 && news2.total_score >= 7 ? 'animate-pulse' : ''
              }`}
              style={{
                backgroundColor: news2
                  ? (news2.total_score >= 7 ? '#DC2626' : news2.total_score >= 5 ? '#F59E0B' : 'var(--care-primary)')
                  : 'var(--care-primary)',
              }}>
              {saving ? 'Saving...' :
                news2 && news2.total_score >= 7 ? 'Save & Escalate NOW' :
                news2 && news2.total_score >= 5 ? 'Save & Flag' :
                'Save Vitals'}
            </button>

            {/* Round skip button */}
            {roundMode && (
              <button onClick={skipPatient}
                className="w-full py-2 text-sm font-medium rounded-lg border"
                style={{ borderColor: 'var(--care-border)', color: 'var(--care-text-secondary)' }}>
                Skip this patient ⏭
              </button>
            )}

            {/* Recent vitals */}
            {recentVitals.length > 0 && (
              <div className="mt-4 rounded-lg border p-3" style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
                <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--care-text-secondary)' }}>
                  Latest Vitals
                </h4>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-center">
                  {recentVitals.map((v: any, i: number) => (
                    <div key={i}>
                      <div className="text-[10px] uppercase" style={{ color: 'var(--care-text-muted)' }}>
                        {v.observation_type?.replace('vital_', '').replace('_', ' ')}
                      </div>
                      <div className="text-sm font-bold" style={{ color: 'var(--care-text)' }}>
                        {v.value_quantity} <span className="text-[10px] font-normal">{v.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ I/O TAB ═══ */}
        {activeTab === 'io' && currentPatient && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold" style={{ color: 'var(--care-text)' }}>
              Intake / Output
            </h3>

            {/* I/O entry form */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Type</label>
                <select value={ioEntry.type}
                  onChange={(e) => setIOEntry({ ...ioEntry, type: e.target.value as IOEntry['type'] })}
                  className="w-full h-12 rounded-lg border px-3 text-sm touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}>
                  <option value="intake_iv">IV Intake</option>
                  <option value="intake_oral">Oral Intake</option>
                  <option value="output_urine">Urine Output</option>
                  <option value="output_drain">Drain Output</option>
                  <option value="output_emesis">Emesis</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Amount (mL)</label>
                <input type="number" min="0" inputMode="numeric"
                  value={ioEntry.amount}
                  onChange={(e) => setIOEntry({ ...ioEntry, amount: e.target.value })}
                  placeholder="250"
                  className="w-full h-12 rounded-lg border px-3 text-lg font-medium touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white', color: 'var(--care-text)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--care-text-secondary)' }}>Notes</label>
                <input type="text" value={ioEntry.notes}
                  onChange={(e) => setIOEntry({ ...ioEntry, notes: e.target.value })}
                  placeholder="e.g. IV NS 500mL"
                  className="w-full h-12 rounded-lg border px-3 text-sm touch-manipulation"
                  style={{ borderColor: 'var(--care-border)', backgroundColor: 'white' }}
                />
              </div>
              <button onClick={handleSaveIO} disabled={!ioEntry.amount || ioSaving}
                className="w-full h-12 rounded-lg text-white font-semibold transition-colors disabled:opacity-50 touch-manipulation"
                style={{ backgroundColor: 'var(--care-primary)' }}>
                {ioSaving ? 'Saving...' : 'Record I/O'}
              </button>
            </div>

            {/* I/O balance summary */}
            {recentIO.length > 0 && recentIO[0] && (
              <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--care-surface)', borderColor: 'var(--care-border)' }}>
                <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--care-text-secondary)' }}>
                  24h Balance
                </h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: 'var(--care-text-muted)' }}>Intake</div>
                    <div className="text-lg font-bold text-blue-600">{recentIO[0].total_intake || 0} mL</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: 'var(--care-text-muted)' }}>Output</div>
                    <div className="text-lg font-bold text-amber-600">{recentIO[0].total_output || 0} mL</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: 'var(--care-text-muted)' }}>Net</div>
                    <div className={`text-lg font-bold ${
                      (recentIO[0].net_balance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {(recentIO[0].net_balance || 0) >= 0 ? '+' : ''}{recentIO[0].net_balance || 0} mL
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ MEDS TAB ═══ */}
        {activeTab === 'meds' && currentPatient && (
          <BedsideMeds
            encounterId={currentPatient.assignment.encounter_id}
            patientId={currentPatient.assignment.patient_id}
            patientName={currentPatient.patient_name}
          />
        )}

        {/* ═══ ASSESS TAB ═══ */}
        {activeTab === 'assess' && currentPatient && (
          <AssessmentForms
            patientId={currentPatient.assignment.patient_id}
            encounterId={currentPatient.assignment.encounter_id}
            assignmentId={currentPatient.assignment.id}
          />
        )}

        {/* ═══ NOTES TAB ═══ */}
        {activeTab === 'notes' && currentPatient && (
          <BedsideNotes
            patientId={currentPatient.assignment.patient_id}
            encounterId={currentPatient.assignment.encounter_id}
          />
        )}

        {/* ═══ HISTORY TAB (placeholder) ═══ */}
        {activeTab === 'history' && (
          <EmptyState title="Vitals History" message="Vitals trend charts will be available in NS.5." icon="📊" />
        )}
      </div>

      {/* ── End Round Confirm Modal ───────────────────────────────── */}
      {showEndRound && (
        <ConfirmModal
          open={showEndRound}
          title="End Vitals Round?"
          message={`${roundCompleted.size} completed, ${roundSkipped.size} skipped, ${patients.length - roundCompleted.size - roundSkipped.size} remaining.`}
          variant="warning"
          confirmLabel="End Round"
          onConfirm={endRound}
          onCancel={() => setShowEndRound(false)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BEDSIDE MEDS — inline eMAR for current patient
// ═══════════════════════════════════════════════════════════════════════════

const HOLD_REASONS = [
  'NPO / Nil by mouth', 'Lab values - awaiting result', 'Vital signs out of range',
  'Patient in procedure', 'Prescriber instruction', 'Pharmacy hold', 'Other',
];
const REFUSE_REASONS = [
  'Patient refused', 'Patient vomiting', 'Patient absent from ward',
  'Patient NPO', 'Patient sleeping (non-critical)', 'Other',
];

// ── Bedside Notes sub-component ─────────────────────────────────────────────
function BedsideNotes({ patientId, encounterId }: { patientId: string; encounterId: string }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await trpcQuery('clinicalNotes.list', { patient_id: patientId, encounter_id: encounterId });
      setNotes(Array.isArray(data) ? data.slice(0, 20) : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [patientId, encounterId]);

  useEffect(() => { load(); }, [load]);

  const saveNote = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      await trpcMutate('clinicalNotes.create', {
        patient_id: patientId,
        encounter_id: encounterId,
        note_type: 'nursing_note',
        content: newNote.trim(),
      });
      setNewNote('');
      await load();
    } catch (err) {
      alert('Failed to save note');
    } finally { setSaving(false); }
  };

  if (loading) return <p style={{ padding: 20, textAlign: 'center', color: '#888' }}>Loading notes…</p>;

  return (
    <div style={{ padding: 16 }}>
      {/* Quick add */}
      <div style={{ marginBottom: 16 }}>
        <textarea
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Add a nursing note…"
          rows={3}
          style={{
            width: '100%', padding: 10, fontSize: 14, borderRadius: 8,
            border: '1px solid #d0d0d0', resize: 'vertical', fontFamily: 'system-ui',
          }}
        />
        <button
          onClick={saveNote}
          disabled={saving || !newNote.trim()}
          style={{
            marginTop: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600,
            background: saving || !newNote.trim() ? '#ccc' : '#1565c0',
            color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Note'}
        </button>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <EmptyState title="No Notes Yet" message="Add the first nursing note for this patient." icon="📝" />
      ) : (
        notes.map((n: any, i: number) => (
          <div key={n.id || i} style={{
            background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
            padding: 12, marginBottom: 8,
          }}>
            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{n.content || n.text || ''}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              {n.author_name || 'Unknown'} · {n.created_at ? new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : ''}
              {n.note_type && <span style={{ marginLeft: 8, textTransform: 'capitalize' }}>{n.note_type.replace(/_/g, ' ')}</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function BedsideMeds({ encounterId, patientId, patientName }: { encounterId: string; patientId: string; patientName: string }) {
  const [schedule, setSchedule] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<{ type: 'give' | 'hold' | 'refuse'; med: any } | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const loadMeds = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const data = await trpcQuery('medicationOrders.emarSchedule', { encounter_id: encounterId, date: today });
    setSchedule(data || []);
    setLoading(false);
  }, [encounterId]);

  useEffect(() => { loadMeds(); }, [loadMeds]);

  const doAction = async () => {
    if (!actionTarget) return;
    setSaving(true);
    try {
      const { type, med } = actionTarget;
      if (type === 'give') {
        await trpcMutate('medicationOrders.emarRecord', {
          medication_request_id: med.request_id,
          encounter_id: encounterId,
          patient_id: patientId,
          scheduled_datetime: med.scheduled_datetime,
          dose_given: med.dose_quantity,
          dose_unit: med.dose_unit,
          route: med.route,
        });
      } else if (type === 'hold') {
        await trpcMutate('medicationOrders.emarHold', {
          medication_request_id: med.request_id,
          encounter_id: encounterId,
          patient_id: patientId,
          scheduled_datetime: med.scheduled_datetime,
          hold_reason: reason,
        });
      } else {
        await trpcMutate('medicationOrders.emarRefuse', {
          medication_request_id: med.request_id,
          encounter_id: encounterId,
          patient_id: patientId,
          scheduled_datetime: med.scheduled_datetime,
          not_done_reason: reason,
        });
      }
      setActionTarget(null);
      setReason('');
      await loadMeds();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 24, color: '#6B7280' }}>Loading medications...</div>;

  const allMeds = schedule.flatMap((s: any) => s.medications.map((m: any) => ({ ...m, _slot: s.time_slot })));
  if (allMeds.length === 0) {
    return <EmptyState title="No Medications" message={`No medications scheduled for ${patientName} today.`} icon="💊" />;
  }

  const isOverdue = (dt: string) => new Date(dt) < new Date();
  const fmtTime = (dt: string) => new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const stColor = (st: string, dt: string) =>
    st === 'completed' ? '#22C55E' : st === 'held' ? '#9CA3AF' : st === 'not_done' ? '#F97316'
    : (st === 'pending' && isOverdue(dt)) ? '#DC2626' : '#3B82F6';
  const stLabel = (st: string, dt: string) =>
    st === 'completed' ? 'Given' : st === 'held' ? 'Held' : st === 'not_done' ? 'Refused'
    : (st === 'pending' && isOverdue(dt)) ? 'Overdue' : 'Due';

  const reasons = actionTarget?.type === 'hold' ? HOLD_REASONS : REFUSE_REASONS;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, color: '#1E293B' }}>Today&apos;s Medications ({allMeds.length})</div>
        <a href="/care/nurse/emar" style={{ fontSize: 13, color: '#3B82F6', textDecoration: 'none' }}>Full eMAR →</a>
      </div>

      {schedule.map((slot: any) => (
        <div key={slot.time_slot} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', padding: '4px 0', borderBottom: '1px solid #E5E7EB' }}>
            ⏰ {slot.time_slot}
          </div>
          {slot.medications.map((med: any) => {
            const st = med.administration?.status || 'pending';
            const color = stColor(st, med.scheduled_datetime);
            const label = stLabel(st, med.scheduled_datetime);
            const actionable = st === 'pending';
            return (
              <div key={`${med.request_id}_${med.time_slot}`} style={{
                padding: '8px 0', borderBottom: '1px solid #F3F4F6',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderLeft: `3px solid ${color}`, paddingLeft: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{med.drug_name}</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>{med.dose_quantity} {med.dose_unit} &middot; {med.route}</div>
                </div>
                {!actionable ? (
                  <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: `${color}15`, color }}>{label}</span>
                ) : (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setActionTarget({ type: 'give', med })}
                      style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#22C55E', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', touchAction: 'manipulation' }}>Give</button>
                    <button onClick={() => { setActionTarget({ type: 'hold', med }); setReason(''); }}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 11, cursor: 'pointer', touchAction: 'manipulation' }}>Hold</button>
                    <button onClick={() => { setActionTarget({ type: 'refuse', med }); setReason(''); }}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 11, cursor: 'pointer', touchAction: 'manipulation' }}>Refuse</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Action modal */}
      {actionTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 400, width: '100%' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
              {actionTarget.type === 'give' ? '✅ Confirm Give' : actionTarget.type === 'hold' ? '⏸ Hold Medication' : '🚫 Record Refusal'}
            </h3>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{actionTarget.med.drug_name}</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>{actionTarget.med.dose_quantity} {actionTarget.med.dose_unit} &middot; {actionTarget.med.route} &middot; {fmtTime(actionTarget.med.scheduled_datetime)}</div>

            {actionTarget.type !== 'give' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {reasons.map(r => (
                  <button key={r} onClick={() => setReason(r)} style={{
                    padding: '8px 12px', borderRadius: 6, textAlign: 'left', cursor: 'pointer', fontSize: 13,
                    border: reason === r ? '2px solid #3B82F6' : '1px solid #D1D5DB',
                    background: reason === r ? '#EFF6FF' : '#fff', fontWeight: reason === r ? 600 : 400,
                  }}>{r}</button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setActionTarget(null)} style={{ flex: 1, height: 44, borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
              <button onClick={doAction} disabled={saving || (actionTarget.type !== 'give' && !reason)} style={{
                flex: 1, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, color: '#fff',
                background: actionTarget.type === 'give' ? '#22C55E' : actionTarget.type === 'hold' ? '#9CA3AF' : '#F97316',
                opacity: (saving || (actionTarget.type !== 'give' && !reason)) ? 0.5 : 1,
              }}>{saving ? 'Saving...' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
