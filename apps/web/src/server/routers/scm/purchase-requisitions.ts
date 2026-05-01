import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';
import { validatePrTransition, type PrState } from '../../scm/pr-state-machine';
import { requiredApproversForPoAmount, approverTierSatisfiesAmount, type ApproverRole } from '../../scm/kpmg-approval-matrix';

// ============================================================
// SCM › PURCHASE REQUISITIONS — Phase 3.2 (PRD §11 Phase 3)
//
// Internal pre-PO step. Caregiver/dept staff raise a PR for items they
// want procured externally. KPMG matrix tier signs off based on
// estimated_total_amount, then PR converts to one or more POs.
//
// Distinct from indents (internal stock movement) — PRs are for buying
// from vendors. SoD enforces pr_creator ⊕ po_approver ⊕ grn_creator
// (Phase 1.6 conflict matrix).
//
// 8 procedures:
//   create / addItem / list / detail / submit / approve / reject /
//   cancel / convertToPO
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const requisitionTypeEnum = z.enum([
  'inventory_replenishment',
  'capex',
  'service',
  'consumable_emergency',
  'consignment',
  'tender_based',
]);

const priorityEnum = z.enum(['routine', 'urgent', 'emergency', 'stat']);
const materialClassEnum = z.enum(['standard', 'emergency', 'vital']);

// ---------- Procedures ----------

export const prCreateProcedure = protectedProcedure
  .input(z.object({
    requisition_type: requisitionTypeEnum,
    requested_for_location: z.string().optional(),
    priority: priorityEnum.default('routine'),
    material_classification: materialClassEnum.optional(),
    needed_by: z.string().optional(),  // YYYY-MM-DD
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['pr_creator']);

      const year = new Date().getFullYear();
      const cnt = await getSql()(
        `SELECT COUNT(*) as cnt FROM purchase_requisitions
         WHERE hospital_id = $1 AND pr_number LIKE $2`,
        [ctx.user.hospital_id, `PR-${year}-${ctx.user.hospital_id}-%`]
      );
      const seq = (Number(cnt[0].cnt) || 0) + 1;
      const prNumber = `PR-${year}-${ctx.user.hospital_id}-${String(seq).padStart(5, '0')}`;

      const result = await getSql()(
        `INSERT INTO purchase_requisitions (
          hospital_id, pr_number, requisition_type, status,
          requested_for_location, priority, material_classification,
          estimated_total_amount, needed_by, notes, created_by
        ) VALUES (
          $1, $2, $3, 'draft',
          $4, $5, $6,
          0, $7, $8, $9
        ) RETURNING *`,
        [
          ctx.user.hospital_id, prNumber, input.requisition_type,
          input.requested_for_location || null, input.priority, input.material_classification || null,
          input.needed_by || null, input.notes || null, ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'INSERT', 'purchase_requisitions', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id, ctx.user.sub, result[0].id,
          JSON.stringify({ pr_number: prNumber, type: input.requisition_type, priority: input.priority }),
        ]
      );

      return result[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create PR', cause: e });
    }
  });

