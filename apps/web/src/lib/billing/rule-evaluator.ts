/**
 * A.2 — Insurer Rules Evaluator Engine
 *
 * Evaluates billing rules for a given insurer against bill line items.
 * Pipeline: load rules → filter by conditions → sort by priority → apply in sequence
 */

// ─── Types ──────────────────────────────────────────────────

export type RuleType =
  | 'room_rent_cap'
  | 'proportional_deduction'
  | 'co_pay'
  | 'item_exclusion'
  | 'sub_limit'
  | 'package_rate'
  | 'waiting_period'
  | 'disease_cap'
  | 'network_tier_pricing'
  | 'category_cap';

export interface InsurerRule {
  id: string;
  rule_name: string;
  rule_type: RuleType;
  priority: number;
  conditions: Record<string, any>;
  parameters: Record<string, any>;
  status: string;
}

export interface BillLineItem {
  id: string;
  charge_code?: string;
  charge_name: string;
  category: string; // room, procedure, lab, pharmacy, consultation, nursing, icu, etc.
  amount: number;
  quantity: number;
  days?: number; // For room charges
  room_type?: string;
  procedure_code?: string;
  disease_codes?: string[];
  is_implant?: boolean;
}

export interface BillContext {
  encounter_id?: string;
  patient_id?: string;
  patient_age?: number;
  admission_date?: string;
  network_tier?: 'preferred' | 'standard' | 'non_network';
  sum_insured?: number;
  room_type?: string;
  diagnosis_codes?: string[];
  line_items: BillLineItem[];
}

export interface RuleResult {
  rule_id: string;
  rule_name: string;
  rule_type: RuleType;
  original_amount: number;
  adjusted_amount: number;
  deduction_amount: number;
  explanation: string;
  affected_items: string[]; // IDs of affected line items
  item_adjustments: ItemAdjustment[];
}

export interface ItemAdjustment {
  item_id: string;
  original_amount: number;
  adjusted_amount: number;
  deduction: number;
}

export interface EvaluationResult {
  insurer_id: string;
  total_original: number;
  total_adjusted: number;
  total_deduction: number;
  rule_results: RuleResult[];
  item_totals: Map<string, { original: number; adjusted: number; deduction: number }>;
}

// ─── Condition Matcher ──────────────────────────────────────

function matchesConditions(rule: InsurerRule, context: BillContext): boolean {
  const cond = rule.conditions;
  if (!cond || Object.keys(cond).length === 0) return true; // No conditions = always applies

  // Room type condition
  if (cond.room_type) {
    const roomTypes = Array.isArray(cond.room_type) ? cond.room_type : [cond.room_type];
    if (context.room_type && !roomTypes.includes(context.room_type)) return false;
  }

  // Network tier condition
  if (cond.network_tier) {
    if (context.network_tier !== cond.network_tier) return false;
  }

  // Patient age conditions
  if (cond.patient_age_gte !== undefined) {
    if (!context.patient_age || context.patient_age < cond.patient_age_gte) return false;
  }
  if (cond.patient_age_lte !== undefined) {
    if (!context.patient_age || context.patient_age > cond.patient_age_lte) return false;
  }

  // Plan type / category conditions
  if (cond.category) {
    const cats = Array.isArray(cond.category) ? cond.category : [cond.category];
    const billCats = context.line_items.map(i => i.category);
    if (!cats.some(c => billCats.includes(c))) return false;
  }

  // Procedure code condition
  if (cond.procedure_code) {
    const codes = Array.isArray(cond.procedure_code) ? cond.procedure_code : [cond.procedure_code];
    const billCodes = context.line_items.map(i => i.procedure_code).filter(Boolean);
    if (!codes.some(c => billCodes.includes(c))) return false;
  }

  // triggered_by: special condition for proportional_deduction
  // This is evaluated in the pipeline, not here
  if (cond.triggered_by) return true; // Let the pipeline handle it

  return true;
}

// ─── Rule Appliers (one per rule type) ──────────────────────

