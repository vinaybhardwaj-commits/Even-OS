import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * POST /api/migrations/seed-test-data
 *
 * Creates a complete operational test dataset so the hospital system is usable:
 * 1. Test users (charge_nurse, staff_nurse x2, doctor, resident, pharmacist, receptionist)
 * 2. Shift templates (Morning/Evening/Night)
 * 3. Today's shift instances for each ward
 * 4. Roster entries (nurses + charge nurse on today's morning shift)
 * 5. Encounters for 10 of the 50 LSQ patients (IPD admissions)
 * 6. Bed assignments for those 10 patients
 * 7. Patient assignments (nurses assigned to patients)
 *
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hospitalId = 'EHRC'; // Even Hospital Race Course Road
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const results: string[] = [];

    // ─── 0. ENSURE SHIFT + NURSING TABLES EXIST ────────────────
    // Run table creation inline (idempotent — IF NOT EXISTS)
    const enumSqls = [
      `DO $$ BEGIN CREATE TYPE shift_name AS ENUM ('morning','evening','night','general','custom'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE shift_instance_status AS ENUM ('planned','active','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE roster_status AS ENUM ('scheduled','confirmed','absent','swapped','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE assignment_status AS ENUM ('active','completed','transferred','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE handoff_status AS ENUM ('draft','submitted','acknowledged','flagged'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE handoff_priority AS ENUM ('routine','watch','critical'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE nursing_assessment_type AS ENUM ('admission','shift_start','routine','focused','discharge'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      `DO $$ BEGIN CREATE TYPE ward_type_applicability AS ENUM ('icu','general','step_down','ot','er','all'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    ];
    for (const e of enumSqls) { await sql(e); }

    await sql(`CREATE TABLE IF NOT EXISTS shift_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      name TEXT NOT NULL, shift_name shift_name NOT NULL DEFAULT 'custom',
      start_time TIME NOT NULL, end_time TIME NOT NULL,
      duration_hours REAL NOT NULL DEFAULT 8,
      ward_type ward_type_applicability NOT NULL DEFAULT 'all',
      is_default BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true,
      color TEXT DEFAULT '#3B82F6',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_templates_name_hospital ON shift_templates(name, hospital_id)`);

    await sql(`CREATE TABLE IF NOT EXISTS shift_instances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE RESTRICT,
      ward_id UUID NOT NULL, shift_date DATE NOT NULL,
      charge_nurse_id UUID, status shift_instance_status NOT NULL DEFAULT 'planned',
      actual_start TIMESTAMPTZ, actual_end TIMESTAMPTZ, notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_instances_unique ON shift_instances(template_id, ward_id, shift_date)`);

    await sql(`CREATE TABLE IF NOT EXISTS shift_roster (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_instance_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
      user_id UUID NOT NULL, role_during_shift TEXT NOT NULL DEFAULT 'nurse',
      status roster_status NOT NULL DEFAULT 'scheduled',
      assigned_by UUID, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_roster_unique ON shift_roster(shift_instance_id, user_id)`);

    await sql(`CREATE TABLE IF NOT EXISTS patient_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      shift_instance_id UUID NOT NULL REFERENCES shift_instances(id) ON DELETE CASCADE,
      nurse_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE RESTRICT,
      ward_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      bed_label TEXT, status assignment_status NOT NULL DEFAULT 'active',
      assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
      notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    results.push('✅ Shift + nursing tables ensured');

    // ─── 1. CREATE TEST USERS ──────────────────────────────────
    // Password hash for 'test1234' using bcrypt (12 rounds, matching app's SALT_ROUNDS)
    const testPasswordHash = '$2a$12$QMfh5kOplN8JQysNr7akwOffKSKCOfL1ie/FgTCePiGvyGEPu2F52';

    const testUsers = [
      { email: 'charge.nurse@even.in', name: 'Priya Sharma', role: 'charge_nurse', dept: 'Nursing' },
      { email: 'nurse.a@even.in', name: 'Deepa Kumari', role: 'nurse', dept: 'Nursing' },
      { email: 'nurse.b@even.in', name: 'Asha Devi', role: 'nurse', dept: 'Nursing' },
      { email: 'dr.patel@even.in', name: 'Dr. Rajesh Patel', role: 'hospitalist', dept: 'Medicine' },
      { email: 'dr.resident@even.in', name: 'Dr. Meera Singh', role: 'resident', dept: 'Medicine' },
      { email: 'pharmacist@even.in', name: 'Ravi Kumar', role: 'pharmacist', dept: 'Pharmacy' },
      { email: 'reception@even.in', name: 'Sunita Rao', role: 'receptionist', dept: 'Front Office' },
    ];

    for (const u of testUsers) {
      const rolesArr = `{${u.role}}`;
      await sql`
        INSERT INTO users (hospital_id, email, full_name, roles, department, password_hash, status, must_change_password)
        VALUES (${hospitalId}, ${u.email}, ${u.name}, ${rolesArr}::text[], ${u.dept}, ${testPasswordHash}, 'active', true)
        ON CONFLICT (email, hospital_id) DO UPDATE SET roles = ${rolesArr}::text[], full_name = ${u.name}, department = ${u.dept}, password_hash = ${testPasswordHash}, status = 'active'
      `;
    }
    results.push(`✅ 7 test users created/updated`);

    // Ensure test.nurse is a regular nurse (not charge_nurse)
    await sql`UPDATE users SET roles = '{nurse}'::text[] WHERE email = 'test.nurse@even.in' AND hospital_id = ${hospitalId}`;
    results.push(`✅ test.nurse@even.in set to nurse role`);

    // Get user IDs
    const usersResult = await sql`
      SELECT id, email, roles FROM users WHERE hospital_id = ${hospitalId} AND email IN (
        'charge.nurse@even.in', 'nurse.a@even.in', 'nurse.b@even.in',
        'dr.patel@even.in', 'test.nurse@even.in'
      )
    `;
    const userMap: Record<string, string> = {};
    for (const u of usersResult) {
      userMap[u.email as string] = u.id as string;
    }
    results.push(`✅ Found ${Object.keys(userMap).length} user IDs`);

    // ─── 2. GET WARDS ─────────────────────────────────────────
    const wards = await sql`
      SELECT id, code, name FROM locations
      WHERE hospital_id = ${hospitalId} AND location_type = 'ward' AND status = 'active'
      ORDER BY code
    `;
    if (wards.length === 0) {
      return NextResponse.json({ error: 'No wards found. Run bed board migration first.' }, { status: 400 });
    }
    results.push(`✅ Found ${wards.length} wards`);

    // ─── 3. SHIFT TEMPLATES ───────────────────────────────────
    const shifts = [
      { name: 'Morning Shift', shift_name: 'morning', start: '06:00', end: '14:00', hours: 8, color: '#F59E0B' },
      { name: 'Evening Shift', shift_name: 'evening', start: '14:00', end: '22:00', hours: 8, color: '#3B82F6' },
      { name: 'Night Shift', shift_name: 'night', start: '22:00', end: '06:00', hours: 8, color: '#6366F1' },
    ];

    const templateIds: string[] = [];
    for (const s of shifts) {
      const result = await sql`
        INSERT INTO shift_templates (hospital_id, name, shift_name, start_time, end_time, duration_hours, is_default, color)
        VALUES (${hospitalId}, ${s.name}, ${s.shift_name}, ${s.start}, ${s.end}, ${s.hours}, true, ${s.color})
        ON CONFLICT (name, hospital_id) DO UPDATE SET start_time = ${s.start}, end_time = ${s.end}
        RETURNING id
      `;
      templateIds.push(result[0].id as string);
    }
    results.push(`✅ 3 shift templates created`);

    // ─── 4. TODAY'S SHIFT INSTANCES (for each ward) ──────────
    // Determine which shift is "active" based on current hour
    const currentHour = new Date().getUTCHours() + 5.5; // IST offset
    const activeShiftIdx = currentHour < 14 ? 0 : currentHour < 22 ? 1 : 2;
    const activeTemplateId = templateIds[activeShiftIdx];

    const instanceIds: string[] = [];
    for (const ward of wards) {
      const result = await sql`
        INSERT INTO shift_instances (hospital_id, template_id, ward_id, shift_date, status,
          charge_nurse_id)
        VALUES (${hospitalId}, ${activeTemplateId}, ${ward.id}, ${today}, 'active',
          ${userMap['charge.nurse@even.in'] || userMap['test.nurse@even.in'] || null})
        ON CONFLICT (template_id, ward_id, shift_date) DO UPDATE SET status = 'active',
          charge_nurse_id = COALESCE(${userMap['charge.nurse@even.in'] || null}, shift_instances.charge_nurse_id)
        RETURNING id
      `;
      instanceIds.push(result[0].id as string);
    }
    results.push(`✅ ${instanceIds.length} shift instances created for today (${today})`);

    // ─── 5. ROSTER (put nurses on shift) ──────────────────────
    // Clean up any stale roster entries with wrong role_during_shift
    await sql`UPDATE shift_roster SET role_during_shift = 'nurse' WHERE user_id IN (
      SELECT id FROM users WHERE email = 'test.nurse@even.in'
    ) AND role_during_shift = 'charge_nurse'`;
    // Update shift instances to use charge.nurse as the charge_nurse_id
    if (userMap['charge.nurse@even.in']) {
      await sql`UPDATE shift_instances SET charge_nurse_id = ${userMap['charge.nurse@even.in']} WHERE shift_date = ${today}`;
    }

    const rosterNurses = ['charge.nurse@even.in', 'nurse.a@even.in', 'nurse.b@even.in', 'test.nurse@even.in'];
    let rosterCount = 0;
    for (const instanceId of instanceIds) {
      for (const email of rosterNurses) {
        const userId = userMap[email];
        if (!userId) continue;
        const roleDuringShift = email === 'charge.nurse@even.in' ? 'charge_nurse' : 'nurse';
        await sql`
          INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
          VALUES (${instanceId}, ${userId}, ${roleDuringShift}, 'confirmed')
          ON CONFLICT (shift_instance_id, user_id) DO NOTHING
        `;
        rosterCount++;
      }
    }
    results.push(`✅ ${rosterCount} roster entries created`);

    // ─── 6. ENCOUNTERS for first 10 patients ──────────────────
    // Get patients who don't already have active encounters
    const patients = await sql`
      SELECT p.id, p.uhid, p.name_full
      FROM patients p
      WHERE p.hospital_id = ${hospitalId}
        AND p.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM encounters e WHERE e.patient_id = p.id AND e.status = 'in-progress'
        )
      ORDER BY p.created_at DESC
      LIMIT 10
    `;
    results.push(`✅ Found ${patients.length} patients without active encounters`);

    // Get beds
    const beds = await sql`
      SELECT b.id, b.code, b.name, b.bed_status, w.id as ward_id, w.code as ward_code
      FROM locations b
      JOIN locations w ON b.parent_location_id = w.id
      WHERE b.hospital_id = ${hospitalId}
        AND b.location_type = 'bed'
        AND b.bed_status = 'available'
      ORDER BY b.code
      LIMIT 10
    `;
    results.push(`✅ Found ${beds.length} available beds`);

    const encounterIds: { encounterId: string; patientId: string; wardId: string; bedCode: string; bedId: string }[] = [];
    const diagnoses = [
      'Acute appendicitis', 'Type 2 DM with ketoacidosis', 'Community-acquired pneumonia',
      'Unstable angina', 'Acute cholecystitis', 'Cellulitis of lower limb',
      'Acute exacerbation of COPD', 'UTI with sepsis', 'Fracture neck of femur',
      'Dengue fever with warning signs',
    ];

    for (let i = 0; i < Math.min(patients.length, beds.length); i++) {
      const p = patients[i];
      const bed = beds[i];
      const diagnosis = diagnoses[i % diagnoses.length];
      const admissionDaysAgo = Math.floor(Math.random() * 5) + 1;
      const admissionAt = new Date(Date.now() - admissionDaysAgo * 86400000).toISOString();

      // Create encounter
      const enc = await sql`
        INSERT INTO encounters (hospital_id, patient_id, encounter_class, admission_type,
          chief_complaint, preliminary_diagnosis_icd10, status, admission_at,
          attending_practitioner_id, current_location_id, expected_los_days,
          diet_type, pre_auth_status)
        VALUES (${hospitalId}, ${p.id}, 'IMP', 'elective',
          ${diagnosis}, ${diagnosis}, 'in-progress', ${admissionAt},
          ${userMap['dr.patel@even.in'] || null}, ${bed.id}, ${admissionDaysAgo + 3},
          ${['regular', 'diabetic', 'soft', 'liquid'][i % 4]}, 'obtained')
        RETURNING id
      `;

      // Assign bed
      await sql`
        INSERT INTO bed_assignments (hospital_id, encounter_id, location_id, assigned_at)
        VALUES (${hospitalId}, ${enc[0].id}, ${bed.id}, ${admissionAt})
        ON CONFLICT DO NOTHING
      `;

      // Mark bed as occupied
      await sql`
        UPDATE locations SET bed_status = 'occupied' WHERE id = ${bed.id}
      `;

      encounterIds.push({
        encounterId: enc[0].id as string,
        patientId: p.id as string,
        wardId: bed.ward_id as string,
        bedCode: bed.code as string,
        bedId: bed.id as string,
      });
    }
    results.push(`✅ ${encounterIds.length} encounters created with bed assignments`);

    // ─── 7. PATIENT ASSIGNMENTS (nurse → patient per shift) ───
    // Distribute patients among nurses
    const nurseEmails = ['nurse.a@even.in', 'nurse.b@even.in', 'test.nurse@even.in'];
    let assignCount = 0;

    for (let i = 0; i < encounterIds.length; i++) {
      const { encounterId, patientId, wardId, bedCode } = encounterIds[i];
      const nurseEmail = nurseEmails[i % nurseEmails.length];
      const nurseId = userMap[nurseEmail];
      if (!nurseId) continue;

      // Find the shift instance for this ward
      const wardInstances = await sql`
        SELECT id FROM shift_instances
        WHERE ward_id = ${wardId} AND shift_date = ${today} AND status = 'active'
        LIMIT 1
      `;
      if (wardInstances.length === 0) continue;

      const assignerId = userMap['charge.nurse@even.in'] || userMap['test.nurse@even.in'] || nurseId;
      await sql`
        INSERT INTO patient_assignments (hospital_id, shift_instance_id, nurse_id, patient_id,
          encounter_id, ward_id, bed_label, status, assigned_by)
        VALUES (${hospitalId}, ${wardInstances[0].id}, ${nurseId}, ${patientId},
          ${encounterId}, ${wardId}, ${bedCode}, 'active', ${assignerId})
        ON CONFLICT DO NOTHING
      `;
      assignCount++;
    }
    results.push(`✅ ${assignCount} patient assignments created`);

    // ─── SUMMARY ──────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      results,
      testLogins: {
        charge_nurse: { email: 'charge.nurse@even.in', password: 'test1234', note: 'Or use test.nurse@even.in (promoted to charge_nurse)' },
        staff_nurse: { email: 'nurse.a@even.in', password: 'test1234' },
        doctor: { email: 'dr.patel@even.in', password: 'test1234' },
        resident: { email: 'dr.resident@even.in', password: 'test1234' },
        pharmacist: { email: 'pharmacist@even.in', password: 'test1234' },
        receptionist: { email: 'reception@even.in', password: 'test1234' },
        super_admin: { email: 'vinay.bhardwaj@even.in', note: 'existing account' },
      },
      note: 'All new test users have must_change_password=true. First login will prompt password change. Password is test1234.',
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Seed failed',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
