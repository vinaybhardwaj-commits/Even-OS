/**
 * Tasks Router — CHAT.X.6 (20 Apr 2026)
 *
 * Query + mutate the real `tasks` table. The chat-side create/complete/reassign
 * flows remain on `chat.*` (they dual-write via task-bridge.ts), so this router
 * is additive: reads, plus an `update` patch and an `updateStatus` for the
 * "In Progress" state that the chat flow doesn't model.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

const priorityEnum = z.enum(['low', 'normal', 'high', 'urgent', 'critical']);
const statusEnum = z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'reassigned']);

export const tasksRouter = router({
  // ── List my pending / in-progress tasks ─────────────────────────
  // The hot query. Powered by idx_tasks_assignee_status.
  listMine: protectedProcedure
    .input(
      z.object({
        includeCompleted: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const limit = input?.limit ?? 50;
      const includeCompleted = input?.includeCompleted ?? false;

      const rows = includeCompleted
        ? await sql`
            SELECT t.id, t.chat_message_id, t.title, t.description,
                   t.due_at, t.priority, t.status,
                   t.encounter_id, t.patient_id,
                   t.completed_at, t.created_at, t.updated_at,
                   t.created_by, cu.name AS created_by_name,
                   t.assignee_id, au.name AS assignee_name,
                   p.name_full AS patient_name, p.uhid AS patient_uhid,
                   c.channel_id AS channel_slug
            FROM tasks t
            LEFT JOIN users cu ON cu.id = t.created_by
            LEFT JOIN users au ON au.id = t.assignee_id
            LEFT JOIN patients p ON p.id = t.patient_id
            LEFT JOIN chat_messages m ON m.id = t.chat_message_id
            LEFT JOIN chat_channels c ON c.id = m.channel_id
            WHERE t.assignee_id = ${ctx.user.sub}
              AND t.hospital_id = ${ctx.user.hospital_id}
            ORDER BY
              CASE t.status
                WHEN 'in_progress' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'completed' THEN 2
                ELSE 3
              END,
              COALESCE(t.due_at, t.created_at) ASC
            LIMIT ${limit}
          `
        : await sql`
            SELECT t.id, t.chat_message_id, t.title, t.description,
                   t.due_at, t.priority, t.status,
                   t.encounter_id, t.patient_id,
                   t.completed_at, t.created_at, t.updated_at,
                   t.created_by, cu.name AS created_by_name,
                   t.assignee_id, au.name AS assignee_name,
                   p.name_full AS patient_name, p.uhid AS patient_uhid,
                   c.channel_id AS channel_slug
            FROM tasks t
            LEFT JOIN users cu ON cu.id = t.created_by
            LEFT JOIN users au ON au.id = t.assignee_id
            LEFT JOIN patients p ON p.id = t.patient_id
            LEFT JOIN chat_messages m ON m.id = t.chat_message_id
            LEFT JOIN chat_channels c ON c.id = m.channel_id
            WHERE t.assignee_id = ${ctx.user.sub}
              AND t.hospital_id = ${ctx.user.hospital_id}
              AND t.status IN ('pending','in_progress')
            ORDER BY
              CASE t.status WHEN 'in_progress' THEN 0 ELSE 1 END,
              COALESCE(t.due_at, t.created_at) ASC
            LIMIT ${limit}
          `;

      return rows as Array<Record<string, any>>;
    }),

  // ── Filter list (admin / department views) ──────────────────────
  list: protectedProcedure
    .input(z.object({
      assigneeId: z.string().uuid().optional(),
      encounterId: z.string().uuid().optional(),
      patientId: z.string().uuid().optional(),
      status: z.array(statusEnum).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const statuses = input.status && input.status.length > 0
        ? input.status
        : null;

      const rows = await sql`
        SELECT t.id, t.chat_message_id, t.title, t.description,
               t.due_at, t.priority, t.status,
               t.encounter_id, t.patient_id,
               t.completed_at, t.created_at, t.updated_at,
               t.created_by, cu.name AS created_by_name,
               t.assignee_id, au.name AS assignee_name,
               p.name_full AS patient_name, p.uhid AS patient_uhid
        FROM tasks t
        LEFT JOIN users cu ON cu.id = t.created_by
        LEFT JOIN users au ON au.id = t.assignee_id
        LEFT JOIN patients p ON p.id = t.patient_id
        WHERE t.hospital_id = ${ctx.user.hospital_id}
          AND (${input.assigneeId ?? null}::uuid IS NULL OR t.assignee_id = ${input.assigneeId ?? null}::uuid)
          AND (${input.encounterId ?? null}::uuid IS NULL OR t.encounter_id = ${input.encounterId ?? null}::uuid)
          AND (${input.patientId ?? null}::uuid IS NULL OR t.patient_id = ${input.patientId ?? null}::uuid)
          AND (${statuses}::text[] IS NULL OR t.status = ANY(${statuses}::text[]))
        ORDER BY t.created_at DESC
        LIMIT ${input.limit}
      `;

      return rows as Array<Record<string, any>>;
    }),

  // ── Quick counts for the "My Tasks" badge ───────────────────────
  myCounts: protectedProcedure.query(async ({ ctx }) => {
    const sql = getSql();
    const [row] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status IN ('pending','in_progress')
                         AND due_at IS NOT NULL
                         AND due_at < NOW())::int AS overdue
      FROM tasks
      WHERE assignee_id = ${ctx.user.sub}
        AND hospital_id = ${ctx.user.hospital_id}
    ` as Array<{ pending: number; in_progress: number; overdue: number }>;
    return row ?? { pending: 0, in_progress: 0, overdue: 0 };
  }),

  // ── Update status (for "Start" button → in_progress, "Cancel", etc.) ──
  // Completion + reassignment still flow through chat.completeTask /
  // chat.reassignTask because they also update the chat_messages row.
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['pending', 'in_progress', 'cancelled']),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const [existing] = await sql`
        SELECT status, assignee_id, created_by
        FROM tasks
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
      ` as Array<{ status: string; assignee_id: string; created_by: string }>;

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      if (existing.status === 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task already completed — use chat.completeTask to re-open or leave as-is' });
      }
      if (existing.assignee_id !== ctx.user.sub && existing.created_by !== ctx.user.sub) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only assignee or creator can change task status' });
      }

      await sql`
        UPDATE tasks
        SET status = ${input.status}, updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
      `;
      return { success: true };
    }),

  // ── Update scalar fields (title / description / due / priority) ──
  // Only creator or assignee. Status/reassignment go through dedicated paths.
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(240).optional(),
      description: z.string().max(4000).optional().nullable(),
      due_at: z.string().optional().nullable(),
      priority: priorityEnum.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const [existing] = await sql`
        SELECT assignee_id, created_by, status
        FROM tasks
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
      ` as Array<{ assignee_id: string; created_by: string; status: string }>;

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      if (existing.status === 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot edit a completed task' });
      }
      if (existing.assignee_id !== ctx.user.sub && existing.created_by !== ctx.user.sub) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only assignee or creator can edit task' });
      }

      await sql`
        UPDATE tasks
        SET
          title       = COALESCE(${input.title ?? null}, title),
          description = CASE WHEN ${input.description === undefined} THEN description ELSE ${input.description ?? null} END,
          due_at      = CASE WHEN ${input.due_at === undefined}      THEN due_at      ELSE ${input.due_at ?? null}::timestamptz END,
          priority    = COALESCE(${input.priority ?? null}, priority),
          updated_at  = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}
      `;

      return { success: true };
    }),

  // ── Get a single task by id ─────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const [row] = await sql`
        SELECT t.*, cu.name AS created_by_name, au.name AS assignee_name,
               p.name_full AS patient_name, p.uhid AS patient_uhid,
               c.channel_id AS channel_slug
        FROM tasks t
        LEFT JOIN users cu ON cu.id = t.created_by
        LEFT JOIN users au ON au.id = t.assignee_id
        LEFT JOIN patients p ON p.id = t.patient_id
        LEFT JOIN chat_messages m ON m.id = t.chat_message_id
        LEFT JOIN chat_channels c ON c.id = m.channel_id
        WHERE t.id = ${input.id}
          AND t.hospital_id = ${ctx.user.hospital_id}
      `;
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      return row as Record<string, any>;
    }),
});
