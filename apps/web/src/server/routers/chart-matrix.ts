/**
 * Chart Matrix Router — PC.3.3.C.
 *
 * Super-admin CRUD surface for `chart_permission_matrix` rows — the live
 * source of truth for per-role Patient Chart configuration:
 *   - tabs (which of the 14 chart tabs to render)
 *   - overview_layout (ordered overview-card ids)
 *   - action_bar_preset { primary: string[], secondary: string[] }
 *   - sensitive_fields (names to run through SensitiveText)
 *   - allowed_write_actions (write-permission gate for future SC.* routing)
 *   - description (admin-facing notes)
 *
 * Listing + update only. Insert is reserved for the migration endpoint
 * (/api/migrations/chart-role-model) — admins can't create new rows
 * because each (role, role_tag, hospital_id) tuple is already seeded and
 * the UNIQUE index enforces it.
 *
 * Plus: a small audit replay window (chart_audit_log + chart_view_audit)
 * scoped to a specific role so admins can see recent activity against a
 * preset without jumping apps.
 *
 * All endpoints are role-gated on super_admin via withSuperAdmin().
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

type UserLike = { role?: string | null };
function requireSuperAdmin(user: UserLike) {
  if (user.role !== 'super_admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only super_admin may view or edit the chart permission matrix.',
    });
  }
}

type MatrixRow = {
  id: string;
  role: string;
  role_tag: string | null;
  hospital_id: string;
  tabs: string[];
  overview_layout: unknown;
  action_bar_preset: unknown;
  sensitive_fields: string[];
  allowed_write_actions: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
};

// Action-bar-preset shape. Keep lenient on decode — older rows may be
// missing `secondary`; new rows always have both.
const actionBarSchema = z.object({
  primary: z.array(z.string().min(1).max(64)).max(20),
  secondary: z.array(z.string().min(1).max(64)).max(20).default([]),
});

// 14 known chart tabs (matches PC.3.2.1 filter + chart-shell tabs array).
const KNOWN_TAB_IDS = [
  'overview', 'vitals', 'labs', 'orders', 'notes', 'plan', 'emar',
  'assessments', 'billing', 'journey', 'brief', 'calculators',
  'documents', 'forms',
] as const;

export const chartMatrixRouter = router({
  // ─── LIST ALL ROWS ──────────────────────────────────────────
  list: protectedProcedure.query(async ({ ctx }) => {
    requireSuperAdmin(ctx.user);
    const sql = getSql();
    const rows = (await sql`
      SELECT id, role, role_tag, hospital_id, tabs,
             overview_layout, action_bar_preset, sensitive_fields,
             allowed_write_actions, description,
             created_at, updated_at
      FROM chart_permission_matrix
      ORDER BY hospital_id ASC, role ASC
    `) as MatrixRow[];
    return { rows, knownTabIds: KNOWN_TAB_IDS as readonly string[] };
  }),

  // ─── GET ONE ────────────────────────────────────────────────
  getOne: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.user);
      const sql = getSql();
      const rows = (await sql`
        SELECT id, role, role_tag, hospital_id, tabs,
               overview_layout, action_bar_preset, sensitive_fields,
               allowed_write_actions, description,
               created_at, updated_at
        FROM chart_permission_matrix
        WHERE id = ${input.id}
        LIMIT 1
      `) as MatrixRow[];
      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix row not found.' });
      }
      return rows[0];
    }),

  // ─── UPDATE ONE ─────────────────────────────────────────────
  // Partial updates supported. Any missing field is left untouched.
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      tabs: z.array(z.string().min(1).max(40)).max(40).optional(),
      overview_layout: z.array(z.string().min(1).max(64)).max(40).optional(),
      action_bar_preset: actionBarSchema.optional(),
      sensitive_fields: z.array(z.string().min(1).max(80)).max(40).optional(),
      allowed_write_actions: z.array(z.string().min(1).max(80)).max(60).optional(),
      description: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.user);
      const sql = getSql();

      // Pull the current row so we can merge unchanged fields.
      const existingRows = (await sql`
        SELECT id, role, role_tag, hospital_id, tabs,
               overview_layout, action_bar_preset, sensitive_fields,
               allowed_write_actions, description
        FROM chart_permission_matrix
        WHERE id = ${input.id}
        LIMIT 1
      `) as MatrixRow[];
      const prev = existingRows[0];
      if (!prev) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix row not found.' });
      }

      const nextTabs = input.tabs ?? prev.tabs;
      const nextOverview = input.overview_layout ?? prev.overview_layout;
      const nextActionBar = input.action_bar_preset ?? (prev.action_bar_preset as unknown);
      const nextSensitive = input.sensitive_fields ?? prev.sensitive_fields;
      const nextAllowed = input.allowed_write_actions ?? prev.allowed_write_actions;
      const nextDescription =
        input.description === undefined ? prev.description : input.description;

      // Unknown-tab guard — don't allow tabs not in the known set.
      for (const t of nextTabs) {
        if (!(KNOWN_TAB_IDS as readonly string[]).includes(t)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown tab id: ${t}. Known: ${KNOWN_TAB_IDS.join(', ')}.`,
          });
        }
      }

      const updated = (await sql`
        UPDATE chart_permission_matrix
           SET tabs                 = ${nextTabs}::text[],
               overview_layout      = ${JSON.stringify(nextOverview)}::jsonb,
               action_bar_preset    = ${JSON.stringify(nextActionBar)}::jsonb,
               sensitive_fields     = ${nextSensitive}::text[],
               allowed_write_actions= ${nextAllowed}::text[],
               description          = ${nextDescription},
               updated_at           = now()
         WHERE id = ${input.id}
        RETURNING id, role, role_tag, hospital_id, tabs,
                  overview_layout, action_bar_preset, sensitive_fields,
                  allowed_write_actions, description,
                  created_at, updated_at
      `) as MatrixRow[];

      // Write a single admin-audit row so the surface is self-documenting.
      try {
        await sql`
          INSERT INTO chart_audit_log
            (patient_id, encounter_id, hospital_id, user_id, user_role,
             action, resource_type, resource_id, payload_summary)
          SELECT
            '00000000-0000-0000-0000-000000000000'::uuid,
            NULL,
            ${prev.hospital_id},
            ${ctx.user.sub ?? null}::uuid,
            ${ctx.user.role ?? 'unknown'},
            'chart_matrix.update',
            'chart_permission_matrix',
            ${prev.id}::uuid,
            ${JSON.stringify({
              role: prev.role,
              role_tag: prev.role_tag,
              hospital_id: prev.hospital_id,
              changed_keys: Object.keys(input).filter((k) => k !== 'id'),
            })}::jsonb
          WHERE EXISTS (SELECT 1 FROM patients WHERE id = '00000000-0000-0000-0000-000000000000'::uuid)
        `;
      } catch {
        // chart_audit_log has a patient_id FK; if the placeholder patient row
        // doesn't exist we silently skip the audit row rather than fail the
        // update itself. The update is the authoritative write.
      }

      return updated[0]!;
    }),

  // ─── AUDIT REPLAY ───────────────────────────────────────────
  // Returns the N most recent chart_view_audit + chart_audit_log rows for
  // a given role, across every patient. Used by the admin UI "Activity"
  // panel — the surface should never need a date picker for the MVP.
  recentActivity: protectedProcedure
    .input(z.object({
      role: z.string().min(1).max(40),
      limit: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.user);
      const sql = getSql();

      const views = (await sql`
        SELECT id, patient_id, hospital_id, user_id, user_role,
               field_name, tab_id, access_reason, created_at
        FROM chart_view_audit
        WHERE user_role = ${input.role}
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `) as Array<{
        id: string; patient_id: string; hospital_id: string;
        user_id: string | null; user_role: string;
        field_name: string; tab_id: string | null;
        access_reason: string | null; created_at: string;
      }>;

      const edits = (await sql`
        SELECT id, patient_id, encounter_id, hospital_id, user_id, user_role,
               action, resource_type, resource_id, payload_summary, created_at
        FROM chart_audit_log
        WHERE user_role = ${input.role}
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `) as Array<{
        id: string; patient_id: string; encounter_id: string | null;
        hospital_id: string; user_id: string | null; user_role: string;
        action: string; resource_type: string; resource_id: string | null;
        payload_summary: unknown; created_at: string;
      }>;

      return { views, edits };
    }),
});
