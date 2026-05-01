// =============================================================================
// Codes — charge tier resolver
// =============================================================================
// Pure helpers for resolving the current charge tier for a (code, class,
// empanelment, date) tuple. Mirrors the BV3 charge_master_price.effective_from
// + effective_to semantic but unified across items + services.
//
// Used by codes.chargeTiers.tierAt and BV3's bill posting (Phase 4.B+).
// =============================================================================

export interface ChargeTierRow {
  id: string;
  service_id: string | null;
  item_id: string | null;
  code_kind: 'item' | 'service';
  class_code: string;
  empanelment_id: string | null;
  effective_from: string | Date;
  effective_to: string | Date | null;
  price_inr: string | number;
  is_open_billing: boolean;
  package_member_count: number;
  gst_percentage: string | number;
}

/**
 * From a flat array of tier rows, pick the one in effect at `at` for a
 * given (target_id, class_code, empanelment_id) coordinate.
 *
 * Resolution rules:
 *   1. Filter rows where effective_from <= at AND (effective_to IS NULL OR effective_to >= at)
 *   2. Filter rows matching class_code + empanelment_id (null = standard tier)
 *   3. Sort by effective_from DESC; return the first row.
 *
 * Returns null when no row matches.
 */
export function tierAt(args: {
  rows: ChargeTierRow[];
  target: { service_id?: string; item_id?: string };
  class_code: string;
  empanelment_id?: string | null;
  at?: Date;
}): ChargeTierRow | null {
  const at = args.at ?? new Date();
  const targetMatch = (r: ChargeTierRow) =>
    args.target.service_id ? r.service_id === args.target.service_id : r.item_id === args.target.item_id;
  const classMatch = (r: ChargeTierRow) => r.class_code === args.class_code;
  const empMatch = (r: ChargeTierRow) => {
    if (args.empanelment_id == null) return r.empanelment_id == null;
    return r.empanelment_id === args.empanelment_id;
  };
  const inWindow = (r: ChargeTierRow) => {
    const ef = new Date(r.effective_from);
    if (ef.getTime() > at.getTime()) return false;
    if (r.effective_to == null) return true;
    return new Date(r.effective_to).getTime() >= at.getTime();
  };
  const matches = args.rows.filter((r) => targetMatch(r) && classMatch(r) && empMatch(r) && inWindow(r));
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime());
  return matches[0];
}

/**
 * Empanelment override resolution: prefer empanelment-specific tier; fall back
 * to standard tier when empanelment-specific row is absent.
 *
 * Mirrors Q6 rule 21 — empanelment_override_resolution applied AFTER tariff lookup.
 */
export function resolveTierWithEmpanelment(args: {
  rows: ChargeTierRow[];
  target: { service_id?: string; item_id?: string };
  class_code: string;
  empanelment_id: string | null;
  at?: Date;
}): { tier: ChargeTierRow | null; resolved_via: 'empanelment_override' | 'standard' | 'none' } {
  if (args.empanelment_id) {
    const empOverride = tierAt({ ...args, empanelment_id: args.empanelment_id });
    if (empOverride) return { tier: empOverride, resolved_via: 'empanelment_override' };
  }
  const standard = tierAt({ ...args, empanelment_id: null });
  if (standard) return { tier: standard, resolved_via: 'standard' };
  return { tier: null, resolved_via: 'none' };
}

/**
 * Validate exactly-one-FK invariant in JS — useful for tests + import-time
 * checks before hitting the DB CHECK constraint.
 */
export function validateExactlyOneFk(row: { item_id?: string | null; service_id?: string | null; code_kind?: string }): string | null {
  const hasItem = !!row.item_id;
  const hasService = !!row.service_id;
  if (hasItem && hasService) return 'both item_id and service_id set; exactly one expected';
  if (!hasItem && !hasService) return 'neither item_id nor service_id set; exactly one expected';
  if (row.code_kind === 'item' && !hasItem) return "code_kind='item' but item_id is NULL";
  if (row.code_kind === 'service' && !hasService) return "code_kind='service' but service_id is NULL";
  return null;
}
