import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  securityAuditFindings,
  rateLimitEvents,
  piiAccessLog,
  disasterRecoveryDrills,
  performanceBaselines,
  complianceChecklistItems,
  systemHealthSnapshots,
} from '@db/schema';
import { eq, and, desc, sql, gte, lte, or } from 'drizzle-orm';

// ============================================================
// SECURITY AUDIT FINDINGS
// ============================================================

export const hardeningRouter = router({
  // ─── LIST SECURITY FINDINGS ──────────────────────────────────
  listSecurityFindings: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      severity: z.string().optional(),
      status: z.string().optional(),
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;
      const conditions: any[] = [];

      if (input.category) conditions.push(eq(securityAuditFindings.category, input.category));
      if (input.severity) conditions.push(eq(securityAuditFindings.severity, input.severity));
      if (input.status) conditions.push(eq(securityAuditFindings.remediation_status, input.status));

      const findings = await db.select()
        .from(securityAuditFindings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(securityAuditFindings.found_at))
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM security_audit_findings ${
          conditions.length > 0 ? sql`WHERE ${and(...conditions)}` : sql``
        }`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { findings, total, page: input.page, limit: input.limit };
    }),

  // ─── GET SECURITY FINDING ────────────────────────────────────
  getSecurityFinding: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [finding] = await db.select()
        .from(securityAuditFindings)
        .where(eq(securityAuditFindings.id, input.id as any))
        .limit(1);

      if (!finding) throw new TRPCError({ code: 'NOT_FOUND', message: 'Finding not found' });
      return finding;
    }),

  // ─── CREATE SECURITY FINDING ─────────────────────────────────
  createSecurityFinding: protectedProcedure
    .input(z.object({
      finding_id: z.string(),
      category: z.string(),
      severity: z.string(),
      title: z.string(),
      description: z.string().optional(),
      affected_module: z.string().optional(),
      affected_endpoint: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [newFinding] = await db.insert(securityAuditFindings)
        .values({
          ...input,
          remediation_status: 'open',
        })
        .returning();

      return newFinding;
    }),

  // ─── UPDATE FINDING STATUS ───────────────────────────────────
  updateFindingStatus: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(securityAuditFindings)
        .set({
          remediation_status: input.status,
          remediation_notes: input.notes,
          updated_at: new Date(),
          ...(input.status === 'resolved' ? { resolved_at: new Date() } : {}),
          ...(input.status === 'resolved' ? { verified_by: ctx.user.sub as any } : {}),
        })
        .where(eq(securityAuditFindings.id, input.id as any))
        .returning();

      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Finding not found' });
      return updated;
    }),

  // ============================================================
  // RATE LIMIT EVENTS
  // ============================================================

  // ─── LIST RATE LIMIT EVENTS ──────────────────────────────────
  listRateLimitEvents: protectedProcedure
    .input(z.object({
      ip_address: z.string().optional(),
      endpoint: z.string().optional(),
      action: z.string().optional(),
      hours_back: z.number().int().default(24),
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;
      const since = new Date(Date.now() - input.hours_back * 3600 * 1000);
      const conditions: any[] = [gte(rateLimitEvents.blocked_at, since)];

      if (input.ip_address) conditions.push(eq(rateLimitEvents.ip_address, input.ip_address));
      if (input.endpoint) conditions.push(eq(rateLimitEvents.endpoint, input.endpoint));
      if (input.action) conditions.push(eq(rateLimitEvents.action_taken, input.action));

      const events = await db.select()
        .from(rateLimitEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(rateLimitEvents.blocked_at))
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM rate_limit_events WHERE blocked_at >= ${since} ${
          conditions.length > 1 ? sql`AND ${and(...conditions.slice(1))}` : sql``
        }`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { events, total, page: input.page, limit: input.limit };
    }),

  // ─── GET RATE LIMIT SUMMARY ──────────────────────────────────
  getRateLimitSummary: protectedProcedure
    .input(z.object({
      hours_back: z.number().int().default(24),
    }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours_back * 3600 * 1000);

      // Top IPs
      const topIps = await db.execute(sql`
        SELECT ip_address, COUNT(*) as count, MAX(blocked_at) as last_block
        FROM rate_limit_events
        WHERE blocked_at >= ${since}
        GROUP BY ip_address
        ORDER BY count DESC
        LIMIT 10
      `);

      // Top endpoints
      const topEndpoints = await db.execute(sql`
        SELECT endpoint, COUNT(*) as count, MAX(blocked_at) as last_block
        FROM rate_limit_events
        WHERE blocked_at >= ${since}
        GROUP BY endpoint
        ORDER BY count DESC
        LIMIT 10
      `);

      // Hourly counts
      const hourlyCounts = await db.execute(sql`
        SELECT
          DATE_TRUNC('hour', blocked_at) as hour,
          COUNT(*) as count,
          COUNT(CASE WHEN action_taken = 'block' THEN 1 END) as blocks,
          COUNT(CASE WHEN action_taken = 'warn' THEN 1 END) as warns
        FROM rate_limit_events
        WHERE blocked_at >= ${since}
        GROUP BY DATE_TRUNC('hour', blocked_at)
        ORDER BY hour DESC
      `);

      return {
        top_ips: (topIps as any).rows || [],
        top_endpoints: (topEndpoints as any).rows || [],
        hourly_counts: (hourlyCounts as any).rows || [],
      };
    }),

  // ============================================================
  // PII ACCESS LOG
  // ============================================================

  // ─── LOG PII ACCESS ──────────────────────────────────────────
  logPiiAccess: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      access_type: z.string(),
      resource_type: z.string(),
      resource_id: z.string(),
      fields_accessed: z.array(z.string()).optional(),
      justification: z.string().optional(),
      ip_address: z.string().optional(),
      user_agent: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [logged] = await db.insert(piiAccessLog)
        .values({
          user_id: ctx.user.sub as any,
          ...input,
        })
        .returning();

      return logged;
    }),

  // ─── LIST PII ACCESS LOG ─────────────────────────────────────
  listPiiAccessLog: protectedProcedure
    .input(z.object({
      user_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      access_type: z.string().optional(),
      days_back: z.number().int().default(30),
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;
      const since = new Date(Date.now() - input.days_back * 24 * 3600 * 1000);
      const conditions: any[] = [gte(piiAccessLog.created_at, since)];

      if (input.user_id) conditions.push(eq(piiAccessLog.user_id, input.user_id as any));
      if (input.patient_id) conditions.push(eq(piiAccessLog.patient_id, input.patient_id as any));
      if (input.access_type) conditions.push(eq(piiAccessLog.access_type, input.access_type));

      const logs = await db.select()
        .from(piiAccessLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(piiAccessLog.created_at))
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM pii_access_log WHERE created_at >= ${since} ${
          conditions.length > 1 ? sql`AND ${and(...conditions.slice(1))}` : sql``
        }`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { logs, total, page: input.page, limit: input.limit };
    }),

  // ============================================================
  // DISASTER RECOVERY DRILLS
  // ============================================================

  // ─── LIST DRILLS ─────────────────────────────────────────────
  listDrills: protectedProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;

      const drills = await db.select()
        .from(disasterRecoveryDrills)
        .orderBy(desc(disasterRecoveryDrills.started_at))
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM disaster_recovery_drills`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { drills, total, page: input.page, limit: input.limit };
    }),

  // ─── CREATE DRILL ────────────────────────────────────────────
  createDrill: protectedProcedure
    .input(z.object({
      drill_type: z.string(),
      scenario_name: z.string(),
      target_rto_minutes: z.number().int().optional(),
      target_rpo_minutes: z.number().int().optional(),
      participants: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [drill] = await db.insert(disasterRecoveryDrills)
        .values({
          ...input,
          started_at: new Date(),
          led_by: ctx.user.sub as any,
        })
        .returning();

      return drill;
    }),

  // ─── UPDATE DRILL ────────────────────────────────────────────
  updateDrill: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      completed_at: z.date().optional(),
      actual_rto_minutes: z.number().int().optional(),
      actual_rpo_minutes: z.number().int().optional(),
      data_loss_detected: z.boolean().optional(),
      issues_found: z.any().optional(),
      remediation_actions: z.any().optional(),
      passed: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(disasterRecoveryDrills)
        .set({
          ...input,
        })
        .where(eq(disasterRecoveryDrills.id, input.id as any))
        .returning();

      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drill not found' });
      return updated;
    }),

  // ============================================================
  // PERFORMANCE BASELINES
  // ============================================================

  // ─── LIST PERFORMANCE BASELINES ──────────────────────────────
  listPerformanceBaselines: protectedProcedure
    .input(z.object({
      test_type: z.string().optional(),
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;
      const conditions: any[] = [];

      if (input.test_type) conditions.push(eq(performanceBaselines.test_type, input.test_type));

      const baselines = await db.select()
        .from(performanceBaselines)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(performanceBaselines.tested_at))
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM performance_baselines ${
          conditions.length > 0 ? sql`WHERE ${and(...conditions)}` : sql``
        }`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { baselines, total, page: input.page, limit: input.limit };
    }),

  // ─── CREATE PERFORMANCE BASELINE ─────────────────────────────
  createPerformanceBaseline: protectedProcedure
    .input(z.object({
      test_name: z.string(),
      test_type: z.string(),
      concurrent_users: z.number().int().optional(),
      duration_minutes: z.number().int().optional(),
      avg_response_ms: z.number().int().optional(),
      p95_response_ms: z.number().int().optional(),
      p99_response_ms: z.number().int().optional(),
      error_rate: z.number().optional(),
      throughput_rps: z.number().optional(),
      endpoints_tested: z.any().optional(),
      issues: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [baseline] = await db.insert(performanceBaselines)
        .values({
          ...input,
          error_rate: input.error_rate !== undefined ? String(input.error_rate) : null,
          throughput_rps: input.throughput_rps !== undefined ? String(input.throughput_rps) : null,
          tested_by: ctx.user.sub as any,
          tested_at: new Date(),
        })
        .returning();

      return baseline;
    }),

  // ============================================================
  // COMPLIANCE CHECKLIST
  // ============================================================

  // ─── LIST CHECKLIST ITEMS ────────────────────────────────────
  listChecklistItems: protectedProcedure
    .input(z.object({
      checklist_type: z.string().optional(),
      status: z.string().optional(),
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;
      const conditions: any[] = [];

      if (input.checklist_type) conditions.push(eq(complianceChecklistItems.checklist_type, input.checklist_type));
      if (input.status) conditions.push(eq(complianceChecklistItems.status, input.status));

      const items = await db.select()
        .from(complianceChecklistItems)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(complianceChecklistItems.section, complianceChecklistItems.item_code)
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM compliance_checklist_items ${
          conditions.length > 0 ? sql`WHERE ${and(...conditions)}` : sql``
        }`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { items, total, page: input.page, limit: input.limit };
    }),

  // ─── UPDATE CHECKLIST ITEM ───────────────────────────────────
  updateChecklistItem: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.string().optional(),
      evidence_url: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(complianceChecklistItems)
        .set({
          ...input,
          updated_at: new Date(),
          ...(input.status === 'compliant' ? { completed_at: new Date(), verified_by: ctx.user.sub as any } : {}),
        })
        .where(eq(complianceChecklistItems.id, input.id as any))
        .returning();

      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Checklist item not found' });
      return updated;
    }),

  // ─── GET COMPLIANCE SUMMARY ──────────────────────────────────
  getComplianceSummary: protectedProcedure
    .input(z.object({
      checklist_type: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const typeFilter = input.checklist_type
        ? sql`WHERE checklist_type = ${input.checklist_type}`
        : sql``;

      const summary = await db.execute(sql`
        SELECT
          checklist_type,
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'compliant' THEN 1 END) as compliant,
          COUNT(CASE WHEN status = 'non_compliant' THEN 1 END) as non_compliant,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
          COUNT(CASE WHEN status = 'not_started' THEN 1 END) as not_started,
          COUNT(CASE WHEN status = 'na' THEN 1 END) as na,
          ROUND(100.0 * COUNT(CASE WHEN status = 'compliant' THEN 1 END) / COUNT(*), 2) as compliance_pct
        FROM compliance_checklist_items
        ${typeFilter}
        GROUP BY checklist_type
        ORDER BY checklist_type
      `);

      return (summary as any).rows || [];
    }),

  // ============================================================
  // SYSTEM HEALTH SNAPSHOTS
  // ============================================================

  // ─── GET LATEST HEALTH SNAPSHOT ──────────────────────────────
  getLatestHealthSnapshot: protectedProcedure
    .query(async ({}) => {
      const [latest] = await db.select()
        .from(systemHealthSnapshots)
        .orderBy(desc(systemHealthSnapshots.snapshot_at))
        .limit(1);

      return latest || null;
    }),

  // ─── LIST HEALTH SNAPSHOTS ───────────────────────────────────
  listHealthSnapshots: protectedProcedure
    .input(z.object({
      snapshot_type: z.string().optional(),
      days_back: z.number().int().default(7),
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = input.page * input.limit;
      const since = new Date(Date.now() - input.days_back * 24 * 3600 * 1000);
      const conditions: any[] = [gte(systemHealthSnapshots.snapshot_at, since)];

      if (input.snapshot_type) conditions.push(eq(systemHealthSnapshots.snapshot_type, input.snapshot_type));

      const snapshots = await db.select()
        .from(systemHealthSnapshots)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(systemHealthSnapshots.snapshot_at))
        .limit(input.limit)
        .offset(offset);

      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM system_health_snapshots WHERE snapshot_at >= ${since} ${
          conditions.length > 1 ? sql`AND ${and(...conditions.slice(1))}` : sql``
        }`
      );
      const total = Number((countResult as any).rows?.[0]?.cnt || 0);

      return { snapshots, total, page: input.page, limit: input.limit };
    }),

  // ─── CAPTURE HEALTH SNAPSHOT ─────────────────────────────────
  captureHealthSnapshot: protectedProcedure
    .input(z.object({
      snapshot_type: z.string().default('hourly'),
    }))
    .mutation(async ({ ctx, input }) => {
      // Mock values for now — would be replaced with real monitoring data
      const [snapshot] = await db.insert(systemHealthSnapshots)
        .values({
          snapshot_type: input.snapshot_type || 'hourly',
          api_uptime_pct: String(99.9),
          avg_response_ms: 145,
          p99_response_ms: 385,
          error_rate_pct: String(0.1),
          active_sessions: 42,
          db_pool_utilization_pct: String(35.5),
          db_query_avg_ms: 28,
          memory_usage_mb: 1024,
          cpu_usage_pct: String(25.3),
          disk_usage_pct: String(62.1),
          cache_hit_rate_pct: String(87.4),
          snapshot_at: new Date(),
        })
        .returning();

      return snapshot;
    }),
});
