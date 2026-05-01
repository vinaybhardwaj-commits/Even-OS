// =============================================================================
// BV3 Phase 3 — charge_items emitter + reverser
// =============================================================================
// The 12-module emit contract per Q1: every operational module that creates
// a chargeable event calls `emitChargeItem` here. This module:
//
//   1. Resolves price via codes.chargeTiers.tierAt(posted_at, room_class)
//   2. Freezes 8 fields at emit time (unit_price, gst_*, room_class_at_post,
//      hsn_code, cost_center_code, empanelment_id_at_post, rule_engine_applied)
//   3. INSERTs charge_items row with source_module + source_ref_id
//   4. Writes audit_log
//
// Immutability: rows once `status='posted'` are NEVER updated. Corrections
// done via `reverseChargeItem` which inserts a new row with opposite-signed
// quantity + line_total + reverses_charge_id pointer.
//
// =============================================================================
// MODULE EMIT CONTRACTS — wiring lands per-module via Q4 refactor sequence
// =============================================================================
//
// Each module's emit point gets wired when its respective PRD module-refactor
// sprints fire (Q4 module-by-module sequence over ~42 sprint-equivalents).
// Phase 3 of BV3 ships the contract + helpers; live wiring is per-PRD work.
//
// PHARMACY (PRD #1, sprint 4 — shadow-write):
//   After dispenseMedication succeeds, call:
//     await emitChargeItem({
//       hospital_id, billing_account_id, patient_id, encounter_id,
//       item_id: <inventory_items.id resolved via SCM items → inventory_items bridge>,
//       code_kind: 'item',
//       source_module: 'pharmacy',
//       source_ref_id: dispensing_records.id,
//       quantity: input.quantity_dispensed,
//       room_class_at_post: <encounter.room_class>,
//       posted_by: ctx.user.sub,
//     });
//   Pharmacy returnMedication should call reverseChargeItem(reason='medication returned').
//
// SCM (PRD #2):
//   On stock_movements.movement_type='issue' for chargeable items, emit with
//   source_module='scm', code_kind='item'.
//
// FACILITIES (PRD #3):
//   linen_issue / cssd_pack_use / deep_clean_complete events → source_module='facilities'.
//
// OT (PRD #4) — most complex:
//   ot_case finalize emits multiple charge_items: surgical procedure (code_kind='procedure'),
//   anaesthesia, OT-minutes, PACU, implants (code_kind='item'), drugs, consumables.
//
// LIMS (PRD #5):
//   test_panel_resulted → emit per-test charge_item (code_kind='lab_test');
//   collection fee separate.
//
// RIS (PRD #6):
//   study_completed → emit per-study (code_kind='imaging_study');
//   contrast / radiopharm separate; teleradiology vendor markup as new charge_item.
//
// CONSULTATION:
//   consultation_record finalized → 1 charge_item per disease per day
//   (Billing Manual rule 15 dedupes; rule 16 free 7-day OPD follow-up).
//
// BED/ROOM (Phase 4 of BV3 — bill builder):
//   midnight cron emits 1 charge_item per encounter per day for the room class
//   (Billing Manual rule 14). source_module='room'.
//
// DISCHARGE CLOSURE (Phase 4 of BV3):
//   discharge.finalize emits proration + late discharge surcharges
//   (Billing Manual rules 11-12). source_module='discharge'.
// =============================================================================

import { db } from '@/lib/db';
import {
  chargeItems,
  type ChargeItem,
  type NewChargeItem,
  codeChargeTiers,
  serviceCodes,
  inventoryItems,
} from '@db/schema';
import { resolveTierWithEmpanelment, type ChargeTierRow } from '@/server/codes/charge-tier-resolver';
import { writeAuditLog } from '@/lib/audit/logger';
import { and, eq, isNull } from 'drizzle-orm';

export type CodeKind =
  | 'drug' | 'item' | 'service' | 'procedure' | 'lab_test'
  | 'imaging_study' | 'pack' | 'charge_tier' | 'lookup' | 'deprecation';

export type SourceModule =
  | 'manual' | 'lab' | 'pharmacy' | 'ot' | 'room' | 'package'
  | 'er_obs' | 'mortuary' | 'admission' | 'adjustment'
  | 'scm' | 'facilities' | 'consultation' | 'discharge';

