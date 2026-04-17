import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { testCatalogExtensions, referenceRangeRules, labPanels, labPanelComponents, externalLabs, users } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, or, sql, desc, asc, count, like, gte, lte } from 'drizzle-orm';

export const testCatalogV2Router = router({

  // ── TEST CATALOG EXTENSIONS ────────────────────────────────────────────────────────

  listExtensions: protectedProcedure
    .input(z.object({
      source_type: z.enum(['in_house', 'outsourced', 'either', 'all']).optional(),
      approval_status: z.enum(['draft', 'pending_approval', 'approved', 'archived', 'all']).optional(),
      search: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id)];

      if (input.source_type && input.source_type !== 'all') {
        filters.push(eq(testCatalogExtensions.source_type, input.source_type as any));
      }
      if (input.approval_status && input.approval_status !== 'all') {
        filters.push(eq(testCatalogExtensions.approval_status, input.approval_status as any));
      }

      if (input.search) {
        const searchFilter = or(
          like(labPanels.panel_name, `%${input.search}%`),
          like(testCatalogExtensions.methodology, `%${input.search}%`)
        );
        if (searchFilter) filters.push(searchFilter);
      }

      const extensions = await db
        .select({
          id: testCatalogExtensions.id,
          panel_id: testCatalogExtensions.panel_id,
          panel_name: labPanels.panel_name,
          source_type: testCatalogExtensions.source_type,
          methodology: testCatalogExtensions.methodology,
          equipment: testCatalogExtensions.equipment,
          specimen_volume: testCatalogExtensions.specimen_volume,
          special_instructions: testCatalogExtensions.special_instructions,
          reporting_format: testCatalogExtensions.reporting_format,
          turnaround_priority: testCatalogExtensions.turnaround_priority,
          approval_status: testCatalogExtensions.approval_status,
          approved_by: testCatalogExtensions.approved_by,
          approved_at: testCatalogExtensions.approved_at,
          requires_consent: testCatalogExtensions.requires_consent,
          created_at: testCatalogExtensions.created_at,
          updated_at: testCatalogExtensions.updated_at,
        })
        .from(testCatalogExtensions)
        .leftJoin(labPanels, eq(testCatalogExtensions.panel_id, labPanels.id))
        .where(and(...filters))
        .limit(input.limit)
        .offset(input.offset);

      return extensions;
    }),

  getExtension: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [ext] = await db
        .select({
          id: testCatalogExtensions.id,
          hospital_id: testCatalogExtensions.hospital_id,
          panel_id: testCatalogExtensions.panel_id,
          panel_name: labPanels.panel_name,
          source_type: testCatalogExtensions.source_type,
          default_external_lab_id: testCatalogExtensions.default_external_lab_id,
          default_external_lab_name: externalLabs.lab_name,
          methodology: testCatalogExtensions.methodology,
          equipment: testCatalogExtensions.equipment,
          specimen_volume: testCatalogExtensions.specimen_volume,
          special_instructions: testCatalogExtensions.special_instructions,
          reporting_format: testCatalogExtensions.reporting_format,
          turnaround_priority: testCatalogExtensions.turnaround_priority,
          approval_status: testCatalogExtensions.approval_status,
          approved_by: testCatalogExtensions.approved_by,
          approved_by_name: users.full_name,
          approved_at: testCatalogExtensions.approved_at,
          requires_consent: testCatalogExtensions.requires_consent,
          created_at: testCatalogExtensions.created_at,
          updated_at: testCatalogExtensions.updated_at,
        })
        .from(testCatalogExtensions)
        .leftJoin(labPanels, eq(testCatalogExtensions.panel_id, labPanels.id))
        .leftJoin(externalLabs, eq(testCatalogExtensions.default_external_lab_id, externalLabs.id))
        .leftJoin(users, eq(testCatalogExtensions.approved_by, users.id))
        .where(and(
          eq(testCatalogExtensions.id, input.id),
          eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id),
        ));

      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extension not found' });
      }

      return ext;
    }),

  createExtension: adminProcedure
    .input(z.object({
      panel_id: z.string().uuid(),
      source_type: z.enum(['in_house', 'outsourced', 'either']),
      default_external_lab_id: z.string().uuid().optional(),
      methodology: z.string().optional(),
      equipment: z.string().optional(),
      specimen_volume: z.string().optional(),
      special_instructions: z.string().optional(),
      reporting_format: z.enum(['standard', 'narrative', 'cumulative']).default('standard'),
      turnaround_priority: z.enum(['routine_4h', 'urgent_2h', 'stat_1h', 'custom']).default('routine_4h'),
      requires_consent: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify panel exists and belongs to hospital
      const [panel] = await db.select({ id: labPanels.id })
        .from(labPanels)
        .where(and(
          eq(labPanels.id, input.panel_id),
          eq(labPanels.hospital_id, ctx.user.hospital_id),
        ));

      if (!panel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Panel not found' });
      }

      const [ext] = await db.insert(testCatalogExtensions).values({
        hospital_id: ctx.user.hospital_id,
        panel_id: input.panel_id,
        source_type: input.source_type,
        default_external_lab_id: input.default_external_lab_id || null,
        methodology: input.methodology || null,
        equipment: input.equipment || null,
        specimen_volume: input.specimen_volume || null,
        special_instructions: input.special_instructions || null,
        reporting_format: input.reporting_format,
        turnaround_priority: input.turnaround_priority,
        approval_status: 'draft',
        requires_consent: input.requires_consent,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'test_catalog_extensions',
        row_id: ext.id,
        new_values: { source_type: input.source_type, panel_id: input.panel_id },
        reason: 'Created test catalog extension',
      });

      return ext;
    }),

  updateExtension: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      source_type: z.enum(['in_house', 'outsourced', 'either']).optional(),
      default_external_lab_id: z.string().uuid().optional().nullable(),
      methodology: z.string().optional().nullable(),
      equipment: z.string().optional().nullable(),
      specimen_volume: z.string().optional().nullable(),
      special_instructions: z.string().optional().nullable(),
      reporting_format: z.enum(['standard', 'narrative', 'cumulative']).optional(),
      turnaround_priority: z.enum(['routine_4h', 'urgent_2h', 'stat_1h', 'custom']).optional(),
      requires_consent: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [ext] = await db.select({ id: testCatalogExtensions.id })
        .from(testCatalogExtensions)
        .where(and(
          eq(testCatalogExtensions.id, input.id),
          eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id),
        ));

      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extension not found' });
      }

      const updates: any = {};
      if (input.source_type !== undefined) updates.source_type = input.source_type;
      if (input.default_external_lab_id !== undefined) updates.default_external_lab_id = input.default_external_lab_id;
      if (input.methodology !== undefined) updates.methodology = input.methodology;
      if (input.equipment !== undefined) updates.equipment = input.equipment;
      if (input.specimen_volume !== undefined) updates.specimen_volume = input.specimen_volume;
      if (input.special_instructions !== undefined) updates.special_instructions = input.special_instructions;
      if (input.reporting_format !== undefined) updates.reporting_format = input.reporting_format;
      if (input.turnaround_priority !== undefined) updates.turnaround_priority = input.turnaround_priority;
      if (input.requires_consent !== undefined) updates.requires_consent = input.requires_consent;

      const [updated] = await db.update(testCatalogExtensions)
        .set({ ...updates, updated_at: new Date() } as any)
        .where(eq(testCatalogExtensions.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'test_catalog_extensions',
        row_id: input.id,
        new_values: updates,
        reason: 'Updated test catalog extension',
      });

      return updated;
    }),

  submitForApproval: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [ext] = await db.select({ id: testCatalogExtensions.id, approval_status: testCatalogExtensions.approval_status })
        .from(testCatalogExtensions)
        .where(and(
          eq(testCatalogExtensions.id, input.id),
          eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id),
        ));

      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extension not found' });
      }

      const [updated] = await db.update(testCatalogExtensions)
        .set({ approval_status: 'pending_approval' as any, updated_at: new Date() })
        .where(eq(testCatalogExtensions.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'test_catalog_extensions',
        row_id: input.id,
        new_values: { approval_status: 'pending_approval' },
        reason: 'Submitted for approval',
      });

      return updated;
    }),

  approveExtension: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [ext] = await db.select({ id: testCatalogExtensions.id })
        .from(testCatalogExtensions)
        .where(and(
          eq(testCatalogExtensions.id, input.id),
          eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id),
        ));

      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extension not found' });
      }

      const [updated] = await db.update(testCatalogExtensions)
        .set({
          approval_status: 'approved' as any,
          approved_by: ctx.user.sub,
          approved_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(testCatalogExtensions.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'test_catalog_extensions',
        row_id: input.id,
        new_values: { approval_status: 'approved' },
        reason: 'Approved test catalog extension',
      });

      return updated;
    }),

  archiveExtension: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [ext] = await db.select({ id: testCatalogExtensions.id })
        .from(testCatalogExtensions)
        .where(and(
          eq(testCatalogExtensions.id, input.id),
          eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id),
        ));

      if (!ext) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Extension not found' });
      }

      const [updated] = await db.update(testCatalogExtensions)
        .set({ approval_status: 'archived' as any, updated_at: new Date() })
        .where(eq(testCatalogExtensions.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'test_catalog_extensions',
        row_id: input.id,
        new_values: { approval_status: 'archived' },
        reason: 'Archived test catalog extension',
      });

      return updated;
    }),

  // ── REFERENCE RANGE RULES ──────────────────────────────────────────────────────

  listRangeRules: protectedProcedure
    .input(z.object({
      component_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      // Verify component exists in this hospital
      const [comp] = await db.select({ id: labPanelComponents.id })
        .from(labPanelComponents)
        .leftJoin(labPanels, eq(labPanelComponents.panel_id, labPanels.id))
        .where(and(
          eq(labPanelComponents.id, input.component_id),
          eq(labPanels.hospital_id, ctx.user.hospital_id),
        ));

      if (!comp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      }

      const rules = await db
        .select()
        .from(referenceRangeRules)
        .where(and(
          eq(referenceRangeRules.component_id, input.component_id),
          eq(referenceRangeRules.hospital_id, ctx.user.hospital_id),
          eq(referenceRangeRules.is_active, true),
        ))
        .orderBy(asc(referenceRangeRules.priority), desc(referenceRangeRules.created_at));

      return rules;
    }),

  createRangeRule: adminProcedure
    .input(z.object({
      component_id: z.string().uuid(),
      rule_name: z.string().min(1),
      age_min_years: z.number().int().min(0).optional().nullable(),
      age_max_years: z.number().int().optional().nullable(),
      age_min_days: z.number().int().min(0).optional().nullable(),
      age_max_days: z.number().int().optional().nullable(),
      gender: z.enum(['all', 'male', 'female']),
      pregnancy_status: z.enum(['not_pregnant', 'trimester_1', 'trimester_2', 'trimester_3', 'postpartum']).optional().nullable(),
      clinical_context: z.enum(['fasting', 'post_prandial', 'exercise', 'altitude']).optional().nullable(),
      ref_range_low: z.string().optional().nullable(),
      ref_range_high: z.string().optional().nullable(),
      ref_range_text: z.string().optional().nullable(),
      unit: z.string().optional().nullable(),
      critical_low: z.string().optional().nullable(),
      critical_high: z.string().optional().nullable(),
      panic_low: z.string().optional().nullable(),
      panic_high: z.string().optional().nullable(),
      interpretation_guide: z.string().optional().nullable(),
      priority: z.number().int().default(100),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify component exists
      const [comp] = await db.select({ id: labPanelComponents.id })
        .from(labPanelComponents)
        .leftJoin(labPanels, eq(labPanelComponents.panel_id, labPanels.id))
        .where(and(
          eq(labPanelComponents.id, input.component_id),
          eq(labPanels.hospital_id, ctx.user.hospital_id),
        ));

      if (!comp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      }

      const [rule] = await db.insert(referenceRangeRules).values({
        hospital_id: ctx.user.hospital_id,
        component_id: input.component_id,
        rule_name: input.rule_name,
        age_min_years: input.age_min_years || null,
        age_max_years: input.age_max_years || null,
        age_min_days: input.age_min_days || null,
        age_max_days: input.age_max_days || null,
        gender: input.gender,
        pregnancy_status: input.pregnancy_status || null,
        clinical_context: input.clinical_context || null,
        ref_range_low: input.ref_range_low || null,
        ref_range_high: input.ref_range_high || null,
        ref_range_text: input.ref_range_text || null,
        unit: input.unit || null,
        critical_low: input.critical_low || null,
        critical_high: input.critical_high || null,
        panic_low: input.panic_low || null,
        panic_high: input.panic_high || null,
        interpretation_guide: input.interpretation_guide || null,
        priority: input.priority,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'reference_range_rules',
        row_id: rule.id,
        new_values: { component_id: input.component_id, rule_name: input.rule_name },
        reason: 'Created reference range rule',
      });

      return rule;
    }),

  updateRangeRule: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      rule_name: z.string().min(1).optional(),
      age_min_years: z.number().int().min(0).optional().nullable(),
      age_max_years: z.number().int().optional().nullable(),
      age_min_days: z.number().int().min(0).optional().nullable(),
      age_max_days: z.number().int().optional().nullable(),
      gender: z.enum(['all', 'male', 'female']).optional(),
      pregnancy_status: z.enum(['not_pregnant', 'trimester_1', 'trimester_2', 'trimester_3', 'postpartum']).optional().nullable(),
      clinical_context: z.enum(['fasting', 'post_prandial', 'exercise', 'altitude']).optional().nullable(),
      ref_range_low: z.string().optional().nullable(),
      ref_range_high: z.string().optional().nullable(),
      ref_range_text: z.string().optional().nullable(),
      unit: z.string().optional().nullable(),
      critical_low: z.string().optional().nullable(),
      critical_high: z.string().optional().nullable(),
      panic_low: z.string().optional().nullable(),
      panic_high: z.string().optional().nullable(),
      interpretation_guide: z.string().optional().nullable(),
      priority: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [rule] = await db.select({ id: referenceRangeRules.id })
        .from(referenceRangeRules)
        .where(and(
          eq(referenceRangeRules.id, input.id),
          eq(referenceRangeRules.hospital_id, ctx.user.hospital_id),
        ));

      if (!rule) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      }

      const updates: any = {};
      if (input.rule_name !== undefined) updates.rule_name = input.rule_name;
      if (input.age_min_years !== undefined) updates.age_min_years = input.age_min_years;
      if (input.age_max_years !== undefined) updates.age_max_years = input.age_max_years;
      if (input.age_min_days !== undefined) updates.age_min_days = input.age_min_days;
      if (input.age_max_days !== undefined) updates.age_max_days = input.age_max_days;
      if (input.gender !== undefined) updates.gender = input.gender;
      if (input.pregnancy_status !== undefined) updates.pregnancy_status = input.pregnancy_status;
      if (input.clinical_context !== undefined) updates.clinical_context = input.clinical_context;
      if (input.ref_range_low !== undefined) updates.ref_range_low = input.ref_range_low;
      if (input.ref_range_high !== undefined) updates.ref_range_high = input.ref_range_high;
      if (input.ref_range_text !== undefined) updates.ref_range_text = input.ref_range_text;
      if (input.unit !== undefined) updates.unit = input.unit;
      if (input.critical_low !== undefined) updates.critical_low = input.critical_low;
      if (input.critical_high !== undefined) updates.critical_high = input.critical_high;
      if (input.panic_low !== undefined) updates.panic_low = input.panic_low;
      if (input.panic_high !== undefined) updates.panic_high = input.panic_high;
      if (input.interpretation_guide !== undefined) updates.interpretation_guide = input.interpretation_guide;
      if (input.priority !== undefined) updates.priority = input.priority;

      const [updated] = await db.update(referenceRangeRules)
        .set({ ...updates, updated_at: new Date() } as any)
        .where(eq(referenceRangeRules.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'reference_range_rules',
        row_id: input.id,
        new_values: updates,
        reason: 'Updated reference range rule',
      });

      return updated;
    }),

  deleteRangeRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [rule] = await db.select({ id: referenceRangeRules.id })
        .from(referenceRangeRules)
        .where(and(
          eq(referenceRangeRules.id, input.id),
          eq(referenceRangeRules.hospital_id, ctx.user.hospital_id),
        ));

      if (!rule) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      }

      const [deleted] = await db.update(referenceRangeRules)
        .set({ is_active: false, updated_at: new Date() })
        .where(eq(referenceRangeRules.id, input.id))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'DELETE',
        table_name: 'reference_range_rules',
        row_id: input.id,
        new_values: { is_active: false },
        reason: 'Soft-deleted reference range rule',
      });

      return deleted;
    }),

  lookupRange: protectedProcedure
    .input(z.object({
      component_id: z.string().uuid(),
      age_years: z.number().int().min(0),
      age_days: z.number().int().min(0).optional(),
      gender: z.enum(['male', 'female']),
      pregnancy_status: z.enum(['not_pregnant', 'trimester_1', 'trimester_2', 'trimester_3', 'postpartum']).optional(),
      clinical_context: z.enum(['fasting', 'post_prandial', 'exercise', 'altitude']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Verify component exists
      const [comp] = await db.select({ id: labPanelComponents.id })
        .from(labPanelComponents)
        .leftJoin(labPanels, eq(labPanelComponents.panel_id, labPanels.id))
        .where(and(
          eq(labPanelComponents.id, input.component_id),
          eq(labPanels.hospital_id, ctx.user.hospital_id),
        ));

      if (!comp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      }

      const allRules = await db
        .select()
        .from(referenceRangeRules)
        .where(and(
          eq(referenceRangeRules.component_id, input.component_id),
          eq(referenceRangeRules.hospital_id, ctx.user.hospital_id),
          eq(referenceRangeRules.is_active, true),
        ))
        .orderBy(asc(referenceRangeRules.priority));

      // Match rules by: clinical_context (most specific) → pregnancy_status → gender → age → fallback
      let matched = null;

      // Try clinical context + pregnancy + gender + age match
      if (input.clinical_context && input.pregnancy_status) {
        matched = allRules.find(r =>
          r.clinical_context === input.clinical_context &&
          r.pregnancy_status === input.pregnancy_status &&
          (r.gender === input.gender || r.gender === 'all') &&
          (!r.age_min_years || r.age_min_years <= input.age_years) &&
          (!r.age_max_years || r.age_max_years >= input.age_years)
        );
      }

      // Try pregnancy + gender + age match
      if (!matched && input.pregnancy_status) {
        matched = allRules.find(r =>
          r.pregnancy_status === input.pregnancy_status &&
          (r.gender === input.gender || r.gender === 'all') &&
          (!r.age_min_years || r.age_min_years <= input.age_years) &&
          (!r.age_max_years || r.age_max_years >= input.age_years)
        );
      }

      // Try gender + age match
      if (!matched) {
        matched = allRules.find(r =>
          (r.gender === input.gender || r.gender === 'all') &&
          (!r.age_min_years || r.age_min_years <= input.age_years) &&
          (!r.age_max_years || r.age_max_years >= input.age_years) &&
          !r.pregnancy_status &&
          !r.clinical_context
        );
      }

      // Fallback to any rule
      if (!matched) {
        matched = allRules[0] || null;
      }

      return matched;
    }),

  // ── STATS ──────────────────────────────────────────────────────────────────

  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const [extStats] = await db.select({
        total: count(),
        in_house: sql<number>`count(case when ${testCatalogExtensions.source_type} = 'in_house' then 1 end)`,
        outsourced: sql<number>`count(case when ${testCatalogExtensions.source_type} = 'outsourced' then 1 end)`,
        either: sql<number>`count(case when ${testCatalogExtensions.source_type} = 'either' then 1 end)`,
        draft: sql<number>`count(case when ${testCatalogExtensions.approval_status} = 'draft' then 1 end)`,
        pending_approval: sql<number>`count(case when ${testCatalogExtensions.approval_status} = 'pending_approval' then 1 end)`,
        approved: sql<number>`count(case when ${testCatalogExtensions.approval_status} = 'approved' then 1 end)`,
        archived: sql<number>`count(case when ${testCatalogExtensions.approval_status} = 'archived' then 1 end)`,
      })
        .from(testCatalogExtensions)
        .where(eq(testCatalogExtensions.hospital_id, ctx.user.hospital_id));

      const [ruleStats] = await db.select({
        total: count(),
        active: sql<number>`count(case when ${referenceRangeRules.is_active} = true then 1 end)`,
      })
        .from(referenceRangeRules)
        .where(eq(referenceRangeRules.hospital_id, ctx.user.hospital_id));

      return {
        extensions: extStats || { total: 0, in_house: 0, outsourced: 0, either: 0, draft: 0, pending_approval: 0, approved: 0, archived: 0 },
        rules: ruleStats || { total: 0, active: 0 },
      };
    }),

});
