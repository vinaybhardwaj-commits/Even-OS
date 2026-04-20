'use client';

/**
 * ChannelTasksPanel — CHAT.X.6 UI.b
 *
 * Read-only "Tasks" tab inside the chatroom. Lists tasks filtered to the
 * current channel's patient_id/encounter_id via tasks.list. Rows link out
 * to /care/my-tasks when the signed-in user is the assignee; otherwise
 * the row is purely informational.
 *
 * Design choices:
 *   • Read-only. All mutations live on /care/my-tasks and /care/patient/[id].
 *   • Only renders for channels with patient context. ChatRoom gates the tab.
 *   • Uses the same priority/status chip language as /care/my-tasks for
 *     cross-surface consistency.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ChatChannel } from '@/providers/ChatProvider';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'reassigned';
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';

interface TaskRow {
  id: string;
  chat_message_id: number | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  encounter_id: string | null;
  patient_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name: string | null;
  assignee_id: string;
  assignee_name: string | null;
  patient_name: string | null;
  patient_uhid: string | null;
}

async function trpcQuery<T = any>(path: string, input?: any): Promise<T | null> {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  try {
    const res = await fetch(`/api/trpc/${path}${params}`);
    const j = await res.json();
    if (j.error) return null;
    return (j.result?.data?.json ?? null) as T;
  } catch {
    return null;
  }
}

function timeLeft(ts: string | null): { label: string; overdue: boolean } {
  if (!ts) return { label: 'No due date', overdue: false };
  const diff = new Date(ts).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const hrs = Math.round(mins / 60);
  const days = Math.round(hrs / 24);
  const unit = mins < 60 ? `${mins}m` : hrs < 24 ? `${hrs}h` : `${days}d`;
  return { label: diff < 0 ? `${unit} overdue` : `Due in ${unit}`, overdue: diff < 0 };
}
function priorityChip(p: TaskPriority): string {
  switch (p) {
    case 'critical': return 'bg-red-500/20 text-red-200 border-red-500/40';
    case 'urgent':   return 'bg-orange-500/20 text-orange-200 border-orange-500/40';
    case 'high':     return 'bg-amber-500/20 text-amber-200 border-amber-500/40';
    case 'normal':   return 'bg-white/10 text-white/70 border-white/20';
    case 'low':      return 'bg-white/5 text-white/50 border-white/10';
  }
}
function statusChip(s: TaskStatus): string {
  switch (s) {
    case 'in_progress': return 'bg-blue-500/25 text-blue-200 border-blue-500/40';
    case 'pending':     return 'bg-white/10 text-white/70 border-white/20';
    case 'completed':   return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40';
    case 'cancelled':   return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40';
    case 'reassigned':  return 'bg-purple-500/20 text-purple-200 border-purple-500/40';
  }
}
function statusLabel(s: TaskStatus): string {
  return s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1);
}

function extractChannelContext(channel: ChatChannel): { patientId?: string; encounterId?: string } {
  // Primary path: encounter_id lives on the channel row directly.
  // Secondary path: metadata.patient_id set by channel-manager when the
  // patient channel is provisioned.
  let meta: any = channel.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = {}; }
  }
  return {
    patientId: meta?.patient_id,
    encounterId: channel.encounter_id || meta?.encounter_id,
  };
}

export function ChannelTasksPanel({
  channel,
  currentUserId,
}: {
  channel: ChatChannel;
  currentUserId: string | null;
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const { patientId, encounterId } = useMemo(() => extractChannelContext(channel), [channel]);

  const load = useCallback(async () => {
    if (!patientId && !encounterId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = await trpcQuery<TaskRow[]>('tasks.list', {
      patientId,
      encounterId,
      // Let the server default to ~100 rows; plenty for a channel view.
      limit: 100,
    });
    setTasks(Array.isArray(rows) ? rows : []);
    setLoading(false);
  }, [patientId, encounterId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const g: Record<'in_progress' | 'pending' | 'completed' | 'cancelled' | 'reassigned', TaskRow[]> = {
      in_progress: [], pending: [], completed: [], cancelled: [], reassigned: [],
    };
    for (const t of tasks) g[t.status].push(t);
    return g;
  }, [tasks]);

  const openCount = grouped.pending.length + grouped.in_progress.length;
  const closedCount = grouped.completed.length + grouped.cancelled.length + grouped.reassigned.length;

  if (!patientId && !encounterId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0D1B2A] text-white/40 text-sm p-6">
        Tasks are only available inside patient channels.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0D1B2A] overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className="font-medium text-white/80">Tasks</span>
          <span>· {openCount} open</span>
          {closedCount > 0 && <span>· {closedCount} closed</span>}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="w-3 h-3 rounded border-white/20 bg-transparent"
            />
            Show closed
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-white/50 hover:text-white/80"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="text-center text-xs text-white/40 py-8">Loading tasks…</div>
        ) : openCount + (showCompleted ? closedCount : 0) === 0 ? (
          <EmptyChannel showClosed={showCompleted} hasClosed={closedCount > 0} />
        ) : (
          <>
            <ChannelSection label="In Progress" rows={grouped.in_progress} currentUserId={currentUserId} />
            <ChannelSection label="Pending" rows={grouped.pending} currentUserId={currentUserId} />
            {showCompleted && (
              <>
                <ChannelSection label="Completed" rows={grouped.completed} currentUserId={currentUserId} dim />
                <ChannelSection label="Cancelled / Reassigned" rows={[...grouped.cancelled, ...grouped.reassigned]} currentUserId={currentUserId} dim />
              </>
            )}
          </>
        )}
      </div>

      {/* Footer — link out to full My Tasks */}
      <div className="shrink-0 px-4 py-2 border-t border-white/10 text-xs text-white/50">
        <Link href="/care/my-tasks" className="hover:text-white/80 inline-flex items-center gap-1">
          Open My Tasks
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

