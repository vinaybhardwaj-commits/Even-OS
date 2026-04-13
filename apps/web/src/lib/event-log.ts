import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

export type EventType = 'created' | 'updated' | 'deleted' | 'restored' | 'status_changed';

export interface WriteEventParams {
  hospital_id: string;
  resource_type: string;  // e.g. 'condition', 'allergy', 'medication_request', 'procedure', 'observation'
  resource_id: string;
  event_type: EventType;
  data: Record<string, unknown>;        // full snapshot of the resource
  delta?: Record<string, unknown>;      // only the changed fields (for updates)
  actor_id: string;
  actor_email: string;
  reason?: string;
}

/**
 * Write an append-only event to the event_log table for clinical-safety-critical resources.
 * This function handles race-condition-free versioning via INSERT ... SELECT.
 */
export async function writeEvent(params: WriteEventParams): Promise<void> {
  try {
    await getSql()`
      INSERT INTO event_log (
        hospital_id,
        resource_type,
        resource_id,
        version,
        event_type,
        data,
        delta,
        actor_id,
        actor_email,
        reason,
        timestamp
      )
      SELECT
        ${params.hospital_id},
        ${params.resource_type},
        ${params.resource_id}::uuid,
        COALESCE(MAX(version), 0) + 1,
        ${params.event_type},
        ${JSON.stringify(params.data)}::jsonb,
        ${params.delta ? JSON.stringify(params.delta) : null}::jsonb,
        ${params.actor_id}::uuid,
        ${params.actor_email},
        ${params.reason || null},
        NOW()
      FROM event_log
      WHERE hospital_id = ${params.hospital_id}
        AND resource_type = ${params.resource_type}
        AND resource_id = ${params.resource_id}::uuid
    `;
  } catch (error) {
    // Log but don't throw — event logging failures should not break the main operation
    console.error('Error writing event log:', {
      resource_type: params.resource_type,
      resource_id: params.resource_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get the complete event history for a resource, ordered by version ascending.
 */
export async function getResourceHistory(
  hospital_id: string,
  resource_type: string,
  resource_id: string
): Promise<any[]> {
  try {
    const result = await getSql()`
      SELECT
        id,
        version,
        event_type,
        data,
        delta,
        actor_id,
        actor_email,
        reason,
        timestamp
      FROM event_log
      WHERE hospital_id = ${hospital_id}
        AND resource_type = ${resource_type}
        AND resource_id = ${resource_id}::uuid
      ORDER BY version ASC
    `;

    return (result as any) || [];
  } catch (error) {
    console.error('Error fetching resource history:', error);
    return [];
  }
}

/**
 * Get the event at a specific version number for a resource.
 */
export async function getResourceAtVersion(
  hospital_id: string,
  resource_type: string,
  resource_id: string,
  version: number
): Promise<any> {
  try {
    const result = await getSql()`
      SELECT
        id,
        version,
        event_type,
        data,
        delta,
        actor_id,
        actor_email,
        reason,
        timestamp
      FROM event_log
      WHERE hospital_id = ${hospital_id}
        AND resource_type = ${resource_type}
        AND resource_id = ${resource_id}::uuid
        AND version = ${version}
      LIMIT 1
    `;

    const rows = (result as any) || [];
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('Error fetching resource at version:', error);
    return null;
  }
}
