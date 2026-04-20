import {
  pgTable, text, timestamp, integer, uuid, index,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';
import { chatMessages } from './35-chat';

// ============================================================
// TASKS — CHAT.X.6
// Structured task rows. /task dual-writes to chat_messages (for the
// inline card) and to this table (for queryability). `chat_message_id`
// links them.
// ============================================================

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  chat_message_id: integer('chat_message_id').references(() => chatMessages.id, { onDelete: 'set null' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  created_by: uuid('created_by').notNull().references(() => users.id),
  assignee_id: uuid('assignee_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  due_at: timestamp('due_at', { withTimezone: true }),
  // CHECK constraint enforced in SQL. Kept as text here so that future
  // statuses (e.g. 'blocked') can be added without a schema migration
  // required by Drizzle.
  priority: text('priority').notNull().default('normal'), // low|normal|high|urgent|critical
  status: text('status').notNull().default('pending'),    // pending|in_progress|completed|cancelled|reassigned
  encounter_id: uuid('encounter_id').references(() => encounters.id),
  patient_id: uuid('patient_id').references(() => patients.id),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  completed_by: uuid('completed_by').references(() => users.id),
  reassigned_from: uuid('reassigned_from').references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Partial: only the open tasks. Covers "my open tasks" which is the hottest query.
  assigneeStatusIdx: index('idx_tasks_assignee_status').on(table.assignee_id, table.status),
  encounterIdx: index('idx_tasks_encounter').on(table.encounter_id),
  chatMessageIdx: index('idx_tasks_chat_message').on(table.chat_message_id),
  hospitalCreatedIdx: index('idx_tasks_hospital_created').on(table.hospital_id, table.created_at),
}));

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
