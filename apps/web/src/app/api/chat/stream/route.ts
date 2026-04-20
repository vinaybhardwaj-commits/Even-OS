/**
 * SSE Chat Stream — CHAT.X.4 (Push + Safety Poll)
 *
 * Replaces the OC.8a 300ms poll with a Postgres LISTEN/NOTIFY push bridge
 * backed by a 5s safety poll. Producer half is `lib/chat/chat-event-bus.ts`
 * (fires pg_notify from every chat_messages INSERT path).
 *
 * Wire contract
 * -------------
 *  - Pool client runs `LISTEN chat_msg`.
 *  - Payload is `{ hid: hospital_id }` — a wakeup hint only, no message data.
 *  - Receiver filters by hospital_id then runs a cursor-since query to fetch
 *    the actual rows. Same query the old poll used; unchanged.
 *
 * Cadences (vs OC.8a):
 *  - Messages: push-driven + 5s safety poll (was 300ms)
 *  - Typing:   2s (was 300ms) — chat_typing rows live 5s, so 0-2s latency
 *  - Presence: 30s (unchanged)
 *  - Keepalive: 15s (unchanged)
 *
 * EventSource still auto-reconnects on the Vercel Pro 300s lambda boundary;
 * Last-Event-ID ensures no messages are missed across reconnect.
 *
 * Cleanup — critical for pool hygiene:
 *  - On abort or stream exit, UNLISTEN → release client → pool.end().
 *  - Fire-and-forget in a `finally` so we never leak.
 *
 * Auth: reads `even_session` cookie, verifies JWT (same as tRPC).
 */

import { verifyToken } from '@/lib/auth/jwt';
import { getSql } from '@/lib/db';
import { getUnreadSummary } from '@/lib/chat/unread';
import { CHAT_NOTIFY_CHANNEL } from '@/lib/chat/chat-event-bus';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Node 20 LTS ships without a global WebSocket; Neon's Pool needs one for the
// WS tunnel that carries LISTEN/NOTIFY. Setting this at module load is safe
// even under Node 22+ (it just overrides the built-in, behaviour identical).
if (!(neonConfig as any).webSocketConstructor) {
  (neonConfig as any).webSocketConstructor = ws;
}

// Vercel Pro: allow up to 300 seconds streaming
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── Interval constants ──────────────────────────────────────────────────────

const SAFETY_POLL_MS = 5000;    // Backstop for dropped NOTIFYs
const TYPING_POLL_MS = 2000;    // Typing indicator cadence (5s DB window)
const PRESENCE_MS = 30000;      // Presence heartbeat
const KEEPALIVE_MS = 15000;     // SSE keepalive comment
const TICK_MS = 2000;           // Max wait between tick iterations

// ── Helper: parse cookie from Request ───────────────────────────────────────

function getCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ── SSE Route Handler ───────────────────────────────────────────────────────

