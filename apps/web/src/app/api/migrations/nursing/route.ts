import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

// ============================================================
// NURSING MIGRATION — NS.1
// 3 tables: patient_assignments, shift_handoffs, nursing_assessments
// 4 enums: assignment_status, handoff_status, handoff_priority, nursing_assessment_type
// ============================================================

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized — super_admin only' }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // ── Enums ────────────────────────────────────────────────────────────

    await sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
        CREATE TYPE assignment_status AS ENUM ('active', 'completed', 'transferred', 'cancelled');
      END IF;
    END $$`;

    await sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'handoff_status') THEN
        CREATE TYPE handoff_status AS ENUM ('draft', 'submitted', 'acknowledged', 'flagged');
      END IF;
    END $$`;

    await sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'handoff_priority') THEN
        CREATE TYPE handoff_priority AS ENUM ('routine', 'watch', 'critical');
      END IF;
    END $$`;

    await sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nursing_assessment_type') THEN
        CREATE TYPE nursing_assessment_type AS ENUM ('admission', 'shift_start', 'routine', 'focused', 'discharge');
      END IF;
    END $$`;

    // ── patient_assignments ──────────────────────────────────────────────

    await sql`CREATE TABLE IF NOT EXISTS patient_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      shift_instance_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
      nurse_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
      ward_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      bed_label TEXT,
      status assignment_status NOT NULL DEFAULT 'active',
      assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_hospital ON patient_assignments(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_shift ON patient_assignments(shift_instance_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_nurse ON patient_assignments(nurse_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_patient ON patient_assignments(patient_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_encounter ON patient_assignments(encounter_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_ward ON patient_assignments(ward_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_patient_assignments_status ON patient_assignments(status)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_assignments_unique_patient_shift ON patient_assignments(shift_instance_id, patient_id)`;

    // ── shift_handoffs ───────────────────────────────────────────────────

    await sql`CREATE TABLE IF NOT EXISTS shift_handoffs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
      outgoing_shift_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
      incoming_shift_id UUID REFERENCES shift_instances(id) ON DELETE SET NULL,
      outgoing_nurse_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      incoming_nurse_id UUID REFERENCES users(id) ON DELETE SET NULL,
      situation TEXT,
      background TEXT,
      assessment TEXT,
      recommendation TEXT,
      priority handoff_priority NOT NULL DEFAULT 'routine',
      status handoff_status NOT NULL DEFAULT 'draft',
      pending_tasks JSONB,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_hospital ON shift_handoffs(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_patient ON shift_handoffs(patient_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_encounter ON shift_handoffs(encounter_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_outgoing ON shift_handoffs(outgoing_shift_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_incoming ON shift_handoffs(incoming_shift_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_outgoing_nurse ON shift_handoffs(outgoing_nurse_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_status ON shift_handoffs(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shift_handoffs_priority ON shift_handoffs(priority)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_handoffs_unique ON shift_handoffs(outgoing_shift_id, patient_id)`;

    // ── nursing_assessments ──────────────────────────────────────────────

    await sql`CREATE TABLE IF NOT EXISTS nursing_assessments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
      assignment_id UUID REFERENCES patient_assignments(id) ON DELETE SET NULL,
      nurse_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assessment_type nursing_assessment_type NOT NULL DEFAULT 'routine',
      pain_score INTEGER,
      fall_risk_score INTEGER,
      braden_score INTEGER,
      mobility_status TEXT,
      diet_compliance TEXT,
      iv_site_status TEXT,
      wound_status TEXT,
      neuro_status TEXT,
      notes TEXT,
      assessment_data JSONB,
      is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
      flag_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_hospital ON nursing_assessments(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_patient ON nursing_assessments(patient_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_encounter ON nursing_assessments(encounter_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_assignment ON nursing_assessments(assignment_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_nurse ON nursing_assessments(nurse_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_type ON nursing_assessments(assessment_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_flagged ON nursing_assessments(is_flagged)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nursing_assessments_created ON nursing_assessments(created_at)`;

    return NextResponse.json({
      success: true,
      message: 'Nursing migration complete — 3 tables, 4 enums, 25 indexes',
      tables: ['patient_assignments', 'shift_handoffs', 'nursing_assessments'],
      enums: ['assignment_status', 'handoff_status', 'handoff_priority', 'nursing_assessment_type'],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Nursing migration error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
