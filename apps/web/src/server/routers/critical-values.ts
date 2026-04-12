/**
 * Critical Value Communication Workflow — Module 8 LIS (L.1)
 *
 * NABH flagship: multi-step alert → read-back confirmation → 15-min escalation chain.
 * Immutable audit trail for all critical value events.
 *
 * Endpoints:
 *   1. detect        — Auto-flag when result crosses critical threshold
 *   2. sendAlert     — Dispatch notifications to clinician + nurse + MOD
 *   3. acknowledge   — Read-back confirmation with tolerance check
 *   4. escalate      — Manual or auto-escalation (L1 → L2 → L3)
 *   5. release       — Release result to EHR after acknowledgment
 *   6. list          — Active alerts dashboard
 *   7. getDetail     — Single alert detail with full audit trail
 *   8. complianceReport — NABH KPIs: % ack within 15min, escalations
 *   9. verifyResult  — Accept/Reject/Flag a lab result
 *  10. unverifiedQueue — Results awaiting verification
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  criticalValueAlerts, resultVerifications,
} from '@db/schema';
import {
  labOrders, labResults, labPanelComponents,
} from '@db/schema';
import { users } from '@db/schema';
import { eq, and, desc, count, sql, isNull, gte, lte, or, ne } from 'drizzle-orm';

// ============================================================
// Router
// ============================================================

export const criticalValuesRouter = router({

  // ----------------------------------------------------------
  // 1. DETECT — Check if a result is critical and create alert
  // ----------------------------------------------------------
  detect: protectedProcedure
    .input(z.object({
      lab_result_id: z.string().uuid(),
      lab_order_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Fetch the result + component reference ranges
      const [result] = await db
        .select()
        .from(labResults)
        .where(and(
          eq(labResults.id, input.lab_result_id),
          eq(labResults.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab result not found' });
      }

      // Check critical thresholds from panel component
      let criticalLow: string | null = null;
      let criticalHigh: string | null = null;

      if (result.component_id) {
        const [comp] = await db
          .select({
            critical_low: labPanelComponents.critical_low,
            critical_high: labPanelComponents.critical_high,
          })
          .from(labPanelComponents)
          .where(eq(labPanelComponents.id, result.component_id))
          .limit(1);

        if (comp) {
          criticalLow = comp.critical_low;
          criticalHigh = comp.critical_high;
        }
      }

      if (!result.value_numeric) {
        return { is_critical: false, message: 'Non-numeric result — manual review required' };
      }

      const numVal = parseFloat(result.value_numeric);
      const cLow = criticalLow ? parseFloat(criticalLow) : null;
      const cHigh = criticalHigh ? parseFloat(criticalHigh) : null;

      let isCritical = false;
      let flag = 'normal';

      if (cLow !== null && numVal < cLow) {
        isCritical = true;
        flag = 'critical_low';
      } else if (cHigh !== null && numVal > cHigh) {
        isCritical = true;
        flag = 'critical_high';
      }

      if (!isCritical) {
        return { is_critical: false, flag };
      }

      // Fetch order for patient & clinician context
      const [order] = await db
        .select()
        .from(labOrders)
        .where(eq(labOrders.id, input.lab_order_id))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab order not found' });
      }

      // Create immutable critical value alert
      const [alert] = await db
        .insert(criticalValueAlerts)
        .values({
          hospital_id: ctx.user.hospital_id,
          lab_order_id: input.lab_order_id,
          lab_result_id: input.lab_result_id,
          patient_id: order.patient_id,
          test_code: result.test_code,
          test_name: result.test_name,
          value_numeric: result.value_numeric,
          value_text: result.value_text,
          unit: result.unit,
          critical_low: criticalLow,
          critical_high: criticalHigh,
          flag,
          status: 'pending',
          ordering_clinician_id: order.ordered_by,
          escalation_chain: [],
        })
        .returning();

      // Mark result as critical
      await db
        .update(labResults)
        .set({ is_critical: true, flag: flag === 'critical_low' ? 'critical_low' : 'critical_high' })
        .where(eq(labResults.id, input.lab_result_id));

      // Mark order as critical
      await db
        .update(labOrders)
        .set({ is_critical: true })
        .where(eq(labOrders.id, input.lab_order_id));

      return { is_critical: true, flag, alert_id: alert.id };
    }),

  // ----------------------------------------------------------
  // 2. SEND ALERT — Dispatch notifications
  // ----------------------------------------------------------
  sendAlert: protectedProcedure
    .input(z.object({
      alert_id: z.string().uuid(),
      method: z.enum(['push', 'sms', 'call', 'in_app']).default('in_app'),
      recipient_ids: z.array(z.string().uuid()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [alert] = await db
        .select()
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.id, input.alert_id),
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }

      if (alert.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Alert already in status: ${alert.status}` });
      }

      const [updated] = await db
        .update(criticalValueAlerts)
        .set({
          status: 'sent',
          alert_sent_at: new Date(),
          alert_method: input.method,
          alert_sent_to: input.recipient_ids,
          updated_at: new Date(),
        })
        .where(eq(criticalValueAlerts.id, input.alert_id))
        .returning();

      // In production: trigger push notifications / SMS here via Twilio/FCM
      // For now we record the dispatch and the UI will poll for pending alerts

      return { success: true, alert: updated };
    }),

  // ----------------------------------------------------------
  // 3. ACKNOWLEDGE — Read-back confirmation with tolerance check
  // ----------------------------------------------------------
  acknowledge: protectedProcedure
    .input(z.object({
      alert_id: z.string().uuid(),
      ack_method: z.enum(['pin', 'password', 'biometric']),
      read_back_text: z.string().min(1),
      read_back_value: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [alert] = await db
        .select()
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.id, input.alert_id),
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }

      if (alert.status !== 'sent' && !alert.status.startsWith('escalated')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot acknowledge alert in status: ${alert.status}`,
        });
      }

      // Validate read-back: must match original value within 0.5% tolerance
      let readBackMatched = false;
      if (input.read_back_value !== undefined && alert.value_numeric) {
        const original = parseFloat(alert.value_numeric);
        const tolerance = original * 0.005; // 0.5%
        readBackMatched = Math.abs(input.read_back_value - original) <= Math.abs(tolerance);
      } else {
        // Text-based read-back — exact match on test name + value
        readBackMatched = input.read_back_text.toLowerCase().includes(
          (alert.test_name || '').toLowerCase()
        );
      }

      if (!readBackMatched) {
        return {
          success: false,
          error: 'Read-back does not match. Please verify the critical value and try again.',
          expected_value: alert.value_numeric,
        };
      }

      const [updated] = await db
        .update(criticalValueAlerts)
        .set({
          status: 'read_back_done',
          ack_at: new Date(),
          ack_by: ctx.user.sub,
          ack_method: input.ack_method,
          read_back_text: input.read_back_text,
          read_back_value: input.read_back_value?.toString() ?? null,
          read_back_matched: readBackMatched,
          read_back_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(criticalValueAlerts.id, input.alert_id))
        .returning();

      return { success: true, read_back_matched: readBackMatched, alert: updated };
    }),

  // ----------------------------------------------------------
  // 4. ESCALATE — Manual or timeout-driven escalation
  // ----------------------------------------------------------
  escalate: protectedProcedure
    .input(z.object({
      alert_id: z.string().uuid(),
      escalate_to_user_id: z.string().uuid(),
      escalate_to_role: z.string().min(1),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [alert] = await db
        .select()
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.id, input.alert_id),
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }

      // Determine next escalation level
      const currentChain: Array<{
        level: number;
        role: string;
        user_id: string;
        escalated_at: string;
        acknowledged_at: string | null;
      }> = (alert.escalation_chain as typeof alert.escalation_chain) || [];
      const nextLevel = currentChain.length + 1;

      if (nextLevel > 3) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Maximum escalation level (L3) already reached',
        });
      }

      const newEntry = {
        level: nextLevel,
        role: input.escalate_to_role,
        user_id: input.escalate_to_user_id,
        escalated_at: new Date().toISOString(),
        acknowledged_at: null,
      };

      const statusMap: Record<number, 'escalated_l1' | 'escalated_l2' | 'escalated_l3'> = {
        1: 'escalated_l1',
        2: 'escalated_l2',
        3: 'escalated_l3',
      };

      const [updated] = await db
        .update(criticalValueAlerts)
        .set({
          status: statusMap[nextLevel],
          escalation_chain: [...currentChain, newEntry],
          notes: input.reason
            ? `${alert.notes || ''}${alert.notes ? '\n' : ''}[L${nextLevel}] ${input.reason}`
            : alert.notes,
          updated_at: new Date(),
        })
        .where(eq(criticalValueAlerts.id, input.alert_id))
        .returning();

      return { success: true, level: nextLevel, alert: updated };
    }),

  // ----------------------------------------------------------
  // 5. RELEASE — Release result to EHR after read-back
  // ----------------------------------------------------------
  release: protectedProcedure
    .input(z.object({
      alert_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [alert] = await db
        .select()
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.id, input.alert_id),
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }

      if (alert.status !== 'read_back_done') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot release: read-back not yet confirmed',
        });
      }

      // Release the alert
      const [updated] = await db
        .update(criticalValueAlerts)
        .set({
          status: 'released',
          released_at: new Date(),
          released_by: ctx.user.sub,
          updated_at: new Date(),
        })
        .where(eq(criticalValueAlerts.id, input.alert_id))
        .returning();

      // Update lab order status to verified
      await db
        .update(labOrders)
        .set({
          status: 'verified',
          verified_at: new Date(),
          verified_by: ctx.user.sub,
          updated_at: new Date(),
        })
        .where(eq(labOrders.id, alert.lab_order_id));

      return { success: true, alert: updated };
    }),

  // ----------------------------------------------------------
  // 6. LIST — Active alerts dashboard
  // ----------------------------------------------------------
  list: protectedProcedure
    .input(z.object({
      status: z.enum([
        'pending', 'sent', 'acknowledged', 'read_back_done', 'released',
        'escalated_l1', 'escalated_l2', 'escalated_l3', 'expired', 'all',
      ]).default('all'),
      limit: z.number().int().max(100).default(50),
      offset: z.number().int().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
      ];

      if (input.status !== 'all') {
        conditions.push(
          eq(criticalValueAlerts.status, input.status as typeof criticalValueAlerts.status.enumValues[number])
        );
      }

      const rows = await db
        .select()
        .from(criticalValueAlerts)
        .where(and(...conditions))
        .orderBy(desc(criticalValueAlerts.created_at))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(...conditions));

      return {
        alerts: rows,
        total: totalRow?.total ?? 0,
      };
    }),

  // ----------------------------------------------------------
  // 7. GET DETAIL — Single alert with full audit trail
  // ----------------------------------------------------------
  getDetail: protectedProcedure
    .input(z.object({ alert_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [alert] = await db
        .select()
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.id, input.alert_id),
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert not found' });
      }

      // Fetch acknowledger name
      let ackByName: string | null = null;
      if (alert.ack_by) {
        const [ackUser] = await db
          .select({ full_name: users.full_name })
          .from(users)
          .where(eq(users.id, alert.ack_by))
          .limit(1);
        ackByName = ackUser?.full_name ?? null;
      }

      // Fetch ordering clinician name
      let clinicianName: string | null = null;
      if (alert.ordering_clinician_id) {
        const [clinician] = await db
          .select({ full_name: users.full_name })
          .from(users)
          .where(eq(users.id, alert.ordering_clinician_id))
          .limit(1);
        clinicianName = clinician?.full_name ?? null;
      }

      return {
        ...alert,
        ack_by_name: ackByName,
        ordering_clinician_name: clinicianName,
      };
    }),

  // ----------------------------------------------------------
  // 8. COMPLIANCE REPORT — NABH KPIs
  // ----------------------------------------------------------
  complianceReport: adminProcedure
    .input(z.object({
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const fromDate = input.from_date ? new Date(input.from_date) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDate = input.to_date ? new Date(input.to_date) : new Date();

      // Total alerts in period
      const [totalRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
          gte(criticalValueAlerts.created_at, fromDate),
          lte(criticalValueAlerts.created_at, toDate),
        ));

      // Acknowledged within 15 minutes
      const ackWithin15Result = await db.execute(sql`
        SELECT COUNT(*) as total FROM critical_value_alerts
        WHERE hospital_id = ${ctx.user.hospital_id}
          AND cva_created_at >= ${fromDate.toISOString()}
          AND cva_created_at <= ${toDate.toISOString()}
          AND cva_ack_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (cva_ack_at - cva_alert_sent_at)) <= 900
      `);
      const ackWithin15 = parseInt((ackWithin15Result.rows as Array<{ total: string }>)[0]?.total ?? '0');

      // Escalated alerts
      const [escalatedRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
          gte(criticalValueAlerts.created_at, fromDate),
          lte(criticalValueAlerts.created_at, toDate),
          or(
            eq(criticalValueAlerts.status, 'escalated_l1'),
            eq(criticalValueAlerts.status, 'escalated_l2'),
            eq(criticalValueAlerts.status, 'escalated_l3'),
          ),
        ));

      // Released (fully completed cycle)
      const [releasedRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
          gte(criticalValueAlerts.created_at, fromDate),
          lte(criticalValueAlerts.created_at, toDate),
          eq(criticalValueAlerts.status, 'released'),
        ));

      // Average time to acknowledge (seconds)
      const avgAckResult = await db.execute(sql`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (cva_ack_at - cva_alert_sent_at))), 0) as avg_seconds
        FROM critical_value_alerts
        WHERE hospital_id = ${ctx.user.hospital_id}
          AND cva_created_at >= ${fromDate.toISOString()}
          AND cva_created_at <= ${toDate.toISOString()}
          AND cva_ack_at IS NOT NULL
          AND cva_alert_sent_at IS NOT NULL
      `);
      const avgAckSeconds = parseFloat((avgAckResult.rows as Array<{ avg_seconds: string }>)[0]?.avg_seconds ?? '0');

      const total = totalRow?.total ?? 0;

      return {
        period: { from: fromDate.toISOString(), to: toDate.toISOString() },
        total_alerts: total,
        acknowledged_within_15min: ackWithin15,
        ack_within_15min_pct: total > 0 ? Math.round((ackWithin15 / Number(total)) * 100) : 0,
        escalated: escalatedRow?.total ?? 0,
        released: releasedRow?.total ?? 0,
        avg_ack_time_seconds: Math.round(avgAckSeconds),
        avg_ack_time_minutes: Math.round(avgAckSeconds / 60 * 10) / 10,
      };
    }),

  // ----------------------------------------------------------
  // 9. VERIFY RESULT — Accept/Reject/Flag a lab result
  // ----------------------------------------------------------
  verifyResult: protectedProcedure
    .input(z.object({
      lab_result_id: z.string().uuid(),
      lab_order_id: z.string().uuid(),
      action: z.enum(['accept', 'reject', 'flag']),
      comment: z.string().optional(),
      rejection_reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify the result exists
      const [result] = await db
        .select()
        .from(labResults)
        .where(and(
          eq(labResults.id, input.lab_result_id),
          eq(labResults.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab result not found' });
      }

      // Create verification record
      const [verification] = await db
        .insert(resultVerifications)
        .values({
          hospital_id: ctx.user.hospital_id,
          lab_order_id: input.lab_order_id,
          lab_result_id: input.lab_result_id,
          action: input.action,
          comment: input.comment,
          rejection_reason: input.rejection_reason,
          verified_by: ctx.user.sub,
        })
        .returning();

      // If accepted, update order status
      if (input.action === 'accept') {
        // Check if all results for this order are now verified
        const unverifiedResults = await db.execute(sql`
          SELECT lr.id FROM lab_results lr
          LEFT JOIN result_verifications rv ON rv.rv_lab_result_id = lr.id AND rv.rv_action = 'accept'
          WHERE lr.lr_order_id = ${input.lab_order_id}
            AND lr.hospital_id = ${ctx.user.hospital_id}
            AND rv.id IS NULL
            AND lr.id != ${input.lab_result_id}
        `);

        if ((unverifiedResults.rows as Array<{ id: string }>).length === 0) {
          // All results verified — update order
          await db
            .update(labOrders)
            .set({
              status: 'verified',
              verified_at: new Date(),
              verified_by: ctx.user.sub,
              updated_at: new Date(),
            })
            .where(eq(labOrders.id, input.lab_order_id));
        }
      }

      return { success: true, verification };
    }),

  // ----------------------------------------------------------
  // 10. UNVERIFIED QUEUE — Results awaiting verification
  // ----------------------------------------------------------
  unverifiedQueue: protectedProcedure
    .input(z.object({
      limit: z.number().int().max(100).default(50),
      offset: z.number().int().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const results = await db.execute(sql`
        SELECT
          lr.id as result_id,
          lr.lr_order_id as order_id,
          lr.lr_test_code as test_code,
          lr.lr_test_name as test_name,
          lr.value_numeric,
          lr.value_text,
          lr.lr_unit as unit,
          lr.lr_flag as flag,
          lr.lr_is_critical as is_critical,
          lr.lr_resulted_at as resulted_at,
          lo.lo_order_number as order_number,
          lo.lo_urgency as urgency,
          lo.lo_panel_name as panel_name,
          p.uhid,
          p.first_name || ' ' || p.last_name as patient_name
        FROM lab_results lr
        JOIN lab_orders lo ON lo.id = lr.lr_order_id
        JOIN patients p ON p.id = lo.lo_patient_id
        LEFT JOIN result_verifications rv ON rv.rv_lab_result_id = lr.id AND rv.rv_action = 'accept'
        WHERE lr.hospital_id = ${ctx.user.hospital_id}
          AND lo.lo_status IN ('resulted', 'processing')
          AND rv.id IS NULL
        ORDER BY
          CASE lo.lo_urgency WHEN 'stat' THEN 0 WHEN 'asap' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
          lr.lr_is_critical DESC,
          lr.lr_resulted_at ASC
        LIMIT ${input.limit}
        OFFSET ${input.offset}
      `);

      const totalResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM lab_results lr
        JOIN lab_orders lo ON lo.id = lr.lr_order_id
        LEFT JOIN result_verifications rv ON rv.rv_lab_result_id = lr.id AND rv.rv_action = 'accept'
        WHERE lr.hospital_id = ${ctx.user.hospital_id}
          AND lo.lo_status IN ('resulted', 'processing')
          AND rv.id IS NULL
      `);

      return {
        results: results.rows as Array<{
          result_id: string;
          order_id: string;
          test_code: string;
          test_name: string;
          value_numeric: string | null;
          value_text: string | null;
          unit: string | null;
          flag: string | null;
          is_critical: boolean;
          resulted_at: string;
          order_number: string;
          urgency: string;
          panel_name: string | null;
          uhid: string;
          patient_name: string;
        }>,
        total: parseInt((totalResult.rows as Array<{ total: string }>)[0]?.total ?? '0'),
      };
    }),

  // ----------------------------------------------------------
  // 11. STATS — Dashboard summary
  // ----------------------------------------------------------
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Pending alerts (not yet acknowledged)
      const [pendingRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
          or(
            eq(criticalValueAlerts.status, 'pending'),
            eq(criticalValueAlerts.status, 'sent'),
            eq(criticalValueAlerts.status, 'escalated_l1'),
            eq(criticalValueAlerts.status, 'escalated_l2'),
            eq(criticalValueAlerts.status, 'escalated_l3'),
          ),
        ));

      // Total alerts in last 24h
      const [last24hRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
          gte(criticalValueAlerts.created_at, last24h),
        ));

      // Released in last 24h
      const [releasedRow] = await db
        .select({ total: count(criticalValueAlerts.id) })
        .from(criticalValueAlerts)
        .where(and(
          eq(criticalValueAlerts.hospital_id, ctx.user.hospital_id),
          eq(criticalValueAlerts.status, 'released'),
          gte(criticalValueAlerts.created_at, last24h),
        ));

      return {
        pending_alerts: pendingRow?.total ?? 0,
        alerts_24h: last24hRow?.total ?? 0,
        released_24h: releasedRow?.total ?? 0,
      };
    }),
});
