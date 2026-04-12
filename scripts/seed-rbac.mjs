/**
 * Seed script: Populate roles, permissions, and role_permissions tables
 * Run from apps/web: node ../../scripts/seed-rbac.mjs
 */
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ============================================================
// ROLE DEFINITIONS (47 roles)
// ============================================================
const ROLES = [
  // System (1)
  { name: 'system_super_admin', group: 'system', timeout: 1440, system: true, desc: 'Full system access, cannot be assigned to regular users' },
  // Admin (7)
  { name: 'super_admin', group: 'admin', timeout: 1440, system: true, desc: 'Hospital-level superuser' },
  { name: 'hospital_admin', group: 'admin', timeout: 720, system: true, desc: 'Hospital administrator' },
  { name: 'department_head', group: 'admin', timeout: 720, system: false, desc: 'Head of department' },
  { name: 'operations_manager', group: 'admin', timeout: 720, system: false, desc: 'Hospital operations manager' },
  { name: 'hr_manager', group: 'admin', timeout: 720, system: false, desc: 'Human resources manager' },
  { name: 'compliance_officer', group: 'admin', timeout: 720, system: false, desc: 'NABH/regulatory compliance officer' },
  { name: 'data_officer', group: 'admin', timeout: 720, system: false, desc: 'Data protection officer (DPDP Act)' },
  // Executive (4)
  { name: 'coo', group: 'executive', timeout: 1440, system: true, desc: 'Chief Operating Officer' },
  { name: 'cfo', group: 'executive', timeout: 1440, system: true, desc: 'Chief Financial Officer' },
  { name: 'medical_director', group: 'executive', timeout: 1440, system: true, desc: 'Medical Director' },
  { name: 'hospital_director', group: 'executive', timeout: 1440, system: true, desc: 'Hospital Director' },
  // Clinical (8)
  { name: 'senior_resident', group: 'clinical', timeout: 480, system: false, desc: 'Senior Resident doctor' },
  { name: 'resident', group: 'clinical', timeout: 480, system: false, desc: 'Resident doctor' },
  { name: 'intern', group: 'clinical', timeout: 480, system: false, desc: 'Medical intern' },
  { name: 'visiting_consultant', group: 'clinical', timeout: 480, system: false, desc: 'Visiting consultant doctor' },
  { name: 'specialist_cardiologist', group: 'clinical', timeout: 480, system: false, desc: 'Cardiology specialist' },
  { name: 'specialist_neurologist', group: 'clinical', timeout: 480, system: false, desc: 'Neurology specialist' },
  { name: 'specialist_orthopedic', group: 'clinical', timeout: 480, system: false, desc: 'Orthopedic specialist' },
  { name: 'hospitalist', group: 'clinical', timeout: 480, system: false, desc: 'Hospitalist physician' },
  // Nursing (6)
  { name: 'senior_nurse', group: 'nursing', timeout: 480, system: false, desc: 'Senior nurse' },
  { name: 'nurse', group: 'nursing', timeout: 480, system: false, desc: 'Staff nurse' },
  { name: 'nursing_assistant', group: 'nursing', timeout: 480, system: false, desc: 'Nursing assistant / aide' },
  { name: 'charge_nurse', group: 'nursing', timeout: 480, system: false, desc: 'Charge nurse (shift lead)' },
  { name: 'nursing_supervisor', group: 'nursing', timeout: 480, system: false, desc: 'Nursing supervisor' },
  { name: 'nursing_manager', group: 'nursing', timeout: 720, system: false, desc: 'Nursing department manager' },
  // Pharmacy (4)
  { name: 'chief_pharmacist', group: 'pharmacy', timeout: 720, system: false, desc: 'Chief pharmacist' },
  { name: 'senior_pharmacist', group: 'pharmacy', timeout: 480, system: false, desc: 'Senior pharmacist' },
  { name: 'pharmacist', group: 'pharmacy', timeout: 480, system: false, desc: 'Staff pharmacist' },
  { name: 'pharmacy_technician', group: 'pharmacy', timeout: 480, system: false, desc: 'Pharmacy technician' },
  // Lab (5)
  { name: 'lab_director', group: 'lab', timeout: 720, system: false, desc: 'Lab director' },
  { name: 'senior_lab_technician', group: 'lab', timeout: 480, system: false, desc: 'Senior lab technician' },
  { name: 'lab_technician', group: 'lab', timeout: 480, system: false, desc: 'Lab technician' },
  { name: 'phlebotomist', group: 'lab', timeout: 480, system: false, desc: 'Phlebotomist' },
  { name: 'lab_manager', group: 'lab', timeout: 720, system: false, desc: 'Lab operations manager' },
  // Radiology (4)
  { name: 'chief_radiologist', group: 'radiology', timeout: 720, system: false, desc: 'Chief radiologist' },
  { name: 'senior_radiologist', group: 'radiology', timeout: 480, system: false, desc: 'Senior radiologist' },
  { name: 'radiologist', group: 'radiology', timeout: 480, system: false, desc: 'Staff radiologist' },
  { name: 'radiology_technician', group: 'radiology', timeout: 480, system: false, desc: 'Radiology technician' },
  // Billing (5)
  { name: 'billing_manager', group: 'billing', timeout: 720, system: false, desc: 'Billing department manager' },
  { name: 'billing_executive', group: 'billing', timeout: 720, system: false, desc: 'Billing executive' },
  { name: 'insurance_coordinator', group: 'billing', timeout: 720, system: false, desc: 'Insurance / TPA coordinator' },
  { name: 'financial_analyst', group: 'billing', timeout: 720, system: false, desc: 'Financial analyst' },
  { name: 'accounts_manager', group: 'billing', timeout: 720, system: false, desc: 'Accounts manager' },
  // Support (3)
  { name: 'receptionist', group: 'support', timeout: 480, system: false, desc: 'Front desk receptionist' },
  { name: 'security_personnel', group: 'support', timeout: 480, system: false, desc: 'Security staff' },
  { name: 'housekeeping_supervisor', group: 'support', timeout: 480, system: false, desc: 'Housekeeping supervisor' },
  // Generic
  { name: 'staff', group: 'support', timeout: 480, system: false, desc: 'General hospital staff' },
];

