/**
 * Chat Action Handler — CM.4
 *
 * Processes button clicks on actionable messages in the chat panel.
 * Each action type maps to a specific tRPC mutation + confirmation.
 *
 * Action types:
 * - assign_nurse: Ward intimation → create patient assignment
 * - acknowledge: Critical value alert → record acknowledgement
 * - give_med: Overdue medication → open Give Med panel
 * - start_cleaning: Patient exit → mark housekeeping step started
 * - complete_step: Generic journey step completion
 * - open_chart: Navigate to patient chart
 */

// ── Action definitions ──────────────────────────────────────────────────────
export interface ChatAction {
  type: ActionType;
  label: string;
  icon: string;
  color: string;
  /** Data payload needed to execute the action */
  payload: Record<string, string>;
}

export type ActionType =
  | 'assign_nurse'
  | 'acknowledge'
  | 'give_med'
  | 'start_cleaning'
  | 'complete_step'
  | 'open_chart';

export interface ActionResult {
  success: boolean;
  message: string;
  /** If the action opens a page instead of mutating */
  navigateTo?: string;
}

// ── tRPC helper ─────────────────────────────────────────────────────────────
async function trpcMutate(path: string, input: any): Promise<any> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Action failed');
  return json.result?.data?.json;
}

// ── Action executors ────────────────────────────────────────────────────────

async function executeAssignNurse(payload: Record<string, string>, userName: string): Promise<ActionResult> {
  // This creates a journey notification for the charge nurse
  // The actual assignment happens through the nurse station UI
  try {
    await trpcMutate('journeyEngine.completeStep', {
      step_id: payload.step_id,
      completed_notes: `Ward intimation acknowledged by ${userName}. Nurse assignment pending.`,
    });
    return { success: true, message: `✅ Ward intimation acknowledged. Charge nurse notified for assignment.` };
  } catch {
    return { success: false, message: '❌ Failed to process. Please try again.' };
  }
}

async function executeAcknowledge(payload: Record<string, string>, userName: string): Promise<ActionResult> {
  try {
    // If there's a step_id, complete the journey step
    if (payload.step_id) {
      await trpcMutate('journeyEngine.completeStep', {
        step_id: payload.step_id,
        completed_notes: `Acknowledged by ${userName}`,
      });
    }
    return { success: true, message: `✅ Acknowledged by ${userName}` };
  } catch {
    return { success: false, message: '❌ Failed to acknowledge. Please try again.' };
  }
}

async function executeGiveMed(payload: Record<string, string>): Promise<ActionResult> {
  // Navigate to eMAR for this patient
  const patientId = payload.patient_id;
  if (patientId) {
    return {
      success: true,
      message: '🔗 Opening eMAR…',
      navigateTo: `/care/nurse/emar?patient=${patientId}`,
    };
  }
  return { success: true, message: '🔗 Opening eMAR…', navigateTo: '/care/nurse/emar' };
}

async function executeStartCleaning(payload: Record<string, string>, userName: string): Promise<ActionResult> {
  try {
    if (payload.step_id) {
      await trpcMutate('journeyEngine.completeStep', {
        step_id: payload.step_id,
        completed_notes: `Terminal cleaning started by ${userName}`,
      });
    }
    return { success: true, message: `🧹 Terminal cleaning started. Marked in progress.` };
  } catch {
    return { success: false, message: '❌ Failed to start cleaning. Please try again.' };
  }
}

async function executeCompleteStep(payload: Record<string, string>, userName: string): Promise<ActionResult> {
  try {
    await trpcMutate('journeyEngine.completeStep', {
      step_id: payload.step_id,
      completed_notes: payload.notes || `Completed via chat action by ${userName}`,
    });
    return { success: true, message: `✅ Step completed by ${userName}` };
  } catch {
    return { success: false, message: '❌ Failed to complete step. Please try again.' };
  }
}

function executeOpenChart(payload: Record<string, string>): ActionResult {
  return {
    success: true,
    message: '🔗 Opening patient chart…',
    navigateTo: `/care/patient/${payload.patient_id}`,
  };
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function executeAction(
  action: ChatAction,
  userName: string
): Promise<ActionResult> {
  switch (action.type) {
    case 'assign_nurse':
      return executeAssignNurse(action.payload, userName);
    case 'acknowledge':
      return executeAcknowledge(action.payload, userName);
    case 'give_med':
      return executeGiveMed(action.payload);
    case 'start_cleaning':
      return executeStartCleaning(action.payload, userName);
    case 'complete_step':
      return executeCompleteStep(action.payload, userName);
    case 'open_chart':
      return executeOpenChart(action.payload);
    default:
      return { success: false, message: 'Unknown action type' };
  }
}

// ── Action factory — creates actions from journey step context ──────────────

export function createActionsForMessage(
  messageType: string,
  context: Record<string, string>
): ChatAction[] {
  switch (messageType) {
    case 'ward_intimation':
      return [
        { type: 'assign_nurse', label: 'Assign Nurse', icon: '👩‍⚕️', color: '#1565c0', payload: context },
        { type: 'open_chart', label: 'View Chart', icon: '📊', color: '#555', payload: context },
      ];
    case 'critical_value':
      return [
        { type: 'acknowledge', label: 'Acknowledge', icon: '✅', color: '#c62828', payload: context },
        { type: 'open_chart', label: 'View Chart', icon: '📊', color: '#555', payload: context },
      ];
    case 'overdue_med':
      return [
        { type: 'give_med', label: 'Give Now', icon: '💊', color: '#2e7d32', payload: context },
        { type: 'open_chart', label: 'View Chart', icon: '📊', color: '#555', payload: context },
      ];
    case 'patient_exit':
      return [
        { type: 'start_cleaning', label: 'Start Cleaning', icon: '🧹', color: '#e65100', payload: context },
      ];
    case 'journey_step':
      return [
        { type: 'complete_step', label: 'Complete', icon: '✅', color: '#1565c0', payload: context },
        { type: 'open_chart', label: 'View Chart', icon: '📊', color: '#555', payload: context },
      ];
    default:
      return [];
  }
}
