/**
 * Slash Commands Engine — OC.5b
 *
 * Parses slash commands from message text and executes them
 * against Even OS's existing tRPC/SQL endpoints.
 * Returns formatted response cards posted as `slash_result` messages.
 *
 * 11 commands:
 *   /vitals {patient}        — Latest vitals card
 *   /labs {patient}          — Lab results with abnormals
 *   /meds {patient}          — Active medication list
 *   /census                  — Ward census summary
 *   /handoff {patient}       — SBAR handoff template
 *   /escalate {patient} {reason} — Escalation to emergency
 *   /discharge-status {patient}  — Discharge checklist
 *   /billing {patient}       — Billing summary
 *   /task @{user} {desc}     — Task creation (handled separately by TaskCard)
 *   /consult {specialty} {patient} — Consult request
 *   /bed-status              — Bed availability
 */

import { neon } from '@neondatabase/serverless';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

// ── Types ────────────────────────────────────────────────

export interface SlashCommandDef {
  name: string;
  description: string;
  usage: string;
  roles: string[];  // Empty = all roles
  icon: string;
}

export interface SlashCommandResult {
  success: boolean;
  card_title: string;
  card_content: string;  // Pre-formatted markdown-like text
  card_icon: string;
  error?: string;
}

// ── Command Registry ─────────────────────────────────────

const NURSE_ROLES = ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager'];
const DOCTOR_ROLES = ['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'surgeon', 'anaesthetist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic'];
const ALL_CLINICAL = [...NURSE_ROLES, ...DOCTOR_ROLES, 'pharmacist', 'senior_pharmacist', 'lab_technician', 'senior_lab_technician'];
const BILLING_ROLES = ['billing_manager', 'billing_executive', 'insurance_coordinator'];

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'vitals',           description: 'Latest vitals for a patient',           usage: '/vitals {patient name or UHID}',          roles: [...NURSE_ROLES, ...DOCTOR_ROLES], icon: '📊' },
  { name: 'labs',             description: 'Latest lab results with abnormals',     usage: '/labs {patient name or UHID}',            roles: [...DOCTOR_ROLES, 'lab_technician', 'senior_lab_technician'], icon: '🧪' },
  { name: 'meds',             description: 'Active medication list',                usage: '/meds {patient name or UHID}',            roles: [...NURSE_ROLES, ...DOCTOR_ROLES, 'pharmacist', 'senior_pharmacist'], icon: '💊' },
  { name: 'census',           description: 'Current ward census',                   usage: '/census',                                 roles: ['charge_nurse', 'nursing_supervisor', 'nursing_manager', 'super_admin', 'admin'], icon: '🏥' },
  { name: 'handoff',          description: 'SBAR handoff template',                 usage: '/handoff {patient name or UHID}',         roles: NURSE_ROLES, icon: '🤝' },
  { name: 'escalate',         description: 'Create escalation message',             usage: '/escalate {patient} {reason}',            roles: ALL_CLINICAL, icon: '🚨' },
  { name: 'discharge-status', description: 'Discharge milestone checklist',         usage: '/discharge-status {patient name or UHID}',roles: [...DOCTOR_ROLES, 'ip_coordinator', 'customer_care'], icon: '🏁' },
  { name: 'billing',          description: 'Billing summary',                       usage: '/billing {patient name or UHID}',         roles: [...BILLING_ROLES, ...DOCTOR_ROLES], icon: '💰' },
  { name: 'task',             description: 'Create a task',                         usage: '/task @{user} {description}',             roles: [], icon: '☑️' },
  { name: 'consult',          description: 'Send consult request',                  usage: '/consult {specialty} {patient}',          roles: DOCTOR_ROLES, icon: '🩺' },
  { name: 'bed-status',       description: 'Bed availability summary',             usage: '/bed-status',                             roles: ['charge_nurse', 'nursing_supervisor', 'admin', 'super_admin', 'admissions', 'customer_care'], icon: '🛏' },
];

// ── Parser ───────────────────────────────────────────────

export interface ParsedCommand {
  command: string;
  args: string;
}

export function parseSlashCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }
  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

export function getCommandsForRole(role: string): SlashCommandDef[] {
  return SLASH_COMMANDS.filter(cmd =>
    cmd.roles.length === 0 || cmd.roles.includes(role) || role === 'super_admin'
  );
}

