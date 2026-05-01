import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';

// SCM router named procedure imports (Phase 1.4 Q2 Path C deprecation re-exports)
import {
  vendorCreateProcedure,
  vendorListProcedure,
  vendorUpdateProcedure,
  vendorDetailProcedure,
} from './scm/vendors';
import {
  inventoryAddProcedure,
  inventoryListProcedure,
  inventoryDetailProcedure,
  inventoryAdjustProcedure,
  inventoryTransferProcedure,
  inventoryExpiryWatchlistProcedure,
} from './scm/inventory';
import {
  purchaseOrderCreateProcedure,
  purchaseOrderAddItemProcedure,
  purchaseOrderApproveProcedure,
  purchaseOrderSendToVendorProcedure,
  purchaseOrderReceiveProcedure,
  purchaseOrderListProcedure,
} from './scm/purchase-orders';
import {
  alertsCheckLowStockProcedure,
  alertsListProcedure,
  alertsResolveProcedure,
} from './scm/alerts';

// ============================================================
// PHARMACY CLINICAL ROUTER — Phase 1.4 split (Q2 Path C)
//
// File renamed from pharmacy.ts → pharmacy-clinical.ts. The router export
// name (`pharmacyRouter`) and namespace (`appRouter.pharmacy`) are unchanged
// for backward compat — only the FILE moved. This router now contains:
//
//   1. CLINICAL procedures (kept): narcotics + dispensing + stats
//      - 5 dispensing procedures
//      - 4 narcotics-register procedures (Schedule H/H1/X + narcotic + psychotropic)
//      - 2 stats procedures (pharmacyStats, dispensingAnalytics)
//
//   2. DEPRECATION RE-EXPORTS (Phase 8 will remove): legacy SCM procedure
//      names (createVendor, addInventory, etc.) re-pointed at the canonical
//      scm.* procedures. Same procedure object, exposed under both names.
//      No logic duplication. Existing UI / tests continue to work without
//      changes; new code should call appRouter.scm.{vendors,items,inventory,
//      purchaseOrders,alerts}.* directly.
//
// SCM-related tables that USED to live here (pharmacy_inventory,
// stock_movements, purchase_orders, purchase_order_items, stock_alerts)
// were dropped in 0060 migration. Their procedures were extracted to
// scm/*.ts in phase-1.4.a.
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Validation schemas ----------

const dispensingSchema = z.object({
  medication_order_id: z.string().uuid(),
  dr_inventory_id: z.string().uuid(),
  quantity_dispensed: z.number().int().positive(),
  dr_notes: z.string().optional(),
});

const narcoticsMovementSchema = z.object({
  nr_drug_id: z.string().uuid(),
  nr_class: z.enum(['schedule_h', 'schedule_h1', 'schedule_x', 'narcotic', 'psychotropic']),
  nr_movement_type: z.enum(['receipt', 'issue', 'return', 'adjustment', 'destruction']),
  nr_quantity: z.number().int().positive(),
  nr_patient_id: z.string().uuid().optional(),
  nr_encounter_id: z.string().uuid().optional(),
  nr_witnessed_by: z.string().uuid().optional(),
  nr_notes: z.string().optional(),
});

// ============================================================
// CLINICAL — DISPENSING (5 procedures)
// ============================================================

