import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  qcLotMaster,
  qcEnhancedRuns,
  westgardConfig,
  eqasResults,
  labPanelComponents,
  labPanels,
  users,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import {
  eq,
  and,
  or,
  sql,
  desc,
  asc,
  count,
  like,
  gte,
  lte,
  inArray,
} from 'drizzle-orm';

// ============================================================
// Validation Schemas
// ============================================================

const lotCreateSchema = z.object({
  lot_number: z.string().min(1),
  material_name: z.string().min(1),
  manufacturer: z.string().optional(),
  level: z.enum(['level_1', 'level_2', 'level_3']),
  component_id: z.string().uuid(),
  target_mean: z.string().transform((v) => parseFloat(v)),
  target_sd: z.string().transform((v) => parseFloat(v)),
  unit: z.string().optional(),
  received_date: z.string().datetime().optional(),
  expiry_date: z.string().datetime().optional(),
  opened_date: z.string().datetime().optional(),
});

const lotUpdateSchema = lotCreateSchema.partial().extend({
  id: z.string().uuid(),
});

const runRecordSchema = z.object({
  lot_id: z.string().uuid(),
  measured_value: z.string().transform((v) => parseFloat(v)),
  instrument: z.string().optional(),
  notes: z.string().optional(),
});

const runSignOffSchema = z.object({
  run_id: z.string().uuid(),
});

const westgardRuleUpdateSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean().optional(),
  block_patient_results: z.boolean().optional(),
});

const eqasRecordSchema = z.object({
  scheme_name: z.string().min(1),
  cycle_name: z.string().optional(),
  component_id: z.string().uuid().optional(),
  sample_id: z.string().optional(),
  reported_value: z.string().transform((v) => parseFloat(v)),
  expected_value: z.string().transform((v) => parseFloat(v)),
  peer_group_mean: z.string().transform((v) => parseFloat(v)),
  peer_group_sd: z.string().transform((v) => parseFloat(v)),
  peer_group_cv: z.string().transform((v) => parseFloat(v)),
  reported_date: z.string().datetime().optional(),
  notes: z.string().optional(),
});

// ============================================================
// QC Enhancement Router
// ============================================================

