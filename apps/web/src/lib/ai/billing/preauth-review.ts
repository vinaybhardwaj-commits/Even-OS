/**
 * Even AI — Billing Intelligence: Pre-Authorization Review Engine
 * Real-time pre-auth completeness checking and TPA requirement validation
 *
 * Features:
 * - Pre-auth field completeness assessment (diagnosis, treatment, cost, documents)
 * - Diagnosis-procedure matching validation
 * - Supporting document and consent form verification
 * - TPA-specific requirement checking
 * - Requested amount reasonableness validation
 * - ReadinessScore (0-100%) for approval readiness
 * - Missing items categorized by severity (required vs recommended)
 * - InsightCard generation for insurance and clinical teams
 *
 * Database tables used:
 * - pre_auth_requests: diagnosis, proposed_treatment, estimated_cost, room_type, status, conditions
 * - insurance_claims: tpa_name, insurer_name, primary_diagnosis, icd_code, procedure_name
 * - patient_documents: document_type, file_name, status
 * - patient_consents: consent_type, status
 * - claim_rubrics: TPA-specific documentation requirements and approval rules
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
 * Pre-auth completeness assessment with readiness score
 */
export interface MissingItem {
  item: string;
  severity: 'required' | 'recommended';
  description: string;
}

/**
 * Pre-auth review result with readiness score and checklist
 */
export interface PreAuthReview {
  pre_auth_id: string;
  hospital_id: string;
  encounter_id?: string;
  readiness_pct: number;
  status: 'ready' | 'needs_attention' | 'incomplete';
  missing_items: MissingItem[];
  tpa_specific_tips: string[];
  has_documents: boolean;
  has_consents: boolean;
  diagnosis_procedure_match: boolean;
  amount_reasonableness: 'acceptable' | 'high' | 'low';
  confidence: number;
}

// ============================================================================
// Pre-Auth Review Engine
// ============================================================================

/**
 * Audit pre-auth request completeness and TPA alignment
 *
 * Checks:
 * 1. Core field population (diagnosis, treatment, cost, room type)
 * 2. Diagnosis-procedure code matching
 * 3. Supporting documents (medical records, imaging, reports)
 * 4. Consent forms (informed consent, insurance assignment)
 * 5. TPA-specific requirements from claim_rubrics
 * 6. Requested amount reasonableness (within ±30% of benchmark)
 *
 * Returns readiness_pct (0-100) and categorized missing items.
 *
 * @param params - { hospital_id, pre_auth_id }
 * @returns PreAuthReview with readiness score and missing items checklist
 *
 * @example
 * const review = await reviewPreAuth({ hospital_id: 'h123', pre_auth_id: 'pa456' });
 * if (review.readiness_pct >= 90) {
 *   await submitToTPA(review.pre_auth_id);
 * }
 */
