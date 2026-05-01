import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';
import {
  validateGrnTransition,
  type GrnState,
  type InspectionChecklist,
  allChecksPassed,
  failedChecks,
} from '../../scm/grn-state-machine';
import { performThreeWayMatch, type ThreeWayMatchStatus } from '../../scm/three-way-match';

// ============================================================
// SCM › GRNs — Phase 3.3 (PRD §11 Phase 3 + KPMG 10-item inspection)
//
// Goods Receipt Notes — formal receipt against a PO with KPMG 10-item
// inspection checklist + 3-way match against vendor invoice.
//
// State machine: draft → inspection_in_progress → submitted →
//                accepted | partially_accepted | rejected
//
// 10 procedures:
//   create / addLine / list / detail / startInspection /
//   runInspection (records checklist + computes overall_pass) /
//   recordInvoice (captures vendor invoice fields denormalized on GRN) /
//   submit / accept / partiallyAccept / reject / run3WayMatch /
//   approveVariance
//
// Vendor invoices live denormalized on GRN per V's B1 lock (manual entry;
// OCR pipeline deferred). 3-way match runs automatically on accept.
//
// SoD: grn_creator gates all writes. po_approver / scm_admin can override
// variance approval.
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Procedures ----------

export const grnCreateProcedure = protectedProcedure
  .input(z.object({
    po_id: z.string().uuid(),
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);

      const po = await getSql()(`SELECT * FROM purchase_orders WHERE id = $1 AND hospital_id = $2`, [input.po_id, ctx.user.hospital_id]);
      if (!po.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PO not found' });
      if (!['sent_to_vendor', 'partially_received'].includes(po[0].status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot create GRN against PO in state '${po[0].status}'` });
      }

      const year = new Date().getFullYear();
      const cnt = await getSql()(
        `SELECT COUNT(*) as cnt FROM goods_receipt_notes WHERE hospital_id = $1 AND grn_number LIKE $2`,
        [ctx.user.hospital_id, `GRN-${year}-${ctx.user.hospital_id}-%`]
      );
      const seq = (Number(cnt[0].cnt) || 0) + 1;
      const grnNumber = `GRN-${year}-${ctx.user.hospital_id}-${String(seq).padStart(5, '0')}`;

      const result = await getSql()(
        `INSERT INTO goods_receipt_notes (
          hospital_id, grn_number, po_id, vendor_id, status,
          payment_terms_days, notes, created_by
        ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7) RETURNING *`,
        [
          ctx.user.hospital_id, grnNumber, input.po_id, po[0].vendor_id,
          // payment_terms_days copied from vendor at GRN time (PRD §11 Phase 3)
          (await getSql()(`SELECT payment_terms_days FROM vendors WHERE id = $1`, [po[0].vendor_id]))[0]?.payment_terms_days || 30,
          input.notes || null, ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'INSERT', 'goods_receipt_notes', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, result[0].id, JSON.stringify({ grn_number: grnNumber, po_id: input.po_id, vendor_id: po[0].vendor_id })]
      );

      return result[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create GRN', cause: e });
    }
  });

export const grnAddLineProcedure = protectedProcedure
  .input(z.object({
    grn_id: z.string().uuid(),
    po_item_id: z.string().uuid(),
    quantity_received: z.number().positive(),
    quantity_accepted: z.number().nonnegative(),
    batch_number: z.string().min(1),
    manufacturer: z.string().optional(),
    expiry_date: z.string(),
    rejection_reason: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);

      const grn = await getSql()(`SELECT * FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input.grn_id, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });
      if (!['draft', 'inspection_in_progress'].includes(grn[0].status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only add lines to draft or in-progress GRN' });
      }

      const poItem = await getSql()(`SELECT * FROM purchase_order_items WHERE id = $1 AND hospital_id = $2`, [input.po_item_id, ctx.user.hospital_id]);
      if (!poItem.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PO line item not found' });

      // Validate quantities
      if (input.quantity_accepted > input.quantity_received) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'quantity_accepted cannot exceed quantity_received' });
      }
      const rejected = input.quantity_received - input.quantity_accepted;
      if (rejected > 0 && !input.rejection_reason?.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'rejection_reason required when quantity_accepted < quantity_received' });
      }

      const totalCost = input.quantity_accepted * Number(poItem[0].unit_cost);

      const inserted = await getSql()(
        `INSERT INTO goods_receipt_note_items (
          hospital_id, grn_id, po_item_id, item_id, item_name,
          quantity_received, quantity_accepted, quantity_rejected,
          batch_number, manufacturer, expiry_date,
          unit_cost, total_cost, rejection_reason
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11,
          $12, $13, $14
        ) RETURNING *`,
        [
          ctx.user.hospital_id, input.grn_id, input.po_item_id, poItem[0].item_id, poItem[0].item_name,
          input.quantity_received, input.quantity_accepted, rejected,
          input.batch_number, input.manufacturer || null, input.expiry_date,
          poItem[0].unit_cost, totalCost, input.rejection_reason || null,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'INSERT', 'goods_receipt_note_items', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, inserted[0].id, JSON.stringify({ grn_id: input.grn_id, po_item_id: input.po_item_id, qty_received: input.quantity_received, qty_accepted: input.quantity_accepted, batch: input.batch_number })]
      );

      return inserted[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add GRN line', cause: e });
    }
  });