export const qcEnhancementRouter = router({
  // ===== QC LOTS =====

  listLots: protectedProcedure
    .input(
      z.object({
        component_id: z.string().optional(),
        level: z.string().optional(),
        is_active: z.boolean().optional(),
        search: z.string().optional(),
        pageSize: z.number().int().default(50),
        pageOffset: z.number().int().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters: any[] = [eq(qcLotMaster.hospital_id, ctx.user.hospital_id)];

      if (input.component_id) {
        filters.push(eq(qcLotMaster.component_id, input.component_id as any));
      }
      if (input.level) {
        filters.push(eq(qcLotMaster.level, input.level as any));
      }
      if (input.is_active !== undefined) {
        filters.push(eq(qcLotMaster.is_active, input.is_active));
      }
      if (input.search) {
        filters.push(
          or(
            like(qcLotMaster.lot_number, `%${input.search}%`),
            like(qcLotMaster.material_name, `%${input.search}%`)
          )!
        );
      }

      const lots = await db
        .select({
          id: qcLotMaster.id,
          lot_number: qcLotMaster.lot_number,
          material_name: qcLotMaster.material_name,
          manufacturer: qcLotMaster.manufacturer,
          level: qcLotMaster.level,
          component_id: qcLotMaster.component_id,
          component_name: labPanelComponents.test_name,
          target_mean: qcLotMaster.target_mean,
          target_sd: qcLotMaster.target_sd,
          unit: qcLotMaster.unit,
          received_date: qcLotMaster.received_date,
          expiry_date: qcLotMaster.expiry_date,
          opened_date: qcLotMaster.opened_date,
          is_expired: qcLotMaster.is_expired,
          is_active: qcLotMaster.is_active,
          created_by: qcLotMaster.created_by,
          created_at: qcLotMaster.created_at,
        })
        .from(qcLotMaster)
        .leftJoin(
          labPanelComponents,
          eq(qcLotMaster.component_id, labPanelComponents.id)
        )
        .where(and(...filters))
        .orderBy(desc(qcLotMaster.created_at))
        .limit(input.pageSize)
        .offset(input.pageOffset);

      return { items: lots };
    }),

  createLot: adminProcedure
    .input(lotCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(qcLotMaster).values({
        id,
        hospital_id: ctx.user.hospital_id,
        lot_number: input.lot_number,
        material_name: input.material_name,
        manufacturer: input.manufacturer,
        level: input.level,
        component_id: input.component_id as any,
        target_mean: String(input.target_mean),
        target_sd: String(input.target_sd),
        unit: input.unit,
        received_date: input.received_date
          ? new Date(input.received_date)
          : undefined,
        expiry_date: input.expiry_date ? new Date(input.expiry_date) : undefined,
        opened_date: input.opened_date ? new Date(input.opened_date) : undefined,
        is_expired: false,
        is_active: true,
        created_by: ctx.user.sub as any,
        created_at: now,
        updated_at: now,
      } as any);

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'qc_lot_master',
        row_id: id,
        new_values: input,
      });

      return { id };
    }),

  updateLot: adminProcedure
    .input(lotUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const now = new Date();

      const updateData: any = {
        updated_at: now,
      };
      if (data.lot_number) updateData.lot_number = data.lot_number;
      if (data.material_name) updateData.material_name = data.material_name;
      if (data.manufacturer !== undefined)
        updateData.manufacturer = data.manufacturer;
      if (data.level) updateData.level = data.level;
      if (data.component_id) updateData.component_id = data.component_id;
      if (data.target_mean !== undefined)
        updateData.target_mean = String(data.target_mean);
      if (data.target_sd !== undefined)
        updateData.target_sd = String(data.target_sd);
      if (data.unit !== undefined) updateData.unit = data.unit;
      if (data.received_date !== undefined)
        updateData.received_date = data.received_date
          ? new Date(data.received_date)
          : null;
      if (data.expiry_date !== undefined)
        updateData.expiry_date = data.expiry_date
          ? new Date(data.expiry_date)
          : null;
      if (data.opened_date !== undefined)
        updateData.opened_date = data.opened_date
          ? new Date(data.opened_date)
          : null;

      await db
        .update(qcLotMaster)
        .set(updateData)
        .where(
          and(
            eq(qcLotMaster.id, id as any),
            eq(qcLotMaster.hospital_id, ctx.user.hospital_id)
          )
        );

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'qc_lot_master',
        row_id: id,
        new_values: updateData,
      });

      return { success: true };
    }),

  toggleLotActive: adminProcedure
    .input(z.object({ id: z.string().uuid(), is_active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      await db
        .update(qcLotMaster)
        .set({ is_active: input.is_active, updated_at: now })
        .where(
          and(
            eq(qcLotMaster.id, input.id as any),
            eq(qcLotMaster.hospital_id, ctx.user.hospital_id)
          )
        );

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'qc_lot_master',
        row_id: input.id,
        new_values: { is_active: input.is_active },
      });

      return { success: true };
    }),

  // ===== QC RUNS =====

  listRuns: protectedProcedure
    .input(
      z.object({
        lot_id: z.string().optional(),
        component_id: z.string().optional(),
        date_from: z.string().datetime().optional(),
        date_to: z.string().datetime().optional(),
        pageSize: z.number().int().default(50),
        pageOffset: z.number().int().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters: any[] = [eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id)];

      if (input.lot_id) {
        filters.push(eq(qcEnhancedRuns.lot_id, input.lot_id as any));
      }
      if (input.component_id) {
        filters.push(eq(qcEnhancedRuns.component_id, input.component_id as any));
      }
      if (input.date_from) {
        filters.push(gte(qcEnhancedRuns.run_date, new Date(input.date_from)));
      }
      if (input.date_to) {
        filters.push(lte(qcEnhancedRuns.run_date, new Date(input.date_to)));
      }

      const runs = await db
        .select({
          id: qcEnhancedRuns.id,
          run_date: qcEnhancedRuns.run_date,
          measured_value: qcEnhancedRuns.measured_value,
          z_score: qcEnhancedRuns.z_score,
          result_status: qcEnhancedRuns.result_status,
          westgard_violations: qcEnhancedRuns.westgard_violations,
          tech_id: qcEnhancedRuns.tech_id,
          tech_name: users.full_name,
          tech_sign_off: qcEnhancedRuns.tech_sign_off,
          sign_off_at: qcEnhancedRuns.sign_off_at,
          instrument: qcEnhancedRuns.instrument,
          notes: qcEnhancedRuns.notes,
          lot_number: qcLotMaster.lot_number,
          material_name: qcLotMaster.material_name,
          target_mean: qcLotMaster.target_mean,
          target_sd: qcLotMaster.target_sd,
        })
        .from(qcEnhancedRuns)
        .leftJoin(qcLotMaster, eq(qcEnhancedRuns.lot_id, qcLotMaster.id))
        .leftJoin(users, eq(qcEnhancedRuns.tech_id, users.id))
        .where(and(...filters))
        .orderBy(desc(qcEnhancedRuns.run_date))
        .limit(input.pageSize)
        .offset(input.pageOffset);

      return { items: runs };
    }),

  recordRun: adminProcedure
    .input(runRecordSchema)
    .mutation(async ({ ctx, input }) => {
      // Get lot details
      const lot = await db.query.qcLotMaster.findFirst({
        where: and(
          eq(qcLotMaster.id, input.lot_id as any),
          eq(qcLotMaster.hospital_id, ctx.user.hospital_id)
        ),
      });

      if (!lot) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'QC lot not found',
        });
      }

      const targetMean = parseFloat(lot.target_mean);
      const targetSd = parseFloat(lot.target_sd);
      const zScore =
        targetSd === 0 ? 0 : (input.measured_value - targetMean) / targetSd;

      // Evaluate Westgard rules
      const westgardViolations = await evaluateWestgardRules(
        ctx.user.hospital_id,
        lot.component_id!,
        input.lot_id,
        zScore
      );

      // Determine result status
      let resultStatus = 'pass';
      if (westgardViolations.some((v: any) => v.is_reject)) {
        resultStatus = 'fail';
      } else if (westgardViolations.some((v: any) => v.is_warning)) {
        resultStatus = 'warning';
      }

      const runId = crypto.randomUUID();
      const now = new Date();

      await db.insert(qcEnhancedRuns).values({
        id: runId,
        hospital_id: ctx.user.hospital_id,
        lot_id: input.lot_id as any,
        component_id: lot.component_id as any,
        run_date: now,
        measured_value: String(input.measured_value),
        z_score: String(zScore.toFixed(4)),
        result_status: resultStatus,
        westgard_violations:
          westgardViolations.length > 0 ? westgardViolations : null,
        tech_id: ctx.user.sub as any,
        tech_sign_off: false,
        instrument: input.instrument,
        notes: input.notes,
        is_active: true,
        created_at: now,
      } as any);

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'qc_runs',
        row_id: runId,
        new_values: {
          measured_value: input.measured_value,
          z_score: zScore.toFixed(4),
          result_status: resultStatus,
        },
      });

      return {
        run: {
          id: runId,
          measured_value: input.measured_value,
          z_score: zScore.toFixed(4),
          result_status: resultStatus,
        },
        westgard_violations: westgardViolations,
        result_status: resultStatus,
      };
    }),

  signOffRun: adminProcedure
    .input(runSignOffSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      await db
        .update(qcEnhancedRuns)
        .set({
          tech_sign_off: true,
          sign_off_at: now,
        })
        .where(
          and(
            eq(qcEnhancedRuns.id, input.run_id as any),
            eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id)
          )
        );

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'qc_runs',
        row_id: input.run_id,
        new_values: { tech_sign_off: true },
      });

      return { success: true };
    }),

  runSheet: protectedProcedure
    .input(z.object({ date: z.string().datetime() }))
    .query(async ({ ctx, input }) => {
      const targetDate = new Date(input.date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const runs = await db
        .select({
          id: qcEnhancedRuns.id,
          component_id: qcEnhancedRuns.component_id,
          component_name: labPanelComponents.test_name,
          lot_number: qcLotMaster.lot_number,
          material_name: qcLotMaster.material_name,
          level: qcLotMaster.level,
          measured_value: qcEnhancedRuns.measured_value,
          target_mean: qcLotMaster.target_mean,
          target_sd: qcLotMaster.target_sd,
          z_score: qcEnhancedRuns.z_score,
          result_status: qcEnhancedRuns.result_status,
          westgard_violations: qcEnhancedRuns.westgard_violations,
          run_date: qcEnhancedRuns.run_date,
          tech_name: users.full_name,
          tech_sign_off: qcEnhancedRuns.tech_sign_off,
        })
        .from(qcEnhancedRuns)
        .leftJoin(qcLotMaster, eq(qcEnhancedRuns.lot_id, qcLotMaster.id))
        .leftJoin(
          labPanelComponents,
          eq(qcEnhancedRuns.component_id, labPanelComponents.id)
        )
        .leftJoin(users, eq(qcEnhancedRuns.tech_id, users.id))
        .where(
          and(
            eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id),
            gte(qcEnhancedRuns.run_date, startOfDay),
            lte(qcEnhancedRuns.run_date, endOfDay)
          )
        )
        .orderBy(asc(qcEnhancedRuns.component_id), desc(qcEnhancedRuns.run_date));

      // Group by component
      const grouped: Record<string, any[]> = {};
      runs.forEach((run) => {
        const key = `${run.component_id}-${run.component_name}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(run);
      });

      return { grouped };
    }),

  // ===== WESTGARD RULES =====

  getWestgardConfig: protectedProcedure.query(async ({ ctx }) => {
    const rules = await db.query.westgardConfig.findMany({
      where: eq(westgardConfig.hospital_id, ctx.user.hospital_id),
    });
    return { items: rules };
  }),

  updateWestgardRule: adminProcedure
    .input(westgardRuleUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const updateData: any = { updated_at: now };
      if (input.is_active !== undefined) updateData.is_active = input.is_active;
      if (input.block_patient_results !== undefined)
        updateData.block_patient_results = input.block_patient_results;

      await db
        .update(westgardConfig)
        .set(updateData)
        .where(
          and(
            eq(westgardConfig.id, input.id as any),
            eq(westgardConfig.hospital_id, ctx.user.hospital_id)
          )
        );

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'westgard_config',
        row_id: input.id,
        new_values: updateData,
      });

      return { success: true };
    }),

  // ===== EQAS =====

  listEqas: protectedProcedure
    .input(
      z.object({
        scheme_name: z.string().optional(),
        component_id: z.string().optional(),
        performance_rating: z.string().optional(),
        date_from: z.string().datetime().optional(),
        date_to: z.string().datetime().optional(),
        pageSize: z.number().int().default(50),
        pageOffset: z.number().int().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters: any[] = [eq(eqasResults.hospital_id, ctx.user.hospital_id)];

      if (input.scheme_name) {
        filters.push(like(eqasResults.scheme_name, `%${input.scheme_name}%`));
      }
      if (input.component_id) {
        filters.push(eq(eqasResults.component_id, input.component_id as any));
      }
      if (input.performance_rating) {
        filters.push(
          eq(eqasResults.performance_rating, input.performance_rating as any)
        );
      }
      if (input.date_from) {
        filters.push(gte(eqasResults.reported_date, new Date(input.date_from)));
      }
      if (input.date_to) {
        filters.push(lte(eqasResults.reported_date, new Date(input.date_to)));
      }

      const results = await db
        .select({
          id: eqasResults.id,
          scheme_name: eqasResults.scheme_name,
          cycle_name: eqasResults.cycle_name,
          sample_id: eqasResults.sample_id,
          component_name: labPanelComponents.test_name,
          reported_value: eqasResults.reported_value,
          expected_value: eqasResults.expected_value,
          sdi: eqasResults.sdi,
          performance_rating: eqasResults.performance_rating,
          peer_group_mean: eqasResults.peer_group_mean,
          peer_group_sd: eqasResults.peer_group_sd,
          peer_group_cv: eqasResults.peer_group_cv,
          reported_date: eqasResults.reported_date,
          notes: eqasResults.notes,
        })
        .from(eqasResults)
        .leftJoin(
          labPanelComponents,
          eq(eqasResults.component_id, labPanelComponents.id)
        )
        .where(and(...filters))
        .orderBy(desc(eqasResults.reported_date))
        .limit(input.pageSize)
        .offset(input.pageOffset);

      return { items: results };
    }),

  recordEqas: adminProcedure
    .input(eqasRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const sdi =
        input.peer_group_sd === 0
          ? 0
          : (input.reported_value - input.peer_group_mean) / input.peer_group_sd;

      let performanceRating = 'acceptable';
      const absSdi = Math.abs(sdi);
      if (absSdi > 2) {
        performanceRating = 'unacceptable';
      } else if (absSdi > 1) {
        performanceRating = 'warning';
      }

      const resultId = crypto.randomUUID();
      const now = new Date();

      await db.insert(eqasResults).values({
        id: resultId,
        hospital_id: ctx.user.hospital_id,
        scheme_name: input.scheme_name,
        cycle_name: input.cycle_name,
        component_id: input.component_id as any,
        sample_id: input.sample_id,
        reported_value: String(input.reported_value),
        expected_value: String(input.expected_value),
        sdi: String(sdi.toFixed(4)),
        performance_rating: performanceRating,
        peer_group_mean: String(input.peer_group_mean),
        peer_group_sd: String(input.peer_group_sd),
        peer_group_cv: String(input.peer_group_cv),
        reported_date: input.reported_date
          ? new Date(input.reported_date)
          : now,
        reported_by: ctx.user.sub as any,
        notes: input.notes,
        is_active: true,
        created_at: now,
      } as any);

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'eqas_results',
        row_id: resultId,
        new_values: {
          scheme_name: input.scheme_name,
          sdi: sdi.toFixed(4),
          performance_rating: performanceRating,
        },
      });

      return {
        id: resultId,
        sdi: sdi.toFixed(4),
        performance_rating: performanceRating,
      };
    }),

  // ===== STATS =====

  stats: protectedProcedure.query(async ({ ctx }) => {
    const activeLots = await db
      .select({ count: count() })
      .from(qcLotMaster)
      .where(
        and(
          eq(qcLotMaster.hospital_id, ctx.user.hospital_id),
          eq(qcLotMaster.is_active, true)
        )
      );

    const thisMonth = new Date();
    thisMonth.setDate(1);

    const runsThisMonth = await db
      .select({ count: count() })
      .from(qcEnhancedRuns)
      .where(
        and(
          eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id),
          gte(qcEnhancedRuns.run_date, thisMonth)
        )
      );

    const runsByStatus = await db
      .select({
        status: qcEnhancedRuns.result_status,
        cnt: count(),
      })
      .from(qcEnhancedRuns)
      .where(eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id))
      .groupBy(qcEnhancedRuns.result_status);

    const eqasByPerformance = await db
      .select({
        rating: eqasResults.performance_rating,
        cnt: count(),
      })
      .from(eqasResults)
      .where(eq(eqasResults.hospital_id, ctx.user.hospital_id))
      .groupBy(eqasResults.performance_rating);

    return {
      active_lots_count: activeLots[0]?.count || 0,
      runs_this_month: runsThisMonth[0]?.count || 0,
      runs_by_status: runsByStatus,
      eqas_by_performance: eqasByPerformance,
    };
  }),
});

// ============================================================
// Helper Functions
// ============================================================

async function evaluateWestgardRules(
  hospitalId: string,
  componentId: string,
  lotId: string,
  latestZScore: number
): Promise<any[]> {
  // Get active Westgard rules for hospital
  const rules = await db.query.westgardConfig.findMany({
    where: and(
      eq(westgardConfig.hospital_id, hospitalId),
      eq(westgardConfig.is_active, true)
    ),
  });

  // Get recent QC runs for this lot (last 20)
  const recentRuns = await db
    .select({ z_score: qcEnhancedRuns.z_score, run_date: qcEnhancedRuns.run_date })
    .from(qcEnhancedRuns)
    .where(
      and(
        eq(qcEnhancedRuns.hospital_id, hospitalId),
        eq(qcEnhancedRuns.lot_id, lotId as any)
      )
    )
    .orderBy(desc(qcEnhancedRuns.run_date))
    .limit(20);

  const zScores = [latestZScore, ...recentRuns.map((r) => parseFloat(r.z_score || '0'))];

  const violations: any[] = [];

  for (const rule of rules) {
    let violated = false;
    let isWarning = rule.is_warning;
    let isReject = rule.is_reject;

    if (rule.rule_code === '1_2s') {
      // Latest value > ±2SD
      violated = Math.abs(latestZScore) > 2;
    } else if (rule.rule_code === '1_3s') {
      // Latest value > ±3SD
      violated = Math.abs(latestZScore) > 3;
    } else if (rule.rule_code === '2_2s') {
      // 2 consecutive values > ±2SD in same direction
      if (zScores.length >= 2) {
        const latest = zScores[0];
        const prev = zScores[1];
        violated =
          Math.abs(latest) > 2 &&
          Math.abs(prev) > 2 &&
          (latest > 0) === (prev > 0);
      }
    } else if (rule.rule_code === 'R_4s') {
      // Range between 2 consecutive values > 4SD
      if (zScores.length >= 2) {
        const range = Math.abs(zScores[0] - zScores[1]);
        violated = range > 4;
      }
    } else if (rule.rule_code === '4_1s') {
      // 4 consecutive values > ±1SD in same direction
      if (zScores.length >= 4) {
        const sign =
          zScores[0] > 1
            ? 1
            : zScores[0] < -1
              ? -1
              : 0;
        if (sign !== 0) {
          violated = zScores
            .slice(0, 4)
            .every((z) => (sign > 0 ? z > 1 : z < -1));
        }
      }
    } else if (rule.rule_code === '10x') {
      // 10 consecutive values on same side of mean
      if (zScores.length >= 10) {
        const allPositive = zScores.slice(0, 10).every((z) => z > 0);
        const allNegative = zScores.slice(0, 10).every((z) => z < 0);
        violated = allPositive || allNegative;
      }
    }

    if (violated) {
      violations.push({
        rule_code: rule.rule_code,
        rule_name: rule.rule_name,
        violated: true,
        is_warning: isWarning,
        is_reject: isReject,
        block_patient_results: rule.block_patient_results,
      });
    }
  }

  return violations;
}
