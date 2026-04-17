/**
 * Form Condition Evaluator
 * Runtime evaluation of field and section visibility conditions.
 */

import type { FieldCondition, ConditionOperator } from './types';

/**
 * Evaluate a single field condition against current form data.
 */
export function evaluateCondition(
  condition: FieldCondition | undefined,
  formData: Record<string, any>
): boolean {
  if (!condition) return true;

  // Group condition: recursively evaluate child conditions
  if (condition.type === 'group' && condition.conditions) {
    const logic = condition.logic || 'AND';
    const results = condition.conditions.map((c) =>
      evaluateCondition(c, formData)
    );

    if (logic === 'AND') {
      return results.every((r) => r === true);
    } else if (logic === 'OR') {
      return results.some((r) => r === true);
    }
    return true;
  }

  // Field condition: evaluate operator
  if (condition.type === 'field' && condition.fieldId && condition.operator) {
    const fieldValue = formData[condition.fieldId];
    const compareValue = condition.value;
    return evaluateOperator(
      condition.operator,
      fieldValue,
      compareValue
    );
  }

  return true;
}

/**
 * Evaluate all conditions in a group using AND/OR logic.
 */
export function evaluateAllConditions(
  conditions: FieldCondition[],
  formData: Record<string, any>,
  logic: 'AND' | 'OR' = 'AND'
): boolean {
  if (!conditions || conditions.length === 0) return true;

  const results = conditions.map((c) => evaluateCondition(c, formData));

  if (logic === 'AND') {
    return results.every((r) => r === true);
  } else if (logic === 'OR') {
    return results.some((r) => r === true);
  }

  return true;
}

/**
 * Evaluate a single operator against field value and compare value.
 */
function evaluateOperator(
  operator: ConditionOperator,
  fieldValue: any,
  compareValue: any
): boolean {
  switch (operator) {
    case 'equals':
      return fieldValue === compareValue;

    case 'not_equals':
      return fieldValue !== compareValue;

    case 'greater_than':
      return Number(fieldValue) > Number(compareValue);

    case 'less_than':
      return Number(fieldValue) < Number(compareValue);

    case 'greater_or_equal':
      return Number(fieldValue) >= Number(compareValue);

    case 'less_or_equal':
      return Number(fieldValue) <= Number(compareValue);

    case 'contains':
      return String(fieldValue).includes(String(compareValue));

    case 'not_contains':
      return !String(fieldValue).includes(String(compareValue));

    case 'is_empty':
      return !fieldValue || fieldValue === '' || fieldValue.length === 0;

    case 'is_not_empty':
      return fieldValue && fieldValue !== '' && fieldValue.length > 0;

    case 'in_list':
      return Array.isArray(compareValue)
        ? compareValue.includes(fieldValue)
        : false;

    case 'not_in_list':
      return Array.isArray(compareValue)
        ? !compareValue.includes(fieldValue)
        : true;

    default:
      return true;
  }
}
