/**
 * LSQ Sync Engine for Even OS
 *
 * Robust implementation using raw SQL via neon() — no Drizzle ORM dependency.
 * Self-healing: creates required tables if they don't exist.
 * Only syncs IPD WIN leads (admitted patients).
 */

import { getSql } from '@/lib/db';
import { fetchLeadsModifiedAfter, normalizeLeadToPatient, isLsqConfigured, type LsqLead } from './client';

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
 * Ensure all required tables exist (self-healing).
 * Uses CREATE TABLE IF NOT EXISTS — safe to call on every sync.
 */
async function ensureTables() {
  const sql = getSql();

  // 1. lsq_sync_log — batch-level sync run records
  await sql`
    CREATE TABLE IF NOT EXISTS lsq_sync_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      sync_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      lead_count_total INTEGER DEFAULT 0,
      lead_count_new INTEGER DEFAULT 0,
      lead_count_updated INTEGER DEFAULT 0,
      lead_count_skipped INTEGER DEFAULT 0,
      lead_count_error INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error_message TEXT
    )
  `;

  // 2. lsq_api_log — API call trace
  await sql`
    CREATE TABLE IF NOT EXISTS lsq_api_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      api_endpoint TEXT NOT NULL,
      request_method TEXT NOT NULL DEFAULT 'POST',
      response_status INTEGER,
      latency_ms INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // 3. lsq_sync_state — lead-to-patient mapping state
  await sql`
    CREATE TABLE IF NOT EXISTS lsq_sync_state (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      lsq_lead_id TEXT NOT NULL,
      patient_id UUID,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT DEFAULT 'synced',
      UNIQUE(hospital_id, lsq_lead_id)
    )
  `;

  // 4. lsq_integration_sync_log — per-event granular log
  await sql`
    CREATE TABLE IF NOT EXISTS lsq_integration_sync_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sync_batch_id TEXT,
      sync_type TEXT NOT NULL DEFAULT 'generic_update',
      patient_id UUID,
      patient_uhid TEXT,
      lsq_lead_id TEXT,
      event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      dedup_checked BOOLEAN DEFAULT true,
      dedup_match_uhid TEXT,
      dedup_action TEXT,
      sync_status TEXT NOT NULL DEFAULT 'success',
      http_status_code TEXT,
      error_message TEXT,
      lsq_response JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
}

/**
 * Log a per-event record (non-blocking — swallows errors)
 */