export const prAddItemProcedure = protectedProcedure
  .input(z.object({
    pr_id: z.string().uuid(),
    item_id: z.string().uuid(),
    quantity_requested: z.number().positive(),
    estimated_unit_cost: z.number().positive().optional(),
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['pr_creator']);

      const pr = await getSql()(`SELECT * FROM purchase_requisitions WHERE id = $1 AND hospital_id = $2`, [input.pr_id, ctx.user.hospital_id]);
      if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });
      if (pr[0].status !== 'draft') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only add items to draft PRs' });

      const item = await getSql()(`SELECT display_name FROM items WHERE id = $1`, [input.item_id]);
      if (!item.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });

      const total = (input.estimated_unit_cost || 0) * input.quantity_requested;
      const inserted = await getSql()(
        `INSERT INTO purchase_requisition_items (hospital_id, pr_id, item_id, item_name, quantity_requested, estimated_unit_cost, estimated_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [ctx.user.hospital_id, input.pr_id, input.item_id, item[0].display_name, input.quantity_requested, input.estimated_unit_cost ?? null, total || null, input.notes || null]
      );

      // Update PR running total
      await getSql()(
        `UPDATE purchase_requisitions SET estimated_total_amount = estimated_total_amount + $1, updated_at = NOW() WHERE id = $2`,
        [total, input.pr_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'INSERT', 'purchase_requisition_items', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, inserted[0].id, JSON.stringify({ pr_id: input.pr_id, item_id: input.item_id, qty: input.quantity_requested, est_total: total })]
      );

      return inserted[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add PR item', cause: e });
    }
  });

export const prListProcedure = protectedProcedure
  .input(z.object({
    status: z.string().optional(),
    requisition_type: requisitionTypeEnum.optional(),
    created_by: z.string().uuid().optional(),
  }))
  .query(async ({ ctx, input }) => {
    let where = 'pr.hospital_id = $1';
    const params: any[] = [ctx.user.hospital_id];
    let p = 2;
    if (input.status) { where += ` AND pr.status = $${p++}`; params.push(input.status); }
    if (input.requisition_type) { where += ` AND pr.requisition_type = $${p++}`; params.push(input.requisition_type); }
    if (input.created_by) { where += ` AND pr.created_by = $${p++}`; params.push(input.created_by); }
    return getSql()(
      `SELECT pr.*, u.full_name AS created_by_name, ua.full_name AS approved_by_name
       FROM purchase_requisitions pr
       LEFT JOIN users u  ON pr.created_by  = u.id
       LEFT JOIN users ua ON pr.approved_by = ua.id
       WHERE ${where}
       ORDER BY pr.created_at DESC`,
      params
    );
  });

export const prDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    const pr = await getSql()(
      `SELECT pr.*, u.full_name AS created_by_name, ua.full_name AS approved_by_name, ur.full_name AS rejected_by_name
       FROM purchase_requisitions pr
       LEFT JOIN users u  ON pr.created_by  = u.id
       LEFT JOIN users ua ON pr.approved_by = ua.id
       LEFT JOIN users ur ON pr.rejected_by = ur.id
       WHERE pr.id = $1 AND pr.hospital_id = $2`,
      [input, ctx.user.hospital_id]
    );
    if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });

    const items = await getSql()(
      `SELECT pri.*, it.kind, it.unit_of_measure, it.generic_name
       FROM purchase_requisition_items pri
       LEFT JOIN items it ON pri.item_id = it.id
       WHERE pri.pr_id = $1 AND pri.hospital_id = $2
       ORDER BY pri.created_at ASC`,
      [input, ctx.user.hospital_id]
    );

    return { ...pr[0], items };
  });

export const prSubmitProcedure = protectedProcedure
  .input(z.string().uuid())
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['pr_creator']);

      const pr = await getSql()(`SELECT * FROM purchase_requisitions WHERE id = $1 AND hospital_id = $2`, [input, ctx.user.hospital_id]);
      if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });
      const v = validatePrTransition({ from: pr[0].status as PrState, to: 'submitted' });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      // Pick approver tier from amount
      const amount = Number(pr[0].estimated_total_amount || 0);
      const requiredApprover = requiredApproversForPoAmount(amount)[0];

      const updated = await getSql()(
        `UPDATE purchase_requisitions
         SET status = 'submitted', approver_role = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [requiredApprover, input]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'purchase_requisitions', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input, JSON.stringify({ status_transition: 'draft→submitted', approver_role: requiredApprover, amount })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to submit PR', cause: e });
    }
  });

