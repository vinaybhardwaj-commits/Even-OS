import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  chargeMasterItem,
  chargeMasterPrice,
  chargeMasterPackage,
  chargeMasterRoom,
  chargeMasterHospitalSetting,
  chargeMasterTariffImport,
  discountPolicy,
  billingCharge,
  billingAccountPayer,
} from '@db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

// =============================================================================
// Billing v3 — read-mostly tRPC surface (Phase 1)
// =============================================================================
// First-pass router that exposes the BV3.1 foundation tables to admin / chart
// surfaces. Mutations are deferred to Phase 4 (bill builder) and Phase 7
// (refund / adjustment).
//
// Procedures:
//   billingV3.bootstrap.status    — table-presence check + per-table EHRC counts
//   billingV3.items.list          — charge_master_item with filters
//   billingV3.items.detail        — single item with active prices joined
//   billingV3.rooms.list          — charge_master_room (9 row class tariffs)
//   billingV3.packages.list       — charge_master_package
//   billingV3.discountPolicies.list — discount_policy (CFO surface)
//   billingV3.hospitalSetting.get — single hospital setting row
//   billingV3.charges.list        — billing_charge ledger with filters
//   billingV3.tariffImports.list  — charge_master_tariff_import audit log
// =============================================================================

const ALL_TABLES = [
  'charge_master_item',
  'charge_master_price',
  'charge_master_package',
  'charge_master_room',
  'charge_master_tariff_import',
  'charge_master_hospital_setting',
  'discount_policy',
  'discount_application',
  'billing_charge',
  'billing_account_payer',
] as const;

