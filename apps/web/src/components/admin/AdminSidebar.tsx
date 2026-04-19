'use client';

/**
 * AdminSidebar — collapsible, pillar-grouped nav driven by the manifest.
 *
 * Expanded: 260px. Collapsed: 64px (icons only, tooltips on hover).
 * The active route is highlighted using the current pathname.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { routesByPillar, PILLAR_META, type AdminRoute, type AdminPillar } from '@/lib/admin-manifest';

interface AdminSidebarProps {
  routes: AdminRoute[];
  collapsed: boolean;
}

export function AdminSidebar({ routes, collapsed }: AdminSidebarProps) {
  const pathname = usePathname() || '';
  // Hide routes flagged with hideFromNav (e.g. sub-wizards).
  const visibleRoutes = useMemo(() => routes.filter(r => !r.hideFromNav), [routes]);
  const grouped = useMemo(() => routesByPillar(visibleRoutes), [visibleRoutes]);

  // Remember which pillars are open (default: all open)
  const [openPillars, setOpenPillars] = useState<Record<AdminPillar, boolean>>(() => {
    const init: Partial<Record<AdminPillar, boolean>> = {};
    (Object.keys(PILLAR_META) as AdminPillar[]).forEach(p => (init[p] = true));
    return init as Record<AdminPillar, boolean>;
  });

  const togglePillar = (p: AdminPillar) =>
    setOpenPillars(prev => ({ ...prev, [p]: !prev[p] }));

  return (
    <aside
      className={`shrink-0 overflow-y-auto border-r border-slate-200 bg-white transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
      aria-label="Admin navigation"
    >
      <nav className="py-2">
        {grouped.map(({ pillar, meta, routes: pillarRoutes }) => {
          const isOpen = openPillars[pillar];
          return (
            <div key={pillar} className="px-2 pb-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => togglePillar(pillar)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true">{meta.icon}</span>
                    <span>{meta.label}</span>
                  </span>
                  <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                </button>
              )}
              {collapsed && (
                <div className="my-1 grid place-items-center text-[14px] text-slate-400" title={meta.label}>
                  {meta.icon}
                </div>
              )}
              {(isOpen || collapsed) && (
                <ul className="mt-0.5">
                  {pillarRoutes.map(r => {
                    const active =
                      pathname === r.path || (r.path !== '/admin' && pathname.startsWith(r.path + '/'));
                    return (
                      <li key={r.path}>
                        <Link
                          href={r.path}
                          title={collapsed ? `${r.title} — ${r.blurb || ''}` : undefined}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                            active
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                          } ${collapsed ? 'justify-center' : ''}`}
                        >
                          <span className="grid h-5 w-5 shrink-0 place-items-center text-[14px]" aria-hidden="true">
                            {r.icon || '•'}
                          </span>
                          {!collapsed && (
                            <span className="truncate">
                              {r.title}
                              {r.status === 'beta' && (
                                <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                                  β
                                </span>
                              )}
                              {r.status === 'legacy' && (
                                <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
                                  legacy
                                </span>
                              )}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        {!collapsed && (
          <div className="mt-4 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
            <div>Even OS — Admin</div>
            <div>{routes.length} routes available</div>
          </div>
        )}
      </nav>
    </aside>
  );
}
