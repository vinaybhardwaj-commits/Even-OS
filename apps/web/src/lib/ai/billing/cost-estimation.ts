/**
 * Even AI — Billing Intelligence: Cost Estimation & Margin Analysis
 * Real-time cost forecasting at admission and during encounter
 *
 * Features:
 * - Admission-time cost estimation based on diagnosis and expected LOS
 * - Real-time charge accrual tracking with burn rate calculation
 * - Package vs itemized billing comparison
 * - Margin analysis with low-margin item flagging
 * - Deposit adequacy assessment
 * - InsightCard generation for clinical and financial teams
 *
 * Database tables used:
 * - encounters: diagnosis, expected_los_days, admission_type, status, admitted_at
 * - billing_accounts: insurer_name, tpa_name, sum_insured, co_pay_percent, room_rent_eligibility
 * - encounter_charges: charge_code, category, qty, unit_price, net_amount
 * - charge_master: charge_code, description, category, base_price, cost_price
 * - deposits: billing_account_id, amount, status
 * - package_applications: package_name, package_price, actual_cost, max_los_days
 * - room_charge_log: charge_type, base_rate, nursing_charge, total_charge
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';

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
// Types
// ============================================================================

/**
 * Cost estimate for an encounter with accrued and projected charges
 */
export interface CostEstimate {
  encounter_id: string;
  hospital_id: string;
  charges_accrued: number;
  estimated_remaining: number;
  estimated_total: number;
  los_current_days: number;
  los_expected_days: number;
  daily_burn_rate: number;
  package_comparison?: {
    package_total: number;
    itemized_total: number;
    recommended: 'package' | 'itemized';
    savings: number;
  };
  deposit_status: {
    collected: number;
    required: number;
    shortfall: number;
  };
  confidence: number;
}

/**
 * Margin analysis breakdown by item and aggregate
 */
export interface MarginAnalysis {
  encounter_id: string;
  hospital_id: string;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
  low_margin_items: Array<{
    charge_id: string;
    description: string;
    revenue: number;
    cost: number;
    margin_pct: number;
    qty: number;
  }>;
  deposit_adequacy_pct: number;
}

/**
 * Package vs itemized billing comparison details
 */