const dispenseMedication = protectedProcedure
  .input(dispensingSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      const order = await getSql()(
        `SELECT mo.* FROM medication_orders mo
        WHERE mo.id = $1 AND mo.hospital_id = $2`,
        [input.medication_order_id, ctx.user.hospital_id]
      );

      if (!order.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Medication order not found' });
      }

      // Get inventory details (now from canonical inventory table; SCM
      // generalization — dr_inventory_id is the canonical inventory.id;
      // legacy pharmacy_inventory rows were migrated in phase-1.3 backfill).
      const inventory = await getSql()(
        `SELECT inv.*, it.display_name AS drug_name FROM inventory inv
        LEFT JOIN items it ON inv.item_id = it.id
        WHERE inv.id = $1 AND inv.hospital_id = $2`,
        [input.dr_inventory_id, ctx.user.hospital_id]
      );

      if (!inventory.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory item not found' });
      }

      const inv = inventory[0];
      const available = Number(inv.quantity_on_hand) - Number(inv.quantity_reserved);
      if (available < input.quantity_dispensed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insufficient stock to dispense' });
      }

      // Create dispensing record
      const dispensing = await getSql()(
        `INSERT INTO dispensing_records
        (hospital_id, dr_patient_id, dr_encounter_id, medication_order_id, dr_inventory_id,
         dr_drug_id, dr_drug_name, dr_batch_number, quantity_ordered, quantity_dispensed,
         dr_unit_price, dr_total_amount, dr_status, dispensed_by, dispensed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'dispensed', $13, NOW())
        RETURNING *`,
        [
          ctx.user.hospital_id,
          order[0].mo_patient_id,
          order[0].mo_encounter_id,
          input.medication_order_id,
          input.dr_inventory_id,
          inv.item_id,
          inv.drug_name,
          inv.batch_number,
          order[0].mo_frequency || input.quantity_dispensed,
          input.quantity_dispensed,
          inv.unit_cost,
          input.quantity_dispensed * Number(inv.unit_cost),
          ctx.user.sub,
        ]
      );

      // Update inventory (deduct stock)
      const prevBalance = Number(inv.quantity_on_hand);
      const newBalance = prevBalance - input.quantity_dispensed;
      await getSql()(
        `UPDATE inventory
        SET quantity_on_hand = $1,
            last_movement_at = NOW(),
            updated_at = NOW()
        WHERE id = $2`,
        [newBalance, input.dr_inventory_id]
      );

      // Create stock movement (issue, source_module='pharmacy')
      await getSql()(
        `INSERT INTO stock_movements
        (hospital_id, inventory_id, item_id, item_name,
         movement_type, quantity, previous_balance, new_balance,
         batch_number, location, source_module, source_ref_id,
         unit_cost, total_value, created_by)
        VALUES ($1, $2, $3, $4, 'issue', $5, $6, $7, $8, $9, 'pharmacy', $10,
                $11, $12, $13)`,
        [
          ctx.user.hospital_id,
          input.dr_inventory_id,
          inv.item_id,
          inv.drug_name,
          -input.quantity_dispensed, // signed
          prevBalance,
          newBalance,
          inv.batch_number,
          inv.location,
          dispensing[0].id,
          inv.unit_cost,
          input.quantity_dispensed * Number(inv.unit_cost),
          ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'dispensing_records', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          dispensing[0].id,
          JSON.stringify({ medication_order_id: input.medication_order_id, qty: input.quantity_dispensed }),
        ]
      );

      return dispensing[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to dispense medication',
        cause: error,
      });
    }
  });

const returnMedication = protectedProcedure
  .input(
    z.object({
      dr_id: z.string().uuid(),
      quantity_returned: z.number().int().positive(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      const dispensing = await getSql()(
        `SELECT * FROM dispensing_records
        WHERE id = $1 AND hospital_id = $2`,
        [input.dr_id, ctx.user.hospital_id]
      );

      if (!dispensing.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dispensing record not found' });
      }

      const disp = dispensing[0];

      if (input.quantity_returned > disp.quantity_dispensed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Return quantity exceeds dispensed quantity' });
      }

      const updated = await getSql()(
        `UPDATE dispensing_records
        SET quantity_returned = $1,
            dr_status = CASE WHEN $1 = quantity_dispensed THEN 'returned' ELSE 'partially_returned' END,
            dr_returned_at = NOW(),
            dr_returned_by = $2
        WHERE id = $3
        RETURNING *`,
        [input.quantity_returned, ctx.user.sub, input.dr_id]
      );

      // Update inventory (return to stock)
      await getSql()(
        `UPDATE inventory
        SET quantity_on_hand = quantity_on_hand + $1,
            last_movement_at = NOW(),
            updated_at = NOW()
        WHERE id = $2`,
        [input.quantity_returned, disp.dr_inventory_id]
      );

      // Append to ledger (return movement, source_module='pharmacy')
      await getSql()(
        `INSERT INTO stock_movements
        (hospital_id, inventory_id, item_id, item_name,
         movement_type, quantity, previous_balance, new_balance,
         batch_number, location, source_module, source_ref_id,
         created_by)
        SELECT $1, inv.id, inv.item_id, COALESCE(it.display_name,'unknown'),
               'return', $2,
               inv.quantity_on_hand - $2, inv.quantity_on_hand,
               inv.batch_number, inv.location, 'pharmacy', $3,
               $4
        FROM inventory inv LEFT JOIN items it ON inv.item_id = it.id
        WHERE inv.id = $5`,
        [ctx.user.hospital_id, input.quantity_returned, input.dr_id, ctx.user.sub, disp.dr_inventory_id]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'dispensing_records', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.dr_id,
          JSON.stringify({ return: input.quantity_returned }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to return medication',
        cause: error,
      });
    }
  });

const listDispensingRecords = protectedProcedure
  .input(
    z.object({
      dr_patient_id: z.string().uuid().optional(),
      dr_encounter_id: z.string().uuid().optional(),
      dr_status: z.string().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = 'dr.hospital_id = $1';
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.dr_patient_id) {
        where += ` AND dr.dr_patient_id = $${p++}`;
        params.push(input.dr_patient_id);
      }
      if (input.dr_encounter_id) {
        where += ` AND dr.dr_encounter_id = $${p++}`;
        params.push(input.dr_encounter_id);
      }
      if (input.dr_status) {
        where += ` AND dr.dr_status = $${p++}`;
        params.push(input.dr_status);
      }

      const records = await getSql()(
        `SELECT dr.*, p.name_full, u.full_name as dispensed_by_name
        FROM dispensing_records dr
        LEFT JOIN patients p ON dr.dr_patient_id = p.id
        LEFT JOIN users u ON dr.dispensed_by = u.id
        WHERE ${where}
        ORDER BY dr.dispensed_at DESC`,
        params
      );

      return records;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list dispensing records',
        cause: error,
      });
    }
  });