// ── Patient Lookup Helper ────────────────────────────────

async function findPatient(query: string, hospitalId: string): Promise<{ id: string; name: string; uhid: string; encounter_id: string | null } | null> {
  const sql = getSql();

  // Try UHID first
  const byUhid = await sql`
    SELECT p.id, p.name_full, p.uhid, e.id as encounter_id
    FROM patients p
    LEFT JOIN encounters e ON e.patient_id = p.id AND e.status = 'admitted'
    WHERE p.hospital_id = ${hospitalId} AND LOWER(p.uhid) = LOWER(${query})
    LIMIT 1
  `;
  if (byUhid.length > 0) {
    return { id: byUhid[0].id as string, name: byUhid[0].name_full as string, uhid: byUhid[0].uhid as string, encounter_id: byUhid[0].encounter_id as string | null };
  }

  // Try name search
  const byName = await sql`
    SELECT p.id, p.name_full, p.uhid, e.id as encounter_id
    FROM patients p
    LEFT JOIN encounters e ON e.patient_id = p.id AND e.status = 'admitted'
    WHERE p.hospital_id = ${hospitalId} AND LOWER(p.name_full) LIKE ${`%${query.toLowerCase()}%`}
    ORDER BY e.admitted_at DESC NULLS LAST
    LIMIT 1
  `;
  if (byName.length > 0) {
    return { id: byName[0].id as string, name: byName[0].name_full as string, uhid: byName[0].uhid as string, encounter_id: byName[0].encounter_id as string | null };
  }

  return null;
}

// ── Command Executors ────────────────────────────────────

