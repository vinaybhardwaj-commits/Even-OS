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

    // 1. ai_insight_cards
    // Universal AI output container for all LLM-generated insights
    await sql(`
      CREATE TABLE IF NOT EXISTS ai_insight_cards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        module VARCHAR(100) NOT NULL,
        category VARCHAR(30) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        explanation TEXT NOT NULL,
        data_sources JSONB NOT NULL DEFAULT '[]',
        suggested_action TEXT,
        action_url VARCHAR(500),
        confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
        source VARCHAR(20) NOT NULL DEFAULT 'template',
        model_version VARCHAR(50),
        audit_log_id UUID,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        target_user_id UUID,
        target_role VARCHAR(50),
        target_encounter_id UUID,
        target_patient_id UUID,
        expires_at TIMESTAMPTZ,
        dismissed_by UUID,
        dismissed_at TIMESTAMPTZ,
        acted_on_by UUID,
        acted_on_at TIMESTAMPTZ,
        feedback_score INTEGER,
        feedback_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_insight_cards_hospital_module ON ai_insight_cards(hospital_id, module)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_insight_cards_hospital_status_severity ON ai_insight_cards(hospital_id, status, severity)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_insight_cards_target_encounter ON ai_insight_cards(target_encounter_id) WHERE target_encounter_id IS NOT NULL`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_insight_cards_target_patient ON ai_insight_cards(target_patient_id) WHERE target_patient_id IS NOT NULL`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_insight_cards_expires_at ON ai_insight_cards(expires_at) WHERE expires_at IS NOT NULL`);
    results.push('ai_insight_cards ✓');

    // 2. ai_audit_log
    // Full transparency on every LLM call: prompts, responses, tokens, latency
    await sql(`
      CREATE TABLE IF NOT EXISTS ai_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        module VARCHAR(100) NOT NULL,
        prompt_text TEXT NOT NULL,
        prompt_tokens INTEGER,
        response_text TEXT NOT NULL,
        response_tokens INTEGER,
        model VARCHAR(50) NOT NULL,
        latency_ms INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        input_data_hash VARCHAR(64),
        triggered_by VARCHAR(50) NOT NULL,
        user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_audit_log_hospital_created ON ai_audit_log(hospital_id, created_at DESC)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_audit_log_module_created ON ai_audit_log(module, created_at DESC)`);
    results.push('ai_audit_log ✓');

    // 3. ai_request_queue
    // Async queue for offline-first processing and batch LLM calls
    await sql(`
      CREATE TABLE IF NOT EXISTS ai_request_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        module VARCHAR(100) NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        input_data JSONB NOT NULL,
        prompt_template VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_attempt_at TIMESTAMPTZ,
        error_message TEXT,
        result_card_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        process_after TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_request_queue_pending ON ai_request_queue(status, process_after) WHERE status='pending'`);
    results.push('ai_request_queue ✓');

    // 4. claim_predictions
    // ML-based insurance claim approval forecasting
    await sql(`
      CREATE TABLE IF NOT EXISTS claim_predictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        encounter_id UUID NOT NULL REFERENCES encounters(id),
        claim_id UUID,
        tpa_name VARCHAR(100) NOT NULL,
        procedure_category VARCHAR(100),
        predicted_amount NUMERIC(12,2) NOT NULL,
        predicted_approval NUMERIC(12,2) NOT NULL,
        predicted_approval_pct NUMERIC(5,2) NOT NULL,
        predicted_deductions JSONB NOT NULL DEFAULT '[]',
        confidence NUMERIC(3,2) NOT NULL,
        source VARCHAR(20) NOT NULL,
        actual_claim_amount NUMERIC(12,2),
        actual_approved_amount NUMERIC(12,2),
        actual_deductions JSONB,
        settlement_date DATE,
        prediction_accuracy NUMERIC(5,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_claim_predictions_encounter ON claim_predictions(encounter_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_claim_predictions_hospital_tpa ON claim_predictions(hospital_id, tpa_name)`);
    results.push('claim_predictions ✓');

    // 5. claim_rubrics
    // Self-improving deduction rules learned from actual TPA responses
    await sql(`
      CREATE TABLE IF NOT EXISTS claim_rubrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        tpa_name VARCHAR(100) NOT NULL,
        procedure_category VARCHAR(100),
        rule_type VARCHAR(30) NOT NULL,
        rule_data JSONB NOT NULL,
        confidence NUMERIC(3,2) NOT NULL DEFAULT 0.70,
        source VARCHAR(30) NOT NULL DEFAULT 'manual',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_claim_rubrics_hospital_tpa ON claim_rubrics(hospital_id, tpa_name, is_active)`);
    results.push('claim_rubrics ✓');

    // 6. nabh_readiness_scores
    // Compliance tracking: chapter-by-chapter NABH readiness with AI-generated action items
    await sql(`
      CREATE TABLE IF NOT EXISTS nabh_readiness_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        score_date DATE NOT NULL,
        overall_score NUMERIC(5,2) NOT NULL,
        chapter_scores JSONB NOT NULL,
        top_gaps JSONB NOT NULL DEFAULT '[]',
        action_items_generated INTEGER NOT NULL DEFAULT 0,
        source VARCHAR(20) NOT NULL,
        audit_log_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(hospital_id, score_date)
      )
    `);
    results.push('nabh_readiness_scores ✓');

    // 7. bed_predictions
    // ML discharge prediction: predict when beds will free up
    await sql(`
      CREATE TABLE IF NOT EXISTS bed_predictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        bed_id UUID NOT NULL REFERENCES beds(id),
        encounter_id UUID NOT NULL REFERENCES encounters(id),
        predicted_discharge_at TIMESTAMPTZ NOT NULL,
        confidence NUMERIC(3,2) NOT NULL,
        factors JSONB NOT NULL DEFAULT '[]',
        actual_discharge_at TIMESTAMPTZ,
        prediction_error_hours NUMERIC(6,2),
        source VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_bed_predictions_hospital_created ON bed_predictions(hospital_id, created_at DESC)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_bed_predictions_bed_active ON bed_predictions(bed_id) WHERE actual_discharge_at IS NULL`);
    results.push('bed_predictions ✓');

    // 8. ai_template_rules
    // Config-driven insight generation: triggers + templates for all modules
    await sql(`
      CREATE TABLE IF NOT EXISTS ai_template_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id UUID NOT NULL REFERENCES hospitals(id),
        module VARCHAR(100) NOT NULL,
        rule_name VARCHAR(200) NOT NULL,
        trigger_type VARCHAR(30) NOT NULL,
        condition_config JSONB NOT NULL,
        card_template JSONB NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        fire_count INTEGER NOT NULL DEFAULT 0,
        last_fired_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql(`CREATE INDEX IF NOT EXISTS idx_ai_template_rules_hospital_module ON ai_template_rules(hospital_id, module, is_active)`);
    results.push('ai_template_rules ✓');

    // ============================================
    // SEED DATA: TPA Claim Rubrics (5 TPAs)
    // ============================================
    const tpas = [
      { name: 'Star Health', deduction_pattern: { consumables_cap_pct: 10, pharmacy_markup_limit: 20, room_upgrade_differential_pct: 50, surgeon_fee_limit_pct: 85 } },
      { name: 'ICICI Lombard', deduction_pattern: { consumables_cap_pct: 12, pharmacy_markup_limit: 18, room_upgrade_differential_pct: 45, surgeon_fee_limit_pct: 80 } },
      { name: 'HDFC Ergo', deduction_pattern: { consumables_cap_pct: 8, pharmacy_markup_limit: 22, room_upgrade_differential_pct: 55, surgeon_fee_limit_pct: 90 } },
      { name: 'Niva Bupa', deduction_pattern: { consumables_cap_pct: 15, pharmacy_markup_limit: 25, room_upgrade_differential_pct: 40, surgeon_fee_limit_pct: 75 } },
      { name: 'Care Health', deduction_pattern: { consumables_cap_pct: 11, pharmacy_markup_limit: 19, room_upgrade_differential_pct: 48, surgeon_fee_limit_pct: 85 } },
    ];

    for (const tpa of tpas) {
      await sql(`
        INSERT INTO claim_rubrics (
          hospital_id,
          tpa_name,
          procedure_category,
          rule_type,
          rule_data,
          confidence,
          source,
          is_active
        )
        SELECT
          (SELECT id FROM hospitals LIMIT 1),
          $1,
          'General Surgery',
          'deduction_pattern',
          $2,
          0.85,
          'manual',
          TRUE
        ON CONFLICT DO NOTHING
      `, [tpa.name, JSON.stringify(tpa.deduction_pattern)]);
    }
    results.push('Claim rubrics seed (5 TPAs) ✓');

    // ============================================
    // SEED DATA: AI Template Rules (~10)
    // ============================================
    const templateRules = [
      // Billing
      {
        module: 'billing',
        rule_name: 'Unsigned Pre-Auth Expiring',
        trigger_type: 'pre_auth_status',
        condition: { field: 'expires_at', operator: 'within_hours', value: 24 },
        template: {
          severity: 'high',
          category: 'alert',
          title: 'Pre-authorization expiring in 24 hours',
          body: 'Patient claim pre-auth expires soon. Expedite document submission.',
        },
      },
      {
        module: 'billing',
        rule_name: 'High-Value Claim Missing Docs',
        trigger_type: 'claim_created',
        condition: { field: 'claim_amount', operator: 'greater_than', value: 100000 },
        template: {
          severity: 'critical',
          category: 'alert',
          title: 'High-value claim (INR {amount}) lacks supporting documentation',
          body: 'Gather operative notes, bills, discharge summary before TPA submission.',
        },
      },
      // Clinical
      {
        module: 'clinical',
        rule_name: 'NEWS2 Critical Score',
        trigger_type: 'observation_recorded',
        condition: { field: 'news2_score', operator: 'greater_than', value: 5 },
        template: {
          severity: 'critical',
          category: 'alert',
          title: 'NEWS2 score {score} — escalation recommended',
          body: 'Patient vital signs indicate potential deterioration. Review immediately.',
        },
      },
      {
        module: 'clinical',
        rule_name: 'Overdue Lab Result',
        trigger_type: 'lab_order_status',
        condition: { field: 'age_hours', operator: 'greater_than', value: 24 },
        template: {
          severity: 'high',
          category: 'alert',
          title: 'Lab result outstanding for 24+ hours',
          body: 'Follow up with lab. Critical for care decisions.',
        },
      },
      {
        module: 'clinical',
        rule_name: 'Medication Without Allergy Check',
        trigger_type: 'medication_order',
        condition: { field: 'allergy_screened', operator: 'equals', value: false },
        template: {
          severity: 'high',
          category: 'alert',
          title: 'Medication ordered without allergy cross-check',
          body: 'Verify patient allergy history before dispensing.',
        },
      },
      // Quality
      {
        module: 'quality',
        rule_name: 'Incident Not Reviewed',
        trigger_type: 'incident_logged',
        condition: { field: 'age_hours', operator: 'greater_than', value: 48 },
        template: {
          severity: 'high',
          category: 'alert',
          title: 'Incident pending RCA for 48+ hours',
          body: 'Initiate root cause analysis to meet compliance deadlines.',
        },
      },
      {
        module: 'quality',
        rule_name: 'NABH Compliance Below Threshold',
        trigger_type: 'compliance_score_calculated',
        condition: { field: 'compliance_pct', operator: 'less_than', value: 75 },
        template: {
          severity: 'critical',
          category: 'alert',
          title: 'NABH compliance below 75% threshold',
          body: 'Immediate corrective action required. Review chapter gaps.',
        },
      },
      // Operations
      {
        module: 'operations',
        rule_name: 'High Bed Occupancy Alert',
        trigger_type: 'occupancy_calculated',
        condition: { field: 'occupancy_pct', operator: 'greater_than', value: 90 },
        template: {
          severity: 'high',
          category: 'alert',
          title: 'Bed occupancy at {pct}% — capacity strain',
          body: 'Expedite discharges or coordinate transfers to manage capacity.',
        },
      },
      {
        module: 'operations',
        rule_name: 'Pharmacy Stock Below Reorder',
        trigger_type: 'inventory_alert',
        condition: { field: 'stock_level_pct', operator: 'less_than', value: 20 },
        template: {
          severity: 'medium',
          category: 'alert',
          title: 'Pharmacy item "{drug_name}" below reorder threshold',
          body: 'Place purchase order to prevent stockouts.',
        },
      },
      {
        module: 'operations',
        rule_name: 'Discharge Process Delay',
        trigger_type: 'discharge_milestone',
        condition: { field: 'delay_hours', operator: 'greater_than', value: 4 },
        template: {
          severity: 'medium',
          category: 'alert',
          title: 'Discharge delayed 4+ hours beyond plan',
          body: 'Identify bottleneck: billing, docs, or bed turnover.',
        },
      },
    ];

    for (const rule of templateRules) {
      await sql(`
        INSERT INTO ai_template_rules (
          hospital_id,
          module,
          rule_name,
          trigger_type,
          condition_config,
          card_template,
          priority,
          is_active
        )
        SELECT
          (SELECT id FROM hospitals LIMIT 1),
          $1,
          $2,
          $3,
          $4,
          $5,
          'medium',
          TRUE
        ON CONFLICT DO NOTHING
      `, [
        rule.module,
        rule.rule_name,
        rule.trigger_type,
        JSON.stringify(rule.condition),
        JSON.stringify(rule.template),
      ]);
    }
    results.push('Template rules seed (10 rules) ✓');

    return NextResponse.json({
      success: true,
      tables_created: 8,
      seed_batches: 2,
      results,
    });

  } catch (error: any) {
    console.error('[MIGRATION] Even AI error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
