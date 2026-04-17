import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { chartOfAccounts } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or, isNull, asc } from 'drizzle-orm';

const accountTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const accountSubTypes = [
  'current_asset', 'fixed_asset', 'current_liability', 'long_term_liability',
  'operating_revenue', 'other_income', 'operating_expense', 'cogs',
  'depreciation', 'tax', 'equity_capital', 'equity_reserves',
] as const;
const normalBalances = ['debit', 'credit'] as const;

export const financeChartRouter = router({

  // ─── LIST (flat, paginated, filterable) ─────────────
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      account_type: z.enum(accountTypes).optional(),
      account_sub_type: z.enum(accountSubTypes).optional(),
      level: z.number().min(1).max(4).optional(),
      is_active: z.enum(['true', 'false', 'all']).default('all'),
      is_group: z.enum(['true', 'false', 'all']).default('all'),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(200).default(100),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, account_type, account_sub_type, level, is_active, is_group, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(chartOfAccounts.hospital_id, ctx.user.hospital_id)];

      if (account_type) conditions.push(eq(chartOfAccounts.account_type, account_type));
      if (account_sub_type) conditions.push(eq(chartOfAccounts.account_sub_type, account_sub_type));
      if (level) conditions.push(eq(chartOfAccounts.level, level));
      if (is_active === 'true') conditions.push(eq(chartOfAccounts.is_active, true));
      if (is_active === 'false') conditions.push(eq(chartOfAccounts.is_active, false));
      if (is_group === 'true') conditions.push(eq(chartOfAccounts.is_group, true));
      if (is_group === 'false') conditions.push(eq(chartOfAccounts.is_group, false));

      if (search) {
        conditions.push(
          or(
            ilike(chartOfAccounts.account_name, `%${search}%`),
            ilike(chartOfAccounts.account_code, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(chartOfAccounts).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(chartOfAccounts)
        .where(where)
        .orderBy(asc(chartOfAccounts.account_code))
        .limit(pageSize)
        .offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── TREE (hierarchical view — all accounts) ─────────────
  tree: protectedProcedure
    .input(z.object({
      account_type: z.enum(accountTypes).optional(),
      include_inactive: z.boolean().default(false),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(chartOfAccounts.hospital_id, ctx.user.hospital_id)];

      if (input.account_type) conditions.push(eq(chartOfAccounts.account_type, input.account_type));
      if (!input.include_inactive) conditions.push(eq(chartOfAccounts.is_active, true));

      const allAccounts = await db.select()
        .from(chartOfAccounts)
        .where(and(...conditions))
        .orderBy(asc(chartOfAccounts.account_code));

      // Build tree structure
      const accountMap = new Map<string, any>();
      const roots: any[] = [];

      // First pass: create map
      for (const acct of allAccounts) {
        accountMap.set(acct.id, { ...acct, children: [] });
      }

      // Second pass: link parents
      for (const acct of allAccounts) {
        const node = accountMap.get(acct.id)!;
        if (acct.parent_account_id && accountMap.has(acct.parent_account_id)) {
          accountMap.get(acct.parent_account_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      }

      return { tree: roots, totalAccounts: allAccounts.length };
    }),

  // ─── GET SINGLE ─────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.id, input.id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });

      // Get children count
      const childCount = await db.select({ count: sql<number>`count(*)` })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.parent_account_id, input.id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ));

      return { ...rows[0], children_count: Number(childCount[0]?.count ?? 0) };
    }),

  // ─── CREATE ─────────────
  create: adminProcedure
    .input(z.object({
      account_code: z.string().min(1).max(20),
      account_name: z.string().min(1).max(200),
      account_type: z.enum(accountTypes),
      account_sub_type: z.enum(accountSubTypes).optional(),
      parent_account_id: z.string().uuid().optional(),
      level: z.number().min(1).max(4).default(3),
      is_group: z.boolean().default(false),
      normal_balance: z.enum(normalBalances),
      gst_applicable: z.boolean().default(false),
      hsn_sac_code: z.string().max(20).optional(),
      description: z.string().optional(),
      opening_balance: z.string().optional().transform((v) => v ? parseFloat(v) : 0),
      opening_balance_date: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate parent exists if provided
      if (input.parent_account_id) {
        const parent = await db.select()
          .from(chartOfAccounts)
          .where(and(
            eq(chartOfAccounts.id, input.parent_account_id),
            eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
          ))
          .limit(1);

        if (!parent.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Parent account not found' });
        }
        if (!parent[0].is_group) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Parent account must be a group account' });
        }
      }

      // Check for duplicate code
      const existing = await db.select({ id: chartOfAccounts.id })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
          eq(chartOfAccounts.account_code, input.account_code),
        ))
        .limit(1);

      if (existing.length) {
        throw new TRPCError({ code: 'CONFLICT', message: `Account code ${input.account_code} already exists` });
      }

      const inserted = await db.insert(chartOfAccounts).values({
        hospital_id: ctx.user.hospital_id,
        account_code: input.account_code,
        account_name: input.account_name,
        account_type: input.account_type,
        account_sub_type: input.account_sub_type || null,
        parent_account_id: input.parent_account_id || null,
        level: input.level,
        is_group: input.is_group,
        normal_balance: input.normal_balance,
        gst_applicable: input.gst_applicable,
        hsn_sac_code: input.hsn_sac_code || null,
        description: input.description || null,
        opening_balance: String(input.opening_balance),
        opening_balance_date: input.opening_balance_date || null,
        is_system_account: false,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'chart_of_accounts',
        row_id: inserted[0].id,
        new_values: { account_code: input.account_code, account_name: input.account_name },
        reason: 'New GL account created',
      });

      return inserted[0];
    }),

  // ─── UPDATE ─────────────
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      account_name: z.string().min(1).max(200).optional(),
      account_sub_type: z.enum(accountSubTypes).nullable().optional(),
      parent_account_id: z.string().uuid().nullable().optional(),
      level: z.number().min(1).max(4).optional(),
      is_group: z.boolean().optional(),
      gst_applicable: z.boolean().optional(),
      hsn_sac_code: z.string().max(20).nullable().optional(),
      description: z.string().nullable().optional(),
      opening_balance: z.string().optional().transform((v) => v ? parseFloat(v) : undefined),
      opening_balance_date: z.string().nullable().optional(),
      is_active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check account exists and belongs to hospital
      const existing = await db.select()
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.id, id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!existing.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });

      // Prevent changes to account_type and normal_balance on system accounts
      // (these are fundamental to the GL structure)

      // Build update object
      const updateObj: any = { updated_at: new Date() };
      if (updates.account_name !== undefined) updateObj.account_name = updates.account_name;
      if (updates.account_sub_type !== undefined) updateObj.account_sub_type = updates.account_sub_type;
      if (updates.parent_account_id !== undefined) updateObj.parent_account_id = updates.parent_account_id;
      if (updates.level !== undefined) updateObj.level = updates.level;
      if (updates.is_group !== undefined) updateObj.is_group = updates.is_group;
      if (updates.gst_applicable !== undefined) updateObj.gst_applicable = updates.gst_applicable;
      if (updates.hsn_sac_code !== undefined) updateObj.hsn_sac_code = updates.hsn_sac_code;
      if (updates.description !== undefined) updateObj.description = updates.description;
      if (updates.opening_balance !== undefined) updateObj.opening_balance = String(updates.opening_balance);
      if (updates.opening_balance_date !== undefined) updateObj.opening_balance_date = updates.opening_balance_date;
      if (updates.is_active !== undefined) updateObj.is_active = updates.is_active;

      // Validate parent if changing
      if (updates.parent_account_id) {
        // Prevent circular reference
        if (updates.parent_account_id === id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Account cannot be its own parent' });
        }
        const parent = await db.select()
          .from(chartOfAccounts)
          .where(and(
            eq(chartOfAccounts.id, updates.parent_account_id),
            eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
          ))
          .limit(1);
        if (!parent.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Parent account not found' });
        }
      }

      const updated = await db.update(chartOfAccounts)
        .set(updateObj)
        .where(and(
          eq(chartOfAccounts.id, id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'chart_of_accounts',
        row_id: id,
        new_values: updateObj,
        reason: 'GL account updated',
      });

      return updated[0];
    }),

  // ─── DELETE (soft — deactivate, or hard if no JE lines reference it) ─────────────
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.select()
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.id, input.id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!existing.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });

      // Cannot delete system accounts
      if (existing[0].is_system_account) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete system account. System accounts are protected.' });
      }

      // Check for children
      const childCount = await db.select({ count: sql<number>`count(*)` })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.parent_account_id, input.id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ));

      if (Number(childCount[0]?.count ?? 0) > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete account with child accounts. Move or delete children first.' });
      }

      // Soft delete (deactivate)
      await db.update(chartOfAccounts)
        .set({ is_active: false, updated_at: new Date() })
        .where(eq(chartOfAccounts.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'DELETE',
        table_name: 'chart_of_accounts',
        row_id: input.id,
        new_values: { is_active: false },
        reason: 'GL account deactivated',
      });

      return { success: true };
    }),

  // ─── SUGGEST NEXT CODE (auto-generate code under a parent) ─────────────
  suggestCode: protectedProcedure
    .input(z.object({
      parent_account_id: z.string().uuid().optional(),
      account_type: z.enum(accountTypes),
    }))
    .query(async ({ ctx, input }) => {
      // Get the parent's code prefix or type prefix
      let prefix = '';
      if (input.parent_account_id) {
        const parent = await db.select({ account_code: chartOfAccounts.account_code })
          .from(chartOfAccounts)
          .where(and(
            eq(chartOfAccounts.id, input.parent_account_id),
            eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
          ))
          .limit(1);
        if (parent.length) prefix = parent[0].account_code;
      }

      if (!prefix) {
        // Type-based prefix
        const prefixMap: Record<string, string> = {
          asset: '1', liability: '2', equity: '3', revenue: '4', expense: '5',
        };
        prefix = prefixMap[input.account_type] || '9';
      }

      // Find highest existing code with this prefix
      const siblings = await db.select({ account_code: chartOfAccounts.account_code })
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
          sql`${chartOfAccounts.account_code} LIKE ${prefix + '%'}`,
        ))
        .orderBy(desc(chartOfAccounts.account_code))
        .limit(1);

      if (siblings.length) {
        const lastCode = siblings[0].account_code;
        const num = parseInt(lastCode, 10);
        if (!isNaN(num)) {
          return { suggested_code: String(num + 1) };
        }
      }

      return { suggested_code: prefix + '00' };
    }),

  // ─── STATS ─────────────
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const result = await db.select({
        account_type: chartOfAccounts.account_type,
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${chartOfAccounts.is_active} = true)`,
        groups: sql<number>`count(*) filter (where ${chartOfAccounts.is_group} = true)`,
        system: sql<number>`count(*) filter (where ${chartOfAccounts.is_system_account} = true)`,
      })
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.hospital_id, ctx.user.hospital_id))
        .groupBy(chartOfAccounts.account_type);

      const totalAccounts = result.reduce((sum, r) => sum + Number(r.total), 0);
      const totalActive = result.reduce((sum, r) => sum + Number(r.active), 0);
      const totalSystem = result.reduce((sum, r) => sum + Number(r.system), 0);

      return {
        by_type: result.map(r => ({
          account_type: r.account_type,
          total: Number(r.total),
          active: Number(r.active),
          groups: Number(r.groups),
          system: Number(r.system),
        })),
        total_accounts: totalAccounts,
        total_active: totalActive,
        total_system: totalSystem,
      };
    }),

  // ─── LEDGER ACCOUNTS ONLY (non-group, for dropdowns in JE entry) ─────────────
  ledgerAccounts: protectedProcedure
    .input(z.object({
      account_type: z.enum(accountTypes).optional(),
      search: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [
        eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        eq(chartOfAccounts.is_active, true),
        eq(chartOfAccounts.is_group, false),
      ];

      if (input.account_type) conditions.push(eq(chartOfAccounts.account_type, input.account_type));
      if (input.search) {
        conditions.push(
          or(
            ilike(chartOfAccounts.account_name, `%${input.search}%`),
            ilike(chartOfAccounts.account_code, `%${input.search}%`),
          )!
        );
      }

      const rows = await db.select({
        id: chartOfAccounts.id,
        account_code: chartOfAccounts.account_code,
        account_name: chartOfAccounts.account_name,
        account_type: chartOfAccounts.account_type,
        normal_balance: chartOfAccounts.normal_balance,
        gst_applicable: chartOfAccounts.gst_applicable,
      })
        .from(chartOfAccounts)
        .where(and(...conditions))
        .orderBy(asc(chartOfAccounts.account_code))
        .limit(200);

      return rows;
    }),
});
