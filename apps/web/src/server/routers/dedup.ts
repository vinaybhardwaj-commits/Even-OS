import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  patients, potentialDuplicates, patientsAudit, mpiLinks, mpiRecords,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, or } from 'drizzle-orm';

// ─── SCORING HELPERS ─────────────────────────────────────────

/** Levenshtein-ish similarity via trigram overlap (0–1) */
function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;

  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();
  const padA = `  ${la} `;
  const padB = `  ${lb} `;
  for (let i = 0; i < padA.length - 2; i++) trigramsA.add(padA.slice(i, i + 3));
  for (let i = 0; i < padB.length - 2; i++) trigramsB.add(padB.slice(i, i + 3));

  let overlap = 0;
  for (const t of trigramsA) if (trigramsB.has(t)) overlap++;
  return overlap / Math.max(trigramsA.size, trigramsB.size);
}

/** Compute dedup score between two patient records */
function computeMatchScore(
  candidate: { phone: string; name_full: string; dob: Date | null },
  input: { phone: string; name_full: string; dob: string },
): { score: number; method: 'exact_phone' | 'fuzzy_name_dob' | 'exact_name_phone' } {
  const phoneMatch = candidate.phone === input.phone;
  const nameSim = trigramSimilarity(candidate.name_full, input.name_full);
  const nameExact = nameSim > 0.85;

  // Exact phone + exact name → very high confidence
  if (phoneMatch && nameExact) return { score: 0.98, method: 'exact_name_phone' };
  // Exact phone → high confidence
  if (phoneMatch) return { score: 0.85, method: 'exact_phone' };
  // Fuzzy name + same DOB → medium confidence
  if (nameSim > 0.6 && input.dob && candidate.dob) {
    const candidateDob = new Date(candidate.dob).toISOString().slice(0, 10);
    if (candidateDob === input.dob) {
      return { score: Math.min(0.65 + nameSim * 0.3, 0.95), method: 'fuzzy_name_dob' };
    }
  }

  return { score: 0, method: 'exact_phone' }; // no match
}

