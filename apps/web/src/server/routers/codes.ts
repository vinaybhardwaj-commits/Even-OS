import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';
import { bucketKey, buildDisplayName, validateForm, type CompositionInput } from '@/lib/codes/code-utils';
import { LOOKUP_KINDS, getLookupKindMeta } from '../../../drizzle/schema/66-codes';
import { codesApprovalsRouter } from './codes-approvals';
import { codesServicesRouter } from './codes-services';
import { codesChargeTiersRouter, codesEmpanelmentsRouter, codesRulesRouter } from './codes-charge-tiers';

// ============================================================
// CODES MODULE — Phase 1 (Cannibalize CodeCreator)
//
// Ports CodeCreator's REST surface to Even OS-native tRPC procedures:
//   - codes.items.create / detail / search
//   - codes.lookups.list / create / update
//   - codes.buckets.peek
//   - codes.badCodes.list / update
//
// Schema lives in drizzle/schema/66-codes.ts (mirrors CodeCreator's
// inventory_* tables; rows already populated in production).
//
// SoD authority (Phase 2 of Codes adds the formal approval workflow with
// pharmacy_supervisor + master_data_officer roles): for now, super_admin /
// hospital_admin gate all writes. PRD Phase 2 adds role-routing.
//
// Audit: every mutation writes audit_logs (matches existing convention).
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

function assertAdmin(ctx: { user: { role: string } }) {
  if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Codes Phase 1: only super_admin / hospital_admin may write. Phase 2 adds master_data_officer + pharmacy_supervisor roles.',
    });
  }
}

// ============================================================
// ITEMS — codes.items.{create, detail, search, list}
// ============================================================

const compositionInputSchema = z.object({
  generic_name: z.string(),
  strength_value: z.string(),
  strength_unit: z.string(),
});

export const itemCreateSchema = z.object({
  item_type: z.string().min(1),
  category: z.string().min(1),
  storage: z.string().min(1),
  classification: z.string().min(1),
  compositions: z.array(compositionInputSchema).min(1),
  form: z.string().min(1),
  brand: z.string().min(1),
  pack_size: z.string().min(1),
  item_name: z.string().optional(),
  manufacturer: z.string().optional(),
  hsn_code: z.string().optional(),
  tax_detail: z.string().optional(),
  price_type: z.string().optional(),
  issue_unit: z.string().optional(),
  conversion: z.number().optional(),
  purchase_unit: z.string().optional(),
  close_for_sale: z.string().optional(),
  item_category: z.string().optional(),
  item_sub_category: z.string().optional(),
});

