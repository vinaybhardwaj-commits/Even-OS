import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  labOrders,
  labResults,
  labPanels,
  labPanelComponents,
  externalLabOrders,
  externalLabs,
  qcEnhancedRuns,
  qcLotMaster,
} from '@db/schema';
import { users, patients, encounters } from '@db/schema';
import {
  eq,
  and,
  or,
  sql,
  desc,
  asc,
  count,
  gte,
  lte,
  ne,
  avg,
  sum,
  max,
  min,
} from 'drizzle-orm';

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

const dateRangeSchema = z.object({
  date_from: z.string(),
  date_to: z.string(),
});

const dateRangeDepartmentSchema = dateRangeSchema.extend({
  department: z.string().optional(),
});

const componentLotSchema = z.object({
  component_id: z.string(),
  lot_id: z.string(),
});

// ============================================================
// ROUTER
// ============================================================

export const labAnalyticsRouter = router({
  // TAT Analysis by department and test
  tatAnalysis: adminProcedure
    .input(dateRangeDepartmentSchema)
    .query(async ({ ctx, input }) => {
      const { date_from, date_to, department } = input;
      const dateFromObj = new Date(date_from);
      const dateToObj = new Date(date_to);

      try {
        const rows = await db
          .select({
            panel_name: labOrders.panel_name,
            panel_id: labOrders.panel_id,
            order_count: count(labOrders.id),
            promised_tat_minutes: labPanels.tat_minutes,
            avg_tat_minutes: avg(
              sql<number>`EXTRACT(EPOCH FROM (${labOrders.verified_at} - ${labOrders.ordered_at})) / 60`
            ),
            within_promised: count(
              sql`CASE WHEN EXTRACT(EPOCH FROM (${labOrders.verified_at} - ${labOrders.ordered_at})) / 60 <= ${labPanels.tat_minutes} THEN 1 END`
            ),
            breach_count: count(
              sql`CASE WHEN EXTRACT(EPOCH FROM (${labOrders.verified_at} - ${labOrders.ordered_at})) / 60 > ${labPanels.tat_minutes} THEN 1 END`
            ),
          })
          .from(labOrders)
          .leftJoin(labPanels, eq(labOrders.panel_id, labPanels.id))
          .where(
            and(
              eq(labOrders.hospital_id, ctx.user.hospital_id),
              gte(labOrders.ordered_at, dateFromObj),
              lte(labOrders.ordered_at, dateToObj),
              eq(labOrders.status, 'verified' as any),
              department ? eq(labPanels.department, department) : undefined
            )
          )
          .groupBy(labOrders.panel_name, labOrders.panel_id, labPanels.tat_minutes);

        return rows.map((r) => ({
          panel_name: r.panel_name || 'Unknown',
          order_count: r.order_count || 0,
          promised_tat_minutes: r.promised_tat_minutes || 0,
          avg_tat_minutes: r.avg_tat_minutes ? Math.round(Number(r.avg_tat_minutes)) : 0,
          within_promised: r.within_promised || 0,
          breach_count: r.breach_count || 0,
          compliance_pct: r.order_count
            ? Math.round(((r.within_promised || 0) / r.order_count) * 100)
            : 0,
        }));
      } catch (err) {
        console.error('TAT Analysis error:', err);
        return [];
      }
    }),

  // Specimen rejections by reason
  specimenRejections: adminProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const { date_from, date_to } = input;
      const dateFromObj = new Date(date_from);
      const dateToObj = new Date(date_to);

      try {
        const rows = await db
          .select({
            status: labOrders.status,
            order_date: sql<string>`DATE(${labOrders.ordered_at})`,
            rejection_count: count(labOrders.id),
          })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, ctx.user.hospital_id),
              gte(labOrders.ordered_at, dateFromObj),
              lte(labOrders.ordered_at, dateToObj),
              eq(labOrders.status, 'cancelled' as any)
            )
          )
          .groupBy(labOrders.status, sql<string>`DATE(${labOrders.ordered_at})`)
          .orderBy(desc(sql<string>`DATE(${labOrders.ordered_at})`));

        return rows.map((r) => ({
          date: r.order_date || '',
          rejection_count: r.rejection_count || 0,
          reason: r.status || 'cancelled',
        }));
      } catch (err) {
        console.error('Specimen Rejections error:', err);
        return [];
      }
    }),

  // External Lab Scorecard
  externalLabScorecard: adminProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const { date_from, date_to } = input;
      const dateFromObj = new Date(date_from);
      const dateToObj = new Date(date_to);

      try {
        const rows = await db
          .select({
            lab_name: externalLabs.lab_name,
            lab_id: externalLabs.id,
            order_count: count(externalLabOrders.id),
            tat_compliant: count(
              sql`CASE WHEN ${externalLabOrders.tat_breach} = false THEN 1 END`
            ),
            breach_count: count(
              sql`CASE WHEN ${externalLabOrders.tat_breach} = true THEN 1 END`
            ),
            avg_tat_hours: avg(externalLabOrders.tat_actual_hours),
            total_cost: sum(externalLabOrders.cost_amount),
            total_billing: sum(externalLabOrders.billing_amount),
          })
          .from(externalLabOrders)
          .leftJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
          .where(
            and(
              eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
              gte(externalLabOrders.created_at, dateFromObj),
              lte(externalLabOrders.created_at, dateToObj),
              ne(externalLabOrders.status, 'cancelled' as any)
            )
          )
          .groupBy(externalLabs.lab_name, externalLabs.id);

        return rows.map((r) => {
          const orderCount = r.order_count || 0;
          const tatCompliant = r.tat_compliant || 0;
          const cost = r.total_cost ? Number(r.total_cost) : 0;
          const billing = r.total_billing ? Number(r.total_billing) : 0;
          const margin = billing - cost;

          return {
            lab_name: r.lab_name || 'Unknown',
            order_count: orderCount,
            tat_compliance_pct: orderCount ? Math.round((tatCompliant / orderCount) * 100) : 0,
            breach_count: r.breach_count || 0,
            avg_tat_hours: r.avg_tat_hours ? Number(r.avg_tat_hours) : 0,
            total_cost: cost,
            total_billing: billing,
            margin_amount: margin,
            margin_pct: billing > 0 ? Math.round((margin / billing) * 100) : 0,
          };
        });
      } catch (err) {
        console.error('External Lab Scorecard error:', err);
        return [];
      }
    }),

  // QC Trending (Levey-Jennings)
  qcTrending: adminProcedure
    .input(componentLotSchema)
    .query(async ({ ctx, input }) => {
      const { component_id, lot_id } = input;

      try {
        const lotData = await db
          .select({
            target_mean: qcLotMaster.target_mean,
            target_sd: qcLotMaster.target_sd,
          })
          .from(qcLotMaster)
          .where(
            and(
              eq(qcLotMaster.id, lot_id),
              eq(qcLotMaster.hospital_id, ctx.user.hospital_id)
            )
          )
          .limit(1);

        const targetMean = lotData[0]?.target_mean
          ? Number(lotData[0].target_mean)
          : 0;
        const targetSd = lotData[0]?.target_sd ? Number(lotData[0].target_sd) : 1;

        const runs = await db
          .select({
            run_date: qcEnhancedRuns.run_date,
            measured_value: qcEnhancedRuns.measured_value,
            z_score: qcEnhancedRuns.z_score,
            result_status: qcEnhancedRuns.result_status,
            westgard_violations: qcEnhancedRuns.westgard_violations,
            tech_id: qcEnhancedRuns.tech_id,
            tech_name: users.full_name,
          })
          .from(qcEnhancedRuns)
          .leftJoin(users, eq(qcEnhancedRuns.tech_id, users.id))
          .where(
            and(
              eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id),
              eq(qcEnhancedRuns.lot_id, lot_id),
              eq(qcEnhancedRuns.component_id, component_id),
              eq(qcEnhancedRuns.is_active, true)
            )
          )
          .orderBy(desc(qcEnhancedRuns.run_date))
          .limit(30);

        const westgardViolationCounts = runs.reduce(
          (acc: any, r) => {
            if (r.westgard_violations && typeof r.westgard_violations === 'object') {
              const violations = r.westgard_violations as Record<string, any>;
              Object.keys(violations).forEach((rule) => {
                acc[rule] = (acc[rule] || 0) + 1;
              });
            }
            return acc;
          },
          {} as Record<string, number>
        );

        return {
          target_mean: targetMean,
          target_sd: targetSd,
          runs: runs.map((r) => ({
            run_date: r.run_date?.toISOString() || '',
            measured_value: r.measured_value ? Number(r.measured_value) : 0,
            z_score: r.z_score ? Number(r.z_score) : 0,
            result_status: r.result_status || 'pass',
            westgard_violations: r.westgard_violations || {},
            tech_name: r.tech_name || 'Unknown',
          })),
          westgard_violation_summary: westgardViolationCounts,
        };
      } catch (err) {
        console.error('QC Trending error:', err);
        return {
          target_mean: 0,
          target_sd: 1,
          runs: [],
          westgard_violation_summary: {},
        };
      }
    }),

  // Workload distribution by tech
  workloadDistribution: adminProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const { date_from, date_to } = input;
      const dateFromObj = new Date(date_from);
      const dateToObj = new Date(date_to);

      try {
        const rows = await db
          .select({
            ordered_by_id: labOrders.ordered_by,
            tech_name: users.full_name,
            order_date: sql<string>`DATE(${labOrders.ordered_at})`,
            order_count: count(labOrders.id),
          })
          .from(labOrders)
          .leftJoin(users, eq(labOrders.ordered_by, users.id))
          .where(
            and(
              eq(labOrders.hospital_id, ctx.user.hospital_id),
              gte(labOrders.ordered_at, dateFromObj),
              lte(labOrders.ordered_at, dateToObj)
            )
          )
          .groupBy(labOrders.ordered_by, users.full_name, sql<string>`DATE(${labOrders.ordered_at})`)
          .orderBy(desc(count(labOrders.id)));

        // Aggregate by tech
        const byTech: Record<string, { tech_name: string; total_orders: number; dates: string[] }> = {};
        rows.forEach((r) => {
          const techId = r.ordered_by_id || 'unknown';
          if (!byTech[techId]) {
            byTech[techId] = {
              tech_name: r.tech_name || 'Unknown',
              total_orders: 0,
              dates: [],
            };
          }
          byTech[techId].total_orders += r.order_count || 0;
          if (r.order_date && !byTech[techId].dates.includes(r.order_date)) {
            byTech[techId].dates.push(r.order_date);
          }
        });

        return Object.values(byTech).map((t) => ({
          tech_name: t.tech_name,
          total_orders: t.total_orders,
          unique_days: t.dates.length,
          avg_per_day: t.dates.length > 0 ? Math.round(t.total_orders / t.dates.length) : 0,
        }));
      } catch (err) {
        console.error('Workload Distribution error:', err);
        return [];
      }
    }),

  // Test volumes (top tests)
  testVolumes: adminProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const { date_from, date_to } = input;
      const dateFromObj = new Date(date_from);
      const dateToObj = new Date(date_to);

      try {
        const rows = await db
          .select({
            panel_name: labOrders.panel_name,
            order_count: count(labOrders.id),
          })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, ctx.user.hospital_id),
              gte(labOrders.ordered_at, dateFromObj),
              lte(labOrders.ordered_at, dateToObj),
              ne(labOrders.status, 'cancelled' as any)
            )
          )
          .groupBy(labOrders.panel_name)
          .orderBy(desc(count(labOrders.id)))
          .limit(20);

        return rows.map((r) => ({
          test_name: r.panel_name || 'Unknown',
          volume: r.order_count || 0,
        }));
      } catch (err) {
        console.error('Test Volumes error:', err);
        return [];
      }
    }),

  // Daily trends (orders by status)
  dailyTrends: adminProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      const { days } = input;
      const dateFromObj = new Date();
      dateFromObj.setDate(dateFromObj.getDate() - days);

      try {
        const rows = await db
          .select({
            date: sql<string>`DATE(${labOrders.ordered_at})`,
            status: labOrders.status,
            count: count(labOrders.id),
          })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, ctx.user.hospital_id),
              gte(labOrders.ordered_at, dateFromObj)
            )
          )
          .groupBy(sql<string>`DATE(${labOrders.ordered_at})`, labOrders.status)
          .orderBy(asc(sql<string>`DATE(${labOrders.ordered_at})`));

        // Pivot by status
        const byDate: Record<
          string,
          {
            date: string;
            ordered: number;
            completed: number;
            rejected: number;
          }
        > = {};

        rows.forEach((r) => {
          const date = r.date || '';
          if (!byDate[date]) {
            byDate[date] = { date, ordered: 0, completed: 0, rejected: 0 };
          }
          const count = r.count || 0;
          if (r.status === 'ordered') byDate[date].ordered = count;
          else if (r.status === 'verified') byDate[date].completed = count;
          else if (r.status === 'cancelled') byDate[date].rejected = count;
        });

        return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
      } catch (err) {
        console.error('Daily Trends error:', err);
        return [];
      }
    }),

  // Dashboard summary (quick stats)
  dashboardSummary: adminProcedure.query(async ({ ctx }) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [todayStats, monthStats, pendingExternal] = await Promise.all([
        db
          .select({
            total_orders: count(labOrders.id),
            pending: count(sql`CASE WHEN ${labOrders.status} != 'verified' AND ${labOrders.status} != 'cancelled' THEN 1 END`),
            completed: count(sql`CASE WHEN ${labOrders.status} = 'verified' THEN 1 END`),
            avg_tat: avg(
              sql<number>`EXTRACT(EPOCH FROM (${labOrders.verified_at} - ${labOrders.ordered_at})) / 60`
            ),
          })
          .from(labOrders)
          .where(
            and(
              eq(labOrders.hospital_id, ctx.user.hospital_id),
              gte(labOrders.ordered_at, today)
            )
          ),

        db
          .select({
            pass_count: count(sql`CASE WHEN ${qcEnhancedRuns.result_status} = 'pass' THEN 1 END`),
            total_runs: count(qcEnhancedRuns.id),
          })
          .from(qcEnhancedRuns)
          .where(
            and(
              eq(qcEnhancedRuns.hospital_id, ctx.user.hospital_id),
              gte(qcEnhancedRuns.run_date, new Date(today.getFullYear(), today.getMonth(), 1))
            )
          ),

        db
          .select({ count: count(externalLabOrders.id) })
          .from(externalLabOrders)
          .where(
            and(
              eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
              ne(externalLabOrders.status, 'verified' as any),
              ne(externalLabOrders.status, 'cancelled' as any)
            )
          ),
      ]);

      const todayData = todayStats[0];
      const monthData = monthStats[0];
      const externalData = pendingExternal[0];

      return {
        total_orders_today: todayData?.total_orders || 0,
        pending_today: todayData?.pending || 0,
        completed_today: todayData?.completed || 0,
        avg_tat_today_minutes: todayData?.avg_tat ? Math.round(Number(todayData.avg_tat)) : 0,
        qc_pass_rate_this_month: monthData?.total_runs
          ? Math.round(((monthData.pass_count || 0) / (monthData.total_runs || 1)) * 100)
          : 0,
        external_orders_pending: externalData?.count || 0,
      };
    } catch (err) {
      console.error('Dashboard Summary error:', err);
      return {
        total_orders_today: 0,
        pending_today: 0,
        completed_today: 0,
        avg_tat_today_minutes: 0,
        qc_pass_rate_this_month: 0,
        external_orders_pending: 0,
      };
    }
  }),
});
