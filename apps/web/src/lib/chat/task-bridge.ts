/**
 * Task Bridge — OC.5a
 *
 * Creates/completes/reassigns tasks via chat messages.
 * Tasks are stored as message_type='task' with structured metadata.
 * A separate system message is posted on completion/reassignment.
 */

import { neon } from '@neondatabase/serverless';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

// ── Types ────────────────────────────────────────────────

export interface TaskMetadata {
  task_id: string;           // UUID for deduplication
  assignee_id: string;
  assignee_name: string;
  due_at: string | null;     // ISO date
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue' | 'reassigned';
  completed_at?: string;
  completed_by?: string;
  completed_by_name?: string;
  reassigned_to?: string;
  reassigned_to_name?: string;
}

// ── Create Task ──────────────────────────────────────────

interface CreateTaskParams {
  channel_id: string;          // Internal UUID of the channel
  hospital_id: string;
  sender_id: string;
  sender_name: string;
  assignee_id: string;
  assignee_name: string;
  description: string;
  due_at?: string | null;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
}

export async function createTask(params: CreateTaskParams) {
  const sql = getSql();
  const taskId = crypto.randomUUID();

  const metadata: TaskMetadata = {
    task_id: taskId,
    assignee_id: params.assignee_id,
    assignee_name: params.assignee_name,
    due_at: params.due_at || null,
    priority: params.priority || 'normal',
    status: 'pending',
  };

  // Insert task message
  const [message] = await sql`
    INSERT INTO chat_messages (
      channel_id, sender_id, message_type, priority, content, metadata, hospital_id
    )
    VALUES (
      ${params.channel_id},
      ${params.sender_id},
      'task',
      ${params.priority || 'normal'},
      ${params.description},
      ${JSON.stringify(metadata)},
      ${params.hospital_id}
    )
    RETURNING id, channel_id, sender_id, message_type, priority, content, metadata, created_at
  `;

  // Update channel last_message_at
  await sql`
    UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = ${params.channel_id}
  `;

  return {
    ...message,
    sender_name: params.sender_name,
  };
}

// ── Complete Task ────────────────────────────────────────

interface CompleteTaskParams {
  message_id: number;
  completed_by: string;
  completed_by_name: string;
  hospital_id: string;
}

export async function completeTask(params: CompleteTaskParams) {
  const sql = getSql();

  // Get the task message
  const [msg] = await sql`
    SELECT id, channel_id, metadata, content FROM chat_messages
    WHERE id = ${params.message_id} AND message_type = 'task' AND hospital_id = ${params.hospital_id}
  `;

  if (!msg) throw new Error('Task message not found');

  const meta = msg.metadata as TaskMetadata;
  if (meta.status === 'completed') throw new Error('Task already completed');

  // Update metadata
  const updatedMeta: TaskMetadata = {
    ...meta,
    status: 'completed',
    completed_at: new Date().toISOString(),
    completed_by: params.completed_by,
    completed_by_name: params.completed_by_name,
  };

  await sql`
    UPDATE chat_messages
    SET metadata = ${JSON.stringify(updatedMeta)}, updated_at = NOW()
    WHERE id = ${params.message_id}
  `;

  // Post system message
  const dueInfo = meta.due_at
    ? (() => {
        const due = new Date(meta.due_at!);
        const now = new Date();
        const diffMin = Math.round((due.getTime() - now.getTime()) / 60000);
        return diffMin > 0 ? `(${diffMin}min before due)` : `(${Math.abs(diffMin)}min overdue)`;
      })()
    : '';

  await sql`
    INSERT INTO chat_messages (channel_id, message_type, content, hospital_id)
    VALUES (
      ${msg.channel_id},
      'system',
      ${'✅ Task completed by ' + params.completed_by_name + ' ' + dueInfo},
      ${params.hospital_id}
    )
  `;

  await sql`
    UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = ${msg.channel_id}
  `;

  return { success: true, task_id: meta.task_id };
}

// ── Reassign Task ────────────────────────────────────────

interface ReassignTaskParams {
  message_id: number;
  reassigned_by_name: string;
  new_assignee_id: string;
  new_assignee_name: string;
  hospital_id: string;
}

export async function reassignTask(params: ReassignTaskParams) {
  const sql = getSql();

  const [msg] = await sql`
    SELECT id, channel_id, metadata FROM chat_messages
    WHERE id = ${params.message_id} AND message_type = 'task' AND hospital_id = ${params.hospital_id}
  `;

  if (!msg) throw new Error('Task message not found');

  const meta = msg.metadata as TaskMetadata;
  if (meta.status === 'completed') throw new Error('Cannot reassign completed task');

  const updatedMeta: TaskMetadata = {
    ...meta,
    assignee_id: params.new_assignee_id,
    assignee_name: params.new_assignee_name,
    status: 'pending',
    reassigned_to: params.new_assignee_id,
    reassigned_to_name: params.new_assignee_name,
  };

  await sql`
    UPDATE chat_messages
    SET metadata = ${JSON.stringify(updatedMeta)}, updated_at = NOW()
    WHERE id = ${params.message_id}
  `;

  await sql`
    INSERT INTO chat_messages (channel_id, message_type, content, hospital_id)
    VALUES (
      ${msg.channel_id},
      'system',
      ${'🔄 Task reassigned from ' + meta.assignee_name + ' to ' + params.new_assignee_name + ' by ' + params.reassigned_by_name},
      ${params.hospital_id}
    )
  `;

  await sql`
    UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = ${msg.channel_id}
  `;

  return { success: true };
}
