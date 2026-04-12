import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { wristbandJobs, encounters, patients } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc } from 'drizzle-orm';

export const wristbandRouter = router({

  // ─── GENERATE (queue a wristband print job) ────────────────
  generate: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      format: z.enum(['wristband_roll', 'label_sheet']).default('wristband_roll'),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify encounter exists
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
        status: encounters.status,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });
      if (encounter.status === 'finished' || encounter.status === 'cancelled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot generate wristband for completed encounter' });
      }

      const [job] = await db.insert(wristbandJobs).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        format: input.format,
        status: 'queued',
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'wristband_jobs',
        row_id: job.id,
        new_values: { encounter_id: input.encounter_id, format: input.format },
      });

      return { job_id: job.id, status: 'queued' };
    }),

  // ─── LIST (print queue with patient details) ───────────────
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['queued', 'printing', 'printed', 'failed']).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const statusFilter = status ? sql`AND wj.status = ${status}` : sql``;

      const result = await db.execute(sql`
        SELECT
          wj.id,
          wj.format,
          wj.status,
          wj.created_at,
          wj.printed_at,
          wj.printer_id,
          p.uhid,
          p.name_full as patient_name,
          p.gender,
          p.dob,
          p.blood_group,
          p.phone,
          e.encounter_class,
          e.admission_at
        FROM wristband_jobs wj
        JOIN encounters e ON wj.encounter_id = e.id
        JOIN patients p ON e.patient_id = p.id
        WHERE wj.hospital_id = ${hospitalId}
          ${statusFilter}
        ORDER BY wj.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM wristband_jobs
        WHERE hospital_id = ${hospitalId}
          ${statusFilter}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── STATS ─────────────────────────────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const hospitalId = ctx.user.hospital_id;

    const result = await db.execute(sql`
      SELECT status, count(*)::int as count
      FROM wristband_jobs
      WHERE hospital_id = ${hospitalId}
      GROUP BY status
    `);

    const rows = (result as any).rows || result;
    const stats: Record<string, number> = { queued: 0, printing: 0, printed: 0, failed: 0 };
    for (const r of rows) stats[r.status] = Number(r.count);
    return stats;
  }),

  // ─── MARK PRINTED ──────────────────────────────────────────
  markPrinted: protectedProcedure
    .input(z.object({
      job_id: z.string().uuid(),
      printer_id: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [job] = await db.select().from(wristbandJobs)
        .where(and(
          eq(wristbandJobs.id, input.job_id as any),
          eq(wristbandJobs.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Wristband job not found' });

      await db.update(wristbandJobs)
        .set({
          status: 'printed',
          printed_at: new Date(),
          printer_id: input.printer_id || null,
        })
        .where(eq(wristbandJobs.id, input.job_id as any));

      return { success: true };
    }),

  // ─── REPRINT ───────────────────────────────────────────────
  reprint: protectedProcedure
    .input(z.object({
      job_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [oldJob] = await db.select().from(wristbandJobs)
        .where(and(
          eq(wristbandJobs.id, input.job_id as any),
          eq(wristbandJobs.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!oldJob) throw new TRPCError({ code: 'NOT_FOUND', message: 'Wristband job not found' });

      // Create a new queued job from the old one
      const [newJob] = await db.insert(wristbandJobs).values({
        hospital_id: hospitalId,
        encounter_id: oldJob.encounter_id,
        format: oldJob.format,
        status: 'queued',
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'wristband_jobs',
        row_id: newJob.id,
        new_values: { reprint_of: input.job_id },
      });

      return { job_id: newJob.id, status: 'queued' };
    }),
});