export const dedupRouter = router({

  // ─── CHECK DUPLICATES (live, during registration) ──────────
  check: protectedProcedure
    .input(z.object({
      phone: z.string().regex(/^\d{10}$/),
      name_full: z.string().min(1),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default(''),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Find candidates by phone OR fuzzy name
      const candidates = await db.select({
        id: patients.id,
        uhid: patients.uhid,
        name_full: patients.name_full,
        phone: patients.phone,
        dob: patients.dob,
        gender: patients.gender,
        patient_category: patients.patient_category,
        status: patients.status,
        created_at: patients.created_at,
      })
        .from(patients)
        .where(and(
          eq(patients.hospital_id, hospitalId),
          eq(patients.status, 'active'),
          or(
            eq(patients.phone, input.phone),
            sql`similarity(${patients.name_full}, ${input.name_full}) > 0.3`,
          ),
        ))
        .limit(20);

      // Score each candidate
      const matches = candidates
        .map(c => {
          const { score, method } = computeMatchScore(c, input);
          return { ...c, match_score: score, match_method: method };
        })
        .filter(c => c.match_score >= 0.50)
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 5);

      return { duplicates: matches, count: matches.length };
    }),

  // ─── LIST QUEUE (admin view of pending duplicates) ─────────
  listQueue: protectedProcedure
    .input(z.object({
      status: z.enum(['pending', 'merged', 'dismissed']).default('pending'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      // Count
      const [countRow] = await db.select({ count: sql<number>`count(*)` })
        .from(potentialDuplicates)
        .where(and(
          eq(potentialDuplicates.hospital_id, hospitalId),
          eq(potentialDuplicates.status, status),
        ));
      const total = Number(countRow?.count ?? 0);

      // Fetch pairs with patient details via subquery joins
      const rows = await db.execute(sql`
        SELECT
          pd.id,
          pd.match_method,
          pd.match_score,
          pd.status,
          pd.created_at,
          pd.resolution_note,
          pd.resolved_at,
          json_build_object(
            'id', pa.id, 'uhid', pa.uhid, 'name_full', pa.name_full,
            'phone', pa.phone, 'dob', pa.dob, 'gender', pa.gender,
            'patient_category', pa.patient_category, 'status', pa.status
          ) as patient_a,
          json_build_object(
            'id', pb.id, 'uhid', pb.uhid, 'name_full', pb.name_full,
            'phone', pb.phone, 'dob', pb.dob, 'gender', pb.gender,
            'patient_category', pb.patient_category, 'status', pb.status
          ) as patient_b
        FROM potential_duplicates pd
        JOIN patients pa ON pd.patient_a_id = pa.id
        JOIN patients pb ON pd.patient_b_id = pb.id
        WHERE pd.hospital_id = ${hospitalId}
          AND pd.status = ${status}
        ORDER BY pd.match_score DESC, pd.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const items = (rows as any).rows || rows;

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── QUEUE STATS ───────────────────────────────────────────
  queueStats: protectedProcedure.query(async ({ ctx }) => {
    const hospitalId = ctx.user.hospital_id;

    const counts = await db.execute(sql`
      SELECT status, count(*)::int as count
      FROM potential_duplicates
      WHERE hospital_id = ${hospitalId}
      GROUP BY status
    `);
    const rows = (counts as any).rows || counts;
    const stats: Record<string, number> = { pending: 0, merged: 0, dismissed: 0 };
    for (const r of rows) stats[r.status] = Number(r.count);
    return stats;
  }),

  // ─── MERGE ─────────────────────────────────────────────────
  merge: protectedProcedure
    .input(z.object({
      duplicate_id: z.string().uuid(),
      keep_patient_id: z.string().uuid(), // patient to keep
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Fetch the duplicate record
      const [dup] = await db.select().from(potentialDuplicates)
        .where(and(
          eq(potentialDuplicates.id, input.duplicate_id as any),
          eq(potentialDuplicates.hospital_id, hospitalId),
          eq(potentialDuplicates.status, 'pending'),
        ))
        .limit(1);

      if (!dup) throw new TRPCError({ code: 'NOT_FOUND', message: 'Duplicate record not found or already resolved' });

      // 2. Determine which patient to merge (the one NOT kept)
      const mergePatientId = dup.patient_a_id === input.keep_patient_id
        ? dup.patient_b_id
        : dup.patient_a_id;

      if (mergePatientId !== dup.patient_a_id && mergePatientId !== dup.patient_b_id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'keep_patient_id must be one of the duplicate pair' });
      }

      // 3. Mark merged patient as merged
      await db.update(patients)
        .set({
          status: 'merged',
          merged_to_patient_id: input.keep_patient_id,
          updated_at: new Date(),
          updated_by_user_id: ctx.user.sub,
        })
        .where(eq(patients.id, mergePatientId as any));

      // 4. Resolve the duplicate record
      await db.update(potentialDuplicates)
        .set({
          status: 'merged',
          resolved_by_user_id: ctx.user.sub,
          resolved_at: new Date(),
          resolution_note: input.note || `Merged into ${input.keep_patient_id}`,
        })
        .where(eq(potentialDuplicates.id, input.duplicate_id as any));

      // 5. Auto-dismiss other pending duplicates involving the merged patient
      await db.execute(sql`
        UPDATE potential_duplicates
        SET status = 'dismissed',
            resolved_by_user_id = ${ctx.user.sub}::uuid,
            resolved_at = NOW(),
            resolution_note = 'Auto-dismissed: patient was merged in another pair'
        WHERE hospital_id = ${hospitalId}
          AND status = 'pending'
          AND (patient_a_id = ${mergePatientId}::uuid OR patient_b_id = ${mergePatientId}::uuid)
          AND id != ${input.duplicate_id}::uuid
      `);

      // 6. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'potential_duplicates',
        row_id: input.duplicate_id,
        new_values: { status: 'merged', keep_patient_id: input.keep_patient_id, merged_patient_id: mergePatientId },
      });

      return { success: true, merged_patient_id: mergePatientId, kept_patient_id: input.keep_patient_id };
    }),

  // ─── DISMISS ───────────────────────────────────────────────
  dismiss: protectedProcedure
    .input(z.object({
      duplicate_id: z.string().uuid(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [dup] = await db.select().from(potentialDuplicates)
        .where(and(
          eq(potentialDuplicates.id, input.duplicate_id as any),
          eq(potentialDuplicates.hospital_id, hospitalId),
          eq(potentialDuplicates.status, 'pending'),
        ))
        .limit(1);

      if (!dup) throw new TRPCError({ code: 'NOT_FOUND', message: 'Duplicate record not found or already resolved' });

      await db.update(potentialDuplicates)
        .set({
          status: 'dismissed',
          resolved_by_user_id: ctx.user.sub,
          resolved_at: new Date(),
          resolution_note: input.note || 'Dismissed as false positive',
        })
        .where(eq(potentialDuplicates.id, input.duplicate_id as any));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'potential_duplicates',
        row_id: input.duplicate_id,
        new_values: { status: 'dismissed' },
      });

      return { success: true };
    }),

  // ─── ENQUEUE (called after registration to log matches) ────
  enqueue: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      matches: z.array(z.object({
        candidate_id: z.string().uuid(),
        match_score: z.number().min(0).max(1),
        match_method: z.enum(['exact_phone', 'fuzzy_name_dob', 'exact_name_phone']),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      let queued = 0;
      for (const m of input.matches) {
        // Avoid duplicate queue entries
        const [existing] = await db.select({ id: potentialDuplicates.id })
          .from(potentialDuplicates)
          .where(and(
            eq(potentialDuplicates.hospital_id, hospitalId),
            or(
              and(
                eq(potentialDuplicates.patient_a_id, input.patient_id as any),
                eq(potentialDuplicates.patient_b_id, m.candidate_id as any),
              ),
              and(
                eq(potentialDuplicates.patient_a_id, m.candidate_id as any),
                eq(potentialDuplicates.patient_b_id, input.patient_id as any),
              ),
            ),
            eq(potentialDuplicates.status, 'pending'),
          ))
          .limit(1);

        if (!existing) {
          await db.insert(potentialDuplicates).values({
            hospital_id: hospitalId,
            patient_a_id: input.patient_id,
            patient_b_id: m.candidate_id,
            match_method: m.match_method,
            match_score: String(m.match_score),
            status: 'pending',
          });
          queued++;
        }
      }

      return { queued };
    }),
});
