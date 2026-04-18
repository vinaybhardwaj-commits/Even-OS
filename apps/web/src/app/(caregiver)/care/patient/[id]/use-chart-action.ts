/**
 * useChartAction — single source of truth for bottom-bar action pill routing.
 *
 * Shipped with PC.1b1. PC.1b2 extension (18 Apr 2026):
 *   - Per-role presets for the core 6 roles (resident, senior_resident,
 *     specialist*, nurse, charge_nurse, nursing_supervisor) per PRD §8.
 *   - Two new actions: Handoff (charge_nurse / nursing_supervisor) and
 *     Escalate (nursing_supervisor).
 *   - ChartActionDeps widened to include setCommsOpen so Escalate can open
 *     the Comms slider.
 *
 * Consumer usage (see patient-chart-client.tsx):
 *
 *     const { handleAction } = useChartAction({ setActiveTab, setOrderPanel, setCommsOpen });
 *     const actionButtons = getActionsForRole(userRole);
 *     ...
 *     <button onClick={() => handleAction(btn.label)}>
 */
import { useCallback, useMemo } from 'react';

// Must mirror PatientTab + orderPanel union in patient-chart-client.tsx
export type ChartTab =
  | 'overview' | 'vitals' | 'labs' | 'orders' | 'notes' | 'plan'
  | 'emar' | 'assessments' | 'billing' | 'journey' | 'forms'
  | 'documents' | 'brief';

export type ChartOrderPanel = 'none' | 'medication' | 'labs' | 'imaging' | 'consult';

export interface ChartActionDeps {
  setActiveTab: (t: ChartTab) => void;
  setOrderPanel: (p: ChartOrderPanel) => void;
  /** Optional — Escalate uses this to open the Comms slider. */
  setCommsOpen?: (open: boolean) => void;
}

export interface ChartAction {
  label: string;
  icon: string;
  /** Stable slug for matrix action_bar_preset lookups (PC.3.2.2). */
  slug: string;
  /** The side-effect when the pill is tapped. */
  run: (deps: ChartActionDeps) => void;
}

// ── Core 6 role ids (PC.1b2 scope) ──────────────────────────────────────────
// The PRD also names senior_consultant etc. — those are folded into the
// specialist bucket via SPECIALIST_ROLES below.
const DOCTOR_ROLES = new Set<string>([
  'resident', 'senior_resident', 'intern',
  'visiting_consultant', 'hospitalist', 'consultant', 'senior_consultant',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'surgeon', 'anaesthetist',
  'department_head', 'medical_director',
]);

const NURSE_ROLES = new Set<string>([
  'nurse', 'senior_nurse',
  'nursing_manager', 'ot_nurse',
]);

const SPECIALIST_ROLES = new Set<string>([
  'visiting_consultant', 'hospitalist', 'consultant', 'senior_consultant',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'surgeon', 'anaesthetist',
  'department_head', 'medical_director',
]);

/** Maps an arbitrary role id onto one of the core-6 buckets. */
function roleBucket(role: string):
  | 'resident' | 'senior_resident' | 'specialist'
  | 'nurse' | 'charge_nurse' | 'nursing_supervisor'
  | 'other' {
  if (role === 'resident' || role === 'intern') return 'resident';
  if (role === 'senior_resident') return 'senior_resident';
  if (role === 'charge_nurse') return 'charge_nurse';
  if (role === 'nursing_supervisor') return 'nursing_supervisor';
  if (SPECIALIST_ROLES.has(role)) return 'specialist';
  if (NURSE_ROLES.has(role)) return 'nurse';
  if (DOCTOR_ROLES.has(role)) return 'specialist';      // clinician fallback
  return 'other';
}

