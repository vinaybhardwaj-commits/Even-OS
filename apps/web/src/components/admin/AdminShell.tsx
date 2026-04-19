/**
 * AdminShell — top-level chrome for every admin surface.
 *
 * Composition: top bar (health pills + search + notifications + user) +
 *              collapsible sidebar (manifest-driven, pillar-grouped) +
 *              main content region (children).
 *
 * AD.1 deployment: wrapped ONLY around /admin (Command Center landing).
 * All other admin pages continue to own their chrome until we cut them over
 * in later sprints. This prevents double-header/double-sidebar regressions.
 *
 * Server component — accepts the current user from the parent server page.
 * Renders a client-side <AdminShellClient /> with the data it needs.
 */
import type { JWTPayload } from '@/lib/auth';
import { searchableRoutesForRole } from '@/lib/admin-manifest';
import { AdminShellClient } from './AdminShellClient';

interface AdminShellProps {
  user: JWTPayload;
  children: React.ReactNode;
}

export function AdminShell({ user, children }: AdminShellProps) {
  // Pass the superset (including hideFromNav) — the sidebar filters it
  // down at render time; the command palette uses the full set.
  const routes = searchableRoutesForRole(user.role);
  return (
    <AdminShellClient
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
      }}
      routes={routes}
    >
      {children}
    </AdminShellClient>
  );
}
