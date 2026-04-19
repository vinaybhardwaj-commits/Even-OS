import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  uniqueIndex, index, uuid, pgEnum, serial,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';
import { encounters, patients } from './03-registration';

// ============================================================
// OMNIPRESENT CHAT — OC.1a
// 8 tables: chat_channels, chat_channel_members, chat_messages,
//   chat_attachments, chat_reactions, chat_typing,
//   chat_presence, chat_notification_prefs
// ============================================================

// ── Enums ──────────────────────────────────────────────────────────────────

export const channelTypeEnum = pgEnum('channel_type', [
  'department', 'patient', 'direct', 'broadcast',
]);

export const channelMemberRoleEnum = pgEnum('channel_member_role', [
  'admin', 'member', 'read_only',
]);

export const messageTypeEnum = pgEnum('chat_message_type', [
  'chat', 'system', 'alert', 'task', 'handoff', 'escalation',
  'actionable', 'media', 'slash_result', 'auto_event',
]);

export const messagePriorityEnum = pgEnum('message_priority', [
  'urgent', 'high', 'normal', 'low',
]);

export const presenceStatusEnum = pgEnum('presence_status', [
  'online', 'away', 'offline',
]);

// ── chat_channels ─────────────────────────────────────────────────────────
// One row per channel. Department channels are seeded; patient channels
// are auto-created on admission; DM channels use deterministic IDs.

export const chatChannels = pgTable('chat_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  channel_id: varchar('channel_id', { length: 128 }).notNull().unique(), // e.g., 'dept-nursing', 'patient-<encounter_id>', 'dm-<uuid1>-<uuid2>'
  channel_type: channelTypeEnum('channel_type').notNull(),
  name: varchar('name', { length: 256 }).notNull(),
  description: text('description'),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id), // For encounter-scoped patient channels
  patient_id: uuid('patient_id').references(() => patients.id), // PC.4.A.1: For persistent patient channels (spans all encounters). encounter_id is NULL when set.
  is_archived: boolean('is_archived').notNull().default(false),
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}), // Extensible: pinned items, custom settings
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalTypeIdx: index('idx_chat_channels_hospital_type').on(table.hospital_id, table.channel_type),
  encounterIdx: index('idx_chat_channels_encounter').on(table.encounter_id),
  patientIdx: index('idx_chat_channels_patient').on(table.hospital_id, table.patient_id), // PC.4.A.1: persistent patient channel lookup
  lastMsgIdx: index('idx_chat_channels_last_msg').on(table.hospital_id, table.last_message_at),
  channelIdIdx: uniqueIndex('idx_chat_channels_channel_id').on(table.channel_id),
}));

// ── chat_channel_members ──────────────────────────────────────────────────
// Membership junction. left_at != null means the user has left the channel.
// last_read_at powers unread count calculation.

export const chatChannelMembers = pgTable('chat_channel_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  channel_id: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: channelMemberRoleEnum('role').notNull().default('member'),
  joined_at: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  left_at: timestamp('left_at', { withTimezone: true }),
  last_read_at: timestamp('last_read_at', { withTimezone: true }),
  is_muted: boolean('is_muted').notNull().default(false),
  is_pinned: boolean('is_pinned').notNull().default(false),
}, (table) => ({
  channelUserIdx: uniqueIndex('idx_chat_members_channel_user').on(table.channel_id, table.user_id),
  userActiveIdx: index('idx_chat_members_user_active').on(table.user_id),
  channelActiveIdx: index('idx_chat_members_channel_active').on(table.channel_id),
}));

// ── chat_messages ─────────────────────────────────────────────────────────
// Every message in every channel. Patient channel messages are permanent
// medical records — no hard delete, only retraction (original preserved).

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(), // SERIAL for cursor-based polling (monotonically increasing)
  channel_id: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  sender_id: uuid('sender_id'), // NULL for system-generated messages
  message_type: messageTypeEnum('message_type').notNull().default('chat'),
  priority: messagePriorityEnum('priority').notNull().default('normal'),
  content: text('content').notNull(),
  metadata: jsonb('metadata').default({}), // Structured data: action buttons, slash cmd results, vitals, etc.
  reply_to_id: integer('reply_to_id'), // Self-reference by serial ID
  is_edited: boolean('is_edited').notNull().default(false),
  is_deleted: boolean('is_deleted').notNull().default(false), // Soft delete (dept/DM only)
  is_retracted: boolean('is_retracted').notNull().default(false), // Patient channels: retracted but original preserved
  retracted_at: timestamp('retracted_at', { withTimezone: true }),
  retracted_by: uuid('retracted_by'),
  retracted_reason: text('retracted_reason'),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelCreatedIdx: index('idx_chat_messages_channel_created').on(table.channel_id, table.created_at),
  senderCreatedIdx: index('idx_chat_messages_sender_created').on(table.sender_id, table.created_at),
  channelTypeIdx: index('idx_chat_messages_channel_type').on(table.channel_id, table.message_type),
  hospitalIdx: index('idx_chat_messages_hospital').on(table.hospital_id),
  // Critical for polling: WHERE id > last_event_id AND channel_id IN (...)
  idChannelIdx: index('idx_chat_messages_id_channel').on(table.id, table.channel_id),
}));

// ── chat_attachments ──────────────────────────────────────────────────────
// Files uploaded in chat. For patient channels, auto-linked to
// patient_documents table for permanent medical record.

