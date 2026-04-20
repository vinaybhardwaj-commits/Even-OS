/**
 * CHAT.X.4 — Chat event bus (Postgres LISTEN/NOTIFY wakeup signal).
 *
 * Before X.4, /api/chat/stream polled chat_messages every 300ms server-side
 * per connected user (~3-7 qps idle per user). This file adds the producer
 * half of a LISTEN/NOTIFY push bridge so SSE lambdas can park on a WS
 * connection and wake on-demand.
 *
 * The consumer half is in `apps/web/src/app/api/chat/stream/route.ts`
 * which opens a Pool from @neondatabase/serverless, runs LISTEN chat_msg,
 * and reacts to notifications with a cursor-since query.
 *
 * Contract — simplified on purpose:
 *   Payload carries ONLY the hospital_id. The receiver already has a
 *   `WHERE m.id > cursor AND m.hospital_id = ?` query that returns the
 *   actual messages; this channel is a wakeup hint, not the data.
 *   - Smaller payload (<100 bytes) — well under Postgres's 8000-byte NOTIFY limit
 *   - No RETURNING changes needed at any of the 8 INSERT callsites
 *   - Receiver-side hospital filter skips work for events belonging to a
 *     different tenant (forward-looking; EHRC is single-tenant today)
 *
 * Fire-and-forget — callers do `void notifyChatMessage(hospital_id)`.
 * Returns Promise<void>, never throws. A dropped NOTIFY just means the
 * receiver's 5s safety poll picks up the message one tick later.
 *
 * Uses the HTTP `neon()` client (single-shot query, no persistent conn).
 * The persistent WS / LISTEN side lives only in the SSE route handler.
 */

import { neon } from '@neondatabase/serverless';

// Canonical Postgres NOTIFY channel. Bumping this is a wire-protocol break
// — producers + consumers must change together.
export const CHAT_NOTIFY_CHANNEL = 'chat_msg';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

export interface ChatNotifyPayload {
  hid: string; // hospital_id
}

/**
 * Fire a NOTIFY chat_msg wakeup signal for a given hospital.
 *
 * Call AFTER the underlying chat_messages INSERT commits (NOTIFY is
 * transactional in Postgres — it fires at COMMIT of the issuing txn;
 * since Neon HTTP driver auto-commits each statement, "after INSERT"
 * is sufficient).
 *
 * Never throws. Errors are console.warn'd — we'd rather lose a push
 * than break the calling mutation. The 5s safety poll in the SSE
 * handler is the backstop.
 */
export async function notifyChatMessage(hospital_id: string): Promise<void> {
  if (!hospital_id) return;
  const payload: ChatNotifyPayload = { hid: hospital_id };
  const sql = getSql();
  try {
    // Use pg_notify(channel, payload) — parameterizable via tagged
    // template, so no string concatenation and no injection surface.
    // Equivalent to `NOTIFY chat_msg, '<json>'` but safer.
    await sql`SELECT pg_notify(${CHAT_NOTIFY_CHANNEL}, ${JSON.stringify(payload)})`;
  } catch (err) {
    console.warn('[chat-event-bus] notifyChatMessage failed:', err);
  }
}
