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

type PatientTab = 'overview' | 'vitals' | 'labs' | 'orders' | 'notes' | 'plan' | 'emar' | 'assessments' | 'billing' | 'journey';

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
      { label: 'eMAR', id: 'emar', icon: '💊' },
      { label: 'Assessments', id: 'assessments', icon: '✅' },
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
      { label: 'Journey', id: 'journey', icon: '🗓️' },
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
      { label: 'Billing', id: 'billing', icon: '💳' },
      { label: 'Journey', id: 'journey', icon: '🗓️' },
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

// ── Sparkline Component ─────────────────────────────────────────────────────
interface LabTest {
  name: string;
  current: string;
  previous: string;
  refRange: string;
  flag: string;
  flagColor: string;
  trend: number[];
}

function renderSparkline(trend: number[], refMin: number = 0, refMax: number = 100): JSX.Element {
  const svgWidth = 50;
  const svgHeight = 16;
  const padding = 2;
  const chartWidth = svgWidth - padding * 2;
  const chartHeight = svgHeight - padding * 2;

  if (trend.length < 2) {
    return <svg width={svgWidth} height={svgHeight} style={{ display: 'inline' }} />;
  }

  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const range = max === min ? 1 : max - min;

  const points = trend.map((val, idx) => {
    const x = (idx / (trend.length - 1)) * chartWidth + padding;
    const y = chartHeight - ((val - min) / range) * chartHeight + padding;
    return { x, y, val };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg width={svgWidth} height={svgHeight} style={{ display: 'inline', marginLeft: 8 }}>
      {/* Reference range background */}
      <rect x={padding} y={padding} width={chartWidth} height={chartHeight} fill="#ECFDF5" />
      {/* Trend line */}
      <path d={pathD} stroke="#0055FF" strokeWidth="1.5" fill="none" />
      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={p.val > refMax || p.val < refMin ? '#DC2626' : '#0055FF'} />
      ))}
    </svg>
  );
}

interface LabPanelProps {
  title: string;
  timestamp: string;
  isOpen: boolean;
  onToggle: () => void;
  tests: LabTest[];
}

