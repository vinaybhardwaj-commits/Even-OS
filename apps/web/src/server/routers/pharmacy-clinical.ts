import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// Validation schemas
const vendorSchema = z.object({
  vendor_code: z.string().min(1),
  vendor_name: z.string().min(1),
  contact_person: z.string().min(1),
  vendor_phone: z.string().min(1),
  vendor_email: z.string().email(),
  vendor_address: z.string().min(1),
  vendor_gst: z.string().optional(),
  drug_license: z.string().optional(),
  license_expiry: z.string().optional(),
  payment_terms_days: z.number().int().positive(),
  vendor_is_active: z.boolean().default(true),
});

const inventorySchema = z.object({
  pi_drug_id: z.string().uuid(),
  pi_location: z.string().min(1),
  batch_number: z.string().min(1),
  pi_manufacturer: z.string().min(1),
  expiry_date: z.string(),
  quantity_on_hand: z.number().int().positive(),
  unit_cost: z.number().positive(),
  pi_mrp: z.number().positive(),
  reorder_level: z.number().int().nonnegative(),
  reorder_quantity: z.number().int().positive(),
  max_stock_level: z.number().int().positive(),
});

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

const purchaseOrderSchema = z.object({
  po_vendor_id: z.string().uuid(),
  expected_delivery: z.string(),
  po_notes: z.string().optional(),
});

const poItemSchema = z.object({
  poi_po_id: z.string().uuid(),
  poi_drug_id: z.string().uuid(),
  poi_qty_ordered: z.number().int().positive(),
  poi_unit_cost: z.number().positive(),
  poi_batch_number: z.string().optional(),
  poi_expiry_date: z.string().optional(),
  poi_manufacturer: z.string().optional(),
});

const stockAdjustmentSchema = z.object({
  sm_inventory_id: z.string().uuid(),
  sm_type: z.enum(['adjustment_plus', 'adjustment_minus']),
  sm_quantity: z.number().int().positive(),
  sm_reason: z.string().min(1),
});

const stockTransferSchema = z.object({
  sm_inventory_id: z.string().uuid(),
  sm_quantity: z.number().int().positive(),
  sm_location: z.string().min(1),
  sm_reason: z.string().optional(),
});

