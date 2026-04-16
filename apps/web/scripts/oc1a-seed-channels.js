#!/usr/bin/env node
/**
 * OC.1a — Seed department channels + broadcast + sync memberships
 * Run from apps/web: export $(grep DATABASE_URL .env.local | tr -d '"') && node scripts/oc1a-seed-channels.js
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
const sql = neon(DATABASE_URL);

// ── 20 department channels ──────────────────────────────────────────────
// Maps channel_id → { name, description, matchDepts: departments whose users auto-join }
const DEPT_CHANNELS = [
  { id: 'dept-admin', name: 'Administration', desc: 'Hospital administration team', match: ['Administration'] },
  { id: 'dept-billing', name: 'Billing', desc: 'Billing and insurance coordination', match: ['Billing'] },
  { id: 'dept-customer-care', name: 'Customer Care', desc: 'Customer care and patient relations', match: ['Customer Care'] },
  { id: 'dept-emergency', name: 'Emergency', desc: 'Emergency department', match: ['Emergency'] },
  { id: 'dept-front-office', name: 'Front Office', desc: 'Reception and front office', match: ['Front Office'] },
  { id: 'dept-general-surgery', name: 'General Surgery', desc: 'General surgery team', match: ['General Surgery'] },
  { id: 'dept-it', name: 'IT', desc: 'Information technology', match: ['IT'] },
  { id: 'dept-internal-medicine', name: 'Internal Medicine', desc: 'Internal medicine team', match: ['Internal Medicine'] },
  { id: 'dept-lab', name: 'Laboratory', desc: 'Laboratory and pathology', match: ['Laboratory'] },
  { id: 'dept-marketing', name: 'Marketing', desc: 'Marketing and communications', match: ['Marketing'] },
  { id: 'dept-medicine', name: 'Medicine', desc: 'Medicine department', match: ['Medicine'] },
  { id: 'dept-nursing', name: 'Nursing', desc: 'All nursing staff', match: ['Nursing', 'Nursing - Float', 'Nursing - Gen F', 'Nursing - Gen M', 'Nursing - ICU', 'Nursing - PVT', 'Nursing - Senior'] },
  { id: 'dept-ot', name: 'Operation Theatre', desc: 'OT scheduling and management', match: ['OT'] },
  { id: 'dept-ortho', name: 'Orthopaedics', desc: 'Orthopaedics team', match: ['Orthopaedics'] },
  { id: 'dept-pharmacy', name: 'Pharmacy', desc: 'Pharmacy and dispensing', match: ['Pharmacy'] },
  { id: 'dept-rmo', name: 'RMO', desc: 'Resident medical officers', match: ['RMO'] },
  // 4 cross-functional channels
  { id: 'dept-clinical-care', name: 'Clinical Care', desc: 'Cross-department clinical discussions', match: ['General Surgery', 'Internal Medicine', 'Medicine', 'Orthopaedics', 'Emergency', 'RMO'] },
  { id: 'dept-ops', name: 'Operations', desc: 'Hospital operations coordination', match: ['Administration', 'Front Office', 'Customer Care'] },
  { id: 'dept-quality', name: 'Quality & Safety', desc: 'Quality improvement and patient safety', match: ['Administration'] }, // HODs added manually
  { id: 'dept-finance', name: 'Finance', desc: 'Finance and revenue cycle', match: ['Billing', 'Administration'] },
];

const HOSPITAL_ID = 'EHRC';

async function run() {
  console.log('🚀 OC.1a: Seeding channels and syncing memberships...\n');

  // Get system admin user for created_by
  const [admin] = await sql`SELECT id FROM users WHERE 'super_admin' = ANY(roles) AND hospital_id = ${HOSPITAL_ID} LIMIT 1`;
  if (!admin) { console.error('❌ No super_admin found for EHRC'); process.exit(1); }
  const createdBy = admin.id;
  console.log(`  Using admin: ${createdBy}\n`);

  // ── 1. Seed department channels ──
  let channelCount = 0;
  for (const ch of DEPT_CHANNELS) {
    const existing = await sql`SELECT id FROM chat_channels WHERE channel_id = ${ch.id}`;
    if (existing.length > 0) {
      console.log(`  ⏭️  Channel ${ch.id} already exists`);
      continue;
    }
    await sql`
      INSERT INTO chat_channels (channel_id, channel_type, name, description, hospital_id, created_by)
      VALUES (${ch.id}, 'department', ${ch.name}, ${ch.desc}, ${HOSPITAL_ID}, ${createdBy})
    `;
    channelCount++;
    console.log(`  ✅ Created channel: ${ch.id} (${ch.name})`);
  }

  // ── 2. Seed broadcast channel ──
  const broadcastExists = await sql`SELECT id FROM chat_channels WHERE channel_id = 'broadcast-ehrc'`;
  if (broadcastExists.length === 0) {
    await sql`
      INSERT INTO chat_channels (channel_id, channel_type, name, description, hospital_id, created_by)
      VALUES ('broadcast-ehrc', 'broadcast', 'EHRC Announcements', 'Hospital-wide announcements and updates', ${HOSPITAL_ID}, ${createdBy})
    `;
    channelCount++;
    console.log(`  ✅ Created channel: broadcast-ehrc (EHRC Announcements)`);
  } else {
    console.log(`  ⏭️  Channel broadcast-ehrc already exists`);
  }

  console.log(`\n  📊 Channels created: ${channelCount}`);

  // ── 3. Sync memberships: map users → channels by department ──
  console.log('\n  Syncing memberships...');
  const allUsers = await sql`SELECT id, full_name, department, roles FROM users WHERE hospital_id = ${HOSPITAL_ID} AND status = 'active'`;
  const allChannels = await sql`SELECT id, channel_id FROM chat_channels WHERE hospital_id = ${HOSPITAL_ID}`;
  const channelMap = Object.fromEntries(allChannels.map(c => [c.channel_id, c.id]));

  let membershipCount = 0;

  for (const user of allUsers) {
    // Department channels
    for (const ch of DEPT_CHANNELS) {
      if (!ch.match.includes(user.department)) continue;
      const chUuid = channelMap[ch.id];
      if (!chUuid) continue;

      const exists = await sql`SELECT 1 FROM chat_channel_members WHERE channel_id = ${chUuid} AND user_id = ${user.id}`;
      if (exists.length > 0) continue;

      // Admins/HODs get admin role in their dept channel
      const isAdmin = (user.roles || []).some(r => ['super_admin', 'hospital_admin', 'department_head'].includes(r));
      await sql`
        INSERT INTO chat_channel_members (channel_id, user_id, role)
        VALUES (${chUuid}, ${user.id}, ${isAdmin ? 'admin' : 'member'})
      `;
      membershipCount++;
    }

    // Broadcast channel — everyone joins
    const broadcastUuid = channelMap['broadcast-ehrc'];
    if (broadcastUuid) {
      const exists = await sql`SELECT 1 FROM chat_channel_members WHERE channel_id = ${broadcastUuid} AND user_id = ${user.id}`;
      if (exists.length === 0) {
        const isAdmin = (user.roles || []).some(r => ['super_admin', 'hospital_admin'].includes(r));
        await sql`
          INSERT INTO chat_channel_members (channel_id, user_id, role)
          VALUES (${broadcastUuid}, ${user.id}, ${isAdmin ? 'admin' : 'read_only'})
        `;
        membershipCount++;
      }
    }
  }

  console.log(`  📊 Memberships created: ${membershipCount}`);

  // ── 4. Seed presence rows for all users ──
  console.log('\n  Seeding presence...');
  let presenceCount = 0;
  for (const user of allUsers) {
    const exists = await sql`SELECT 1 FROM chat_presence WHERE user_id = ${user.id}`;
    if (exists.length > 0) continue;
    await sql`INSERT INTO chat_presence (user_id, hospital_id) VALUES (${user.id}, ${HOSPITAL_ID})`;
    presenceCount++;
  }
  console.log(`  📊 Presence rows created: ${presenceCount}`);

  // ── 5. Final verification ──
  console.log('\n📊 Final Verification:');
  const [chCount] = await sql`SELECT count(*) as c FROM chat_channels WHERE hospital_id = ${HOSPITAL_ID}`;
  const [memCount] = await sql`SELECT count(*) as c FROM chat_channel_members`;
  const [presCount] = await sql`SELECT count(*) as c FROM chat_presence`;
  console.log(`  Channels: ${chCount.c}`);
  console.log(`  Memberships: ${memCount.c}`);
  console.log(`  Presence rows: ${presCount.c}`);

  // Per-channel membership counts
  const channelStats = await sql`
    SELECT cc.channel_id, cc.name, count(ccm.id) as members
    FROM chat_channels cc
    LEFT JOIN chat_channel_members ccm ON ccm.channel_id = cc.id AND ccm.left_at IS NULL
    WHERE cc.hospital_id = ${HOSPITAL_ID}
    GROUP BY cc.channel_id, cc.name
    ORDER BY cc.channel_id
  `;
  console.log('\n  Per-channel membership:');
  channelStats.forEach(c => console.log(`    ${c.channel_id.padEnd(24)} ${c.name.padEnd(20)} → ${c.members} members`));

  console.log('\n✅ OC.1a seed + membership sync complete!');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
