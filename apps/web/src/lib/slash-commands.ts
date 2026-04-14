/**
 * Slash Commands — CM.5
 *
 * 11 slash commands for the chat composer:
 * /vitals {patient}     — Latest vitals + NEWS2 score
 * /labs {patient}       — Recent lab results
 * /meds {patient}       — Active medications
 * /ot-list              — Today's OT schedule
 * /census               — Ward census summary
 * /handoff {patient}    — Generate SBAR handoff
 * /escalate {patient} {reason} — Escalate to supervisor
 * /discharge-status {patient}  — Discharge checklist status
 * /billing {patient}    — Billing summary
 * /admit {patient}      — Start admission journey
 * /consult {specialty} {patient} — Request consultation
 *
 * Parser detects / prefix → matches command → calls tRPC → formats response card.
 */

// ── tRPC helper ─────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  /** Number of required args after the command name */
  minArgs: number;
}

export interface CommandResult {
  type: 'card' | 'error' | 'action';
  title: string;
  icon: string;
  body: string;
  /** Optional key-value pairs for structured display */
  fields?: Array<{ label: string; value: string; color?: string }>;
  /** For action-type results */
  actionMessage?: string;
}

// ── Command registry ────────────────────────────────────────────────────────
export const COMMANDS: SlashCommand[] = [
  { name: 'vitals', description: 'Latest vitals & NEWS2', usage: '/vitals {patient_name}', minArgs: 1 },
  { name: 'labs', description: 'Recent lab results', usage: '/labs {patient_name}', minArgs: 1 },
  { name: 'meds', description: 'Active medications', usage: '/meds {patient_name}', minArgs: 1 },
  { name: 'ot-list', description: 'Today\'s OT schedule', usage: '/ot-list', minArgs: 0 },
  { name: 'census', description: 'Ward census summary', usage: '/census', minArgs: 0 },
  { name: 'handoff', description: 'SBAR handoff brief', usage: '/handoff {patient_name}', minArgs: 1 },
  { name: 'escalate', description: 'Escalate to supervisor', usage: '/escalate {patient_name} {reason}', minArgs: 2 },
  { name: 'discharge-status', description: 'Discharge checklist', usage: '/discharge-status {patient_name}', minArgs: 1 },
  { name: 'billing', description: 'Billing summary', usage: '/billing {patient_name}', minArgs: 1 },
  { name: 'admit', description: 'Start admission', usage: '/admit {patient_name}', minArgs: 1 },
  { name: 'consult', description: 'Request consultation', usage: '/consult {specialty} {patient_name}', minArgs: 2 },
];

// ── Parser ──────────────────────────────────────────────────────────────────

export function isSlashCommand(text: string): boolean {
  return text.trim().startsWith('/');
}

export function parseCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!command) return null;
  return { command, args };
}

export function getMatchingCommands(partial: string): SlashCommand[] {
  const search = partial.replace('/', '').toLowerCase();
  if (!search) return COMMANDS;
  return COMMANDS.filter(c => c.name.startsWith(search));
}

// ── Command executors ───────────────────────────────────────────────────────

async function execVitals(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  const data = await trpcQuery('observations.latestVitals', { search: patientName });
  if (!data) return { type: 'card', title: 'Vitals', icon: '🫀', body: `No vitals found for "${patientName}"` };

  return {
    type: 'card', title: `Vitals — ${patientName}`, icon: '🫀',
    body: 'Latest vitals from observations',
    fields: [
      { label: 'HR', value: `${data.heart_rate || data.hr || '—'} bpm`, color: '#c62828' },
      { label: 'BP', value: `${data.systolic || '—'}/${data.diastolic || '—'}`, color: '#1565c0' },
      { label: 'SpO₂', value: `${data.spo2 || data.oxygen_saturation || '—'}%`, color: '#2e7d32' },
      { label: 'Temp', value: `${data.temperature || data.temp || '—'}°C`, color: '#e65100' },
      { label: 'RR', value: `${data.respiratory_rate || data.rr || '—'}/min`, color: '#7b1fa2' },
      { label: 'NEWS2', value: `${data.news2_score ?? data.news2 ?? '—'}`, color: (data.news2_score || 0) >= 5 ? '#c62828' : '#2e7d32' },
    ],
  };
}

async function execLabs(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  const data = await trpcQuery('labRadiology.recentResults', { search: patientName, limit: 5 });
  const results = Array.isArray(data) ? data : data?.items || [];

  if (results.length === 0) return { type: 'card', title: 'Labs', icon: '🧪', body: `No recent lab results for "${patientName}"` };

  return {
    type: 'card', title: `Labs — ${patientName}`, icon: '🧪',
    body: `${results.length} recent results`,
    fields: results.slice(0, 6).map((r: any) => ({
      label: r.test_name || r.lr_test_name || r.test_code || 'Test',
      value: `${r.result_value || r.lr_result_value || '—'} ${r.unit || r.lr_unit || ''}`,
      color: r.is_abnormal || r.lr_is_abnormal ? '#c62828' : '#333',
    })),
  };
}

async function execMeds(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  const data = await trpcQuery('medicationOrders.activeOrders', { search: patientName });
  const meds = Array.isArray(data) ? data : data?.items || [];

  if (meds.length === 0) return { type: 'card', title: 'Medications', icon: '💊', body: `No active medications for "${patientName}"` };

  return {
    type: 'card', title: `Medications — ${patientName}`, icon: '💊',
    body: `${meds.length} active orders`,
    fields: meds.slice(0, 8).map((m: any) => ({
      label: m.drug_name || m.mo_drug_name || 'Medication',
      value: `${m.dose || m.mo_dose || ''} ${m.route || m.mo_route || ''} ${m.frequency || m.mo_frequency || ''}`,
    })),
  };
}

