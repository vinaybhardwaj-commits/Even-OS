/**
 * A.5 — Billing Integration Library
 *
 * Orchestrates bill generation with insurer rule evaluation.
 * Integrates the rule-evaluator with encounter charges and billing accounts.
 */

import { db } from '@/lib/db';
import { evaluateRules, BillLineItem, BillContext, EvaluationResult, RuleResult } from './rule-evaluator';
import {
  encounters, patients, billingAccounts, encounterCharges, insurers, insurerRules, ruleApplications,
} from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────

export interface BillSummary {
  encounter_id: string;
  billing_type: 'self_pay' | 'insurance' | 'corporate' | 'government';
  insurer_id?: string;
  insurer_name?: string;

  // Original charges
  total_charges: number;
  total_gst: number;
  total_discount: number;
  gross_total: number;

  // After rules
  total_deductions: number;
  insurer_payable: number;
  patient_liability: number;
  net_total: number;

  // Rule details
  rules_applied: number;
  rule_results: RuleResult[];

  // Implants (from A.5)
  implant_charges: number;
  implant_count: number;
}

export interface TPABillFormat {
  encounter_id: string;
  patient_details: {
    patient_id: string;
    patient_name: string;
    uhid: string;
    admission_date: string;
    discharge_date?: string;
  };
  billing_details: {
    billing_account_id: string;
    account_type: 'self_pay' | 'insurance' | 'corporate' | 'government';
    insurer_name?: string;
    policy_number?: string;
    member_id?: string;
  };
  itemized_charges: {
    description: string;
    category: string;
    quantity: number;
    unit_price: number;
    discount_percent: number;
    gst_percent: number;
    original_amount: number;
  }[];
  rule_deductions: {
    rule_name: string;
    rule_type: string;
    deduction_amount: number;
    explanation: string;
  }[];
  financial_summary: {
    total_charges: number;
    total_discount: number;
    total_gst: number;
    subtotal: number;
    total_rule_deductions: number;
    net_payable_by_insurer: number;
    patient_liability: number;
    net_total: number;
  };
}

// ─── Helper Functions ──────────────────────────────────

function roundToTwo(num: number | string | null | undefined): number {
  if (!num) return 0;
  const n = typeof num === 'string' ? parseFloat(num) : num;
  return Math.round(n * 100) / 100;
}

