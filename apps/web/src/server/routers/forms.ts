import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';
import { generateFormDataHash } from '@/lib/forms/hash';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// FORM ENGINE — SC.1
// CRUD + submission handling + audit logging + analytics
// ============================================================

const fieldConditionSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(['field', 'group']),
    fieldId: z.string().optional(),
    operator: z.string().optional(),
    value: z.any().optional(),
    logic: z.enum(['AND', 'OR']).optional(),
    conditions: z.array(fieldConditionSchema).optional(),
  })
);

const fieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  type: z.string(),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  validation: z.object({
    type: z.enum(['optional', 'required', 'custom']).optional(),
    pattern: z.string().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    customMessage: z.string().optional(),
  }).optional(),
  visibility: z.object({
    type: z.enum(['always', 'conditional', 'hidden']).optional(),
    condition: fieldConditionSchema.optional(),
  }).optional(),
  roleVisibility: z.record(z.boolean()).optional(),
  defaultValue: z.any().optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
  })).optional(),
  metadata: z.record(z.any()).optional(),
  piping: z.object({
    type: z.enum(['none', 'patient_data', 'encounter_data', 'custom']).optional(),
    source: z.string().optional(),
  }).optional(),
});

const sectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  instruction: z.string().optional(),
  fields: z.array(fieldSchema),
  visibility: z.object({
    type: z.enum(['always', 'conditional', 'hidden']).optional(),
    condition: fieldConditionSchema.optional(),
  }).optional(),
  repeatable: z.object({
    enabled: z.boolean().optional(),
    minInstances: z.number().optional(),
    maxInstances: z.number().optional(),
  }).optional(),
  metadata: z.record(z.any()).optional(),
});

