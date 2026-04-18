'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertBanner } from '@/components/caregiver';
import DischargeChecklist from '@/components/discharge/DischargeChecklist';
import { FormHistoryPanel } from '@/components/forms/FormHistoryPanel';
import FormLauncher from '@/components/forms/FormLauncher';
import ProblemForm from '@/components/conditions/ProblemForm';
import LabsTab from '@/components/patient-chart/LabsTab';
import DocumentsTab from '@/components/patient-chart/DocumentsTab';
import NotesTab from '@/components/patient-chart/NotesTab';
import BriefTab from '@/components/patient-brief/BriefTab';
import CalculatorsTab from '@/components/patient-chart/CalculatorsTab';
import { SensitiveText } from '@/components/patient-chart/SensitiveText';
import OverviewCalculatorsCard from '@/components/patient-chart/OverviewCalculatorsCard';
import ChatPanel, { type Channel as ChatChannel } from '@/components/chat/ChatPanel';
import { useChartAction, getActionsForRole, resolveActionsFromSlugs } from './use-chart-action';
import { useLock, LockBanner } from './use-lock';
import type { ChartConfig } from '@/lib/chart/selectors';

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
  if (json.error) {
    const msg = json.error?.message || json.error?.json?.message || 'Operation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface PatientData {
  id: string;
  uhid: string;
  full_name?: string;
  name_full?: string;
  name_given?: string;
  name_family?: string;
  date_of_birth?: string;
  dob?: string;
  sex?: string;
  gender?: string;
  phone_number?: string;
  phone?: string;
  primary_diagnosis?: string;
  [key: string]: any;
}

interface EncounterData {
  id: string;
  patient_id: string;
  admission_at: string;
  admission_date?: string; // alias
  bed_code: string;
  bed_name: string;
  ward_code: string;
  ward_name: string;
  assigned_bed?: string; // alias
  attending_practitioner_id: string;
  attending_physician_id?: string; // alias
  attending_physician_name?: string; // alias
  chief_complaint: string;
  preliminary_diagnosis_icd10: string;
  encounter_class: string;
  diet_type: string;
  expected_los_days: number;
  pre_auth_status: string;
  [key: string]: any;
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

type PatientTab = 'overview' | 'vitals' | 'labs' | 'orders' | 'notes' | 'plan' | 'emar' | 'assessments' | 'billing' | 'journey' | 'forms' | 'documents' | 'brief' | 'calculators';

// ── Unified Orders types (PC.1b1) ──────────────────────────────────────────
// All order sources (medication_requests, service_requests, clinical_orders)
// normalise into this shape for the Orders tab.
type OrderTypeFilter = 'all' | 'medication' | 'lab' | 'imaging' | 'consult' | 'referral' | 'nursing' | 'diet' | 'procedure' | 'other';
type OrderStatusBucket = 'all' | 'active' | 'completed' | 'cancelled';
interface UnifiedOrder {
  id: string;
  source: 'medication' | 'service_request' | 'clinical_order';
  type: string;                // medication | lab | imaging | consult | referral | nursing | diet | procedure | pharmacy | radiology | other
  title: string;
  subtitle: string;
  status: string;              // raw status from the source
  priority: string | null;
  orderedAt: string | null;    // ISO
  orderedBy: string | null;    // display name
  isHighAlert?: boolean;
  isNarcotic?: boolean;
  isPrn?: boolean;
}

interface Props {
  patientId: string;
  userId: string;
  userRole: string;
  userName: string;
  hospitalId: string;
  /** PC.3.1 — server-side projection result. When `source === 'matrix'` the
   *  client should prefer config.tabs / overview_layout / action_bar_preset
   *  over the inline fallbacks. In PC.3.1 the prop is threaded but inline
   *  fallbacks still drive the UI (no visible change); PC.3.2 activates it. */
  chartConfig?: ChartConfig;
}

// ── Role-specific tab config ────────────────────────────────────────────────
// PC.3.2.1 (18 Apr 2026): canonical catalog of every possible tab. When
// chartConfig.tabs is present (source='matrix'), we filter this catalog by
// those ids so the matrix is authoritative. Inline fallback in getTabsForRole
// below stays as the safety net when chartConfig is missing/empty.
const TAB_CATALOG: Record<string, { label: string; id: PatientTab; icon: string }> = {
  overview:    { label: 'Overview',         id: 'overview',    icon: '📋' },
  vitals:      { label: 'Vitals',           id: 'vitals',      icon: '📊' },
  emar:        { label: 'eMAR',             id: 'emar',        icon: '💊' },
  assessments: { label: 'Assessments',      id: 'assessments', icon: '✅' },
  labs:        { label: 'Labs & Results',   id: 'labs',        icon: '🧪' },
  orders:      { label: 'Orders',           id: 'orders',      icon: '📋' },
  notes:       { label: 'Notes',            id: 'notes',       icon: '📝' },
  plan:        { label: 'Care Plan',        id: 'plan',        icon: '🗺️' },
  journey:     { label: 'Journey',          id: 'journey',     icon: '🗓️' },
  brief:       { label: 'Brief',            id: 'brief',       icon: '🧠' },
  calculators: { label: 'Calculators',      id: 'calculators', icon: '🧮' },
  documents:   { label: 'Documents',        id: 'documents',   icon: '📁' },
  forms:       { label: 'Forms',            id: 'forms',       icon: '📋' },
  billing:     { label: 'Billing',          id: 'billing',     icon: '💳' },
};

// Resolve tab list: matrix-driven when chartConfig.tabs is populated,
// inline fallback otherwise. Preserves the order in chartConfig.tabs.
function resolveTabs(
  role: string,
  chartConfig?: ChartConfig | null
): { label: string; id: PatientTab; icon: string }[] {
  if (chartConfig?.tabs && chartConfig.tabs.length > 0 && chartConfig.source === 'matrix') {
    const resolved = chartConfig.tabs
      .map(id => TAB_CATALOG[id])
      .filter((t): t is NonNullable<typeof t> => !!t);
    if (resolved.length > 0) return resolved;
  }
  return getTabsForRole(role);
}

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
      { label: 'Brief', id: 'brief', icon: '🧠' },
      { label: 'Calculators', id: 'calculators', icon: '🧮' },
      { label: 'Documents', id: 'documents', icon: '📁' },
      { label: 'Forms', id: 'forms', icon: '📋' },
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
      { label: 'Brief', id: 'brief', icon: '🧠' },
      { label: 'Calculators', id: 'calculators', icon: '🧮' },
      { label: 'Documents', id: 'documents', icon: '📁' },
      { label: 'Forms', id: 'forms', icon: '📋' },
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
    { label: 'Brief', id: 'brief', icon: '🧠' },
    { label: 'Calculators', id: 'calculators', icon: '🧮' },
    { label: 'Documents', id: 'documents', icon: '📁' },
    { label: 'Forms', id: 'forms', icon: '📋' },
  ];
}

// ── Floating action buttons for role ────────────────────────────────────────
// PC.1b1 (18 Apr 2026): role-to-pill mapping moved to use-chart-action.ts
// so the registry is shared with the action handler (single source of truth).
// PC.3.2.2 (18 Apr 2026): if chartConfig.action_bar_preset is provided by
// the matrix, resolve slugs → pills. Safe fallback to inline role preset
// if any slug is unknown (e.g., 'verify_order' for pharmacist not yet in
// CHART_ACTIONS registry). This keeps the matrix authoritative where it
// can be, and the inline preset authoritative everywhere else.
function getActionButtonsForRole(role: string): { label: string; icon: string }[] {
  return getActionsForRole(role);
}

function resolveActionButtons(
  role: string,
  chartConfig?: ChartConfig | null
): { label: string; icon: string }[] {
  if (chartConfig?.source === 'matrix' && chartConfig.action_bar_preset) {
    const primary = chartConfig.action_bar_preset.primary || [];
    const resolved = resolveActionsFromSlugs(primary);
    if (resolved && resolved.length > 0) return resolved;
    // Any unknown slug → safe fallback to inline preset
  }
  return getActionsForRole(role);
}

// ── Timeline event categories ─────────────────────────────────────────────
type TimelineCategory = 'escalation' | 'medication' | 'lab' | 'vitals' | 'note' | 'order' | 'procedure' | 'assessment' | 'handoff' | 'alert';

interface TimelineEvent {
  id: string;
  time: string;         // "08:45"
  timestamp: number;    // epoch ms — for sorting
  title: string;
  description: string;
  category: TimelineCategory;
  source?: string;      // originating tab to deep-link to
}

const TIMELINE_CATEGORY_META: Record<TimelineCategory, { color: string; icon: string; label: string }> = {
  escalation:  { color: '#DC2626', icon: '🚨', label: 'Escalations' },
  medication:  { color: '#0B8A3E', icon: '💊', label: 'Medications' },
  lab:         { color: '#D97706', icon: '🧪', label: 'Lab Results' },
  vitals:      { color: '#7C3AED', icon: '📊', label: 'Vitals' },
  note:        { color: '#0055FF', icon: '📝', label: 'Notes' },
  order:       { color: '#059669', icon: '📋', label: 'Orders' },
  procedure:   { color: '#DB2777', icon: '🔬', label: 'Procedures' },
  assessment:  { color: '#6366F1', icon: '✅', label: 'Assessments' },
  handoff:     { color: '#64748B', icon: '🔄', label: 'Handoffs' },
  alert:       { color: '#EA580C', icon: '⚠️', label: 'Alerts' },
};

/** Synthesise a unified timeline from real patient data.
 *  Falls back to demo data when no real events are available. */
