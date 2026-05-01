import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';

// ============================================================
// SCM › ALERTS — Phase 1.4 router (Q2 Path C)
//
// Architectural note (Phase 1.4 build log):
//   Legacy `stock_alerts` table was DROPPED in 0060 migration. Canonical
//   equivalent: `auto_reorder_drafts` — same intent (low-stock threshold
//   breached → action item), forward-compatible with Phase 2 auto-PR /
//   auto-PO conversion flow.
//
//   Status mapping:
//     legacy 'unresolved' → auto_reorder_drafts.status = 'pending_review'
//     legacy 'resolved'   → 'rejected' (acknowledged, no action)
//                            OR 'converted_to_pr'/'converted_to_po' (acted on)
//
// Procedures exported as named consts for re-use in legacy router
// re-exports (Phase 1.4 Q2 Path C).
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Named procedure exports ----------

/** Scan inventory for low-stock items, generate auto_reorder_drafts. */
export const alertsCheckLowStockProcedure = protectedProcedure.mutation(async ({ ctx }) => {
  try {
    await assertHasScmRole(ctx, ['inventory_manager', 'po_creator']);
    const lowStockItems = await getSql()(
      `SELECT inv.id AS inventory_id, inv.item_id, inv.quantity_on_hand,
              COALESCE(inv.reorder_level, it.default_reorder_level, 0) AS effective_reorder_level,
              COALESCE(inv.reorder_quantity, it.default_reorder_quantity, 0) AS suggested_quantity,
              inv.unit_cost,
              it.preferred_vendor_id
       FROM inventory inv
       LEFT JOIN items it ON inv.item_id = it.id
       WHERE inv.hospital_id = $1
         AND inv.is_active = TRUE
         AND inv.quantity_on_hand <= COALESCE(inv.reorder_level, it.default_reorder_level, 0)`,
      [ctx.user.hospital_id]
    );

    let createdCount = 0;

    for (const row of lowStockItems) {
      const existing = await getSql()(
        `SELECT id FROM auto_reorder_drafts
         WHERE hospital_id = $1 AND inventory_id = $2 AND status = 'pending_review'`,
        [ctx.user.hospital_id, row.inventory_id]
      );

      if (existing.length) continue;

      await getSql()(
        `INSERT INTO auto_reorder_drafts (
          hospital_id, item_id, inventory_id,
          current_quantity, reorder_level, suggested_quantity,
          suggested_vendor_id, suggested_unit_cost,
          status, expires_at
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6,
          $7, $8,
          'pending_review', NOW() + INTERVAL '14 days'
        )`,
        [
          ctx.user.hospital_id,
          row.item_id,
          row.inventory_id,
          row.quantity_on_hand,
          row.effective_reorder_level,
          row.suggested_quantity,
          row.preferred_vendor_id || null,
          row.unit_cost || null,
        ]
      );
      createdCount += 1;
    }

    await getSql()(
      `INSERT INTO audit_logs (
        hospital_id, user_id, action, table_name, row_id,
        new_values, ip_address, created_at
      ) VALUES ($1, $2, 'INSERT', 'auto_reorder_drafts', 'low_stock_scan', $3::jsonb, 'server', NOW())`,
      [
        ctx.user.hospital_id,
        ctx.user.sub,
        JSON.stringify({ scanned: lowStockItems.length, drafts_created: createdCount }),
      ]
    );

    return { drafts_created: createdCount, low_stock_inventory_rows: lowStockItems.length };
  } catch (error) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to scan for low stock',
      cause: error,
    });
  }
});

/** List active alerts (auto_reorder_drafts pending_review). */
export const alertsListProcedure = protectedProcedure
  .input(
    z.object({
      only_unreviewed: z.boolean().default(true),
      limit: z.number().int().positive().max(500).default(100),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = 'aro.hospital_id = $1';
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.only_unreviewed) {
        where += ` AND aro.status = 'pending_review'`;
      }

      params.push(input.limit);
      const rows = await getSql()(
        `SELECT aro.*, it.display_name AS item_name, it.kind, it.generic_name,
                inv.location, inv.batch_number,
                v.vendor_name AS suggested_vendor_name
         FROM auto_reorder_drafts aro
         LEFT JOIN items it ON aro.item_id = it.id
         LEFT JOIN inventory inv ON aro.inventory_id = inv.id
         LEFT JOIN vendors v ON aro.suggested_vendor_id = v.id
         WHERE ${where}
         ORDER BY aro.generated_at DESC
         LIMIT $${p++}`,
        params
      );
      return rows;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list alerts',
        cause: error,
      });
    }
  });

/** Resolve an alert (auto_reorder_draft) without creating a PR/PO. */
export const alertsResolveProcedure = protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      notes: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['inventory_manager', 'po_creator']);
      const updated = await getSql()(
        `UPDATE auto_reorder_drafts
         SET status = 'rejected',
             reviewed_by = $1,
             reviewed_at = NOW(),
             review_notes = $2
         WHERE id = $3 AND hospital_id = $4 AND status = 'pending_review'
         RETURNING *`,
        [ctx.user.sub, input.notes || 'acknowledged without action', input.id, ctx.user.hospital_id]
      );
      if (!updated.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending alert not found' });
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'auto_reorder_drafts', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.id,
          JSON.stringify({ resolution: 'rejected', notes: input.notes }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to resolve alert',
        cause: error,
      });
    }
  });

// ---------- Router ----------

export const scmAlertsRouter = router({
  checkLowStock: alertsCheckLowStockProcedure,
  list: alertsListProcedure,
  resolve: alertsResolveProcedure,
});