export async function GET(req: Request) {
  // 1. Authenticate from cookie
  const token = getCookieValue(req, 'even_session');
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await verifyToken(token);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = user.sub;
  const hospitalId = user.hospital_id;

  // 2. Parse params
  const url = new URL(req.url);
  const lastEventIdHeader = req.headers.get('Last-Event-ID');
  const lastEventIdParam = url.searchParams.get('lastEventId');
  let cursor = parseInt(lastEventIdHeader || lastEventIdParam || '0', 10) || 0;

  // 3. Create readable stream
  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      // ── Push-wakeup wiring ─────────────────────────────────────
      //
      // `needsMsgQuery` is the "dirty bit" — set by NOTIFY and by the 5s
      // safety timer. `wakeupResolve` lets the main-loop sleep exit early
      // when a notification arrives.

      let needsMsgQuery = true; // first-pass fetch on connect
      let lastMsgQuery = 0;
      let wakeupResolve: (() => void) | null = null;

      function fireWakeup() {
        const r = wakeupResolve;
        wakeupResolve = null;
        if (r) r();
      }

      function waitForWakeup(maxWaitMs: number): Promise<void> {
        return new Promise((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            wakeupResolve = null;
            resolve();
          }, maxWaitMs);
          wakeupResolve = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            resolve();
          };
        });
      }

      // Listen for client disconnect
      req.signal.addEventListener('abort', () => {
        aborted = true;
        fireWakeup(); // break the sleep so we can clean up promptly
      });

      // ── Pool + LISTEN ──────────────────────────────────────────
      //
      // The Pool is scoped to this single SSE connection. Neon's WebSocket-
      // bridged pg client is what gives us real LISTEN support (HTTP driver
      // can't hold a session).
      const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
      let listenClient: any = null;
      try {
        listenClient = await pool.connect();
      } catch (err) {
        console.error('[SSE Stream] Pool connect failed, falling back to safety-poll only:', err);
      }

      if (listenClient) {
        listenClient.on('notification', (msg: any) => {
          if (msg.channel !== CHAT_NOTIFY_CHANNEL) return;
          try {
            const payload = JSON.parse(msg.payload || '{}');
            if (payload.hid && payload.hid !== hospitalId) return; // wrong tenant
          } catch {
            // Malformed payload — still wake up; safer to do a needless query
            // than to miss a legitimate message on a parse error.
          }
          needsMsgQuery = true;
          fireWakeup();
        });
        listenClient.on('error', (err: any) => {
          console.warn('[SSE Stream] LISTEN client error:', err);
          // The safety poll is still running; no need to tear the stream
          // down. EventSource will reconnect on the 300s boundary anyway.
        });
        try {
          await listenClient.query(`LISTEN ${CHAT_NOTIFY_CHANNEL}`);
        } catch (err) {
          console.warn('[SSE Stream] LISTEN failed, safety poll only:', err);
        }
      }

      // ── Timer bookkeeping ──────────────────────────────────────

      let lastKeepalive = Date.now();
      let lastTypingQuery = 0;
      let lastPresence = 0; // force immediate presence update

      // ── Main loop ──────────────────────────────────────────────

      try {
        while (!aborted) {
          const now = Date.now();
          const sql = getSql();

          try {
            // Presence heartbeat (every 30s)
            if (now - lastPresence >= PRESENCE_MS) {
              await sql`
                INSERT INTO chat_presence (user_id, status, last_seen_at, hospital_id)
                VALUES (${userId}, 'online', NOW(), ${hospitalId})
                ON CONFLICT (user_id)
                DO UPDATE SET status = 'online', last_seen_at = NOW()
              `;
              lastPresence = now;
            }

            // ── Messages — push-driven OR 5s safety poll ───────
            const safetyElapsed = now - lastMsgQuery >= SAFETY_POLL_MS;
            if (needsMsgQuery || safetyElapsed) {
              needsMsgQuery = false;
              lastMsgQuery = now;

              const newMessages = await sql`
                SELECT m.id, m.channel_id, m.sender_id, m.message_type, m.priority,
                       LEFT(m.content, 200) as content_preview, m.created_at,
                       m.is_retracted, m.metadata,
                       u.full_name as sender_name, u.department as sender_department
                FROM chat_messages m
                LEFT JOIN users u ON u.id = m.sender_id
                WHERE m.id > ${cursor}
                  AND m.hospital_id = ${hospitalId}
                ORDER BY m.id ASC
                LIMIT 100
              `;

              if (newMessages.length > 0) {
                const maxId = Math.max(...newMessages.map((m: any) => m.id));
                cursor = maxId;

                // Unread counts for channels with new messages
                const channelIds = [...new Set(newMessages.map((m: any) => m.channel_id))];
                let unreadCounts: any[] = [];
                if (channelIds.length > 0) {
                  unreadCounts = await sql`
                    SELECT cc.channel_id as cid,
                           count(cm.id)::int as unread
                    FROM chat_channels cc
                    LEFT JOIN chat_channel_members ccm ON ccm.channel_id = cc.id AND ccm.user_id = ${userId}
                    JOIN chat_messages cm ON cm.channel_id = cc.id
                    WHERE cm.created_at > COALESCE(ccm.last_read_at, '1970-01-01'::timestamptz)
                      AND cm.sender_id != ${userId}
                      AND cc.id = ANY(${channelIds}::uuid[])
                    GROUP BY cc.channel_id
                  `;
                }

                const unreadMap: Record<string, number> = {};
                unreadCounts.forEach((r: any) => { unreadMap[r.cid] = r.unread; });

                // CHAT.X.2 — A/B/C summary computed once and shipped with the batch.
                let unreadSummary = { a: 0, b: 0, c: 0 };
                try {
                  unreadSummary = await getUnreadSummary(sql, userId, hospitalId);
                } catch (err) {
                  console.warn('[SSE Stream] getUnreadSummary failed:', err);
                }

                const eventData = JSON.stringify({
                  messages: newMessages,
                  unreadCounts: unreadMap,
                  unreadSummary,
                  lastEventId: maxId,
                  serverTime: new Date().toISOString(),
                });

                controller.enqueue(encoder.encode(`id: ${maxId}\nevent: messages\ndata: ${eventData}\n\n`));
                lastKeepalive = now;
              }
            }

            // ── Typing (every 2s) ─────────────────────────────────
            if (now - lastTypingQuery >= TYPING_POLL_MS) {
              lastTypingQuery = now;
              const typing = await sql`
                SELECT ct.channel_id, ct.user_id, u.full_name as user_name
                FROM chat_typing ct
                JOIN users u ON u.id = ct.user_id
                WHERE ct.started_at > NOW() - INTERVAL '5 seconds'
                  AND ct.user_id != ${userId}
              `;
              if (typing.length > 0) {
                const typingData = JSON.stringify({ typing });
                controller.enqueue(encoder.encode(`event: typing\ndata: ${typingData}\n\n`));
                lastKeepalive = Date.now();
              }
            }

            // ── Keepalive (every 15s if no other event enqueued) ─
            if (Date.now() - lastKeepalive >= KEEPALIVE_MS) {
              controller.enqueue(encoder.encode(`: keepalive ${new Date().toISOString()}\n\n`));
              lastKeepalive = Date.now();
            }

          } catch (err) {
            // Log but don't crash the stream — next iteration will retry
            console.error('[SSE Stream] Error:', err);
          }

          // Wait — wake up on notification, or after TICK_MS (2s) for typing/keepalive cadence.
          // Safety poll is enforced independently by `safetyElapsed` above.
          if (!aborted) {
            await waitForWakeup(TICK_MS);
          }
        }
      } finally {
        // ── Cleanup ──────────────────────────────────────────────
        //
        // Mark presence away, UNLISTEN, release, end pool. Each step is
        // best-effort: if one fails we keep going to avoid leaking sockets.
        try {
          const sql = getSql();
          await sql`
            UPDATE chat_presence
            SET status = 'away', last_seen_at = NOW()
            WHERE user_id = ${userId}
          `;
        } catch { /* best effort */ }

        if (listenClient) {
          try { await listenClient.query(`UNLISTEN ${CHAT_NOTIFY_CHANNEL}`); } catch { /* best effort */ }
          try { listenClient.release(); } catch { /* best effort */ }
        }
        try { await pool.end(); } catch { /* best effort */ }

        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  // 4. Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering if present
    },
  });
}
