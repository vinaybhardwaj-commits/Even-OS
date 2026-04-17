import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { billAdjustments, adjustmentConfig } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const ROLE_TIERS: Record<string, number> = {
  billing_exec: 1,
  billing_manager: 2,
  accounts_manager: 3,
  gm: 4,
  hospital_admin: 4,
  super_admin: 4,
};

interface TierResult {
  tier: number;
  approverRole: string;
  autoApprove: boolean;
}

function computeTier(
  amount: number,
  adjustmentType: string,
  category: string | null,
  config: any
): TierResult {
  const thresholds = config.waiver_tier_thresholds || {
    tier_1_max: 5000,
    tier_2_max: 50000,
    tier_3_max: 200000,
    tier_4_max: Infinity,
    tier_1_role: 'billing_exec',
    tier_2_role: 'billing_manager',
    tier_3_role: 'accounts_manager',
    tier_4_role: 'gm',
  };

  const categoryOverrides = config.waiver_category_overrides || {};

  // Check category/type overrides
  let forcedTier = 0;
  if (adjustmentType === 'hardship' || category === 'financial_hardship') {
    forcedTier = 4;
  } else if (adjustmentType === 'write_off') {
    forcedTier = 3;
  }

  // Compute tier from amount
  let amountTier = 1;
  if (amount <= thresholds.tier_1_max) {
    amountTier = 1;
  } else if (amount <= thresholds.tier_2_max) {
    amountTier = 2;
  } else if (amount <= thresholds.tier_3_max) {
    amountTier = 3;
  } else {
    amountTier = 4;
  }

  // Take max of forced and amount-based tier
  const tier = Math.max(forcedTier, amountTier);

  // Determine approver role
  let approverRole = thresholds.tier_1_role;
  if (tier === 2) approverRole = thresholds.tier_2_role;
  else if (tier === 3) approverRole = thresholds.tier_3_role;
  else if (tier === 4) approverRole = thresholds.tier_4_role;

  // Auto-approve if tier1 and autoApprove flag is set
  const autoApprove = tier === 1 && config.auto_approve_tier_1 === true;

  return { tier, approverRole, autoApprove };
}

function canApprove(userRole: string, tierRequired: number): boolean {
  return (ROLE_TIERS[userRole] || 0) >= tierRequired;
}

// ============================================================================
// ROUTER
// ============================================================================