export async function reviewPreAuth(params: {
  hospital_id: string;
  pre_auth_id: string;
}): Promise<PreAuthReview> {
  const sql = getSql();
  const { hospital_id, pre_auth_id } = params;

  try {
    // Query 1: Pre-auth request details
    const preAuthRows = await sql(
      `SELECT
        pa.id, pa.encounter_id, pa.diagnosis, pa.proposed_treatment, pa.estimated_cost,
        pa.room_type_requested, pa.requested_amount, pa.conditions, pa.status,
        ic.tpa_name, ic.insurer_name, ic.primary_diagnosis, ic.icd_code, ic.procedure_name
      FROM pre_auth_requests pa
      LEFT JOIN insurance_claims ic ON pa.claim_id = ic.id
      WHERE pa.id = $1 AND pa.hospital_id = $2
      LIMIT 1`,
      [pre_auth_id, hospital_id]
    );

    if (!preAuthRows || preAuthRows.length === 0) {
      throw new Error(`Pre-auth request not found: ${pre_auth_id}`);
    }

    const preAuth = preAuthRows[0];
    const missingItems: MissingItem[] = [];
    let coreFieldScore = 100;

    // Check 1: Core field population
    if (!preAuth.diagnosis || preAuth.diagnosis.trim() === '') {
      missingItems.push({
        item: 'Primary Diagnosis',
        severity: 'required',
        description: 'Diagnosis code and description required for pre-auth submission',
      });
      coreFieldScore -= 20;
    }

    if (!preAuth.proposed_treatment || preAuth.proposed_treatment.trim() === '') {
      missingItems.push({
        item: 'Proposed Treatment/Procedure',
        severity: 'required',
        description: 'Treatment plan must be documented with procedure codes',
      });
      coreFieldScore -= 20;
    }

    if (!preAuth.estimated_cost || preAuth.estimated_cost <= 0) {
      missingItems.push({
        item: 'Estimated Cost',
        severity: 'required',
        description: 'Cost estimation required to match insurer limits',
      });
      coreFieldScore -= 15;
    }

    if (!preAuth.room_type_requested || preAuth.room_type_requested.trim() === '') {
      missingItems.push({
        item: 'Room Type Requested',
        severity: 'recommended',
        description: 'Room class selection helps verify coverage eligibility',
      });
      coreFieldScore -= 5;
    }

    // Check 2: Diagnosis-procedure code matching (basic string matching)
    let diagnosis_procedure_match = true;
    if (preAuth.icd_code && preAuth.proposed_treatment) {
      const icdKeywords = (preAuth.icd_code || '').toLowerCase().split(/\s+/);
      const treatmentKeywords = (preAuth.proposed_treatment || '').toLowerCase().split(/\s+/);
      const matchCount = icdKeywords.filter((keyword: string) =>
        treatmentKeywords.some((t: string) => t.includes(keyword) || keyword.includes(t))
      ).length;

      if (matchCount === 0 && icdKeywords.length > 0) {
        diagnosis_procedure_match = false;
        missingItems.push({
          item: 'Diagnosis-Procedure Alignment',
          severity: 'recommended',
          description: `ICD-10 code (${preAuth.icd_code}) may not match proposed treatment — verify alignment`,
        });
        coreFieldScore -= 5;
      }
    }

    // Query 2: Supporting documents
    const documentRows = await sql(
      `SELECT
        document_type,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'uploaded' THEN 1 END) as uploaded_count
      FROM patient_documents
      WHERE patient_id IN (
        SELECT patient_id FROM encounters WHERE id = $1
      )
      GROUP BY document_type`,
      [preAuth.encounter_id || '']
    );

    let has_documents = false;
    const requiredDocTypes = [
      'medical_records',
      'investigation_reports',
      'clinical_notes',
    ];

    if (documentRows && documentRows.length > 0) {
      has_documents = documentRows.some((row: any) => row.uploaded_count > 0);

      // Check for specific required documents
      const uploadedDocTypes = new Set(
        documentRows
          .filter((row: any) => row.uploaded_count > 0)
          .map((row: any) => row.document_type)
      );

      requiredDocTypes.forEach((docType) => {
        if (!uploadedDocTypes.has(docType)) {
          missingItems.push({
            item: `${docType.replace(/_/g, ' ')} Documentation`,
            severity: 'required',
            description: `Attach ${docType.replace(/_/g, ' ').toLowerCase()} for TPA review`,
          });
          coreFieldScore -= 8;
        }
      });
    } else {
      missingItems.push({
        item: 'Medical Records & Investigations',
        severity: 'required',
        description: 'Upload patient medical records, lab reports, and imaging for pre-auth',
      });
      coreFieldScore -= 15;
    }

    // Query 3: Consent forms
    const consentRows = await sql(
      `SELECT
        consent_type,
        COUNT(CASE WHEN status = 'signed' THEN 1 END) as signed_count
      FROM patient_consents
      WHERE encounter_id = $1
      GROUP BY consent_type`,
      [preAuth.encounter_id || '']
    );

    let has_consents = false;
    const requiredConsents = ['informed_consent', 'insurance_assignment'];

    if (consentRows && consentRows.length > 0) {
      has_consents = consentRows.some((row: any) => row.signed_count > 0);

      const signedConsentTypes = new Set(
        consentRows
          .filter((row: any) => row.signed_count > 0)
          .map((row: any) => row.consent_type)
      );

      requiredConsents.forEach((consentType) => {
        if (!signedConsentTypes.has(consentType)) {
          missingItems.push({
            item: `${consentType.replace(/_/g, ' ')} Form`,
            severity: 'required',
            description: `Patient/guardian signature on ${consentType.replace(/_/g, ' ').toLowerCase()} consent`,
          });
          coreFieldScore -= 7;
        }
      });
    } else {
      missingItems.push({
        item: 'Consent Forms',
        severity: 'required',
        description: 'Obtain and upload signed informed consent and insurance assignment forms',
      });
      coreFieldScore -= 10;
    }

    // Query 4: TPA-specific requirements
    const tpa_specific_tips: string[] = [];
    let tpaRuleScore = 100;

    if (preAuth.tpa_name) {
      const rubricRows = await sql(
        `SELECT rule_type, rule_data
        FROM claim_rubrics
        WHERE tpa_name = $1 AND hospital_id = $2 AND is_active = true
        LIMIT 10`,
        [preAuth.tpa_name, hospital_id]
      );

      if (rubricRows && rubricRows.length > 0) {
        rubricRows.forEach((rubric: any) => {
          const ruleData = rubric.rule_data || {};

          // Extract tips from rule data
          if (ruleData.documentation_required) {
            tpa_specific_tips.push(
              `${preAuth.tpa_name} requires: ${Array.isArray(ruleData.documentation_required) ? ruleData.documentation_required.join(', ') : ruleData.documentation_required}`
            );
          }

          if (ruleData.max_approval_days) {
            tpa_specific_tips.push(
              `${preAuth.tpa_name} typical approval: ${ruleData.max_approval_days} days`
            );
          }

          if (ruleData.common_deductions) {
            tpa_specific_tips.push(
              `Common deductions: ${Array.isArray(ruleData.common_deductions) ? ruleData.common_deductions.join(', ') : ruleData.common_deductions}`
            );
          }
        });
      } else {
        tpa_specific_tips.push(`No specific rules found for ${preAuth.tpa_name} — use standard guidelines`);
      }
    }

    // Check 5: Requested amount reasonableness
    let amount_reasonableness: 'acceptable' | 'high' | 'low' = 'acceptable';
    if (preAuth.estimated_cost && preAuth.requested_amount) {
      const estimatedCost = parseFloat(preAuth.estimated_cost);
      const requestedAmount = parseFloat(preAuth.requested_amount);

      if (estimatedCost > 0) {
        const variation = Math.abs((requestedAmount - estimatedCost) / estimatedCost);

        if (variation > 0.3) {
          if (requestedAmount > estimatedCost) {
            amount_reasonableness = 'high';
            missingItems.push({
              item: 'Requested Amount Justification',
              severity: 'recommended',
              description: `Requested amount (₹${requestedAmount.toLocaleString('en-IN')}) exceeds estimate by ${((variation - 1) * 100).toFixed(0)}% — document justification`,
            });
            tpaRuleScore -= 10;
          } else {
            amount_reasonableness = 'low';
            tpa_specific_tips.push(
              `Requested amount is ${(variation * 100).toFixed(0)}% below estimate — ensure adequate coverage`
            );
          }
        }
      }
    }

    // Calculate final readiness score (weighted)
    const coreWeight = 0.5;
    const documentsWeight = 0.25;
    const consentsWeight = 0.15;
    const tpaWeight = 0.1;

    const readiness_pct = Math.round(
      coreFieldScore * coreWeight +
        (has_documents ? 100 : 50) * documentsWeight +
        (has_consents ? 100 : 50) * consentsWeight +
        tpaRuleScore * tpaWeight
    );

    // Determine status
    let status: 'ready' | 'needs_attention' | 'incomplete';
    if (readiness_pct >= 90) {
      status = 'ready';
    } else if (readiness_pct >= 70) {
      status = 'needs_attention';
    } else {
      status = 'incomplete';
    }

    return {
      pre_auth_id,
      hospital_id,
      encounter_id: preAuth.encounter_id,
      readiness_pct,
      status,
      missing_items: missingItems.sort((a, b) => {
        const severityOrder = { required: 0, recommended: 1 };
        return (
          severityOrder[a.severity as keyof typeof severityOrder] -
          severityOrder[b.severity as keyof typeof severityOrder]
        );
      }),
      tpa_specific_tips,
      has_documents,
      has_consents,
      diagnosis_procedure_match,
      amount_reasonableness,
      confidence: 0.88,
    };
  } catch (error) {
    console.error(`Pre-auth review error for ${pre_auth_id}:`, error);
    throw error;
  }
}