export const pharmacyRouter = router({
  // VENDOR MANAGEMENT
  createVendor: protectedProcedure
    .input(vendorSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await getSql()(
          `INSERT INTO vendors
          (hospital_id, vendor_code, vendor_name, contact_person, vendor_phone, vendor_email,
           vendor_address, vendor_gst, drug_license, license_expiry, payment_terms_days, vendor_is_active, vendor_created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          RETURNING *`,
          [
            ctx.user.hospital_id,
            input.vendor_code,
            input.vendor_name,
            input.contact_person,
            input.vendor_phone,
            input.vendor_email,
            input.vendor_address,
            input.vendor_gst || null,
            input.drug_license || null,
            input.license_expiry || null,
            input.payment_terms_days,
            input.vendor_is_active,
          ]
        );
        return result[0];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create vendor',
          cause: error,
        });
      }
    }),

  listVendors: protectedProcedure
    .input(
      z.object({
        is_active: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const vendors = await getSql()(
          `SELECT * FROM vendors
          WHERE hospital_id = $1
          AND (${input.is_active ?? null}::boolean IS NULL OR vendor_is_active = ${input.is_active ?? null})
          ORDER BY vendor_name ASC`,
          [ctx.user.hospital_id]
        );
        return vendors;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list vendors',
          cause: error,
        });
      }
    }),

  updateVendor: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        ...vendorSchema.partial().shape,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      try {
        const setClause = Object.keys(updates)
          .map((key, idx) => `${key} = $${idx + 2}`)
          .join(', ');

        const result = await getSql()(
          `UPDATE vendors
          SET ${setClause}
          WHERE id = $1 AND hospital_id = $${Object.keys(updates).length + 2}
          RETURNING *`,
          [id, ...Object.values(updates), ctx.user.hospital_id]
        );

        if (!result.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Vendor not found',
          });
        }
        return result[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update vendor',
          cause: error,
        });
      }
    }),

  vendorDetail: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      try {
        const vendor = await getSql()(
          `SELECT * FROM vendors
          WHERE id = $1 AND hospital_id = $2`,
          [input, ctx.user.hospital_id]
        );

        if (!vendor.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Vendor not found',
          });
        }
        return vendor[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch vendor details',
          cause: error,
        });
      }
    }),

  // INVENTORY MANAGEMENT
  addInventory: protectedProcedure
    .input(inventorySchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await getSql()(
          `INSERT INTO pharmacy_inventory
          (hospital_id, pi_drug_id, pi_location, batch_number, pi_manufacturer, expiry_date,
           quantity_on_hand, quantity_reserved, quantity_available, unit_cost, pi_mrp,
           reorder_level, reorder_quantity, max_stock_level, pi_is_active, pi_created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9, $10, $11, $12, $13, TRUE, NOW())
          RETURNING *`,
          [
            ctx.user.hospital_id,
            input.pi_drug_id,
            input.pi_location,
            input.batch_number,
            input.pi_manufacturer,
            input.expiry_date,
            input.quantity_on_hand,
            0,
            input.unit_cost,
            input.pi_mrp,
            input.reorder_level,
            input.reorder_quantity,
            input.max_stock_level,
          ]
        );

        // Create stock movement record
        await getSql()(
          `INSERT INTO stock_movements
          (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity, previous_balance, new_balance,
           sm_batch_number, sm_location, sm_unit_cost, sm_total_value, sm_performed_by, sm_performed_at)
          SELECT $1, $2, $3, 'receipt', $4, 0, $4, $5, $6, $7, ($4 * $7), $8, NOW()
          FROM pharmacy_inventory WHERE id = $2`,
          [
            ctx.user.hospital_id,
            result[0].id,
            input.pi_drug_id,
            input.quantity_on_hand,
            input.batch_number,
            input.pi_location,
            input.unit_cost,
            ctx.user.sub,
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
    }),

  listInventory: protectedProcedure
    .input(
      z.object({
        pi_drug_id: z.string().uuid().optional(),
        pi_location: z.string().optional(),
        low_stock_only: z.boolean().optional(),
        expiring_within_days: z.number().int().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        let whereClause = 'pi.hospital_id = $1';
        const params: any[] = [ctx.user.hospital_id];
        let paramIdx = 2;

        if (input.pi_drug_id) {
          whereClause += ` AND pi_drug_id = $${paramIdx}`;
          params.push(input.pi_drug_id);
          paramIdx++;
        }

        if (input.pi_location) {
          whereClause += ` AND pi_location = $${paramIdx}`;
          params.push(input.pi_location);
          paramIdx++;
        }

        if (input.low_stock_only) {
          whereClause += ` AND quantity_available <= reorder_level`;
        }

        if (input.expiring_within_days) {
          whereClause += ` AND expiry_date <= (CURRENT_DATE + INTERVAL '${input.expiring_within_days} days')`;
        }

        const inventory = await getSql()(
          `SELECT pi.*, dm.drug_name, dm.generic_name
          FROM pharmacy_inventory pi
          LEFT JOIN drug_master dm ON pi.pi_drug_id = dm.id
          WHERE ${whereClause}
          ORDER BY expiry_date ASC`,
          params
        );

        return inventory;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list inventory',
          cause: error,
        });
      }
    }),

  getInventoryDetail: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      try {
        const inventory = await getSql()(
          `SELECT pi.*, dm.drug_name, dm.generic_name, dm.dm_strength
          FROM pharmacy_inventory pi
          LEFT JOIN drug_master dm ON pi.pi_drug_id = dm.id
          WHERE pi.id = $1 AND pi.hospital_id = $2`,
          [input, ctx.user.hospital_id]
        );

        if (!inventory.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Inventory item not found',
          });
        }
        return inventory[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch inventory details',
          cause: error,
        });
      }
    }),

  adjustStock: protectedProcedure
    .input(stockAdjustmentSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const inventory = await getSql()(
          `SELECT * FROM pharmacy_inventory WHERE id = $1 AND hospital_id = $2`,
          [input.sm_inventory_id, ctx.user.hospital_id]
        );

        if (!inventory.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Inventory item not found',
          });
        }

        const inv = inventory[0];
        const previousBalance = inv.quantity_on_hand;
        const quantityChange = input.sm_type === 'adjustment_plus' ? input.sm_quantity : -input.sm_quantity;
        const newBalance = previousBalance + quantityChange;

        if (newBalance < 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Adjustment would result in negative stock',
          });
        }

        // Update inventory
        await getSql()(
          `UPDATE pharmacy_inventory
          SET quantity_on_hand = $1, quantity_available = $2, last_restocked_at = NOW()
          WHERE id = $3`,
          [newBalance, newBalance - inv.quantity_reserved, input.sm_inventory_id]
        );

        // Create stock movement
        const movement = await getSql()(
          `INSERT INTO stock_movements
          (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity, previous_balance, new_balance,
           sm_batch_number, sm_location, sm_unit_cost, sm_total_value, sm_reason, sm_performed_by, sm_performed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
          RETURNING *`,
          [
            ctx.user.hospital_id,
            input.sm_inventory_id,
            inv.pi_drug_id,
            input.sm_type,
            input.sm_quantity,
            previousBalance,
            newBalance,
            inv.batch_number,
            inv.pi_location,
            inv.unit_cost,
            input.sm_quantity * inv.unit_cost,
            input.sm_reason,
            ctx.user.sub,
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
    }),

  transferStock: protectedProcedure
    .input(stockTransferSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const inventory = await getSql()(
          `SELECT * FROM pharmacy_inventory WHERE id = $1 AND hospital_id = $2`,
          [input.sm_inventory_id, ctx.user.hospital_id]
        );

        if (!inventory.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Inventory item not found',
          });
        }

        const inv = inventory[0];

        if (inv.quantity_available < input.sm_quantity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Insufficient available stock for transfer',
          });
        }

        // Create transfer_out movement
        await getSql()(
          `INSERT INTO stock_movements
          (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity, previous_balance, new_balance,
           sm_batch_number, sm_location, sm_unit_cost, sm_total_value, sm_reason, sm_performed_by, sm_performed_at)
          VALUES ($1, $2, $3, 'transfer_out', $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            ctx.user.hospital_id,
            input.sm_inventory_id,
            inv.pi_drug_id,
            input.sm_quantity,
            inv.quantity_on_hand,
            inv.quantity_on_hand - input.sm_quantity,
            inv.batch_number,
            inv.pi_location,
            inv.unit_cost,
            input.sm_quantity * inv.unit_cost,
            input.sm_reason || null,
            ctx.user.sub,
          ]
        );

        // Create transfer_in movement at destination
        const transferIn = await getSql()(
          `INSERT INTO stock_movements
          (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity, previous_balance, new_balance,
           sm_batch_number, sm_location, sm_unit_cost, sm_total_value, sm_reason, sm_performed_by, sm_performed_at)
          VALUES ($1, $2, $3, 'transfer_in', $4, 0, $4, $5, $6, $7, $8, $9, $10, NOW())
          RETURNING *`,
          [
            ctx.user.hospital_id,
            input.sm_inventory_id,
            inv.pi_drug_id,
            input.sm_quantity,
            inv.batch_number,
            input.sm_location,
            inv.unit_cost,
            input.sm_quantity * inv.unit_cost,
            input.sm_reason || null,
            ctx.user.sub,
          ]
        );

        // Update source inventory
        await getSql()(
          `UPDATE pharmacy_inventory
          SET quantity_on_hand = quantity_on_hand - $1,
              quantity_available = quantity_available - $1,
              last_restocked_at = NOW()
          WHERE id = $2`,
          [input.sm_quantity, input.sm_inventory_id]
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
    }),

  expiryWatchlist: protectedProcedure
    .input(
      z.object({
        days_until_expiry: z.number().int().positive().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const items = await getSql()(
          `SELECT pi.*, dm.drug_name, dm.generic_name
          FROM pharmacy_inventory pi
          LEFT JOIN drug_master dm ON pi.pi_drug_id = dm.id
          WHERE pi.hospital_id = $1
          AND pi.expiry_date <= (CURRENT_DATE + INTERVAL '${input.days_until_expiry} days')
          AND pi.expiry_date > CURRENT_DATE
          AND pi_is_active = TRUE
          ORDER BY pi.expiry_date ASC`,
          [ctx.user.hospital_id]
        );

        return items;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch expiry watchlist',
          cause: error,
        });
      }
    }),

  // DISPENSING
  dispenseMedication: protectedProcedure
    .input(dispensingSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Get medication order details
        const order = await getSql()(
          `SELECT mo.* FROM medication_orders mo
          WHERE mo.id = $1 AND mo.hospital_id = $2`,
          [input.medication_order_id, ctx.user.hospital_id]
        );

        if (!order.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Medication order not found',
          });
        }

        // Get inventory details
        const inventory = await getSql()(
          `SELECT pi.*, dm.drug_name FROM pharmacy_inventory pi
          LEFT JOIN drug_master dm ON pi.pi_drug_id = dm.id
          WHERE pi.id = $1 AND pi.hospital_id = $2`,
          [input.dr_inventory_id, ctx.user.hospital_id]
        );

        if (!inventory.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Inventory item not found',
          });
        }

        const inv = inventory[0];

        if (inv.quantity_available < input.quantity_dispensed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Insufficient stock to dispense',
          });
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
            inv.pi_drug_id,
            inv.drug_name,
            inv.batch_number,
            order[0].mo_frequency || input.quantity_dispensed,
            input.quantity_dispensed,
            inv.unit_cost,
            input.quantity_dispensed * inv.unit_cost,
            ctx.user.sub,
          ]
        );

        // Update inventory (deduct stock)
        await getSql()(
          `UPDATE pharmacy_inventory
          SET quantity_on_hand = quantity_on_hand - $1,
              quantity_available = quantity_available - $1,
              last_restocked_at = NOW()
          WHERE id = $2`,
          [input.quantity_dispensed, input.dr_inventory_id]
        );

        // Create stock movement (issue)
        await getSql()(
          `INSERT INTO stock_movements
          (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity, previous_balance, new_balance,
           sm_batch_number, sm_location, sm_unit_cost, sm_total_value, sm_ref_type, sm_ref_id, sm_performed_by, sm_performed_at)
          VALUES ($1, $2, $3, 'issue', $4, $5, $6, $7, $8, $9, $10, 'dispensing', $11, $12, NOW())`,
          [
            ctx.user.hospital_id,
            input.dr_inventory_id,
            inv.pi_drug_id,
            input.quantity_dispensed,
            inv.quantity_on_hand,
            inv.quantity_on_hand - input.quantity_dispensed,
            inv.batch_number,
            inv.pi_location,
            inv.unit_cost,
            input.quantity_dispensed * inv.unit_cost,
            dispensing[0].id,
            ctx.user.sub,
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
    }),

  returnMedication: protectedProcedure
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
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Dispensing record not found',
          });
        }

        const disp = dispensing[0];

        if (input.quantity_returned > disp.quantity_dispensed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Return quantity exceeds dispensed quantity',
          });
        }

        // Update dispensing record
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

        // Update inventory
        await getSql()(
          `UPDATE pharmacy_inventory
          SET quantity_on_hand = quantity_on_hand + $1,
              quantity_available = quantity_available + $1,
              last_restocked_at = NOW()
          WHERE id = $2`,
          [input.quantity_returned, disp.dr_inventory_id]
        );

        // Create stock movement (return_to_stock)
        await getSql()(
          `INSERT INTO stock_movements
          (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity, sm_ref_type, sm_ref_id, sm_performed_by, sm_performed_at)
          VALUES ($1, $2, $3, 'return_to_stock', $4, 'dispensing', $5, $6, NOW())`,
          [
            ctx.user.hospital_id,
            disp.dr_inventory_id,
            disp.dr_drug_id,
            input.quantity_returned,
            input.dr_id,
            ctx.user.sub,
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
    }),

  listDispensingRecords: protectedProcedure
    .input(
      z.object({
        dr_patient_id: z.string().uuid().optional(),
        dr_encounter_id: z.string().uuid().optional(),
        dr_status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        let whereClause = 'dr.hospital_id = $1';
        const params: any[] = [ctx.user.hospital_id];
        let paramIdx = 2;

        if (input.dr_patient_id) {
          whereClause += ` AND dr.dr_patient_id = $${paramIdx}`;
          params.push(input.dr_patient_id);
          paramIdx++;
        }

        if (input.dr_encounter_id) {
          whereClause += ` AND dr.dr_encounter_id = $${paramIdx}`;
          params.push(input.dr_encounter_id);
          paramIdx++;
        }

        if (input.dr_status) {
          whereClause += ` AND dr.dr_status = $${paramIdx}`;
          params.push(input.dr_status);
          paramIdx++;
        }

        const records = await getSql()(
          `SELECT dr.*, p.name_full, u.full_name as dispensed_by_name
          FROM dispensing_records dr
          LEFT JOIN patients p ON dr.dr_patient_id = p.id
          LEFT JOIN users u ON dr.dispensed_by = u.id
          WHERE ${whereClause}
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
    }),

  dispensingDetail: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      try {
        const record = await getSql()(
          `SELECT dr.*, p.name_full, u.full_name as dispensed_by_name, dm.drug_name
          FROM dispensing_records dr
          LEFT JOIN patients p ON dr.dr_patient_id = p.id
          LEFT JOIN users u ON dr.dispensed_by = u.id
          LEFT JOIN drug_master dm ON dr.dr_drug_id = dm.id
          WHERE dr.id = $1 AND dr.hospital_id = $2`,
          [input, ctx.user.hospital_id]
        );

        if (!record.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Dispensing record not found',
          });
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
    }),

  pendingDispensing: protectedProcedure
    .input(
      z.object({
        dr_encounter_id: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        let whereClause = `mo.hospital_id = $1 AND mo.mo_status = 'active'`;
        const params: any[] = [ctx.user.hospital_id];
        let paramIdx = 2;

        if (input.dr_encounter_id) {
          whereClause += ` AND mo.mo_encounter_id = $${paramIdx}`;
          params.push(input.dr_encounter_id);
          paramIdx++;
        }

        const pending = await getSql()(
          `SELECT mo.*, p.name_full, dm.drug_name, dm.dm_strength
          FROM medication_orders mo
          LEFT JOIN patients p ON mo.mo_patient_id = p.id
          LEFT JOIN drug_master dm ON mo.mo_drug_id = dm.id
          WHERE ${whereClause}
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
    }),

  // NARCOTICS REGISTER
  recordNarcoticMovement: protectedProcedure
    .input(narcoticsMovementSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Get current balance
        const lastRecord = await getSql()(
          `SELECT nr_running_balance FROM narcotics_register
          WHERE hospital_id = $1 AND nr_drug_id = $2
          ORDER BY nr_recorded_at DESC LIMIT 1`,
          [ctx.user.hospital_id, input.nr_drug_id]
        );

        const previousBalance = lastRecord.length > 0 ? lastRecord[0].nr_running_balance : 0;

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

        // Get drug details
        const drug = await getSql()(
          `SELECT drug_name FROM drug_master WHERE id = $1`,
          [input.nr_drug_id]
        );

        if (!drug.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Drug not found',
          });
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
            drug[0].drug_name,
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

        return record[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to record narcotic movement',
          cause: error,
        });
      }
    }),

  narcoticsAudit: protectedProcedure
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
    }),

  narcoticsBalance: protectedProcedure
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
    }),

  narcoticsReport: protectedProcedure
    .input(
      z.object({
        nr_class: z.enum(['schedule_h', 'schedule_h1', 'schedule_x', 'narcotic', 'psychotropic']).optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        let whereClause = 'nr.hospital_id = $1';
        const params: any[] = [ctx.user.hospital_id];
        let paramIdx = 2;

        if (input.nr_class) {
          whereClause += ` AND nr.nr_class = $${paramIdx}`;
          params.push(input.nr_class);
          paramIdx++;
        }

        if (input.date_from) {
          whereClause += ` AND nr.nr_recorded_at >= $${paramIdx}`;
          params.push(input.date_from);
          paramIdx++;
        }

        if (input.date_to) {
          whereClause += ` AND nr.nr_recorded_at <= $${paramIdx}`;
          params.push(input.date_to);
          paramIdx++;
        }

        const report = await getSql()(
          `SELECT
            nr_drug_id, nr_drug_name, nr_class,
            COUNT(*) as movement_count,
            SUM(CASE WHEN nr_movement_type = 'receipt' THEN nr_quantity ELSE 0 END) as total_received,
            SUM(CASE WHEN nr_movement_type = 'issue' THEN nr_quantity ELSE 0 END) as total_issued,
            MAX(nr_running_balance) as current_balance
          FROM narcotics_register
          WHERE ${whereClause}
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
    }),

  // PURCHASE ORDERS
  createPurchaseOrder: protectedProcedure
    .input(purchaseOrderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Generate PO number: PO-YYYYMMDD-NNNN
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const countToday = await getSql()(
          `SELECT COUNT(*) as cnt FROM purchase_orders
          WHERE hospital_id = $1 AND po_number LIKE $2`,
          [ctx.user.hospital_id, `PO-${today}%`]
        );

        const nextSeq = (countToday[0].cnt || 0) + 1;
        const poNumber = `PO-${today}-${String(nextSeq).padStart(4, '0')}`;

        const po = await getSql()(
          `INSERT INTO purchase_orders
          (hospital_id, po_number, po_vendor_id, po_status, po_total_items, po_total_amount,
           expected_delivery, po_notes, po_created_by, po_created_at)
          VALUES ($1, $2, $3, 'draft', 0, 0, $4, $5, $6, NOW())
          RETURNING *`,
          [
            ctx.user.hospital_id,
            poNumber,
            input.po_vendor_id,
            input.expected_delivery,
            input.po_notes || null,
            ctx.user.sub,
          ]
        );

        return po[0];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create purchase order',
          cause: error,
        });
      }
    }),

  addPOItem: protectedProcedure
    .input(poItemSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Verify PO exists
        const po = await getSql()(
          `SELECT * FROM purchase_orders WHERE id = $1 AND hospital_id = $2`,
          [input.poi_po_id, ctx.user.hospital_id]
        );

        if (!po.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Purchase order not found',
          });
        }

        // Get drug details
        const drug = await getSql()(
          `SELECT drug_name FROM drug_master WHERE id = $1`,
          [input.poi_drug_id]
        );

        if (!drug.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Drug not found',
          });
        }

        const totalCost = input.poi_qty_ordered * input.poi_unit_cost;

        const item = await getSql()(
          `INSERT INTO purchase_order_items
          (hospital_id, poi_po_id, poi_drug_id, poi_drug_name, poi_qty_ordered, poi_unit_cost,
           poi_total_cost, poi_batch_number, poi_expiry_date, poi_manufacturer)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            ctx.user.hospital_id,
            input.poi_po_id,
            input.poi_drug_id,
            drug[0].drug_name,
            input.poi_qty_ordered,
            input.poi_unit_cost,
            totalCost,
            input.poi_batch_number || null,
            input.poi_expiry_date || null,
            input.poi_manufacturer || null,
          ]
        );

        // Update PO totals
        await getSql()(
          `UPDATE purchase_orders
          SET po_total_items = po_total_items + 1,
              po_total_amount = po_total_amount + $1
          WHERE id = $2`,
          [totalCost, input.poi_po_id]
        );

        return item[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add PO item',
          cause: error,
        });
      }
    }),

  submitPO: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      try {
        const po = await getSql()(
          `UPDATE purchase_orders
          SET po_status = 'submitted'
          WHERE id = $1 AND hospital_id = $2
          RETURNING *`,
          [input, ctx.user.hospital_id]
        );

        if (!po.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Purchase order not found',
          });
        }

        return po[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to submit purchase order',
          cause: error,
        });
      }
    }),

  approvePO: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      try {
        const po = await getSql()(
          `UPDATE purchase_orders
          SET po_status = 'approved', po_approved_by = $1, po_approved_at = NOW()
          WHERE id = $2 AND hospital_id = $3
          RETURNING *`,
          [ctx.user.sub, input, ctx.user.hospital_id]
        );

        if (!po.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Purchase order not found',
          });
        }

        return po[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to approve purchase order',
          cause: error,
        });
      }
    }),

  receivePO: protectedProcedure
    .input(
      z.object({
        po_id: z.string().uuid(),
        items: z.array(
          z.object({
            poi_id: z.string().uuid(),
            poi_qty_received: z.number().int().positive(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const po = await getSql()(
          `SELECT * FROM purchase_orders WHERE id = $1 AND hospital_id = $2`,
          [input.po_id, ctx.user.hospital_id]
        );

        if (!po.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Purchase order not found',
          });
        }

        // Update PO items and create inventory/movements
        for (const item of input.items) {
          const poItem = await getSql()(
            `SELECT * FROM purchase_order_items WHERE id = $1 AND hospital_id = $2`,
            [item.poi_id, ctx.user.hospital_id]
          );

          if (!poItem.length) continue;

          const poi = poItem[0];

          // Update PO item
          await getSql()(
            `UPDATE purchase_order_items SET poi_qty_received = $1 WHERE id = $2`,
            [item.poi_qty_received, item.poi_id]
          );

          // Create or update inventory
          const inventory = await getSql()(
            `SELECT * FROM pharmacy_inventory
            WHERE hospital_id = $1 AND pi_drug_id = $2 AND batch_number = $3 AND pi_location = $4`,
            [ctx.user.hospital_id, poi.poi_drug_id, poi.poi_batch_number || 'N/A', 'warehouse']
          );

          if (inventory.length) {
            // Update existing
            await getSql()(
              `UPDATE pharmacy_inventory
              SET quantity_on_hand = quantity_on_hand + $1,
                  quantity_available = quantity_available + $1
              WHERE id = $2`,
              [item.poi_qty_received, inventory[0].id]
            );
          } else {
            // Create new
            await getSql()(
              `INSERT INTO pharmacy_inventory
              (hospital_id, pi_drug_id, pi_location, batch_number, pi_manufacturer, expiry_date,
               quantity_on_hand, quantity_reserved, quantity_available, unit_cost, pi_mrp,
               reorder_level, reorder_quantity, max_stock_level, pi_is_active, pi_created_at)
              VALUES ($1, $2, 'warehouse', $3, $4, $5, $6, 0, $6, $7, $8, 100, 200, 1000, TRUE, NOW())`,
              [
                ctx.user.hospital_id,
                poi.poi_drug_id,
                poi.poi_batch_number || 'N/A',
                poi.poi_manufacturer || 'N/A',
                poi.poi_expiry_date || null,
                item.poi_qty_received,
                poi.poi_unit_cost,
                poi.poi_unit_cost * 1.5,
              ]
            );
          }

          // Create stock movement
          await getSql()(
            `INSERT INTO stock_movements
            (hospital_id, sm_inventory_id, sm_drug_id, sm_type, sm_quantity,
             sm_batch_number, sm_location, sm_unit_cost, sm_total_value,
             sm_ref_type, sm_ref_id, sm_vendor_id, sm_performed_by, sm_performed_at)
            VALUES ($1, (SELECT id FROM pharmacy_inventory WHERE hospital_id = $1 AND pi_drug_id = $2 LIMIT 1),
                    $2, 'receipt', $3, $4, 'warehouse', $5, $6, 'purchase_order', $7, $8, $9, NOW())`,
            [
              ctx.user.hospital_id,
              poi.poi_drug_id,
              item.poi_qty_received,
              poi.poi_batch_number || 'N/A',
              poi.poi_unit_cost,
              item.poi_qty_received * poi.poi_unit_cost,
              input.po_id,
              po[0].po_vendor_id,
              ctx.user.sub,
            ]
          );
        }

        // Update PO status
        const updated = await getSql()(
          `UPDATE purchase_orders
          SET po_status = 'received', po_received_at = NOW()
          WHERE id = $1
          RETURNING *`,
          [input.po_id]
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
    }),

  listPurchaseOrders: protectedProcedure
    .input(
      z.object({
        po_status: z.string().optional(),
        po_vendor_id: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        let whereClause = 'po.hospital_id = $1';
        const params: any[] = [ctx.user.hospital_id];
        let paramIdx = 2;

        if (input.po_status) {
          whereClause += ` AND po.po_status = $${paramIdx}`;
          params.push(input.po_status);
          paramIdx++;
        }

        if (input.po_vendor_id) {
          whereClause += ` AND po.po_vendor_id = $${paramIdx}`;
          params.push(input.po_vendor_id);
          paramIdx++;
        }

        const orders = await getSql()(
          `SELECT po.*, v.vendor_name, u.full_name as created_by_name
          FROM purchase_orders po
          LEFT JOIN vendors v ON po.po_vendor_id = v.id
          LEFT JOIN users u ON po.po_created_by = u.id
          WHERE ${whereClause}
          ORDER BY po.po_created_at DESC`,
          params
        );

        return orders;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list purchase orders',
          cause: error,
        });
      }
    }),

  // ALERTS & ANALYTICS
  checkLowStock: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Find all inventory items below reorder level
      const lowStockItems = await getSql()(
        `SELECT pi.* FROM pharmacy_inventory pi
        WHERE pi.hospital_id = $1 AND pi.quantity_available <= pi.reorder_level AND pi.pi_is_active = TRUE`,
        [ctx.user.hospital_id]
      );

      // Create alerts for each
      for (const item of lowStockItems) {
        // Check if alert already exists
        const existing = await getSql()(
          `SELECT id FROM stock_alerts
          WHERE hospital_id = $1 AND sa_drug_id = $2 AND sa_alert_type = 'low_stock' AND sa_is_resolved = FALSE`,
          [ctx.user.hospital_id, item.pi_drug_id]
        );

        if (!existing.length) {
          await getSql()(
            `INSERT INTO stock_alerts
            (hospital_id, sa_drug_id, sa_drug_name, sa_location, sa_alert_type, sa_severity,
             sa_message, sa_current_stock, sa_threshold, sa_is_resolved)
            SELECT $1, pi.pi_drug_id, dm.drug_name, pi.pi_location, 'low_stock', 'high',
                   CONCAT('Stock for ', dm.drug_name, ' is below reorder level'),
                   pi.quantity_available, pi.reorder_level, FALSE
            FROM pharmacy_inventory pi
            LEFT JOIN drug_master dm ON pi.pi_drug_id = dm.id
            WHERE pi.id = $2`,
            [ctx.user.hospital_id, item.id]
          );
        }
      }

      return { alerts_created: lowStockItems.length };
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to check low stock',
        cause: error,
      });
    }
  }),

  listAlerts: protectedProcedure
    .input(
      z.object({
        sa_alert_type: z.string().optional(),
        sa_severity: z.string().optional(),
        resolved_only: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        let whereClause = 'hospital_id = $1 AND sa_is_resolved = $2';
        const params: any[] = [ctx.user.hospital_id, input.resolved_only];
        let paramIdx = 3;

        if (input.sa_alert_type) {
          whereClause += ` AND sa_alert_type = $${paramIdx}`;
          params.push(input.sa_alert_type);
          paramIdx++;
        }

        if (input.sa_severity) {
          whereClause += ` AND sa_severity = $${paramIdx}`;
          params.push(input.sa_severity);
          paramIdx++;
        }

        const alerts = await getSql()(
          `SELECT * FROM stock_alerts
          WHERE ${whereClause}
          ORDER BY sa_severity DESC, id DESC`,
          params
        );

        return alerts;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list alerts',
          cause: error,
        });
      }
    }),

  resolveAlert: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      try {
        const alert = await getSql()(
          `UPDATE stock_alerts
          SET sa_is_resolved = TRUE, sa_resolved_by = $1, sa_resolved_at = NOW()
          WHERE id = $2 AND hospital_id = $3
          RETURNING *`,
          [ctx.user.sub, input, ctx.user.hospital_id]
        );

        if (!alert.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Alert not found',
          });
        }

        return alert[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resolve alert',
          cause: error,
        });
      }
    }),

  pharmacyStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      const stats = await getSql()(
        `SELECT
          COUNT(DISTINCT pi.id) as total_items,
          COUNT(DISTINCT pi.pi_location) as locations,
          SUM(pi.quantity_on_hand * pi.unit_cost) as total_stock_value,
          COUNT(DISTINCT CASE WHEN pi.quantity_available <= pi.reorder_level THEN pi.id END) as low_stock_items,
          COUNT(DISTINCT sa.id) as active_alerts
        FROM pharmacy_inventory pi
        LEFT JOIN stock_alerts sa ON pi.pi_drug_id = sa.sa_drug_id AND sa.sa_is_resolved = FALSE
        WHERE pi.hospital_id = $1`,
        [ctx.user.hospital_id]
      );

      const movementCounts = await getSql()(
        `SELECT
          sm_type,
          COUNT(*) as count
        FROM stock_movements
        WHERE hospital_id = $1 AND sm_performed_at > NOW() - INTERVAL '30 days'
        GROUP BY sm_type`,
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
  }),

  dispensingAnalytics: protectedProcedure
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
    }),
});
