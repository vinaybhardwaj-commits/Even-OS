import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ─── ENUMS ───────────────────────────────────────────────────────
const severityLevelEnum = z.enum(['1', '2', '3', '4']);
const alertStatusFilterEnum = z.enum(['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed']);
const trendDirectionEnum = z.enum(['up', 'down', 'stable']);
const kpiStatusEnum = z.enum(['green', 'amber', 'red', 'neutral']);

// ════════════════════════════════════════════════════════════════════
// KPI DEFINITIONS (5 endpoints)
// ════════════════════════════════════════════════════════════════════

const createKpiInput = z.object({
  hospital_id: z.string().uuid().optional(),
  kpi_name: z.string().min(1).max(100),
  kpi_code: z.string().min(1).max(50),
  description: z.string().optional(),
  formula_type: z.enum(['sql_query', 'aggregation', 'derived']),
  formula_query: z.string().optional(),
  data_source: z.string().max(100).optional(),
  refresh_cadence: z.enum(['real_time', 'hourly', 'daily']).default('hourly'),
  target_value: z.number().optional(),
  warning_threshold: z.number().optional(),
  critical_threshold: z.number().optional(),
  unit: z.string().max(50).optional(),
  display_format: z.enum(['integer', 'decimal_2', 'percentage', 'currency']).optional(),
  dashboard_tiers: z.array(z.number().int().min(1).max(4)),
  category: z.string().max(50).optional(),
  benchmark_national: z.number().optional(),
  benchmark_network_avg: z.number().optional(),
});

const updateKpiInput = createKpiInput.partial().extend({
  id: z.string().uuid(),
});

// ════════════════════════════════════════════════════════════════════
// ALERT QUEUE (6 endpoints)
// ════════════════════════════════════════════════════════════════════

