import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.3.1 migration — creates the Role/Tab Model foundation:
 *   1. chart_permission_matrix — per-role chart config (tabs, overview layout,
 *      action-bar preset, sensitive-field list, allowed write actions).
 *   2. chart_audit_log — append-only edit log.
 *   3. chart_view_audit — append-only sensitive-field render log.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS + INSERT … ON CONFLICT DO NOTHING).
 *
 * Seeds 8 role presets (per PRD v2.0 §18 + §23), each applied to every
 * Even-OS role id that buckets into that preset. Per-hospital rows — the
 * seed runs for every hospital row in `hospitals`.
 */

type Preset = {
  tabs: string[];
  overview_layout: string[];
  action_bar_preset: { primary: string[]; secondary: string[] };
  sensitive_fields: string[];
  allowed_write_actions: string[];
  description: string;
};

const PRESETS: Record<string, Preset> = {
  doctor: {
    tabs: ['overview','vitals','labs','orders','notes','plan','journey','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','brief','vitals_snapshot','journey','active_orders','active_meds','problems','allergies','recent_notes','calculators_pinned'],
    action_bar_preset: { primary: ['soap','prescribe','labs','consults'], secondary: ['complaints','handoff'] },
    sensitive_fields: [],
    allowed_write_actions: ['note.create','note.amend','order.place','order.cancel','problem.add','problem.update','vitals.record','plan.update','discharge.initiate','cosign.approve'],
    description: 'Full clinical chart for attending / RMO / consultant / surgeon.',
  },
  charge_nurse: {
    tabs: ['overview','vitals','emar','assessments','notes','orders','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','vitals_snapshot','emar_due','assessments_due','active_orders','active_meds','problems','allergies','handoff_notes'],
    action_bar_preset: { primary: ['record_vitals','administer_med','assessment','handoff'], secondary: ['complaints','escalate'] },
    sensitive_fields: [],
    allowed_write_actions: ['note.create','vitals.record','emar.administer','emar.hold','emar.refuse','assessment.submit','handoff.create','escalation.raise'],
    description: 'Charge nurse oversight chart — NS.5 interface + shift handoff.',
  },
  nurse: {
    tabs: ['overview','vitals','emar','assessments','notes','orders','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','vitals_snapshot','emar_due','assessments_due','active_meds','problems','allergies','recent_notes'],
    action_bar_preset: { primary: ['record_vitals','administer_med','assessment','nursing_note'], secondary: ['complaints'] },
    sensitive_fields: [],
    allowed_write_actions: ['note.create','vitals.record','emar.administer','emar.hold','emar.refuse','assessment.submit'],
    description: 'Ward nurse chart — bedside vitals + eMAR + assessments.',
  },
  pharmacist: {
    tabs: ['overview','orders','vitals','calculators','documents'],
    overview_layout: ['bed_attending','active_meds','allergies','ddi_alerts','dispensing_queue'],
    action_bar_preset: { primary: ['verify_order','dispense','clarify_dose','ddi_check'], secondary: ['complaints'] },
    sensitive_fields: ['diagnosis','notes_snippet'],
    allowed_write_actions: ['medication.verify','medication.dispense','medication.clarify','ddi.resolve'],
    description: 'Pharmacist chart — DDI verify + dispensing queue.',
  },
  lab: {
    tabs: ['overview','labs','calculators','documents'],
    overview_layout: ['bed_attending','lab_orders_pending','critical_values','sample_collection'],
    action_bar_preset: { primary: ['collect_sample','verify_result','flag_critical','batch_accept'], secondary: ['complaints'] },
    sensitive_fields: ['diagnosis','notes_snippet'],
    allowed_write_actions: ['lab.collect','lab.verify','lab.release','critical.flag'],
    description: 'Lab tech chart — order worklist + result verification.',
  },
  cce: {
    tabs: ['overview','brief','documents','billing'],
    overview_layout: ['bed_attending','brief','complaints','comms_threads','bill_summary'],
    action_bar_preset: { primary: ['raise_complaint','create_ticket','contact_family','log_visit'], secondary: [] },
    sensitive_fields: ['diagnosis','notes_snippet','procedures','mlc_reason','medications','allergies'],
    allowed_write_actions: ['complaint.raise','ticket.create','visit.log','note.cce'],
    description: 'Customer care / reception chart — top-line only + comms + complaints + bill. Appointments dropped per PRD §27.1.',
  },
  billing: {
    tabs: ['overview','billing','journey','documents'],
    overview_layout: ['bed_attending','bill_summary','insurance_status','tpa_queries','preauth_status','package_status'],
    action_bar_preset: { primary: ['generate_bill','apply_adjustment','submit_preauth','raise_query'], secondary: ['complaints'] },
    sensitive_fields: ['diagnosis','procedures','notes_snippet'],
    allowed_write_actions: ['bill.generate','bill.adjust','preauth.submit','enhancement.submit','query.raise','refund.initiate'],
    description: 'Billing chart — encounter charges + insurance + TPA workflow.',
  },
  admin: {
    tabs: ['overview','vitals','labs','orders','notes','plan','emar','assessments','billing','journey','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','brief','vitals_snapshot','journey','active_orders','active_meds','problems','allergies','recent_notes','bill_summary','audit_badge','edit_lock_state'],
    action_bar_preset: { primary: ['admin_overlay','edit_lock_toggle','audit_trail','export_mrd'], secondary: ['complaints'] },
    sensitive_fields: [],
    allowed_write_actions: ['admin.override','edit_lock.toggle','audit.review','export.mrd'],
    description: 'Admin / HOD / super_admin chart — all tabs visible, audit overlay, edit-lock toggle.',
  },
};