export const codesItemsCreateProcedure = protectedProcedure
  .input(itemCreateSchema)
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);

    // Normalize input
    const normalized = {
      item_type: input.item_type.trim(),
      category: input.category.trim().toUpperCase(),
      storage: input.storage.trim().toUpperCase(),
      classification: input.classification.trim().toUpperCase(),
      compositions: input.compositions.map((c) => ({
        generic_name: c.generic_name.trim(),
        strength_value: c.strength_value.trim(),
        strength_unit: c.strength_unit.trim(),
      })),
      form: input.form.trim(),
      brand: input.brand.trim(),
      pack_size: input.pack_size.trim(),
      item_name: input.item_name?.trim() || null,
      manufacturer: input.manufacturer?.trim() || null,
      hsn_code: input.hsn_code?.trim() || null,
      tax_detail: input.tax_detail?.trim() || null,
      price_type: input.price_type?.trim() || 'mrp',
      issue_unit: input.issue_unit?.trim() || null,
      conversion: input.conversion ?? null,
      purchase_unit: input.purchase_unit?.trim() || null,
      close_for_sale: input.close_for_sale?.trim() || 'N',
      item_category: input.item_category?.trim() || null,
      item_sub_category: input.item_sub_category?.trim() || null,
    };

    // Form validation (mirrored client-side too)
    const v = validateForm(normalized);
    if (!v.ok) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Validation failed: ${JSON.stringify(v.errors)}` });
    }

    const sql = getSql();
    const bucket = bucketKey({
      category: normalized.category,
      storage: normalized.storage,
      classification: normalized.classification,
    });

    // Lookups defense-in-depth: confirm bucket triple + item_type are known + active
    const lookupCheck = (await sql`
      SELECT
        (SELECT count(*)::int FROM inventory_lookup_categories WHERE code = ${normalized.category} AND is_active) AS cat_ok,
        (SELECT count(*)::int FROM inventory_lookup_storage_codes WHERE code = ${normalized.storage} AND is_active) AS sto_ok,
        (SELECT count(*)::int FROM inventory_lookup_classification_codes WHERE code = ${normalized.classification} AND is_active) AS cls_ok,
        (SELECT count(*)::int FROM inventory_lookup_item_types WHERE code = ${normalized.item_type} AND is_active) AS type_ok
    `) as Array<{ cat_ok: number; sto_ok: number; cls_ok: number; type_ok: number }>;
    const lc = lookupCheck[0];
    if (!lc || lc.cat_ok === 0 || lc.sto_ok === 0 || lc.cls_ok === 0 || lc.type_ok === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown lookup: category=${lc?.cat_ok}, storage=${lc?.sto_ok}, classification=${lc?.cls_ok}, item_type=${lc?.type_ok}`,
      });
    }

    const displayName = buildDisplayName({
      compositions: normalized.compositions,
      form: normalized.form,
      brand: normalized.brand,
      pack_size: normalized.pack_size,
    });
    const itemName = normalized.item_name ?? displayName;
    const compsForChain = normalized.compositions.filter((cm) => cm.generic_name !== '');
    const generic_name_chain = compsForChain.map((cm) => cm.generic_name).join('+');
    const strength_chain = compsForChain
      .map((cm) => (cm.strength_unit ? `${cm.strength_value}${cm.strength_unit}` : cm.strength_value))
      .join('+');
    const strength_unit = compsForChain[0]?.strength_unit ?? null;
    const packSize = parseInt(normalized.pack_size, 10);

    // First-use detection (drives soft warning in UI)
    const counterRow = (await sql`
      SELECT last_serial FROM inventory_serial_counters WHERE bucket = ${bucket}
    `) as Array<{ last_serial: number }>;
    const firstUseOfBucket = counterRow.length === 0;

    // Pre-flight duplicate display-name check
    const dupCheck = (await sql`
      SELECT id, item_code, item_display_name
        FROM inventory_items
        WHERE lower(item_display_name) = lower(${displayName})
        LIMIT 1
    `) as Array<{ id: string; item_code: string; item_display_name: string }>;
    if (dupCheck.length > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Duplicate display_name. Existing item: ${dupCheck[0].item_code}`,
      });
    }

    // Atomic chained-CTE: serial UPSERT + items INSERT + compositions INSERT
    const genericArr = compsForChain.map((cm) => cm.generic_name);
    const strengthValueArr = compsForChain.map((cm) => parseFloat(cm.strength_value));
    const strengthUnitArr = compsForChain.map((cm) => cm.strength_unit);
    const positionArr = compsForChain.map((_, i) => i + 1);

    let itemRow: { id: string; item_code: string; item_display_name: string; serial: number };
    try {
      const result = (await sql`
        WITH next_serial AS (
          INSERT INTO inventory_serial_counters (bucket, last_serial)
          VALUES (${bucket}, 1)
          ON CONFLICT (bucket) DO UPDATE
            SET last_serial = inventory_serial_counters.last_serial + 1,
                updated_at = now()
          RETURNING last_serial
        ),
        new_item AS (
          INSERT INTO inventory_items (
            item_code, category_code, storage_code, classification_code, serial,
            item_type, item_display_name, item_name,
            generic_name_chain, form, strength_chain, strength_unit, brand, pack_size,
            manufacturer, hsn_code, tax_detail, price_type,
            issue_unit, conversion, purchase_unit, close_for_sale,
            item_category, item_sub_category, source, status
          )
          SELECT
            ${normalized.category} || '-' || ${normalized.storage} || '-' || ${normalized.classification} || '-' || lpad(ns.last_serial::text, 5, '0'),
            ${normalized.category}, ${normalized.storage}, ${normalized.classification}, ns.last_serial,
            ${normalized.item_type}, ${displayName}, ${itemName},
            ${generic_name_chain}, ${normalized.form}, ${strength_chain}, ${strength_unit},
            ${normalized.brand}, ${packSize},
            ${normalized.manufacturer}, ${normalized.hsn_code}, ${normalized.tax_detail}, ${normalized.price_type},
            ${normalized.issue_unit}, ${normalized.conversion}, ${normalized.purchase_unit}, ${normalized.close_for_sale},
            ${normalized.item_category}, ${normalized.item_sub_category}, 'codecreator',
            -- Phase 2 gating: every new code starts in 'draft' state. The
            -- creator (or a peer) must call codes.approvals.submit to advance
            -- it through the routing chain. SOP §5.6 enforced; no super_admin
            -- bypass per A2.
            'draft'
          FROM next_serial ns
          RETURNING id, item_code, item_display_name, serial, status
        ),
        _comps AS (
          INSERT INTO inventory_compositions (item_id, generic_name, strength_value, strength_unit, position)
          SELECT new_item.id, c.generic_name, c.strength_value, c.strength_unit, c.position
          FROM new_item
          CROSS JOIN unnest(
            ${genericArr}::text[],
            ${strengthValueArr}::numeric[],
            ${strengthUnitArr}::text[],
            ${positionArr}::int[]
          ) AS c(generic_name, strength_value, strength_unit, position)
          RETURNING 1
        )
        SELECT id, item_code, item_display_name, serial FROM new_item
      `) as Array<{ id: string; item_code: string; item_display_name: string; serial: number }>;

      if (!Array.isArray(result) || result.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Insert returned 0 rows' });
      }
      itemRow = result[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('inventory_items_display_name_lower_uq')) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Race: duplicate display_name detected at insert time' });
      }
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Insert failed', cause: err });
    }

    // Audit (NB: inventory_items lacks hospital_id; CodeCreator schema is global.
    // Phase 6 may introduce per-hospital overrides — for now the audit row
    // uses the actor's hospital_id as the audit-domain marker.)
    await sql(
      `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
       VALUES ($1, $2, 'INSERT', 'inventory_items', $3, $4::jsonb, 'server', NOW())`,
      [
        ctx.user.hospital_id,
        ctx.user.sub,
        itemRow.id,
        JSON.stringify({ item_code: itemRow.item_code, display_name: itemRow.item_display_name, bucket, serial: itemRow.serial }),
      ]
    );

    return { item: itemRow, first_use_of_bucket: firstUseOfBucket };
  });

export const codesItemsDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ input }) => {
    const sql = getSql();
    const itemRows = (await sql`
      SELECT * FROM inventory_items WHERE id = ${input} LIMIT 1
    `) as Array<Record<string, unknown>>;
    if (itemRows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
    }
    const compRows = (await sql`
      SELECT id, generic_name, strength_value, strength_unit, position
        FROM inventory_compositions
        WHERE item_id = ${input}
        ORDER BY position
    `) as Array<Record<string, unknown>>;
    return { item: itemRows[0], compositions: compRows };
  });

export const codesItemsSearchProcedure = protectedProcedure
  .input(z.object({
    q: z.string(),
    limit: z.number().int().positive().max(50).default(10),
    /**
     * Phase 2 — default to active-only. Caregiver surfaces (CPOE, dispense,
     * order entry) want this. Admin / approval surfaces pass include_drafts=true
     * to see codes still in the workflow.
     */
    include_drafts: z.boolean().default(false),
  }))
  .query(async ({ input }) => {
    const q = input.q.trim();
    if (q.length < 2) return { results: [], q };
    const pat = `%${q}%`;
    const sql = getSql();
    // Phase 2 gate: if include_drafts is false (default), only return active.
    // We pass the flag as a regular parameter and OR-it into the WHERE; this
    // keeps the query a single tagged-template literal (no sql.unsafe) and
    // lets Postgres optimize via the idx_inventory_items_status partial index.
    const includeDrafts = input.include_drafts;
    const rows = (await sql`
      SELECT id, item_code, item_display_name, item_type, source, brand, manufacturer, status
      FROM inventory_items
      WHERE
        (item_code           ILIKE ${pat}
         OR item_display_name  ILIKE ${pat}
         OR item_name          ILIKE ${pat}
         OR generic_name_chain ILIKE ${pat}
         OR brand              ILIKE ${pat}
         OR manufacturer       ILIKE ${pat})
        AND (${includeDrafts}::boolean OR status = 'active')
      ORDER BY
        CASE
          WHEN item_code ILIKE ${pat}            THEN 1
          WHEN item_display_name ILIKE ${pat}    THEN 2
          WHEN brand ILIKE ${pat}                THEN 3
          WHEN generic_name_chain ILIKE ${pat}   THEN 4
          ELSE 5
        END,
        length(item_display_name)
      LIMIT ${input.limit}
    `) as any[];
    return { results: rows, q };
  });

export const codesItemsListProcedure = protectedProcedure
  .input(z.object({
    bucket: z.string().optional(),
    item_type: z.string().optional(),
    source: z.string().optional(),
    /** Phase 2 filter — defaults to ['active'] for caregiver-safe browse. Pass [] for all. */
    status: z.array(z.string()).optional(),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  }))
  .query(async ({ input }) => {
    const sql = getSql();
    let where = '1=1';
    const params: any[] = [];
    let p = 1;

    if (input.bucket) {
      const parts = input.bucket.split('-');
      if (parts.length === 3) {
        where += ` AND category_code = $${p++} AND storage_code = $${p++} AND classification_code = $${p++}`;
        params.push(parts[0], parts[1], parts[2]);
      }
    }
    if (input.item_type) { where += ` AND item_type = $${p++}`; params.push(input.item_type); }
    if (input.source) { where += ` AND source = $${p++}`; params.push(input.source); }
    // Phase 2 default: filter to active. Passing status=[] explicitly returns all states.
    const effectiveStatus = input.status === undefined ? ['active'] : input.status;
    if (effectiveStatus.length > 0) {
      where += ` AND status = ANY($${p++}::text[])`;
      params.push(effectiveStatus);
    }

    params.push(input.limit, input.offset);
    return sql(
      `SELECT id, item_code, item_display_name, item_type, brand, manufacturer, source, status, created_at
       FROM inventory_items
       WHERE ${where}
       ORDER BY item_code ASC
       LIMIT $${p++} OFFSET $${p++}`,
      params
    );
  });

// ============================================================
// LOOKUPS — codes.lookups.{list, create, update}
// ============================================================

export const codesLookupsListProcedure = protectedProcedure
  .query(async () => {
    const sql = getSql();
    const all = (await sql`
      SELECT 'categories' AS kind, code, label, description, sort_order
        FROM inventory_lookup_categories WHERE is_active
      UNION ALL
      SELECT 'storage_codes', code, label, description, sort_order
        FROM inventory_lookup_storage_codes WHERE is_active
      UNION ALL
      SELECT 'classification_codes', code, label, description, sort_order
        FROM inventory_lookup_classification_codes WHERE is_active
      UNION ALL
      SELECT 'item_types', code, label, NULL::text, sort_order
        FROM inventory_lookup_item_types WHERE is_active
      UNION ALL
      SELECT 'forms', code, label, NULL::text, sort_order
        FROM inventory_lookup_forms WHERE is_active
      UNION ALL
      SELECT 'strength_units', code, label, NULL::text, sort_order
        FROM inventory_lookup_strength_units WHERE is_active
      UNION ALL
      SELECT 'issue_units', code, label, NULL::text, sort_order
        FROM inventory_lookup_issue_units WHERE is_active
      ORDER BY kind, sort_order
    `) as Array<{ kind: string; code: string; label: string; description: string | null; sort_order: number }>;

    const grouped: Record<string, Array<{ code: string; label: string; description: string | null }>> = {
      categories: [], storage_codes: [], classification_codes: [],
      item_types: [], forms: [], strength_units: [], issue_units: [],
    };
    for (const r of all) {
      if (grouped[r.kind]) grouped[r.kind].push({ code: r.code, label: r.label, description: r.description });
    }

    const mfgs = (await sql`
      SELECT DISTINCT manufacturer
        FROM inventory_items
        WHERE manufacturer IS NOT NULL AND manufacturer <> ''
        ORDER BY manufacturer
        LIMIT 500
    `) as Array<{ manufacturer: string }>;

    return { ...grouped, manufacturers: mfgs.map((m) => m.manufacturer) };
  });

export const codesLookupsCreateProcedure = protectedProcedure
  .input(z.object({
    kind: z.string(),
    code: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    sort_order: z.number().int().nonnegative().default(0),
  }))
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);
    const meta = getLookupKindMeta(input.kind);
    if (!meta) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown lookup kind' });
    if (!meta.codePattern.test(input.code)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Code must match ${meta.codePattern}` });
    }

    const sql = getSql();
    const dup = (await sql(`SELECT 1 FROM ${meta.table} WHERE code = $1 LIMIT 1`, [input.code])) as any[];
    if (dup.length > 0) {
      throw new TRPCError({ code: 'CONFLICT', message: `Code ${input.code} already exists in ${meta.kind}` });
    }

    let row: any;
    if (meta.hasDescription) {
      const r = (await sql(
        `INSERT INTO ${meta.table} (code, label, description, sort_order) VALUES ($1, $2, $3, $4)
         RETURNING code, label, description, is_active, sort_order`,
        [input.code, input.label, input.description ?? null, input.sort_order]
      )) as any[];
      row = r[0];
    } else {
      const r = (await sql(
        `INSERT INTO ${meta.table} (code, label, sort_order) VALUES ($1, $2, $3)
         RETURNING code, label, is_active, sort_order`,
        [input.code, input.label, input.sort_order]
      )) as any[];
      row = r[0];
    }

    await sql(
      `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
       VALUES ($1, $2, 'INSERT', $3, $4, $5::jsonb, 'server', NOW())`,
      [ctx.user.hospital_id, ctx.user.sub, meta.table, input.code, JSON.stringify(row)]
    );

    return row;
  });