export const billAdjustmentsRouter = router({
  // 1. LIST
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        adjustment_type: z.string().optional(),
        encounter_id: z.string().uuid().optional(),
        patient_id: z.string().uuid().optional(),
        days: z.number().int().positive().default(30),
        page: z.number().int().positive().default(1),
        limit: z.number().int().positive().max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;
      const conditions = [eq(billAdjustments.hospital_id, ctx.user.hospital_id)];

      if (input.status) {
        conditions.push(eq(billAdjustments.status, input.status as any));
      }

      if (input.adjustment_type) {
        conditions.push(eq(billAdjustments.adjustment_type, input.adjustment_type as any));
      }

      if (input.encounter_id) {
        conditions.push(eq(billAdjustments.encounter_id, input.encounter_id));
      }

      if (input.patient_id) {
        conditions.push(eq(billAdjustments.patient_id, input.patient_id));
      }

      // Date filter: created_at >= NOW() - days interval
      conditions.push(
        sql`${billAdjustments.created_at} >= NOW() - INTERVAL '${sql.raw(
          String(input.days)
        )} days'`
      );

      const items = await db
        .select()
        .from(billAdjustments)
        .where(and(...conditions))
        .orderBy(desc(billAdjustments.created_at))
        .limit(input.limit)
        .offset(offset);

      const totalResult = await db
        .select({ count: sql`COUNT(*)` })
        .from(billAdjustments)
        .where(and(...conditions));

      const total = parseInt(String(totalResult[0]?.count || 0));
      const totalPages = Math.ceil(total / input.limit);

      return {
        items,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
      };
    }),

  // 2. GET
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await db
        .select()
        .from(billAdjustments)
        .where(
          and(
            eq(billAdjustments.id, input.id),
            eq(billAdjustments.hospital_id, ctx.user.hospital_id)
          )
        )
        .limit(1);

      if (!row.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bill adjustment not found',
        });
      }

      return row[0];
    }),

  // 3. MY QUEUE
  myQueue: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const userTierMax = ROLE_TIERS[ctx.user.role] || 0;

      const rows = await db
        .select()
        .from(billAdjustments)
        .where(
          and(
            eq(billAdjustments.hospital_id, ctx.user.hospital_id),
            eq(billAdjustments.status, 'pending'),
            sql`${billAdjustments.tier_required} <= ${userTierMax}`
          )
        )
        .orderBy(billAdjustments.created_at)
        .limit(input?.limit || 50);

      return rows;
    }),

  // 4. REQUEST
  request: protectedProcedure
    .input(
      z.object({
        encounter_id: z.string().uuid().optional(),
        patient_id: z.string().uuid().optional(),
        bill_id: z.string().uuid().optional(),
        billing_account_id: z.string().uuid().optional(),
        adjustment_type: z.enum(['waiver', 'discount', 'write_off', 'hardship', 'goodwill', 'rounding']),
        adjustment_amount: z.number().positive(),
        original_amount: z.number().positive(),
        reason: z.string().min(1),
        category: z.string().optional(),
        justification: z.string().optional(),
        discount_percentage: z.number().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Load tier config from adjustmentConfig
      const configRows = await db
        .select()
        .from(adjustmentConfig)
        .where(
          and(
            eq(adjustmentConfig.hospital_id, ctx.user.hospital_id),
            eq(adjustmentConfig.config_key, 'waiver_governance')
          )
        )
        .limit(1);

      const config = configRows.length ? configRows[0].config_value : {};

      // Compute tier
      const tierResult = computeTier(
        input.adjustment_amount,
        input.adjustment_type,
        input.category || null,
        config
      );

      // Calculate adjusted amount
      const adjusted_amount = input.original_amount - input.adjustment_amount;

      // Build initial approval chain
      const initialChain = [
        {
          tier: 0,
          action: 'requested',
          user_id: ctx.user.sub,
          user_name: ctx.user.name,
          timestamp: new Date().toISOString(),
        },
      ];

      // Determine initial status
      let status = 'pending';
      let resolved_at = null;
      let approved_by = null;

      if (tierResult.autoApprove) {
        status = `approved_tier${tierResult.tier}`;
        resolved_at = new Date();
        approved_by = ctx.user.sub;
      }

      // Insert new adjustment
      const newId = crypto.randomUUID();
      await db.insert(billAdjustments).values({
        id: newId as any,
        hospital_id: ctx.user.hospital_id as any,
        encounter_id: input.encounter_id as any,
        patient_id: input.patient_id as any,
        bill_id: input.bill_id as any,
        billing_account_id: input.billing_account_id as any,
        adjustment_type: input.adjustment_type as any,
        adjustment_amount: String(input.adjustment_amount) as any,
        original_amount: String(input.original_amount) as any,
        adjusted_amount: String(adjusted_amount) as any,
        discount_percentage: input.discount_percentage ? String(input.discount_percentage) : null as any,
        reason: input.reason as any,
        category: input.category || null as any,
        justification: input.justification || null as any,
        supporting_docs: null as any,
        status: status as any,
        current_approver_role: tierResult.autoApprove ? null : (tierResult.approverRole as any),
        tier_required: tierResult.tier as any,
        approval_chain: initialChain as any,
        rejection_reason: null as any,
        rejected_by: null as any,
        version: 1 as any,
        parent_adjustment_id: null as any,
        requested_by: ctx.user.sub as any,
        approved_by: approved_by as any,
        created_at: new Date() as any,
        updated_at: new Date() as any,
        resolved_at: resolved_at as any,
      });

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'bill_adjustments',
        row_id: newId,
        new_values: {
          adjustment_type: input.adjustment_type,
          adjustment_amount: input.adjustment_amount,
          status,
          tier_required: tierResult.tier,
        },
        reason: `Created bill adjustment: ${input.reason}`,
      });

      return { id: newId, status, tier: tierResult.tier };
    }),

  // 5. APPROVE
  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid(), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Load adjustment
      const rows = await db
        .select()
        .from(billAdjustments)
        .where(
          and(
            eq(billAdjustments.id, input.id),
            eq(billAdjustments.hospital_id, ctx.user.hospital_id)
          )
        )
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bill adjustment not found',
        });
      }

      const row = rows[0];

      // Check status is pending
      if (row.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Can only approve pending adjustments',
        });
      }

      // Check permission
      if (!canApprove(ctx.user.role, row.tier_required)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Your role cannot approve tier ${row.tier_required} adjustments`,
        });
      }

      // New status
      const newStatus = `approved_tier${row.tier_required}`;

      // Append to approval chain
      const chainArray = Array.isArray(row.approval_chain) ? row.approval_chain : [];
      chainArray.push({
        tier: row.tier_required,
        action: 'approved',
        user_id: ctx.user.sub,
        user_name: ctx.user.name,
        timestamp: new Date().toISOString(),
        notes: input.notes,
      });

      // Update
      await db
        .update(billAdjustments)
        .set({
          status: newStatus as any,
          approval_chain: chainArray as any,
          approved_by: ctx.user.sub as any,
          current_approver_role: null as any,
          resolved_at: new Date() as any,
          updated_at: new Date() as any,
        })
        .where(eq(billAdjustments.id, input.id));

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'bill_adjustments',
        row_id: input.id,
        old_values: { status: row.status },
        new_values: { status: newStatus },
        reason: `Approved bill adjustment at tier ${row.tier_required}${input.notes ? ': ' + input.notes : ''}`,
      });

      return { status: newStatus };
    }),

  // 6. REJECT
  reject: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        rejection_reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Load adjustment
      const rows = await db
        .select()
        .from(billAdjustments)
        .where(
          and(
            eq(billAdjustments.id, input.id),
            eq(billAdjustments.hospital_id, ctx.user.hospital_id)
          )
        )
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bill adjustment not found',
        });
      }

      const row = rows[0];

      // Check status is pending
      if (row.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Can only reject pending adjustments',
        });
      }

      // Check permission
      if (!canApprove(ctx.user.role, row.tier_required)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Your role cannot reject tier ${row.tier_required} adjustments`,
        });
      }

      // Append to approval chain
      const chainArray = Array.isArray(row.approval_chain) ? row.approval_chain : [];
      chainArray.push({
        tier: row.tier_required,
        action: 'rejected',
        user_id: ctx.user.sub,
        user_name: ctx.user.name,
        timestamp: new Date().toISOString(),
        reason: input.rejection_reason,
      });

      // Update
      await db
        .update(billAdjustments)
        .set({
          status: 'rejected' as any,
          approval_chain: chainArray as any,
          rejection_reason: input.rejection_reason as any,
          rejected_by: ctx.user.sub as any,
          current_approver_role: null as any,
          resolved_at: new Date() as any,
          updated_at: new Date() as any,
        })
        .where(eq(billAdjustments.id, input.id));

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'bill_adjustments',
        row_id: input.id,
        old_values: { status: row.status },
        new_values: { status: 'rejected' },
        reason: `Rejected bill adjustment: ${input.rejection_reason}`,
      });

      return { status: 'rejected' };
    }),

  // 7. CANCEL
  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Load adjustment
      const rows = await db
        .select()
        .from(billAdjustments)
        .where(
          and(
            eq(billAdjustments.id, input.id),
            eq(billAdjustments.hospital_id, ctx.user.hospital_id)
          )
        )
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bill adjustment not found',
        });
      }

      const row = rows[0];

      // Check requester
      if (row.requested_by !== ctx.user.sub) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the requester can cancel an adjustment',
        });
      }

      // Check status is pending
      if (row.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Can only cancel pending adjustments',
        });
      }

      // Update
      await db
        .update(billAdjustments)
        .set({
          status: 'cancelled' as any,
          updated_at: new Date() as any,
        })
        .where(eq(billAdjustments.id, input.id));

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'bill_adjustments',
        row_id: input.id,
        old_values: { status: row.status },
        new_values: { status: 'cancelled' },
        reason: 'Requester cancelled adjustment',
      });

      return { status: 'cancelled' };
    }),

  // 8. REVISE
  revise: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        adjustment_amount: z.number().positive(),
        reason: z.string().min(1),
        justification: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Load adjustment
      const rows = await db
        .select()
        .from(billAdjustments)
        .where(
          and(
            eq(billAdjustments.id, input.id),
            eq(billAdjustments.hospital_id, ctx.user.hospital_id)
          )
        )
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bill adjustment not found',
        });
      }

      const row = rows[0];

      // Check requester
      if (row.requested_by !== ctx.user.sub) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the requester can revise an adjustment',
        });
      }

      // Check status is pending or rejected
      if (row.status !== 'pending' && row.status !== 'rejected') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Can only revise pending or rejected adjustments',
        });
      }

      // Load config for tier re-computation
      const configRows = await db
        .select()
        .from(adjustmentConfig)
        .where(
          and(
            eq(adjustmentConfig.hospital_id, ctx.user.hospital_id),
            eq(adjustmentConfig.config_key, 'waiver_governance')
          )
        )
        .limit(1);

      const config = configRows.length ? configRows[0].config_value : {};

      // Re-compute tier
      const tierResult = computeTier(
        input.adjustment_amount,
        row.adjustment_type,
        row.category,
        config
      );

      // Archive old as 'revised'
      await db
        .update(billAdjustments)
        .set({
          status: 'revised' as any,
          updated_at: new Date() as any,
        })
        .where(eq(billAdjustments.id, input.id));

      // Create new version
      const newId = crypto.randomUUID();
      const adjusted_amount = Number(row.original_amount) - input.adjustment_amount;

      const initialChain = [
        {
          tier: 0,
          action: 'revised',
          user_id: ctx.user.sub,
          user_name: ctx.user.name,
          timestamp: new Date().toISOString(),
          from_id: input.id,
          reason: input.reason,
        },
      ];

      await db.insert(billAdjustments).values({
        id: newId as any,
        hospital_id: ctx.user.hospital_id as any,
        encounter_id: row.encounter_id as any,
        patient_id: row.patient_id as any,
        bill_id: row.bill_id as any,
        billing_account_id: row.billing_account_id as any,
        adjustment_type: row.adjustment_type as any,
        adjustment_amount: String(input.adjustment_amount) as any,
        original_amount: row.original_amount as any,
        adjusted_amount: String(adjusted_amount) as any,
        discount_percentage: row.discount_percentage as any,
        reason: input.reason as any,
        category: row.category as any,
        justification: input.justification || row.justification || null as any,
        supporting_docs: row.supporting_docs as any,
        status: 'pending' as any,
        current_approver_role: tierResult.approverRole as any,
        tier_required: tierResult.tier as any,
        approval_chain: initialChain as any,
        rejection_reason: null as any,
        rejected_by: null as any,
        version: (row.version || 0) + 1 as any,
        parent_adjustment_id: input.id as any,
        requested_by: ctx.user.sub as any,
        approved_by: null as any,
        created_at: new Date() as any,
        updated_at: new Date() as any,
        resolved_at: null as any,
      });

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'bill_adjustments',
        row_id: newId,
        new_values: {
          parent_adjustment_id: input.id,
          version: (row.version || 0) + 1,
          adjustment_amount: input.adjustment_amount,
          tier_required: tierResult.tier,
        },
        reason: `Revised bill adjustment from ${input.id}: ${input.reason}`,
      });

      return { id: newId, status: 'pending', tier: tierResult.tier };
    }),

  // 9. GET CONFIG
  getConfig: adminProcedure.query(async ({ ctx }) => {
    const configs = await db
      .select()
      .from(adjustmentConfig)
      .where(eq(adjustmentConfig.hospital_id, ctx.user.hospital_id));

    return configs;
  }),

  // 10. UPDATE CONFIG
  updateConfig: adminProcedure
    .input(
      z.object({
        config_key: z.string().min(1),
        config_value: z.record(z.any()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check super_admin role
      if (ctx.user.role !== 'super_admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only super_admin can update billing config',
        });
      }

      // Upsert
      const existing = await db
        .select()
        .from(adjustmentConfig)
        .where(
          and(
            eq(adjustmentConfig.hospital_id, ctx.user.hospital_id),
            eq(adjustmentConfig.config_key, input.config_key)
          )
        )
        .limit(1);

      if (existing.length) {
        await db
          .update(adjustmentConfig)
          .set({
            config_value: input.config_value as any,
            updated_by: ctx.user.sub as any,
            updated_at: new Date() as any,
          })
          .where(
            and(
              eq(adjustmentConfig.hospital_id, ctx.user.hospital_id),
              eq(adjustmentConfig.config_key, input.config_key)
            )
          );
      } else {
        const newId = crypto.randomUUID();
        await db.insert(adjustmentConfig).values({
          id: newId as any,
          hospital_id: ctx.user.hospital_id as any,
          config_key: input.config_key as any,
          config_value: input.config_value as any,
          description: null as any,
          updated_by: ctx.user.sub as any,
          created_at: new Date() as any,
          updated_at: new Date() as any,
        });
      }

      // Audit log
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'billing_config',
        row_id: input.config_key,
        new_values: input.config_value,
        reason: `Updated billing config: ${input.config_key}`,
      });

      return { success: true };
    }),

  // 11. STATS
  stats: protectedProcedure
    .input(z.object({ days: z.number().int().positive().default(30) }))
    .query(async ({ ctx, input }) => {
      const dateFilter = sql`${billAdjustments.created_at} >= NOW() - INTERVAL '${sql.raw(
        String(input.days)
      )} days'`;

      const baseConditions = and(
        eq(billAdjustments.hospital_id, ctx.user.hospital_id),
        dateFilter
      );

      // Count by status
      const statusCounts = await db
        .select({
          status: billAdjustments.status,
          count: sql`COUNT(*)`,
        })
        .from(billAdjustments)
        .where(baseConditions)
        .groupBy(billAdjustments.status);

      // Count by type
      const typeCounts = await db
        .select({
          type: billAdjustments.adjustment_type,
          count: sql`COUNT(*)`,
        })
        .from(billAdjustments)
        .where(baseConditions)
        .groupBy(billAdjustments.adjustment_type);

      // Sum by status
      const sumByStatus = await db
        .select({
          status: billAdjustments.status,
          total: sql`SUM(CAST(${billAdjustments.adjustment_amount} AS NUMERIC))`,
        })
        .from(billAdjustments)
        .where(baseConditions)
        .groupBy(billAdjustments.status);

      // Average resolution time (only resolved records)
      const resolutionStats = await db
        .select({
          avg_hours: sql`AVG(EXTRACT(EPOCH FROM (${billAdjustments.resolved_at} - ${billAdjustments.created_at})) / 3600)`,
          median_hours: sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${billAdjustments.resolved_at} - ${billAdjustments.created_at})) / 3600)`,
        })
        .from(billAdjustments)
        .where(
          and(
            baseConditions,
            sql`${billAdjustments.resolved_at} IS NOT NULL`
          )
        );

      return {
        days: input.days,
        statusCounts: statusCounts.map((s) => ({
          status: s.status,
          count: parseInt(String(s.count)),
        })),
        typeCounts: typeCounts.map((t) => ({
          type: t.type,
          count: parseInt(String(t.count)),
        })),
        sumByStatus: sumByStatus.map((s) => ({
          status: s.status,
          total: parseFloat(String(s.total || 0)),
        })),
        avgResolutionHours: resolutionStats[0]?.avg_hours
          ? parseFloat(String(resolutionStats[0].avg_hours))
          : null,
        medianResolutionHours: resolutionStats[0]?.median_hours
          ? parseFloat(String(resolutionStats[0].median_hours))
          : null,
      };
    }),
});
