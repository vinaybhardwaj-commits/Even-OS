/**
 * LSQ Sync Engine for Even OS
 * Handles: batch sync, upsert patients, log sync runs + API calls
 */

import { db } from '@/lib/db';
import { patients, lsqSyncLog, lsqApiLog, lsqSyncState } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { fetchLeadsModifiedAfter, normalizeLeadToPatient, isLsqConfigured, type LsqApiCallResult } from './client';

export interface SyncRunResult {
  sync_id: string;
  status: 'success' | 'partial' | 'failed';
  total: number;
  new_count: number;
  updated: number;
  skipped: number;
  errors: number;
  error_message?: string;
}

/**
 * Run a full LSQ sync for a hospital
 */
export async function runLsqSync(hospitalId: string, userId: string): Promise<SyncRunResult> {
  // 1. Create sync run record
  const [syncRun] = await db.insert(lsqSyncLog).values({
    hospital_id: hospitalId,
    status: 'partial' as any, // Will update on completion
  }).returning();

  if (!isLsqConfigured()) {
    // Update run as failed
    await db.update(lsqSyncLog)
      .set({ status: 'failed' as any, error_message: 'LSQ API keys not configured' })
      .where(eq(lsqSyncLog.id, syncRun.id as any));

    return {
      sync_id: syncRun.id,
      status: 'failed',
      total: 0, new_count: 0, updated: 0, skipped: 0, errors: 0,
      error_message: 'LSQ API keys not configured. Set LSQ_ACCESS_KEY and LSQ_SECRET_KEY in environment.',
    };
  }

  // 2. Determine last sync time
  const lastSync = await db.execute(sql`
    SELECT MAX(sync_at) as last_sync
    FROM lsq_sync_log
    WHERE hospital_id = ${hospitalId}
      AND status = 'success'
      AND id != ${syncRun.id}::uuid
  `);
  const lastSyncRows = (lastSync as any).rows || lastSync;
  const since = lastSyncRows[0]?.last_sync
    ? new Date(lastSyncRows[0].last_sync)
    : new Date('2024-01-01'); // First-time sync: go back far

  // 3. Fetch leads from LSQ
  const apiResult = await fetchLeadsModifiedAfter(since);

  // 4. Log API call
  await db.insert(lsqApiLog).values({
    hospital_id: hospitalId,
    api_endpoint: 'LeadManagement.svc/Leads.GetByFilter',
    request_method: 'POST',
    response_status: apiResult.status,
    latency_ms: apiResult.latency_ms,
    error: apiResult.error || null,
  });

  if (apiResult.error || !apiResult.leads) {
    await db.update(lsqSyncLog)
      .set({
        status: 'failed' as any,
        error_message: apiResult.error || 'No leads returned',
      })
      .where(eq(lsqSyncLog.id, syncRun.id as any));

    return {
      sync_id: syncRun.id,
      status: 'failed',
      total: 0, new_count: 0, updated: 0, skipped: 0, errors: 0,
      error_message: apiResult.error || 'Failed to fetch leads from LSQ',
    };
  }

  // 5. Process leads
  const leads = apiResult.leads;
  let newCount = 0, updated = 0, skipped = 0, errors = 0;

  for (const lead of leads) {
    try {
      const normalized = normalizeLeadToPatient(lead);

      if (!normalized.phone || normalized.phone.length < 10) {
        skipped++;
        continue;
      }

      // Check if lead already synced
      const [existing] = await db.select({ id: lsqSyncState.id, patient_id: lsqSyncState.patient_id })
        .from(lsqSyncState)
        .where(and(
          eq(lsqSyncState.hospital_id, hospitalId),
          eq(lsqSyncState.lsq_lead_id, normalized.lsq_lead_id),
        ))
        .limit(1);

      if (existing && existing.patient_id) {
        // Update existing patient
        await db.update(patients)
          .set({
            name_full: normalized.name_full,
            phone: normalized.phone,
            email: normalized.email,
            gender: normalized.gender as any,
            patient_category: normalized.patient_category as any,
            updated_at: new Date(),
          })
          .where(eq(patients.id, existing.patient_id as any));

        // Update sync state
        await db.update(lsqSyncState)
          .set({ synced_at: new Date(), status: 'processed' as any })
          .where(eq(lsqSyncState.id, existing.id as any));

        updated++;
      } else {
        // Generate UHID for new patient
        const uhidResult = await db.execute(sql`
          UPDATE uhid_sequences
          SET next_value = next_value + 1
          WHERE hospital_id = ${hospitalId}
          RETURNING next_value - 1 as current_value, site_code
        `);
        const uhidRows = (uhidResult as any).rows || uhidResult;
        if (!uhidRows[0]) {
          errors++;
          continue;
        }
        const uhid = `EVEN-${uhidRows[0].site_code}-${String(uhidRows[0].current_value).padStart(6, '0')}`;

        // Create patient
        const [newPatient] = await db.insert(patients).values({
          hospital_id: hospitalId,
          uhid,
          name_given: normalized.name_given,
          name_family: normalized.name_family,
          name_full: normalized.name_full,
          phone: normalized.phone,
          email: normalized.email,
          gender: normalized.gender as any,
          dob: normalized.dob ? new Date(normalized.dob) : null,
          source_type: 'lsq_lead' as any,
          patient_category: normalized.patient_category as any,
          lsq_lead_id: normalized.lsq_lead_id,
          status: 'active' as any,
          created_by_user_id: userId,
        } as any).returning();

        // Create or update sync state
        if (existing) {
          await db.update(lsqSyncState)
            .set({ patient_id: newPatient.id, synced_at: new Date(), status: 'synced' as any })
            .where(eq(lsqSyncState.id, existing.id as any));
        } else {
          await db.insert(lsqSyncState).values({
            hospital_id: hospitalId,
            lsq_lead_id: normalized.lsq_lead_id,
            patient_id: newPatient.id,
            status: 'synced' as any,
          });
        }

        newCount++;
      }
    } catch {
      errors++;
    }
  }

  // 6. Update sync run
  const status = errors > 0 && (newCount + updated) > 0 ? 'partial' : errors > 0 ? 'failed' : 'success';
  await db.update(lsqSyncLog)
    .set({
      status: status as any,
      lead_count_total: leads.length,
      lead_count_new: newCount,
      lead_count_updated: updated,
      lead_count_skipped: skipped,
      lead_count_error: errors,
    })
    .where(eq(lsqSyncLog.id, syncRun.id as any));

  return {
    sync_id: syncRun.id,
    status,
    total: leads.length,
    new_count: newCount,
    updated,
    skipped,
    errors,
  };
}
