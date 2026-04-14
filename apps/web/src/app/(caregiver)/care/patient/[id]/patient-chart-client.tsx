'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertBanner } from '@/components/caregiver';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface PatientData {
  id: string;
  uhid: string;
  full_name: string;
  date_of_birth: string;
  sex: string;
  phone_number: string;
  primary_diagnosis: string;
}

interface EncounterData {
  id: string;
  patient_id: string;
  admission_date: string;
  assigned_bed: string;
  attending_physician_id: string;
  attending_physician_name: string;
}

interface VitalData {
  observation_type: string;
  value: number;
  unit: string;
  effective_datetime: string;
}

interface AllergyData {
  id: string;
  allergen: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
}

interface ConditionData {
  id: string;
  condition_name: string;
  status: string;
}

interface MedicationData {
  id: string;
  medication_name: string;
  dose: string;
  route: string;
  status: 'pending' | 'given' | 'overdue' | 'due' | 'discontinued';
  scheduled_time: string;
}

interface NoteData {
  id: string;
  note_type: string;
  content: string;
  created_at: string;
  created_by: string;
}

interface JourneyData {
  current_phase: string;
  completed_steps: number;
  total_steps: number;
  next_milestone: string;
}

type PatientTab = 'overview' | 'vitals' | 'labs' | 'orders' | 'notes' | 'plan';

interface Props {
  patientId: string;
  userId: string;
  userRole: string;
  userName: string;
  hospitalId: string;
}

// ── Role-specific tab config ────────────────────────────────────────────────
function getTabsForRole(role: string): { label: string; id: PatientTab; icon: string }[] {
  const nurseRoles = ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'];
  const doctorRoles = ['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon', 'anaesthetist'];
  const pharmacistRoles = ['pharmacist', 'senior_pharmacist', 'chief_pharmacist'];
  const labRoles = ['lab_technician', 'senior_lab_technician', 'lab_manager'];
  const billingRoles = ['billing_manager', 'billing_executive', 'insurance_coordinator'];

  if (nurseRoles.includes(role)) {
    return [
      { label: 'Overview', id: 'overview', icon: '📋' },
      { label: 'Vitals & I/O', id: 'vitals', icon: '📊' },
      { label: 'eMAR', id: 'notes', icon: '💊' },
      { label: 'Assessments', id: 'plan', icon: '✅' },
      { label: 'Notes', id: 'notes', icon: '📝' },
      { label: 'Tasks', id: 'orders', icon: '🎯' },
    ];
  }

  if (doctorRoles.includes(role)) {
    return [
      { label: 'Overview', id: 'overview', icon: '📋' },
      { label: 'Vitals', id: 'vitals', icon: '📊' },
      { label: 'Labs & Results', id: 'labs', icon: '🧪' },
      { label: 'Orders', id: 'orders', icon: '📋' },
      { label: 'Notes', id: 'notes', icon: '📝' },
      { label: 'Care Plan', id: 'plan', icon: '🗺️' },
    ];
  }

  if (pharmacistRoles.includes(role)) {
    return [
      { label: 'Overview', id: 'overview', icon: '📋' },
      { label: 'Medications & DDIs', id: 'orders', icon: '💊' },
      { label: 'Dispensing', id: 'vitals', icon: '📦' },
    ];
  }

  if (labRoles.includes(role)) {
    return [
      { label: 'Overview', id: 'overview', icon: '📋' },
      { label: 'Orders & Results', id: 'labs', icon: '🧪' },
    ];
  }

  if (billingRoles.includes(role)) {
    return [
      { label: 'Overview', id: 'overview', icon: '📋' },
      { label: 'Billing & Claims', id: 'orders', icon: '💳' },
    ];
  }

  // Default tabs
  return [
    { label: 'Overview', id: 'overview', icon: '📋' },
    { label: 'Vitals', id: 'vitals', icon: '📊' },
    { label: 'Labs', id: 'labs', icon: '🧪' },
    { label: 'Orders', id: 'orders', icon: '📋' },
    { label: 'Notes', id: 'notes', icon: '📝' },
    { label: 'Plan', id: 'plan', icon: '🗺️' },
  ];
}

// ── Floating action buttons for role ────────────────────────────────────────
function getActionButtonsForRole(role: string): { label: string; icon: string }[] {
  const nurseRoles = ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager'];
  const doctorRoles = ['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon'];

  if (nurseRoles.includes(role)) {
    return [
      { label: 'Record Vitals', icon: '📊' },
      { label: 'Give Medication', icon: '💊' },
      { label: 'Nursing Note', icon: '📝' },
      { label: 'Assessment', icon: '✅' },
    ];
  }

  if (doctorRoles.includes(role)) {
    return [
      { label: 'SOAP Note', icon: '📝' },
      { label: 'Prescribe Med', icon: '💊' },
      { label: 'Order Labs', icon: '🧪' },
      { label: 'Consult', icon: '👥' },
    ];
  }

  return [{ label: 'Add Note', icon: '📝' }];
}

// ── Sample timeline events (hardcoded for this sprint) ──────────────────────
function getSampleTimelineEvents(): { time: string; title: string; description: string; category: 'escalation' | 'medication' | 'note' | 'lab' | 'routine' }[] {
  return [
    {
      time: '08:45',
      title: 'NEWS2 Escalation',
      description: 'Score 8, SpO₂ dropping to 93%',
      category: 'escalation',
    },
    {
      time: '08:00',
      title: 'Medication Given',
      description: 'Metoprolol 25mg PO (Nurse Priya)',
      category: 'medication',
    },
    {
      time: '07:30',
      title: 'Progress Note',
      description: 'Dr. Sharma: reports reduced chest discomfort, vitals stable',
      category: 'note',
    },
    {
      time: '07:15',
      title: 'Lab Results',
      description: 'CBC + RFT: Hb 10.2↓, Cr 1.8↑, INR 2.8↑',
      category: 'lab',
    },
    {
      time: '06:00',
      title: 'Medication Given',
      description: 'Pantoprazole 40mg IV (Nurse Priya)',
      category: 'medication',
    },
    {
      time: '06:00',
      title: 'Shift Handoff',
      description: 'Night → Day (SBAR completed)',
      category: 'routine',
    },
    {
      time: '04:00',
      title: 'PRN Medication',
      description: 'Morphine 2mg IV for pain 7/10',
      category: 'medication',
    },
    {
      time: '02:00',
      title: 'Vitals Recorded',
      description: 'BP 138/82, HR 96, SpO₂ 93%, NEWS2=5',
      category: 'routine',
    },
  ];
}

