import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import {
  type ScmRole,
  SCM_ROLES,
  listUserScmRoles,
  assertNoSoDConflict,
  assertHasScmRole,
  isAppAdmin,
} from '../../scm/sod-permissions';

// ============================================================
// SCM › ROLES — Phase 1.6 (Path B locked)
//
// Per-hospital admin self-service for SCM role assignment.
//   - assign      grant an SCM role to a user (validates SoD matrix)
//   - revoke      soft-revoke (preserves audit trail)
//   - list        list assignments with filters (active_only / role / user)
//   - listForUser current active SCM roles for a user (UI prefill / SoD preview)
//
// Authority:
//   - super_admin + hospital_admin can assign / revoke any SCM role
//   - scm_admin (a SCM role) can also assign / revoke (oversight pillar)
//   - All others: FORBIDDEN
//
// Audit: every assign + revoke writes audit_logs (matches medication-orders.ts
// + care-pathways.ts convention). Re-assigning a previously-revoked role
// creates a NEW row (revoked_at NULL); the old row stays revoked for history.
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const scmRoleEnum = z.enum([
  'pr_creator',
  'po_approver',
  'po_creator',
  'grn_creator',
  'inventory_manager',
  'item_master_steward',
  'scm_admin',
]);

// Helper: only super_admin / hospital_admin / scm_admin may manage assignments
async function assertCanManageRoles(ctx: { user: { sub: string; hospital_id: string; role: string } }) {
  if (isAppAdmin(ctx.user.role)) return;
  // scm_admin (the SCM role) may also manage assignments
  await assertHasScmRole(ctx, ['scm_admin']);
}

// ---------- Named procedure exports ----------

/** Grant an SCM role to a user. SoD matrix enforced server-side. */
export const rolesAssignProcedure = protectedProcedure
  .input(
    z.object({
      user_id: z.string().uuid(),
      scm_role: scmRoleEnum,
      grant_reason: z.string().optional(),
      notes: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    await assertCanManageRoles(ctx);

    // Compute current active roles for SoD check
    const existing = await listUserScmRoles(input.user_id, ctx.user.hospital_id);

    // Idempotent: don't double-grant the same role
    if (existing.includes(input.scm_role)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `User already holds ${input.scm_role}`,
      });
    }

    // SoD conflict matrix
    assertNoSoDConflict(input.scm_role as ScmRole, existing);

    // Verify target user exists in this hospital
    const userCheck = await getSql()(
      `SELECT id FROM users WHERE id = $1 AND hospital_id = $2`,
      [input.user_id, ctx.user.hospital_id]
    );
    if (!userCheck.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Target user not found in this hospital' });
    }

    const result = await getSql()(
      `INSERT INTO scm_role_assignments (
        hospital_id, user_id, scm_role,
        granted_by, grant_reason, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        ctx.user.hospital_id,
        input.user_id,
        input.scm_role,
        ctx.user.sub,
        input.grant_reason || null,
        input.notes || null,
      ]
    );

    await getSql()(
      `INSERT INTO audit_logs (
        hospital_id, user_id, action, table_name, row_id,
        new_values, ip_address, created_at
      ) VALUES ($1, $2, 'INSERT', 'scm_role_assignments', $3, $4::jsonb, 'server', NOW())`,
      [
        ctx.user.hospital_id,
        ctx.user.sub,
        result[0].id,
        JSON.stringify({
          target_user: input.user_id,
          scm_role: input.scm_role,
          grant_reason: input.grant_reason,
          previously_held: existing,
        }),
      ]
    );

    return result[0];
  });

/** Soft-revoke an active SCM role assignment. */
export const rolesRevokeProcedure = protectedProcedure
  .input(
    z.object({
      assignment_id: z.string().uuid(),
      revoke_reason: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    await assertCanManageRoles(ctx);

    // Hospital-scoped + still-active check
    const result = await getSql()(
      `UPDATE scm_role_assignments
       SET revoked_by = $1,
           revoked_at = NOW(),
           revoke_reason = $2
       WHERE id = $3 AND hospital_id = $4 AND revoked_at IS NULL
       RETURNING *`,
      [ctx.user.sub, input.revoke_reason || null, input.assignment_id, ctx.user.hospital_id]
    );

    if (!result.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Active role assignment not found (already revoked or wrong hospital)',
      });
    }

    await getSql()(
      `INSERT INTO audit_logs (
        hospital_id, user_id, action, table_name, row_id,
        new_values, ip_address, created_at
      ) VALUES ($1, $2, 'UPDATE', 'scm_role_assignments', $3, $4::jsonb, 'server', NOW())`,
      [
        ctx.user.hospital_id,
        ctx.user.sub,
        input.assignment_id,
        JSON.stringify({
          revoked: true,
          revoke_reason: input.revoke_reason,
          target_user: result[0].user_id,
          scm_role: result[0].scm_role,
        }),
      ]
    );

    return result[0];
  });

/** List role assignments. Filters: active_only, scm_role, user_id. */
export const rolesListProcedure = protectedProcedure
  .input(
    z.object({
      active_only: z.boolean().default(true),
      scm_role: scmRoleEnum.optional(),
      user_id: z.string().uuid().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    let where = 'a.hospital_id = $1';
    const params: any[] = [ctx.user.hospital_id];
    let p = 2;

    if (input.active_only) {
      where += ' AND a.revoked_at IS NULL';
    }
    if (input.scm_role) {
      where += ` AND a.scm_role = $${p++}`;
      params.push(input.scm_role);
    }
    if (input.user_id) {
      where += ` AND a.user_id = $${p++}`;
      params.push(input.user_id);
    }

    const rows = await getSql()(
      `SELECT a.*,
              u.full_name AS user_full_name, u.email AS user_email, u.role AS user_role,
              ub.full_name AS granted_by_name,
              ur.full_name AS revoked_by_name
       FROM scm_role_assignments a
       LEFT JOIN users u  ON a.user_id    = u.id
       LEFT JOIN users ub ON a.granted_by = ub.id
       LEFT JOIN users ur ON a.revoked_by = ur.id
       WHERE ${where}
       ORDER BY a.granted_at DESC`,
      params
    );
    return rows;
  });

/** Get a single user's active SCM roles (for SoD preview / UI prefill). */
export const rolesListForUserProcedure = protectedProcedure
  .input(z.object({ user_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const roles = await listUserScmRoles(input.user_id, ctx.user.hospital_id);
    return { user_id: input.user_id, hospital_id: ctx.user.hospital_id, roles };
  });

// ---------- Router ----------

export const scmRolesRouter = router({
  assign: rolesAssignProcedure,
  revoke: rolesRevokeProcedure,
  list: rolesListProcedure,
  listForUser: rolesListForUserProcedure,
});

// Re-export the role list for client-side validation parity
export { SCM_ROLES };