const dispensingDetail = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      const record = await getSql()(
        `SELECT dr.*, p.name_full, u.full_name as dispensed_by_name, it.display_name AS drug_name
        FROM dispensing_records dr
        LEFT JOIN patients p ON dr.dr_patient_id = p.id
        LEFT JOIN users u ON dr.dispensed_by = u.id
        LEFT JOIN items it ON dr.dr_drug_id = it.id
        WHERE dr.id = $1 AND dr.hospital_id = $2`,
        [input, ctx.user.hospital_id]
      );

      if (!record.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dispensing record not found' });
      }

      return record[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch dispensing details',
        cause: error,
      });
    }
  });

const pendingDispensing = protectedProcedure
  .input(
    z.object({
      dr_encounter_id: z.string().uuid().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = `mo.hospital_id = $1 AND mo.mo_status = 'active'`;
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.dr_encounter_id) {
        where += ` AND mo.mo_encounter_id = $${p++}`;
        params.push(input.dr_encounter_id);
      }

      const pending = await getSql()(
        `SELECT mo.*, p.name_full, it.display_name AS drug_name, it.strength
        FROM medication_orders mo
        LEFT JOIN patients p ON mo.mo_patient_id = p.id
        LEFT JOIN items it ON mo.mo_drug_id = it.id
        WHERE ${where}
        AND NOT EXISTS (
          SELECT 1 FROM dispensing_records dr
          WHERE dr.medication_order_id = mo.id AND dr.dr_status IN ('dispensed', 'partially_dispensed')
        )
        ORDER BY mo.mo_created_at ASC`,
        params
      );

      return pending;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch pending dispensing',
        cause: error,
      });
    }
  });

// ============================================================
// CLINICAL — NARCOTICS REGISTER (4 procedures)
// ============================================================