// ── NEWS2 Score Calculation ─────────────────────────────────────────────────
function calculateNews2(vitals: {
  spo2?: number;
  pulse?: number;
  systolic_bp?: number;
  temperature?: number;
  rr?: number;
}): number {
  let score = 0;

  // SpO₂
  if (vitals.spo2 !== undefined) {
    if (vitals.spo2 <= 91) score += 3;
    else if (vitals.spo2 <= 93) score += 2;
    else if (vitals.spo2 <= 94) score += 1;
  }

  // Pulse
  if (vitals.pulse !== undefined) {
    if (vitals.pulse <= 40 || vitals.pulse >= 131) score += 3;
    else if (vitals.pulse <= 50 || vitals.pulse >= 111) score += 1;
  }

  // Systolic BP
  if (vitals.systolic_bp !== undefined) {
    if (vitals.systolic_bp <= 90 || vitals.systolic_bp >= 220) score += 3;
    else if (vitals.systolic_bp <= 100 || vitals.systolic_bp >= 180) score += 1;
  }

  // Temperature
  if (vitals.temperature !== undefined) {
    if (vitals.temperature <= 35.0) score += 3;
    else if (vitals.temperature <= 36.0) score += 1;
    else if (vitals.temperature >= 39.1) score += 1;
  }

  // Respiratory Rate
  if (vitals.rr !== undefined) {
    if (vitals.rr <= 8 || vitals.rr >= 25) score += 3;
    else if (vitals.rr <= 11 || vitals.rr >= 21) score += 1;
  }

  return score;
}

