import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { drugMaster } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

const drugCategories = ['tablet', 'capsule', 'injection', 'syrup', 'cream', 'ointment', 'drops', 'inhaler', 'patch', 'suppository', 'powder', 'other'] as const;
const drugRoutes = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'sublingual', 'rectal', 'ophthalmic', 'otic', 'nasal', 'transdermal', 'other'] as const;

export const drugMasterRouter = router({

  // ─── LIST (paginated, filterable, searchable) ─────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.enum(drugCategories).optional(),
      route: z.enum(drugRoutes).optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const { search, category, route, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(drugMaster.hospital_id, ctx.user.hospital_id)];

      if (category) conditions.push(eq(drugMaster.category, category));
      if (route) conditions.push(eq(drugMaster.route, route));
      if (status === 'active') conditions.push(eq(drugMaster.is_active, true));
      if (status === 'inactive') conditions.push(eq(drugMaster.is_active, false));

      if (search) {
        conditions.push(
          or(
            ilike(drugMaster.drug_name, `%${search}%`),
            ilike(drugMaster.drug_code, `%${search}%`),
            ilike(drugMaster.generic_name, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(drugMaster).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(drugMaster)
        .where(where)
        .orderBy(desc(drugMaster.updated_at))
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
      const db = getDb();
      const [row] = await db.select().from(drugMaster)
        .where(and(
          eq(drugMaster.id, input.id as any),
          eq(drugMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drug not found' });
      return row;
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      drug_code: z.string().min(1).max(50),
      drug_name: z.string().min(1).max(200),
      generic_name: z.string().optional(),
      category: z.enum(drugCategories),
      strength: z.string().optional(),
      unit: z.string().optional(),
      route: z.enum(drugRoutes).optional(),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      manufacturer: z.string().optional(),
      hsn_code: z.string().optional(),
      gst_percentage: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Check for duplicate drug_code
      const existing = await db.select({ id: drugMaster.id }).from(drugMaster)
        .where(and(
          eq(drugMaster.drug_code, input.drug_code),
          eq(drugMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: `Drug code "${input.drug_code}" already exists` });
      }

      const [row] = await db.insert(drugMaster).values({
        hospital_id: ctx.user.hospital_id,
        drug_code: input.drug_code,
        drug_name: input.drug_name,
        generic_name: input.generic_name,
        category: input.category,
        strength: input.strength,
        unit: input.unit,
        route: input.route,
        price: input.price,
        manufacturer: input.manufacturer,
        hsn_code: input.hsn_code,
        gst_percentage: input.gst_percentage,
        created_by: ctx.user.sub as any,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'drug_master', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'drug_master', row_id: row.id, new_values: row as any });

      return row;
    }),

  // ─── UPDATE ───────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      drug_name: z.string().min(1).max(200).optional(),
      generic_name: z.string().optional(),
      category: z.enum(drugCategories).optional(),
      strength: z.string().optional(),
      unit: z.string().optional(),
      route: z.enum(drugRoutes).optional(),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      manufacturer: z.string().optional(),
      hsn_code: z.string().optional(),
      gst_percentage: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...updates } = input;

      const [old] = await db.select().from(drugMaster)
        .where(and(eq(drugMaster.id, id as any), eq(drugMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drug not found' });

      const setValues: any = { updated_at: new Date(), updated_by: ctx.user.sub };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) setValues[key] = val;
      }

      const [row] = await db.update(drugMaster)
        .set(setValues)
        .where(eq(drugMaster.id, id as any))
        .returning();

      await recordVersion(ctx.user, 'drug_master', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'drug_master', row_id: row.id, old_values: old as any, new_values: row as any });

      return row;
    }),

  // ─── DEACTIVATE (soft delete / toggle) ────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const [old] = await db.select().from(drugMaster)
        .where(and(eq(drugMaster.id, input.id as any), eq(drugMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drug not found' });

      const [row] = await db.update(drugMaster)
        .set({ is_active: !old.is_active, updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(drugMaster.id, input.id as any))
        .returning();

      await recordVersion(ctx.user, 'drug_master', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'drug_master', row_id: row.id,
        old_values: { is_active: old.is_active }, new_values: { is_active: row.is_active },
        reason: row.is_active ? 'Reactivated' : 'Deactivated',
      });

      return row;
    }),

  // ─── BULK IMPORT ──────────────────────────────────────────
  bulkImport: adminProcedure
    .input(z.object({
      rows: z.array(z.object({
        drug_code: z.string().min(1),
        drug_name: z.string().min(1),
        generic_name: z.string().optional(),
        category: z.enum(drugCategories),
        strength: z.string().optional(),
        unit: z.string().optional(),
        route: z.enum(drugRoutes).optional(),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        manufacturer: z.string().optional(),
        hsn_code: z.string().optional(),
        gst_percentage: z.string().optional().default('0'),
      })),
      mode: z.enum(['skip_duplicates', 'update_duplicates']).default('skip_duplicates'),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; code: string; error: string }[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        const rowNum = i + 1;

        try {
          const [existing] = await db.select({ id: drugMaster.id }).from(drugMaster)
            .where(and(
              eq(drugMaster.drug_code, row.drug_code),
              eq(drugMaster.hospital_id, ctx.user.hospital_id),
            )).limit(1);

          if (existing) {
            if (input.mode === 'update_duplicates') {
              await db.update(drugMaster).set({
                drug_name: row.drug_name,
                generic_name: row.generic_name,
                category: row.category,
                strength: row.strength,
                unit: row.unit,
                route: row.route,
                price: row.price,
                manufacturer: row.manufacturer,
                hsn_code: row.hsn_code,
                gst_percentage: row.gst_percentage,
                updated_by: ctx.user.sub as any,
                updated_at: new Date(),
              }).where(eq(drugMaster.id, existing.id));
              updated++;
            } else {
              skipped++;
            }
          } else {
            await db.insert(drugMaster).values({
              hospital_id: ctx.user.hospital_id,
              drug_code: row.drug_code,
              drug_name: row.drug_name,
              generic_name: row.generic_name,
              category: row.category,
              strength: row.strength,
              unit: row.unit,
              route: row.route,
              price: row.price,
              manufacturer: row.manufacturer,
              hsn_code: row.hsn_code,
              gst_percentage: row.gst_percentage,
              created_by: ctx.user.sub as any,
              updated_by: ctx.user.sub as any,
            });
            imported++;
          }
        } catch (err: any) {
          errors.push({ row: rowNum, code: row.drug_code, error: err.message || 'Unknown error' });
        }
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'drug_master',
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
      return getVersionHistory('drug_master', input.id);
    }),

  // ─── STATS ────────────────────────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const result = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE is_active = true)`,
      inactive: sql<number>`count(*) FILTER (WHERE is_active = false)`,
    }).from(drugMaster)
      .where(eq(drugMaster.hospital_id, ctx.user.hospital_id));

    return {
      total: Number(result[0]?.total ?? 0),
      active: Number(result[0]?.active ?? 0),
      inactive: Number(result[0]?.inactive ?? 0),
    };
  }),
});
