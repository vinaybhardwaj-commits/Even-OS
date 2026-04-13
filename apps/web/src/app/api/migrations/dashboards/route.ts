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

    // 1. dashboard_snapshots
    await sql(`
      CREATE TABLE IF NOT EXISTS dashboard_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        snapshot_date DATE NOT NULL,
        snapshot_time TIME NOT NULL,
        snapshot_interval VARCHAR(10) NOT NULL,
        census_current INT,
        census_target INT,
        occupancy_pct DECIMAL(5,2),
        pending_admissions_count INT,
        pending_admissions_overdue_count INT,
        pending_discharges_count INT,
        pending_discharges_overdue_count INT,
        critical_alerts_count INT,
        critical_alerts_unacked_count INT,
        staffing_summary JSONB,
        overdue_tasks_count INT,
        overdue_tasks_by_type JSONB,
        incidents_24h_count INT,
        incidents_critical_count INT,
        incident_queue_open INT,
        vc_signature_backlog_count INT,
        pharmacy_oos_count INT,
        billing_holds_count INT,
        admissions_yesterday INT,
        discharges_yesterday INT,
        revenue_yesterday DECIMAL(12,2),
        revenue_ytd DECIMAL(12,2),
        claim_rejection_rate DECIMAL(5,2),
        staff_attendance_pct DECIMAL(5,2),
        complaint_resolution_rate DECIMAL(5,2),
        los_avg_current DECIMAL(5,2),
        los_target DECIMAL(5,2),
        infection_rate DECIMAL(5,2),
        nabh_compliance_pct DECIMAL(5,2),
        revenue_month_to_date DECIMAL(12,2),
        revenue_budget DECIMAL(12,2),
        ebitda DECIMAL(12,2),
        ebitda_margin_pct DECIMAL(5,2),
        admission_volume_ytd INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_hospital_date ON dashboard_snapshots(hospital_id, snapshot_date, snapshot_interval)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_created_at ON dashboard_snapshots(created_at DESC)`);
    results.push('dashboard_snapshots ✓');

    // 2. dashboard_config
    await sql(`
      CREATE TABLE IF NOT EXISTS dashboard_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        dashboard_tier INT NOT NULL,
        layout_config JSONB NOT NULL DEFAULT '{}',
        auto_refresh_enabled BOOLEAN DEFAULT TRUE,
        refresh_interval_seconds INT DEFAULT 30,
        alert_severity_filter INT DEFAULT 1,
        department_filters JSONB DEFAULT '[]',
        kpi_bookmarks JSONB DEFAULT '[]',
        slack_notifications_enabled BOOLEAN DEFAULT FALSE,
        slack_webhook_url TEXT,
        sms_notifications_enabled BOOLEAN DEFAULT FALSE,
        email_digest_frequency VARCHAR(20) DEFAULT 'daily',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES users(id),
        updated_by UUID REFERENCES users(id)
      )
    `);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_config_user_hospital_tier ON dashboard_config(user_id, hospital_id, dashboard_tier)`);
    results.push('dashboard_config ✓');

    // 3. kpi_definitions
    await sql(`
      CREATE TABLE IF NOT EXISTS kpi_definitions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID REFERENCES hospitals(id),
        kpi_name VARCHAR(100) NOT NULL,
        kpi_code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        formula_type VARCHAR(50) NOT NULL,
        formula_query TEXT,
        data_source VARCHAR(100),
        refresh_cadence VARCHAR(20) DEFAULT 'hourly',
        target_value DECIMAL(12,2),
        warning_threshold DECIMAL(12,2),
        critical_threshold DECIMAL(12,2),
        unit VARCHAR(50),
        display_format VARCHAR(50),
        dashboard_tiers JSONB NOT NULL,
        category VARCHAR(50),
        benchmark_national DECIMAL(12,2),
        benchmark_network_avg DECIMAL(12,2),
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES users(id),
        updated_by UUID REFERENCES users(id)
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_kpi_definitions_kpi_code ON kpi_definitions(kpi_code)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_kpi_definitions_hospital_id ON kpi_definitions(hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_kpi_definitions_category ON kpi_definitions(category)`);
    results.push('kpi_definitions ✓');

    // 4. kpi_daily_values
    await sql(`
      CREATE TABLE IF NOT EXISTS kpi_daily_values (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        kpi_id UUID NOT NULL REFERENCES kpi_definitions(id),
        value_date DATE NOT NULL,
        actual_value DECIMAL(12,2) NOT NULL,
        target_value DECIMAL(12,2),
        variance_pct DECIMAL(5,2),
        status VARCHAR(20),
        previous_day_value DECIMAL(12,2),
        previous_week_value DECIMAL(12,2),
        previous_month_value DECIMAL(12,2),
        ytd_value DECIMAL(12,2),
        trend_direction VARCHAR(20),
        trend_pct DECIMAL(5,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_daily_values_hospital_kpi_date ON kpi_daily_values(hospital_id, kpi_id, value_date)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_kpi_daily_values_hospital_date ON kpi_daily_values(hospital_id, value_date)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_kpi_daily_values_kpi_id ON kpi_daily_values(kpi_id)`);
    results.push('kpi_daily_values ✓');

    // 5. alert_queue
    await sql(`
      CREATE TABLE IF NOT EXISTS alert_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        alert_type VARCHAR(100) NOT NULL,
        alert_source VARCHAR(100) NOT NULL,
        alert_code VARCHAR(50),
        alert_title VARCHAR(255) NOT NULL,
        alert_description TEXT,
        patient_id UUID,
        order_id UUID,
        ward_id UUID,
        assigned_to_role VARCHAR(50),
        assigned_to_user_id UUID REFERENCES users(id),
        severity_level INT NOT NULL,
        urgency_score INT,
        raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        raised_by_user_id UUID REFERENCES users(id),
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by_user_id UUID REFERENCES users(id),
        resolved_at TIMESTAMPTZ,
        resolved_by_user_id UUID REFERENCES users(id),
        escalation_chain JSONB DEFAULT '[]',
        escalation_attempts INT DEFAULT 0,
        escalated_to_ceo BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        dismissal_reason TEXT,
        metadata JSONB DEFAULT '{}',
        related_alerts JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_alert_queue_hospital_status ON alert_queue(hospital_id, status)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_alert_queue_severity ON alert_queue(severity_level)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_alert_queue_assigned_user ON alert_queue(assigned_to_user_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_alert_queue_patient_id ON alert_queue(patient_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_alert_queue_raised_at ON alert_queue(raised_at DESC)`);
    results.push('alert_queue ✓');

    // 6. dashboard_access_audit
    await sql(`
      CREATE TABLE IF NOT EXISTS dashboard_access_audit (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        action_type VARCHAR(100) NOT NULL,
        action_detail VARCHAR(255),
        dashboard_tier INT,
        kpi_accessed VARCHAR(100),
        export_format VARCHAR(20),
        export_scope VARCHAR(100),
        alert_id UUID,
        escalated_to_role VARCHAR(50),
        escalation_message TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_dashboard_access_audit_user_hospital ON dashboard_access_audit(user_id, hospital_id, created_at DESC)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_dashboard_access_audit_action_type ON dashboard_access_audit(action_type)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_dashboard_access_audit_created_at ON dashboard_access_audit(created_at DESC)`);
    results.push('dashboard_access_audit ✓');

    // 7. huddle_recordings
    await sql(`
      CREATE TABLE IF NOT EXISTS huddle_recordings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        ward_id UUID,
        recording_date DATE NOT NULL,
        recording_time TIME NOT NULL,
        recording_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recording_end_at TIMESTAMPTZ,
        duration_seconds INT,
        media_file_url TEXT,
        media_file_duration_seconds INT,
        media_file_size_bytes INT,
        transcript_status VARCHAR(50) DEFAULT 'pending',
        transcript_text TEXT,
        transcript_language VARCHAR(10) DEFAULT 'en-IN',
        speaker_count INT,
        speakers JSONB DEFAULT '[]',
        recorded_by_user_id UUID REFERENCES users(id),
        initiated_by_user_id UUID REFERENCES users(id),
        notes TEXT,
        audio_quality_score INT,
        transcription_confidence_score DECIMAL(3,2),
        retention_until DATE,
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_huddle_recordings_hospital_ward_date ON huddle_recordings(hospital_id, ward_id, recording_date DESC)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_huddle_recordings_status ON huddle_recordings(transcript_status)`);
    results.push('huddle_recordings ✓');

    // 8. huddle_speakers
    await sql(`
      CREATE TABLE IF NOT EXISTS huddle_speakers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recording_id UUID NOT NULL REFERENCES huddle_recordings(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        speaker_name VARCHAR(255),
        speaker_role VARCHAR(100),
        first_spoken_at TIMESTAMPTZ,
        last_spoken_at TIMESTAMPTZ,
        total_speaking_time_seconds INT,
        turn_count INT,
        speech_clarity_score DECIMAL(3,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_huddle_speakers_recording_id ON huddle_speakers(recording_id)`);
    results.push('huddle_speakers ✓');

    // 9. huddle_transcript_edits
    await sql(`
      CREATE TABLE IF NOT EXISTS huddle_transcript_edits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recording_id UUID NOT NULL REFERENCES huddle_recordings(id) ON DELETE CASCADE,
        original_text TEXT,
        corrected_text TEXT,
        timestamp_in_recording INT,
        edited_by_user_id UUID NOT NULL REFERENCES users(id),
        edit_reason VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_huddle_transcript_edits_recording_id ON huddle_transcript_edits(recording_id)`);
    results.push('huddle_transcript_edits ✓');

    // Seed standard KPIs
    await sql(`
      INSERT INTO kpi_definitions (kpi_name, kpi_code, description, formula_type, refresh_cadence, target_value, warning_threshold, critical_threshold, unit, display_format, dashboard_tiers, category)
      VALUES
        ('Current Census', 'CENSUS_CURRENT', 'Active admitted patients', 'sql_query', 'hourly', 85, 80, 95, 'count', 'integer', '[1,2,3,4]', 'census'),
        ('Occupancy Rate', 'OCCUPANCY_PCT', 'Bed occupancy percentage', 'derived', 'hourly', 80, 90, 95, '%', 'percentage', '[1,2,3,4]', 'census'),
        ('Pending Admissions', 'PENDING_ADMISSIONS', 'Patients waiting for admission', 'sql_query', 'real_time', 0, 3, 6, 'count', 'integer', '[1,2]', 'census'),
        ('Pending Discharges', 'PENDING_DISCHARGES', 'Discharge orders not yet processed', 'sql_query', 'real_time', 0, 2, 5, 'count', 'integer', '[1,2]', 'census'),
        ('Critical Alerts', 'CRITICAL_ALERTS', 'Unresolved critical alerts', 'sql_query', 'real_time', 0, 1, 3, 'count', 'integer', '[1,2]', 'incidents'),
        ('Revenue Yesterday', 'REVENUE_YESTERDAY', 'Total revenue collected yesterday', 'sql_query', 'daily', NULL, NULL, NULL, 'INR', 'currency', '[3,4]', 'finance'),
        ('Revenue MTD', 'REVENUE_MTD', 'Month-to-date revenue', 'aggregation', 'daily', NULL, NULL, NULL, 'INR', 'currency', '[3,4]', 'finance'),
        ('Claim Rejection Rate', 'CLAIM_REJECTION_RATE', 'Insurance claim rejection percentage', 'derived', 'daily', 10, 15, 25, '%', 'percentage', '[3,4]', 'billing'),
        ('Average LOS', 'LOS_AVG', 'Average length of stay in days', 'sql_query', 'daily', 4.5, 5.5, 7, 'days', 'decimal_2', '[3,4]', 'los'),
        ('NABH Compliance', 'NABH_COMPLIANCE_PCT', 'Overall NABH indicator compliance', 'aggregation', 'daily', 95, 85, 75, '%', 'percentage', '[3,4]', 'compliance'),
        ('HAI Rate', 'INFECTION_RATE', 'Hospital-acquired infections per 1000 patient-days', 'derived', 'daily', 2, 3, 5, 'per 1000 PD', 'decimal_2', '[3,4]', 'infection'),
        ('Staff Attendance', 'STAFF_ATTENDANCE_PCT', 'Overall staff attendance rate', 'sql_query', 'daily', 95, 90, 85, '%', 'percentage', '[3]', 'staffing'),
        ('Pharmacy OOS', 'PHARMACY_OOS', 'Drug items out of stock', 'sql_query', 'hourly', 0, 3, 8, 'count', 'integer', '[2]', 'quality'),
        ('Billing Holds', 'BILLING_HOLDS', 'Active billing holds', 'sql_query', 'hourly', 0, 5, 10, 'count', 'integer', '[2]', 'billing'),
        ('EBITDA Margin', 'EBITDA_MARGIN_PCT', 'Earnings before interest, taxes, depreciation, and amortization margin', 'derived', 'daily', 20, 15, 10, '%', 'percentage', '[4]', 'finance')
      ON CONFLICT (kpi_code) DO NOTHING
    `);
    results.push('KPI seed data (15 KPIs) ✓');

    return NextResponse.json({
      success: true,
      tables_created: results.length - 1, // -1 for seed
      results,
    });

  } catch (error: any) {
    console.error('[MIGRATION] Dashboards error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