async function execVitals(args: string, hospitalId: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Vitals', card_content: '', card_icon: '📊', error: 'Usage: /vitals {patient name or UHID}' };

  const patient = await findPatient(args, hospitalId);
  if (!patient) return { success: false, card_title: 'Vitals', card_content: '', card_icon: '📊', error: `Patient "${args}" not found` };

  const sql = getSql();
  const vitals = await sql`
    SELECT observation_type, value_numeric, unit, effective_datetime
    FROM observations
    WHERE patient_id = ${patient.id}::uuid AND hospital_id = ${hospitalId}
    ORDER BY effective_datetime DESC
    LIMIT 10
  `;

  if (vitals.length === 0) {
    return { success: true, card_title: `📊 Vitals — ${patient.name}`, card_content: 'No vitals recorded.', card_icon: '📊' };
  }

  const latest: Record<string, { value: string; unit: string; time: string }> = {};
  for (const v of vitals) {
    const type = v.observation_type as string;
    if (!latest[type]) {
      latest[type] = { value: String(v.value_numeric), unit: v.unit as string || '', time: new Date(v.effective_datetime as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
    }
  }

  const lines = Object.entries(latest).map(([k, v]) => `• ${k}: ${v.value}${v.unit} (${v.time})`);
  return { success: true, card_title: `📊 Vitals — ${patient.name} (${patient.uhid})`, card_content: lines.join('\n'), card_icon: '📊' };
}

async function execLabs(args: string, hospitalId: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Labs', card_content: '', card_icon: '🧪', error: 'Usage: /labs {patient name or UHID}' };

  const patient = await findPatient(args, hospitalId);
  if (!patient) return { success: false, card_title: 'Labs', card_content: '', card_icon: '🧪', error: `Patient "${args}" not found` };

  const sql = getSql();
  const labs = await sql`
    SELECT lo_panel_name, lo_status, lo_urgency, lo_ordered_at
    FROM lab_orders
    WHERE lo_patient_id = ${patient.id}::uuid AND hospital_id = ${hospitalId}
    ORDER BY lo_ordered_at DESC
    LIMIT 10
  `;

  if (labs.length === 0) {
    return { success: true, card_title: `🧪 Labs — ${patient.name}`, card_content: 'No lab orders.', card_icon: '🧪' };
  }

  const lines = labs.map(l => {
    const urgencyBadge = l.lo_urgency !== 'routine' ? ` [${(l.lo_urgency as string).toUpperCase()}]` : '';
    const statusIcon = l.lo_status === 'verified' ? '✅' : l.lo_status === 'resulted' ? '📋' : '⏳';
    return `${statusIcon} ${l.lo_panel_name}${urgencyBadge} — ${l.lo_status}`;
  });

  return { success: true, card_title: `🧪 Labs — ${patient.name} (${patient.uhid})`, card_content: lines.join('\n'), card_icon: '🧪' };
}

async function execMeds(args: string, hospitalId: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Meds', card_content: '', card_icon: '💊', error: 'Usage: /meds {patient name or UHID}' };

  const patient = await findPatient(args, hospitalId);
  if (!patient) return { success: false, card_title: 'Meds', card_content: '', card_icon: '💊', error: `Patient "${args}" not found` };

  const sql = getSql();
  const meds = await sql`
    SELECT drug_name, dose_quantity, dose_unit, route, frequency_code, is_high_alert
    FROM medication_requests
    WHERE patient_id = ${patient.id}::uuid AND hospital_id = ${hospitalId} AND status = 'active'
    ORDER BY created_at DESC
  `;

  if (meds.length === 0) {
    return { success: true, card_title: `💊 Meds — ${patient.name}`, card_content: 'No active medications.', card_icon: '💊' };
  }

  const lines = meds.map(m => {
    const alert = m.is_high_alert ? ' ⚠️' : '';
    return `• ${m.drug_name} ${m.dose_quantity || ''}${m.dose_unit || ''} ${m.route || ''} ${m.frequency_code || ''}${alert}`;
  });

  return { success: true, card_title: `💊 Active Meds — ${patient.name} (${patient.uhid})`, card_content: `${meds.length} active medications:\n${lines.join('\n')}`, card_icon: '💊' };
}

async function execCensus(hospitalId: string): Promise<SlashCommandResult> {
  const sql = getSql();
  const census = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'admitted') as admitted,
      COUNT(*) FILTER (WHERE status = 'discharge_initiated') as discharging,
      COUNT(*) FILTER (WHERE status = 'admitted' AND admitted_at > NOW() - INTERVAL '24 hours') as new_24h
    FROM encounters
    WHERE hospital_id = ${hospitalId}
  `;

  const beds = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'available') as available,
      COUNT(*) FILTER (WHERE status = 'occupied') as occupied
    FROM beds
    WHERE hospital_id = ${hospitalId}
  `;

  const c = census[0] || { admitted: 0, discharging: 0, new_24h: 0 };
  const b = beds[0] || { total: 0, available: 0, occupied: 0 };

  const content = [
    `🏥 **Ward Census**`,
    `• Currently admitted: ${c.admitted}`,
    `• Discharge in progress: ${c.discharging}`,
    `• New admissions (24h): ${c.new_24h}`,
    ``,
    `🛏 **Bed Status**`,
    `• Total beds: ${b.total}`,
    `• Available: ${b.available}`,
    `• Occupied: ${b.occupied}`,
    `• Occupancy: ${Number(b.total) > 0 ? Math.round((Number(b.occupied) / Number(b.total)) * 100) : 0}%`,
  ];

  return { success: true, card_title: '🏥 Ward Census', card_content: content.join('\n'), card_icon: '🏥' };
}

async function execHandoff(args: string, hospitalId: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Handoff', card_content: '', card_icon: '🤝', error: 'Usage: /handoff {patient name or UHID}' };

  const patient = await findPatient(args, hospitalId);
  if (!patient) return { success: false, card_title: 'Handoff', card_content: '', card_icon: '🤝', error: `Patient "${args}" not found` };

  const sql = getSql();
  // Get encounter info
  const encounter = patient.encounter_id ? (await sql`
    SELECT chief_complaint, preliminary_diagnosis_icd10, assigned_bed, attending_physician_name
    FROM encounters WHERE id = ${patient.encounter_id}::uuid LIMIT 1
  `)[0] : null;

  const content = [
    `**S — Situation**`,
    `Patient: ${patient.name} (${patient.uhid})`,
    encounter ? `Bed: ${encounter.assigned_bed || 'N/A'} | Attending: ${encounter.attending_physician_name || 'N/A'}` : '',
    encounter ? `Chief complaint: ${encounter.chief_complaint || 'N/A'}` : '',
    ``,
    `**B — Background**`,
    encounter ? `Diagnosis: ${encounter.preliminary_diagnosis_icd10 || 'N/A'}` : 'No active encounter',
    `[Add relevant history, allergies, recent procedures]`,
    ``,
    `**A — Assessment**`,
    `[Current condition, vitals trend, concerns]`,
    ``,
    `**R — Recommendation**`,
    `[Pending tasks, monitoring plan, escalation criteria]`,
  ].filter(Boolean);

  return { success: true, card_title: `🤝 SBAR Handoff — ${patient.name}`, card_content: content.join('\n'), card_icon: '🤝' };
}

async function execDischargeStatus(args: string, hospitalId: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Discharge', card_content: '', card_icon: '🏁', error: 'Usage: /discharge-status {patient name or UHID}' };

  const patient = await findPatient(args, hospitalId);
  if (!patient) return { success: false, card_title: 'Discharge', card_content: '', card_icon: '🏁', error: `Patient "${args}" not found` };
  if (!patient.encounter_id) return { success: false, card_title: 'Discharge', card_content: '', card_icon: '🏁', error: 'No active encounter' };

  const sql = getSql();
  const milestones = await sql`
    SELECT milestone_name, status, completed_at
    FROM encounter_milestones
    WHERE encounter_id = ${patient.encounter_id}::uuid
    ORDER BY sort_order ASC
  `;

  if (milestones.length === 0) {
    return { success: true, card_title: `🏁 Discharge — ${patient.name}`, card_content: 'No milestones tracked yet.', card_icon: '🏁' };
  }

  const lines = milestones.map(m => {
    const icon = m.status === 'completed' ? '✅' : m.status === 'in_progress' ? '🔄' : '⬜';
    return `${icon} ${m.milestone_name}`;
  });
  const completed = milestones.filter(m => m.status === 'completed').length;

  return {
    success: true,
    card_title: `🏁 Discharge Status — ${patient.name} (${completed}/${milestones.length})`,
    card_content: lines.join('\n'),
    card_icon: '🏁',
  };
}

async function execBilling(args: string, hospitalId: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Billing', card_content: '', card_icon: '💰', error: 'Usage: /billing {patient name or UHID}' };

  const patient = await findPatient(args, hospitalId);
  if (!patient) return { success: false, card_title: 'Billing', card_content: '', card_icon: '💰', error: `Patient "${args}" not found` };
  if (!patient.encounter_id) return { success: false, card_title: 'Billing', card_content: '', card_icon: '💰', error: 'No active encounter' };

  const sql = getSql();
  const billing = await sql`
    SELECT total_charges, total_payments, outstanding_balance, insurance_approved, deposit_amount
    FROM billing_accounts
    WHERE encounter_id = ${patient.encounter_id}::uuid AND hospital_id = ${hospitalId}
    LIMIT 1
  `;

  if (billing.length === 0) {
    return { success: true, card_title: `💰 Billing — ${patient.name}`, card_content: 'No billing account found.', card_icon: '💰' };
  }

  const b = billing[0];
  const fmt = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const content = [
    `• Total charges: ${fmt(b.total_charges)}`,
    `• Insurance approved: ${fmt(b.insurance_approved)}`,
    `• Deposits: ${fmt(b.deposit_amount)}`,
    `• Payments: ${fmt(b.total_payments)}`,
    `• **Outstanding: ${fmt(b.outstanding_balance)}**`,
  ];

  return { success: true, card_title: `💰 Billing — ${patient.name} (${patient.uhid})`, card_content: content.join('\n'), card_icon: '💰' };
}

async function execBedStatus(hospitalId: string): Promise<SlashCommandResult> {
  const sql = getSql();
  const beds = await sql`
    SELECT
      w.name as ward_name,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE b.status = 'available') as available,
      COUNT(*) FILTER (WHERE b.status = 'occupied') as occupied,
      COUNT(*) FILTER (WHERE b.status = 'blocked') as blocked
    FROM beds b
    JOIN wards w ON w.id = b.ward_id
    WHERE b.hospital_id = ${hospitalId}
    GROUP BY w.name
    ORDER BY w.name
  `;

  if (beds.length === 0) {
    return { success: true, card_title: '🛏 Bed Status', card_content: 'No beds configured.', card_icon: '🛏' };
  }

  const lines = beds.map(b =>
    `• ${b.ward_name}: ${b.available}/${b.total} available (${b.occupied} occupied, ${b.blocked} blocked)`
  );

  const totalAvail = beds.reduce((s, b) => s + Number(b.available), 0);
  const totalBeds = beds.reduce((s, b) => s + Number(b.total), 0);

  return {
    success: true,
    card_title: `🛏 Bed Availability — ${totalAvail}/${totalBeds} available`,
    card_content: lines.join('\n'),
    card_icon: '🛏',
  };
}

async function execConsult(args: string, hospitalId: string, senderName: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Consult', card_content: '', card_icon: '🩺', error: 'Usage: /consult {specialty} {patient name or UHID}' };

  const parts = args.split(' ');
  if (parts.length < 2) return { success: false, card_title: 'Consult', card_content: '', card_icon: '🩺', error: 'Usage: /consult {specialty} {patient name or UHID}' };

  const specialty = parts[0];
  const patientQuery = parts.slice(1).join(' ');

  const patient = await findPatient(patientQuery, hospitalId);
  if (!patient) return { success: false, card_title: 'Consult', card_content: '', card_icon: '🩺', error: `Patient "${patientQuery}" not found` };

  const content = [
    `**Consult Request**`,
    `• Specialty: ${specialty}`,
    `• Patient: ${patient.name} (${patient.uhid})`,
    `• Requested by: ${senderName}`,
    `• Status: Pending`,
    ``,
    `[Please review and accept/decline this consult request]`,
  ];

  return { success: true, card_title: `🩺 Consult — ${specialty} for ${patient.name}`, card_content: content.join('\n'), card_icon: '🩺' };
}

async function execEscalate(args: string, hospitalId: string, senderName: string): Promise<SlashCommandResult> {
  if (!args) return { success: false, card_title: 'Escalation', card_content: '', card_icon: '🚨', error: 'Usage: /escalate {patient} {reason}' };

  const parts = args.split(' ');
  const patientQuery = parts[0];
  const reason = parts.slice(1).join(' ') || 'Urgent attention required';

  const patient = await findPatient(patientQuery, hospitalId);
  const patientName = patient ? `${patient.name} (${patient.uhid})` : patientQuery;

  const content = [
    `🚨 **ESCALATION**`,
    `• Patient: ${patientName}`,
    `• Reason: ${reason}`,
    `• Escalated by: ${senderName}`,
    `• Time: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
  ];

  return { success: true, card_title: `🚨 Escalation — ${patientName}`, card_content: content.join('\n'), card_icon: '🚨' };
}

// ── Main Executor ────────────────────────────────────────

export async function executeSlashCommand(
  command: string,
  args: string,
  hospitalId: string,
  userRole: string,
  userName: string,
): Promise<SlashCommandResult> {
  // Check if command exists
  const cmdDef = SLASH_COMMANDS.find(c => c.name === command);
  if (!cmdDef) {
    return { success: false, card_title: 'Unknown Command', card_content: '', card_icon: '❓', error: `Unknown command: /${command}` };
  }

  // Check role
  if (cmdDef.roles.length > 0 && !cmdDef.roles.includes(userRole) && userRole !== 'super_admin') {
    return { success: false, card_title: cmdDef.name, card_content: '', card_icon: cmdDef.icon, error: `/${command} is not available for your role.` };
  }

  // Execute
  try {
    switch (command) {
      case 'vitals':           return await execVitals(args, hospitalId);
      case 'labs':             return await execLabs(args, hospitalId);
      case 'meds':             return await execMeds(args, hospitalId);
      case 'census':           return await execCensus(hospitalId);
      case 'handoff':          return await execHandoff(args, hospitalId);
      case 'escalate':         return await execEscalate(args, hospitalId, userName);
      case 'discharge-status': return await execDischargeStatus(args, hospitalId);
      case 'billing':          return await execBilling(args, hospitalId);
      case 'bed-status':       return await execBedStatus(hospitalId);
      case 'consult':          return await execConsult(args, hospitalId, userName);
      case 'task':
        // Task is handled separately by the composer/task-bridge
        return { success: false, card_title: 'Task', card_content: '', card_icon: '☑️', error: 'Use the message type selector to create tasks.' };
      default:
        return { success: false, card_title: 'Unknown', card_content: '', card_icon: '❓', error: `Command /${command} not implemented.` };
    }
  } catch (err) {
    console.error(`[slash-commands] /${command} failed:`, err);
    return { success: false, card_title: command, card_content: '', card_icon: '❓', error: `Command failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}
