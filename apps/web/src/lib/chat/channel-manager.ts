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
import { logAudit } from './audit';
import { notifyChatMessage } from './chat-event-bus';

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

    // CHAT.X.7 — audit (system source: no human actor on this path)
    void logAudit({
      action: 'channel_created',
      source: 'system',
      hospital_id: params.hospital_id,
      channel_id: channelId,
      details: {
        encounter_id: params.encounter_id,
        patient_uhid: params.patient_uhid,
        attending_doctor_id: params.attending_doctor_id,
        bed_label: params.bed_label ?? null,
      },
    });

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

    // CHAT.X.7 — audit (system source: discharge flow has no user in hand)
    void logAudit({
      action: 'channel_archived',
      source: 'system',
      hospital_id: channel.hospital_id,
      channel_id: channelId,
      details: { encounter_id, reason: 'discharge' },
    });
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

    // CHAT.X.7 — audit (system source: assignment orchestrated by role-based rules)
    void logAudit({
      action: 'care_team_added',
      source: 'system',
      hospital_id: channel.hospital_id,
      channel_id: channelId,
      target_user_id: params.user_id,
      details: {
        encounter_id: params.encounter_id,
        role: params.role || 'member',
        user_name: params.user_name ?? null,
        reason: params.reason ?? null,
      },
    });
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

    // CHAT.X.7 — audit (system source)
    void logAudit({
      action: 'care_team_removed',
      source: 'system',
      hospital_id: channel.hospital_id,
      channel_id: channelId,
      target_user_id: user_id,
      details: {
        encounter_id,
        user_name: user_name ?? null,
      },
    });
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

    // CHAT.X.7 — audit (system source)
    void logAudit({
      action: 'bed_transfer',
      source: 'system',
      hospital_id: params.hospital_id,
      channel_id: channelId,
      details: {
        encounter_id: params.encounter_id,
        from_bed_label: params.from_bed_label ?? null,
        to_bed_label: params.to_bed_label ?? null,
      },
    });
  } catch (err) {
    console.error('[channel-manager] onBedTransfer failed:', err);
  }
}

// ── CREATE PERSISTENT PATIENT CHANNEL (PC.4.A.1) ───────────
//
// Persistent patient channel spans ALL of a patient's encounters. Created
// on first registration (or backfilled via /api/migrations/chat-channels-patient-id).
// Never archived; care team members persist across admissions.
//
// Semantics:
//   channel_id   = 'patient-persistent-<patient_id>'
//   channel_type = 'patient'
//   patient_id   = set
//   encounter_id = NULL  (distinguishes from per-encounter patient channel)

interface CreatePersistentPatientChannelParams {
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  hospital_id: string;
  created_by: string;
}

export async function createPersistentPatientChannel(
  params: CreatePersistentPatientChannelParams
) {
  const sql = getSql();
  const channelId = `patient-persistent-${params.patient_id}`;

  try {
    // Idempotent — skip if already present
    const [existing] = await sql`
      SELECT id FROM chat_channels WHERE channel_id = ${channelId}
    `;
    if (existing) return { channelId, id: existing.id, created: false };

    const [channel] = await sql`
      INSERT INTO chat_channels (
        channel_id, hospital_id, channel_type, name, description,
        patient_id, encounter_id, created_by
      )
      VALUES (
        ${channelId},
        ${params.hospital_id},
        'patient',
        ${`${params.patient_name} (${params.patient_uhid}) — all admissions`},
        ${`Persistent patient channel — spans all encounters for UHID ${params.patient_uhid}`},
        ${params.patient_id}::uuid,
        NULL,
        ${params.created_by}::uuid
      )
      RETURNING id
    `;

    // Creator joins as admin
    await sql`
      INSERT INTO chat_channel_members (channel_id, user_id, role)
      VALUES (${channel.id}, ${params.created_by}::uuid, 'admin')
      ON CONFLICT DO NOTHING
    `;

    await postSystemMessage(channel.id, params.hospital_id,
      `🧍 Persistent patient channel opened for ${params.patient_name} (UHID ${params.patient_uhid}). This thread persists across all admissions.`
    );

    return { channelId, id: channel.id, created: true };
  } catch (err) {
    console.error('[channel-manager] createPersistentPatientChannel failed:', err);
    return null;
  }
}

// ── ADD CARE TEAM MEMBER TO PERSISTENT CHANNEL ─────────────
// Used when a clinician is assigned to a patient via any encounter — they
// should also be a member of the persistent patient channel so they see
// history across admissions. Idempotent via ON CONFLICT.

interface AddPersistentCareTeamMemberParams {
  patient_id: string;
  user_id: string;
  role?: 'member' | 'admin' | 'read_only';
  user_name?: string;
  reason?: string;
}

export async function addPersistentCareTeamMember(
  params: AddPersistentCareTeamMemberParams
) {
  const sql = getSql();
  const channelId = `patient-persistent-${params.patient_id}`;

  try {
    const [channel] = await sql`
      SELECT id, hospital_id FROM chat_channels
      WHERE channel_id = ${channelId}
    `;
    if (!channel) return;

    await sql`
      INSERT INTO chat_channel_members (channel_id, user_id, role)
      VALUES (${channel.id}, ${params.user_id}::uuid, ${params.role || 'member'})
      ON CONFLICT (channel_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        left_at = NULL
    `;

    if (params.user_name) {
      const reason = params.reason ? ` (${params.reason})` : '';
      await postSystemMessage(channel.id, channel.hospital_id,
        `👤 ${params.user_name} joined the persistent care team${reason}`
      );
    }
  } catch (err) {
    console.error('[channel-manager] addPersistentCareTeamMember failed:', err);
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
    // CHAT.X.4 — push wakeup so lifecycle announcements (admit/transfer/
    // discharge/care-team-change) paint in listeners within ~50ms.
    void notifyChatMessage(hospital_id);
  } catch (err) {
    console.error('[channel-manager] postSystemMessage failed:', err);
  }
}
