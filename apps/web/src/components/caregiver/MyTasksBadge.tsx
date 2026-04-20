'use client';

/**
 * MyTasksBadge — CHAT.X.6 UI.c
 *
 * Top-nav badge showing the signed-in user's open-task count.
 * Calls tasks.myCounts on mount, refreshes every 30s, and listens for
 * a global `tasks:changed` CustomEvent so the badge updates the moment
 * /care/my-tasks or the ChannelTasksPanel mutates a task.
 *
 * Displays:
 *   • nothing when open count = 0 (prevents chrome noise)
 *   • `{pending + in_progress}` as the pill number
 *   • red dot overlay when overdue > 0
 *
 * Clicking deep-links to /care/my-tasks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface MyCounts {
  pending: number;
  in_progress: number;
  overdue: number;
}

async function fetchCounts(): Promise<MyCounts | null> {
  const wrapped = { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  try {
    const res = await fetch(`/api/trpc/tasks.myCounts${params}`);
    const j = await res.json();
    if (j.error) return null;
    return (j.result?.data?.json ?? null) as MyCounts;
  } catch {
    return null;
  }
}

const REFRESH_MS = 30_000;

export default function MyTasksBadge() {
  const [counts, setCounts] = useState<MyCounts | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const c = await fetchCounts();
    if (c) setCounts(c);
  }, []);

  useEffect(() => {
    void refresh();
    timerRef.current = setInterval(refresh, REFRESH_MS);

    // Other surfaces can dispatch `tasks:changed` after a mutation to
    // keep this badge fresh without waiting for the 30s poll.
    const onTasksChanged = () => { void refresh(); };
    window.addEventListener('tasks:changed', onTasksChanged);

    // When tab returns to focus, nudge a refresh.
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener('tasks:changed', onTasksChanged);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  const open = counts ? counts.pending + counts.in_progress : 0;
  const overdue = counts?.overdue ?? 0;
  const label = open === 0
    ? 'My Tasks — no open tasks'
    : `My Tasks — ${open} open${overdue > 0 ? `, ${overdue} overdue` : ''}`;

  // Hide until the first fetch resolves to avoid a flash of "0".
  if (counts === null) {
    return (
      <Link
        href="/care/my-tasks"
        title="My Tasks"
        className="relative p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors inline-flex"
        aria-label="My Tasks"
      >
        <TasksIcon />
      </Link>
    );
  }

  return (
    <Link
      href="/care/my-tasks"
      title={label}
      aria-label={label}
      className="relative p-1.5 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors inline-flex"
    >
      <TasksIcon />

      {/* Count pill — only when there are open tasks */}
      {open > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-semibold rounded-full flex items-center justify-center
            ${overdue > 0 ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`}
        >
          {open > 99 ? '99+' : open}
        </span>
      )}

      {/* Overdue pulse — subtle ring if any overdue and count pill already red */}
      {overdue > 0 && open === 0 && (
        <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
      )}
    </Link>
  );
}

function TasksIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}