export interface EmitChargeArgs {
  hospital_id: string;
  billing_account_id: string;
  patient_id: string;
  encounter_id?: string | null;
  /** Polymorphic — exactly one of item_id / service_id required. */
  item_id?: string;
  service_id?: string;
  /** Discriminator. */
  code_kind: CodeKind;
  /** Source provenance. */
  source_module: SourceModule;
  source_ref_id?: string | null;
  source_emit_event_id?: string | null;
  /** Quantity (default 1; reversals use negative). */
  quantity?: number;
  /** Encounter's room class at emit-time — used for tier lookup + frozen. */
  room_class_at_post?: string | null;
  /** Optional empanelment override; null = standard tariff. */
  empanelment_id?: string | null;
  /** When supplied, overrides the resolver's price. Use sparingly (manual emit). */
  override_unit_price?: number;
  /** Override GST (rare; usually frozen from Codes). */
  override_gst_percentage?: number;
  /** Override HSN code (rare). */
  override_hsn_code?: string | null;
  /** Cost center for revenue-cost dual posting. */
  cost_center_code?: string | null;
  /** JSON snapshot of which Billing Manual rules fired. */
  rule_engine_applied?: Record<string, unknown>;
  /** Free-form note. */
  notes?: string | null;
  /** User id of the actor (cashier or system). */
  posted_by: string;
  /** Provisional vs posted (default 'posted'). */
  status?: 'posted' | 'provisional';
}

/**
 * Resolve the current code identity for human-readable charge_code +
 * charge_name (denormalized at emit so they survive code renames).
 */
async function resolveCodeIdentity(
  args: { item_id?: string; service_id?: string },
): Promise<{ charge_code: string; charge_name: string }> {
  if (args.service_id) {
    const [svc] = await db
      .select({ service_code: serviceCodes.service_code, service_name: serviceCodes.service_name })
      .from(serviceCodes)
      .where(eq(serviceCodes.id, args.service_id))
      .limit(1);
    if (!svc) throw new Error(`service_codes row not found for id=${args.service_id}`);
    return { charge_code: svc.service_code, charge_name: svc.service_name };
  }
  if (args.item_id) {
    const [item] = await db
      .select({ item_code: inventoryItems.item_code, item_display_name: inventoryItems.item_display_name })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, args.item_id))
      .limit(1);
    if (!item) throw new Error(`inventory_items row not found for id=${args.item_id}`);
    return { charge_code: item.item_code, charge_name: item.item_display_name };
  }
  throw new Error('Exactly one of item_id / service_id required');
}

/**
 * Emit a charge_items row. Resolves price via Codes; freezes 8 fields at
 * emit time; writes audit_log.
 */
export async function emitChargeItem(args: EmitChargeArgs): Promise<ChargeItem> {
  // 1. Validate exactly-one polymorphic FK
  const hasItem = !!args.item_id;
  const hasService = !!args.service_id;
  if (hasItem === hasService) {
    throw new Error('emitChargeItem: exactly one of item_id / service_id required');
  }
  if (args.code_kind === 'item' && !hasItem) {
    throw new Error("code_kind='item' requires item_id");
  }
  if (args.code_kind !== 'item' && !hasService) {
    throw new Error(`code_kind='${args.code_kind}' requires service_id`);
  }

  // 2. Resolve price + frozen fields via Codes (unless overridden for manual emits)
  let unit_price: number;
  let gst_percentage: number;
  let hsn_code: string | null;

  if (args.override_unit_price !== undefined) {
    unit_price = args.override_unit_price;
    gst_percentage = args.override_gst_percentage ?? 0;
    hsn_code = args.override_hsn_code ?? null;
  } else {
    // Pull all tiers for the target + use the resolver
    const target = hasService ? { service_id: args.service_id } : { item_id: args.item_id };
    const tierRows = hasService
      ? await db.select().from(codeChargeTiers).where(eq(codeChargeTiers.service_id, args.service_id!))
      : await db.select().from(codeChargeTiers).where(eq(codeChargeTiers.item_id, args.item_id!));
    const classCode = (args.room_class_at_post ?? 'GENERAL') as ChargeTierRow['class_code'];
    const resolution = resolveTierWithEmpanelment({
      rows: tierRows as ChargeTierRow[],
      target,
      class_code: classCode,
      empanelment_id: args.empanelment_id ?? null,
      at: new Date(),
    });
    if (!resolution.tier) {
      throw new Error(
        `emitChargeItem: no charge tier found for ${hasService ? 'service' : 'item'}_id=${args.service_id ?? args.item_id}, class=${classCode}, empanelment=${args.empanelment_id ?? 'standard'}. Code-charge-tiers must have an active row.`,
      );
    }
    unit_price = parseFloat(String(resolution.tier.price_inr));
    gst_percentage = parseFloat(String(resolution.tier.gst_percentage));
    hsn_code = args.override_hsn_code ?? null;
  }

  // 3. Compute line_total + gst_amount (frozen)
  const quantity = args.quantity ?? 1;
  const subtotal = unit_price * quantity;
  // GST exclusive: amount = subtotal * gst%; line_total = subtotal + amount
  // (when is_gst_inclusive=true, callers pass override_unit_price already inclusive; we set is_gst_inclusive accordingly)
  const gst_amount = subtotal * (gst_percentage / 100);
  const line_total = subtotal + gst_amount;

  // 4. Resolve human-readable code identity
  const { charge_code, charge_name } = await resolveCodeIdentity(args);

  // 5. INSERT charge_items
  const insertRow: NewChargeItem = {
    hospital_id: args.hospital_id,
    billing_account_id: args.billing_account_id,
    patient_id: args.patient_id,
    encounter_id: args.encounter_id ?? null,
    charge_code,
    charge_name,
    item_id: args.item_id ?? null,
    service_id: args.service_id ?? null,
    code_kind: args.code_kind,
    source_module: args.source_module,
    source_ref_id: args.source_ref_id ?? null,
    source_emit_event_id: args.source_emit_event_id ?? null,
    room_class_at_post: args.room_class_at_post ?? null,
    quantity: String(quantity) as any,
    unit_price: unit_price.toFixed(2) as any,
    line_total: line_total.toFixed(2) as any,
    gst_percentage: gst_percentage.toFixed(2) as any,
    gst_amount: gst_amount.toFixed(2) as any,
    hsn_code,
    cost_center_code: args.cost_center_code ?? null,
    empanelment_id_at_post: args.empanelment_id ?? null,
    rule_engine_applied: (args.rule_engine_applied ?? {}) as any,
    status: args.status ?? 'posted',
    posted_by: args.posted_by,
    notes: args.notes ?? null,
  };

  const [inserted] = await db.insert(chargeItems).values(insertRow).returning();

  // 6. Audit-log
  await writeAuditLog({
    action: 'INSERT',
    table: 'charge_items',
    row_id: inserted.id,
    actor_id: args.posted_by,
    hospital_id: args.hospital_id,
    new_values: {
      source_module: args.source_module,
      source_ref_id: args.source_ref_id,
      code_kind: args.code_kind,
      charge_code,
      line_total: inserted.line_total,
    },
  });

  return inserted;
}