function calculatePatientAge(birthDate?: string | Date): number | undefined {
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// ─── Main Orchestration ──────────────────────────────────

/**
 * Generate bill with insurer rule evaluation
 *
 * Flow:
 * 1. Load encounter's billing account
 * 2. If insurance type, load insurer rules
 * 3. Load encounter charges
 * 4. Evaluate rules
 * 5. Return bill summary
 */
export async function generateBillWithRules(
  encounterId: string,
  hospitalId: string,
  userId: string,
): Promise<BillSummary> {
  // 1. Load encounter with patient data
  const [encounter] = await db.select({
    id: encounters.id,
    patient_id: encounters.patient_id,
    admission_date: encounters.admission_at,
    discharge_date: encounters.discharge_at,
  })
    .from(encounters)
    .where(and(
      eq(encounters.id, encounterId as any),
      eq(encounters.hospital_id, hospitalId),
    ))
    .limit(1);

  if (!encounter) {
    throw new Error(`Encounter ${encounterId} not found`);
  }

  // 2. Load patient
  const [patient] = await db.select({
    id: patients.id,
    date_of_birth: patients.dob,
    name_full: patients.name_full,
    uhid: patients.uhid,
  })
    .from(patients)
    .where(eq(patients.id, encounter.patient_id))
    .limit(1);

  if (!patient) {
    throw new Error(`Patient ${encounter.patient_id} not found`);
  }

  // 3. Load billing account
  const [billingAccount] = await db.select({
    id: billingAccounts.id,
    account_type: billingAccounts.account_type,
    insurer_name: billingAccounts.insurer_name,
    sum_insured: billingAccounts.sum_insured,
    room_rent_eligibility: billingAccounts.room_rent_eligibility,
  })
    .from(billingAccounts)
    .where(and(
      eq(billingAccounts.encounter_id, encounterId as any),
      eq(billingAccounts.hospital_id, hospitalId),
    ))
    .limit(1);

  // Default to self-pay if no account
  const accountType = billingAccount?.account_type || 'self_pay';
  const insurerName = billingAccount?.insurer_name;

  // 4. Load encounter charges
  const charges = await db.select({
    id: encounterCharges.id,
    charge_name: encounterCharges.charge_name,
    charge_code: encounterCharges.charge_code,
    category: encounterCharges.category,
    quantity: encounterCharges.quantity,
    unit_price: encounterCharges.unit_price,
    discount_percent: encounterCharges.discount_percent,
    gst_percent: encounterCharges.gst_percent,
    net_amount: encounterCharges.net_amount,
    service_date: encounterCharges.service_date,
  })
    .from(encounterCharges)
    .where(and(
      eq(encounterCharges.encounter_id, encounterId as any),
      eq(encounterCharges.hospital_id, hospitalId),
    ));

  // Calculate totals from charges
  let totalCharges = 0;
  let totalDiscount = 0;
  let totalGst = 0;
  let implantCharges = 0;
  let implantCount = 0;

  const lineItems: BillLineItem[] = charges.map((charge) => {
    const unitPrice = roundToTwo(Number(charge.unit_price));
    const qty = charge.quantity || 1;
    const baseAmount = unitPrice * qty;
    const discount = roundToTwo(Number(charge.discount_percent || 0) / 100 * baseAmount);
    const netBefore = baseAmount - discount;
    const gst = roundToTwo(Number(charge.gst_percent || 0) / 100 * netBefore);

    totalCharges += baseAmount;
    totalDiscount += discount;
    totalGst += gst;

    // Mark implants for tracking
    const isImplant = charge.category?.toLowerCase().includes('implant') || false;
    if (isImplant) {
      implantCharges += (baseAmount - discount + gst);
      implantCount += 1;
    }

    return {
      id: charge.id,
      charge_name: charge.charge_name,
      charge_code: charge.charge_code || undefined,
      category: charge.category || 'other',
      amount: roundToTwo(baseAmount - discount + gst),
      quantity: qty,
      unit_price: unitPrice,
      is_implant: isImplant,
    };
  });

  const grossTotal = totalCharges + totalGst - totalDiscount;

  // If self-pay, skip rule evaluation
  if (accountType === 'self_pay') {
    return {
      encounter_id: encounterId,
      billing_type: 'self_pay',
      total_charges: roundToTwo(totalCharges),
      total_gst: roundToTwo(totalGst),
      total_discount: roundToTwo(totalDiscount),
      gross_total: roundToTwo(grossTotal),
      total_deductions: 0,
      insurer_payable: roundToTwo(grossTotal),
      patient_liability: roundToTwo(grossTotal),
      net_total: roundToTwo(grossTotal),
      rules_applied: 0,
      rule_results: [],
      implant_charges: roundToTwo(implantCharges),
      implant_count: implantCount,
    };
  }

  // 5. For insurance: load insurer and rules
  let insurerId: string | undefined;
  let evaluationResult: EvaluationResult | null = null;

  // Query billing_accounts to find insurer_id (if available in schema)
  const billingAccountRow = await db.execute(sql`
    SELECT insurer_id FROM billing_accounts
    WHERE encounter_id = ${encounterId}::uuid
    AND hospital_id = ${hospitalId}
    LIMIT 1
  `);

  const billingRow = ((billingAccountRow as any).rows || billingAccountRow)[0];
  if (billingRow?.insurer_id) {
    insurerId = billingRow.insurer_id;

    // Load active rules for this insurer
    const rules = await db.select({
      id: insurerRules.id,
      rule_name: insurerRules.rule_name,
      rule_type: insurerRules.rule_type,
      priority: insurerRules.priority,
      conditions: insurerRules.conditions,
      parameters: insurerRules.parameters,
      status: insurerRules.status,
    })
      .from(insurerRules)
      .where(and(
        eq(insurerRules.insurer_id, insurerId as any),
        eq(insurerRules.hospital_id, hospitalId),
        eq(insurerRules.status, 'active'),
      ));

    // Build bill context for evaluation
    const patientAge = calculatePatientAge(patient.date_of_birth || undefined);
    const sumInsured = billingAccount ? roundToTwo(billingAccount.sum_insured) : undefined;

    const context: BillContext = {
      encounter_id: encounterId,
      patient_id: encounter.patient_id,
      patient_age: patientAge,
      admission_date: encounter.admission_date?.toISOString(),
      room_type: billingAccount?.room_rent_eligibility ? 'private' : 'general',
      sum_insured: sumInsured,
      line_items: lineItems,
    };

    // 6. Evaluate rules
    evaluationResult = evaluateRules(rules as any, context);
    evaluationResult.insurer_id = insurerId || '';
  }

  // 7. Build final summary
  const totalDeductions = evaluationResult?.total_deduction || 0;
  const insurerPayable = roundToTwo(grossTotal - totalDeductions);
  const patientLiability = roundToTwo(totalDeductions);
  const netTotal = roundToTwo(Math.max(0, insurerPayable));

  return {
    encounter_id: encounterId,
    billing_type: accountType as any,
    insurer_id: insurerId || undefined,
    insurer_name: insurerName || undefined,
    total_charges: roundToTwo(totalCharges),
    total_gst: roundToTwo(totalGst),
    total_discount: roundToTwo(totalDiscount),
    gross_total: roundToTwo(grossTotal),
    total_deductions: roundToTwo(totalDeductions),
    insurer_payable: insurerPayable,
    patient_liability: patientLiability,
    net_total: netTotal,
    rules_applied: evaluationResult?.rule_results.length || 0,
    rule_results: evaluationResult?.rule_results || [],
    implant_charges: roundToTwo(implantCharges),
    implant_count: implantCount,
  };
}

/**
 * Format bill for TPA submission
 */
export function formatBillForTPA(
  billSummary: BillSummary,
  charges: typeof encounterCharges.$inferSelect[],
  patient: typeof patients.$inferSelect,
): TPABillFormat {
  return {
    encounter_id: billSummary.encounter_id,
    patient_details: {
      patient_id: patient.id,
      patient_name: patient.name_full || 'Unknown',
      uhid: patient.uhid || 'N/A',
      admission_date: new Date().toISOString(),
      discharge_date: undefined,
    },
    billing_details: {
      billing_account_id: billSummary.encounter_id,
      account_type: billSummary.billing_type,
      insurer_name: billSummary.insurer_name,
    },
    itemized_charges: charges.map((c) => ({
      description: c.charge_name,
      category: c.category || 'other',
      quantity: c.quantity || 1,
      unit_price: roundToTwo(c.unit_price),
      discount_percent: roundToTwo(c.discount_percent) || 0,
      gst_percent: roundToTwo(c.gst_percent) || 0,
      original_amount: roundToTwo(c.net_amount),
    })),
    rule_deductions: billSummary.rule_results.map((r) => ({
      rule_name: r.rule_name,
      rule_type: r.rule_type,
      deduction_amount: roundToTwo(r.deduction_amount),
      explanation: r.explanation,
    })),
    financial_summary: {
      total_charges: billSummary.total_charges,
      total_discount: billSummary.total_discount,
      total_gst: billSummary.total_gst,
      subtotal: billSummary.gross_total,
      total_rule_deductions: billSummary.total_deductions,
      net_payable_by_insurer: billSummary.insurer_payable,
      patient_liability: billSummary.patient_liability,
      net_total: billSummary.net_total,
    },
  };
}

/**
 * Apply rule results to database
 *
 * Stores each rule application in rule_applications table.
 */
export async function applyRuleResults(
  encounterId: string,
  evaluationResult: EvaluationResult,
  hospitalId: string,
  userId: string,
): Promise<number> {
  if (!evaluationResult.rule_results || evaluationResult.rule_results.length === 0) {
    return 0;
  }

  let appliedCount = 0;

  for (const result of evaluationResult.rule_results) {
    await db.insert(ruleApplications).values({
      hospital_id: hospitalId,
      rule_id: result.rule_id as any,
      insurer_id: evaluationResult.insurer_id as any,
      encounter_id: encounterId as any,
      patient_id: null,
      bill_id: null,
      original_amount: String(result.original_amount) as any,
      adjusted_amount: String(result.adjusted_amount) as any,
      deduction_amount: String(result.deduction_amount) as any,
      explanation: result.explanation,
      evaluation_context: {
        rule_name: result.rule_name,
        rule_type: result.rule_type,
        affected_items: result.affected_items,
      } as any,
      is_simulation: false,
      applied_by: userId as any,
      applied_at: new Date(),
    });

    appliedCount++;
  }

  return appliedCount;
}

/**
 * Get bill preview without saving
 */
export async function previewBillWithRules(
  encounterId: string,
  hospitalId: string,
  insurerId?: string,
): Promise<BillSummary> {
  // Similar to generateBillWithRules but read-only
  return generateBillWithRules(encounterId, hospitalId, '');
}
