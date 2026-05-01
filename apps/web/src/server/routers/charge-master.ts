import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  chargeMaster, masterDataVersionHistory,
  codeChargeTiers, serviceCodes, CHARGE_TIER_CLASSES,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion, getVersionHistory } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, ilike, or, isNull, inArray } from 'drizzle-orm';

const chargeCategories = ['room', 'procedure', 'lab', 'pharmacy', 'consultation', 'nursing', 'other'] as const;

export const chargeMasterRouter = router({

  // ─── LIST (paginated, filterable, searchable) ─────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.enum(chargeCategories).optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, category, status, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(chargeMaster.hospital_id, ctx.user.hospital_id)];

      if (category) conditions.push(eq(chargeMaster.category, category));
      if (status === 'active') conditions.push(eq(chargeMaster.is_active, true));
      if (status === 'inactive') conditions.push(eq(chargeMaster.is_active, false));

      if (search) {
        conditions.push(
          or(
            ilike(chargeMaster.charge_name, `%${search}%`),
            ilike(chargeMaster.charge_code, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(chargeMaster).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(chargeMaster)
        .where(where)
        .orderBy(desc(chargeMaster.updated_at))
        .limit(pageSize)
        .offset(offset);

      return {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  // ─── GET by ID ────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(chargeMaster)
        .where(and(
          eq(chargeMaster.id, input.id as any),
          eq(chargeMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge not found' });
      return row;
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      charge_code: z.string().min(1).max(50),
      charge_name: z.string().min(1).max(200),
      category: z.enum(chargeCategories),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      unit: z.string().min(1).default('per unit'),
      description: z.string().optional(),
      gst_percentage: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
    }))
    .mutation(async ({ ctx, input }) => {

      // Check for duplicate charge_code
      const existing = await db.select({ id: chargeMaster.id }).from(chargeMaster)
        .where(and(
          eq(chargeMaster.charge_code, input.charge_code),
          eq(chargeMaster.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: `Charge code "${input.charge_code}" already exists` });
      }

      const [row] = await db.insert(chargeMaster).values({
        hospital_id: ctx.user.hospital_id,
        charge_code: input.charge_code,
        charge_name: input.charge_name,
        category: input.category,
        price: input.price,
        unit: input.unit,
        description: input.description,
        gst_percentage: input.gst_percentage,
        created_by: ctx.user.sub as any,
        updated_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'charge_master', row.id, row as any);
      await writeAuditLog(ctx.user, { action: 'INSERT', table_name: 'charge_master', row_id: row.id, new_values: row as any });

      return row;
    }),

  // ─── UPDATE ───────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      charge_name: z.string().min(1).max(200).optional(),
      category: z.enum(chargeCategories).optional(),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      unit: z.string().min(1).optional(),
      description: z.string().optional(),
      gst_percentage: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Get current state
      const [old] = await db.select().from(chargeMaster)
        .where(and(eq(chargeMaster.id, id as any), eq(chargeMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge not found' });

      const setValues: any = { updated_at: new Date(), updated_by: ctx.user.sub };
      if (updates.charge_name !== undefined) setValues.charge_name = updates.charge_name;
      if (updates.category !== undefined) setValues.category = updates.category;
      if (updates.price !== undefined) setValues.price = updates.price;
      if (updates.unit !== undefined) setValues.unit = updates.unit;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.gst_percentage !== undefined) setValues.gst_percentage = updates.gst_percentage;

      const [row] = await db.update(chargeMaster)
        .set(setValues)
        .where(eq(chargeMaster.id, id as any))
        .returning();

      await recordVersion(ctx.user, 'charge_master', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'charge_master', row_id: row.id, old_values: old as any, new_values: row as any });

      return row;
    }),

  // ─── DEACTIVATE (soft delete) ─────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      const [old] = await db.select().from(chargeMaster)
        .where(and(eq(chargeMaster.id, input.id as any), eq(chargeMaster.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Charge not found' });

      const [row] = await db.update(chargeMaster)
        .set({ is_active: !old.is_active, updated_at: new Date(), updated_by: ctx.user.sub as any })
        .where(eq(chargeMaster.id, input.id as any))
        .returning();

      await recordVersion(ctx.user, 'charge_master', row.id, row as any, old as any);
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'charge_master', row_id: row.id,
        old_values: { is_active: old.is_active }, new_values: { is_active: row.is_active },
        reason: row.is_active ? 'Reactivated' : 'Deactivated',
      });

      return row;
    }),

  // ─── BULK IMPORT (CSV rows) ───────────────────────────────
  bulkImport: adminProcedure
    .input(z.object({
      rows: z.array(z.object({
        charge_code: z.string().min(1),
        charge_name: z.string().min(1),
        category: z.enum(chargeCategories),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        unit: z.string().optional().default('per unit'),
        description: z.string().optional(),
        gst_percentage: z.string().optional().default('0'),
      })),
      mode: z.enum(['skip_duplicates', 'update_duplicates']).default('skip_duplicates'),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; code: string; error: string }[] = [];

      // Process in batches of 500
      const batchSize = 500;
      for (let i = 0; i < input.rows.length; i += batchSize) {
        const batch = input.rows.slice(i, i + batchSize);

        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const rowNum = i + j + 1;

          try {
            // Check for existing
            const [existing] = await db.select({ id: chargeMaster.id }).from(chargeMaster)
              .where(and(
                eq(chargeMaster.charge_code, row.charge_code),
                eq(chargeMaster.hospital_id, ctx.user.hospital_id),
              )).limit(1);

            if (existing) {
              if (input.mode === 'update_duplicates') {
                await db.update(chargeMaster).set({
                  charge_name: row.charge_name,
                  category: row.category,
                  price: row.price,
                  unit: row.unit,
                  description: row.description,
                  gst_percentage: row.gst_percentage,
                  updated_by: ctx.user.sub as any,
                  updated_at: new Date(),
                }).where(eq(chargeMaster.id, existing.id));
                updated++;
              } else {
                skipped++;
              }
            } else {
              await db.insert(chargeMaster).values({
                hospital_id: ctx.user.hospital_id,
                charge_code: row.charge_code,
                charge_name: row.charge_name,
                category: row.category,
                price: row.price,
                unit: row.unit,
                description: row.description,
                gst_percentage: row.gst_percentage,
                created_by: ctx.user.sub as any,
                updated_by: ctx.user.sub as any,
              });
              imported++;
            }
          } catch (err: any) {
            errors.push({ row: rowNum, code: row.charge_code, error: err.message || 'Unknown error' });
          }
        }
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'charge_master',
        row_id: 'bulk_import',
        new_values: { imported, updated, skipped, errors: errors.length, total: input.rows.length },
        reason: `Bulk import: ${input.rows.length} rows`,
      });

      return { imported, updated, skipped, errors, total: input.rows.length };
    }),

  // ─── VERSION HISTORY ──────────────────────────────────────
  versionHistory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVersionHistory('charge_master', input.id);
    }),

  // ─── STATS (dashboard widget) ─────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const result = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE is_active = true)`,
      inactive: sql<number>`count(*) FILTER (WHERE is_active = false)`,
    }).from(chargeMaster)
      .where(eq(chargeMaster.hospital_id, ctx.user.hospital_id));

    return {
      total: Number(result[0]?.total ?? 0),
      active: Number(result[0]?.active ?? 0),
      inactive: Number(result[0]?.inactive ?? 0),
    };
  }),

  // =============================================================================
  // BV3 PHASE 2 — Codes integration additions
  // =============================================================================
  // The 6 procedures above (list/get/create/update/deactivate/bulkImport) read +
  // write the legacy v1 `charge_master` table. Phase 4.B / Pharmacy refactor
  // fully migrates them. The 2 procedures below expose the new code_charge_tiers
  // path additively without breaking the existing UI.
  // =============================================================================

  /**
   * searchUnified — search BOTH legacy charge_master AND code_charge_tiers
   * (joined to service_codes for human-readable name + code). Dedupes by
   * service_code FK presence. Returns rows with `source` flag indicating
   * the origin table.
   *
   * Caregiver-safe: filters service_codes to status='active' by default;
   * include_drafts=true reveals codes still in approval flow.
   */
  searchUnified: protectedProcedure
    .input(z.object({
      q: z.string().min(2),
      include_drafts: z.boolean().default(false),
      limit: z.number().int().positive().max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      const pat = `%${input.q.trim()}%`;
      const hospital_id = ctx.user.hospital_id;

      // Legacy charge_master rows
      const legacyRows = await db
        .select({
          source: sql<string>`'charge_master'`,
          id: chargeMaster.id,
          charge_code: chargeMaster.charge_code,
          charge_name: chargeMaster.charge_name,
          category: chargeMaster.category,
          price: chargeMaster.price,
          gst_percentage: chargeMaster.gst_percentage,
          is_active: chargeMaster.is_active,
          service_code_id: sql<string | null>`NULL`,
          tier_id: sql<string | null>`NULL`,
          class_code: sql<string | null>`NULL`,
        })
        .from(chargeMaster)
        .where(and(
          eq(chargeMaster.hospital_id, hospital_id),
          or(
            ilike(chargeMaster.charge_code, pat),
            ilike(chargeMaster.charge_name, pat),
          ),
        ))
        .limit(input.limit);

      // Tier-backed rows: service_codes joined to code_charge_tiers (current only)
      const statusClause = input.include_drafts
        ? sql`TRUE`
        : sql`${serviceCodes.status} = 'active'`;
      const tierRows = await db
        .select({
          source: sql<string>`'code_charge_tiers'`,
          id: codeChargeTiers.id,
          charge_code: serviceCodes.service_code,
          charge_name: serviceCodes.service_name,
          category: serviceCodes.service_type_code,
          price: codeChargeTiers.price_inr,
          gst_percentage: codeChargeTiers.gst_percentage,
          is_active: sql<boolean>`(${serviceCodes.status} = 'active')`,
          service_code_id: serviceCodes.id,
          tier_id: codeChargeTiers.id,
          class_code: codeChargeTiers.class_code,
        })
        .from(codeChargeTiers)
        .innerJoin(serviceCodes, eq(codeChargeTiers.service_id, serviceCodes.id))
        .where(and(
          eq(codeChargeTiers.hospital_id, hospital_id),
          isNull(codeChargeTiers.effective_to),
          eq(codeChargeTiers.class_code, 'GENERAL' as const),  // surface 1 row per service @ GENERAL class
          statusClause,
          or(
            ilike(serviceCodes.service_code, pat),
            ilike(serviceCodes.service_name, pat),
            ilike(serviceCodes.legacy_code, pat),
          ),
        ))
        .limit(input.limit);

      // Dedupe: if a tier-backed row's service_code matches a legacy charge_code
      // (via service_codes.legacy_code in earlier backfill), prefer the tier row.
      const tierLegacyCodes = new Set<string>();
      const tiersFull = await db
        .select({ legacy_code: serviceCodes.legacy_code })
        .from(serviceCodes)
        .where(eq(serviceCodes.hospital_id, hospital_id));
      for (const r of tiersFull) {
        if (r.legacy_code) tierLegacyCodes.add(r.legacy_code);
      }
      const dedupedLegacy = legacyRows.filter((r) => !tierLegacyCodes.has(r.charge_code));

      const combined = [...tierRows, ...dedupedLegacy];
      // Order: exact code match first, then name match
      combined.sort((a, b) => {
        const aExact = a.charge_code.toLowerCase() === input.q.toLowerCase();
        const bExact = b.charge_code.toLowerCase() === input.q.toLowerCase();
        if (aExact !== bExact) return aExact ? -1 : 1;
        return a.charge_name.localeCompare(b.charge_name);
      });
      return {
        rows: combined.slice(0, input.limit),
        count: combined.length,
        sources: {
          legacy: dedupedLegacy.length,
          code_charge_tiers: tierRows.length,
        },
      };
    }),

  /**
   * listFromTiers — paginated listing reading EXCLUSIVELY from code_charge_tiers
   * (joined to service_codes). Replacement for `list` once /admin/charge-master
   * fully migrates in Phase 4.B. Phase 2 surfaces it alongside the legacy list
   * so admins can A/B compare.
   */
  listFromTiers: adminProcedure
    .input(z.object({
      service_type_code: z.string().optional(),
      department_code: z.string().optional(),
      class_code: z.enum(CHARGE_TIER_CLASSES).default('GENERAL'),
      include_drafts: z.boolean().default(false),
      limit: z.number().int().positive().max(500).default(100),
      offset: z.number().int().nonnegative().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conds: any[] = [
        eq(codeChargeTiers.hospital_id, ctx.user.hospital_id),
        eq(codeChargeTiers.class_code, input.class_code),
        isNull(codeChargeTiers.effective_to),
      ];
      if (!input.include_drafts) conds.push(eq(serviceCodes.status, 'active'));
      if (input.service_type_code) conds.push(eq(serviceCodes.service_type_code, input.service_type_code));
      if (input.department_code) conds.push(eq(serviceCodes.department_code, input.department_code));

      const rows = await db
        .select({
          tier_id: codeChargeTiers.id,
          service_id: serviceCodes.id,
          service_code: serviceCodes.service_code,
          service_name: serviceCodes.service_name,
          service_type_code: serviceCodes.service_type_code,
          department_code: serviceCodes.department_code,
          legacy_code: serviceCodes.legacy_code,
          status: serviceCodes.status,
          price_inr: codeChargeTiers.price_inr,
          gst_percentage: codeChargeTiers.gst_percentage,
          is_open_billing: codeChargeTiers.is_open_billing,
          effective_from: codeChargeTiers.effective_from,
          effective_to: codeChargeTiers.effective_to,
          empanelment_id: codeChargeTiers.empanelment_id,
          source: codeChargeTiers.source,
        })
        .from(codeChargeTiers)
        .innerJoin(serviceCodes, eq(codeChargeTiers.service_id, serviceCodes.id))
        .where(and(...conds))
        .orderBy(serviceCodes.service_code)
        .limit(input.limit)
        .offset(input.offset);

      return { rows, count: rows.length, class_code: input.class_code };
    }),
});
