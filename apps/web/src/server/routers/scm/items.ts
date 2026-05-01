import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';

// ============================================================
// SCM › ITEMS — universal item master (Phase 1.4 NEW router)
//
// CRUD over the canonical `items` table (63-scm-core.ts), the universal
// material/asset register that SUBSUMES drug_master, partial charge_master,
// and adds consumables / implants / reagents / linen / cssd_packs /
// equipment_spares / general.
//
// Lifecycle (Codes Q3 5-state machine + Q12 deprecation):
//   pending_clinical_review → pending_master_data_review →
//   pending_cms_gm_review → active → deprecated_grace → deprecated → archived
//   (or rejected at any pending step)
//
// Codes-FK gate (Codes Q3): every item should eventually have code_id;
// nullable in Phase 1 (codes table not yet shipped); becomes NOT NULL
// after Codes Phase 1 backfill.
//
// Server-side gate (Codes Q3): when codes table is live, charge_item
// writes are rejected if item.code is in non-active state. Enforced by
// Billing v3 procedures, NOT this router.
//
// Audit: every mutation → audit_logs. High-stakes (deprecate) → event_log
// after Codes Phase 1.
//
// Procedures exported as named consts for re-use in legacy router
// re-exports (Phase 1.4 Q2 Path C).
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Validation ----------

const itemKindEnum = z.enum([
  'drug',
  'consumable',
  'implant',
  'reagent',
  'linen',
  'cssd_pack',
  'equipment_spare',
  'general',
]);

const itemStatusEnum = z.enum([
  'pending_clinical_review',
  'pending_master_data_review',
  'pending_cms_gm_review',
  'active',
  'deprecated_grace',
  'deprecated',
  'archived',
  'rejected',
]);

export const itemCreateSchema = z.object({
  code: z.string().min(1),
  display_name: z.string().min(1),
  kind: itemKindEnum,

  storage_class: z.string().optional(),
  classification_code: z.string().optional(),

  generic_name: z.string().optional(),
  form: z.string().optional(),
  strength: z.string().optional(),
  brand: z.string().optional(),
  pack_size: z.string().optional(),

  unit_of_measure: z.string().min(1),

  hsn_code: z.string().optional(),
  gst_percentage: z.number().nonnegative().optional(),

  manufacturer: z.string().optional(),
  preferred_vendor_id: z.string().uuid().optional(),

  default_reorder_level: z.number().nonnegative().optional(),
  default_reorder_quantity: z.number().nonnegative().optional(),
  default_max_stock_level: z.number().nonnegative().optional(),
  auto_reorder_enabled: z.boolean().default(false),

  material_classification_id: z.string().uuid().optional(),
  handling_rules_apply: z.array(z.string()).optional(),
});

// ---------- Named procedure exports ----------

