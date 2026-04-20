/**
 * Task Bridge — CHAT.X.6 (20 Apr 2026)
 *
 * Originally (OC.5a) tasks lived only as chat_messages rows with
 * structured metadata. X.6 adds a real `tasks` table so we can query
 * "show me all open tasks assigned to me" without scanning jsonb blobs.
 *
 * Dual-write contract:
 *   createTask    →  INSERT chat_messages, INSERT tasks (chat_message_id FK)
 *   completeTask  →  UPDATE chat_messages metadata, UPDATE tasks, post system msg
 *   reassignTask  →  UPDATE chat_messages metadata, UPDATE tasks, post system msg
 *
 * Neon HTTP driver has no transaction() — we order writes so the
 * user-visible chat_messages row is authoritative and the tasks row is
 * best-effort-consistent. On failure, chat_messages is durable; a cron
 * could reconcile orphans, but in practice both writes are to the same
 * Neon endpoint and failures here would also be failing the top-level
 * tRPC call.
 */

import { neon } from '@neondatabase/serverless';
import { notifyChatMessage } from './chat-event-bus';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

// ── Types ────────────────────────────────────────────────

export interface TaskMetadata {
  task_id: string;           // UUID — now the real tasks.id
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
  sender_id: string;           // created_by on tasks row
  sender_name: string;
  assignee_id: string;
  assignee_name: string;
  description: string;
  due_at?: string | null;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  encounter_id?: string | null;
  patient_id?: string | null;
}

export async function createTask(params: CreateTaskParams) {
  const sql = getSql();

  // Look up patient/encounter context from the channel so the tasks row
  // can record it even if the caller didn't pass it explicitly. For
  // patient-scoped channels this means /task auto-links to the patient.
  let encounterId = params.encounter_id ?? null;
  let patientId = params.patient_id ?? null;
  if (!encounterId && !patientId) {
    const [ctx] = await sql`
      SELECT encounter_id, patient_id
      FROM chat_channels
      WHERE id = ${params.channel_id}
    ` as Array<{ encounter_id: string | null; patient_id: string | null }>;
    if (ctx) {
      encounterId = ctx.encounter_id;
      patientId = ctx.patient_id;
    }
  }

  // 1. Insert chat_messages row (in-channel card). This is what the user
  //    sees. We generate the task UUID first so metadata + tasks row share it.
  const taskId = crypto.randomUUID();
  const metadata: TaskMetadata = {
    task_id: taskId,
    assignee_id: params.assignee_id,
    assignee_name: params.assignee_name,
    due_at: params.due_at || null,
    priority: params.priority || 'normal',
    status: 'pending',
  };

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
  ` as Array<any>;

  // 2. Insert tasks row — the queryable source of truth.
  // Title = first 120 chars of description (one-line summary); description
  // holds the full text. This keeps "My Tasks" lists scannable.
  const title = params.description.length > 120
    ? params.description.slice(0, 117).trimEnd() + '…'
    : params.description;

  await sql`
    INSERT INTO tasks (
      id, chat_message_id, hospital_id, created_by, assignee_id,
      title, description, due_at, priority, status,
      encounter_id, patient_id
    ) VALUES (
      ${taskId},
      ${message.id},
      ${params.hospital_id},
      ${params.sender_id},
      ${params.assignee_id},
      ${title},
      ${params.description},
      ${params.due_at || null},
      ${params.priority || 'normal'},
      'pending',
      ${encounterId},
      ${patientId}
    )
  `;

  // 3. Bump channel last_message_at so the channel sorts to the top.
  await sql`
    UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = ${params.channel_id}
  `;

  // CHAT.X.4 — push wakeup so the task card shows up in listeners instantly.
  void notifyChatMessage(params.hospital_id);

  return {
    ...message,
    task_id: taskId,
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
  ` as Array<any>;

  if (!msg) throw new Error('Task message not found');

  const meta = msg.metadata as TaskMetadata;
  if (meta.status === 'completed') throw new Error('Task already completed');

  // 1. Update chat_messages metadata (for in-channel display)
  const nowIso = new Date().toISOString();
  const updatedMeta: TaskMetadata = {
    ...meta,
    status: 'completed',
    completed_at: nowIso,
    completed_by: params.completed_by,
    completed_by_name: params.completed_by_name,
  };

  await sql`
    UPDATE chat_messages
    SET metadata = ${JSON.stringify(updatedMeta)}, updated_at = NOW()
    WHERE id = ${params.message_id}
  `;

  // 2. Update tasks row by chat_message_id. Fall back to task_id from
  //    metadata if the FK link was broken (ON DELETE SET NULL case).
  await sql`
    UPDATE tasks
    SET status = 'completed',
        completed_at = NOW(),
        completed_by = ${params.completed_by},
        updated_at = NOW()
    WHERE (chat_message_id = ${params.message_id}
           OR id = ${meta.task_id}::uuid)
      AND hospital_id = ${params.hospital_id}
      AND status <> 'completed'
  `;

  // 3. Post system message
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

  // CHAT.X.4 — push wakeup for the completion system message.
  void notifyChatMessage(params.hospital_id);

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
  ` as Array<any>;

  if (!msg) throw new Error('Task message not found');

  const meta = msg.metadata as TaskMetadata;
  if (meta.status === 'completed') throw new Error('Cannot reassign completed task');

  const oldAssigneeId = meta.assignee_id;

  // 1. Update chat_messages metadata
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

  // 2. Update tasks row — move assignee, clear reassigned_from for audit
  await sql`
    UPDATE tasks
    SET assignee_id = ${params.new_assignee_id},
        reassigned_from = ${oldAssigneeId},
        status = 'pending',
        updated_at = NOW()
    WHERE (chat_message_id = ${params.message_id}
           OR id = ${meta.task_id}::uuid)
      AND hospital_id = ${params.hospital_id}
      AND status <> 'completed'
  `;

  // 3. Post system message
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

  // CHAT.X.4 — push wakeup for reassign system message.
  void notifyChatMessage(params.hospital_id);

  return { success: true };
}
