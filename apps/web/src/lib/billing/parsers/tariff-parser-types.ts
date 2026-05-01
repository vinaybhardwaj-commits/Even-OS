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

/** Map a PDF Service Type string → category + dept_code pair. */
export function classifyServiceType(serviceType: string): { category: string; dept_code: string } {
  const t = serviceType.trim().toLowerCase();
  switch (t) {
    case 'lab':                 return { category: 'lab',         dept_code: 'LAB' };
    case 'radiology':           return { category: 'radiology',   dept_code: 'RADIO' };
    case 'cardiology':          return { category: 'cardiology',  dept_code: 'CARDIO' };
    case 'urology':             return { category: 'urology',     dept_code: 'URO' };
    case 'orthopeadic':         // PDF spelling
    case 'orthopedic':          return { category: 'orthopedic',  dept_code: 'ORTHO' };
    case 'accident':            return { category: 'emergency',   dept_code: 'ER' };
    case 'administrative':      return { category: 'admin',       dept_code: 'ADMIN' };
    default: {
      // Unknown — coerce to a slug; cashier review can fix later.
      const slug = t.replace(/[^a-z]/g, '_').slice(0, 30) || 'unknown';
      return { category: slug, dept_code: 'UNCLASSIFIED' };
    }
  }
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