function applyRoomRentCap(rule: InsurerRule, context: BillContext): RuleResult | null {
  const params = rule.parameters;
  const roomItems = context.line_items.filter(i => i.category === 'room');
  if (roomItems.length === 0) return null;

  let totalOriginal = 0;
  let totalAdjusted = 0;
  const adjustments: ItemAdjustment[] = [];
  const affected: string[] = [];

  for (const item of roomItems) {
    const days = item.days || item.quantity || 1;
    const perDay = item.amount / days;
    let maxPerDay: number;

    if (params.cap_type === 'percentage_si' && context.sum_insured) {
      maxPerDay = (context.sum_insured * (params.percentage_of_si || 1)) / 100;
    } else {
      maxPerDay = params.max_per_day || Infinity;
    }

    totalOriginal += item.amount;
    if (perDay > maxPerDay) {
      const adjusted = maxPerDay * days;
      totalAdjusted += adjusted;
      adjustments.push({ item_id: item.id, original_amount: item.amount, adjusted_amount: adjusted, deduction: item.amount - adjusted });
      affected.push(item.id);
    } else {
      totalAdjusted += item.amount;
      adjustments.push({ item_id: item.id, original_amount: item.amount, adjusted_amount: item.amount, deduction: 0 });
    }
  }

  const deduction = totalOriginal - totalAdjusted;
  if (deduction <= 0) return null;

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'room_rent_cap',
    original_amount: totalOriginal,
    adjusted_amount: totalAdjusted,
    deduction_amount: deduction,
    explanation: `Room rent capped at ₹${params.max_per_day || 'SI-based'}/day. Deduction: ₹${deduction.toFixed(2)}`,
    affected_items: affected,
    item_adjustments: adjustments,
  };
}

function applyProportionalDeduction(rule: InsurerRule, context: BillContext, previousResults: RuleResult[]): RuleResult | null {
  const params = rule.parameters;

  // Check if triggered by room_rent_cap
  if (rule.conditions.triggered_by === 'room_rent_cap') {
    const roomCapResult = previousResults.find(r => r.rule_type === 'room_rent_cap');
    if (!roomCapResult || roomCapResult.deduction_amount <= 0) return null;
  }

  // Get the room items to calculate the proportional ratio
  const roomItems = context.line_items.filter(i => i.category === 'room');
  const nonRoomItems = context.line_items.filter(i => i.category !== 'room');
  if (roomItems.length === 0 || nonRoomItems.length === 0) return null;

  // Calculate the eligible vs actual ratio
  const totalRoomCharge = roomItems.reduce((s, i) => s + i.amount, 0);
  const eligibleAmount = params.eligible_amount || totalRoomCharge;
  if (totalRoomCharge <= eligibleAmount) return null;

  const ratio = eligibleAmount / totalRoomCharge;
  const applyTo = params.apply_to || 'all';

  let totalOriginal = 0;
  let totalAdjusted = 0;
  const adjustments: ItemAdjustment[] = [];
  const affected: string[] = [];

  const targetItems = applyTo === 'all' ? nonRoomItems : nonRoomItems.filter(i => i.category === applyTo);

  for (const item of targetItems) {
    const adjusted = Math.round(item.amount * ratio * 100) / 100;
    totalOriginal += item.amount;
    totalAdjusted += adjusted;
    adjustments.push({ item_id: item.id, original_amount: item.amount, adjusted_amount: adjusted, deduction: item.amount - adjusted });
    affected.push(item.id);
  }

  const deduction = totalOriginal - totalAdjusted;
  if (deduction <= 0) return null;

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'proportional_deduction',
    original_amount: totalOriginal,
    adjusted_amount: totalAdjusted,
    deduction_amount: deduction,
    explanation: `Proportional deduction at ratio ${(ratio * 100).toFixed(1)}%. Eligible: ₹${eligibleAmount}, Actual room: ₹${totalRoomCharge}. Deduction: ₹${deduction.toFixed(2)}`,
    affected_items: affected,
    item_adjustments: adjustments,
  };
}

function applyCoPay(rule: InsurerRule, context: BillContext, currentTotal: number): RuleResult | null {
  const params = rule.parameters;
  const percentage = params.percentage || 0;
  if (percentage <= 0) return null;

  const deduction = Math.round(currentTotal * percentage) / 100;
  const adjustedTotal = currentTotal - deduction;

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'co_pay',
    original_amount: currentTotal,
    adjusted_amount: adjustedTotal,
    deduction_amount: deduction,
    explanation: `${percentage}% co-payment applied on ₹${currentTotal.toFixed(2)}. Patient pays: ₹${deduction.toFixed(2)}`,
    affected_items: context.line_items.map(i => i.id),
    item_adjustments: [],
  };
}

function applyItemExclusion(rule: InsurerRule, context: BillContext): RuleResult | null {
  const params = rule.parameters;
  const excludedCategories = params.excluded_categories || [];
  const excludedCodes = params.excluded_codes || [];
  const reason = params.reason || 'Excluded by insurer policy';

  const excluded = context.line_items.filter(item =>
    excludedCategories.includes(item.category) ||
    (item.charge_code && excludedCodes.includes(item.charge_code))
  );

  if (excluded.length === 0) return null;

  const totalDeduction = excluded.reduce((s, i) => s + i.amount, 0);
  const adjustments = excluded.map(item => ({
    item_id: item.id,
    original_amount: item.amount,
    adjusted_amount: 0,
    deduction: item.amount,
  }));

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'item_exclusion',
    original_amount: totalDeduction,
    adjusted_amount: 0,
    deduction_amount: totalDeduction,
    explanation: `${excluded.length} item(s) excluded: ${reason}. Deduction: ₹${totalDeduction.toFixed(2)}`,
    affected_items: excluded.map(i => i.id),
    item_adjustments: adjustments,
  };
}