// ── Utility functions ───────────────────────────────────────────────────────
function calculateAge(dobString: string): number {
  const dob = new Date(dobString);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN');
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const mins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getVitalColor(type: string, value: number): string {
  if (type === 'vital_spo2') {
    if (value < 92) return '#DC2626'; // red
    if (value < 95) return '#D97706'; // amber
    return '#0B8A3E'; // green
  }
  if (type === 'vital_pulse') {
    if (value > 120 || value < 50) return '#DC2626';
    if (value > 100 || value < 60) return '#D97706';
    return '#0B8A3E';
  }
  if (type === 'vital_bp_systolic') {
    if (value > 180 || value < 90) return '#DC2626';
    if (value > 160 || value < 100) return '#D97706';
    return '#0B8A3E';
  }
  return '#0B8A3E';
}

function getVitalUnit(type: string): string {
  const units: Record<string, string> = {
    vital_temperature: '°C',
    vital_pulse: 'bpm',
    vital_bp_systolic: 'mmHg',
    vital_bp_diastolic: 'mmHg',
    vital_spo2: '%',
    vital_rr: '/min',
    vital_pain_score: '/10',
    vital_weight: 'kg',
    vital_height: 'cm',
    vital_bmi: 'kg/m²',
  };
  return units[type] || '';
}

function getVitalLabel(type: string): string {
  const labels: Record<string, string> = {
    vital_temperature: 'Temp',
    vital_pulse: 'HR',
    vital_bp_systolic: 'SysBP',
    vital_bp_diastolic: 'DiaBP',
    vital_spo2: 'SpO₂',
    vital_rr: 'RR',
    vital_pain_score: 'Pain',
    vital_weight: 'Wt',
    vital_height: 'Ht',
    vital_bmi: 'BMI',
  };
  return labels[type] || type;
}

// ── Main component ──────────────────────────────────────────────────────────
export default function PatientChartClient({ patientId, userId, userRole, userName, hospitalId }: Props) {
  const [activeTab, setActiveTab] = useState<PatientTab>('overview');
  const [loading, setLoading] = useState(true);

  const [patient, setPatient] = useState<PatientData | null>(null);
  const [encounter, setEncounter] = useState<EncounterData | null>(null);
  const [vitals, setVitals] = useState<VitalData[]>([]);
  const [allergies, setAllergies] = useState<AllergyData[]>([]);
  const [conditions, setConditions] = useState<ConditionData[]>([]);
  const [medications, setMedications] = useState<MedicationData[]>([]);
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [news2Score, setNews2Score] = useState<number | null>(null);
  const [news2RiskLevel, setNews2RiskLevel] = useState<'low' | 'medium' | 'high' | null>(null);

  const tabs = getTabsForRole(userRole);
  const actionButtons = getActionButtonsForRole(userRole);

  // ── Load all data in parallel ────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [patientData, encounterData, vitalsData, allergiesData, conditionsData, medsData, notesData, journeyData] = await Promise.all([
        trpcQuery('patient.get', { id: patientId }),
        trpcQuery('encounter.getActive', { patient_id: patientId }),
        trpcQuery('observations.latestVitals', { patient_id: patientId }),
        trpcQuery('allergies.list', { patient_id: patientId }),
        trpcQuery('conditions.list', { patient_id: patientId }),
        trpcQuery('medicationOrders.emarSchedule', { patient_id: patientId }),
        trpcQuery('clinicalNotes.listNotes', { patient_id: patientId, limit: 5 }),
        trpcQuery('journeyEngine.getPatientJourney', { patient_id: patientId }),
      ]);

      setPatient(patientData || null);
      setEncounter(encounterData || null);
      setVitals(Array.isArray(vitalsData) ? vitalsData : (vitalsData?.vitals || []));
      setAllergies(Array.isArray(allergiesData) ? allergiesData : (allergiesData?.items || []));
      setConditions(Array.isArray(conditionsData) ? conditionsData : (conditionsData?.items || []));
      setMedications(Array.isArray(medsData) ? medsData : (medsData?.medications || []));
      setNotes(Array.isArray(notesData) ? notesData : (notesData?.items || []));
      setJourney(journeyData || null);

      // Calculate NEWS2 from vitals
      if (vitalsData && Array.isArray(vitalsData)) {
        const vitalMap: Record<string, number> = {};
        vitalsData.forEach((v: VitalData) => {
          if (v.observation_type === 'vital_temperature') vitalMap.temperature = v.value;
          if (v.observation_type === 'vital_pulse') vitalMap.pulse = v.value;
          if (v.observation_type === 'vital_bp_systolic') vitalMap.systolic_bp = v.value;
          if (v.observation_type === 'vital_spo2') vitalMap.spo2 = v.value;
          if (v.observation_type === 'vital_rr') vitalMap.rr = v.value;
        });

        // Simple NEWS2 calc
        let score = 0;
        if (vitalMap.spo2 !== undefined && vitalMap.spo2 < 92) score += 3;
        else if (vitalMap.spo2 !== undefined && vitalMap.spo2 < 95) score += 1;
        if (vitalMap.pulse !== undefined && (vitalMap.pulse > 120 || vitalMap.pulse < 40)) score += 3;
        else if (vitalMap.pulse !== undefined && (vitalMap.pulse > 110 || vitalMap.pulse < 50)) score += 1;
        if (vitalMap.systolic_bp !== undefined && (vitalMap.systolic_bp > 220 || vitalMap.systolic_bp < 90)) score += 3;

        let risk: 'low' | 'medium' | 'high' = 'low';
        if (score >= 7) risk = 'high';
        else if (score >= 3) risk = 'medium';

        setNews2Score(score);
        setNews2RiskLevel(risk);
      }
    } catch (err) {
      console.error('Patient chart load error:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Event handlers ───────────────────────────────────────────────────────
  const handleActionClick = (label: string) => {
    // Placeholder for future action panels
    console.log('Action clicked:', label);
  };

  // ── Render: Loading state ───────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
        <p style={{ color: '#666' }}>Loading patient chart…</p>
      </div>
    );
  }

  if (!patient) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
        <p style={{ color: '#999' }}>Patient not found</p>
      </div>
    );
  }

  const age = calculateAge(patient.date_of_birth);
  const daysSinceAdmission = encounter ? Math.floor((Date.now() - new Date(encounter.admission_date).getTime()) / (1000 * 60 * 60 * 24)) : 0;

  // Organise vitals by type for display
  const latestVitalsMap: Record<string, VitalData | null> = {};
  vitals.forEach((v) => {
    if (!latestVitalsMap[v.observation_type]) {
      latestVitalsMap[v.observation_type] = v;
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh', paddingBottom: 80 }}>
      {/* ── Header: Row 1 - Patient Identity ────────────────────────────────── */}
      <header style={{
        background: '#002054',
        color: 'white',
        padding: '12px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          {/* Avatar */}
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#0055FF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 700,
            fontSize: 18,
            flexShrink: 0,
          }}>
            {patient.full_name.charAt(0).toUpperCase()}
          </div>

          {/* Patient info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {patient.full_name}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, margin: '2px 0 0' }}>
              UHID: {patient.uhid} · {age}y {patient.sex.toUpperCase()} · {patient.primary_diagnosis}
            </div>
          </div>
        </div>

        {/* Bed badge */}
        {encounter && (
          <div style={{
            background: 'white',
            color: '#002054',
            padding: '6px 12px',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}>
            Bed {encounter.assigned_bed}
          </div>
        )}

        {/* Day counter badge */}
        {encounter && (
          <div style={{
            background: '#D97706',
            color: 'white',
            padding: '6px 12px',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}>
            Day {daysSinceAdmission + 1}
          </div>
        )}

        {/* Attending doctor */}
        {encounter && (
          <div style={{ fontSize: 12, opacity: 0.8, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{encounter.attending_physician_name || 'Unassigned'}</div>
            <div style={{ opacity: 0.7 }}>Attending</div>
          </div>
        )}
      </header>

      {/* ── Header: Row 2 - Acuity + Journey ────────────────────────────────── */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e0e0e0',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
      }}>
        {/* NEWS2 Badge */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
        }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: news2RiskLevel === 'high' ? '#DC2626' : news2RiskLevel === 'medium' ? '#D97706' : '#0B8A3E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 700,
            fontSize: 28,
          }}>
            {news2Score || '—'}
          </div>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: news2RiskLevel === 'high' ? '#DC2626' : news2RiskLevel === 'medium' ? '#D97706' : '#0B8A3E',
            textTransform: 'uppercase',
          }}>
            {news2RiskLevel === 'high' ? 'HIGH RISK' : news2RiskLevel === 'medium' ? 'MEDIUM' : 'LOW RISK'}
          </div>
        </div>

        {/* Journey Strip */}
        {journey && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            {['Start', 'Admission', 'Assessment', 'Treatment', 'Progress', 'Stabilize', 'Discharge Plan', 'Ready', 'Discharge'].map((phase, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: idx < journey.completed_steps ? '#0B8A3E' : idx === journey.completed_steps ? '#0055FF' : '#e0e0e0',
                  border: idx === journey.completed_steps ? '2px solid #0055FF' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 12,
                  animation: idx === journey.completed_steps ? 'pulse 2s infinite' : 'none',
                }}>
                  {idx < journey.completed_steps ? '✓' : idx + 1}
                </div>
                <div style={{ fontSize: 10, textAlign: 'center', maxWidth: 40, color: '#666', lineHeight: 1.2 }}>
                  {phase.split(' ').length > 1 ? phase.split(' ')[0] : phase}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Alert Banner: Allergies (only if allergies exist) ────────────────── */}
      {allergies.length > 0 && (
        <div style={{ padding: '0 24px', paddingTop: 16 }}>
          <AlertBanner
            variant="critical"
            title="Known Allergies"
            message={allergies.map(a => `${a.allergen} (${a.severity}): ${a.reaction}`).join(' · ')}
            dismissible={false}
          />
        </div>
      )}

      {/* ── Tab Bar ───────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e0e0e0',
        padding: '0 24px',
        display: 'flex',
        gap: 24,
        overflowX: 'auto',
        marginTop: 16,
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 0',
              fontSize: 14,
              fontWeight: activeTab === tab.id ? 600 : 500,
              color: activeTab === tab.id ? '#0055FF' : '#666',
              borderBottom: activeTab === tab.id ? '2px solid #0055FF' : 'none',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab Content ──────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{
          padding: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 24,
        }}>
          {/* LEFT COLUMN: Vitals */}
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>Latest Vitals</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {Object.entries(latestVitalsMap).slice(0, 6).map(([type, vital]) => vital && (
                <div key={type} style={{
                  padding: 12,
                  borderRadius: 8,
                  background: getVitalColor(type, vital.value) + '12',
                  borderLeft: `4px solid ${getVitalColor(type, vital.value)}`,
                }}>
                  <div style={{
                    fontSize: 20,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: getVitalColor(type, vital.value),
                  }}>
                    {vital.value}{getVitalUnit(type)}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    {getVitalLabel(type)}
                  </div>
                  <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                    {timeAgo(vital.effective_datetime)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CENTER COLUMN: Timeline */}
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            gridColumn: 'span 1',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>What's Happening</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {getSampleTimelineEvents().map((event, idx) => {
                const colorMap: Record<string, string> = {
                  escalation: '#DC2626',
                  medication: '#0B8A3E',
                  note: '#0055FF',
                  lab: '#D97706',
                  routine: '#999',
                };
                return (
                  <div key={idx} style={{
                    display: 'flex',
                    gap: 12,
                    paddingLeft: 12,
                    borderLeft: `3px solid ${colorMap[event.category]}`,
                  }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#666', minWidth: 36 }}>
                        {event.time}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#002054' }}>
                        {event.title}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        {event.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT COLUMN: Tasks, Journey, Care Team */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* My Tasks */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', color: '#666' }}>My Tasks</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {medications.filter(m => m.status === 'overdue' || m.status === 'due').slice(0, 3).map((med) => (
                  <div key={med.id} style={{
                    padding: 10,
                    background: med.status === 'overdue' ? '#FEE2E2' : '#FEF3C7',
                    borderRadius: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{med.medication_name}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>{med.dose} {med.route}</div>
                    </div>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: med.status === 'overdue' ? '#DC2626' : '#D97706',
                      color: 'white',
                    }}>
                      {med.status === 'overdue' ? '🔴 OVERDUE' : '⏰ DUE'}
                    </div>
                  </div>
                ))}
              </div>
              <button style={{
                marginTop: 12,
                fontSize: 12,
                color: '#0055FF',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
              }}>
                View all medications →
              </button>
            </div>

            {/* Journey Status */}
            {journey && (
              <div style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', color: '#666' }}>Journey Status</h3>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#002054', marginBottom: 8 }}>
                  {journey.current_phase}
                </div>
                <div style={{
                  height: 8,
                  background: '#e0e0e0',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    background: '#0055FF',
                    width: `${(journey.completed_steps / journey.total_steps) * 100}%`,
                    transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{
                  fontSize: 11,
                  color: '#666',
                  marginTop: 8,
                  textAlign: 'center',
                }}>
                  {journey.completed_steps} of {journey.total_steps} steps
                </div>
                <div style={{ fontSize: 12, color: '#0055FF', fontWeight: 600, marginTop: 8 }}>
                  Next: {journey.next_milestone}
                </div>
              </div>
            )}

            {/* Care Team */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', color: '#666' }}>Care Team</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {encounter && (
                  <div style={{ paddingBottom: 10, borderBottom: '1px solid #e0e0e0' }}>
                    <div style={{ fontSize: 11, color: '#666' }}>Attending Doctor</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                      {encounter.attending_physician_name || 'Unassigned'}
                    </div>
                  </div>
                )}
                <div style={{ paddingBottom: 10, borderBottom: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: 11, color: '#666' }}>Logged in As</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                    {userName}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Vitals & I/O Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'vitals' && (
        <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh' }}>
          {/* SECTION 1: Nurse Quick-Entry Bar (for nursing roles only) */}
          {['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'].includes(userRole) && (
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              marginBottom: 24,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
                Quick Vitals Entry
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))',
                gap: 12,
                marginBottom: 16,
              }}>
                {/* BP Systolic */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>BP (Sys)</label>
                  <input
                    type="number"
                    placeholder="120"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* BP Diastolic */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>BP (Dias)</label>
                  <input
                    type="number"
                    placeholder="80"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Heart Rate */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>HR</label>
                  <input
                    type="number"
                    placeholder="80"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* SpO2 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>SpO₂ %</label>
                  <input
                    type="number"
                    placeholder="97"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Temperature */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>Temp °C</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="37"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* RR */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>RR</label>
                  <input
                    type="number"
                    placeholder="16"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Pain */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>Pain</label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    placeholder="2"
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* AVPU */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>AVPU</label>
                  <select
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '8px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                      background: 'white',
                    }}
                  >
                    <option value="">Select</option>
                    <option value="alert">Alert</option>
                    <option value="voice">Voice</option>
                    <option value="pain">Pain</option>
                    <option value="unresponsive">Unresponsive</option>
                  </select>
                </div>

                {/* O2 Supplement Checkbox */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    id="supplementalO2"
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <label htmlFor="supplementalO2" style={{ fontSize: 11, fontWeight: 600, color: '#666', cursor: 'pointer' }}>
                    Supplemental O₂
                  </label>
                </div>
              </div>

              {/* Save Button */}
              <button
                style={{
                  padding: '12px 24px',
                  background: '#0055FF',
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#003DBF')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#0055FF')}
              >
                Save Vitals
              </button>
            </div>
          )}

          {/* SECTION 2: Vitals Trend Charts (2x2 Grid) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
            gap: 24,
            marginBottom: 24,
          }}>
            {/* Chart 1: SpO₂ + Heart Rate */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', color: '#002054' }}>
                SpO₂ & Heart Rate Trend
              </h3>
              <svg style={{ width: '100%', height: 180, marginBottom: 8 }} viewBox="0 0 500 180">
                {/* Grid background */}
                <defs>
                  <pattern id="grid" width="40" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="500" height="180" fill="url(#grid)" />

                {/* Reference bands */}
                {/* SpO₂ green band (94-100%, left axis) */}
                <rect x="40" y="20" width="440" height="56" fill="#0B8A3E" opacity="0.08" />
                {/* HR green band (60-100, right axis) */}
                <rect x="40" y="80" width="440" height="44" fill="#0055FF" opacity="0.08" />

                {/* Y-axis labels */}
                <text x="15" y="30" fontSize="10" fill="#666" textAnchor="end">100%</text>
                <text x="15" y="80" fontSize="10" fill="#666" textAnchor="end">95%</text>
                <text x="15" y="130" fontSize="10" fill="#666" textAnchor="end">90%</text>
                <text x="15" y="170" fontSize="10" fill="#666" textAnchor="end">85%</text>

                {/* HR scale (right axis) */}
                <text x="485" y="30" fontSize="10" fill="#666" textAnchor="start">120</text>
                <text x="485" y="80" fontSize="10" fill="#666" textAnchor="start">100</text>
                <text x="485" y="130" fontSize="10" fill="#666" textAnchor="start">80</text>
                <text x="485" y="170" fontSize="10" fill="#666" textAnchor="start">60</text>

                {/* SpO₂ line and points (97, 96, 96, 95, 94, 93, 91, 89) */}
                <polyline points="70,25 110,35 150,35 190,45 230,55 270,65 310,85 350,105" fill="none" stroke="#0B8A3E" strokeWidth="2" />
                <circle cx="70" cy="25" r="4" fill="#0B8A3E" />
                <circle cx="110" cy="35" r="4" fill="#0B8A3E" />
                <circle cx="150" cy="35" r="4" fill="#0B8A3E" />
                <circle cx="190" cy="45" r="4" fill="#0B8A3E" />
                <circle cx="230" cy="55" r="4" fill="#0B8A3E" />
                <circle cx="270" cy="65" r="4" fill="#0B8A3E" />
                <circle cx="310" cy="85" r="6" fill="#D97706" />
                <circle cx="350" cy="105" r="6" fill="#DC2626" />

                {/* HR line and points (80, 84, 86, 88, 92, 96, 102, 108) */}
                <polyline points="70,116 110,102 150,96 190,90 230,76 270,62 310,38 350,20" fill="none" stroke="#0055FF" strokeWidth="2" />
                <circle cx="70" cy="116" r="4" fill="#0055FF" />
                <circle cx="110" cy="102" r="4" fill="#0055FF" />
                <circle cx="150" cy="96" r="4" fill="#0055FF" />
                <circle cx="190" cy="90" r="4" fill="#0055FF" />
                <circle cx="230" cy="76" r="4" fill="#0055FF" />
                <circle cx="270" cy="62" r="4" fill="#0055FF" />
                <circle cx="310" cy="38" r="6" fill="#D97706" />
                <circle cx="350" cy="20" r="6" fill="#DC2626" />

                {/* X-axis labels (time) */}
                <text x="70" y="175" fontSize="10" fill="#666" textAnchor="middle">12-4pm</text>
                <text x="190" y="175" fontSize="10" fill="#666" textAnchor="middle">12-10pm</text>
                <text x="310" y="175" fontSize="10" fill="#666" textAnchor="middle">1-6am</text>
                <text x="430" y="175" fontSize="10" fill="#666" textAnchor="middle">8am</text>
              </svg>
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0B8A3E', borderRadius: 2 }} />
                  <span>SpO₂ (%)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0055FF', borderRadius: 2 }} />
                  <span>HR (bpm)</span>
                </div>
              </div>
            </div>

            {/* Chart 2: Blood Pressure */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', color: '#002054' }}>
                Blood Pressure Trend
              </h3>
              <svg style={{ width: '100%', height: 180, marginBottom: 8 }} viewBox="0 0 500 180">
                {/* Grid background */}
                <rect width="500" height="180" fill="url(#grid)" />

                {/* Reference bands */}
                {/* Systolic green band (90-140) */}
                <rect x="40" y="25" width="440" height="88" fill="#0B8A3E" opacity="0.08" />
                {/* Diastolic green band (60-90) */}
                <rect x="40" y="80" width="440" height="48" fill="#0055FF" opacity="0.08" />

                {/* Y-axis labels */}
                <text x="15" y="30" fontSize="10" fill="#666" textAnchor="end">150</text>
                <text x="15" y="80" fontSize="10" fill="#666" textAnchor="end">120</text>
                <text x="15" y="130" fontSize="10" fill="#666" textAnchor="end">90</text>
                <text x="15" y="170" fontSize="10" fill="#666" textAnchor="end">60</text>

                {/* Systolic line (125, 128, 130, 132, 135, 138, 140, 142) */}
                <polyline points="70,66 110,60 150,54 190,48 230,40 270,32 310,25 350,21" fill="none" stroke="#0B8A3E" strokeWidth="2" />
                <circle cx="70" cy="66" r="4" fill="#0B8A3E" />
                <circle cx="110" cy="60" r="4" fill="#0B8A3E" />
                <circle cx="150" cy="54" r="4" fill="#0B8A3E" />
                <circle cx="190" cy="48" r="4" fill="#0B8A3E" />
                <circle cx="230" cy="40" r="4" fill="#0B8A3E" />
                <circle cx="270" cy="32" r="4" fill="#0B8A3E" />
                <circle cx="310" cy="25" r="6" fill="#D97706" />
                <circle cx="350" cy="21" r="6" fill="#DC2626" />

                {/* Diastolic line (72, 74, 76, 78, 80, 82, 85, 88) */}
                <polyline points="70,104 110,96 150,88 190,80 230,72 270,64 310,48 350,32" fill="none" stroke="#0055FF" strokeWidth="2" />
                <circle cx="70" cy="104" r="4" fill="#0055FF" />
                <circle cx="110" cy="96" r="4" fill="#0055FF" />
                <circle cx="150" cy="88" r="4" fill="#0055FF" />
                <circle cx="190" cy="80" r="4" fill="#0055FF" />
                <circle cx="230" cy="72" r="4" fill="#0055FF" />
                <circle cx="270" cy="64" r="4" fill="#0055FF" />
                <circle cx="310" cy="48" r="6" fill="#D97706" />
                <circle cx="350" cy="32" r="6" fill="#DC2626" />

                {/* X-axis labels */}
                <text x="70" y="175" fontSize="10" fill="#666" textAnchor="middle">12-4pm</text>
                <text x="190" y="175" fontSize="10" fill="#666" textAnchor="middle">12-10pm</text>
                <text x="310" y="175" fontSize="10" fill="#666" textAnchor="middle">1-6am</text>
                <text x="430" y="175" fontSize="10" fill="#666" textAnchor="middle">8am</text>
              </svg>
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0B8A3E', borderRadius: 2 }} />
                  <span>Systolic (mmHg)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0055FF', borderRadius: 2 }} />
                  <span>Diastolic (mmHg)</span>
                </div>
              </div>
            </div>

            {/* Chart 3: Temperature + Respiratory Rate */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', color: '#002054' }}>
                Temperature & RR Trend
              </h3>
              <svg style={{ width: '100%', height: 180, marginBottom: 8 }} viewBox="0 0 500 180">
                {/* Grid background */}
                <rect width="500" height="180" fill="url(#grid)" />

                {/* Reference bands */}
                {/* Temp green band (36.1-37.5) */}
                <rect x="40" y="40" width="440" height="44" fill="#0B8A3E" opacity="0.08" />
                {/* RR green band (12-20) */}
                <rect x="40" y="76" width="440" height="40" fill="#0055FF" opacity="0.08" />

                {/* Y-axis labels (Temp) */}
                <text x="15" y="30" fontSize="10" fill="#666" textAnchor="end">39°C</text>
                <text x="15" y="80" fontSize="10" fill="#666" textAnchor="end">37°C</text>
                <text x="15" y="130" fontSize="10" fill="#666" textAnchor="end">35°C</text>
                <text x="15" y="170" fontSize="10" fill="#666" textAnchor="end">33°C</text>

                {/* RR scale (right axis) */}
                <text x="485" y="30" fontSize="10" fill="#666" textAnchor="start">26</text>
                <text x="485" y="80" fontSize="10" fill="#666" textAnchor="start">18</text>
                <text x="485" y="130" fontSize="10" fill="#666" textAnchor="start">10</text>

                {/* Temperature line (36.8, 36.9, 36.8, 37.0, 37.2, 37.4, 37.6, 37.8) */}
                <polyline points="70,65 110,61 150,65 190,57 230,49 270,41 310,33 350,25" fill="none" stroke="#0B8A3E" strokeWidth="2" />
                <circle cx="70" cy="65" r="4" fill="#0B8A3E" />
                <circle cx="110" cy="61" r="4" fill="#0B8A3E" />
                <circle cx="150" cy="65" r="4" fill="#0B8A3E" />
                <circle cx="190" cy="57" r="4" fill="#0B8A3E" />
                <circle cx="230" cy="49" r="4" fill="#0B8A3E" />
                <circle cx="270" cy="41" r="4" fill="#D97706" />
                <circle cx="310" cy="33" r="6" fill="#D97706" />
                <circle cx="350" cy="25" r="6" fill="#DC2626" />

                {/* RR line (14, 14, 16, 16, 18, 18, 20, 22) */}
                <polyline points="70,112 110,112 150,104 190,104 230,96 270,96 310,88 350,76" fill="none" stroke="#0055FF" strokeWidth="2" />
                <circle cx="70" cy="112" r="4" fill="#0055FF" />
                <circle cx="110" cy="112" r="4" fill="#0055FF" />
                <circle cx="150" cy="104" r="4" fill="#0055FF" />
                <circle cx="190" cy="104" r="4" fill="#0055FF" />
                <circle cx="230" cy="96" r="4" fill="#0055FF" />
                <circle cx="270" cy="96" r="4" fill="#0055FF" />
                <circle cx="310" cy="88" r="4" fill="#0055FF" />
                <circle cx="350" cy="76" r="6" fill="#D97706" />

                {/* X-axis labels */}
                <text x="70" y="175" fontSize="10" fill="#666" textAnchor="middle">12-4pm</text>
                <text x="190" y="175" fontSize="10" fill="#666" textAnchor="middle">12-10pm</text>
                <text x="310" y="175" fontSize="10" fill="#666" textAnchor="middle">1-6am</text>
                <text x="430" y="175" fontSize="10" fill="#666" textAnchor="middle">8am</text>
              </svg>
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0B8A3E', borderRadius: 2 }} />
                  <span>Temp (°C)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0055FF', borderRadius: 2 }} />
                  <span>RR (/min)</span>
                </div>
              </div>
            </div>

            {/* Chart 4: NEWS2 Score History */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', color: '#002054' }}>
                NEWS2 Score History
              </h3>
              <svg style={{ width: '100%', height: 180, marginBottom: 8 }} viewBox="0 0 500 180">
                {/* Grid background */}
                <rect width="500" height="180" fill="url(#grid)" />

                {/* Y-axis labels */}
                <text x="15" y="30" fontSize="10" fill="#666" textAnchor="end">12+</text>
                <text x="15" y="80" fontSize="10" fill="#666" textAnchor="end">6</text>
                <text x="15" y="130" fontSize="10" fill="#666" textAnchor="end">3</text>
                <text x="15" y="170" fontSize="10" fill="#666" textAnchor="end">0</text>

                {/* Score bars with color coding */}
                {/* Score 1 (green) */}
                <rect x="62" y="140" width="16" height="20" fill="#0B8A3E" />
                {/* Score 1 (green) */}
                <rect x="102" y="140" width="16" height="20" fill="#0B8A3E" />
                {/* Score 2 (green) */}
                <rect x="142" y="130" width="16" height="30" fill="#0B8A3E" />
                {/* Score 2 (green) */}
                <rect x="182" y="130" width="16" height="30" fill="#0B8A3E" />
                {/* Score 3 (amber) */}
                <rect x="222" y="120" width="16" height="40" fill="#D97706" />
                {/* Score 5 (red) */}
                <rect x="262" y="100" width="16" height="60" fill="#DC2626" />
                {/* Score 5 (red) */}
                <rect x="302" y="100" width="16" height="60" fill="#DC2626" />
                {/* Score 8 (red) */}
                <rect x="342" y="60" width="16" height="100" fill="#DC2626" />

                {/* X-axis labels */}
                <text x="70" y="175" fontSize="10" fill="#666" textAnchor="middle">12-4pm</text>
                <text x="190" y="175" fontSize="10" fill="#666" textAnchor="middle">12-10pm</text>
                <text x="310" y="175" fontSize="10" fill="#666" textAnchor="middle">1-6am</text>
                <text x="430" y="175" fontSize="10" fill="#666" textAnchor="middle">8am</text>
              </svg>
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#0B8A3E', borderRadius: 2 }} />
                  <span>Low (0-2)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#D97706', borderRadius: 2 }} />
                  <span>Medium (3-4)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#DC2626', borderRadius: 2 }} />
                  <span>High (5+)</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: Vitals History Table */}
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            overflowX: 'auto',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
              Vitals History
            </h3>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0', background: '#f9f9f9' }}>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#666' }}>Date/Time</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>BP</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>HR</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>SpO₂</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>Temp</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>RR</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>Pain</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>NEWS2</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#666' }}>By</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { time: '14 Apr 08:00', bp: '142/88', hr: 108, spo2: 89, temp: '37.8', rr: 22, pain: 4, news2: 8, by: 'Priya' },
                  { time: '14 Apr 04:00', bp: '140/85', hr: 102, spo2: 91, temp: '37.6', rr: 20, pain: 3, news2: 5, by: 'Priya' },
                  { time: '13 Apr 22:00', bp: '138/82', hr: 96, spo2: 93, temp: '37.4', rr: 18, pain: 3, news2: 5, by: 'Rajesh' },
                  { time: '13 Apr 18:00', bp: '135/80', hr: 92, spo2: 94, temp: '37.2', rr: 18, pain: 2, news2: 3, by: 'Rajesh' },
                  { time: '13 Apr 14:00', bp: '132/78', hr: 88, spo2: 95, temp: '37.0', rr: 16, pain: 2, news2: 2, by: 'Sushma' },
                  { time: '13 Apr 10:00', bp: '130/76', hr: 86, spo2: 96, temp: '36.9', rr: 16, pain: 1, news2: 2, by: 'Sushma' },
                  { time: '13 Apr 06:00', bp: '128/74', hr: 84, spo2: 96, temp: '36.8', rr: 14, pain: 1, news2: 1, by: 'Nurse' },
                  { time: '12 Apr 20:00', bp: '125/72', hr: 80, spo2: 97, temp: '36.8', rr: 14, pain: 0, news2: 1, by: 'Nurse' },
                ].map((row, idx) => {
                  const news2BgColor = row.news2 >= 5 ? '#FEE2E2' : row.news2 >= 3 ? '#FEF3C7' : '#F0FDF4';
                  const spo2BgColor = row.spo2 < 92 ? '#FEE2E2' : row.spo2 < 95 ? '#FEF3C7' : 'transparent';
                  const hrBgColor = row.hr > 100 ? '#FEE2E2' : 'transparent';

                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid #e0e0e0',
                        background: idx % 2 === 0 ? 'transparent' : '#fafafa',
                        cursor: 'default',
                      }}
                    >
                      <td style={{ padding: '12px 8px', color: '#666', fontFamily: "'SF Mono', Menlo, monospace", fontSize: 11 }}>
                        {row.time}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace" }}>
                        {row.bp}
                      </td>
                      <td style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        fontWeight: 600,
                        fontFamily: "'SF Mono', Menlo, monospace",
                        background: hrBgColor,
                      }}>
                        {row.hr}
                      </td>
                      <td style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        fontWeight: 600,
                        fontFamily: "'SF Mono', Menlo, monospace",
                        background: spo2BgColor,
                      }}>
                        {row.spo2}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace" }}>
                        {row.temp}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace" }}>
                        {row.rr}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace" }}>
                        {row.pain}
                      </td>
                      <td style={{
                        padding: '12px 8px',
                        textAlign: 'center',
                        fontWeight: 700,
                        fontFamily: "'SF Mono', Menlo, monospace",
                        background: news2BgColor,
                        color: row.news2 >= 5 ? '#DC2626' : row.news2 >= 3 ? '#D97706' : '#0B8A3E',
                      }}>
                        {row.news2}
                      </td>
                      <td style={{ padding: '12px 8px', color: '#666' }}>
                        {row.by}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* SECTION 4: I/O Management (for nursing roles only) */}
          {['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'].includes(userRole) && (
            <>
              {/* 24h Summary */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: 16,
                marginBottom: 24,
              }}>
                <div style={{
                  background: 'white',
                  borderRadius: 12,
                  padding: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  <h3 style={{ fontSize: 11, fontWeight: 600, margin: '0 0 12px', textTransform: 'uppercase', color: '#666' }}>
                    24h Intake
                  </h3>
                  <div style={{
                    fontSize: 32,
                    fontWeight: 700,
                    fontFamily: "'SF Mono', Menlo, monospace",
                    color: '#0055FF',
                  }}>
                    2,480 mL
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                    Oral + IV + Feeds
                  </div>
                </div>

                <div style={{
                  background: 'white',
                  borderRadius: 12,
                  padding: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  <h3 style={{ fontSize: 11, fontWeight: 600, margin: '0 0 12px', textTransform: 'uppercase', color: '#666' }}>
                    24h Output
                  </h3>
                  <div style={{
                    fontSize: 32,
                    fontWeight: 700,
                    fontFamily: "'SF Mono', Menlo, monospace",
                    color: '#0B8A3E',
                  }}>
                    1,850 mL
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                    Urine + Drain + Vomit
                  </div>
                </div>

                <div style={{
                  background: 'white',
                  borderRadius: 12,
                  padding: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  <h3 style={{ fontSize: 11, fontWeight: 600, margin: '0 0 12px', textTransform: 'uppercase', color: '#666' }}>
                    Net Balance
                  </h3>
                  <div style={{
                    fontSize: 32,
                    fontWeight: 700,
                    fontFamily: "'SF Mono', Menlo, monospace",
                    color: '#D97706',
                  }}>
                    +630 mL
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                    Positive (monitor closely)
                  </div>
                </div>
              </div>

              {/* Add I/O Entry Form */}
              <div style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                marginBottom: 24,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
                  Add I/O Entry
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 12,
                  marginBottom: 16,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>Type</label>
                    <select
                      style={{
                        padding: '10px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        border: '1px solid #d0d0d0',
                        borderRadius: 6,
                        boxSizing: 'border-box',
                        background: 'white',
                      }}
                    >
                      <option value="">Select type</option>
                      <option value="oral">Oral</option>
                      <option value="iv">IV Fluid</option>
                      <option value="urine">Urine</option>
                      <option value="drain">Drain</option>
                      <option value="vomit">Vomit</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>Amount (mL)</label>
                    <input
                      type="number"
                      placeholder="250"
                      style={{
                        padding: '10px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        fontFamily: "'SF Mono', Menlo, monospace",
                        border: '1px solid #d0d0d0',
                        borderRadius: 6,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>Notes</label>
                    <input
                      type="text"
                      placeholder="Optional notes"
                      style={{
                        padding: '10px 12px',
                        fontSize: 13,
                        border: '1px solid #d0d0d0',
                        borderRadius: 6,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      style={{
                        padding: '10px 20px',
                        background: '#0055FF',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#003DBF')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#0055FF')}
                    >
                      Save I/O Entry
                    </button>
                  </div>
                </div>
              </div>

              {/* I/O History Table */}
              <div style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                overflowX: 'auto',
              }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
                  Recent I/O Entries
                </h3>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e0e0e0', background: '#f9f9f9' }}>
                      <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#666' }}>Date/Time</th>
                      <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#666' }}>Type</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#666' }}>Amount (mL)</th>
                      <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#666' }}>Notes</th>
                      <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#666' }}>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { time: '14 Apr 08:15', type: 'Urine', amount: 200, notes: 'Clear', by: 'Priya' },
                      { time: '14 Apr 07:30', type: 'Oral', amount: 200, notes: 'Tea + water', by: 'Priya' },
                      { time: '14 Apr 06:00', type: 'IV Fluid', amount: 500, notes: 'RL', by: 'Priya' },
                      { time: '14 Apr 04:00', type: 'Urine', amount: 180, notes: 'Slightly yellow', by: 'Rajesh' },
                      { time: '13 Apr 23:00', type: 'Oral', amount: 250, notes: 'Juice + water', by: 'Rajesh' },
                      { time: '13 Apr 20:00', type: 'IV Fluid', amount: 500, notes: 'RL', by: 'Sushma' },
                    ].map((row, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #e0e0e0',
                          background: idx % 2 === 0 ? 'transparent' : '#fafafa',
                        }}
                      >
                        <td style={{ padding: '12px 8px', color: '#666', fontFamily: "'SF Mono', Menlo, monospace", fontSize: 11 }}>
                          {row.time}
                        </td>
                        <td style={{ padding: '12px 8px', fontWeight: 600, color: '#002054' }}>
                          {row.type}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace" }}>
                          {row.amount}
                        </td>
                        <td style={{ padding: '12px 8px', color: '#666', fontSize: 11 }}>
                          {row.notes}
                        </td>
                        <td style={{ padding: '12px 8px', color: '#666' }}>
                          {row.by}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Other Tabs: Coming Soon ───────────────────────────────────────────── */}
      {activeTab !== 'overview' && activeTab !== 'vitals' && (
        <div style={{
          padding: '40px 24px',
          textAlign: 'center',
          color: '#666',
        }}>
          <p style={{ fontSize: 16, fontWeight: 600 }}>Coming in PC.3–PC.7</p>
          <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>
            This tab will be available in upcoming sprints.
          </p>
        </div>
      )}

      {/* ── Floating Action Bar ───────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'white',
        borderTop: '1px solid #e0e0e0',
        padding: '12px 24px',
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(actionButtons.length, 4)}, 1fr)`,
        gap: 12,
        height: 80,
        zIndex: 1000,
      }}>
        {actionButtons.map((btn, idx) => (
          <button
            key={idx}
            onClick={() => handleActionClick(btn.label)}
            style={{
              padding: 12,
              background: '#0055FF',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              minHeight: 56,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#003DBF')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#0055FF')}
          >
            <div style={{ fontSize: 16 }}>{btn.icon}</div>
            <div>{btn.label}</div>
          </button>
        ))}
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
