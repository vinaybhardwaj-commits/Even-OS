import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { chargeMaster, masterDataVersionHistory } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

const chargeCategories = ['room', 'procedure', 'lab', 'pharmacy', 'consultation', 'nursing', 'other'] as const;

export const chargeMasterRouter = router({

  // ─── LIST (paginated, filterable, searchable) ─────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.enum(chargeCategories).optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, category, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(chargeMaster.hospital_id, ctx.user.hospital_id)];

      if (category) conditions.push(eq(chargeMaster.category, category));
      if (status === 'active') conditions.push(eq(chargeMaster.is_active, true));
      if (status === 'inactive') conditions.push(eq(chargeMaster.is_active, false));

      if (search) {
        conditions.push(
          or(
            ilike(chargeMaster.charge_name, `%${search}%`),
            ilike(chargeMaster.charge_code, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(chargeMaster).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(chargeMaster)
        .where(where)
        .orderBy(desc(chargeMaster.updated_at))
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

  // ─── GET by ID ────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(chargeMaster)
        .where(and(
          eq(chargeMaster.id, input.id as any),
          eq(chargeMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge not found' });
      return row;
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      charge_code: z.string().min(1).max(50),
      charge_name: z.string().min(1).max(200),
      category: z.enum(chargeCategories),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      unit: z.string().min(1).default('per unit'),
      description: z.string().optional(),
      gst_percentage: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
    }))
    .mutation(async ({ ctx, input }) => {

      // Check for duplicate charge_code
      const existing = await db.select({ id: chargeMaster.id }).from(chargeMaster)
        .where(and(
          eq(chargeMaster.charge_code, input.charge_code),
          eq(chargeMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: `Charge code "${input.charge_code}" already exists` });
      }

      const [row] = await db.insert(chargeMaster).values({
        hospital_id: ctx.user.hospital_id,
        charge_code: input.charge_code,
        charge_name: input.charge_name,
        category: input.category,
        price: input.price,
        unit: input.unit,
        description: input.description,
        gst_percentage: input.gst_percentage,
        created_by: ctx.user.sub as any,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'charge_master', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'charge_master', row_id: row.id, new_values: row as any });

      return row;
    }),

  // ─── UPDATE ───────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      charge_name: z.string().min(1).max(200).optional(),
      category: z.enum(chargeCategories).optional(),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      unit: z.string().min(1).optional(),
      description: z.string().optional(),
      gst_percentage: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Get current state
      const [old] = await db.select().from(chargeMaster)
        .where(and(eq(chargeMaster.id, id as any), eq(chargeMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge not found' });

      const setValues: any = { updated_at: new Date(), updated_by: ctx.user.sub };
      if (updates.charge_name !== undefined) setValues.charge_name = updates.charge_name;
      if (updates.category !== undefined) setValues.category = updates.category;
      if (updates.price !== undefined) setValues.price = updates.price;
      if (updates.unit !== undefined) setValues.unit = updates.unit;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.gst_percentage !== undefined) setValues.gst_percentage = updates.gst_percentage;

      const [row] = await db.update(chargeMaster)
        .set(setValues)
        .where(eq(chargeMaster.id, id as any))
        .returning();

      await recordVersion(ctx.user, 'charge_master', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'charge_master', row_id: row.id, old_values: old as any, new_values: row as any });

      return row;
    }),

  // ─── DEACTIVATE (soft delete) ─────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      const [old] = await db.select().from(chargeMaster)
        .where(and(eq(chargeMaster.id, input.id as any), eq(chargeMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge not found' });

      const [row] = await db.update(chargeMaster)
        .set({ is_active: !old.is_active, updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(chargeMaster.id, input.id as any))
        .returning();

      await recordVersion(ctx.user, 'charge_master', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'charge_master', row_id: row.id,
        old_values: { is_active: old.is_active }, new_values: { is_active: row.is_active },
        reason: row.is_active ? 'Reactivated' : 'Deactivated',
      });

      return row;
    }),

  // ─── BULK IMPORT (CSV rows) ───────────────────────────────
  bulkImport: adminProcedure
    .input(z.object({
      rows: z.array(z.object({
        charge_code: z.string().min(1),
        charge_name: z.string().min(1),
        category: z.enum(chargeCategories),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        unit: z.string().optional().default('per unit'),
        description: z.string().optional(),
        gst_percentage: z.string().optional().default('0'),
      })),
      mode: z.enum(['skip_duplicates', 'update_duplicates']).default('skip_duplicates'),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; code: string; error: string }[] = [];

      // Process in batches of 500
      const batchSize = 500;
      for (let i = 0; i < input.rows.length; i += batchSize) {
        const batch = input.rows.slice(i, i + batchSize);

        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const rowNum = i + j + 1;

          try {
            // Check for existing
            const [existing] = await db.select({ id: chargeMaster.id }).from(chargeMaster)
              .where(and(
                eq(chargeMaster.charge_code, row.charge_code),
                eq(chargeMaster.hospital_id, ctx.user.hospital_id),
              )).limit(1);

            if (existing) {
              if (input.mode === 'update_duplicates') {
                await db.update(chargeMaster).set({
                  charge_name: row.charge_name,
                  category: row.category,
                  price: row.price,
                  unit: row.unit,
                  description: row.description,
                  gst_percentage: row.gst_percentage,
                  updated_by: ctx.user.sub as any,
                  updated_at: new Date(),
                }).where(eq(chargeMaster.id, existing.id));
                updated++;
              } else {
                skipped++;
              }
            } else {
              await db.insert(chargeMaster).values({
                hospital_id: ctx.user.hospital_id,
                charge_code: row.charge_code,
                charge_name: row.charge_name,
                category: row.category,
                price: row.price,
                unit: row.unit,
                description: row.description,
                gst_percentage: row.gst_percentage,
                created_by: ctx.user.sub as any,
                updated_by: ctx.user.sub as any,
              });
              imported++;
            }
          } catch (err: any) {
            errors.push({ row: rowNum, code: row.charge_code, error: err.message || 'Unknown error' });
          }
        }
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'charge_master',
        row_id: 'bulk_import',
        new_values: { imported, updated, skipped, errors: errors.length, total: input.rows.length },
        reason: `Bulk import: ${input.rows.length} rows`,
      });

      return { imported, updated, skipped, errors, total: input.rows.length };
    }),

  // ─── VERSION HISTORY ──────────────────────────────────────
  versionHistory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVersionHistory('charge_master', input.id);
    }),

  // ─── STATS (dashboard widget) ─────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const result = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE is_active = true)`,
      inactive: sql<number>`count(*) FILTER (WHERE is_active = false)`,
    }).from(chargeMaster)
      .where(eq(chargeMaster.hospital_id, ctx.user.hospital_id));

    return {
      total: Number(result[0]?.total ?? 0),
      active: Number(result[0]?.active ?? 0),
      inactive: Number(result[0]?.inactive ?? 0),
    };
  }),
});