function applySubLimit(rule: InsurerRule, context: BillContext): RuleResult | null {
  const params = rule.parameters;
  const category = params.category;
  const maxAmount = params.max_amount;
  if (!category || !maxAmount) return null;

  const catItems = context.line_items.filter(i => i.category === category);
  if (catItems.length === 0) return null;

  const totalCategory = catItems.reduce((s, i) => s + i.amount, 0);
  if (totalCategory <= maxAmount) return null;

  const ratio = maxAmount / totalCategory;
  const deduction = totalCategory - maxAmount;
  const adjustments = catItems.map(item => ({
    item_id: item.id,
    original_amount: item.amount,
    adjusted_amount: Math.round(item.amount * ratio * 100) / 100,
    deduction: Math.round(item.amount * (1 - ratio) * 100) / 100,
  }));

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'sub_limit',
    original_amount: totalCategory,
    adjusted_amount: maxAmount,
    deduction_amount: deduction,
    explanation: `${category} charges capped at ₹${maxAmount.toLocaleString('en-IN')}. Total: ₹${totalCategory.toLocaleString('en-IN')}. Deduction: ₹${deduction.toFixed(2)}`,
    affected_items: catItems.map(i => i.id),
    item_adjustments: adjustments,
  };
}

function applyPackageRate(rule: InsurerRule, context: BillContext): RuleResult | null {
  const params = rule.parameters;
  const procedureCode = params.procedure_code;
  const packageAmount = params.package_amount;
  if (!procedureCode || !packageAmount) return null;

  const procItems = context.line_items.filter(i => i.procedure_code === procedureCode);
  if (procItems.length === 0) return null;

  const totalActual = procItems.reduce((s, i) => s + i.amount, 0);
  if (totalActual <= packageAmount) return null;

  const deduction = totalActual - packageAmount;

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'package_rate',
    original_amount: totalActual,
    adjusted_amount: packageAmount,
    deduction_amount: deduction,
    explanation: `Package rate ₹${packageAmount.toLocaleString('en-IN')} for ${procedureCode}. Actual: ₹${totalActual.toLocaleString('en-IN')}. Deduction: ₹${deduction.toFixed(2)}`,
    affected_items: procItems.map(i => i.id),
    item_adjustments: procItems.map(item => ({
      item_id: item.id,
      original_amount: item.amount,
      adjusted_amount: Math.round((item.amount / totalActual) * packageAmount * 100) / 100,
      deduction: Math.round(item.amount - (item.amount / totalActual) * packageAmount * 100) / 100,
    })),
  };
}

function applyWaitingPeriod(rule: InsurerRule, context: BillContext): RuleResult | null {
  const params = rule.parameters;
  const diseaseCode = params.disease_code;
  const waitingDays = params.days;
  if (!diseaseCode || !waitingDays || !context.admission_date) return null;

  const diagnosisCodes = context.diagnosis_codes || [];
  if (!diagnosisCodes.includes(diseaseCode)) return null;

  // Waiting period logic: if admission_date is within waiting period, entire claim denied for this disease
  // This is a simplified check — real implementation would check policy start date
  const totalBill = context.line_items.reduce((s, i) => s + i.amount, 0);

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'waiting_period',
    original_amount: totalBill,
    adjusted_amount: 0,
    deduction_amount: totalBill,
    explanation: `Waiting period of ${waitingDays} days for ${diseaseCode}. Claim denied.`,
    affected_items: context.line_items.map(i => i.id),
    item_adjustments: context.line_items.map(item => ({
      item_id: item.id,
      original_amount: item.amount,
      adjusted_amount: 0,
      deduction: item.amount,
    })),
  };
}

function applyDiseaseCap(rule: InsurerRule, context: BillContext, currentTotal: number): RuleResult | null {
  const params = rule.parameters;
  const diseaseCode = params.disease_code;
  const maxAmount = params.max_amount;
  if (!diseaseCode || !maxAmount) return null;

  const diagnosisCodes = context.diagnosis_codes || [];
  if (!diagnosisCodes.includes(diseaseCode)) return null;

  if (currentTotal <= maxAmount) return null;

  const deduction = currentTotal - maxAmount;

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'disease_cap',
    original_amount: currentTotal,
    adjusted_amount: maxAmount,
    deduction_amount: deduction,
    explanation: `Disease cap ₹${maxAmount.toLocaleString('en-IN')} for ${diseaseCode}. Total: ₹${currentTotal.toLocaleString('en-IN')}. Deduction: ₹${deduction.toFixed(2)}`,
    affected_items: context.line_items.map(i => i.id),
    item_adjustments: [],
  };
}

