// User role type (mirrors the DB enum)
export type UserRole =
  | 'super_admin' | 'hospital_admin'
  | 'medical_director' | 'department_head'
  | 'attending_physician' | 'resident' | 'rmo'
  | 'nurse_supervisor' | 'nurse' | 'nurse_aide'
  | 'pharmacist' | 'pharmacy_tech'
  | 'lab_tech' | 'lab_supervisor'
  | 'radiologist' | 'radiology_tech'
  | 'billing_manager' | 'billing_executive' | 'insurance_coordinator'
  | 'ot_coordinator' | 'anaesthetist'
  | 'quality_manager' | 'infection_control_nurse'
  | 'front_desk' | 'customer_care'
  | 'supply_chain_manager' | 'facilities_manager'
  | 'hr_manager' | 'marketing_manager'
  | 'dietician' | 'physiotherapist'
  | 'medical_records' | 'it_admin'
  | 'housekeeping_supervisor' | 'security_supervisor'
  | 'staff';

// Session timeout tiers
export const SESSION_TIMEOUTS: Record<string, string> = {
  clinical: '8h',
  admin: '12h',
  executive: '24h',
};

// Rate limiting config
export const RATE_LIMITS = {
  login: { maxAttempts: 5, windowMinutes: 10, lockoutMinutes: 10 },
  api: { maxRequests: 100, windowMinutes: 1 },
  webhook: { maxRequests: 10, windowMinutes: 1 },
};

// Audit action types
export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'ACCESS' | 'EXPORT';
