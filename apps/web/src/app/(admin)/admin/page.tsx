/**
 * /admin — Command Center landing.
 *
 * AD.3: the full 3-rail Command Center body. From top to bottom:
 *
 *   1. <LiveOpsStrip />   — 4-cell live aggregated probe (ops/alerts/
 *                           revenue/system). Polls /api/admin/live-ops
 *                           every 30s. Every cell deep-links.
 *   2. <MyWorkRail />     — 6–8 role-scoped action tiles for the user's
 *                           daily workflow. Pure server-render, no data.
 *   3. <ModuleIndex />    — dense, searchable superset of EVERY admin
 *                           surface (incl. hideFromNav routes). Replaces
 *                           the AD.1 pillar-grid cards.
 *
 * The page itself only wires composition + auth gating. All three rails
 * are self-contained so regressions in one don't break the others.
 *
 * Other /admin/* routes still own their own chrome — we haven't done the
 * AdminShell cut-over for them yet (that's a later polish pass). The
 * landing page is the single AdminShell-wrapped surface for now.
 */
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AdminShell } from '@/components/admin/AdminShell';
import { LiveOpsStrip } from '@/components/admin/LiveOpsStrip';
import { MyWorkRail } from '@/components/admin/MyWorkRail';
import { ModuleIndex } from '@/components/admin/ModuleIndex';
import { searchableRoutesForRole } from '@/lib/admin-manifest';

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

  // ModuleIndex gets the SUPERSET — includes hideFromNav routes so V can
  // still reach back-office surfaces from the search box. The sidebar/⌘K
  // already filter hideFromNav out, so this is the only place those
  // routes are discoverable.
  const indexRoutes = searchableRoutesForRole(user.role);

  return (
    <AdminShell user={user}>
      {/* Header block */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Command Center
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Live operations, your work, and every module — one screen.
          <span className="ml-1 font-mono text-xs">⌘K</span> to jump to any page.
        </p>
      </div>

      {/* Rail 1 — Live Ops strip (client, polls every 30s) */}
      <LiveOpsStrip />

      {/* Rail 2 — My Work (role-adaptive, server-rendered) */}
      <MyWorkRail role={user.role} />

      {/* Rail 3 — Module Index (client, searchable superset) */}
      <ModuleIndex routes={indexRoutes} />
    </AdminShell>
  );
}