function LabPanel({ title, timestamp, isOpen, onToggle, tests }: LabPanelProps) {
  return (
    <div style={{
      background: 'white',
      borderRadius: 12,
      padding: 0,
      marginBottom: 20,
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      overflow: 'hidden',
    }}>
      {/* Panel Header */}
      <div
        onClick={onToggle}
        style={{
          padding: 16,
          borderBottom: isOpen ? '1px solid #e0e0e0' : 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          background: '#fafafa',
        }}
      >
        <div>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 14, color: '#002054' }}>
            {title}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
            {timestamp}
          </p>
        </div>
        <div style={{ fontSize: 18, color: '#666' }}>
          {isOpen ? '▼' : '▶'}
        </div>
      </div>

      {/* Panel Content */}
      {isOpen && (
        <div style={{ padding: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ padding: '12px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>
                  Test
                </th>
                <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', fontFamily: "'SF Mono', Menlo, monospace" }}>
                  Current
                </th>
                <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', fontFamily: "'SF Mono', Menlo, monospace" }}>
                  Prev
                </th>
                <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>
                  Ref Range
                </th>
                <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>
                  Flag
                </th>
                <th style={{ padding: '12px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>
                  Trend
                </th>
              </tr>
            </thead>
            <tbody>
              {tests.map((test, idx) => (
                <tr key={idx} style={{ borderBottom: idx < tests.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <td style={{ padding: '12px 8px', color: '#333', fontWeight: 500, fontSize: 13 }}>
                    {test.name}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontFamily: "'SF Mono', Menlo, monospace", fontSize: 12, color: '#002054' }}>
                    {test.current}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center', color: '#666', fontFamily: "'SF Mono', Menlo, monospace", fontSize: 12 }}>
                    {test.previous}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center', color: '#666', fontFamily: "'SF Mono', Menlo, monospace", fontSize: 11 }}>
                    {test.refRange}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600, fontSize: 11, color: test.flagColor }}>
                    {test.flag}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                    {renderSparkline(test.trend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Notes Tab Component ────────────────────────────────────────────────────
interface NotesTabProps {
  userRole: string;
  userName: string;
  onNoteSaved: () => void;
}

function NotesTab({ userRole, userName, onNoteSaved }: NotesTabProps) {
  const doctorRoles = ['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon', 'anaesthetist'];
  const nurseRoles = ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'];
  const isDoctor = doctorRoles.includes(userRole);
  const isNurse = nurseRoles.includes(userRole);

  // SOAP form state
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState(
    'Vitals (08:00): BP 142/88, HR 108↑, SpO₂ 89%↓, Temp 37.8°C, RR 22, Pain 6/10.\n' +
    'NEWS2: 8 (↑ from 5 yesterday).\n' +
    'Labs (06:00): Hb 10.2↓ (ref 13-17), Cr 1.8↑ (ref 0.7-1.3), INR 2.8↑ (ref 0.8-1.2).\n' +
    'I/O (24h): Intake 1,850 mL, Output 1,420 mL, Net +430 mL.\n' +
    'Wound: [describe].'
  );
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [noteType, setNoteType] = useState('General');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // Sample notes data
  const sampleNotes = [
    {
      id: '1',
      author: 'Dr. Sharma',
      role: 'Cardiology',
      time: '14 Apr 07:30',
      type: 'SOAP',
      badge: 'SOAP',
      badgeColor: '#0055FF',
      content: 'S: Reports reduced chest discomfort, pain 4/10 from 6/10 yesterday. Tolerated liquids.\nO: BP 142/88, HR 108, SpO₂ 89%, T 37.8. NEWS2 8. Hb 10.2, Cr 1.8, INR 2.8...\nA: POD-3 post CABG. SpO₂ dropping, tachycardia. Cr rising — possible contrast nephropathy.\nP: Increase O₂, hold Enoxaparin if INR >3, nephrology consult, repeat CBC+RFT AM.',
      signed: true,
    },
    {
      id: '2',
      author: 'Nurse Priya',
      role: 'Nursing',
      time: '14 Apr 06:00',
      type: 'Nursing',
      badge: 'Nursing',
      badgeColor: '#0B8A3E',
      content: 'Shift handoff: Patient cooperative, wound dressing clean, drain output 150mL overnight. Pain managed with Morphine 2mg at 04:00. Blood sugar 145mg/dL fasting.',
      signed: false,
    },
    {
      id: '3',
      author: 'Dr. Priya Mehta',
      role: 'RMO',
      time: '13 Apr 20:00',
      type: 'Progress',
      badge: 'Progress',
      badgeColor: '#0055FF',
      content: 'Evening review. Vitals stable. SpO₂ maintained at 93% on 2L O₂. Pain controlled...',
      signed: true,
    },
    {
      id: '4',
      author: 'Nurse Meera',
      role: 'Nursing',
      time: '13 Apr 18:00',
      type: 'Wound Care',
      badge: 'Wound Care',
      badgeColor: '#D97706',
      content: 'Sternotomy wound: clean, no erythema, no discharge. Drain site intact. Dressing changed.',
      signed: false,
    },
    {
      id: '5',
      author: 'Physiotherapist',
      role: 'Rehab',
      time: '13 Apr 14:00',
      type: 'Session',
      badge: 'Physio',
      badgeColor: '#9333EA',
      content: 'Session 2: Mobilized to chair for 15 min. Breathing exercises demonstrated. Tolerated well.',
      signed: null,
    },
    {
      id: '6',
      author: 'Dr. Sharma',
      role: 'Cardiology',
      time: '13 Apr 08:00',
      type: 'SOAP',
      badge: 'SOAP',
      badgeColor: '#0055FF',
      content: 'S: Reports chest discomfort, pain 6/10... [expandable]',
      signed: true,
    },
  ];

  const quickChips = {
    s: ['Pain improved', 'Nausea', 'SOB', 'Tolerated diet', 'Slept well', 'Fever resolved'],
    a: ['Improving', 'Stable', 'Deteriorating', 'New concern', 'Ready for discharge'],
    p: ['Continue current Rx', 'Modify Rx', 'Order labs', 'DC tomorrow', 'Consult ___', 'Step down O₂'],
  };

  const handleQuickChip = (field: 'subjective' | 'assessment' | 'plan', text: string) => {
    if (field === 'subjective') {
      setSubjective((s) => (s ? s + ' ' + text : text));
    } else if (field === 'assessment') {
      setAssessment((a) => (a ? a + ' ' + text : text));
    } else {
      setPlan((p) => (p ? p + ' ' + text : text));
    }
  };

  const handleSaveNote = () => {
    if (isDoctor) {
      if (!subjective.trim() || !assessment.trim() || !plan.trim()) {
        alert('Please fill in all SOAP sections');
        return;
      }
    }
    alert('Note saved successfully');
    setSubjective('');
    setObjective(
      'Vitals (08:00): BP 142/88, HR 108↑, SpO₂ 89%↓, Temp 37.8°C, RR 22, Pain 6/10.\n' +
      'NEWS2: 8 (↑ from 5 yesterday).\n' +
      'Labs (06:00): Hb 10.2↓ (ref 13-17), Cr 1.8↑ (ref 0.7-1.3), INR 2.8↑ (ref 0.8-1.2).\n' +
      'I/O (24h): Intake 1,850 mL, Output 1,420 mL, Net +430 mL.\n' +
      'Wound: [describe].'
    );
    setAssessment('');
    setPlan('');
  };

  const toggleNoteExpanded = (noteId: string) => {
    const updated = new Set(expandedNotes);
    if (updated.has(noteId)) {
      updated.delete(noteId);
    } else {
      updated.add(noteId);
    }
    setExpandedNotes(updated);
  };

  return (
    <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh', paddingBottom: 100 }}>
      {/* ── Write Section ────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 20px', textTransform: 'uppercase', color: '#666' }}>
          Write Note
        </h3>

        {isDoctor ? (
          <>
            {/* SOAP Sections */}
            <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
              {/* Subjective */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                  S (Subjective)
                </label>
                <textarea
                  value={subjective}
                  onChange={(e) => setSubjective(e.target.value)}
                  placeholder="Patient's symptoms, complaints..."
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {quickChips.s.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => handleQuickChip('subjective', chip)}
                      style={{
                        padding: '6px 12px',
                        background: '#EFF6FF',
                        border: '1px solid #0055FF',
                        borderRadius: 6,
                        color: '#0055FF',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#0055FF';
                        e.currentTarget.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#EFF6FF';
                        e.currentTarget.style.color = '#0055FF';
                      }}
                    >
                      [+] {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Objective */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                  O (Objective) — Auto-populated from vitals & labs
                </label>
                <textarea
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 120,
                    padding: 12,
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: "'SF Mono', Menlo, monospace",
                    resize: 'none',
                    background: '#FAFAFA',
                  }}
                />
              </div>

              {/* Assessment */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                  A (Assessment)
                </label>
                <textarea
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                  placeholder="Clinical impression..."
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {quickChips.a.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => handleQuickChip('assessment', chip)}
                      style={{
                        padding: '6px 12px',
                        background: '#EFF6FF',
                        border: '1px solid #0055FF',
                        borderRadius: 6,
                        color: '#0055FF',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#0055FF';
                        e.currentTarget.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#EFF6FF';
                        e.currentTarget.style.color = '#0055FF';
                      }}
                    >
                      [+] {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plan */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                  P (Plan)
                </label>
                <textarea
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  placeholder="Treatment plan..."
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    border: '1px solid #e0e0e0',
                    borderRadius: 8,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {quickChips.p.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => handleQuickChip('plan', chip)}
                      style={{
                        padding: '6px 12px',
                        background: '#EFF6FF',
                        border: '1px solid #0055FF',
                        borderRadius: 6,
                        color: '#0055FF',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#0055FF';
                        e.currentTarget.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#EFF6FF';
                        e.currentTarget.style.color = '#0055FF';
                      }}
                    >
                      [+] {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setSubjective('');
                  setAssessment('');
                  setPlan('');
                }}
                style={{
                  padding: '10px 20px',
                  background: 'white',
                  border: '2px solid #999',
                  color: '#333',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F5F5F5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'white';
                }}
              >
                Clear Draft
              </button>
              <button
                onClick={handleSaveNote}
                style={{
                  padding: '10px 20px',
                  background: '#0055FF',
                  border: 'none',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#003DBF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#0055FF';
                }}
              >
                Submit & Sign
              </button>
            </div>
          </>
        ) : isNurse ? (
          <>
            {/* Nursing Note Form */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                Note Type
              </label>
              <select
                value={noteType}
                onChange={(e) => setNoteType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              >
                <option>General</option>
                <option>Wound Care</option>
                <option>Fall Event</option>
                <option>Patient Education</option>
                <option>Family Communication</option>
                <option>Pain Reassessment</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
                Note
              </label>
              <textarea
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
                placeholder="Write your nursing note..."
                style={{
                  width: '100%',
                  minHeight: 120,
                  padding: 12,
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  resize: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveNote}
                style={{
                  padding: '10px 20px',
                  background: '#0055FF',
                  border: 'none',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#003DBF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#0055FF';
                }}
              >
                Save Note
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Quick Note for Other Roles */}
            <div style={{ marginBottom: 16 }}>
              <textarea
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
                placeholder="Write a note..."
                style={{
                  width: '100%',
                  minHeight: 100,
                  padding: 12,
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  resize: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveNote}
                style={{
                  padding: '10px 20px',
                  background: '#0055FF',
                  border: 'none',
                  color: 'white',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#003DBF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#0055FF';
                }}
              >
                Save Note
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Notes Timeline ────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white',
        borderRadius: 12,
        padding: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 20px', textTransform: 'uppercase', color: '#666' }}>
          Notes Timeline
        </h3>

        <div style={{ display: 'grid', gap: 16 }}>
          {sampleNotes.map((note) => {
            const isExpanded = expandedNotes.has(note.id);
            const contentLines = note.content.split('\n');
            const shouldShowReadMore = contentLines.length > 3;
            const displayContent = isExpanded ? note.content : contentLines.slice(0, 3).join('\n');

            return (
              <div
                key={note.id}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#FAFAFA',
                }}
              >
                {/* Header */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#333' }}>
                      {note.author}
                    </span>
                    <span style={{ fontSize: 11, color: '#999' }}>
                      ({note.role})
                    </span>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        background: note.badgeColor,
                        color: 'white',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      {note.badge}
                    </span>
                    <span style={{ fontSize: 11, color: '#999', marginLeft: 'auto' }}>
                      {note.time}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#999' }}>
                    {note.signed === true && '✅ Signed'}
                    {note.signed === false && '⏳ Awaiting co-sign'}
                    {note.signed === null && 'N/A'}
                  </div>
                </div>

                {/* Content */}
                <div style={{
                  fontSize: 12,
                  color: '#333',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  marginBottom: 12,
                  fontFamily: note.type === 'SOAP' ? "'SF Mono', Menlo, monospace" : 'inherit',
                }}>
                  {displayContent}
                  {shouldShowReadMore && !isExpanded && ' ...'}
                </div>

                {/* Footer Actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                  {shouldShowReadMore && (
                    <button
                      onClick={() => toggleNoteExpanded(note.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#0055FF',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {note.signed === false && isDoctor && (
                      <>
                        <button
                          style={{
                            padding: '6px 12px',
                            background: '#0055FF',
                            border: 'none',
                            color: 'white',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#003DBF';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#0055FF';
                          }}
                        >
                          Co-Sign
                        </button>
                        <button
                          style={{
                            padding: '6px 12px',
                            background: '#FEE2E2',
                            border: '1px solid #DC2626',
                            color: '#DC2626',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#DC2626';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#FEE2E2';
                            e.currentTarget.style.color = '#DC2626';
                          }}
                        >
                          Request Revision
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function PatientChartClient({ patientId, userId, userRole, userName, hospitalId }: Props) {
  const [activeTab, setActiveTab] = useState<PatientTab>('overview');
  const [loading, setLoading] = useState(true);
  const [orderPanel, setOrderPanel] = useState<'none' | 'medication' | 'labs' | 'imaging' | 'consult'>('none');

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

  // eMAR state
  const [emarGiveModal, setEmarGiveModal] = useState<{ med_id: string; med_name: string; dose: string; route: string } | null>(null);
  const [emarHoldModal, setEmarHoldModal] = useState<{ med_id: string; med_name: string } | null>(null);
  const [emarRefuseModal, setEmarRefuseModal] = useState<{ med_id: string; med_name: string } | null>(null);
  const [emarAdminSite, setEmarAdminSite] = useState('');
  const [emarBarcode, setEmarBarcode] = useState('');
  const [emarHoldReason, setEmarHoldReason] = useState('');
  const [emarRefuseReason, setEmarRefuseReason] = useState('');

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

  // ── Escape key handler for closing order panels ───────────────────────────
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOrderPanel('none');
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

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

      {/* ── Labs & Results Tab ────────────────────────────────────────────────── */}
      {activeTab === 'labs' && (
        <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh' }}>
          {/* Order Labs Button (for doctor roles only) */}
          {['doctor', 'senior_doctor', 'department_head', 'medical_director'].includes(userRole) && (
            <div style={{ marginBottom: 24 }}>
              <button
                onClick={() => alert('Coming in PC.4: Lab ordering engine')}
                style={{
                  padding: '12px 20px',
                  background: '#0055FF',
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>🔬</span> Order New Labs
              </button>
            </div>
          )}

          {/* CBC Panel */}
          <LabPanel
            title="CBC — Complete Blood Count"
            timestamp="14 Apr 06:00"
            isOpen={true}
            onToggle={() => {}}
            tests={[
              {
                name: 'Haemoglobin',
                current: '10.2',
                previous: '10.8',
                refRange: '13.0–17.0',
                flag: 'LOW',
                flagColor: '#DC2626',
                trend: [12.8, 11.5, 10.8, 10.2],
              },
              {
                name: 'WBC',
                current: '8.0',
                previous: '9.2',
                refRange: '4.5–11.0',
                flag: 'Normal',
                flagColor: '#0B8A3E',
                trend: [7.5, 11.0, 9.2, 8.0],
              },
              {
                name: 'Platelets',
                current: '203',
                previous: '195',
                refRange: '150–400',
                flag: 'Normal',
                flagColor: '#0B8A3E',
                trend: [220, 180, 195, 203],
              },
              {
                name: 'Neutrophils',
                current: '75.1',
                previous: '72.0',
                refRange: '40–75',
                flag: 'HIGH',
                flagColor: '#D97706',
                trend: [72, 74, 72, 75.1],
              },
              {
                name: 'Lymphocytes',
                current: '18.1',
                previous: '20.0',
                refRange: '20–40',
                flag: 'LOW',
                flagColor: '#D97706',
                trend: [22, 21, 20, 18.1],
              },
            ]}
          />

          {/* RFT Panel */}
          <LabPanel
            title="Renal Function Test"
            timestamp="14 Apr 06:00"
            isOpen={true}
            onToggle={() => {}}
            tests={[
              {
                name: 'Creatinine',
                current: '1.8',
                previous: '1.5',
                refRange: '0.7–1.3',
                flag: 'HIGH',
                flagColor: '#DC2626',
                trend: [1.0, 1.2, 1.5, 1.8],
              },
              {
                name: 'BUN',
                current: '28',
                previous: '24',
                refRange: '7–20',
                flag: 'HIGH',
                flagColor: '#DC2626',
                trend: [18, 20, 24, 28],
              },
              {
                name: 'eGFR',
                current: '38',
                previous: '45',
                refRange: '>60',
                flag: 'LOW',
                flagColor: '#DC2626',
                trend: [85, 65, 45, 38],
              },
              {
                name: 'Potassium',
                current: '4.2',
                previous: '4.0',
                refRange: '3.5–5.0',
                flag: 'Normal',
                flagColor: '#0B8A3E',
                trend: [4.0, 4.0, 4.0, 4.2],
              },
              {
                name: 'Sodium',
                current: '139',
                previous: '140',
                refRange: '136–145',
                flag: 'Normal',
                flagColor: '#0B8A3E',
                trend: [140, 140, 140, 139],
              },
            ]}
          />

          {/* Clinical Alerts */}
          <div style={{
            background: '#FEE2E2',
            border: '1px solid #FECACA',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            borderLeft: '4px solid #DC2626',
          }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 18 }}>⚠️</div>
              <div>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#991B1B', fontSize: 14 }}>
                  Creatinine 1.8 and rising (1.0 → 1.2 → 1.5 → 1.8)
                </p>
                <p style={{ margin: 0, color: '#7F1D1D', fontSize: 13 }}>
                  Possible acute kidney injury. Consider nephrology consult.
                </p>
              </div>
            </div>
          </div>

          {/* Coagulation Panel */}
          <LabPanel
            title="Coagulation Panel"
            timestamp="14 Apr 06:00"
            isOpen={true}
            onToggle={() => {}}
            tests={[
              {
                name: 'INR',
                current: '2.8',
                previous: '2.4',
                refRange: '0.8–1.2',
                flag: 'HIGH',
                flagColor: '#DC2626',
                trend: [1.1, 1.8, 2.4, 2.8],
              },
              {
                name: 'PT',
                current: '32',
                previous: '28',
                refRange: '11–13.5',
                flag: 'HIGH',
                flagColor: '#DC2626',
                trend: [12, 18, 28, 32],
              },
            ]}
          />

          {/* Second Clinical Alert */}
          <div style={{
            background: '#FEF3C7',
            border: '1px solid #FDE68A',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            borderLeft: '4px solid #D97706',
          }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 18 }}>⚠️</div>
              <div>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#92400E', fontSize: 14 }}>
                  INR 2.8 with active Enoxaparin
                </p>
                <p style={{ margin: 0, color: '#78350F', fontSize: 13 }}>
                  Risk of over-anticoagulation. Consider dose adjustment or holding anticoagulant.
                </p>
              </div>
            </div>
          </div>

          {/* Metabolic Panel */}
          <LabPanel
            title="Metabolic Panel"
            timestamp="14 Apr 06:00"
            isOpen={true}
            onToggle={() => {}}
            tests={[
              {
                name: 'Glucose (Fasting)',
                current: '145',
                previous: '132',
                refRange: '70–100',
                flag: 'HIGH',
                flagColor: '#D97706',
                trend: [128, 155, 132, 145],
              },
            ]}
          />

          {/* Pending Lab Orders Section */}
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            marginTop: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
              Pending Lab Orders
            </h3>
            <div style={{
              padding: 16,
              background: '#EFF6FF',
              borderRadius: 8,
              borderLeft: '4px solid #0055FF',
            }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#002054', fontSize: 14 }}>
                CBC + RFT + Coagulation
              </p>
              <p style={{ margin: '0 0 4px', fontSize: 12, color: '#666' }}>
                Ordered 14 Apr 07:30
              </p>
              <p style={{ margin: '0 0 4px', fontSize: 12, color: '#666' }}>
                Status: <span style={{ fontWeight: 600, color: '#D97706' }}>Pending collection</span>
              </p>
              <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                Priority: Routine
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Orders Tab (Doctor Roles Only) ──────────────────────────────────── */}
      {activeTab === 'orders' && (
        <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh', paddingBottom: 100 }}>
          {/* Doctor role check */}
          {!['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon', 'anaesthetist'].includes(userRole) ? (
            <div style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: '#666',
            }}>
              <p style={{ fontSize: 16, fontWeight: 600 }}>Orders are managed by doctors</p>
              <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>
                Your role does not have permission to place orders. Please contact a doctor or specialist.
              </p>
            </div>
          ) : (
            <>
              {/* Quick Order Buttons */}
              <div style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                marginBottom: 24,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
                  Place New Order
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                  gap: 12,
                }}>
                  <button
                    onClick={() => setOrderPanel('labs')}
                    style={{
                      height: 48,
                      padding: '8px 16px',
                      background: 'white',
                      border: '2px solid #0055FF',
                      color: '#0055FF',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#EFF6FF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'white';
                    }}
                  >
                    <span style={{ fontSize: 18 }}>🔬</span> Order Labs
                  </button>
                  <button
                    onClick={() => setOrderPanel('medication')}
                    style={{
                      height: 48,
                      padding: '8px 16px',
                      background: 'white',
                      border: '2px solid #0055FF',
                      color: '#0055FF',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#EFF6FF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'white';
                    }}
                  >
                    <span style={{ fontSize: 18 }}>💊</span> Prescribe Med
                  </button>
                  <button
                    onClick={() => setOrderPanel('imaging')}
                    style={{
                      height: 48,
                      padding: '8px 16px',
                      background: 'white',
                      border: '2px solid #0055FF',
                      color: '#0055FF',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#EFF6FF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'white';
                    }}
                  >
                    <span style={{ fontSize: 18 }}>📡</span> Order Imaging
                  </button>
                  <button
                    onClick={() => setOrderPanel('consult')}
                    style={{
                      height: 48,
                      padding: '8px 16px',
                      background: 'white',
                      border: '2px solid #0055FF',
                      color: '#0055FF',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#EFF6FF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'white';
                    }}
                  >
                    <span style={{ fontSize: 18 }}>🏥</span> Request Consult
                  </button>
                </div>
              </div>

              {/* Active Orders Table */}
              <div style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>
                  Active Orders
                </h3>
                <div style={{
                  overflowX: 'auto',
                  borderRadius: 8,
                  border: '1px solid #e0e0e0',
                }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                  }}>
                    <thead>
                      <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e0e0e0' }}>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Date</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Order</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Type</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Status</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Priority</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Ordered By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { date: '14 Apr 07:30', order: 'CBC + RFT + Coag', type: 'Lab', status: 'Pending', priority: 'Routine', orderedBy: 'Dr. Sharma' },
                        { date: '13 Apr 08:00', order: 'Chest X-Ray PA', type: 'Imaging', status: 'Completed', priority: 'Routine', orderedBy: 'Dr. Priya' },
                        { date: '12 Apr 14:00', order: 'Enoxaparin 40mg SC OD', type: 'Medication', status: 'Active', priority: 'Routine', orderedBy: 'Dr. Sharma' },
                        { date: '12 Apr 14:00', order: 'Metoprolol 25mg PO BD', type: 'Medication', status: 'Active', priority: 'Routine', orderedBy: 'Dr. Sharma' },
                        { date: '12 Apr 14:00', order: 'Clopidogrel 75mg PO OD', type: 'Medication', status: 'Active', priority: 'Routine', orderedBy: 'Dr. Sharma' },
                        { date: '11 Apr 18:00', order: 'Cardiology Consult', type: 'Consult', status: 'Completed', priority: 'Routine', orderedBy: 'Dr. Priya' },
                      ].map((row, idx) => {
                        let statusBg = '#EFF6FF';
                        let statusColor = '#0055FF';
                        if (row.status === 'Active') {
                          statusBg = '#ECFDF5';
                          statusColor = '#0B8A3E';
                        } else if (row.status === 'Completed') {
                          statusBg = '#F3F4F6';
                          statusColor = '#666';
                        } else if (row.status === 'Cancelled') {
                          statusBg = '#FEE2E2';
                          statusColor = '#DC2626';
                        }
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #e0e0e0' }}>
                            <td style={{ padding: '12px', color: '#666' }}>{row.date}</td>
                            <td style={{ padding: '12px', color: '#333', fontWeight: 500 }}>{row.order}</td>
                            <td style={{ padding: '12px', color: '#666' }}>{row.type}</td>
                            <td style={{ padding: '12px' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '4px 8px',
                                borderRadius: 4,
                                background: statusBg,
                                color: statusColor,
                                fontWeight: 500,
                                fontSize: 12,
                              }}>
                                {row.status}
                              </span>
                            </td>
                            <td style={{ padding: '12px', color: '#666' }}>{row.priority}</td>
                            <td style={{ padding: '12px', color: '#666' }}>{row.orderedBy}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Notes Tab ────────────────────────────────────────────────────────────── */}
      {activeTab === 'notes' && (
        <NotesTab userRole={userRole} userName={userName} onNoteSaved={loadData} />
      )}

      {/* ── eMAR Tab (Medication Administration Record) ────────────────────────── */}
      {activeTab === 'emar' && (
        <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh' }}>
          {/* Nursing roles: show full eMAR interface */}
          {['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'].includes(userRole) ? (
            <>
              {/* ── Summary Stats Bar ──────────────────────────────────────────────── */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 16,
                marginBottom: 24,
              }}>
                {[
                  { label: 'Total Active Meds', value: '6', color: '#0055FF' },
                  { label: 'Given Today', value: '3', color: '#0B8A3E' },
                  { label: 'Overdue', value: '1', color: '#DC2626' },
                  { label: 'Pending', value: '2', color: '#D97706' },
                ].map((stat, idx) => (
                  <div key={idx} style={{
                    background: 'white',
                    borderRadius: 12,
                    padding: 16,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    borderLeft: `4px solid ${stat.color}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>{stat.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: stat.color, marginTop: 8 }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* ── Scheduled Medications ──────────────────────────────────────────── */}
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#002054', marginBottom: 16, padding: '0 0 12px', borderBottom: '2px solid #e0e0e0' }}>
                  Scheduled Medications
                </h2>

                {/* Medication Cards */}
                {[
                  { id: 'm1', name: 'Metoprolol 25mg PO BD', dose: '25mg', route: 'PO', doctor: 'Dr. Sharma', startDate: '12 Apr', times: [{ time: '06:00', status: 'given' }, { time: '08:00', status: 'given' }, { time: '14:00', status: 'due' }, { time: '22:00', status: 'none' }], nextDue: 'Due 14:00' },
                  { id: 'm2', name: 'Clopidogrel 75mg PO OD', dose: '75mg', route: 'PO', doctor: 'Dr. Sharma', startDate: '12 Apr', times: [{ time: '08:00', status: 'none' }, { time: '12:00', status: 'due' }, { time: '16:00', status: 'none' }, { time: '20:00', status: 'none' }], nextDue: 'Due 12:00' },
                  { id: 'm3', name: 'Enoxaparin 40mg SC OD', dose: '40mg', route: 'SC', doctor: 'Dr. Sharma', startDate: '12 Apr', times: [{ time: '06:00', status: 'none' }, { time: '10:00', status: 'overdue' }, { time: '14:00', status: 'none' }, { time: '18:00', status: 'none' }], nextDue: 'OVERDUE (due 10:00)', isOverdue: true },
                  { id: 'm4', name: 'Atorvastatin 40mg PO HS', dose: '40mg', route: 'PO', doctor: 'Dr. Sharma', startDate: '12 Apr', times: [{ time: '06:00', status: 'none' }, { time: '12:00', status: 'none' }, { time: '18:00', status: 'none' }, { time: '22:00', status: 'due' }], nextDue: 'Due tonight' },
                  { id: 'm5', name: 'Pantoprazole 40mg IV OD', dose: '40mg', route: 'IV', doctor: 'Dr. Sharma', startDate: '11 Apr', times: [{ time: '06:00', status: 'given' }, { time: '12:00', status: 'none' }, { time: '18:00', status: 'none' }, { time: '00:00', status: 'none' }], nextDue: 'Given today' },
                  { id: 'm6', name: 'Aspirin 75mg PO OD', dose: '75mg', route: 'PO', doctor: 'Dr. Sharma', startDate: '12 Apr', times: [{ time: '08:00', status: 'none' }, { time: '10:00', status: 'none' }, { time: '14:00', status: 'refused' }, { time: '18:00', status: 'none' }], nextDue: 'Refused 14:00' },
                ].map((med) => (
                  <div key={med.id} style={{
                    background: 'white',
                    borderRadius: 12,
                    padding: 20,
                    marginBottom: 16,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    borderLeft: med.isOverdue ? '4px solid #DC2626' : '4px solid #0055FF',
                  }}>
                    {/* Card Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#002054' }}>{med.name}</div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{med.doctor} | Started {med.startDate}</div>
                      </div>
                      <div style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '4px 12px',
                        borderRadius: 4,
                        background: med.isOverdue ? '#DC2626' : '#D97706',
                        color: 'white',
                      }}>
                        {med.nextDue}
                      </div>
                    </div>

                    {/* Time-Slot Grid */}
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, overflowX: 'auto' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {med.times.map((slot, idx) => {
                          let icon = '—';
                          let color = '#ccc';
                          let bgColor = 'transparent';

                          if (slot.status === 'given') {
                            icon = '✓';
                            color = '#0B8A3E';
                            bgColor = '#0B8A3E';
                          } else if (slot.status === 'overdue') {
                            icon = '!';
                            color = 'white';
                            bgColor = '#DC2626';
                          } else if (slot.status === 'due') {
                            icon = '•';
                            color = '#0055FF';
                            bgColor = 'transparent';
                          } else if (slot.status === 'held') {
                            icon = '⊘';
                            color = '#999';
                            bgColor = 'transparent';
                          } else if (slot.status === 'refused') {
                            icon = '✕';
                            color = 'white';
                            bgColor = '#D97706';
                          }

                          return (
                            <div key={idx} style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 6,
                              minWidth: 48,
                            }}>
                              <div style={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: bgColor,
                                border: slot.status === 'due' ? '2px solid #0055FF' : (slot.status === 'none' ? '1px solid #e0e0e0' : 'none'),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 700,
                                color: color,
                              }}>
                                {icon}
                              </div>
                              <div style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>{slot.time}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {med.isOverdue && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                        <button
                          onClick={() => setEmarGiveModal({ med_id: med.id, med_name: med.name, dose: med.dose, route: med.route })}
                          style={{
                            padding: '10px 16px',
                            background: '#0B8A3E',
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#086a31')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '#0B8A3E')}
                        >
                          Give Now
                        </button>
                        <button
                          onClick={() => setEmarHoldModal({ med_id: med.id, med_name: med.name })}
                          style={{
                            padding: '10px 16px',
                            background: '#999',
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#777')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '#999')}
                        >
                          Hold
                        </button>
                        <button
                          onClick={() => setEmarRefuseModal({ med_id: med.id, med_name: med.name })}
                          style={{
                            padding: '10px 16px',
                            background: '#D97706',
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#b85c03')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '#D97706')}
                        >
                          Refuse
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── PRN Section ────────────────────────────────────────────────────── */}
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#002054', marginBottom: 16, padding: '0 0 12px', borderBottom: '2px solid #e0e0e0' }}>
                  PRN Medications
                </h2>
                <div style={{
                  background: 'white',
                  borderRadius: 12,
                  padding: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#002054' }}>Morphine 2mg IV PRN q4h</div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>(for pain &gt; 5)</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 16, lineHeight: 1.6 }}>
                    <div>Last given: <span style={{ fontWeight: 600, color: '#002054' }}>04:00 (6h 45m ago)</span></div>
                    <div>Next available: <span style={{ fontWeight: 600, color: '#0B8A3E' }}>NOW</span></div>
                  </div>
                  <button
                    style={{
                      padding: '10px 20px',
                      background: '#0055FF',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#003DBF')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#0055FF')}
                  >
                    Give PRN
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}>
              <p style={{ fontSize: 14, color: '#666', margin: 0 }}>eMAR is managed by nursing staff.</p>
              <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>Contact your nurse for medication administration details.</p>
            </div>
          )}

          {/* ── Give Medication Inline Modal ────────────────────────────────────── */}
          {emarGiveModal && (
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              marginTop: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              border: '2px solid #0B8A3E',
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#002054', margin: '0 0 16px' }}>Give Medication</h3>

              {/* Identity Verification */}
              <div style={{ padding: '12px 16px', background: '#f5f6fa', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#666' }}>Patient Name / UHID</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#002054', marginTop: 4 }}>{patient?.full_name} ({patient?.uhid})</div>
              </div>

              {/* Drug Details */}
              <div style={{ padding: '12px 16px', background: '#f5f6fa', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#666' }}>Drug</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#002054', marginTop: 4 }}>{emarGiveModal.med_name}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                  <span style={{ fontFamily: "'SF Mono', Menlo, monospace", fontWeight: 600 }}>{emarGiveModal.dose}</span> {emarGiveModal.route}
                </div>
              </div>

              {/* Barcode Input */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>Barcode Scan</label>
                <input
                  type="text"
                  placeholder="Scan barcode here"
                  value={emarBarcode}
                  onChange={(e) => setEmarBarcode(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '8px 12px',
                    fontSize: 13,
                    border: '1px solid #d0d0d0',
                    borderRadius: 6,
                    boxSizing: 'border-box',
                    fontFamily: 'system-ui',
                  }}
                />
              </div>

              {/* Admin Site (for injections) */}
              {['SC', 'IM', 'IV'].includes(emarGiveModal.route) && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>Administration Site</label>
                  <select
                    value={emarAdminSite}
                    onChange={(e) => setEmarAdminSite(e.target.value)}
                    style={{
                      width: '100%',
                      height: 40,
                      padding: '8px 12px',
                      fontSize: 13,
                      border: '1px solid #d0d0d0',
                      borderRadius: 6,
                      boxSizing: 'border-box',
                      fontFamily: 'system-ui',
                    }}
                  >
                    <option value="">Select site...</option>
                    <option value="left_arm">Left Arm</option>
                    <option value="right_arm">Right Arm</option>
                    <option value="left_thigh">Left Thigh</option>
                    <option value="right_thigh">Right Thigh</option>
                    <option value="abdomen">Abdomen</option>
                    <option value="left_buttock">Left Buttock</option>
                    <option value="right_buttock">Right Buttock</option>
                  </select>
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  onClick={() => {
                    alert('Medication administered successfully');
                    setEmarGiveModal(null);
                    setEmarBarcode('');
                    setEmarAdminSite('');
                  }}
                  style={{
                    padding: '12px 16px',
                    background: '#0B8A3E',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#086a31')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#0B8A3E')}
                >
                  Confirm Give
                </button>
                <button
                  onClick={() => {
                    setEmarGiveModal(null);
                    setEmarBarcode('');
                    setEmarAdminSite('');
                  }}
                  style={{
                    padding: '12px 16px',
                    background: '#e0e0e0',
                    color: '#333',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#d0d0d0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#e0e0e0')}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Hold Medication Inline Modal ────────────────────────────────────── */}
          {emarHoldModal && (
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              marginTop: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              border: '2px solid #999',
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#002054', margin: '0 0 16px' }}>Hold Medication</h3>

              <div style={{ padding: '12px 16px', background: '#f5f6fa', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#666' }}>Drug</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#002054', marginTop: 4 }}>{emarHoldModal.med_name}</div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>Reason for Hold</label>
                <select
                  value={emarHoldReason}
                  onChange={(e) => setEmarHoldReason(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '8px 12px',
                    fontSize: 13,
                    border: '1px solid #d0d0d0',
                    borderRadius: 6,
                    boxSizing: 'border-box',
                    fontFamily: 'system-ui',
                  }}
                >
                  <option value="">Select reason...</option>
                  <option value="npo">Patient NPO</option>
                  <option value="refused">Patient refused</option>
                  <option value="vitals">Vitals abnormal</option>
                  <option value="doctor">Doctor hold</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  onClick={() => {
                    alert('Medication held successfully');
                    setEmarHoldModal(null);
                    setEmarHoldReason('');
                  }}
                  style={{
                    padding: '12px 16px',
                    background: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#777')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#999')}
                >
                  Confirm Hold
                </button>
                <button
                  onClick={() => {
                    setEmarHoldModal(null);
                    setEmarHoldReason('');
                  }}
                  style={{
                    padding: '12px 16px',
                    background: '#e0e0e0',
                    color: '#333',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#d0d0d0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#e0e0e0')}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Refuse Medication Inline Modal ──────────────────────────────────── */}
          {emarRefuseModal && (
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              marginTop: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              border: '2px solid #D97706',
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#002054', margin: '0 0 16px' }}>Medication Refused</h3>

              <div style={{ padding: '12px 16px', background: '#f5f6fa', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#666' }}>Drug</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#002054', marginTop: 4 }}>{emarRefuseModal.med_name}</div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>Reason for Refusal</label>
                <select
                  value={emarRefuseReason}
                  onChange={(e) => setEmarRefuseReason(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '8px 12px',
                    fontSize: 13,
                    border: '1px solid #d0d0d0',
                    borderRadius: 6,
                    boxSizing: 'border-box',
                    fontFamily: 'system-ui',
                  }}
                >
                  <option value="">Select reason...</option>
                  <option value="refused">Patient refused</option>
                  <option value="unavailable">Not available</option>
                  <option value="allergy">Allergy concern</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  onClick={() => {
                    alert('Medication refusal recorded');
                    setEmarRefuseModal(null);
                    setEmarRefuseReason('');
                  }}
                  style={{
                    padding: '12px 16px',
                    background: '#D97706',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#b85c03')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#D97706')}
                >
                  Confirm Refusal
                </button>
                <button
                  onClick={() => {
                    setEmarRefuseModal(null);
                    setEmarRefuseReason('');
                  }}
                  style={{
                    padding: '12px 16px',
                    background: '#e0e0e0',
                    color: '#333',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#d0d0d0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#e0e0e0')}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: ASSESSMENTS ──────────────────────────────────────────────────── */}
      {activeTab === 'assessments' && (
        <div style={{ padding: '24px' }}>
          {['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'].includes(userRole) ? (
            <>
              {/* Assessment Cards */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 16,
                marginBottom: 32,
              }}>
                {/* Pain Assessment */}
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Pain Assessment (NRS 0-10)</h3>
                      <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0 0' }}>Last: 14 Apr 08:00</p>
                    </div>
                    <div style={{ background: '#FFA500', color: 'white', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>OVERDUE</div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#FFA500', marginBottom: 12 }}>6/10</div>
                  <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>Next due: Now</p>
                  <button style={{
                    width: '100%',
                    padding: 10,
                    background: '#0055FF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}>
                    Assess Now
                  </button>
                </div>

                {/* Morse Fall Risk Scale */}
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Morse Fall Risk Scale</h3>
                      <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0 0' }}>Last: 14 Apr 06:00</p>
                    </div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#D32F2F', marginBottom: 8 }}>55 — HIGH RISK</div>
                  <div style={{ fontSize: 11, color: '#666', background: 'white', padding: 8, borderRadius: 4, marginBottom: 12 }}>
                    <p style={{ margin: '4px 0' }}>History: 25 • Diagnosis: 15 • Aid: 15 • IV/Heparin: 0 • Gait: 0 • Status: 0</p>
                  </div>
                  <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>Next due: Every shift</p>
                  <button style={{
                    width: '100%',
                    padding: 10,
                    background: '#0055FF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}>
                    Assess Now
                  </button>
                </div>

                {/* Braden Pressure Injury Scale */}
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Braden Pressure Injury</h3>
                      <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0 0' }}>Last: 13 Apr 20:00</p>
                    </div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#FFA500', marginBottom: 8 }}>16 — MILD RISK</div>
                  <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>Next due: Daily</p>
                  <button style={{
                    width: '100%',
                    padding: 10,
                    background: '#0055FF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}>
                    Assess Now
                  </button>
                </div>

                {/* Nutritional Screening */}
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Nutritional Screening</h3>
                    </div>
                    <div style={{ fontSize: 18 }}>✅</div>
                  </div>
                  <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>Status: Completed on admission</p>
                  <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>Result: At risk — dietitian referral made</p>
                </div>

                {/* Nursing Admission Assessment */}
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Nursing Admission Assessment</h3>
                    </div>
                    <div style={{ fontSize: 18 }}>✅</div>
                  </div>
                  <p style={{ fontSize: 12, color: '#666', margin: '8px 0' }}>Completed: 11 Apr 09:30</p>
                </div>
              </div>

              {/* Assessment History */}
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#002054', marginBottom: 12 }}>Assessment History</h3>
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  overflowX: 'auto',
                }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                  }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #e0e0e0' }}>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Date</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Type</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Score</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Risk Level</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Assessed By</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>14 Apr 08:00</td>
                        <td style={{ padding: '12px', color: '#666' }}>Pain (NRS)</td>
                        <td style={{ padding: '12px', color: '#666' }}>6/10</td>
                        <td style={{ padding: '12px' }}><span style={{ background: '#FFA500', color: 'white', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>AMBER</span></td>
                        <td style={{ padding: '12px', color: '#666' }}>Nurse Priya</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>14 Apr 06:00</td>
                        <td style={{ padding: '12px', color: '#666' }}>Morse Fall Risk</td>
                        <td style={{ padding: '12px', color: '#666' }}>55</td>
                        <td style={{ padding: '12px' }}><span style={{ background: '#D32F2F', color: 'white', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>HIGH</span></td>
                        <td style={{ padding: '12px', color: '#666' }}>Nurse Rajesh</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>13 Apr 20:00</td>
                        <td style={{ padding: '12px', color: '#666' }}>Braden Scale</td>
                        <td style={{ padding: '12px', color: '#666' }}>16</td>
                        <td style={{ padding: '12px' }}><span style={{ background: '#FFA500', color: 'white', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>AMBER</span></td>
                        <td style={{ padding: '12px', color: '#666' }}>Nurse Priya</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>13 Apr 18:00</td>
                        <td style={{ padding: '12px', color: '#666' }}>Pain (NRS)</td>
                        <td style={{ padding: '12px', color: '#666' }}>4/10</td>
                        <td style={{ padding: '12px' }}><span style={{ background: '#0B8A3E', color: 'white', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>GREEN</span></td>
                        <td style={{ padding: '12px', color: '#666' }}>Nurse Rajesh</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '12px', color: '#666' }}>13 Apr 12:00</td>
                        <td style={{ padding: '12px', color: '#666' }}>Morse Fall Risk</td>
                        <td style={{ padding: '12px', color: '#666' }}>50</td>
                        <td style={{ padding: '12px' }}><span style={{ background: '#D32F2F', color: 'white', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>HIGH</span></td>
                        <td style={{ padding: '12px', color: '#666' }}>Nurse Priya</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: '#666',
            }}>
              <p style={{ fontSize: 16, fontWeight: 600 }}>Assessments</p>
              <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>
                Assessments are managed by nursing staff.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: BILLING ───────────────────────────────────────────────────────── */}
      {activeTab === 'billing' && (
        <div style={{ padding: '24px' }}>
          {['billing_manager', 'billing_executive', 'insurance_coordinator', 'visiting_consultant'].includes(userRole) ? (
            <>
              {/* Billing Summary Cards */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                marginBottom: 24,
              }}>
                <div style={{
                  background: '#002054',
                  color: 'white',
                  padding: 16,
                  borderRadius: 8,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px 0' }}>Running Bill</p>
                  <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>₹2,45,000</p>
                </div>
                <div style={{
                  background: '#0B8A3E',
                  color: 'white',
                  padding: 16,
                  borderRadius: 8,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px 0' }}>Deposit Paid</p>
                  <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>₹50,000</p>
                </div>
                <div style={{
                  background: '#0055FF',
                  color: 'white',
                  padding: 16,
                  borderRadius: 8,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px 0' }}>Pre-Auth Approved</p>
                  <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>₹3,00,000</p>
                  <p style={{ fontSize: 11, margin: '4px 0 0 0' }}>Star Health</p>
                </div>
                <div style={{
                  background: '#0B8A3E',
                  color: 'white',
                  padding: 16,
                  borderRadius: 8,
                }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px 0' }}>Balance Available</p>
                  <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>₹1,05,000</p>
                </div>
              </div>

              {/* Charge Breakdown */}
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#002054', marginBottom: 12 }}>Charge Breakdown</h3>
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  overflowX: 'auto',
                }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                  }}>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>Room Charges (3 days × ₹5,000)</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹15,000</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>OT Charges (CABG)</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹1,20,000</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>Anaesthesia</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹35,000</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>Medications</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹28,500</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>Lab Investigations</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹18,200</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px', color: '#666' }}>Consumables & Implants</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹22,300</td>
                      </tr>
                      <tr style={{ background: '#f5f5f5' }}>
                        <td style={{ padding: '12px', color: '#666' }}>Professional Fees</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹6,000</td>
                      </tr>
                      <tr style={{ background: '#f5f5f5', borderTop: '2px solid #002054' }}>
                        <td style={{ padding: '12px', fontWeight: 600, color: '#002054' }}>Total</td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: '#002054', fontSize: 14 }}>₹2,45,000</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Insurance Details */}
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#002054', marginBottom: 12 }}>Insurance Details</h3>
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <p style={{ fontSize: 12, color: '#666', margin: '0 0 4px 0' }}>TPA</p>
                      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Star Health & Allied Insurance</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 12, color: '#666', margin: '0 0 4px 0' }}>Policy #</p>
                      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>SH-2024-87654321</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 12, color: '#666', margin: '0 0 4px 0' }}>Pre-Auth Status</p>
                      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>✅ Approved ₹3,00,000</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 12, color: '#666', margin: '0 0 4px 0' }}>Enhancement</p>
                      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Not Required</p>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <p style={{ fontSize: 12, color: '#666', margin: '0 0 4px 0' }}>Estimated Shortfall</p>
                      <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#0B8A3E' }}>None (₹1,05,000 headroom)</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment History */}
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#002054', marginBottom: 12 }}>Payment History</h3>
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  overflowX: 'auto',
                }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                  }}>
                    <thead>
                      <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #e0e0e0' }}>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Date</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Type</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Amount</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '12px', color: '#666' }}>11 Apr</td>
                        <td style={{ padding: '12px', color: '#666' }}>Deposit</td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>₹50,000</td>
                        <td style={{ padding: '12px', color: '#666' }}>UPI</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: '#666',
            }}>
              <p style={{ fontSize: 16, fontWeight: 600 }}>Billing Information</p>
              <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>
                Billing information is restricted.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: JOURNEY ──────────────────────────────────────────────────────── */}
      {activeTab === 'journey' && (
        <div style={{ padding: '24px' }}>
          {['billing_manager', 'billing_executive', 'insurance_coordinator', 'resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon', 'anaesthetist'].includes(userRole) ? (
            <>
              {/* Journey Timeline */}
              <div style={{ marginBottom: 32 }}>
                {/* Phase 1 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#0B8A3E',
                    border: '2px solid #0B8A3E',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>✓</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #0B8A3E',
                    borderRadius: 6,
                    padding: 16,
                    background: '#f5f5f5',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Phase 1: Pre-Admission</h3>
                      <span style={{ fontSize: 11, color: '#0B8A3E', fontWeight: 600 }}>✓ 10 Apr (2 days)</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0' }}>Financial Counselling ✓ • Estimation Sheet ✓ • OT Slot ✓ • PAC ✓ • Pre-Auth ✓</p>
                  </div>
                </div>

                {/* Phase 2 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#0B8A3E',
                    border: '2px solid #0B8A3E',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>✓</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #0B8A3E',
                    borderRadius: 6,
                    padding: 16,
                    background: '#f5f5f5',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Phase 2: Admission</h3>
                      <span style={{ fontSize: 11, color: '#0B8A3E', fontWeight: 600 }}>✓ 11 Apr 09:45</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0' }}>Arrival ✓ • UHID ✓ • Demographics ✓ • Advice ✓ • Room ✓ • Consent ✓ • Ward Intimation ✓ • Transport ✓</p>
                  </div>
                </div>

                {/* Phase 3 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#0B8A3E',
                    border: '2px solid #0B8A3E',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>✓</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #0B8A3E',
                    borderRadius: 6,
                    padding: 16,
                    background: '#f5f5f5',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Phase 3: Clinical Assessment</h3>
                      <span style={{ fontSize: 11, color: '#0B8A3E', fontWeight: 600 }}>✓ 11 Apr 12:00</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0' }}>Nursing Assessment ✓ • Medical Assessment ✓ • Care Plan ✓ • Nursing Board ✓</p>
                  </div>
                </div>

                {/* Phase 4 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#0B8A3E',
                    border: '2px solid #0B8A3E',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>✓</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #0B8A3E',
                    borderRadius: 6,
                    padding: 16,
                    background: '#f5f5f5',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Phase 4: Pre-Op</h3>
                      <span style={{ fontSize: 11, color: '#0B8A3E', fontWeight: 600 }}>✓ 11 Apr 13:30</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0' }}>Investigations ✓ • PAC Clearance ✓ • Financial Clearance ✓ • Pre-Op Checklist ✓ • OT List ✓</p>
                  </div>
                </div>

                {/* Phase 5 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#0B8A3E',
                    border: '2px solid #0B8A3E',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>✓</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #0B8A3E',
                    borderRadius: 6,
                    padding: 16,
                    background: '#f5f5f5',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Phase 5: Intra-Op</h3>
                      <span style={{ fontSize: 11, color: '#0B8A3E', fontWeight: 600 }}>✓ 11 Apr 18:20</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0' }}>Patient Receiving ✓ • Anaesthesia ✓ • WHO Time-Out ✓ • CABG ×3 (4h 20min) ✓ • Sign-Out ✓ • Transfer to Recovery ✓</p>
                  </div>
                </div>

                {/* Phase 6 - Current */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#0055FF',
                    border: '2px solid #0055FF',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                    animation: 'pulse 2s infinite',
                  }}>●</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #0055FF',
                    borderRadius: 6,
                    padding: 16,
                    background: '#f0f7ff',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#002054' }}>Phase 6: Post-Op</h3>
                      <span style={{ fontSize: 11, background: '#0055FF', color: 'white', padding: '2px 8px', borderRadius: 3, fontWeight: 600 }}>IN PROGRESS (Day 3)</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0' }}>Recovery (Aldrete) ✓ • Ward Transfer ✓ • Post-Op Assessment ✓ • Surgeon Review ✓</p>
                    <p style={{ fontSize: 12, color: '#0055FF', margin: '8px 0 0 0', fontWeight: 600 }}>Current: Daily monitoring (vitals, meds, physiotherapy)</p>
                  </div>
                </div>

                {/* Phase 7 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#e0e0e0',
                    border: '2px solid #e0e0e0',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>○</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #e0e0e0',
                    borderRadius: 6,
                    padding: 16,
                    background: '#fafafa',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#666' }}>Phase 7: Ward Care</h3>
                      <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>PENDING</span>
                    </div>
                  </div>
                </div>

                {/* Phase 8 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#e0e0e0',
                    border: '2px solid #e0e0e0',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>○</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #e0e0e0',
                    borderRadius: 6,
                    padding: 16,
                    background: '#fafafa',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#666' }}>Phase 8: Discharge</h3>
                      <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>PENDING</span>
                    </div>
                  </div>
                </div>

                {/* Phase 9 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: '#e0e0e0',
                    border: '2px solid #e0e0e0',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: 18,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>○</div>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderLeft: '4px solid #e0e0e0',
                    borderRadius: 6,
                    padding: 16,
                    background: '#fafafa',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#666' }}>Phase 9: Billing Closure</h3>
                      <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>PENDING</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons (for IP Coordinator / Billing roles) */}
              {['billing_manager', 'billing_executive', 'insurance_coordinator'].includes(userRole) && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 12,
                  marginTop: 24,
                }}>
                  <button style={{
                    padding: 12,
                    background: '#0055FF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#003DBF')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#0055FF')}
                  >
                    Advance to Phase 7
                  </button>
                  <button style={{
                    padding: 12,
                    background: '#D32F2F',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#B71C1C')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#D32F2F')}
                  >
                    Flag Issue
                  </button>
                  <button style={{
                    padding: 12,
                    background: '#666',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#555')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#666')}
                  >
                    Transfer Patient
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: '#666',
            }}>
              <p style={{ fontSize: 16, fontWeight: 600 }}>Journey</p>
              <p style={{ fontSize: 13, color: '#999', marginTop: 8 }}>
                Journey information is restricted.
              </p>
            </div>
          )}
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

      {/* ── SLIDE-IN PANELS FOR ORDERS ──────────────────────────────────────── */}

      {/* Backdrop Overlay */}
      {orderPanel !== 'none' && (
        <div
          onClick={() => setOrderPanel('none')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 999,
          }}
        />
      )}

      {/* Medication Panel */}
      {orderPanel === 'medication' && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: 420,
          height: '100vh',
          background: 'white',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
          zIndex: 1000,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#002054' }}>Prescribe Medication</h2>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 24,
                cursor: 'pointer',
                color: '#666',
                padding: 0,
                width: 32,
                height: 32,
              }}
            >
              ×
            </button>
          </div>

          {/* Form */}
          <div style={{
            padding: '20px',
            flex: 1,
            overflowY: 'auto',
          }}>
            {/* Drug Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Drug Name
              </label>
              <input
                type="text"
                placeholder="Search drug name..."
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              />
            </div>

            {/* Dose */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Dose
              </label>
              <input
                type="text"
                placeholder="e.g., 25mg, 500mg"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              />
            </div>

            {/* Route */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Route
              </label>
              <select
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              >
                <option>PO</option>
                <option>IV</option>
                <option>SC</option>
                <option>IM</option>
                <option>PR</option>
                <option>Topical</option>
                <option>Inhaled</option>
                <option>Sublingual</option>
              </select>
            </div>

            {/* Frequency */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Frequency
              </label>
              <select
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              >
                <option>OD</option>
                <option>BD</option>
                <option>TDS</option>
                <option>QDS</option>
                <option>Q4H</option>
                <option>Q6H</option>
                <option>Q8H</option>
                <option>Q12H</option>
                <option>PRN</option>
                <option>STAT</option>
                <option>Once</option>
              </select>
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Duration
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="e.g., 5 days, 2 weeks"
                  style={{
                    flex: 1,
                    height: 40,
                    padding: '8px 12px',
                    fontSize: 13,
                    border: '1px solid #d0d0d0',
                    borderRadius: 6,
                    boxSizing: 'border-box',
                    fontFamily: 'system-ui',
                  }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#333', cursor: 'pointer' }}>
                <input type="checkbox" style={{ cursor: 'pointer' }} />
                Until discharge
              </label>
            </div>

            {/* PRN Instructions */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                PRN Instructions (if applicable)
              </label>
              <input
                type="text"
                placeholder="e.g., for pain &gt; 5"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              />
            </div>

            {/* Start */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Start
              </label>
              <select
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              >
                <option>Now</option>
                <option>Next dose time</option>
                <option>Tomorrow</option>
              </select>
            </div>

            {/* Special Instructions */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Special Instructions
              </label>
              <textarea
                placeholder="Any special instructions..."
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Safety Checks */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, margin: '0 0 12px', color: '#333' }}>Safety Checks</h4>

              {/* Allergy Warning */}
              <div style={{
                padding: 12,
                background: '#FEE2E2',
                border: '1px solid #FCA5A5',
                borderRadius: 6,
                marginBottom: 8,
              }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, color: '#DC2626' }}>
                  ⚠️ ALLERGY: Patient is allergic to Penicillin (SEVERE)
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#991B1B' }}>
                  Drug class match would be flagged here
                </p>
              </div>

              {/* DDI Warning */}
              <div style={{
                padding: 12,
                background: '#FEF3C7',
                border: '1px solid #FCD34D',
                borderRadius: 6,
                marginBottom: 8,
              }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, color: '#D97706' }}>
                  ⚠️ DDI: Potential interaction with existing medication
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#92400E' }}>
                  Severity: Moderate
                </p>
              </div>

              {/* Renal Warning */}
              <div style={{
                padding: 12,
                background: '#DBEAFE',
                border: '1px solid #93C5FD',
                borderRadius: 6,
              }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, color: '#0055FF' }}>
                  ℹ️ Renal: eGFR 38
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#1E40AF' }}>
                  Dose adjustment may be needed
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid #e0e0e0',
            display: 'flex',
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                flex: 1,
                height: 40,
                background: '#f0f0f0',
                border: 'none',
                color: '#333',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                alert('Medication order placed successfully!');
                setOrderPanel('none');
              }}
              style={{
                flex: 1,
                height: 40,
                background: '#0055FF',
                border: 'none',
                color: 'white',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Prescribe
            </button>
          </div>
        </div>
      )}

      {/* Labs Panel */}
      {orderPanel === 'labs' && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: 420,
          height: '100vh',
          background: 'white',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
          zIndex: 1000,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#002054' }}>Order Labs</h2>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 24,
                cursor: 'pointer',
                color: '#666',
                padding: 0,
                width: 32,
                height: 32,
              }}
            >
              ×
            </button>
          </div>

          {/* Form */}
          <div style={{
            padding: '20px',
            flex: 1,
            overflowY: 'auto',
          }}>
            {/* Quick-select chips */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 12, color: '#333' }}>
                Quick Select
              </label>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                {['CBC', 'RFT', 'LFT', 'Coagulation', 'Electrolytes', 'Blood Gas', 'Cardiac Markers', 'HbA1c', 'Thyroid', 'Cultures'].map((chip) => (
                  <button
                    key={chip}
                    style={{
                      padding: '6px 12px',
                      background: '#EFF6FF',
                      border: '1px solid #0055FF',
                      color: '#0055FF',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Search Tests
              </label>
              <input
                type="text"
                placeholder="Search individual test..."
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              />
            </div>

            {/* Selected Tests */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#333' }}>
                Selected Tests
              </label>
              <div style={{
                background: '#f9f9f9',
                border: '1px solid #e0e0e0',
                borderRadius: 6,
                padding: '12px',
                minHeight: 60,
              }}>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: '#666' }}>
                  CBC, RFT, Coagulation
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#999' }}>
                  (Select tests above to add them)
                </p>
              </div>
            </div>

            {/* Priority */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#333' }}>
                Priority
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  style={{
                    flex: 1,
                    height: 40,
                    background: '#ECFDF5',
                    border: '1px solid #0B8A3E',
                    color: '#0B8A3E',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Routine
                </button>
                <button
                  style={{
                    flex: 1,
                    height: 40,
                    background: '#FEE2E2',
                    border: '1px solid #DC2626',
                    color: '#DC2626',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  STAT
                </button>
              </div>
            </div>

            {/* Clinical Indication */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Clinical Indication
              </label>
              <textarea
                placeholder="e.g., Baseline before chemotherapy..."
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                  resize: 'vertical',
                }}
              />
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid #e0e0e0',
            display: 'flex',
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                flex: 1,
                height: 40,
                background: '#f0f0f0',
                border: 'none',
                color: '#333',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                alert('Lab order placed successfully!');
                setOrderPanel('none');
              }}
              style={{
                flex: 1,
                height: 40,
                background: '#0055FF',
                border: 'none',
                color: 'white',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Place Order
            </button>
          </div>
        </div>
      )}

      {/* Imaging Panel */}
      {orderPanel === 'imaging' && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: 420,
          height: '100vh',
          background: 'white',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
          zIndex: 1000,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#002054' }}>Order Imaging</h2>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 24,
                cursor: 'pointer',
                color: '#666',
                padding: 0,
                width: 32,
                height: 32,
              }}
            >
              ×
            </button>
          </div>

          {/* Form */}
          <div style={{
            padding: '20px',
            flex: 1,
            overflowY: 'auto',
          }}>
            {/* Modality */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Modality
              </label>
              <select
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              >
                <option>X-Ray</option>
                <option>CT</option>
                <option>MRI</option>
                <option>Ultrasound</option>
                <option>Echo</option>
                <option>Fluoroscopy</option>
              </select>
            </div>

            {/* Body Part / Region */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Body Part / Region
              </label>
              <input
                type="text"
                placeholder="e.g., Chest PA, Abdomen"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              />
            </div>

            {/* Clinical Indication */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Clinical Indication
              </label>
              <textarea
                placeholder="e.g., Fever, SOB, chest pain..."
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Priority */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#333' }}>
                Priority
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  style={{
                    flex: 1,
                    height: 40,
                    background: '#ECFDF5',
                    border: '1px solid #0B8A3E',
                    color: '#0B8A3E',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Routine
                </button>
                <button
                  style={{
                    flex: 1,
                    height: 40,
                    background: '#FEE2E2',
                    border: '1px solid #DC2626',
                    color: '#DC2626',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Urgent
                </button>
              </div>
            </div>

            {/* Special Instructions */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Special Instructions
              </label>
              <textarea
                placeholder="Any special instructions..."
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                  resize: 'vertical',
                }}
              />
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid #e0e0e0',
            display: 'flex',
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                flex: 1,
                height: 40,
                background: '#f0f0f0',
                border: 'none',
                color: '#333',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                alert('Imaging order placed successfully!');
                setOrderPanel('none');
              }}
              style={{
                flex: 1,
                height: 40,
                background: '#0055FF',
                border: 'none',
                color: 'white',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Place Order
            </button>
          </div>
        </div>
      )}

      {/* Consult Panel */}
      {orderPanel === 'consult' && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: 420,
          height: '100vh',
          background: 'white',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
          zIndex: 1000,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#002054' }}>Request Consult</h2>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 24,
                cursor: 'pointer',
                color: '#666',
                padding: 0,
                width: 32,
                height: 32,
              }}
            >
              ×
            </button>
          </div>

          {/* Form */}
          <div style={{
            padding: '20px',
            flex: 1,
            overflowY: 'auto',
          }}>
            {/* Specialty */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Specialty
              </label>
              <select
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                }}
              >
                <option>Cardiology</option>
                <option>Nephrology</option>
                <option>Pulmonology</option>
                <option>Neurology</option>
                <option>General Surgery</option>
                <option>Orthopedics</option>
                <option>ENT</option>
                <option>Ophthalmology</option>
                <option>Dermatology</option>
                <option>Urology</option>
                <option>Oncology</option>
                <option>Psychiatry</option>
                <option>Physiotherapy</option>
                <option>Dietetics</option>
              </select>
            </div>

            {/* Urgency */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#333' }}>
                Urgency
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  style={{
                    height: 40,
                    background: '#ECFDF5',
                    border: '1px solid #0B8A3E',
                    color: '#0B8A3E',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Routine 6-12h
                </button>
                <button
                  style={{
                    height: 40,
                    background: '#FEF3C7',
                    border: '1px solid #D97706',
                    color: '#D97706',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Urgent &lt;30min
                </button>
                <button
                  style={{
                    height: 40,
                    background: '#FEE2E2',
                    border: '1px solid #DC2626',
                    color: '#DC2626',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Emergency
                </button>
              </div>
            </div>

            {/* Clinical Question */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Clinical Question
              </label>
              <textarea
                placeholder="e.g., Rising creatinine, possible AKI. Please evaluate."
                style={{
                  width: '100%',
                  minHeight: 100,
                  padding: '8px 12px',
                  fontSize: 13,
                  border: '1px solid #d0d0d0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontFamily: 'system-ui',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Relevant Findings */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#333' }}>
                Relevant Findings
              </label>
              <div style={{
                background: '#f9f9f9',
                border: '1px solid #e0e0e0',
                borderRadius: 6,
                padding: '12px',
                fontSize: 12,
                fontFamily: "'SF Mono', Menlo, monospace",
                color: '#666',
                minHeight: 60,
              }}>
                <p style={{ margin: 0 }}>Cr 1.8↑, eGFR 38↓, BUN 28↑</p>
                <p style={{ margin: '4px 0 0' }}>On Enoxaparin</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid #e0e0e0',
            display: 'flex',
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setOrderPanel('none')}
              style={{
                flex: 1,
                height: 40,
                background: '#f0f0f0',
                border: 'none',
                color: '#333',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                alert('Consult request sent successfully!');
                setOrderPanel('none');
              }}
              style={{
                flex: 1,
                height: 40,
                background: '#0055FF',
                border: 'none',
                color: 'white',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send Consult
            </button>
          </div>
        </div>
      )}

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
