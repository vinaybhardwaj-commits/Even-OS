'use client';

/**
 * AdminTopBar — 56px high. From left to right:
 *   [☰ collapse] [Even OS logo/title] [HealthPills] [🔍 Search (⌘K)] [🔔 Bell] [User menu]
 */
import Link from 'next/link';
import { HealthPills } from './HealthPills';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

interface AdminTopBarProps {
  user: {
    name: string;
    email: string;
    role: string;
    department?: string;
  };
  onSearchClick: () => void;
  onToggleSidebar: () => void;
}

export function AdminTopBar({ user, onSearchClick, onToggleSidebar }: AdminTopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 shadow-sm">
      {/* Left: sidebar toggle + brand */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="grid h-9 w-9 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M3 5h14a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2Zm0 4h14a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2Zm0 4h14a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2Z" />
        </svg>
      </button>

      <Link href="/admin" className="flex items-center gap-2 text-slate-900 hover:text-slate-700">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white">
          E
        </div>
        <span className="text-sm font-semibold tracking-tight">Even OS</span>
        <span className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600 md:inline">
          Admin
        </span>
      </Link>

      {/* Center: health pills (hidden on small screens) */}
      <div className="hidden flex-1 justify-center md:flex">
        <HealthPills />
      </div>
      <div className="flex-1 md:hidden" />

      {/* Right cluster: search + bell + user */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 hover:bg-white hover:text-slate-700"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8 3a5 5 0 1 0 3.06 8.94l3 3a1 1 0 0 0 1.42-1.41l-3-3A5 5 0 0 0 8 3Zm-3 5a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" clipRule="evenodd" />
        </svg>
        <span className="hidden md:inline">Search…</span>
        <kbd className="ml-2 hidden rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 shadow-sm md:inline">⌘K</kbd>
      </button>

      <NotificationBell />
      <UserMenu user={user} />
    </header>
  );
}