export const prApproveProcedure = protectedProcedure
  .input(z.object({
    pr_id: z.string().uuid(),
    approver_role: z.enum(['hod', 'non_med_head', 'finance_in_charge', 'facility_director', 'procurement_head']),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_approver', 'scm_admin']);

      const pr = await getSql()(`SELECT * FROM purchase_requisitions WHERE id = $1 AND hospital_id = $2`, [input.pr_id, ctx.user.hospital_id]);
      if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });

      const v = validatePrTransition({ from: pr[0].status as PrState, to: 'pr_approved' });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      // Tier-vs-amount enforcement (PRD §10 KPMG matrix)
      const amount = Number(pr[0].estimated_total_amount || 0);
      if (!approverTierSatisfiesAmount({ amount, approver_role: input.approver_role as ApproverRole })) {
        const required = requiredApproversForPoAmount(amount)[0];
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `KPMG tier mismatch: amount ₹${amount} requires ${required} or higher; you signed as ${input.approver_role}`,
        });
      }

      const updated = await getSql()(
        `UPDATE purchase_requisitions
         SET status = 'pr_approved', approved_by = $1, approved_at = NOW(),
             approver_role = $2, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [ctx.user.sub, input.approver_role, input.pr_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'purchase_requisitions', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input.pr_id, JSON.stringify({ status_transition: 'submitted→pr_approved', approver_role: input.approver_role, amount })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve PR', cause: e });
    }
  });

export const prRejectProcedure = protectedProcedure
  .input(z.object({
    pr_id: z.string().uuid(),
    rejection_reason: z.string().min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_approver', 'scm_admin']);

      const pr = await getSql()(`SELECT status FROM purchase_requisitions WHERE id = $1 AND hospital_id = $2`, [input.pr_id, ctx.user.hospital_id]);
      if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });
      const v = validatePrTransition({ from: pr[0].status as PrState, to: 'pr_rejected', rejection_reason: input.rejection_reason });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      const updated = await getSql()(
        `UPDATE purchase_requisitions
         SET status = 'pr_rejected', rejected_by = $1, rejected_at = NOW(),
             rejection_reason = $2, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [ctx.user.sub, input.rejection_reason, input.pr_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'purchase_requisitions', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input.pr_id, JSON.stringify({ status_transition: 'submitted→pr_rejected', reason: input.rejection_reason })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to reject PR', cause: e });
    }
  });

