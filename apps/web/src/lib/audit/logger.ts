import { db } from '@/lib/db';
import { auditLog } from '@db/schema';
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
 * Write an immutable audit log entry.
 * This function is fire-and-forget — it should never block the calling operation.
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
