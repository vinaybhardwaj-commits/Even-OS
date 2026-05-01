import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';

// ============================================================
// SCM › PURCHASE ORDERS — Phase 1.4 router (Q2 Path C)
//
// Extracted from pharmacy.ts (6 procedures). Generalized over canonical
// `purchase_orders` + `purchase_order_items` tables (63-scm-core.ts).
//
// State machine: draft → approved → sent_to_vendor → partially_received →
// received → closed. KPMG approval matrix captured (RBAC enforcement
// deferred to Phase 1.6).
//
// Procedures exported as named consts for re-use in legacy router
// re-exports (Phase 1.4 Q2 Path C).
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Validation ----------

const purchaseOrderCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  pr_id: z.string().uuid().optional(),
  expected_delivery: z.string(),
  delivery_address: z.string().optional(),
  notes: z.string().optional(),
});

const poItemAddSchema = z.object({
  po_id: z.string().uuid(),
  item_id: z.string().uuid(),
  quantity_ordered: z.number().positive(),
  unit_cost: z.number().positive(),
  expected_batch_count: z.number().int().positive().optional(),
  preferred_manufacturer: z.string().optional(),
  notes: z.string().optional(),
});

const poReceiveSchema = z.object({
  po_id: z.string().uuid(),
  items: z.array(
    z.object({
      poi_id: z.string().uuid(),
      quantity_received: z.number().positive(),
      batch_number: z.string().optional(),
      expiry_date: z.string().optional(),
      manufacturer: z.string().optional(),
      receive_location: z.string().default('warehouse'),
    })
  ),
});

// ---------- Named procedure exports ----------