const formDefinitionSchema = z.object({
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(128),
  description: z.string().optional(),
  category: z.enum(['clinical', 'operational', 'administrative', 'custom']).default('custom'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  sections: z.array(sectionSchema),
  requires_patient: z.boolean().default(false),
  applicable_roles: z.array(z.string()).default([]),
  applicable_encounter_types: z.array(z.string()).optional(),
  role_field_visibility: z.record(z.record(z.boolean())).optional(),
  slash_command: z.string().max(64).optional(),
  slash_role_action_map: z.record(z.record(z.string())).optional(),
  layout: z.enum(['scroll', 'wizard', 'auto']).default('auto'),
  submission_target: z.enum(['form_submissions', 'his_router', 'clinical_template']).default('form_submissions'),
  submit_endpoint: z.string().optional(),
  template_slug: z.string().max(128).optional(),
  submit_transform: z.string().optional(),
  source_url: z.string().optional(),
  ported_from: z.string().max(128).optional(),
});

export const formsRouter = router({

  // ── LIST DEFINITIONS ──────────────────────────────────────────────────────
  listDefinitions: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.enum(['clinical', 'operational', 'administrative', 'custom', 'all']).default('all'),
      status: z.enum(['draft', 'active', 'archived', 'all']).default('all'),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const searchTerm = input.search ? `%${input.search}%` : '%';

      let query = `
        SELECT id, hospital_id, name, slug, description, category, version, status,
               sections, requires_patient, applicable_roles, layout,
               submission_target, slash_command, created_by, created_at, updated_at
        FROM form_definitions
        WHERE hospital_id = $1
      `;
      const params: any[] = [hospitalId];
      let paramCount = 1;

      if (input.category && input.category !== 'all') {
        paramCount++;
        query += ` AND category = $${paramCount}`;
        params.push(input.category);
      }

      if (input.status && input.status !== 'all') {
        paramCount++;
        query += ` AND status = $${paramCount}`;
        params.push(input.status);
      }

      if (input.search) {
        paramCount++;
        query += ` AND (name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
        params.push(searchTerm);
      }

      query += ` ORDER BY updated_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(input.limit, input.offset);

      const rows = await getSql()(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) as count FROM form_definitions WHERE hospital_id = $1';
      const countParams: any[] = [hospitalId];
      let countParamCount = 1;

      if (input.category && input.category !== 'all') {
        countParamCount++;
        countQuery += ` AND category = $${countParamCount}`;
        countParams.push(input.category);
      }

      if (input.status && input.status !== 'all') {
        countParamCount++;
        countQuery += ` AND status = $${countParamCount}`;
        countParams.push(input.status);
      }

      if (input.search) {
        countParamCount++;
        countQuery += ` AND (name ILIKE $${countParamCount} OR description ILIKE $${countParamCount})`;
        countParams.push(searchTerm);
      }

      const countResult = await getSql()(countQuery, countParams);
      const total = Number((countResult[0] as any)?.count ?? 0);

      return { items: rows as any[], total, limit: input.limit, offset: input.offset };
    }),

  // ── GET DEFINITION ────────────────────────────────────────────────────────
  getDefinition: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      slug: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (!input.id && !input.slug) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Either id or slug required' });
      }

      const hospitalId = ctx.user.hospital_id;
      const query = input.id
        ? 'SELECT * FROM form_definitions WHERE id = $1 AND hospital_id = $2'
        : 'SELECT * FROM form_definitions WHERE slug = $1 AND hospital_id = $2';

      const params = [input.id || input.slug, hospitalId];
      const rows = await getSql()(query, params);

      if (!rows || (rows as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form definition not found' });
      }

      return (rows as any[])[0];
    }),

  // ── GET BY SLASH COMMAND ──────────────────────────────────────────────────
  getFormBySlashCommand: protectedProcedure
    .input(z.object({
      slash_command: z.string().max(64),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userRole = ctx.user.role;

      const query = `
        SELECT * FROM form_definitions
        WHERE hospital_id = $1
          AND slash_command = $2
          AND status = 'active'
          AND (
            applicable_roles::text = '[]'
            OR applicable_roles @> $3::jsonb
          )
        LIMIT 1
      `;

      const rows = await getSql()(query, [hospitalId, input.slash_command, JSON.stringify([userRole])]);

      if (!rows || (rows as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found for this command and role' });
      }

      return (rows as any[])[0];
    }),

  // ── CREATE DEFINITION ─────────────────────────────────────────────────────
  createDefinition: adminProcedure
    .input(formDefinitionSchema)
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const formId = crypto.randomUUID();

      // Check for slug uniqueness
      const existingRows = await getSql()`
        SELECT id FROM form_definitions
        WHERE hospital_id = ${hospitalId} AND slug = ${input.slug}
        LIMIT 1
      `;

      if (existingRows && (existingRows as any[]).length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Form slug already exists' });
      }

      // Insert form definition
      await getSql()`
        INSERT INTO form_definitions (
          id, hospital_id, name, slug, description, category, version, status,
          sections, requires_patient, applicable_roles, applicable_encounter_types,
          role_field_visibility, slash_command, slash_role_action_map, layout,
          submission_target, submit_endpoint, template_slug, submit_transform,
          source_url, ported_from, created_by, created_at, updated_at
        ) VALUES (
          ${formId}, ${hospitalId}, ${input.name}, ${input.slug},
          ${input.description || null}, ${input.category}, 1, ${input.status},
          ${JSON.stringify(input.sections)}::jsonb,
          ${input.requires_patient}, ${JSON.stringify(input.applicable_roles)}::jsonb,
          ${input.applicable_encounter_types ? JSON.stringify(input.applicable_encounter_types) : null}::jsonb,
          ${input.role_field_visibility ? JSON.stringify(input.role_field_visibility) : null}::jsonb,
          ${input.slash_command || null}, ${input.slash_role_action_map ? JSON.stringify(input.slash_role_action_map) : null}::jsonb,
          ${input.layout}, ${input.submission_target}, ${input.submit_endpoint || null},
          ${input.template_slug || null}, ${input.submit_transform || null},
          ${input.source_url || null}, ${input.ported_from || null},
          ${userId}::uuid, NOW(), NOW()
        )
      `;

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'form_definitions',
        row_id: formId,
        new_values: { ...input, id: formId, hospital_id: hospitalId, version: 1, created_by: userId },
      });

      return { id: formId, ...input, version: 1, created_by: userId };
    }),

  // ── UPDATE DEFINITION (creates new version) ───────────────────────────────
  updateDefinition: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      ...formDefinitionSchema.omit({ slug: true }).shape,
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const { id, ...updates } = input;

      // Get current definition
      const currentRows = await getSql()`
        SELECT * FROM form_definitions
        WHERE id = ${id} AND hospital_id = ${hospitalId}
        LIMIT 1
      `;

      if (!currentRows || (currentRows as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form definition not found' });
      }

      const current = (currentRows as any[])[0];
      const newVersion = (current.version || 1) + 1;

      // Update the definition
      await getSql()`
        UPDATE form_definitions
        SET
          name = ${updates.name || current.name},
          description = ${updates.description !== undefined ? updates.description : current.description},
          category = ${updates.category || current.category},
          status = ${updates.status || current.status},
          sections = ${updates.sections ? JSON.stringify(updates.sections) : current.sections}::jsonb,
          requires_patient = ${updates.requires_patient !== undefined ? updates.requires_patient : current.requires_patient},
          applicable_roles = ${updates.applicable_roles ? JSON.stringify(updates.applicable_roles) : current.applicable_roles}::jsonb,
          layout = ${updates.layout || current.layout},
          submission_target = ${updates.submission_target || current.submission_target},
          slash_command = ${updates.slash_command || current.slash_command},
          version = ${newVersion},
          updated_at = NOW()
        WHERE id = ${id}
      `;

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'form_definitions',
        row_id: id,
        new_values: { ...updates, version: newVersion },
      });

      return { id, ...updates, version: newVersion };
    }),

  // ── ARCHIVE DEFINITION ────────────────────────────────────────────────────
  archiveDefinition: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      await getSql()`
        UPDATE form_definitions
        SET status = 'archived', updated_at = NOW()
        WHERE id = ${input.id} AND hospital_id = ${hospitalId}
      `;

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'form_definitions',
        row_id: input.id,
        new_values: { status: 'archived' },
      });

      return { success: true };
    }),

  // ── SUBMIT FORM ───────────────────────────────────────────────────────────
  submit: protectedProcedure
    .input(z.object({
      form_definition_id: z.string().uuid(),
      patient_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
      channel_id: z.string().uuid().optional(),
      form_data: z.record(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const submissionId = crypto.randomUUID();

      // Generate hash
      const formDataHash = await generateFormDataHash(input.form_data);

      // Check for previous submission (version chain)
      let parentSubmissionId: string | null = null;
      let version = 1;

      if (input.patient_id && input.form_definition_id) {
        const prevRows = await getSql()`
          SELECT id, version FROM form_submissions
          WHERE hospital_id = ${hospitalId}
            AND form_definition_id = ${input.form_definition_id}
            AND patient_id = ${input.patient_id}::uuid
          ORDER BY version DESC
          LIMIT 1
        `;

        if (prevRows && (prevRows as any[]).length > 0) {
          parentSubmissionId = (prevRows[0] as any).id;
          version = ((prevRows[0] as any).version || 0) + 1;
        }
      }

      // Insert submission
      await getSql()`
        INSERT INTO form_submissions (
          id, hospital_id, form_definition_id, patient_id, encounter_id,
          channel_id, parent_submission_id, version, form_data, form_data_hash,
          status, submitted_by, submitted_at, created_at
        ) VALUES (
          ${submissionId}, ${hospitalId}, ${input.form_definition_id},
          ${input.patient_id || null}::uuid, ${input.encounter_id || null}::uuid,
          ${input.channel_id || null}::uuid, ${parentSubmissionId || null}::uuid,
          ${version}, ${JSON.stringify(input.form_data)}::jsonb, ${formDataHash},
          'submitted', ${userId}::uuid, NOW(), NOW()
        )
      `;

      // Insert audit log
      await getSql()`
        INSERT INTO form_audit_log (
          hospital_id, form_definition_id, form_submission_id, patient_id,
          action, field_snapshot, performed_by, performed_at
        ) VALUES (
          ${hospitalId}, ${input.form_definition_id}, ${submissionId}::uuid,
          ${input.patient_id || null}::uuid, 'form_submitted',
          ${JSON.stringify(input.form_data)}::jsonb, ${userId}::uuid, NOW()
        )
      `;

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'form_submissions',
        row_id: submissionId,
        new_values: { ...input, id: submissionId, version, form_data_hash: formDataHash },
      });

      return { submission_id: submissionId, version, form_data_hash: formDataHash };
    }),

  // ── GET SUBMISSION ────────────────────────────────────────────────────────
  getSubmission: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const rows = await getSql()`
        SELECT * FROM form_submissions
        WHERE id = ${input.id} AND hospital_id = ${hospitalId}
      `;

      if (!rows || (rows as any[]).length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found' });
      }

      return (rows as any[])[0];
    }),

  // ── LIST SUBMISSIONS (patient + form) ──────────────────────────────────────
  listSubmissions: protectedProcedure
    .input(z.object({
      form_definition_id: z.string().uuid(),
      patient_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      let query = `
        SELECT * FROM form_submissions
        WHERE hospital_id = $1 AND form_definition_id = $2
      `;
      const params: any[] = [hospitalId, input.form_definition_id];
      let paramCount = 2;

      if (input.patient_id) {
        paramCount++;
        query += ` AND patient_id = $${paramCount}::uuid`;
        params.push(input.patient_id);
      }

      query += ` ORDER BY submitted_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(input.limit, input.offset);

      const rows = await getSql()(query, params);
      return { items: rows as any[], limit: input.limit, offset: input.offset };
    }),

  // ── LOG ANALYTICS EVENT ───────────────────────────────────────────────────
  logAnalyticsEvent: adminProcedure
    .input(z.object({
      form_definition_id: z.string().uuid(),
      session_id: z.string(),
      event_type: z.enum(['form_start', 'field_focus', 'field_blur', 'section_enter', 'form_submit', 'form_abandon']),
      field_id: z.string().optional(),
      section_id: z.string().optional(),
      duration_ms: z.number().optional(),
      metadata: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      await getSql()`
        INSERT INTO form_analytics_events (
          hospital_id, form_definition_id, session_id, event_type,
          field_id, section_id, duration_ms, metadata, created_at
        ) VALUES (
          ${hospitalId}, ${input.form_definition_id}, ${input.session_id},
          ${input.event_type}, ${input.field_id || null}, ${input.section_id || null},
          ${input.duration_ms || null}, ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb,
          NOW()
        )
      `;

      return { success: true };
    }),

  // ── GET ANALYTICS ─────────────────────────────────────────────────────────
  getAnalytics: adminProcedure
    .input(z.object({
      form_definition_id: z.string().uuid(),
      days: z.number().default(30),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Get submission analytics
      const submissionStats = await getSql()`
        SELECT
          COUNT(*) as total_submissions,
          COUNT(DISTINCT patient_id) as unique_patients,
          COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted_count,
          COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
          COUNT(CASE WHEN status = 'locked' THEN 1 END) as locked_count,
          AVG(EXTRACT(EPOCH FROM (submitted_at - created_at))) as avg_completion_time_sec
        FROM form_submissions
        WHERE hospital_id = ${hospitalId}
          AND form_definition_id = ${input.form_definition_id}
          AND submitted_at > NOW() - INTERVAL '${input.days} days'
      `;

      // Get event analytics
      const eventStats = await getSql()`
        SELECT
          event_type,
          COUNT(*) as event_count,
          AVG(COALESCE(duration_ms, 0)) as avg_duration_ms
        FROM form_analytics_events
        WHERE hospital_id = ${hospitalId}
          AND form_definition_id = ${input.form_definition_id}
          AND created_at > NOW() - INTERVAL '${input.days} days'
        GROUP BY event_type
      `;

      return {
        submissions: (submissionStats as any[])[0],
        events: eventStats as any[],
        period_days: input.days,
      };
    }),
});
