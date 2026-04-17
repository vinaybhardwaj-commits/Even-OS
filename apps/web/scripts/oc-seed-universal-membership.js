#!/usr/bin/env node
/**
 * OC Seed — Universal channel membership + patient chat rooms (batch version)
 * Uses INSERT ... ON CONFLICT for fast bulk operations.
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
const sql = neon(DATABASE_URL);

const HOSPITAL_ID = 'EHRC';

async function run() {
  console.log('🚀 Universal membership + patient channels seed\n');

  // ── 1. Admin user ──
  const [admin] = await sql`SELECT id FROM users WHERE 'super_admin' = ANY(roles) AND hospital_id = ${HOSPITAL_ID} LIMIT 1`;
  if (!admin) { console.error('❌ No super_admin found'); process.exit(1); }

  // ── 2. Batch add ALL users to ALL dept+broadcast channels ──
  console.log('  Adding all users to all channels (batch)...');
  const result = await sql`
    INSERT INTO chat_channel_members (channel_id, user_id, role)
    SELECT cc.id, u.id,
      CASE
        WHEN 'super_admin' = ANY(u.roles) OR 'hospital_admin' = ANY(u.roles) THEN 'admin'::channel_member_role
        WHEN cc.channel_type = 'broadcast' THEN 'read_only'::channel_member_role
        ELSE 'member'::channel_member_role
      END
    FROM chat_channels cc
    CROSS JOIN users u
    WHERE cc.hospital_id = ${HOSPITAL_ID}
      AND cc.channel_type IN ('department', 'broadcast')
      AND cc.is_archived = false
      AND u.hospital_id = ${HOSPITAL_ID}
      AND u.status = 'active'
    ON CONFLICT (channel_id, user_id) DO NOTHING
  `;
  console.log(`  ✅ Batch membership insert complete`);

  // ── 3. Count memberships ──
  const [memCount] = await sql`
    SELECT count(*)::int as c FROM chat_channel_members ccm
    JOIN chat_channels cc ON cc.id = ccm.channel_id
    WHERE cc.hospital_id = ${HOSPITAL_ID} AND ccm.left_at IS NULL
  `;
  console.log(`  Total active memberships: ${memCount.c}`);

  // ── 4. Seed presence for any missing users ──
  await sql`
    INSERT INTO chat_presence (user_id, hospital_id)
    SELECT u.id, u.hospital_id FROM users u
    WHERE u.hospital_id = ${HOSPITAL_ID} AND u.status = 'active'
    ON CONFLICT (user_id) DO NOTHING
  `;
  console.log(`  ✅ Presence rows synced`);

  // ── 5. Create patient chat rooms for active encounters ──
  console.log('\n  Creating patient channels for active encounters...');
  const encounters = await sql`
    SELECT e.id as encounter_id, e.patient_id,
           p.name_full as patient_name, p.uhid,
           loc.name as bed_name,
           ward.name as ward_name
    FROM encounters e
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN bed_assignments ba ON ba.encounter_id = e.id AND ba.released_at IS NULL
    LEFT JOIN locations loc ON loc.id = ba.location_id
    LEFT JOIN locations ward ON ward.id = loc.parent_location_id
    WHERE e.hospital_id = ${HOSPITAL_ID}
      AND e.status = 'in-progress'
  `;
  console.log(`  Active encounters: ${encounters.length}`);

  let patientChannels = 0;
  for (const enc of encounters) {
    const channelId = `patient-${enc.encounter_id}`;
    const exists = await sql`SELECT 1 FROM chat_channels WHERE channel_id = ${channelId}`;
    if (exists.length > 0) continue;

    const name = `${enc.patient_name || 'Patient'} (${enc.uhid || 'N/A'})`;
    const desc = enc.bed_name && enc.ward_name
      ? `${enc.ward_name} — ${enc.bed_name}`
      : 'Patient care coordination';
    const meta = JSON.stringify({ patient_id: enc.patient_id, uhid: enc.uhid, bed: enc.bed_name, ward: enc.ward_name });

    await sql`
      INSERT INTO chat_channels (channel_id, channel_type, name, description, hospital_id, encounter_id, created_by, metadata)
      VALUES (${channelId}, 'patient', ${name}, ${desc}, ${HOSPITAL_ID}, ${enc.encounter_id}, ${admin.id}, ${meta})
    `;
    patientChannels++;

    // Batch-add clinical staff to this patient channel
    const [ch] = await sql`SELECT id FROM chat_channels WHERE channel_id = ${channelId}`;
    if (ch) {
      await sql`
        INSERT INTO chat_channel_members (channel_id, user_id, role)
        SELECT ${ch.id}, u.id, 'member'::channel_member_role
        FROM users u
        WHERE u.hospital_id = ${HOSPITAL_ID}
          AND u.status = 'active'
          AND (
            'super_admin' = ANY(u.roles)
            OR 'hospital_admin' = ANY(u.roles)
            OR 'doctor' = ANY(u.roles)
            OR 'nurse' = ANY(u.roles)
            OR 'charge_nurse' = ANY(u.roles)
            OR 'department_head' = ANY(u.roles)
          )
        ON CONFLICT (channel_id, user_id) DO NOTHING
      `;
    }
  }
  console.log(`  ✅ Patient channels created: ${patientChannels}`);

  // ── 6. Final stats ──
  console.log('\n📊 Final Verification:');
  const stats = await sql`
    SELECT cc.channel_type, count(DISTINCT cc.id)::int as channels,
           count(ccm.id)::int as memberships
    FROM chat_channels cc
    LEFT JOIN chat_channel_members ccm ON ccm.channel_id = cc.id AND ccm.left_at IS NULL
    WHERE cc.hospital_id = ${HOSPITAL_ID}
    GROUP BY cc.channel_type
    ORDER BY cc.channel_type
  `;
  stats.forEach(s => console.log(`  ${s.channel_type.padEnd(12)} → ${s.channels} channels, ${s.memberships} memberships`));

  const [total] = await sql`SELECT count(*)::int as c FROM chat_channel_members WHERE left_at IS NULL`;
  console.log(`\n  Total memberships: ${total.c}`);

  console.log('\n✅ Done!');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
