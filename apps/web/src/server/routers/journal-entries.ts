import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { journalEntries, journalEntryLines, chartOfAccounts, depositTransactions } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, ilike, or, gte, lte, inArray } from 'drizzle-orm';

const entryTypes = [
  'auto_billing', 'auto_collection', 'auto_deposit', 'auto_refund', 'auto_waiver',
  'auto_pharmacy', 'auto_payroll', 'auto_vendor', 'manual', 'adjustment',
  'opening_balance', 'closing',
] as const;

const statuses = ['draft', 'posted', 'reversed', 'voided'] as const;

const referenceTypes = [
  'invoice', 'payment', 'deposit', 'refund', 'waiver', 'purchase_order',
  'vendor_invoice', 'payroll_run', 'insurance_settlement', 'claim', 'other',
] as const;

// ─── Helper: Generate next JE number ─────────────
async function generateEntryNumber(hospitalId: string, entryDate: string): Promise<string> {
  const dateStr = entryDate.replace(/-/g, '');
  const prefix = `JE-${dateStr}`;

  const last = await db.select({ entry_number: journalEntries.entry_number })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.hospital_id, hospitalId),
      sql`${journalEntries.entry_number} LIKE ${prefix + '%'}`,
    ))
    .orderBy(desc(journalEntries.entry_number))
    .limit(1);

  if (last.length) {
    const lastNum = parseInt(last[0].entry_number.split('-').pop() || '0', 10);
    return `${prefix}-${String(lastNum + 1).padStart(4, '0')}`;
  }
  return `${prefix}-0001`;
}

// ─── Line item schema (shared by create and manual entry) ─────────────
const lineItemSchema = z.object({
  account_id: z.string().uuid(),
  debit_amount: z.number().min(0).default(0),
  credit_amount: z.number().min(0).default(0),
  narration: z.string().optional(),
  cost_center: z.string().optional(),
});

