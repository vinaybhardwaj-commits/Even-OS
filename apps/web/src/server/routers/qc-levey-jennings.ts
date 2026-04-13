/**
 * QC & Levey-Jennings — Module 8 LIS (L.7)
 *
 * Quality Control lot management, QC run recording with Westgard
 * multi-rule evaluation, Levey-Jennings charting data, and sigma metrics.
 *
 * Endpoints:
 *   1.  createLot        — Register a new QC control lot
 *   2.  listLots         — List lots with filters
 *   3.  updateLot        — Edit lot details or expire
 *   4.  recordRun        — Record QC measurement + auto Westgard eval
 *   5.  reviewRun        — Supervisor review + corrective action
 *   6.  listRuns         — Runs for a lot (feeds LJ chart)
 *   7.  ljChartData      — Pre-computed LJ chart payload (runs + lines)
 *   8.  computeMetrics   — Recompute LJ period statistics + sigma
 *   9.  listMetrics      — Period metrics for trend analysis
 *  10.  stats            — QC dashboard summary
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { qcLots, qcRuns, leveyJenningsMetrics } from '@db/schema';
import { eq, and, desc, count, sql, gte, lte, asc, between } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/*  Westgard Multi-Rule Engine                                         */
/* ------------------------------------------------------------------ */

interface WestgardResult {
  status: 'accepted' | 'rejected' | 'warning';
  rule_violated: string;
  details: { rules_checked: string[]; triggered: string[] };
}

