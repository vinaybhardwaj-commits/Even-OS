// =============================================================================
// BV3 Phase 4 — Bill builder aggregator
// =============================================================================
// buildBillFromEncounter(encounter_id) reads charge_items for the encounter,
// groups by category, computes subtotals + GST + grand total, and returns
// the canonical aggregator output that the bills router INSERTs into the
// bills + bill_lines tables.
//
// Aggregation rule (per A3 lock):
//   1. service-backed lines (service_id IS NOT NULL) → category from
//      service_codes.service_type_code (PR, LB, IM, PK, etc.)
//   2. item-backed lines (item_id IS NOT NULL) → category from
//      inventory_items.item_type
//   3. legacy/no-bridge lines → fallback to source_module
//
// Phase 4: NO rule-engine evaluation here (Phase 4.B / future). The
// aggregator captures the existing line_total + gst_amount as already
// frozen at emit time per Q1.
// =============================================================================

import { db } from '@/lib/db';
import { chargeItems, serviceCodes, inventoryItems } from '@db/schema';
import { and, eq, isNull, ne } from 'drizzle-orm';

export interface BillCategoryGroup {
  category: string;
  category_label: string;
  line_count: number;
  subtotal_inr: number;
  gst_amount_inr: number;
  total_inr: number;
  display_order: number;
  /** Underlying charge_items (decorated with display info). */
  lines: BillCategoryLine[];
}

export interface BillCategoryLine {
  charge_item_id: string;
  charge_code: string;
  display_name: string;
  quantity: number;
  unit_price_inr: number;
  line_total_inr: number;
  gst_percentage: number;
  gst_amount_inr: number;
  source_module: string;
  posted_at: string | Date;
}

export interface BuildBillResult {
  encounter_id: string;
  billing_account_id: string;
  patient_id: string;
  hospital_id: string;
  /** Total before concession (subtotal + gst). */
  subtotal_inr: number;
  gst_amount_inr: number;
  total_amount_inr: number;
  /** Number of distinct charge_items aggregated. */
  charge_items_count: number;
  /** Charge_items skipped (reversed / void). */
  charge_items_skipped: number;
  /** Categories with their lines. Sorted by display_order. */
  categories: BillCategoryGroup[];
}

/** Display ordering + label for known categories. */
const CATEGORY_META: Record<string, { label: string; order: number }> = {
  // service_type_codes
  CN: { label: 'Consultation',    order: 10 },
  PR: { label: 'Procedures',      order: 20 },
  LB: { label: 'Laboratory',      order: 30 },
  IM: { label: 'Imaging',         order: 40 },
  PK: { label: 'Packages',        order: 50 },
  BD: { label: 'Bed charges',     order: 60 },
  RM: { label: 'Room charges',    order: 61 },
  FE: { label: 'Fees',            order: 70 },
  XX: { label: 'Other',           order: 80 },
  // inventory_items.item_type fallback
  drug: { label: 'Pharmacy',           order: 25 },
  consumable: { label: 'Consumables',  order: 35 },
  implant: { label: 'Implants',        order: 45 },
  general: { label: 'General items',   order: 55 },
  // source_module fallback
  pharmacy: { label: 'Pharmacy',                   order: 25 },
  lab: { label: 'Laboratory',                       order: 30 },
  ot: { label: 'OT',                                order: 22 },
  room: { label: 'Room charges',                    order: 61 },
  package: { label: 'Packages',                     order: 50 },
  er_obs: { label: 'ER Observation',                order: 65 },
  mortuary: { label: 'Mortuary',                    order: 75 },
  admission: { label: 'Admission',                  order: 5 },
  adjustment: { label: 'Adjustments',               order: 90 },
  manual: { label: 'Other (manual)',                order: 80 },
  scm: { label: 'Consumables (SCM)',                order: 35 },
  facilities: { label: 'Facilities',                order: 56 },
  consultation: { label: 'Consultation',            order: 10 },
  discharge: { label: 'Discharge adjustments',      order: 95 },
};