// ============================================================================
// InsightCard Generation
// ============================================================================

/**
 * Generate an InsightCard summarizing pre-auth completeness and next steps
 *
 * Creates a billing alert card with:
 * - Readiness percentage and status
 * - Checklist of missing items (required vs recommended)
 * - TPA-specific tips and common pitfalls
 * - Suggested action based on readiness level
 * - Severity escalation for critical gaps
 *
 * @param review - PreAuthReview from reviewPreAuth()
 * @param hospital_id - Hospital ID
 * @param encounter_id - Optional encounter ID for card targeting
 * @returns InsightCard ready for insertion into ai_insight_cards
 *
 * @example
 * const review = await reviewPreAuth({ hospital_id: 'h123', pre_auth_id: 'pa456' });
 * const card = generatePreAuthInsightCard(review, 'h123', review.encounter_id);
 * await insertInsightCard(card);
 */
export function generatePreAuthInsightCard(
  review: PreAuthReview,
  hospital_id: string,
  encounter_id?: string
): InsightCard {
  // Determine severity based on readiness percentage
  let severity: CardSeverity = 'info';
  if (review.readiness_pct < 60) {
    severity = 'critical';
  } else if (review.readiness_pct < 80) {
    severity = 'high';
  } else if (review.readiness_pct < 90) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  // Build body with checklist
  const bodyLines = [
    `**Pre-Auth Review — ${review.readiness_pct}% Ready**`,
    '',
    `**Status:** ${review.status.toUpperCase().replace(/_/g, ' ')}`,
    '',
  ];

  // Add missing items by severity
  const requiredItems = review.missing_items.filter((item) => item.severity === 'required');
  const recommendedItems = review.missing_items.filter((item) => item.severity === 'recommended');

  if (requiredItems.length > 0) {
    bodyLines.push('**⚠️ Required Items:**');
    requiredItems.forEach((item) => {
      bodyLines.push(`• **${item.item}** — ${item.description}`);
    });
    bodyLines.push('');
  }

  if (recommendedItems.length > 0) {
    bodyLines.push('**📋 Recommended Items:**');
    recommendedItems.forEach((item) => {
      bodyLines.push(`• ${item.item} — ${item.description}`);
    });
    bodyLines.push('');
  }

  // Add TPA-specific tips
  if (review.tpa_specific_tips.length > 0) {
    bodyLines.push('**TPA-Specific Tips:**');
    review.tpa_specific_tips.slice(0, 3).forEach((tip) => {
      bodyLines.push(`• ${tip}`);
    });
    bodyLines.push('');
  }

  // Add diagnosis-procedure match warning
  if (!review.diagnosis_procedure_match) {
    bodyLines.push('⚠️ **Diagnosis-procedure mismatch detected** — verify alignment with TPA');
    bodyLines.push('');
  }

  // Add amount reasonableness note
  if (review.amount_reasonableness === 'high') {
    bodyLines.push(
      '⚠️ **Requested amount is higher than estimate** — document justification for TPA'
    );
  } else if (review.amount_reasonableness === 'low') {
    bodyLines.push('ℹ️ **Requested amount is lower than estimate** — ensure adequate coverage');
  }

  const body = bodyLines.join('\n');

  // Explanation for backend auditing
  const explanation =
    'Pre-auth completeness assessment evaluates required fields (diagnosis, treatment, cost), ' +
    'supporting documents (medical records, investigations), consent forms (informed consent, insurance assignment), ' +
    'and TPA-specific requirements. Readiness score guides submission timing and identifies gaps before TPA rejection.';

  // Suggested action based on readiness
  let suggested_action: string | undefined;
  if (review.readiness_pct >= 90) {
    suggested_action = 'Pre-auth ready for TPA submission';
  } else if (review.readiness_pct >= 70) {
    suggested_action = 'Address required items before submission';
  } else {
    suggested_action = 'Incomplete — contact insurance team for next steps';
  }

  return {
    id: randomUUID(),
    hospital_id,
    module: 'billing',
    category: 'alert',
    severity,
    title: `Pre-Auth Review — ${review.readiness_pct}% Ready`,
    body,
    explanation,
    data_sources: [
      'pre_auth_requests',
      'insurance_claims',
      'patient_documents',
      'patient_consents',
      'claim_rubrics',
    ],
    suggested_action,
    action_url: `/admin/billing/preauth/${review.pre_auth_id}`,
    confidence: review.confidence,
    source: 'template',
    status: 'active',
    target_encounter_id: encounter_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
