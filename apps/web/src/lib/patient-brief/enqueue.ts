/**
 * Patient Brief enqueue helper (N.5).
 *
 * Per V's "Real-time on every clinical write" decision, this helper is
 * called from every clinical mutation site (note signed, vitals saved,
 * med ordered, lab resulted, condition/allergy added, encounter event,
 * accepted chart proposal). It writes one ai_request_queue row with
 * prompt_template='regenerate_brief'.
 *
 * Debounce: if a pending/running regenerate_brief already exists for the
 * same patient, we DON'T insert a duplicate — instead we union the new
 * trigger tag into input_data.trigger_tags and bump priority if the new
 * trigger is more urgent than what's already queued. This collapses
 * bursts (5 vitals in 30s = one brief regen, not five).
 *
 * Fire-and-forget: callers MUST NOT await this in a way that affects
 * their own response shape. Wrap in try/catch and swallow errors so a
 * stray queue insert never breaks a clinical write.
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

export type BriefTrigger =
  | 'admission'
  | 'new_note'
  | 'new_document'
  | 'new_lab'
  | 'vitals_abnormal'
  | 'problem_list_change'
  | 'med_list_change'
  | 'discharge'
  | 'scheduled'
  | 'manual';

// Higher number = more urgent. Used to decide whether to bump an existing
// pending row's priority when a new (more important) trigger arrives.
const TRIGGER_PRIORITY: Record<BriefTrigger, number> = {
  scheduled: 1,
  new_document: 2,
  new_note: 3,
  vitals_abnormal: 3,
  new_lab: 3,
  problem_list_change: 4,
  med_list_change: 4,
  admission: 5,
  discharge: 5,
  manual: 5,
};

function priorityFor(trigger: BriefTrigger): 'low' | 'medium' | 'high' | 'critical' {
  const score = TRIGGER_PRIORITY[trigger] ?? 2;
  if (score >= 5) return 'critical';
  if (score >= 4) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export interface EnqueueArgs {
  hospitalUuid: string;   // hospitals.id (uuid) — ai_request_queue.hospital_id is uuid
  patientId: string;      // patients.id
  trigger: BriefTrigger;
}

/**
 * Call from any clinical write site. Idempotent within a debounce window.
 * Returns { ok, enqueued, debounced, error } so callers can log without
 * blocking. Never throws.
 */
export async function enqueueBriefRegen(sql: Sql, args: EnqueueArgs): Promise<{
  ok: boolean;
  enqueued?: boolean;
  debounced?: boolean;
  error?: string;
}> {
  try {
    const { hospitalUuid, patientId, trigger } = args;
    const newPriority = priorityFor(trigger);

    // Debounce: any pending/running row for this patient?
    const existing = await sql(
      `SELECT id, priority, input_data
         FROM ai_request_queue
        WHERE hospital_id = $1
          AND module = 'clinical'
          AND prompt_template = 'regenerate_brief'
          AND status IN ('pending','processing')
          AND input_data->>'patient_id' = $2
        LIMIT 1`,
      [hospitalUuid, patientId],
    );

    if (existing.length > 0) {
      const row = existing[0];
      const currentTags: string[] = Array.isArray(row.input_data?.trigger_tags)
        ? row.input_data.trigger_tags
        : [];
      const tags = Array.from(new Set([...currentTags, trigger]));
      const shouldBumpPriority = priorityRank(newPriority) > priorityRank(row.priority);

      if (shouldBumpPriority) {
        await sql(
          `UPDATE ai_request_queue
              SET priority = $1,
                  input_data = jsonb_set(input_data, '{trigger_tags}', $2::jsonb)
            WHERE id = $3`,
          [newPriority, JSON.stringify(tags), row.id],
        );
      } else if (!currentTags.includes(trigger)) {
        await sql(
          `UPDATE ai_request_queue
              SET input_data = jsonb_set(input_data, '{trigger_tags}', $1::jsonb)
            WHERE id = $2`,
          [JSON.stringify(tags), row.id],
        );
      }
      return { ok: true, debounced: true };
    }

    await sql(
      `INSERT INTO ai_request_queue (
         hospital_id, module, priority, input_data, prompt_template,
         status, attempts, max_attempts
       )
       VALUES ($1, 'clinical', $2, $3::jsonb, 'regenerate_brief', 'pending', 0, 3)`,
      [
        hospitalUuid,
        newPriority,
        JSON.stringify({ patient_id: patientId, trigger, trigger_tags: [trigger] }),
      ],
    );
    return { ok: true, enqueued: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'enqueueBriefRegen failed' };
  }
}

function priorityRank(p: string): number {
  switch (p) {
    case 'critical': return 4;
    case 'high':     return 3;
    case 'medium':   return 2;
    case 'low':      return 1;
    default:         return 0;
  }
}

/**
 * Helper: many of our routers expose ctx.user.hospital_id as the TEXT key
 * but ai_request_queue needs the UUID. Cache one lookup per request
 * lifecycle by passing the cache map in.
 */
export async function resolveHospitalUuid(
  sql: Sql,
  hospitalTextId: string,
  cache?: Map<string, string>,
): Promise<string | null> {
  const cached = cache?.get(hospitalTextId);
  if (cached) return cached;
  const rows = await sql(
    `SELECT id FROM hospitals WHERE hospital_id = $1 LIMIT 1`,
    [hospitalTextId],
  );
  const id = rows[0]?.id ?? null;
  if (id && cache) cache.set(hospitalTextId, id);
  return id;
}

/**
 * Convenience wrapper: resolve uuid + enqueue in one call. Use this from
 * routers where you only have ctx.user.hospital_id (text key).
 */
export async function enqueueBriefRegenByText(
  sql: Sql,
  args: { hospitalTextId: string; patientId: string; trigger: BriefTrigger },
): Promise<{ ok: boolean; enqueued?: boolean; debounced?: boolean; error?: string }> {
  try {
    const uuid = await resolveHospitalUuid(sql, args.hospitalTextId);
    if (!uuid) return { ok: false, error: 'hospital not found' };
    return enqueueBriefRegen(sql, {
      hospitalUuid: uuid,
      patientId: args.patientId,
      trigger: args.trigger,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || 'enqueueBriefRegenByText failed' };
  }
}
