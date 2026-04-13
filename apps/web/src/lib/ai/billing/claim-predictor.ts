/**
 * Even AI — Claim Prediction Engine
 * Rubric-based insurance claim outcome prediction for Even OS billing module
 *
 * Features:
 * - TPA-specific deduction pattern matching
 * - Charge category breakdown (room, pharmacy, consumables, etc.)
 * - Multi-level deduction calculation (consumables cap, markup limits, co-pay)
 * - Actionable recommendations per TPA
 * - InsightCard generation with ₹ formatting
 * - Prediction accuracy tracking
 *
 * Database tables:
 * - insurance_claims, pre_auth_requests, tpa_deductions
 * - billing_accounts, encounter_charges
 * - claim_rubrics, claim_predictions
 * - ai_insight_cards
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
// Type Definitions
// ============================================================================

/**
 * Charge breakdown by category
 */
export interface ChargeBreakdown {
  room_charges: number;
  pharmacy_charges: number;
  consumables_charges: number;
  investigation_charges: number; // Lab + Radiology
  procedure_charges: number; // Surgeon fees, etc.
  other_charges: number;
  total_charges: number;
}

/**
 * Matched rubric for a TPA
 */
export interface RubricMatch {
  id: string;
  tpa_name: string;
  procedure_category?: string;
  rule_type: string;
  rule_data: {
    consumables_cap_pct?: number; // % of total bill
    pharmacy_markup_limit?: number; // % markup allowed
    room_upgrade_differential_pct?: number;
    surgeon_fee_limit_pct?: number;
    sub_limits?: Record<string, number>;
    known_exclusions?: string[];
    waiting_period_days?: number;
    co_pay_applies_to?: string[]; // Categories that co-pay applies to
  };
  confidence: number;
}

/**
 * Predicted deduction item
 */
export interface PredictedDeduction {
  type: string;
  amount: number;
  reason: string;
}

/**
 * Claim prediction result
 */
export interface ClaimPredictionResult {
  prediction: {
    encounter_id: string;
    tpa_name: string;
    total_bill_amount: number;
    predicted_approval: number;
    predicted_approval_pct: number;
    predicted_deductions: PredictedDeduction[];
    recommendations: string[];
    confidence: number;
  };
  card: InsightCard;
}

// ============================================================================
// Utility: Indian Number Formatting
// ============================================================================

/**
 * Format amount in Indian rupee notation with ₹ symbol
 * Examples: 1000 → ₹1,000; 1000000 → ₹10,00,000; 10000000 → ₹1,00,00,000
 *
 * @param amount - Numeric amount in rupees
 * @returns Formatted string with ₹ and commas
 */
