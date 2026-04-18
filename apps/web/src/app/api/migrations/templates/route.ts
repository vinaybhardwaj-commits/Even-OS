import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    // ── Create enums ──────────────────────────────────────────────────
    await sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_category') THEN
        CREATE TYPE template_category AS ENUM ('discharge', 'operative', 'handoff', 'admission', 'assessment', 'consent', 'nursing', 'progress', 'consultation', 'referral', 'custom');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_scope') THEN
        CREATE TYPE template_scope AS ENUM ('system', 'department', 'personal');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_suggestion_type') THEN
        CREATE TYPE template_suggestion_type AS ENUM ('new_field', 'default_change', 'section_reorder', 'field_removal', 'field_type_change');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_suggestion_status') THEN
        CREATE TYPE template_suggestion_status AS ENUM ('pending', 'accepted', 'rejected', 'expired');
      END IF;
    END $$`;

    // ── Create tables ─────────────────────────────────────────────────
    await sql`CREATE TABLE IF NOT EXISTS clinical_templates (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      template_name TEXT NOT NULL,
      template_description TEXT,
      template_category template_category NOT NULL,
      template_scope template_scope DEFAULT 'personal' NOT NULL,
      template_department_id UUID,
      template_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      applicable_roles JSONB DEFAULT '[]'::jsonb,
      applicable_encounter_types JSONB DEFAULT '[]'::jsonb,
      template_fields JSONB DEFAULT '[]'::jsonb NOT NULL,
      template_default_values JSONB DEFAULT '{}'::jsonb,
      ai_generation_prompt TEXT,
      template_version INTEGER DEFAULT 1 NOT NULL,
      template_is_active BOOLEAN DEFAULT true NOT NULL,
      template_is_locked BOOLEAN DEFAULT false NOT NULL,
      forked_from_id UUID,
      template_tags JSONB DEFAULT '[]'::jsonb,
      template_usage_count INTEGER DEFAULT 0 NOT NULL,
      template_last_used_at TIMESTAMP,
      template_created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      template_created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      template_updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`;

    await sql`CREATE TABLE IF NOT EXISTS clinical_template_versions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ctv_template_id UUID NOT NULL REFERENCES clinical_templates(id) ON DELETE CASCADE,
      ctv_version_number INTEGER NOT NULL,
      ctv_fields JSONB NOT NULL,
      ctv_default_values JSONB DEFAULT '{}'::jsonb,
      ctv_change_summary TEXT,
      ctv_changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      ctv_created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`;

    await sql`CREATE TABLE IF NOT EXISTS clinical_template_usage_log (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ctul_template_id UUID NOT NULL REFERENCES clinical_templates(id) ON DELETE CASCADE,
      ctul_template_version INTEGER NOT NULL,
      ctul_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      ctul_patient_id UUID,
      ctul_encounter_id UUID,
      ctul_filled_data JSONB DEFAULT '{}'::jsonb,
      ctul_completion_time_seconds INTEGER,
      ctul_fields_modified JSONB DEFAULT '[]'::jsonb,
      ctul_fields_skipped JSONB DEFAULT '[]'::jsonb,
      ctul_created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`;

    await sql`CREATE TABLE IF NOT EXISTS clinical_template_ai_suggestions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      ctas_template_id UUID NOT NULL REFERENCES clinical_templates(id) ON DELETE CASCADE,
      ctas_suggestion_type template_suggestion_type NOT NULL,
      ctas_suggestion_data JSONB NOT NULL,
      ctas_confidence_score NUMERIC(5,4),
      ctas_supporting_evidence JSONB DEFAULT '{}'::jsonb,
      ctas_status template_suggestion_status DEFAULT 'pending' NOT NULL,
      ctas_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ctas_reviewed_at TIMESTAMP,
      ctas_created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`;

    // ── Create indexes ────────────────────────────────────────────────
    await sql`CREATE INDEX IF NOT EXISTS idx_ct_hospital ON clinical_templates(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ct_category ON clinical_templates(template_category)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ct_scope ON clinical_templates(template_scope)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ct_owner ON clinical_templates(template_owner_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ct_active ON clinical_templates(template_is_active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctv_template ON clinical_template_versions(ctv_template_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctul_template ON clinical_template_usage_log(ctul_template_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctul_user ON clinical_template_usage_log(ctul_user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctas_template ON clinical_template_ai_suggestions(ctas_template_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctas_status ON clinical_template_ai_suggestions(ctas_status)`;

    // ── Seed 20 pre-built templates ───────────────────────────────────
    // Get first super_admin user for created_by
    const adminRows = await sql`SELECT id FROM users WHERE 'super_admin' = ANY(roles) LIMIT 1`;
    const adminId = (adminRows as any[])?.[0]?.id;
    if (!adminId) {
      return NextResponse.json({ status: 'tables_created', templates_seeded: 0, note: 'No super_admin user found for seeding' });
    }

    // Get hospital_id
    const hospitalRows = await sql`SELECT hospital_id FROM hospitals LIMIT 1`;
    const hospitalId = (hospitalRows as any[])?.[0]?.hospital_id;
    if (!hospitalId) {
      return NextResponse.json({ status: 'tables_created', templates_seeded: 0, note: 'No hospital found for seeding' });
    }

    // Check if already seeded
    const existing = await sql`SELECT COUNT(*)::int AS count FROM clinical_templates WHERE hospital_id = ${hospitalId}`;
    if ((existing as any[])?.[0]?.count > 0) {
      return NextResponse.json({ status: 'ok', templates_seeded: 0, note: 'Already seeded' });
    }

    const templates = getPreBuiltTemplates();
    let seeded = 0;
    for (const tpl of templates) {
      const id = crypto.randomUUID();
      await sql`
        INSERT INTO clinical_templates (
          id, hospital_id, template_name, template_description, template_category,
          template_scope, applicable_roles, applicable_encounter_types,
          template_fields, template_default_values,
          template_version, template_is_active, template_is_locked,
          template_tags, template_usage_count,
          template_created_by, template_created_at, template_updated_at
        ) VALUES (
          ${id}, ${hospitalId}, ${tpl.name}, ${tpl.description}, ${tpl.category},
          'system', ${JSON.stringify(tpl.roles)}::jsonb, ${JSON.stringify(tpl.encounterTypes)}::jsonb,
          ${JSON.stringify(tpl.fields)}::jsonb, '{}'::jsonb,
          1, true, true,
          ${JSON.stringify(tpl.tags)}::jsonb, 0,
          ${adminId}::uuid, NOW(), NOW()
        )
      `;
      // Create v1 snapshot
      await sql`
        INSERT INTO clinical_template_versions (id, ctv_template_id, ctv_version_number, ctv_fields, ctv_change_summary, ctv_changed_by)
        VALUES (gen_random_uuid(), ${id}, 1, ${JSON.stringify(tpl.fields)}::jsonb, 'Pre-built template', ${adminId}::uuid)
      `;
      seeded++;
    }

    return NextResponse.json({ status: 'ok', tables_created: 4, indexes_created: 10, templates_seeded: seeded });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── Pre-built template definitions ──────────────────────────────────────────
function getPreBuiltTemplates() {
  const f = (id: string, type: string, label: string, order: number, opts?: any) => ({
    id, type, label, order, required: opts?.required ?? false,
    placeholder: opts?.placeholder, auto_populate_from: opts?.auto_from,
    options: opts?.options, ai_hint: opts?.ai_hint,
  });

  return [
    // ── DISCHARGE (5) ─────────────────────────────────────────────────
    { name: 'General Discharge Summary', description: 'Standard discharge summary for all IPD patients', category: 'discharge', roles: ['resident','senior_resident','hospitalist','visiting_consultant'], encounterTypes: ['ipd'], tags: ['discharge','standard'],
      fields: [
        f('d1','patient_data_auto','Patient Information',1,{auto_from:'patient.name',required:true}),
        f('d2','patient_data_auto','Admission Date',2,{auto_from:'encounter.admission_date'}),
        f('d3','patient_data_auto','Primary Diagnosis',3,{auto_from:'encounter.primary_diagnosis',required:true}),
        f('d4','textarea','Course in Hospital',4,{required:true,placeholder:'Describe the clinical course...',ai_hint:'Summarize hospital stay based on notes and vitals'}),
        f('d5','textarea','Condition at Discharge',5,{required:true,placeholder:'Stable / Improved / Against medical advice'}),
        f('d6','medication_list','Discharge Medications',6,{auto_from:'meds.discharge'}),
        f('d7','textarea','Follow-up Instructions',7,{required:true,placeholder:'Follow-up date, investigations...'}),
        f('d8','textarea','Warning Signs',8,{placeholder:'When to return to hospital...'}),
        f('d9','signature','Discharging Doctor',9,{required:true}),
      ]},
    { name: 'Surgical Discharge', description: 'Post-surgical discharge with wound care', category: 'discharge', roles: ['surgeon','resident','senior_resident'], encounterTypes: ['ipd'], tags: ['discharge','surgical'],
      fields: [
        f('sd1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('sd2','patient_data_auto','Procedure Performed',2,{auto_from:'procedures.performed',required:true}),
        f('sd3','textarea','Operative Summary',3,{required:true,ai_hint:'Brief operative findings'}),
        f('sd4','textarea','Wound Care Instructions',4,{required:true,placeholder:'Dressing changes, suture removal date...'}),
        f('sd5','textarea','Activity Restrictions',5,{placeholder:'Weight bearing, driving, return to work...'}),
        f('sd6','checkbox','Drain in situ',6),
        f('sd7','textarea','Drain Care Instructions',7,{placeholder:'If drain present...',conditional_on:{field_id:'sd6',value:true}}),
        f('sd8','medication_list','Medications',8,{auto_from:'meds.discharge'}),
        f('sd9','textarea','Follow-up',9,{required:true}),
        f('sd10','signature','Surgeon',10,{required:true}),
      ]},
    { name: 'Cardiac Discharge', description: 'Cardiology discharge with rehab referral', category: 'discharge', roles: ['visiting_consultant','hospitalist','resident'], encounterTypes: ['ipd'], tags: ['discharge','cardiac'],
      fields: [
        f('cd1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('cd2','textarea','Cardiac Diagnosis',2,{required:true}),
        f('cd3','textarea','Course & Interventions',3,{required:true,ai_hint:'Summarize cardiac events and procedures'}),
        f('cd4','medication_list','Cardiac Medications',4,{auto_from:'meds.discharge',required:true}),
        f('cd5','textarea','Diet Instructions',5,{placeholder:'Low salt, low fat...'}),
        f('cd6','checkbox','Cardiac Rehab Referral',6),
        f('cd7','textarea','Exercise Guidelines',7,{placeholder:'Walking program, activity targets...'}),
        f('cd8','date','Follow-up Appointment',8,{required:true}),
        f('cd9','signature','Cardiologist',9,{required:true}),
      ]},
    { name: 'Pediatric Discharge', description: 'Pediatric discharge with growth milestones', category: 'discharge', roles: ['resident','senior_resident','visiting_consultant'], encounterTypes: ['ipd'], tags: ['discharge','pediatric'],
      fields: [
        f('pd1','patient_data_auto','Child Name',1,{auto_from:'patient.name',required:true}),
        f('pd2','patient_data_auto','Age',2,{auto_from:'patient.age'}),
        f('pd3','textarea','Diagnosis & Course',3,{required:true}),
        f('pd4','medication_list','Medications',4,{auto_from:'meds.discharge'}),
        f('pd5','textarea','Feeding Instructions',5,{placeholder:'Breastfeeding, formula, diet...'}),
        f('pd6','textarea','Growth & Development Notes',6),
        f('pd7','checkbox_group','Vaccinations Due',7,{options:['DPT','OPV','MMR','Hepatitis B','Other']}),
        f('pd8','textarea','Parent Education',8,{required:true,placeholder:'Warning signs, when to return...'}),
        f('pd9','date','Follow-up',9,{required:true}),
        f('pd10','signature','Pediatrician',10,{required:true}),
      ]},
    { name: 'Day Surgery Discharge', description: 'Simplified daycare discharge', category: 'discharge', roles: ['surgeon','resident','anaesthetist'], encounterTypes: ['daycare'], tags: ['discharge','daycare'],
      fields: [
        f('ds1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('ds2','text','Procedure',2,{required:true}),
        f('ds3','textarea','Post-Procedure Instructions',3,{required:true}),
        f('ds4','textarea','Pain Management',4,{placeholder:'Medications, ice, elevation...'}),
        f('ds5','textarea','When to Call',5,{required:true,placeholder:'Fever >101°F, bleeding, severe pain...'}),
        f('ds6','signature','Doctor',6,{required:true}),
      ]},

    // ── OPERATIVE (4) ─────────────────────────────────────────────────
    { name: 'General Operative Note', description: 'Standard operative note', category: 'operative', roles: ['surgeon','resident','senior_resident'], encounterTypes: ['ipd','daycare'], tags: ['operative','general'],
      fields: [
        f('op1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('op2','text','Pre-operative Diagnosis',2,{required:true}),
        f('op3','text','Post-operative Diagnosis',3,{required:true}),
        f('op4','text','Procedure Performed',4,{required:true}),
        f('op5','text','Surgeon',5,{required:true}),
        f('op6','text','Assistants',6),
        f('op7','text','Anaesthesia',7,{required:true}),
        f('op8','textarea','Findings',8,{required:true,ai_hint:'Describe intraoperative findings'}),
        f('op9','textarea','Technique',9,{required:true}),
        f('op10','text','Specimens',10),
        f('op11','numeric','EBL (ml)',11),
        f('op12','textarea','Complications',12,{placeholder:'None / describe...'}),
        f('op13','textarea','Post-op Plan',13,{required:true}),
        f('op14','signature','Surgeon',14,{required:true}),
      ]},
    { name: 'Orthopaedic Op Note', description: 'Ortho-specific with implant details', category: 'operative', roles: ['surgeon','resident'], encounterTypes: ['ipd'], tags: ['operative','ortho'],
      fields: [
        f('oo1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('oo2','text','Procedure',2,{required:true}),
        f('oo3','text','Implant Details',3,{placeholder:'Manufacturer, size, lot number...'}),
        f('oo4','text','Positioning',4),
        f('oo5','text','Tourniquet Time',5),
        f('oo6','textarea','Findings & Technique',6,{required:true}),
        f('oo7','checkbox','C-arm Used',7),
        f('oo8','textarea','ROM Goals',8),
        f('oo9','textarea','Post-op Plan',9,{required:true}),
        f('oo10','signature','Surgeon',10,{required:true}),
      ]},
    { name: 'Laparoscopic Op Note', description: 'Lap-specific with port details', category: 'operative', roles: ['surgeon','resident'], encounterTypes: ['ipd','daycare'], tags: ['operative','laparoscopic'],
      fields: [
        f('lo1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('lo2','text','Procedure',2,{required:true}),
        f('lo3','textarea','Port Placement',3,{required:true,placeholder:'Number, size, location of ports'}),
        f('lo4','text','Insufflation Pressure',4),
        f('lo5','textarea','Findings & Technique',5,{required:true}),
        f('lo6','checkbox','Conversion to Open',6),
        f('lo7','textarea','Conversion Reason',7,{conditional_on:{field_id:'lo6',value:true}}),
        f('lo8','checkbox','Drain Placed',8),
        f('lo9','textarea','Post-op Plan',9,{required:true}),
        f('lo10','signature','Surgeon',10,{required:true}),
      ]},
    { name: 'Emergency Operative Note', description: 'Emergency surgery with timing details', category: 'operative', roles: ['surgeon','resident'], encounterTypes: ['ipd'], tags: ['operative','emergency'],
      fields: [
        f('eo1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('eo2','textarea','Indication for Emergency',2,{required:true}),
        f('eo3','datetime','Decision to Operate',3,{required:true}),
        f('eo4','datetime','Incision Time',4,{required:true}),
        f('eo5','text','Procedure',5,{required:true}),
        f('eo6','textarea','Findings & Technique',6,{required:true}),
        f('eo7','textarea','Intra-op Hemodynamics',7),
        f('eo8','numeric','EBL (ml)',8),
        f('eo9','textarea','Post-op Plan',9,{required:true}),
        f('eo10','signature','Surgeon',10,{required:true}),
      ]},

    // ── HANDOFF (3) ───────────────────────────────────────────────────
    { name: 'SBAR Nursing Handoff', description: 'Standard SBAR nursing shift handoff', category: 'handoff', roles: ['nurse','senior_nurse','charge_nurse'], encounterTypes: ['ipd'], tags: ['handoff','nursing','sbar'],
      fields: [
        f('h1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('h2','textarea','Situation',2,{required:true,ai_hint:'Current status and reason for handoff'}),
        f('h3','textarea','Background',3,{required:true,ai_hint:'Relevant history and context'}),
        f('h4','textarea','Assessment',4,{required:true,ai_hint:'Current clinical assessment'}),
        f('h5','textarea','Recommendation',5,{required:true,ai_hint:'What needs to happen next'}),
        f('h6','textarea','Pending Tasks',6,{placeholder:'Labs due, meds due, procedures...'}),
        f('h7','dropdown','Priority',7,{options:['Routine','Watch','Critical'],required:true}),
        f('h8','signature','Outgoing Nurse',8,{required:true}),
      ]},
    { name: 'Doctor Signout', description: 'Doctor-to-doctor handoff with contingencies', category: 'handoff', roles: ['resident','senior_resident','hospitalist'], encounterTypes: ['ipd'], tags: ['handoff','doctor'],
      fields: [
        f('ds1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('ds2','text','One-liner',2,{required:true,placeholder:'65M CHF exacerbation, improving on diuresis'}),
        f('ds3','textarea','Active Issues',3,{required:true}),
        f('ds4','textarea','If-Then Contingencies',4,{placeholder:'If BP <90 → give NS bolus and call me'}),
        f('ds5','dropdown','Code Status',5,{options:['Full Code','DNR','DNI','Comfort Care'],required:true}),
        f('ds6','textarea','Anticipated Events',6),
        f('ds7','signature','Outgoing Doctor',7,{required:true}),
      ]},
    { name: 'Night Float Handoff', description: 'Cross-cover handoff for night team', category: 'handoff', roles: ['resident','senior_resident'], encounterTypes: ['ipd'], tags: ['handoff','night'],
      fields: [
        f('nf1','section_header','Cross-Cover List',1),
        f('nf2','textarea','Patients & One-liners',2,{required:true,placeholder:'List all patients with brief status'}),
        f('nf3','textarea','Anticipated Events',3,{placeholder:'Expected admissions, pending results...'}),
        f('nf4','textarea','Critical Lab Follow-ups',4),
        f('nf5','textarea','New Admissions Expected',5),
        f('nf6','signature','Outgoing Resident',6,{required:true}),
      ]},

    // ── ASSESSMENT (4) ────────────────────────────────────────────────
    { name: 'Admission Assessment (Nursing)', description: 'Initial nursing assessment on admission', category: 'assessment', roles: ['nurse','senior_nurse','charge_nurse'], encounterTypes: ['ipd'], tags: ['assessment','admission','nursing'],
      fields: [
        f('na1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('na2','vitals_grid','Admission Vitals',2,{required:true}),
        f('na3','textarea','Chief Complaint',3,{auto_from:'encounter.chief_complaint',required:true}),
        f('na4','numeric','Pain Score (0-10)',4,{required:true}),
        f('na5','dropdown','Fall Risk',5,{options:['Low','Moderate','High'],required:true}),
        f('na6','dropdown','Skin Integrity',6,{options:['Intact','Pressure injury present','Wound present'],required:true}),
        f('na7','textarea','Psychosocial Assessment',7),
        f('na8','dropdown','Nutrition Screening',8,{options:['No risk','At risk','Malnourished']}),
        f('na9','patient_data_auto','Allergies',9,{auto_from:'patient.allergies'}),
        f('na10','signature','Admitting Nurse',10,{required:true}),
      ]},
    { name: 'Pre-Anaesthetic Assessment', description: 'Pre-anaesthetic evaluation', category: 'assessment', roles: ['anaesthetist'], encounterTypes: ['ipd','daycare'], tags: ['assessment','anaesthesia'],
      fields: [
        f('pa1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('pa2','dropdown','ASA Grade',2,{options:['I','II','III','IV','V','VI'],required:true}),
        f('pa3','dropdown','Airway Assessment',3,{options:['Normal','Potentially Difficult','Difficult'],required:true}),
        f('pa4','dropdown','Mallampati Score',4,{options:['I','II','III','IV'],required:true}),
        f('pa5','text','NPO Status',5,{required:true,placeholder:'Hours since last meal/drink'}),
        f('pa6','textarea','Co-morbidities',6,{auto_from:'problems.active'}),
        f('pa7','patient_data_auto','Current Medications',7,{auto_from:'meds.active'}),
        f('pa8','patient_data_auto','Allergies',8,{auto_from:'patient.allergies'}),
        f('pa9','dropdown','Planned Technique',9,{options:['General','Regional','Spinal','Epidural','Local','Sedation'],required:true}),
        f('pa10','textarea','Special Considerations',10),
        f('pa11','signature','Anaesthetist',11,{required:true}),
      ]},
    { name: 'Initial Medical Assessment', description: 'Doctor initial assessment on admission', category: 'assessment', roles: ['resident','senior_resident','hospitalist','visiting_consultant'], encounterTypes: ['ipd'], tags: ['assessment','medical'],
      fields: [
        f('ma1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('ma2','textarea','History of Present Illness',2,{required:true,ai_hint:'Detailed HPI'}),
        f('ma3','textarea','Past Medical History',3),
        f('ma4','patient_data_auto','Current Medications',4,{auto_from:'meds.active'}),
        f('ma5','patient_data_auto','Allergies',5,{auto_from:'patient.allergies'}),
        f('ma6','textarea','Review of Systems',6),
        f('ma7','textarea','Physical Examination',7,{required:true}),
        f('ma8','vitals_grid','Vitals',8,{auto_from:'vitals.latest'}),
        f('ma9','textarea','Assessment',9,{required:true}),
        f('ma10','textarea','Plan',10,{required:true}),
        f('ma11','signature','Doctor',11,{required:true}),
      ]},
    { name: 'Nutritional Screening', description: 'MUST-based nutritional risk screening', category: 'assessment', roles: ['nurse','senior_nurse'], encounterTypes: ['ipd'], tags: ['assessment','nutrition'],
      fields: [
        f('ns1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('ns2','numeric','BMI',2,{placeholder:'kg/m²'}),
        f('ns3','dropdown','Weight Loss (3-6 months)',3,{options:['None','<5%','5-10%','>10%'],required:true}),
        f('ns4','dropdown','Acute Illness Effect',4,{options:['None','Reduced intake >5 days'],required:true}),
        f('ns5','numeric','MUST Score',5,{ai_hint:'Auto-calculate from above fields'}),
        f('ns6','dropdown','Risk Category',6,{options:['Low Risk (0)','Medium Risk (1)','High Risk (2+)'],required:true}),
        f('ns7','textarea','Nutrition Plan',7,{placeholder:'Dietary modifications, supplements, referral...'}),
        f('ns8','signature','Nurse',8,{required:true}),
      ]},

    // ── PROGRESS/CONSULTATION (4) ─────────────────────────────────────
    { name: 'Daily Progress Note (SOAP)', description: 'Standard SOAP progress note', category: 'progress', roles: ['resident','senior_resident','hospitalist','visiting_consultant'], encounterTypes: ['ipd'], tags: ['progress','soap','daily'],
      fields: [
        f('sp1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('sp2','textarea','S — Subjective',2,{required:true,ai_hint:'Patient complaints and symptoms'}),
        f('sp3','textarea','O — Objective',3,{required:true,auto_from:'vitals.latest',ai_hint:'Auto-populate vitals, labs, I/O'}),
        f('sp4','textarea','A — Assessment',4,{required:true}),
        f('sp5','textarea','P — Plan',5,{required:true}),
        f('sp6','signature','Doctor',6,{required:true}),
      ]},
    { name: 'Consultation Note', description: 'Specialist consultation response', category: 'consultation', roles: ['visiting_consultant','specialist_cardiologist','specialist_neurologist','specialist_orthopedic'], encounterTypes: ['ipd','opd'], tags: ['consultation'],
      fields: [
        f('cn1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('cn2','text','Referred By',2,{required:true}),
        f('cn3','textarea','Reason for Consultation',3,{required:true}),
        f('cn4','textarea','Relevant History',4),
        f('cn5','textarea','Examination',5),
        f('cn6','textarea','Opinion',6,{required:true,ai_hint:'Specialist impression'}),
        f('cn7','textarea','Recommendations',7,{required:true}),
        f('cn8','signature','Consultant',8,{required:true}),
      ]},
    { name: 'Procedure Note', description: 'Bedside/minor procedure documentation', category: 'progress', roles: ['resident','senior_resident','surgeon','visiting_consultant'], encounterTypes: ['ipd','opd'], tags: ['procedure','bedside'],
      fields: [
        f('pn1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('pn2','text','Procedure',2,{required:true}),
        f('pn3','text','Indication',3,{required:true}),
        f('pn4','checkbox','Consent Obtained',4,{required:true}),
        f('pn5','textarea','Technique',5,{required:true}),
        f('pn6','textarea','Findings',6),
        f('pn7','text','Specimens',7),
        f('pn8','textarea','Complications',8,{placeholder:'None / describe'}),
        f('pn9','textarea','Post-Procedure Plan',9,{required:true}),
        f('pn10','signature','Doctor',10,{required:true}),
      ]},
    { name: 'Referral Letter', description: 'Outward referral letter', category: 'referral', roles: ['resident','senior_resident','hospitalist','visiting_consultant'], encounterTypes: ['ipd','opd'], tags: ['referral'],
      fields: [
        f('rl1','patient_data_auto','Patient',1,{auto_from:'patient.name',required:true}),
        f('rl2','text','Referring To',2,{required:true,placeholder:'Dr. / Hospital / Department'}),
        f('rl3','textarea','Reason for Referral',3,{required:true}),
        f('rl4','textarea','Relevant History',4,{ai_hint:'Summarize pertinent medical history'}),
        f('rl5','patient_data_auto','Current Medications',5,{auto_from:'meds.active'}),
        f('rl6','textarea','Specific Questions',6,{placeholder:'What do you need from the consultant?'}),
        f('rl7','signature','Referring Doctor',7,{required:true}),
      ]},
  ];
}
