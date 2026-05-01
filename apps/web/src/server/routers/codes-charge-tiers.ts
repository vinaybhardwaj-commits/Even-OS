import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';
import {
  CHARGE_TIER_CLASSES,
  CODE_CHARGE_RULE_TYPES,
  EMPANELMENT_TYPES,
} from '@db/schema';

// =============================================================================
// codes.chargeTiers + codes.empanelments — Phase 4 routers
// =============================================================================
// Read-mostly Phase 4a. Writes are super_admin-only and write to the
// effective-dating pattern (close existing tier with effective_to=NOW(),
// insert new row with effective_from=NOW()). Phase 4b adds the wider write
// surface alongside the tariff editor write UX.
// =============================================================================

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

function assertAdmin(ctx: { user: { role: string } }) {
  if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Codes Phase 4: only super_admin / hospital_admin may write charge tiers. Tariff edit role lands in Phase 4.B.',
    });
  }
}

// ─── chargeTiers.list — paginated browse ────────────────────────────────────

export const chargeTiersListProcedure = protectedProcedure
  .input(z.object({
    code_kind: z.enum(['item', 'service']).optional(),
    class_code: z.enum(CHARGE_TIER_CLASSES).optional(),
    empanelment_id: z.string().uuid().optional(),
    /** When true, includes historical (effective_to IS NOT NULL) rows. */
    include_history: z.boolean().default(false),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  }))
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    const params: any[] = [ctx.user.hospital_id];
    let where = 'hospital_id = $1';
    let p = 2;
    if (input.code_kind) { where += ` AND code_kind = $${p++}`; params.push(input.code_kind); }
    if (input.class_code) { where += ` AND class_code = $${p++}`; params.push(input.class_code); }
    if (input.empanelment_id) { where += ` AND empanelment_id = $${p++}`; params.push(input.empanelment_id); }
    if (!input.include_history) where += ` AND effective_to IS NULL`;
    params.push(input.limit, input.offset);
    return sql(
      `SELECT id, code_kind, item_id, service_id, class_code, empanelment_id,
              effective_from, effective_to, price_inr, is_open_billing,
              package_member_count, gst_percentage, source, created_at
         FROM code_charge_tiers
        WHERE ${where}
        ORDER BY effective_from DESC
        LIMIT $${p++} OFFSET $${p++}`,
      params,
    );
  });

// ─── chargeTiers.listForService — current tiers for one service ─────────────

export const chargeTiersListForServiceProcedure = protectedProcedure
  .input(z.object({
    service_id: z.string().uuid(),
    include_history: z.boolean().default(false),
  }))
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    if (input.include_history) {
      return (await sql`
        SELECT * FROM code_charge_tiers
         WHERE service_id = ${input.service_id}
           AND hospital_id = ${ctx.user.hospital_id}
        ORDER BY class_code, effective_from DESC
      `) as any[];
    }
    return (await sql`
      SELECT * FROM code_charge_tiers
       WHERE service_id = ${input.service_id}
         AND hospital_id = ${ctx.user.hospital_id}
         AND effective_to IS NULL
      ORDER BY class_code
    `) as any[];
  });

// ─── chargeTiers.listForItem ────────────────────────────────────────────────

export const chargeTiersListForItemProcedure = protectedProcedure
  .input(z.object({
    item_id: z.string().uuid(),
    include_history: z.boolean().default(false),
  }))
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    if (input.include_history) {
      return (await sql`
        SELECT * FROM code_charge_tiers
         WHERE item_id = ${input.item_id}
           AND hospital_id = ${ctx.user.hospital_id}
        ORDER BY class_code, effective_from DESC
      `) as any[];
    }
    return (await sql`
      SELECT * FROM code_charge_tiers
       WHERE item_id = ${input.item_id}
         AND hospital_id = ${ctx.user.hospital_id}
         AND effective_to IS NULL
      ORDER BY class_code
    `) as any[];
  });

// ─── chargeTiers.tierAt — historical-bill resolver ──────────────────────────

export const chargeTiersTierAtProcedure = protectedProcedure
  .input(z.object({
    service_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
    class_code: z.enum(CHARGE_TIER_CLASSES),
    at_date: z.string().datetime().optional(), // ISO datetime; defaults to NOW
    empanelment_id: z.string().uuid().nullable().optional(),
  }))
  .query(async ({ ctx, input }) => {
    if (!input.service_id && !input.item_id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'service_id or item_id required' });
    }
    const sql = getSql();
    const at = input.at_date ? new Date(input.at_date) : new Date();
    const empanelmentClause = input.empanelment_id
      ? `AND empanelment_id = '${input.empanelment_id}'`
      : `AND empanelment_id IS NULL`;
    const targetIdClause = input.service_id
      ? `AND service_id = $2`
      : `AND item_id = $2`;
    const targetId = input.service_id ?? input.item_id;
    const rows = (await sql(
      `SELECT * FROM code_charge_tiers
        WHERE hospital_id = $1
          ${targetIdClause}
          AND class_code = $3
          AND effective_from <= $4
          AND (effective_to IS NULL OR effective_to >= $4)
          ${empanelmentClause}
        ORDER BY effective_from DESC
        LIMIT 1`,
      [ctx.user.hospital_id, targetId, input.class_code, at.toISOString()],
    )) as any[];
    return rows[0] ?? null;
  });

// ─── chargeTiers.upsert (super_admin only; effective-dating writes) ─────────

const tierUpsertSchema = z.object({
  service_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  class_code: z.enum(CHARGE_TIER_CLASSES),
  empanelment_id: z.string().uuid().nullable().optional(),
  price_inr: z.number().nonnegative(),
  gst_percentage: z.number().nonnegative().default(0),
  is_open_billing: z.boolean().default(false),
  package_member_count: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});