const createAlertInput = z.object({
  hospital_id: z.string().uuid(),
  alert_type: z.string().min(1).max(100),
  alert_source: z.string().min(1).max(100),
  alert_code: z.string().max(50).optional(),
  alert_title: z.string().min(1).max(255),
  alert_description: z.string().optional(),
  patient_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  ward_id: z.string().uuid().optional(),
  assigned_to_role: z.string().max(50).optional(),
  assigned_to_user_id: z.string().uuid().optional(),
  severity_level: z.number().int().min(1).max(4),
  urgency_score: z.number().int().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ════════════════════════════════════════════════════════════════════
// DASHBOARD CONFIG (3 endpoints)
// ════════════════════════════════════════════════════════════════════

const upsertConfigInput = z.object({
  hospital_id: z.string().uuid(),
  dashboard_tier: z.number().int().min(1).max(4),
  layout_config: z.record(z.unknown()).optional(),
  auto_refresh_enabled: z.boolean().optional(),
  refresh_interval_seconds: z.number().int().min(5).max(3600).optional(),
  alert_severity_filter: z.number().int().min(0).max(4).optional(),
  department_filters: z.array(z.string().uuid()).optional(),
  kpi_bookmarks: z.array(z.string().uuid()).optional(),
  email_digest_frequency: z.enum(['real_time', 'hourly', 'daily', 'none']).optional(),
});

// ════════════════════════════════════════════════════════════════════
// KPI DAILY VALUES (3 endpoints)
// ════════════════════════════════════════════════════════════════════

const recordKpiValueInput = z.object({
  hospital_id: z.string().uuid(),
  kpi_id: z.string().uuid(),
  value_date: z.string(), // YYYY-MM-DD
  actual_value: z.number(),
  target_value: z.number().optional(),
  previous_day_value: z.number().optional(),
  previous_week_value: z.number().optional(),
  previous_month_value: z.number().optional(),
  ytd_value: z.number().optional(),
});

// ════════════════════════════════════════════════════════════════════
// DASHBOARD SNAPSHOTS (2 endpoints)
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════

export const dashboardsRouter = router({

  // ──────────────────────────────────────────────────────────────
  // KPI DEFINITIONS
  // ──────────────────────────────────────────────────────────────

  listKpis: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid().optional(),
      category: z.string().optional(),
      tier: z.number().int().min(1).max(4).optional(),
      enabled_only: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.hospital_id) {
        conditions.push(`(hospital_id = $${paramIdx} OR hospital_id IS NULL)`);
        params.push(input.hospital_id);
        paramIdx++;
      }
      if (input.category) {
        conditions.push(`category = $${paramIdx}`);
        params.push(input.category);
        paramIdx++;
      }
      if (input.enabled_only) {
        conditions.push(`enabled = true`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await getSql()(
        `SELECT * FROM kpi_definitions ${where} ORDER BY category, kpi_name LIMIT 200`,
        params
      );

      // Filter by tier in JS (dashboard_tiers is JSONB)
      const filtered = input.tier
        ? result.filter((r: any) => {
            const tiers = Array.isArray(r.dashboard_tiers) ? r.dashboard_tiers : JSON.parse(r.dashboard_tiers || '[]');
            return tiers.includes(input.tier);
          })
        : result;

      return { items: filtered, count: filtered.length };
    }),

  getKpi: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await getSql()(
        `SELECT * FROM kpi_definitions WHERE id = $1`,
        [input.id]
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'KPI definition not found' });
      return rows[0];
    }),

  createKpi: adminProcedure
    .input(createKpiInput)
    .mutation(async ({ input, ctx }) => {
      const rows = await getSql()(
        `INSERT INTO kpi_definitions (
          hospital_id, kpi_name, kpi_code, description,
          formula_type, formula_query, data_source, refresh_cadence,
          target_value, warning_threshold, critical_threshold,
          unit, display_format, dashboard_tiers, category,
          benchmark_national, benchmark_network_avg,
          created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18
        ) RETURNING *`,
        [
          input.hospital_id || null, input.kpi_name, input.kpi_code, input.description || null,
          input.formula_type, input.formula_query || null, input.data_source || null, input.refresh_cadence,
          input.target_value ?? null, input.warning_threshold ?? null, input.critical_threshold ?? null,
          input.unit || null, input.display_format || null, JSON.stringify(input.dashboard_tiers), input.category || null,
          input.benchmark_national ?? null, input.benchmark_network_avg ?? null,
          ctx.user.sub,
        ]
      );
      return rows[0];
    }),

  updateKpi: adminProcedure
    .input(updateKpiInput)
    .mutation(async ({ input, ctx }) => {
      const { id, ...fields } = input;
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          const dbKey = key === 'dashboardTiers' ? 'dashboard_tiers' : key;
          if (key === 'dashboard_tiers') {
            setClauses.push(`dashboard_tiers = $${paramIdx}`);
            params.push(JSON.stringify(value));
          } else {
            setClauses.push(`${key} = $${paramIdx}`);
            params.push(value);
          }
          paramIdx++;
        }
      }

      if (setClauses.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });

      setClauses.push(`updated_by = $${paramIdx}`);
      params.push(ctx.user.sub);
      paramIdx++;

      setClauses.push(`updated_at = NOW()`);

      params.push(id);
      const rows = await getSql()(
        `UPDATE kpi_definitions SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        params
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'KPI definition not found' });
      return rows[0];
    }),

  deleteKpi: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const rows = await getSql()(
        `UPDATE kpi_definitions SET enabled = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
        [input.id]
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'KPI definition not found' });
      return { success: true };
    }),

  // ──────────────────────────────────────────────────────────────
  // KPI DAILY VALUES
  // ──────────────────────────────────────────────────────────────

  recordKpiValue: adminProcedure
    .input(recordKpiValueInput)
    .mutation(async ({ input }) => {
      // Compute variance and status
      let variance_pct: number | null = null;
      let status = 'neutral';
      let trend_direction = 'stable';
      let trend_pct: number | null = null;

      if (input.target_value && input.target_value !== 0) {
        variance_pct = ((input.actual_value - input.target_value) / input.target_value) * 100;
      }

      // Lookup thresholds from kpi_definitions
      const [kpi] = await getSql()(
        `SELECT warning_threshold, critical_threshold FROM kpi_definitions WHERE id = $1`,
        [input.kpi_id]
      );
      if (kpi) {
        const warnThresh = parseFloat(kpi.warning_threshold || '0');
        const critThresh = parseFloat(kpi.critical_threshold || '0');
        if (variance_pct !== null) {
          if (Math.abs(variance_pct) >= critThresh) status = 'red';
          else if (Math.abs(variance_pct) >= warnThresh) status = 'amber';
          else status = 'green';
        }
      }

      // Compute trend from previous day
      if (input.previous_day_value !== undefined && input.previous_day_value !== 0) {
        trend_pct = ((input.actual_value - input.previous_day_value) / input.previous_day_value) * 100;
        if (trend_pct > 1) trend_direction = 'up';
        else if (trend_pct < -1) trend_direction = 'down';
        else trend_direction = 'stable';
      }

      const rows = await getSql()(
        `INSERT INTO kpi_daily_values (
          hospital_id, kpi_id, value_date, actual_value, target_value,
          variance_pct, status, previous_day_value, previous_week_value,
          previous_month_value, ytd_value, trend_direction, trend_pct
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (hospital_id, kpi_id, value_date)
        DO UPDATE SET
          actual_value = EXCLUDED.actual_value,
          target_value = EXCLUDED.target_value,
          variance_pct = EXCLUDED.variance_pct,
          status = EXCLUDED.status,
          previous_day_value = EXCLUDED.previous_day_value,
          previous_week_value = EXCLUDED.previous_week_value,
          previous_month_value = EXCLUDED.previous_month_value,
          ytd_value = EXCLUDED.ytd_value,
          trend_direction = EXCLUDED.trend_direction,
          trend_pct = EXCLUDED.trend_pct,
          updated_at = NOW()
        RETURNING *`,
        [
          input.hospital_id, input.kpi_id, input.value_date, input.actual_value,
          input.target_value ?? null, variance_pct, status,
          input.previous_day_value ?? null, input.previous_week_value ?? null,
          input.previous_month_value ?? null, input.ytd_value ?? null,
          trend_direction, trend_pct,
        ]
      );
      return rows[0];
    }),

  getKpiValues: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      kpi_id: z.string().uuid().optional(),
      category: z.string().optional(),
      start_date: z.string(), // YYYY-MM-DD
      end_date: z.string(),   // YYYY-MM-DD
    }))
    .query(async ({ input }) => {
      const conditions = [`kdv.hospital_id = $1`, `kdv.value_date >= $2`, `kdv.value_date <= $3`];
      const params: unknown[] = [input.hospital_id, input.start_date, input.end_date];
      let paramIdx = 4;

      if (input.kpi_id) {
        conditions.push(`kdv.kpi_id = $${paramIdx}`);
        params.push(input.kpi_id);
        paramIdx++;
      }
      if (input.category) {
        conditions.push(`kd.category = $${paramIdx}`);
        params.push(input.category);
        paramIdx++;
      }

      const rows = await getSql()(
        `SELECT kdv.*, kd.kpi_name, kd.kpi_code, kd.unit, kd.display_format, kd.category
         FROM kpi_daily_values kdv
         JOIN kpi_definitions kd ON kd.id = kdv.kpi_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY kdv.value_date DESC, kd.category, kd.kpi_name
         LIMIT 500`,
        params
      );
      return { items: rows, count: rows.length };
    }),

  getLatestKpiScorecard: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      tier: z.number().int().min(1).max(4).optional(),
    }))
    .query(async ({ input }) => {
      // Get yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      const rows = await getSql()(
        `SELECT kdv.*, kd.kpi_name, kd.kpi_code, kd.unit, kd.display_format,
                kd.category, kd.dashboard_tiers, kd.target_value as definition_target
         FROM kpi_daily_values kdv
         JOIN kpi_definitions kd ON kd.id = kdv.kpi_id
         WHERE kdv.hospital_id = $1 AND kdv.value_date = $2 AND kd.enabled = true
         ORDER BY kd.category, kd.kpi_name`,
        [input.hospital_id, dateStr]
      );

      // Filter by tier in JS
      const filtered = input.tier
        ? rows.filter((r: any) => {
            const tiers = Array.isArray(r.dashboard_tiers) ? r.dashboard_tiers : JSON.parse(r.dashboard_tiers || '[]');
            return tiers.includes(input.tier);
          })
        : rows;

      return { date: dateStr, items: filtered, count: filtered.length };
    }),

  // ──────────────────────────────────────────────────────────────
  // ALERT QUEUE
  // ──────────────────────────────────────────────────────────────

  listAlerts: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      status: z.array(alertStatusFilterEnum).optional(),
      severity: z.array(z.number().int().min(1).max(4)).optional(),
      patient_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [`hospital_id = $1`];
      const params: unknown[] = [input.hospital_id];
      let paramIdx = 2;

      if (input.status && input.status.length > 0) {
        const placeholders = input.status.map((_, i) => `$${paramIdx + i}`);
        conditions.push(`status IN (${placeholders.join(', ')})`);
        params.push(...input.status);
        paramIdx += input.status.length;
      }
      if (input.severity && input.severity.length > 0) {
        const placeholders = input.severity.map((_, i) => `$${paramIdx + i}`);
        conditions.push(`severity_level IN (${placeholders.join(', ')})`);
        params.push(...input.severity);
        paramIdx += input.severity.length;
      }
      if (input.patient_id) {
        conditions.push(`patient_id = $${paramIdx}`);
        params.push(input.patient_id);
        paramIdx++;
      }

      params.push(input.limit);
      const rows = await getSql()(
        `SELECT * FROM alert_queue
         WHERE ${conditions.join(' AND ')}
         ORDER BY severity_level ASC, raised_at DESC
         LIMIT $${paramIdx}`,
        params
      );

      // Also get summary counts
      const [counts] = await getSql()(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open') as open_count,
           COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged_count,
           COUNT(*) FILTER (WHERE severity_level = 1 AND status IN ('open', 'acknowledged')) as critical_unresolved,
           COUNT(*) FILTER (WHERE severity_level = 2 AND status IN ('open', 'acknowledged')) as high_unresolved
         FROM alert_queue WHERE hospital_id = $1`,
        [input.hospital_id]
      );

      return { items: rows, counts, total: rows.length };
    }),

  getAlert: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await getSql()(
        `SELECT * FROM alert_queue WHERE id = $1`,
        [input.id]
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      return rows[0];
    }),

  raiseAlert: protectedProcedure
    .input(createAlertInput)
    .mutation(async ({ input, ctx }) => {
      const rows = await getSql()(
        `INSERT INTO alert_queue (
          hospital_id, alert_type, alert_source, alert_code, alert_title, alert_description,
          patient_id, order_id, ward_id, assigned_to_role, assigned_to_user_id,
          severity_level, urgency_score, raised_by_user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          input.hospital_id, input.alert_type, input.alert_source, input.alert_code || null,
          input.alert_title, input.alert_description || null,
          input.patient_id || null, input.order_id || null, input.ward_id || null,
          input.assigned_to_role || null, input.assigned_to_user_id || null,
          input.severity_level, input.urgency_score ?? null,
          ctx.user.sub, JSON.stringify(input.metadata || {}),
        ]
      );
      return rows[0];
    }),

  acknowledgeAlert: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      hospital_id: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await getSql()(
        `UPDATE alert_queue
         SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by_user_id = $1, updated_at = NOW()
         WHERE id = $2 AND hospital_id = $3 AND status = 'open'
         RETURNING *`,
        [ctx.user.sub, input.id, input.hospital_id]
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found or already acknowledged' });

      // Audit log
      await getSql()(
        `INSERT INTO dashboard_access_audit (user_id, hospital_id, action_type, action_detail, alert_id)
         VALUES ($1, $2, 'acknowledge', 'Alert acknowledged', $3)`,
        [ctx.user.sub, input.hospital_id, input.id]
      );

      return rows[0];
    }),

  escalateAlert: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      hospital_id: z.string().uuid(),
      escalate_to_role: z.string().max(50),
      message: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Get current escalation chain
      const [alert] = await getSql()(
        `SELECT escalation_chain, escalation_attempts FROM alert_queue WHERE id = $1 AND hospital_id = $2`,
        [input.id, input.hospital_id]
      );
      if (!alert) throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });

      const chain = Array.isArray(alert.escalation_chain) ? alert.escalation_chain : [];
      chain.push({
        escalated_at: new Date().toISOString(),
        escalated_by: ctx.user.sub,
        escalated_to_role: input.escalate_to_role,
        message: input.message || null,
      });

      const rows = await getSql()(
        `UPDATE alert_queue
         SET escalation_chain = $1, escalation_attempts = escalation_attempts + 1,
             escalated_to_ceo = $2, updated_at = NOW()
         WHERE id = $3 AND hospital_id = $4
         RETURNING *`,
        [JSON.stringify(chain), input.escalate_to_role === 'ceo', input.id, input.hospital_id]
      );

      // Audit log
      await getSql()(
        `INSERT INTO dashboard_access_audit (user_id, hospital_id, action_type, action_detail, alert_id, escalated_to_role, escalation_message)
         VALUES ($1, $2, 'escalate', 'Alert escalated', $3, $4, $5)`,
        [ctx.user.sub, input.hospital_id, input.id, input.escalate_to_role, input.message || null]
      );

      return rows[0];
    }),

  resolveAlert: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      hospital_id: z.string().uuid(),
      resolution_note: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await getSql()(
        `UPDATE alert_queue
         SET status = 'resolved', resolved_at = NOW(), resolved_by_user_id = $1,
             metadata = jsonb_set(COALESCE(metadata, '{}'), '{resolution_note}', $2::jsonb),
             updated_at = NOW()
         WHERE id = $3 AND hospital_id = $4 AND status IN ('open', 'acknowledged', 'in_progress')
         RETURNING *`,
        [ctx.user.sub, JSON.stringify(input.resolution_note || ''), input.id, input.hospital_id]
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found or already resolved' });
      return rows[0];
    }),

  dismissAlert: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      hospital_id: z.string().uuid(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await getSql()(
        `UPDATE alert_queue
         SET status = 'dismissed', dismissal_reason = $1, resolved_at = NOW(), resolved_by_user_id = $2, updated_at = NOW()
         WHERE id = $3 AND hospital_id = $4 AND status IN ('open', 'acknowledged')
         RETURNING *`,
        [input.reason, ctx.user.sub, input.id, input.hospital_id]
      );
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found or cannot be dismissed' });

      // Audit log
      await getSql()(
        `INSERT INTO dashboard_access_audit (user_id, hospital_id, action_type, action_detail, alert_id)
         VALUES ($1, $2, 'acknowledge', $3, $4)`,
        [ctx.user.sub, input.hospital_id, `Dismissed: ${input.reason}`, input.id]
      );

      return rows[0];
    }),

  // ──────────────────────────────────────────────────────────────
  // DASHBOARD CONFIG
  // ──────────────────────────────────────────────────────────────

  getMyConfig: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      dashboard_tier: z.number().int().min(1).max(4),
    }))
    .query(async ({ input, ctx }) => {
      const rows = await getSql()(
        `SELECT * FROM dashboard_config WHERE user_id = $1 AND hospital_id = $2 AND dashboard_tier = $3`,
        [ctx.user.sub, input.hospital_id, input.dashboard_tier]
      );
      return rows[0] || null;
    }),

  upsertConfig: protectedProcedure
    .input(upsertConfigInput)
    .mutation(async ({ input, ctx }) => {
      const rows = await getSql()(
        `INSERT INTO dashboard_config (
          user_id, hospital_id, dashboard_tier,
          layout_config, auto_refresh_enabled, refresh_interval_seconds,
          alert_severity_filter, department_filters, kpi_bookmarks,
          email_digest_frequency, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $1, $1)
        ON CONFLICT (user_id, hospital_id, dashboard_tier)
        DO UPDATE SET
          layout_config = COALESCE($4, dashboard_config.layout_config),
          auto_refresh_enabled = COALESCE($5, dashboard_config.auto_refresh_enabled),
          refresh_interval_seconds = COALESCE($6, dashboard_config.refresh_interval_seconds),
          alert_severity_filter = COALESCE($7, dashboard_config.alert_severity_filter),
          department_filters = COALESCE($8, dashboard_config.department_filters),
          kpi_bookmarks = COALESCE($9, dashboard_config.kpi_bookmarks),
          email_digest_frequency = COALESCE($10, dashboard_config.email_digest_frequency),
          updated_by = $1,
          updated_at = NOW()
        RETURNING *`,
        [
          ctx.user.sub, input.hospital_id, input.dashboard_tier,
          JSON.stringify(input.layout_config || {}),
          input.auto_refresh_enabled ?? null,
          input.refresh_interval_seconds ?? null,
          input.alert_severity_filter ?? null,
          JSON.stringify(input.department_filters || []),
          JSON.stringify(input.kpi_bookmarks || []),
          input.email_digest_frequency ?? null,
        ]
      );
      return rows[0];
    }),

  // ──────────────────────────────────────────────────────────────
  // DASHBOARD SNAPSHOTS
  // ──────────────────────────────────────────────────────────────

  getLatestSnapshot: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      interval: z.enum(['hourly', 'daily']).default('hourly'),
    }))
    .query(async ({ input }) => {
      const rows = await getSql()(
        `SELECT * FROM dashboard_snapshots
         WHERE hospital_id = $1 AND snapshot_interval = $2
         ORDER BY snapshot_date DESC, snapshot_time DESC
         LIMIT 1`,
        [input.hospital_id, input.interval]
      );
      return rows[0] || null;
    }),

  getSnapshotHistory: protectedProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      interval: z.enum(['hourly', 'daily']).default('daily'),
      days: z.number().int().min(1).max(90).default(7),
    }))
    .query(async ({ input }) => {
      const rows = await getSql()(
        `SELECT * FROM dashboard_snapshots
         WHERE hospital_id = $1 AND snapshot_interval = $2
           AND snapshot_date >= CURRENT_DATE - $3::int
         ORDER BY snapshot_date DESC, snapshot_time DESC
         LIMIT 200`,
        [input.hospital_id, input.interval, input.days]
      );
      return { items: rows, count: rows.length };
    }),

  // ──────────────────────────────────────────────────────────────
  // DASHBOARD ACCESS AUDIT (read-only for admins)
  // ──────────────────────────────────────────────────────────────

  getAccessAudit: adminProcedure
    .input(z.object({
      hospital_id: z.string().uuid(),
      user_id: z.string().uuid().optional(),
      action_type: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [`hospital_id = $1`];
      const params: unknown[] = [input.hospital_id];
      let paramIdx = 2;

      if (input.user_id) {
        conditions.push(`user_id = $${paramIdx}`);
        params.push(input.user_id);
        paramIdx++;
      }
      if (input.action_type) {
        conditions.push(`action_type = $${paramIdx}`);
        params.push(input.action_type);
        paramIdx++;
      }

      params.push(input.limit);
      const rows = await getSql()(
        `SELECT daa.*, u.full_name as user_name
         FROM dashboard_access_audit daa
         LEFT JOIN users u ON u.id = daa.user_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY daa.created_at DESC
         LIMIT $${paramIdx}`,
        params
      );
      return { items: rows, count: rows.length };
    }),
});
