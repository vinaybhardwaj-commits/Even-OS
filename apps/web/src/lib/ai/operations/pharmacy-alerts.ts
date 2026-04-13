import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';

let _sql: any = null;
function getSql() {
  if (!_sql) {
    _sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

/**
 * Build a pharmacy alert card with standard fields
 */
function buildPharmacyCard(hospital_id: string, opts: {
  severity: CardSeverity;
  title: string;
  body: string;
  explanation: string;
  data_sources: string[];
  category?: 'alert' | 'suggestion' | 'prediction' | 'report' | 'nudge';
  action_url?: string;
  suggested_action?: string;
}): InsightCard {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    hospital_id,
    module: 'pharmacy',
    category: opts.category || 'alert',
    severity: opts.severity,
    title: opts.title,
    body: opts.body,
    explanation: opts.explanation,
    data_sources: opts.data_sources,
    action_url: opts.action_url,
    suggested_action: opts.suggested_action,
    confidence: 0.9,
    source: 'template',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Insert a single pharmacy card into ai_insight_cards
 */
async function insertPharmacyCard(card: InsightCard): Promise<void> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO ai_insight_cards (
      id, hospital_id, module, category, severity,
      title, body, explanation, data_sources, suggested_action, action_url,
      confidence, source, status,
      created_at, expires_at
    ) VALUES (
      ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
      ${card.title}, ${card.body}, ${card.explanation}, ${JSON.stringify(card.data_sources)},
      ${card.suggested_action || null}, ${card.action_url || null},
      ${card.confidence}, ${card.source}, ${card.status},
      ${card.created_at}, ${expiresAt}
    )
  `;
}

/**
 * Check for stock-out risks:
 * - Items at 0 stock: CRITICAL alert
 * - Items below reorder level: HIGH alert
 * - Items below 2x reorder level: MEDIUM prediction
 */
export async function checkStockOutRisk(hospital_id: string): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();

    // Query items at critical stock level
    const stockLevels = await sql`
      SELECT
        id, drug_name, current_quantity, reorder_level,
        CASE
          WHEN current_quantity = 0 THEN 'critical'
          WHEN current_quantity <= reorder_level THEN 'high'
          WHEN current_quantity <= (reorder_level * 2) THEN 'medium'
          ELSE 'ok'
        END as risk_level,
        location
      FROM pharmacy_inventory
      WHERE hospital_id = ${hospital_id}
        AND status = 'active'
        AND current_quantity <= (reorder_level * 2)
      ORDER BY current_quantity ASC
      LIMIT 500
    `;

    if (!stockLevels || stockLevels.length === 0) {
      return { cards, errors };
    }

    // Group by risk level
    const criticalItems = stockLevels.filter((item: any) => item.risk_level === 'critical');
    const highRiskItems = stockLevels.filter((item: any) => item.risk_level === 'high');
    const mediumRiskItems = stockLevels.filter((item: any) => item.risk_level === 'medium');

    // Critical: Zero stock items
    if (criticalItems.length > 0) {
      const itemList = criticalItems.map((item: any) => `${item.drug_name} (${item.location})`).join(', ');
      const card = buildPharmacyCard(hospital_id, {
        severity: 'critical',
        title: `Stock-Out: ${criticalItems.length} item${criticalItems.length > 1 ? 's' : ''} at zero inventory`,
        body: `Immediate restocking required: ${itemList}`,
        explanation: `These medications are completely out of stock and may be required for patient care. Immediate action required.`,
        data_sources: ['pharmacy_inventory'],
        category: 'alert',
        action_url: '/admin/pharmacy/inventory',
        suggested_action: 'Review stock levels and initiate emergency purchase orders',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }

    // High: Below reorder level
    if (highRiskItems.length > 0) {
      const itemList = highRiskItems.map((item: any) => `${item.drug_name} (${item.current_quantity}/${item.reorder_level})`).join(', ');
      const card = buildPharmacyCard(hospital_id, {
        severity: 'high',
        title: `Low Stock: ${highRiskItems.length} item${highRiskItems.length > 1 ? 's' : ''} below reorder level`,
        body: `Inventory levels below reorder threshold: ${itemList}`,
        explanation: `Stock levels have fallen below configured reorder points. Place replenishment orders to prevent stockouts.`,
        data_sources: ['pharmacy_inventory'],
        category: 'alert',
        action_url: '/admin/pharmacy/inventory',
        suggested_action: 'Create and process purchase orders for these items',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }

    // Medium: Below 2x reorder level (predictive)
    if (mediumRiskItems.length > 0) {
      const itemList = mediumRiskItems.map((item: any) => `${item.drug_name} (${item.current_quantity}/${item.reorder_level})`).slice(0, 5).join(', ');
      const totalMedium = mediumRiskItems.length;
      const card = buildPharmacyCard(hospital_id, {
        severity: 'medium',
        title: `Upcoming Stock Risks: ${totalMedium} item${totalMedium > 1 ? 's' : ''} below 2x reorder level`,
        body: `${totalMedium} items approaching reorder threshold: ${itemList}${totalMedium > 5 ? ` (+${totalMedium - 5} more)` : ''}`,
        explanation: `These items have current stock between 1x and 2x reorder level. Consider placing advance orders to prevent future shortages.`,
        data_sources: ['pharmacy_inventory'],
        category: 'prediction',
        action_url: '/admin/pharmacy/inventory',
        suggested_action: 'Plan replenishment orders for upcoming demand',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }
  } catch (error) {
    errors.push(`Error in checkStockOutRisk: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { cards, errors };
}

/**
 * Check for expiry alerts:
 * - Within 30 days: HIGH alert
 * - Within 60 days: MEDIUM alert
 * - Within 90 days: LOW alert
 */
export async function checkExpiryAlerts(hospital_id: string): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();

    // Calculate date ranges
    const now = new Date();
    const days30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const days60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const days90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Query expiring items
    const expiryData = await sql`
      SELECT
        id, drug_name, batch_number, current_quantity,
        expiry_date, location,
        CASE
          WHEN expiry_date <= ${days30.toISOString()} THEN 'high'
          WHEN expiry_date <= ${days60.toISOString()} THEN 'medium'
          WHEN expiry_date <= ${days90.toISOString()} THEN 'low'
          ELSE 'ok'
        END as expiry_risk,
        EXTRACT(DAY FROM (expiry_date - NOW())) as days_until_expiry
      FROM pharmacy_inventory
      WHERE hospital_id = ${hospital_id}
        AND status = 'active'
        AND expiry_date <= ${days90.toISOString()}
        AND current_quantity > 0
      ORDER BY expiry_date ASC
      LIMIT 500
    `;

    if (!expiryData || expiryData.length === 0) {
      return { cards, errors };
    }

    // Group by risk level
    const highExpiry = expiryData.filter((item: any) => item.expiry_risk === 'high');
    const mediumExpiry = expiryData.filter((item: any) => item.expiry_risk === 'medium');
    const lowExpiry = expiryData.filter((item: any) => item.expiry_risk === 'low');

    // High: Within 30 days
    if (highExpiry.length > 0) {
      const itemList = highExpiry.map((item: any) => `${item.drug_name} batch ${item.batch_number} (expires in ${Math.ceil(item.days_until_expiry)} days)`).join(', ');
      const card = buildPharmacyCard(hospital_id, {
        severity: 'high',
        title: `Urgent Expiry: ${highExpiry.length} item${highExpiry.length > 1 ? 's' : ''} expiring within 30 days`,
        body: `Critical expiry alert: ${itemList}`,
        explanation: `These items will expire soon and must be used or disposed of according to regulatory guidelines. Consider prioritizing use in patient care or scheduling waste disposal.`,
        data_sources: ['pharmacy_inventory'],
        category: 'alert',
        action_url: '/admin/pharmacy/inventory',
        suggested_action: 'Prioritize use or schedule waste disposal for near-expiry items',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }

    // Medium: Within 60 days
    if (mediumExpiry.length > 0) {
      const itemList = mediumExpiry.map((item: any) => `${item.drug_name} (${Math.ceil(item.days_until_expiry)} days)`).slice(0, 5).join(', ');
      const totalMedium = mediumExpiry.length;
      const card = buildPharmacyCard(hospital_id, {
        severity: 'medium',
        title: `Expiry Alert: ${totalMedium} item${totalMedium > 1 ? 's' : ''} expiring within 60 days`,
        body: `${totalMedium} items expiring soon: ${itemList}${totalMedium > 5 ? ` (+${totalMedium - 5} more)` : ''}`,
        explanation: `Monitor expiry dates and plan usage or disposal. Ensure inventory rotation follows FIFO (First-In-First-Out) principle.`,
        data_sources: ['pharmacy_inventory'],
        category: 'alert',
        action_url: '/admin/pharmacy/inventory',
        suggested_action: 'Review and prioritize inventory rotation',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }

    // Low: Within 90 days
    if (lowExpiry.length > 0) {
      const totalLow = lowExpiry.length;
      const card = buildPharmacyCard(hospital_id, {
        severity: 'low',
        title: `Upcoming Expirations: ${totalLow} item${totalLow > 1 ? 's' : ''} expiring within 90 days`,
        body: `${totalLow} items expiring in 60-90 days. Monitor and plan inventory rotation.`,
        explanation: `These items will expire within 90 days. Plan usage and rotation to minimize waste.`,
        data_sources: ['pharmacy_inventory'],
        category: 'nudge',
        action_url: '/admin/pharmacy/inventory',
        suggested_action: 'Monitor expiry trends and plan inventory rotation',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }
  } catch (error) {
    errors.push(`Error in checkExpiryAlerts: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { cards, errors };
}

/**
 * Check for consumption anomalies:
 * - Current 7-day rate > 2x average: HIGH alert (spike)
 * - Current 7-day rate < 0.3x average: MEDIUM alert (drop/hoarding)
 */
export async function checkConsumptionAnomalies(hospital_id: string): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();

    // Calculate consumption for last 7 days vs 30-day average
    const anomalies = await sql`
      WITH consumption_stats AS (
        SELECT
          drug_id,
          drug_name,
          SUM(CASE WHEN dispensed_at >= NOW() - INTERVAL '7 days' THEN quantity ELSE 0 END) as recent_7d,
          SUM(CASE WHEN dispensed_at >= NOW() - INTERVAL '30 days' THEN quantity ELSE 0 END) as recent_30d,
          COUNT(DISTINCT CASE WHEN dispensed_at >= NOW() - INTERVAL '30 days' THEN DATE(dispensed_at) ELSE NULL END) as days_dispensed
        FROM pharmacy_dispensing
        WHERE hospital_id = ${hospital_id}
          AND dispensed_at >= NOW() - INTERVAL '30 days'
        GROUP BY drug_id, drug_name
      )
      SELECT
        drug_id,
        drug_name,
        recent_7d,
        recent_30d,
        days_dispensed,
        ROUND(CAST(recent_30d AS NUMERIC) / NULLIF(days_dispensed, 0), 2) as daily_avg,
        ROUND(CAST(recent_7d AS NUMERIC) / NULLIF(CAST(recent_30d AS NUMERIC) / NULLIF(days_dispensed, 0), 0), 2) as rate_multiplier,
        CASE
          WHEN (CAST(recent_7d AS NUMERIC) / NULLIF(CAST(recent_30d AS NUMERIC) / NULLIF(days_dispensed, 0), 0)) > 2 THEN 'spike'
          WHEN (CAST(recent_7d AS NUMERIC) / NULLIF(CAST(recent_30d AS NUMERIC) / NULLIF(days_dispensed, 0), 0)) < 0.3 THEN 'drop'
          ELSE 'normal'
        END as anomaly_type
      FROM consumption_stats
      WHERE recent_30d > 0
        AND days_dispensed >= 7
        AND (
          (CAST(recent_7d AS NUMERIC) / NULLIF(CAST(recent_30d AS NUMERIC) / NULLIF(days_dispensed, 0), 0)) > 2
          OR (CAST(recent_7d AS NUMERIC) / NULLIF(CAST(recent_30d AS NUMERIC) / NULLIF(days_dispensed, 0), 0)) < 0.3
        )
      ORDER BY rate_multiplier DESC
      LIMIT 500
    `;

    if (!anomalies || anomalies.length === 0) {
      return { cards, errors };
    }

    // Group by anomaly type
    const spikeAnomalies = anomalies.filter((item: any) => item.anomaly_type === 'spike');
    const dropAnomalies = anomalies.filter((item: any) => item.anomaly_type === 'drop');

    // High: Consumption spike (possible over-dispensing or high demand)
    if (spikeAnomalies.length > 0) {
      const itemList = spikeAnomalies.map((item: any) => `${item.drug_name} (${item.recent_7d} units, ${item.rate_multiplier}x average)`).slice(0, 5).join(', ');
      const totalSpikes = spikeAnomalies.length;
      const card = buildPharmacyCard(hospital_id, {
        severity: 'high',
        title: `High Consumption: ${totalSpikes} item${totalSpikes > 1 ? 's' : ''} with unusual usage spike`,
        body: `Unusual consumption spike detected: ${itemList}${totalSpikes > 5 ? ` (+${totalSpikes - 5} more)` : ''}`,
        explanation: `These items show consumption rates 2x higher than average. Verify legitimacy of increased demand, check for over-dispensing, or assess patient care needs.`,
        data_sources: ['pharmacy_dispensing'],
        category: 'alert',
        action_url: '/admin/pharmacy/dispensing',
        suggested_action: 'Audit recent dispensing for these items',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }

    // Medium: Consumption drop (possible hoarding, error, or low demand)
    if (dropAnomalies.length > 0) {
      const itemList = dropAnomalies.map((item: any) => `${item.drug_name} (${item.recent_7d} units, ${(item.rate_multiplier * 100).toFixed(0)}% of average)`).slice(0, 5).join(', ');
      const totalDrops = dropAnomalies.length;
      const card = buildPharmacyCard(hospital_id, {
        severity: 'medium',
        title: `Low Consumption: ${totalDrops} item${totalDrops > 1 ? 's' : ''} with unusual usage drop`,
        body: `Unusual consumption drop detected: ${itemList}${totalDrops > 5 ? ` (+${totalDrops - 5} more)` : ''}`,
        explanation: `These items show consumption rates < 30% of historical average. Investigate possible hoarding, storage errors, or reduced patient demand.`,
        data_sources: ['pharmacy_dispensing'],
        category: 'alert',
        action_url: '/admin/pharmacy/dispensing',
        suggested_action: 'Review storage locations and recent dispensing patterns',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }
  } catch (error) {
    errors.push(`Error in checkConsumptionAnomalies: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { cards, errors };
}

/**
 * Check for narcotic discrepancies:
 * Any mismatch between dispensed and (returned + administered) triggers CRITICAL alert
 */
export async function checkNarcoticDiscrepancies(hospital_id: string): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();

    // Query narcotic register for discrepancies
    const discrepancies = await sql`
      SELECT
        id,
        drug_name,
        quantity_dispensed,
        quantity_returned,
        quantity_administered,
        (quantity_returned + quantity_administered) as accounted_for,
        (quantity_dispensed - (quantity_returned + quantity_administered)) as discrepancy,
        discrepancy_notes,
        verified_at,
        EXTRACT(DAY FROM (NOW() - verified_at)) as days_since_verification
      FROM narcotic_register
      WHERE hospital_id = ${hospital_id}
        AND (quantity_dispensed != (quantity_returned + quantity_administered))
        AND verified_at >= NOW() - INTERVAL '90 days'
      ORDER BY ABS(quantity_dispensed - (quantity_returned + quantity_administered)) DESC
      LIMIT 500
    `;

    if (!discrepancies || discrepancies.length === 0) {
      return { cards, errors };
    }

    // Group discrepancies by severity
    const significantDiscrepancies = discrepancies.filter((item: any) => Math.abs(item.discrepancy) > 0);

    if (significantDiscrepancies.length > 0) {
      const itemList = significantDiscrepancies.map((item: any) => {
        const direction = item.discrepancy > 0 ? 'missing' : 'excess';
        return `${item.drug_name} (${Math.abs(item.discrepancy)} units ${direction})`;
      }).slice(0, 5).join(', ');
      const totalDiscrepancies = significantDiscrepancies.length;

      const card = buildPharmacyCard(hospital_id, {
        severity: 'critical',
        title: `Narcotic Control Alert: ${totalDiscrepancies} discrepanc${totalDiscrepancies > 1 ? 'ies' : 'y'} detected`,
        body: `Narcotic register discrepancies: ${itemList}${totalDiscrepancies > 5 ? ` (+${totalDiscrepancies - 5} more)` : ''}`,
        explanation: `Regulatory requirement: All narcotic dispensing must balance to zero. Discrepancies indicate potential diversion, documentation errors, or loss. Immediate investigation and audit trail review required.`,
        data_sources: ['narcotic_register'],
        category: 'alert',
        action_url: '/admin/pharmacy/narcotic-register',
        suggested_action: 'Immediately audit and reconcile narcotic records. Document findings.',
      });
      cards.push(card);
      await insertPharmacyCard(card);
    }
  } catch (error) {
    errors.push(`Error in checkNarcoticDiscrepancies: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { cards, errors };
}

/**
 * Main entry point: Run all pharmacy checks
 */
export async function runPharmacyAlerts(hospital_id: string): Promise<{
  checks_run: number;
  total_alerts: number;
  alerts: InsightCard[];
  errors: string[];
}> {
  const allCards: InsightCard[] = [];
  const allErrors: string[] = [];

  // Run all four checks in parallel
  const [
    stockOutResult,
    expiryResult,
    consumptionResult,
    narcoticResult,
  ] = await Promise.all([
    checkStockOutRisk(hospital_id),
    checkExpiryAlerts(hospital_id),
    checkConsumptionAnomalies(hospital_id),
    checkNarcoticDiscrepancies(hospital_id),
  ]);

  allCards.push(...stockOutResult.cards);
  allErrors.push(...stockOutResult.errors);

  allCards.push(...expiryResult.cards);
  allErrors.push(...expiryResult.errors);

  allCards.push(...consumptionResult.cards);
  allErrors.push(...consumptionResult.errors);

  allCards.push(...narcoticResult.cards);
  allErrors.push(...narcoticResult.errors);

  return {
    checks_run: 4,
    total_alerts: allCards.length,
    alerts: allCards,
    errors: allErrors,
  };
}
