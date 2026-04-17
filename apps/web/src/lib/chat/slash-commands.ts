/**
 * Slash Commands Engine — SC.2
 *
 * Hybrid command system: form-backed commands (from form_definitions DB)
 * + read-only commands (hardcoded, no submission).
 *
 * Flow:
 *   1. getSlashCommandsForRole() → merges DB form commands + hardcoded read-only
 *   2. User selects command in SlashCommandMenu
 *   3. resolveCommand() → returns { type: 'form', formDefinition } or { type: 'read_only', executor }
 *   4. Form commands → FormModal opens in ChatRoom
 *   5. Read-only commands → executes SQL, posts card to chat (existing OC.5b behavior)
 *
 * Commands that keep existing card behavior: /census, /bed-status, /task
 * All other commands resolve to form_definitions when available,
 * falling back to existing card behavior for backward compatibility.
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
  icon: string;
  /** How this command resolves */
  type: 'form' | 'read_only' | 'task';
  /** Role-specific action label (e.g., "Log Vitals" for nurses, "View Vitals" for doctors) */
  actionLabel?: string;
  /** Form definition ID to open (only for type='form') */
  formDefinitionId?: string;
  /** Form slug (only for type='form') */
  formSlug?: string;
  /** Whether the form requires patient context */
  requiresPatient?: boolean;
}

export interface SlashCommandResult {
  success: boolean;
  card_title: string;
  card_content: string;
  card_icon: string;
  error?: string;
}

export interface ParsedCommand {
  command: string;
  args: string;
}

// ── Role Groups ─────────────────────────────────────────

const NURSE_ROLES = ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager'];
const DOCTOR_ROLES = ['resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist', 'surgeon', 'anaesthetist', 'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic'];
const ALL_CLINICAL = [...NURSE_ROLES, ...DOCTOR_ROLES, 'pharmacist', 'senior_pharmacist', 'lab_technician', 'senior_lab_technician'];
const BILLING_ROLES = ['billing_manager', 'billing_executive', 'insurance_coordinator'];

// ── Command Icons ────────────────────────────────────────
// Canonical icon for each slash command name.

const COMMAND_ICONS: Record<string, string> = {
  'vitals': '📊', 'meds': '💊', 'labs': '🧪', 'notes': '📝',
  'consult': '🩺', 'handoff': '🤝', 'escalate': '🚨',
  'discharge': '🏁', 'billing': '💰', 'transfer': '🔄',
  'fc': '💼', 'incident': '⚠️', 'consent': '📋',
  'diet': '🍽', 'alert': '🔔', 'form': '📄',
  'census': '🏥', 'bed-status': '🛏', 'task': '☑️',
};

// ── Read-Only Command Registry ──────────────────────────
// These commands NEVER open forms — they execute SQL and return cards.

interface ReadOnlyCommandDef {
  name: string;
  description: string;
  usage: string;
  icon: string;
  roles: string[];
}

const READ_ONLY_COMMANDS: ReadOnlyCommandDef[] = [
  { name: 'census',     description: 'Current ward census',      usage: '/census',     roles: ['charge_nurse', 'nursing_supervisor', 'nursing_manager', 'super_admin', 'admin'], icon: '🏥' },
  { name: 'bed-status', description: 'Bed availability summary', usage: '/bed-status', roles: ['charge_nurse', 'nursing_supervisor', 'admin', 'super_admin', 'admissions', 'customer_care'], icon: '🛏' },
];

const TASK_COMMAND: ReadOnlyCommandDef = {
  name: 'task', description: 'Create a task', usage: '/task @{user} {description}', roles: [], icon: '☑️',
};

// ── Parser ───────────────────────────────────────────────

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

// ── Resolve Commands for Role (Server-Side) ─────────────
// Merges DB form_definitions + hardcoded read-only commands.
// Called by chat.getSlashCommands tRPC endpoint.