function EmptyChannel({ showClosed, hasClosed }: { showClosed: boolean; hasClosed: boolean }) {
  return (
    <div className="text-center py-10 text-white/40 text-xs">
      {showClosed
        ? 'No tasks on this patient yet.'
        : hasClosed
          ? 'No open tasks. Toggle "Show closed" to see completed history.'
          : 'No tasks on this patient yet. Use /task in the chat below to assign one.'}
    </div>
  );
}

function ChannelSection({
  label, rows, currentUserId, dim,
}: {
  label: string;
  rows: TaskRow[];
  currentUserId: string | null;
  dim?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className={dim ? 'opacity-60' : ''}>
      <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5 px-0.5">
        {label} <span className="text-white/30">({rows.length})</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((t) => (
          <ChannelTaskRow key={t.id} task={t} currentUserId={currentUserId} />
        ))}
      </div>
    </div>
  );
}

function ChannelTaskRow({ task, currentUserId }: { task: TaskRow; currentUserId: string | null }) {
  const due = timeLeft(task.due_at);
  const isMine = currentUserId && task.assignee_id === currentUserId;
  const isOpen = task.status === 'pending' || task.status === 'in_progress';

  const body = (
    <div
      className={`rounded-md border px-3 py-2 transition
        ${due.overdue && isOpen ? 'border-amber-400/40 bg-amber-500/5' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
    >
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span className={`inline-flex rounded border px-1 py-0.5 uppercase font-semibold tracking-wide ${statusChip(task.status)}`}>
          {statusLabel(task.status)}
        </span>
        <span className={`inline-flex rounded border px-1 py-0.5 uppercase font-semibold tracking-wide ${priorityChip(task.priority)}`}>
          {task.priority}
        </span>
        <span className={`inline-flex rounded border px-1 py-0.5 ${due.overdue && isOpen ? 'border-amber-400/40 text-amber-200' : 'border-white/10 text-white/50'}`}>
          {due.label}
        </span>
        {isMine && (
          <span className="inline-flex rounded bg-blue-500/20 text-blue-200 border border-blue-500/40 px-1 py-0.5 uppercase font-semibold tracking-wide">
            Mine
          </span>
        )}
      </div>
      <div className="mt-1 text-sm text-white/90 truncate">{task.title}</div>
      {task.description && (
        <div className="mt-0.5 text-xs text-white/50 line-clamp-2 whitespace-pre-wrap">
          {task.description}
        </div>
      )}
      <div className="mt-1 text-[11px] text-white/40 flex items-center gap-2 flex-wrap">
        {task.assignee_name && <span>→ {task.assignee_name}</span>}
        {task.created_by_name && <span className="text-white/30">from {task.created_by_name}</span>}
      </div>
    </div>
  );

  // If this task is assigned to the current user, clicking opens /care/my-tasks.
  if (isMine && isOpen) {
    return <Link href="/care/my-tasks" className="block">{body}</Link>;
  }
  return body;
}
