/**
 * BV3.2.A — shared types for Charge Master PDF probes.
 *
 * These scripts produce the intermediate data that BV3.2.B's server-side
 * importer will accept (as CSV) via `chargeMaster.uploadTariff`. We keep
 * the shapes here, in the dev-script folder, so the importer lib can
 * import them later without pulling in Node-only parsing deps.
 */

/** Class codes accepted by `charge_master_price.class_code`. */
export const CLASS_CODES = [
  'OPD',
  'GENERAL',
  'SEMI_PVT',
  'PVT',
  'SUITE',
  'ICU',
  'HDU',
  '_ANY',
] as const;
export type ClassCode = (typeof CLASS_CODES)[number];

/** 9 room classes from BV3.1 schema + seed. */
export const ROOM_CLASSES = [
  'DAY_CARE',
  'GENERAL',
  'TWIN_SHARING',
  'PRIVATE',
  'SUITE',
  'ICU',
  'HDU',
  'LABOR_OBS',
  'ER_OBS',
] as const;
export type RoomClass = (typeof ROOM_CLASSES)[number];

/** Output of parse-room-rent.ts (one row per room class in the PDF). */
export interface ParsedRoomRow {
  room_class: RoomClass;
  room_class_label: string;
  /** `tariff` in schema = BED CHARGES + NURSING CHARGES (the TOTAL col in PDF). */
  tariff: number;
  /** Kept for audit / future split: BED CHARGES from PDF. */
  bed_charges: number;
  /** Kept for audit: NURSING CHARGES from PDF. */
  nursing_charges: number;
  /** Kept for audit: CONSULTATION from PDF. Not loaded into charge_master_room. */
  consultation: number;
}

/** Output of parse-investigations.ts (one row per Code = charge_master_item). */
export interface ParsedInvestigationRow {
  charge_code: string;
  service_type: string;
  dept_code: string;
  category: string;
  charge_name: string;
  /** OPD/GENERAL/SEMI_PVT/PVT/SUITE/ICU/HDU — 7 keys (HDU duplicates ICU per Q3). */
  prices: Record<ClassCode, number | null>;
}

/** Output of parse-packages.ts (one row per PKG code = charge_master_package). */
export interface ParsedPackageRow {
  package_code: string;
  package_name: string;
  /** Full dept label as it appears in the PDF (e.g. "Orthopaedics"). */
  dept: string;
  /** Short dept_code derived from the code prefix (ENT / GAS / GEN / OBG / ORT / URO / VAS). */
  dept_code: string;
  /** "Total No of Days" column. 0 means unspecified / OPD. */
  duration_days: number;
  /** "ICU" column = ICU days included (always 0 or 1 in current PDF). Flag, not a price. */
  icu_days: number;
  /** All rows in current PDF have Suite = "Open Billing".  Left as an option for future PDFs. */
  suite_open_billing: boolean;
  /**
   * Per-class prices: GENERAL / SEMI_PVT / PVT are populated from PDF cols.
   * ICU + SUITE stay null when the package is open-billing for those classes.
   * Only the 5 class codes relevant for packages appear here.
   */
  prices: Partial<Record<ClassCode, number | null>>;
}

/** A row the parser could NOT parse — dumped to a .rejects.csv for human review. */
export interface ParseReject {
  lineno: number;
  raw_line: string;
  reason: string;
}

/** Summary emitted by every parser script. */
export interface ParseSummary {
  source_file: string;
  parsed: number;
  rejected: number;
  duration_ms: number;
  output_json: string;
  output_csv: string;
  reject_csv?: string;
}