export const grnListProcedure = protectedProcedure
  .input(z.object({
    status: z.string().optional(),
    po_id: z.string().uuid().optional(),
    vendor_id: z.string().uuid().optional(),
    three_way_match_status: z.string().optional(),
  }))
  .query(async ({ ctx, input }) => {
    let where = 'g.hospital_id = $1';
    const params: any[] = [ctx.user.hospital_id];
    let p = 2;
    if (input.status) { where += ` AND g.status = $${p++}`; params.push(input.status); }
    if (input.po_id) { where += ` AND g.po_id = $${p++}`; params.push(input.po_id); }
    if (input.vendor_id) { where += ` AND g.vendor_id = $${p++}`; params.push(input.vendor_id); }
    if (input.three_way_match_status) { where += ` AND g.three_way_match_status = $${p++}`; params.push(input.three_way_match_status); }
    return getSql()(
      `SELECT g.*, po.po_number, v.vendor_name, u.full_name AS created_by_name
       FROM goods_receipt_notes g
       LEFT JOIN purchase_orders po ON g.po_id = po.id
       LEFT JOIN vendors v ON g.vendor_id = v.id
       LEFT JOIN users u ON g.created_by = u.id
       WHERE ${where}
       ORDER BY g.created_at DESC`,
      params
    );
  });

export const grnDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    const grn = await getSql()(
      `SELECT g.*, po.po_number, po.total_amount AS po_total_amount, v.vendor_name, u.full_name AS created_by_name
       FROM goods_receipt_notes g
       LEFT JOIN purchase_orders po ON g.po_id = po.id
       LEFT JOIN vendors v ON g.vendor_id = v.id
       LEFT JOIN users u ON g.created_by = u.id
       WHERE g.id = $1 AND g.hospital_id = $2`,
      [input, ctx.user.hospital_id]
    );
    if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });

    const lines = await getSql()(
      `SELECT gni.*, it.kind, it.unit_of_measure, it.generic_name
       FROM goods_receipt_note_items gni
       LEFT JOIN items it ON gni.item_id = it.id
       WHERE gni.grn_id = $1 AND gni.hospital_id = $2
       ORDER BY gni.created_at ASC`,
      [input, ctx.user.hospital_id]
    );

    const inspection = await getSql()(
      `SELECT * FROM inspection_checklist_results WHERE grn_id = $1 AND hospital_id = $2 ORDER BY inspected_at DESC LIMIT 1`,
      [input, ctx.user.hospital_id]
    );

    return { ...grn[0], lines, inspection: inspection[0] || null };
  });

export const grnStartInspectionProcedure = protectedProcedure
  .input(z.string().uuid())
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);
      const grn = await getSql()(`SELECT status FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });
      const v = validateGrnTransition({ from: grn[0].status as GrnState, to: 'inspection_in_progress' });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      const updated = await getSql()(
        `UPDATE goods_receipt_notes SET status = 'inspection_in_progress', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'goods_receipt_notes', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input, JSON.stringify({ status_transition: 'draft→inspection_in_progress' })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to start inspection', cause: e });
    }
  });

/**
 * Run KPMG 10-item inspection checklist. Writes inspection_checklist_results
 * row + flips inspection_passed on the GRN row.
 */