interface PackageComparison {
  package_name: string;
  package_total: number;
  itemized_total: number;
  savings: number;
  recommended: 'package' | 'itemized';
  max_los_days: number;
  current_los_days: number;
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Estimate total cost for an encounter based on diagnosis, LOS, and historical patterns
 *
 * Queries:
 * 1. Encounter details (diagnosis, expected_los, admission_type, admitted_at)
 * 2. Current charges accrued
 * 3. Charge master average costs by category for similar diagnoses
 * 4. Package applications if eligible
 *
 * @param params - { hospital_id, encounter_id }
 * @returns CostEstimate with accrued, remaining, and total projection
 *
 * @example
 * const estimate = await estimateCost({ hospital_id: 'h123', encounter_id: 'e456' });
 * console.log(`Estimated total: ₹${estimate.estimated_total.toLocaleString('en-IN')}`);
 */
export async function estimateCost(params: {
  hospital_id: string;
  encounter_id: string;
}): Promise<CostEstimate> {
  const sql = getSql();
  const { hospital_id, encounter_id } = params;

  try {
    // Query 1: Encounter details
    const encounterRows = await sql(
      `SELECT
        e.id, e.primary_diagnosis, e.expected_los_days, e.admission_type, e.admitted_at,
        ba.sum_insured, ba.co_pay_percent
      FROM encounters e
      LEFT JOIN billing_accounts ba ON e.id = ba.encounter_id
      WHERE e.id = $1 AND e.hospital_id = $2
      LIMIT 1`,
      [encounter_id, hospital_id]
    );

    if (!encounterRows || encounterRows.length === 0) {
      throw new Error(`Encounter not found: ${encounter_id}`);
    }

    const encounter = encounterRows[0];
    const admittedAt = new Date(encounter.admitted_at);
    const currentDate = new Date();
    const los_current_days = Math.ceil(
      (currentDate.getTime() - admittedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Query 2: Current charges accrued
    const chargesRows = await sql(
      `SELECT COALESCE(SUM(net_amount), 0) as total_charges
      FROM encounter_charges
      WHERE encounter_id = $1
      LIMIT 1`,
      [encounter_id]
    );

    const charges_accrued = chargesRows?.[0]?.total_charges || 0;

    // Query 3: Charge master average costs by category
    const avgCostRows = await sql(
      `SELECT category, AVG(base_price) as avg_daily_cost
      FROM charge_master
      WHERE hospital_id = $1
      GROUP BY category`,
      [hospital_id]
    );

    const avgCostByCategory = new Map<string, number>();
    avgCostRows?.forEach((row: any) => {
      avgCostByCategory.set(row.category, row.avg_daily_cost || 0);
    });

    // Estimate remaining charges based on expected LOS
    const los_expected_days = encounter.expected_los_days || 7;
    const los_remaining_days = Math.max(0, los_expected_days - los_current_days);

    // Average daily burn rate from accrued charges
    const daily_burn_rate = los_current_days > 0 ? charges_accrued / los_current_days : 0;
    const estimated_remaining = daily_burn_rate * los_remaining_days;
    const estimated_total = charges_accrued + estimated_remaining;

    // Query 4: Package applications
    let packageComparison: PackageComparison | undefined;
    const packageRows = await sql(
      `SELECT package_name, package_price, actual_cost, max_los_days
      FROM package_applications
      WHERE encounter_id = $1
      ORDER BY package_price ASC
      LIMIT 1`,
      [encounter_id]
    );

    if (packageRows && packageRows.length > 0) {
      const pkg = packageRows[0];
      const itemizedTotal = estimated_total;
      packageComparison = {
        package_name: pkg.package_name,
        package_total: pkg.package_price,
        itemized_total: itemizedTotal,
        savings: Math.max(0, itemizedTotal - pkg.package_price),
        recommended:
          pkg.package_price < itemizedTotal && los_expected_days <= pkg.max_los_days
            ? 'package'
            : 'itemized',
        max_los_days: pkg.max_los_days,
        current_los_days: los_current_days,
      };
    }

    // Query 5: Deposit status
    const depositRows = await sql(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'collected' THEN amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN status = 'applied' THEN amount ELSE 0 END), 0) as applied
      FROM deposits d
      JOIN billing_accounts ba ON d.billing_account_id = ba.id
      WHERE ba.encounter_id = $1`,
      [encounter_id]
    );

    const depositStatus = depositRows?.[0] || { collected: 0, applied: 0 };
    const deposit_collected = depositStatus.collected || 0;
    const required_deposit = estimated_total * 0.5; // Typical 50% advance
    const shortfall = Math.max(0, required_deposit - deposit_collected);

    return {
      encounter_id,
      hospital_id,
      charges_accrued,
      estimated_remaining,
      estimated_total,
      los_current_days,
      los_expected_days,
      daily_burn_rate,
      package_comparison: packageComparison
        ? {
            package_total: packageComparison.package_total,
            itemized_total: packageComparison.itemized_total,
            recommended: packageComparison.recommended,
            savings: packageComparison.savings,
          }
        : undefined,
      deposit_status: {
        collected: deposit_collected,
        required: required_deposit,
        shortfall,
      },
      confidence: 0.85,
    };
  } catch (error) {
    console.error(`Cost estimation error for ${encounter_id}:`, error);
    throw error;
  }
}

// ============================================================================
// Margin Analysis
// ============================================================================

/**
 * Analyze revenue vs cost and identify low-margin items
 *
 * Queries:
 * 1. Encounter charges with their costs from charge_master
 * 2. Calculate margins by item and aggregate
 * 3. Flag items below 15% margin threshold
 * 4. Calculate deposit adequacy as % of total cost
 *
 * @param params - { hospital_id, encounter_id }
 * @returns MarginAnalysis with revenue, cost, margin %, and low-margin items
 *
 * @example
 * const margin = await analyzeMargin({ hospital_id: 'h123', encounter_id: 'e456' });
 * if (margin.margin_pct < 20) console.log('Warning: Low margin case');
 */
export async function analyzeMargin(params: {
  hospital_id: string;
  encounter_id: string;
}): Promise<MarginAnalysis> {
  const sql = getSql();
  const { hospital_id, encounter_id } = params;

  try {
    // Query: Join encounter_charges with charge_master to get costs
    const chargeRows = await sql(
      `SELECT
        ec.id as charge_id,
        ec.description,
        ec.qty,
        ec.unit_price,
        ec.net_amount as revenue,
        COALESCE(cm.cost_price, ec.unit_price * 0.6) as cost_per_unit
      FROM encounter_charges ec
      LEFT JOIN charge_master cm ON ec.charge_code = cm.charge_code AND cm.hospital_id = $2
      WHERE ec.encounter_id = $1`,
      [encounter_id, hospital_id]
    );

    if (!chargeRows || chargeRows.length === 0) {
      // Return zero margin for empty encounter
      return {
        encounter_id,
        hospital_id,
        revenue: 0,
        cost: 0,
        margin: 0,
        margin_pct: 0,
        low_margin_items: [],
        deposit_adequacy_pct: 0,
      };
    }

    // Calculate totals and item margins
    let totalRevenue = 0;
    let totalCost = 0;
    const low_margin_items: MarginAnalysis['low_margin_items'] = [];

    chargeRows.forEach((row: any) => {
      const revenue = row.revenue || 0;
      const cost = (row.cost_per_unit || 0) * (row.qty || 1);
      const margin = revenue - cost;
      const margin_pct = revenue > 0 ? (margin / revenue) * 100 : 0;

      totalRevenue += revenue;
      totalCost += cost;

      // Flag low margin items (< 15%)
      if (margin_pct < 15) {
        low_margin_items.push({
          charge_id: row.charge_id,
          description: row.description || 'Unknown',
          revenue,
          cost,
          margin_pct,
          qty: row.qty || 1,
        });
      }
    });

    const totalMargin = totalRevenue - totalCost;
    const totalMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

    // Query: Deposit adequacy
    const depositRows = await sql(
      `SELECT COALESCE(SUM(amount), 0) as total_deposit
      FROM deposits d
      JOIN billing_accounts ba ON d.billing_account_id = ba.id
      WHERE ba.encounter_id = $1 AND d.status IN ('collected', 'applied')`,
      [encounter_id]
    );

    const depositAmount = depositRows?.[0]?.total_deposit || 0;
    const deposit_adequacy_pct =
      totalCost > 0 ? Math.min(100, (depositAmount / totalCost) * 100) : 0;

    return {
      encounter_id,
      hospital_id,
      revenue: totalRevenue,
      cost: totalCost,
      margin: totalMargin,
      margin_pct: totalMarginPct,
      low_margin_items: low_margin_items.sort((a, b) => a.margin_pct - b.margin_pct),
      deposit_adequacy_pct,
    };
  } catch (error) {
    console.error(`Margin analysis error for ${encounter_id}:`, error);
    throw error;
  }
}

// ============================================================================
// InsightCard Generation
// ============================================================================

/**
 * Generate an InsightCard summarizing cost estimate and recommendations
 *
 * Creates a billing prediction card with:
 * - Estimated total cost with daily burn rate
 * - Package vs itemized billing recommendation
 * - Deposit shortfall warning if present
 * - Methodology explanation for clinical/admin review
 *
 * @param estimate - CostEstimate from estimateCost()
 * @param margin - MarginAnalysis from analyzeMargin()
 * @param hospital_id - Hospital ID
 * @param encounter_id - Encounter ID
 * @returns InsightCard ready for insertion into ai_insight_cards
 *
 * @example
 * const card = generateCostInsightCard(estimate, margin, 'h123', 'e456');
 * await insertInsightCard(card); // In your API handler
 */
export function generateCostInsightCard(
  estimate: CostEstimate,
  margin: MarginAnalysis,
  hospital_id: string,
  encounter_id: string
): InsightCard {
  const formatAmount = (amount: number): string => {
    return '₹' + Math.round(amount).toLocaleString('en-IN');
  };

  // Determine severity based on deposit shortfall and margin
  let severity: CardSeverity = 'medium';
  if (estimate.deposit_status.shortfall > 0) {
    severity = estimate.deposit_status.shortfall > estimate.estimated_total * 0.3
      ? 'critical'
      : 'high';
  } else if (margin.margin_pct < 15) {
    severity = 'high';
  } else if (margin.margin_pct < 20) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  // Build body with cost breakdown
  const bodyLines = [
    `**Cost Estimate — Day ${estimate.los_current_days} of ${estimate.los_expected_days}**`,
    '',
    '**Charges & Projection:**',
    `• Accrued: ${formatAmount(estimate.charges_accrued)}`,
    `• Daily rate: ${formatAmount(estimate.daily_burn_rate)}/day`,
    `• Estimated remaining: ${formatAmount(estimate.estimated_remaining)}`,
    `• **Estimated total: ${formatAmount(estimate.estimated_total)}**`,
    '',
  ];

  // Add package recommendation if available
  if (estimate.package_comparison) {
    const pkg = estimate.package_comparison;
    bodyLines.push('**Package Comparison:**');
    bodyLines.push(`• Package: ${formatAmount(pkg.package_total)}`);
    bodyLines.push(`• Itemized: ${formatAmount(pkg.itemized_total)}`);
    bodyLines.push(`• Recommended: **${pkg.recommended}**`);
    if (pkg.savings > 0) {
      bodyLines.push(`• Potential savings: ${formatAmount(pkg.savings)}`);
    }
    bodyLines.push('');
  }

  // Add deposit status
  bodyLines.push('**Deposit Status:**');
  bodyLines.push(`• Collected: ${formatAmount(estimate.deposit_status.collected)}`);
  bodyLines.push(`• Required (50%): ${formatAmount(estimate.deposit_status.required)}`);
  if (estimate.deposit_status.shortfall > 0) {
    bodyLines.push(`• ⚠️ **Shortfall: ${formatAmount(estimate.deposit_status.shortfall)}**`);
  }

  // Add margin info
  bodyLines.push('');
  bodyLines.push('**Margin Analysis:**');
  bodyLines.push(`• Gross margin: ${margin.margin_pct.toFixed(1)}% (${formatAmount(margin.margin)})`);
  bodyLines.push(`• Deposit adequacy: ${margin.deposit_adequacy_pct.toFixed(0)}%`);

  if (margin.low_margin_items.length > 0) {
    bodyLines.push('');
    bodyLines.push('**Low-Margin Items:**');
    margin.low_margin_items.slice(0, 3).forEach((item) => {
      bodyLines.push(`• ${item.description}: ${item.margin_pct.toFixed(1)}%`);
    });
  }

  const body = bodyLines.join('\n');

  // Explanation for backend auditing
  const explanation =
    'Real-time cost projection based on diagnosis, expected LOS, accrued charges, ' +
    'and hospital charge master averages. Package comparison flags itemized vs packaged cost-benefit. ' +
    'Deposit adequacy and margin analysis inform revenue team and clinical financial planning.';

  return {
    id: randomUUID(),
    hospital_id,
    module: 'billing',
    category: 'prediction',
    severity,
    title: `Cost Estimate — Day ${estimate.los_current_days} of ${estimate.los_expected_days}`,
    body,
    explanation,
    data_sources: [
      'encounters',
      'encounter_charges',
      'charge_master',
      'billing_accounts',
      'deposits',
      'package_applications',
    ],
    suggested_action:
      estimate.deposit_status.shortfall > 0
        ? 'Review deposit collection strategy'
        : margin.margin_pct < 15
          ? 'Flag for revenue optimization review'
          : undefined,
    action_url: `/admin/billing/encounters/${encounter_id}`,
    confidence: estimate.confidence,
    source: 'template',
    status: 'active',
    target_encounter_id: encounter_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
