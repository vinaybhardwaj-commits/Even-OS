import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * POST /api/migrations/seed-roles
 *
 * Rationalizes the EHRC role system:
 * - Removes: senior_nurse, nursing_assistant, senior_resident, intern,
 *   chief_pharmacist, senior_pharmacist, pharmacy_technician, lab_director,
 *   senior_lab_technician, lab_manager, chief_radiologist, senior_radiologist
 * - Adds: specialty-based Consultant and Registrar roles for 12 specialties
 * - Keeps: Ward Nurse, Charge Nurse, Nursing Superintendent, RMO, VC, support roles
 * - Proper capitalization and descriptions
 */
export async function POST(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hospitalId = 'EHRC';
    const results: string[] = [];

    // ─── 1. DEACTIVATE OLD ROLES ─────────────────────────────
    const oldRoles = [
      'senior_nurse', 'nursing_assistant', 'nursing_manager',
      'senior_resident', 'intern',
      'chief_pharmacist', 'senior_pharmacist', 'pharmacy_technician',
      'lab_director', 'senior_lab_technician', 'lab_manager',
      'chief_radiologist', 'senior_radiologist',
    ];
    for (const r of oldRoles) {
      await sql`UPDATE roles SET is_active = false WHERE name = ${r} AND hospital_id = ${hospitalId}`;
    }
    results.push(`✅ Deactivated ${oldRoles.length} legacy roles`);

    // ─── 2. DEFINE RATIONALIZED ROLES ────────────────────────
    const roleDefinitions = [
      // ── ADMINISTRATION ──
      { name: 'super_admin', desc: 'System super administrator', group: 'admin' },
      { name: 'hospital_admin', desc: 'Hospital administrator', group: 'admin' },

      // ── NURSING ──
      { name: 'nurse', desc: 'Ward Nurse', group: 'nursing' },
      { name: 'charge_nurse', desc: 'Charge Nurse (shift lead)', group: 'nursing' },
      { name: 'nursing_superintendent', desc: 'Nursing Superintendent', group: 'nursing' },

      // ── DOCTORS — Visiting Consultants ──
      { name: 'vc_general_medicine', desc: 'Visiting Consultant — General Medicine', group: 'clinical' },
      { name: 'vc_general_surgery', desc: 'Visiting Consultant — General Surgery', group: 'clinical' },
      { name: 'vc_orthopaedics', desc: 'Visiting Consultant — Orthopaedics', group: 'clinical' },
      { name: 'vc_cardiology', desc: 'Visiting Consultant — Cardiology', group: 'clinical' },
      { name: 'vc_neurology', desc: 'Visiting Consultant — Neurology', group: 'clinical' },
      { name: 'vc_paediatrics', desc: 'Visiting Consultant — Paediatrics', group: 'clinical' },
      { name: 'vc_obgyn', desc: 'Visiting Consultant — Obstetrics & Gynaecology', group: 'clinical' },
      { name: 'vc_anaesthesiology', desc: 'Visiting Consultant — Anaesthesiology', group: 'clinical' },
      { name: 'vc_pulmonology', desc: 'Visiting Consultant — Pulmonology', group: 'clinical' },
      { name: 'vc_nephrology', desc: 'Visiting Consultant — Nephrology', group: 'clinical' },
      { name: 'vc_urology', desc: 'Visiting Consultant — Urology', group: 'clinical' },
      { name: 'vc_ent', desc: 'Visiting Consultant — ENT', group: 'clinical' },

      // ── DOCTORS — Hospitalist / Consultant (In-House) ──
      { name: 'consultant_general_medicine', desc: 'Hospitalist / Consultant — General Medicine', group: 'clinical' },
      { name: 'consultant_general_surgery', desc: 'Hospitalist / Consultant — General Surgery', group: 'clinical' },
      { name: 'consultant_orthopaedics', desc: 'Hospitalist / Consultant — Orthopaedics', group: 'clinical' },
      { name: 'consultant_cardiology', desc: 'Hospitalist / Consultant — Cardiology', group: 'clinical' },
      { name: 'consultant_neurology', desc: 'Hospitalist / Consultant — Neurology', group: 'clinical' },
      { name: 'consultant_paediatrics', desc: 'Hospitalist / Consultant — Paediatrics', group: 'clinical' },
      { name: 'consultant_obgyn', desc: 'Hospitalist / Consultant — Obstetrics & Gynaecology', group: 'clinical' },
      { name: 'consultant_anaesthesiology', desc: 'Hospitalist / Consultant — Anaesthesiology', group: 'clinical' },
      { name: 'consultant_pulmonology', desc: 'Hospitalist / Consultant — Pulmonology', group: 'clinical' },
      { name: 'consultant_nephrology', desc: 'Hospitalist / Consultant — Nephrology', group: 'clinical' },
      { name: 'consultant_urology', desc: 'Hospitalist / Consultant — Urology', group: 'clinical' },
      { name: 'consultant_ent', desc: 'Hospitalist / Consultant — ENT', group: 'clinical' },

      // ── DOCTORS — Registrars ──
      { name: 'registrar_general_medicine', desc: 'Registrar — General Medicine', group: 'clinical' },
      { name: 'registrar_general_surgery', desc: 'Registrar — General Surgery', group: 'clinical' },
      { name: 'registrar_orthopaedics', desc: 'Registrar — Orthopaedics', group: 'clinical' },
      { name: 'registrar_cardiology', desc: 'Registrar — Cardiology', group: 'clinical' },
      { name: 'registrar_neurology', desc: 'Registrar — Neurology', group: 'clinical' },
      { name: 'registrar_paediatrics', desc: 'Registrar — Paediatrics', group: 'clinical' },
      { name: 'registrar_obgyn', desc: 'Registrar — Obstetrics & Gynaecology', group: 'clinical' },
      { name: 'registrar_anaesthesiology', desc: 'Registrar — Anaesthesiology', group: 'clinical' },
      { name: 'registrar_pulmonology', desc: 'Registrar — Pulmonology', group: 'clinical' },
      { name: 'registrar_nephrology', desc: 'Registrar — Nephrology', group: 'clinical' },
      { name: 'registrar_urology', desc: 'Registrar — Urology', group: 'clinical' },
      { name: 'registrar_ent', desc: 'Registrar — ENT', group: 'clinical' },

      // ── DOCTORS — RMO ──
      { name: 'rmo', desc: 'Resident Medical Officer', group: 'clinical' },

      // ── PHARMACY ──
      { name: 'pharmacist', desc: 'Pharmacist', group: 'pharmacy' },

      // ── LABORATORY ──
      { name: 'lab_technician', desc: 'Lab Technician', group: 'lab' },
      { name: 'phlebotomist', desc: 'Phlebotomist', group: 'lab' },

      // ── RADIOLOGY ──
      { name: 'radiologist', desc: 'Radiologist', group: 'radiology' },
      { name: 'radiology_technician', desc: 'Radiology Technician', group: 'radiology' },

      // ── BILLING & FINANCE ──
      { name: 'billing_manager', desc: 'Billing Manager', group: 'billing' },
      { name: 'billing_executive', desc: 'Billing Executive', group: 'billing' },
      { name: 'insurance_coordinator', desc: 'Insurance Coordinator', group: 'billing' },

      // ── SUPPORT ──
      { name: 'receptionist', desc: 'Front Desk / Receptionist', group: 'support' },
      { name: 'ip_coordinator', desc: 'IP Coordinator / Customer Care', group: 'support' },
      { name: 'housekeeping_supervisor', desc: 'Housekeeping Supervisor', group: 'support' },
      { name: 'dietitian', desc: 'Dietitian', group: 'support' },
      { name: 'physiotherapist', desc: 'Physiotherapist', group: 'support' },
      { name: 'medical_social_worker', desc: 'Medical Social Worker', group: 'support' },

      // ── EXECUTIVE ──
      { name: 'gm', desc: 'General Manager', group: 'executive' },
      { name: 'medical_director', desc: 'Medical Director', group: 'executive' },
      { name: 'ceo', desc: 'Chief Executive Officer', group: 'executive' },

      // Keep legacy roles that may be in use (but update descriptions)
      { name: 'visiting_consultant', desc: 'Visiting Consultant (legacy — use specialty-specific VC roles)', group: 'clinical' },
      { name: 'hospitalist', desc: 'Hospitalist / Consultant (legacy — use specialty-specific roles)', group: 'clinical' },
      { name: 'resident', desc: 'Resident (legacy — use Registrar or RMO roles)', group: 'clinical' },
      { name: 'surgeon', desc: 'Surgeon (legacy — use specialty-specific Consultant roles)', group: 'clinical' },
      { name: 'anaesthetist', desc: 'Anaesthetist (legacy — use VC/Consultant Anaesthesiology)', group: 'clinical' },
      { name: 'staff', desc: 'General Staff', group: 'support' },
    ];

    let created = 0;
    let updated = 0;
    for (const r of roleDefinitions) {
      // Check if role exists first (ON CONFLICT doesn't work with nullable hospital_id index)
      const existing = await sql`
        SELECT id FROM roles WHERE name = ${r.name} AND hospital_id = ${hospitalId} LIMIT 1
      `;
      let isNew = false;
      if (existing.length === 0) {
        await sql`
          INSERT INTO roles (hospital_id, name, description, role_group, is_active, is_system_role)
          VALUES (${hospitalId}, ${r.name}, ${r.desc}, ${r.group}, true, false)
        `;
        isNew = true;
      } else {
        await sql`
          UPDATE roles SET description = ${r.desc}, role_group = ${r.group}, is_active = true
          WHERE name = ${r.name} AND hospital_id = ${hospitalId}
        `;
      }
      const result = [{ is_new: isNew }];
      if (result[0]?.is_new) created++; else updated++;
    }
    results.push(`✅ ${created} new roles created, ${updated} existing roles updated`);
    results.push(`✅ Total active roles: ${roleDefinitions.length}`);

    // ─── 3. UPDATE ROLE_LABELS in CaregiverShell ──────────────
    // This is in the code, but the DB roles are the source of truth for the admin UI
    // The CaregiverShell falls back to role.replace(/_/g, ' ').replace(...) which works

    return NextResponse.json({
      success: true,
      results,
      roleGroups: {
        admin: roleDefinitions.filter(r => r.group === 'admin').length,
        nursing: roleDefinitions.filter(r => r.group === 'nursing').length,
        clinical: roleDefinitions.filter(r => r.group === 'clinical').length,
        pharmacy: roleDefinitions.filter(r => r.group === 'pharmacy').length,
        lab: roleDefinitions.filter(r => r.group === 'lab').length,
        radiology: roleDefinitions.filter(r => r.group === 'radiology').length,
        billing: roleDefinitions.filter(r => r.group === 'billing').length,
        support: roleDefinitions.filter(r => r.group === 'support').length,
        executive: roleDefinitions.filter(r => r.group === 'executive').length,
      },
    });
  } catch (error) {
    console.error('Seed roles error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Seed failed',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
