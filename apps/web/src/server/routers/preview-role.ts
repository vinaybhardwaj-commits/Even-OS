/**
 * PC.3.4 Track B — preview-as-role router.
 *
 * Lets a super_admin flip the server-side read path into "view as role X"
 * mode. The tRPC context builder in `server/trpc.ts` reads the cookie and
 * derives `ctx.effectiveUser`. All projection/redaction helpers (PC.3.3.D)
 * honour effectiveUser, so previewing as a pharmacist means the wire
 * payload for sensitive fields is actually redacted — identical to what
 * a real pharmacist sees, not just cosmetically hidden.
 *
 * Endpoints:
 *   - current()   — returns { active, preview, realRole }
 *   - set()       — super_admin only. Writes the cookie + admin_audit_log row.
 *   - clear()     — any authenticated user. Drops the cookie.
 *
 * Design notes:
 *   - The context builder already ignores preview cookies from non-super_admins,
 *     so setting a cookie as a lower role is inert. We still gate `set()` on
 *     super_admin for clarity + audit hygiene.
 *   - Every `set` writes an admin_audit_log row with action='preview_role.set'
 *     so matrix edits and preview sessions share an audit surface.
 *   - `clear()` is open to any role because if you somehow end up with a
 *     preview cookie you should always be able to drop it.
 */
import { z } from 'zod';
import { neon } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import {
  getPreviewRole,
  setPreviewRole,
  clearPreviewRole,
} from '@/lib/chart/preview-role';

const sql = neon(process.env.DATABASE_URL!);

const ALLOWED_PREVIEW_ROLES = [
  // Clinical
  'resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist',
  'consultant', 'senior_consultant', 'surgeon', 'anaesthetist',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'radiologist', 'senior_radiologist',
  // Nursing
  'nurse', 'senior_nurse', 'nursing_manager', 'ot_nurse',
  'charge_nurse', 'nursing_supervisor',
  // Pharmacy
  'pharmacist', 'senior_pharmacist', 'chief_pharmacist',
  // Lab
  'lab_technician', 'senior_lab_technician', 'lab_manager', 'radiology_technician',
  // CCE
  'ip_coordinator', 'receptionist',
  // Billing
  'billing_manager', 'billing_executive', 'insurance_coordinator',
  // Admin (self-check previews)
  'hospital_admin', 'operations_manager', 'department_head', 'medical_director',
];

export const previewRoleRouter = router({
  /** Get current preview state. Anyone authenticated can call. */
  current: protectedProcedure.query(async ({ ctx }) => {
    const preview = await getPreviewRole();
    const realRole = ctx.user.role;
    const active = Boolean(preview) && realRole === 'super_admin';
    return {
      active,
      preview: active ? preview : null,
      realRole,
    };
  }),

  /** Start previewing as another role. super_admin only. */
  set: adminProcedure
    .input(z.object({
      role: z.string().min(1),
      hospital_id: z.string().nullable().optional(),
      role_tag: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'super_admin') {
        // adminProcedure allows hospital_admin too; previewing is super_admin-only.
        throw new Error('Only super_admin may preview as another role');
      }
      if (!ALLOWED_PREVIEW_ROLES.includes(input.role)) {
        throw new Error(`Role "${input.role}" is not in the preview whitelist`);
      }
      const hospital = input.hospital_id ?? ctx.user.hospital_id;
      await setPreviewRole({
        role: input.role,
        role_tag: input.role_tag ?? null,
        hospital_id: hospital,
      });
      // Durable audit row — see PC.3.4.A admin_audit_log.
      await sql`
        INSERT INTO admin_audit_log
          (hospital_id, user_id, user_role, action, resource_type, resource_id, payload_summary)
        VALUES (
          ${ctx.user.hospital_id},
          ${ctx.user.sub ?? null}::uuid,
          ${ctx.user.role},
          'preview_role.set',
          'preview_role',
          NULL,
          ${JSON.stringify({
            role: input.role,
            role_tag: input.role_tag ?? null,
            hospital_id: hospital,
          })}::jsonb
        )
      `;
      return { ok: true };
    }),

  /** Exit preview mode. Any authenticated user may clear their own cookie. */
  clear: protectedProcedure.mutation(async ({ ctx }) => {
    const prev = await getPreviewRole();
    await clearPreviewRole();
    if (prev && ctx.user.role === 'super_admin') {
      await sql`
        INSERT INTO admin_audit_log
          (hospital_id, user_id, user_role, action, resource_type, resource_id, payload_summary)
        VALUES (
          ${ctx.user.hospital_id},
          ${ctx.user.sub ?? null}::uuid,
          ${ctx.user.role},
          'preview_role.clear',
          'preview_role',
          NULL,
          ${JSON.stringify({ cleared_role: prev.role })}::jsonb
        )
      `;
    }
    return { ok: true };
  }),
});