async function logEvent(params: {
  syncBatchId: string;
  syncType: string;
  patientId?: string | null;
  patientUhid?: string | null;
  lsqLeadId: string;
  eventData: unknown;
  syncStatus: string;
  errorMessage?: string | null;
}) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO lsq_integration_sync_log
        (sync_batch_id, sync_type, patient_id, patient_uhid, lsq_lead_id,
         event_data, sync_status, error_message)
      VALUES (
        ${params.syncBatchId},
        ${params.syncType},
        ${params.patientId || null},
        ${params.patientUhid || null},
        ${params.lsqLeadId},
        ${JSON.stringify(params.eventData || {})}::jsonb,
        ${params.syncStatus},
        ${params.errorMessage || null}
      )
    `;
  } catch (e) {
    console.error('[LSQ] Failed to log event:', e);
  }
}

/**
 * Run a full LSQ sync for a hospital.
 * Only syncs IPD WIN leads. Uses raw SQL throughout for robustness.
 */
export async function runLsqSync(hospitalId: string, userId: string): Promise<SyncRunResult> {
  const sql = getSql();

  // 0. Self-heal tables
  await ensureTables();

  // 1. Create sync run record
  const [syncRun] = await sql`
    INSERT INTO lsq_sync_log (hospital_id, status)
    VALUES (${hospitalId}, 'partial')
    RETURNING id
  `;

  if (!isLsqConfigured()) {
    await sql`
      UPDATE lsq_sync_log
      SET status = 'failed', error_message = 'LSQ API keys not configured'
      WHERE id = ${syncRun.id}::uuid
    `;
    return {
      sync_id: syncRun.id,
      status: 'failed',
      total: 0, new_count: 0, updated: 0, skipped: 0, errors: 0,
      error_message: 'LSQ API keys not configured. Set LSQ_ACCESS_KEY and LSQ_SECRET_KEY.',
    };
  }

  // 2. Determine last sync time
  let since = new Date('2024-01-01');
  try {
    const lastSyncRows = await sql`
      SELECT MAX(sync_at) as last_sync
      FROM lsq_sync_log
      WHERE hospital_id = ${hospitalId}
        AND status = 'success'
        AND id != ${syncRun.id}::uuid
    `;
    if (lastSyncRows[0]?.last_sync) {
      since = new Date(lastSyncRows[0].last_sync);
    }
  } catch (e) {
    // First run — use default since date
  }

  // 3. Fetch leads from LSQ (IPD WIN only)
  const apiResult = await fetchLeadsModifiedAfter(since);

  // 4. Log API call
  try {
    await sql`
      INSERT INTO lsq_api_log (hospital_id, api_endpoint, request_method, response_status, latency_ms, error)
      VALUES (${hospitalId}, 'LeadManagement.svc/Leads.Get', 'POST', ${apiResult.status}, ${apiResult.latency_ms}, ${apiResult.error || null})
    `;
  } catch (e) {
    console.error('[LSQ] Failed to log API call:', e);
  }

  if (apiResult.error || !apiResult.leads) {
    await sql`
      UPDATE lsq_sync_log
      SET status = 'failed', error_message = ${apiResult.error || 'No leads returned'}
      WHERE id = ${syncRun.id}::uuid
    `;
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

      // Skip leads with bad phone numbers
      if (!normalized.phone || normalized.phone.length < 10) {
        skipped++;
        await logEvent({
          syncBatchId: syncRun.id,
          syncType: 'admission',
          lsqLeadId: normalized.lsq_lead_id,
          eventData: lead,
          syncStatus: 'skipped',
          errorMessage: `Invalid phone: "${lead.Phone || ''}"`,
        });
        continue;
      }

      // Check if lead already synced
      const existingRows = await sql`
        SELECT id, patient_id FROM lsq_sync_state
        WHERE hospital_id = ${hospitalId}
          AND lsq_lead_id = ${normalized.lsq_lead_id}
        LIMIT 1
      `;
      const existing = existingRows[0];

      if (existing && existing.patient_id) {
        // Update existing patient
        await sql`
          UPDATE patients SET
            name_full = ${normalized.name_full},
            phone = ${normalized.phone},
            email = ${normalized.email || null},
            gender = ${normalized.gender},
            patient_category = ${normalized.patient_category},
            updated_at = now()
          WHERE id = ${existing.patient_id}::uuid
        `;

        // Update sync state timestamp
        await sql`
          UPDATE lsq_sync_state SET synced_at = now(), status = 'synced'
          WHERE id = ${existing.id}::uuid
        `;

        updated++;

        await logEvent({
          syncBatchId: syncRun.id,
          syncType: 'generic_update',
          patientId: existing.patient_id,
          lsqLeadId: normalized.lsq_lead_id,
          eventData: lead,
          syncStatus: 'success',
        });
      } else {
        // Generate UHID for new patient
        let uhid: string;
        try {
          const uhidRows = await sql`
            UPDATE uhid_sequences
            SET next_value = next_value + 1
            WHERE hospital_id = ${hospitalId}
            RETURNING next_value - 1 as current_value, site_code
          `;
          if (!uhidRows[0]) {
            throw new Error('UHID sequence not found');
          }
          uhid = `EVEN-${uhidRows[0].site_code}-${String(uhidRows[0].current_value).padStart(6, '0')}`;
        } catch (uhidErr) {
          // Fallback: generate a temporary UHID from timestamp
          uhid = `EVEN-LSQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        }

        // Create patient
        const [newPatient] = await sql`
          INSERT INTO patients (
            hospital_id, uhid, name_given, name_family, name_full,
            phone, email, gender, dob, source_type, patient_category,
            lsq_lead_id, status, created_by_user_id
          ) VALUES (
            ${hospitalId}, ${uhid}, ${normalized.name_given}, ${normalized.name_family},
            ${normalized.name_full}, ${normalized.phone}, ${normalized.email || null},
            ${normalized.gender}, ${normalized.dob || null},
            'lsq_lead', ${normalized.patient_category},
            ${normalized.lsq_lead_id}, 'active', ${userId}
          )
          RETURNING id, uhid
        `;

        // Create or update sync state
        if (existing) {
          await sql`
            UPDATE lsq_sync_state
            SET patient_id = ${newPatient.id}::uuid, synced_at = now(), status = 'synced'
            WHERE id = ${existing.id}::uuid
          `;
        } else {
          await sql`
            INSERT INTO lsq_sync_state (hospital_id, lsq_lead_id, patient_id, status)
            VALUES (${hospitalId}, ${normalized.lsq_lead_id}, ${newPatient.id}::uuid, 'synced')
          `;
        }

        newCount++;

        await logEvent({
          syncBatchId: syncRun.id,
          syncType: 'admission',
          patientId: newPatient.id,
          patientUhid: uhid,
          lsqLeadId: normalized.lsq_lead_id,
          eventData: lead,
          syncStatus: 'success',
        });
      }
    } catch (err) {
      errors++;
      await logEvent({
        syncBatchId: syncRun.id,
        syncType: 'admission',
        lsqLeadId: lead.ProspectID || 'unknown',
        eventData: lead,
        syncStatus: 'failure',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // 6. Update sync run summary
  const status = errors > 0 && (newCount + updated) > 0 ? 'partial'
    : errors > 0 ? 'failed'
    : 'success';

  await sql`
    UPDATE lsq_sync_log
    SET status = ${status},
        lead_count_total = ${leads.length},
        lead_count_new = ${newCount},
        lead_count_updated = ${updated},
        lead_count_skipped = ${skipped},
        lead_count_error = ${errors}
    WHERE id = ${syncRun.id}::uuid
  `;

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