export const codesLookupsUpdateProcedure = protectedProcedure
  .input(z.object({
    kind: z.string(),
    code: z.string().min(1),
    label: z.string().optional(),
    description: z.string().optional().nullable(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);
    const meta = getLookupKindMeta(input.kind);
    if (!meta) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown lookup kind' });

    const sets: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (input.label !== undefined) { sets.push(`label = $${p++}`); params.push(input.label.trim()); }
    if (input.description !== undefined && meta.hasDescription) {
      sets.push(`description = $${p++}`);
      params.push(input.description ? input.description.trim() : null);
    }
    if (input.is_active !== undefined) { sets.push(`is_active = $${p++}`); params.push(input.is_active); }
    if (input.sort_order !== undefined) { sets.push(`sort_order = $${p++}`); params.push(input.sort_order); }

    if (sets.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });

    sets.push(`updated_at = now()`);
    params.push(input.code);

    const sql = getSql();
    const rows = (await sql(
      `UPDATE ${meta.table} SET ${sets.join(', ')} WHERE code = $${p}
       RETURNING code, label, ${meta.hasDescription ? 'description, ' : ''}is_active, sort_order`,
      params
    )) as any[];
    if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Code not found' });

    await sql(
      `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
       VALUES ($1, $2, 'UPDATE', $3, $4, $5::jsonb, 'server', NOW())`,
      [ctx.user.hospital_id, ctx.user.sub, meta.table, input.code, JSON.stringify(rows[0])]
    );

    return rows[0];
  });