/** Registry — each action appears exactly once. Label is the dispatch key. */
export const CHART_ACTIONS: ChartAction[] = [
  // Clinician actions
  { label: 'SOAP Note',     icon: '📝', slug: 'soap',           run: ({ setActiveTab }) => setActiveTab('notes') },
  { label: 'Prescribe Med', icon: '💊', slug: 'prescribe',      run: ({ setOrderPanel }) => setOrderPanel('medication') },
  { label: 'Order Labs',    icon: '🧪', slug: 'labs',           run: ({ setOrderPanel }) => setOrderPanel('labs') },
  { label: 'Consult',       icon: '👥', slug: 'consults',       run: ({ setOrderPanel }) => setOrderPanel('consult') },

  // Nurse actions
  { label: 'Record Vitals',   icon: '📊', slug: 'record_vitals',  run: ({ setActiveTab }) => setActiveTab('vitals') },
  { label: 'Give Medication', icon: '💊', slug: 'administer_med', run: ({ setActiveTab }) => setActiveTab('emar') },
  { label: 'Nursing Note',    icon: '📝', slug: 'nursing_note',   run: ({ setActiveTab }) => setActiveTab('notes') },
  { label: 'Assessment',      icon: '✅', slug: 'assessment',     run: ({ setActiveTab }) => setActiveTab('forms') },

  // PC.1b2 — new actions
  { label: 'Handoff',  icon: '🔁', slug: 'handoff',  run: ({ setActiveTab }) => setActiveTab('forms') },
  { label: 'Escalate', icon: '🚨', slug: 'escalate', run: ({ setCommsOpen }) => { if (setCommsOpen) setCommsOpen(true); } },

  // Fallback
  { label: 'Add Note', icon: '📝', slug: 'add_note', run: ({ setActiveTab }) => setActiveTab('notes') },
];

// PC.3.2.2: resolve matrix slug list → action button list.
// Returns null if any slug is unknown (caller should fall back to role preset).
export function resolveActionsFromSlugs(
  slugs: string[]
): { label: string; icon: string }[] | null {
  const bySlug = new Map(CHART_ACTIONS.map((a) => [a.slug, a] as const));
  const resolved: { label: string; icon: string }[] = [];
  for (const s of slugs) {
    const action = bySlug.get(s);
    if (!action) return null; // abort; safe fallback in caller
    resolved.push({ label: action.label, icon: action.icon });
  }
  return resolved;
}

/**
 * Per-role pill presets from PRD §8. The order here IS the display order.
 * Keep in sync with PRD decision: Doctor/RMO/Surgeon share the same preset,
 * Charge Nurse adds Handoff, Nursing Supervisor adds Handoff + Escalate.
 */
const ROLE_PRESETS: Record<string, string[]> = {
  resident:           ['SOAP Note', 'Prescribe Med', 'Order Labs', 'Consult'],
  senior_resident:    ['SOAP Note', 'Prescribe Med', 'Order Labs', 'Consult'],
  specialist:         ['SOAP Note', 'Prescribe Med', 'Order Labs', 'Consult'],
  nurse:              ['Record Vitals', 'Give Medication', 'Nursing Note', 'Assessment'],
  charge_nurse:       ['Assessment', 'Record Vitals', 'Give Medication', 'Handoff'],
  nursing_supervisor: ['Assessment', 'Record Vitals', 'Handoff', 'Escalate'],
  other:              ['Add Note'],
};

export function getActionsForRole(role: string): { label: string; icon: string }[] {
  const bucket = roleBucket(role);
  const labels = ROLE_PRESETS[bucket] || ROLE_PRESETS.other;
  const byLabel = new Map(CHART_ACTIONS.map((a) => [a.label, a] as const));
  return labels
    .map((lbl) => byLabel.get(lbl))
    .filter((a): a is ChartAction => Boolean(a))
    .map(({ label, icon }) => ({ label, icon }));
}

/** The single entry point the UI should call when a pill is tapped. */
export function useChartAction(deps: ChartActionDeps) {
  const { setActiveTab, setOrderPanel, setCommsOpen } = deps;

  const handleAction = useCallback((label: string) => {
    const action = CHART_ACTIONS.find((a) => a.label === label);
    if (!action) {
      if (typeof console !== 'undefined') console.warn('[chart] unhandled action pill:', label);
      return;
    }
    action.run({ setActiveTab, setOrderPanel, setCommsOpen });
  }, [setActiveTab, setOrderPanel, setCommsOpen]);

  const knownLabels = useMemo(() => CHART_ACTIONS.map((a) => a.label), []);

  return { handleAction, knownLabels };
}