export const chatAttachments = pgTable('chat_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  message_id: integer('message_id').notNull(), // References chat_messages.id (serial)
  file_name: varchar('file_name', { length: 256 }).notNull(),
  file_type: varchar('file_type', { length: 64 }).notNull(), // MIME type
  file_size: integer('file_size').notNull(), // Bytes
  file_url: text('file_url').notNull(), // Vercel Blob URL
  thumbnail_url: text('thumbnail_url'),
  patient_document_id: uuid('patient_document_id'), // Auto-created link to patient_documents (patient channels)
  document_category: varchar('document_category', { length: 64 }), // 'Clinical Photo', 'Lab Report', etc.
  is_retracted: boolean('is_retracted').notNull().default(false), // 5-min undo window, then permanent
  retracted_at: timestamp('retracted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  messageIdx: index('idx_chat_attachments_message').on(table.message_id),
  patientDocIdx: index('idx_chat_attachments_patient_doc').on(table.patient_document_id),
}));

// ── chat_reactions ────────────────────────────────────────────────────────
// Emoji reactions on messages.

export const chatReactions = pgTable('chat_reactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  message_id: integer('message_id').notNull(), // References chat_messages.id (serial)
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 8 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  messageUserEmojiIdx: uniqueIndex('idx_chat_reactions_msg_user_emoji').on(table.message_id, table.user_id, table.emoji),
  messageIdx: index('idx_chat_reactions_message').on(table.message_id),
}));

// ── chat_typing ───────────────────────────────────────────────────────────
// Ephemeral typing indicators. Cleaned up by cron or inline during polls.
// Rows older than 10 seconds are stale.

export const chatTyping = pgTable('chat_typing', {
  channel_id: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: uniqueIndex('idx_chat_typing_pk').on(table.channel_id, table.user_id),
}));

// ── chat_presence ─────────────────────────────────────────────────────────
// User online/away/offline status, updated via poll heartbeats.
// online: last_seen_at < 10s, away: 10-60s, offline: >60s.

export const chatPresence = pgTable('chat_presence', {
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  status: presenceStatusEnum('status').notNull().default('offline'),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
}, (table) => ({
  hospitalStatusIdx: index('idx_chat_presence_hospital_status').on(table.hospital_id, table.status),
}));

// ── chat_notification_prefs ───────────────────────────────────────────────
// Per-user, per-channel notification preferences. NULL channel_id = global default.

export const chatNotificationPrefs = pgTable('chat_notification_prefs', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel_id: uuid('channel_id').references(() => chatChannels.id, { onDelete: 'cascade' }), // NULL = global default
  push_enabled: boolean('push_enabled').notNull().default(true),
  sound_enabled: boolean('sound_enabled').notNull().default(true),
  mute_until: timestamp('mute_until', { withTimezone: true }),
}, (table) => ({
  // Non-NULL channel prefs: one row per (user, channel)
  userChannelIdx: uniqueIndex('idx_chat_notif_prefs_user_channel')
    .on(table.user_id, table.channel_id),
  // Global prefs: one row per user where channel_id IS NULL
  // NOTE: Drizzle doesn't support partial indexes natively.
  //       The SQL migration creates: CREATE UNIQUE INDEX idx_chat_notif_prefs_user_global ON chat_notification_prefs (user_id) WHERE channel_id IS NULL
}));

// ============================================================
// RELATIONS
// ============================================================

export const chatChannelRelations = relations(chatChannels, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [chatChannels.hospital_id], references: [hospitals.hospital_id] }),
  encounter: one(encounters, { fields: [chatChannels.encounter_id], references: [encounters.id] }),
  patient: one(patients, { fields: [chatChannels.patient_id], references: [patients.id] }),
  creator: one(users, { fields: [chatChannels.created_by], references: [users.id] }),
  members: many(chatChannelMembers),
  messages: many(chatMessages),
}));

export const chatChannelMemberRelations = relations(chatChannelMembers, ({ one }) => ({
  channel: one(chatChannels, { fields: [chatChannelMembers.channel_id], references: [chatChannels.id] }),
  user: one(users, { fields: [chatChannelMembers.user_id], references: [users.id] }),
}));

export const chatMessageRelations = relations(chatMessages, ({ one, many }) => ({
  channel: one(chatChannels, { fields: [chatMessages.channel_id], references: [chatChannels.id] }),
  sender: one(users, { fields: [chatMessages.sender_id], references: [users.id] }),
  attachments: many(chatAttachments),
  reactions: many(chatReactions),
}));

export const chatAttachmentRelations = relations(chatAttachments, ({ one }) => ({
  message: one(chatMessages, { fields: [chatAttachments.message_id], references: [chatMessages.id] }),
}));

export const chatReactionRelations = relations(chatReactions, ({ one }) => ({
  message: one(chatMessages, { fields: [chatReactions.message_id], references: [chatMessages.id] }),
  user: one(users, { fields: [chatReactions.user_id], references: [users.id] }),
}));

export const chatPresenceRelations = relations(chatPresence, ({ one }) => ({
  user: one(users, { fields: [chatPresence.user_id], references: [users.id] }),
  hospital: one(hospitals, { fields: [chatPresence.hospital_id], references: [hospitals.hospital_id] }),
}));

export const chatNotificationPrefRelations = relations(chatNotificationPrefs, ({ one }) => ({
  user: one(users, { fields: [chatNotificationPrefs.user_id], references: [users.id] }),
  channel: one(chatChannels, { fields: [chatNotificationPrefs.channel_id], references: [chatChannels.id] }),
}));