const ROLE_TO_PRESET: Record<string, keyof typeof PRESETS> = {
  // Doctor preset
  'resident': 'doctor',
  'senior_resident': 'doctor',
  'intern': 'doctor',
  'visiting_consultant': 'doctor',
  'hospitalist': 'doctor',
  'consultant': 'doctor',
  'senior_consultant': 'doctor',
  'specialist_cardiologist': 'doctor',
  'specialist_neurologist': 'doctor',
  'specialist_orthopedic': 'doctor',
  'surgeon': 'doctor',
  'anaesthetist': 'doctor',
  'radiologist': 'doctor',
  'senior_radiologist': 'doctor',
  // Nurse presets
  'nurse': 'nurse',
  'senior_nurse': 'nurse',
  'nursing_manager': 'nurse',
  'ot_nurse': 'nurse',
  'charge_nurse': 'charge_nurse',
  'nursing_supervisor': 'charge_nurse',
  // Pharmacy
  'pharmacist': 'pharmacist',
  'senior_pharmacist': 'pharmacist',
  'chief_pharmacist': 'pharmacist',
  // Lab
  'lab_technician': 'lab',
  'senior_lab_technician': 'lab',
  'lab_manager': 'lab',
  'radiology_technician': 'lab',
  // CCE / Reception
  'ip_coordinator': 'cce',
  'receptionist': 'cce',
  // Billing
  'billing_manager': 'billing',
  'billing_executive': 'billing',
  'insurance_coordinator': 'billing',
  // Admin / HOD / Medical leadership
  'super_admin': 'admin',
  'hospital_admin': 'admin',
  'operations_manager': 'admin',
  'department_head': 'admin',
  'medical_director': 'admin',
};

export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. chart_permission_matrix ──────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_permission_matrix (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        role                  text NOT NULL,
        role_tag              text NULL,
        hospital_id           text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        tabs                  text[] NOT NULL,
        overview_layout       jsonb NOT NULL DEFAULT '[]'::jsonb,
        action_bar_preset     jsonb NOT NULL DEFAULT '{}'::jsonb,
        sensitive_fields      text[] NOT NULL DEFAULT '{}'::text[],
        allowed_write_actions text[] NOT NULL DEFAULT '{}'::text[],
        description           text NULL,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_chart_perm_role ON chart_permission_matrix (role, COALESCE(role_tag, ''), hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_perm_hospital ON chart_permission_matrix (hospital_id)`;
    steps.push('CREATE TABLE chart_permission_matrix + 2 indexes');

    // ── 2. chart_audit_log ──────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_audit_log (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        encounter_id    uuid NULL REFERENCES encounters(id) ON DELETE SET NULL,
        hospital_id     text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        user_id         uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        user_role       text NOT NULL,
        action          text NOT NULL,
        resource_type   text NOT NULL,
        resource_id     uuid NULL,
        payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_audit_patient ON chart_audit_log (patient_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_audit_user ON chart_audit_log (user_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_audit_hospital ON chart_audit_log (hospital_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_audit_action ON chart_audit_log (action, created_at)`;
    steps.push('CREATE TABLE chart_audit_log + 4 indexes');

    // ── 3. chart_view_audit ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_view_audit (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        hospital_id    text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        user_id        uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        user_role      text NOT NULL,
        field_name     text NOT NULL,
        tab_id         text NULL,
        access_reason  text NULL,
        created_at     timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_view_patient ON chart_view_audit (patient_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_view_user ON chart_view_audit (user_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_chart_view_field ON chart_view_audit (field_name, created_at)`;
    steps.push('CREATE TABLE chart_view_audit + 3 indexes');

    // ── 4. Seed chart_permission_matrix for every (role, hospital) pair ─────
    const hosp = (await sql`SELECT hospital_id FROM hospitals`) as Array<{ hospital_id: string }>;

    let seededCount = 0;
    for (const h of hosp) {
      for (const [role, presetKey] of Object.entries(ROLE_TO_PRESET)) {
        const p = PRESETS[presetKey];
        const ins = (await sql`
          INSERT INTO chart_permission_matrix
            (role, role_tag, hospital_id, tabs, overview_layout, action_bar_preset,
             sensitive_fields, allowed_write_actions, description)
          VALUES (
            ${role}, NULL, ${h.hospital_id},
            ${p.tabs as any}::text[],
            ${JSON.stringify(p.overview_layout)}::jsonb,
            ${JSON.stringify(p.action_bar_preset)}::jsonb,
            ${p.sensitive_fields as any}::text[],
            ${p.allowed_write_actions as any}::text[],
            ${p.description}
          )
          ON CONFLICT (role, COALESCE(role_tag, ''), hospital_id) DO NOTHING
          RETURNING id
        `) as Array<{ id: string }>;
        if (ins.length > 0) seededCount += 1;
      }
    }
    steps.push(`seeded ${seededCount} matrix rows across ${hosp.length} hospital(s)`);

    // Verify
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('chart_permission_matrix','chart_audit_log','chart_view_audit')
    `) as Array<{ column_name: string }>;
    const matrixCount = (await sql`SELECT count(*)::int AS n FROM chart_permission_matrix`) as Array<{ n: number }>;
    steps.push(`verified ${cols.length} columns across 3 tables; matrix has ${matrixCount[0].n} rows`);

    return NextResponse.json({ ok: true, steps });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message, steps }, { status: 500 });
  }
}