/** Create a draft PO. PO number: PO-YYYY-{HOSPITAL}-NNNNN. */
export const purchaseOrderCreateProcedure = protectedProcedure
  .input(purchaseOrderCreateSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_creator']);
      const year = new Date().getFullYear();
      const countYear = await getSql()(
        `SELECT COUNT(*) as cnt FROM purchase_orders
         WHERE hospital_id = $1 AND po_number LIKE $2`,
        [ctx.user.hospital_id, `PO-${year}-${ctx.user.hospital_id}-%`]
      );
      const nextSeq = (Number(countYear[0].cnt) || 0) + 1;
      const poNumber = `PO-${year}-${ctx.user.hospital_id}-${String(nextSeq).padStart(5, '0')}`;

      const result = await getSql()(
        `INSERT INTO purchase_orders (
          hospital_id, po_number, pr_id, vendor_id,
          status, total_items, total_amount,
          expected_delivery, delivery_address, notes, created_by
        ) VALUES (
          $1, $2, $3, $4,
          'draft', 0, 0,
          $5, $6, $7, $8
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          poNumber,
          input.pr_id || null,
          input.vendor_id,
          input.expected_delivery,
          input.delivery_address || null,
          input.notes || null,
          ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'purchase_orders', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          result[0].id,
          JSON.stringify({ po_number: poNumber, vendor_id: input.vendor_id, pr_id: input.pr_id }),
        ]
      );

      return result[0];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create purchase order',
        cause: error,
      });
    }
  });

/** Add a line item to a draft PO. Updates PO totals. */
export const purchaseOrderAddItemProcedure = protectedProcedure
  .input(poItemAddSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_creator']);
      const po = await getSql()(
        `SELECT * FROM purchase_orders WHERE id = $1 AND hospital_id = $2`,
        [input.po_id, ctx.user.hospital_id]
      );
      if (!po.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase order not found' });
      }
      if (po[0].status !== 'draft') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only add items to draft POs' });
      }

      const item = await getSql()(
        `SELECT display_name FROM items WHERE id = $1`,
        [input.item_id]
      );
      if (!item.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }

      const totalCost = input.quantity_ordered * input.unit_cost;

      const inserted = await getSql()(
        `INSERT INTO purchase_order_items (
          hospital_id, po_id, item_id, item_name,
          quantity_ordered, quantity_received, unit_cost, total_cost,
          expected_batch_count, preferred_manufacturer, notes
        ) VALUES (
          $1, $2, $3, $4,
          $5, 0, $6, $7,
          $8, $9, $10
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          input.po_id,
          input.item_id,
          item[0].display_name,
          input.quantity_ordered,
          input.unit_cost,
          totalCost,
          input.expected_batch_count || null,
          input.preferred_manufacturer || null,
          input.notes || null,
        ]
      );

      await getSql()(
        `UPDATE purchase_orders
         SET total_items = total_items + 1,
             total_amount = total_amount + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [totalCost, input.po_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'purchase_order_items', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          inserted[0].id,
          JSON.stringify({ po_id: input.po_id, item_id: input.item_id, qty: input.quantity_ordered, total: totalCost }),
        ]
      );

      return inserted[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to add PO item',
        cause: error,
      });
    }
  });

/** Approve a draft PO. State: draft → approved. */
export const purchaseOrderApproveProcedure = protectedProcedure
  .input(
    z.object({
      po_id: z.string().uuid(),
      approver_role: z.enum(['hod', 'procurement_head', 'finance_in_charge', 'facility_director']).optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_approver']);
      const po = await getSql()(
        `UPDATE purchase_orders
         SET status = 'approved',
             approved_by = $1,
             approved_at = NOW(),
             approver_role = $2,
             updated_at = NOW()
         WHERE id = $3 AND hospital_id = $4 AND status = 'draft'
         RETURNING *`,
        [ctx.user.sub, input.approver_role || null, input.po_id, ctx.user.hospital_id]
      );
      if (!po.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft PO not found' });
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'purchase_orders', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.po_id,
          JSON.stringify({ status_transition: 'draft→approved', approver_role: input.approver_role }),
        ]
      );

      return po[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to approve purchase order',
        cause: error,
      });
    }
  });

/** Mark PO as sent to vendor. State: approved → sent_to_vendor. */
export const purchaseOrderSendToVendorProcedure = protectedProcedure
  .input(z.string().uuid())
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_creator']);
      const po = await getSql()(
        `UPDATE purchase_orders
         SET status = 'sent_to_vendor',
             sent_to_vendor_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND hospital_id = $2 AND status = 'approved'
         RETURNING *`,
        [input, ctx.user.hospital_id]
      );
      if (!po.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Approved PO not found' });
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'purchase_orders', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, input, JSON.stringify({ status_transition: 'approved→sent_to_vendor' })]
      );

      return po[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to mark PO sent',
        cause: error,
      });
    }
  });

/** Receive items against a PO; creates inventory rows + ledger entries. */
export const purchaseOrderReceiveProcedure = protectedProcedure
  .input(poReceiveSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['grn_creator']);
      const po = await getSql()(
        `SELECT * FROM purchase_orders WHERE id = $1 AND hospital_id = $2`,
        [input.po_id, ctx.user.hospital_id]
      );
      if (!po.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase order not found' });
      }
      if (!['sent_to_vendor', 'partially_received'].includes(po[0].status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot receive against PO in status '${po[0].status}'`,
        });
      }

      for (const it of input.items) {
        const poItem = await getSql()(
          `SELECT * FROM purchase_order_items WHERE id = $1 AND hospital_id = $2 AND po_id = $3`,
          [it.poi_id, ctx.user.hospital_id, input.po_id]
        );
        if (!poItem.length) continue;
        const poi = poItem[0];

        await getSql()(
          `UPDATE purchase_order_items
           SET quantity_received = quantity_received + $1
           WHERE id = $2`,
          [it.quantity_received, it.poi_id]
        );

        const existing = await getSql()(
          `SELECT id, quantity_on_hand FROM inventory
           WHERE hospital_id = $1 AND item_id = $2
             AND location = $3
             AND COALESCE(batch_number,'') = COALESCE($4::text,'')`,
          [
            ctx.user.hospital_id,
            poi.item_id,
            it.receive_location,
            it.batch_number || null,
          ]
        );

        let invId: string;
        let prevBalance: number;
        let newBalance: number;
        if (existing.length) {
          invId = existing[0].id;
          prevBalance = Number(existing[0].quantity_on_hand);
          newBalance = prevBalance + it.quantity_received;
          await getSql()(
            `UPDATE inventory
             SET quantity_on_hand = $1,
                 last_movement_at = NOW(),
                 last_restocked_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [newBalance, invId]
          );
        } else {
          const ins = await getSql()(
            `INSERT INTO inventory (
              hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
              quantity_on_hand, quantity_reserved, quantity_in_transit,
              unit_cost, mrp, is_active,
              last_movement_at, last_restocked_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, 0, 0, $8, $9, TRUE,
              NOW(), NOW()
            ) RETURNING id`,
            [
              ctx.user.hospital_id,
              poi.item_id,
              it.receive_location,
              it.batch_number || null,
              it.manufacturer || null,
              it.expiry_date || null,
              it.quantity_received,
              poi.unit_cost,
              Number(poi.unit_cost) * 1.5,
            ]
          );
          invId = ins[0].id;
          prevBalance = 0;
          newBalance = it.quantity_received;
        }

        await getSql()(
          `INSERT INTO stock_movements (
            hospital_id, inventory_id, item_id, item_name,
            movement_type, quantity, previous_balance, new_balance,
            batch_number, location, source_module, source_ref_id,
            unit_cost, total_value, vendor_id, created_by
          ) VALUES (
            $1, $2, $3, $4,
            'grn_receive', $5, $6, $7,
            $8, $9, 'scm', $10,
            $11, $12, $13, $14
          )`,
          [
            ctx.user.hospital_id,
            invId,
            poi.item_id,
            poi.item_name,
            it.quantity_received,
            prevBalance,
            newBalance,
            it.batch_number || null,
            it.receive_location,
            input.po_id,
            poi.unit_cost,
            it.quantity_received * Number(poi.unit_cost),
            po[0].vendor_id,
            ctx.user.sub,
          ]
        );
      }

      const lineSummary = await getSql()(
        `SELECT
          SUM(CASE WHEN quantity_received >= quantity_ordered THEN 1 ELSE 0 END) AS fully,
          SUM(CASE WHEN quantity_received > 0 AND quantity_received < quantity_ordered THEN 1 ELSE 0 END) AS partial,
          COUNT(*) AS total
         FROM purchase_order_items WHERE po_id = $1`,
        [input.po_id]
      );
      const fully = Number(lineSummary[0].fully);
      const total = Number(lineSummary[0].total);
      const newStatus = fully === total ? 'received' : 'partially_received';

      const updated = await getSql()(
        `UPDATE purchase_orders
         SET status = $1,
             first_received_at = COALESCE(first_received_at, NOW()),
             fully_received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE fully_received_at END,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [newStatus, input.po_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'purchase_orders', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.po_id,
          JSON.stringify({ status_transition: `→${newStatus}`, lines_received: input.items.length }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to receive purchase order',
        cause: error,
      });
    }
  });