const recordNarcoticMovement = protectedProcedure
  .input(narcoticsMovementSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      const lastRecord = await getSql()(
        `SELECT nr_running_balance FROM narcotics_register
        WHERE hospital_id = $1 AND nr_drug_id = $2
        ORDER BY nr_recorded_at DESC LIMIT 1`,
        [ctx.user.hospital_id, input.nr_drug_id]
      );

      const previousBalance = lastRecord.length > 0 ? Number(lastRecord[0].nr_running_balance) : 0;

      let newBalance = previousBalance;
      if (input.nr_movement_type === 'receipt') {
        newBalance = previousBalance + input.nr_quantity;
      } else if (input.nr_movement_type === 'issue') {
        newBalance = previousBalance - input.nr_quantity;
      } else if (input.nr_movement_type === 'return') {
        newBalance = previousBalance + input.nr_quantity;
      }

      if (newBalance < 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Narcotic adjustment would result in negative balance',
        });
      }

      // Drug lookup now via items table (unified item master)
      const drug = await getSql()(
        `SELECT display_name FROM items WHERE id = $1`,
        [input.nr_drug_id]
      );

      if (!drug.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Drug not found' });
      }

      const record = await getSql()(
        `INSERT INTO narcotics_register
        (hospital_id, nr_drug_id, nr_drug_name, nr_class, nr_movement_type, nr_quantity,
         nr_running_balance, nr_patient_id, nr_encounter_id, nr_performed_by, nr_witnessed_by,
         witness_verified, nr_notes, nr_recorded_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        RETURNING *`,
        [
          ctx.user.hospital_id,
          input.nr_drug_id,
          drug[0].display_name,
          input.nr_class,
          input.nr_movement_type,
          input.nr_quantity,
          newBalance,
          input.nr_patient_id || null,
          input.nr_encounter_id || null,
          ctx.user.sub,
          input.nr_witnessed_by || null,
          !!input.nr_witnessed_by,
          input.nr_notes || null,
        ]
      );

      // Audit + event_log (high-stakes — narcotic movement, V's standing rule)
      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'narcotics_register', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          record[0].id,
          JSON.stringify({
            class: input.nr_class,
            movement_type: input.nr_movement_type,
            qty: input.nr_quantity,
            running_balance: newBalance,
            witnessed_by: input.nr_witnessed_by,
          }),
        ]
      );

      return record[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to record narcotic movement',
        cause: error,
      });
    }
  });

const narcoticsAudit = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      const records = await getSql()(
        `SELECT nr.*, u.full_name as performed_by_name, uw.full_name as witnessed_by_name
        FROM narcotics_register nr
        LEFT JOIN users u ON nr.nr_performed_by = u.id
        LEFT JOIN users uw ON nr.nr_witnessed_by = uw.id
        WHERE nr.hospital_id = $1 AND nr.nr_drug_id = $2
        ORDER BY nr.nr_recorded_at ASC`,
        [ctx.user.hospital_id, input]
      );

      return records;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch narcotic audit trail',
        cause: error,
      });
    }
  });

const narcoticsBalance = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      const balance = await getSql()(
        `SELECT nr_drug_id, nr_drug_name, nr_class, nr_running_balance as current_balance
        FROM narcotics_register
        WHERE hospital_id = $1 AND nr_drug_id = $2
        ORDER BY nr_recorded_at DESC LIMIT 1`,
        [ctx.user.hospital_id, input]
      );

      if (!balance.length) {
        return { current_balance: 0, nr_drug_name: null };
      }

      return balance[0];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch narcotic balance',
        cause: error,
      });
    }
  });

const narcoticsReport = protectedProcedure
  .input(
    z.object({
      nr_class: z.enum(['schedule_h', 'schedule_h1', 'schedule_x', 'narcotic', 'psychotropic']).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = 'nr.hospital_id = $1';
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.nr_class) {
        where += ` AND nr.nr_class = $${p++}`;
        params.push(input.nr_class);
      }
      if (input.date_from) {
        where += ` AND nr.nr_recorded_at >= $${p++}`;
        params.push(input.date_from);
      }
      if (input.date_to) {
        where += ` AND nr.nr_recorded_at <= $${p++}`;
        params.push(input.date_to);
      }

      const report = await getSql()(
        `SELECT
          nr_drug_id, nr_drug_name, nr_class,
          COUNT(*) as movement_count,
          SUM(CASE WHEN nr_movement_type = 'receipt' THEN nr_quantity ELSE 0 END) as total_received,
          SUM(CASE WHEN nr_movement_type = 'issue' THEN nr_quantity ELSE 0 END) as total_issued,
          MAX(nr_running_balance) as current_balance
        FROM narcotics_register nr
        WHERE ${where}
        GROUP BY nr_drug_id, nr_drug_name, nr_class
        ORDER BY nr_drug_name`,
        params
      );

      return report;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to generate narcotic report',
        cause: error,
      });
    }
  });

// ============================================================
// CLINICAL — STATS (2 procedures)
// ============================================================