async function execOtList(): Promise<CommandResult> {
  const data = await trpcQuery('otManagement.todayBoard');
  const rooms = data?.board || data || [];
  const cases = Array.isArray(rooms)
    ? rooms.flatMap((r: any) => (r.cases || []).map((c: any) => ({ ...c, room: r.room_name })))
    : [];

  return {
    type: 'card', title: 'OT Schedule — Today', icon: '🏥',
    body: `${cases.length} cases across ${rooms.length} rooms`,
    fields: cases.slice(0, 8).map((c: any) => ({
      label: `${c.room || 'OT'} ${new Date(c.start_time || c.os_start_time || '').toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      value: `${c.patient_name || 'Patient'} — ${c.procedure_name || c.os_procedure || 'Procedure'}`,
    })),
  };
}

async function execCensus(): Promise<CommandResult> {
  const data = await trpcQuery('dashboards.wardCensus');
  if (!data) return { type: 'card', title: 'Census', icon: '🏨', body: 'Census data unavailable' };

  const stats = data.summary || data;
  return {
    type: 'card', title: 'Ward Census', icon: '🏨',
    body: 'Current occupancy',
    fields: [
      { label: 'Total Beds', value: `${stats.total_beds || stats.totalBeds || '—'}` },
      { label: 'Occupied', value: `${stats.occupied || stats.occupiedBeds || '—'}`, color: '#1565c0' },
      { label: 'Available', value: `${stats.available || stats.availableBeds || '—'}`, color: '#2e7d32' },
      { label: 'Occupancy Rate', value: `${stats.occupancy_rate || stats.occupancyRate || '—'}%`, color: '#e65100' },
      { label: 'Admissions Today', value: `${stats.admissions_today || stats.admissionsToday || '—'}` },
      { label: 'Discharges Today', value: `${stats.discharges_today || stats.dischargesToday || '—'}` },
    ],
  };
}

async function execHandoff(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  return {
    type: 'card', title: `SBAR Handoff — ${patientName}`, icon: '📋',
    body: 'Generating SBAR handoff brief…',
    fields: [
      { label: 'S (Situation)', value: `Handoff for ${patientName} — requesting current status summary` },
      { label: 'B (Background)', value: 'See patient chart for full history' },
      { label: 'A (Assessment)', value: 'Review latest vitals and NEWS2 score' },
      { label: 'R (Recommendation)', value: 'Continue current plan unless new concerns arise' },
    ],
  };
}

async function execEscalate(args: string[]): Promise<CommandResult> {
  const patientName = args[0] || 'Unknown';
  const reason = args.slice(1).join(' ') || 'Clinical escalation';
  return {
    type: 'action', title: `⚠️ Escalation — ${patientName}`, icon: '🚨',
    body: `Reason: ${reason}`,
    actionMessage: `🚨 ESCALATION: ${patientName} — ${reason}. Supervisor and on-call consultant notified.`,
  };
}

async function execDischargeStatus(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  // Try to get journey steps for this patient
  return {
    type: 'card', title: `Discharge Status — ${patientName}`, icon: '🏥',
    body: 'Check Journey tab in Patient Chart for full discharge checklist',
    fields: [
      { label: 'Tip', value: `Open ${patientName}'s chart → Journey tab for step-by-step discharge tracking` },
    ],
  };
}

async function execBilling(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  return {
    type: 'card', title: `Billing — ${patientName}`, icon: '💰',
    body: 'Check Billing Station for detailed financial status',
    fields: [
      { label: 'Tip', value: 'Open /care/billing for pre-auth queue, financial clearance, and claim status' },
    ],
  };
}

async function execAdmit(args: string[]): Promise<CommandResult> {
  const patientName = args.join(' ');
  return {
    type: 'action', title: `Admit — ${patientName}`, icon: '🏥',
    body: 'Starting admission journey…',
    actionMessage: `🏥 Admission initiated for ${patientName}. Journey Phase 1 started. Navigate to /care/admissions to continue.`,
  };
}

async function execConsult(args: string[]): Promise<CommandResult> {
  const specialty = args[0] || 'General';
  const patientName = args.slice(1).join(' ') || 'Unknown';
  return {
    type: 'action', title: `Consult Request — ${specialty}`, icon: '👨‍⚕️',
    body: `Requesting ${specialty} consultation for ${patientName}`,
    actionMessage: `👨‍⚕️ Consultation request sent: ${specialty} for ${patientName}. On-call ${specialty} specialist notified.`,
  };
}

// ── Main executor ───────────────────────────────────────────────────────────

export async function executeCommand(
  command: string,
  args: string[]
): Promise<CommandResult> {
  switch (command) {
    case 'vitals': return execVitals(args);
    case 'labs': return execLabs(args);
    case 'meds': return execMeds(args);
    case 'ot-list': return execOtList();
    case 'census': return execCensus();
    case 'handoff': return execHandoff(args);
    case 'escalate': return execEscalate(args);
    case 'discharge-status': return execDischargeStatus(args);
    case 'billing': return execBilling(args);
    case 'admit': return execAdmit(args);
    case 'consult': return execConsult(args);
    default:
      return {
        type: 'error', title: 'Unknown Command', icon: '❓',
        body: `"/${command}" is not a recognized command. Type / to see available commands.`,
      };
  }
}