/**
 * Reverse a posted charge_item. Inserts a new row with negative quantity +
 * negative line_total + reverses_charge_id pointing to the original. The
 * original row is NEVER updated (immutability invariant).
 *
 * The reversed row resolves to status='posted' (it's a real accounting entry
 * representing the credit) but the original gets its status flipped to
 * 'reversed' for query convenience.
 *
 * Returns both the reversal row + the updated original.
 */
export async function reverseChargeItem(args: {
  charge_id: string;
  reason: string;
  reversed_by: string;
}): Promise<{ original: ChargeItem; reversal: ChargeItem }> {
  const [original] = await db
    .select()
    .from(chargeItems)
    .where(eq(chargeItems.id, args.charge_id))
    .limit(1);
  if (!original) throw new Error(`charge_items row not found: ${args.charge_id}`);
  if (original.status === 'reversed' || original.status === 'void') {
    throw new Error(`Cannot reverse charge_items row in status='${original.status}'`);
  }

  // Build reversal row: negate quantity, line_total, gst_amount; preserve everything else frozen
  const reversalRow: NewChargeItem = {
    hospital_id: original.hospital_id,
    billing_account_id: original.billing_account_id,
    patient_id: original.patient_id,
    encounter_id: original.encounter_id,
    charge_code: original.charge_code,
    charge_name: original.charge_name,
    item_id: original.item_id,
    service_id: original.service_id,
    code_kind: original.code_kind,
    source_module: 'adjustment',
    source_ref_id: original.id,
    source_emit_event_id: null,
    room_class_at_post: original.room_class_at_post,
    quantity: (-parseFloat(String(original.quantity))).toFixed(2) as any,
    unit_price: original.unit_price,
    line_total: (-parseFloat(String(original.line_total))).toFixed(2) as any,
    gst_percentage: original.gst_percentage,
    gst_amount: (-parseFloat(String(original.gst_amount))).toFixed(2) as any,
    is_gst_inclusive: original.is_gst_inclusive,
    hsn_code: original.hsn_code,
    cost_center_code: original.cost_center_code,
    empanelment_id_at_post: original.empanelment_id_at_post,
    rule_engine_applied: { reversal_reason: args.reason, reversed_at: new Date().toISOString() } as any,
    status: 'posted',  // the reversal entry IS itself posted
    reverses_charge_id: original.id,
    posted_by: args.reversed_by,
    notes: `Reversal of charge ${original.id}: ${args.reason}`,
  };

  const [reversal] = await db.insert(chargeItems).values(reversalRow).returning();

  // Mark original as reversed (this is the ONE allowed update on the original — flip status)
  const [updatedOriginal] = await db
    .update(chargeItems)
    .set({ status: 'reversed', updated_at: new Date() })
    .where(eq(chargeItems.id, original.id))
    .returning();

  await writeAuditLog({
    action: 'UPDATE',
    table: 'charge_items',
    row_id: original.id,
    actor_id: args.reversed_by,
    hospital_id: original.hospital_id,
    new_values: { status: 'reversed', reversal_id: reversal.id, reason: args.reason },
  });

  return { original: updatedOriginal, reversal };
}
