'use client';

/**
 * NotificationBell — placeholder for AD.3/AD.4. Shows a bell with no dot
 * until we wire real alert-queue polling. Clicking it opens a
 * "Notifications coming soon" popover.
 */
import { useState, useRef, useEffect } from 'react';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        className="grid h-9 w-9 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 2a5 5 0 0 0-5 5v2.586l-1.707 1.707A1 1 0 0 0 4 13h12a1 1 0 0 0 .707-1.707L15 9.586V7a5 5 0 0 0-5-5Zm-1 15a1 1 0 0 0 2 0h-2Z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-72 rounded-lg bg-white p-4 text-sm shadow-xl ring-1 ring-slate-900/5">
          <div className="font-semibold text-slate-900">Notifications</div>
          <p className="mt-1 text-xs text-slate-500">
            Alert queue integration lands in AD.4. For now, check{' '}
            <a href="/admin/alert-queue" className="text-blue-600 hover:underline">
              Alert Queue
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
