import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';

import {
  generateInsight,
  checkHealth,
  getRecentAuditStats,
  getErrorCountLastHour,
  getLatencyTrendLastHour,
  getRequestsByModule,
} from '@/lib/ai/llm-client';
import { generateFromTemplate } from '@/lib/ai/template-engine';

// ────────────────────────────────────────────────────────────────────────
// Lazy SQL Client
// ────────────────────────────────────────────────────────────────────────

let _sqlClient: NeonQueryFunction<false, false> | null = null;

function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ────────────────────────────────────────────────────────────────────────
// Helper: Get Default Hospital
// ────────────────────────────────────────────────────────────────────────

/**
 * Get the first hospital ID (for single-hospital setup).
 * In a true multi-tenant system, this would come from the user's context.
 */
async function getDefaultHospitalId(): Promise<string> {
  const sql = getSql();
  const result = await sql`SELECT id FROM hospitals LIMIT 1`;
  if (!result || result.length === 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'No hospitals found in system',
    });
  }
  return result[0].id;
}

// ────────────────────────────────────────────────────────────────────────
// ENUMS & INPUT SCHEMAS
// ────────────────────────────────────────────────────────────────────────

const insightSeverityEnum = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const insightStatusEnum = z.enum(['active', 'dismissed', 'acted_on']);
const aiModuleEnum = z.enum(['billing', 'clinical', 'quality', 'operations', 'pharmacy']);

// ════════════════════════════════════════════════════════════════════════
// INSIGHT CARD ENDPOINTS (4)
// ════════════════════════════════════════════════════════════════════════

/**
 * 1. getInsightCards — Fetch paginated insight cards with sorting by severity
 */
