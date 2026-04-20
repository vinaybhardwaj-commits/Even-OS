import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { routeFileToMedicalRecord } from '@/lib/chat/file-to-record';
import { createTask, completeTask, reassignTask } from '@/lib/chat/task-bridge';
import { parseSlashCommand, executeReadOnlyCommand, getSlashCommandsForRole, resolveCommand } from '@/lib/chat/slash-commands';
import { getUnreadSummary } from '@/lib/chat/unread';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// AUDIT LOGGER — Every chat action gets logged
// ============================================================

async function logAudit(params: {
  action: string;
  user_id: string;
  user_name: string;
  hospital_id: string;
  channel_id?: string;
  message_id?: number;
  target_user_id?: string;
  details?: Record<string, any>;
}) {
  const sql = getSql();
  try {
    await sql`
      INSERT INTO chat_audit_log (
        action, user_id, user_name, hospital_id,
        channel_id, message_id, target_user_id, details
      ) VALUES (
        ${params.action}, ${params.user_id}, ${params.user_name}, ${params.hospital_id},
        ${params.channel_id || null}, ${params.message_id || null},
        ${params.target_user_id || null}, ${JSON.stringify(params.details || {})}
      )
    `;
  } catch (err) {
    console.warn('[ChatAudit] Failed to log:', err);
  }
}

// ============================================================
// AUTO-MEMBERSHIP — Ensure user is a member of a channel
// ============================================================

async function ensureMembership(channelUuid: string, userId: string) {
  const sql = getSql();
  await sql`
    INSERT INTO chat_channel_members (channel_id, user_id, role)
    VALUES (${channelUuid}, ${userId}, 'member')
    ON CONFLICT (channel_id, user_id) DO UPDATE SET
      left_at = NULL,
      joined_at = CASE WHEN chat_channel_members.left_at IS NOT NULL THEN NOW() ELSE chat_channel_members.joined_at END
  `;
}

// ============================================================
// VALIDATORS
// ============================================================

const messageTypeEnum = z.enum([
  'chat', 'system', 'alert', 'task', 'handoff', 'escalation',
  'actionable', 'media', 'slash_result', 'auto_event',
]);

const messagePriorityEnum = z.enum(['urgent', 'high', 'normal', 'low']);

// ============================================================
// CHAT ROUTER — Universal visibility, immutable audit trail
// ============================================================

