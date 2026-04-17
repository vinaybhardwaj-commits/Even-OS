import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  insurerRules, ruleApplications, insurers,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { evaluateRules, type BillContext, type InsurerRule } from '@/lib/billing/rule-evaluator';
import { eq, and, sql, desc, ilike, or, count } from 'drizzle-orm';

// ============================================================
// BILL CONTEXT SCHEMA
// ============================================================

const billContextSchema = z.object({
  encounter_id: z.string().optional(),
  patient_id: z.string().optional(),
  patient_age: z.number().optional(),
  admission_date: z.string().optional(),
  network_tier: z.enum(['preferred', 'standard', 'non_network']).optional(),
  sum_insured: z.number().optional(),
  room_type: z.string().optional(),
  diagnosis_codes: z.array(z.string()).optional(),
  line_items: z.array(z.object({
    id: z.string(),
    charge_code: z.string().optional(),
    charge_name: z.string(),
    category: z.string(),
    amount: z.number(),
    quantity: z.number(),
    days: z.number().optional(),
    room_type: z.string().optional(),
    procedure_code: z.string().optional(),
    disease_codes: z.array(z.string()).optional(),
    is_implant: z.boolean().optional(),
  })),
});

// ============================================================
// INSURER RULES ROUTER
// ============================================================

