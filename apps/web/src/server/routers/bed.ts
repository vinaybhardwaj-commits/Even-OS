import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { locations, bedStatusHistory, bedAssignments, encounters, patients } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';

const bedStatusValues = ['available', 'occupied', 'reserved', 'blocked', 'housekeeping'] as const;

export const bedRouter = router({

  // ─── BED BOARD (grid of all beds with status) ──────────────
  board: protectedProcedure
    .input(z.object({
      ward_code: z.string().optional(), // filter to specific ward
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // Get all wards with their beds + current occupant info
      const result = await db.execute(sql`
        WITH bed_occupants AS (
          SELECT
            ba.location_id,
            ba.encounter_id,
            e.patient_id,
            p.uhid,
            p.name_full as patient_name,
            p.gender,
            e.encounter_class,
            e.admission_at,
            e.preliminary_diagnosis_icd10 as diagnosis
          FROM bed_assignments ba
          JOIN encounters e ON ba.encounter_id = e.id
          JOIN patients p ON e.patient_id = p.id
          WHERE ba.released_at IS NULL
            AND ba.hospital_id = ${hospitalId}
        )
        SELECT
          w.id as ward_id,
          w.code as ward_code,
          w.name as ward_name,
          w.capacity as ward_capacity,
          json_agg(
            json_build_object(
              'id', b.id,
              'code', b.code,
              'name', b.name,
              'bed_status', b.bed_status,
              'patient_uhid', bo.uhid,
              'patient_name', bo.patient_name,
              'patient_gender', bo.gender,
              'encounter_id', bo.encounter_id,
              'encounter_class', bo.encounter_class,
              'admission_at', bo.admission_at,
              'diagnosis', bo.diagnosis
            ) ORDER BY b.code
          ) as beds
        FROM locations w
        JOIN locations b ON b.parent_location_id = w.id AND b.location_type = 'bed'
        LEFT JOIN bed_occupants bo ON bo.location_id = b.id
        WHERE w.location_type = 'ward'
          AND w.hospital_id = ${hospitalId}
          AND w.status = 'active'
          ${input.ward_code ? sql`AND w.code = ${input.ward_code}` : sql``}
        GROUP BY w.id, w.code, w.name, w.capacity
        ORDER BY w.code
      `);

      const rows = (result as any).rows || result;
      return { wards: rows };
    }),

  // ─── BED STATS (summary counts) ───────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const hospitalId = ctx.user.hospital_id;

    const result = await db.execute(sql`
      SELECT
        bed_status,
        count(*)::int as count
      FROM locations
      WHERE location_type = 'bed'
        AND hospital_id = ${hospitalId}
        AND status = 'active'
      GROUP BY bed_status
    `);

    const rows = (result as any).rows || result;
    const stats: Record<string, number> = {
      available: 0, occupied: 0, reserved: 0, blocked: 0, housekeeping: 0,
    };
    for (const r of rows) stats[r.bed_status] = Number(r.count);
    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    return { ...stats, total };
  }),

  // ─── UPDATE BED STATUS ─────────────────────────────────────
  updateStatus: protectedProcedure
    .input(z.object({
      bed_id: z.string().uuid(),
      status: z.enum(bedStatusValues),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // Verify bed exists and belongs to this hospital
      const [bed] = await db.select().from(locations)
        .where(and(
          eq(locations.id, input.bed_id as any),
          eq(locations.hospital_id, hospitalId),
          eq(locations.location_type, 'bed'),
        ))
        .limit(1);

      if (!bed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bed not found' });

      // Can't manually set to 'occupied' — that happens via bed assignment
      if (input.status === 'occupied') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Beds are marked occupied via admission, not manual status change' });
      }

      const oldStatus = bed.bed_status;

      // Update bed
      await db.update(locations)
        .set({ bed_status: input.status })
        .where(eq(locations.id, input.bed_id as any));

      // Log status change
      await db.insert(bedStatusHistory).values({
        hospital_id: hospitalId,
        location_id: input.bed_id,
        status: input.status,
        reason: input.reason || `Changed from ${oldStatus} to ${input.status}`,
        changed_by_user_id: ctx.user.sub,
      });

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'locations',
        row_id: input.bed_id,
        old_values: { bed_status: oldStatus },
        new_values: { bed_status: input.status },
      });

      return { success: true, bed_id: input.bed_id, old_status: oldStatus, new_status: input.status };
    }),

  // ─── LIST WARDS ────────────────────────────────────────────
  listWards: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    return db.select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
      capacity: locations.capacity,
    })
      .from(locations)
      .where(and(
        eq(locations.hospital_id, ctx.user.hospital_id),
        eq(locations.location_type, 'ward'),
        eq(locations.status, 'active'),
      ))
      .orderBy(locations.code);
  }),

  // ─── BED HISTORY ───────────────────────────────────────────
  history: protectedProcedure
    .input(z.object({
      bed_id: z.string().uuid(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      return db.select()
        .from(bedStatusHistory)
        .where(and(
          eq(bedStatusHistory.location_id, input.bed_id as any),
          eq(bedStatusHistory.hospital_id, ctx.user.hospital_id),
        ))
        .orderBy(desc(bedStatusHistory.changed_at))
        .limit(input.limit);
    }),
});
