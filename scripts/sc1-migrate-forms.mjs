/**
 * SC.1 — Form Engine Migration
 * Creates 4 tables: form_definitions, form_submissions, form_audit_log, form_analytics_events
 * Run: node scripts/sc1-migrate-forms.mjs
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('SC.1 — Creating form engine tables...\n');

  // ── Enums ──────────────────────────────────────────────────────────────────
  console.log('1/6 Creating enums...');
  await sql`
    DO $$ BEGIN
      CREATE TYPE form_category_sc1 AS ENUM ('clinical', 'operational', 'administrative', 'custom');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE form_status_sc1 AS ENUM ('draft', 'active', 'archived');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE submission_status AS ENUM ('draft', 'submitted', 'reviewed', 'locked', 'voided');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE form_audit_action AS ENUM ('form_opened', 'form_submitted', 'form_viewed', 'status_changed', 'version_created', 'export_pdf');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `;
  await sql`
    DO $$ BEGIN
      CREATE TYPE form_analytics_event_type AS ENUM ('form_start', 'field_focus', 'field_blur', 'section_enter', 'form_submit', 'form_abandon');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `;
  console.log('   ✅ Enums created');

  // ── form_definitions ───────────────────────────────────────────────────────
  console.log('2/6 Creating form_definitions...');
  await sql`
    CREATE TABLE IF NOT EXISTS form_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      name VARCHAR(256) NOT NULL,
      slug VARCHAR(128) NOT NULL,
      description TEXT,
      category form_category_sc1 NOT NULL DEFAULT 'custom',
      version INT NOT NULL DEFAULT 1,
      status form_status_sc1 NOT NULL DEFAULT 'draft',
      sections JSONB NOT NULL DEFAULT '[]',
      requires_patient BOOLEAN NOT NULL DEFAULT false,
      applicable_roles JSONB NOT NULL DEFAULT '[]',
      applicable_encounter_types JSONB DEFAULT '[]',
      role_field_visibility JSONB,
      slash_command VARCHAR(64),
      slash_role_action_map JSONB,
      layout VARCHAR(32) NOT NULL DEFAULT 'auto',
      submission_target TEXT NOT NULL DEFAULT 'form_submissions',
      submit_endpoint TEXT,
      template_slug VARCHAR(128),
      submit_transform TEXT,
      source_url TEXT,
      ported_from VARCHAR(128),
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_form_defs_slug ON form_definitions(hospital_id, slug, version)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_defs_hospital ON form_definitions(hospital_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_defs_slash ON form_definitions(slash_command) WHERE slash_command IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_defs_roles ON form_definitions USING GIN(applicable_roles)`;
  console.log('   ✅ form_definitions created');

  // ── form_submissions ───────────────────────────────────────────────────────
  console.log('3/6 Creating form_submissions...');
  await sql`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      form_definition_id UUID NOT NULL REFERENCES form_definitions(id) ON DELETE RESTRICT,
      patient_id UUID,
      encounter_id UUID,
      channel_id UUID,
      message_id INT,
      parent_submission_id UUID REFERENCES form_submissions(id),
      version INT NOT NULL DEFAULT 1,
      form_data JSONB NOT NULL,
      form_data_hash TEXT NOT NULL,
      status submission_status NOT NULL DEFAULT 'submitted',
      void_reason TEXT,
      submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by UUID,
      reviewed_at TIMESTAMPTZ,
      locked_by UUID,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_subs_hospital ON form_submissions(hospital_id, submitted_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_subs_patient ON form_submissions(patient_id) WHERE patient_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_subs_form ON form_submissions(form_definition_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_subs_parent ON form_submissions(parent_submission_id) WHERE parent_submission_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_subs_encounter ON form_submissions(encounter_id) WHERE encounter_id IS NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_form_subs_version ON form_submissions(form_definition_id, patient_id, version)`;
  console.log('   ✅ form_submissions created');

  // ── form_audit_log ─────────────────────────────────────────────────────────
  console.log('4/6 Creating form_audit_log...');
  await sql`
    CREATE TABLE IF NOT EXISTS form_audit_log (
      id BIGSERIAL PRIMARY KEY,
      hospital_id TEXT NOT NULL,
      form_definition_id UUID NOT NULL,
      form_submission_id UUID,
      patient_id UUID,
      action form_audit_action NOT NULL,
      action_detail JSONB,
      field_snapshot JSONB,
      performed_by UUID NOT NULL,
      performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_audit_hospital ON form_audit_log(hospital_id, performed_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_audit_form ON form_audit_log(form_definition_id, performed_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_audit_patient ON form_audit_log(patient_id) WHERE patient_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_audit_user ON form_audit_log(performed_by, performed_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_audit_submission ON form_audit_log(form_submission_id) WHERE form_submission_id IS NOT NULL`;
  console.log('   ✅ form_audit_log created');

  // ── form_analytics_events ──────────────────────────────────────────────────
  console.log('5/6 Creating form_analytics_events...');
  await sql`
    CREATE TABLE IF NOT EXISTS form_analytics_events (
      id BIGSERIAL PRIMARY KEY,
      hospital_id TEXT NOT NULL,
      form_definition_id UUID NOT NULL,
      session_id TEXT NOT NULL,
      event_type form_analytics_event_type NOT NULL,
      field_id TEXT,
      section_id TEXT,
      duration_ms INT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_events_form ON form_analytics_events(form_definition_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_form_events_session ON form_analytics_events(session_id)`;
  console.log('   ✅ form_analytics_events created');

  // ── Verify ─────────────────────────────────────────────────────────────────
  console.log('6/6 Verifying...');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('form_definitions', 'form_submissions', 'form_audit_log', 'form_analytics_events')
    ORDER BY table_name
  `;
  console.log(`   ✅ ${tables.length}/4 tables verified:`);
  tables.forEach(t => console.log(`      - ${t.table_name}`));

  const totalTables = await sql`
    SELECT COUNT(*) as count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  console.log(`\n🏁 SC.1 migration complete. Total tables in Even OS: ${totalTables[0].count}`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