// ============================================================
// PERMISSION DEFINITIONS (86 permissions)
// ============================================================
const PERMISSIONS = [
  // Patient
  { resource: 'patient', action: 'read', desc: 'View patient demographics' },
  { resource: 'patient', action: 'create', desc: 'Register a new patient' },
  { resource: 'patient', action: 'update', desc: 'Edit patient demographics' },
  { resource: 'patient', action: 'delete', desc: 'Delete patient record' },
  // Clinical records
  { resource: 'clinical_note', action: 'read', desc: 'View clinical notes' },
  { resource: 'clinical_note', action: 'create', desc: 'Write clinical notes' },
  { resource: 'clinical_note', action: 'update', desc: 'Edit clinical notes' },
  // Medication
  { resource: 'medication_request', action: 'read', desc: 'View medication orders' },
  { resource: 'medication_request', action: 'create', desc: 'Create medication order' },
  { resource: 'medication_request', action: 'approve', desc: 'Approve medication order' },
  { resource: 'medication_request', action: 'cancel', desc: 'Cancel medication order' },
  // Lab
  { resource: 'lab_result', action: 'read', desc: 'View lab results' },
  { resource: 'lab_result', action: 'create', desc: 'Enter lab results' },
  { resource: 'lab_result', action: 'sign', desc: 'Sign/approve lab results' },
  { resource: 'lab_result', action: 'correct', desc: 'Correct a signed lab result' },
  { resource: 'lab_order', action: 'read', desc: 'View lab orders' },
  { resource: 'lab_order', action: 'create', desc: 'Create lab order' },
  // Prescription
  { resource: 'prescription', action: 'read', desc: 'View prescriptions' },
  { resource: 'prescription', action: 'create', desc: 'Create prescription' },
  { resource: 'prescription', action: 'dispense', desc: 'Dispense medication' },
  { resource: 'prescription', action: 'return', desc: 'Process medication return' },
  // Radiology
  { resource: 'radiology_order', action: 'read', desc: 'View radiology orders' },
  { resource: 'radiology_order', action: 'create', desc: 'Create radiology order' },
  { resource: 'radiology_report', action: 'read', desc: 'View radiology reports' },
  { resource: 'radiology_report', action: 'create', desc: 'Write radiology report' },
  { resource: 'radiology_report', action: 'sign', desc: 'Sign radiology report' },
  // Billing
  { resource: 'billing', action: 'read', desc: 'View billing records' },
  { resource: 'billing', action: 'create', desc: 'Create billing entry' },
  { resource: 'billing', action: 'approve', desc: 'Approve billing charges' },
  { resource: 'billing', action: 'generate_invoice', desc: 'Generate invoice' },
  { resource: 'billing', action: 'void', desc: 'Void a billing entry' },
  { resource: 'insurance_claim', action: 'read', desc: 'View insurance claims' },
  { resource: 'insurance_claim', action: 'create', desc: 'Submit insurance claim' },
  { resource: 'insurance_claim', action: 'update', desc: 'Update insurance claim status' },
  // Discharge
  { resource: 'discharge', action: 'read', desc: 'View discharge summaries' },
  { resource: 'discharge', action: 'create', desc: 'Create discharge summary' },
  { resource: 'discharge', action: 'approve', desc: 'Approve discharge' },
  // ADT (Admission, Discharge, Transfer)
  { resource: 'admission', action: 'read', desc: 'View admissions' },
  { resource: 'admission', action: 'create', desc: 'Create admission' },
  { resource: 'admission', action: 'update', desc: 'Update admission details' },
  { resource: 'transfer', action: 'read', desc: 'View transfers' },
  { resource: 'transfer', action: 'create', desc: 'Create bed/ward transfer' },
  // OT (Operation Theatre)
  { resource: 'ot_schedule', action: 'read', desc: 'View OT schedule' },
  { resource: 'ot_schedule', action: 'create', desc: 'Schedule OT procedure' },
  { resource: 'ot_schedule', action: 'update', desc: 'Modify OT schedule' },
  { resource: 'ot_note', action: 'read', desc: 'View OT notes' },
  { resource: 'ot_note', action: 'create', desc: 'Write OT note' },
  // Audit & Config
  { resource: 'audit_log', action: 'read', desc: 'View audit log' },
  { resource: 'audit_log', action: 'export', desc: 'Export audit log to CSV' },
  { resource: 'config', action: 'read', desc: 'View system configuration' },
  { resource: 'config', action: 'update', desc: 'Modify system configuration' },
  // User & Role management
  { resource: 'user', action: 'read', desc: 'View user list' },
  { resource: 'user', action: 'create', desc: 'Create new user' },
  { resource: 'user', action: 'update', desc: 'Edit user details' },
  { resource: 'user', action: 'suspend', desc: 'Suspend user account' },
  { resource: 'user', action: 'delete', desc: 'Delete user account' },
  { resource: 'user', action: 'reset_password', desc: 'Reset user password' },
  { resource: 'role', action: 'read', desc: 'View roles' },
  { resource: 'role', action: 'update', desc: 'Edit role permissions' },
  { resource: 'role', action: 'create', desc: 'Create new role' },
  // Session management
  { resource: 'session', action: 'read', desc: 'View active sessions' },
  { resource: 'session', action: 'revoke', desc: 'Revoke a single session' },
  { resource: 'session', action: 'revoke_all', desc: 'Revoke all sessions for a user' },
  // Break glass
  { resource: 'break_glass', action: 'request', desc: 'Request emergency access' },
  { resource: 'break_glass', action: 'approve', desc: 'Approve break-glass request' },
  // Dashboard
  { resource: 'dashboard', action: 'read', desc: 'View dashboard' },
  { resource: 'dashboard', action: 'admin', desc: 'Access admin dashboard' },
  // Error log
  { resource: 'error_log', action: 'read', desc: 'View error logs' },
  { resource: 'error_log', action: 'resolve', desc: 'Mark errors as resolved' },
  // Notifications
  { resource: 'notification', action: 'send', desc: 'Send notifications' },
  { resource: 'notification', action: 'subscribe', desc: 'Manage push subscriptions' },
  // Bed management
  { resource: 'bed', action: 'read', desc: 'View bed availability' },
  { resource: 'bed', action: 'assign', desc: 'Assign bed to patient' },
  { resource: 'bed', action: 'release', desc: 'Release bed' },
  // Inventory / Pharmacy stock
  { resource: 'inventory', action: 'read', desc: 'View inventory levels' },
  { resource: 'inventory', action: 'update', desc: 'Update inventory' },
  { resource: 'inventory', action: 'order', desc: 'Create purchase order' },
  // Reports
  { resource: 'report', action: 'read', desc: 'View reports' },
  { resource: 'report', action: 'generate', desc: 'Generate reports' },
  { resource: 'report', action: 'export', desc: 'Export reports' },
  // Care pathway
  { resource: 'care_pathway', action: 'read', desc: 'View care pathways' },
  { resource: 'care_pathway', action: 'create', desc: 'Create care pathway' },
  { resource: 'care_pathway', action: 'update', desc: 'Edit care pathway' },
  // Quality / NABH
  { resource: 'quality_indicator', action: 'read', desc: 'View quality indicators' },
  { resource: 'quality_indicator', action: 'update', desc: 'Update quality indicators' },
  { resource: 'incident_report', action: 'read', desc: 'View incident reports' },
  { resource: 'incident_report', action: 'create', desc: 'Submit incident report' },
];

