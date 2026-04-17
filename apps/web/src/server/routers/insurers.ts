import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { insurers, insurerTpaMappings } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

const insurerTypes = ['insurance_company', 'tpa', 'government', 'corporate', 'trust'] as const;
const networkTiers = ['preferred', 'standard', 'non_network'] as const;

export const insurersRouter = router({

  // ─── LIST (paginated, filterable, searchable) ─────────────
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      insurer_type: z.enum(insurerTypes).optional(),
      network_tier: z.enum(networkTiers).optional(),
      is_active: z.enum(['true', 'false', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, insurer_type, network_tier, is_active, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(insurers.hospital_id, ctx.user.hospital_id)];

      if (insurer_type) conditions.push(eq(insurers.insurer_type, insurer_type));
      if (network_tier) conditions.push(eq(insurers.network_tier, network_tier));
      if (is_active === 'true') conditions.push(eq(insurers.is_active, true));
      if (is_active === 'false') conditions.push(eq(insurers.is_active, false));

      if (search) {
        conditions.push(
          or(
            ilike(insurers.insurer_name, `%${search}%`),
            ilike(insurers.insurer_code, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(insurers).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(insurers)
        .where(where)
        .orderBy(desc(insurers.updated_at))
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
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(insurers)
        .where(and(
          eq(insurers.id, input.id as any),
          eq(insurers.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found' });
      return row;
    }),

  // ─── CREATE ───────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      insurer_code: z.string().min(1).max(50),
      insurer_name: z.string().min(1).max(200),
      insurer_type: z.enum(insurerTypes),
      contact_person: z.string().optional(),
      contact_phone: z.string().optional(),
      contact_email: z.string().email().optional(),
      address: z.string().optional(),
      gst_number: z.string().optional(),
      network_tier: z.enum(networkTiers).optional().default('standard'),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {

      // Check for duplicate insurer_code within hospital
      const existing = await db.select({ id: insurers.id }).from(insurers)
        .where(and(
          eq(insurers.insurer_code, input.insurer_code),
          eq(insurers.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: `Insurer code "${input.insurer_code}" already exists` });
      }

      const [row] = await db.insert(insurers).values({
        hospital_id: ctx.user.hospital_id,
        insurer_code: input.insurer_code,
        insurer_name: input.insurer_name,
        insurer_type: input.insurer_type,
        contact_person: input.contact_person,
        contact_phone: input.contact_phone,
        contact_email: input.contact_email,
        address: input.address,
        gst_number: input.gst_number,
        network_tier: input.network_tier,
        notes: input.notes,
        created_by: ctx.user.sub as any,
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'insurers',
        row_id: row.id,
        new_values: row as any,
      });

      return row;
    }),

  // ─── UPDATE ───────────────────────────────────────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      insurer_name: z.string().min(1).max(200).optional(),
      insurer_type: z.enum(insurerTypes).optional(),
      contact_person: z.string().optional(),
      contact_phone: z.string().optional(),
      contact_email: z.string().email().optional(),
      address: z.string().optional(),
      gst_number: z.string().optional(),
      network_tier: z.enum(networkTiers).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Get current state
      const [old] = await db.select().from(insurers)
        .where(and(eq(insurers.id, id as any), eq(insurers.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found' });

      const setValues: any = { updated_at: new Date() };
      if (updates.insurer_name !== undefined) setValues.insurer_name = updates.insurer_name;
      if (updates.insurer_type !== undefined) setValues.insurer_type = updates.insurer_type;
      if (updates.contact_person !== undefined) setValues.contact_person = updates.contact_person;
      if (updates.contact_phone !== undefined) setValues.contact_phone = updates.contact_phone;
      if (updates.contact_email !== undefined) setValues.contact_email = updates.contact_email;
      if (updates.address !== undefined) setValues.address = updates.address;
      if (updates.gst_number !== undefined) setValues.gst_number = updates.gst_number;
      if (updates.network_tier !== undefined) setValues.network_tier = updates.network_tier;
      if (updates.notes !== undefined) setValues.notes = updates.notes;

      const [row] = await db.update(insurers)
        .set(setValues)
        .where(eq(insurers.id, id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'insurers',
        row_id: row.id,
        old_values: old as any,
        new_values: row as any,
      });

      return row;
    }),

  // ─── TOGGLE ACTIVE ────────────────────────────────────────
  toggleActive: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      const [old] = await db.select().from(insurers)
        .where(and(eq(insurers.id, input.id as any), eq(insurers.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found' });

      const [row] = await db.update(insurers)
        .set({ is_active: !old.is_active, updated_at: new Date() })
        .where(eq(insurers.id, input.id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'insurers',
        row_id: row.id,
        old_values: { is_active: old.is_active },
        new_values: { is_active: row.is_active },
        reason: row.is_active ? 'Reactivated' : 'Deactivated',
      });

      return row;
    }),

  // ─── LIST TPAs (quick lookup for dropdowns) ───────────────
  listTpas: protectedProcedure
    .query(async ({ ctx }) => {
      const tpas = await db.select({
        id: insurers.id,
        insurer_code: insurers.insurer_code,
        insurer_name: insurers.insurer_name,
      })
        .from(insurers)
        .where(and(
          eq(insurers.hospital_id, ctx.user.hospital_id),
          eq(insurers.insurer_type, 'tpa'),
          eq(insurers.is_active, true),
        ))
        .orderBy(insurers.insurer_name);

      return tpas;
    }),

  // ─── GET TPA MAPPINGS for an insurer ──────────────────────
  getTpaMappings: protectedProcedure
    .input(z.object({ insurer_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // First verify insurer belongs to this hospital
      const [insurer] = await db.select().from(insurers)
        .where(and(
          eq(insurers.id, input.insurer_id as any),
          eq(insurers.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!insurer) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found' });

      // Get mappings with TPA details
      const mappings = await db.select({
        id: insurerTpaMappings.id,
        insurer_id: insurerTpaMappings.insurer_id,
        tpa_id: insurerTpaMappings.tpa_id,
        tpa_name: insurers.insurer_name, // aliased from join
        tpa_code: insurers.insurer_code,
        effective_from: insurerTpaMappings.effective_from,
        effective_to: insurerTpaMappings.effective_to,
        is_active: insurerTpaMappings.is_active,
        created_at: insurerTpaMappings.created_at,
      })
        .from(insurerTpaMappings)
        .leftJoin(insurers, eq(insurerTpaMappings.tpa_id, insurers.id))
        .where(eq(insurerTpaMappings.insurer_id, input.insurer_id as any))
        .orderBy(desc(insurerTpaMappings.created_at));

      return mappings;
    }),

  // ─── ADD TPA MAPPING ──────────────────────────────────────
  addTpaMapping: adminProcedure
    .input(z.object({
      insurer_id: z.string().uuid(),
      tpa_id: z.string().uuid(),
      effective_from: z.string(), // ISO date format
      effective_to: z.string().optional(), // ISO date format
    }))
    .mutation(async ({ ctx, input }) => {

      // Verify both insurer and TPA exist and belong to this hospital
      const [insurer] = await db.select().from(insurers)
        .where(and(
          eq(insurers.id, input.insurer_id as any),
          eq(insurers.hospital_id, ctx.user.hospital_id),
        )).limit(1);
      if (!insurer) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found' });

      const [tpa] = await db.select().from(insurers)
        .where(and(
          eq(insurers.id, input.tpa_id as any),
          eq(insurers.hospital_id, ctx.user.hospital_id),
          eq(insurers.insurer_type, 'tpa'),
        )).limit(1);
      if (!tpa) throw new TRPCError({ code: 'NOT_FOUND', message: 'TPA not found' });

      // Check for duplicate active mapping
      const existing = await db.select({ id: insurerTpaMappings.id }).from(insurerTpaMappings)
        .where(and(
          eq(insurerTpaMappings.insurer_id, input.insurer_id as any),
          eq(insurerTpaMappings.tpa_id, input.tpa_id as any),
          eq(insurerTpaMappings.is_active, true),
        )).limit(1);
      if (existing.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Active TPA mapping already exists for this insurer',
        });
      }

      const [row] = await db.insert(insurerTpaMappings).values({
        hospital_id: ctx.user.hospital_id,
        insurer_id: input.insurer_id as any,
        tpa_id: input.tpa_id as any,
        effective_from: input.effective_from,
        effective_to: input.effective_to || null,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'insurer_tpa_mappings',
        row_id: row.id,
        new_values: row as any,
      });

      return row;
    }),

  // ─── REMOVE TPA MAPPING (deactivate) ──────────────────────
  removeTpaMapping: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      const [old] = await db.select().from(insurerTpaMappings)
        .where(eq(insurerTpaMappings.id, input.id as any))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'TPA mapping not found' });

      // Verify mapping belongs to this hospital
      if (old.hospital_id !== ctx.user.hospital_id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Unauthorized' });
      }

      const [row] = await db.update(insurerTpaMappings)
        .set({ is_active: false })
        .where(eq(insurerTpaMappings.id, input.id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'insurer_tpa_mappings',
        row_id: row.id,
        old_values: { is_active: old.is_active },
        new_values: { is_active: row.is_active },
        reason: 'TPA mapping deactivated',
      });

      return row;
    }),

  // ─── LIST ALL TPA MAPPINGS (admin view) ────────────────────
  listAllMappings: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select({
        id: insurerTpaMappings.id,
        insurer_id: insurerTpaMappings.insurer_id,
        tpa_id: insurerTpaMappings.tpa_id,
        effective_from: insurerTpaMappings.effective_from,
        effective_to: insurerTpaMappings.effective_to,
        is_active: insurerTpaMappings.is_active,
        created_at: insurerTpaMappings.created_at,
      })
        .from(insurerTpaMappings)
        .where(eq(insurerTpaMappings.hospital_id, ctx.user.hospital_id))
        .orderBy(desc(insurerTpaMappings.created_at));

      // Fetch names for display
      if (rows.length === 0) return [];

      const allInsurerIds = [...new Set([
        ...rows.map(r => r.insurer_id),
        ...rows.map(r => r.tpa_id),
      ])];

      const insurerRows = await db.select({
        id: insurers.id,
        insurer_name: insurers.insurer_name,
      }).from(insurers)
        .where(sql`${insurers.id} = ANY(ARRAY[${sql.join(allInsurerIds.map(id => sql`${id}::uuid`), sql`, `)}])`);

      const nameMap: Record<string, string> = {};
      insurerRows.forEach(r => { nameMap[r.id] = r.insurer_name; });

      return rows.map(r => ({
        ...r,
        insurer_name: nameMap[r.insurer_id] || 'Unknown',
        tpa_name: nameMap[r.tpa_id] || 'Unknown',
      }));
    }),

  // ─── STATS (dashboard widget) ─────────────────────────────
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const result = await db.select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) FILTER (WHERE is_active = true)`,
        inactive: sql<number>`count(*) FILTER (WHERE is_active = false)`,
        insurance_company_count: sql<number>`count(*) FILTER (WHERE insurer_type = 'insurance_company')`,
        tpa_count: sql<number>`count(*) FILTER (WHERE insurer_type = 'tpa')`,
        government_count: sql<number>`count(*) FILTER (WHERE insurer_type = 'government')`,
        corporate_count: sql<number>`count(*) FILTER (WHERE insurer_type = 'corporate')`,
        trust_count: sql<number>`count(*) FILTER (WHERE insurer_type = 'trust')`,
        preferred_count: sql<number>`count(*) FILTER (WHERE network_tier = 'preferred')`,
        standard_count: sql<number>`count(*) FILTER (WHERE network_tier = 'standard')`,
        non_network_count: sql<number>`count(*) FILTER (WHERE network_tier = 'non_network')`,
      }).from(insurers)
        .where(eq(insurers.hospital_id, ctx.user.hospital_id));

      return {
        total: Number(result[0]?.total ?? 0),
        active: Number(result[0]?.active ?? 0),
        inactive: Number(result[0]?.inactive ?? 0),
        byType: {
          insurance_company: Number(result[0]?.insurance_company_count ?? 0),
          tpa: Number(result[0]?.tpa_count ?? 0),
          government: Number(result[0]?.government_count ?? 0),
          corporate: Number(result[0]?.corporate_count ?? 0),
          trust: Number(result[0]?.trust_count ?? 0),
        },
        byTier: {
          preferred: Number(result[0]?.preferred_count ?? 0),
          standard: Number(result[0]?.standard_count ?? 0),
          non_network: Number(result[0]?.non_network_count ?? 0),
        },
      };
    }),

});
