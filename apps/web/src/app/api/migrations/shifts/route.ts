import { NextRequest, NextResponse } from 'next/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const results: string[] = [];

    // ── Enums ──────────────────────────────────────────────────────

    await sql(`DO $$ BEGIN
      CREATE TYPE shift_name AS ENUM ('morning', 'evening', 'night', 'general', 'custom');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum shift_name ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE shift_instance_status AS ENUM ('planned', 'active', 'completed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum shift_instance_status ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE roster_status AS ENUM ('scheduled', 'confirmed', 'absent', 'swapped', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum roster_status ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE swap_status AS ENUM ('pending_target', 'pending_approval', 'approved', 'denied', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum swap_status ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE leave_type AS ENUM ('sick', 'casual', 'privilege', 'emergency', 'compensatory', 'maternity', 'other');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum leave_type ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'denied', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum leave_status ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE ward_type_applicability AS ENUM ('icu', 'general', 'step_down', 'ot', 'er', 'all');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum ward_type_applicability ready');

    // ── 1. shift_templates ─────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS shift_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        shift_name shift_name NOT NULL DEFAULT 'custom',
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        duration_hours REAL NOT NULL DEFAULT 8,
        ward_type ward_type_applicability NOT NULL DEFAULT 'all',
        is_default BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        color TEXT DEFAULT '#3B82F6',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('shift_templates created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_templates_hospital ON shift_templates(hospital_id)`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_templates_name_hospital ON shift_templates(name, hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_templates_default ON shift_templates(is_default)`);

    // ── 2. shift_instances ─────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS shift_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE RESTRICT,
        ward_id UUID NOT NULL,
        shift_date DATE NOT NULL,
        charge_nurse_id UUID,
        status shift_instance_status NOT NULL DEFAULT 'planned',
        actual_start TIMESTAMPTZ,
        actual_end TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('shift_instances created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_instances_hospital ON shift_instances(hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_instances_ward_date ON shift_instances(ward_id, shift_date)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_instances_date ON shift_instances(shift_date)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_instances_template ON shift_instances(template_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_instances_charge_nurse ON shift_instances(charge_nurse_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_instances_status ON shift_instances(status)`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_instances_unique ON shift_instances(template_id, ward_id, shift_date)`);

    // ── 3. shift_roster ────────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS shift_roster (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shift_instance_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        role_during_shift TEXT NOT NULL DEFAULT 'nurse',
        status roster_status NOT NULL DEFAULT 'scheduled',
        assigned_by UUID,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('shift_roster created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_roster_instance ON shift_roster(shift_instance_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_roster_user ON shift_roster(user_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_roster_status ON shift_roster(status)`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_roster_unique ON shift_roster(shift_instance_id, user_id)`);

    // ── 4. shift_swaps ─────────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS shift_swaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        requesting_user_id UUID NOT NULL,
        target_user_id UUID NOT NULL,
        shift_instance_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
        swap_shift_instance_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
        reason TEXT,
        status swap_status NOT NULL DEFAULT 'pending_target',
        target_confirmed_at TIMESTAMPTZ,
        approved_by UUID,
        approved_at TIMESTAMPTZ,
        denial_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('shift_swaps created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_swaps_hospital ON shift_swaps(hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_swaps_requesting ON shift_swaps(requesting_user_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_swaps_target ON shift_swaps(target_user_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swaps(status)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_shift_swaps_instance ON shift_swaps(shift_instance_id)`);

    // ── 5. leave_requests ──────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        user_id UUID NOT NULL,
        leave_type leave_type NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT,
        status leave_status NOT NULL DEFAULT 'pending',
        approved_by UUID,
        approved_at TIMESTAMPTZ,
        denial_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('leave_requests created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_leave_requests_hospital ON leave_requests(hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date)`);

    // ── 6. staffing_targets ────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS staffing_targets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        ward_type ward_type_applicability NOT NULL,
        role TEXT NOT NULL DEFAULT 'nurse',
        min_ratio REAL NOT NULL,
        optimal_ratio REAL NOT NULL,
        amber_threshold_pct REAL NOT NULL DEFAULT 20,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('staffing_targets created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_staffing_targets_hospital ON staffing_targets(hospital_id)`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_staffing_targets_ward_role ON staffing_targets(hospital_id, ward_type, role)`);

    // ── 7. overtime_log ────────────────────────────────────────────

    await sql(`
      CREATE TABLE IF NOT EXISTS overtime_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        user_id UUID NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        scheduled_hours REAL NOT NULL DEFAULT 0,
        actual_hours REAL NOT NULL DEFAULT 0,
        overtime_hours REAL NOT NULL DEFAULT 0,
        consecutive_shifts INTEGER NOT NULL DEFAULT 0,
        is_flagged BOOLEAN NOT NULL DEFAULT false,
        flag_reason TEXT,
        approved_by UUID,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    results.push('overtime_log created');

    await sql(`CREATE INDEX IF NOT EXISTS idx_overtime_log_hospital ON overtime_log(hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_overtime_log_user ON overtime_log(user_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_overtime_log_period ON overtime_log(period_start, period_end)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_overtime_log_flagged ON overtime_log(is_flagged)`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_overtime_log_unique ON overtime_log(user_id, period_start, period_end)`);

    return NextResponse.json({
      success: true,
      message: 'Shift management migration complete',
      tables: results,
    });
  } catch (error: any) {
    console.error('Shift migration error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
