/**
 * /admin — Command Center landing.
 *
 * AD.1.5: wires the new <AdminShell /> around a placeholder Command Center
 * body. The body will be fleshed out in AD.3 with the 3-rail layout
 * (Live Ops / My Work / Module Index). For now we ship a manifest-backed
 * module index so every admin page is reachable from this page on day one.
 *
 * Other /admin/* routes continue to own their own chrome — they are NOT
 * wrapped by <AdminShell /> yet. That cut-over happens in a later phase
 * to avoid double-header/double-sidebar regressions.
 */
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { AdminShell } from '@/components/admin/AdminShell';
import { routesForRole, routesByPillar } from '@/lib/admin-manifest';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['super_admin', 'hospital_admin', 'dept_head'];

export default async function AdminIndexPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  if (!ADMIN_ROLES.includes(user.role)) {
    redirect('/');
  }

  // routesForRole already filters out hideFromNav — ideal for a browse grid.
  const visibleRoutes = routesForRole(user.role);
  const grouped = routesByPillar(visibleRoutes);

  return (
    <AdminShell user={user}>
      {/* Header block */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Command Center
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {grouped.length} pillars · {visibleRoutes.length} modules available ·
          <span className="ml-1 font-mono text-xs">⌘K</span> to jump to any page.
        </p>
      </div>

      {/* Module index — pillar grid */}
      <section aria-label="Module index" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {grouped.map(({ pillar, meta, routes: pillarRoutes }) => (
          <div
            key={pillar}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">
                  {meta.icon}
                </span>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                  {meta.label}
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {pillarRoutes.length}
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-500">{meta.blurb}</p>
            <ul className="space-y-0.5">
              {pillarRoutes.map(r => (
                <li key={r.path}>
                  <Link
                    href={r.path}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-[13px]" aria-hidden="true">
                      {r.icon || '•'}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium leading-tight">{r.title}</span>
                      {r.blurb && (
                        <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">
                          {r.blurb}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Footer note */}
      <div className="mt-8 rounded-lg border border-dashed border-slate-200 bg-white/60 p-4 text-[12px] text-slate-500">
        <strong className="text-slate-700">AD.1 preview.</strong>{' '}
        Full Live-Ops strip, My-Work rail, and deep health/status dashboard
        land in AD.3–AD.4. The <code>admin-manifest.ts</code> index ships with
        the most important ~60 routes; AD.2 brings the full ~88 enumeration
        plus a CI gate that fails the build on drift.
      </div>
    </AdminShell>
  );
}