/** Create a new item. Defaults to pending_master_data_review per Codes Q3. */
export const itemCreateProcedure = protectedProcedure
  .input(itemCreateSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['item_master_steward']);
      const result = await getSql()(
        `INSERT INTO items (
          hospital_id, code, display_name, kind,
          storage_class, classification_code,
          generic_name, form, strength, brand, pack_size,
          unit_of_measure, hsn_code, gst_percentage,
          manufacturer, preferred_vendor_id,
          default_reorder_level, default_reorder_quantity,
          default_max_stock_level, auto_reorder_enabled,
          material_classification_id, handling_rules_apply,
          status, created_by
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14,
          $15, $16,
          $17, $18,
          $19, $20,
          $21, $22::jsonb,
          'pending_master_data_review', $23
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          input.code,
          input.display_name,
          input.kind,
          input.storage_class || null,
          input.classification_code || null,
          input.generic_name || null,
          input.form || null,
          input.strength || null,
          input.brand || null,
          input.pack_size || null,
          input.unit_of_measure,
          input.hsn_code || null,
          input.gst_percentage ?? null,
          input.manufacturer || null,
          input.preferred_vendor_id || null,
          input.default_reorder_level ?? null,
          input.default_reorder_quantity ?? null,
          input.default_max_stock_level ?? null,
          input.auto_reorder_enabled,
          input.material_classification_id || null,
          input.handling_rules_apply ? JSON.stringify(input.handling_rules_apply) : null,
          ctx.user.sub,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'items', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          result[0].id,
          JSON.stringify({ code: input.code, kind: input.kind, display_name: input.display_name }),
        ]
      );

      return result[0];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create item',
        cause: error,
      });
    }
  });

/** List items, filtered by kind / status / search / hospital. */
export const itemListProcedure = protectedProcedure
  .input(
    z.object({
      kind: itemKindEnum.optional(),
      status: itemStatusEnum.optional(),
      search: z.string().optional(),
      include_network: z.boolean().default(true),
      limit: z.number().int().positive().max(500).default(100),
      offset: z.number().int().nonnegative().default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      let where = `(hospital_id = $1${input.include_network ? ' OR hospital_id IS NULL' : ''})`;
      const params: any[] = [ctx.user.hospital_id];
      let p = 2;

      if (input.kind) {
        where += ` AND kind = $${p++}`;
        params.push(input.kind);
      }
      if (input.status) {
        where += ` AND status = $${p++}`;
        params.push(input.status);
      }
      if (input.search) {
        where += ` AND (display_name ILIKE $${p} OR code ILIKE $${p} OR generic_name ILIKE $${p})`;
        params.push(`%${input.search}%`);
        p++;
      }

      params.push(input.limit, input.offset);
      const rows = await getSql()(
        `SELECT * FROM items WHERE ${where} ORDER BY display_name LIMIT $${p++} OFFSET $${p++}`,
        params
      );
      return rows;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list items',
        cause: error,
      });
    }
  });

/** Get a single item by id. */
export const itemDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      const rows = await getSql()(
        `SELECT * FROM items
         WHERE id = $1 AND (hospital_id = $2 OR hospital_id IS NULL)`,
        [input, ctx.user.hospital_id]
      );
      if (!rows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }
      return rows[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch item',
        cause: error,
      });
    }
  });

/** Update mutable item fields. Status changes go through transitionStatus. */
export const itemUpdateProcedure = protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      ...itemCreateSchema.partial().shape,
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    if (!Object.keys(updates).length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'No updates provided' });
    }

    try {
      await assertHasScmRole(ctx, ['item_master_steward']);
      const setParts: string[] = [];
      const params: any[] = [id];
      let p = 2;
      for (const [k, v] of Object.entries(updates)) {
        if (k === 'handling_rules_apply') {
          setParts.push(`${k} = $${p++}::jsonb`);
          params.push(JSON.stringify(v));
        } else {
          setParts.push(`${k} = $${p++}`);
          params.push(v);
        }
      }
      setParts.push(`updated_by = $${p++}`);
      params.push(ctx.user.sub);
      setParts.push(`updated_at = NOW()`);

      params.push(ctx.user.hospital_id);
      const result = await getSql()(
        `UPDATE items SET ${setParts.join(', ')}
         WHERE id = $1 AND (hospital_id = $${p} OR hospital_id IS NULL)
         RETURNING *`,
        params
      );
      if (!result.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'items', $3, $4::jsonb, 'server', NOW())`,
        [ctx.user.hospital_id, ctx.user.sub, id, JSON.stringify(updates)]
      );

      return result[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update item',
        cause: error,
      });
    }
  });

/** Move an item through its lifecycle (Codes Q3 5-state machine). */
export const itemTransitionStatusProcedure = protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      to_status: itemStatusEnum,
      reason: z.string().optional(),
      urgency_tier: z.enum(['routine', 'urgent', 'emergency']).optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['item_master_steward']);
      const current = await getSql()(
        `SELECT id, status FROM items WHERE id = $1 AND (hospital_id = $2 OR hospital_id IS NULL)`,
        [input.id, ctx.user.hospital_id]
      );
      if (!current.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }

      const from = current[0].status as string;
      const to = input.to_status;

      const allowed: Record<string, string[]> = {
        pending_clinical_review: ['pending_master_data_review', 'rejected'],
        pending_master_data_review: ['pending_cms_gm_review', 'rejected'],
        pending_cms_gm_review: ['active', 'rejected'],
        active: ['deprecated_grace'],
        deprecated_grace: ['deprecated'],
        deprecated: ['archived'],
        archived: [],
        rejected: [],
      };
      if (!allowed[from]?.includes(to)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid transition: ${from} → ${to}`,
        });
      }

      if (to === 'deprecated_grace' && (!input.reason || !input.urgency_tier)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Deprecation requires reason and urgency_tier',
        });
      }

      const setParts = ['status = $2', 'updated_by = $3', 'updated_at = NOW()'];
      const params: any[] = [input.id, to, ctx.user.sub];
      let p = 4;
      if (to === 'deprecated_grace') {
        setParts.push(`deprecated_at = NOW()`);
        setParts.push(`deprecated_by = $${p++}`);
        params.push(ctx.user.sub);
        setParts.push(`deprecation_reason = $${p++}`);
        params.push(input.reason);
        setParts.push(`deprecation_urgency_tier = $${p++}`);
        params.push(input.urgency_tier);
      }

      const updated = await getSql()(
        `UPDATE items SET ${setParts.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'items', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.id,
          JSON.stringify({ status_transition: { from, to }, reason: input.reason, urgency_tier: input.urgency_tier }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to transition item status',
        cause: error,
      });
    }
  });

// ---------- Router ----------

export const scmItemsRouter = router({
  create: itemCreateProcedure,
  list: itemListProcedure,
  detail: itemDetailProcedure,
  update: itemUpdateProcedure,
  transitionStatus: itemTransitionStatusProcedure,
});
