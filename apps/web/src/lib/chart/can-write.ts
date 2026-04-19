/**
 * PC.3.4.C — Server-side enforcement of `chart_permission_matrix.allowed_write_actions`.
 *
 * Before PC.3.4.C a role's `allowed_write_actions` list was purely a client-side
 * hint — the action bar hid buttons a role shouldn't see, but the underlying
 * tRPC mutations would still accept the request if someone crafted it directly.
 * This helper gates mutations against the same matrix that drives the UI so the
 * wire is truly role-scoped.
 *
 * ### Usage
 *
 *   await assertRoleCanWrite(ctx.user, 'note.create');
 *
 * Throws `TRPCError({ code: 'FORBIDDEN' })` when the caller's role is not in the
 * matrix row's `allowed_write_actions` array. Returns silently when allowed.
 *
 * ### Important — use ctx.user, NOT ctx.effectiveUser
 *
 * Preview-as-role (PC.3.4.B) is a **read-only** impersonation. A super_admin
 * viewing the chart "as pharmacist" should see exactly the pharmacist
 * projection, but any write they commit must go through under their real
 * super_admin identity (for audit attribution and to stop the preview cookie
 * from becoming a write-escalation vector). So this helper ALWAYS reads
 * ctx.user — the real JWT — regardless of any preview overlay.
 *
 * ### Bypass roles
 *
 * `super_admin` and `hospital_admin` always pass — they need unrestricted
 * write access for break-glass/incident scenarios, and we cannot rely on the
 * matrix seeding every mutation slug for them.
 */

import { TRPCError } from '@trpc/server';
import { resolveChartConfigForUser } from './selectors';

const BYPASS_ROLES = new Set(['super_admin', 'hospital_admin']);

type WritableUser = {
  role?: string | null;
  hospital_id?: string | null;
} | null | undefined;

export async function assertRoleCanWrite(
  user: WritableUser,
  slug: string,
): Promise<void> {
  if (!user || !user.role) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  }
  if (BYPASS_ROLES.has(user.role)) return;

  const config = await resolveChartConfigForUser(user);
  const allowed = config.allowed_write_actions ?? [];
  if (allowed.includes(slug)) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `Role "${user.role}" is not permitted to perform "${slug}". Matrix-defined allowed actions: ${allowed.join(', ') || '(none)'}.`,
  });
}

export async function checkRoleCanWrite(
  user: WritableUser,
  slug: string,
): Promise<{ ok: boolean; allowed: string[]; reason?: string }> {
  if (!user || !user.role) {
    return { ok: false, allowed: [], reason: 'unauthenticated' };
  }
  if (BYPASS_ROLES.has(user.role)) {
    return { ok: true, allowed: ['*'] };
  }
  const config = await resolveChartConfigForUser(user);
  const allowed = config.allowed_write_actions ?? [];
  if (allowed.includes(slug)) return { ok: true, allowed };
  return { ok: false, allowed, reason: 'not-in-matrix' };
}
