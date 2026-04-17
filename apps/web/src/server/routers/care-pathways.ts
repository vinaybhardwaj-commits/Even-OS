import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const nodeTypeValues = ['assessment', 'order_set', 'task', 'decision_point', 'clinical_milestone'] as const;
const pathwayStatusValues = ['draft', 'active', 'archived'] as const;
const carePlanStatusValues = ['draft', 'active', 'on_hold', 'completed', 'revoked', 'entered_in_error'] as const;
const varianceTypeValues = ['timing', 'omission', 'complication', 'patient_refusal'] as const;
const varianceSeverityValues = ['low', 'medium', 'high'] as const;
const escalationLevelValues = ['level_1', 'level_2', 'level_3'] as const;

export const carePathwaysRouter = router({

  // ═══════════════════════════════════════════════════════════
  // TEMPLATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  createTemplate: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      description: z.string().optional(),
      category: z.string().max(100).optional(),
      icd10_codes: z.array(z.string()).optional(),
      expected_los_days: z.number().int().positive().optional(),
      expected_cost: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await getSql()`
        INSERT INTO pathway_templates (hospital_id, pathway_name, pathway_description, pathway_category, icd10_codes, expected_los_days, expected_cost, pathway_created_by)
        VALUES (${hospitalId}, ${input.name}, ${input.description || null}, ${input.category || null}, ${input.icd10_codes ? JSON.stringify(input.icd10_codes) : null}::jsonb, ${input.expected_los_days || null}, ${input.expected_cost || null}, ${userId})
        RETURNING id
      `;
      const id = (result as any)[0]?.id;

      await getSql()`INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address) VALUES (${hospitalId}, ${userId}, 'INSERT', 'pathway_templates', ${id}, ${JSON.stringify({ name: input.name })}::jsonb, 'server')`;

      return { id };
    }),

  updateTemplate: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      category: z.string().max(100).optional(),
      dag_definition: z.any().optional(),
      expected_los_days: z.number().int().positive().optional(),
      expected_cost: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const existing = await getSql()`SELECT id, pathway_status FROM pathway_templates WHERE id = ${input.id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!existing?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      if ((existing as any)[0].pathway_status !== 'draft') throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only edit draft templates' });

      await getSql()`
        UPDATE pathway_templates SET
          pathway_name = COALESCE(${input.name || null}, pathway_name),
          pathway_description = COALESCE(${input.description ?? null}, pathway_description),
          pathway_category = COALESCE(${input.category ?? null}, pathway_category),
          dag_definition = COALESCE(${input.dag_definition ? JSON.stringify(input.dag_definition) : null}::jsonb, dag_definition),
          expected_los_days = COALESCE(${input.expected_los_days ?? null}, expected_los_days),
          expected_cost = COALESCE(${input.expected_cost ?? null}, expected_cost),
          pathway_updated_at = now()
        WHERE id = ${input.id} AND hospital_id = ${hospitalId}
      `;

      return { success: true };
    }),

  publishTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const existing = await getSql()`SELECT id, pathway_status, pathway_version FROM pathway_templates WHERE id = ${input.id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!existing?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      const t = (existing as any)[0];
      if (t.pathway_status !== 'draft') throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only publish draft templates' });

      const nodeCount = await getSql()`SELECT COUNT(*)::int as cnt FROM pathway_nodes WHERE template_id = ${input.id} AND hospital_id = ${hospitalId}`;
      const cnt = (nodeCount as any)[0]?.cnt || 0;
      if (cnt < 3) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Need at least 3 nodes to publish' });

      await getSql()`
        UPDATE pathway_templates SET
          pathway_status = 'active', published_at = now(), published_by = ${userId},
          pathway_version = pathway_version + 1, node_count = ${cnt}, pathway_updated_at = now()
        WHERE id = ${input.id} AND hospital_id = ${hospitalId}
      `;

      await getSql()`INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address) VALUES (${hospitalId}, ${userId}, 'UPDATE', 'pathway_templates', ${input.id}, '{"action":"publish"}'::jsonb, 'server')`;

      return { success: true, version: (t.pathway_version || 1) + 1 };
    }),

  archiveTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await getSql()`UPDATE pathway_templates SET pathway_status = 'archived', pathway_updated_at = now() WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id}`;
      return { success: true };
    }),

  listTemplates: protectedProcedure
    .input(z.object({
      status: z.enum(pathwayStatusValues).optional(),
      category: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const status = input?.status;
      const category = input?.category;

      if (status && category) {
        return await getSql()`
          SELECT t.*, u.full_name as created_by_name FROM pathway_templates t LEFT JOIN users u ON u.id = t.pathway_created_by
          WHERE t.hospital_id = ${hospitalId} AND t.pathway_status = ${status} AND t.pathway_category = ${category}
          ORDER BY t.pathway_created_at DESC LIMIT 100
        ` || [];
      } else if (status) {
        return await getSql()`
          SELECT t.*, u.full_name as created_by_name FROM pathway_templates t LEFT JOIN users u ON u.id = t.pathway_created_by
          WHERE t.hospital_id = ${hospitalId} AND t.pathway_status = ${status}
          ORDER BY t.pathway_created_at DESC LIMIT 100
        ` || [];
      } else {
        return await getSql()`
          SELECT t.*, u.full_name as created_by_name FROM pathway_templates t LEFT JOIN users u ON u.id = t.pathway_created_by
          WHERE t.hospital_id = ${hospitalId}
          ORDER BY t.pathway_created_at DESC LIMIT 100
        ` || [];
      }
    }),

  getTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const tpl = await getSql()`SELECT t.*, u.full_name as created_by_name FROM pathway_templates t LEFT JOIN users u ON u.id = t.pathway_created_by WHERE t.id = ${input.id} AND t.hospital_id = ${hospitalId} LIMIT 1`;
      if (!tpl?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });

      const nodes = await getSql()`SELECT * FROM pathway_nodes WHERE template_id = ${input.id} AND hospital_id = ${hospitalId} ORDER BY sort_order, pn_created_at`;
      const edges = await getSql()`SELECT * FROM pathway_edges WHERE edge_template_id = ${input.id}`;

      return { template: (tpl as any)[0], nodes: nodes || [], edges: edges || [] };
    }),

  // ═══════════════════════════════════════════════════════════
  // NODE MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  addNode: protectedProcedure
    .input(z.object({
      template_id: z.string().uuid(),
      node_key: z.string().min(1).max(50),
      node_type: z.enum(nodeTypeValues),
      name: z.string().min(1).max(200),
      description: z.string().optional(),
      timing_expression: z.string().max(100).optional(),
      timing_offset_hours: z.number().int().optional(),
      responsible_role: z.string().max(50).optional(),
      order_set_id: z.string().uuid().optional(),
      auto_fire: z.boolean().optional(),
      is_required: z.boolean().optional(),
      escalation_rules: z.any().optional(),
      condition_expression: z.any().optional(),
      true_branch_node_key: z.string().max(50).optional(),
      false_branch_node_key: z.string().max(50).optional(),
      sort_order: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const tpl = await getSql()`SELECT pathway_status FROM pathway_templates WHERE id = ${input.template_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!tpl?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      if ((tpl as any)[0].pathway_status !== 'draft') throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only add nodes to draft templates' });

      const result = await getSql()`
        INSERT INTO pathway_nodes (hospital_id, template_id, node_key, node_type, node_name, node_description, timing_expression, timing_offset_hours, responsible_role, order_set_id, auto_fire, is_required, escalation_rules, condition_expression, true_branch_node_key, false_branch_node_key, sort_order)
        VALUES (${hospitalId}, ${input.template_id}, ${input.node_key}, ${input.node_type}, ${input.name}, ${input.description || null}, ${input.timing_expression || null}, ${input.timing_offset_hours ?? null}, ${input.responsible_role || null}, ${input.order_set_id || null}, ${input.auto_fire ?? false}, ${input.is_required ?? true}, ${input.escalation_rules ? JSON.stringify(input.escalation_rules) : null}::jsonb, ${input.condition_expression ? JSON.stringify(input.condition_expression) : null}::jsonb, ${input.true_branch_node_key || null}, ${input.false_branch_node_key || null}, ${input.sort_order ?? 0})
        RETURNING id
      `;

      await getSql()`UPDATE pathway_templates SET node_count = (SELECT COUNT(*)::int FROM pathway_nodes WHERE template_id = ${input.template_id}), pathway_updated_at = now() WHERE id = ${input.template_id}`;

      return { id: (result as any)[0]?.id };
    }),

  addEdge: protectedProcedure
    .input(z.object({
      template_id: z.string().uuid(),
      from_node_id: z.string().uuid(),
      to_node_id: z.string().uuid(),
      condition_label: z.string().optional(),
      is_default: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const tpl = await getSql()`SELECT pathway_status FROM pathway_templates WHERE id = ${input.template_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!tpl?.length || (tpl as any)[0].pathway_status !== 'draft') throw new TRPCError({ code: 'FORBIDDEN', message: 'Can only add edges to draft templates' });

      const result = await getSql()`
        INSERT INTO pathway_edges (edge_template_id, from_node_id, to_node_id, condition_label, is_default)
        VALUES (${input.template_id}, ${input.from_node_id}, ${input.to_node_id}, ${input.condition_label || null}, ${input.is_default ?? true})
        RETURNING id
      `;

      return { id: (result as any)[0]?.id };
    }),

  removeNode: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const node = await getSql()`SELECT template_id FROM pathway_nodes WHERE id = ${input.id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!node?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Node not found' });
      const templateId = (node as any)[0].template_id;

      await getSql()`DELETE FROM pathway_edges WHERE from_node_id = ${input.id} OR to_node_id = ${input.id}`;
      await getSql()`DELETE FROM pathway_nodes WHERE id = ${input.id}`;
      await getSql()`UPDATE pathway_templates SET node_count = (SELECT COUNT(*)::int FROM pathway_nodes WHERE template_id = ${templateId}), pathway_updated_at = now() WHERE id = ${templateId}`;

      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════
  // CARE PLAN ACTIVATION
  // ═══════════════════════════════════════════════════════════

  activatePathway: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      template_id: z.string().uuid(),
      team_members: z.array(z.object({
        user_id: z.string().uuid(),
        role: z.string().max(50),
        is_lead: z.boolean().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const tpl = await getSql()`SELECT id, pathway_name FROM pathway_templates WHERE id = ${input.template_id} AND hospital_id = ${hospitalId} AND pathway_status = 'active' LIMIT 1`;
      if (!tpl?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active template not found' });

      const cpResult = await getSql()`
        INSERT INTO care_plans (hospital_id, cp_patient_id, cp_encounter_id, cp_template_id, activated_by)
        VALUES (${hospitalId}, ${input.patient_id}, ${input.encounter_id || null}, ${input.template_id}, ${userId})
        RETURNING id
      `;
      const carePlanId = (cpResult as any)[0]?.id;

      const nodes = await getSql()`SELECT * FROM pathway_nodes WHERE template_id = ${input.template_id} AND hospital_id = ${hospitalId} ORDER BY sort_order`;

      let milestoneCount = 0;
      for (const node of (nodes as any[])) {
        const offsetHours = node.timing_offset_hours || 0;
        await getSql()`
          INSERT INTO care_plan_milestones (hospital_id, care_plan_id, ms_patient_id, ms_pathway_node_id, ms_node_key, ms_node_type, ms_name, ms_responsible_role, due_datetime, ms_sort_order)
          VALUES (${hospitalId}, ${carePlanId}, ${input.patient_id}, ${node.id}, ${node.node_key}, ${node.node_type}, ${node.node_name}, ${node.responsible_role}, now() + (${offsetHours} || ' hours')::interval, ${node.sort_order || 0})
        `;
        milestoneCount++;
      }

      await getSql()`UPDATE care_plans SET total_milestones = ${milestoneCount} WHERE id = ${carePlanId}`;

      if (input.team_members?.length) {
        for (const member of input.team_members) {
          await getSql()`
            INSERT INTO care_teams (hospital_id, ct_care_plan_id, ct_patient_id, member_user_id, ct_role, is_lead)
            VALUES (${hospitalId}, ${carePlanId}, ${input.patient_id}, ${member.user_id}, ${member.role}, ${member.is_lead ?? false})
          `;
        }
      }

      await getSql()`INSERT INTO audit_logs (hospital_id, user_id, action, table_name, row_id, new_values, ip_address) VALUES (${hospitalId}, ${userId}, 'INSERT', 'care_plans', ${carePlanId}, ${JSON.stringify({ template_id: input.template_id, milestones: milestoneCount })}::jsonb, 'server')`;

      return { id: carePlanId, milestone_count: milestoneCount };
    }),

  deactivatePathway: protectedProcedure
    .input(z.object({ care_plan_id: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await getSql()`UPDATE care_plans SET care_plan_status = 'revoked', revoked_at = now(), revoke_reason = ${input.reason || null}, cp_updated_at = now() WHERE id = ${input.care_plan_id} AND hospital_id = ${ctx.user.hospital_id}`;
      return { success: true };
    }),

  getCarePlan: protectedProcedure
    .input(z.object({ care_plan_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const cp = await getSql()`
        SELECT cp.*, pt.pathway_name as template_name, pt.pathway_category as template_category,
               p.name_full as patient_name, p.uhid
        FROM care_plans cp
        LEFT JOIN pathway_templates pt ON pt.id = cp.cp_template_id
        LEFT JOIN patients p ON p.id = cp.cp_patient_id
        WHERE cp.id = ${input.care_plan_id} AND cp.hospital_id = ${hospitalId} LIMIT 1
      `;
      if (!cp?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Care plan not found' });

      const milestones = await getSql()`SELECT * FROM care_plan_milestones WHERE care_plan_id = ${input.care_plan_id} AND hospital_id = ${hospitalId} ORDER BY ms_sort_order, ms_created_at`;
      const team = await getSql()`
        SELECT ct.*, u.full_name as member_name FROM care_teams ct LEFT JOIN users u ON u.id = ct.member_user_id
        WHERE ct.ct_care_plan_id = ${input.care_plan_id} AND ct.hospital_id = ${hospitalId} AND ct.ct_removed_at IS NULL
      `;

      return { care_plan: (cp as any)[0], milestones: milestones || [], team: team || [] };
    }),

  listCarePlans: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      status: z.enum(carePlanStatusValues).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      if (input?.patient_id) {
        return await getSql()`
          SELECT cp.*, pt.pathway_name as template_name, p.name_full as patient_name, p.uhid
          FROM care_plans cp LEFT JOIN pathway_templates pt ON pt.id = cp.cp_template_id LEFT JOIN patients p ON p.id = cp.cp_patient_id
          WHERE cp.hospital_id = ${hospitalId} AND cp.cp_patient_id = ${input.patient_id}
          ORDER BY cp.activated_at DESC LIMIT 50
        ` || [];
      } else if (input?.status) {
        return await getSql()`
          SELECT cp.*, pt.pathway_name as template_name, p.name_full as patient_name, p.uhid
          FROM care_plans cp LEFT JOIN pathway_templates pt ON pt.id = cp.cp_template_id LEFT JOIN patients p ON p.id = cp.cp_patient_id
          WHERE cp.hospital_id = ${hospitalId} AND cp.care_plan_status = ${input.status}
          ORDER BY cp.activated_at DESC LIMIT 50
        ` || [];
      } else {
        return await getSql()`
          SELECT cp.*, pt.pathway_name as template_name, p.name_full as patient_name, p.uhid
          FROM care_plans cp LEFT JOIN pathway_templates pt ON pt.id = cp.cp_template_id LEFT JOIN patients p ON p.id = cp.cp_patient_id
          WHERE cp.hospital_id = ${hospitalId}
          ORDER BY cp.activated_at DESC LIMIT 50
        ` || [];
      }
    }),

  // ═══════════════════════════════════════════════════════════
  // MILESTONE OPERATIONS
  // ═══════════════════════════════════════════════════════════

  completeMilestone: protectedProcedure
    .input(z.object({ milestone_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const ms = await getSql()`SELECT care_plan_id FROM care_plan_milestones WHERE id = ${input.milestone_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!ms?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });

      await getSql()`UPDATE care_plan_milestones SET ms_status = 'completed', ms_completed_at = now(), ms_completed_by = ${userId}, ms_updated_at = now() WHERE id = ${input.milestone_id}`;

      const carePlanId = (ms as any)[0].care_plan_id;
      await getSql()`UPDATE care_plans SET completed_milestones = (SELECT COUNT(*)::int FROM care_plan_milestones WHERE care_plan_id = ${carePlanId} AND ms_status = 'completed'), cp_updated_at = now() WHERE id = ${carePlanId}`;

      return { success: true };
    }),

  skipMilestone: protectedProcedure
    .input(z.object({ milestone_id: z.string().uuid(), skip_reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const ms = await getSql()`SELECT care_plan_id, ms_patient_id, due_datetime FROM care_plan_milestones WHERE id = ${input.milestone_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!ms?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });
      const m = (ms as any)[0];

      await getSql()`UPDATE care_plan_milestones SET ms_status = 'skipped', skipped_at = now(), skip_reason = ${input.skip_reason}, skipped_by = ${userId}, ms_updated_at = now() WHERE id = ${input.milestone_id}`;

      await getSql()`
        INSERT INTO variance_log (hospital_id, vl_care_plan_id, vl_milestone_id, vl_patient_id, variance_type, vl_severity, expected_datetime, vl_reason, documented_by)
        VALUES (${hospitalId}, ${m.care_plan_id}, ${input.milestone_id}, ${m.ms_patient_id}, 'omission', 'medium', ${m.due_datetime || null}, ${input.skip_reason}, ${userId})
      `;

      return { success: true };
    }),

  startMilestone: protectedProcedure
    .input(z.object({ milestone_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await getSql()`UPDATE care_plan_milestones SET ms_status = 'in_progress', ms_started_at = now(), ms_updated_at = now() WHERE id = ${input.milestone_id} AND hospital_id = ${ctx.user.hospital_id}`;
      return { success: true };
    }),

  getMilestoneDetail: protectedProcedure
    .input(z.object({ milestone_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const ms = await getSql()`SELECT * FROM care_plan_milestones WHERE id = ${input.milestone_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!ms?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });

      const variances = await getSql()`SELECT * FROM variance_log WHERE vl_milestone_id = ${input.milestone_id} AND hospital_id = ${hospitalId} ORDER BY vl_created_at DESC`;
      const escalations = await getSql()`SELECT * FROM escalation_events WHERE ee_milestone_id = ${input.milestone_id} AND hospital_id = ${hospitalId} ORDER BY ee_created_at DESC`;

      return { milestone: (ms as any)[0], variances: variances || [], escalations: escalations || [] };
    }),

  // ═══════════════════════════════════════════════════════════
  // VARIANCE & ESCALATION
  // ═══════════════════════════════════════════════════════════

  recordVariance: protectedProcedure
    .input(z.object({
      milestone_id: z.string().uuid(),
      variance_type: z.enum(varianceTypeValues),
      severity: z.enum(varianceSeverityValues),
      expected_datetime: z.string().optional(),
      actual_datetime: z.string().optional(),
      delay_hours: z.number().optional(),
      reason: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const ms = await getSql()`SELECT care_plan_id, ms_patient_id FROM care_plan_milestones WHERE id = ${input.milestone_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!ms?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });
      const m = (ms as any)[0];

      const result = await getSql()`
        INSERT INTO variance_log (hospital_id, vl_care_plan_id, vl_milestone_id, vl_patient_id, variance_type, vl_severity, expected_datetime, actual_datetime, delay_hours, vl_reason, vl_notes, documented_by)
        VALUES (${hospitalId}, ${m.care_plan_id}, ${input.milestone_id}, ${m.ms_patient_id}, ${input.variance_type}, ${input.severity}, ${input.expected_datetime || null}, ${input.actual_datetime || null}, ${input.delay_hours ?? null}, ${input.reason || null}, ${input.notes || null}, ${userId})
        RETURNING id
      `;

      return { id: (result as any)[0]?.id };
    }),

  listVariances: protectedProcedure
    .input(z.object({
      care_plan_id: z.string().uuid().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      if (input?.care_plan_id) {
        return await getSql()`
          SELECT v.*, m.ms_name as milestone_name, p.name_full as patient_name, u.full_name as documented_by_name
          FROM variance_log v LEFT JOIN care_plan_milestones m ON m.id = v.vl_milestone_id LEFT JOIN patients p ON p.id = v.vl_patient_id LEFT JOIN users u ON u.id = v.documented_by
          WHERE v.hospital_id = ${hospitalId} AND v.vl_care_plan_id = ${input.care_plan_id}
          ORDER BY v.vl_created_at DESC LIMIT 100
        ` || [];
      } else {
        return await getSql()`
          SELECT v.*, m.ms_name as milestone_name, p.name_full as patient_name, u.full_name as documented_by_name
          FROM variance_log v LEFT JOIN care_plan_milestones m ON m.id = v.vl_milestone_id LEFT JOIN patients p ON p.id = v.vl_patient_id LEFT JOIN users u ON u.id = v.documented_by
          WHERE v.hospital_id = ${hospitalId}
          ORDER BY v.vl_created_at DESC LIMIT 100
        ` || [];
      }
    }),

  createEscalation: protectedProcedure
    .input(z.object({
      milestone_id: z.string().uuid(),
      level: z.enum(escalationLevelValues),
      notify_role: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const ms = await getSql()`SELECT care_plan_id, ms_patient_id FROM care_plan_milestones WHERE id = ${input.milestone_id} AND hospital_id = ${hospitalId} LIMIT 1`;
      if (!ms?.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });
      const m = (ms as any)[0];

      await getSql()`UPDATE care_plans SET overdue_milestones = (SELECT COUNT(*)::int FROM care_plan_milestones WHERE care_plan_id = ${m.care_plan_id} AND ms_status IN ('not_started','in_progress') AND due_datetime < now()), cp_updated_at = now() WHERE id = ${m.care_plan_id}`;

      const result = await getSql()`
        INSERT INTO escalation_events (hospital_id, ee_care_plan_id, ee_milestone_id, ee_patient_id, escalation_level, notify_role)
        VALUES (${hospitalId}, ${m.care_plan_id}, ${input.milestone_id}, ${m.ms_patient_id}, ${input.level}, ${input.notify_role || null})
        RETURNING id
      `;

      return { id: (result as any)[0]?.id };
    }),

  acknowledgeEscalation: protectedProcedure
    .input(z.object({ escalation_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await getSql()`UPDATE escalation_events SET ee_status = 'acknowledged', acknowledged_at = now(), acknowledged_by = ${ctx.user.sub} WHERE id = ${input.escalation_id} AND hospital_id = ${ctx.user.hospital_id}`;
      return { success: true };
    }),

  resolveEscalation: protectedProcedure
    .input(z.object({ escalation_id: z.string().uuid(), resolution_notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await getSql()`UPDATE escalation_events SET ee_status = 'resolved', ee_resolved_at = now(), ee_resolved_by = ${ctx.user.sub}, resolution_notes = ${input.resolution_notes || null} WHERE id = ${input.escalation_id} AND hospital_id = ${ctx.user.hospital_id}`;
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════
  // REPORTING
  // ═══════════════════════════════════════════════════════════

  pathwayStats: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;

      const templates = await getSql()`SELECT COUNT(*)::int as cnt FROM pathway_templates WHERE hospital_id = ${hospitalId} AND pathway_status = 'active'`;
      const activePlans = await getSql()`SELECT COUNT(*)::int as cnt FROM care_plans WHERE hospital_id = ${hospitalId} AND care_plan_status = 'active'`;
      const overdue = await getSql()`
        SELECT COUNT(*)::int as cnt FROM care_plan_milestones m
        JOIN care_plans cp ON cp.id = m.care_plan_id AND cp.care_plan_status = 'active'
        WHERE m.hospital_id = ${hospitalId} AND m.ms_status IN ('not_started','in_progress') AND m.due_datetime < now()
      `;
      const completion = await getSql()`
        SELECT CASE WHEN SUM(total_milestones) > 0 THEN ROUND(SUM(completed_milestones)::numeric / SUM(total_milestones) * 100, 1) ELSE 0 END as avg_rate
        FROM care_plans WHERE hospital_id = ${hospitalId} AND care_plan_status = 'active'
      `;

      return {
        total_templates: (templates as any)[0]?.cnt || 0,
        total_active_plans: (activePlans as any)[0]?.cnt || 0,
        total_overdue_milestones: (overdue as any)[0]?.cnt || 0,
        avg_completion_rate: parseFloat((completion as any)[0]?.avg_rate || '0'),
      };
    }),

  overdueMillestones: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      return await getSql()`
        SELECT m.*, p.name_full as patient_name, p.uhid,
               pt.pathway_name as template_name,
               EXTRACT(EPOCH FROM (now() - m.due_datetime)) / 3600 as hours_overdue
        FROM care_plan_milestones m
        JOIN care_plans cp ON cp.id = m.care_plan_id AND cp.care_plan_status = 'active'
        JOIN patients p ON p.id = m.ms_patient_id
        JOIN pathway_templates pt ON pt.id = cp.cp_template_id
        WHERE m.hospital_id = ${hospitalId} AND m.ms_status IN ('not_started','in_progress') AND m.due_datetime < now()
        ORDER BY m.due_datetime ASC LIMIT 50
      ` || [];
    }),

  varianceReport: protectedProcedure
    .input(z.object({ template_id: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      if (input?.template_id) {
        return await getSql()`
          SELECT m.ms_name as milestone_name, COUNT(*)::int as variance_count,
                 ROUND(AVG(v.delay_hours)::numeric, 1) as avg_delay_hours,
                 MODE() WITHIN GROUP (ORDER BY v.variance_type) as most_common_type
          FROM variance_log v
          JOIN care_plan_milestones m ON m.id = v.vl_milestone_id
          JOIN care_plans cp ON cp.id = v.vl_care_plan_id AND cp.cp_template_id = ${input.template_id}
          WHERE v.hospital_id = ${hospitalId}
          GROUP BY m.ms_name ORDER BY variance_count DESC LIMIT 50
        ` || [];
      } else {
        return await getSql()`
          SELECT m.ms_name as milestone_name, COUNT(*)::int as variance_count,
                 ROUND(AVG(v.delay_hours)::numeric, 1) as avg_delay_hours,
                 MODE() WITHIN GROUP (ORDER BY v.variance_type) as most_common_type
          FROM variance_log v
          JOIN care_plan_milestones m ON m.id = v.vl_milestone_id
          WHERE v.hospital_id = ${hospitalId}
          GROUP BY m.ms_name ORDER BY variance_count DESC LIMIT 50
        ` || [];
      }
    }),

  // ═══════════════════════════════════════════════════════════
  // PATIENT-SCOPED VARIANCE + ESCALATION LISTS (for Plan tab)
  // ═══════════════════════════════════════════════════════════

  listVariancesByPatient: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      return await getSql()`
        SELECT v.id, v.variance_type, v.vl_severity as severity,
               v.vl_reason as reason, v.vl_notes as notes,
               v.delay_hours, v.expected_datetime, v.actual_datetime,
               v.vl_created_at as created_at,
               m.ms_name as milestone_name,
               u.full_name as documented_by_name
        FROM variance_log v
        LEFT JOIN care_plan_milestones m ON m.id = v.vl_milestone_id
        LEFT JOIN users u ON u.id = v.documented_by
        WHERE v.hospital_id = ${hospitalId}
          AND v.vl_patient_id = ${input.patient_id}
        ORDER BY v.vl_created_at DESC
        LIMIT ${input.limit}
      ` || [];
    }),

  listEscalationsByPatient: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      return await getSql()`
        SELECT e.id, e.escalation_level as level, e.ee_status as status,
               e.triggered_at, e.notify_role, e.acknowledged_at,
               e.resolved_at, e.resolution_notes,
               e.ee_created_at as created_at,
               m.ms_name as milestone_name
        FROM escalation_events e
        LEFT JOIN care_plan_milestones m ON m.id = e.ee_milestone_id
        WHERE e.hospital_id = ${hospitalId}
          AND e.ee_patient_id = ${input.patient_id}
        ORDER BY e.triggered_at DESC
        LIMIT ${input.limit}
      ` || [];
    }),

});
