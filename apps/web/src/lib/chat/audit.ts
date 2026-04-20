/**
 * CHAT.X.7 — Central chat audit logger.
 *
 * Single source of truth for writing into chat_audit_log. Previously
 * lived as a local helper inside `server/routers/chat.ts` so only
 * user-driven chat mutations were logged. That left a blind spot:
 * channels created/archived by the encounter lifecycle
 * (channel-manager.ts) and auto-events posted from clinical mutations
 * (auto-events.ts) left no audit trace.
 *
 * The 0058 migration relaxes NOT NULL on user_id + user_name and adds
 * a `source` column (user | system | integration). This helper
 * centralizes that contract:
 *   - source='user'     → user_id + user_name required
 *   - source='system'   → actor may be null (channel lifecycle,
 *                         auto-events). Defaults to user_id=null.
 *   - source='integration' → reserved for HL7/FHIR inbound, 3rd-party
 *                         webhooks. Not wired yet.
 *
 * Fire-and-forget: callers should `void logAudit({...})`. Returns
 * Promise<void>. Never throws — console.warn on DB failure so we
 * never break the calling mutation.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

export type AuditSource = 'user' | 'system' | 'integration';

export interface AuditLogParams {
  action: string;
  hospital_id: string;
  source?: AuditSource; // defaults to 'user' for backward compat
  user_id?: string | null;
  user_name?: string | null;
  channel_id?: string | null;
  message_id?: number | null;
  target_user_id?: string | null;
  details?: Record<string, any>;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  const source: AuditSource = params.source ?? 'user';

  // Runtime invariant: user-sourced rows must identify the user.
  // Skip the write rather than throw — a missing audit row is better
  // than breaking the calling mutation.
  if (source === 'user' && (!params.user_id || !params.user_name)) {
    console.warn(
      '[ChatAudit] Skipping user-sourced audit row: missing user_id/user_name',
      { action: params.action, hospital_id: params.hospital_id }
    );
    return;
  }

  const sql = getSql();
  try {
    await sql`
      INSERT INTO chat_audit_log (
        action, source, user_id, user_name, hospital_id,
        channel_id, message_id, target_user_id, details
      ) VALUES (
        ${params.action}, ${source},
        ${params.user_id ?? null}, ${params.user_name ?? null},
        ${params.hospital_id},
        ${params.channel_id ?? null}, ${params.message_id ?? null},
        ${params.target_user_id ?? null},
        ${JSON.stringify(params.details ?? {})}
      )
    `;
  } catch (err) {
    console.warn('[ChatAudit] Failed to log:', err);
  }
}
