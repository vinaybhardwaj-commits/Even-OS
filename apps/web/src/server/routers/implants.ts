import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { implantMaster, implantUsage } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or, gte, lte, inArray } from 'drizzle-orm';

const implantCategories = [
  'orthopedic', 'cardiac', 'ophthalmic', 'dental', 'spinal',
  'vascular', 'neurological', 'ent', 'gi', 'other',
] as const;

export const implantsRouter = router({

  // ─── LIST IMPLANT MASTER (paginated, filterable, searchable) ────
  listMaster: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.enum(implantCategories).optional(),
      isActive: z.enum(['active', 'inactive', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, category, isActive, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(implantMaster.hospital_id, ctx.user.hospital_id)];

      if (category) conditions.push(eq(implantMaster.category, category));
      if (isActive === 'active') conditions.push(eq(implantMaster.is_active, true));
      if (isActive === 'inactive') conditions.push(eq(implantMaster.is_active, false));

      if (search) {
        conditions.push(
          or(
            ilike(implantMaster.implant_name, `%${search}%`),
            ilike(implantMaster.implant_code, `%${search}%`),
            ilike(implantMaster.manufacturer, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(implantMaster).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(implantMaster)
        .where(where)
        .orderBy(desc(implantMaster.updated_at))
        .limit(pageSize)
        .offset(offset);

      return {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  // ─── GET IMPLANT MASTER by ID ────────────────────────────────
  getMaster: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(implantMaster)
        .where(and(
          eq(implantMaster.id, input.id as any),
          eq(implantMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Implant not found' });
      return row;
    }),

  // ─── CREATE IMPLANT MASTER ───────────────────────────────────
  createMaster: adminProcedure
    .input(z.object({
      implant_code: z.string().min(1).max(50).optional(),
      implant_name: z.string().min(1).max(200),
      category: z.enum(implantCategories),
      sub_category: z.string().optional(),
      manufacturer: z.string().optional(),
      brand: z.string().optional(),
      model_number: z.string().optional(),
      hsn_code: z.string().optional(),
      gst_rate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      procurement_cost: z.string().regex(/^\d+(\.\d{1,2})?$/),
      billing_price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      mrp: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      requires_serial_tracking: z.boolean().default(true),
      shelf_life_months: z.number().int().min(0).optional(),
      storage_instructions: z.string().optional(),
      regulatory_approval: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate code if provided
      if (input.implant_code) {
        const existing = await db.select({ id: implantMaster.id }).from(implantMaster)
          .where(and(
            eq(implantMaster.implant_code, input.implant_code),
            eq(implantMaster.hospital_id, ctx.user.hospital_id),
          )).limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: `Code "${input.implant_code}" already exists` });
        }
      }

      const [row] = await db.insert(implantMaster).values({
        hospital_id: ctx.user.hospital_id,
        implant_code: input.implant_code || null,
        implant_name: input.implant_name,
        category: input.category as any,
        sub_category: input.sub_category || null,
        manufacturer: input.manufacturer || null,
        brand: input.brand || null,
        model_number: input.model_number || null,
        hsn_code: input.hsn_code || null,
        gst_rate: input.gst_rate ? String(input.gst_rate) : null,
        procurement_cost: String(input.procurement_cost),
        billing_price: String(input.billing_price),
        mrp: input.mrp ? String(input.mrp) : null,
        requires_serial_tracking: input.requires_serial_tracking,
        shelf_life_months: input.shelf_life_months || null,
        storage_instructions: input.storage_instructions || null,
        regulatory_approval: input.regulatory_approval || null,
        notes: input.notes || null,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'implant_master',
        row_id: row.id,
        new_values: row as any,
      });

      return row;
    }),

  // ─── UPDATE IMPLANT MASTER ───────────────────────────────────
  updateMaster: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      implant_name: z.string().min(1).max(200).optional(),
      category: z.enum(implantCategories).optional(),
      sub_category: z.string().optional(),
      manufacturer: z.string().optional(),
      brand: z.string().optional(),
      model_number: z.string().optional(),
      hsn_code: z.string().optional(),
      gst_rate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      procurement_cost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      billing_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      mrp: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      requires_serial_tracking: z.boolean().optional(),
      shelf_life_months: z.number().int().min(0).optional(),
      storage_instructions: z.string().optional(),
      regulatory_approval: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Get current state
      const [old] = await db.select().from(implantMaster)
        .where(and(eq(implantMaster.id, id as any), eq(implantMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Implant not found' });

      const setValues: any = { updated_at: new Date() };
      if (updates.implant_name !== undefined) setValues.implant_name = updates.implant_name;
      if (updates.category !== undefined) setValues.category = updates.category;
      if (updates.sub_category !== undefined) setValues.sub_category = updates.sub_category;
      if (updates.manufacturer !== undefined) setValues.manufacturer = updates.manufacturer;
      if (updates.brand !== undefined) setValues.brand = updates.brand;
      if (updates.model_number !== undefined) setValues.model_number = updates.model_number;
      if (updates.hsn_code !== undefined) setValues.hsn_code = updates.hsn_code;
      if (updates.gst_rate !== undefined) setValues.gst_rate = String(updates.gst_rate);
      if (updates.procurement_cost !== undefined) setValues.procurement_cost = String(updates.procurement_cost);
      if (updates.billing_price !== undefined) setValues.billing_price = String(updates.billing_price);
      if (updates.mrp !== undefined) setValues.mrp = String(updates.mrp);
      if (updates.requires_serial_tracking !== undefined) setValues.requires_serial_tracking = updates.requires_serial_tracking;
      if (updates.shelf_life_months !== undefined) setValues.shelf_life_months = updates.shelf_life_months;
      if (updates.storage_instructions !== undefined) setValues.storage_instructions = updates.storage_instructions;
      if (updates.regulatory_approval !== undefined) setValues.regulatory_approval = updates.regulatory_approval;
      if (updates.notes !== undefined) setValues.notes = updates.notes;

      const [row] = await db.update(implantMaster)
        .set(setValues)
        .where(eq(implantMaster.id, id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'implant_master',
        row_id: row.id,
        old_values: old as any,
        new_values: row as any,
      });

      return row;
    }),

  // ─── TOGGLE IS_ACTIVE ────────────────────────────────────────
  toggleActive: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [old] = await db.select().from(implantMaster)
        .where(and(eq(implantMaster.id, input.id as any), eq(implantMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Implant not found' });

      const [row] = await db.update(implantMaster)
        .set({ is_active: !old.is_active, updated_at: new Date() })
        .where(eq(implantMaster.id, input.id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'implant_master',
        row_id: row.id,
        old_values: { is_active: old.is_active },
        new_values: { is_active: row.is_active },
        reason: row.is_active ? 'Reactivated' : 'Deactivated',
      });

      return row;
    }),

  // ─── RECORD IMPLANT USAGE ────────────────────────────────────
  recordUsage: adminProcedure
    .input(z.object({
      implant_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      surgery_id: z.string().uuid().optional(),
      serial_number: z.string().optional(),
      batch_number: z.string().optional(),
      lot_number: z.string().optional(),
      expiry_date: z.string().optional(), // ISO date
      quantity: z.number().int().min(1).default(1),
      surgeon_id: z.string().uuid().optional(),
      surgeon_name: z.string().optional(),
      implant_site: z.string().optional(),
      implant_date: z.string(), // ISO datetime
      removal_date: z.string().optional(),
      removal_reason: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify implant exists and get billing_price
      const [implant] = await db.select().from(implantMaster)
        .where(and(
          eq(implantMaster.id, input.implant_id as any),
          eq(implantMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!implant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Implant not found' });

      // Compute billing_amount from implant.billing_price * quantity
      const billingAmount = String(
        parseFloat(implant.billing_price as string) * input.quantity
      );

      const [row] = await db.insert(implantUsage).values({
        hospital_id: ctx.user.hospital_id,
        implant_id: input.implant_id,
        encounter_id: input.encounter_id || null,
        patient_id: input.patient_id || null,
        surgery_id: input.surgery_id || null,
        serial_number: input.serial_number || null,
        batch_number: input.batch_number || null,
        lot_number: input.lot_number || null,
        expiry_date: input.expiry_date || null,
        quantity: input.quantity,
        unit_cost: String(implant.billing_price),
        billing_amount: billingAmount,
        surgeon_id: input.surgeon_id || null,
        surgeon_name: input.surgeon_name || null,
        implant_site: input.implant_site || null,
        implant_date: new Date(input.implant_date),
        removal_date: input.removal_date ? new Date(input.removal_date) : null,
        removal_reason: input.removal_reason || null,
        notes: input.notes || null,
        recorded_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'implant_usage',
        row_id: row.id,
        new_values: row as any,
      });

      return row;
    }),

  // ─── LIST IMPLANT USAGE ──────────────────────────────────────
  listUsage: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      surgery_id: z.string().uuid().optional(),
      implant_id: z.string().uuid().optional(),
      dateFrom: z.string().optional(), // ISO date
      dateTo: z.string().optional(), // ISO date
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { encounter_id, patient_id, surgery_id, implant_id, dateFrom, dateTo, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(implantUsage.hospital_id, ctx.user.hospital_id)];

      if (encounter_id) conditions.push(eq(implantUsage.encounter_id, encounter_id as any));
      if (patient_id) conditions.push(eq(implantUsage.patient_id, patient_id as any));
      if (surgery_id) conditions.push(eq(implantUsage.surgery_id, surgery_id as any));
      if (implant_id) conditions.push(eq(implantUsage.implant_id, implant_id as any));

      if (dateFrom) {
        conditions.push(gte(implantUsage.implant_date, new Date(dateFrom)));
      }
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        conditions.push(lte(implantUsage.implant_date, endOfDay));
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(implantUsage).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(implantUsage)
        .where(where)
        .orderBy(desc(implantUsage.implant_date))
        .limit(pageSize)
        .offset(offset);

      return {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  // ─── GET SINGLE IMPLANT USAGE ────────────────────────────────
  getUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(implantUsage)
        .where(and(
          eq(implantUsage.id, input.id as any),
          eq(implantUsage.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usage record not found' });
      return row;
    }),

  // ─── REMOVE USAGE RECORD (only if not yet billed) ─────────────
  removeUsage: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(implantUsage)
        .where(and(
          eq(implantUsage.id, input.id as any),
          eq(implantUsage.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usage record not found' });

      // Check if billed (bill_id is not null)
      if (row.bill_id) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot remove billed implant usage' });
      }

      await db.delete(implantUsage).where(eq(implantUsage.id, input.id as any));

      await writeAuditLog(ctx.user, {
        action: 'DELETE',
        table_name: 'implant_usage',
        row_id: row.id,
        old_values: row as any,
      });

      return { success: true };
    }),

  // ─── USAGE BY ENCOUNTER (for billing integration) ────────────
  usageByEncounter: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(implantUsage)
        .where(and(
          eq(implantUsage.encounter_id, input.encounter_id as any),
          eq(implantUsage.hospital_id, ctx.user.hospital_id),
        ))
        .orderBy(desc(implantUsage.implant_date));
      return rows;
    }),

  // ─── STATS (by category, inventory value, billed this month, top implants) ──
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      // Total implants in catalog
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(implantMaster)
        .where(eq(implantMaster.hospital_id, ctx.user.hospital_id));
      const totalImplants = Number(countResult[0]?.count ?? 0);

      // Catalog value (sum of procurement_cost * estimated qty, or just catalog value)
      const catalogValue = await db.select({
        total: sql<string>`sum(cast(procurement_cost as decimal) * 2)`, // Rough est: avg 2 per type
      })
        .from(implantMaster)
        .where(eq(implantMaster.hospital_id, ctx.user.hospital_id));

      // This month's billed amount
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const billedResult = await db.select({
        total: sql<string>`sum(cast(billing_amount as decimal))`,
      })
        .from(implantUsage)
        .where(and(
          eq(implantUsage.hospital_id, ctx.user.hospital_id),
          gte(implantUsage.implant_date, monthStart),
        ));

      // Counts by category
      const byCategoryResult = await db.select({
        category: implantMaster.category,
        count: sql<number>`count(*)`,
      })
        .from(implantMaster)
        .where(eq(implantMaster.hospital_id, ctx.user.hospital_id))
        .groupBy(implantMaster.category);

      // Top 5 implants by usage (last 90 days)
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const topUsageResult = await db.select({
        implant_name: implantMaster.implant_name,
        category: implantMaster.category,
        usage_count: sql<number>`count(${implantUsage.id})`,
        total_billed: sql<string>`sum(cast(${implantUsage.billing_amount} as decimal))`,
      })
        .from(implantUsage)
        .leftJoin(implantMaster, eq(implantUsage.implant_id, implantMaster.id))
        .where(and(
          eq(implantUsage.hospital_id, ctx.user.hospital_id),
          gte(implantUsage.implant_date, ninetyDaysAgo),
        ))
        .groupBy(implantMaster.id)
        .orderBy(sql`count(${implantUsage.id})` as any)
        .limit(5);

      return {
        totalImplants,
        catalogValue: catalogValue[0]?.total ? parseFloat(catalogValue[0].total as string) : 0,
        billedThisMonth: billedResult[0]?.total ? parseFloat(billedResult[0].total as string) : 0,
        byCategory: byCategoryResult,
        topUsage: topUsageResult,
      };
    }),

});