// ============================================================
// BUCKETS — codes.buckets.{peek}
// ============================================================

export const codesBucketsPeekProcedure = protectedProcedure
  .input(z.string().regex(/^[A-Z]-[A-Z]-[A-Z]{2}$/, 'Bucket format: X-X-XX'))
  .query(async ({ input }) => {
    const sql = getSql();
    const rows = (await sql`
      SELECT last_serial FROM inventory_serial_counters WHERE bucket = ${input}
    `) as Array<{ last_serial: number }>;
    if (rows.length === 0) {
      return { bucket: input, next_serial: 1, first_use: true };
    }
    return { bucket: input, next_serial: rows[0].last_serial + 1, first_use: false };
  });

export const codesBucketsListProcedure = protectedProcedure
  .query(async () => {
    const sql = getSql();
    return sql`
      SELECT bucket, last_serial, updated_at
      FROM inventory_serial_counters
      ORDER BY last_serial DESC
    ` as any;
  });

// ============================================================
// BAD CODES — codes.badCodes.{list, update}
// ============================================================

export const codesBadCodesListProcedure = protectedProcedure
  .input(z.object({
    reason: z.string().optional(),
    status: z.string().default('open'),
  }))
  .query(async ({ input }) => {
    const sql = getSql();
    const groups = (await sql`
      SELECT flag_reason AS reason, count(*)::int AS count
        FROM inventory_bad_codes_review
        WHERE status = ${input.status}
        GROUP BY flag_reason
        ORDER BY count DESC, flag_reason
    `) as Array<{ reason: string; count: number }>;

    let rows: any[];
    if (input.reason) {
      rows = (await sql`
        SELECT id, original_item_code, flag_reason, flag_detail, notes, status, imported_at, original_row_data
          FROM inventory_bad_codes_review
          WHERE status = ${input.status} AND flag_reason = ${input.reason}
          ORDER BY imported_at DESC, id
      `) as any[];
    } else {
      rows = (await sql`
        SELECT id, original_item_code, flag_reason, flag_detail, notes, status, imported_at, original_row_data
          FROM inventory_bad_codes_review
          WHERE status = ${input.status}
          ORDER BY flag_reason, imported_at DESC, id
      `) as any[];
    }

    return { groups, rows };
  });