function synthesizeTimeline(
  vitals: VitalData[],
  medications: MedicationData[],
  notes: NoteData[],
  allergies: AllergyData[],
  news2Score: number | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const fmt = (d: Date): string => {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hr}:${m} ${ampm}`;
  };

  // NEWS2 escalation (if score ≥ 5)
  if (news2Score !== null && news2Score >= 5) {
    events.push({
      id: 'news2-esc',
      time: fmt(new Date()),
      timestamp: Date.now(),
      title: 'NEWS2 Escalation',
      description: `Score ${news2Score}${news2Score >= 7 ? ' — Urgent clinical review' : ' — Increased monitoring'}`,
      category: 'escalation',
      source: 'vitals',
    });
  }

  // Vitals
  const vitalsByTime: Record<string, VitalData[]> = {};
  vitals.forEach(v => {
    const key = v.effective_datetime;
    (vitalsByTime[key] = vitalsByTime[key] || []).push(v);
  });
  Object.entries(vitalsByTime).forEach(([dt, vGroup]) => {
    const d = new Date(dt);
    const labels = vGroup.map(v => {
      const label = v.observation_type.replace('vital_', '').replace(/_/g, ' ').toUpperCase();
      return `${label}: ${v.value}${v.unit || ''}`;
    });
    events.push({
      id: `vitals-${dt}`,
      time: fmt(d),
      timestamp: d.getTime(),
      title: 'Vitals Recorded',
      description: labels.join(', '),
      category: 'vitals',
      source: 'vitals',
    });
  });

  // Medications
  medications.forEach(m => {
    const d = m.scheduled_time ? new Date(m.scheduled_time) : new Date();
    const statusLabel = m.status === 'given' ? 'Given' : m.status === 'overdue' ? 'OVERDUE' : m.status === 'due' ? 'Due' : m.status;
    events.push({
      id: `med-${m.id}`,
      time: fmt(d),
      timestamp: d.getTime(),
      title: m.status === 'overdue' ? 'Overdue Medication' : m.status === 'given' ? 'Medication Given' : 'Medication Scheduled',
      description: `${m.medication_name} ${m.dose} ${m.route} — ${statusLabel}`,
      category: 'medication',
      source: 'emar',
    });
  });

  // Notes
  notes.forEach(n => {
    const d = new Date(n.created_at);
    events.push({
      id: `note-${n.id}`,
      time: fmt(d),
      timestamp: d.getTime(),
      title: n.note_type === 'soap' ? 'SOAP Note' : n.note_type === 'nursing' ? 'Nursing Note' : 'Progress Note',
      description: `${n.created_by}: ${(n.content || '').slice(0, 80)}${(n.content || '').length > 80 ? '…' : ''}`,
      category: 'note',
      source: 'notes',
    });
  });

  // Allergy alerts (static — shown once)
  if (allergies.length > 0) {
    events.push({
      id: 'allergy-alert',
      time: '',
      timestamp: Date.now() - 1000, // slightly earlier so escalation stays on top
      title: 'Active Allergies',
      description: allergies.map(a => `${a.allergen} (${a.severity})`).join(', '),
      category: 'alert',
    });
  }

  // Sort newest first
  events.sort((a, b) => b.timestamp - a.timestamp);

  // Fallback: hardcoded demo data when no real events exist
  if (events.length === 0) {
    const now = new Date();
    const demoEvents: Omit<TimelineEvent, 'id'>[] = [
      { time: '08:45 AM', timestamp: now.getTime() - 15 * 60000, title: 'NEWS2 Escalation', description: 'Score 8, SpO₂ dropping to 93%', category: 'escalation' },
      { time: '08:00 AM', timestamp: now.getTime() - 60 * 60000, title: 'Medication Given', description: 'Metoprolol 25mg PO (Nurse Priya)', category: 'medication' },
      { time: '07:30 AM', timestamp: now.getTime() - 90 * 60000, title: 'Progress Note', description: 'Dr. Sharma: reports reduced chest discomfort, vitals stable', category: 'note' },
      { time: '07:15 AM', timestamp: now.getTime() - 105 * 60000, title: 'Lab Results', description: 'CBC + RFT: Hb 10.2↓, Cr 1.8↑, INR 2.8↑', category: 'lab' },
      { time: '06:00 AM', timestamp: now.getTime() - 180 * 60000, title: 'Medication Given', description: 'Pantoprazole 40mg IV (Nurse Priya)', category: 'medication' },
      { time: '06:00 AM', timestamp: now.getTime() - 180 * 60000, title: 'Shift Handoff', description: 'Night → Day (SBAR completed)', category: 'handoff' },
      { time: '04:00 AM', timestamp: now.getTime() - 300 * 60000, title: 'PRN Medication', description: 'Morphine 2mg IV for pain 7/10', category: 'medication' },
      { time: '02:00 AM', timestamp: now.getTime() - 420 * 60000, title: 'Vitals Recorded', description: 'BP 138/82, HR 96, SpO₂ 93%, NEWS2=5', category: 'vitals' },
    ];
    return demoEvents.map((e, i) => ({ ...e, id: `demo-${i}` }));
  }

  return events;
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
  if (!dobString) return NaN;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return NaN;
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

// ── Main component ──────────────────────────────────────────────────────────
export default function PatientChartClient({ patientId, userId, userRole, userName, hospitalId, chartConfig }: Props) {
  const [activeTab, setActiveTab] = useState<PatientTab>('overview');

  // PC.3.1: projection result is threaded but not yet used for rendering.
  // Log once (dev-only) to confirm the matrix lookup reached the client.
  useEffect(() => {
    if (chartConfig && typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[PC.3.1] chartConfig source:', chartConfig.source, 'tabs:', chartConfig.tabs.length);
    }
  }, [chartConfig]);
  const [initialCalcId, setInitialCalcId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderPanel, setOrderPanel] = useState<'none' | 'medication' | 'labs' | 'imaging' | 'consult'>('none');
  // PC.1a: right-side Comms slider (480px), reuses ChatPanel. Opens to encounter-scoped channel by default.
  const [commsOpen, setCommsOpen] = useState(false);
  const [commsInitialChannelId, setCommsInitialChannelId] = useState<string | null>(null);
  const [showFormLauncher, setShowFormLauncher] = useState(false);
  const [formLauncherSlug, setFormLauncherSlug] = useState('');

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

  // Timeline filter state
  const [tlFilterOpen, setTlFilterOpen] = useState(false);
  const [tlSearch, setTlSearch] = useState('');
  const [tlActiveCategories, setTlActiveCategories] = useState<Set<TimelineCategory>>(
    new Set(Object.keys(TIMELINE_CATEGORY_META) as TimelineCategory[]),
  );
  const [tlExpandedId, setTlExpandedId] = useState<string | null>(null);
  const [tlShowCount, setTlShowCount] = useState(20);

  // Vitals form state
  const [vitalsForm, setVitalsForm] = useState({ bp_systolic: '', bp_diastolic: '', pulse: '', spo2: '', temperature: '', rr: '', pain_score: '' });
  const [vitalsSubmitting, setVitalsSubmitting] = useState(false);

  // Order form state
  const [medOrderForm, setMedOrderForm] = useState({ drug_name: '', dose: '', route: 'PO', frequency: 'QD', duration: '', prn_condition: '', instructions: '' });
  const [labOrderForm, setLabOrderForm] = useState({ panel_name: '', individual_tests: '', urgency: 'routine', clinical_indication: '', fasting: false, special_instructions: '' });
  const [imagingOrderForm, setImagingOrderForm] = useState({ study_name: '', clinical_indication: '', urgency: 'routine', special_instructions: '' });
  const [consultOrderForm, setConsultOrderForm] = useState({ specialty: '', reason: '', urgency: 'routine', clinical_summary: '' });
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  // eMAR state
  const [emarGiveModal, setEmarGiveModal] = useState<{ med_id: string; med_name: string; dose: string; route: string } | null>(null);
  const [emarHoldModal, setEmarHoldModal] = useState<{ med_id: string; med_name: string } | null>(null);
  const [emarRefuseModal, setEmarRefuseModal] = useState<{ med_id: string; med_name: string } | null>(null);
  const [emarAdminSite, setEmarAdminSite] = useState('');
  const [emarBarcode, setEmarBarcode] = useState('');
  const [emarHoldReason, setEmarHoldReason] = useState('');
  const [emarRefuseReason, setEmarRefuseReason] = useState('');

  // ── PC.1b2: eMAR edit lock ───────────────────────────────────────────────
  // Surface keyed by med_id so two nurses working on *different* meds don't
  // block each other. Active whenever any of the three eMAR modals is open.
  const activeEmarMedId =
    emarGiveModal?.med_id || emarHoldModal?.med_id || emarRefuseModal?.med_id || null;
  const emarLock = useLock({
    patient_id: patientId,
    encounter_id: encounter?.id || null,
    surface: activeEmarMedId ? `emar:${activeEmarMedId}` : 'emar:none',
    active: !!activeEmarMedId,
    reason: 'eMAR action',
  });
  const emarLocked = emarLock.status === 'conflict';

  // ── Plan tab state (lazy-loaded when tab becomes active) ──────────────────
  const [carePlans, setCarePlans] = useState<any[]>([]);
  const [planMilestones, setPlanMilestones] = useState<any[]>([]);
  const [planVariances, setPlanVariances] = useState<any[]>([]);
  const [planEscalations, setPlanEscalations] = useState<any[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [showAddProblemModal, setShowAddProblemModal] = useState(false);

  // ── Orders tab state (PC.1b1: real-data rewrite) ─────────────────────────
  // Merges medication_requests + service_requests + clinical_orders into one list.
  const [ordersList, setOrdersList] = useState<UnifiedOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  // D-05: per-source error tracking so a failing endpoint does not silently
  // masquerade as "no orders" — clinical-safety red banner (see render below).
  const [ordersErrors, setOrdersErrors] = useState<{ medication: string | null; services: string | null; clinical: string | null }>({
    medication: null, services: null, clinical: null,
  });
  const [ordersSearch, setOrdersSearch] = useState('');
  const [ordersTypeFilter, setOrdersTypeFilter] = useState<OrderTypeFilter>('all');
  const [ordersStatusFilter, setOrdersStatusFilter] = useState<OrderStatusBucket>('all');
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);


  const tabs = resolveTabs(userRole, chartConfig);
  const actionButtons = resolveActionButtons(userRole, chartConfig);

  // ── Load all data in parallel ────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      // D-07 / D-08 contract fix: the previous one-shot Promise.all called
      //   - observations.latestVitals  (actual proc is observations.getLatestVitals → 404)
      //   - medicationOrders.emarSchedule({patient_id}) (actual schema needs {encounter_id} → 400)
      // Both are now renamed + reshaped. emarSchedule depends on encounter_id so we
      // phase-load: phase 1 gets patient + active encounter, phase 2 fans out the rest.
      const [patientData, encounterData] = await Promise.all([
        trpcQuery('patient.get', { id: patientId }),
        trpcQuery('encounter.getActive', { patient_id: patientId }),
      ]);
      const _encId = (encounterData as any)?.id as string | undefined;

      const [vitalsData, allergiesData, conditionsData, medsData, notesData, journeyData] = await Promise.all([
        trpcQuery('observations.getLatestVitals', { patient_id: patientId }),
        trpcQuery('allergies.list', { patient_id: patientId }),
        trpcQuery('conditions.list', { patient_id: patientId }),
        _encId
          ? trpcQuery('medicationOrders.emarSchedule', { encounter_id: _encId })
          : Promise.resolve(null),
        trpcQuery('clinicalNotes.listNotes', { patient_id: patientId, limit: 5 }),
        trpcQuery('journeyEngine.getPatientJourney', { patient_id: patientId }),
      ]);

      setPatient(patientData || null);
      setEncounter(encounterData || null);
      // observations.getLatestVitals returns { success, vitals: { temperature: {value, unit, recorded_at} | null, pulse: ..., ... } }
      // Downstream renderers (line ~1013 + NEWS2 calc) expect an array of { observation_type, value, unit, effective_datetime }.
      let vitalsArr: VitalData[] = [];
      if (Array.isArray(vitalsData)) {
        vitalsArr = vitalsData as VitalData[];
      } else if (vitalsData?.vitals && typeof vitalsData.vitals === 'object') {
        vitalsArr = Object.entries(vitalsData.vitals)
          .filter(([_k, v]) => v !== null && v !== undefined)
          .map(([k, v]: [string, any]) => ({
            observation_type: `vital_${k}`,
            value: v.value,
            unit: v.unit,
            recorded_at: v.recorded_at,
            effective_datetime: v.recorded_at,
          }) as VitalData);
      }
      setVitals(vitalsArr);
      setAllergies(Array.isArray(allergiesData) ? allergiesData : (allergiesData?.items || []));
      setConditions(Array.isArray(conditionsData) ? conditionsData : (conditionsData?.items || []));
      setMedications(Array.isArray(medsData) ? medsData : (medsData?.medications || []));
      setNotes(Array.isArray(notesData) ? notesData : (notesData?.items || []));
      setJourney(journeyData || null);

      // Calculate NEWS2 from normalised vitals array
      if (vitalsArr.length > 0) {
        const vitalMap: Record<string, number> = {};
        vitalsArr.forEach((v: VitalData) => {
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

  // ── Plan tab lazy-loader ───────────────────────────────────────────────────
  const loadPlanData = useCallback(async () => {
    setPlanLoading(true);
    try {
      const [plans, variances, escalations] = await Promise.all([
        trpcQuery('carePathways.listCarePlans', { patient_id: patientId }),
        trpcQuery('carePathways.listVariancesByPatient', { patient_id: patientId, limit: 10 }),
        trpcQuery('carePathways.listEscalationsByPatient', { patient_id: patientId, limit: 10 }),
      ]);
      const plansList = Array.isArray(plans) ? plans : [];
      setCarePlans(plansList);
      setPlanVariances(Array.isArray(variances) ? variances : []);
      setPlanEscalations(Array.isArray(escalations) ? escalations : []);
      // Fetch milestones for the most recent active plan (if any)
      const activePlan = plansList.find((p: any) => p.care_plan_status === 'active') || plansList[0];
      if (activePlan?.id) {
        const detail = await trpcQuery('carePathways.getCarePlan', { care_plan_id: activePlan.id });
        setPlanMilestones(Array.isArray(detail?.milestones) ? detail.milestones : (Array.isArray(detail) ? detail : []));
      } else {
        setPlanMilestones([]);
      }
      setPlanLoaded(true);
    } catch (err) {
      console.error('Plan tab load error:', err);
    } finally {
      setPlanLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (activeTab === 'plan' && !planLoaded) loadPlanData();
  }, [activeTab, planLoaded, loadPlanData]);

  // ── Orders tab lazy-loader (PC.1b1) ───────────────────────────────────────
  const loadOrdersData = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersErrors({ medication: null, services: null, clinical: null });
    try {
      const encId = encounter?.id;
      // D-05: Promise.allSettled so one failed source doesn't blank the tab.
      // Each failure is surfaced in a red banner above the list.
      // D-05: local throw-on-error fetch (global trpcQuery swallows errors → null,
      // which would blank the tab silently — exactly the clinical-safety hazard
      // this commit is fixing). Rejecting promises surface to Promise.allSettled.
      const trpcFetchOrThrow = async (path: string, input: any) => {
        const params = `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
        const res = await fetch(`/api/trpc/${path}${params}`);
        let json: any = null;
        try { json = await res.json(); } catch {}
        if (!res.ok || json?.error) {
          const msg = json?.error?.json?.message || json?.error?.message || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        return json?.result?.data?.json;
      };
      const settled = await Promise.allSettled([
        trpcFetchOrThrow('medicationOrders.listMedicationOrders', {
          patient_id: patientId,
          include_completed: true,
        }),
        trpcFetchOrThrow('medicationOrders.listServiceRequests', {
          patient_id: patientId,
        }),
        encId
          ? trpcFetchOrThrow('clinicalOrders.listOrders', { encounter_id: encId, limit: 100 })
          : Promise.resolve({ items: [] }),
      ]);
      const medsRes = settled[0].status === 'fulfilled' ? settled[0].value : [];
      const srRes   = settled[1].status === 'fulfilled' ? settled[1].value : [];
      const clinRes = settled[2].status === 'fulfilled' ? settled[2].value : { items: [] };
      const errMsg = (r: any) => r?.message || (typeof r === 'string' ? r : 'Failed to load.');
      const nextErrs = {
        medication: settled[0].status === 'rejected' ? errMsg(settled[0].reason) : null,
        services:   settled[1].status === 'rejected' ? errMsg(settled[1].reason) : null,
        clinical:   settled[2].status === 'rejected' ? errMsg(settled[2].reason) : null,
      };
      if (nextErrs.medication) console.warn('[orders] listMedicationOrders failed:', settled[0].status === 'rejected' ? settled[0].reason : null);
      if (nextErrs.services)   console.warn('[orders] listServiceRequests failed:',   settled[1].status === 'rejected' ? settled[1].reason : null);
      if (nextErrs.clinical)   console.warn('[orders] clinicalOrders.listOrders failed:', settled[2].status === 'rejected' ? settled[2].reason : null);
      setOrdersErrors(nextErrs);

      const medList: UnifiedOrder[] = (Array.isArray(medsRes) ? medsRes : []).map((m: any) => ({
        id: String(m.id),
        source: 'medication',
        type: 'medication',
        title: [m.drug_name, m.dose_quantity ? String(m.dose_quantity) + (m.dose_unit || '') : null, m.route].filter(Boolean).join(' · '),
        subtitle: [m.frequency_code, m.duration_days ? String(m.duration_days) + 'd' : null, m.is_prn ? 'PRN' : null, m.instructions].filter(Boolean).join(' · '),
        status: String(m.status || 'active'),
        priority: m.is_prn ? 'prn' : null,
        orderedAt: m.created_at || m.start_date || null,
        orderedBy: m.prescriber_name || null,
        isHighAlert: !!m.is_high_alert,
        isNarcotic: !!m.narcotics_class,
        isPrn: !!m.is_prn,
      }));

      const srList: UnifiedOrder[] = (Array.isArray(srRes) ? srRes : []).map((s: any) => ({
        id: String(s.id),
        source: 'service_request',
        type: String(s.request_type || 'other'),
        title: String(s.order_name || ''),
        subtitle: [s.clinical_indication, s.instructions].filter(Boolean).join(' · '),
        status: String(s.status || 'requested'),
        priority: s.priority || null,
        orderedAt: s.sr_ordered_at || s.created_at || null,
        orderedBy: s.requester_name || null,
      }));

      const clinItems = (clinRes as any)?.items ?? (Array.isArray(clinRes) ? clinRes : []);
      const clinList: UnifiedOrder[] = (Array.isArray(clinItems) ? clinItems : []).map((c: any) => ({
        id: String(c.id),
        source: 'clinical_order',
        type: String(c.order_type || 'other'),
        title: String(c.order_name || ''),
        subtitle: [c.description, c.frequency, c.duration_days ? String(c.duration_days) + 'd' : null, c.instructions].filter(Boolean).join(' · '),
        status: String(c.order_status || 'ordered'),
        priority: c.priority || null,
        orderedAt: c.ordered_at || null,
        orderedBy: null,
      }));

      // Dedup by id (medication_requests and clinical_orders can mirror each other for drug orders)
      const seen = new Set<string>();
      const combined: UnifiedOrder[] = [];
      for (const o of [...medList, ...srList, ...clinList]) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        combined.push(o);
      }
      combined.sort((a, b) => {
        const ta = a.orderedAt ? new Date(a.orderedAt).getTime() : 0;
        const tb = b.orderedAt ? new Date(b.orderedAt).getTime() : 0;
        return tb - ta;
      });

      setOrdersList(combined);
      setOrdersLoaded(true);
    } catch (err) {
      console.error('Orders tab load error:', err);
    } finally {
      setOrdersLoading(false);
    }
  }, [patientId, encounter?.id]);

  useEffect(() => {
    if (activeTab === 'orders' && !ordersLoaded) loadOrdersData();
  }, [activeTab, ordersLoaded, loadOrdersData]);


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
  // PC.1b1 (18 Apr 2026): pill routing now lives in useChartAction() — a single
  // registry shared with getActionsForRole so pills + handler can never drift.
  const { handleAction: handleActionClick } = useChartAction({ setActiveTab, setOrderPanel, setCommsOpen });

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

  const age = calculateAge(patient.date_of_birth || patient.dob || '');
  const admDate = encounter?.admission_at || encounter?.admission_date;
  const daysSinceAdmission = admDate ? Math.floor((Date.now() - new Date(admDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;

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
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        {/* Back button */}
        <button
          onClick={() => window.history.back()}
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'rgba(255,255,255,0.12)',
            border: 'none', color: '#fff',
            fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          title="Go back"
        >
          ←
        </button>

        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: '#0055FF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: 17, flexShrink: 0,
        }}>
          {(patient.name_full || patient.full_name || patient.name_given || 'P')[0]?.toUpperCase() || 'P'}
        </div>

        {/* Patient info — grows to fill available space */}
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 18, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
            {patient.name_full || patient.full_name || `${patient.name_given || ''} ${patient.name_family || ''}`.trim() || 'Patient'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, margin: '2px 0 0', lineHeight: 1.3 }}>
            {patient.uhid} · {Number.isFinite(age) ? `${age}y` : '—'} {(patient.sex || patient.gender || '').toUpperCase()} · <SensitiveText field="diagnosis" chartConfig={chartConfig} patientId={patientId} tabId="header">{encounter?.chief_complaint || encounter?.preliminary_diagnosis_icd10 || patient.primary_diagnosis || ''}</SensitiveText>
          </div>
        </div>

        {/* Right-side badges — wrap on narrow screens */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {encounter && (
            <div style={{
              background: 'white', color: '#002054',
              padding: '5px 10px', borderRadius: 6,
              fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
            }}>
              🛏 {encounter.bed_code || encounter.bed_name || encounter.assigned_bed || 'Bed'}
            </div>
          )}
          {encounter && (
            <div style={{
              background: '#D97706', color: 'white',
              padding: '5px 10px', borderRadius: 6,
              fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap',
            }}>
              Day {daysSinceAdmission + 1}
            </div>
          )}
          {encounter && (
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              padding: '5px 10px', borderRadius: 6,
              fontSize: 12, whiteSpace: 'nowrap',
            }}>
              <span style={{ fontWeight: 600 }}>{encounter.attending_physician_name || 'Unassigned'}</span>
              <span style={{ opacity: 0.65, marginLeft: 4 }}>Attending</span>
            </div>
          )}
          {/* OC.4c: Open patient chat channel */}
          {encounter && (
            <button
              onClick={() => {
                // Dispatch custom event to open chat sidebar on patient channel
                window.dispatchEvent(new CustomEvent('open-patient-chat', {
                  detail: { channelId: `patient-${encounter.id}` },
                }));
              }}
              style={{
                background: '#10B981', color: 'white',
                padding: '5px 12px', borderRadius: 6,
                fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              title="Open patient chat channel"
            >
              💬 Chat
            </button>
          )}
        </div>
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

        {/* Journey Strip — horizontally scrollable on narrow screens */}
        {journey && (
          <div style={{ flex: 1, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 'max-content', padding: '0 4px' }}>
              {['Start', 'Admit', 'Assess', 'Treat', 'Progress', 'Stabilize', 'DC Plan', 'Ready', 'Exit'].map((phase, idx, arr) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 44 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: idx < journey.completed_steps ? '#0B8A3E' : idx === journey.completed_steps ? '#0055FF' : '#e0e0e0',
                      border: idx === journey.completed_steps ? '2px solid #0055FF' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'white', fontWeight: 600, fontSize: 11,
                      animation: idx === journey.completed_steps ? 'pulse 2s infinite' : 'none',
                    }}>
                      {idx < journey.completed_steps ? '✓' : idx + 1}
                    </div>
                    <div style={{ fontSize: 9, textAlign: 'center', color: '#666', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                      {phase}
                    </div>
                  </div>
                  {idx < arr.length - 1 && (
                    <div style={{
                      width: 16, height: 2, borderRadius: 1,
                      background: idx < journey.completed_steps ? '#0B8A3E' : '#e0e0e0',
                      flexShrink: 0,
                    }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Alert Banner: Allergies (only if allergies exist) ────────────────── */}
      {allergies.length > 0 && (
        <div style={{ padding: '0 24px', paddingTop: 16 }}>
          <AlertBanner
            variant="critical"
            title="Known Allergies"
            message={<SensitiveText field="allergies" chartConfig={chartConfig} patientId={patientId} tabId="header">{allergies.map(a => `${a.allergen} (${a.severity}): ${a.reaction}`).join(' · ')}</SensitiveText>}
            dismissible={false}
          />
        </div>
      )}

      {/* ── Tab Bar ───────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e0e0e0',
        padding: '0 20px',
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        marginTop: 0,
        WebkitOverflowScrolling: 'touch',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className="patient-chart-tab-btn"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 10px',
              minHeight: 44,
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? '#0055FF' : '#666',
              borderBottom: activeTab === tab.id ? '3px solid #0055FF' : '3px solid transparent',
              background: 'none',
              border: 'none',
              borderBottomStyle: 'solid',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 15 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
        {/* PC.1a: Comms tab opens right-side slider (dual rooms: encounter + patient). Replaces OC.4d link. */}
        {encounter && (
          <button
            type="button"
            className="patient-chart-tab-btn"
            onClick={() => {
              setCommsInitialChannelId(`patient-enc-${encounter.id}`);
              setCommsOpen(true);
            }}
            style={{
              padding: '12px 10px',
              minHeight: 44,
              fontSize: 13,
              fontWeight: 500,
              color: '#10B981',
              borderBottom: '3px solid transparent',
              background: 'none',
              border: 'none',
              borderBottomStyle: 'solid',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Open communications for this patient"
          >
            <span style={{ fontSize: 15 }}>💬</span>
            <span>Comms</span>
          </button>
        )}
      </div>

      {/* ── Overview Tab Content ──────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="patient-chart-overview-grid" style={{
          padding: '20px 24px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
          gap: 20,
        }}>
          {/* ──── LEFT: main content area (timeline on top, vitals below) ──── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>

          {/* LEFT COLUMN: Vitals */}
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 16px', textTransform: 'uppercase', color: '#666' }}>Latest Vitals</h3>
            {Object.keys(latestVitalsMap).length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 12px', color: '#9ca3af' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>📊</div>
                <div style={{ fontSize: '13px' }}>No vitals recorded yet</div>
                <div style={{ fontSize: '11px', marginTop: '4px' }}>Record vitals using the button below</div>
              </div>
            )}
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

          {/* CENTER COLUMN: What's Happening Timeline (with filter) */}
          {(() => {
            const allEvents = synthesizeTimeline(vitals, medications, notes, allergies, news2Score);
            const searchLower = tlSearch.toLowerCase().trim();
            const filtered = allEvents.filter(ev => {
              if (!tlActiveCategories.has(ev.category)) return false;
              if (searchLower && !ev.title.toLowerCase().includes(searchLower) && !ev.description.toLowerCase().includes(searchLower)) return false;
              return true;
            });
            const visible = filtered.slice(0, tlShowCount);
            const hasMore = filtered.length > tlShowCount;

            // Count per category (for badge numbers)
            const catCounts: Partial<Record<TimelineCategory, number>> = {};
            allEvents.forEach(ev => { catCounts[ev.category] = (catCounts[ev.category] || 0) + 1; });

            return (
              <div style={{
                background: 'white',
                borderRadius: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 'calc(100vh - 220px)',
                overflow: 'hidden',
              }}>
                {/* Sticky header: title + filter toggle + search */}
                <div style={{
                  padding: '16px 20px 0',
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'uppercase', color: '#666' }}>
                      What&apos;s Happening
                      <span style={{ fontSize: 11, fontWeight: 500, color: '#999', marginLeft: 6 }}>
                        {filtered.length} event{filtered.length !== 1 ? 's' : ''}
                      </span>
                    </h3>
                    <button
                      onClick={() => setTlFilterOpen(!tlFilterOpen)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: tlFilterOpen ? '#EEF2FF' : '#f5f5f5',
                        color: tlFilterOpen ? '#4338CA' : '#666',
                        border: tlFilterOpen ? '1px solid #C7D2FE' : '1px solid #e0e0e0',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {tlFilterOpen ? '✕ Close' : '⚙ Filter'}
                      {tlActiveCategories.size < Object.keys(TIMELINE_CATEGORY_META).length && (
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: '#4338CA', display: 'inline-block', marginLeft: 2,
                        }} />
                      )}
                    </button>
                  </div>

                  {/* Collapsible filter drawer */}
                  {tlFilterOpen && (
                    <div style={{
                      background: '#F8FAFC', borderRadius: 10,
                      padding: '12px 14px', marginBottom: 12,
                      border: '1px solid #E2E8F0',
                    }}>
                      {/* Search input */}
                      <div style={{ position: 'relative', marginBottom: 10 }}>
                        <input
                          type="text"
                          placeholder="Search events…"
                          value={tlSearch}
                          onChange={e => { setTlSearch(e.target.value); setTlShowCount(20); }}
                          style={{
                            width: '100%', padding: '8px 12px 8px 32px',
                            border: '1px solid #CBD5E1', borderRadius: 8,
                            fontSize: 13, background: '#fff', boxSizing: 'border-box',
                          }}
                        />
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#94A3B8', pointerEvents: 'none' }}>
                          🔍
                        </span>
                      </div>

                      {/* Category pills */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {/* All / None toggle */}
                        <button
                          onClick={() => {
                            const allCats = new Set(Object.keys(TIMELINE_CATEGORY_META) as TimelineCategory[]);
                            setTlActiveCategories(tlActiveCategories.size === allCats.size ? new Set() : allCats);
                            setTlShowCount(20);
                          }}
                          style={{
                            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                            background: tlActiveCategories.size === Object.keys(TIMELINE_CATEGORY_META).length ? '#002054' : '#fff',
                            color: tlActiveCategories.size === Object.keys(TIMELINE_CATEGORY_META).length ? '#fff' : '#374151',
                            border: '1px solid #CBD5E1', cursor: 'pointer',
                          }}
                        >
                          All
                        </button>
                        {(Object.entries(TIMELINE_CATEGORY_META) as [TimelineCategory, typeof TIMELINE_CATEGORY_META[TimelineCategory]][]).map(([cat, meta]) => {
                          const active = tlActiveCategories.has(cat);
                          const count = catCounts[cat] || 0;
                          return (
                            <button
                              key={cat}
                              onClick={() => {
                                const next = new Set(tlActiveCategories);
                                if (active) next.delete(cat); else next.add(cat);
                                setTlActiveCategories(next);
                                setTlShowCount(20);
                              }}
                              style={{
                                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                                background: active ? meta.color + '18' : '#fff',
                                color: active ? meta.color : '#9CA3AF',
                                border: `1px solid ${active ? meta.color + '40' : '#E5E7EB'}`,
                                cursor: 'pointer', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center', gap: 4,
                                opacity: count === 0 ? 0.5 : 1,
                              }}
                            >
                              <span>{meta.icon}</span>
                              <span>{meta.label}</span>
                              {count > 0 && (
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: '0 5px',
                                  borderRadius: 10, background: active ? meta.color : '#E5E7EB',
                                  color: active ? '#fff' : '#6B7280',
                                  lineHeight: '16px',
                                }}>
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Scrollable event list */}
                <div className="tl-scroll" style={{
                  flex: 1, overflowY: 'auto',
                  padding: '0 20px 16px',
                  WebkitOverflowScrolling: 'touch',
                }}>
                  {visible.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 12px', color: '#9ca3af' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>{tlSearch ? '🔍' : '📋'}</div>
                      <div style={{ fontSize: 13 }}>{tlSearch ? 'No events match your search' : 'No events in selected categories'}</div>
                      {tlSearch && (
                        <button
                          onClick={() => setTlSearch('')}
                          style={{ marginTop: 8, fontSize: 12, color: '#0055FF', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {visible.map((event) => {
                        const meta = TIMELINE_CATEGORY_META[event.category];
                        const isExpanded = tlExpandedId === event.id;
                        return (
                          <div
                            key={event.id}
                            onClick={() => setTlExpandedId(isExpanded ? null : event.id)}
                            style={{
                              display: 'flex', gap: 10,
                              padding: '10px 12px',
                              borderLeft: `3px solid ${meta.color}`,
                              borderRadius: '0 8px 8px 0',
                              background: isExpanded ? meta.color + '08' : 'transparent',
                              cursor: 'pointer',
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#f9fafb'; }}
                            onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                          >
                            <div style={{ minWidth: 60, flexShrink: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', fontFamily: 'monospace' }}>
                                {event.time}
                              </div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {(() => {
                                // PC.3.3.B — notes_snippet / procedures / mlc_reason redaction
                                // for CCE / billing / pharmacist / lab when a timeline row
                                // surfaces a sensitive category.
                                let field: string | null = null;
                                if (event.category === 'note') {
                                  field = /mlc/i.test(event.title) ? 'mlc_reason' : 'notes_snippet';
                                } else if (event.category === 'procedure') {
                                  field = 'procedures';
                                }
                                const Body = (
                                  <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ fontSize: 12 }}>{meta.icon}</span>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#002054' }}>
                                        {event.title}
                                      </span>
                                    </div>
                                    <div style={{
                                      fontSize: 12, color: '#666', marginTop: 3,
                                      overflow: isExpanded ? 'visible' : 'hidden',
                                      textOverflow: isExpanded ? 'clip' : 'ellipsis',
                                      whiteSpace: isExpanded ? 'normal' : 'nowrap',
                                      lineHeight: 1.5,
                                    }}>
                                      {event.description}
                                    </div>
                                  </>
                                );
                                if (!field) return Body;
                                return (
                                  <SensitiveText
                                    field={field}
                                    chartConfig={chartConfig}
                                    patientId={patientId}
                                    tabId="timeline"
                                  >
                                    {Body}
                                  </SensitiveText>
                                );
                              })()}
                              {/* Expanded: show source link + timestamp */}
                              {isExpanded && event.source && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveTab(event.source as PatientTab);
                                    setTlExpandedId(null);
                                  }}
                                  style={{
                                    marginTop: 8, fontSize: 11, fontWeight: 600,
                                    color: meta.color, background: 'none',
                                    border: `1px solid ${meta.color}40`,
                                    borderRadius: 6, padding: '3px 10px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Open in {event.source.charAt(0).toUpperCase() + event.source.slice(1)} →
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Load more */}
                      {hasMore && (
                        <button
                          onClick={() => setTlShowCount(c => c + 20)}
                          style={{
                            marginTop: 8, padding: '8px 0', borderRadius: 8,
                            border: '1px solid #e0e0e0', background: '#fafafa',
                            fontSize: 12, fontWeight: 600, color: '#666',
                            cursor: 'pointer', textAlign: 'center',
                          }}
                        >
                          Load more ({filtered.length - tlShowCount} remaining)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          </div>{/* close left content area */}

          {/* ──── RIGHT: sidebar (tasks, journey, care team) ──── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

            {/* Clinical Calculators (PC.2b2) */}
            <OverviewCalculatorsCard
              patientId={patientId}
              onOpenCalc={(id) => {
                setInitialCalcId(id ?? null);
                setActiveTab('calculators');
              }}
            />

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
                    value={vitalsForm.bp_systolic}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, bp_systolic: e.target.value })}
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
                    value={vitalsForm.bp_diastolic}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, bp_diastolic: e.target.value })}
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
                    value={vitalsForm.pulse}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, pulse: e.target.value })}
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
                    value={vitalsForm.spo2}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, spo2: e.target.value })}
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
                    value={vitalsForm.temperature}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, temperature: e.target.value })}
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
                    value={vitalsForm.rr}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, rr: e.target.value })}
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
                    value={vitalsForm.pain_score}
                    onChange={(e) => setVitalsForm({ ...vitalsForm, pain_score: e.target.value })}
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
                onClick={async () => {
                  if (!encounter?.id) { alert('No active encounter'); return; }
                  const v = vitalsForm;
                  if (!v.bp_systolic && !v.pulse && !v.spo2 && !v.temperature && !v.rr) {
                    alert('Please enter at least one vital sign');
                    return;
                  }
                  setVitalsSubmitting(true);
                  try {
                    await trpcMutate('observations.createVitals', {
                      patient_id: patientId,
                      encounter_id: encounter.id,
                      effective_datetime: new Date().toISOString(),
                      ...(v.bp_systolic ? { bp_systolic: parseInt(v.bp_systolic) } : {}),
                      ...(v.bp_diastolic ? { bp_diastolic: parseInt(v.bp_diastolic) } : {}),
                      ...(v.pulse ? { pulse: parseInt(v.pulse) } : {}),
                      ...(v.spo2 ? { spo2: parseFloat(v.spo2) } : {}),
                      ...(v.temperature ? { temperature: parseFloat(v.temperature) } : {}),
                      ...(v.rr ? { rr: parseInt(v.rr) } : {}),
                      ...(v.pain_score ? { pain_score: parseInt(v.pain_score) } : {}),
                    });
                    setVitalsForm({ bp_systolic: '', bp_diastolic: '', pulse: '', spo2: '', temperature: '', rr: '', pain_score: '' });
                    loadData();
                  } catch (err: any) {
                    alert(`Failed to save vitals: ${err.message}`);
                  } finally {
                    setVitalsSubmitting(false);
                  }
                }}
                disabled={vitalsSubmitting}
                style={{
                  padding: '12px 24px',
                  background: vitalsSubmitting ? '#9CA3AF' : '#0055FF',
                  color: 'white',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: vitalsSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => !vitalsSubmitting && (e.currentTarget.style.background = '#003DBF')}
                onMouseLeave={(e) => !vitalsSubmitting && (e.currentTarget.style.background = '#0055FF')}
              >
                {vitalsSubmitting ? 'Saving...' : 'Save Vitals'}
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
        <LabsTab
          patientId={patientId}
          userRole={userRole}
          onOrderLabs={() => setOrderPanel('labs')}
        />
      )}

      {activeTab === 'orders' && (
        <div style={{ padding: '24px', background: '#f5f6fa', minHeight: '100vh', paddingBottom: 100 }}>
          {/* Doctor role check */}
          {!['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon', 'anaesthetist', 'department_head', 'medical_director'].includes(userRole) ? (
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

              {/* ── PC.1b1: Real Orders List (search + type/status filters) ─── */}
              <div style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'uppercase', color: '#666' }}>
                    Orders {!ordersLoading && ordersList.length > 0 ? `(${ordersList.length})` : ''}
                  </h3>
                  <button
                    onClick={() => { setOrdersLoaded(false); loadOrdersData(); }}
                    disabled={ordersLoading}
                    style={{
                      height: 30, padding: '0 12px',
                      background: 'white', border: '1px solid #d1d5db',
                      color: '#374151', borderRadius: 6,
                      fontSize: 12, fontWeight: 600,
                      cursor: ordersLoading ? 'wait' : 'pointer',
                      opacity: ordersLoading ? 0.6 : 1,
                    }}
                  >
                    {ordersLoading ? 'Refreshing…' : '↻ Refresh'}
                  </button>
                </div>

                {/* PC.1b2 / D-05: red banner when any orders source failed */}
                {(ordersErrors.medication || ordersErrors.services || ordersErrors.clinical) && (
                  <div style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 14,
                    fontSize: 13,
                  }}>
                    <strong>⚠ Some order sources failed to load.</strong> Showing partial list — do not assume absence of an order means none exists.
                    <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                      {ordersErrors.medication && <li>Medications: {ordersErrors.medication}</li>}
                      {ordersErrors.services && <li>Labs / imaging / consults: {ordersErrors.services}</li>}
                      {ordersErrors.clinical && <li>Other clinical orders: {ordersErrors.clinical}</li>}
                    </ul>
                  </div>
                )}

                {/* Search + filter row */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={ordersSearch}
                    onChange={(e) => setOrdersSearch(e.target.value)}
                    placeholder="Search orders (name, indication, instructions)…"
                    style={{
                      flex: '1 1 240px',
                      height: 34, padding: '0 12px',
                      border: '1px solid #d1d5db', borderRadius: 6,
                      fontSize: 13, color: '#111',
                    }}
                  />
                  <select
                    value={ordersTypeFilter}
                    onChange={(e) => setOrdersTypeFilter(e.target.value as OrderTypeFilter)}
                    style={{
                      height: 34, padding: '0 10px',
                      border: '1px solid #d1d5db', borderRadius: 6,
                      fontSize: 13, background: 'white', color: '#111',
                    }}
                  >
                    <option value="all">All types</option>
                    <option value="medication">Medication</option>
                    <option value="lab">Lab</option>
                    <option value="imaging">Imaging</option>
                    <option value="consult">Consult</option>
                    <option value="referral">Referral</option>
                    <option value="nursing">Nursing</option>
                    <option value="diet">Diet</option>
                    <option value="procedure">Procedure</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    value={ordersStatusFilter}
                    onChange={(e) => setOrdersStatusFilter(e.target.value as OrderStatusBucket)}
                    style={{
                      height: 34, padding: '0 10px',
                      border: '1px solid #d1d5db', borderRadius: 6,
                      fontSize: 13, background: 'white', color: '#111',
                    }}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active / Open</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                {/* Loading / empty / list */}
                {ordersLoading && ordersList.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Loading orders…</div>
                ) : (() => {
                  const q = ordersSearch.trim().toLowerCase();
                  const ACTIVE_SET = new Set(['active','ordered','in_progress','requested','on-hold','approved','pending','draft']);
                  const COMPLETED_SET = new Set(['completed','fulfilled','done','resulted']);
                  const CANCELLED_SET = new Set(['cancelled','canceled','revoked','rejected','stopped']);
                  const TYPE_MAP: Record<string, OrderTypeFilter> = {
                    medication: 'medication', pharmacy: 'medication',
                    lab: 'lab',
                    imaging: 'imaging', radiology: 'imaging',
                    consult: 'consult',
                    referral: 'referral',
                    nursing: 'nursing',
                    diet: 'diet',
                    procedure: 'procedure',
                  };
                  const toBucket = (s: string): OrderStatusBucket => {
                    const k = s.toLowerCase();
                    if (CANCELLED_SET.has(k)) return 'cancelled';
                    if (COMPLETED_SET.has(k)) return 'completed';
                    if (ACTIVE_SET.has(k)) return 'active';
                    return 'active';
                  };
                  const filtered = ordersList.filter((o) => {
                    const mappedType = TYPE_MAP[o.type] || 'other';
                    if (ordersTypeFilter !== 'all' && mappedType !== ordersTypeFilter) return false;
                    if (ordersStatusFilter !== 'all' && toBucket(o.status) !== ordersStatusFilter) return false;
                    if (q) {
                      const hay = `${o.title} ${o.subtitle} ${o.orderedBy || ''}`.toLowerCase();
                      if (!hay.includes(q)) return false;
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                        {ordersList.length === 0
                          ? 'No orders on this patient yet. Use the buttons above to place one.'
                          : 'No orders match your filters.'}
                      </div>
                    );
                  }

                  const TYPE_META: Record<string, { label: string; bg: string; color: string; icon: string }> = {
                    medication: { label: 'Medication', bg: '#fef3c7', color: '#92400e', icon: '💊' },
                    pharmacy:   { label: 'Medication', bg: '#fef3c7', color: '#92400e', icon: '💊' },
                    lab:        { label: 'Lab',        bg: '#e0f2fe', color: '#075985', icon: '🧪' },
                    imaging:    { label: 'Imaging',    bg: '#ede9fe', color: '#5b21b6', icon: '📡' },
                    radiology:  { label: 'Imaging',    bg: '#ede9fe', color: '#5b21b6', icon: '📡' },
                    consult:    { label: 'Consult',    bg: '#fce7f3', color: '#9d174d', icon: '👥' },
                    referral:   { label: 'Referral',   bg: '#fce7f3', color: '#9d174d', icon: '↗️' },
                    nursing:    { label: 'Nursing',    bg: '#dcfce7', color: '#166534', icon: '🩺' },
                    diet:       { label: 'Diet',       bg: '#fef9c3', color: '#854d0e', icon: '🍽️' },
                    procedure:  { label: 'Procedure',  bg: '#fee2e2', color: '#991b1b', icon: '🔬' },
                    other:      { label: 'Other',      bg: '#f3f4f6', color: '#475467', icon: '📋' },
                  };
                  const fmtDate = (iso: string | null) => {
                    if (!iso) return '—';
                    const d = new Date(iso);
                    if (isNaN(d.getTime())) return '—';
                    const now = new Date();
                    const sameDay = d.toDateString() === now.toDateString();
                    const y = new Date(now); y.setDate(now.getDate() - 1);
                    const isYesterday = d.toDateString() === y.toDateString();
                    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                    if (sameDay) return `Today ${time}`;
                    if (isYesterday) return `Yesterday ${time}`;
                    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + time;
                  };

                  return (
                    <div style={{
                      overflowX: 'auto',
                      borderRadius: 8,
                      border: '1px solid #e0e0e0',
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Date</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Order</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Type</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Status</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Ordered By</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#374151' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((o) => {
                            const mapped = TYPE_MAP[o.type] || 'other';
                            const meta = TYPE_META[mapped] || TYPE_META.other;
                            const bucket = toBucket(o.status);
                            const statusStyle = bucket === 'active'
                              ? { bg: '#ECFDF5', color: '#065F46' }
                              : bucket === 'completed'
                                ? { bg: '#F3F4F6', color: '#4B5563' }
                                : { bg: '#FEE2E2', color: '#991B1B' };
                            const canCancel = o.source === 'clinical_order' && bucket === 'active';
                            return (
                              <tr key={o.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '10px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(o.orderedAt)}</td>
                                <td style={{ padding: '10px 12px', color: '#111' }}>
                                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{o.title || 'Unnamed order'}</span>
                                    {o.isHighAlert && <span title="High-alert medication" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>HIGH-ALERT</span>}
                                    {o.isNarcotic && <span title="Narcotic" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>NARC</span>}
                                    {o.isPrn && <span title="Pro re nata" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#e0f2fe', color: '#075985', fontWeight: 700 }}>PRN</span>}
                                  </div>
                                  {o.subtitle && (
                                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{o.subtitle}</div>
                                  )}
                                </td>
                                <td style={{ padding: '10px 12px' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600 }}>
                                    <span>{meta.icon}</span>{meta.label}
                                  </span>
                                </td>
                                <td style={{ padding: '10px 12px' }}>
                                  <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: statusStyle.bg, color: statusStyle.color, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
                                    {o.status.replace(/_/g, ' ')}
                                  </span>
                                  {o.priority && o.priority !== 'routine' && (
                                    <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2, fontWeight: 700, textTransform: 'uppercase' }}>{o.priority}</div>
                                  )}
                                </td>
                                <td style={{ padding: '10px 12px', color: '#64748b' }}>{o.orderedBy || '—'}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                  {canCancel && (
                                    <button
                                      onClick={async () => {
                                        const reason = prompt('Reason for cancelling this order:');
                                        if (!reason) return;
                                        setCancellingOrderId(o.id);
                                        try {
                                          await trpcMutate('clinicalOrders.updateOrderStatus', { order_id: o.id, new_status: 'cancelled', cancel_reason: reason });
                                          setOrdersLoaded(false);
                                          await loadOrdersData();
                                        } catch (err: any) {
                                          alert(`Failed to cancel: ${err?.message || err}`);
                                        } finally {
                                          setCancellingOrderId(null);
                                        }
                                      }}
                                      disabled={cancellingOrderId === o.id}
                                      style={{
                                        height: 26, padding: '0 10px',
                                        background: 'white', border: '1px solid #fca5a5',
                                        color: '#b91c1c', borderRadius: 4,
                                        fontSize: 11, fontWeight: 600,
                                        cursor: cancellingOrderId === o.id ? 'wait' : 'pointer',
                                        opacity: cancellingOrderId === o.id ? 0.6 : 1,
                                      }}
                                    >
                                      {cancellingOrderId === o.id ? 'Cancelling…' : 'Cancel'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Notes Tab ────────────────────────────────────────────────────────────── */}
      {activeTab === 'notes' && (
        <NotesTab userRole={userRole} userName={userName} userId={userId} patientId={patientId} encounterId={encounter?.id || null} />
      )}

      {/* ── Plan Tab (Care Plan: pathway + problem list + variance) ─────────────── */}
      {activeTab === 'plan' && (() => {
        const doctorRoles = ['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'surgeon', 'anaesthetist', 'department_head', 'medical_director'];
        const nurseRoles = ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager', 'ot_nurse'];
        const canAddProblem = doctorRoles.includes(userRole);
        const canCompleteMilestone = (responsibleRole: string | null | undefined) => {
          if (!responsibleRole) return false;
          if (doctorRoles.includes(userRole)) return true; // doctors can complete any
          if (nurseRoles.includes(userRole)) {
            return /nurs/i.test(responsibleRole || '');
          }
          return false;
        };
        const activePlan = carePlans.find((p: any) => p.care_plan_status === 'active') || carePlans[0];
        const combinedEvents = [
          ...planVariances.map((v: any) => ({ kind: 'variance', id: v.id, ts: v.created_at, title: `Variance · ${v.variance_type}`, sev: v.severity, detail: v.reason || v.notes || '', who: v.documented_by_name, milestone: v.milestone_name })),
          ...planEscalations.map((e: any) => ({ kind: 'escalation', id: e.id, ts: e.triggered_at, title: `Escalation · ${e.level}`, sev: e.status, detail: e.resolution_notes || e.notify_role || '', who: null, milestone: e.milestone_name })),
        ].sort((a, b) => (new Date(b.ts).getTime() - new Date(a.ts).getTime())).slice(0, 8);
        const showVariance = !['receptionist', 'ip_coordinator', 'billing_manager', 'billing_executive', 'insurance_coordinator'].includes(userRole);

        async function handleCompleteMilestone(msId: string) {
          try {
            await trpcMutate('carePathways.completeMilestone', { milestone_id: msId });
            setPlanLoaded(false); // trigger reload
          } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : err}`); }
        }
        async function handleSkipMilestone(msId: string) {
          const reason = prompt('Reason for skipping this milestone:');
          if (!reason) return;
          try {
            await trpcMutate('carePathways.skipMilestone', { milestone_id: msId, skip_reason: reason });
            setPlanLoaded(false);
          } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : err}`); }
        }

        return (
          <div style={{ padding: '20px 24px', background: '#f5f6fa', minHeight: '100vh' }}>
            {planLoading && !planLoaded && (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading care plan…</div>
            )}

            {!planLoading && planLoaded && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 20 }}>
                  {/* ── LEFT: Active Care Pathway ───────────────────────────── */}
                  <div style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    {activePlan ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111' }}>{activePlan.template_name || 'Care Pathway'}</h3>
                            {(journey as any)?.current_phase && (
                              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                                Journey: <strong>{(journey as any).current_phase}</strong>
                                {(journey as any).next_milestone ? ` · next: ${(journey as any).next_milestone}` : ''}
                              </div>
                            )}
                          </div>
                          <span style={{
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase' as const,
                            borderRadius: 12,
                            background: activePlan.care_plan_status === 'active' ? '#dcfce7' : '#f3f4f6',
                            color: activePlan.care_plan_status === 'active' ? '#166534' : '#475467',
                          }}>{activePlan.care_plan_status}</span>
                        </div>

                        {/* Progress bar */}
                        {(() => {
                          const total = Number(activePlan.total_milestones || 0);
                          const done = Number(activePlan.completed_milestones || 0);
                          const overdue = Number(activePlan.overdue_milestones || 0);
                          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                          return (
                            <div style={{ marginBottom: 20 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475467', marginBottom: 6 }}>
                                <span>{done} of {total} milestones complete</span>
                                {overdue > 0 && <span style={{ color: '#b91c1c', fontWeight: 600 }}>{overdue} overdue</span>}
                              </div>
                              <div style={{ height: 8, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: overdue > 0 ? '#f59e0b' : '#10b981' }} />
                              </div>
                            </div>
                          );
                        })()}

                        {/* Milestone timeline */}
                        <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, color: '#475467', margin: '0 0 12px' }}>Milestones</h4>
                        {planMilestones.length === 0 ? (
                          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No milestones recorded yet.</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {planMilestones.map((m: any) => {
                              const isOverdue = m.ms_status !== 'completed' && m.ms_status !== 'skipped' && m.due_datetime && new Date(m.due_datetime).getTime() < Date.now();
                              const statusColors: Record<string, { bg: string; fg: string }> = {
                                completed: { bg: '#dcfce7', fg: '#166534' },
                                in_progress: { bg: '#dbeafe', fg: '#1e40af' },
                                not_started: { bg: '#f3f4f6', fg: '#475467' },
                                skipped: { bg: '#fef3c7', fg: '#92400e' },
                              };
                              const sc = statusColors[m.ms_status] || statusColors.not_started;
                              const canComplete = canCompleteMilestone(m.ms_responsible_role) && m.ms_status !== 'completed' && m.ms_status !== 'skipped';
                              return (
                                <div key={m.id} style={{
                                  padding: 12,
                                  border: `1px solid ${isOverdue ? '#fca5a5' : '#e5e7eb'}`,
                                  borderLeft: `4px solid ${isOverdue ? '#b91c1c' : sc.fg}`,
                                  borderRadius: 8,
                                  background: isOverdue ? '#fef2f2' : '#fafafa',
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{m.ms_name}</div>
                                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                                        {m.ms_responsible_role && <span>👤 {m.ms_responsible_role}</span>}
                                        {m.due_datetime && <span>⏰ {new Date(m.due_datetime).toLocaleString()}</span>}
                                        <span style={{ padding: '1px 8px', background: sc.bg, color: sc.fg, borderRadius: 10, fontWeight: 700, textTransform: 'uppercase' as const }}>{m.ms_status}</span>
                                        {isOverdue && <span style={{ color: '#b91c1c', fontWeight: 700 }}>OVERDUE</span>}
                                      </div>
                                    </div>
                                    {canComplete && (
                                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                        <button
                                          onClick={() => handleCompleteMilestone(m.id)}
                                          style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: '#10b981', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                                        >Complete</button>
                                        {doctorRoles.includes(userRole) && (
                                          <button
                                            onClick={() => handleSkipMilestone(m.id)}
                                            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'white', color: '#475467', border: '1px solid #d0d5dd', borderRadius: 6, cursor: 'pointer' }}
                                          >Skip</button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ padding: 40, textAlign: 'center' }}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 4 }}>No Care Pathway attached</div>
                        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                          {doctorRoles.includes(userRole) ? 'Activate a pathway template to start tracking milestones.' : 'A doctor needs to activate a care pathway for this patient.'}
                        </div>
                        {doctorRoles.includes(userRole) && (
                          <a
                            href="/admin/care-pathways"
                            style={{ display: 'inline-block', padding: '8px 16px', background: '#0055FF', color: 'white', fontSize: 13, fontWeight: 600, borderRadius: 8, textDecoration: 'none' }}
                          >Browse Templates →</a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── RIGHT: Problem List ─────────────────────────────────── */}
                  <div style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, color: '#475467', margin: 0 }}>Problem List</h4>
                      {canAddProblem && (
                        <button
                          onClick={() => setShowAddProblemModal(true)}
                          style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, background: '#0055FF', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                        >+ Add</button>
                      )}
                    </div>
                    {(() => {
                      const active = conditions.filter((c: any) => c.clinical_status === 'active');
                      if (active.length === 0) {
                        return <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: '#9ca3af' }}>No active problems.</div>;
                      }
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {active.map((c: any) => (
                            <div key={c.id} style={{ padding: 10, background: '#f9fafb', borderRadius: 8, borderLeft: '3px solid #0055FF' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{c.condition_name}</div>
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                                {c.icd10_code && <span>{c.icd10_code}</span>}
                                {c.severity && <span style={{ textTransform: 'capitalize' as const }}>· {c.severity}</span>}
                                {c.onset_date && <span>· {new Date(c.onset_date).toLocaleDateString()}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ── BOTTOM: Variance & Escalations ───────────────────────── */}
                {showVariance && combinedEvents.length > 0 && (
                  <div style={{ marginTop: 20, background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, color: '#475467', margin: '0 0 12px' }}>Variance & Escalations</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {combinedEvents.map((ev: any) => (
                        <div key={`${ev.kind}-${ev.id}`} style={{
                          padding: '8px 12px',
                          background: ev.kind === 'escalation' ? '#fef2f2' : '#fffbeb',
                          borderLeft: `3px solid ${ev.kind === 'escalation' ? '#dc2626' : '#f59e0b'}`,
                          borderRadius: 6,
                          fontSize: 12,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ fontWeight: 600, color: '#111', textTransform: 'capitalize' as const }}>{ev.title}</div>
                            <div style={{ color: '#6b7280', fontSize: 11, whiteSpace: 'nowrap' as const }}>{ev.ts ? new Date(ev.ts).toLocaleString() : ''}</div>
                          </div>
                          {ev.milestone && <div style={{ color: '#475467', marginTop: 2 }}>Milestone: {ev.milestone}</div>}
                          {ev.detail && <div style={{ color: '#475467', marginTop: 2 }}>{ev.detail}</div>}
                          {ev.who && <div style={{ color: '#9ca3af', marginTop: 2, fontSize: 11 }}>by {ev.who}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Add Problem modal */}
            {showAddProblemModal && (
              <ProblemForm
                patientId={patientId}
                encounterId={encounter?.id || null}
                onClose={() => setShowAddProblemModal(false)}
                onSaved={() => { loadData(); setShowAddProblemModal(false); }}
              />
            )}
          </div>
        );
      })()}

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
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#002054' }}><SensitiveText field="medications" chartConfig={chartConfig} patientId={patientId} tabId="emar">{med.name}</SensitiveText></div>
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
              {emarLocked && (
                <LockBanner current={emarLock.current} surfaceLabel="This medication" onRetry={emarLock.acquire} />
              )}

              {/* Identity Verification */}
              <div style={{ padding: '12px 16px', background: '#f5f6fa', borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#666' }}>Patient Name / UHID</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#002054', marginTop: 4 }}>{patient?.name_full || patient?.full_name || `${patient?.name_given || ''} ${patient?.name_family || ''}`.trim() || 'Patient'} ({patient?.uhid})</div>
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
                  onClick={async () => {
                    if (!encounter?.id) return;
                    try {
                      await trpcMutate('medicationOrders.emarRecord', {
                        medication_request_id: emarGiveModal!.med_id,
                        encounter_id: encounter.id,
                        patient_id: patientId,
                        scheduled_datetime: new Date().toISOString(),
                        dose_given: parseFloat(emarGiveModal!.dose) || 0,
                        dose_unit: emarGiveModal!.dose.replace(/[0-9.]/g, '').trim() || 'mg',
                        route: emarGiveModal!.route,
                        administration_site: emarAdminSite || undefined,
                        medication_barcode_scanned: !!emarBarcode,
                      });
                      setEmarGiveModal(null);
                      setEmarBarcode('');
                      setEmarAdminSite('');
                      try { await emarLock.release(); } catch {}
                      loadData();
                    } catch (err: any) {
                      alert(`Failed to record: ${err.message}`);
                    }
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
                  onMouseEnter={(e) => { if (!emarLocked) e.currentTarget.style.background = '#086a31'; }}
                  onMouseLeave={(e) => { if (!emarLocked) e.currentTarget.style.background = '#0B8A3E'; }}
                  disabled={emarLocked}
                >
                  {emarLocked ? 'Locked' : 'Confirm Give'}
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
              {emarLocked && (
                <LockBanner current={emarLock.current} surfaceLabel="This medication" onRetry={emarLock.acquire} />
              )}

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
                  onClick={async () => {
                    if (!encounter?.id || !emarHoldReason) { alert('Please select a reason'); return; }
                    try {
                      await trpcMutate('medicationOrders.emarHold', {
                        medication_request_id: emarHoldModal!.med_id,
                        encounter_id: encounter.id,
                        patient_id: patientId,
                        scheduled_datetime: new Date().toISOString(),
                        hold_reason: emarHoldReason,
                      });
                      setEmarHoldModal(null);
                      setEmarHoldReason('');
                      try { await emarLock.release(); } catch {}
                      loadData();
                    } catch (err: any) {
                      alert(`Failed to hold: ${err.message}`);
                    }
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
                  onMouseEnter={(e) => { if (!emarLocked) e.currentTarget.style.background = '#777'; }}
                  onMouseLeave={(e) => { if (!emarLocked) e.currentTarget.style.background = '#999'; }}
                  disabled={emarLocked}
                >
                  {emarLocked ? 'Locked' : 'Confirm Hold'}
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
              {emarLocked && (
                <LockBanner current={emarLock.current} surfaceLabel="This medication" onRetry={emarLock.acquire} />
              )}

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
                  onClick={async () => {
                    if (!encounter?.id || !emarRefuseReason) { alert('Please select a reason'); return; }
                    try {
                      await trpcMutate('medicationOrders.emarRefuse', {
                        medication_request_id: emarRefuseModal!.med_id,
                        encounter_id: encounter.id,
                        patient_id: patientId,
                        scheduled_datetime: new Date().toISOString(),
                        not_done_reason: emarRefuseReason,
                      });
                      setEmarRefuseModal(null);
                      setEmarRefuseReason('');
                      try { await emarLock.release(); } catch {}
                      loadData();
                    } catch (err: any) {
                      alert(`Failed to record refusal: ${err.message}`);
                    }
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
                  onMouseEnter={(e) => { if (!emarLocked) e.currentTarget.style.background = '#b85c03'; }}
                  onMouseLeave={(e) => { if (!emarLocked) e.currentTarget.style.background = '#D97706'; }}
                  disabled={emarLocked}
                >
                  {emarLocked ? 'Locked' : 'Confirm Refusal'}
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
          {/* Discharge Checklist — shows only when discharge has been initiated */}
          <DischargeChecklist
            patientId={patientId}
            encounterId={encounter?.id}
            userRole={userRole}
            userName={userName}
          />

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

      {/* ── Forms Tab (SC.5) ──────────────────────────────────────────────────── */}
      {/* ── Brief Tab (N.6) ───────────────────────────────────────────────── */}
      {activeTab === 'brief' && (
        <BriefTab
          patientId={patientId}
          userRole={userRole}
          userName={userName}
        />
      )}

      {/* ── Calculators Tab (PC.2b1) ─────────────────────────────────────── */}
      {activeTab === 'calculators' && (
        <CalculatorsTab
          patientId={patientId}
          encounterId={encounter?.id ?? null}
          userRole={userRole}
          userName={userName}
          initialCalcId={initialCalcId}
          onInitialCalcConsumed={() => setInitialCalcId(null)}
          chartContext={{
            patient: { age: Number.isFinite(age) ? age : undefined, sex: patient.sex ?? patient.gender ?? null },
            conditions: conditions.map((c) => ({ condition_name: c.condition_name, status: c.status })),
            medications: medications.map((m) => ({ medication_name: m.medication_name, status: m.status })),
            vitals: vitals.map((v) => ({
              observation_type: v.observation_type,
              value: v.value,
              unit: v.unit,
              effective_datetime: v.effective_datetime,
            })),
          }}
        />
      )}

      {/* ── Documents Tab (N.2) ──────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <DocumentsTab
          patientId={patientId}
          userRole={userRole}
          userName={userName}
        />
      )}

      {activeTab === 'forms' && (
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#002054' }}>Form Submissions</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <FormLauncher slug="vitals" label="Log Vitals" icon={'📊'} patientId={patientId} encounterId={encounter?.id} variant="outline" size="sm" />
              <FormLauncher slug="notes" label="Clinical Note" icon={'📝'} patientId={patientId} encounterId={encounter?.id} variant="outline" size="sm" />
              <FormLauncher slug="meds" label="Medication" icon={'💊'} patientId={patientId} encounterId={encounter?.id} variant="outline" size="sm" />
            </div>
          </div>
          <FormHistoryPanel patientId={patientId} encounterId={encounter?.id} />
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
              onClick={async () => {
                if (!encounter?.id) { alert('No active encounter'); return; }
                const drugEl = document.querySelector('input[placeholder="Search drug name..."]') as HTMLInputElement;
                const doseEl = document.querySelector('input[placeholder*="25mg"]') as HTMLInputElement;
                const drugName = drugEl?.value?.trim();
                const dose = doseEl?.value?.trim();
                if (!drugName) { alert('Please enter a drug name'); return; }
                setOrderSubmitting(true);
                try {
                  await trpcMutate('medicationOrders.createMedicationOrder', {
                    patient_id: patientId,
                    encounter_id: encounter.id,
                    drug_name: drugName,
                    dose_quantity: dose ? parseFloat(dose) || undefined : undefined,
                    dose_unit: dose ? dose.replace(/[0-9.]/g, '').trim() || 'mg' : undefined,
                    route: 'PO',
                    instructions: undefined,
                  });
                  setOrderPanel('none');
                  loadData();
                  setOrdersLoaded(false);
                } catch (err: any) {
                  alert(`Failed to place order: ${err.message}`);
                } finally {
                  setOrderSubmitting(false);
                }
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
              onClick={async () => {
                if (!encounter?.id) { alert('No active encounter'); return; }
                const testEl = document.querySelector('input[placeholder="Search individual test..."]') as HTMLInputElement;
                const indicationEl = document.querySelector('textarea[placeholder*="Baseline before"]') as HTMLTextAreaElement;
                const testName = testEl?.value?.trim();
                if (!testName) { alert('Please enter a test name'); return; }
                setOrderSubmitting(true);
                try {
                  await trpcMutate('medicationOrders.createServiceRequest', {
                    patient_id: patientId,
                    encounter_id: encounter.id,
                    request_type: 'lab',
                    order_name: testName,
                    clinical_indication: indicationEl?.value?.trim() || undefined,
                    priority: 'routine',
                  });
                  setOrderPanel('none');
                  loadData();
                  setOrdersLoaded(false);
                } catch (err: any) {
                  alert(`Failed to place lab order: ${err.message}`);
                } finally {
                  setOrderSubmitting(false);
                }
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
              onClick={async () => {
                if (!encounter?.id) { alert('No active encounter'); return; }
                const studyEl = document.querySelector('input[placeholder*="Chest PA"]') as HTMLInputElement;
                const imgIndicationEl = document.querySelector('input[placeholder*="Fever, SOB"]') as HTMLInputElement;
                const studyName = studyEl?.value?.trim();
                if (!studyName) { alert('Please enter a study name'); return; }
                setOrderSubmitting(true);
                try {
                  await trpcMutate('medicationOrders.createServiceRequest', {
                    patient_id: patientId,
                    encounter_id: encounter.id,
                    request_type: 'imaging',
                    order_name: studyName,
                    clinical_indication: imgIndicationEl?.value?.trim() || undefined,
                    priority: 'routine',
                    body_part: studyName,
                  });
                  setOrderPanel('none');
                  loadData();
                  setOrdersLoaded(false);
                } catch (err: any) {
                  alert(`Failed to place imaging order: ${err.message}`);
                } finally {
                  setOrderSubmitting(false);
                }
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
              onClick={async () => {
                if (!encounter?.id) { alert('No active encounter'); return; }
                const reasonEl = document.querySelector('textarea[placeholder*="Rising creatinine"]') as HTMLTextAreaElement;
                const reason = reasonEl?.value?.trim();
                if (!reason) { alert('Please enter a reason for consult'); return; }
                setOrderSubmitting(true);
                try {
                  await trpcMutate('medicationOrders.createServiceRequest', {
                    patient_id: patientId,
                    encounter_id: encounter.id,
                    request_type: 'consult',
                    order_name: 'Consult Request',
                    referral_reason: reason,
                    clinical_indication: reason,
                    priority: 'routine',
                  });
                  setOrderPanel('none');
                  loadData();
                  setOrdersLoaded(false);
                } catch (err: any) {
                  alert(`Failed to request consult: ${err.message}`);
                } finally {
                  setOrderSubmitting(false);
                }
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

      {/* PC.1a: Omnipresent Chat slider — dual rooms for this patient (encounter + persistent) */}
      {encounter && (
        <ChatPanel
          isOpen={commsOpen}
          onClose={() => setCommsOpen(false)}
          userId={userId}
          userRole={userRole}
          userName={userName}
          initialChannelId={commsInitialChannelId || undefined}
          extraChannels={[
            {
              group: 'THIS PATIENT',
              type: 'patient-thread',
              id: `patient-enc-${encounter.id}`,
              name: `Current admission · ${patient?.name_full || patient?.full_name || `${patient?.name_given ?? ''} ${patient?.name_family ?? ''}`.trim() || 'Patient'}`,
              unread: 0,
            },
            {
              group: 'THIS PATIENT',
              type: 'patient-thread',
              id: `patient-persistent-${patientId}`,
              name: `Patient (all time) · UHID ${patient?.uhid ?? patientId}`,
              unread: 0,
            },
          ] as ChatChannel[]}
        />
      )}

      {/* CSS for pulse animation + responsive overrides */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        /* Collapse overview grid on narrow screens (tablets portrait and phones) */
        @media (max-width: 860px) {
          .patient-chart-overview-grid {
            grid-template-columns: 1fr !important;
          }
        }
        /* Comfortable touch targets on tablets */
        @media (pointer: coarse) {
          .patient-chart-tab-btn {
            min-height: 44px !important;
            padding: 12px 4px !important;
          }
        }
        /* Smooth scrolling on timeline */
        .tl-scroll::-webkit-scrollbar { width: 4px; }
        .tl-scroll::-webkit-scrollbar-track { background: transparent; }
        .tl-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
      `}</style>
    </div>
  );
}
