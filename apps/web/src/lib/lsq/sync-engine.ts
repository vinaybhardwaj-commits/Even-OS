/**
 * LSQ Sync Engine for Even OS
 * Handles: batch sync, upsert patients, log sync runs + API calls,
 * and per-event granular logging to lsq_integration_sync_log.
 */

import { db } from '@/lib/db';
import { patients, lsqSyncLog, lsqApiLog, lsqSyncState } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { fetchLeadsModifiedAfter, normalizeLeadToPatient, isLsqConfigured } from './client';

/**
 * Ensure the lsq_integration_sync_log table exists (self-healing).
 * Safe to call repeatedly — uses IF NOT EXISTS.
 */
async function ensureGranularTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lsq_integration_sync_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sync_batch_id TEXT,
      sync_type TEXT NOT NULL DEFAULT 'generic_update',
      patient_id UUID,
      patient_uhid TEXT,
      win_capture_id UUID,
      encounter_id UUID,
      lsq_lead_id TEXT,
      lsq_contact_id TEXT,
      event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      dedup_checked BOOLEAN DEFAULT true,
      dedup_match_uhid TEXT,
      dedup_action TEXT,
      sync_status TEXT NOT NULL DEFAULT 'success',
      http_status_code TEXT,
      error_message TEXT,
      retry_count TEXT DEFAULT '0',
      next_retry_at TIMESTAMPTZ,
      lsq_response JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

/**
 * Log a per-patient-event record to lsq_integration_sync_log
 */
async function logGranularEvent(params: {
  syncBatchId: string;
  syncType: string;
  patientId?: string | null;
  patientUhid?: string | null;
  lsqLeadId: string;
  eventData: unknown;
  dedupChecked: boolean;
  dedupMatchUhid?: string | null;
  dedupAction?: string | null;
  syncStatus: string;
  httpStatusCode?: string | null;
  errorMessage?: string | null;
  lsqResponse?: unknown;
}) {
  try {
    await db.execute(sql`
      INSERT INTO lsq_integration_sync_log
        (sync_batch_id, sync_type, patient_id, patient_uhid, lsq_lead_id,
         event_data, dedup_checked, dedup_match_uhid, dedup_action,
         sync_status, http_status_code, error_message, lsq_response)
      VALUES (
        ${params.syncBatchId},
        ${params.syncType},
        ${params.patientId ?? null}::uuid,
        ${params.patientUhid ?? null},
        ${params.lsqLeadId},
        ${JSON.stringify(params.eventData)}::jsonb,
        ${params.dedupChecked},
        ${params.dedupMatchUhid ?? null},
        ${params.dedupAction ?? null},
        ${params.syncStatus},
        ${params.httpStatusCode ?? null},
        ${params.errorMessage ?? null},
        ${params.lsqResponse ? JSON.stringify(params.lsqResponse) : null}::jsonb
      )
    `);
  } catch (e) {
    // Non-blocking — don't fail the sync if granular logging fails
    console.error('[LSQ] Failed to log granular event:', e);
  }
}

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
  // 0. Ensure granular log table exists
  await ensureGranularTable();

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
        // Log skipped event (bad phone)
        await logGranularEvent({
          syncBatchId: syncRun.id,
          syncType: 'generic_update',
          lsqLeadId: normalized.lsq_lead_id,
          eventData: lead,
          dedupChecked: false,
          syncStatus: 'failure',
          errorMessage: `Invalid phone: "${lead.Phone || ''}" — skipped`,
        });
        continue;
      }

      // Check if lead already synced (dedup check)
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

        // Get UHID for logging
        const [existingPatient] = await db.select({ uhid: patients.uhid })
          .from(patients)
          .where(eq(patients.id, existing.patient_id as any))
          .limit(1);

        // Update sync state
        await db.update(lsqSyncState)
          .set({ synced_at: new Date(), status: 'processed' as any })
          .where(eq(lsqSyncState.id, existing.id as any));

        updated++;

        // Log updated event
        await logGranularEvent({
          syncBatchId: syncRun.id,
          syncType: 'generic_update',
          patientId: existing.patient_id as string,
          patientUhid: existingPatient?.uhid,
          lsqLeadId: normalized.lsq_lead_id,
          eventData: lead,
          dedupChecked: true,
          dedupMatchUhid: existingPatient?.uhid,
          dedupAction: 'none',
          syncStatus: 'success',
          httpStatusCode: String(apiResult.status),
        });
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
          await logGranularEvent({
            syncBatchId: syncRun.id,
            syncType: 'generic_update',
            lsqLeadId: normalized.lsq_lead_id,
            eventData: lead,
            dedupChecked: true,
            syncStatus: 'failure',
            errorMessage: 'UHID sequence not found for hospital',
          });
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

        // Log new patient event
        await logGranularEvent({
          syncBatchId: syncRun.id,
          syncType: normalized.lsq_stage?.includes('IPD') ? 'admission' : 'opd_inquiry',
          patientId: newPatient.id,
          patientUhid: uhid,
          lsqLeadId: normalized.lsq_lead_id,
          eventData: lead,
          dedupChecked: true,
          dedupAction: 'none',
          syncStatus: 'success',
          httpStatusCode: String(apiResult.status),
        });
      }
    } catch (err) {
      errors++;
      // Log error event
      await logGranularEvent({
        syncBatchId: syncRun.id,
        syncType: 'generic_update',
        lsqLeadId: lead.ProspectID || 'unknown',
        eventData: lead,
        dedupChecked: false,
        syncStatus: 'failure',
        errorMessage: err instanceof Error ? err.message : 'Unknown processing error',
      });
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
