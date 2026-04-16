/**
 * Channel Lifecycle Manager — OC.4a
 *
 * Functions for managing patient channel lifecycle:
 * - createPatientChannel: on admission
 * - archivePatientChannel: on discharge
 * - addCareTeamMember: when nurse/doctor/specialist assigned
 * - removeCareTeamMember: when care team member removed
 * - postSystemMessage: lifecycle event announcements
 *
 * All functions use neon() HTTP driver for serverless compatibility.
 * Designed to be called from tRPC router mutations as fire-and-forget hooks.
 */

import { neon } from '@neondatabase/serverless';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

// ── CREATE PATIENT CHANNEL ─────────────────────────────────

interface CreatePatientChannelParams {
  encounter_id: string;
  patient_name: string;
  patient_uhid: string;
  hospital_id: string;
  attending_doctor_id: string;
  bed_label?: string;
}

export async function createPatientChannel(params: CreatePatientChannelParams) {
  const sql = getSql();
  const channelId = `patient-${params.encounter_id}`;

  try {
    // Check if channel already exists (idempotent)
    const [existing] = await sql`
      SELECT id FROM chat_channels WHERE channel_id = ${channelId}
    `;
    if (existing) return { channelId, id: existing.id };

    // Create channel
    const [channel] = await sql`
      INSERT INTO chat_channels (channel_id, hospital_id, channel_type, name, description, encounter_id)
      VALUES (
        ${channelId},
        ${params.hospital_id},
        'patient',
        ${`${params.patient_name} (${params.patient_uhid})`},
        ${`Patient channel for encounter ${params.encounter_id}`},
        ${params.encounter_id}
      )
      RETURNING id
    `;

    // Add attending doctor as admin
    await sql`
      INSERT INTO chat_channel_members (channel_id, user_id, role)
      VALUES (${channel.id}, ${params.attending_doctor_id}, 'admin')
      ON CONFLICT DO NOTHING
    `;

    // Post system message
    await postSystemMessage(channel.id, params.hospital_id,
      `🏥 Patient admitted: ${params.patient_name} (${params.patient_uhid})${params.bed_label ? ` → Bed ${params.bed_label}` : ''}`
    );

    return { channelId, id: channel.id };
  } catch (err) {
    console.error('[channel-manager] createPatientChannel failed:', err);
    return null;
  }
}

// ── ARCHIVE PATIENT CHANNEL (DISCHARGE) ────────────────────

export async function archivePatientChannel(encounter_id: string) {
  const sql = getSql();
  const channelId = `patient-${encounter_id}`;

  try {
    // Archive the channel
    const [channel] = await sql`
      UPDATE chat_channels
      SET is_archived = true, updated_at = NOW()
      WHERE channel_id = ${channelId}
      RETURNING id, hospital_id
    `;
    if (!channel) return;

    // Set all members to read_only
    await sql`
      UPDATE chat_channel_members
      SET role = 'read_only', updated_at = NOW()
      WHERE channel_id = ${channel.id}
    `;

    // Post system message
    await postSystemMessage(channel.id, channel.hospital_id,
      `✅ Patient discharged. Channel is now read-only.`
    );
  } catch (err) {
    console.error('[channel-manager] archivePatientChannel failed:', err);
  }
}

// ── ADD CARE TEAM MEMBER ───────────────────────────────────

interface AddCareTeamMemberParams {
  encounter_id: string;
  user_id: string;
  role?: string; // 'member' | 'admin' — defaults to 'member'
  user_name?: string; // for system message
  reason?: string; // e.g., "Nurse assignment", "Consult request"
}

export async function addCareTeamMember(params: AddCareTeamMemberParams) {
  const sql = getSql();
  const channelId = `patient-${params.encounter_id}`;

  try {
    // Look up channel
    const [channel] = await sql`
      SELECT id, hospital_id FROM chat_channels
      WHERE channel_id = ${channelId} AND is_archived = false
    `;
    if (!channel) return;

    // Add member (idempotent via ON CONFLICT)
    await sql`
      INSERT INTO chat_channel_members (channel_id, user_id, role)
      VALUES (${channel.id}, ${params.user_id}, ${params.role || 'member'})
      ON CONFLICT (channel_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        left_at = NULL,
        updated_at = NOW()
    `;

    // System message
    if (params.user_name) {
      const reason = params.reason ? ` (${params.reason})` : '';
      await postSystemMessage(channel.id, channel.hospital_id,
        `👤 ${params.user_name} joined the care team${reason}`
      );
    }
  } catch (err) {
    console.error('[channel-manager] addCareTeamMember failed:', err);
  }
}

// ── REMOVE CARE TEAM MEMBER ────────────────────────────────

export async function removeCareTeamMember(encounter_id: string, user_id: string, user_name?: string) {
  const sql = getSql();
  const channelId = `patient-${encounter_id}`;

  try {
    const [channel] = await sql`
      SELECT id, hospital_id FROM chat_channels
      WHERE channel_id = ${channelId}
    `;
    if (!channel) return;

    // Soft-remove (set left_at instead of deleting — for audit trail)
    await sql`
      UPDATE chat_channel_members
      SET left_at = NOW(), updated_at = NOW()
      WHERE channel_id = ${channel.id} AND user_id = ${user_id}
    `;

    if (user_name) {
      await postSystemMessage(channel.id, channel.hospital_id,
        `👤 ${user_name} left the care team`
      );
    }
  } catch (err) {
    console.error('[channel-manager] removeCareTeamMember failed:', err);
  }
}

// ── TRANSFER HOOK ──────────────────────────────────────────

interface TransferHookParams {
  encounter_id: string;
  hospital_id: string;
  from_bed_label?: string;
  to_bed_label?: string;
}

export async function onBedTransfer(params: TransferHookParams) {
  const sql = getSql();
  const channelId = `patient-${params.encounter_id}`;

  try {
    const [channel] = await sql`
      SELECT id FROM chat_channels
      WHERE channel_id = ${channelId} AND is_archived = false
    `;
    if (!channel) return;

    const from = params.from_bed_label || 'previous bed';
    const to = params.to_bed_label || 'new bed';
    await postSystemMessage(channel.id, params.hospital_id,
      `🔄 Transfer: ${from} → ${to}`
    );
  } catch (err) {
    console.error('[channel-manager] onBedTransfer failed:', err);
  }
}

// ── SYSTEM MESSAGE HELPER ──────────────────────────────────

async function postSystemMessage(channelInternalId: string, hospital_id: string, content: string) {
  const sql = getSql();
  try {
    await sql`
      INSERT INTO chat_messages (channel_id, hospital_id, message_type, content)
      VALUES (${channelInternalId}, ${hospital_id}, 'system', ${content})
    `;
    // Update channel's last_message_at
    await sql`
      UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = ${channelInternalId}
    `;
  } catch (err) {
    console.error('[channel-manager] postSystemMessage failed:', err);
  }
}