export const grnRunInspectionProcedure = protectedProcedure
  .input(z.object({
    grn_id: z.string().uuid(),
    visual_quantity_tally_pass: z.boolean(),
    invoice_match_pass: z.boolean(),
    damage_check_pass: z.boolean(),
    po_invoice_receipt_pass: z.boolean(),
    packaging_integrity_pass: z.boolean(),
    mfr_brand_batch_expiry_markings_pass: z.boolean(),
    shelf_life_180_days_pass: z.boolean(),
    broken_bottles_pass: z.boolean(),
    iv_fluid_fungus_pass: z.boolean(),
    cold_chain_indicators_pass: z.boolean(),
    failure_notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);

      const grn = await getSql()(`SELECT * FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input.grn_id, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });
      if (grn[0].status !== 'inspection_in_progress') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Inspection only allowed in inspection_in_progress state' });
      }

      const checklist: InspectionChecklist = {
        visual_quantity_tally_pass: input.visual_quantity_tally_pass,
        invoice_match_pass: input.invoice_match_pass,
        damage_check_pass: input.damage_check_pass,
        po_invoice_receipt_pass: input.po_invoice_receipt_pass,
        packaging_integrity_pass: input.packaging_integrity_pass,
        mfr_brand_batch_expiry_markings_pass: input.mfr_brand_batch_expiry_markings_pass,
        shelf_life_180_days_pass: input.shelf_life_180_days_pass,
        broken_bottles_pass: input.broken_bottles_pass,
        iv_fluid_fungus_pass: input.iv_fluid_fungus_pass,
        cold_chain_indicators_pass: input.cold_chain_indicators_pass,
      };
      const overallPass = allChecksPassed(checklist);
      const fails = failedChecks(checklist);

      if (!overallPass && !input.failure_notes?.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Inspection failures require failure_notes (failed: ${fails.join(', ')})` });
      }

      const result = await getSql()(
        `INSERT INTO inspection_checklist_results (
          hospital_id, grn_id,
          visual_quantity_tally_pass, invoice_match_pass, damage_check_pass,
          po_invoice_receipt_pass, packaging_integrity_pass,
          mfr_brand_batch_expiry_markings_pass, shelf_life_180_days_pass,
          broken_bottles_pass, iv_fluid_fungus_pass, cold_chain_indicators_pass,
          overall_pass, failure_notes, inspected_by
        ) VALUES (
          $1, $2,
          $3, $4, $5,
          $6, $7,
          $8, $9,
          $10, $11, $12,
          $13, $14, $15
        ) RETURNING *`,
        [
          ctx.user.hospital_id, input.grn_id,
          input.visual_quantity_tally_pass, input.invoice_match_pass, input.damage_check_pass,
          input.po_invoice_receipt_pass, input.packaging_integrity_pass,
          input.mfr_brand_batch_expiry_markings_pass, input.shelf_life_180_days_pass,
          input.broken_bottles_pass, input.iv_fluid_fungus_pass, input.cold_chain_indicators_pass,
          overallPass, input.failure_notes || null, ctx.user.sub,
        ]
      );

      // Update GRN with inspection_checklist_id + inspection_passed
      await getSql()(
        `UPDATE goods_receipt_notes
         SET inspection_checklist_id = $1, inspection_passed = $2, updated_at = NOW()
         WHERE id = $3`,
        [result[0].id, overallPass, input.grn_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'INSERT', 'inspection_checklist_results', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, result[0].id, JSON.stringify({ grn_id: input.grn_id, overall_pass: overallPass, failed_checks: fails })]
      );

      return result[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to run inspection', cause: e });
    }
  });

/**
 * Record vendor invoice on GRN (denormalized per V's B1 lock).
 */
export const grnRecordInvoiceProcedure = protectedProcedure
  .input(z.object({
    grn_id: z.string().uuid(),
    vendor_invoice_number: z.string().min(1),
    vendor_invoice_date: z.string(),
    vendor_invoice_amount: z.number().positive(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);
      const grn = await getSql()(`SELECT status FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input.grn_id, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });

      const updated = await getSql()(
        `UPDATE goods_receipt_notes
         SET vendor_invoice_number = $1, vendor_invoice_date = $2, vendor_invoice_amount = $3,
             updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [input.vendor_invoice_number, input.vendor_invoice_date, input.vendor_invoice_amount, input.grn_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'goods_receipt_notes', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input.grn_id, JSON.stringify({ vendor_invoice: { number: input.vendor_invoice_number, date: input.vendor_invoice_date, amount: input.vendor_invoice_amount } })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to record invoice', cause: e });
    }
  });

/**
 * Submit GRN: inspection_in_progress → submitted.
 * Requires inspection_passed not null + at least one line.
 */
export const grnSubmitProcedure = protectedProcedure
  .input(z.string().uuid())
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);

      const grn = await getSql()(`SELECT * FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });
      const v = validateGrnTransition({ from: grn[0].status as GrnState, to: 'submitted' });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });
      if (grn[0].inspection_passed == null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Run KPMG 10-item inspection before submitting' });
      }

      const lineCount = await getSql()(`SELECT COUNT(*) AS cnt FROM goods_receipt_note_items WHERE grn_id = $1`, [input]);
      if (Number(lineCount[0].cnt) === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'GRN must have at least one line' });
      }

      const updated = await getSql()(
        `UPDATE goods_receipt_notes SET status = 'submitted', received_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'goods_receipt_notes', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input, JSON.stringify({ status_transition: 'inspection_in_progress→submitted' })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to submit GRN', cause: e });
    }
  });

