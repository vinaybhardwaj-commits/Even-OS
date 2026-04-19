'use client';

/**
 * ModuleIndex — dense, searchable "god view" of every admin route the user
 * can access.
 *
 * Replaces the AD.1 pillar-grid card layout. The grid was pretty but
 * inefficient for scanning ~90 routes — this is a single dense list
 * grouped by pillar, with an always-visible search box at the top.
 *
 * Behavior:
 *   - Search filters titles, paths, blurbs, and keywords (via searchRoutes()).
 *   - Pillar headers collapse/expand on click (default: expanded).
 *   - `hideFromNav` routes are included (this is the superset view) and
 *     are marked with a subtle "hidden" tag so V can still reach them.
 *   - Beta / legacy / stub statuses each get a tiny tag.
 *
 * Performance: all 90-ish routes render client-side; filter is a simple
 * in-memory scan on each keystroke. No virtualization needed at this scale.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  routesByPillar,
  searchRoutes,
  type AdminRoute,
} from '@/lib/admin-manifest';

interface ModuleIndexProps {
  /** The full superset of routes the user can see (incl. hideFromNav). */
  routes: AdminRoute[];
}

export function ModuleIndex({ routes }: ModuleIndexProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => searchRoutes(routes, query),
    [routes, query],
  );

  const grouped = useMemo(() => routesByPillar(filtered), [filtered]);

  const totalMatches = filtered.length;
  const totalRoutes = routes.length;

  return (
    <section aria-label="Module index" className="mb-4">
      {/* Header */}
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Module Index
          </h2>
          <p className="text-[11px] text-slate-500">
            {query
              ? `${totalMatches} of ${totalRoutes} routes match "${query}"`
              : `${totalRoutes} routes available`}
          </p>
        </div>
        <input
          type="search"
          placeholder="Search modules…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          aria-label="Search modules"
        />
      </div>

      {/* Empty state */}
      {grouped.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No modules match <code className="font-mono">{query}</code>.
        </div>
      )}

      {/* Grouped dense list */}
      <div className="space-y-4">
        {grouped.map(({ pillar, meta, routes: pillarRoutes }) => (
          <div
            key={pillar}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="text-base" aria-hidden="true">
                  {meta.icon}
                </span>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  {meta.label}
                </h3>
                <span className="text-[11px] text-slate-400">
                  · {meta.blurb}
                </span>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                {pillarRoutes.length}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {pillarRoutes.map(r => (
                <li key={r.path}>
                  <Link
                    href={r.path}
                    className="flex items-start gap-3 px-4 py-2 transition-colors hover:bg-slate-50"
                  >
                    <span
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-[13px] text-slate-500"
                      aria-hidden="true"
                    >
                      {r.icon || '•'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium text-slate-900">
                          {r.title}
                        </span>
                        <RouteTag route={r} />
                      </span>
                      {r.blurb && (
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                          {r.blurb}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 ml-2 shrink-0 font-mono text-[10px] text-slate-400">
                      {r.path}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function RouteTag({ route }: { route: AdminRoute }) {
  const tags: Array<{ label: string; className: string }> = [];

  if (route.status === 'beta') {
    tags.push({
      label: 'β',
      className: 'bg-amber-100 text-amber-800',
    });
  }
  if (route.status === 'legacy') {
    tags.push({
      label: 'legacy',
      className: 'bg-slate-100 text-slate-500',
    });
  }
  if (route.status === 'stub') {
    tags.push({
      label: 'stub',
      className: 'bg-slate-100 text-slate-500',
    });
  }
  if (route.hideFromNav) {
    tags.push({
      label: 'hidden',
      className: 'bg-blue-50 text-blue-600',
    });
  }

  if (tags.length === 0) return null;

  return (
    <>
      {tags.map(t => (
        <span
          key={t.label}
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${t.className}`}
        >
          {t.label}
        </span>
      ))}
    </>
  );
}