const pharmacyStats = protectedProcedure.query(async ({ ctx }) => {
  try {
    // Stats now run against canonical inventory + items + auto_reorder_drafts
    const stats = await getSql()(
      `SELECT
        COUNT(DISTINCT inv.id) as total_items,
        COUNT(DISTINCT inv.location) as locations,
        SUM(inv.quantity_on_hand * inv.unit_cost) as total_stock_value,
        COUNT(DISTINCT CASE
          WHEN inv.quantity_on_hand <= COALESCE(inv.reorder_level, it.default_reorder_level, 0)
          THEN inv.id END) as low_stock_items,
        (SELECT COUNT(*) FROM auto_reorder_drafts
          WHERE hospital_id = $1 AND status = 'pending_review') as active_alerts
      FROM inventory inv
      LEFT JOIN items it ON inv.item_id = it.id
      WHERE inv.hospital_id = $1 AND it.kind = 'drug'`,
      [ctx.user.hospital_id]
    );

    const movementCounts = await getSql()(
      `SELECT
        movement_type,
        COUNT(*) as count
      FROM stock_movements
      WHERE hospital_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY movement_type`,
      [ctx.user.hospital_id]
    );

    return {
      inventory: stats[0],
      movements: movementCounts,
    };
  } catch (error) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch pharmacy stats',
      cause: error,
    });
  }
});

const dispensingAnalytics = protectedProcedure
  .input(
    z.object({
      days_back: z.number().int().positive().default(30),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      const topDrugs = await getSql()(
        `SELECT
          dr_drug_id, dr_drug_name,
          COUNT(*) as dispensing_count,
          SUM(quantity_dispensed) as total_quantity,
          AVG(dr_total_amount) as avg_amount
        FROM dispensing_records
        WHERE hospital_id = $1 AND dispensed_at > NOW() - INTERVAL '${input.days_back} days'
        GROUP BY dr_drug_id, dr_drug_name
        ORDER BY dispensing_count DESC
        LIMIT 10`,
        [ctx.user.hospital_id]
      );

      const returnRate = await getSql()(
        `SELECT
          COUNT(CASE WHEN dr_status = 'returned' THEN 1 END)::float /
          NULLIF(COUNT(*), 0) * 100 as return_percentage
        FROM dispensing_records
        WHERE hospital_id = $1 AND dispensed_at > NOW() - INTERVAL '${input.days_back} days'`,
        [ctx.user.hospital_id]
      );

      return {
        top_dispensed_drugs: topDrugs,
        return_rate: returnRate[0]?.return_percentage || 0,
      };
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch dispensing analytics',
        cause: error,
      });
    }
  });

// ============================================================
// PHARMACY ROUTER — clinical procedures + deprecation re-exports
//
// Phase 8 cleanup: drop the deprecation re-exports once UI / tests
// migrate to appRouter.scm.*. Until then, the pharmacy.* namespace
// continues to work for backward compat.
// ============================================================

export const pharmacyRouter = router({
  // ---------- CLINICAL (kept; Pharmacy v2 Q3 locked surfaces) ----------
  // Dispensing
  dispenseMedication,
  returnMedication,
  listDispensingRecords,
  dispensingDetail,
  pendingDispensing,
  // Narcotics register
  recordNarcoticMovement,
  narcoticsAudit,
  narcoticsBalance,
  narcoticsReport,
  // Stats
  pharmacyStats,
  dispensingAnalytics,

  // ---------- DEPRECATION RE-EXPORTS (Phase 8 will drop) ----------
  // Vendors → scm.vendors.*
  createVendor: vendorCreateProcedure,
  listVendors: vendorListProcedure,
  updateVendor: vendorUpdateProcedure,
  vendorDetail: vendorDetailProcedure,
  // Inventory → scm.inventory.*
  addInventory: inventoryAddProcedure,
  listInventory: inventoryListProcedure,
  getInventoryDetail: inventoryDetailProcedure,
  adjustStock: inventoryAdjustProcedure,
  transferStock: inventoryTransferProcedure,
  expiryWatchlist: inventoryExpiryWatchlistProcedure,
  // Purchase orders → scm.purchaseOrders.*
  createPurchaseOrder: purchaseOrderCreateProcedure,
  addPOItem: purchaseOrderAddItemProcedure,
  submitPO: purchaseOrderSendToVendorProcedure, // legacy 'submitPO' = canonical 'sendToVendor'
  approvePO: purchaseOrderApproveProcedure,
  receivePO: purchaseOrderReceiveProcedure,
  listPurchaseOrders: purchaseOrderListProcedure,
  // Alerts → scm.alerts.*
  checkLowStock: alertsCheckLowStockProcedure,
  listAlerts: alertsListProcedure,
  resolveAlert: alertsResolveProcedure,
});