/** List purchase orders for the hospital, optional filters. */
export const purchaseOrderListProcedure = protectedProcedure
  .input(
    z.object({
      status: z.string().optional(),
      vendor_id: z.string().uuid().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = 'po.hospital_id = $1';
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.status) {
        where += ` AND po.status = $${p++}`;
        params.push(input.status);
      }
      if (input.vendor_id) {
        where += ` AND po.vendor_id = $${p++}`;
        params.push(input.vendor_id);
      }

      const rows = await getSql()(
        `SELECT po.*, v.vendor_name, u.full_name AS created_by_name
         FROM purchase_orders po
         LEFT JOIN vendors v ON po.vendor_id = v.id
         LEFT JOIN users u ON po.created_by = u.id
         WHERE ${where}
         ORDER BY po.created_at DESC`,
        params
      );
      return rows;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list purchase orders',
        cause: error,
      });
    }
  });

/** List line items for a single PO. Hospital-scoped via ctx.user.hospital_id. */
export const purchaseOrderListItemsProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      // Hospital-scope check: only return items for POs owned by this hospital
      const poCheck = await getSql()(
        `SELECT id FROM purchase_orders WHERE id = $1 AND hospital_id = $2`,
        [input, ctx.user.hospital_id]
      );
      if (!poCheck.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase order not found' });
      }

      const rows = await getSql()(
        `SELECT poi.*, it.kind, it.unit_of_measure, it.generic_name
         FROM purchase_order_items poi
         LEFT JOIN items it ON poi.item_id = it.id
         WHERE poi.po_id = $1 AND poi.hospital_id = $2
         ORDER BY poi.created_at ASC`,
        [input, ctx.user.hospital_id]
      );
      return rows;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list PO items',
        cause: error,
      });
    }
  });

// ---------- Router ----------

export const scmPurchaseOrdersRouter = router({
  create: purchaseOrderCreateProcedure,
  addItem: purchaseOrderAddItemProcedure,
  approve: purchaseOrderApproveProcedure,
  sendToVendor: purchaseOrderSendToVendorProcedure,
  receive: purchaseOrderReceiveProcedure,
  list: purchaseOrderListProcedure,
  listItems: purchaseOrderListItemsProcedure,
});
