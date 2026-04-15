import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * POST /api/migrations/seed-staff
 *
 * Seeds a realistic staff roster for EHRC Race Course Road:
 * - 20 nurses (mix of nurse + charge_nurse capable)
 * - 8 doctors (1 VC, 2 Even Attendings, 2 Registrars, 3 RMOs)
 * - 4 support staff (pharmacist, lab tech, receptionist, billing)
 * - Shift templates for EHRC standard (AM 8-2:30, PM 2-8:30, Night 8pm-8am)
 * - Separate templates for doctors (12h block, on-call block)
 * - Today's shift instances and roster assignments with 24h coverage
 *
 * Safe to re-run — ON CONFLICT preserves existing passwords.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hospitalId = 'EHRC';
    const today = new Date().toISOString().split('T')[0];
    const results: string[] = [];

    // Bcrypt hash for 'test1234' (12 rounds)
    const testPwHash = '$2a$12$QMfh5kOplN8JQysNr7akwOffKSKCOfL1ie/FgTCePiGvyGEPu2F52';

    // ─── 1. NURSING STAFF (20) ──────────────────────────────────
    const nurses = [
      // Ward nurses — General Ward (Female)
      { email: 'anita.sharma@even.in', name: 'Anita Sharma', dept: 'Nursing - Gen F' },
      { email: 'kavitha.nair@even.in', name: 'Kavitha Nair', dept: 'Nursing - Gen F' },
      { email: 'sunitha.raj@even.in', name: 'Sunitha Raj', dept: 'Nursing - Gen F' },
      { email: 'meena.kumari@even.in', name: 'Meena Kumari', dept: 'Nursing - Gen F' },
      { email: 'lakshmi.devi@even.in', name: 'Lakshmi Devi', dept: 'Nursing - Gen F' },
      // Ward nurses — General Ward (Male)
      { email: 'priya.menon@even.in', name: 'Priya Menon', dept: 'Nursing - Gen M' },
      { email: 'deepa.thomas@even.in', name: 'Deepa Thomas', dept: 'Nursing - Gen M' },
      { email: 'anjali.pillai@even.in', name: 'Anjali Pillai', dept: 'Nursing - Gen M' },
      { email: 'sarala.bhat@even.in', name: 'Sarala Bhat', dept: 'Nursing - Gen M' },
      { email: 'rekha.iyer@even.in', name: 'Rekha Iyer', dept: 'Nursing - Gen M' },
      // ICU nurses
      { email: 'divya.krishnan@even.in', name: 'Divya Krishnan', dept: 'Nursing - ICU' },
      { email: 'sowmya.rao@even.in', name: 'Sowmya Rao', dept: 'Nursing - ICU' },
      { email: 'vidya.shetty@even.in', name: 'Vidya Shetty', dept: 'Nursing - ICU' },
      { email: 'geeta.patil@even.in', name: 'Geeta Patil', dept: 'Nursing - ICU' },
      // Private ward nurses
      { email: 'swathi.reddy@even.in', name: 'Swathi Reddy', dept: 'Nursing - PVT' },
      { email: 'asha.mohan@even.in', name: 'Asha Mohan', dept: 'Nursing - PVT' },
      // Float/per-diem nurses
      { email: 'jaya.varma@even.in', name: 'Jaya Varma', dept: 'Nursing - Float' },
      { email: 'nandini.gowda@even.in', name: 'Nandini Gowda', dept: 'Nursing - Float' },
      // Senior/Charge-capable nurses
      { email: 'padma.rangan@even.in', name: 'Padma Rangan', dept: 'Nursing - Senior' },
      { email: 'kamala.suresh@even.in', name: 'Kamala Suresh', dept: 'Nursing - Senior' },
    ];

    for (const n of nurses) {
      await sql`
        INSERT INTO users (hospital_id, email, full_name, roles, department, password_hash, status, must_change_password)
        VALUES (${hospitalId}, ${n.email}, ${n.name}, '{nurse}'::text[], ${n.dept}, ${testPwHash}, 'active', true)
        ON CONFLICT (email, hospital_id) DO UPDATE SET full_name = ${n.name}, department = ${n.dept},
          password_hash = CASE WHEN users.password_hash IS NULL OR users.password_hash = '' THEN ${testPwHash} ELSE users.password_hash END
      `;
    }
    results.push(`✅ 20 nurses created/updated`);

    // ─── 2. DOCTORS (8) ─────────────────────────────────────────
    const doctors = [
      // Visiting Consultant (1) — no shifts, comes for their patients
      { email: 'dr.subramaniam@even.in', name: 'Dr. K. Subramaniam', role: 'visiting_consultant', dept: 'General Surgery' },
      // Even Attendings / In-house Consultants (2) — 12h block + on-call
      { email: 'dr.anand.kumar@even.in', name: 'Dr. Anand Kumar', role: 'hospitalist', dept: 'Internal Medicine' },
      { email: 'dr.preethi.nair@even.in', name: 'Dr. Preethi Nair', role: 'hospitalist', dept: 'Internal Medicine' },
      // Registrars (2) — department-specific, similar to attendings
      { email: 'dr.vikram.singh@even.in', name: 'Dr. Vikram Singh', role: 'resident', dept: 'General Surgery' },
      { email: 'dr.rashmi.patel@even.in', name: 'Dr. Rashmi Patel', role: 'resident', dept: 'Orthopaedics' },
      // RMOs (3) — follow 3-shift cycle like nurses
      { email: 'dr.arun.jose@even.in', name: 'Dr. Arun Jose', role: 'resident', dept: 'RMO' },
      { email: 'dr.sneha.yadav@even.in', name: 'Dr. Sneha Yadav', role: 'resident', dept: 'RMO' },
      { email: 'dr.rahul.verma@even.in', name: 'Dr. Rahul Verma', role: 'resident', dept: 'RMO' },
    ];

    for (const d of doctors) {
      const rolesArr = `{${d.role}}`;
      await sql`
        INSERT INTO users (hospital_id, email, full_name, roles, department, password_hash, status, must_change_password)
        VALUES (${hospitalId}, ${d.email}, ${d.name}, ${rolesArr}::text[], ${d.dept}, ${testPwHash}, 'active', true)
        ON CONFLICT (email, hospital_id) DO UPDATE SET full_name = ${d.name}, department = ${d.dept}, roles = ${rolesArr}::text[],
          password_hash = CASE WHEN users.password_hash IS NULL OR users.password_hash = '' THEN ${testPwHash} ELSE users.password_hash END
      `;
    }
    results.push(`✅ 8 doctors created/updated`);

    // ─── 3. SUPPORT STAFF (4) ───────────────────────────────────
    const support = [
      { email: 'ravi.pharmacist@even.in', name: 'Ravi Kumar', role: 'pharmacist', dept: 'Pharmacy' },
      { email: 'sangeetha.lab@even.in', name: 'Sangeetha M', role: 'lab_technician', dept: 'Laboratory' },
      { email: 'manjunath.front@even.in', name: 'Manjunath K', role: 'receptionist', dept: 'Front Office' },
      { email: 'mohan.billing@even.in', name: 'Mohan Rao', role: 'billing_executive', dept: 'Billing' },
    ];

    for (const s of support) {
      const rolesArr = `{${s.role}}`;
      await sql`
        INSERT INTO users (hospital_id, email, full_name, roles, department, password_hash, status, must_change_password)
        VALUES (${hospitalId}, ${s.email}, ${s.name}, ${rolesArr}::text[], ${s.dept}, ${testPwHash}, 'active', true)
        ON CONFLICT (email, hospital_id) DO UPDATE SET full_name = ${s.name}, department = ${s.dept}, roles = ${rolesArr}::text[],
          password_hash = CASE WHEN users.password_hash IS NULL OR users.password_hash = '' THEN ${testPwHash} ELSE users.password_hash END
      `;
    }
    results.push(`✅ 4 support staff created/updated`);

    // ─── 4. SHIFT TEMPLATES ─────────────────────────────────────
    // Delete old defaults, create EHRC-specific ones
    // Nursing + RMO shifts
    const shiftTemplates = [
      { name: 'Nursing AM', shift_name: 'morning', start: '08:00', end: '14:30', hours: 6.5, color: '#F59E0B', ward_type: 'all' },
      { name: 'Nursing PM', shift_name: 'evening', start: '14:00', end: '20:30', hours: 6.5, color: '#3B82F6', ward_type: 'all' },
      { name: 'Nursing Night', shift_name: 'night', start: '20:00', end: '08:00', hours: 12, color: '#6366F1', ward_type: 'all' },
      // Doctor (Attending/Registrar) blocks
      { name: 'Doctor Day Block', shift_name: 'general', start: '08:00', end: '20:00', hours: 12, color: '#10B981', ward_type: 'all' },
      { name: 'Doctor On-Call', shift_name: 'custom', start: '20:00', end: '08:00', hours: 12, color: '#EF4444', ward_type: 'all' },
      // RMO shifts (same as nursing)
      { name: 'RMO AM', shift_name: 'morning', start: '08:00', end: '14:30', hours: 6.5, color: '#F59E0B', ward_type: 'all' },
      { name: 'RMO PM', shift_name: 'evening', start: '14:00', end: '20:30', hours: 6.5, color: '#3B82F6', ward_type: 'all' },
      { name: 'RMO Night', shift_name: 'night', start: '20:00', end: '08:00', hours: 12, color: '#6366F1', ward_type: 'all' },
    ];

    const templateMap: Record<string, string> = {};
    for (const t of shiftTemplates) {
      const result = await sql`
        INSERT INTO shift_templates (hospital_id, name, shift_name, start_time, end_time, duration_hours, ward_type, is_default, is_active, color)
        VALUES (${hospitalId}, ${t.name}, ${t.shift_name}, ${t.start}, ${t.end}, ${t.hours}, ${t.ward_type}, true, true, ${t.color})
        ON CONFLICT (name, hospital_id) DO UPDATE SET start_time = ${t.start}, end_time = ${t.end}, duration_hours = ${t.hours}, color = ${t.color}
        RETURNING id
      `;
      templateMap[t.name] = result[0].id as string;
    }
    results.push(`✅ ${shiftTemplates.length} shift templates created`);

    // ─── 5. GET WARDS ───────────────────────────────────────────
    const wards = await sql`
      SELECT id, code, name FROM locations
      WHERE hospital_id = ${hospitalId} AND location_type = 'ward' AND status = 'active'
      ORDER BY code
    `;
    const wardMap: Record<string, string> = {};
    for (const w of wards) {
      wardMap[w.code as string] = w.id as string;
    }
    results.push(`✅ Found ${wards.length} wards`);

    // ─── 6. GET ALL USER IDS ────────────────────────────────────
    const allUsers = await sql`
      SELECT id, email, full_name, roles, department FROM users
      WHERE hospital_id = ${hospitalId} AND status = 'active'
    `;
    const userIdMap: Record<string, { id: string; name: string; dept: string }> = {};
    for (const u of allUsers) {
      userIdMap[u.email as string] = { id: u.id as string, name: u.full_name as string, dept: u.department as string };
    }
    results.push(`✅ Found ${allUsers.length} active users`);

    // ─── 7. TODAY'S SHIFT INSTANCES + ROSTER ────────────────────
    // Determine current IST hour
    const istHour = (new Date().getUTCHours() + 5) % 24 + (new Date().getUTCMinutes() + 30) / 60;

    // Create instances for each ward for each nursing shift
    const nursingShiftNames = ['Nursing AM', 'Nursing PM', 'Nursing Night'];

    // Ward → nurse mapping for rotation
    const wardNurseMap: Record<string, string[]> = {
      'GEN-F': ['anita.sharma@even.in', 'kavitha.nair@even.in', 'sunitha.raj@even.in', 'meena.kumari@even.in', 'lakshmi.devi@even.in'],
      'GEN-M': ['priya.menon@even.in', 'deepa.thomas@even.in', 'anjali.pillai@even.in', 'sarala.bhat@even.in', 'rekha.iyer@even.in'],
      'ICU': ['divya.krishnan@even.in', 'sowmya.rao@even.in', 'vidya.shetty@even.in', 'geeta.patil@even.in'],
      'PVT': ['swathi.reddy@even.in', 'asha.mohan@even.in', 'jaya.varma@even.in', 'nandini.gowda@even.in'],
    };

    // Charge nurses per ward (senior nurses rotate)
    const chargeNurseMap: Record<string, string> = {
      'GEN-F': 'padma.rangan@even.in',
      'GEN-M': 'kamala.suresh@even.in',
      'ICU': 'charge.nurse@even.in',  // existing test charge nurse
      'PVT': 'padma.rangan@even.in',
    };

    let instanceCount = 0;
    let rosterCount = 0;

    for (const wardRow of wards) {
      const wardCode = wardRow.code as string;
      const wardId = wardRow.id as string;
      const chargeEmail = chargeNurseMap[wardCode];
      const chargeId = chargeEmail ? userIdMap[chargeEmail]?.id : null;

      for (const shiftName of nursingShiftNames) {
        const templateId = templateMap[shiftName];
        if (!templateId) continue;

        // Determine if this shift is currently active
        let status = 'planned';
        if (shiftName === 'Nursing AM' && istHour >= 8 && istHour < 14.5) status = 'active';
        else if (shiftName === 'Nursing PM' && istHour >= 14 && istHour < 20.5) status = 'active';
        else if (shiftName === 'Nursing Night' && (istHour >= 20 || istHour < 8)) status = 'active';

        const inst = await sql`
          INSERT INTO shift_instances (hospital_id, template_id, ward_id, shift_date, charge_nurse_id, status)
          VALUES (${hospitalId}, ${templateId}, ${wardId}, ${today}, ${chargeId}, ${status})
          ON CONFLICT (template_id, ward_id, shift_date) DO UPDATE SET charge_nurse_id = ${chargeId}, status = ${status}
          RETURNING id
        `;
        const instanceId = inst[0].id as string;
        instanceCount++;

        // Assign nurses to this shift
        // For AM: first 2 nurses. PM: next 2. Night: last nurse + 1 overlap
        const wardNurses = wardNurseMap[wardCode] || [];
        let shiftNurses: string[] = [];
        if (shiftName === 'Nursing AM') {
          shiftNurses = wardNurses.slice(0, 2);
        } else if (shiftName === 'Nursing PM') {
          shiftNurses = wardNurses.slice(2, 4);
        } else {
          shiftNurses = wardNurses.length > 4 ? [wardNurses[4]] : [wardNurses[0]];
        }

        // Add charge nurse to their ward's roster
        if (chargeId && status === 'active') {
          await sql`
            INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
            VALUES (${instanceId}, ${chargeId}, 'charge_nurse', 'confirmed')
            ON CONFLICT (shift_instance_id, user_id) DO UPDATE SET role_during_shift = 'charge_nurse', status = 'confirmed'
          `;
          rosterCount++;
        }

        // Add ward nurses
        for (const nurseEmail of shiftNurses) {
          const nurseId = userIdMap[nurseEmail]?.id;
          if (!nurseId) continue;
          await sql`
            INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
            VALUES (${instanceId}, ${nurseId}, 'nurse', 'confirmed')
            ON CONFLICT (shift_instance_id, user_id) DO UPDATE SET role_during_shift = 'nurse', status = 'confirmed'
          `;
          rosterCount++;
        }
      }
    }
    results.push(`✅ ${instanceCount} shift instances created for today`);
    results.push(`✅ ${rosterCount} roster entries created`);

    // ─── 8. RMO SHIFT INSTANCES ─────────────────────────────────
    // RMOs cover all wards, not ward-specific
    const rmoEmails = ['dr.arun.jose@even.in', 'dr.sneha.yadav@even.in', 'dr.rahul.verma@even.in'];
    const rmoShiftNames = ['RMO AM', 'RMO PM', 'RMO Night'];
    let rmoRosterCount = 0;

    // Use first ward for RMO instance (they float across wards)
    const firstWardId = wards[0]?.id as string;
    if (firstWardId) {
      for (let i = 0; i < rmoShiftNames.length; i++) {
        const templateId = templateMap[rmoShiftNames[i]];
        if (!templateId) continue;

        let status = 'planned';
        if (rmoShiftNames[i] === 'RMO AM' && istHour >= 8 && istHour < 14.5) status = 'active';
        else if (rmoShiftNames[i] === 'RMO PM' && istHour >= 14 && istHour < 20.5) status = 'active';
        else if (rmoShiftNames[i] === 'RMO Night' && (istHour >= 20 || istHour < 8)) status = 'active';

        const inst = await sql`
          INSERT INTO shift_instances (hospital_id, template_id, ward_id, shift_date, status)
          VALUES (${hospitalId}, ${templateId}, ${firstWardId}, ${today}, ${status})
          ON CONFLICT (template_id, ward_id, shift_date) DO UPDATE SET status = ${status}
          RETURNING id
        `;

        // Assign RMO: one per shift, rotating
        const rmoEmail = rmoEmails[i % rmoEmails.length];
        const rmoId = userIdMap[rmoEmail]?.id;
        if (rmoId) {
          await sql`
            INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
            VALUES (${inst[0].id}, ${rmoId}, 'rmo', 'confirmed')
            ON CONFLICT (shift_instance_id, user_id) DO UPDATE SET role_during_shift = 'rmo', status = 'confirmed'
          `;
          rmoRosterCount++;
        }
      }
    }
    results.push(`✅ ${rmoRosterCount} RMO roster entries created`);

    // ─── 9. ATTENDING DOCTOR INSTANCES ──────────────────────────
    // Day block + on-call for attendings
    const attendingEmails = ['dr.anand.kumar@even.in', 'dr.preethi.nair@even.in'];
    const registrarEmails = ['dr.vikram.singh@even.in', 'dr.rashmi.patel@even.in'];
    let docRosterCount = 0;

    if (firstWardId) {
      // Day block: Dr. Anand on-site, Dr. Preethi on-call (and vice versa at night)
      const dayBlockId = templateMap['Doctor Day Block'];
      const onCallId = templateMap['Doctor On-Call'];

      if (dayBlockId) {
        const dayInst = await sql`
          INSERT INTO shift_instances (hospital_id, template_id, ward_id, shift_date, status)
          VALUES (${hospitalId}, ${dayBlockId}, ${firstWardId}, ${today}, ${istHour >= 8 && istHour < 20 ? 'active' : 'planned'})
          ON CONFLICT (template_id, ward_id, shift_date) DO UPDATE SET status = ${istHour >= 8 && istHour < 20 ? 'active' : 'planned'}
          RETURNING id
        `;

        // Dr. Anand on day, Dr. Preethi on-site too (both attendings present during day)
        for (const email of attendingEmails) {
          const uid = userIdMap[email]?.id;
          if (uid) {
            await sql`
              INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
              VALUES (${dayInst[0].id}, ${uid}, 'attending', 'confirmed')
              ON CONFLICT (shift_instance_id, user_id) DO NOTHING
            `;
            docRosterCount++;
          }
        }

        // Registrars on day block
        for (const email of registrarEmails) {
          const uid = userIdMap[email]?.id;
          if (uid) {
            await sql`
              INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
              VALUES (${dayInst[0].id}, ${uid}, 'registrar', 'confirmed')
              ON CONFLICT (shift_instance_id, user_id) DO NOTHING
            `;
            docRosterCount++;
          }
        }
      }

      if (onCallId) {
        const nightInst = await sql`
          INSERT INTO shift_instances (hospital_id, template_id, ward_id, shift_date, status)
          VALUES (${hospitalId}, ${onCallId}, ${firstWardId}, ${today}, ${istHour >= 20 || istHour < 8 ? 'active' : 'planned'})
          ON CONFLICT (template_id, ward_id, shift_date) DO UPDATE SET status = ${istHour >= 20 || istHour < 8 ? 'active' : 'planned'}
          RETURNING id
        `;

        // Dr. Anand on-call at night
        const anandId = userIdMap['dr.anand.kumar@even.in']?.id;
        if (anandId) {
          await sql`
            INSERT INTO shift_roster (shift_instance_id, user_id, role_during_shift, status)
            VALUES (${nightInst[0].id}, ${anandId}, 'attending_oncall', 'confirmed')
            ON CONFLICT (shift_instance_id, user_id) DO NOTHING
          `;
          docRosterCount++;
        }
      }
    }
    results.push(`✅ ${docRosterCount} doctor roster entries created`);

    // ─── SUMMARY ────────────────────────────────────────────────
    const totalUsers = nurses.length + doctors.length + support.length;
    return NextResponse.json({
      success: true,
      results,
      summary: {
        total_staff_seeded: totalUsers,
        nurses: nurses.length,
        doctors: doctors.length,
        support: support.length,
        shift_templates: shiftTemplates.length,
        todays_instances: instanceCount,
        todays_roster: rosterCount + rmoRosterCount + docRosterCount,
      },
      admin_urls: {
        shift_management: '/admin/shifts',
        user_management: '/admin/users',
        test_cockpit: '/admin/test-cockpit',
      },
      note: 'All new accounts: password test1234, must_change_password=true. Existing passwords preserved.',
    });
  } catch (error) {
    console.error('Seed staff error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Seed failed',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
