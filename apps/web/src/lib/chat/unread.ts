/**
 * Chat unread summary helper — CHAT.X.2
 *
 * Computes the 3-number A/B/C unread breakdown that powers the chat badge:
 *   A = total unread across all channels the user is a member of
 *   B = subset of A restricted to role-scoped channels (department + patient)
 *   C = subset of A restricted to direct messages (DMs)
 *
 * Invariants:
 *   - B ⊆ A, C ⊆ A, B ∩ C = ∅
 *   - A - (B + C) = unreads in broadcast channels (no role context)
 *   - Mute state is NOT applied here. The badge mirrors the sidebar per-channel
 *     dot indicators so the two numbers never diverge. CHAT.X.8 will add
 *     notification preferences that honour mute/snooze.
 *
 * Called from:
 *   - chat.getUnreadSummary tRPC query (ChatProvider bootstrap + post-markRead refresh)
 *   - /api/chat/stream SSE tick (every message push carries a fresh summary)
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';

export interface UnreadSummary {
  a: number;
  b: number;
  c: number;
}

/**
 * Compute unread A/B/C for a single user in a single hospital.
 *
 * @param sql    Neon HTTP client
 * @param userId JWT sub
 * @param hospitalId JWT hospital_id
 */
export async function getUnreadSummary(
  sql: NeonQueryFunction<false, false>,
  userId: string,
  hospitalId: string,
): Promise<UnreadSummary> {
  // Single query: count per channel_type in one pass, then bucket into A/B/C.
  // This is cheaper than 3 round-trips and keeps consistent snapshot semantics.
  const rows = await sql`
    SELECT
      cc.channel_type as ctype,
      COUNT(cm.id)::int as unread
    FROM chat_channel_members ccm
    JOIN chat_channels cc ON cc.id = ccm.channel_id
    JOIN chat_messages cm ON cm.channel_id = cc.id
    WHERE ccm.user_id = ${userId}
      AND ccm.left_at IS NULL
      AND cc.hospital_id = ${hospitalId}
      AND cc.is_archived = false
      AND cm.sender_id IS DISTINCT FROM ${userId}
      AND cm.created_at > COALESCE(ccm.last_read_at, '1970-01-01'::timestamptz)
      AND cm.is_deleted = false
    GROUP BY cc.channel_type
  `;

  let a = 0;
  let b = 0;
  let c = 0;
  for (const r of rows as Array<{ ctype: string; unread: number }>) {
    const n = Number(r.unread) || 0;
    a += n;
    if (r.ctype === 'department' || r.ctype === 'patient') b += n;
    else if (r.ctype === 'direct') c += n;
    // broadcast contributes to A only
  }

  return { a, b, c };
}