function evaluateWestgard(
  currentValue: number,
  mean: number,
  sd: number,
  recentValues: number[],     // most recent first (up to 10)
): WestgardResult {
  const z = (currentValue - mean) / sd;
  const rules_checked: string[] = [];
  const triggered: string[] = [];

  // 1-3s: single value beyond ±3 SD → REJECT
  rules_checked.push('1_3s');
  if (Math.abs(z) > 3) triggered.push('1_3s');

  // 1-2s: single value beyond ±2 SD → WARNING
  rules_checked.push('1_2s');
  if (Math.abs(z) > 2 && !triggered.includes('1_3s')) triggered.push('1_2s');

  // Need recent history for multi-value rules
  if (recentValues.length >= 1) {
    const allValues = [currentValue, ...recentValues];
    const zScores = allValues.map(v => (v - mean) / sd);

    // 2-2s: 2 consecutive beyond ±2 SD same side → REJECT
    if (zScores.length >= 2) {
      rules_checked.push('2_2s');
      if (Math.abs(zScores[0]) > 2 && Math.abs(zScores[1]) > 2 &&
          Math.sign(zScores[0]) === Math.sign(zScores[1])) {
        triggered.push('2_2s');
      }
    }

    // R-4s: difference between consecutive > 4 SD → REJECT
    if (zScores.length >= 2) {
      rules_checked.push('R_4s');
      if (Math.abs(zScores[0] - zScores[1]) > 4) {
        triggered.push('R_4s');
      }
    }

    // 4-1s: 4 consecutive beyond ±1 SD same side → REJECT
    if (zScores.length >= 4) {
      rules_checked.push('4_1s');
      const first4 = zScores.slice(0, 4);
      if (first4.every(z => z > 1) || first4.every(z => z < -1)) {
        triggered.push('4_1s');
      }
    }

    // 7-T: 7 consecutive trending (all increasing or all decreasing) → WARNING
    if (allValues.length >= 7) {
      rules_checked.push('7_T');
      const first7 = allValues.slice(0, 7);
      let increasing = true, decreasing = true;
      for (let i = 1; i < 7; i++) {
        if (first7[i] >= first7[i - 1]) decreasing = false;
        if (first7[i] <= first7[i - 1]) increasing = false;
      }
      if (increasing || decreasing) triggered.push('7_T');
    }

    // 7-x: 7 consecutive on same side of mean → WARNING
    if (zScores.length >= 7) {
      rules_checked.push('7_x');
      const first7 = zScores.slice(0, 7);
      if (first7.every(z => z > 0) || first7.every(z => z < 0)) {
        triggered.push('7_x');
      }
    }

    // 10-x: 10 consecutive on same side of mean → REJECT
    if (zScores.length >= 10) {
      rules_checked.push('10_x');
      const first10 = zScores.slice(0, 10);
      if (first10.every(z => z > 0) || first10.every(z => z < 0)) {
        triggered.push('10_x');
      }
    }
  }

  const rejectRules = ['1_3s', '2_2s', 'R_4s', '4_1s', '10_x'];
  const hasReject = triggered.some(r => rejectRules.includes(r));
  const hasWarning = triggered.some(r => !rejectRules.includes(r));

  return {
    status: hasReject ? 'rejected' : hasWarning ? 'warning' : 'accepted',
    rule_violated: triggered[0] ?? 'none',
    details: { rules_checked, triggered },
  };
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export const qcLeveyJenningsRouter = router({

  // 1. CREATE LOT
  createLot: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      lot_number: z.string().min(1),
      manufacturer: z.string().optional(),
      material_name: z.string().min(1),
      level: z.string().min(1),
      analyte: z.string().min(1),
      analyzer: z.string().optional(),
      department: z.string().optional(),
      unit: z.string().optional(),
      target_mean: z.number(),
      target_sd: z.number().positive(),
      target_cv: z.number().optional(),
      expiry_date: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [lot] = await db.insert(qcLots).values({
        hospital_id: input.hospital_id,
        lot_number: input.lot_number,
        manufacturer: input.manufacturer ?? null,
        material_name: input.material_name,
        level: input.level,
        analyte: input.analyte,
        analyzer: input.analyzer ?? null,
        department: input.department ?? null,
        unit: input.unit ?? null,
        target_mean: input.target_mean,
        target_sd: input.target_sd,
        target_cv: input.target_cv ?? null,
        expiry_date: new Date(input.expiry_date),
        status: 'active',
        created_by: ctx.user.sub,
      }).returning();

      return lot;
    }),

  // 2. LIST LOTS
  listLots: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['active', 'expired', 'depleted']).optional(),
      analyte: z.string().optional(),
      department: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(qcLots.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(qcLots.status, input.status));
      if (input.analyte) conditions.push(eq(qcLots.analyte, input.analyte));
      if (input.department) conditions.push(eq(qcLots.department, input.department));

      const lots = await db.select()
        .from(qcLots)
        .where(and(...conditions))
        .orderBy(desc(qcLots.created_at))
        .limit(input.limit);

      return lots;
    }),

  // 3. UPDATE LOT
  updateLot: protectedProcedure
    .input(z.object({
      lot_id: z.string().uuid(),
      status: z.enum(['active', 'expired', 'depleted']).optional(),
      peer_mean: z.number().optional(),
      peer_sd: z.number().positive().optional(),
      opened_date: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (input.status) updates.status = input.status;
      if (input.peer_mean !== undefined) updates.peer_mean = input.peer_mean;
      if (input.peer_sd !== undefined) updates.peer_sd = input.peer_sd;
      if (input.opened_date) updates.opened_date = new Date(input.opened_date);

      const [updated] = await db.update(qcLots)
        .set(updates)
        .where(eq(qcLots.id, input.lot_id))
        .returning();

      return updated;
    }),

  // 4. RECORD RUN — with auto Westgard evaluation
  recordRun: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      lot_id: z.string().uuid(),
      measured_value: z.number(),
      shift: z.string().optional(),
      temperature: z.number().optional(),
      reagent_lot: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Fetch lot for mean/SD
      const [lot] = await db.select()
        .from(qcLots)
        .where(eq(qcLots.id, input.lot_id))
        .limit(1);

      if (!lot) throw new TRPCError({ code: 'NOT_FOUND', message: 'QC lot not found' });
      if (lot.status !== 'active') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lot is not active' });

      // Use peer values if available, else manufacturer target
      const mean = lot.peer_mean ?? lot.target_mean;
      const sd = lot.peer_sd ?? lot.target_sd;

      // Fetch recent runs for multi-rule evaluation
      const recentRuns = await db.select({ measured_value: qcRuns.measured_value })
        .from(qcRuns)
        .where(eq(qcRuns.lot_id, input.lot_id))
        .orderBy(desc(qcRuns.run_datetime))
        .limit(10);

      const recentValues = recentRuns.map(r => r.measured_value);
      const westgard = evaluateWestgard(input.measured_value, mean, sd, recentValues);

      const zScore = (input.measured_value - mean) / sd;

      const [run] = await db.insert(qcRuns).values({
        hospital_id: input.hospital_id,
        lot_id: input.lot_id,
        measured_value: input.measured_value,
        z_score: zScore,
        sd_index: Math.abs(zScore),
        status: westgard.status,
        rule_violated: westgard.rule_violated as typeof qcRuns.$inferInsert.rule_violated,
        westgard_details: westgard.details,
        action_taken: null,
        operator: ctx.user.sub,
        shift: input.shift ?? null,
        temperature: input.temperature ?? null,
        reagent_lot: input.reagent_lot ?? null,
      }).returning();

      return { run, westgard };
    }),

  // 5. REVIEW RUN
  reviewRun: protectedProcedure
    .input(z.object({
      run_id: z.string().uuid(),
      action_taken: z.enum(['accept', 'reject', 'repeat', 'recalibrate', 'new_lot', 'maintenance']),
      action_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(qcRuns)
        .set({
          action_taken: input.action_taken,
          action_notes: input.action_notes ?? null,
          reviewed_by: ctx.user.sub,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(qcRuns.id, input.run_id))
        .returning();

      return updated;
    }),

  // 6. LIST RUNS
  listRuns: protectedProcedure
    .input(z.object({
      lot_id: z.string().uuid(),
      status: z.enum(['accepted', 'rejected', 'warning', 'pending_review']).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(qcRuns.lot_id, input.lot_id)];
      if (input.status) conditions.push(eq(qcRuns.status, input.status));
      if (input.from) conditions.push(gte(qcRuns.run_datetime, new Date(input.from)));
      if (input.to) conditions.push(lte(qcRuns.run_datetime, new Date(input.to)));

      const runs = await db.select()
        .from(qcRuns)
        .where(and(...conditions))
        .orderBy(asc(qcRuns.run_datetime))
        .limit(input.limit);

      return runs;
    }),

  // 7. LJ CHART DATA — runs + control lines for rendering
  ljChartData: protectedProcedure
    .input(z.object({
      lot_id: z.string().uuid(),
      days: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const [lot] = await db.select()
        .from(qcLots)
        .where(eq(qcLots.id, input.lot_id))
        .limit(1);

      if (!lot) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lot not found' });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const runs = await db.select()
        .from(qcRuns)
        .where(and(
          eq(qcRuns.lot_id, input.lot_id),
          gte(qcRuns.run_datetime, since),
        ))
        .orderBy(asc(qcRuns.run_datetime))
        .limit(500);

      const mean = lot.peer_mean ?? lot.target_mean;
      const sd = lot.peer_sd ?? lot.target_sd;

      return {
        lot: { id: lot.id, analyte: lot.analyte, level: lot.level, unit: lot.unit, analyzer: lot.analyzer },
        control_lines: {
          mean,
          plus_1sd: mean + sd,
          plus_2sd: mean + 2 * sd,
          plus_3sd: mean + 3 * sd,
          minus_1sd: mean - sd,
          minus_2sd: mean - 2 * sd,
          minus_3sd: mean - 3 * sd,
        },
        runs: runs.map(r => ({
          id: r.id,
          value: r.measured_value,
          z_score: r.z_score,
          status: r.status,
          rule_violated: r.rule_violated,
          datetime: r.run_datetime,
          operator: r.operator,
          action_taken: r.action_taken,
        })),
      };
    }),

  // 8. COMPUTE METRICS — recalculate period stats + sigma
  computeMetrics: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      lot_id: z.string().uuid(),
      period_start: z.string(),
      period_end: z.string(),
      total_allowable_error: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const runs = await db.select()
        .from(qcRuns)
        .where(and(
          eq(qcRuns.lot_id, input.lot_id),
          gte(qcRuns.run_datetime, new Date(input.period_start)),
          lte(qcRuns.run_datetime, new Date(input.period_end)),
        ))
        .orderBy(asc(qcRuns.run_datetime));

      if (runs.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No runs in period' });

      const values = runs.map(r => r.measured_value);
      const n = values.length;
      const calcMean = values.reduce((a, b) => a + b, 0) / n;
      const calcSD = Math.sqrt(values.reduce((s, v) => s + (v - calcMean) ** 2, 0) / (n - 1));
      const calcCV = (calcSD / calcMean) * 100;

      // Fetch lot for bias calculation
      const [lot] = await db.select().from(qcLots).where(eq(qcLots.id, input.lot_id)).limit(1);
      const targetMean = lot?.target_mean ?? calcMean;
      const bias = Math.abs(calcMean - targetMean);
      const biasPercent = (bias / targetMean) * 100;

      // Sigma metric: (TEa - |bias%|) / CV
      const TEa = input.total_allowable_error;
      const sigma = TEa && calcCV > 0 ? (TEa - biasPercent) / calcCV : null;

      const violations = runs.filter(r => r.rule_violated !== 'none').length;
      const rejections = runs.filter(r => r.status === 'rejected').length;
      const warnings = runs.filter(r => r.status === 'warning').length;

      const [metric] = await db.insert(leveyJenningsMetrics).values({
        hospital_id: input.hospital_id,
        lot_id: input.lot_id,
        period_start: new Date(input.period_start),
        period_end: new Date(input.period_end),
        run_count: n,
        calculated_mean: calcMean,
        calculated_sd: calcSD,
        calculated_cv: calcCV,
        min_value: Math.min(...values),
        max_value: Math.max(...values),
        total_violations: violations,
        rejection_count: rejections,
        warning_count: warnings,
        sigma_metric: sigma,
        total_allowable_error: TEa ?? null,
      }).returning();

      return metric;
    }),

  // 9. LIST METRICS
  listMetrics: protectedProcedure
    .input(z.object({
      lot_id: z.string().uuid(),
      limit: z.number().min(1).max(50).default(12),
    }))
    .query(async ({ input }) => {
      const metrics = await db.select()
        .from(leveyJenningsMetrics)
        .where(eq(leveyJenningsMetrics.lot_id, input.lot_id))
        .orderBy(desc(leveyJenningsMetrics.period_start))
        .limit(input.limit);

      return metrics;
    }),

  // 10. STATS — QC dashboard summary
  stats: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const [activeLots] = await db.select({ total: count() })
        .from(qcLots)
        .where(and(eq(qcLots.hospital_id, input.hospital_id), eq(qcLots.status, 'active')));

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [runsToday] = await db.select({ total: count() })
        .from(qcRuns)
        .where(and(eq(qcRuns.hospital_id, input.hospital_id), gte(qcRuns.run_datetime, today)));

      const [pendingReview] = await db.select({ total: count() })
        .from(qcRuns)
        .where(and(eq(qcRuns.hospital_id, input.hospital_id), eq(qcRuns.status, 'pending_review')));

      const [rejected] = await db.select({ total: count() })
        .from(qcRuns)
        .where(and(
          eq(qcRuns.hospital_id, input.hospital_id),
          eq(qcRuns.status, 'rejected'),
          gte(qcRuns.run_datetime, today),
        ));

      const [warnings] = await db.select({ total: count() })
        .from(qcRuns)
        .where(and(
          eq(qcRuns.hospital_id, input.hospital_id),
          eq(qcRuns.status, 'warning'),
          gte(qcRuns.run_datetime, today),
        ));

      return {
        active_lots: activeLots?.total ?? 0,
        runs_today: runsToday?.total ?? 0,
        pending_review: pendingReview?.total ?? 0,
        rejected_today: rejected?.total ?? 0,
        warnings_today: warnings?.total ?? 0,
      };
    }),
});