// ─── bootstrap.status ────────────────────────────────────────────────────────
export const billingV3BootstrapStatusProcedure = protectedProcedure.query(async ({ ctx }) => {
  const hospitalId = ctx.user.hospital_id;

  // 1. Table existence
  const present = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${[...ALL_TABLES]}::text[])
    ORDER BY table_name
  `);
  const presentSet = new Set((present.rows ?? present).map((r: any) => r.table_name));

  // 2. Per-table row counts scoped to the caller's hospital
  const counts: Record<string, number> = {};
  for (const t of ALL_TABLES) {
    if (!presentSet.has(t)) {
      counts[t] = -1; // sentinel: not present
      continue;
    }
    try {
      const rows = await db.execute<{ c: number }>(sql.raw(
        `SELECT count(*)::int AS c FROM ${t} WHERE hospital_id = '${hospitalId.replace(/'/g, "''")}'`,
      ));
      counts[t] = (rows.rows ?? rows)[0]?.c ?? 0;
    } catch {
      counts[t] = 0;
    }
  }

  // 3. Self-FK + partial indexes presence (sanity)
  const selfFk = await db.execute<{ ok: number }>(sql`
    SELECT 1 AS ok FROM pg_constraint
    WHERE conname = 'billing_charge_reverses_charge_id_fkey'
  `);
  const partialIdx = await db.execute<{ indexname: string }>(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = ANY(${[...ALL_TABLES]}::text[])
      AND indexdef ILIKE '%WHERE%'
    ORDER BY indexname
  `);

  return {
    hospital_id: hospitalId,
    tables_present: ALL_TABLES.filter((t) => presentSet.has(t)),
    tables_missing: ALL_TABLES.filter((t) => !presentSet.has(t)),
    counts,
    self_fk_present: ((selfFk.rows ?? selfFk) as any[]).length > 0,
    partial_indexes: ((partialIdx.rows ?? partialIdx) as any[]).map((r: any) => r.indexname),
    timestamp: new Date().toISOString(),
  };
});

// ─── items.list ──────────────────────────────────────────────────────────────
export const billingV3ItemsListProcedure = protectedProcedure
  .input(z.object({
    status: z.enum(['active', 'pending_finance', 'inactive', 'all']).default('all'),
    category: z.string().optional(),
    dept_code: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const where = [eq(chargeMasterItem.hospital_id, hospitalId)];
    if (input.status !== 'all') {
      where.push(eq(chargeMasterItem.status, input.status));
    }
    if (input.category) {
      where.push(eq(chargeMasterItem.category, input.category));
    }
    if (input.dept_code) {
      where.push(eq(chargeMasterItem.dept_code, input.dept_code));
    }
    const rows = await db
      .select()
      .from(chargeMasterItem)
      .where(and(...where))
      .orderBy(desc(chargeMasterItem.created_at))
      .limit(input.limit)
      .offset(input.offset);
    return { items: rows, count: rows.length };
  });

// ─── items.detail ────────────────────────────────────────────────────────────
export const billingV3ItemsDetailProcedure = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const [item] = await db
      .select()
      .from(chargeMasterItem)
      .where(and(
        eq(chargeMasterItem.id, input.id),
        eq(chargeMasterItem.hospital_id, hospitalId),
      ))
      .limit(1);
    if (!item) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge master item not found' });
    }
    const prices = await db
      .select()
      .from(chargeMasterPrice)
      .where(and(
        eq(chargeMasterPrice.item_id, input.id),
        isNull(chargeMasterPrice.effective_to),
      ));
    return { item, current_prices: prices };
  });

// ─── rooms.list ──────────────────────────────────────────────────────────────
export const billingV3RoomsListProcedure = protectedProcedure.query(async ({ ctx }) => {
  const hospitalId = ctx.user.hospital_id;
  const rows = await db
    .select()
    .from(chargeMasterRoom)
    .where(eq(chargeMasterRoom.hospital_id, hospitalId))
    .orderBy(chargeMasterRoom.room_class);
  return { rooms: rows, count: rows.length };
});

// ─── packages.list ───────────────────────────────────────────────────────────
export const billingV3PackagesListProcedure = protectedProcedure
  .input(z.object({
    status: z.enum(['active', 'draft', 'retired', 'all']).default('all'),
  }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const where = [eq(chargeMasterPackage.hospital_id, hospitalId)];
    if (input.status !== 'all') {
      where.push(eq(chargeMasterPackage.status, input.status));
    }
    const rows = await db
      .select()
      .from(chargeMasterPackage)
      .where(and(...where))
      .orderBy(chargeMasterPackage.package_code);
    return { packages: rows, count: rows.length };
  });

// ─── discountPolicies.list ───────────────────────────────────────────────────
export const billingV3DiscountPoliciesListProcedure = protectedProcedure
  .input(z.object({ active_only: z.boolean().default(false) }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const where = [eq(discountPolicy.hospital_id, hospitalId)];
    if (input.active_only) {
      where.push(eq(discountPolicy.is_active, true));
    }
    const rows = await db
      .select()
      .from(discountPolicy)
      .where(and(...where))
      .orderBy(discountPolicy.policy_code);
    return { policies: rows, count: rows.length };
  });

// ─── hospitalSetting.get ─────────────────────────────────────────────────────
export const billingV3HospitalSettingGetProcedure = protectedProcedure.query(async ({ ctx }) => {
  const hospitalId = ctx.user.hospital_id;
  const [row] = await db
    .select()
    .from(chargeMasterHospitalSetting)
    .where(eq(chargeMasterHospitalSetting.hospital_id, hospitalId))
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `No charge_master_hospital_setting row for ${hospitalId} — run BV3.1 EHRC seed`,
    });
  }
  return { setting: row };
});

// ─── charges.list ────────────────────────────────────────────────────────────
export const billingV3ChargesListProcedure = protectedProcedure
  .input(z.object({
    billing_account_id: z.string().uuid().optional(),
    patient_id: z.string().uuid().optional(),
    encounter_id: z.string().uuid().optional(),
    status: z.enum(['provisional', 'posted', 'reversed', 'void', 'all']).default('all'),
    source_module: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const where = [eq(billingCharge.hospital_id, hospitalId)];
    if (input.billing_account_id) where.push(eq(billingCharge.billing_account_id, input.billing_account_id));
    if (input.patient_id) where.push(eq(billingCharge.patient_id, input.patient_id));
    if (input.encounter_id) where.push(eq(billingCharge.encounter_id, input.encounter_id));
    if (input.status !== 'all') where.push(eq(billingCharge.status, input.status));
    if (input.source_module) where.push(eq(billingCharge.source_module, input.source_module));

    const rows = await db
      .select()
      .from(billingCharge)
      .where(and(...where))
      .orderBy(desc(billingCharge.posted_at))
      .limit(input.limit)
      .offset(input.offset);
    return { charges: rows, count: rows.length };
  });

// ─── tariffImports.list ──────────────────────────────────────────────────────
export const billingV3TariffImportsListProcedure = protectedProcedure
  .input(z.object({
    import_kind: z.enum(['items', 'prices', 'packages', 'rooms', 'policies', 'all']).default('all'),
    limit: z.number().int().min(1).max(200).default(50),
  }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const where = [eq(chargeMasterTariffImport.hospital_id, hospitalId)];
    if (input.import_kind !== 'all') {
      where.push(eq(chargeMasterTariffImport.import_kind, input.import_kind));
    }
    const rows = await db
      .select()
      .from(chargeMasterTariffImport)
      .where(and(...where))
      .orderBy(desc(chargeMasterTariffImport.created_at))
      .limit(input.limit);
    return { imports: rows, count: rows.length };
  });

// ─── accountPayers.list ──────────────────────────────────────────────────────
// Multi-payer split for a single billing account. Used by chart Billing tab
// + IPD census once Phase 4 ships.
export const billingV3AccountPayersListProcedure = protectedProcedure
  .input(z.object({ billing_account_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const rows = await db
      .select()
      .from(billingAccountPayer)
      .where(and(
        eq(billingAccountPayer.hospital_id, hospitalId),
        eq(billingAccountPayer.billing_account_id, input.billing_account_id),
      ))
      .orderBy(billingAccountPayer.priority);
    return { payers: rows, count: rows.length };
  });

// ─── Composed routers ────────────────────────────────────────────────────────
export const billingV3BootstrapRouter = router({
  status: billingV3BootstrapStatusProcedure,
});

export const billingV3ItemsRouter = router({
  list: billingV3ItemsListProcedure,
  detail: billingV3ItemsDetailProcedure,
});

export const billingV3RoomsRouter = router({
  list: billingV3RoomsListProcedure,
});

export const billingV3PackagesRouter = router({
  list: billingV3PackagesListProcedure,
});

export const billingV3DiscountPoliciesRouter = router({
  list: billingV3DiscountPoliciesListProcedure,
});

export const billingV3HospitalSettingRouter = router({
  get: billingV3HospitalSettingGetProcedure,
});

export const billingV3ChargesRouter = router({
  list: billingV3ChargesListProcedure,
});

export const billingV3TariffImportsRouter = router({
  list: billingV3TariffImportsListProcedure,
});

export const billingV3AccountPayersRouter = router({
  list: billingV3AccountPayersListProcedure,
});

export const billingV3Router = router({
  bootstrap: billingV3BootstrapRouter,
  items: billingV3ItemsRouter,
  rooms: billingV3RoomsRouter,
  packages: billingV3PackagesRouter,
  discountPolicies: billingV3DiscountPoliciesRouter,
  hospitalSetting: billingV3HospitalSettingRouter,
  charges: billingV3ChargesRouter,
  tariffImports: billingV3TariffImportsRouter,
  accountPayers: billingV3AccountPayersRouter,
});
