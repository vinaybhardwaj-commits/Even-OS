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

      {/* ── Other Tabs: Coming Soon ───────────────────────────────────────────── */}
      {activeTab !== 'overview' && (
        <div style={{
          padding: '40px 24px',
          textAlign: 'center',
          color: '#666',
        }}>
          <p style={{ fontSize: 16, fontWeight: 600 }}>Coming in PC.2–PC.7</p>
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
