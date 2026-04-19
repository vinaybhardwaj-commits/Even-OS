/**
 * PC.4.B.4 — Notification event → chart tab navigation mapping.
 *
 * Each of the 7 event types emitted by chart_notification_events (PC.4.B.2)
 * maps to a destination inside the patient chart. Critical vitals/labs land
 * on the overview tab (where the vitals + labs summary cards live);
 * calculator red-bands deep-link via initialCalcId; edit-lock-override has
 * no navigation target (just dismiss the drawer).
 *
 * Consumed by patient-chart-client.tsx when a notification row is clicked.
 */
export type ChartEventType =
  | 'critical_vital'
  | 'critical_lab'
  | 'cosign_overdue'
  | 'llm_proposal_new'
  | 'calc_red_band'
  | 'encounter_transition'
  | 'edit_lock_override';

export type ChartNotificationTarget =
  | { tab: 'overview' }
  | { tab: 'notes' }
  | { tab: 'documents' }
  | { tab: 'calculators'; initialCalcId?: string | null }
  | { tab: null /* no navigation — drawer close only */ };

export function getNotificationTarget(
  eventType: string,
  payload?: Record<string, unknown> | null,
): ChartNotificationTarget {
  switch (eventType as ChartEventType) {
    case 'critical_vital':
    case 'critical_lab':
    case 'encounter_transition':
      return { tab: 'overview' };
    case 'llm_proposal_new':
      return { tab: 'documents' };
    case 'cosign_overdue':
      return { tab: 'notes' };
    case 'calc_red_band': {
      const calcId =
        payload && typeof payload === 'object' && 'calc_id' in payload
          ? (payload as { calc_id?: unknown }).calc_id
          : null;
      return {
        tab: 'calculators',
        initialCalcId: typeof calcId === 'string' ? calcId : null,
      };
    }
    case 'edit_lock_override':
    default:
      return { tab: null };
  }
}

/**
 * Short human labels for notification rows (drawer left side badges etc).
 */
export function getEventTypeLabel(eventType: string): string {
  switch (eventType as ChartEventType) {
    case 'critical_vital':
      return 'Vital';
    case 'critical_lab':
      return 'Lab';
    case 'cosign_overdue':
      return 'Co-sign';
    case 'llm_proposal_new':
      return 'Proposal';
    case 'calc_red_band':
      return 'Calc';
    case 'encounter_transition':
      return 'Transition';
    case 'edit_lock_override':
      return 'Lock';
    default:
      return 'Event';
  }
}