function categoryFor(item: {
  service_type_code?: string | null;
  item_type?: string | null;
  source_module: string;
}): { category: string; meta: { label: string; order: number } } {
  if (item.service_type_code) {
    const cat = item.service_type_code;
    return { category: cat, meta: CATEGORY_META[cat] ?? { label: cat, order: 99 } };
  }
  if (item.item_type) {
    const cat = item.item_type.toLowerCase();
    return { category: cat, meta: CATEGORY_META[cat] ?? { label: item.item_type, order: 99 } };
  }
  // Fallback to source_module
  const cat = item.source_module;
  return { category: cat, meta: CATEGORY_META[cat] ?? { label: cat, order: 99 } };
}

export async function buildBillFromEncounter(args: {
  hospital_id: string;
  encounter_id: string;
  billing_account_id: string;
  patient_id: string;
  /** When true, include 'reversed' status charge_items for audit display; default excludes them. */
  include_reversed?: boolean;
}): Promise<BuildBillResult> {
  const includeReversed = args.include_reversed ?? false;

  // Pull charge_items for this encounter, joined to service_codes / inventory_items
  // for category resolution.
  const rows = await db
    .select({
      charge_item_id: chargeItems.id,
      charge_code: chargeItems.charge_code,
      display_name: chargeItems.charge_name,
      quantity: chargeItems.quantity,
      unit_price_inr: chargeItems.unit_price,
      line_total_inr: chargeItems.line_total,
      gst_percentage: chargeItems.gst_percentage,
      gst_amount_inr: chargeItems.gst_amount,
      source_module: chargeItems.source_module,
      status: chargeItems.status,
      posted_at: chargeItems.posted_at,
      service_id: chargeItems.service_id,
      item_id: chargeItems.item_id,
      service_type_code: serviceCodes.service_type_code,
      item_type: inventoryItems.item_type,
    })
    .from(chargeItems)
    .leftJoin(serviceCodes, eq(chargeItems.service_id, serviceCodes.id))
    .leftJoin(inventoryItems, eq(chargeItems.item_id, inventoryItems.id))
    .where(and(
      eq(chargeItems.hospital_id, args.hospital_id),
      eq(chargeItems.encounter_id, args.encounter_id),
    ));

  let subtotal = 0;
  let gstTotal = 0;
  let count = 0;
  let skipped = 0;
  const groups = new Map<string, BillCategoryGroup>();

  for (const r of rows) {
    if (r.status === 'reversed' && !includeReversed) { skipped++; continue; }
    if (r.status === 'void') { skipped++; continue; }
    count++;

    const lineTotal = parseFloat(String(r.line_total_inr));
    const gstAmount = parseFloat(String(r.gst_amount_inr));
    subtotal += lineTotal - gstAmount;
    gstTotal += gstAmount;

    const { category, meta } = categoryFor({
      service_type_code: r.service_type_code,
      item_type: r.item_type,
      source_module: r.source_module,
    });

    const existing = groups.get(category);
    const line: BillCategoryLine = {
      charge_item_id: r.charge_item_id,
      charge_code: r.charge_code,
      display_name: r.display_name,
      quantity: parseFloat(String(r.quantity)),
      unit_price_inr: parseFloat(String(r.unit_price_inr)),
      line_total_inr: lineTotal,
      gst_percentage: parseFloat(String(r.gst_percentage)),
      gst_amount_inr: gstAmount,
      source_module: r.source_module,
      posted_at: r.posted_at,
    };

    if (existing) {
      existing.line_count++;
      existing.subtotal_inr += lineTotal - gstAmount;
      existing.gst_amount_inr += gstAmount;
      existing.total_inr += lineTotal;
      existing.lines.push(line);
    } else {
      groups.set(category, {
        category,
        category_label: meta.label,
        line_count: 1,
        subtotal_inr: lineTotal - gstAmount,
        gst_amount_inr: gstAmount,
        total_inr: lineTotal,
        display_order: meta.order,
        lines: [line],
      });
    }
  }

  const categories = [...groups.values()].sort((a, b) => a.display_order - b.display_order);

  return {
    encounter_id: args.encounter_id,
    billing_account_id: args.billing_account_id,
    patient_id: args.patient_id,
    hospital_id: args.hospital_id,
    subtotal_inr: subtotal,
    gst_amount_inr: gstTotal,
    total_amount_inr: subtotal + gstTotal,
    charge_items_count: count,
    charge_items_skipped: skipped,
    categories,
  };
}