export async function getSlashCommandsForRole(
  role: string,
  hospitalId: string,
): Promise<SlashCommandDef[]> {
  const sql = getSql();
  const commands: SlashCommandDef[] = [];

  // 1. Query form_definitions that have a slash_command set
  const formDefs = await sql`
    SELECT id, name, slug, description, slash_command, slash_role_action_map,
           applicable_roles, requires_patient, category
    FROM form_definitions
    WHERE hospital_id = ${hospitalId}
      AND status = 'active'
      AND slash_command IS NOT NULL
    ORDER BY slash_command
  `;

  // Group form defs by slash_command — multiple forms can share the same command
  // (e.g., /meds → different form per role)
  const commandMap = new Map<string, typeof formDefs>();
  for (const fd of formDefs) {
    const cmd = (fd.slash_command as string).replace('/', '');
    if (!commandMap.has(cmd)) commandMap.set(cmd, []);
    commandMap.get(cmd)!.push(fd);
  }

  // 2. For each slash_command, find the right form for this role
  for (const [cmdName, defs] of commandMap) {
    // Find the form definition that matches this user's role
    let matchedDef = null;
    let actionLabel = '';

    for (const fd of defs) {
      const roles = (fd.applicable_roles as string[]) || [];
      const roleActionMap = (fd.slash_role_action_map as Record<string, any>) || {};

      // Check if this form applies to the user's role
      const roleMatches = roles.length === 0 || roles.includes(role) || role === 'super_admin';
      if (roleMatches) {
        matchedDef = fd;
        // Get role-specific action label — supports both { role: 'label' } and { role: { action: 'label' } }
        const rawLabel = roleActionMap[role] || roleActionMap['default'];
        if (typeof rawLabel === 'string') {
          actionLabel = rawLabel;
        } else if (rawLabel && typeof rawLabel === 'object' && rawLabel.action) {
          actionLabel = rawLabel.action;
        } else {
          actionLabel = fd.name as string;
        }
        break;
      }
    }

    if (matchedDef) {
      commands.push({
        name: cmdName,
        description: matchedDef.description as string || '',
        usage: `/${cmdName}`,
        icon: COMMAND_ICONS[cmdName] || '📋',
        type: 'form',
        actionLabel,
        formDefinitionId: matchedDef.id as string,
        formSlug: matchedDef.slug as string,
        requiresPatient: matchedDef.requires_patient as boolean,
      });
    }
  }

  // 3. Add read-only commands (role-filtered)
  for (const cmd of READ_ONLY_COMMANDS) {
    if (cmd.roles.length === 0 || cmd.roles.includes(role) || role === 'super_admin') {
      commands.push({
        name: cmd.name,
        description: cmd.description,
        usage: cmd.usage,
        icon: cmd.icon,
        type: 'read_only',
      });
    }
  }

  // 4. Add task command (available to all)
  commands.push({
    name: TASK_COMMAND.name,
    description: TASK_COMMAND.description,
    usage: TASK_COMMAND.usage,
    icon: TASK_COMMAND.icon,
    type: 'task',
  });

  // 5. Add fallback commands for roles that have no form_definitions yet
  //    (backward compatibility during SC.2→SC.3 transition)
  const existingCommandNames = new Set(commands.map(c => c.name));
  const fallbackCommands = getFallbackCommandsForRole(role);
  for (const fb of fallbackCommands) {
    if (!existingCommandNames.has(fb.name)) {
      commands.push(fb);
    }
  }

  // Sort: form commands first, then read-only, then task
  commands.sort((a, b) => {
    const typeOrder = { form: 0, read_only: 1, task: 2 };
    const diff = typeOrder[a.type] - typeOrder[b.type];
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  return commands;
}

// ── Fallback Commands (until SC.3 creates form_definitions) ──

function getFallbackCommandsForRole(role: string): SlashCommandDef[] {
  const fallbacks: Array<ReadOnlyCommandDef & { actionLabel?: string }> = [
    { name: 'vitals',           description: 'Latest vitals for a patient',        usage: '/vitals {patient}',        roles: [...NURSE_ROLES, ...DOCTOR_ROLES], icon: '📊', actionLabel: NURSE_ROLES.includes(role) ? 'Log Vitals' : 'View Vitals' },
    { name: 'labs',             description: 'Lab results & orders',              usage: '/labs {patient}',          roles: [...DOCTOR_ROLES, 'lab_technician', 'senior_lab_technician', ...NURSE_ROLES], icon: '🧪' },
    { name: 'meds',             description: 'Medications & orders',              usage: '/meds {patient}',          roles: [...NURSE_ROLES, ...DOCTOR_ROLES, 'pharmacist', 'senior_pharmacist'], icon: '💊', actionLabel: NURSE_ROLES.includes(role) ? 'eMAR' : DOCTOR_ROLES.includes(role) ? 'Order Medication' : 'Dispense' },
    { name: 'handoff',          description: 'SBAR handoff template',             usage: '/handoff {patient}',       roles: NURSE_ROLES, icon: '🤝' },
    { name: 'escalate',         description: 'Create escalation',                 usage: '/escalate {patient} {reason}', roles: ALL_CLINICAL, icon: '🚨' },
    { name: 'discharge-status', description: 'Discharge milestone checklist',     usage: '/discharge-status {patient}', roles: [...DOCTOR_ROLES, 'ip_coordinator', 'customer_care'], icon: '🏁' },
    { name: 'billing',          description: 'Billing summary',                   usage: '/billing {patient}',       roles: [...BILLING_ROLES, ...DOCTOR_ROLES], icon: '💰' },
    { name: 'consult',          description: 'Send consult request',              usage: '/consult {specialty} {patient}', roles: DOCTOR_ROLES, icon: '🩺' },
  ];

  const result: SlashCommandDef[] = [];
  for (const fb of fallbacks) {
    if (fb.roles.length === 0 || fb.roles.includes(role) || role === 'super_admin') {
      result.push({
        name: fb.name,
        description: fb.description,
        usage: fb.usage,
        icon: fb.icon,
        type: 'read_only', // Fallback to read-only card behavior
        actionLabel: fb.actionLabel,
      });
    }
  }
  return result;
}

// ── Read-Only Command Executors ──────────────────────────
// These execute SQL and return formatted cards (same as OC.5b).

async function findPatient(query: string, hospitalId: string): Promise<{ id: string; name: string; uhid: string; encounter_id: string | null } | null> {
  const sql = getSql();

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

// ── Main Executor (for read-only/fallback commands) ─────
// Form-backed commands are handled client-side by opening FormModal.

export async function executeReadOnlyCommand(
  command: string,
  args: string,
  hospitalId: string,
  userRole: string,
  userName: string,
): Promise<SlashCommandResult> {
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
        return { success: false, card_title: 'Task', card_content: '', card_icon: '☑️', error: 'Use the message type selector to create tasks.' };
      default:
        return { success: false, card_title: 'Unknown', card_content: '', card_icon: '❓', error: `Command /${command} not recognized.` };
    }
  } catch (err) {
    console.error(`[slash-commands] /${command} failed:`, err);
    return { success: false, card_title: command, card_content: '', card_icon: '❓', error: `Command failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

// ── Resolve a command to form or read-only ──────────────
// Used by the chat router to decide what to do.

export interface CommandResolution {
  type: 'form' | 'read_only' | 'task';
  formDefinitionId?: string;
  formSlug?: string;
  requiresPatient?: boolean;
}

export async function resolveCommand(
  command: string,
  role: string,
  hospitalId: string,
): Promise<CommandResolution> {
  // Task command
  if (command === 'task') return { type: 'task' };

  // Read-only commands never resolve to forms
  if (command === 'census' || command === 'bed-status') {
    return { type: 'read_only' };
  }

  // Check if a form_definition exists for this command + role
  const sql = getSql();
  const formDefs = await sql`
    SELECT id, slug, applicable_roles, requires_patient
    FROM form_definitions
    WHERE hospital_id = ${hospitalId}
      AND status = 'active'
      AND slash_command = ${'/' + command}
  `;

  for (const fd of formDefs) {
    const roles = (fd.applicable_roles as string[]) || [];
    if (roles.length === 0 || roles.includes(role) || role === 'super_admin') {
      return {
        type: 'form',
        formDefinitionId: fd.id as string,
        formSlug: fd.slug as string,
        requiresPatient: fd.requires_patient as boolean,
      };
    }
  }

  // No form found → fall back to read-only
  return { type: 'read_only' };
}
