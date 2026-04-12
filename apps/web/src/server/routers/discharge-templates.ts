import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { dischargeTemplates } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, ilike } from 'drizzle-orm';

const AVAILABLE_FIELDS = [
  'diagnosis', 'medications', 'follow_up', 'precautions', 'activity',
  'diet', 'investigations', 'procedures_done', 'condition_at_discharge',
  'vitals_at_discharge', 'wound_care', 'physiotherapy', 'emergency_instructions',
] as const;

export const dischargeTemplatesRouter = router({

  // ─── LIST ─────────────────────────────────────────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const { search, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(dischargeTemplates.hospital_id, ctx.user.hospital_id)];
      if (status === 'active') conditions.push(eq(dischargeTemplates.is_active, true));
      if (status === 'inactive') conditions.push(eq(dischargeTemplates.is_active, false));
      if (search) conditions.push(ilike(dischargeTemplates.name, `%${search}%`));

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(dischargeTemplates).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(dischargeTemplates).where(where)
        .orderBy(desc(dischargeTemplates.updated_at))
        .limit(pageSize).offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── GET ──────────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db.select().from(dischargeTemplates)
        .where(and(eq(dischargeTemplates.id, input.id as any), eq(dischargeTemplates.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Discharge template not found' });
      return row;
    }),

  // ─── AVAILABLE FIELDS (for UI field picker) ───────────────
  availableFields: adminProcedure.query(() => {
    return AVAILABLE_FIELDS.map(f => ({
      key: f,
      label: f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    }));
  }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      clinical_fields: z.array(z.string()).min(1),
      text_sections: z.array(z.object({
        title: z.string().min(1),
        default_text: z.string().default(''),
      })).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db.insert(dischargeTemplates).values({
        hospital_id: ctx.user.hospital_id,
        name: input.name,
        clinical_fields: input.clinical_fields,
        text_sections: input.text_sections,
        created_by: ctx.user.sub as any,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'discharge_template', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'discharge_templates', row_id: row.id, new_values: row as any });
      return row;
    }),

  // ─── UPDATE ───────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      clinical_fields: z.array(z.string()).optional(),
      text_sections: z.array(z.object({
        title: z.string().min(1),
        default_text: z.string().default(''),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...updates } = input;

      const [old] = await db.select().from(dischargeTemplates)
        .where(and(eq(dischargeTemplates.id, id as any), eq(dischargeTemplates.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Discharge template not found' });

      const setValues: any = { updated_at: new Date(), updated_by: ctx.user.sub };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) setValues[key] = val;
      }

      const [row] = await db.update(dischargeTemplates).set(setValues)
        .where(eq(dischargeTemplates.id, id as any)).returning();

      await recordVersion(ctx.user, 'discharge_template', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'discharge_templates', row_id: row.id, old_values: old as any, new_values: row as any });
      return row;
    }),

  // ─── DEACTIVATE (toggle) ──────────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [old] = await db.select().from(dischargeTemplates)
        .where(and(eq(dischargeTemplates.id, input.id as any), eq(dischargeTemplates.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Discharge template not found' });

      const [row] = await db.update(dischargeTemplates)
        .set({ is_active: !old.is_active, updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(dischargeTemplates.id, input.id as any)).returning();

      await recordVersion(ctx.user, 'discharge_template', row.id, row as any, old as any);
      return row;
    }),

  // ─── VERSION HISTORY ──────────────────────────────────────
  versionHistory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVersionHistory('discharge_template', input.id);
    }),

  // ─── STATS ────────────────────────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const result = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE is_active = true)`,
    }).from(dischargeTemplates).where(eq(dischargeTemplates.hospital_id, ctx.user.hospital_id));

    return {
      total: Number(result[0]?.total ?? 0),
      active: Number(result[0]?.active ?? 0),
    };
  }),
});
