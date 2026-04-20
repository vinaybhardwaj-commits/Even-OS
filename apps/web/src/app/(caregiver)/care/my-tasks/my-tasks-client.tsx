'use client';

/**
 * MyTasksClient — CHAT.X.6 UI.a
 *
 * Client surface for /care/my-tasks.
 *
 * Reads:
 *   • tasks.listMine { includeCompleted }   — grouped list
 *   • tasks.myCounts                        — badge counts
 *
 * Mutates:
 *   • tasks.updateStatus  — Start (→ in_progress), Cancel (→ cancelled)
 *   • chat.completeTask   — Complete (chat message stays authoritative)
 *
 * Layout
 *   Header strip        : counts (pending / in_progress / overdue) + toggle
 *   Overdue callout     : amber banner if overdue > 0
 *   Section: In Progress: ordered by due_at ASC (or created_at if no due)
 *   Section: Pending    : same ordering
 *   Section: Completed  : hidden by default, toggle reveals
 *
 * Each row shows title, description, patient link, channel link, due chip,
 * priority chip, and the appropriate action buttons.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ── tRPC helpers ───────────────────────────────────────────────────────
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
async function trpcMutate<T = any>(path: string, input: any): Promise<T | null> {
  try {
    const res = await fetch(`/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: input }),
    });
    const j = await res.json();
    if (j.error) return null;
    return (j.result?.data?.json ?? null) as T;
  } catch {
    return null;
  }
}

// ── Types (shape from tasks.ts router) ──────────────────────────────────
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
  channel_slug: string | null;
}
interface MyCounts {
  pending: number;
  in_progress: number;
  overdue: number;
}
interface Props {
  userId: string;
  userName: string;
}

// ── Display helpers ─────────────────────────────────────────────────────
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
function priorityStyle(p: TaskPriority): string {
  switch (p) {
    case 'critical': return 'bg-red-100 text-red-700 border-red-200';
    case 'urgent':   return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'high':     return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'normal':   return 'bg-slate-100 text-slate-600 border-slate-200';
    case 'low':      return 'bg-slate-50  text-slate-500 border-slate-200';
  }
}
function statusStyle(s: TaskStatus): string {
  switch (s) {
    case 'in_progress': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'pending':     return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'completed':   return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'cancelled':   return 'bg-zinc-100 text-zinc-500 border-zinc-200';
    case 'reassigned':  return 'bg-purple-100 text-purple-600 border-purple-200';
  }
}
function statusLabel(s: TaskStatus): string {
  return s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1);
}

export default function MyTasksClient({ userId, userName }: Props) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [counts, setCounts] = useState<MyCounts>({ pending: 0, in_progress: 0, overdue: 0 });
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const [rows, c] = await Promise.all([
      trpcQuery<TaskRow[]>('tasks.listMine', { includeCompleted: showCompleted, limit: 200 }),
      trpcQuery<MyCounts>('tasks.myCounts'),
    ]);
    setTasks(Array.isArray(rows) ? rows : []);
    setCounts(c ?? { pending: 0, in_progress: 0, overdue: 0 });
    setLoading(false);
    setRefreshing(false);
  }, [showCompleted]);

  useEffect(() => { void load(); }, [load]);

  // ── Grouping ───────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const g: Record<'in_progress' | 'pending' | 'completed' | 'cancelled' | 'reassigned', TaskRow[]> = {
      in_progress: [], pending: [], completed: [], cancelled: [], reassigned: [],
    };
    for (const t of tasks) g[t.status].push(t);
    return g;
  }, [tasks]);

  const dispatchChanged = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tasks:changed'));
    }
  };

  // ── Actions ────────────────────────────────────────────────────
  const onStart = async (t: TaskRow) => {
    setBusyId(t.id);
    setError(null);
    const res = await trpcMutate('tasks.updateStatus', { id: t.id, status: 'in_progress' });
    if (!res) setError('Could not start task. Try again?');
    else dispatchChanged();
    setBusyId(null);
    await load(true);
  };
  const onCancel = async (t: TaskRow) => {
    if (!confirm(`Cancel "${t.title}"? This cannot be undone.`)) return;
    setBusyId(t.id);
    setError(null);
    const res = await trpcMutate('tasks.updateStatus', { id: t.id, status: 'cancelled' });
    if (!res) setError('Could not cancel task. Try again?');
    else dispatchChanged();
    setBusyId(null);
    await load(true);
  };
  const onComplete = async (t: TaskRow) => {
    if (!t.chat_message_id) {
      setError('This task has no linked chat message — cannot complete through chat. Ask an admin.');
      return;
    }
    setBusyId(t.id);
    setError(null);
    const res = await trpcMutate('chat.completeTask', { messageId: t.chat_message_id });
    if (!res) setError('Could not complete task. Try again?');
    else dispatchChanged();
    setBusyId(null);
    await load(true);
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-slate-50">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">My Tasks</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Tasks assigned to {userName}. Updates here sync back to the originating chat.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}>
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              Refresh
            </button>
          </div>

          {/* Counts strip */}
          <div className="mt-4 flex flex-wrap gap-2">
            <CountChip label="Pending" value={counts.pending} tone="slate" />
            <CountChip label="In Progress" value={counts.in_progress} tone="blue" />
            <CountChip label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? 'red' : 'slate'} />
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300"
              />
              Show completed &amp; cancelled
            </label>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {counts.overdue > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
              <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <span>
              <strong>{counts.overdue}</strong> task{counts.overdue === 1 ? '' : 's'} past due. Address the oldest first.
            </span>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-slate-500 py-8 text-center">Loading your tasks…</div>
        ) : tasks.length === 0 ? (
          <EmptyState showingCompleted={showCompleted} />
        ) : (
          <>
            <Section title="In Progress" count={grouped.in_progress.length}>
              {grouped.in_progress.map((t) => (
                <TaskCard key={t.id} task={t} busy={busyId === t.id} onStart={onStart} onCancel={onCancel} onComplete={onComplete} />
              ))}
            </Section>
            <Section title="Pending" count={grouped.pending.length}>
              {grouped.pending.map((t) => (
                <TaskCard key={t.id} task={t} busy={busyId === t.id} onStart={onStart} onCancel={onCancel} onComplete={onComplete} />
              ))}
            </Section>
            {showCompleted && (
              <>
                <Section title="Completed" count={grouped.completed.length}>
                  {grouped.completed.map((t) => (
                    <TaskCard key={t.id} task={t} busy={busyId === t.id} onStart={onStart} onCancel={onCancel} onComplete={onComplete} />
                  ))}
                </Section>
                <Section title="Cancelled / Reassigned" count={grouped.cancelled.length + grouped.reassigned.length}>
                  {[...grouped.cancelled, ...grouped.reassigned].map((t) => (
                    <TaskCard key={t.id} task={t} busy={busyId === t.id} onStart={onStart} onCancel={onCancel} onComplete={onComplete} />
                  ))}
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {title} <span className="text-slate-400 font-normal">({count})</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function CountChip({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'blue' | 'red' }) {
  const toneMap: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    red: 'bg-red-100 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${toneMap[tone]}`}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function EmptyState({ showingCompleted }: { showingCompleted: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
      <div className="text-4xl mb-2">✅</div>
      <div className="text-sm font-medium text-slate-700">
        {showingCompleted ? 'No tasks to show.' : 'Inbox zero — no tasks assigned to you.'}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        New tasks appear here the moment someone /task-assigns them in chat.
      </div>
    </div>
  );
}

function TaskCard({
  task, busy, onStart, onCancel, onComplete,
}: {
  task: TaskRow;
  busy: boolean;
  onStart: (t: TaskRow) => void;
  onCancel: (t: TaskRow) => void;
  onComplete: (t: TaskRow) => void;
}) {
  const due = timeLeft(task.due_at);
  const isOpen = task.status === 'pending' || task.status === 'in_progress';
  const canStart = task.status === 'pending';
  const canComplete = isOpen && !!task.chat_message_id;

  return (
    <div className={`rounded-lg border bg-white px-4 py-3 shadow-sm transition ${due.overdue && isOpen ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Title + chips row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(task.status)}`}>
              {statusLabel(task.status)}
            </span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityStyle(task.priority)}`}>
              {task.priority}
            </span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] ${due.overdue && isOpen ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              {due.label}
            </span>
          </div>

          {/* Title */}
          <div className="mt-1.5 text-sm font-medium text-slate-900 truncate">{task.title}</div>

          {/* Description */}
          {task.description && (
            <div className="mt-0.5 text-xs text-slate-600 line-clamp-2 whitespace-pre-wrap">
              {task.description}
            </div>
          )}

          {/* Meta row */}
          <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-slate-500">
            {task.patient_name && task.patient_id && (
              <Link
                href={`/care/patient/${task.patient_id}`}
                className="inline-flex items-center gap-1 hover:text-slate-700"
                title="Open patient chart"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                {task.patient_name}
                {task.patient_uhid && <span className="text-slate-400">· {task.patient_uhid}</span>}
              </Link>
            )}
            {task.channel_slug && (
              <span className="inline-flex items-center gap-1 text-slate-500" title="Originating chat channel">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                #{task.channel_slug}
              </span>
            )}
            {task.created_by_name && (
              <span className="text-slate-400">from {task.created_by_name}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        {isOpen && (
          <div className="flex items-center gap-1.5 shrink-0">
            {canStart && (
              <button
                type="button"
                onClick={() => onStart(task)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Start
              </button>
            )}
            {canComplete && (
              <button
                type="button"
                onClick={() => onComplete(task)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Complete
              </button>
            )}
            <button
              type="button"
              onClick={() => onCancel(task)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
