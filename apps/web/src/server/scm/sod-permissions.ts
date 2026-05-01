import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// ============================================================
// SCM SoD permissions — Phase 1.6
//
// Encodes the 7-role conflict matrix from /admin/scm/roles spec:
//
//   pr_creator         ✗ po_approver, grn_creator
//   po_creator         ✗ po_approver, grn_creator
//   po_approver        ✗ pr_creator, po_creator, grn_creator
//   grn_creator        ✗ pr_creator, po_creator, po_approver
//   inventory_manager  ✗ pr_creator, po_creator, grn_creator
//   item_master_steward (no SoD conflicts)
//   scm_admin          (no SoD conflicts; oversight role with audited override)
//
// Plus access helpers used by SCM router mutations:
//   - listUserScmRoles(userId, hospitalId) → string[]   (active roles only)
//   - assertHasRole(ctx, allowed)                       (throws FORBIDDEN if user lacks any of `allowed`)
//   - assertNoSoDConflict(scmRole, existingRoles)       (throws BAD_REQUEST if assignment would conflict)
//
// Override pattern: super_admin and hospital_admin pass assertHasRole
// WITHOUT needing scm_role_assignments rows. This matches the existing
// app convention and lets V/admins bootstrap before role assignments roll out.
//
// Audit: every assertion logged at the procedure call site, not here —
// this module is pure logic, no DB writes other than the one read.
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

export type ScmRole =
  | 'pr_creator'
  | 'po_approver'
  | 'po_creator'
  | 'grn_creator'
  | 'inventory_manager'
  | 'item_master_steward'
  | 'scm_admin';

export const SCM_ROLES: ScmRole[] = [
  'pr_creator',
  'po_approver',
  'po_creator',
  'grn_creator',
  'inventory_manager',
  'item_master_steward',
  'scm_admin',
];

/** Per-role conflict set. A user may NOT hold both roles in any pair. */
export const SCM_SOD_CONFLICTS: Record<ScmRole, ScmRole[]> = {
  pr_creator: ['po_approver', 'grn_creator'],
  po_creator: ['po_approver', 'grn_creator'],
  po_approver: ['pr_creator', 'po_creator', 'grn_creator'],
  grn_creator: ['pr_creator', 'po_creator', 'po_approver'],
  inventory_manager: ['pr_creator', 'po_creator', 'grn_creator'],
  item_master_steward: [],
  scm_admin: [],
};

/** Application-level admin roles that bypass all SCM SoD checks. */
const APP_ADMIN_OVERRIDES = new Set(['super_admin', 'hospital_admin']);

/**
 * List the user's currently-active SCM roles for the given hospital.
 * `revoked_at IS NULL` means active.
 */
export async function listUserScmRoles(userId: string, hospitalId: string): Promise<ScmRole[]> {
  const rows = await getSql()(
    `SELECT scm_role FROM scm_role_assignments
     WHERE user_id = $1 AND hospital_id = $2 AND revoked_at IS NULL`,
    [userId, hospitalId]
  );
  return rows.map((r: any) => r.scm_role as ScmRole);
}

/**
 * Bypass check: super_admin / hospital_admin pass every SCM SoD check.
 */
export function isAppAdmin(userRole: string): boolean {
  return APP_ADMIN_OVERRIDES.has(userRole);
}

/**
 * Assert that the user holds AT LEAST ONE of `allowed` SCM roles for the
 * current hospital. Application admins bypass.
 *
 * @throws TRPCError({ code: 'FORBIDDEN' }) if the user has no app-admin
 *         override and no matching SCM role assignment.
 */
export async function assertHasScmRole(
  ctx: { user: { sub: string; hospital_id: string; role: string } },
  allowed: ScmRole[],
): Promise<void> {
  if (isAppAdmin(ctx.user.role)) return;

  const roles = await listUserScmRoles(ctx.user.sub, ctx.user.hospital_id);
  const matched = roles.some((r) => allowed.includes(r));
  if (!matched) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Requires SCM role: ${allowed.join(' OR ')}. You hold: ${roles.join(', ') || '(none)'}.`,
    });
  }
}

/**
 * Determine which assigned roles would conflict if `scmRole` were added.
 * Pure function — does NOT hit the database. Caller is responsible for
 * passing the user's currently-active roles.
 */
export function findSoDConflicts(scmRole: ScmRole, existingRoles: ScmRole[]): ScmRole[] {
  const conflicts = SCM_SOD_CONFLICTS[scmRole] || [];
  return existingRoles.filter((r) => conflicts.includes(r));
}

/**
 * Throw BAD_REQUEST if granting `scmRole` to a user would create a SoD
 * conflict with any role they already hold.
 */
export function assertNoSoDConflict(scmRole: ScmRole, existingRoles: ScmRole[]): void {
  const conflicts = findSoDConflicts(scmRole, existingRoles);
  if (conflicts.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        `Cannot assign ${scmRole}: SoD conflict with already-held roles ` +
        `${conflicts.join(', ')}. Revoke the conflicting roles first.`,
    });
  }
}

/** Quick label lookup for UI / error messages. */
export const SCM_ROLE_LABELS: Record<ScmRole, string> = {
  pr_creator: 'Purchase Requisition Creator',
  po_approver: 'Purchase Order Approver',
  po_creator: 'Purchase Order Creator',
  grn_creator: 'Goods Receipt Creator',
  inventory_manager: 'Inventory Manager',
  item_master_steward: 'Item Master Steward',
  scm_admin: 'SCM Administrator',
};
