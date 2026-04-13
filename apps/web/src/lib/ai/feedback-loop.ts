/**
 * Even AI — Feedback Loop & Effectiveness Tracking Engine
 * Analyzes user feedback on AI insight cards to measure effectiveness and identify improvements
 *
 * Features:
 * - Comprehensive effectiveness metrics (response rate, action rate, dismiss rate)
 * - Module-level deep dives with category breakdowns
 * - Low-performing card patterns (consistent feedback scores, auto-dismiss detection)
 * - Card lifecycle analysis (time to action, generation trends, peak times)
 * - Time-series feedback trends for trend analysis
 * - Source comparison (LLM vs template effectiveness)
 *
 * Database table: ai_insight_cards
 */

import { neon } from '@neondatabase/serverless';
import type { AIModule, CardCategory, CardStatus, CardSource } from './types';

// ============================================================================
// Lazy Singleton
// ============================================================================

let _sql: any = null;

/**
 * Get or create the Neon SQL client (lazy singleton)
 */
function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface EffectivenessReport {
  hospital_id: string;
  period_days: number;
  total_cards: number;
  status_breakdown: Record<CardStatus, number>;
  feedback_distribution: {
    helpful: number;
    neutral: number;
    not_helpful: number;
    no_feedback: number;
  };
  response_rate: number; // % of cards with feedback
  action_rate: number; // % of cards acted on
  dismiss_rate: number; // % of cards dismissed without action
  avg_time_to_action_hours: number;
  avg_time_to_dismiss_hours: number;
  by_module: Array<{
    module: AIModule;
    card_count: number;
    action_rate: number;
    avg_feedback_score: number;
  }>;
  by_source: Array<{
    source: CardSource;
    card_count: number;
    action_rate: number;
    avg_feedback_score: number;
  }>;
}

export interface ModuleEffectivenessReport {
  hospital_id: string;
  module: AIModule;
  period_days: number;
  total_cards: number;
  by_category: Array<{
    category: CardCategory;
    card_count: number;
    avg_feedback_score: number;
    helpful_pct: number;
    not_helpful_pct: number;
    action_rate: number;
  }>;
  most_acted_upon: Array<{
    title: string;
    count: number;
    avg_feedback_score: number;
  }>;
  most_dismissed: Array<{
    title: string;
    count: number;
    avg_feedback_score: number;
  }>;
  avg_confidence_acted: number;
  avg_confidence_dismissed: number;
}

export interface LowPerformingCard {
  module: AIModule;
  category: CardCategory;
  title_pattern: string;
  count: number;
  avg_feedback_score: number;
  pattern_type: 'consistently_negative' | 'auto_dismissed' | 'expired_unread';
  recommendation: string;
}

export interface CardLifecycleStats {
  hospital_id: string;
  period_days: number;
  avg_card_lifespan_hours: number;
  cards_per_day: number;
  peak_generation_hour: number;
  busiest_module_by_volume: AIModule;
  module_volume_breakdown: Array<{
    module: AIModule;
    card_count: number;
    pct_of_total: number;
  }>;
}