export const insurerRulesRouter = router({

  // ── LIST RULES ──────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      insurer_id: z.string().uuid().optional(),
      rule_type: z.enum([
        'room_rent_cap', 'proportional_deduction', 'co_pay', 'item_exclusion',
        'sub_limit', 'package_rate', 'waiting_period', 'disease_cap',
        'network_tier_pricing', 'category_cap',
      ]).optional(),
      status: z.enum(['active', 'draft', 'archived']).optional(),
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      // Build WHERE clause
      const conditions: any[] = [eq(insurerRules.hospital_id, hospitalId)];

      if (input.insurer_id) {
        conditions.push(eq(insurerRules.insurer_id, input.insurer_id as any));
      }

      if (input.rule_type) {
        conditions.push(eq(insurerRules.rule_type, input.rule_type as any));
      }

      if (input.status) {
        conditions.push(eq(insurerRules.status, input.status as any));
      }

      if (input.search) {
        conditions.push(
          or(
            ilike(insurerRules.rule_name, `%${input.search}%`),
            ilike(insurerRules.description, `%${input.search}%`),
          )
        );
      }

      // Fetch rules with insurer name
      const rules = await db.select({
        id: insurerRules.id,
        rule_name: insurerRules.rule_name,
        rule_type: insurerRules.rule_type,
        description: insurerRules.description,
        priority: insurerRules.priority,
        status: insurerRules.status,
        version: insurerRules.version,
        effective_from: insurerRules.effective_from,
        effective_to: insurerRules.effective_to,
        created_at: insurerRules.created_at,
        updated_at: insurerRules.updated_at,
        insurer_name: insurers.insurer_name,
        insurer_id: insurerRules.insurer_id,
      })
        .from(insurerRules)
        .leftJoin(insurers, eq(insurerRules.insurer_id, insurers.id))
        .where(and(...conditions))
        .orderBy(desc(insurerRules.priority), desc(insurerRules.created_at))
        .limit(input.limit)
        .offset(offset);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(insurerRules)
        .where(and(...conditions));

      const total = countResult?.total || 0;

      return {
        rules,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          pages: Math.ceil(total / input.limit),
        },
      };
    }),

  // ── GET RULE ────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({
      rule_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [rule] = await db.select({
        id: insurerRules.id,
        rule_name: insurerRules.rule_name,
        rule_type: insurerRules.rule_type,
        description: insurerRules.description,
        priority: insurerRules.priority,
        conditions: insurerRules.conditions,
        parameters: insurerRules.parameters,
        status: insurerRules.status,
        version: insurerRules.version,
        parent_rule_id: insurerRules.parent_rule_id,
        effective_from: insurerRules.effective_from,
        effective_to: insurerRules.effective_to,
        created_by: insurerRules.created_by,
        created_at: insurerRules.created_at,
        updated_at: insurerRules.updated_at,
        insurer_name: insurers.insurer_name,
        insurer_id: insurerRules.insurer_id,
      })
        .from(insurerRules)
        .leftJoin(insurers, eq(insurerRules.insurer_id, insurers.id))
        .where(and(
          eq(insurerRules.id, input.rule_id as any),
          eq(insurerRules.hospital_id, hospitalId),
        ));

      if (!rule) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Rule not found',
        });
      }

      return rule;
    }),

  // ── CREATE RULE ─────────────────────────────────────────────
  create: adminProcedure
    .input(z.object({
      insurer_id: z.string().uuid(),
      rule_name: z.string().min(1).max(255),
      rule_type: z.enum([
        'room_rent_cap', 'proportional_deduction', 'co_pay', 'item_exclusion',
        'sub_limit', 'package_rate', 'waiting_period', 'disease_cap',
        'network_tier_pricing', 'category_cap',
      ]),
      description: z.string().max(1000).optional(),
      priority: z.number().int().min(0).default(0),
      conditions: z.record(z.any()).default({}),
      parameters: z.record(z.any()),
      status: z.enum(['active', 'draft', 'archived']).default('draft'),
      effective_from: z.string().datetime().optional(),
      effective_to: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Verify insurer exists
      const [insurer] = await db.select({ id: insurers.id })
        .from(insurers)
        .where(and(
          eq(insurers.id, input.insurer_id as any),
          eq(insurers.hospital_id, hospitalId),
        ));

      if (!insurer) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Insurer not found',
        });
      }

      // Create rule
      const [rule] = await db.insert(insurerRules).values({
        hospital_id: hospitalId,
        insurer_id: input.insurer_id,
        rule_name: input.rule_name,
        rule_type: input.rule_type,
        description: input.description || null,
        priority: input.priority,
        conditions: input.conditions,
        parameters: input.parameters,
        version: 1,
        parent_rule_id: null,
        status: input.status,
        effective_from: input.effective_from ? new Date(input.effective_from) : null,
        effective_to: input.effective_to ? new Date(input.effective_to) : null,
        created_by: userId,
      }).returning();

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'insurer_rules',
        row_id: rule.id,
        new_values: {
          rule_name: input.rule_name,
          rule_type: input.rule_type,
          status: input.status,
          priority: input.priority,
        },
      });

      return rule;
    }),

  // ── UPDATE RULE (creates new version) ───────────────────────
  update: adminProcedure
    .input(z.object({
      rule_id: z.string().uuid(),
      rule_name: z.string().min(1).max(255).optional(),
      rule_type: z.enum([
        'room_rent_cap', 'proportional_deduction', 'co_pay', 'item_exclusion',
        'sub_limit', 'package_rate', 'waiting_period', 'disease_cap',
        'network_tier_pricing', 'category_cap',
      ]).optional(),
      description: z.string().max(1000).optional(),
      priority: z.number().int().min(0).optional(),
      conditions: z.record(z.any()).optional(),
      parameters: z.record(z.any()).optional(),
      status: z.enum(['active', 'draft', 'archived']).optional(),
      effective_from: z.string().datetime().optional(),
      effective_to: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Get current rule
      const [currentRule] = await db.select()
        .from(insurerRules)
        .where(and(
          eq(insurerRules.id, input.rule_id as any),
          eq(insurerRules.hospital_id, hospitalId),
        ));

      if (!currentRule) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Rule not found',
        });
      }

      // Archive current rule
      await db.update(insurerRules)
        .set({ status: 'archived' })
        .where(eq(insurerRules.id, input.rule_id as any));

      // Create new version
      const [newRule] = await db.insert(insurerRules).values({
        hospital_id: hospitalId,
        insurer_id: currentRule.insurer_id,
        rule_name: input.rule_name || currentRule.rule_name,
        rule_type: input.rule_type || currentRule.rule_type,
        description: input.description !== undefined ? input.description : currentRule.description,
        priority: input.priority !== undefined ? input.priority : currentRule.priority,
        conditions: input.conditions || currentRule.conditions,
        parameters: input.parameters || currentRule.parameters,
        version: (currentRule.version || 1) + 1,
        parent_rule_id: input.rule_id,
        status: input.status || currentRule.status,
        effective_from: input.effective_from ? new Date(input.effective_from) : currentRule.effective_from,
        effective_to: input.effective_to ? new Date(input.effective_to) : currentRule.effective_to,
        created_by: userId,
      }).returning();

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'insurer_rules',
        row_id: newRule.id,
        old_values: { version: currentRule.version },
        new_values: { version: newRule.version, parent_rule_id: input.rule_id },
      });

      return newRule;
    }),

  // ── ARCHIVE RULE ────────────────────────────────────────────
  archive: adminProcedure
    .input(z.object({
      rule_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Get rule
      const [rule] = await db.select()
        .from(insurerRules)
        .where(and(
          eq(insurerRules.id, input.rule_id as any),
          eq(insurerRules.hospital_id, hospitalId),
        ));

      if (!rule) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Rule not found',
        });
      }

      // Archive
      await db.update(insurerRules)
        .set({ status: 'archived' })
        .where(eq(insurerRules.id, input.rule_id as any));

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'insurer_rules',
        row_id: input.rule_id,
        old_values: { status: rule.status },
        new_values: { status: 'archived' },
      });

      return { success: true };
    }),

  // ── ACTIVATE RULE ───────────────────────────────────────────
  activate: adminProcedure
    .input(z.object({
      rule_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Get rule
      const [rule] = await db.select()
        .from(insurerRules)
        .where(and(
          eq(insurerRules.id, input.rule_id as any),
          eq(insurerRules.hospital_id, hospitalId),
        ));

      if (!rule) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Rule not found',
        });
      }

      // Activate
      await db.update(insurerRules)
        .set({ status: 'active' })
        .where(eq(insurerRules.id, input.rule_id as any));

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'insurer_rules',
        row_id: input.rule_id,
        old_values: { status: rule.status },
        new_values: { status: 'active' },
      });

      return { success: true };
    }),

  // ── EVALUATE RULES (dry-run) ────────────────────────────────
  evaluate: protectedProcedure
    .input(z.object({
      insurer_id: z.string().uuid(),
      bill_context: billContextSchema,
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Load all active rules for this insurer
      const rules = await db.select({
        id: insurerRules.id,
        rule_name: insurerRules.rule_name,
        rule_type: insurerRules.rule_type,
        priority: insurerRules.priority,
        conditions: insurerRules.conditions,
        parameters: insurerRules.parameters,
        status: insurerRules.status,
      })
        .from(insurerRules)
        .where(and(
          eq(insurerRules.hospital_id, hospitalId),
          eq(insurerRules.insurer_id, input.insurer_id as any),
          eq(insurerRules.status, 'active'),
        ))
        .orderBy(desc(insurerRules.priority));

      // Convert to InsurerRule format
      const mappedRules: InsurerRule[] = rules.map(r => ({
        id: r.id,
        rule_name: r.rule_name,
        rule_type: r.rule_type,
        priority: r.priority,
        conditions: r.conditions || {},
        parameters: r.parameters || {},
        status: r.status,
      }));

      // Evaluate
      const result = evaluateRules(mappedRules, input.bill_context);

      return result;
    }),

  // ── EVALUATE AND SAVE ───────────────────────────────────────
  evaluateAndSave: adminProcedure
    .input(z.object({
      insurer_id: z.string().uuid(),
      bill_context: billContextSchema,
      encounter_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      bill_id: z.string().uuid().optional(),
      is_simulation: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Load all active rules
      const rules = await db.select({
        id: insurerRules.id,
        rule_name: insurerRules.rule_name,
        rule_type: insurerRules.rule_type,
        priority: insurerRules.priority,
        conditions: insurerRules.conditions,
        parameters: insurerRules.parameters,
        status: insurerRules.status,
      })
        .from(insurerRules)
        .where(and(
          eq(insurerRules.hospital_id, hospitalId),
          eq(insurerRules.insurer_id, input.insurer_id as any),
          eq(insurerRules.status, 'active'),
        ))
        .orderBy(desc(insurerRules.priority));

      // Map to InsurerRule format
      const mappedRules: InsurerRule[] = rules.map(r => ({
        id: r.id,
        rule_name: r.rule_name,
        rule_type: r.rule_type,
        priority: r.priority,
        conditions: r.conditions || {},
        parameters: r.parameters || {},
        status: r.status,
      }));

      // Evaluate
      const evaluation = evaluateRules(mappedRules, input.bill_context);

      // Save each rule result
      for (const result of evaluation.rule_results) {
        await db.insert(ruleApplications).values({
          hospital_id: hospitalId,
          rule_id: result.rule_id as any,
          insurer_id: input.insurer_id as any,
          encounter_id: input.encounter_id ? (input.encounter_id as any) : null,
          patient_id: input.patient_id ? (input.patient_id as any) : null,
          bill_id: input.bill_id ? (input.bill_id as any) : null,
          original_amount: String(result.original_amount),
          adjusted_amount: String(result.adjusted_amount),
          deduction_amount: String(result.deduction_amount),
          explanation: result.explanation,
          evaluation_context: input.bill_context,
          is_simulation: input.is_simulation,
          applied_by: userId as any,
        } as any);
      }

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'rule_applications',
        row_id: 'batch',
        new_values: {
          insurer_id: input.insurer_id,
          total_deduction: evaluation.total_deduction,
          rules_applied: evaluation.rule_results.length,
          is_simulation: input.is_simulation,
        },
      });

      return {
        ...evaluation,
        saved: true,
        applications_count: evaluation.rule_results.length,
      };
    }),

  // ── GET RULE APPLICATIONS ───────────────────────────────────
  getApplications: protectedProcedure
    .input(z.object({
      insurer_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      bill_id: z.string().uuid().optional(),
      is_simulation: z.boolean().optional(),
      days: z.number().int().min(1).default(30),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      // Build WHERE clause
      const conditions: any[] = [eq(ruleApplications.hospital_id, hospitalId)];

      // Date filter (last N days)
      const nDaysAgo = new Date();
      nDaysAgo.setDate(nDaysAgo.getDate() - input.days);
      conditions.push(sql`${ruleApplications.applied_at} >= ${nDaysAgo}`);

      if (input.insurer_id) {
        conditions.push(eq(ruleApplications.insurer_id, input.insurer_id as any));
      }

      if (input.encounter_id) {
        conditions.push(eq(ruleApplications.encounter_id, input.encounter_id as any));
      }

      if (input.patient_id) {
        conditions.push(eq(ruleApplications.patient_id, input.patient_id as any));
      }

      if (input.bill_id) {
        conditions.push(eq(ruleApplications.bill_id, input.bill_id as any));
      }

      if (input.is_simulation !== undefined) {
        conditions.push(eq(ruleApplications.is_simulation, input.is_simulation));
      }

      // Fetch applications with rule and insurer names
      const applications = await db.select({
        id: ruleApplications.id,
        rule_id: ruleApplications.rule_id,
        rule_name: insurerRules.rule_name,
        insurer_id: ruleApplications.insurer_id,
        insurer_name: insurers.insurer_name,
        encounter_id: ruleApplications.encounter_id,
        patient_id: ruleApplications.patient_id,
        bill_id: ruleApplications.bill_id,
        original_amount: ruleApplications.original_amount,
        adjusted_amount: ruleApplications.adjusted_amount,
        deduction_amount: ruleApplications.deduction_amount,
        explanation: ruleApplications.explanation,
        is_simulation: ruleApplications.is_simulation,
        applied_at: ruleApplications.applied_at,
      })
        .from(ruleApplications)
        .leftJoin(insurerRules, eq(ruleApplications.rule_id, insurerRules.id))
        .leftJoin(insurers, eq(ruleApplications.insurer_id, insurers.id))
        .where(and(...conditions))
        .orderBy(desc(ruleApplications.applied_at))
        .limit(input.limit)
        .offset(offset);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(ruleApplications)
        .where(and(...conditions));

      const total = countResult?.total || 0;

      return {
        applications,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          pages: Math.ceil(total / input.limit),
        },
      };
    }),

  // ── GET VERSION HISTORY ─────────────────────────────────────
  getVersionHistory: protectedProcedure
    .input(z.object({
      rule_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Get the rule to start from
      const [startRule] = await db.select()
        .from(insurerRules)
        .where(and(
          eq(insurerRules.id, input.rule_id as any),
          eq(insurerRules.hospital_id, hospitalId),
        ));

      if (!startRule) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Rule not found',
        });
      }

      // Walk the chain backwards
      const history = [startRule];
      let current = startRule;

      while (current.parent_rule_id) {
        const [parent] = await db.select()
          .from(insurerRules)
          .where(eq(insurerRules.id, current.parent_rule_id));

        if (!parent) break;
        history.push(parent);
        current = parent;
      }

      return {
        current_rule_id: input.rule_id,
        version_count: history.length,
        history: history.map(r => ({
          rule_id: r.id,
          version: r.version,
          rule_name: r.rule_name,
          status: r.status,
          created_at: r.created_at,
          created_by: r.created_by,
          priority: r.priority,
          parent_rule_id: r.parent_rule_id,
        })),
      };
    }),

  // ── STATS ───────────────────────────────────────────────────
  stats: protectedProcedure
    .input(z.object({
      insurer_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Count rules by type
      const rulesByType = await db.execute(sql`
        SELECT rule_type, COUNT(*) as count
        FROM insurer_rules
        WHERE hospital_id = ${hospitalId}
          AND status = 'active'
          ${input.insurer_id ? sql`AND insurer_id = ${input.insurer_id}::uuid` : sql``}
        GROUP BY rule_type
      `);

      // Count rules by status
      const rulesByStatus = await db.execute(sql`
        SELECT status, COUNT(*) as count
        FROM insurer_rules
        WHERE hospital_id = ${hospitalId}
          ${input.insurer_id ? sql`AND insurer_id = ${input.insurer_id}::uuid` : sql``}
        GROUP BY status
      `);

      // Count rules by insurer (if not filtered)
      const rulesByInsurer = !input.insurer_id
        ? await db.execute(sql`
            SELECT i.id, i.insurer_name, COUNT(ir.id) as count
            FROM insurers i
            LEFT JOIN insurer_rules ir ON ir.insurer_id = i.id AND ir.status = 'active'
            WHERE i.hospital_id = ${hospitalId}
            GROUP BY i.id, i.insurer_name
          `)
        : [];

      // Total applications in last 30 days
      const nDaysAgo = new Date();
      nDaysAgo.setDate(nDaysAgo.getDate() - 30);

      const appConditions = [
        eq(ruleApplications.hospital_id, hospitalId),
        sql`${ruleApplications.applied_at} >= ${nDaysAgo}`,
      ];
      if (input.insurer_id) appConditions.push(eq(ruleApplications.insurer_id, input.insurer_id as any));

      const [appStats] = await db
        .select({
          total_applications: sql<number>`count(*)`,
          total_deductions: sql<number>`COALESCE(SUM(deduction_amount), 0)`,
        })
        .from(ruleApplications)
        .where(and(...appConditions));

      return {
        rules_by_type: ((rulesByType as any).rows || rulesByType).reduce(
          (acc: any, row: any) => ({ ...acc, [row.rule_type]: row.count }),
          {},
        ),
        rules_by_status: ((rulesByStatus as any).rows || rulesByStatus).reduce(
          (acc: any, row: any) => ({ ...acc, [row.status]: row.count }),
          {},
        ),
        rules_by_insurer: ((rulesByInsurer as any).rows || rulesByInsurer).map((row: any) => ({
          insurer_id: row.id,
          insurer_name: row.insurer_name,
          active_rules: row.count,
        })),
        applications_30d: {
          total_applications: appStats?.total_applications || 0,
          total_deductions: appStats?.total_deductions || 0,
          avg_deduction: appStats?.total_applications > 0
            ? (appStats?.total_deductions || 0) / appStats?.total_applications
            : 0,
        },
      };
    }),

});