// ============================================================
// ROLE → PERMISSION MAPPINGS
// ============================================================
// Define which permissions each role gets. Roles not listed get no permissions.
const ROLE_PERMISSION_MAP = {
  // System & Admin — full access
  system_super_admin: '*', // all permissions
  super_admin: '*',
  hospital_admin: [
    'patient.*', 'clinical_note.read', 'medication_request.read', 'lab_result.read', 'lab_order.read',
    'prescription.read', 'radiology_order.read', 'radiology_report.read',
    'billing.*', 'insurance_claim.*', 'discharge.read',
    'admission.*', 'transfer.*', 'ot_schedule.read',
    'audit_log.*', 'config.*', 'user.*', 'role.*', 'session.*',
    'break_glass.approve', 'dashboard.*', 'error_log.*', 'notification.*',
    'bed.*', 'inventory.read', 'report.*', 'quality_indicator.*', 'incident_report.*',
  ],
  // Executive
  coo: [
    'patient.read', 'clinical_note.read', 'billing.read', 'insurance_claim.read',
    'admission.read', 'discharge.read', 'ot_schedule.read',
    'audit_log.read', 'config.read', 'user.read', 'role.read', 'session.read',
    'dashboard.*', 'report.*', 'quality_indicator.*', 'incident_report.read',
    'bed.read', 'inventory.read',
  ],
  cfo: [
    'patient.read', 'billing.*', 'insurance_claim.*',
    'audit_log.read', 'config.read', 'user.read',
    'dashboard.*', 'report.*',
  ],
  medical_director: [
    'patient.*', 'clinical_note.*', 'medication_request.*', 'lab_result.*', 'lab_order.*',
    'prescription.*', 'radiology_order.*', 'radiology_report.*',
    'discharge.*', 'admission.*', 'transfer.*', 'ot_schedule.*', 'ot_note.*',
    'audit_log.read', 'config.read', 'user.read', 'role.read', 'session.read',
    'break_glass.approve', 'dashboard.*', 'report.*',
    'care_pathway.*', 'quality_indicator.*', 'incident_report.*', 'bed.read',
  ],
  hospital_director: [
    'patient.read', 'billing.read', 'insurance_claim.read',
    'audit_log.read', 'config.read', 'user.read',
    'dashboard.*', 'report.*', 'quality_indicator.read', 'incident_report.read',
  ],
  // Department head — wide clinical + admin view
  department_head: [
    'patient.*', 'clinical_note.*', 'medication_request.read', 'lab_result.read', 'lab_order.read',
    'prescription.read', 'radiology_order.read', 'radiology_report.read',
    'billing.read', 'discharge.read', 'admission.read', 'transfer.read',
    'ot_schedule.read', 'ot_note.read',
    'audit_log.read', 'user.read',
    'dashboard.*', 'report.read', 'report.generate',
    'quality_indicator.read', 'incident_report.*', 'bed.read',
  ],
  operations_manager: [
    'patient.read', 'billing.read', 'admission.read', 'transfer.read', 'discharge.read',
    'ot_schedule.read', 'bed.*', 'inventory.*',
    'audit_log.read', 'user.read', 'dashboard.*', 'report.*',
    'quality_indicator.*', 'incident_report.*',
  ],
  hr_manager: ['user.*', 'audit_log.read', 'dashboard.read', 'report.read'],
  compliance_officer: [
    'audit_log.*', 'quality_indicator.*', 'incident_report.*',
    'config.read', 'user.read', 'dashboard.*', 'report.*',
  ],
  data_officer: [
    'audit_log.*', 'error_log.*', 'config.read', 'user.read',
    'dashboard.read', 'report.*',
  ],
  // Clinical roles
  senior_resident: [
    'patient.*', 'clinical_note.*', 'medication_request.*', 'lab_result.read', 'lab_order.create', 'lab_order.read',
    'prescription.read', 'prescription.create',
    'radiology_order.read', 'radiology_order.create', 'radiology_report.read',
    'discharge.read', 'discharge.create',
    'admission.read', 'admission.create', 'transfer.read', 'transfer.create',
    'ot_schedule.read', 'ot_note.*',
    'dashboard.read', 'bed.read', 'care_pathway.read', 'incident_report.create',
    'break_glass.request',
  ],
  resident: [
    'patient.read', 'patient.update', 'clinical_note.*',
    'medication_request.read', 'medication_request.create',
    'lab_result.read', 'lab_order.read', 'lab_order.create',
    'prescription.read', 'prescription.create',
    'radiology_order.read', 'radiology_order.create', 'radiology_report.read',
    'discharge.read', 'discharge.create',
    'admission.read', 'transfer.read',
    'ot_schedule.read', 'ot_note.create', 'ot_note.read',
    'dashboard.read', 'bed.read', 'care_pathway.read', 'incident_report.create',
    'break_glass.request',
  ],
  intern: [
    'patient.read', 'clinical_note.read', 'clinical_note.create',
    'medication_request.read', 'lab_result.read', 'lab_order.read',
    'prescription.read', 'radiology_order.read', 'radiology_report.read',
    'admission.read', 'discharge.read', 'ot_schedule.read', 'ot_note.read',
    'dashboard.read', 'bed.read', 'care_pathway.read',
  ],
  visiting_consultant: [
    'patient.read', 'clinical_note.*',
    'medication_request.read', 'medication_request.create',
    'lab_result.read', 'lab_order.read', 'lab_order.create',
    'prescription.read', 'prescription.create',
    'radiology_order.read', 'radiology_report.read',
    'discharge.read', 'discharge.create',
    'ot_schedule.read', 'ot_note.*',
    'dashboard.read', 'break_glass.request',
  ],
  specialist_cardiologist: 'senior_resident', // inherit
  specialist_neurologist: 'senior_resident',
  specialist_orthopedic: 'senior_resident',
  hospitalist: 'senior_resident',
  // Nursing
  senior_nurse: [
    'patient.read', 'patient.update', 'clinical_note.read', 'clinical_note.create',
    'medication_request.read', 'lab_result.read', 'lab_order.read',
    'prescription.read', 'prescription.dispense',
    'admission.read', 'transfer.read', 'discharge.read',
    'ot_schedule.read', 'ot_note.read',
    'dashboard.read', 'bed.read', 'bed.assign', 'bed.release',
    'care_pathway.read', 'incident_report.create', 'incident_report.read',
  ],
  nurse: [
    'patient.read', 'clinical_note.read', 'clinical_note.create',
    'medication_request.read', 'lab_result.read',
    'prescription.read',
    'admission.read', 'discharge.read',
    'ot_schedule.read', 'ot_note.read',
    'dashboard.read', 'bed.read',
    'care_pathway.read', 'incident_report.create',
  ],
  nursing_assistant: [
    'patient.read', 'clinical_note.read', 'medication_request.read',
    'admission.read', 'dashboard.read', 'bed.read', 'incident_report.create',
  ],
  charge_nurse: 'senior_nurse',
  nursing_supervisor: 'senior_nurse',
  nursing_manager: [
    'patient.read', 'clinical_note.read',
    'medication_request.read', 'lab_result.read',
    'admission.read', 'discharge.read',
    'user.read', 'dashboard.*', 'bed.*',
    'report.read', 'report.generate',
    'quality_indicator.read', 'incident_report.*',
  ],
  // Pharmacy
  chief_pharmacist: [
    'patient.read', 'medication_request.*', 'prescription.*',
    'lab_result.read', 'inventory.*',
    'dashboard.read', 'report.read', 'report.generate',
    'incident_report.create',
  ],
  senior_pharmacist: [
    'patient.read', 'medication_request.read', 'medication_request.approve',
    'prescription.*', 'inventory.read', 'inventory.update',
    'dashboard.read', 'incident_report.create',
  ],
  pharmacist: [
    'patient.read', 'medication_request.read',
    'prescription.read', 'prescription.dispense', 'prescription.return',
    'inventory.read', 'dashboard.read', 'incident_report.create',
  ],
  pharmacy_technician: [
    'patient.read', 'medication_request.read', 'prescription.read',
    'inventory.read', 'dashboard.read',
  ],
  // Lab
  lab_director: [
    'patient.read', 'lab_result.*', 'lab_order.*',
    'user.read', 'dashboard.*', 'report.read', 'report.generate',
    'quality_indicator.read', 'incident_report.*', 'inventory.read',
  ],
  senior_lab_technician: [
    'patient.read', 'lab_result.*', 'lab_order.read',
    'dashboard.read', 'incident_report.create',
  ],
  lab_technician: [
    'patient.read', 'lab_result.read', 'lab_result.create', 'lab_order.read',
    'dashboard.read', 'incident_report.create',
  ],
  phlebotomist: [
    'patient.read', 'lab_order.read', 'lab_result.read',
    'dashboard.read',
  ],
  lab_manager: [
    'patient.read', 'lab_result.read', 'lab_order.read',
    'user.read', 'inventory.*', 'dashboard.*',
    'report.read', 'report.generate', 'quality_indicator.read', 'incident_report.*',
  ],
  // Radiology
  chief_radiologist: [
    'patient.read', 'radiology_order.*', 'radiology_report.*',
    'clinical_note.read', 'lab_result.read',
    'user.read', 'dashboard.*', 'report.read', 'report.generate',
    'quality_indicator.read', 'incident_report.*',
  ],
  senior_radiologist: [
    'patient.read', 'radiology_order.read', 'radiology_report.*',
    'clinical_note.read', 'lab_result.read',
    'dashboard.read', 'incident_report.create',
  ],
  radiologist: [
    'patient.read', 'radiology_order.read', 'radiology_report.read', 'radiology_report.create',
    'clinical_note.read', 'dashboard.read', 'incident_report.create',
  ],
  radiology_technician: [
    'patient.read', 'radiology_order.read', 'radiology_report.read',
    'dashboard.read',
  ],
  // Billing
  billing_manager: [
    'patient.read', 'billing.*', 'insurance_claim.*',
    'admission.read', 'discharge.read',
    'user.read', 'dashboard.*', 'report.*',
    'audit_log.read',
  ],
  billing_executive: [
    'patient.read', 'billing.read', 'billing.create', 'billing.generate_invoice',
    'insurance_claim.*', 'admission.read', 'discharge.read',
    'dashboard.read', 'report.read',
  ],
  insurance_coordinator: [
    'patient.read', 'billing.read', 'insurance_claim.*',
    'admission.read', 'discharge.read',
    'dashboard.read', 'report.read',
  ],
  financial_analyst: [
    'billing.read', 'insurance_claim.read',
    'dashboard.*', 'report.*', 'audit_log.read',
  ],
  accounts_manager: [
    'billing.*', 'insurance_claim.read',
    'dashboard.*', 'report.*',
  ],
  // Support
  receptionist: [
    'patient.read', 'patient.create', 'patient.update',
    'admission.read', 'admission.create', 'bed.read', 'bed.assign',
    'dashboard.read',
  ],
  security_personnel: ['dashboard.read', 'incident_report.create'],
  housekeeping_supervisor: ['bed.read', 'dashboard.read', 'incident_report.create'],
  staff: ['dashboard.read'],
};

