/**
 * SSE Chat Stream — OC.8a
 *
 * Real-time Server-Sent Events endpoint that replaces adaptive polling.
 * Micro-polls the database every 300ms server-side and pushes new messages,
 * typing indicators, and presence updates to connected clients.
 *
 * EventSource auto-reconnects on disconnect. Last-Event-ID header ensures
 * no messages are missed across reconnections (Vercel Pro 300s limit).
 *
 * Auth: reads `even_session` cookie, verifies JWT (same as tRPC).
 */

import { verifyToken } from '@/lib/auth/jwt';
import { getSql } from '@/lib/db';
import { getUnreadSummary } from '@/lib/chat/unread';

// Vercel Pro: allow up to 300 seconds streaming
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ── Interval constants ──────────────────────────────────────────────────────

const MICRO_POLL_MS = 300;       // Server-side check interval (chatroom/sidebar)
const COLLAPSED_POLL_MS = 2000;  // When chat is collapsed (just badge updates)
const KEEPALIVE_MS = 15000;      // SSE keepalive comment interval
const PRESENCE_MS = 30000;       // Presence heartbeat interval

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

  const uiState = url.searchParams.get('uiState') || 'chatroom';
  const pollInterval = uiState === 'collapsed' ? COLLAPSED_POLL_MS : MICRO_POLL_MS;

  // 3. Create readable stream
  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Listen for client disconnect
      req.signal.addEventListener('abort', () => {
        aborted = true;
      });

      let lastKeepalive = Date.now();
      let lastPresence = 0; // Force immediate presence update

      // ── Main loop ──────────────────────────────────────────

      while (!aborted) {
        try {
          const sql = getSql();
          const now = Date.now();

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

          // Query new messages since cursor
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

          // Query typing indicators (active in last 5 seconds)
          const typing = await sql`
            SELECT ct.channel_id, ct.user_id, u.full_name as user_name
            FROM chat_typing ct
            JOIN users u ON u.id = ct.user_id
            WHERE ct.started_at > NOW() - INTERVAL '5 seconds'
              AND ct.user_id != ${userId}
          `;

          // If we have new messages, compute unread counts and push
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
            // Cheap (single GROUP BY) and keeps the badge always in sync with
            // the authoritative server state on every push.
            let unreadSummary = { a: 0, b: 0, c: 0 };
            try {
              unreadSummary = await getUnreadSummary(sql, userId, hospitalId);
            } catch (err) {
              console.warn('[SSE Stream] getUnreadSummary failed:', err);
            }

            // Push SSE event
            const eventData = JSON.stringify({
              messages: newMessages,
              typing,
              unreadCounts: unreadMap,
              unreadSummary,
              lastEventId: maxId,
              serverTime: new Date().toISOString(),
            });

            controller.enqueue(encoder.encode(`id: ${maxId}\nevent: messages\ndata: ${eventData}\n\n`));
            lastKeepalive = now;
          } else if (typing.length > 0) {
            // No new messages but typing activity — push typing event
            const typingData = JSON.stringify({ typing });
            controller.enqueue(encoder.encode(`event: typing\ndata: ${typingData}\n\n`));
            lastKeepalive = now;
          }

          // Keepalive comment (prevents proxy/CDN timeouts)
          if (now - lastKeepalive >= KEEPALIVE_MS) {
            controller.enqueue(encoder.encode(`: keepalive ${new Date().toISOString()}\n\n`));
            lastKeepalive = now;
          }

        } catch (err) {
          // Log but don't crash the stream — next iteration will retry
          console.error('[SSE Stream] Error:', err);
        }

        // Wait before next check
        if (!aborted) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }

      // Client disconnected — mark presence as away
      try {
        const sql = getSql();
        await sql`
          UPDATE chat_presence
          SET status = 'away', last_seen_at = NOW()
          WHERE user_id = ${userId}
        `;
      } catch { /* best effort */ }

      controller.close();
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
