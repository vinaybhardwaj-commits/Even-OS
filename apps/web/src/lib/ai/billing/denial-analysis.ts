/**
 * Even AI — Denial Analysis Engine
 * Claim denial categorization, root cause identification, and resubmission recommendations
 *
 * Features:
 * - Denial type classification (full, partial, deduction-heavy, documentation gap, policy exclusion)
 * - Deduction breakdown and categorization
 * - LLM-powered root cause analysis with graceful fallback to template-based analysis
 * - Systemic pattern detection (recurring issues by TPA/deduction type)
 * - Resubmission checklist generation per deduction type
 * - InsightCard generation with high severity
 *
 * Database tables:
 * - insurance_claims, tpa_deductions, claim_events, pre_auth_requests
 * - claim_rubrics (for TPA patterns)
 * - ai_insight_cards, ai_audit_log
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import { generateInsight } from '../llm-client';
import type { InsightCard } from '../types';

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

export type DenialType = 'full_denial' | 'partial_denial' | 'deduction_heavy' | 'documentation_gap' | 'policy_exclusion';

/**
 * Deduction breakdown summary
 */
export interface DeductionBreakdown {
  category: string;
  amount: number;
  count: number;
  percent_of_total: number;
  examples: string[];
}

/**
 * Complete denial analysis result
 */
export interface DenialAnalysis {
  claim_id: string;
  claim_number?: string;
  tpa_name?: string;
  denial_type: DenialType;
  total_bill_amount: number;
  approved_amount: number;
  total_deductions: number;
  denial_percent: number;
  deduction_breakdown: DeductionBreakdown[];
  root_cause: string;
  recommendations: string[];
  resubmission_viable: boolean;
  resubmission_checklist: string[];
  systemic_pattern?: string;
  card: InsightCard;
}

/**
 * Systemic pattern in denials
 */
export interface DenialPattern {
  pattern_type: 'category_repeat' | 'reason_repeat' | 'increasing_rate';
  description: string;
  frequency: number;
  severity: 'low' | 'medium' | 'high';
}

// ============================================================================
// Utility: Indian Number Formatting
// ============================================================================

/**
 * Format amount in Indian rupee notation
 * Examples: 1000 → ₹1,000; 1000000 → ₹10,00,000
 */