export const chatRouter = router({

  // ── CHANNELS ────────────────────────────────────────────────

  /**
   * List ALL channels in the hospital grouped by type.
   * Every user sees every channel — no membership filter.
   * User-specific prefs (pinned, muted, last_read) come from LEFT JOIN.
   */
  listChannels: protectedProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const channels = await sql`
        SELECT
          cc.id, cc.channel_id, cc.channel_type, cc.name, cc.description,
          cc.is_archived, cc.last_message_at, cc.encounter_id, cc.patient_id, cc.metadata,
          COALESCE(ccm.is_pinned, false) as is_pinned,
          COALESCE(ccm.is_muted, false) as is_muted,
          ccm.last_read_at,
          (
            SELECT count(*)::int FROM chat_messages cm
            WHERE cm.channel_id = cc.id
              AND cm.created_at > COALESCE(ccm.last_read_at, '1970-01-01'::timestamptz)
              AND cm.sender_id != ${userId}
          ) as unread_count,
          (
            SELECT count(*)::int FROM chat_channel_members
            WHERE channel_id = cc.id AND left_at IS NULL
          ) as member_count
        FROM chat_channels cc
        LEFT JOIN chat_channel_members ccm ON ccm.channel_id = cc.id AND ccm.user_id = ${userId} AND ccm.left_at IS NULL
        WHERE cc.hospital_id = ${hospitalId}
        ORDER BY cc.is_archived ASC, COALESCE(ccm.is_pinned, false) DESC, cc.last_message_at DESC NULLS LAST
      `;

      // Group by type — persistent patient rooms surface above encounter-scoped rooms
      // so the chart UI can default to persistent + offer a switcher to active encounters.
      const patientChannels = channels.filter((c: any) => c.channel_type === 'patient' && !c.is_archived);
      const grouped = {
        // PC.4.A.2: persistent = channel scopes ALL admissions for a patient (patient_id set, encounter_id null)
        patient_persistent: patientChannels.filter((c: any) => c.patient_id && !c.encounter_id),
        // patient_encounter = channel scoped to ONE admission (encounter_id set)
        patient_encounter: patientChannels.filter((c: any) => c.encounter_id),
        // Legacy alias for callers pre-PC.4.A.2 — kept for a deprecation window
        my_patients: patientChannels,
        departments: channels.filter((c: any) => c.channel_type === 'department'),
        direct_messages: channels.filter((c: any) => c.channel_type === 'direct'),
        broadcast: channels.filter((c: any) => c.channel_type === 'broadcast'),
        archived: channels.filter((c: any) => c.is_archived),
      };

      const unreadTotal = channels.reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0);

      return { channels: grouped, unreadTotal };
    }),

  /**
   * PC.4.A.2: List all chat channels for a single patient — persistent + every
   * encounter-scoped room, ordered persistent-first then most-recent encounter.
   * Used by the patient chart Comms tab for dual-room default + switcher.
   */
  listPatientChannels: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const rows = await sql`
        SELECT
          cc.id, cc.channel_id, cc.channel_type, cc.name, cc.description,
          cc.is_archived, cc.last_message_at, cc.encounter_id, cc.patient_id,
          cc.metadata, cc.created_at,
          COALESCE(ccm.is_pinned, false) as is_pinned,
          COALESCE(ccm.is_muted, false) as is_muted,
          ccm.last_read_at,
          (
            SELECT count(*)::int FROM chat_messages cm
            WHERE cm.channel_id = cc.id
              AND cm.created_at > COALESCE(ccm.last_read_at, '1970-01-01'::timestamptz)
              AND cm.sender_id != ${userId}
          ) as unread_count,
          (
            SELECT count(*)::int FROM chat_channel_members
            WHERE channel_id = cc.id AND left_at IS NULL
          ) as member_count,
          CASE
            WHEN cc.patient_id = ${input.patient_id}::uuid AND cc.encounter_id IS NULL THEN 0
            ELSE 1
          END as sort_bucket
        FROM chat_channels cc
        LEFT JOIN chat_channel_members ccm
          ON ccm.channel_id = cc.id AND ccm.user_id = ${userId} AND ccm.left_at IS NULL
        WHERE cc.hospital_id = ${hospitalId}
          AND cc.channel_type = 'patient'
          AND (
            cc.patient_id = ${input.patient_id}::uuid
            OR cc.encounter_id IN (
              SELECT id FROM encounters WHERE patient_id = ${input.patient_id}::uuid
            )
          )
        ORDER BY sort_bucket ASC, cc.last_message_at DESC NULLS LAST, cc.created_at DESC
      `;

      const persistent = rows.find((r: any) => r.patient_id && !r.encounter_id) || null;
      const encounters = rows.filter((r: any) => r.encounter_id);
      return {
        patient_id: input.patient_id,
        persistent,
        encounters,
        total: rows.length,
      };
    }),

  /**
   * Get single channel details + members + last 50 messages.
   * No membership check — everyone can view any channel.
   * Auto-adds user as member for tracking (last_read_at, etc.).
   */
  getChannel: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const hospitalId = ctx.user.hospital_id;

      // PC.4.A.2: hospital-scope validation — a channel from a different hospital
      // must not be reachable via channelId alone. Persistent patient rooms surface
      // this cross-tenancy risk because they span encounters.
      const [channel] = await sql`
        SELECT id, channel_id, channel_type, name, description, is_archived,
               last_message_at, encounter_id, patient_id, metadata, created_at
        FROM chat_channels
        WHERE channel_id = ${input.channelId}
          AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      // Auto-add user as member for read-tracking
      await ensureMembership(channel.id, userId);

      const members = await sql`
        SELECT ccm.user_id, ccm.role, ccm.joined_at, ccm.is_muted,
               u.full_name, u.department, u.roles as user_roles,
               CASE WHEN cp.last_seen_at > NOW() - INTERVAL '10 seconds' THEN 'online'
                    WHEN cp.last_seen_at > NOW() - INTERVAL '60 seconds' THEN 'away'
                    ELSE 'offline' END as presence
        FROM chat_channel_members ccm
        JOIN users u ON u.id = ccm.user_id
        LEFT JOIN chat_presence cp ON cp.user_id = ccm.user_id
        WHERE ccm.channel_id = ${channel.id} AND ccm.left_at IS NULL
        ORDER BY u.full_name
      `;

      const messages = await sql`
        SELECT m.id, m.sender_id, m.message_type, m.priority, m.content,
               m.metadata, m.reply_to_id, m.is_edited, m.is_deleted,
               m.is_retracted, m.retracted_reason, m.created_at, m.updated_at,
               u.full_name as sender_name, u.department as sender_department,
               u.roles as sender_roles
        FROM chat_messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.channel_id = ${channel.id}
        ORDER BY m.created_at DESC
        LIMIT 50
      `;

      // Get user's membership role (will exist due to ensureMembership above)
      const [membership] = await sql`
        SELECT role FROM chat_channel_members
        WHERE channel_id = ${channel.id} AND user_id = ${userId} AND left_at IS NULL
      `;

      return {
        channel,
        members,
        messages: messages.reverse(), // Oldest first for display
        memberRole: membership?.role || 'member',
      };
    }),

  /**
   * Search channels by name — searches ALL hospital channels.
   */
  searchChannels: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const search = `%${input.query.toLowerCase()}%`;

      return sql`
        SELECT cc.id, cc.channel_id, cc.channel_type, cc.name, cc.description,
               cc.is_archived, cc.last_message_at
        FROM chat_channels cc
        WHERE cc.hospital_id = ${hospitalId}
          AND LOWER(cc.name) LIKE ${search}
        ORDER BY cc.last_message_at DESC NULLS LAST
        LIMIT 20
      `;
    }),

  // ── MESSAGES ────────────────────────────────────────────────

  /**
   * Send a message. Auto-adds sender as member if not already.
   * Logs to audit trail.
   */
  sendMessage: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      content: z.string().min(1).max(10000),
      messageType: messageTypeEnum.default('chat'),
      priority: messagePriorityEnum.default('normal'),
      metadata: z.record(z.any()).optional().refine(
        (obj) => !obj || JSON.stringify(obj).length < 10000,
        'Metadata exceeds 10KB limit'
      ),
      replyToId: z.number().optional(),
      attachments: z.array(z.object({
        file_name: z.string(),
        file_type: z.string(),
        file_size: z.number(),
        file_url: z.string(),
        thumbnail_url: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      // Get channel
      const [channel] = await sql`
        SELECT id, channel_type FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      // Auto-add user as member
      await ensureMembership(channel.id, userId);

      // CHAT.X.9 — Broadcast policy
      // Per V: "Any user should be able to use the broadcast channel."
      // Old behaviour: only chat_channel_members.role='admin' could post.
      // New behaviour: any authenticated user can post BUT we cap them at
      // 5 broadcast posts per rolling 60 minutes (counted via chat_audit_log
      // 'broadcast_sent' entries). Admin ops on broadcast (pin/archive/
      // member-add) remain RBAC-gated elsewhere — only the post path opens up.
      if (channel.channel_type === 'broadcast') {
        const [{ count }] = await sql`
          SELECT COUNT(*)::int AS count FROM chat_audit_log
          WHERE user_id = ${userId}
            AND action = 'broadcast_sent'
            AND created_at > NOW() - INTERVAL '60 minutes'
        `;
        if (count >= 5) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'Broadcast rate limit reached (5 per hour). Please wait before posting again.',
          });
        }
      }

      const [message] = await sql`
        INSERT INTO chat_messages (channel_id, sender_id, message_type, priority, content, metadata, reply_to_id, hospital_id)
        VALUES (${channel.id}, ${userId}, ${input.messageType}, ${input.priority},
                ${input.content}, ${JSON.stringify(input.metadata || {})},
                ${input.replyToId || null}, ${hospitalId})
        RETURNING id, channel_id, sender_id, message_type, priority, content, metadata,
                  reply_to_id, created_at
      `;

      // Insert attachments
      if (input.attachments && input.attachments.length > 0) {
        for (const att of input.attachments) {
          const [inserted] = await sql`
            INSERT INTO chat_attachments (message_id, file_name, file_type, file_size, file_url, thumbnail_url)
            VALUES (${message.id}, ${att.file_name}, ${att.file_type}, ${att.file_size},
                    ${att.file_url}, ${att.thumbnail_url || null})
            RETURNING id
          `;

          // OC.4c: Auto-route to medical record for patient channels
          if (inserted && channel.channel_type === 'patient') {
            routeFileToMedicalRecord({
              attachment_id: inserted.id,
              message_id: message.id,
              channel_id: input.channelId,
              file_name: att.file_name,
              file_type: att.file_type,
              file_size: att.file_size,
              file_url: att.file_url,
              uploaded_by: userId,
              hospital_id: hospitalId,
            }).catch(err => console.warn('[chat.sendMessage] file-to-record failed:', err));
          }
        }
      }

      // Update channel last_message_at
      await sql`
        UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
        WHERE id = ${channel.id}
      `;

      // Audit log
      void logAudit({
        action: 'message_sent',
        user_id: userId,
        user_name: ctx.user.name,
        hospital_id: hospitalId,
        channel_id: input.channelId,
        message_id: message.id,
        details: {
          message_type: input.messageType,
          priority: input.priority,
          has_attachments: (input.attachments?.length || 0) > 0,
          content_length: input.content.length,
        },
      });

      // CHAT.X.9 — Separate broadcast_sent audit entry powers the rate-limit
      // COUNT(*) above. Keeps the message_sent row untouched so generic
      // message metrics aren't skewed.
      if (channel.channel_type === 'broadcast') {
        void logAudit({
          action: 'broadcast_sent',
          user_id: userId,
          user_name: ctx.user.name,
          hospital_id: hospitalId,
          channel_id: input.channelId,
          message_id: message.id,
          details: {
            content_length: input.content.length,
            priority: input.priority,
          },
        });
      }

      return {
        ...message,
        sender_name: ctx.user.name,
        sender_department: ctx.user.department,
        attachments: input.attachments || [],
      };
    }),

  /**
   * List messages for a channel. Cursor-based pagination.
   * No membership check — all messages are visible to everyone.
   * Shows ALL messages including retracted (with strikethrough).
   */
  listMessages: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      cursor: z.number().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();

      // Fetch messages — no membership check, no is_deleted filter
      // All messages are always visible (retracted ones show strikethrough)
      const messages = input.cursor
        ? await sql`
            SELECT m.id, m.sender_id, m.message_type, m.priority, m.content,
                   m.metadata, m.reply_to_id, m.is_edited, m.is_deleted,
                   m.is_retracted, m.retracted_reason, m.created_at, m.updated_at,
                   u.full_name as sender_name, u.department as sender_department,
                   u.roles as sender_roles
            FROM chat_messages m
            LEFT JOIN users u ON u.id = m.sender_id
            JOIN chat_channels cc ON cc.id = m.channel_id
            WHERE cc.channel_id = ${input.channelId}
              AND m.id < ${input.cursor}
            ORDER BY m.id DESC
            LIMIT ${input.limit}
          `
        : await sql`
            SELECT m.id, m.sender_id, m.message_type, m.priority, m.content,
                   m.metadata, m.reply_to_id, m.is_edited, m.is_deleted,
                   m.is_retracted, m.retracted_reason, m.created_at, m.updated_at,
                   u.full_name as sender_name, u.department as sender_department,
                   u.roles as sender_roles
            FROM chat_messages m
            LEFT JOIN users u ON u.id = m.sender_id
            JOIN chat_channels cc ON cc.id = m.channel_id
            WHERE cc.channel_id = ${input.channelId}
            ORDER BY m.id DESC
            LIMIT ${input.limit}
          `;

      const reversed = messages.reverse();
      const nextCursor = messages.length === input.limit ? messages[0]?.id : null;

      return { messages: reversed, nextCursor, hasMore: nextCursor !== null };
    }),

  /**
   * Retract message (strikethrough). Works on ALL channels.
   * Original content is ALWAYS preserved in DB. Cannot be undone.
   * Display shows retraction notice + strikethrough original text.
   */
  retractMessage: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const [msg] = await sql`
        SELECT m.id, m.sender_id, m.content, m.channel_id,
               cc.channel_id as channel_string_id, cc.channel_type
        FROM chat_messages m
        JOIN chat_channels cc ON cc.id = m.channel_id
        WHERE m.id = ${input.messageId}
      `;
      if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      if (msg.sender_id !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only retract own messages' });

      const [updated] = await sql`
        UPDATE chat_messages
        SET is_retracted = true, retracted_at = NOW(), retracted_by = ${userId},
            retracted_reason = ${input.reason}, updated_at = NOW()
        WHERE id = ${input.messageId}
        RETURNING id, is_retracted, retracted_at, retracted_reason
      `;

      // Audit log
      void logAudit({
        action: 'message_retracted',
        user_id: userId,
        user_name: ctx.user.name,
        hospital_id: ctx.user.hospital_id,
        channel_id: msg.channel_string_id,
        message_id: input.messageId,
        details: {
          reason: input.reason,
          original_content_length: msg.content?.length || 0,
        },
      });

      return updated;
    }),

  /**
   * Mark channel as read (updates last_read_at).
   * Auto-creates membership row if needed.
   *
   * CHAT.X.2: Returns a fresh A/B/C unreadSummary so the client can reconcile
   * its optimistic local decrement against the authoritative DB state in the
   * same round-trip (no separate follow-up query needed).
   */
  markRead: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      // Optional — message id up to which we're marking read. Present for
      // viewport-based marks. If omitted, last_read_at jumps to NOW() (channel-open semantic).
      messageId: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      // Get channel UUID and auto-ensure membership
      const [channel] = await sql`
        SELECT id FROM chat_channels WHERE channel_id = ${input.channelId}
      `;
      if (channel) {
        await ensureMembership(channel.id, userId);

        if (input.messageId != null) {
          // Mark-read up to a specific message: set last_read_at to that message's
          // timestamp, but only if it advances the watermark (never rewind).
          await sql`
            UPDATE chat_channel_members ccm
            SET last_read_at = GREATEST(
              COALESCE(ccm.last_read_at, '1970-01-01'::timestamptz),
              (SELECT created_at FROM chat_messages WHERE id = ${input.messageId})
            )
            WHERE ccm.channel_id = ${channel.id} AND ccm.user_id = ${userId}
          `;
        } else {
          // Channel-open semantic: clear unreads up to now.
          await sql`
            UPDATE chat_channel_members
            SET last_read_at = NOW()
            WHERE channel_id = ${channel.id} AND user_id = ${userId}
          `;
        }
      }

      const summary = await getUnreadSummary(sql, userId, ctx.user.hospital_id);
      return { success: true, unreadSummary: summary };
    }),

  /**
   * CHAT.X.2 — Fetch the A/B/C unread summary on demand.
   * Cheap single-query endpoint; used by ChatProvider on bootstrap and after
   * local state changes that may have drifted from the server (e.g., tab refocus).
   */
  getUnreadSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      return getUnreadSummary(sql, ctx.user.sub, ctx.user.hospital_id);
    }),

  // ── POLL ────────────────────────────────────────────────────

  // NOTE: poll endpoint removed in OC.8 — replaced by SSE at /api/chat/stream.
  // The SSE handler (apps/web/src/app/api/chat/stream/route.ts) now handles:
  //   - Real-time message delivery (~300ms latency)
  //   - Typing indicators
  //   - Presence heartbeat
  //   - Unread count computation

  // ── PRESENCE & TYPING ───────────────────────────────────────

  heartbeat: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sql = getSql();
      await sql`
        INSERT INTO chat_presence (user_id, status, last_seen_at, hospital_id)
        VALUES (${ctx.user.sub}, 'online', NOW(), ${ctx.user.hospital_id})
        ON CONFLICT (user_id)
        DO UPDATE SET status = 'online', last_seen_at = NOW()
      `;
      return { success: true };
    }),

  /**
   * Get online users for a channel — no membership check.
   */
  getOnlineUsers: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      return sql`
        SELECT u.id, u.full_name, u.department,
               CASE WHEN cp.last_seen_at > NOW() - INTERVAL '10 seconds' THEN 'online'
                    WHEN cp.last_seen_at > NOW() - INTERVAL '60 seconds' THEN 'away'
                    ELSE 'offline' END as presence
        FROM users u
        LEFT JOIN chat_presence cp ON cp.user_id = u.id
        WHERE u.hospital_id = ${ctx.user.hospital_id}
          AND u.status = 'active'
        ORDER BY
          CASE WHEN cp.last_seen_at > NOW() - INTERVAL '10 seconds' THEN 0
               WHEN cp.last_seen_at > NOW() - INTERVAL '60 seconds' THEN 1
               ELSE 2 END,
          u.full_name
        LIMIT 100
      `;
    }),

  /**
   * Set typing indicator. Auto-ensures membership.
   */
  setTyping: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      isTyping: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const [channel] = await sql`
        SELECT id FROM chat_channels WHERE channel_id = ${input.channelId}
      `;
      if (!channel) return { success: false };

      // Auto-ensure membership
      await ensureMembership(channel.id, userId);

      if (input.isTyping) {
        await sql`
          INSERT INTO chat_typing (channel_id, user_id, started_at)
          VALUES (${channel.id}, ${userId}, NOW())
          ON CONFLICT (channel_id, user_id)
          DO UPDATE SET started_at = NOW()
        `;
      } else {
        await sql`
          DELETE FROM chat_typing WHERE channel_id = ${channel.id} AND user_id = ${userId}
        `;
      }
      return { success: true };
    }),

  // ── DM CREATION ─────────────────────────────────────────────

  searchUsers: protectedProcedure
    .input(z.object({ query: z.string().min(2).max(100) }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;
      const pattern = `%${input.query}%`;

      return sql`
        SELECT id, full_name, department, roles[1] as role
        FROM users
        WHERE hospital_id = ${hospitalId}
          AND status = 'active'
          AND id != ${userId}
          AND (full_name ILIKE ${pattern} OR department ILIKE ${pattern})
        ORDER BY full_name ASC
        LIMIT 20
      `;
    }),

  /**
   * Create or get existing DM channel. DM channels are visible to everyone
   * but named after the participants for context.
   */
  createDM: protectedProcedure
    .input(z.object({ targetUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      if (input.targetUserId === userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot DM yourself' });
      }

      const [target] = await sql`
        SELECT id, full_name, department FROM users
        WHERE id = ${input.targetUserId} AND hospital_id = ${hospitalId} AND status = 'active'
      `;
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Deterministic DM channel_id
      const sortedIds = [userId, input.targetUserId].sort();
      const dmChannelId = `dm-${sortedIds[0].slice(0, 8)}-${sortedIds[1].slice(0, 8)}`;

      // Upsert DM channel
      const [channel] = await sql`
        INSERT INTO chat_channels (channel_id, channel_type, name, hospital_id, created_by)
        VALUES (${dmChannelId}, 'direct', ${target.full_name}, ${hospitalId}, ${userId})
        ON CONFLICT (channel_id) DO UPDATE SET updated_at = NOW()
        RETURNING id, channel_id, channel_type, name, created_at
      `;

      // Add both users as members
      await sql`
        INSERT INTO chat_channel_members (channel_id, user_id, role) VALUES
        (${channel.id}, ${userId}, 'member'),
        (${channel.id}, ${input.targetUserId}, 'member')
        ON CONFLICT (channel_id, user_id) DO NOTHING
      `;

      // Audit log
      void logAudit({
        action: 'dm_created',
        user_id: userId,
        user_name: ctx.user.name,
        hospital_id: hospitalId,
        channel_id: dmChannelId,
        target_user_id: input.targetUserId,
        details: { target_name: target.full_name },
      });

      return { channel, created: true };
    }),

  // ── NOTIFICATION PREFERENCES ────────────────────────────────

  getNotificationPrefs: protectedProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const prefs = await sql`
        SELECT id, channel_id, push_enabled, sound_enabled, mute_until
        FROM chat_notification_prefs
        WHERE user_id = ${userId}
        ORDER BY channel_id NULLS FIRST
      `;

      const global = prefs.find((p: any) => !p.channel_id) || {
        push_enabled: true, sound_enabled: true, mute_until: null,
      };
      const channelOverrides = prefs.filter((p: any) => p.channel_id);

      return { global, channelOverrides };
    }),

  updateGlobalPrefs: protectedProcedure
    .input(z.object({
      push_enabled: z.boolean(),
      sound_enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      await sql`
        INSERT INTO chat_notification_prefs (user_id, channel_id, push_enabled, sound_enabled)
        VALUES (${userId}, NULL, ${input.push_enabled}, ${input.sound_enabled})
        ON CONFLICT (user_id, channel_id) WHERE channel_id IS NULL
        DO UPDATE SET push_enabled = ${input.push_enabled}, sound_enabled = ${input.sound_enabled}
      `;
      return { ok: true };
    }),

  muteChannel: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      duration: z.enum(['1h', '8h', '24h', '7d', 'forever', 'unmute']),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const [channel] = await sql`
        SELECT id FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });

      // Ensure membership
      await ensureMembership(channel.id, userId);

      if (input.duration === 'unmute') {
        await sql`
          UPDATE chat_channel_members SET is_muted = false
          WHERE channel_id = ${channel.id} AND user_id = ${userId}
        `;
        await sql`
          DELETE FROM chat_notification_prefs
          WHERE user_id = ${userId} AND channel_id = ${channel.id}
        `;
        return { muted: false };
      }

      await sql`
        UPDATE chat_channel_members SET is_muted = true
        WHERE channel_id = ${channel.id} AND user_id = ${userId}
      `;

      if (input.duration === 'forever') {
        await sql`
          INSERT INTO chat_notification_prefs (user_id, channel_id, push_enabled, sound_enabled, mute_until)
          VALUES (${userId}, ${channel.id}, false, false, '9999-12-31'::timestamptz)
          ON CONFLICT (user_id, channel_id)
          DO UPDATE SET push_enabled = false, sound_enabled = false, mute_until = '9999-12-31'::timestamptz
        `;
      } else {
        const interval = { '1h': '1 hour', '8h': '8 hours', '24h': '24 hours', '7d': '7 days' }[input.duration] || '1 hour';
        await sql`
          INSERT INTO chat_notification_prefs (user_id, channel_id, push_enabled, sound_enabled, mute_until)
          VALUES (${userId}, ${channel.id}, false, false, NOW() + ${interval}::interval)
          ON CONFLICT (user_id, channel_id)
          DO UPDATE SET push_enabled = false, sound_enabled = false, mute_until = NOW() + ${interval}::interval
        `;
      }

      return { muted: true, duration: input.duration };
    }),

  // ── ADMIN ENDPOINTS ─────────────────────────────────────────

  seedDepartmentChannels: adminProcedure
    .mutation(async ({ ctx }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      const existing = await sql`
        SELECT channel_id FROM chat_channels
        WHERE hospital_id = ${hospitalId} AND channel_type = 'department'
      `;
      return { channels: existing.length, message: `${existing.length} department channels exist` };
    }),

  getChannelStats: adminProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      return sql`
        SELECT
          cc.channel_id, cc.name, cc.channel_type,
          (SELECT count(*)::int FROM chat_channel_members WHERE channel_id = cc.id AND left_at IS NULL) as members,
          (SELECT count(*)::int FROM chat_messages WHERE channel_id = cc.id) as total_messages,
          (SELECT count(*)::int FROM chat_messages WHERE channel_id = cc.id AND created_at > NOW() - INTERVAL '24 hours') as messages_24h,
          cc.last_message_at
        FROM chat_channels cc
        WHERE cc.hospital_id = ${hospitalId}
        ORDER BY cc.channel_type, cc.name
      `;
    }),

  bulkAddMembers: adminProcedure
    .input(z.object({
      channelId: z.string(),
      userIds: z.array(z.string().uuid()),
      role: z.enum(['admin', 'member', 'read_only']).default('member'),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();

      const [channel] = await sql`
        SELECT id FROM chat_channels WHERE channel_id = ${input.channelId}
      `;
      if (!channel) throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });

      let added = 0;
      for (const userId of input.userIds) {
        await sql`
          INSERT INTO chat_channel_members (channel_id, user_id, role)
          VALUES (${channel.id}, ${userId}, ${input.role})
          ON CONFLICT (channel_id, user_id) DO NOTHING
        `;
        added++;
      }

      return { added, total: input.userIds.length };
    }),

  /**
   * Admin: Get chat audit log (last 200 entries)
   */
  getAuditLog: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).default(200),
      offset: z.number().min(0).default(0),
      action: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      if (input.action) {
        return sql`
          SELECT id, action, user_id, user_name, channel_id, message_id,
                 target_user_id, details, created_at
          FROM chat_audit_log
          WHERE hospital_id = ${hospitalId} AND action = ${input.action}
          ORDER BY created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `;
      }

      return sql`
        SELECT id, action, user_id, user_name, channel_id, message_id,
               target_user_id, details, created_at
        FROM chat_audit_log
        WHERE hospital_id = ${hospitalId}
        ORDER BY created_at DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;
    }),

  // ─── TOGGLE REACTION ───────────────────────────────────────
  toggleReaction: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      channelId: z.string(),
      emoji: z.string().max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const [existing] = await sql`
        SELECT id FROM chat_reactions
        WHERE message_id = ${input.messageId}
          AND user_id = ${userId}
          AND emoji = ${input.emoji}
      `;

      if (existing) {
        await sql`DELETE FROM chat_reactions WHERE id = ${existing.id}`;
        void logAudit({
          action: 'reaction_removed',
          user_id: userId,
          user_name: ctx.user.name,
          hospital_id: ctx.user.hospital_id,
          channel_id: input.channelId,
          message_id: input.messageId,
          details: { emoji: input.emoji },
        });
        return { action: 'removed' };
      } else {
        await sql`
          INSERT INTO chat_reactions (message_id, user_id, emoji)
          VALUES (${input.messageId}, ${userId}, ${input.emoji})
        `;
        void logAudit({
          action: 'reaction_added',
          user_id: userId,
          user_name: ctx.user.name,
          hospital_id: ctx.user.hospital_id,
          channel_id: input.channelId,
          message_id: input.messageId,
          details: { emoji: input.emoji },
        });
        return { action: 'added' };
      }
    }),

  // ── TASKS ──────────────────────────────────────────────────

  createTask: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      assigneeId: z.string().uuid(),
      assigneeName: z.string(),
      description: z.string().min(1).max(2000),
      dueAt: z.string().optional(),
      priority: z.enum(['urgent', 'high', 'normal', 'low']).default('normal'),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const [channel] = await sql`
        SELECT id FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      const result = await createTask({
        channel_id: channel.id as string,
        hospital_id: hospitalId,
        sender_id: userId,
        sender_name: ctx.user.name,
        assignee_id: input.assigneeId,
        assignee_name: input.assigneeName,
        description: input.description,
        due_at: input.dueAt,
        priority: input.priority,
      });

      void logAudit({
        action: 'task_created',
        user_id: userId,
        user_name: ctx.user.name,
        hospital_id: hospitalId,
        channel_id: input.channelId,
        target_user_id: input.assigneeId,
        details: { description: input.description, priority: input.priority, assignee: input.assigneeName },
      });

      return result;
    }),

  completeTask: protectedProcedure
    .input(z.object({ messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const result = await completeTask({
        message_id: input.messageId,
        completed_by: ctx.user.sub,
        completed_by_name: ctx.user.name,
        hospital_id: ctx.user.hospital_id,
      });

      void logAudit({
        action: 'task_completed',
        user_id: ctx.user.sub,
        user_name: ctx.user.name,
        hospital_id: ctx.user.hospital_id,
        message_id: input.messageId,
      });

      return result;
    }),

  reassignTask: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      newAssigneeId: z.string().uuid(),
      newAssigneeName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await reassignTask({
        message_id: input.messageId,
        reassigned_by_name: ctx.user.name,
        new_assignee_id: input.newAssigneeId,
        new_assignee_name: input.newAssigneeName,
        hospital_id: ctx.user.hospital_id,
      });

      void logAudit({
        action: 'task_reassigned',
        user_id: ctx.user.sub,
        user_name: ctx.user.name,
        hospital_id: ctx.user.hospital_id,
        message_id: input.messageId,
        target_user_id: input.newAssigneeId,
        details: { new_assignee: input.newAssigneeName },
      });

      return result;
    }),

  // ── SLASH COMMANDS ─────────────────────────────────────────

  // ── SC.2 — Slash Commands v2 ──────────────────────────────

  getSlashCommands: protectedProcedure
    .query(async ({ ctx }) => {
      return getSlashCommandsForRole(ctx.user.role, ctx.user.hospital_id);
    }),

  executeSlashCommand: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      commandText: z.string().min(2),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const parsed = parseSlashCommand(input.commandText);
      if (!parsed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a valid slash command' });
      }

      if (parsed.command === 'task') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use createTask endpoint for task creation' });
      }

      // SC.2: Resolve command — form commands are handled client-side,
      // this endpoint only handles read-only commands
      const resolution = await resolveCommand(parsed.command, ctx.user.role, hospitalId);
      if (resolution.type === 'form') {
        // Form commands should be handled client-side via FormModal
        // If we get here, it means the client sent a form command via text input
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `/${parsed.command} opens a form. Use the slash command menu to select it.`,
        });
      }

      const [channel] = await sql`
        SELECT id, channel_type FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      const result = await executeReadOnlyCommand(parsed.command, parsed.args, hospitalId, ctx.user.role, ctx.user.name);

      const [message] = await sql`
        INSERT INTO chat_messages (
          channel_id, sender_id, message_type, content, metadata, hospital_id
        )
        VALUES (
          ${channel.id},
          ${userId},
          'slash_result',
          ${'/' + parsed.command + (parsed.args ? ' ' + parsed.args : '')},
          ${JSON.stringify(result)},
          ${hospitalId}
        )
        RETURNING id, channel_id, sender_id, message_type, content, metadata, created_at
      `;

      await sql`
        UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
        WHERE id = ${channel.id}
      `;

      void logAudit({
        action: 'slash_command',
        user_id: userId,
        user_name: ctx.user.name,
        hospital_id: hospitalId,
        channel_id: input.channelId,
        message_id: message.id,
        details: { command: parsed.command, args: parsed.args },
      });

      return {
        ...message,
        sender_name: ctx.user.name,
        sender_department: ctx.user.department,
      };
    }),

  // SC.2: Post form confirmation card to chat after form submission
  postFormConfirmation: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      formName: z.string(),
      submissionId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const [channel] = await sql`
        SELECT id FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      const metadata = {
        success: true,
        card_title: `✅ ${input.formName}`,
        card_content: `Form submitted successfully by ${ctx.user.name}`,
        card_icon: '📋',
        submission_id: input.submissionId,
        form_name: input.formName,
      };

      const [message] = await sql`
        INSERT INTO chat_messages (
          channel_id, sender_id, message_type, content, metadata, hospital_id
        )
        VALUES (
          ${channel.id},
          ${userId},
          'slash_result',
          ${`📋 ${input.formName} submitted`},
          ${JSON.stringify(metadata)},
          ${hospitalId}
        )
        RETURNING id, channel_id, sender_id, message_type, content, metadata, created_at
      `;

      await sql`
        UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
        WHERE id = ${channel.id}
      `;

      void logAudit({
        action: 'form_submission_card',
        user_id: userId,
        user_name: ctx.user.name,
        hospital_id: hospitalId,
        channel_id: input.channelId,
        message_id: message.id,
        details: { formName: input.formName, submissionId: input.submissionId },
      });

      return {
        ...message,
        sender_name: ctx.user.name,
        sender_department: ctx.user.department,
      };
    }),
});