// ============================================================
// SEED LOGIC
// ============================================================

async function seed() {
  console.log('🌱 Seeding RBAC tables...\n');

  // 1. Check if roles already exist
  const existingRoles = await sql`SELECT count(*) as cnt FROM roles`;
  if (existingRoles[0].cnt > 0) {
    console.log(`⚠️  Found ${existingRoles[0].cnt} existing roles. Clearing and re-seeding...`);
    await sql`DELETE FROM role_permissions`;
    await sql`DELETE FROM permissions`;
    await sql`DELETE FROM roles`;
  }

  // 2. Insert roles
  console.log(`📋 Inserting ${ROLES.length} roles...`);
  for (const role of ROLES) {
    await sql`
      INSERT INTO roles (hospital_id, name, description, role_group, session_timeout_minutes, is_active, is_system_role)
      VALUES ('EHRC', ${role.name}, ${role.desc}, ${role.group}, ${role.timeout}, true, ${role.system})
    `;
  }
  console.log(`   ✅ ${ROLES.length} roles inserted`);

  // 3. Insert permissions
  console.log(`🔑 Inserting ${PERMISSIONS.length} permissions...`);
  for (const perm of PERMISSIONS) {
    await sql`
      INSERT INTO permissions (resource, action, description, is_system_permission)
      VALUES (${perm.resource}, ${perm.action}, ${perm.desc}, true)
    `;
  }
  console.log(`   ✅ ${PERMISSIONS.length} permissions inserted`);

  // 4. Fetch IDs for mapping
  const roleRows = await sql`SELECT id, name FROM roles WHERE hospital_id = 'EHRC'`;
  const permRows = await sql`SELECT id, resource, action FROM permissions`;

  const roleMap = {};
  for (const r of roleRows) roleMap[r.name] = r.id;
  const permMap = {};
  for (const p of permRows) permMap[`${p.resource}.${p.action}`] = p.id;

  const allPermKeys = Object.keys(permMap);

  // 5. Resolve permission patterns (wildcard expansion + inheritance)
  function resolvePermissions(spec) {
    if (spec === '*') return allPermKeys;
    if (typeof spec === 'string' && ROLE_PERMISSION_MAP[spec]) {
      // Inheritance: role inherits another role's permissions
      return resolvePermissions(ROLE_PERMISSION_MAP[spec]);
    }
    const result = new Set();
    for (const pattern of spec) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        for (const key of allPermKeys) {
          if (key.startsWith(prefix + '.')) result.add(key);
        }
      } else if (allPermKeys.includes(pattern)) {
        result.add(pattern);
      }
    }
    return [...result];
  }

  // 6. Insert role_permissions
  let mappingCount = 0;
  for (const [roleName, spec] of Object.entries(ROLE_PERMISSION_MAP)) {
    const roleId = roleMap[roleName];
    if (!roleId) {
      console.warn(`   ⚠️  Role "${roleName}" not found in DB, skipping`);
      continue;
    }
    const permKeys = resolvePermissions(spec);
    for (const key of permKeys) {
      const permId = permMap[key];
      if (!permId) continue;
      await sql`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (${roleId}, ${permId})
        ON CONFLICT DO NOTHING
      `;
      mappingCount++;
    }
  }
  console.log(`🔗 Inserted ${mappingCount} role→permission mappings`);

  // Summary
  console.log(`\n✅ RBAC seed complete:`);
  console.log(`   ${ROLES.length} roles | ${PERMISSIONS.length} permissions | ${mappingCount} mappings`);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