export interface FeedbackTrendItem {
  date: string;
  card_count: number;
  helpful_count: number;
  neutral_count: number;
  not_helpful_count: number;
  avg_feedback_score: number;
  action_rate: number;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Get comprehensive effectiveness report for a hospital
 * Includes overall metrics, status breakdown, feedback distribution, and module/source comparison
 */
export async function getEffectivenessMetrics(
  hospital_id: string,
  days: number = 30
): Promise<EffectivenessReport> {
  const sql = getSql();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Main effectiveness query with all metrics
  const metricsQuery = `
    SELECT
      COUNT(*) as total_cards,

      -- Status breakdown
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed_count,
      SUM(CASE WHEN status = 'acted_on' THEN 1 ELSE 0 END) as acted_on_count,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_count,

      -- Feedback distribution
      SUM(CASE WHEN feedback_score = 1 THEN 1 ELSE 0 END) as helpful_count,
      SUM(CASE WHEN feedback_score = 0 THEN 1 ELSE 0 END) as neutral_count,
      SUM(CASE WHEN feedback_score = -1 THEN 1 ELSE 0 END) as not_helpful_count,
      SUM(CASE WHEN feedback_score IS NULL THEN 1 ELSE 0 END) as no_feedback_count,

      -- Time metrics
      AVG(EXTRACT(EPOCH FROM (acted_on_at - created_at)) / 3600) as avg_time_to_action_hours,
      AVG(EXTRACT(EPOCH FROM (dismissed_at - created_at)) / 3600) as avg_time_to_dismiss_hours
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
  `;

  const metricsResult = await sql(metricsQuery, [hospital_id, cutoffDate.toISOString()]);
  const metrics = metricsResult[0];

  // Module breakdown
  const moduleQuery = `
    SELECT
      module,
      COUNT(*) as card_count,
      SUM(CASE WHEN status = 'acted_on' THEN 1 ELSE 0 END) as acted_on_count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
    GROUP BY module
    ORDER BY card_count DESC
  `;

  const moduleResults = await sql(moduleQuery, [hospital_id, cutoffDate.toISOString()]);

  // Source breakdown
  const sourceQuery = `
    SELECT
      source,
      COUNT(*) as card_count,
      SUM(CASE WHEN status = 'acted_on' THEN 1 ELSE 0 END) as acted_on_count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
    GROUP BY source
    ORDER BY card_count DESC
  `;

  const sourceResults = await sql(sourceQuery, [hospital_id, cutoffDate.toISOString()]);

  const totalCards = parseInt(metrics.total_cards) || 0;
  const ackedOnCards = parseInt(metrics.acted_on_count) || 0;
  const dismissedCards = parseInt(metrics.dismissed_count) || 0;
  const feedbackCards =
    totalCards - (parseInt(metrics.no_feedback_count) || 0);

  return {
    hospital_id,
    period_days: days,
    total_cards: totalCards,
    status_breakdown: {
      active: parseInt(metrics.active_count) || 0,
      dismissed: parseInt(metrics.dismissed_count) || 0,
      acted_on: ackedOnCards,
      expired: parseInt(metrics.expired_count) || 0,
    },
    feedback_distribution: {
      helpful: parseInt(metrics.helpful_count) || 0,
      neutral: parseInt(metrics.neutral_count) || 0,
      not_helpful: parseInt(metrics.not_helpful_count) || 0,
      no_feedback: parseInt(metrics.no_feedback_count) || 0,
    },
    response_rate: totalCards > 0 ? (feedbackCards / totalCards) * 100 : 0,
    action_rate: totalCards > 0 ? (ackedOnCards / totalCards) * 100 : 0,
    dismiss_rate: totalCards > 0 ? (dismissedCards / totalCards) * 100 : 0,
    avg_time_to_action_hours:
      parseFloat(metrics.avg_time_to_action_hours) || 0,
    avg_time_to_dismiss_hours:
      parseFloat(metrics.avg_time_to_dismiss_hours) || 0,
    by_module: moduleResults.map((row: any) => ({
      module: row.module as AIModule,
      card_count: parseInt(row.card_count) || 0,
      action_rate:
        parseInt(row.card_count) > 0
          ? (parseInt(row.acted_on_count) / parseInt(row.card_count)) * 100
          : 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
    })),
    by_source: sourceResults.map((row: any) => ({
      source: row.source as CardSource,
      card_count: parseInt(row.card_count) || 0,
      action_rate:
        parseInt(row.card_count) > 0
          ? (parseInt(row.acted_on_count) / parseInt(row.card_count)) * 100
          : 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
    })),
  };
}

/**
 * Get deep dive effectiveness report for a specific module
 * Includes category breakdowns, best/worst performing cards, confidence analysis
 */
export async function getModuleEffectiveness(
  hospital_id: string,
  module: string,
  days: number = 30
): Promise<ModuleEffectivenessReport> {
  const sql = getSql();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Category breakdown
  const categoryQuery = `
    SELECT
      category,
      COUNT(*) as card_count,
      SUM(CASE WHEN feedback_score = 1 THEN 1 ELSE 0 END) as helpful_count,
      SUM(CASE WHEN feedback_score = -1 THEN 1 ELSE 0 END) as not_helpful_count,
      SUM(CASE WHEN status = 'acted_on' THEN 1 ELSE 0 END) as acted_on_count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND module = $2 AND created_at >= $3
    GROUP BY category
    ORDER BY card_count DESC
  `;

  const categoryResults = await sql(categoryQuery, [
    hospital_id,
    module,
    cutoffDate.toISOString(),
  ]);

  // Most acted-upon cards (grouped by title)
  const actsQuery = `
    SELECT
      title,
      COUNT(*) as count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND module = $2 AND status = 'acted_on' AND created_at >= $3
    GROUP BY title
    ORDER BY count DESC
    LIMIT 5
  `;

  const actsResults = await sql(actsQuery, [
    hospital_id,
    module,
    cutoffDate.toISOString(),
  ]);

  // Most dismissed cards (grouped by title)
  const dismissQuery = `
    SELECT
      title,
      COUNT(*) as count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND module = $2 AND status = 'dismissed' AND created_at >= $3
    GROUP BY title
    ORDER BY count DESC
    LIMIT 5
  `;

  const dismissResults = await sql(dismissQuery, [
    hospital_id,
    module,
    cutoffDate.toISOString(),
  ]);

  // Confidence analysis
  const confidenceQuery = `
    SELECT
      status,
      AVG(confidence) as avg_confidence
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND module = $2 AND created_at >= $3
    GROUP BY status
  `;

  const confidenceResults = await sql(confidenceQuery, [
    hospital_id,
    module,
    cutoffDate.toISOString(),
  ]);

  const totalCards = categoryResults.reduce(
    (sum: number, row: any) => sum + parseInt(row.card_count),
    0
  );

  const confidenceMap = confidenceResults.reduce(
    (acc: Record<string, number>, row: any) => {
      acc[row.status] = parseFloat(row.avg_confidence) || 0;
      return acc;
    },
    {}
  );

  return {
    hospital_id,
    module: module as AIModule,
    period_days: days,
    total_cards: totalCards,
    by_category: categoryResults.map((row: any) => {
      const cardCount = parseInt(row.card_count) || 0;
      return {
        category: row.category as CardCategory,
        card_count: cardCount,
        avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
        helpful_pct: cardCount > 0
          ? ((parseInt(row.helpful_count) || 0) / cardCount) * 100
          : 0,
        not_helpful_pct: cardCount > 0
          ? ((parseInt(row.not_helpful_count) || 0) / cardCount) * 100
          : 0,
        action_rate: cardCount > 0
          ? ((parseInt(row.acted_on_count) || 0) / cardCount) * 100
          : 0,
      };
    }),
    most_acted_upon: actsResults.map((row: any) => ({
      title: row.title,
      count: parseInt(row.count) || 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
    })),
    most_dismissed: dismissResults.map((row: any) => ({
      title: row.title,
      count: parseInt(row.count) || 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
    })),
    avg_confidence_acted: confidenceMap['acted_on'] || 0,
    avg_confidence_dismissed: confidenceMap['dismissed'] || 0,
  };
}

/**
 * Identify patterns in low-performing cards
 * Returns cards with negative feedback, auto-dismiss patterns, and expired-unread patterns
 */
export async function getLowPerformingCards(
  hospital_id: string,
  days: number = 30
): Promise<LowPerformingCard[]> {
  const sql = getSql();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Consistently negative feedback pattern
  const negativeQuery = `
    SELECT
      module,
      category,
      SUBSTRING(title, 1, 30) as title_pattern,
      COUNT(*) as count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1
      AND created_at >= $2
      AND feedback_score = -1
    GROUP BY module, category, SUBSTRING(title, 1, 30)
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
    LIMIT 10
  `;

  const negativeResults = await sql(negativeQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  // Auto-dismiss pattern (dismissed within 30 seconds of creation)
  const autoDismissQuery = `
    SELECT
      module,
      category,
      SUBSTRING(title, 1, 30) as title_pattern,
      COUNT(*) as count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1
      AND created_at >= $2
      AND status = 'dismissed'
      AND dismissed_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (dismissed_at - created_at)) < 30
    GROUP BY module, category, SUBSTRING(title, 1, 30)
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
    LIMIT 10
  `;

  const autoDismissResults = await sql(autoDismissQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  // Expired without interaction pattern
  const expiredQuery = `
    SELECT
      module,
      category,
      SUBSTRING(title, 1, 30) as title_pattern,
      COUNT(*) as count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1
      AND created_at >= $2
      AND status = 'expired'
      AND dismissed_at IS NULL
      AND acted_on_at IS NULL
      AND feedback_score IS NULL
    GROUP BY module, category, SUBSTRING(title, 1, 30)
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
    LIMIT 10
  `;

  const expiredResults = await sql(expiredQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  const results: LowPerformingCard[] = [];

  negativeResults.forEach((row: any) => {
    results.push({
      module: row.module as AIModule,
      category: row.category as CardCategory,
      title_pattern: row.title_pattern,
      count: parseInt(row.count) || 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
      pattern_type: 'consistently_negative',
      recommendation: `Refine LLM prompt or rubric for ${row.module} ${row.category} cards. Consider alternative action suggestions.`,
    });
  });

  autoDismissResults.forEach((row: any) => {
    results.push({
      module: row.module as AIModule,
      category: row.category as CardCategory,
      title_pattern: row.title_pattern,
      count: parseInt(row.count) || 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
      pattern_type: 'auto_dismissed',
      recommendation: `Cards dismissed too quickly suggest poor relevance or timing. Check trigger conditions and card urgency level.`,
    });
  });

  expiredResults.forEach((row: any) => {
    results.push({
      module: row.module as AIModule,
      category: row.category as CardCategory,
      title_pattern: row.title_pattern,
      count: parseInt(row.count) || 0,
      avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
      pattern_type: 'expired_unread',
      recommendation: `Reduce card TTL or increase visibility. Consider routing to different role/user for better reach.`,
    });
  });

  return results.sort((a, b) => b.count - a.count);
}

/**
 * Analyze card lifecycle: average lifespan, generation trends, peak times, busiest modules
 */
export async function getCardLifecycleStats(
  hospital_id: string,
  days: number = 30
): Promise<CardLifecycleStats> {
  const sql = getSql();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Lifespan analysis (time from creation to final status)
  const lifespanQuery = `
    SELECT
      AVG(EXTRACT(EPOCH FROM (
        COALESCE(acted_on_at, COALESCE(dismissed_at, expires_at, updated_at)) - created_at
      )) / 3600) as avg_lifespan_hours
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
  `;

  const lifespanResult = await sql(lifespanQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  // Generation stats by hour (for peak time analysis)
  const hourlyQuery = `
    SELECT
      EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') as hour,
      COUNT(*) as card_count
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
    GROUP BY EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')
    ORDER BY card_count DESC
    LIMIT 1
  `;

  const hourlyResult = await sql(hourlyQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  // Total card count by day
  const dailyCountQuery = `
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT DATE(created_at)) as days
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
  `;

  const dailyCountResult = await sql(dailyCountQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  // Module volume breakdown
  const moduleVolumeQuery = `
    SELECT
      module,
      COUNT(*) as card_count
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
    GROUP BY module
    ORDER BY card_count DESC
  `;

  const moduleVolumeResults = await sql(moduleVolumeQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  const totalCards = parseInt(dailyCountResult[0].total) || 0;
  const daysCount = parseInt(dailyCountResult[0].days) || 1;
  const peakHour = hourlyResult[0] ? parseInt(hourlyResult[0].hour) : 0;

  const moduleVolumeMap = moduleVolumeResults.map((row: any) => ({
    module: row.module as AIModule,
    card_count: parseInt(row.card_count) || 0,
    pct_of_total:
      totalCards > 0
        ? ((parseInt(row.card_count) || 0) / totalCards) * 100
        : 0,
  }));

  const busiestModule =
    moduleVolumeMap.length > 0
      ? (moduleVolumeMap[0].module as AIModule)
      : ('operations' as AIModule);

  return {
    hospital_id,
    period_days: days,
    avg_card_lifespan_hours:
      parseFloat(lifespanResult[0].avg_lifespan_hours) || 0,
    cards_per_day: daysCount > 0 ? totalCards / daysCount : 0,
    peak_generation_hour: peakHour,
    busiest_module_by_volume: busiestModule,
    module_volume_breakdown: moduleVolumeMap,
  };
}

/**
 * Get time-series feedback data for trend analysis
 * Returns daily metrics: card count, feedback distribution, action rate
 */
export async function getFeedbackTrend(
  hospital_id: string,
  days: number = 30
): Promise<FeedbackTrendItem[]> {
  const sql = getSql();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const trendQuery = `
    SELECT
      DATE(created_at AT TIME ZONE 'UTC')::text as date,
      COUNT(*) as card_count,
      SUM(CASE WHEN feedback_score = 1 THEN 1 ELSE 0 END) as helpful_count,
      SUM(CASE WHEN feedback_score = 0 THEN 1 ELSE 0 END) as neutral_count,
      SUM(CASE WHEN feedback_score = -1 THEN 1 ELSE 0 END) as not_helpful_count,
      SUM(CASE WHEN status = 'acted_on' THEN 1 ELSE 0 END) as acted_on_count,
      AVG(COALESCE(feedback_score, 0)) as avg_feedback_score
    FROM ai_insight_cards
    WHERE hospital_id = $1 AND created_at >= $2
    GROUP BY DATE(created_at AT TIME ZONE 'UTC')
    ORDER BY date ASC
  `;

  const results = await sql(trendQuery, [
    hospital_id,
    cutoffDate.toISOString(),
  ]);

  return results.map((row: any) => ({
    date: row.date,
    card_count: parseInt(row.card_count) || 0,
    helpful_count: parseInt(row.helpful_count) || 0,
    neutral_count: parseInt(row.neutral_count) || 0,
    not_helpful_count: parseInt(row.not_helpful_count) || 0,
    avg_feedback_score: parseFloat(row.avg_feedback_score) || 0,
    action_rate:
      parseInt(row.card_count) > 0
        ? (parseInt(row.acted_on_count) / parseInt(row.card_count)) * 100
        : 0,
  }));
}
