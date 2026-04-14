import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';
import { generateTemplate, generateSmartDefaults } from '@/lib/ai/template-ai';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// TEMPLATE MANAGEMENT — TM.1
// CRUD + versioning + usage logging + AI suggestions
// ============================================================

const fieldSchema = z.object({
  id: z.string(),
  type: z.enum([
    'text', 'textarea', 'checkbox', 'checkbox_group', 'dropdown', 'numeric',
    'date', 'time', 'datetime', 'signature', 'medication_list', 'vitals_grid',
    'icd_picker', 'procedure_picker', 'drug_picker', 'patient_data_auto',
    'section_header', 'divider',
  ]),
  label: z.string(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  default_value: z.any().optional(),
  auto_populate_from: z.string().optional(),
  validation: z.object({
    min_length: z.number().optional(),
    max_length: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
  conditional_on: z.object({ field_id: z.string(), value: z.any() }).optional(),
  ai_hint: z.string().optional(),
  order: z.number(),
});

export const templateManagementRouter = router({

  // ── List templates (filtered by scope, category, role) ────────────────
  list: protectedProcedure
    .input(z.object({
      scope: z.enum(['system', 'department', 'personal', 'all']).default('all'),
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const scopeFilter = input.scope || 'all';
      const catFilter = input.category || '';
      const searchFilter = input.search ? `%${input.search}%` : '';

      const rows = await getSql()`
        SELECT ct.*, u.full_name AS creator_name
        FROM clinical_templates ct
        LEFT JOIN users u ON u.id = ct.template_created_by
        WHERE ct.hospital_id = ${hospitalId}
          AND ct.template_is_active = true
          AND (
            ${scopeFilter} = 'all' AND (
              ct.template_scope = 'system'
              OR ct.template_scope = 'department'
              OR (ct.template_scope = 'personal' AND ct.template_owner_id = ${userId}::uuid)
            )
            OR (${scopeFilter} = 'system' AND ct.template_scope = 'system')
            OR (${scopeFilter} = 'department' AND ct.template_scope = 'department')
            OR (${scopeFilter} = 'personal' AND ct.template_scope = 'personal' AND ct.template_owner_id = ${userId}::uuid)
          )
          AND (${catFilter} = '' OR ct.template_category::text = ${catFilter})
          AND (${searchFilter} = '' OR ct.template_name ILIKE ${searchFilter} OR ct.template_description ILIKE ${searchFilter})
        ORDER BY
          CASE ct.template_scope
            WHEN 'personal' THEN 0
            WHEN 'department' THEN 1
            WHEN 'system' THEN 2
          END,
          ct.template_usage_count DESC,
          ct.template_updated_at DESC
        LIMIT ${input.limit} OFFSET ${input.offset};
      `;
      return rows as any[];
    }),

  // ── Get single template ───────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT ct.*, u.full_name AS creator_name
        FROM clinical_templates ct
        LEFT JOIN users u ON u.id = ct.template_created_by
        WHERE ct.id = ${input.id} AND ct.hospital_id = ${ctx.user.hospital_id};
      `;
      if (!rows || (rows as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      return (rows as any[])[0];
    }),

  // ── Create template ───────────────────────────────────────────────────
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      category: z.enum([
        'discharge', 'operative', 'handoff', 'admission', 'assessment',
        'consent', 'nursing', 'progress', 'consultation', 'referral', 'custom',
      ]),
      scope: z.enum(['system', 'department', 'personal']).default('personal'),
      department_id: z.string().uuid().optional(),
      applicable_roles: z.array(z.string()).optional(),
      applicable_encounter_types: z.array(z.string()).optional(),
      fields: z.array(fieldSchema),
      default_values: z.record(z.any()).optional(),
      ai_generation_prompt: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const templateId = crypto.randomUUID();
      const versionId = crypto.randomUUID();

      // Create template
      await getSql()`
        INSERT INTO clinical_templates (
          id, hospital_id, template_name, template_description, template_category,
          template_scope, template_department_id, template_owner_id,
          applicable_roles, applicable_encounter_types,
          template_fields, template_default_values, ai_generation_prompt,
          template_version, template_is_active, template_is_locked,
          template_tags, template_usage_count,
          template_created_by, template_created_at, template_updated_at
        ) VALUES (
          ${templateId}, ${hospitalId}, ${input.name}, ${input.description || null},
          ${input.category}, ${input.scope}, ${input.department_id || null},
          ${input.scope === 'personal' ? userId : null},
          ${JSON.stringify(input.applicable_roles || [])}::jsonb,
          ${JSON.stringify(input.applicable_encounter_types || [])}::jsonb,
          ${JSON.stringify(input.fields)}::jsonb,
          ${JSON.stringify(input.default_values || {})}::jsonb,
          ${input.ai_generation_prompt || null},
          1, true, ${input.scope === 'system'},
          ${JSON.stringify(input.tags || [])}::jsonb, 0,
          ${userId}::uuid, NOW(), NOW()
        );
      `;

      // Create initial version
      await getSql()`
        INSERT INTO clinical_template_versions (
          id, ctv_template_id, ctv_version_number, ctv_fields, ctv_default_values,
          ctv_change_summary, ctv_changed_by, ctv_created_at
        ) VALUES (
          ${versionId}, ${templateId}, 1, ${JSON.stringify(input.fields)}::jsonb,
          ${JSON.stringify(input.default_values || {})}::jsonb,
          'Initial version', ${userId}::uuid, NOW()
        );
      `;

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'clinical_templates',
        row_id: templateId, new_values: { name: input.name, category: input.category, scope: input.scope },
      });

      return { id: templateId, version: 1 };
    }),

  // ── Update template (creates new version) ─────────────────────────────
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      fields: z.array(fieldSchema).optional(),
      default_values: z.record(z.any()).optional(),
      applicable_roles: z.array(z.string()).optional(),
      applicable_encounter_types: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      change_summary: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Get current template
      const current = await getSql()`
        SELECT * FROM clinical_templates WHERE id = ${input.id} AND hospital_id = ${hospitalId};
      `;
      if (!current || (current as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      const tpl = (current as any[])[0];

      // Check permissions
      if (tpl.template_scope === 'personal' && tpl.template_owner_id !== userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot edit another user\'s personal template' });
      }
      if (tpl.template_is_locked && !['admin', 'super_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Template is locked. Admin access required.' });
      }

      const newVersion = (tpl.template_version || 1) + 1;
      const newFields = input.fields || tpl.template_fields;
      const newDefaults = input.default_values || tpl.template_default_values;

      // Update template
      await getSql()`
        UPDATE clinical_templates SET
          template_name = ${input.name || tpl.template_name},
          template_description = ${input.description !== undefined ? input.description : tpl.template_description},
          template_fields = ${JSON.stringify(newFields)}::jsonb,
          template_default_values = ${JSON.stringify(newDefaults)}::jsonb,
          applicable_roles = ${JSON.stringify(input.applicable_roles || tpl.applicable_roles)}::jsonb,
          applicable_encounter_types = ${JSON.stringify(input.applicable_encounter_types || tpl.applicable_encounter_types)}::jsonb,
          template_tags = ${JSON.stringify(input.tags || tpl.template_tags)}::jsonb,
          template_version = ${newVersion},
          template_updated_at = NOW()
        WHERE id = ${input.id};
      `;

      // Create version snapshot
      const versionId = crypto.randomUUID();
      await getSql()`
        INSERT INTO clinical_template_versions (
          id, ctv_template_id, ctv_version_number, ctv_fields, ctv_default_values,
          ctv_change_summary, ctv_changed_by, ctv_created_at
        ) VALUES (
          ${versionId}, ${input.id}, ${newVersion}, ${JSON.stringify(newFields)}::jsonb,
          ${JSON.stringify(newDefaults)}::jsonb,
          ${input.change_summary}, ${userId}::uuid, NOW()
        );
      `;

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'clinical_templates',
        row_id: input.id, new_values: { version: newVersion, change_summary: input.change_summary },
      });

      return { id: input.id, version: newVersion };
    }),

  // ── Fork template (create personal copy) ──────────────────────────────
  fork: protectedProcedure
    .input(z.object({ id: z.string().uuid(), new_name: z.string().min(1).max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const source = await getSql()`
        SELECT * FROM clinical_templates WHERE id = ${input.id} AND hospital_id = ${hospitalId};
      `;
      if (!source || (source as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source template not found' });
      }
      const s = (source as any[])[0];
      const newId = crypto.randomUUID();

      await getSql()`
        INSERT INTO clinical_templates (
          id, hospital_id, template_name, template_description, template_category,
          template_scope, template_owner_id,
          applicable_roles, applicable_encounter_types,
          template_fields, template_default_values, ai_generation_prompt,
          template_version, template_is_active, template_is_locked,
          forked_from_id, template_tags, template_usage_count,
          template_created_by, template_created_at, template_updated_at
        ) VALUES (
          ${newId}, ${hospitalId}, ${input.new_name || s.template_name + ' (My Copy)'},
          ${s.template_description}, ${s.template_category},
          'personal', ${userId}::uuid,
          ${JSON.stringify(s.applicable_roles || [])}::jsonb,
          ${JSON.stringify(s.applicable_encounter_types || [])}::jsonb,
          ${JSON.stringify(s.template_fields)}::jsonb,
          ${JSON.stringify(s.template_default_values || {})}::jsonb,
          ${s.ai_generation_prompt || null},
          1, true, false,
          ${input.id}, ${JSON.stringify(s.template_tags || [])}::jsonb, 0,
          ${userId}::uuid, NOW(), NOW()
        );
      `;

      return { id: newId, forked_from: input.id };
    }),

  // ── Deactivate template ───────────────────────────────────────────────
  deactivate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await getSql()`
        UPDATE clinical_templates SET template_is_active = false, template_updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id};
      `;
      await writeAuditLog(ctx.user, {
        action: 'DELETE', table_name: 'clinical_templates', row_id: input.id,
      });
      return { success: true };
    }),

  // ── List versions ─────────────────────────────────────────────────────
  listVersions: protectedProcedure
    .input(z.object({ template_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await getSql()`
        SELECT v.*, u.full_name AS changed_by_name
        FROM clinical_template_versions v
        LEFT JOIN users u ON u.id = v.ctv_changed_by
        WHERE v.ctv_template_id = ${input.template_id}
        ORDER BY v.ctv_version_number DESC;
      `;
      return rows as any[];
    }),

  // ── Log usage ─────────────────────────────────────────────────────────
  logUsage: protectedProcedure
    .input(z.object({
      template_id: z.string().uuid(),
      template_version: z.number().int(),
      patient_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
      filled_data: z.record(z.any()),
      completion_time_seconds: z.number().int().optional(),
      fields_modified: z.array(z.string()).optional(),
      fields_skipped: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const logId = crypto.randomUUID();
      await getSql()`
        INSERT INTO clinical_template_usage_log (
          id, ctul_template_id, ctul_template_version, ctul_user_id,
          ctul_patient_id, ctul_encounter_id,
          ctul_filled_data, ctul_completion_time_seconds,
          ctul_fields_modified, ctul_fields_skipped, ctul_created_at
        ) VALUES (
          ${logId}, ${input.template_id}, ${input.template_version}, ${ctx.user.sub}::uuid,
          ${input.patient_id || null}::uuid, ${input.encounter_id || null}::uuid,
          ${JSON.stringify(input.filled_data)}::jsonb, ${input.completion_time_seconds || null},
          ${JSON.stringify(input.fields_modified || [])}::jsonb,
          ${JSON.stringify(input.fields_skipped || [])}::jsonb, NOW()
        );
      `;

      // Increment usage count
      await getSql()`
        UPDATE clinical_templates SET
          template_usage_count = template_usage_count + 1,
          template_last_used_at = NOW()
        WHERE id = ${input.template_id};
      `;

      return { id: logId };
    }),

  // ── List AI suggestions ───────────────────────────────────────────────
  listSuggestions: protectedProcedure
    .input(z.object({
      template_id: z.string().uuid().optional(),
      status: z.enum(['pending', 'accepted', 'rejected', 'expired']).optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const tplFilter = input.template_id || '';
      const statusFilter = input.status || 'pending';

      const rows = await getSql()`
        SELECT s.*, ct.template_name, ct.template_category
        FROM clinical_template_ai_suggestions s
        JOIN clinical_templates ct ON ct.id = s.ctas_template_id
        WHERE ct.hospital_id = ${hospitalId}
          AND (${tplFilter} = '' OR s.ctas_template_id = ${tplFilter}::uuid)
          AND s.ctas_status::text = ${statusFilter}
        ORDER BY s.ctas_confidence_score DESC, s.ctas_created_at DESC
        LIMIT 50;
      `;
      return rows as any[];
    }),

  // ── Review AI suggestion ──────────────────────────────────────────────
  reviewSuggestion: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      action: z.enum(['accept', 'reject']),
    }))
    .mutation(async ({ ctx, input }) => {
      const newStatus = input.action === 'accept' ? 'accepted' : 'rejected';

      // Update suggestion status
      await getSql()`
        UPDATE clinical_template_ai_suggestions SET
          ctas_status = ${newStatus},
          ctas_reviewed_by = ${ctx.user.sub}::uuid,
          ctas_reviewed_at = NOW()
        WHERE id = ${input.id};
      `;

      // If accepted, auto-apply the suggestion to the template
      if (input.action === 'accept') {
        const suggRows = await getSql()`
          SELECT ctas_template_id, ctas_suggestion_type, ctas_suggestion_data
          FROM clinical_template_ai_suggestions WHERE id = ${input.id}
        `;
        const sugg = (suggRows as any[])?.[0];
        if (sugg) {
          const tplRows = await getSql()`
            SELECT template_fields, template_version FROM clinical_templates WHERE id = ${sugg.ctas_template_id}
          `;
          const tpl = (tplRows as any[])?.[0];
          if (tpl) {
            let fields = tpl.template_fields || [];
            const data = sugg.ctas_suggestion_data || {};
            const newVersion = (tpl.template_version || 1) + 1;

            if (sugg.ctas_suggestion_type === 'field_removal') {
              // Mark field as optional instead of removing
              fields = fields.map((f: any) => f.id === data.field_id ? { ...f, required: false } : f);
            }
            // For default_change, we flag it but don't auto-change defaults (needs manual review)

            // Create new version
            await getSql()`
              UPDATE clinical_templates SET
                template_fields = ${JSON.stringify(fields)}::jsonb,
                template_version = ${newVersion},
                template_updated_at = NOW()
              WHERE id = ${sugg.ctas_template_id}
            `;
            await getSql()`
              INSERT INTO clinical_template_versions (id, ctv_template_id, ctv_version_number, ctv_fields, ctv_change_summary, ctv_changed_by)
              VALUES (gen_random_uuid(), ${sugg.ctas_template_id}, ${newVersion}, ${JSON.stringify(fields)}::jsonb,
                ${'AI suggestion accepted: ' + sugg.ctas_suggestion_type + ' for ' + (data.field_label || 'field')},
                ${ctx.user.sub}::uuid)
            `;
          }
        }
      }

      return { success: true, status: newStatus };
    }),

  // ── Usage stats (admin) ───────────────────────────────────────────────
  usageStats: adminProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const rows = await getSql()`
        SELECT
          ct.id, ct.template_name, ct.template_category, ct.template_scope,
          ct.template_usage_count, ct.template_version,
          ct.template_last_used_at, ct.template_created_at,
          COALESCE(AVG(l.ctul_completion_time_seconds), 0)::int AS avg_completion_seconds,
          COUNT(DISTINCT l.ctul_user_id)::int AS unique_users
        FROM clinical_templates ct
        LEFT JOIN clinical_template_usage_log l ON l.ctul_template_id = ct.id
        WHERE ct.hospital_id = ${hospitalId} AND ct.template_is_active = true
        GROUP BY ct.id
        ORDER BY ct.template_usage_count DESC
        LIMIT 100;
      `;
      return rows as any[];
    }),

  // ── AI: Generate template from description ────────────────────────────
  aiGenerate: protectedProcedure
    .input(z.object({
      description: z.string().min(10).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await generateTemplate({
        description: input.description,
        hospital_id: ctx.user.hospital_id,
        user_id: ctx.user.sub,
      });

      if (!result) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'AI template generation failed. Try a more detailed description or try again.',
        });
      }

      return result;
    }),

  // ── AI: Generate smart defaults for template fields ───────────────────
  aiSmartDefaults: protectedProcedure
    .input(z.object({
      fields: z.array(z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
        ai_hint: z.string().optional(),
      })),
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      diagnosis: z.string().optional(),
      chief_complaint: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Fetch patient context
      const hospitalId = ctx.user.hospital_id;
      const [vitals, labs, orders, problems, allergies] = await Promise.all([
        getSql()`
          SELECT observation_type, value_quantity, value_text, unit, effective_datetime
          FROM observations WHERE hospital_id = ${hospitalId} AND patient_id = ${input.patient_id}::uuid
          AND observation_type IN ('vital_temperature','vital_pulse','vital_bp_systolic','vital_bp_diastolic','vital_spo2','vital_rr')
          ORDER BY effective_datetime DESC LIMIT 12
        `,
        getSql()`
          SELECT lr.lr_test_code AS test_code, lr.lr_test_name AS test_name,
                 COALESCE(lr.value_numeric::text, lr.value_text) AS result_value,
                 (lr.lr_flag != 'normal') AS is_abnormal
          FROM lab_results lr JOIN lab_orders lo ON lo.id = lr.lr_order_id
          WHERE lo.hospital_id = ${hospitalId} AND lo.lo_patient_id = ${input.patient_id}::uuid
          ORDER BY lr.lr_resulted_at DESC LIMIT 10
        `,
        getSql()`
          SELECT drug_name, dose_quantity, dose_unit, route, frequency_code
          FROM medication_requests WHERE hospital_id = ${hospitalId} AND patient_id = ${input.patient_id}::uuid
          AND status = 'active' AND is_deleted = false
        `,
        getSql()`
          SELECT condition_name AS code_display FROM conditions
          WHERE hospital_id = ${hospitalId} AND patient_id = ${input.patient_id}::uuid
          AND clinical_status IN ('active','recurrence')
        `,
        getSql()`
          SELECT substance, reaction, severity FROM allergy_intolerances
          WHERE hospital_id = ${hospitalId} AND patient_id = ${input.patient_id}::uuid AND is_deleted = false
        `,
      ]);

      const defaults = await generateSmartDefaults({
        fields: input.fields,
        patientContext: {
          vitals: vitals as any[],
          labs: labs as any[],
          activeOrders: orders as any[],
          problems: problems as any[],
          allergies: allergies as any[],
          diagnosis: input.diagnosis,
          chief_complaint: input.chief_complaint,
        },
        hospital_id: hospitalId,
        user_id: ctx.user.sub,
      });

      return { defaults, ai_generated: true };
    }),

  // ── Template analytics (per template) ─────────────────────────────────
  templateAnalytics: protectedProcedure
    .input(z.object({ template_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [usage, fieldStats, timeStats] = await Promise.all([
        // Usage over last 30 days
        getSql()`
          SELECT DATE(ctul_created_at) AS day, COUNT(*)::int AS uses
          FROM clinical_template_usage_log
          WHERE ctul_template_id = ${input.template_id}
            AND ctul_created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(ctul_created_at)
          ORDER BY day
        `,
        // Most modified fields
        getSql()`
          SELECT field_id, COUNT(*)::int AS modify_count
          FROM clinical_template_usage_log,
               LATERAL jsonb_array_elements_text(ctul_fields_modified) AS field_id
          WHERE ctul_template_id = ${input.template_id}
          GROUP BY field_id
          ORDER BY modify_count DESC
          LIMIT 10
        `,
        // Completion time distribution
        getSql()`
          SELECT
            COUNT(*)::int AS total_uses,
            ROUND(AVG(ctul_completion_time_seconds))::int AS avg_seconds,
            MIN(ctul_completion_time_seconds)::int AS min_seconds,
            MAX(ctul_completion_time_seconds)::int AS max_seconds,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ctul_completion_time_seconds)::int AS median_seconds
          FROM clinical_template_usage_log
          WHERE ctul_template_id = ${input.template_id}
            AND ctul_completion_time_seconds > 0
        `,
      ]);

      return {
        daily_usage: usage as any[],
        most_modified_fields: fieldStats as any[],
        completion_time: (timeStats as any[])?.[0] || {},
      };
    }),
});