export const prCancelProcedure = protectedProcedure
  .input(z.object({
    pr_id: z.string().uuid(),
    cancellation_reason: z.string().min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const pr = await getSql()(`SELECT * FROM purchase_requisitions WHERE id = $1 AND hospital_id = $2`, [input.pr_id, ctx.user.hospital_id]);
      if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });

      // Originator-only OR app-admin
      if (pr[0].created_by !== ctx.user.sub && !['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the originator can cancel this PR' });
      }
      const v = validatePrTransition({ from: pr[0].status as PrState, to: 'cancelled', cancellation_reason: input.cancellation_reason });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      const updated = await getSql()(
        `UPDATE purchase_requisitions SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input.pr_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'purchase_requisitions', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input.pr_id, JSON.stringify({ from_state: pr[0].status, to_state: 'cancelled', reason: input.cancellation_reason })]
      );

      return updated[0];
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to cancel PR', cause: e });
    }
  });

/**
 * Convert an approved PR into a single PO (Phase 3 v1 single-PO conversion).
 * Phase 2 of Phase 3 may add multi-PO conversion (one PR → multiple POs by vendor).
 *
 * Creates a draft PO + line items mirroring the PR + records the conversion
 * back on the PR (status='pr_converted_to_po', converted_to_po_ids=[po_id]).
 */
export const prConvertToPoProcedure = protectedProcedure
  .input(z.object({
    pr_id: z.string().uuid(),
    vendor_id: z.string().uuid(),
    expected_delivery: z.string(),
    delivery_address: z.string().optional(),
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_creator']);

      const pr = await getSql()(`SELECT * FROM purchase_requisitions WHERE id = $1 AND hospital_id = $2`, [input.pr_id, ctx.user.hospital_id]);
      if (!pr.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'PR not found' });
      const v = validatePrTransition({ from: pr[0].status as PrState, to: 'pr_converted_to_po' });
      if (!v.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason! });

      // Get PR items
      const items = await getSql()(
        `SELECT * FROM purchase_requisition_items WHERE pr_id = $1 AND hospital_id = $2`,
        [input.pr_id, ctx.user.hospital_id]
      );
      if (!items.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'PR has no line items' });

      // Generate PO number
      const year = new Date().getFullYear();
      const cnt = await getSql()(
        `SELECT COUNT(*) as cnt FROM purchase_orders WHERE hospital_id = $1 AND po_number LIKE $2`,
        [ctx.user.hospital_id, `PO-${year}-${ctx.user.hospital_id}-%`]
      );
      const seq = (Number(cnt[0].cnt) || 0) + 1;
      const poNumber = `PO-${year}-${ctx.user.hospital_id}-${String(seq).padStart(5, '0')}`;

      // Insert PO with FK back to PR
      const poRows = await getSql()(
        `INSERT INTO purchase_orders (
          hospital_id, po_number, pr_id, vendor_id, status, total_items, total_amount,
          expected_delivery, delivery_address, notes, created_by
        ) VALUES (
          $1, $2, $3, $4, 'draft', 0, 0, $5, $6, $7, $8
        ) RETURNING *`,
        [
          ctx.user.hospital_id, poNumber, input.pr_id, input.vendor_id,
          input.expected_delivery, input.delivery_address || null,
          input.notes || `Converted from ${pr[0].pr_number}`, ctx.user.sub,
        ]
      );
      const poId = poRows[0].id;

      // Insert PO items mirroring PR
      let totalAmount = 0;
      for (const it of items) {
        const qty = Number(it.quantity_requested);
        const unitCost = Number(it.estimated_unit_cost || 0);
        const total = qty * unitCost;
        totalAmount += total;
        await getSql()(
          `INSERT INTO purchase_order_items (
            hospital_id, po_id, item_id, item_name,
            quantity_ordered, quantity_received, unit_cost, total_cost, notes
          ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
          [ctx.user.hospital_id, poId, it.item_id, it.item_name, qty, unitCost, total, it.notes || null]
        );
      }

      await getSql()(
        `UPDATE purchase_orders SET total_items = $1, total_amount = $2 WHERE id = $3`,
        [items.length, totalAmount, poId]
      );

      // Update PR
      await getSql()(
        `UPDATE purchase_requisitions
         SET status = 'pr_converted_to_po',
             converted_to_po_ids = ARRAY[$1::uuid],
             converted_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [poId, input.pr_id]
      );

      // Audit
      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'UPDATE', 'purchase_requisitions', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input.pr_id, JSON.stringify({ status_transition: 'pr_approved→pr_converted_to_po', po_id: poId, po_number: poNumber, line_count: items.length, total: totalAmount })]
      );
      await getSql()(
        `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
         VALUES ($1, $2, 'INSERT', 'purchase_orders', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, poId, JSON.stringify({ po_number: poNumber, source_pr_id: input.pr_id, vendor_id: input.vendor_id, line_count: items.length })]
      );

      return { pr: { id: input.pr_id, status: 'pr_converted_to_po' }, po: poRows[0], po_id: poId };
    } catch (e: any) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to convert PR to PO', cause: e });
    }
  });

// ---------- Router ----------

export const scmPurchaseRequisitionsRouter = router({
  create: prCreateProcedure,
  addItem: prAddItemProcedure,
  list: prListProcedure,
  detail: prDetailProcedure,
  submit: prSubmitProcedure,
  approve: prApproveProcedure,
  reject: prRejectProcedure,
  cancel: prCancelProcedure,
  convertToPO: prConvertToPoProcedure,
});
