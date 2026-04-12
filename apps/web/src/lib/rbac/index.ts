/**
 * RBAC — permission checking library
 * Checks user permissions against the roles → role_permissions → permissions tables.
 * Uses a server-side cache (per-request) to avoid repeated DB hits.
 */
import { getDb } from '@even-os/db';
import { roles, rolePermissions, permissions } from '@db/schema';
import { eq, and, inArray } from 'drizzle-orm';

export interface PermissionCheck {
  resource: string;
  action: string;
}

/**
 * Get all permissions for a user based on their roles array.
 * Returns Set of "resource.action" strings.
 */
export async function getUserPermissions(
  userRoles: string[],
  hospitalId: string
): Promise<Set<string>> {
  if (!userRoles || userRoles.length === 0) return new Set();

  const db = getDb();

  // Find role IDs matching user's role names for this hospital
  const roleRows = await db.select({ id: roles.id })
    .from(roles)
    .where(
      and(
        inArray(roles.name, userRoles),
        eq(roles.hospital_id, hospitalId),
        eq(roles.is_active, true),
      )
    );

  if (roleRows.length === 0) return new Set();

  const roleIds = roleRows.map(r => r.id);

  // Get all permissions for these roles
  const permRows = await db.select({
    resource: permissions.resource,
    action: permissions.action,
  })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permission_id, permissions.id))
    .where(inArray(rolePermissions.role_id, roleIds));

  return new Set(permRows.map(p => `${p.resource}.${p.action}`));
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(
  userRoles: string[],
  hospitalId: string,
  check: PermissionCheck
): Promise<boolean> {
  const perms = await getUserPermissions(userRoles, hospitalId);
  return perms.has(`${check.resource}.${check.action}`);
}

/**
 * Check if a user has ANY of the specified permissions.
 */
export async function hasAnyPermission(
  userRoles: string[],
  hospitalId: string,
  checks: PermissionCheck[]
): Promise<boolean> {
  const perms = await getUserPermissions(userRoles, hospitalId);
  return checks.some(c => perms.has(`${c.resource}.${c.action}`));
}

/**
 * Get all roles with their permission counts for a hospital.
 */
export async function getRolesWithPermissionCounts(hospitalId: string) {
  const db = getDb();

  const roleRows = await db.select({
    id: roles.id,
    name: roles.name,
    description: roles.description,
    role_group: roles.role_group,
    session_timeout_minutes: roles.session_timeout_minutes,
    is_active: roles.is_active,
    is_system_role: roles.is_system_role,
  })
    .from(roles)
    .where(eq(roles.hospital_id, hospitalId));

  // Get permission counts per role
  const result = [];
  for (const role of roleRows) {
    const permCount = await db.select({ id: rolePermissions.id })
      .from(rolePermissions)
      .where(eq(rolePermissions.role_id, role.id));
    result.push({ ...role, permission_count: permCount.length });
  }

  return result;
}