function formatIndianRupees(amount: number): string {
  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(amount);
  const [intPart, decPart] = absoluteAmount.toFixed(2).split('.');

  let formatted = '';
  const len = intPart.length;
  for (let i = 0; i < len; i++) {
    const digit = intPart[len - 1 - i];
    if (i > 0 && (i === 3 || (i > 3 && (i - 3) % 2 === 0))) {
      formatted = ',' + formatted;
    }
    formatted = digit + formatted;
  }

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
// Core: Denial Analysis
// ============================================================================

/**
 * Analyze a claim denial: categorize, breakdown deductions, identify root cause
 *
 * Steps:
 * 1. Fetch claim, deductions, events, pre-auth
 * 2. Categorize denial type
 * 3. Sum and group deductions by category
 * 4. Call LLM for root cause analysis (or fallback to template)
 * 5. Generate resubmission checklist
 * 6. Detect systemic patterns
 * 7. Create InsightCard
 * 8. Persist card to ai_insight_cards
 *
 * @param params.hospital_id - Hospital identifier
 * @param params.claim_id - Claim ID to analyze
 * @returns Promise<DenialAnalysis>
 */
export async function analyzeDenial(params: {
  hospital_id: string;
  claim_id: string;
}): Promise<DenialAnalysis> {
  const { hospital_id, claim_id } = params;
  const sql = getSql();

  // ---- 1. Fetch claim details ----
  const claimResult = await sql`
    SELECT
      id,
      claim_number,
      tpa,
      insurer_name,
      total_bill_amount,
      approved_amount,
      total_deductions,
      status,
      primary_diagnosis,
      procedure_name,
      icd_code
    FROM insurance_claims
    WHERE id = ${claim_id} AND hospital_id = ${hospital_id}
    LIMIT 1
  `;

  if (!claimResult || claimResult.length === 0) {
    throw new Error(`Claim ${claim_id} not found`);
  }

  const claim = claimResult[0];
  const totalBill = Number(claim.total_bill_amount) || 0;
  const approvedAmount = Number(claim.approved_amount) || 0;
  const totalDeductions = Number(claim.total_deductions) || 0;

  // ---- 2. Fetch deductions grouped by category ----
  const deductionsResult = await sql`
    SELECT
      category,
      COUNT(*) as count,
      SUM(amount) as total_amount,
      STRING_AGG(DISTINCT description, ', ') as examples
    FROM tpa_deductions
    WHERE claim_id = ${claim_id} AND hospital_id = ${hospital_id}
    GROUP BY category
    ORDER BY total_amount DESC
  `;

  const deductionBreakdown: DeductionBreakdown[] = deductionsResult.map((row: any) => ({
    category: row.category,
    amount: Number(row.total_amount) || 0,
    count: Number(row.count) || 0,
    percent_of_total: totalDeductions > 0 ? ((Number(row.total_amount) || 0) / totalDeductions) * 100 : 0,
    examples: (row.examples || '').split(', ').filter(Boolean),
  }));

  // ---- 3. Fetch claim events (timeline) ----
  const eventsResult = await sql`
    SELECT
      event_type,
      from_status,
      to_status,
      description,
      performed_at
    FROM claim_events
    WHERE claim_id = ${claim_id} AND hospital_id = ${hospital_id}
    ORDER BY performed_at DESC
    LIMIT 20
  `;

  // ---- 4. Fetch pre-auth if exists ----
  const preAuthResult = await sql`
    SELECT
      requested_amount,
      approved_amount,
      rejection_reason,
      conditions,
      status
    FROM pre_auth_requests
    WHERE claim_id = ${claim_id} AND hospital_id = ${hospital_id}
    LIMIT 1
  `;

  const preAuth = preAuthResult?.[0] || null;

  // ---- 5. Categorize denial type ----
  const denialType = categorizeDenial({
    status: claim.status,
    totalBill,
    approvedAmount,
    totalDeductions,
    deductionBreakdown,
    preAuthRejected: preAuth?.status === 'rejected',
    preAuthReason: preAuth?.rejection_reason,
  });

  // ---- 6. Get resubmission checklist ----
  const resubmissionChecklist = getResubmissionChecklist(claim_id, deductionBreakdown);
  const resubmissionViable = denialType !== 'full_denial' && totalDeductions < totalBill * 0.5;

  // ---- 7. Detect systemic patterns ----
  const systemicPattern = (await detectSystemicPatterns(hospital_id, claim.tpa || claim.insurer_name)) ?? undefined;

  // ---- 8. Generate root cause (LLM or template) ----
  const analysisText = generateAnalysisPrompt({
    claimNumber: claim.claim_number,
    tpaName: claim.tpa || claim.insurer_name,
    totalBill,
    approvedAmount,
    totalDeductions,
    denialType,
    deductionBreakdown,
    diagnosis: claim.primary_diagnosis,
    procedure: claim.procedure_name,
    preAuth,
    systemicPattern,
  });

  let rootCause = '';
  let recommendations: string[] = [];
  let source: 'llm' | 'template' = 'template';

  try {
    const llmResponse = await generateInsight({
      hospital_id,
      module: 'billing',
      system_prompt: `You are an expert medical billing analyst specializing in insurance claim denials.
Analyze the following claim denial and provide:
1. Root cause (1-2 sentences)
2. Top 3 specific recommendations for resubmission or appeal`,
      user_prompt: analysisText,
      max_tokens: 300,
      temperature: 0.5,
      triggered_by: 'event',
    });

    if (llmResponse) {
      source = 'llm';
      const response = llmResponse.content;

      // Parse LLM response (expect "Root cause: ...\n\nRecommendations:\n- ...")
      const rootCauseMatch = response.match(/root\s+cause:\s*(.+?)(?:\n|$)/i);
      if (rootCauseMatch) {
        rootCause = rootCauseMatch[1].trim();
      }

      const recommendationsMatch = response.match(/recommendations?:\s*(.+?)$/is);
      if (recommendationsMatch) {
        recommendations = recommendationsMatch[1]
          .split(/\n/)
          .map(line => line.replace(/^[-•*]\s*/, '').trim())
          .filter(line => line.length > 0);
      }
    }
  } catch (err) {
    // LLM unavailable, use template
    console.warn('[Denial Analysis] LLM unavailable, using template:', err);
  }

  // Fallback to template if LLM failed
  if (!rootCause) {
    rootCause = templateRootCause(denialType, deductionBreakdown, systemicPattern);
    recommendations = templateRecommendations(denialType, deductionBreakdown);
  }

  // ---- 9. Create InsightCard ----
  const cardId = randomUUID();
  const card = generateDenialInsightCard({
    claim_id,
    claim_number: claim.claim_number || claim_id,
    tpa_name: claim.tpa || claim.insurer_name,
    hospital_id,
    denial_type: denialType,
    total_bill_amount: totalBill,
    total_deductions: totalDeductions,
    approved_amount: approvedAmount,
    denial_percent: totalBill > 0 ? (totalDeductions / totalBill) * 100 : 0,
    deduction_breakdown: deductionBreakdown,
    root_cause: rootCause,
    recommendations,
    resubmission_viable: resubmissionViable,
    resubmission_checklist: resubmissionChecklist,
    systemic_pattern: systemicPattern,
    source,
    card_id: cardId,
  });

  // ---- 10. Persist card ----
  try {
    await sql`
      INSERT INTO ai_insight_cards (
        id,
        hospital_id,
        module,
        category,
        severity,
        title,
        body,
        explanation,
        data_sources,
        suggested_action,
        action_url,
        confidence,
        source,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${card.id},
        ${card.hospital_id},
        ${card.module},
        ${card.category},
        ${card.severity},
        ${card.title},
        ${card.body},
        ${card.explanation},
        ${JSON.stringify(card.data_sources)},
        ${card.suggested_action},
        ${card.action_url},
        ${card.confidence},
        ${card.source},
        ${card.status},
        NOW(),
        NOW()
      )
    `;
  } catch (err) {
    console.error('[Denial Analysis] Failed to persist card:', err);
  }

  return {
    claim_id,
    claim_number: claim.claim_number,
    tpa_name: claim.tpa || claim.insurer_name,
    denial_type: denialType,
    total_bill_amount: totalBill,
    approved_amount: approvedAmount,
    total_deductions: totalDeductions,
    denial_percent: totalBill > 0 ? (totalDeductions / totalBill) * 100 : 0,
    deduction_breakdown: deductionBreakdown,
    root_cause: rootCause,
    recommendations,
    resubmission_viable: resubmissionViable,
    resubmission_checklist: resubmissionChecklist,
    systemic_pattern: systemicPattern,
    card,
  };
}

// ============================================================================
// Denial Categorization
// ============================================================================

/**
 * Categorize denial into one of five types
 */
function categorizeDenial(params: {
  status: string;
  totalBill: number;
  approvedAmount: number;
  totalDeductions: number;
  deductionBreakdown: DeductionBreakdown[];
  preAuthRejected: boolean;
  preAuthReason?: string;
}): DenialType {
  const { status, totalBill, approvedAmount, totalDeductions, deductionBreakdown, preAuthRejected, preAuthReason } = params;

  // Full denial: nothing approved
  if (approvedAmount === 0 || status === 'rejected') {
    return 'full_denial';
  }

  // Documentation gap: pre-auth rejected for missing docs
  if (preAuthRejected && preAuthReason && preAuthReason.toLowerCase().includes('document')) {
    return 'documentation_gap';
  }

  // Policy exclusion: deductions mention policy exclusion or procedure exclusion
  const hasExclusion = deductionBreakdown.some(d =>
    d.category === 'policy_exclusion' || d.examples.some(e => e.toLowerCase().includes('exclusion'))
  );
  if (hasExclusion) {
    return 'policy_exclusion';
  }

  // Deduction-heavy: many small deductions (count > 5) or total deductions > 40% of bill
  if (deductionBreakdown.reduce((sum, d) => sum + d.count, 0) > 5 || (totalDeductions / totalBill) > 0.4) {
    return 'deduction_heavy';
  }

  // Default: partial denial
  return 'partial_denial';
}

// ============================================================================
// Systemic Pattern Detection
// ============================================================================

/**
 * Detect recurring patterns in denials for a specific TPA
 * Looks for same deduction categories, reasons, or increasing rates in last 30 days
 *
 * @param hospital_id - Hospital identifier
 * @param tpa_name - TPA or insurer name
 * @returns Promise<string | null> - Pattern description or null
 */
export async function detectSystemicPatterns(hospital_id: string, tpa_name: string): Promise<string | null> {
  const sql = getSql();

  try {
    // Fetch recent denials (last 30 days) for this TPA
    const recentDenialsResult = await sql`
      SELECT
        c.id,
        c.claim_number,
        c.total_bill_amount,
        c.total_deductions,
        c.status,
        d.category,
        COUNT(d.id) as deduction_count,
        SUM(d.amount) as total_deduction_amount
      FROM insurance_claims c
      LEFT JOIN tpa_deductions d ON c.id = d.claim_id
      WHERE
        c.hospital_id = ${hospital_id}
        AND (c.tpa = ${tpa_name} OR c.insurer_name = ${tpa_name})
        AND c.created_at > NOW() - INTERVAL '30 days'
      GROUP BY c.id, c.claim_number, c.total_bill_amount, c.total_deductions, c.status, d.category
      ORDER BY c.created_at DESC
      LIMIT 100
    `;

    if (recentDenialsResult.length === 0) {
      return null;
    }

    // Count deduction category frequencies
    const categoryFreq: Record<string, number> = {};
    let deniedCount = 0;
    let partiallyApprovedCount = 0;

    for (const row of recentDenialsResult) {
      if (row.category) {
        categoryFreq[row.category] = (categoryFreq[row.category] || 0) + 1;
      }
      if (row.status === 'rejected') deniedCount++;
      if (row.status === 'partially_approved') partiallyApprovedCount++;
    }

    // Detect patterns
    const topCategory = Object.entries(categoryFreq).sort((a, b) => b[1] - a[1])[0];
    if (topCategory && topCategory[1] >= 3) {
      return `${topCategory[1]} denials in last 30 days involve "${topCategory[0]}" — systemic TPA policy issue`;
    }

    // Increasing denial rate
    const denialRate = (deniedCount / recentDenialsResult.length) * 100;
    if (denialRate >= 30) {
      return `${denialRate.toFixed(0)}% rejection rate for ${tpa_name} this month — escalate to insurance coordinator`;
    }

    return null;
  } catch (err) {
    console.error('[Pattern Detection] Error:', err);
    return null;
  }
}

// ============================================================================
// Resubmission Checklist
// ============================================================================

/**
 * Generate specific resubmission checklist items based on deduction types
 *
 * @param claim_id - Claim ID
 * @param deductions - Deduction breakdown
 * @returns string[] - Checklist items
 */
export function getResubmissionChecklist(claim_id: string, deductions: DeductionBreakdown[]): string[] {
  const checklist: Set<string> = new Set();

  for (const deduction of deductions) {
    const category = deduction.category;

    switch (category) {
      case 'non_payable':
        checklist.add('Reclassify consumable items to specific procedure-related categories');
        checklist.add('Attach itemized list with procedure justification for each non-payable item');
        break;

      case 'proportional_deduction':
        checklist.add('Provide detailed clinical justification for proportional charges');
        checklist.add('Submit doctor\'s certification of medical necessity');
        break;

      case 'co_pay':
        checklist.add('Verify policy co-pay percentage and submit corrected claim if rate was misapplied');
        break;

      case 'sub_limit_excess':
        checklist.add('Review sub-limits in policy document');
        checklist.add('If amount exceeds sub-limit, submit appeal with clinical priority documentation');
        break;

      case 'room_rent_excess':
        checklist.add('Submit room upgrade justification with doctor\'s recommendation letter');
        checklist.add('Attach hospital room rate certificate for claimed room type');
        break;

      case 'policy_exclusion':
        checklist.add('Review policy exclusion document and determine if procedure qualifies for appeal');
        checklist.add('Prepare detailed clinical case summary for exclusion review');
        break;

      case 'waiting_period':
        checklist.add('Verify waiting period status in policy');
        checklist.add('If waiting period has lapsed, submit amendment request with effective date proof');
        break;

      case 'other':
        checklist.add('Request TPA detailed reason for this deduction');
        checklist.add('Prepare item-by-item response addressing TPA\'s specific objections');
        break;
    }
  }

  return Array.from(checklist);
}

// ============================================================================
// Template-Based Analysis (Fallback)
// ============================================================================

/**
 * Template-based root cause when LLM unavailable
 */
function templateRootCause(
  denialType: DenialType,
  deductions: DeductionBreakdown[],
  systemicPattern?: string
): string {
  if (systemicPattern) {
    return systemicPattern;
  }

  const topDeduction = deductions[0];
  switch (denialType) {
    case 'full_denial':
      return 'Entire claim rejected by TPA. Likely due to missing pre-auth approval or policy non-coverage.';
    case 'partial_denial':
      return `Claim partially approved with ${topDeduction?.category} deductions applied.`;
    case 'deduction_heavy':
      return `Multiple line-level deductions applied across ${deductions.length} categories — review charge categorization.`;
    case 'documentation_gap':
      return 'Claim rejected due to incomplete documentation at submission. Resubmit with complete clinical records.';
    case 'policy_exclusion':
      return 'Procedure or service excluded under patient\'s policy terms.';
    default:
      return 'Claim denial requires review of TPA correspondence.';
  }
}

/**
 * Template-based recommendations when LLM unavailable
 */
function templateRecommendations(denialType: DenialType, deductions: DeductionBreakdown[]): string[] {
  const recs: string[] = [];

  switch (denialType) {
    case 'full_denial':
      recs.push('Verify pre-auth was approved before claim submission');
      recs.push('Request TPA detailed rejection letter');
      recs.push('File appeal if procedure was medically necessary');
      break;

    case 'partial_denial':
      const topDeduction = deductions[0];
      recs.push(`Address top deduction category: ${topDeduction?.category}`);
      recs.push('Provide clinical justification for deducted services');
      recs.push('File appeal for unreasonable deductions');
      break;

    case 'deduction_heavy':
      recs.push('Re-code charges using more specific procedure/service categories');
      recs.push('Attach charge master reference for each deducted line item');
      recs.push('Request line-level appeal for each deduction');
      break;

    case 'documentation_gap':
      recs.push('Obtain complete discharge summary and clinical notes');
      recs.push('Resubmit claim with all supporting documentation');
      recs.push('Consider resubmission after 7 days with updated documents');
      break;

    case 'policy_exclusion':
      recs.push('Review policy document for exclusion terms');
      recs.push('If procedure was medically necessary, file exception appeal');
      recs.push('Escalate to insurance coordinator for TPA negotiation');
      break;
  }

  return recs.slice(0, 3);
}

// ============================================================================
// Analysis Prompt Generation
// ============================================================================

/**
 * Generate the analysis prompt for LLM
 */
function generateAnalysisPrompt(params: {
  claimNumber?: string;
  tpaName: string;
  totalBill: number;
  approvedAmount: number;
  totalDeductions: number;
  denialType: DenialType;
  deductionBreakdown: DeductionBreakdown[];
  diagnosis?: string;
  procedure?: string;
  preAuth?: any;
  systemicPattern?: string;
}): string {
  const {
    claimNumber,
    tpaName,
    totalBill,
    approvedAmount,
    totalDeductions,
    denialType,
    deductionBreakdown,
    diagnosis,
    procedure,
    preAuth,
    systemicPattern,
  } = params;

  let prompt = `Claim: ${claimNumber || 'N/A'}
TPA: ${tpaName}
Diagnosis: ${diagnosis || 'N/A'}
Procedure: ${procedure || 'N/A'}

Financial Summary:
- Total Bill: ${formatIndianRupees(totalBill)}
- Approved: ${formatIndianRupees(approvedAmount)}
- Denied/Deducted: ${formatIndianRupees(totalDeductions)}
- Denial Type: ${denialType}

Deduction Breakdown:
${deductionBreakdown
  .map(
    d => `- ${d.category} (${d.count} items): ${formatIndianRupees(d.amount)} (${d.percent_of_total.toFixed(1)}%)
    Examples: ${d.examples.slice(0, 2).join(', ')}`
  )
  .join('\n')}
`;

  if (preAuth) {
    prompt += `\nPre-Auth Status: ${preAuth.status}`;
    if (preAuth.rejection_reason) {
      prompt += `\nPre-Auth Rejection Reason: ${preAuth.rejection_reason}`;
    }
  }

  if (systemicPattern) {
    prompt += `\nSystemic Pattern: ${systemicPattern}`;
  }

  prompt += `\n\nProvide:
1. Root cause of denial (1-2 sentences)
2. Top 3 specific recommendations for resubmission or appeal`;

  return prompt;
}

// ============================================================================
// InsightCard Generation
// ============================================================================

/**
 * Generate InsightCard for denial analysis
 */
function generateDenialInsightCard(params: {
  claim_id: string;
  claim_number: string;
  tpa_name: string;
  hospital_id: string;
  denial_type: DenialType;
  total_bill_amount: number;
  total_deductions: number;
  approved_amount: number;
  denial_percent: number;
  deduction_breakdown: DeductionBreakdown[];
  root_cause: string;
  recommendations: string[];
  resubmission_viable: boolean;
  resubmission_checklist: string[];
  systemic_pattern?: string;
  source: 'llm' | 'template';
  card_id: string;
}): InsightCard {
  const {
    claim_id,
    claim_number,
    tpa_name,
    hospital_id,
    denial_type,
    total_bill_amount,
    total_deductions,
    approved_amount,
    denial_percent,
    deduction_breakdown,
    root_cause,
    recommendations,
    resubmission_viable,
    resubmission_checklist,
    systemic_pattern,
    source,
    card_id,
  } = params;

  const topDeduction = deduction_breakdown[0];
  const topDeductionDesc = topDeduction
    ? `${topDeduction.category} (${formatIndianRupees(topDeduction.amount)})`
    : 'N/A';

  const body = `Claim ${claim_number} from ${tpa_name} shows ${denial_percent.toFixed(1)}% denial.
Bill: ${formatIndianRupees(total_bill_amount)} | Approved: ${formatIndianRupees(approved_amount)} | Denied: ${formatIndianRupees(total_deductions)}
Top Deduction: ${topDeductionDesc}`;

  const explanation = `
Root Cause: ${root_cause}

${systemic_pattern ? `\nSystemic Pattern: ${systemic_pattern}` : ''}

Key Deductions:
${deduction_breakdown.slice(0, 3).map(d => `- ${d.category}: ${formatIndianRupees(d.amount)} (${d.count} items)`).join('\n')}

Resubmission Viable: ${resubmission_viable ? 'Yes' : 'No'}
`;

  const suggestedAction = resubmission_viable
    ? recommendations[0] || 'Review deduction details and prepare appeal'
    : 'Escalate to insurance coordinator for negotiation';

  const actionUrl = `/admin/billing/claims/${claim_id}`;

  return {
    id: card_id,
    hospital_id,
    module: 'billing',
    category: 'alert',
    severity: 'high',
    title: `Claim Denial Analysis — ${tpa_name}`,
    body,
    explanation,
    data_sources: ['insurance_claims', 'tpa_deductions', 'claim_events', 'pre_auth_requests'],
    suggested_action: suggestedAction,
    action_url: actionUrl,
    confidence: source === 'llm' ? 0.85 : 0.7,
    source,
    model_version: source === 'llm' ? 'qwen2.5:14b' : undefined,
    status: 'active',
    target_role: 'billing_manager',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
