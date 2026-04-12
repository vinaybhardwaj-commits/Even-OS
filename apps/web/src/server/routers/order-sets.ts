import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { orderSets, orderSetItems } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

const itemTypes = ['medication', 'lab', 'radiology', 'procedure', 'other'] as const;

export const orderSetsRouter = router({

  // ─── LIST ─────────────────────────────────────────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, category, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(orderSets.hospital_id, ctx.user.hospital_id)];
      if (category) conditions.push(eq(orderSets.category, category));
      if (status === 'active') conditions.push(eq(orderSets.is_active, true));
      if (status === 'inactive') conditions.push(eq(orderSets.is_active, false));
      if (search) {
        conditions.push(or(
          ilike(orderSets.name, `%${search}%`),
          ilike(orderSets.description, `%${search}%`),
        )!);
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(orderSets).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(orderSets).where(where)
        .orderBy(desc(orderSets.updated_at))
        .limit(pageSize).offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── GET (with items) ─────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [set] = await db.select().from(orderSets)
        .where(and(eq(orderSets.id, input.id as any), eq(orderSets.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!set) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order set not found' });

      const items = await db.select().from(orderSetItems)
        .where(eq(orderSetItems.order_set_id, input.id as any))
        .orderBy(orderSetItems.sort_order);

      return { ...set, items };
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      description: z.string().optional(),
      category: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.insert(orderSets).values({
        hospital_id: ctx.user.hospital_id,
        name: input.name,
        description: input.description,
        category: input.category,
        created_by: ctx.user.sub as any,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'order_set', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'order_sets', row_id: row.id, new_values: row as any });
      return row;
    }),

  // ─── UPDATE ───────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [old] = await db.select().from(orderSets)
        .where(and(eq(orderSets.id, id as any), eq(orderSets.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order set not found' });

      const setValues: any = { updated_at: new Date(), updated_by: ctx.user.sub };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) setValues[key] = val;
      }

      const [row] = await db.update(orderSets).set(setValues)
        .where(eq(orderSets.id, id as any)).returning();

      await recordVersion(ctx.user, 'order_set', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'order_sets', row_id: row.id, old_values: old as any, new_values: row as any });
      return row;
    }),

  // ─── DEACTIVATE (toggle) ──────────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [old] = await db.select().from(orderSets)
        .where(and(eq(orderSets.id, input.id as any), eq(orderSets.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order set not found' });

      const [row] = await db.update(orderSets)
        .set({ is_active: !old.is_active, updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(orderSets.id, input.id as any)).returning();

      await recordVersion(ctx.user, 'order_set', row.id, row as any, old as any);
      return row;
    }),

  // ─── ADD ITEM ─────────────────────────────────────────────
  addItem: adminProcedure
    .input(z.object({
      order_set_id: z.string().uuid(),
      item_type: z.enum(itemTypes),
      item_name: z.string().min(1),
      reference_id: z.string().uuid().optional(),
      frequency: z.string().optional(),
      duration: z.string().optional(),
      instructions: z.string().optional(),
      sort_order: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {

      // Verify order set exists and belongs to hospital
      const [set] = await db.select({ id: orderSets.id }).from(orderSets)
        .where(and(eq(orderSets.id, input.order_set_id as any), eq(orderSets.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!set) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order set not found' });

      // Auto sort_order if not provided
      let sortOrder = input.sort_order;
      if (sortOrder === 0) {
        const maxSort = await db.select({ max: sql<number>`COALESCE(MAX(sort_order), 0)` })
          .from(orderSetItems).where(eq(orderSetItems.order_set_id, input.order_set_id as any));
        sortOrder = Number(maxSort[0]?.max ?? 0) + 1;
      }

      const [item] = await db.insert(orderSetItems).values({
        order_set_id: input.order_set_id as any,
        item_type: input.item_type,
        item_name: input.item_name,
        reference_id: input.reference_id as any,
        frequency: input.frequency,
        duration: input.duration,
        instructions: input.instructions,
        sort_order: sortOrder,
      }).returning();

      // Update order set timestamp
      await db.update(orderSets).set({ updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(orderSets.id, input.order_set_id as any));

      return item;
    }),

  // ─── REMOVE ITEM ──────────────────────────────────────────
  removeItem: adminProcedure
    .input(z.object({ item_id: z.string().uuid(), order_set_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      // Verify ownership
      const [set] = await db.select({ id: orderSets.id }).from(orderSets)
        .where(and(eq(orderSets.id, input.order_set_id as any), eq(orderSets.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!set) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order set not found' });

      await db.delete(orderSetItems).where(eq(orderSetItems.id, input.item_id as any));

      await db.update(orderSets).set({ updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(orderSets.id, input.order_set_id as any));

      return { success: true };
    }),

  // ─── VERSION HISTORY ──────────────────────────────────────
  versionHistory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVersionHistory('order_set', input.id);
    }),

  // ─── STATS ────────────────────────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const result = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE is_active = true)`,
    }).from(orderSets).where(eq(orderSets.hospital_id, ctx.user.hospital_id));

    // Count total items across all sets
    const itemCount = await db.select({ count: sql<number>`count(*)` })
      .from(orderSetItems)
      .innerJoin(orderSets, eq(orderSetItems.order_set_id, orderSets.id))
      .where(eq(orderSets.hospital_id, ctx.user.hospital_id));

    return {
      total: Number(result[0]?.total ?? 0),
      active: Number(result[0]?.active ?? 0),
      totalItems: Number(itemCount[0]?.count ?? 0),
    };
  }),
});