export const getInsightCardsInput = z.object({
  module: z.string().optional(),
  encounter_id: z.string().uuid().optional(),
  patient_id: z.string().uuid().optional(),
  status: insightStatusEnum.optional(),
  severity: insightSeverityEnum.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

/**
 * 2. dismissCard — Mark a card as dismissed
 */
export const dismissCardInput = z.object({
  card_id: z.string().uuid(),
});

/**
 * 3. actOnCard — Mark a card as acted upon
 */
export const actOnCardInput = z.object({
  card_id: z.string().uuid(),
  note: z.string().optional(),
});

/**
 * 4. submitFeedback — Log user feedback on card helpfulness
 */
export const submitFeedbackInput = z.object({
  card_id: z.string().uuid(),
  score: z.number().int().min(-1).max(1), // -1 = not helpful, 0 = neutral, 1 = helpful
  note: z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════════
// HEALTH & MONITORING ENDPOINTS (4)
// ════════════════════════════════════════════════════════════════════════

/**
 * 5. getAIHealth — LLM health, queue depth, cards generated today
 */

/**
 * 6. getAuditLog — Admin view of all AI requests/responses
 */
export const getAuditLogInput = z.object({
  module: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * 7. getQueueStatus — Count of requests by status in ai_request_queue
 */

/**
 * 8. getObservatory — Comprehensive AI observability dashboard
 */
export const getObservatoryInput = z.object({
  hours: z.number().int().min(1).default(24),
});

// ════════════════════════════════════════════════════════════════════════
// BILLING AI ENDPOINTS (3)
// ════════════════════════════════════════════════════════════════════════

/**
 * 10. getClaimPrediction — Get claim approval/deduction prediction
 */
export const getClaimPredictionInput = z.object({
  encounter_id: z.string().uuid(),
});

/**
 * 11. listClaimRubrics — Admin: view all TPA-specific claim rules
 */
export const listClaimRubricsInput = z.object({
  tpa_name: z.string().optional(),
  is_active: z.boolean().optional(),
});

/**
 * 12. updateClaimRubric — Admin: update claim prediction rule
 */
export const updateClaimRubricInput = z.object({
  rubric_id: z.string().uuid(),
  rule_data: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

// ════════════════════════════════════════════════════════════════════════
// QUALITY AI ENDPOINT (1)
// ════════════════════════════════════════════════════════════════════════

/**
 * 13. getNabhScore — Get daily NABH readiness score
 */
export const getNabhScoreInput = z.object({
  date: z.string().optional(), // YYYY-MM-DD, defaults to today
});

// ════════════════════════════════════════════════════════════════════════
// OPERATIONS AI ENDPOINTS (2)
// ════════════════════════════════════════════════════════════════════════

/**
 * 14. getBedPredictions — Discharge timing predictions per bed
 */
export const getBedPredictionsInput = z.object({
  ward: z.string().optional(),
});

/**
 * 15. getMorningBriefing — Daily operations brief
 */
export const getMorningBriefingInput = z.object({
  date: z.string().optional(), // YYYY-MM-DD, defaults to today
});

// ════════════════════════════════════════════════════════════════════════
// TEMPLATE MANAGEMENT ENDPOINTS (2)
// ════════════════════════════════════════════════════════════════════════

/**
 * 16. listTemplateRules — Admin: view all fallback template rules
 */
export const listTemplateRulesInput = z.object({
  module: z.string().optional(),
  is_active: z.boolean().optional(),
});

/**
 * 17. updateTemplateRule — Admin: update rule conditions & templates
 */
export const updateTemplateRuleInput = z.object({
  rule_id: z.string().uuid(),
  condition_config: z.record(z.unknown()).optional(),
  card_template: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

// ════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════

export const evenAIRouter = router({
  // ──────────────────────────────────────────────────────────────────
  // INSIGHT CARD ENDPOINTS (4)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 1. getInsightCards — Paginated insight cards sorted by severity
   */
  getInsightCards: protectedProcedure
    .input(getInsightCardsInput)
    .query(async ({ input, ctx }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const conditions: string[] = ['hospital_id = $1'];
      const params: unknown[] = [hospitalId];
      let paramIdx = 2;

      if (input.module) {
        conditions.push(`module = $${paramIdx}`);
        params.push(input.module);
        paramIdx++;
      }
      if (input.encounter_id) {
        conditions.push(`encounter_id = $${paramIdx}`);
        params.push(input.encounter_id);
        paramIdx++;
      }
      if (input.patient_id) {
        conditions.push(`patient_id = $${paramIdx}`);
        params.push(input.patient_id);
        paramIdx++;
      }
      if (input.status) {
        conditions.push(`status = $${paramIdx}`);
        params.push(input.status);
        paramIdx++;
      }
      if (input.severity) {
        conditions.push(`severity = $${paramIdx}`);
        params.push(input.severity);
        paramIdx++;
      }

      const where = conditions.join(' AND ');

      // Sort by severity (critical < high < medium < low < info), then by created_at DESC
      const severityOrder = `CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        WHEN 'info' THEN 5
        ELSE 6
      END`;

      const cards = await sql(
        `SELECT * FROM ai_insight_cards
         WHERE ${where}
         ORDER BY ${severityOrder}, created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, input.limit, input.offset]
      );

      const countResult = await sql(
        `SELECT COUNT(*)::int as total FROM ai_insight_cards WHERE ${where}`,
        params
      );

      const total = countResult[0]?.total || 0;

      return { cards, total };
    }),

  /**
   * 2. dismissCard — Mark insight card as dismissed
   */
  dismissCard: protectedProcedure
    .input(dismissCardInput)
    .mutation(async ({ input, ctx }) => {
      const sql = getSql();

      await sql`
        UPDATE ai_insight_cards
        SET status = 'dismissed',
            dismissed_by = ${ctx.user.sub},
            dismissed_at = NOW()
        WHERE id = ${input.card_id}
      `;

      return { success: true };
    }),

  /**
   * 3. actOnCard — Mark insight card as acted upon
   */
  actOnCard: protectedProcedure
    .input(actOnCardInput)
    .mutation(async ({ input, ctx }) => {
      const sql = getSql();

      await sql`
        UPDATE ai_insight_cards
        SET status = 'acted_on',
            acted_on_by = ${ctx.user.sub},
            acted_on_at = NOW(),
            acted_on_note = ${input.note || null}
        WHERE id = ${input.card_id}
      `;

      return { success: true };
    }),

  /**
   * 4. submitFeedback — Submit feedback on card helpfulness
   */
  submitFeedback: protectedProcedure
    .input(submitFeedbackInput)
    .mutation(async ({ input, ctx }) => {
      const sql = getSql();

      await sql`
        UPDATE ai_insight_cards
        SET feedback_score = ${input.score},
            feedback_note = ${input.note || null},
            feedback_submitted_at = NOW()
        WHERE id = ${input.card_id}
      `;

      return { success: true };
    }),

  // ──────────────────────────────────────────────────────────────────
  // HEALTH & MONITORING ENDPOINTS (4)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 5. getAIHealth — LLM health check and queue status
   */
  getAIHealth: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = await getDefaultHospitalId();
      const sql = getSql();

      // Check LLM health
      const healthResult = await checkHealth();

      // Get audit stats
      const auditStats = await getRecentAuditStats(hospitalId);

      // Get queue depth
      const queueResult = await sql`
        SELECT COUNT(*)::int as pending FROM ai_request_queue
        WHERE status = 'pending'
        LIMIT 500
      `;

      const queueDepth = queueResult[0]?.pending || 0;

      return {
        llm_status: healthResult?.status || 'offline',
        llm_latency_ms: healthResult?.latency_ms || 0,
        model: healthResult?.model || 'unknown',
        queue_depth: queueDepth,
        cards_generated_today: auditStats.cards_generated_today,
        last_successful_inference: auditStats.last_successful_inference,
      };
    }),

  /**
   * 6. getAuditLog — Admin: list all AI audit logs with filters
   */
  getAuditLog: adminProcedure
    .input(getAuditLogInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const conditions: string[] = ['hospital_id = $1'];
      const params: unknown[] = [hospitalId];
      let paramIdx = 2;

      if (input.module) {
        conditions.push(`module = $${paramIdx}`);
        params.push(input.module);
        paramIdx++;
      }
      if (input.status) {
        conditions.push(`status = $${paramIdx}`);
        params.push(input.status);
        paramIdx++;
      }

      const where = conditions.join(' AND ');

      const logs = await sql(
        `SELECT * FROM ai_audit_log
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, input.limit, input.offset]
      );

      const countResult = await sql(
        `SELECT COUNT(*)::int as total FROM ai_audit_log WHERE ${where}`,
        params
      );

      const total = countResult[0]?.total || 0;

      return { logs, total };
    }),

  /**
   * 7. getQueueStatus — Admin: request queue status
   */
  getQueueStatus: adminProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();

      // Get counts by status
      const countsResult = await sql`
        SELECT status, COUNT(*)::int as count FROM ai_request_queue
        GROUP BY status
        LIMIT 500
      `;

      // Get age of oldest pending request
      const oldestResult = await sql`
        SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as minutes_old
        FROM ai_request_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `;

      const statusMap: Record<string, number> = {
        pending: 0,
        processing: 0,
        failed: 0,
      };

      countsResult.forEach((row: any) => {
        if (statusMap.hasOwnProperty(row.status)) {
          statusMap[row.status] = row.count;
        }
      });

      const oldestPendingAge = oldestResult[0]?.minutes_old
        ? Math.round(oldestResult[0].minutes_old)
        : null;

      return {
        pending: statusMap.pending,
        processing: statusMap.processing,
        failed: statusMap.failed,
        oldest_pending_age_minutes: oldestPendingAge,
      };
    }),

  /**
   * 8. getObservatory — Comprehensive AI observability dashboard
   */
  getObservatory: adminProcedure
    .input(getObservatoryInput)
    .query(async ({ input }) => {
      const hospitalId = await getDefaultHospitalId();
      const sql = getSql();

      // Fetch all data in parallel
      const [
        healthResult,
        auditStats,
        latencyTrend,
        requestsByModule,
        queueStatus,
      ] = await Promise.all([
        checkHealth(),
        getRecentAuditStats(hospitalId),
        getLatencyTrendLastHour(hospitalId),
        getRequestsByModule(hospitalId),
        (async () => {
          const queueResult = await sql`
            SELECT COUNT(*)::int as pending FROM ai_request_queue
            WHERE status = 'pending'
          `;
          return queueResult[0]?.pending || 0;
        })(),
      ]);

      // Cards by status
      const cardsByStatusResult = await sql`
        SELECT status, COUNT(*)::int as count FROM ai_insight_cards
        WHERE hospital_id = ${hospitalId}
        GROUP BY status
      `;

      const cardsByStatus: Record<string, number> = {
        active: 0,
        dismissed: 0,
        acted_on: 0,
      };
      cardsByStatusResult.forEach((row: any) => {
        if (cardsByStatus.hasOwnProperty(row.status)) {
          cardsByStatus[row.status] = row.count;
        }
      });

      // Cards by module
      const cardsByModuleResult = await sql`
        SELECT module, COUNT(*)::int as count FROM ai_insight_cards
        WHERE hospital_id = ${hospitalId}
        GROUP BY module
        ORDER BY count DESC
      `;

      // Feedback summary
      const feedbackResult = await sql`
        SELECT
          COUNT(CASE WHEN feedback_score = 1 THEN 1 END)::int as helpful,
          COUNT(CASE WHEN feedback_score = -1 THEN 1 END)::int as not_helpful,
          COUNT(CASE WHEN feedback_score = 0 OR feedback_score IS NULL THEN 1 END)::int as neutral
        FROM ai_insight_cards
        WHERE hospital_id = ${hospitalId}
          AND feedback_submitted_at IS NOT NULL
      `;

      const feedback = feedbackResult[0] || {
        helpful: 0,
        not_helpful: 0,
        neutral: 0,
      };

      // Top template rules
      const topRulesResult = await sql`
        SELECT rule_name, module, fire_count FROM ai_template_rules
        WHERE hospital_id = ${hospitalId}
        ORDER BY fire_count DESC
        LIMIT 10
      `;

      return {
        health: {
          llm_status: healthResult?.status || 'offline',
          llm_latency_ms: healthResult?.latency_ms || 0,
          model: healthResult?.model || 'unknown',
        },
        audit_stats: {
          cards_generated_today: auditStats.cards_generated_today,
          last_successful_inference: auditStats.last_successful_inference,
          avg_latency_ms: auditStats.avg_latency_ms,
        },
        latency_trend: latencyTrend,
        requests_by_module: requestsByModule,
        cards_by_status: cardsByStatus,
        cards_by_module: cardsByModuleResult,
        feedback_summary: feedback,
        queue_depth: queueStatus,
        top_template_rules: topRulesResult,
      };
    }),

  /**
   * 9. triggerInsight — Admin: manually trigger insight generation
   */
  triggerInsight: adminProcedure
    .input(
      z.object({
        module: z.string(),
        context: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const hospitalId = await getDefaultHospitalId();

      try {
        const cards = await generateFromTemplate({
          hospital_id: hospitalId,
          module: input.module as any,
          trigger_type: 'manual',
          data: input.context || {},
        });

        return {
          cards_generated: cards.length,
          card_ids: cards.map((c: any) => c.id),
        };
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to trigger insight: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    }),

  // ──────────────────────────────────────────────────────────────────
  // BILLING AI ENDPOINTS (3)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 10. getClaimPrediction — Get claim approval prediction for encounter
   */
  getClaimPrediction: protectedProcedure
    .input(getClaimPredictionInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const prediction = await sql`
        SELECT * FROM claim_predictions
        WHERE hospital_id = ${hospitalId}
          AND encounter_id = ${input.encounter_id}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (!prediction || prediction.length === 0) {
        return null;
      }

      const pred = prediction[0];

      // Count rubric rules applied (from claim_rubrics for that TPA)
      const rubricsResult = await sql`
        SELECT COUNT(*)::int as count FROM claim_rubrics
        WHERE hospital_id = ${hospitalId}
          AND tpa_name = ${pred.tpa_name}
          AND is_active = true
      `;

      const rubricsCount = rubricsResult[0]?.count || 0;

      // Count data points used (fields present in prediction_data)
      const dataPoints =
        pred.prediction_data && typeof pred.prediction_data === 'object'
          ? Object.keys(pred.prediction_data).length
          : 0;

      return {
        prediction: pred,
        rubric_rules_applied: rubricsCount,
        data_points_used: dataPoints,
      };
    }),

  /**
   * 11. listClaimRubrics — Admin: list all TPA claim rubrics
   */
  listClaimRubrics: adminProcedure
    .input(listClaimRubricsInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const conditions: string[] = ['hospital_id = $1'];
      const params: unknown[] = [hospitalId];
      let paramIdx = 2;

      if (input.tpa_name) {
        conditions.push(`tpa_name = $${paramIdx}`);
        params.push(input.tpa_name);
        paramIdx++;
      }
      if (input.is_active !== undefined) {
        conditions.push(`is_active = $${paramIdx}`);
        params.push(input.is_active);
        paramIdx++;
      }

      const where = conditions.join(' AND ');

      const rubrics = await sql(
        `SELECT * FROM claim_rubrics WHERE ${where} ORDER BY tpa_name, rule_name LIMIT 500`,
        params
      );

      return { rubrics };
    }),

  /**
   * 12. updateClaimRubric — Admin: update claim rubric rule
   */
  updateClaimRubric: adminProcedure
    .input(updateClaimRubricInput)
    .mutation(async ({ input }) => {
      const sql = getSql();

      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.rule_data !== undefined) {
        updates.push(`rule_data = $${paramIdx}`);
        params.push(JSON.stringify(input.rule_data));
        paramIdx++;
      }
      if (input.is_active !== undefined) {
        updates.push(`is_active = $${paramIdx}`);
        params.push(input.is_active);
        paramIdx++;
      }

      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) {
        // Only updated_at, no actual changes
        return { success: true };
      }

      await sql(
        `UPDATE claim_rubrics SET ${updates.join(', ')}
         WHERE id = $${paramIdx}`,
        [...params, input.rubric_id]
      );

      return { success: true };
    }),

  // ──────────────────────────────────────────────────────────────────
  // QUALITY AI ENDPOINT (1)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 13. getNabhScore — Get NABH readiness score for a date
   */
  getNabhScore: protectedProcedure
    .input(getNabhScoreInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const scoreDate = input.date || new Date().toISOString().split('T')[0];

      const score = await sql`
        SELECT * FROM nabh_readiness_scores
        WHERE hospital_id = ${hospitalId}
          AND score_date = ${scoreDate}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      return {
        score: score.length > 0 ? score[0] : null,
      };
    }),

  // ──────────────────────────────────────────────────────────────────
  // OPERATIONS AI ENDPOINTS (2)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 14. getBedPredictions — Discharge predictions per bed
   */
  getBedPredictions: protectedProcedure
    .input(getBedPredictionsInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      let predictions;

      if (input.ward) {
        predictions = await sql`
          SELECT bp.* FROM bed_predictions bp
          JOIN beds b ON bp.bed_id = b.id
          WHERE bp.hospital_id = ${hospitalId}
            AND bp.actual_discharge_at IS NULL
            AND b.ward = ${input.ward}
          LIMIT 500
        `;
      } else {
        predictions = await sql`
          SELECT * FROM bed_predictions
          WHERE hospital_id = ${hospitalId}
            AND actual_discharge_at IS NULL
          LIMIT 500
        `;
      }

      // Calculate occupancy_pct and predicted_discharges_24h
      const occupancyResult = await sql`
        SELECT
          COUNT(CASE WHEN actual_discharge_at IS NULL THEN 1 END)::int as occupied,
          COUNT(*)::int as total_beds
        FROM beds WHERE hospital_id = ${hospitalId}
      `;

      const occupancy = occupancyResult[0];
      const occupancyPct =
        occupancy && occupancy.total_beds > 0
          ? Math.round((occupancy.occupied / occupancy.total_beds) * 100)
          : 0;

      // Count predicted discharges in next 24 hours
      const dischargeForecastResult = await sql`
        SELECT COUNT(*)::int as count FROM bed_predictions
        WHERE hospital_id = ${hospitalId}
          AND predicted_discharge_at > NOW()
          AND predicted_discharge_at <= NOW() + INTERVAL '24 hours'
          AND actual_discharge_at IS NULL
      `;

      const predictedDischarges = dischargeForecastResult[0]?.count || 0;

      return {
        predictions,
        occupancy_pct: occupancyPct,
        predicted_discharges_24h: predictedDischarges,
      };
    }),

  /**
   * 15. getMorningBriefing — Get morning briefing for the day
   */
  getMorningBriefing: protectedProcedure
    .input(getMorningBriefingInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const briefingDate = input.date || new Date().toISOString().split('T')[0];

      const briefing = await sql`
        SELECT * FROM ai_insight_cards
        WHERE hospital_id = ${hospitalId}
          AND module = 'operations'
          AND category = 'report'
          AND title ILIKE '%Morning Briefing%'
          AND DATE(created_at) = ${briefingDate}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      return {
        briefing: briefing.length > 0 ? briefing[0] : null,
      };
    }),

  // ──────────────────────────────────────────────────────────────────
  // TEMPLATE MANAGEMENT ENDPOINTS (2)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 16. listTemplateRules — Admin: list all fallback template rules
   */
  listTemplateRules: adminProcedure
    .input(listTemplateRulesInput)
    .query(async ({ input }) => {
      const sql = getSql();
      const hospitalId = await getDefaultHospitalId();

      const conditions: string[] = ['hospital_id = $1'];
      const params: unknown[] = [hospitalId];
      let paramIdx = 2;

      if (input.module) {
        conditions.push(`module = $${paramIdx}`);
        params.push(input.module);
        paramIdx++;
      }
      if (input.is_active !== undefined) {
        conditions.push(`is_active = $${paramIdx}`);
        params.push(input.is_active);
        paramIdx++;
      }

      const where = conditions.join(' AND ');

      const rules = await sql(
        `SELECT * FROM ai_template_rules
         WHERE ${where}
         ORDER BY module, rule_name
         LIMIT 500`,
        params
      );

      return { rules };
    }),

  /**
   * 17. updateTemplateRule — Admin: update template rule
   */
  updateTemplateRule: adminProcedure
    .input(updateTemplateRuleInput)
    .mutation(async ({ input }) => {
      const sql = getSql();

      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.condition_config !== undefined) {
        updates.push(`condition_config = $${paramIdx}`);
        params.push(JSON.stringify(input.condition_config));
        paramIdx++;
      }
      if (input.card_template !== undefined) {
        updates.push(`card_template = $${paramIdx}`);
        params.push(JSON.stringify(input.card_template));
        paramIdx++;
      }
      if (input.is_active !== undefined) {
        updates.push(`is_active = $${paramIdx}`);
        params.push(input.is_active);
        paramIdx++;
      }

      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) {
        // Only updated_at
        return { success: true };
      }

      await sql(
        `UPDATE ai_template_rules SET ${updates.join(', ')}
         WHERE id = $${paramIdx}`,
        [...params, input.rule_id]
      );

      return { success: true };
    }),
});
