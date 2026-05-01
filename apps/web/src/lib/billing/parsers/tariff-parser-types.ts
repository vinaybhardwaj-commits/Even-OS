// =============================================================================
// Tariff parser — shared types
// =============================================================================
// All BV3.1.A parsers normalize to one of three record shapes that map cleanly
// to charge_master_room / charge_master_package / charge_master_item +
// charge_master_price.
// =============================================================================

/** Room tariff row (one per room class). */
export interface RoomTariffRecord {
  /** Schema room_class. */
  room_class: 'DAY_CARE' | 'GENERAL' | 'TWIN_SHARING' | 'PRIVATE' | 'SUITE' | 'ICU' | 'HDU' | 'LABOR_OBS' | 'ER_OBS';
  /** Display label as it appeared in the PDF. */
  room_class_label: string;
  /** Daily total tariff (BED + NURSING). */
  tariff: number;
  /** Bed-only charge component. Captured for future split. */
  bed_charges?: number;
  /** Nursing component. */
  nursing_charges?: number;
  /** Consultation component. Used by consultation auto-post (Phase 4). */
  consultation_charge?: number;
  /** day | 6hr | 2hr — defaults applied per existing seed convention. */
  billing_unit: 'day' | '6hr' | '2hr';
}

/** One package row from the package PDF. */
export interface PackageTariffRecord {
  /** e.g. ENT-PKG-001 */
  package_code: string;
  /** Department prefix from CODES — e.g. ENT, GS, ORTHO. */
  dept_code: string;
  /** Free-form package name. */
  package_name: string;
  /** No. of days field. 0 = day-care. */
  total_days: number;
  /** Per-class prices. Class names follow charge_master_price.class_code. */
  prices: Partial<Record<'GENERAL' | 'SEMI_PVT' | 'PVT' | 'ICU', number>>;
  /** Suite class is often 'Open Billing' instead of a fixed price. */
  suite_open_billing: boolean;
  /** If suite is a fixed amount, captured here; else null. */
  suite_price: number | null;
}

/** One charge_master_item row plus its 6 prices (per investigation row). */
export interface InvestigationTariffRecord {
  /** Charge code (e.g. LHA00001, RAD00123, ADM00007). */
  charge_code: string;
  /** Free-form item name. */
  charge_name: string;
  /** Service Type column → category ('lab', 'radiology', 'cardiology', 'emergency', 'admin', etc). */
  category: string;
  /** Department code derived from category (LAB, RADIO, CARDIO, etc). */
  dept_code: string;
  /** Per-class prices. ICU + HDU share "All ICU" PDF column. */
  prices: Partial<Record<'OPD' | 'GENERAL' | 'SEMI_PVT' | 'PVT' | 'SUITE' | 'ICU' | 'HDU', number>>;
  /**
   * 'active' = at least one non-zero price; 'pending_finance' = item exists in
   * tariff list but Finance hasn't priced it yet (e.g. Medical Certificate
   * Charges). 'pending_finance' rows insert into charge_master_item with
   * status='pending_finance' and write zero charge_master_price rows.
   */
  status: 'active' | 'pending_finance';
  /**
   * Provenance tag for parser diagnostics. 'inline' = code + data on one
   * physical line; 'orphan_pair' = code on its own line, data on the line
   * immediately above; 'pending_finance' = code + Service Type + Name on the
   * code line, no prices. Useful for QA + audit reports.
   */
  source_pattern: 'inline' | 'orphan_pair' | 'pending_finance';
}

/** Result envelope returned by every parser. */
export interface ParseResult<T> {
  records: T[];
  /** Lines that the parser saw but couldn't interpret — for review. */
  skipped: Array<{ line: string; reason: string; line_no: number }>;
  /** Lines that look like records but failed validation. */
  errored: Array<{ line: string; reason: string; line_no: number }>;
  /** Total non-blank lines processed. */
  lines_total: number;
}

/**
 * Known PDF Service Type strings — ordered LONGEST-FIRST so multi-token
 * matches win over single-token prefixes (e.g. "Accident & ER" before
 * "Accident", "Administrative Mortuary" before "Administrative").
 *
 * Verified against the full investigations PDF as of 1 May 2026.
 */
export const KNOWN_SERVICE_TYPES = [
  'Administrative Mortuary',
  'Accident & ER',
  'Administrative',
  'Cardiology',
  'Orthopeadic', // PDF spelling
  'Orthopedic',
  'Radiology',
  'Urology',
  'LAB',
] as const;

/** Map a PDF Service Type string → category + dept_code pair. */
export function classifyServiceType(serviceType: string): { category: string; dept_code: string } {
  const t = serviceType.trim().toLowerCase();
  switch (t) {
    case 'lab':                       return { category: 'lab',         dept_code: 'LAB' };
    case 'radiology':                 return { category: 'radiology',   dept_code: 'RADIO' };
    case 'cardiology':                return { category: 'cardiology',  dept_code: 'CARDIO' };
    case 'urology':                   return { category: 'urology',     dept_code: 'URO' };
    case 'orthopeadic':               // PDF spelling
    case 'orthopedic':                return { category: 'orthopedic',  dept_code: 'ORTHO' };
    case 'accident':                  // legacy short-form
    case 'accident & er':             return { category: 'emergency',   dept_code: 'ER' };
    case 'administrative':            return { category: 'admin',       dept_code: 'ADMIN' };
    case 'administrative mortuary':   return { category: 'mortuary',    dept_code: 'MORTUARY' };
    default: {
      // Unknown — coerce to a slug; cashier review can fix later.
      const slug = t.replace(/[^a-z]/g, '_').slice(0, 30) || 'unknown';
      return { category: slug, dept_code: 'UNCLASSIFIED' };
    }
  }
}

/**
 * Try to match a known Service Type at the start of `text`. Returns the
 * matched type + remainder (the Name field), or null if nothing matches.
 * Multi-token types win over their prefixes via longest-first ordering.
 */
export function matchServiceTypeAtStart(
  text: string,
): { type: string; name: string } | null {
  const upper = text.toUpperCase();
  for (const candidate of KNOWN_SERVICE_TYPES) {
    const cand = candidate.toUpperCase();
    if (upper.startsWith(cand + ' ') || upper === cand) {
      return {
        type: candidate,
        name: text.slice(candidate.length).trim(),
      };
    }
  }
  return null;
}

/** Map a charge code prefix → fallback dept_code if Service Type is missing. */
export function dept_from_code_prefix(charge_code: string): string {
  const prefix = charge_code.slice(0, 3).toUpperCase();
  if (prefix.startsWith('L')) return 'LAB';
  if (prefix === 'RAD')        return 'RADIO';
  if (prefix === 'CAD')        return 'CARDIO';
  if (prefix === 'EMR')        return 'ER';
  if (prefix === 'ADM')        return 'ADMIN';
  if (prefix === 'AMB')        return 'AMB';
  return 'UNCLASSIFIED';
}