export const codesBadCodesUpdateProcedure = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    status: z.enum(['open', 'ignored', 'fixed']),
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);
    const sql = getSql();
    const rows = (await sql`
      UPDATE inventory_bad_codes_review
      SET status = ${input.status},
          notes = COALESCE(${input.notes ?? null}, notes)
      WHERE id = ${input.id}
      RETURNING *
    `) as any[];
    if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bad-code row not found' });

    await sql(
      `INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address, created_at)
       VALUES ($1, $2, 'UPDATE', 'inventory_bad_codes_review', $3, $4::jsonb, 'server', NOW())`,
      [ctx.user.hospital_id, ctx.user.sub, input.id, JSON.stringify({ status: input.status, notes: input.notes })]
    );

    return rows[0];
  });

// ============================================================
// ROUTER
// ============================================================

export const codesRouter = router({
  items: router({
    create: codesItemsCreateProcedure,
    detail: codesItemsDetailProcedure,
    search: codesItemsSearchProcedure,
    list: codesItemsListProcedure,
  }),
  lookups: router({
    list: codesLookupsListProcedure,
    create: codesLookupsCreateProcedure,
    update: codesLookupsUpdateProcedure,
  }),
  buckets: router({
    peek: codesBucketsPeekProcedure,
    list: codesBucketsListProcedure,
  }),
  badCodes: router({
    list: codesBadCodesListProcedure,
    update: codesBadCodesUpdateProcedure,
  }),
  // Phase 2 — approval workflow router (sub-routes: submit, mdoApprove,
  // clinicalApprove, reject, resubmit, listForStage, listMyHistory, getDetail,
  // assignRole, revokeRole, listRoles, listMyRoles, bootstrapHistorical).
  approvals: codesApprovalsRouter,
  // Phase 3 — service code catalog router (create, detail, list, search,
  // lookups for types/departments/subdepartments).
  services: codesServicesRouter,
  // Phase 4 — unified charge tiers (replaces 7 legacy charge_master_* tables;
  // shadow-deployed alongside legacy until Pharmacy refactor catalyzes write-switch).
  chargeTiers: codesChargeTiersRouter,
  // Phase 4 — corporate / TPA / insurance empanelment master.
  empanelments: codesEmpanelmentsRouter,
  // Phase 4 — Billing Manual rule engine (read-only data; eval engine ships in BV3 Phase 4).
  rules: codesRulesRouter,
});
