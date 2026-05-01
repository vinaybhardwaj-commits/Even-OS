import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';

// ============================================================
// SCM › INVENTORY — Phase 1.4 router (Q2 Path C)
//
// Extracted from pharmacy.ts (6 procedures). Generalized over canonical
// `inventory` table (63-scm-core.ts) — drug_id ⇒ item_id, batch+location
// keyed (uq_inventory_location_batch).
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

export const inventoryAddSchema = z.object({
  item_id: z.string().uuid(),
  location: z.string().min(1),
  batch_number: z.string().min(1),
  manufacturer: z.string().min(1),
  expiry_date: z.string(),
  quantity_on_hand: z.number().positive(),
  unit_cost: z.number().positive(),
  mrp: z.number().positive(),
  reorder_level: z.number().nonnegative(),
  reorder_quantity: z.number().positive(),
  max_stock_level: z.number().positive(),
});

const stockAdjustmentSchema = z.object({
  inventory_id: z.string().uuid(),
  type: z.enum(['adjustment_increase', 'adjustment_decrease']),
  quantity: z.number().positive(),
  reason: z.string().min(1),
});

const stockTransferSchema = z.object({
  inventory_id: z.string().uuid(),
  quantity: z.number().positive(),
  destination_location: z.string().min(1),
  reason: z.string().optional(),
});

// ---------- Named procedure exports ----------