/**
 * Accept GRN — full or partial. Computes 3-way match + writes inventory rows
 * + stock_movements for accepted lines. Updates PO line quantity_received.
 */
export const grnAcceptProcedure = protectedProcedure
  .input(z.object({
    grn_id: z.string().uuid(),
    receive_location: z.string().default('warehouse'),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);

      const grn = await getSql()(`SELECT * FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input.grn_id, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });

      const lines = await getSql()(`SELECT * FROM goods_receipt_note_items WHERE grn_id = $1 AND hospital_id = $2`, [input.grn_id, ctx.user.hospital_id]);

      const totalAccepted = lines.reduce((s: number, l: any) => s + Number(l.total_cost || 0), 0);
      const anyRejection = lines.some((l: any) => Number(l.quantity_rejected) > 0);
      const allRejected = lines.every((l: any) => Number(l.quantity_accepted) === 0);

      let newState: GrnState;
      if (allRejected) newState = 'rejected';
      else if (anyRejection) newState = 'partially_accepted';
      else newState = 'accepted';

      const v = validateGrnTransition({ from: grn[0].status as GrnState, to: newState });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      // Inventory write + stock_movements (only for accepted lines, only if not rejected outright)
      if (newState !== 'rejected') {
        const po = await getSql()(`SELECT vendor_id FROM purchase_orders WHERE id = $1`, [grn[0].po_id]);
        for (const li of lines) {
          const qtyAccepted = Number(li.quantity_accepted);
          if (qtyAccepted <= 0) continue;

          // Find or create inventory row
          const existing = await getSql()(
            `SELECT id, quantity_on_hand FROM inventory
             WHERE hospital_id = $1 AND item_id = $2 AND location = $3
               AND COALESCE(batch_number,'') = COALESCE($4::text,'')`,
            [ctx.user.hospital_id, li.item_id, input.receive_location, li.batch_number]
          );

          let invId: string;
          let prevBal: number;
          let newBal: number;
          if (existing.length) {
            invId = existing[0].id;
            prevBal = Number(existing[0].quantity_on_hand);
            newBal = prevBal + qtyAccepted;
            await getSql()(
              `UPDATE inventory SET quantity_on_hand = $1, last_movement_at = NOW(), last_restocked_at = NOW(), updated_at = NOW() WHERE id = $2`,
              [newBal, invId]
            );
          } else {
            const ins = await getSql()(
              `INSERT INTO inventory (
                hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
                quantity_on_hand, quantity_reserved, quantity_in_transit,
                unit_cost, mrp, is_active, last_movement_at, last_restocked_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, 0, 0,
                $8, $9, TRUE, NOW(), NOW()
              ) RETURNING id`,
              [
                ctx.user.hospital_id, li.item_id, input.receive_location,
                li.batch_number, li.manufacturer, li.expiry_date,
                qtyAccepted, li.unit_cost, Number(li.unit_cost) * 1.5,
              ]
            );
            invId = ins[0].id;
            prevBal = 0;
            newBal = qtyAccepted;
          }

          // Append stock_movements ledger entry
          const moveRow = await getSql()(
            `INSERT INTO stock_movements (
              hospital_id, inventory_id, item_id, item_name,
              movement_type, quantity, previous_balance, new_balance,
              batch_number, location, source_module, source_ref_id, grn_id,
              unit_cost, total_value, vendor_id, created_by, reason
            ) VALUES (
              $1, $2, $3, $4,
              'grn_receive', $5, $6, $7,
              $8, $9, 'scm', $10, $11,
              $12, $13, $14, $15, $16
            ) RETURNING id`,
            [
              ctx.user.hospital_id, invId, li.item_id, li.item_name,
              qtyAccepted, prevBal, newBal,
              li.batch_number, input.receive_location, grn[0].po_id, input.grn_id,
              li.unit_cost, qtyAccepted * Number(li.unit_cost), po[0]?.vendor_id || null, ctx.user.sub,
              `GRN ${grn[0].grn_number} accept`,
            ]
          );

          // Update GRN line with inventory + movement linkage
          await getSql()(
            `UPDATE goods_receipt_note_items SET inventory_id = $1, stock_movement_id = $2 WHERE id = $3`,
            [invId, moveRow[0].id, li.id]
          );

          // Update PO line cumulative quantity_received
          await getSql()(
            `UPDATE purchase_order_items SET quantity_received = quantity_received + $1 WHERE id = $2`,
            [qtyAccepted, li.po_item_id]
          );
        }

        // Update PO state
        const poLineSummary = await getSql()(
          `SELECT
            SUM(CASE WHEN quantity_received >= quantity_ordered THEN 1 ELSE 0 END) AS fully,
            COUNT(*) AS total
           FROM purchase_order_items WHERE po_id = $1`,
          [grn[0].po_id]
        );
        const fully = Number(poLineSummary[0].fully);
        const total = Number(poLineSummary[0].total);
        const newPoStatus = fully === total ? 'received' : 'partially_received';
        await getSql()(
          `UPDATE purchase_orders
           SET status = $1, first_received_at = COALESCE(first_received_at, NOW()),
               fully_received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE fully_received_at END,
               updated_at = NOW()
           WHERE id = $2`,
          [newPoStatus, grn[0].po_id]
        );
      }

      // Run 3-way match if invoice is recorded
      let matchResult: any = null;
      if (grn[0].vendor_invoice_amount != null && newState !== 'rejected') {
        const po = await getSql()(`SELECT total_amount FROM purchase_orders WHERE id = $1`, [grn[0].po_id]);
        matchResult = performThreeWayMatch({
          po_total: Number(po[0].total_amount),
          grn_value: totalAccepted,
          invoice_value: Number(grn[0].vendor_invoice_amount),
        });
        await getSql()(
          `UPDATE goods_receipt_notes
           SET three_way_match_status = $1, variance_amount = $2, updated_at = NOW()
           WHERE id = $3`,
          [matchResult.status, matchResult.variance_amount, input.grn_id]
        );
      }

      const updated = await getSql()(
        `UPDATE goods_receipt_notes SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [newState, input.grn_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'goods_receipt_notes', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id, ctx.user.sub, input.grn_id,
          JSON.stringify({
            status_transition: `submitted→${newState}`,
            total_accepted: totalAccepted,
            three_way_match: matchResult ? { variance_pct: matchResult.variance_pct, bucket: matchResult.bucket, status: matchResult.status } : null,
          }),
        ]
      );

      return { grn: updated[0], three_way_match: matchResult };
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to accept GRN', cause: e });
    }
  });