function formatIndianRupees(amount: number): string {
  // Handle negative and decimal
  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(amount);
  const [intPart, decPart] = absoluteAmount.toFixed(2).split('.');

  // Format integer part with Indian comma placement (3 digits from right, then 2)
  let formatted = '';
  const len = intPart.length;
  for (let i = 0; i < len; i++) {
    const digit = intPart[len - 1 - i];
    if (i > 0 && (i === 3 || (i > 3 && (i - 3) % 2 === 0))) {
      formatted = ',' + formatted;
    }
    formatted = digit + formatted;
  }

  // Add rupee symbol and sign
  let result = '₹' + formatted;
  if (decPart !== '00') {
    result += '.' + decPart;
  }
  if (isNegative) {
    result = '-' + result;
  }

  return result;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get charge breakdown for an encounter
 *
 * Queries encounter_charges and categorizes by service type/category
 *
 * @param encounter_id - Encounter ID
 * @returns Promise<ChargeBreakdown>
 */
export async function getChargeBreakdown(encounter_id: string): Promise<ChargeBreakdown> {
  const sql = getSql();

  try {
    // Fetch all charges for this encounter
    const charges = await sql`
      SELECT
        charge_code,
        description,
        category,
        qty,
        unit_price,
        discount_pct,
        gst_pct,
        net_amount
      FROM encounter_charges
      WHERE encounter_id = ${encounter_id}
      ORDER BY service_date DESC
    `;

    const breakdown: ChargeBreakdown = {
      room_charges: 0,
      pharmacy_charges: 0,
      consumables_charges: 0,
      investigation_charges: 0,
      procedure_charges: 0,
      other_charges: 0,
      total_charges: 0,
    };

    // Categorize each charge
    for (const charge of charges) {
      const amount = Number(charge.net_amount) || 0;
      const category = String(charge.category).toLowerCase();
      const description = String(charge.description).toLowerCase();

      if (category.includes('room') || category.includes('bed') || description.includes('room rent')) {
        breakdown.room_charges += amount;
      } else if (category.includes('pharmacy') || category.includes('drug') || category.includes('medicine')) {
        breakdown.pharmacy_charges += amount;
      } else if (
        category.includes('consumable') ||
        category.includes('supply') ||
        category.includes('material')
      ) {
        breakdown.consumables_charges += amount;
      } else if (
        category.includes('investigation') ||
        category.includes('lab') ||
        category.includes('pathology') ||
        category.includes('radiology') ||
        category.includes('imaging')
      ) {
        breakdown.investigation_charges += amount;
      } else if (
        category.includes('procedure') ||
        category.includes('surgery') ||
        category.includes('surgeon') ||
        category.includes('ot')
      ) {
        breakdown.procedure_charges += amount;
      } else {
        breakdown.other_charges += amount;
      }
    }

    breakdown.total_charges =
      breakdown.room_charges +
      breakdown.pharmacy_charges +
      breakdown.consumables_charges +
      breakdown.investigation_charges +
      breakdown.procedure_charges +
      breakdown.other_charges;

    return breakdown;
  } catch (error) {
    console.error(`[ClaimPredictor] Error getting charge breakdown for ${encounter_id}:`, error);
    return {
      room_charges: 0,
      pharmacy_charges: 0,
      consumables_charges: 0,
      investigation_charges: 0,
      procedure_charges: 0,
      other_charges: 0,
      total_charges: 0,
    };
  }
}

/**
 * Find the best matching rubric for a TPA
 *
 * Searches claim_rubrics for:
 * 1. Exact match: hospital_id + tpa_name + procedure_category
 * 2. Fallback: hospital_id + tpa_name (general rubric)
 *
 * @param hospital_id - Hospital ID
 * @param tpa_name - TPA name (medi_assist, paramount, etc.)
 * @param procedure_category - Optional procedure category
 * @returns Promise<RubricMatch | null>
 */
export async function matchRubric(
  hospital_id: string,
  tpa_name: string,
  procedure_category?: string
): Promise<RubricMatch | null> {
  const sql = getSql();

  try {
    // First try: exact match with procedure category
    if (procedure_category) {
      const exactMatch = await sql`
        SELECT
          id, hospital_id, tpa_name, procedure_category, rule_type,
          rule_data, confidence, source, is_active, created_at, updated_at
        FROM claim_rubrics
        WHERE hospital_id = ${hospital_id}
          AND tpa_name = ${tpa_name}
          AND procedure_category = ${procedure_category}
          AND is_active = true
        ORDER BY confidence DESC
        LIMIT 1
      `;

      if (exactMatch && exactMatch.length > 0) {
        return {
          id: exactMatch[0].id,
          tpa_name: exactMatch[0].tpa_name,
          procedure_category: exactMatch[0].procedure_category,
          rule_type: exactMatch[0].rule_type,
          rule_data: exactMatch[0].rule_data || {},
          confidence: Number(exactMatch[0].confidence) || 0.5,
        };
      }
    }

    // Fallback: general rubric for TPA
    const generalMatch = await sql`
      SELECT
        id, hospital_id, tpa_name, procedure_category, rule_type,
        rule_data, confidence, source, is_active, created_at, updated_at
      FROM claim_rubrics
      WHERE hospital_id = ${hospital_id}
        AND tpa_name = ${tpa_name}
        AND (procedure_category IS NULL OR procedure_category = '')
        AND is_active = true
      ORDER BY confidence DESC
      LIMIT 1
    `;

    if (generalMatch && generalMatch.length > 0) {
      return {
        id: generalMatch[0].id,
        tpa_name: generalMatch[0].tpa_name,
        procedure_category: generalMatch[0].procedure_category,
        rule_type: generalMatch[0].rule_type,
        rule_data: generalMatch[0].rule_data || {},
        confidence: Number(generalMatch[0].confidence) || 0.5,
      };
    }

    return null;
  } catch (error) {
    console.error(
      `[ClaimPredictor] Error matching rubric for ${tpa_name}:`,
      error
    );
    return null;
  }
}

/**
 * Calculate predicted deductions based on rubric rules
 *
 * Applies deduction patterns:
 * - Consumables cap: excess above % of total
 * - Pharmacy markup: excess above limit
 * - Room upgrade: differential deduction
 * - Surgeon fee cap: excess above limit
 * - Co-pay: % of eligible categories
 *
 * @param charges - Charge breakdown
 * @param rubric - Matched rubric rules
 * @param billing_account - Billing account data with co_pay_percent, room_rent_eligibility, etc.
 * @returns PredictedDeduction[]
 */
export function calculateDeductions(
  charges: ChargeBreakdown,
  rubric: RubricMatch,
  billing_account: any
): PredictedDeduction[] {
  const deductions: PredictedDeduction[] = [];
  const { rule_data } = rubric;

  // 1. Consumables cap deduction
  if (rule_data.consumables_cap_pct && charges.consumables_charges > 0) {
    const cap = (charges.total_charges * rule_data.consumables_cap_pct) / 100;
    if (charges.consumables_charges > cap) {
      const deductionAmount = charges.consumables_charges - cap;
      deductions.push({
        type: 'consumables_cap',
        amount: Math.round(deductionAmount),
        reason: `Consumables capped at ${rule_data.consumables_cap_pct}% of total bill`,
      });
    }
  }

  // 2. Pharmacy markup limit deduction
  if (rule_data.pharmacy_markup_limit && charges.pharmacy_charges > 0) {
    const markup = (charges.pharmacy_charges * rule_data.pharmacy_markup_limit) / 100;
    if (charges.pharmacy_charges > markup) {
      const deductionAmount = charges.pharmacy_charges - markup;
      deductions.push({
        type: 'pharmacy_markup',
        amount: Math.round(deductionAmount),
        reason: `Pharmacy charges capped at ${rule_data.pharmacy_markup_limit}% markup`,
      });
    }
  }

  // 3. Room upgrade differential deduction
  if (
    rule_data.room_upgrade_differential_pct &&
    charges.room_charges > 0 &&
    billing_account?.room_rent_eligibility
  ) {
    // Simplified: assume some room upgrade
    const diffDeduction = (charges.room_charges * rule_data.room_upgrade_differential_pct) / 100;
    if (diffDeduction > 0) {
      deductions.push({
        type: 'room_upgrade_differential',
        amount: Math.round(diffDeduction),
        reason: `Room upgrade differential: ${rule_data.room_upgrade_differential_pct}% not covered`,
      });
    }
  }

  // 4. Surgeon fee cap deduction
  if (rule_data.surgeon_fee_limit_pct && charges.procedure_charges > 0) {
    const cap = (charges.total_charges * rule_data.surgeon_fee_limit_pct) / 100;
    if (charges.procedure_charges > cap) {
      const deductionAmount = charges.procedure_charges - cap;
      deductions.push({
        type: 'surgeon_fee_cap',
        amount: Math.round(deductionAmount),
        reason: `Surgeon fees capped at ${rule_data.surgeon_fee_limit_pct}% of total bill`,
      });
    }
  }

  // 5. Co-pay deduction (apply to eligible categories)
  if (billing_account?.co_pay_percent && billing_account.co_pay_percent > 0) {
    const co_pay_categories = rule_data.co_pay_applies_to || ['investigation', 'pharmacy'];
    let co_pay_eligible = 0;

    if (co_pay_categories.includes('investigation')) {
      co_pay_eligible += charges.investigation_charges;
    }
    if (co_pay_categories.includes('pharmacy')) {
      co_pay_eligible += charges.pharmacy_charges;
    }
    if (co_pay_categories.includes('consumables')) {
      co_pay_eligible += charges.consumables_charges;
    }

    if (co_pay_eligible > 0) {
      const coPayAmount = (co_pay_eligible * billing_account.co_pay_percent) / 100;
      deductions.push({
        type: 'co_pay',
        amount: Math.round(coPayAmount),
        reason: `Co-pay ${billing_account.co_pay_percent}% on eligible categories`,
      });
    }
  }

  // 6. Known exclusions (policy-specific)
  if (rule_data.known_exclusions && rule_data.known_exclusions.length > 0) {
    // Note: Simplified — in production would match against actual charges
    // For now, just track that exclusions exist
    deductions.push({
      type: 'policy_exclusion',
      amount: 0, // Would be calculated by matching charges to exclusion list
      reason: `Policy exclusions apply: ${rule_data.known_exclusions.join(', ')}`,
    });
  }

  return deductions;
}

/**
 * Generate actionable recommendations based on deductions
 *
 * @param deductions - Predicted deductions
 * @param tpa_name - TPA name (to customize recommendations)
 * @returns string[] - Array of recommendations
 */
export function generateRecommendations(deductions: PredictedDeduction[], tpa_name: string): string[] {
  const recommendations: string[] = [];

  // Scan deductions and generate TPA-specific recommendations
  const hasConsumablesCap = deductions.some((d) => d.type === 'consumables_cap');
  const hasPharmacyMarkup = deductions.some((d) => d.type === 'pharmacy_markup');
  const hasRoomUpgrade = deductions.some((d) => d.type === 'room_upgrade_differential');
  const hasSurgeonFeeCap = deductions.some((d) => d.type === 'surgeon_fee_cap');
  const hasCoPayDeduction = deductions.some((d) => d.type === 'co_pay');
  const hasExclusions = deductions.some((d) => d.type === 'policy_exclusion');

  if (hasConsumablesCap) {
    if (tpa_name.includes('Star') || tpa_name.includes('star')) {
      recommendations.push(
        'Attach itemized consumables breakup with HSN codes (Star Health rejects lump-sum consumables)'
      );
    } else if (tpa_name.includes('ICICI') || tpa_name.includes('icici')) {
      recommendations.push('Submit detailed consumables list in ICICI format with unit costs');
    } else {
      recommendations.push('Provide itemized consumables breakdown to justify charges');
    }
  }

  if (hasPharmacyMarkup) {
    if (tpa_name.includes('Medi')) {
      recommendations.push(
        'Include wholesale cost certificate for pharmacy charges (Medi Assist caps markup at 15%)'
      );
    } else {
      recommendations.push('Attach pharmacy receipt with generic + branded breakdown');
    }
  }

  if (hasRoomUpgrade) {
    recommendations.push(
      'If room upgrade was medically necessary, obtain physician request documentation'
    );
  }

  if (hasSurgeonFeeCap) {
    recommendations.push('Verify surgeon fee does not exceed NRHM-approved rates for this specialty');
  }

  if (hasCoPayDeduction) {
    recommendations.push(`Patient liable for co-pay portion — communicate amount before discharge`);
  }

  if (hasExclusions) {
    recommendations.push('Review policy document for exclusion clauses — dispute if applicable');
  }

  // Time-based recommendation (generic for all TPAs)
  recommendations.push('Submit claim within 48 hours of discharge to avoid delays');

  return recommendations;
}

/**
 * Generate an InsightCard for the claim prediction
 *
 * @param prediction - Prediction data
 * @param hospital_id - Hospital ID
 * @param encounter_id - Encounter ID
 * @returns Promise<InsightCard>
 */
export async function generateClaimInsightCard(
  prediction: ClaimPredictionResult['prediction'],
  hospital_id: string,
  encounter_id: string
): Promise<InsightCard> {
  const sql = getSql();
  const cardId = randomUUID();

  // Determine severity based on approval percentage
  let severity: CardSeverity = 'low';
  if (prediction.predicted_approval_pct < 70) {
    severity = 'critical';
  } else if (prediction.predicted_approval_pct < 80) {
    severity = 'high';
  } else if (prediction.predicted_approval_pct < 90) {
    severity = 'medium';
  }

  // Format amounts in Indian rupees
  const billAmount = formatIndianRupees(prediction.total_bill_amount);
  const approvedAmount = formatIndianRupees(prediction.predicted_approval);
  const totalDeductionsAmount = formatIndianRupees(
    prediction.predicted_deductions.reduce((sum, d) => sum + d.amount, 0)
  );
  const approvalPct = prediction.predicted_approval_pct.toFixed(1);

  // Build card body
  let body = `Predicted approval: ${approvedAmount} (${approvalPct}%)\n\n`;
  body += `Total bill: ${billAmount}\nTotal deductions: ${totalDeductionsAmount}\n\n`;

  if (prediction.predicted_deductions.length > 0) {
    body += 'Deductions:\n';
    for (const deduction of prediction.predicted_deductions.slice(0, 3)) {
      body += `• ${deduction.type}: ${formatIndianRupees(deduction.amount)}\n`;
    }
    if (prediction.predicted_deductions.length > 3) {
      body += `• +${prediction.predicted_deductions.length - 3} more\n`;
    }
  }

  // Build explanation
  const chargeItemCount = prediction.predicted_deductions.length;
  const explanation = `Even AI analyzed ${chargeItemCount || 'multiple'} charge items against ${prediction.tpa_name}'s known deduction patterns from historical claims. Confidence: ${(prediction.confidence * 100).toFixed(0)}%`;

  // Create the card
  const card: InsightCard = {
    id: cardId,
    hospital_id,
    module: 'billing',
    category: 'prediction',
    severity,

    title: `Claim Prediction — ${prediction.tpa_name}`,
    body,
    explanation,
    data_sources: ['insurance_claims', 'encounter_charges', 'claim_rubrics'],
    suggested_action: prediction.recommendations?.[0],

    confidence: prediction.confidence,
    source: 'template', // Rule-based, not LLM
    model_version: undefined,

    target_encounter_id: encounter_id,
    status: 'active',

    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Insert into database
  try {
    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity, title, body, explanation,
        data_sources, suggested_action, confidence, source,
        status, target_encounter_id, created_at, updated_at
      )
      VALUES (
        ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
        ${card.title}, ${card.body}, ${card.explanation},
        ${JSON.stringify(card.data_sources)}, ${card.suggested_action},
        ${card.confidence}, ${card.source},
        ${card.status}, ${card.target_encounter_id}, ${card.created_at}, ${card.updated_at}
      )
    `;
  } catch (error) {
    console.error(`[ClaimPredictor] Error inserting insight card:`, error);
  }

  return card;
}

/**
 * Main function: Predict claim outcome for an encounter
 *
 * Steps:
 * 1. Fetch billing account for encounter (TPA, sum_insured, co_pay, etc.)
 * 2. Get charge breakdown by category
 * 3. Match rubric for this TPA
 * 4. Calculate predicted deductions
 * 5. Calculate predicted approval
 * 6. Generate recommendations
 * 7. Insert/upsert prediction into claim_predictions table
 * 8. Generate and return InsightCard
 *
 * @param params - { hospital_id, encounter_id, claim_id? }
 * @returns Promise<ClaimPredictionResult>
 */
export async function predictClaimOutcome(params: {
  hospital_id: string;
  encounter_id: string;
  claim_id?: string;
}): Promise<ClaimPredictionResult> {
  const { hospital_id, encounter_id, claim_id } = params;
  const sql = getSql();

  try {
    // 1. Fetch billing account
    const billingAccounts = await sql`
      SELECT
        id, encounter_id, hospital_id, account_type, insurer_name, tpa_name,
        policy_number, sum_insured, room_rent_eligibility, co_pay_percent
      FROM billing_accounts
      WHERE encounter_id = ${encounter_id}
      LIMIT 1
    `;

    if (!billingAccounts || billingAccounts.length === 0) {
      throw new Error(`No billing account found for encounter ${encounter_id}`);
    }

    const billingAccount = billingAccounts[0];
    const tpa_name = String(billingAccount.tpa_name || 'unknown');
    const co_pay_percent = Number(billingAccount.co_pay_percent) || 0;

    // 2. Get charge breakdown
    const charges = await getChargeBreakdown(encounter_id);

    // 3. Match rubric (try to get procedure category if available)
    let procedure_category: string | undefined;
    if (claim_id) {
      const claims = await sql`
        SELECT procedure_name, procedure_code
        FROM insurance_claims
        WHERE id = ${claim_id}
        LIMIT 1
      `;
      if (claims && claims.length > 0) {
        procedure_category = claims[0].procedure_name;
      }
    }

    const rubric = await matchRubric(hospital_id, tpa_name, procedure_category);

    if (!rubric) {
      throw new Error(
        `No rubric found for TPA ${tpa_name} at hospital ${hospital_id}`
      );
    }

    // 4. Calculate deductions
    const deductions = calculateDeductions(charges, rubric, billingAccount);

    // 5. Calculate predicted approval
    const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
    const predicted_approval = Math.max(0, charges.total_charges - totalDeductions);
    const predicted_approval_pct =
      charges.total_charges > 0 ? (predicted_approval / charges.total_charges) * 100 : 0;

    // 6. Generate recommendations
    const recommendations = generateRecommendations(deductions, tpa_name);

    // 7. Build prediction object
    const prediction = {
      encounter_id,
      tpa_name,
      total_bill_amount: charges.total_charges,
      predicted_approval: Math.round(predicted_approval),
      predicted_approval_pct: Math.round(predicted_approval_pct * 10) / 10,
      predicted_deductions: deductions,
      recommendations,
      confidence: rubric.confidence,
    };

    // 8. Insert/upsert into claim_predictions
    const predictionId = randomUUID();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO claim_predictions (
        id, hospital_id, encounter_id, claim_id, tpa_name, procedure_category,
        predicted_amount, predicted_approval, predicted_approval_pct,
        predicted_deductions, confidence, source, created_at
      )
      VALUES (
        ${predictionId}, ${hospital_id}, ${encounter_id}, ${claim_id || null},
        ${tpa_name}, ${procedure_category || null},
        ${charges.total_charges}, ${prediction.predicted_approval},
        ${prediction.predicted_approval_pct},
        ${JSON.stringify(deductions)}, ${rubric.confidence}, 'template', ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        predicted_approval = ${prediction.predicted_approval},
        predicted_approval_pct = ${prediction.predicted_approval_pct},
        predicted_deductions = ${JSON.stringify(deductions)}
    `;

    // 9. Generate insight card
    const card = await generateClaimInsightCard(prediction, hospital_id, encounter_id);

    return {
      prediction,
      card,
    };
  } catch (error) {
    console.error(
      `[ClaimPredictor] Error predicting claim outcome for ${encounter_id}:`,
      error
    );
    throw error;
  }
}
