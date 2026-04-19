'use client';

/**
 * CommandPalette — ⌘K modal for jumping to any admin route.
 *
 * Fuzzy matches via searchRoutes() in the manifest. Arrow keys navigate,
 * Enter activates. Esc closes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchRoutes, type AdminRoute } from '@/lib/admin-manifest';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  routes: AdminRoute[];
}

export function CommandPalette({ open, onClose, routes }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    return searchRoutes(routes, query).slice(0, 10);
  }, [routes, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus input next tick so autofocus works with the transition
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const go = (r: AdminRoute) => {
    router.push(r.path);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) go(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="text-slate-400" aria-hidden="true">
            <path fillRule="evenodd" d="M8 3a5 5 0 1 0 3.06 8.94l3 3a1 1 0 0 0 1.42-1.41l-3-3A5 5 0 0 0 8 3Zm-3 5a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" clipRule="evenodd" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a module or search…"
            className="flex-1 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No matches.</div>
          )}
          {results.map((r, i) => {
            const isActive = i === active;
            return (
              <button
                key={r.path}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                  isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-base">
                  {r.icon || '•'}
                </span>
                <span className="flex-1 overflow-hidden">
                  <span className="block truncate text-sm font-medium text-slate-900">{r.title}</span>
                  <span className="block truncate text-xs text-slate-500">{r.blurb || r.path}</span>
                </span>
                <span className="hidden font-mono text-[10px] text-slate-400 md:inline">{r.path}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-2">
            <kbd className="rounded bg-white px-1.5 py-0.5 font-mono">↑↓</kbd> navigate
            <kbd className="rounded bg-white px-1.5 py-0.5 font-mono">↵</kbd> open
          </span>
          <span>{routes.length} routes indexed</span>
        </div>
      </div>
    </div>
  );
}
