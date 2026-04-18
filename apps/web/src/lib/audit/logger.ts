import { db } from '@/lib/db';
import { auditLog, chartAuditLog } from '@db/schema';
import type { JWTPayload } from '@/lib/auth';

type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'ACCESS' | 'EXPORT';

interface AuditEntry {
  action: AuditAction;
  table_name: string;
  row_id?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  reason?: string;
  ip_address?: string;
  user_agent?: string;
}

/**
 * Map generic audit table_name → chart-writeable action/resource.
 * PC.3.1: teeing writeAuditLog into chart_audit_log whenever a clinical write
 * hits one of these tables. Non-chart writes (config, billing, user mgmt)
 * are NOT duplicated — chart_audit_log is patient-scoped only.
 */
const CHART_WRITE_MAP: Record<string, { action: string; resource_type: string }> = {
  clinical_impression:      { action: 'note_edit',            resource_type: 'clinical_note' },
  clinical_notes:           { action: 'note_edit',            resource_type: 'clinical_note' },
  medication_request:       { action: 'order_place',          resource_type: 'medication_order' },
  medication_order:         { action: 'order_place',          resource_type: 'medication_order' },
  medication_administration:{ action: 'medication_administer',resource_type: 'mar_administration' },
  mar_administration:       { action: 'medication_administer',resource_type: 'mar_administration' },
  condition:                { action: 'problem_add',          resource_type: 'condition' },
  conditions:               { action: 'problem_add',          resource_type: 'condition' },
  observation:              { action: 'vitals_record',        resource_type: 'observation' },
  observations:             { action: 'vitals_record',        resource_type: 'observation' },
  allergy_intolerance:      { action: 'allergy_add',          resource_type: 'allergy' },
  allergies:                { action: 'allergy_add',          resource_type: 'allergy' },
  procedure:                { action: 'procedure_record',     resource_type: 'procedure' },
  procedures:               { action: 'procedure_record',     resource_type: 'procedure' },
  service_request:          { action: 'order_place',          resource_type: 'service_request' },
  service_requests:         { action: 'order_place',          resource_type: 'service_request' },
  diet_order:               { action: 'order_place',          resource_type: 'diet_order' },
  nursing_order:            { action: 'order_place',          resource_type: 'nursing_order' },
  care_plan:                { action: 'care_plan_update',     resource_type: 'care_plan' },
  care_plans:               { action: 'care_plan_update',     resource_type: 'care_plan' },
  problem_list:             { action: 'problem_add',          resource_type: 'problem' },
  chart_update_proposal:    { action: 'proposal_resolve',     resource_type: 'chart_proposal' },
  chart_update_proposals:   { action: 'proposal_resolve',     resource_type: 'chart_proposal' },
};

/**
 * Write an immutable audit log entry.
 * This function is fire-and-forget — it should never block the calling operation.
 * PC.3.1: also writes a chart_audit_log row when the write is chart-scoped.
 */
export async function writeAuditLog(
  actor: JWTPayload | null,
  entry: AuditEntry
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      hospital_id: actor?.hospital_id || 'unknown',
      table_name: entry.table_name,
      row_id: entry.row_id || 'unknown',
      action: entry.action as any,
      old_data: entry.old_values ?? null,
      new_data: stripPIIFromAudit(entry.new_values ?? {}),
      delta: null,
      actor_id: actor?.sub ? (actor.sub as any) : null,
      actor_email: actor?.email,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      reason: entry.reason,
    });
  } catch (error) {
    // Audit logging should never crash the application
    console.error('[AUDIT] Failed to write audit log:', error);
  }

  // PC.3.1: tee to chart_audit_log for chart-writeable resources
  const chartMeta = CHART_WRITE_MAP[entry.table_name];
  if (chartMeta) {
    try {
      const merged = { ...(entry.old_values ?? {}), ...(entry.new_values ?? {}) } as Record<string, unknown>;
      const patient_id = typeof merged.patient_id === 'string' ? merged.patient_id : undefined;
      // Only write when we actually have a patient_id — chart_audit_log is patient-scoped
      if (patient_id) {
        const encounter_id = typeof merged.encounter_id === 'string' ? merged.encounter_id : undefined;
        await db.insert(chartAuditLog).values({
          patient_id,
          encounter_id: encounter_id ?? null,
          hospital_id: actor?.hospital_id || 'unknown',
          user_id: actor?.sub ? (actor.sub as any) : null,
          user_role: (actor as any)?.role || 'unknown',
          action: `${chartMeta.action}.${entry.action.toLowerCase()}`,
          resource_type: chartMeta.resource_type,
          resource_id: entry.row_id ?? null,
          payload_summary: {
            table_name: entry.table_name,
            reason: entry.reason ?? null,
          },
        });
      }
    } catch (error) {
      console.warn('[CHART_AUDIT] Failed to tee to chart_audit_log:', error);
    }
  }
}

/**
 * Strip sensitive values from audit log entries (guardrail G-5.1)
 */
function stripPIIFromAudit(values: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['password_hash', 'token_hash', 'auth_encrypted', 'p256dh_encrypted'];
  const cleaned = { ...values };
  for (const field of sensitiveFields) {
    if (field in cleaned) {
      cleaned[field] = 'REDACTED';
    }
  }
  return cleaned;
}