/** Add a new inventory row (item × location × batch). */
export const inventoryAddProcedure = protectedProcedure
  .input(inventoryAddSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      const result = await getSql()(
        `INSERT INTO inventory (
          hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
          quantity_on_hand, quantity_reserved, quantity_in_transit,
          unit_cost, mrp, reorder_level, reorder_quantity, max_stock_level,
          is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, 0, 0,
          $8, $9, $10, $11, $12,
          TRUE
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          input.item_id,
          input.location,
          input.batch_number,
          input.manufacturer,
          input.expiry_date,
          input.quantity_on_hand,
          input.unit_cost,
          input.mrp,
          input.reorder_level,
          input.reorder_quantity,
          input.max_stock_level,
        ]
      );

      const itemRow = await getSql()(
        `SELECT display_name FROM items WHERE id = $1`,
        [input.item_id]
      );
      const itemName = itemRow[0]?.display_name || 'unknown';

      await getSql()(
        `INSERT INTO stock_movements (
          hospital_id, inventory_id, item_id, item_name,
          movement_type, quantity, previous_balance, new_balance,
          batch_number, location, source_module,
          unit_cost, total_value, created_by
        ) VALUES (
          $1, $2, $3, $4,
          'grn_receive', $5, 0, $5,
          $6, $7, 'scm',
          $8, $9, $10
        )`,
        [
          ctx.user.hospital_id,
          result[0].id,
          input.item_id,
          itemName,
          input.quantity_on_hand,
          input.batch_number,
          input.location,
          input.unit_cost,
          input.quantity_on_hand * input.unit_cost,
          ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'inventory', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          result[0].id,
          JSON.stringify({ item_id: input.item_id, location: input.location, batch: input.batch_number, qty: input.quantity_on_hand }),
        ]
      );

      return result[0];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to add inventory',
        cause: error,
      });
    }
  });

/** List inventory rows for the hospital, optionally filtered. */
export const inventoryListProcedure = protectedProcedure
  .input(
    z.object({
      item_id: z.string().uuid().optional(),
      location: z.string().optional(),
      low_stock_only: z.boolean().optional(),
      expiring_within_days: z.number().int().positive().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = 'inv.hospital_id = $1';
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.item_id) {
        where += ` AND inv.item_id = $${p++}`;
        params.push(input.item_id);
      }
      if (input.location) {
        where += ` AND inv.location = $${p++}`;
        params.push(input.location);
      }
      if (input.low_stock_only) {
        where += ` AND inv.quantity_on_hand <= COALESCE(inv.reorder_level, it.default_reorder_level, 0)`;
      }
      if (input.expiring_within_days) {
        where += ` AND inv.expiry_date <= (CURRENT_DATE + INTERVAL '${input.expiring_within_days} days')`;
      }

      const rows = await getSql()(
        `SELECT inv.*, it.display_name AS item_name, it.generic_name, it.kind
         FROM inventory inv
         LEFT JOIN items it ON inv.item_id = it.id
         WHERE ${where}
         ORDER BY inv.expiry_date ASC NULLS LAST`,
        params
      );
      return rows;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list inventory',
        cause: error,
      });
    }
  });

/** Get a single inventory row by id (hospital-scoped). */
export const inventoryDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      const rows = await getSql()(
        `SELECT inv.*, it.display_name AS item_name, it.generic_name, it.strength, it.kind
         FROM inventory inv
         LEFT JOIN items it ON inv.item_id = it.id
         WHERE inv.id = $1 AND inv.hospital_id = $2`,
        [input, ctx.user.hospital_id]
      );
      if (!rows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
      }
      return rows[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch inventory detail',
        cause: error,
      });
    }
  });

/** Adjust stock up or down. */
export const inventoryAdjustProcedure = protectedProcedure
  .input(stockAdjustmentSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      const inv = await getSql()(
        `SELECT inv.*, it.display_name AS item_name FROM inventory inv
         LEFT JOIN items it ON inv.item_id = it.id
         WHERE inv.id = $1 AND inv.hospital_id = $2`,
        [input.inventory_id, ctx.user.hospital_id]
      );
      if (!inv.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
      }

      const row = inv[0];
      const prev = Number(row.quantity_on_hand);
      const delta = input.type === 'adjustment_increase' ? input.quantity : -input.quantity;
      const next = prev + delta;
      if (next < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Adjustment would result in negative stock' });
      }

      await getSql()(
        `UPDATE inventory
         SET quantity_on_hand = $1,
             last_movement_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [next, input.inventory_id]
      );

      const movement = await getSql()(
        `INSERT INTO stock_movements (
          hospital_id, inventory_id, item_id, item_name,
          movement_type, quantity, previous_balance, new_balance,
          batch_number, location, source_module,
          unit_cost, total_value, reason, created_by
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, 'scm',
          $11, $12, $13, $14
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          input.inventory_id,
          row.item_id,
          row.item_name || 'unknown',
          input.type,
          delta,
          prev,
          next,
          row.batch_number,
          row.location,
          row.unit_cost,
          input.quantity * Number(row.unit_cost || 0),
          input.reason,
          ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'inventory', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.inventory_id,
          JSON.stringify({ adjustment: input.type, qty: input.quantity, reason: input.reason, prev, next }),
        ]
      );

      return movement[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to adjust stock',
        cause: error,
      });
    }
  });

/** Transfer stock from one location to another within the hospital. */
export const inventoryTransferProcedure = protectedProcedure
  .input(stockTransferSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      const inv = await getSql()(
        `SELECT inv.*, it.display_name AS item_name FROM inventory inv
         LEFT JOIN items it ON inv.item_id = it.id
         WHERE inv.id = $1 AND inv.hospital_id = $2`,
        [input.inventory_id, ctx.user.hospital_id]
      );
      if (!inv.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
      }
      const src = inv[0];
      const srcAvail = Number(src.quantity_on_hand) - Number(src.quantity_reserved);
      if (srcAvail < input.quantity) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient available stock for transfer' });
      }

      const srcPrev = Number(src.quantity_on_hand);
      const srcNext = srcPrev - input.quantity;

      await getSql()(
        `INSERT INTO stock_movements (
          hospital_id, inventory_id, item_id, item_name,
          movement_type, quantity, previous_balance, new_balance,
          batch_number, location, source_module,
          unit_cost, total_value, reason, created_by
        ) VALUES (
          $1, $2, $3, $4,
          'transfer_out', $5, $6, $7,
          $8, $9, 'scm',
          $10, $11, $12, $13
        )`,
        [
          ctx.user.hospital_id,
          input.inventory_id,
          src.item_id,
          src.item_name || 'unknown',
          -input.quantity,
          srcPrev,
          srcNext,
          src.batch_number,
          src.location,
          src.unit_cost,
          input.quantity * Number(src.unit_cost || 0),
          input.reason || null,
          ctx.user.sub,
        ]
      );

      const destExisting = await getSql()(
        `SELECT id, quantity_on_hand FROM inventory
         WHERE hospital_id = $1 AND item_id = $2
           AND location = $3
           AND COALESCE(batch_number,'') = COALESCE($4::text,'')`,
        [ctx.user.hospital_id, src.item_id, input.destination_location, src.batch_number || null]
      );

      let destId: string;
      let destPrev: number;
      let destNext: number;
      if (destExisting.length) {
        destId = destExisting[0].id;
        destPrev = Number(destExisting[0].quantity_on_hand);
        destNext = destPrev + input.quantity;
        await getSql()(
          `UPDATE inventory SET quantity_on_hand = $1, last_movement_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [destNext, destId]
        );
      } else {
        const inserted = await getSql()(
          `INSERT INTO inventory (
            hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
            quantity_on_hand, quantity_reserved, quantity_in_transit,
            unit_cost, mrp, is_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, 0, 0, $8, $9, TRUE
          ) RETURNING id`,
          [
            ctx.user.hospital_id,
            src.item_id,
            input.destination_location,
            src.batch_number,
            src.manufacturer,
            src.expiry_date,
            input.quantity,
            src.unit_cost,
            src.mrp,
          ]
        );
        destId = inserted[0].id;
        destPrev = 0;
        destNext = input.quantity;
      }

      const transferIn = await getSql()(
        `INSERT INTO stock_movements (
          hospital_id, inventory_id, item_id, item_name,
          movement_type, quantity, previous_balance, new_balance,
          batch_number, location, source_module,
          unit_cost, total_value, reason, created_by
        ) VALUES (
          $1, $2, $3, $4,
          'transfer_in', $5, $6, $7,
          $8, $9, 'scm',
          $10, $11, $12, $13
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          destId,
          src.item_id,
          src.item_name || 'unknown',
          input.quantity,
          destPrev,
          destNext,
          src.batch_number,
          input.destination_location,
          src.unit_cost,
          input.quantity * Number(src.unit_cost || 0),
          input.reason || null,
          ctx.user.sub,
        ]
      );

      await getSql()(
        `UPDATE inventory SET quantity_on_hand = $1, last_movement_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [srcNext, input.inventory_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'inventory', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.inventory_id,
          JSON.stringify({ transfer: { from: src.location, to: input.destination_location, qty: input.quantity, dest_inventory_id: destId } }),
        ]
      );

      return transferIn[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to transfer stock',
        cause: error,
      });
    }
  });

/** Items expiring within N days. Hospital-scoped, ordered ASC. */
export const inventoryExpiryWatchlistProcedure = protectedProcedure
  .input(
    z.object({
      days_until_expiry: z.number().int().positive().default(30),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      const rows = await getSql()(
        `SELECT inv.*, it.display_name AS item_name, it.generic_name, it.kind
         FROM inventory inv
         LEFT JOIN items it ON inv.item_id = it.id
         WHERE inv.hospital_id = $1
           AND inv.expiry_date <= (CURRENT_DATE + INTERVAL '${input.days_until_expiry} days')
           AND inv.expiry_date > CURRENT_DATE
           AND inv.is_active = TRUE
         ORDER BY inv.expiry_date ASC`,
        [ctx.user.hospital_id]
      );
      return rows;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch expiry watchlist',
        cause: error,
      });
    }
  });

// ---------- Router ----------

export const scmInventoryRouter = router({
  add: inventoryAddProcedure,
  list: inventoryListProcedure,
  detail: inventoryDetailProcedure,
  adjust: inventoryAdjustProcedure,
  transfer: inventoryTransferProcedure,
  expiryWatchlist: inventoryExpiryWatchlistProcedure,
});
