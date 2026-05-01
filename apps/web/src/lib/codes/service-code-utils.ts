// =============================================================================
// Service code format helpers (Phase 3)
// =============================================================================
// Format (Q2-locked):  S-[ServiceType2]-[Department3-5]-[Serial4]
// Examples:            S-PR-OT-0001 / S-LB-LBI-0001 / S-IM-RAD-0001
//
// Mirrors lib/codes/code-utils.ts (Phase 1 item-code helpers) for symmetry.
// =============================================================================

export const SERVICE_TYPES = ['PR','CN','LB','IM','PK','BD','RM','FE','XX'] as const;
export type ServiceType = typeof SERVICE_TYPES[number];

/** Departments are validated against `service_lookup_departments` server-side; this is just a regex shape check. */
export const SERVICE_DEPT_REGEX = /^[A-Z]{3,5}$/;

/** Full code format regex (matches the SQL CHECK constraint exactly). */
export const SERVICE_CODE_REGEX = /^S-(PR|CN|LB|IM|PK|BD|RM|FE|XX)-([A-Z]{3,5})-(\d{4})$/;

export const SERVICE_CODE_SERIAL_WIDTH = 4;
export const SERVICE_CODE_SERIAL_MAX = 9999;

/**
 * Build a service code from its parts.
 * @throws Error if the parts are invalid.
 */
export function buildServiceCode(args: {
  service_type_code: ServiceType;
  department_code: string;
  serial: number;
}): string {
  if (!SERVICE_TYPES.includes(args.service_type_code)) {
    throw new Error(`Invalid service_type_code: ${args.service_type_code}; must be one of ${SERVICE_TYPES.join('/')}`);
  }
  if (!SERVICE_DEPT_REGEX.test(args.department_code)) {
    throw new Error(`Invalid department_code: ${args.department_code}; must be 3-5 uppercase letters`);
  }
  if (!Number.isInteger(args.serial) || args.serial <= 0 || args.serial > SERVICE_CODE_SERIAL_MAX) {
    throw new Error(`Invalid serial: ${args.serial}; must be 1-${SERVICE_CODE_SERIAL_MAX}`);
  }
  const serialStr = String(args.serial).padStart(SERVICE_CODE_SERIAL_WIDTH, '0');
  return `S-${args.service_type_code}-${args.department_code}-${serialStr}`;
}

/**
 * Parse a service code into its parts. Returns null if the format is invalid.
 */
export function parseServiceCode(code: string): {
  service_type_code: ServiceType;
  department_code: string;
  serial: number;
} | null {
  const m = code.match(SERVICE_CODE_REGEX);
  if (!m) return null;
  return {
    service_type_code: m[1] as ServiceType,
    department_code: m[2],
    serial: parseInt(m[3], 10),
  };
}

/** Bucket key for serial allocation: '<service_type_code>-<department_code>'. */
export function bucketKey(args: { service_type_code: ServiceType; department_code: string }): string {
  return `${args.service_type_code}-${args.department_code}`;
}

/** Validate a service code; returns null if ok, else error message. */
export function validateServiceCode(code: string): string | null {
  if (!SERVICE_CODE_REGEX.test(code)) {
    return `Service code must match S-XX-DEPT-NNNN (got '${code}')`;
  }
  return null;
}

// =============================================================================
// Tariff classifier — Phase 3.5 backfill helper
// =============================================================================
// Maps Phase 1.A.C charge_master_item.{category, dept_code} values into
// canonical (service_type_code, department_code) per Billing Manual taxonomy.
//
// The tariff PDFs used non-canonical dept codes (ER vs EMR, RAD vs RADIO,
// CARDIO vs CAD, ORTHO vs ORT, ADMIN vs ADM). The classifier maps them onto
// the Billing Manual canonical codes.
// =============================================================================

interface ClassifyResult {
  service_type_code: ServiceType;
  department_code: string;
  /** True if the input dept code was non-canonical and got remapped. */
  remapped: boolean;
}

/**
 * Map a tariff charge_master_item ({category, dept_code}) → (service_type, department).
 * Used by scripts/backfill-service-codes.ts.
 */
export function classifyTariffItem(args: {
  category: string;
  dept_code: string;
  charge_code: string;
}): ClassifyResult {
  const cat = (args.category || '').toLowerCase();
  const inputDept = (args.dept_code || '').toUpperCase();

  // Department canonicalization: tariff PDFs used loose names; map to Billing Manual.
  const DEPT_REMAP: Record<string, string> = {
    'ER':       'EMR',     // Phase 1.A used ER, Billing Manual uses EMR
    'RADIO':    'RAD',
    'CARDIO':   'CAD',
    'ORTHO':    'ORT',
    'ADMIN':    'ADM',
    'MORTUARY': 'ADM',     // Mortuary is administrative per Billing Manual
    'LAB':      'LBI',     // Generic 'LAB' from charge prefix; default to Biochemistry sub-area
    'IPD':      'ADM',     // Room codes — admin bucket
  };

  const department_code = DEPT_REMAP[inputDept] ?? inputDept;
  const remapped = department_code !== inputDept;

  // Service type from category. The 'category' field on charge_master_item
  // was set by the Phase 1.A.R parser based on PDF Service Type column.
  let service_type_code: ServiceType;
  switch (cat) {
    case 'lab':         service_type_code = 'LB'; break;
    case 'radiology':   service_type_code = 'IM'; break;
    case 'cardiology':  service_type_code = 'IM'; break; // Cardiology investigations are imaging-class
    case 'urology':     service_type_code = 'PR'; break;
    case 'orthopedic':  service_type_code = 'PR'; break;
    case 'emergency':   service_type_code = 'PR'; break;
    case 'admin':       service_type_code = 'FE'; break;
    case 'mortuary':    service_type_code = 'FE'; break;
    case 'ambulance':   service_type_code = 'FE'; break;
    case 'mlc':         service_type_code = 'FE'; break;
    default:            service_type_code = 'XX'; break;
  }

  return { service_type_code, department_code, remapped };
}

/**
 * Map a charge_master_package row → (service_type='PK', department) using
 * the package_code prefix.
 */
export function classifyTariffPackage(packageCode: string): ClassifyResult {
  // Package codes are like ENT-PKG-001, GEN-PKG-005, OBG-PKG-012, etc.
  const m = packageCode.match(/^([A-Z]+)-PKG-/);
  const inputDept = m ? m[1] : 'XX';

  const DEPT_REMAP: Record<string, string> = {
    'ENT':   'ENT',
    'GEN':   'GEN',
    'OBG':   'OBG',
    'ORT':   'ORT',
    'URO':   'URO',
    'GAS':   'GAS',
    'VAS':   'VAS',
    'NEU':   'NEU',
    'OPTO':  'OPTO',
    'PAS':   'PAS',
    'PLS':   'PLS',
    'CAD':   'CAD',
    'RAD':   'RAD',
    'ONS':   'ONS',
    'ENTSB': 'ENTSB',
  };

  const department_code = DEPT_REMAP[inputDept] ?? inputDept;
  const remapped = !!m && department_code !== inputDept;

  return { service_type_code: 'PK', department_code, remapped };
}

/**
 * Map a charge_master_room row → ('RM' | 'BD', department).
 * EHRC uses 'IPD' bucket conceptually but Billing Manual doesn't list IPD as
 * a department; rooms are admin per the canonical taxonomy.
 */
export function classifyTariffRoom(roomClass: string): ClassifyResult {
  return {
    service_type_code: 'RM',
    department_code: 'ADM', // rooms are admin per Billing Manual taxonomy
    remapped: true,
  };
}