export const journalEntriesRouter = router({

  // ─── LIST (paginated, filterable) ─────────────
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      entry_type: z.enum(entryTypes).optional(),
      status: z.enum(statuses).optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, entry_type, status, date_from, date_to, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(journalEntries.hospital_id, ctx.user.hospital_id)];

      if (entry_type) conditions.push(eq(journalEntries.entry_type, entry_type));
      if (status) conditions.push(eq(journalEntries.status, status));
      if (date_from) conditions.push(gte(journalEntries.entry_date, date_from));
      if (date_to) conditions.push(lte(journalEntries.entry_date, date_to));
      if (search) {
        conditions.push(
          or(
            ilike(journalEntries.entry_number, `%${search}%`),
            ilike(journalEntries.narration, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(journalEntries).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(journalEntries)
        .where(where)
        .orderBy(desc(journalEntries.entry_date), desc(journalEntries.entry_number))
        .limit(pageSize)
        .offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── GET (single JE with lines) ─────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const je = await db.select()
        .from(journalEntries)
        .where(and(
          eq(journalEntries.id, input.id),
          eq(journalEntries.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!je.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });

      const lines = await db.select({
        id: journalEntryLines.id,
        account_id: journalEntryLines.account_id,
        debit_amount: journalEntryLines.debit_amount,
        credit_amount: journalEntryLines.credit_amount,
        narration: journalEntryLines.narration,
        cost_center: journalEntryLines.cost_center,
        account_code: chartOfAccounts.account_code,
        account_name: chartOfAccounts.account_name,
        account_type: chartOfAccounts.account_type,
      })
        .from(journalEntryLines)
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(eq(journalEntryLines.journal_entry_id, input.id))
        .orderBy(desc(journalEntryLines.debit_amount)); // debits first

      return { ...je[0], lines };
    }),

  // ─── CREATE (manual JE — draft) ─────────────
  create: adminProcedure
    .input(z.object({
      entry_date: z.string(),
      entry_type: z.enum(entryTypes).default('manual'),
      narration: z.string().min(1),
      reference_type: z.enum(referenceTypes).optional(),
      reference_id: z.string().uuid().optional(),
      lines: z.array(lineItemSchema).min(2),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate balance
      const totalDebit = input.lines.reduce((sum, l) => sum + l.debit_amount, 0);
      const totalCredit = input.lines.reduce((sum, l) => sum + l.credit_amount, 0);

      if (Math.abs(totalDebit - totalCredit) > 0.001) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Journal entry must balance. Debit: ${totalDebit.toFixed(2)}, Credit: ${totalCredit.toFixed(2)}, Difference: ${(totalDebit - totalCredit).toFixed(2)}`,
        });
      }

      // Each line must have either debit or credit (not both, not zero)
      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        if (line.debit_amount === 0 && line.credit_amount === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Line ${i + 1}: amount must be non-zero` });
        }
        if (line.debit_amount > 0 && line.credit_amount > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Line ${i + 1}: cannot have both debit and credit` });
        }
      }

      const entryNumber = await generateEntryNumber(ctx.user.hospital_id, input.entry_date);

      // Insert header
      const inserted = await db.insert(journalEntries).values({
        hospital_id: ctx.user.hospital_id,
        entry_number: entryNumber,
        entry_date: input.entry_date,
        entry_type: input.entry_type,
        narration: input.narration,
        reference_type: input.reference_type || null,
        reference_id: input.reference_id || null,
        total_debit: String(totalDebit),
        total_credit: String(totalCredit),
        status: 'draft',
        created_by: ctx.user.sub,
      } as any).returning();

      // Insert lines
      for (const line of input.lines) {
        await db.insert(journalEntryLines).values({
          hospital_id: ctx.user.hospital_id,
          journal_entry_id: inserted[0].id,
          account_id: line.account_id,
          debit_amount: String(line.debit_amount),
          credit_amount: String(line.credit_amount),
          narration: line.narration || null,
          cost_center: line.cost_center || null,
        } as any);
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'journal_entries',
        row_id: inserted[0].id,
        new_values: { entry_number: entryNumber, total: totalDebit, lines: input.lines.length },
        reason: 'Manual journal entry created',
      });

      return inserted[0];
    }),

  // ─── POST (draft → posted) ─────────────
  post: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const je = await db.select()
        .from(journalEntries)
        .where(and(
          eq(journalEntries.id, input.id),
          eq(journalEntries.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!je.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
      if (je[0].status !== 'draft') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot post a ${je[0].status} entry. Only drafts can be posted.` });
      }

      const updated = await db.update(journalEntries)
        .set({
          status: 'posted',
          posted_by: ctx.user.sub,
          posted_at: new Date(),
        })
        .where(eq(journalEntries.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'journal_entries',
        row_id: input.id,
        new_values: { status: 'posted' },
        reason: `Journal entry ${je[0].entry_number} posted`,
      });

      return updated[0];
    }),

  // ─── REVERSE (posted → reversed, creates reversing JE) ─────────────
  reverse: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const je = await db.select()
        .from(journalEntries)
        .where(and(
          eq(journalEntries.id, input.id),
          eq(journalEntries.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!je.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
      if (je[0].status !== 'posted') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot reverse a ${je[0].status} entry. Only posted entries can be reversed.` });
      }

      // Get original lines
      const originalLines = await db.select()
        .from(journalEntryLines)
        .where(eq(journalEntryLines.journal_entry_id, input.id));

      // Create reversing entry (swap debits and credits)
      const today = new Date().toISOString().split('T')[0];
      const reversalNumber = await generateEntryNumber(ctx.user.hospital_id, today);

      const reversalJe = await db.insert(journalEntries).values({
        hospital_id: ctx.user.hospital_id,
        entry_number: reversalNumber,
        entry_date: today,
        entry_type: 'adjustment',
        narration: `Reversal of ${je[0].entry_number}: ${input.reason}`,
        reference_type: je[0].reference_type,
        reference_id: je[0].reference_id,
        total_debit: je[0].total_credit, // Swapped
        total_credit: je[0].total_debit,  // Swapped
        status: 'posted',
        posted_by: ctx.user.sub,
        posted_at: new Date(),
        created_by: ctx.user.sub,
      } as any).returning();

      // Insert reversed lines
      for (const line of originalLines) {
        await db.insert(journalEntryLines).values({
          hospital_id: ctx.user.hospital_id,
          journal_entry_id: reversalJe[0].id,
          account_id: line.account_id,
          debit_amount: line.credit_amount,  // Swapped
          credit_amount: line.debit_amount,   // Swapped
          narration: `Reversal: ${line.narration || ''}`,
          cost_center: line.cost_center,
        } as any);
      }

      // Mark original as reversed
      await db.update(journalEntries)
        .set({
          status: 'reversed',
          reversed_by: ctx.user.sub,
          reversed_at: new Date(),
          reversal_entry_id: reversalJe[0].id,
        })
        .where(eq(journalEntries.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'journal_entries',
        row_id: input.id,
        new_values: { status: 'reversed', reversal_entry_id: reversalJe[0].id },
        reason: `Reversed: ${input.reason}`,
      });

      return { original_id: input.id, reversal_id: reversalJe[0].id, reversal_number: reversalNumber };
    }),

  // ─── VOID (draft → voided) ─────────────
  void: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const je = await db.select()
        .from(journalEntries)
        .where(and(
          eq(journalEntries.id, input.id),
          eq(journalEntries.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!je.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
      if (je[0].status !== 'draft') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot void a ${je[0].status} entry. Only drafts can be voided.` });
      }

      await db.update(journalEntries)
        .set({ status: 'voided' })
        .where(eq(journalEntries.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'journal_entries',
        row_id: input.id,
        new_values: { status: 'voided' },
        reason: `Voided: ${input.reason}`,
      });

      return { success: true };
    }),

  // ─── GL VIEW (account-level transaction list with running balance) ─────────────
  glView: protectedProcedure
    .input(z.object({
      account_id: z.string().uuid(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const { account_id, date_from, date_to, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      // Get account info
      const account = await db.select()
        .from(chartOfAccounts)
        .where(and(
          eq(chartOfAccounts.id, account_id),
          eq(chartOfAccounts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!account.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });

      // Build conditions for lines (only from posted JEs)
      const jeConditions: any[] = [
        eq(journalEntries.hospital_id, ctx.user.hospital_id),
        eq(journalEntries.status, 'posted'),
      ];
      if (date_from) jeConditions.push(gte(journalEntries.entry_date, date_from));
      if (date_to) jeConditions.push(lte(journalEntries.entry_date, date_to));

      // Count total lines for this account
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .where(and(
          eq(journalEntryLines.account_id, account_id),
          ...jeConditions,
        ));
      const total = Number(countResult[0]?.count ?? 0);

      // Get lines with JE details
      const lines = await db.select({
        line_id: journalEntryLines.id,
        debit_amount: journalEntryLines.debit_amount,
        credit_amount: journalEntryLines.credit_amount,
        line_narration: journalEntryLines.narration,
        cost_center: journalEntryLines.cost_center,
        je_id: journalEntries.id,
        entry_number: journalEntries.entry_number,
        entry_date: journalEntries.entry_date,
        entry_type: journalEntries.entry_type,
        je_narration: journalEntries.narration,
        reference_type: journalEntries.reference_type,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .where(and(
          eq(journalEntryLines.account_id, account_id),
          ...jeConditions,
        ))
        .orderBy(asc(journalEntries.entry_date), asc(journalEntries.entry_number))
        .limit(pageSize)
        .offset(offset);

      // Calculate running balance
      // Opening balance = sum of all lines before the first visible line
      const openingResult = await db.select({
        total_debit: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
        total_credit: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .where(and(
          eq(journalEntryLines.account_id, account_id),
          ...jeConditions,
        ));

      const totalDebit = Number(openingResult[0]?.total_debit ?? 0);
      const totalCredit = Number(openingResult[0]?.total_credit ?? 0);
      const isDebitNormal = account[0].normal_balance === 'debit';
      const balance = isDebitNormal ? totalDebit - totalCredit : totalCredit - totalDebit;

      // Add running balance to each line
      let runningBalance = Number(account[0].opening_balance || 0);
      const linesWithBalance = lines.map(line => {
        const dr = Number(line.debit_amount);
        const cr = Number(line.credit_amount);
        if (isDebitNormal) {
          runningBalance += dr - cr;
        } else {
          runningBalance += cr - dr;
        }
        return { ...line, running_balance: runningBalance };
      });

      return {
        account: account[0],
        lines: linesWithBalance,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        summary: {
          total_debit: totalDebit,
          total_credit: totalCredit,
          balance,
          balance_type: isDebitNormal ? 'debit' : 'credit',
        },
      };
    }),

  // ─── TRIAL BALANCE (all accounts with debit/credit totals) ─────────────
  trialBalance: protectedProcedure
    .input(z.object({
      as_of_date: z.string().optional(), // If omitted, all time
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const jeConditions: any[] = [
        eq(journalEntries.hospital_id, ctx.user.hospital_id),
        eq(journalEntries.status, 'posted'),
      ];
      if (input.as_of_date) {
        jeConditions.push(lte(journalEntries.entry_date, input.as_of_date));
      }

      const result = await db.select({
        account_id: journalEntryLines.account_id,
        account_code: chartOfAccounts.account_code,
        account_name: chartOfAccounts.account_name,
        account_type: chartOfAccounts.account_type,
        normal_balance: chartOfAccounts.normal_balance,
        opening_balance: chartOfAccounts.opening_balance,
        total_debit: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
        total_credit: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(and(...jeConditions))
        .groupBy(
          journalEntryLines.account_id,
          chartOfAccounts.account_code,
          chartOfAccounts.account_name,
          chartOfAccounts.account_type,
          chartOfAccounts.normal_balance,
          chartOfAccounts.opening_balance,
        )
        .orderBy(asc(chartOfAccounts.account_code));

      let grandDebit = 0;
      let grandCredit = 0;

      const accounts = result.map(r => {
        const dr = Number(r.total_debit);
        const cr = Number(r.total_credit);
        const opening = Number(r.opening_balance || 0);
        const isDebitNormal = r.normal_balance === 'debit';
        const net = isDebitNormal ? (opening + dr - cr) : (opening + cr - dr);

        // For trial balance display: net positive debit-normal → debit column, etc.
        const tbDebit = isDebitNormal ? (net >= 0 ? net : 0) : (net < 0 ? Math.abs(net) : 0);
        const tbCredit = isDebitNormal ? (net < 0 ? Math.abs(net) : 0) : (net >= 0 ? net : 0);

        grandDebit += tbDebit;
        grandCredit += tbCredit;

        return {
          ...r,
          total_debit: dr,
          total_credit: cr,
          closing_balance: net,
          tb_debit: tbDebit,
          tb_credit: tbCredit,
        };
      });

      return {
        accounts,
        grand_total_debit: grandDebit,
        grand_total_credit: grandCredit,
        is_balanced: Math.abs(grandDebit - grandCredit) < 0.01,
      };
    }),

  // ─── STATS ─────────────
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const result = await db.select({
        status: journalEntries.status,
        count: sql<number>`count(*)`,
        total_amount: sql<number>`COALESCE(SUM(${journalEntries.total_debit}), 0)`,
      })
        .from(journalEntries)
        .where(eq(journalEntries.hospital_id, ctx.user.hospital_id))
        .groupBy(journalEntries.status);

      const byType = await db.select({
        entry_type: journalEntries.entry_type,
        count: sql<number>`count(*)`,
      })
        .from(journalEntries)
        .where(eq(journalEntries.hospital_id, ctx.user.hospital_id))
        .groupBy(journalEntries.entry_type);

      return {
        by_status: result.map(r => ({
          status: r.status,
          count: Number(r.count),
          total_amount: Number(r.total_amount),
        })),
        by_type: byType.map(r => ({
          entry_type: r.entry_type,
          count: Number(r.count),
        })),
        total_entries: result.reduce((sum, r) => sum + Number(r.count), 0),
      };
    }),

  // ─── DEPOSIT TRANSACTIONS (list for a patient/encounter) ─────────────
  depositTransactions: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(depositTransactions.hospital_id, ctx.user.hospital_id)];
      if (input.patient_id) conditions.push(eq(depositTransactions.patient_id, input.patient_id));
      if (input.encounter_id) conditions.push(eq(depositTransactions.encounter_id, input.encounter_id));

      const offset = (input.page - 1) * input.pageSize;
      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(depositTransactions).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(depositTransactions)
        .where(where)
        .orderBy(desc(depositTransactions.created_at))
        .limit(input.pageSize)
        .offset(offset);

      // Net balance
      const balResult = await db.select({
        collections: sql<number>`COALESCE(SUM(CASE WHEN ${depositTransactions.txn_type} = 'collection' THEN ${depositTransactions.amount} ELSE 0 END), 0)`,
        applications: sql<number>`COALESCE(SUM(CASE WHEN ${depositTransactions.txn_type} = 'application' THEN ${depositTransactions.amount} ELSE 0 END), 0)`,
        refunds: sql<number>`COALESCE(SUM(CASE WHEN ${depositTransactions.txn_type} = 'refund' THEN ${depositTransactions.amount} ELSE 0 END), 0)`,
      })
        .from(depositTransactions)
        .where(where);

      const collections = Number(balResult[0]?.collections ?? 0);
      const applications = Number(balResult[0]?.applications ?? 0);
      const refunds = Number(balResult[0]?.refunds ?? 0);

      return {
        items: rows,
        total,
        page: input.page,
        pageSize: input.pageSize,
        balance: {
          collections,
          applications,
          refunds,
          net_deposit: collections - applications - refunds,
        },
      };
    }),
});
