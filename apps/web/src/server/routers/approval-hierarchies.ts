import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { approvalHierarchies } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql } from 'drizzle-orm';

const approvalTypes = ['discount', 'write_off', 'override', 'refund', 'credit_note', 'other'] as const;

export const approvalHierarchiesRouter = router({

  // ─── LIST ─────────────────────────────────────────────────
  list: adminProcedure.query(async ({ ctx }) => {
    const db = getDb();
    return db.select().from(approvalHierarchies)
      .where(eq(approvalHierarchies.hospital_id, ctx.user.hospital_id))
      .orderBy(approvalHierarchies.approval_type);
  }),

  // ─── GET ──────────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db.select().from(approvalHierarchies)
        .where(and(eq(approvalHierarchies.id, input.id as any), eq(approvalHierarchies.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval hierarchy not found' });
      return row;
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      approval_type: z.enum(approvalTypes),
      levels: z.array(z.object({
        threshold_min: z.number(),
        threshold_max: z.number(),
        approver_role: z.string(),
        description: z.string().optional(),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Check if type already exists for this hospital
      const existing = await db.select({ id: approvalHierarchies.id }).from(approvalHierarchies)
        .where(and(
          eq(approvalHierarchies.approval_type, input.approval_type),
          eq(approvalHierarchies.hospital_id, ctx.user.hospital_id),
        )).limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: `Approval hierarchy for "${input.approval_type}" already exists. Use update instead.` });
      }

      const [row] = await db.insert(approvalHierarchies).values({
        hospital_id: ctx.user.hospital_id,
        approval_type: input.approval_type,
        levels: input.levels,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'approval_hierarchy', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'approval_hierarchies', row_id: row.id, new_values: row as any });
      return row;
    }),

  // ─── UPDATE LEVELS ────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      levels: z.array(z.object({
        threshold_min: z.number(),
        threshold_max: z.number(),
        approver_role: z.string(),
        description: z.string().optional(),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const [old] = await db.select().from(approvalHierarchies)
        .where(and(eq(approvalHierarchies.id, input.id as any), eq(approvalHierarchies.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval hierarchy not found' });

      const [row] = await db.update(approvalHierarchies)
        .set({ levels: input.levels, updated_by: ctx.user.sub as any, updated_at: new Date() })
        .where(eq(approvalHierarchies.id, input.id as any))
        .returning();

      await recordVersion(ctx.user, 'approval_hierarchy', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'approval_hierarchies', row_id: row.id, old_values: old as any, new_values: row as any });
      return row;
    }),

  // ─── DEACTIVATE (toggle) ──────────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [old] = await db.select().from(approvalHierarchies)
        .where(and(eq(approvalHierarchies.id, input.id as any), eq(approvalHierarchies.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval hierarchy not found' });

      const [row] = await db.update(approvalHierarchies)
        .set({ is_active: !old.is_active, updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(approvalHierarchies.id, input.id as any))
        .returning();

      await recordVersion(ctx.user, 'approval_hierarchy', row.id, row as any, old as any);
      return row;
    }),

  // ─── VERSION HISTORY ──────────────────────────────────────
  versionHistory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVersionHistory('approval_hierarchy', input.id);
    }),
});
