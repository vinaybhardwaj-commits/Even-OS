#!/usr/bin/env node
/**
 * OC.1a — Create 8 chat tables + 5 enums in Neon
 * Run from apps/web: node scripts/oc1a-migrate-chat.js
 * Requires: DATABASE_URL in .env.local
 */

const { neon } = require('@neondatabase/serverless');
// DATABASE_URL must be set via: export $(grep DATABASE_URL .env.local | tr -d '"')

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const statements = [
  // ── Enums ──
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_type') THEN
      CREATE TYPE channel_type AS ENUM ('department', 'patient', 'direct', 'broadcast');
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_member_role') THEN
      CREATE TYPE channel_member_role AS ENUM ('admin', 'member', 'read_only');
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_message_type') THEN
      CREATE TYPE chat_message_type AS ENUM ('chat', 'system', 'alert', 'task', 'handoff', 'escalation', 'actionable', 'media', 'slash_result', 'auto_event');
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_priority') THEN
      CREATE TYPE message_priority AS ENUM ('urgent', 'high', 'normal', 'low');
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'presence_status') THEN
      CREATE TYPE presence_status AS ENUM ('online', 'away', 'offline');
    END IF;
  END $$`,

  // ── 1. chat_channels ──
  `CREATE TABLE IF NOT EXISTS chat_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id VARCHAR(128) UNIQUE NOT NULL,
    channel_type channel_type NOT NULL,
    name VARCHAR(256) NOT NULL,
    description TEXT,
    hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
    encounter_id UUID REFERENCES encounters(id),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    last_message_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_channels_hospital_type ON chat_channels(hospital_id, channel_type)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_channels_encounter ON chat_channels(encounter_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_channels_last_msg ON chat_channels(hospital_id, last_message_at DESC)`,

  // ── 2. chat_channel_members ──
  `CREATE TABLE IF NOT EXISTS chat_channel_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role channel_member_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    last_read_at TIMESTAMPTZ,
    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(channel_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_members_user_active ON chat_channel_members(user_id) WHERE left_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_chat_members_channel_active ON chat_channel_members(channel_id) WHERE left_at IS NULL`,

  // ── 3. chat_messages (SERIAL PK for cursor-based polling) ──
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id),
    message_type chat_message_type NOT NULL DEFAULT 'chat',
    priority message_priority NOT NULL DEFAULT 'normal',
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    reply_to_id INTEGER REFERENCES chat_messages(id),
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_retracted BOOLEAN NOT NULL DEFAULT FALSE,
    retracted_at TIMESTAMPTZ,
    retracted_by UUID,
    retracted_reason TEXT,
    hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created ON chat_messages(channel_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_created ON chat_messages(sender_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_type ON chat_messages(channel_id, message_type)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_hospital ON chat_messages(hospital_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_id_channel ON chat_messages(id, channel_id)`,

  // ── 4. chat_attachments ──
  `CREATE TABLE IF NOT EXISTS chat_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    file_name VARCHAR(256) NOT NULL,
    file_type VARCHAR(64) NOT NULL,
    file_size INTEGER NOT NULL,
    file_url TEXT NOT NULL,
    thumbnail_url TEXT,
    patient_document_id UUID,
    document_category VARCHAR(64),
    is_retracted BOOLEAN NOT NULL DEFAULT FALSE,
    retracted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_attachments_patient_doc ON chat_attachments(patient_document_id)`,

  // ── 5. chat_reactions ──
  `CREATE TABLE IF NOT EXISTS chat_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_reactions(message_id)`,

  // ── 6. chat_typing (ephemeral) ──
  `CREATE TABLE IF NOT EXISTS chat_typing (
    channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
  )`,

  // ── 7. chat_presence ──
  `CREATE TABLE IF NOT EXISTS chat_presence (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status presence_status NOT NULL DEFAULT 'offline',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_presence_hospital_status ON chat_presence(hospital_id, status)`,

  // ── 8. chat_notification_prefs ──
  `CREATE TABLE IF NOT EXISTS chat_notification_prefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES chat_channels(id) ON DELETE CASCADE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    mute_until TIMESTAMPTZ,
    UNIQUE(user_id, channel_id)
  )`,
  // Partial unique index for global prefs (channel_id IS NULL)
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_notif_prefs_user_global
   ON chat_notification_prefs (user_id) WHERE channel_id IS NULL`,
];

async function run() {
  console.log('🚀 OC.1a: Creating 5 enums + 8 chat tables...\n');

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
    try {
      await sql(stmt);
      console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}...`);
    } catch (err) {
      console.error(`  ❌ [${i + 1}/${statements.length}] ${preview}...`);
      console.error(`     ${err.message}`);
    }
  }

  // Verify
  console.log('\n📊 Verification:');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'chat_%'
    ORDER BY table_name
  `;
  console.log(`  Chat tables: ${tables.length}`);
  tables.forEach(t => console.log(`    ✓ ${t.table_name}`));

  const enums = await sql`
    SELECT typname FROM pg_type
    WHERE typname IN ('channel_type', 'channel_member_role', 'chat_message_type', 'message_priority', 'presence_status')
    ORDER BY typname
  `;
  console.log(`  Chat enums: ${enums.length}`);
  enums.forEach(e => console.log(`    ✓ ${e.typname}`));

  console.log('\n✅ OC.1a migration complete!');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
