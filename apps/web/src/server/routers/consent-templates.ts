import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { consentTemplates } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

const consentCategories = ['surgical', 'anesthesia', 'transfusion', 'research', 'general', 'procedure', 'other'] as const;

export const consentTemplatesRouter = router({

  // ─── LIST ─────────────────────────────────────────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.enum(consentCategories).optional(),
      status: z.enum(['active', 'draft', 'archived', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, category, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(consentTemplates.hospital_id, ctx.user.hospital_id)];
      if (category) conditions.push(eq(consentTemplates.category, category));
      if (status && status !== 'all') conditions.push(eq(consentTemplates.status, status));
      if (search) {
        conditions.push(ilike(consentTemplates.name, `%${search}%`));
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(consentTemplates).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(consentTemplates).where(where)
        .orderBy(desc(consentTemplates.updated_at))
        .limit(pageSize).offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── GET ──────────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(consentTemplates)
        .where(and(eq(consentTemplates.id, input.id as any), eq(consentTemplates.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Consent template not found' });
      return row;
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      category: z.enum(consentCategories),
      template_text: z.string().min(1),
      status: z.enum(['active', 'draft']).default('draft'),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.insert(consentTemplates).values({
        hospital_id: ctx.user.hospital_id,
        name: input.name,
        category: input.category,
        template_text: input.template_text,
        version: 1,
        status: input.status,
        created_by: ctx.user.sub as any,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'consent_template', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'consent_templates', row_id: row.id, new_values: row as any });
      return row;
    }),

  // ─── UPDATE (creates new version) ────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      category: z.enum(consentCategories).optional(),
      template_text: z.string().min(1).optional(),
      status: z.enum(['active', 'draft', 'archived']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [old] = await db.select().from(consentTemplates)
        .where(and(eq(consentTemplates.id, id as any), eq(consentTemplates.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Consent template not found' });

      // Bump version if template_text changed
      const newVersion = updates.template_text && updates.template_text !== old.template_text
        ? old.version + 1
        : old.version;

      const setValues: any = { updated_at: new Date(), updated_by: ctx.user.sub, version: newVersion };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) setValues[key] = val;
      }

      const [row] = await db.update(consentTemplates).set(setValues)
        .where(eq(consentTemplates.id, id as any)).returning();

      await recordVersion(ctx.user, 'consent_template', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'consent_templates', row_id: row.id, old_values: old as any, new_values: row as any });
      return row;
    }),

  // ─── VERSION HISTORY ──────────────────────────────────────
  versionHistory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVersionHistory('consent_template', input.id);
    }),

  // ─── STATS ────────────────────────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const result = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE status = 'active')`,
      draft: sql<number>`count(*) FILTER (WHERE status = 'draft')`,
      archived: sql<number>`count(*) FILTER (WHERE status = 'archived')`,
    }).from(consentTemplates).where(eq(consentTemplates.hospital_id, ctx.user.hospital_id));

    return {
      total: Number(result[0]?.total ?? 0),
      active: Number(result[0]?.active ?? 0),
      draft: Number(result[0]?.draft ?? 0),
      archived: Number(result[0]?.archived ?? 0),
    };
  }),
});
