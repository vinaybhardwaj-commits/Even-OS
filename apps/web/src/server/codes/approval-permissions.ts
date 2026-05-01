// =============================================================================
// Codes — approval RBAC helpers
// =============================================================================
// Mirrors the SCM SoD pattern (apps/web/src/server/scm/sod-permissions.ts) but
// for the 6 codes_role values. super_admin / hospital_admin always bypass.
// =============================================================================

import { db } from '@/lib/db';
import { codesRoleAssignments, type CodesRole, CODES_ROLES } from '@db/schema';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Look up the codes roles a user currently holds at a hospital. Soft-revoked
 * assignments are filtered out via `revoked_at IS NULL`.
 */
export async function listUserCodesRoles(
  hospital_id: string,
  user_id: string,
): Promise<CodesRole[]> {
  const rows = await db
    .select({ codes_role: codesRoleAssignments.codes_role })
    .from(codesRoleAssignments)
    .where(and(
      eq(codesRoleAssignments.hospital_id, hospital_id),
      eq(codesRoleAssignments.user_id, user_id),
      isNull(codesRoleAssignments.revoked_at),
    ));
  // Coerce text → CodesRole; defensive filter against garbage.
  return rows
    .map((r) => r.codes_role as CodesRole)
    .filter((r): r is CodesRole => CODES_ROLES.includes(r));
}

/**
 * Throw a useful error if the caller doesn't hold the required codes role.
 * super_admin / hospital_admin bypass per Even OS standard pattern.
 */
export async function assertHasCodesRole(args: {
  hospital_id: string;
  user_id: string;
  user_system_role: string;
  required_role: CodesRole;
}): Promise<void> {
  if (args.user_system_role === 'super_admin' || args.user_system_role === 'hospital_admin') {
    return; // bypass
  }
  const held = await listUserCodesRoles(args.hospital_id, args.user_id);
  if (!held.includes(args.required_role)) {
    throw new Error(
      `Caller (${args.user_id}, ${args.user_system_role}) does not hold required codes role '${args.required_role}'. Currently held: [${held.join(', ') || 'none'}].`,
    );
  }
}

/**
 * As above, but allow ANY of a set of roles. Used for transitions where
 * multiple roles are acceptable (e.g. clinical_approve).
 */
export async function assertHasAnyCodesRole(args: {
  hospital_id: string;
  user_id: string;
  user_system_role: string;
  acceptable_roles: CodesRole[];
}): Promise<void> {
  if (args.user_system_role === 'super_admin' || args.user_system_role === 'hospital_admin') {
    return;
  }
  const held = await listUserCodesRoles(args.hospital_id, args.user_id);
  for (const r of args.acceptable_roles) {
    if (held.includes(r)) return;
  }
  throw new Error(
    `Caller (${args.user_id}, ${args.user_system_role}) holds none of the acceptable codes roles [${args.acceptable_roles.join(', ')}]. Currently held: [${held.join(', ') || 'none'}].`,
  );
}