/**
 * Approve a flagged variance — only Finance In-Charge / Facility Director / scm_admin
 * can sign off. variance_block bucket also requires the same.
 */
export const grnApproveVarianceProcedure = protectedProcedure
  .input(z.object({
    grn_id: z.string().uuid(),
    decision: z.enum(['approved', 'rejected']),
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_approver', 'scm_admin']);

      const grn = await getSql()(`SELECT * FROM goods_receipt_notes WHERE id = $1 AND hospital_id = $2`, [input.grn_id, ctx.user.hospital_id]);
      if (!grn.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'GRN not found' });
      if (grn[0].three_way_match_status !== 'variance_flagged') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Variance approval only valid for variance_flagged GRNs' });
      }

      const newStatus: ThreeWayMatchStatus = input.decision === 'approved' ? 'variance_approved' : 'variance_rejected';

      const updated = await getSql()(
        `UPDATE goods_receipt_notes
         SET three_way_match_status = $1, variance_approved_by = $2, variance_approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [newStatus, ctx.user.sub, input.grn_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'goods_receipt_notes', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input.grn_id, JSON.stringify({ variance_decision: input.decision, status: newStatus, notes: input.notes })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve variance', cause: e });
    }
  });

// ---------- Router ----------

export const scmGrnsRouter = router({
  create: grnCreateProcedure,
  addLine: grnAddLineProcedure,
  list: grnListProcedure,
  detail: grnDetailProcedure,
  startInspection: grnStartInspectionProcedure,
  runInspection: grnRunInspectionProcedure,
  recordInvoice: grnRecordInvoiceProcedure,
  submit: grnSubmitProcedure,
  accept: grnAcceptProcedure,
  approveVariance: grnApproveVarianceProcedure,
});