function applyNetworkTierPricing(rule: InsurerRule, context: BillContext): RuleResult | null {
  const params = rule.parameters;
  const tier = context.network_tier || 'standard';
  const multiplier = params[tier];
  if (multiplier === undefined || multiplier >= 1) return null;
  if (multiplier === 0) {
    // Not covered at this tier
    const total = context.line_items.reduce((s, i) => s + i.amount, 0);
    return {
      rule_id: rule.id,
      rule_name: rule.rule_name,
      rule_type: 'network_tier_pricing',
      original_amount: total,
      adjusted_amount: 0,
      deduction_amount: total,
      explanation: `Hospital not covered under ${tier} tier. Full deduction.`,
      affected_items: context.line_items.map(i => i.id),
      item_adjustments: context.line_items.map(item => ({
        item_id: item.id, original_amount: item.amount, adjusted_amount: 0, deduction: item.amount,
      })),
    };
  }

  const adjustments: ItemAdjustment[] = [];
  let totalOriginal = 0;
  let totalAdjusted = 0;

  for (const item of context.line_items) {
    const adjusted = Math.round(item.amount * multiplier * 100) / 100;
    totalOriginal += item.amount;
    totalAdjusted += adjusted;
    adjustments.push({ item_id: item.id, original_amount: item.amount, adjusted_amount: adjusted, deduction: item.amount - adjusted });
  }

  const deduction = totalOriginal - totalAdjusted;
  if (deduction <= 0) return null;

  return {
    rule_id: rule.id,
    rule_name: rule.rule_name,
    rule_type: 'network_tier_pricing',
    original_amount: totalOriginal,
    adjusted_amount: totalAdjusted,
    deduction_amount: deduction,
    explanation: `${tier} tier pricing at ${(multiplier * 100).toFixed(0)}%. Deduction: ₹${deduction.toFixed(2)}`,
    affected_items: context.line_items.map(i => i.id),
    item_adjustments: adjustments,
  };
}

function applyCategoryCap(rule: InsurerRule, context: BillContext): RuleResult | null {
  // Same logic as sub_limit but using 'category_cap' type name
  return applySubLimit({ ...rule, rule_type: 'sub_limit' } as any, context);
}

// ─── Main Evaluator ─────────────────────────────────────────

/**
 * Evaluate all active rules for an insurer against a bill.
 *
 * Pipeline:
 * 1. Load rules (passed in, sorted by priority)
 * 2. Filter by conditions
 * 3. Apply in priority order
 * 4. Accumulate deductions
 */
export function evaluateRules(rules: InsurerRule[], context: BillContext): EvaluationResult {
  // Sort by priority (lower = higher priority)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  const results: RuleResult[] = [];
  let runningTotal = context.line_items.reduce((s, i) => s + i.amount, 0);
  const originalTotal = runningTotal;

  for (const rule of sortedRules) {
    if (rule.status !== 'active') continue;
    if (!matchesConditions(rule, context)) continue;

    let result: RuleResult | null = null;

    switch (rule.rule_type) {
      case 'room_rent_cap':
        result = applyRoomRentCap(rule, context);
        break;
      case 'proportional_deduction':
        result = applyProportionalDeduction(rule, context, results);
        break;
      case 'co_pay':
        result = applyCoPay(rule, context, runningTotal);
        break;
      case 'item_exclusion':
        result = applyItemExclusion(rule, context);
        break;
      case 'sub_limit':
        result = applySubLimit(rule, context);
        break;
      case 'package_rate':
        result = applyPackageRate(rule, context);
        break;
      case 'waiting_period':
        result = applyWaitingPeriod(rule, context);
        break;
      case 'disease_cap':
        result = applyDiseaseCap(rule, context, runningTotal);
        break;
      case 'network_tier_pricing':
        result = applyNetworkTierPricing(rule, context);
        break;
      case 'category_cap':
        result = applyCategoryCap(rule, context);
        break;
    }

    if (result && result.deduction_amount > 0) {
      results.push(result);
      runningTotal -= result.deduction_amount;
    }
  }

  // Compute per-item totals
  const itemTotals = new Map<string, { original: number; adjusted: number; deduction: number }>();
  for (const item of context.line_items) {
    itemTotals.set(item.id, { original: item.amount, adjusted: item.amount, deduction: 0 });
  }
  for (const result of results) {
    for (const adj of result.item_adjustments) {
      const existing = itemTotals.get(adj.item_id);
      if (existing) {
        existing.adjusted -= adj.deduction;
        existing.deduction += adj.deduction;
      }
    }
  }

  return {
    insurer_id: '',
    total_original: originalTotal,
    total_adjusted: Math.max(0, runningTotal),
    total_deduction: originalTotal - Math.max(0, runningTotal),
    rule_results: results,
    item_totals: itemTotals,
  };
}
