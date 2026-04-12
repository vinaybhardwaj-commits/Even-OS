import { getDb } from '@even-os/db';
import { masterDataVersionHistory } from '@db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { JWTPayload } from '@/lib/auth';

type EntityType = 'charge_master' | 'drug_master' | 'order_set' | 'consent_template' |
  'discharge_template' | 'gst_rate' | 'approval_hierarchy' | 'nabh_indicator';

/**
 * Record a version history entry for a master data entity.
 * Always called after a create or update operation.
 */
export async function recordVersion(
  actor: JWTPayload,
  entityType: EntityType,
  entityId: string,
  newData: Record<string, unknown>,
  oldData?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const db = getDb();

    // Calculate next version number
    const lastVersion = await db.select({ v: sql<number>`COALESCE(MAX(version), 0)` })
      .from(masterDataVersionHistory)
      .where(and(
        eq(masterDataVersionHistory.entity_id, entityId as any),
        eq(masterDataVersionHistory.entity_type, entityType),
      ));
    const nextVersion = Number(lastVersion[0]?.v ?? 0) + 1;

    // Calculate changed fields
    let changedFields: string[] | null = null;
    if (oldData) {
      changedFields = [];
      const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
      for (const key of allKeys) {
        if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
          changedFields.push(key);
        }
      }
    }

    await db.insert(masterDataVersionHistory).values({
      hospital_id: actor.hospital_id,
      entity_type: entityType,
      entity_id: entityId as any,
      version: nextVersion,
      old_data: oldData ?? null,
      new_data: newData,
      changed_fields: changedFields,
      actor_id: actor.sub as any,
      actor_email: actor.email,
    });
  } catch (err) {
    console.error('[version-history] Failed to record version:', err);
  }
}

/**
 * Retrieve version history for a specific entity.
 */
export async function getVersionHistory(
  entityType: EntityType,
  entityId: string,
) {
  const db = getDb();
  return db.select()
    .from(masterDataVersionHistory)
    .where(and(
      eq(masterDataVersionHistory.entity_type, entityType),
      eq(masterDataVersionHistory.entity_id, entityId as any),
    ))
    .orderBy(desc(masterDataVersionHistory.version));
}