export const chargeTiersUpsertProcedure = protectedProcedure
  .input(tierUpsertSchema)
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);
    if (!input.service_id && !input.item_id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'service_id or item_id required (exactly one)' });
    }
    if (input.service_id && input.item_id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provide exactly one of service_id / item_id, not both' });
    }
    const sql = getSql();

    // Close any existing current tier for this (target, class, empanelment)
    const targetIdClause = input.service_id ? `service_id = '${input.service_id}'` : `item_id = '${input.item_id}'`;
    const empClause = input.empanelment_id ? `empanelment_id = '${input.empanelment_id}'` : `empanelment_id IS NULL`;
    await sql(
      `UPDATE code_charge_tiers
          SET effective_to = NOW(), updated_at = NOW()
        WHERE hospital_id = $1
          AND ${targetIdClause}
          AND class_code = $2
          AND ${empClause}
          AND effective_to IS NULL`,
      [ctx.user.hospital_id, input.class_code],
    );

    // Insert new current tier
    const code_kind = input.service_id ? 'service' : 'item';
    const inserted = (await sql`
      INSERT INTO code_charge_tiers
        (hospital_id, item_id, service_id, code_kind, class_code,
         empanelment_id, price_inr, gst_percentage, is_open_billing,
         package_member_count, source, audit_user_id, notes)
      VALUES (
        ${ctx.user.hospital_id},
        ${input.item_id ?? null},
        ${input.service_id ?? null},
        ${code_kind},
        ${input.class_code},
        ${input.empanelment_id ?? null},
        ${input.price_inr.toFixed(2)},
        ${input.gst_percentage.toFixed(2)},
        ${input.is_open_billing},
        ${input.package_member_count},
        'manual',
        ${ctx.user.sub},
        ${input.notes ?? null}
      )
      RETURNING *
    `) as any[];
    return inserted[0];
  });

// ─── empanelments.* CRUD ────────────────────────────────────────────────────

const empanelmentCreateSchema = z.object({
  empanelment_name: z.string().min(1).max(200),
  empanelment_type: z.enum(EMPANELMENT_TYPES),
  agreement_number: z.string().optional(),
  effective_from: z.string().datetime().optional(),
  effective_to: z.string().datetime().optional(),
  contact_person: z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email().optional(),
  notes: z.string().optional(),
});

export const empanelmentsListProcedure = protectedProcedure
  .input(z.object({
    is_active: z.boolean().default(true),
    empanelment_type: z.enum(EMPANELMENT_TYPES).optional(),
  }).optional())
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    const activeFilter = (input?.is_active ?? true) ? 'AND is_active = TRUE' : '';
    if (input?.empanelment_type) {
      return (await sql(
        `SELECT * FROM code_charge_empanelments
          WHERE hospital_id = $1 AND empanelment_type = $2 ${activeFilter}
          ORDER BY empanelment_name`,
        [ctx.user.hospital_id, input.empanelment_type],
      )) as any[];
    }
    return (await sql(
      `SELECT * FROM code_charge_empanelments
        WHERE hospital_id = $1 ${activeFilter}
        ORDER BY empanelment_name`,
      [ctx.user.hospital_id],
    )) as any[];
  });

export const empanelmentsCreateProcedure = protectedProcedure
  .input(empanelmentCreateSchema)
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);
    const sql = getSql();
    const inserted = (await sql`
      INSERT INTO code_charge_empanelments
        (hospital_id, empanelment_name, empanelment_type, agreement_number,
         effective_from, effective_to, contact_person, contact_phone, contact_email,
         notes, created_by)
      VALUES (
        ${ctx.user.hospital_id}, ${input.empanelment_name}, ${input.empanelment_type},
        ${input.agreement_number ?? null},
        ${input.effective_from ? new Date(input.effective_from).toISOString() : new Date().toISOString()},
        ${input.effective_to ? new Date(input.effective_to).toISOString() : null},
        ${input.contact_person ?? null}, ${input.contact_phone ?? null}, ${input.contact_email ?? null},
        ${input.notes ?? null}, ${ctx.user.sub}
      )
      RETURNING *
    `) as any[];
    return inserted[0];
  });

// ─── rules.list (read-only — Phase 4 ships data; eval engine is BV3 P4) ─────

export const rulesListProcedure = protectedProcedure
  .input(z.object({
    rule_type: z.enum(CODE_CHARGE_RULE_TYPES).optional(),
    is_active: z.boolean().default(true),
  }).optional())
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    const activeFilter = (input?.is_active ?? true) ? 'AND is_active = TRUE' : '';
    if (input?.rule_type) {
      return (await sql(
        `SELECT * FROM code_charge_rules
          WHERE hospital_id = $1 AND rule_type = $2 ${activeFilter}
          ORDER BY priority, rule_name`,
        [ctx.user.hospital_id, input.rule_type],
      )) as any[];
    }
    return (await sql(
      `SELECT * FROM code_charge_rules
        WHERE hospital_id = $1 ${activeFilter}
        ORDER BY priority, rule_name`,
      [ctx.user.hospital_id],
    )) as any[];
  });

// ─── Composed routers ──────────────────────────────────────────────────────

export const codesChargeTiersRouter = router({
  list: chargeTiersListProcedure,
  listForService: chargeTiersListForServiceProcedure,
  listForItem: chargeTiersListForItemProcedure,
  tierAt: chargeTiersTierAtProcedure,
  upsert: chargeTiersUpsertProcedure,
});

export const codesEmpanelmentsRouter = router({
  list: empanelmentsListProcedure,
  create: empanelmentsCreateProcedure,
});

export const codesRulesRouter = router({
  list: rulesListProcedure,
});
