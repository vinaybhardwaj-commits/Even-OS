/**
 * useChartAction — single source of truth for bottom-bar action pill routing.
 *
 * Shipped with PC.1b1 (18 Apr 2026). Replaces the switch in handleActionClick().
 * Role-to-pill mapping lives in a registry so PC.1b2 can extend it per PRD §6.
 *
 * Consumer usage (see patient-chart-client.tsx):
 *
 *     const { handleAction } = useChartAction({ setActiveTab, setOrderPanel });
 *     const actionButtons = getActionsForRole(userRole);  // [{ label, icon }]
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
}

export interface ChartAction {
  label: string;
  icon: string;
  /** Which role class this pill renders for. PC.1b2 will extend this for full PRD §6. */
  audience: 'doctor' | 'nurse' | 'fallback';
  /** The side-effect when the pill is tapped. */
  run: (deps: ChartActionDeps) => void;
}

const DOCTOR_ROLES = new Set<string>([
  'resident', 'senior_resident', 'intern',
  'visiting_consultant', 'hospitalist',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'surgeon', 'anaesthetist',
  'department_head', 'medical_director',
]);

const NURSE_ROLES = new Set<string>([
  'nurse', 'senior_nurse', 'charge_nurse',
  'nursing_supervisor', 'nursing_manager', 'ot_nurse',
]);

function roleClass(role: string): 'doctor' | 'nurse' | 'other' {
  if (DOCTOR_ROLES.has(role)) return 'doctor';
  if (NURSE_ROLES.has(role)) return 'nurse';
  return 'other';
}

/** Registry — each action appears exactly once. Keep in PRD §6 order. */
export const CHART_ACTIONS: ChartAction[] = [
  // Doctor pills
  { label: 'SOAP Note',    icon: '📝', audience: 'doctor', run: ({ setActiveTab }) => setActiveTab('notes') },
  { label: 'Prescribe Med', icon: '💊', audience: 'doctor', run: ({ setOrderPanel }) => setOrderPanel('medication') },
  { label: 'Order Labs',   icon: '🧪', audience: 'doctor', run: ({ setOrderPanel }) => setOrderPanel('labs') },
  { label: 'Consult',      icon: '👥', audience: 'doctor', run: ({ setOrderPanel }) => setOrderPanel('consult') },

  // Nurse pills
  { label: 'Record Vitals',   icon: '📊', audience: 'nurse', run: ({ setActiveTab }) => setActiveTab('vitals') },
  { label: 'Give Medication', icon: '💊', audience: 'nurse', run: ({ setActiveTab }) => setActiveTab('emar') },
  { label: 'Nursing Note',    icon: '📝', audience: 'nurse', run: ({ setActiveTab }) => setActiveTab('notes') },
  { label: 'Assessment',      icon: '✅', audience: 'nurse', run: ({ setActiveTab }) => setActiveTab('forms') },

  // Fallback — applies to anyone whose role class isn't doctor/nurse.
  { label: 'Add Note',        icon: '📝', audience: 'fallback', run: ({ setActiveTab }) => setActiveTab('notes') },
];

export function getActionsForRole(role: string): { label: string; icon: string }[] {
  const rc = roleClass(role);
  const audience: ChartAction['audience'] = rc === 'doctor' ? 'doctor' : rc === 'nurse' ? 'nurse' : 'fallback';
  return CHART_ACTIONS
    .filter((a) => a.audience === audience)
    .map(({ label, icon }) => ({ label, icon }));
}

/** The single entry point the UI should call when a pill is tapped. */
export function useChartAction(deps: ChartActionDeps) {
  const { setActiveTab, setOrderPanel } = deps;

  const handleAction = useCallback((label: string) => {
    const action = CHART_ACTIONS.find((a) => a.label === label);
    if (!action) {
      if (typeof console !== 'undefined') console.warn('[chart] unhandled action pill:', label);
      return;
    }
    action.run({ setActiveTab, setOrderPanel });
  }, [setActiveTab, setOrderPanel]);

  // Convenience: expose known labels (e.g. for tests / help text).
  const knownLabels = useMemo(() => CHART_ACTIONS.map((a) => a.label), []);

  return { handleAction, knownLabels };
}
