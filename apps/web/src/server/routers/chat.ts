import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { routeFileToMedicalRecord } from '@/lib/chat/file-to-record';
import { createTask, completeTask, reassignTask } from '@/lib/chat/task-bridge';
import { parseSlashCommand, executeSlashCommand as execSlash, getCommandsForRole, type SlashCommandDef } from '@/lib/chat/slash-commands';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
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
// CHAT ROUTER — OC.1b (15 core endpoints)
// ============================================================

export const chatRouter = router({

  // ── CHANNELS ────────────────────────────────────────────────

  /**
   * List user's channels grouped by type, with unread counts.
   * Groups: my_patients, departments, direct_messages, broadcast
   */
  listChannels: protectedProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      const channels = await sql`
        SELECT
          cc.id, cc.channel_id, cc.channel_type, cc.name, cc.description,
          cc.is_archived, cc.last_message_at, cc.encounter_id, cc.metadata,
          ccm.is_pinned, ccm.is_muted, ccm.last_read_at,
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
        JOIN chat_channel_members ccm ON ccm.channel_id = cc.id
        WHERE ccm.user_id = ${userId}
          AND ccm.left_at IS NULL
          AND cc.hospital_id = ${hospitalId}
        ORDER BY cc.is_archived ASC, ccm.is_pinned DESC, cc.last_message_at DESC NULLS LAST
      `;

      // Group by type
      const grouped = {
        my_patients: channels.filter((c: any) => c.channel_type === 'patient' && !c.is_archived),
        departments: channels.filter((c: any) => c.channel_type === 'department'),
        direct_messages: channels.filter((c: any) => c.channel_type === 'direct'),
        broadcast: channels.filter((c: any) => c.channel_type === 'broadcast'),
        archived: channels.filter((c: any) => c.is_archived),
      };

      const unreadTotal = channels.reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0);

      return { channels: grouped, unreadTotal };
    }),

  /**
   * Get single channel details + members + last 50 messages
   */
  getChannel: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      // Verify membership
      const [membership] = await sql`
        SELECT ccm.id, ccm.role FROM chat_channel_members ccm
        JOIN chat_channels cc ON cc.id = ccm.channel_id
        WHERE cc.channel_id = ${input.channelId}
          AND ccm.user_id = ${userId}
          AND ccm.left_at IS NULL
      `;
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this channel' });
      }

      const [channel] = await sql`
        SELECT id, channel_id, channel_type, name, description, is_archived,
               last_message_at, encounter_id, metadata, created_at
        FROM chat_channels WHERE channel_id = ${input.channelId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

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
          AND m.is_deleted = false
        ORDER BY m.created_at DESC
        LIMIT 50
      `;

      return {
        channel,
        members,
        messages: messages.reverse(), // Oldest first for display
        memberRole: membership.role,
      };
    }),

  /**
   * Search channels by name
   */
  searchChannels: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;
      const search = `%${input.query.toLowerCase()}%`;

      return sql`
        SELECT cc.id, cc.channel_id, cc.channel_type, cc.name, cc.description,
               cc.is_archived, cc.last_message_at
        FROM chat_channels cc
        JOIN chat_channel_members ccm ON ccm.channel_id = cc.id
        WHERE ccm.user_id = ${userId}
          AND ccm.left_at IS NULL
          AND cc.hospital_id = ${hospitalId}
          AND LOWER(cc.name) LIKE ${search}
        ORDER BY cc.last_message_at DESC NULLS LAST
        LIMIT 20
      `;
    }),

  // ── MESSAGES ────────────────────────────────────────────────

  /**
   * Send a message. Inserts into chat_messages, updates channel last_message_at.
   * Returns the created message with sender info.
   */
  sendMessage: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      content: z.string().min(1).max(10000),
      messageType: messageTypeEnum.default('chat'),
      priority: messagePriorityEnum.default('normal'),
      metadata: z.record(z.any()).optional(),
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

      // Verify membership + get channel UUID
      const [channel] = await sql`
        SELECT cc.id, cc.channel_type FROM chat_channels cc
        JOIN chat_channel_members ccm ON ccm.channel_id = cc.id
        WHERE cc.channel_id = ${input.channelId}
          AND ccm.user_id = ${userId}
          AND ccm.left_at IS NULL
      `;
      if (!channel) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this channel' });
      }

      // For broadcast, only admins can post
      if (channel.channel_type === 'broadcast') {
        const [mem] = await sql`
          SELECT role FROM chat_channel_members
          WHERE channel_id = ${channel.id} AND user_id = ${userId}
        `;
        if (mem?.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can post to broadcast channels' });
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

      // Insert attachments if provided
      if (input.attachments && input.attachments.length > 0) {
        for (const att of input.attachments) {
          const [inserted] = await sql`
            INSERT INTO chat_attachments (message_id, file_name, file_type, file_size, file_url, thumbnail_url)
            VALUES (${message.id}, ${att.file_name}, ${att.file_type}, ${att.file_size},
                    ${att.file_url}, ${att.thumbnail_url || null})
            RETURNING id
          `;

          // OC.4c: Auto-route to medical record for patient channels (fire-and-forget)
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
            }).catch(() => {});
          }
        }
      }

      // Update channel last_message_at
      await sql`
        UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
        WHERE id = ${channel.id}
      `;

      return {
        ...message,
        sender_name: ctx.user.name,
        sender_department: ctx.user.department,
        attachments: input.attachments || [],
      };
    }),

  /**
   * List messages for a channel. Cursor-based pagination (by message ID).
   */
  listMessages: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      cursor: z.number().optional(), // message ID — load messages BEFORE this ID
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      // Verify membership
      const [membership] = await sql`
        SELECT 1 FROM chat_channel_members ccm
        JOIN chat_channels cc ON cc.id = ccm.channel_id
        WHERE cc.channel_id = ${input.channelId}
          AND ccm.user_id = ${userId}
          AND ccm.left_at IS NULL
      `;
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this channel' });
      }

      // Fetch messages: if cursor is provided, load older messages (< cursor)
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
              AND m.is_deleted = false
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
              AND m.is_deleted = false
            ORDER BY m.id DESC
            LIMIT ${input.limit}
          `;

      const reversed = messages.reverse(); // Oldest first
      const nextCursor = messages.length === input.limit ? messages[0]?.id : null;

      return { messages: reversed, nextCursor, hasMore: nextCursor !== null };
    }),

  /**
   * Edit own message (dept/DM channels only — patient channels are immutable)
   */
  editMessage: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      content: z.string().min(1).max(10000),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const [msg] = await sql`
        SELECT m.id, m.sender_id, cc.channel_type
        FROM chat_messages m
        JOIN chat_channels cc ON cc.id = m.channel_id
        WHERE m.id = ${input.messageId}
      `;
      if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      if (msg.sender_id !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only edit own messages' });
      if (msg.channel_type === 'patient') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Patient channel messages cannot be edited — they are permanent medical records. Use retract instead.' });
      }

      const [updated] = await sql`
        UPDATE chat_messages SET content = ${input.content}, is_edited = true, updated_at = NOW()
        WHERE id = ${input.messageId}
        RETURNING id, content, is_edited, updated_at
      `;
      return updated;
    }),

  /**
   * Soft delete message (dept/DM channels only)
   */
  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      const [msg] = await sql`
        SELECT m.id, m.sender_id, cc.channel_type
        FROM chat_messages m
        JOIN chat_channels cc ON cc.id = m.channel_id
        WHERE m.id = ${input.messageId}
      `;
      if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      if (msg.sender_id !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only delete own messages' });
      if (msg.channel_type === 'patient') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Patient channel messages cannot be deleted — use retract instead.' });
      }

      await sql`UPDATE chat_messages SET is_deleted = true, updated_at = NOW() WHERE id = ${input.messageId}`;
      return { success: true };
    }),

  /**
   * Retract message (patient channels only). Original content is preserved
   * in the DB for medicolegal audit trail. Display shows retraction notice.
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
        SELECT m.id, m.sender_id, cc.channel_type
        FROM chat_messages m
        JOIN chat_channels cc ON cc.id = m.channel_id
        WHERE m.id = ${input.messageId}
      `;
      if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      if (msg.sender_id !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only retract own messages' });
      if (msg.channel_type !== 'patient') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Retract is only for patient channel messages. Use delete for dept/DM channels.' });
      }

      const [updated] = await sql`
        UPDATE chat_messages
        SET is_retracted = true, retracted_at = NOW(), retracted_by = ${userId},
            retracted_reason = ${input.reason}, updated_at = NOW()
        WHERE id = ${input.messageId}
        RETURNING id, is_retracted, retracted_at, retracted_reason
      `;
      return updated;
    }),

  /**
   * Mark channel as read (updates last_read_at on membership row)
   */
  markRead: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      await sql`
        UPDATE chat_channel_members ccm
        SET last_read_at = NOW()
        FROM chat_channels cc
        WHERE cc.id = ccm.channel_id
          AND cc.channel_id = ${input.channelId}
          AND ccm.user_id = ${userId}
      `;
      return { success: true };
    }),

  // ── POLL ────────────────────────────────────────────────────

  /**
   * Poll for new messages, typing indicators, and presence since last_event_id.
   * This is the heart of the real-time system. Called every 2-5 seconds.
   */
  poll: protectedProcedure
    .input(z.object({ lastEventId: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      // 1. New messages since last_event_id
      const newMessages = await sql`
        SELECT m.id, m.channel_id, m.sender_id, m.message_type, m.priority,
               LEFT(m.content, 200) as content_preview, m.created_at,
               m.is_retracted, m.metadata,
               u.full_name as sender_name, u.department as sender_department
        FROM chat_messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.id > ${input.lastEventId}
          AND m.channel_id IN (
            SELECT channel_id FROM chat_channel_members
            WHERE user_id = ${userId} AND left_at IS NULL
          )
          AND m.is_deleted = false
        ORDER BY m.id ASC
        LIMIT 100
      `;

      // 2. Typing indicators (active in last 5 seconds)
      const typing = await sql`
        SELECT ct.channel_id, ct.user_id, u.full_name as user_name
        FROM chat_typing ct
        JOIN users u ON u.id = ct.user_id
        JOIN chat_channel_members ccm ON ccm.channel_id = ct.channel_id AND ccm.user_id = ${userId}
        WHERE ct.started_at > NOW() - INTERVAL '5 seconds'
          AND ct.user_id != ${userId}
          AND ccm.left_at IS NULL
      `;

      // 3. Update own presence (heartbeat)
      await sql`
        INSERT INTO chat_presence (user_id, status, last_seen_at, hospital_id)
        VALUES (${userId}, 'online', NOW(), ${hospitalId})
        ON CONFLICT (user_id)
        DO UPDATE SET status = 'online', last_seen_at = NOW()
      `;

      // 4. Unread counts per channel (lightweight — only channels with new messages)
      const channelIds = [...new Set(newMessages.map((m: any) => m.channel_id))];
      let unreadCounts: any[] = [];
      if (channelIds.length > 0) {
        unreadCounts = await sql`
          SELECT cc.channel_id as cid,
                 count(cm.id)::int as unread
          FROM chat_channels cc
          JOIN chat_channel_members ccm ON ccm.channel_id = cc.id
          JOIN chat_messages cm ON cm.channel_id = cc.id
          WHERE ccm.user_id = ${userId}
            AND ccm.left_at IS NULL
            AND cm.created_at > COALESCE(ccm.last_read_at, '1970-01-01'::timestamptz)
            AND cm.sender_id != ${userId}
            AND cc.id = ANY(${channelIds}::uuid[])
          GROUP BY cc.channel_id
        `;
      }

      const maxEventId = newMessages.length > 0
        ? Math.max(...newMessages.map((m: any) => m.id))
        : input.lastEventId;

      return {
        messages: newMessages,
        typing,
        unreadCounts: Object.fromEntries(unreadCounts.map((u: any) => [u.cid, u.unread])),
        lastEventId: maxEventId,
        serverTime: new Date().toISOString(),
      };
    }),

  // ── PRESENCE & TYPING ───────────────────────────────────────

  /**
   * Heartbeat — keep-alive + presence update. Called by ChatProvider on each poll.
   */
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
   * Get online users for a channel
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
        FROM chat_channel_members ccm
        JOIN users u ON u.id = ccm.user_id
        JOIN chat_channels cc ON cc.id = ccm.channel_id
        LEFT JOIN chat_presence cp ON cp.user_id = ccm.user_id
        WHERE cc.channel_id = ${input.channelId}
          AND ccm.left_at IS NULL
        ORDER BY
          CASE WHEN cp.last_seen_at > NOW() - INTERVAL '10 seconds' THEN 0
               WHEN cp.last_seen_at > NOW() - INTERVAL '60 seconds' THEN 1
               ELSE 2 END,
          u.full_name
      `;
    }),

  /**
   * Set typing indicator (UPSERT into chat_typing)
   */
  setTyping: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      isTyping: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      // Get channel UUID
      const [channel] = await sql`
        SELECT cc.id FROM chat_channels cc
        JOIN chat_channel_members ccm ON ccm.channel_id = cc.id
        WHERE cc.channel_id = ${input.channelId}
          AND ccm.user_id = ${userId}
          AND ccm.left_at IS NULL
      `;
      if (!channel) return { success: false };

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

  /**
   * Create or get existing DM channel. Uses deterministic channel_id
   * (sorted UUIDs) to prevent duplicate DM channels.
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

      // Verify target user exists and is in the same hospital
      const [target] = await sql`
        SELECT id, full_name, department FROM users
        WHERE id = ${input.targetUserId} AND hospital_id = ${hospitalId} AND status = 'active'
      `;
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Deterministic DM channel_id: sorted UUIDs
      const sortedIds = [userId, input.targetUserId].sort();
      const dmChannelId = `dm-${sortedIds[0].slice(0, 8)}-${sortedIds[1].slice(0, 8)}`;

      // Check if DM already exists
      const [existing] = await sql`
        SELECT id, channel_id FROM chat_channels WHERE channel_id = ${dmChannelId}
      `;
      if (existing) {
        return { channel: existing, created: false };
      }

      // Create DM channel
      const [channel] = await sql`
        INSERT INTO chat_channels (channel_id, channel_type, name, hospital_id, created_by)
        VALUES (${dmChannelId}, 'direct', ${target.full_name}, ${hospitalId}, ${userId})
        RETURNING id, channel_id, channel_type, name, created_at
      `;

      // Add both users as members
      await sql`
        INSERT INTO chat_channel_members (channel_id, user_id, role) VALUES
        (${channel.id}, ${userId}, 'member'),
        (${channel.id}, ${input.targetUserId}, 'member')
      `;

      return { channel, created: true };
    }),

  // ── ADMIN ENDPOINTS ─────────────────────────────────────────

  /**
   * Admin: Seed/verify all department channels exist
   */
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

  /**
   * Admin: Get channel stats (message counts, active users)
   */
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

  /**
   * Admin: Bulk sync role→channel membership
   */
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
        const [existing] = await sql`
          SELECT 1 FROM chat_channel_members WHERE channel_id = ${channel.id} AND user_id = ${userId}
        `;
        if (existing) continue;
        await sql`
          INSERT INTO chat_channel_members (channel_id, user_id, role)
          VALUES (${channel.id}, ${userId}, ${input.role})
        `;
        added++;
      }

      return { added, total: input.userIds.length };
    }),

  // ─── TOGGLE REACTION (OC.3b) ───────────────────────────────
  toggleReaction: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      channelId: z.string(),
      emoji: z.string().max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;

      // Check if reaction already exists
      const [existing] = await sql`
        SELECT id FROM chat_reactions
        WHERE message_id = ${input.messageId}
          AND user_id = ${userId}
          AND emoji = ${input.emoji}
      `;

      if (existing) {
        // Remove reaction
        await sql`DELETE FROM chat_reactions WHERE id = ${existing.id}`;
        return { action: 'removed' };
      } else {
        // Add reaction
        await sql`
          INSERT INTO chat_reactions (message_id, user_id, emoji)
          VALUES (${input.messageId}, ${userId}, ${input.emoji})
        `;
        return { action: 'added' };
      }
    }),

  // ── OC.5: TASKS ──────────────────────────────────────────

  /**
   * Create a task via chat. Posts task message + creates task record.
   */
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

      // Get channel internal ID
      const [channel] = await sql`
        SELECT id FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      return await createTask({
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
    }),

  /**
   * Complete a task. Updates metadata + posts system message.
   */
  completeTask: protectedProcedure
    .input(z.object({
      messageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await completeTask({
        message_id: input.messageId,
        completed_by: ctx.user.sub,
        completed_by_name: ctx.user.name,
        hospital_id: ctx.user.hospital_id,
      });
    }),

  /**
   * Reassign a task. Updates assignee in metadata + posts system message.
   */
  reassignTask: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      newAssigneeId: z.string().uuid(),
      newAssigneeName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await reassignTask({
        message_id: input.messageId,
        reassigned_by_name: ctx.user.name,
        new_assignee_id: input.newAssigneeId,
        new_assignee_name: input.newAssigneeName,
        hospital_id: ctx.user.hospital_id,
      });
    }),

  // ── OC.5: SLASH COMMANDS ─────────────────────────────────

  /**
   * Get available slash commands for the current user's role.
   */
  getSlashCommands: protectedProcedure
    .query(({ ctx }) => {
      return getCommandsForRole(ctx.user.role);
    }),

  /**
   * Execute a slash command. Parses the command text and runs the executor.
   * Posts the result as a slash_result message in the channel.
   */
  executeSlashCommand: protectedProcedure
    .input(z.object({
      channelId: z.string(),
      commandText: z.string().min(2), // e.g., "/vitals Rajesh"
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const userId = ctx.user.sub;
      const hospitalId = ctx.user.hospital_id;

      // Parse the command
      const parsed = parseSlashCommand(input.commandText);
      if (!parsed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a valid slash command' });
      }

      // Don't execute /task here — it's handled by createTask
      if (parsed.command === 'task') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use createTask endpoint for task creation' });
      }

      // Get channel internal ID
      const [channel] = await sql`
        SELECT id, channel_type FROM chat_channels
        WHERE channel_id = ${input.channelId} AND hospital_id = ${hospitalId}
      `;
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      // Execute the command
      const result = await execSlash(parsed.command, parsed.args, hospitalId, ctx.user.role, ctx.user.name);

      // Post the result as a slash_result message
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

      return {
        ...message,
        sender_name: ctx.user.name,
        sender_department: ctx.user.department,
      };
    }),
});
