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
      CREATE TYPE journey_type AS ENUM ('elective_surgical', 'emergency', 'day_care', 'medical');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum journey_type ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE journey_phase AS ENUM (
        'PHASE_1_PRE_ADMISSION', 'PHASE_2_ADMISSION', 'PHASE_3_CLINICAL_ASSESSMENT',
        'PHASE_4_PRE_OP', 'PHASE_5_INTRA_OP', 'PHASE_6_POST_OP',
        'PHASE_7_WARD_CARE', 'PHASE_8_DISCHARGE', 'PHASE_9_BILLING_CLOSURE'
      );
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum journey_phase ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE journey_step_status AS ENUM ('pending', 'in_progress', 'completed', 'blocked', 'skipped', 'not_applicable');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum journey_step_status ready');

    await sql(`DO $$ BEGIN
      CREATE TYPE journey_notification_type AS ENUM ('step_assigned', 'step_completed', 'tat_warning', 'tat_exceeded', 'escalation');
    EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('enum journey_notification_type ready');

    // ── Tables ─────────────────────────────────────────────────────

    await sql(`CREATE TABLE IF NOT EXISTS journey_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      journey_type journey_type NOT NULL,
      phase journey_phase NOT NULL,
      step_number TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_description TEXT,
      owner_role TEXT NOT NULL,
      tat_target_mins INTEGER,
      preconditions JSONB,
      is_required BOOLEAN NOT NULL DEFAULT true,
      is_auto_advance BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    results.push('table journey_templates ready');

    await sql(`CREATE TABLE IF NOT EXISTS patient_journey_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
      template_step_id UUID REFERENCES journey_templates(id) ON DELETE SET NULL,
      phase journey_phase NOT NULL,
      step_number TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status journey_step_status NOT NULL DEFAULT 'pending',
      owner_role TEXT NOT NULL,
      owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      tat_target_mins INTEGER,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      tat_actual_mins INTEGER,
      blocked_reason TEXT,
      skipped_reason TEXT,
      step_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    results.push('table patient_journey_steps ready');

    await sql(`CREATE TABLE IF NOT EXISTS journey_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
      step_number TEXT NOT NULL,
      step_name TEXT NOT NULL,
      recipient_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      recipient_role TEXT,
      notification_type journey_notification_type NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    results.push('table journey_notifications ready');

    await sql(`CREATE TABLE IF NOT EXISTS journey_escalations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
      step_number TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_id UUID REFERENCES patient_journey_steps(id) ON DELETE CASCADE,
      escalation_level INTEGER NOT NULL DEFAULT 1,
      escalated_to_role TEXT NOT NULL,
      escalated_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      resolved_at TIMESTAMPTZ,
      resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    results.push('table journey_escalations ready');

    // ── Indexes ────────────────────────────────────────────────────

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_journey_templates_hospital ON journey_templates(hospital_id)',
      'CREATE INDEX IF NOT EXISTS idx_journey_templates_type ON journey_templates(journey_type)',
      'CREATE INDEX IF NOT EXISTS idx_journey_templates_sort ON journey_templates(hospital_id, journey_type, sort_order)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_hospital ON patient_journey_steps(hospital_id)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_patient ON patient_journey_steps(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_encounter ON patient_journey_steps(encounter_id)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_status ON patient_journey_steps(status)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_owner_role ON patient_journey_steps(owner_role)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_owner_user ON patient_journey_steps(owner_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_pjs_phase_step ON patient_journey_steps(hospital_id, patient_id, phase, step_number)',
      'CREATE INDEX IF NOT EXISTS idx_jn_recipient ON journey_notifications(recipient_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_jn_unread ON journey_notifications(recipient_user_id, read_at)',
      'CREATE INDEX IF NOT EXISTS idx_jn_patient ON journey_notifications(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_je_step ON journey_escalations(step_id)',
      'CREATE INDEX IF NOT EXISTS idx_je_unresolved ON journey_escalations(hospital_id, resolved_at)',
    ];

    for (const idx of indexes) {
      await sql(idx);
    }
    results.push(`${indexes.length} indexes created`);

    // ── Add journey columns to encounters (nullable, additive) ────

    try {
      await sql(`ALTER TABLE encounters ADD COLUMN IF NOT EXISTS journey_type journey_type`);
      results.push('column encounters.journey_type added');
    } catch {
      results.push('column encounters.journey_type already exists or skipped');
    }

    // ── Add journey tracking columns to patients (nullable, additive) ──

    try {
      await sql(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS journey_current_phase journey_phase`);
      await sql(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS journey_current_step TEXT`);
      results.push('columns patients.journey_current_phase + journey_current_step added');
    } catch {
      results.push('patient journey columns already exist or skipped');
    }

    // ── Seed: Elective Surgical Journey Template (45 steps) ───────
    // Mapped from EHRC IP Process Owner Map (March 2026)
    // Each step has: phase, step_number, step_name, description, owner_role, tat_target_mins

    const hospitalId = user.hospital_id;

    // Check if already seeded
    const existing = await sql(`SELECT COUNT(*) as count FROM journey_templates WHERE hospital_id = '${hospitalId}' AND journey_type = 'elective_surgical'`);
    const alreadySeeded = Number(existing[0]?.count) > 0;

    if (!alreadySeeded) {
      const steps = [
        // ── PHASE 1: PRE-ADMISSION & BOOKING ──
        { phase: 'PHASE_1_PRE_ADMISSION', num: '1.1', name: 'Financial Counselling Call', desc: 'Counselor discusses procedure, estimated cost, room tariff, insurance coverage with patient/family.', role: 'receptionist', tat: 60, sort: 1 },
        { phase: 'PHASE_1_PRE_ADMISSION', num: '1.2', name: 'Financial Estimation Sheet', desc: 'Generate printable Financial Estimation Sheet. Held at admissions for patient signature on arrival.', role: 'ip_coordinator', tat: 60, sort: 2 },
        { phase: 'PHASE_1_PRE_ADMISSION', num: '1.3', name: 'OT Slot Booking', desc: 'Surgeon confirms surgery, OT slot blocked. Elective list finalized 24 hrs before procedure.', role: 'ip_coordinator', tat: 1440, sort: 3 },
        { phase: 'PHASE_1_PRE_ADMISSION', num: '1.4', name: 'PAC Scheduling', desc: 'Pre-anaesthetic checkup arranged with anaesthetist. Investigations ordered. Must precede admission.', role: 'anaesthetist', tat: 10080, sort: 4 },
        { phase: 'PHASE_1_PRE_ADMISSION', num: '1.5', name: 'Insurance Pre-Authorization', desc: 'Verify coverage, submit pre-auth to TPA, obtain GOP or pre-auth letter.', role: 'billing_manager', tat: 2880, sort: 5 },

        // ── PHASE 2: ADMISSION ──
        { phase: 'PHASE_2_ADMISSION', num: '2.1', name: 'Patient Arrival & Triage', desc: 'Greet patient. Emergency check. If elective, proceed to registration.', role: 'receptionist', tat: 5, sort: 6 },
        { phase: 'PHASE_2_ADMISSION', num: '2.2', name: 'UHID Search / Generation', desc: 'Search HIS for existing UHID. If not found, create new registration.', role: 'receptionist', tat: 5, sort: 7 },
        { phase: 'PHASE_2_ADMISSION', num: '2.3', name: 'Demographics & Wristband', desc: 'Capture demographics, issue ID wristband with UHID.', role: 'receptionist', tat: 5, sort: 8 },
        { phase: 'PHASE_2_ADMISSION', num: '2.4', name: 'Admission Advice Verification', desc: 'Verify written Admission Advice from consultant. Confirm procedure and doctor.', role: 'ip_coordinator', tat: 10, sort: 9 },
        { phase: 'PHASE_2_ADMISSION', num: '2.5', name: 'Room Allocation & Tariff', desc: 'Allocate bed based on preference, availability, clinical need. Explain tariff. Patient signs estimation.', role: 'receptionist', tat: 15, sort: 10 },
        { phase: 'PHASE_2_ADMISSION', num: '2.6', name: 'Consent Documentation', desc: 'General consent, procedure-specific informed consent, anaesthesia consent. Patient Rights leaflet.', role: 'ip_coordinator', tat: 20, sort: 11 },
        { phase: 'PHASE_2_ADMISSION', num: '2.7', name: 'Ward Intimation & Bed Prep', desc: 'Inform ward charge nurse of incoming patient. Housekeeping prepares bed.', role: 'receptionist', tat: 5, sort: 12 },
        { phase: 'PHASE_2_ADMISSION', num: '2.8', name: 'Patient Transport to Ward', desc: 'GDA escorts patient to ward with file. Nurse receives at bedside.', role: 'receptionist', tat: 10, sort: 13 },

        // ── PHASE 3: INITIAL CLINICAL ASSESSMENT ──
        { phase: 'PHASE_3_CLINICAL_ASSESSMENT', num: '3.1', name: 'Nursing Admission Assessment', desc: 'Vitals, fall risk, nutritional screening, pain score, ADL, allergy check. Nursing Assessment Tool.', role: 'nurse', tat: 30, sort: 14 },
        { phase: 'PHASE_3_CLINICAL_ASSESSMENT', num: '3.2', name: 'Medical Initial Assessment', desc: 'History, physical exam, vitals, drug allergies, medication reconciliation, provisional diagnosis, plan of care.', role: 'resident', tat: 1440, sort: 15 },
        { phase: 'PHASE_3_CLINICAL_ASSESSMENT', num: '3.3', name: 'Care Plan & Countersign', desc: 'Plan of Care documented. Consultant countersigns RMO assessment within 24 hrs. Special needs identified.', role: 'visiting_consultant', tat: 1440, sort: 16 },
        { phase: 'PHASE_3_CLINICAL_ASSESSMENT', num: '3.4', name: 'Patient ID on Nursing Board', desc: 'Patient name, UHID, Primary Consultant updated on Patient Information Board at Nursing Station.', role: 'charge_nurse', tat: 15, sort: 17 },

        // ── PHASE 4: PRE-OPERATIVE WORKUP ──
        { phase: 'PHASE_4_PRE_OP', num: '4.1', name: 'Pre-Op Investigations Completed', desc: 'CBC, coag, metabolic, ECG, echo, specialist clearances. Abnormal results flagged to anaesthetist.', role: 'resident', tat: 1440, sort: 18 },
        { phase: 'PHASE_4_PRE_OP', num: '4.2', name: 'PAC Clearance & Fitness', desc: 'Anaesthetist reviews results, assigns ASA grade, documents plan. Issues formal PAC clearance.', role: 'anaesthetist', tat: 1440, sort: 19 },
        { phase: 'PHASE_4_PRE_OP', num: '4.3', name: 'Surgical Financial Clearance', desc: 'Billing confirms clearance. Insurance: pre-auth confirmed. Cash: advance collected. OT Clearance Slip issued.', role: 'billing_manager', tat: 120, sort: 20 },
        { phase: 'PHASE_4_PRE_OP', num: '4.4', name: 'Pre-Op Checklist Completion', desc: 'Consents signed, NPO confirmed, pre-op meds given, jewelry removed, site marked, wristbands confirmed.', role: 'nurse', tat: 60, sort: 21 },
        { phase: 'PHASE_4_PRE_OP', num: '4.5', name: 'OT Case List Confirmation', desc: 'OT Coordinator confirms final case list with all surgeons. Changes communicated. Sequence and times shared.', role: 'ip_coordinator', tat: 1440, sort: 22 },

        // ── PHASE 5: INTRA-OPERATIVE ──
        { phase: 'PHASE_5_INTRA_OP', num: '5.1', name: 'Patient Receiving in Pre-Op', desc: 'OT nurse verifies 2 IDs, file completeness, NPO, all consents, OT Clearance Slip. Pre-op medications.', role: 'nurse', tat: 30, sort: 23 },
        { phase: 'PHASE_5_INTRA_OP', num: '5.2', name: 'Anaesthesia Induction', desc: 'IV access, monitoring attached (SpO2, ECG, NIBP, capnography). Anaesthesia record started.', role: 'anaesthetist', tat: 30, sort: 24 },
        { phase: 'PHASE_5_INTRA_OP', num: '5.3', name: 'WHO Time-Out', desc: 'All team confirm: patient ID, procedure, site, personnel ready, critical steps, blood, allergies. Documented.', role: 'nurse', tat: 5, sort: 25 },
        { phase: 'PHASE_5_INTRA_OP', num: '5.4', name: 'Surgical Procedure', desc: 'Surgeon performs procedure. Counts documented. Implants/specimens labeled. Complications documented.', role: 'surgeon', tat: 360, sort: 26 },
        { phase: 'PHASE_5_INTRA_OP', num: '5.5', name: 'Sign-Out & Specimen Dispatch', desc: 'Count confirmed. Specimen labeled and sent to lab. OT notes completed. Terminal cleaning initiated.', role: 'nurse', tat: 15, sort: 27 },
        { phase: 'PHASE_5_INTRA_OP', num: '5.6', name: 'Transfer to Recovery (PACU)', desc: 'Patient to recovery with ongoing monitoring. Anaesthetist hands over to recovery nurse via SBAR.', role: 'anaesthetist', tat: 10, sort: 28 },

        // ── PHASE 6: POST-OPERATIVE CARE ──
        { phase: 'PHASE_6_POST_OP', num: '6.1', name: 'Recovery Monitoring (Aldrete)', desc: 'Monitor vitals, consciousness (Aldrete Score), pain, nausea, bleeding. Aldrete >= 9 for ward transfer.', role: 'nurse', tat: 60, sort: 29 },
        { phase: 'PHASE_6_POST_OP', num: '6.2', name: 'Transfer to Ward & Handover', desc: 'On Aldrete >= 9: transfer to ward. Recovery nurse gives SBAR to ward nurse. Transfer checklist completed.', role: 'nurse', tat: 15, sort: 30 },
        { phase: 'PHASE_6_POST_OP', num: '6.3', name: 'Post-Op Nursing Assessment', desc: 'Vitals per post-op orders, wound inspection, drain output, pain score, urine output, MEWS calculated.', role: 'nurse', tat: 60, sort: 31 },
        { phase: 'PHASE_6_POST_OP', num: '6.4', name: 'Surgeon & Anaesthetist Review', desc: 'Primary surgeon and anaesthetist review within 24 hrs. Wound check, drain, pain mgmt, post-op orders.', role: 'visiting_consultant', tat: 1440, sort: 32 },

        // ── PHASE 7: ONGOING WARD CARE ──
        { phase: 'PHASE_7_WARD_CARE', num: '7.1', name: 'Daily Consultant Rounds', desc: 'Primary consultant reviews daily. Documents response to treatment, modifies care plan.', role: 'visiting_consultant', tat: 1440, sort: 33 },
        { phase: 'PHASE_7_WARD_CARE', num: '7.2', name: 'RMO Rounds & Shift Coverage', desc: 'Duty RMO reviews all IP patients each shift. Responds to nursing calls, orders investigations, escalates.', role: 'resident', tat: 480, sort: 34 },
        { phase: 'PHASE_7_WARD_CARE', num: '7.3', name: 'Vital Signs & MEWS Monitoring', desc: 'Nurses record vitals per protocol. MEWS calculated. Score 5+: trigger Code Blue / call Consultant.', role: 'nurse', tat: 240, sort: 35 },
        { phase: 'PHASE_7_WARD_CARE', num: '7.4', name: 'Medication Administration', desc: 'Nurse administers per prescription. Five rights checked. High-alert meds double-checked. ADR documented.', role: 'nurse', tat: 480, sort: 36 },
        { phase: 'PHASE_7_WARD_CARE', num: '7.5', name: 'Physiotherapy Sessions', desc: 'Physio reviews referral, conducts treatment (mobilization, exercises, chest physio). Documents progress.', role: 'staff', tat: 1440, sort: 37 },
        { phase: 'PHASE_7_WARD_CARE', num: '7.6', name: 'Nutritional Assessment & Diet', desc: 'Dietitian screening, dietary requirements, diet orders. Within 24-48 hrs of admission.', role: 'staff', tat: 2880, sort: 38 },
        { phase: 'PHASE_7_WARD_CARE', num: '7.7', name: 'Shift Handover (SBAR)', desc: 'Nursing handover at bedside. RMO handover in duty room. Both documented. Covers pending items.', role: 'charge_nurse', tat: 480, sort: 39 },

        // ── PHASE 8: DISCHARGE & EXIT ──
        { phase: 'PHASE_8_DISCHARGE', num: '8.1', name: 'Discharge Planning Initiation', desc: 'Begins 24-48 hrs after admission. Consultant discusses DC date, post-DC needs, financial implications.', role: 'visiting_consultant', tat: 2880, sort: 40 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.2', name: 'Discharge Order', desc: 'Consultant writes formal Discharge Order: diagnosis, procedures, follow-up, red flags, medication reconciliation.', role: 'visiting_consultant', tat: 60, sort: 41 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.3', name: 'Discharge Summary Preparation', desc: 'RMO/Consultant prepares DC summary: reason, findings, procedures, treatment, follow-up, med list.', role: 'resident', tat: 120, sort: 42 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.4', name: 'Final Bill & Settlement', desc: 'Billing prepares itemized final bill. Cash: settle <2h. TPA: submit claim, advance adjusted <4h.', role: 'billing_manager', tat: 240, sort: 43 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.5', name: 'Discharge Medications Dispensed', desc: 'Pharmacy dispenses, labels, counsels on dosage/schedule/storage. Cross-checked against DC summary.', role: 'pharmacist', tat: 60, sort: 44 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.6', name: 'Nursing Discharge Education', desc: 'Wound care, activity restrictions, diet, red-flag symptoms, follow-up date. Signed instruction sheet.', role: 'nurse', tat: 30, sort: 45 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.7', name: 'Patient Exit & Report Handover', desc: 'Patient signs acknowledgement. Exit recorded. Wristband removed. GDA escorts to exit.', role: 'ip_coordinator', tat: 15, sort: 46 },
        { phase: 'PHASE_8_DISCHARGE', num: '8.8', name: 'Terminal Cleaning', desc: 'Housekeeping notified immediately upon exit. Terminal cleaning per IPC protocol before next admission.', role: 'housekeeping_supervisor', tat: 30, sort: 47 },

        // ── PHASE 9: BILLING & DOCUMENTATION CLOSURE ──
        { phase: 'PHASE_9_BILLING_CLOSURE', num: '9.1', name: 'TPA Claims Submission', desc: 'Compile claims package (final bill, DC summary, reports, pre-auth). Submit to TPA within TAT.', role: 'billing_manager', tat: 4320, sort: 48 },
        { phase: 'PHASE_9_BILLING_CLOSURE', num: '9.2', name: 'Medical Records Closure', desc: 'Complete IP file compiled and archived. ICD-10 coded. Retention policy applied.', role: 'staff', tat: 1440, sort: 49 },
        { phase: 'PHASE_9_BILLING_CLOSURE', num: '9.3', name: 'Follow-Up Appointment Booking', desc: 'Follow-up booked before exit or within 24 hrs. Entered in system. OPD team notified.', role: 'receptionist', tat: 1440, sort: 50 },
      ];

      for (const s of steps) {
        await sql(`INSERT INTO journey_templates (hospital_id, journey_type, phase, step_number, step_name, step_description, owner_role, tat_target_mins, is_required, is_auto_advance, sort_order)
          VALUES ('${hospitalId}', 'elective_surgical', '${s.phase}', '${s.num}', '${s.name.replace(/'/g, "''")}', '${s.desc.replace(/'/g, "''")}', '${s.role}', ${s.tat}, true, ${s.sort <= 13 ? 'true' : 'false'}, ${s.sort})`);
      }
      results.push(`seeded ${steps.length} elective surgical journey steps`);
    } else {
      results.push(`journey template already seeded (${existing[0]?.count} steps exist)`);
    }

    return NextResponse.json({
      success: true,
      results,
      summary: {
        tables: 4,
        indexes: 15,
        enums: 4,
        seed_steps: alreadySeeded ? 'already seeded' : 50,
        columns_added: ['encounters.journey_type', 'patients.journey_current_phase', 'patients.journey_current_step'],
      },
    });
  } catch (error: any) {
    console.error('Journey Engine migration error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
