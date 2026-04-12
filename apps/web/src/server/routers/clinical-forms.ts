import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import {
  patientConsents, clinicalFormTemplates, clinicalForms,
  consentTemplates, encounters, patients,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, count, isNull } from 'drizzle-orm';

// ============================================================
// SCHEMAS
// ============================================================

const consentStatusValues = ['pending', 'signed', 'refused', 'revoked'] as const;
const formStatusValues = ['draft', 'submitted', 'reviewed', 'locked'] as const;
const formTemplateStatusValues = ['active', 'draft', 'archived'] as const;

// Field definition for form templates
const fieldDefinitionSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(255),
  type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox', 'email', 'phone']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(), // for select/radio/checkbox
  validation: z.record(z.any()).optional(),
});

export const clinicalFormsRouter = router({
  // ═══════════════════════════════════════════════════════════
  // CONSENT ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  // ─── CREATE CONSENT ────────────────────────────────────────
  createConsent: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      template_id: z.string().uuid(),
      consent_status: z.enum(['pending', 'signed']).default('pending'),
      signed_by_name: z.string().max(255).optional(),
      relationship: z.string().max(50).optional(),
      signature_data: z.string().optional(), // base64 or "verbal"
      witnessed_by_user_id: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is in-progress
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (!encounter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });
      }

      // 2. Verify consent template exists and is active
      const [template] = await db.select({
        id: consentTemplates.id,
        name: consentTemplates.name,
      })
        .from(consentTemplates)
        .where(and(
          eq(consentTemplates.id, input.template_id as any),
          eq(consentTemplates.status, 'active'),
        ))
        .limit(1);

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Consent template not found or inactive' });
      }

      // 3. Create consent record
      const now = new Date();
      const [consent] = await db.insert(patientConsents).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        template_id: input.template_id,
        consent_status: input.consent_status as any,
        signed_by_name: input.signed_by_name || null,
        relationship: input.relationship || null,
        signature_data: input.signature_data || null,
        signed_at: input.consent_status === 'signed' ? now : null,
        witnessed_by_user_id: input.witnessed_by_user_id || null,
        created_by_user_id: ctx.user.sub,
      }).returning();

      // 4. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'patient_consents',
        row_id: consent.id,
        new_values: {
          template_name: template.name,
          consent_status: input.consent_status,
          encounter_id: input.encounter_id,
        },
      });

      return {
        consent_id: consent.id,
        template_name: template.name,
        consent_status: consent.consent_status,
      };
    }),

  // ─── LIST CONSENTS ────────────────────────────────────────
  listConsents: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      // Build filter
      const filters = [eq(patientConsents.hospital_id, hospitalId)];
      if (input.encounter_id) filters.push(eq(patientConsents.encounter_id, input.encounter_id as any));
      if (input.patient_id) filters.push(eq(patientConsents.patient_id, input.patient_id as any));

      const result = await db.execute(sql`
        SELECT
          pc.id, pc.consent_status, pc.signed_by_name, pc.relationship,
          pc.signed_at, pc.refused_reason, pc.revoked_at, pc.revoke_reason,
          pc.created_at,
          ct.id as template_id, ct.name as template_name, ct.category as template_category
        FROM ${patientConsents} pc
        JOIN ${consentTemplates} ct ON pc.template_id = ct.id
        WHERE pc.hospital_id = ${hospitalId}
          ${input.encounter_id ? sql`AND pc.encounter_id = ${input.encounter_id}::uuid` : sql``}
          ${input.patient_id ? sql`AND pc.patient_id = ${input.patient_id}::uuid` : sql``}
        ORDER BY pc.created_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM ${patientConsents} pc
        WHERE pc.hospital_id = ${hospitalId}
          ${input.encounter_id ? sql`AND pc.encounter_id = ${input.encounter_id}::uuid` : sql``}
          ${input.patient_id ? sql`AND pc.patient_id = ${input.patient_id}::uuid` : sql``}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
    }),

  // ─── UPDATE CONSENT STATUS ────────────────────────────────
  updateConsentStatus: protectedProcedure
    .input(z.object({
      consent_id: z.string().uuid(),
      action: z.enum(['sign', 'refuse', 'revoke']),
      signed_by_name: z.string().max(255).optional(),
      relationship: z.string().max(50).optional(),
      signature_data: z.string().optional(),
      refused_reason: z.string().max(1000).optional(),
      revoke_reason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // 1. Fetch consent
      const [consent] = await db.select()
        .from(patientConsents)
        .where(and(
          eq(patientConsents.id, input.consent_id as any),
          eq(patientConsents.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!consent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Consent not found' });
      }

      // 2. Validate state transitions
      if (input.action === 'sign') {
        if (consent.consent_status !== 'pending') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot sign consent with status: ${consent.consent_status}`,
          });
        }
      } else if (input.action === 'refuse') {
        if (consent.consent_status !== 'pending') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot refuse consent with status: ${consent.consent_status}`,
          });
        }
      } else if (input.action === 'revoke') {
        if (consent.consent_status !== 'signed') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Can only revoke signed consents; current status: ${consent.consent_status}`,
          });
        }
      }

      // 3. Update based on action
      const now = new Date();
      let updates: any = { updated_at: now };

      if (input.action === 'sign') {
        updates = {
          ...updates,
          consent_status: 'signed' as any,
          signed_at: now,
          signed_by_name: input.signed_by_name || null,
          relationship: input.relationship || null,
          signature_data: input.signature_data || null,
        };
      } else if (input.action === 'refuse') {
        updates = {
          ...updates,
          consent_status: 'refused' as any,
          refused_reason: input.refused_reason || null,
        };
      } else if (input.action === 'revoke') {
        updates = {
          ...updates,
          consent_status: 'revoked' as any,
          revoked_at: now,
          revoke_reason: input.revoke_reason || null,
        };
      }

      await db.update(patientConsents)
        .set(updates)
        .where(eq(patientConsents.id, input.consent_id as any));

      // 4. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'patient_consents',
        row_id: consent.id,
        new_values: {
          consent_status: updates.consent_status || consent.consent_status,
          action: input.action,
        },
      });

      return {
        consent_id: consent.id,
        consent_status: updates.consent_status || consent.consent_status,
      };
    }),

  // ═══════════════════════════════════════════════════════════
  // CLINICAL FORM TEMPLATE ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  // ─── CREATE FORM TEMPLATE ─────────────────────────────────
  createFormTemplate: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      category: z.string().min(1).max(50), // intake, assessment, screening, discharge, followup
      description: z.string().max(1000).optional(),
      fields_schema: z.array(fieldDefinitionSchema).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // Create template
      const [template] = await db.insert(clinicalFormTemplates).values({
        hospital_id: hospitalId,
        name: input.name,
        category: input.category,
        description: input.description || null,
        version: 1,
        status: 'active' as any,
        fields_schema: input.fields_schema as any, // JSON
        created_by: ctx.user.sub,
      }).returning();

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'clinical_form_templates',
        row_id: template.id,
        new_values: {
          name: input.name,
          category: input.category,
          fields_count: input.fields_schema.length,
        },
      });

      return {
        template_id: template.id,
        name: template.name,
        category: template.category,
        fields_count: input.fields_schema.length,
      };
    }),

  // ─── LIST FORM TEMPLATES ──────────────────────────────────
  listFormTemplates: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      status: z.enum(['active', 'draft', 'archived']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      const filters = [eq(clinicalFormTemplates.hospital_id, hospitalId)];
      if (input.category) filters.push(eq(clinicalFormTemplates.category, input.category));
      if (input.status) filters.push(eq(clinicalFormTemplates.status, input.status as any));

      const templates = await db.select({
        id: clinicalFormTemplates.id,
        name: clinicalFormTemplates.name,
        category: clinicalFormTemplates.category,
        description: clinicalFormTemplates.description,
        version: clinicalFormTemplates.version,
        status: clinicalFormTemplates.status,
        created_at: clinicalFormTemplates.created_at,
      })
        .from(clinicalFormTemplates)
        .where(and(...filters))
        .orderBy(desc(clinicalFormTemplates.created_at));

      return templates;
    }),

  // ═══════════════════════════════════════════════════════════
  // CLINICAL FORM SUBMISSION ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  // ─── SUBMIT FORM ───────────────────────────────────────────
  submitForm: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      template_id: z.string().uuid(),
      form_data: z.record(z.any()), // { field_key: value } pairs
      form_status: z.enum(['draft', 'submitted']).default('submitted'),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is in-progress
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (!encounter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });
      }

      // 2. Verify template exists and is active
      const [template] = await db.select({
        id: clinicalFormTemplates.id,
        name: clinicalFormTemplates.name,
      })
        .from(clinicalFormTemplates)
        .where(and(
          eq(clinicalFormTemplates.id, input.template_id as any),
          eq(clinicalFormTemplates.hospital_id, hospitalId),
          eq(clinicalFormTemplates.status, 'active'),
        ))
        .limit(1);

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form template not found or inactive' });
      }

      // 3. Create form submission
      const now = new Date();
      const [form] = await db.insert(clinicalForms).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        template_id: input.template_id,
        form_status: input.form_status as any,
        form_data: input.form_data as any,
        submitted_by_user_id: ctx.user.sub,
        submitted_at: input.form_status === 'submitted' ? now : null,
      }).returning();

      // 4. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'clinical_forms',
        row_id: form.id,
        new_values: {
          template_name: template.name,
          form_status: input.form_status,
          encounter_id: input.encounter_id,
        },
      });

      return {
        form_id: form.id,
        template_name: template.name,
        form_status: form.form_status,
      };
    }),

  // ─── LIST FORMS ────────────────────────────────────────────
  listForms: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid().optional(),
      template_id: z.string().uuid().optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      const filters = [eq(clinicalForms.hospital_id, hospitalId)];
      if (input.encounter_id) filters.push(eq(clinicalForms.encounter_id, input.encounter_id as any));
      if (input.template_id) filters.push(eq(clinicalForms.template_id, input.template_id as any));

      const result = await db.execute(sql`
        SELECT
          cf.id, cf.form_status, cf.submitted_at, cf.reviewed_at, cf.locked_at,
          cf.created_at,
          cft.id as template_id, cft.name as template_name, cft.category as template_category
        FROM ${clinicalForms} cf
        JOIN ${clinicalFormTemplates} cft ON cf.template_id = cft.id
        WHERE cf.hospital_id = ${hospitalId}
          ${input.encounter_id ? sql`AND cf.encounter_id = ${input.encounter_id}::uuid` : sql``}
          ${input.template_id ? sql`AND cf.template_id = ${input.template_id}::uuid` : sql``}
        ORDER BY cf.created_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM ${clinicalForms} cf
        WHERE cf.hospital_id = ${hospitalId}
          ${input.encounter_id ? sql`AND cf.encounter_id = ${input.encounter_id}::uuid` : sql``}
          ${input.template_id ? sql`AND cf.template_id = ${input.template_id}::uuid` : sql``}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
    }),

  // ─── REVIEW FORM ───────────────────────────────────────────
  reviewForm: protectedProcedure
    .input(z.object({
      form_id: z.string().uuid(),
      action: z.enum(['review', 'lock']),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const hospitalId = ctx.user.hospital_id;

      // 1. Fetch form
      const [form] = await db.select()
        .from(clinicalForms)
        .where(and(
          eq(clinicalForms.id, input.form_id as any),
          eq(clinicalForms.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!form) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' });
      }

      // 2. Validate transitions
      if (input.action === 'review') {
        if (form.form_status !== 'submitted') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Can only review submitted forms; current status: ${form.form_status}`,
          });
        }
      } else if (input.action === 'lock') {
        if (form.form_status !== 'submitted' && form.form_status !== 'reviewed') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Can only lock submitted or reviewed forms; current status: ${form.form_status}`,
          });
        }
      }

      // 3. Update form
      const now = new Date();
      let updates: any = { updated_at: now };

      if (input.action === 'review') {
        updates = {
          ...updates,
          form_status: 'reviewed' as any,
          reviewed_by_user_id: ctx.user.sub,
          reviewed_at: now,
        };
      } else if (input.action === 'lock') {
        updates = {
          ...updates,
          form_status: 'locked' as any,
          locked_at: now,
        };
      }

      await db.update(clinicalForms)
        .set(updates)
        .where(eq(clinicalForms.id, input.form_id as any));

      // 4. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'clinical_forms',
        row_id: form.id,
        new_values: {
          form_status: updates.form_status || form.form_status,
          action: input.action,
        },
      });

      return {
        form_id: form.id,
        form_status: updates.form_status || form.form_status,
      };
    }),

  // ═══════════════════════════════════════════════════════════
  // STATS ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  // ─── FORM STATS ────────────────────────────────────────────
  formStats: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const hospitalId = ctx.user.hospital_id;

    // Consent stats
    const consentStats = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE consent_status = 'pending')::int as pending,
        count(*) FILTER (WHERE consent_status = 'signed')::int as signed,
        count(*) FILTER (WHERE consent_status = 'refused')::int as refused,
        count(*) FILTER (WHERE consent_status = 'revoked')::int as revoked
      FROM ${patientConsents}
      WHERE hospital_id = ${hospitalId}
    `);

    // Form stats
    const formStats = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE form_status = 'draft')::int as draft,
        count(*) FILTER (WHERE form_status = 'submitted')::int as submitted,
        count(*) FILTER (WHERE form_status = 'reviewed')::int as reviewed,
        count(*) FILTER (WHERE form_status = 'locked')::int as locked
      FROM ${clinicalForms}
      WHERE hospital_id = ${hospitalId}
    `);

    const consentRows = (consentStats as any).rows || consentStats;
    const formRows = (formStats as any).rows || formStats;

    return {
      consents: consentRows[0] || { pending: 0, signed: 0, refused: 0, revoked: 0 },
      forms: formRows[0] || { draft: 0, submitted: 0, reviewed: 0, locked: 0 },
    };
  }),
});
