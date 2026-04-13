import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ─── ENUMS AND VALIDATION SCHEMAS ─────────────────────────────────────────

const incidentTypeEnum = z.enum([
  'near_miss',
  'adverse_event',
  'sentinel_event',
  'medication_error',
  'fall',
  'infection',
  'equipment_failure',
  'surgical_complication',
  'patient_complaint',
]);

const incidentSeverityEnum = z.enum(['minor', 'moderate', 'major', 'catastrophic']);

const incidentStatusEnum = z.enum(['open', 'investigating', 'closed', 'no_action_needed']);

const medErrorSeverityEnum = z.enum(['near_miss', 'potential_harm', 'temporary_harm', 'permanent_harm', 'death']);

const fallRiskCategoryEnum = z.enum(['no_risk', 'low_risk', 'high_risk']);

const fallInjurySeverityEnum = z.enum(['none', 'minor_abrasion', 'moderate_bruising', 'fracture', 'intracranial_injury', 'death']);

const fallContributingFactorsEnum = z.enum([
  'poor_lighting',
  'wet_surface',
  'cluttered_environment',
  'inadequate_handrails',
  'improper_footwear',
  'medication_side_effects',
  'cognitive_impairment',
  'weakness',
  'visual_impairment',
  'balance_disorder',
  'delirium',
]);

const approvalStatusEnum = z.enum(['draft', 'approved', 'rejected']);

const auditOperationEnum = z.enum(['CREATE', 'UPDATE', 'ROUTE', 'CLOSE', 'ESCALATE']);

// ─── ADVERSE EVENTS / INCIDENTS ────────────────────────────────────────────

const reportIncidentInput = z.object({
  incident_type: incidentTypeEnum,
  ae_severity: incidentSeverityEnum.optional(),
  incident_description: z.string().min(1).max(5000),
  incident_date: z.string().datetime(),
  incident_location_text: z.string().max(255).optional(),
  incident_location_id: z.string().uuid().optional(),
  involved_staff_ids: z.string().optional(), // comma-separated
  witness_names: z.string().optional(),
  immediate_actions_taken: z.string().optional(),
  patient_outcome_statement: z.string().optional(),
  ae_patient_id: z.string().uuid().optional(),
  ae_encounter_id: z.string().uuid().optional(),
  anonymous: z.boolean().default(false),
});

const updateIncidentInput = z.object({
  incident_id: z.string().uuid(),
  incident_description: z.string().max(5000).optional(),
  ae_severity: incidentSeverityEnum.optional(),
  incident_location_text: z.string().max(255).optional(),
  incident_location_id: z.string().uuid().optional(),
  involved_staff_ids: z.string().optional(),
  witness_names: z.string().optional(),
  immediate_actions_taken: z.string().optional(),
  patient_outcome_statement: z.string().optional(),
});

const updateIncidentStatusInput = z.object({
  incident_id: z.string().uuid(),
  ae_status: incidentStatusEnum,
  reason: z.string().optional(),
});

const listIncidentsInput = z.object({
  incident_type: incidentTypeEnum.optional(),
  ae_severity: incidentSeverityEnum.optional(),
  ae_status: incidentStatusEnum.optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  ae_patient_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

const getIncidentInput = z.object({
  incident_id: z.string().uuid(),
});

// ─── MEDICATION ERRORS ─────────────────────────────────────────────────────

const reportMedErrorInput = z.object({
  incident_type: z.literal('medication_error'),
  ae_severity: incidentSeverityEnum.optional(),
  incident_description: z.string().min(1).max(5000),
  incident_date: z.string().datetime(),
  incident_location_text: z.string().max(255).optional(),
  involved_staff_ids: z.string().optional(),
  witness_names: z.string().optional(),
  ae_patient_id: z.string().uuid().optional(),
  ae_encounter_id: z.string().uuid().optional(),
  anonymous: z.boolean().default(false),
  error_types: z.string(), // comma-separated
  me_severity: medErrorSeverityEnum,
  prescribed_medication: z.string().max(255),
  dispensed_medication: z.string().max(255),
});

const listMedErrorsInput = z.object({
  error_type: z.string().optional(),
  me_severity: medErrorSeverityEnum.optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

// ─── FALL ASSESSMENTS ──────────────────────────────────────────────────────

const assessFallRiskInput = z.object({
  fa_patient_id: z.string().uuid(),
  fa_encounter_id: z.string().uuid().optional(),
  history_of_falls: z.number().int().min(0).max(25),
  secondary_diagnosis: z.number().int().min(0).max(15),
  ambulatory_aid: z.number().int().min(0).max(30),
  iv_or_heparin_lock: z.number().int().min(0).max(20),
  gait: z.number().int().min(0).max(20),
  mental_status: z.number().int().min(0).max(15),
  assessment_notes: z.string().optional(),
});

const listFallAssessmentsInput = z.object({
  fa_patient_id: z.string().uuid().optional(),
  fa_encounter_id: z.string().uuid().optional(),
  risk_category: fallRiskCategoryEnum.optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

const getLatestAssessmentInput = z.object({
  fa_patient_id: z.string().uuid(),
});

// ─── FALL EVENTS ───────────────────────────────────────────────────────────

const reportFallInput = z.object({
  incident_type: z.literal('fall'),
  ae_severity: incidentSeverityEnum.optional(),
  incident_description: z.string().min(1).max(5000),
  incident_date: z.string().datetime(),
  incident_location_text: z.string().max(255).optional(),
  involved_staff_ids: z.string().optional(),
  witness_names: z.string().optional(),
  immediate_actions_taken: z.string().optional(),
  fe_patient_id: z.string().uuid(),
  fe_encounter_id: z.string().uuid().optional(),
  anonymous: z.boolean().default(false),
  fall_date: z.string().datetime(),
  witnessed: z.boolean().default(false),
  fall_location: z.string().max(255).optional(),
  fall_cause: z.string().max(255).optional(),
  injury_severity: fallInjurySeverityEnum,
  contributing_factors: z.string().optional(), // comma-separated
  interventions_taken: z.string().optional(),
  morse_score_at_fall: z.number().int().min(0).max(125).optional(),
});

const listFallEventsInput = z.object({
  injury_severity: fallInjurySeverityEnum.optional(),
  fall_location: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

// ─── QUALITY INDICATOR VALUES ──────────────────────────────────────────────

const submitIndicatorValueInput = z.object({
  qiv_indicator_id: z.string().max(20),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  numerator: z.number().nonnegative(),
  denominator: z.number().positive(),
  evidence_notes: z.string().optional(),
});

const approveIndicatorValueInput = z.object({
  qiv_id: z.string().uuid(),
});

const rejectIndicatorValueInput = z.object({
  qiv_id: z.string().uuid(),
  rejection_reason: z.string().min(1).max(1000),
});

const listIndicatorValuesInput = z.object({
  qiv_indicator_id: z.string().max(20).optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  qiv_source: z.enum(['auto_computed', 'manual_entry']).optional(),
  approval_status: approvalStatusEnum.optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

const indicatorTrendInput = z.object({
  qiv_indicator_id: z.string().max(20),
  limit: z.number().int().min(1).max(500).default(100),
});

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────────────

async function createAuditRecord(
  hospitalId: string,
  adverseEventId: string,
  operation: 'CREATE' | 'UPDATE' | 'ROUTE' | 'CLOSE' | 'ESCALATE',
  fieldName: string,
  oldValue: string | null,
  newValue: string | null,
  userId: string,
): Promise<void> {
  await getSql()`
    INSERT INTO adverse_events_audit (
      hospital_id, adverse_event_id, aea_operation, field_name,
      old_value, new_value, aea_user_id, aea_changed_at
    )
    VALUES (
      ${hospitalId}, ${adverseEventId}, ${operation}, ${fieldName},
      ${oldValue}, ${newValue}, ${userId}, NOW()
    );
  `;
}

// ─── ROUTER ────────────────────────────────────────────────────────────────

export const incidentReportingRouter = router({
  // ─── ADVERSE EVENTS / INCIDENTS ────────────────────────────────────────

  reportIncident: protectedProcedure
    .input(reportIncidentInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Auto-set severity to catastrophic for sentinel events
        const severity = input.incident_type === 'sentinel_event'
          ? 'catastrophic'
          : (input.ae_severity || 'moderate');

        const result = await getSql()`
          INSERT INTO adverse_events (
            hospital_id, incident_type, ae_severity, incident_description,
            incident_date, incident_location_text, incident_location_id,
            involved_staff_ids, witness_names, immediate_actions_taken,
            patient_outcome_statement, ae_patient_id, ae_encounter_id,
            anonymous, ae_status, has_rca, reported_at, reported_by_user_id,
            ae_created_at, ae_updated_at
          )
          VALUES (
            ${hospitalId}, ${input.incident_type}, ${severity}, ${input.incident_description},
            ${input.incident_date}, ${input.incident_location_text || null}, ${input.incident_location_id || null},
            ${input.involved_staff_ids || null}, ${input.witness_names || null}, ${input.immediate_actions_taken || null},
            ${input.patient_outcome_statement || null}, ${input.ae_patient_id || null}, ${input.ae_encounter_id || null},
            ${input.anonymous}, 'open', false, NOW(), ${ctx.user.sub},
            NOW(), NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create incident');
        }

        const incident = rows[0];

        // Create initial audit record
        await createAuditRecord(
          hospitalId,
          incident.id,
          'CREATE',
          'incident_description',
          null,
          input.incident_description,
          ctx.user.sub,
        );

        return { success: true, incident };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to report incident: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateIncident: protectedProcedure
    .input(updateIncidentInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Fetch current incident
        const current = await getSql()`
          SELECT * FROM adverse_events
          WHERE id = ${input.incident_id} AND hospital_id = ${hospitalId};
        `;

        const currentRows = (current as any);
        if (!currentRows || currentRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
        }

        const currentIncident = currentRows[0];
        const updates: Record<string, any> = {};
        const auditPromises = [];

        // Track changes
        if (input.incident_description !== undefined && input.incident_description !== currentIncident.incident_description) {
          updates.incident_description = input.incident_description;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'incident_description',
              currentIncident.incident_description,
              input.incident_description,
              ctx.user.sub,
            ),
          );
        }

        if (input.ae_severity !== undefined && input.ae_severity !== currentIncident.ae_severity) {
          updates.ae_severity = input.ae_severity;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'ae_severity',
              currentIncident.ae_severity,
              input.ae_severity,
              ctx.user.sub,
            ),
          );
        }

        if (input.incident_location_text !== undefined) {
          updates.incident_location_text = input.incident_location_text || null;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'incident_location_text',
              currentIncident.incident_location_text,
              input.incident_location_text || null,
              ctx.user.sub,
            ),
          );
        }

        if (input.incident_location_id !== undefined) {
          updates.incident_location_id = input.incident_location_id || null;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'incident_location_id',
              currentIncident.incident_location_id,
              input.incident_location_id || null,
              ctx.user.sub,
            ),
          );
        }

        if (input.involved_staff_ids !== undefined) {
          updates.involved_staff_ids = input.involved_staff_ids || null;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'involved_staff_ids',
              currentIncident.involved_staff_ids,
              input.involved_staff_ids || null,
              ctx.user.sub,
            ),
          );
        }

        if (input.witness_names !== undefined) {
          updates.witness_names = input.witness_names || null;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'witness_names',
              currentIncident.witness_names,
              input.witness_names || null,
              ctx.user.sub,
            ),
          );
        }

        if (input.immediate_actions_taken !== undefined) {
          updates.immediate_actions_taken = input.immediate_actions_taken || null;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'immediate_actions_taken',
              currentIncident.immediate_actions_taken,
              input.immediate_actions_taken || null,
              ctx.user.sub,
            ),
          );
        }

        if (input.patient_outcome_statement !== undefined) {
          updates.patient_outcome_statement = input.patient_outcome_statement || null;
          auditPromises.push(
            createAuditRecord(
              hospitalId,
              input.incident_id,
              'UPDATE',
              'patient_outcome_statement',
              currentIncident.patient_outcome_statement,
              input.patient_outcome_statement || null,
              ctx.user.sub,
            ),
          );
        }

        if (Object.keys(updates).length === 0) {
          return { success: true, incident: currentIncident };
        }

        updates.ae_updated_at = new Date();

        // Build UPDATE with explicit column updates (no sql.raw)
        const updateResult = await getSql()`
          UPDATE adverse_events SET
            ae_severity = COALESCE(${(updates.ae_severity as any) ?? null}::incident_severity, ae_severity),
            incident_description = COALESCE(${(updates.incident_description as any) ?? null}, incident_description),
            incident_location_text = COALESCE(${(updates.incident_location_text as any) ?? null}, incident_location_text),
            immediate_actions_taken = COALESCE(${(updates.immediate_actions_taken as any) ?? null}, immediate_actions_taken),
            patient_outcome_statement = COALESCE(${(updates.patient_outcome_statement as any) ?? null}, patient_outcome_statement),
            ae_updated_at = NOW()
          WHERE id = ${input.incident_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const updateRows = (updateResult as any);
        if (!updateRows || updateRows.length === 0) {
          throw new Error('Failed to update incident');
        }

        // Execute all audit records
        await Promise.all(auditPromises);

        return { success: true, incident: updateRows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update incident: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateIncidentStatus: adminProcedure
    .input(updateIncidentStatusInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Fetch current incident
        const current = await getSql()`
          SELECT ae_status FROM adverse_events
          WHERE id = ${input.incident_id} AND hospital_id = ${hospitalId};
        `;

        const currentRows = (current as any);
        if (!currentRows || currentRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
        }

        const oldStatus = currentRows[0].ae_status;

        const result = await getSql()`
          UPDATE adverse_events
          SET ae_status = ${input.ae_status}, ae_updated_at = NOW()
          WHERE id = ${input.incident_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to update incident status');
        }

        // Create audit record
        const auditOp = input.ae_status === 'closed'
          ? 'CLOSE'
          : input.ae_status === 'investigating'
            ? 'ROUTE'
            : 'UPDATE';

        await createAuditRecord(
          hospitalId,
          input.incident_id,
          auditOp,
          'ae_status',
          oldStatus,
          input.ae_status,
          ctx.user.sub,
        );

        return { success: true, incident: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update incident status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listIncidents: protectedProcedure
    .input(listIncidentsInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Use parameterized WHERE with IS NULL OR pattern (no sql.raw)
        const result = await getSql()`
          SELECT
            ae.*,
            p.name_full as patient_name
          FROM adverse_events ae
          LEFT JOIN patients p ON ae.ae_patient_id = p.id
          WHERE ae.hospital_id = ${hospitalId}
            AND (${input.incident_type ?? null}::incident_type IS NULL OR ae.incident_type = ${input.incident_type ?? null}::incident_type)
            AND (${input.ae_severity ?? null}::incident_severity IS NULL OR ae.ae_severity = ${input.ae_severity ?? null}::incident_severity)
            AND (${input.ae_status ?? null}::incident_status IS NULL OR ae.ae_status = ${input.ae_status ?? null}::incident_status)
            AND (${input.date_from ?? null}::timestamptz IS NULL OR ae.incident_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR ae.incident_date <= ${input.date_to ?? null}::timestamptz)
            AND (${input.ae_patient_id ?? null}::uuid IS NULL OR ae.ae_patient_id = ${input.ae_patient_id ?? null}::uuid)
          ORDER BY ae.incident_date DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        // Get total count
        const countResult = await getSql()`
          SELECT COUNT(*) as count FROM adverse_events ae
          WHERE ae.hospital_id = ${hospitalId}
            AND (${input.incident_type ?? null}::incident_type IS NULL OR ae.incident_type = ${input.incident_type ?? null}::incident_type)
            AND (${input.ae_severity ?? null}::incident_severity IS NULL OR ae.ae_severity = ${input.ae_severity ?? null}::incident_severity)
            AND (${input.ae_status ?? null}::incident_status IS NULL OR ae.ae_status = ${input.ae_status ?? null}::incident_status)
            AND (${input.date_from ?? null}::timestamptz IS NULL OR ae.incident_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR ae.incident_date <= ${input.date_to ?? null}::timestamptz)
            AND (${input.ae_patient_id ?? null}::uuid IS NULL OR ae.ae_patient_id = ${input.ae_patient_id ?? null}::uuid);
        `;

        const countRows = (countResult as any);
        const total = countRows[0]?.count || 0;

        return {
          incidents: rows || [],
          total,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list incidents: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  getIncident: protectedProcedure
    .input(getIncidentInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ae.*,
            p.name_full as patient_name,
            u.email as reported_by_email
          FROM adverse_events ae
          LEFT JOIN patients p ON ae.ae_patient_id = p.id
          LEFT JOIN users u ON ae.reported_by_user_id = u.id
          WHERE ae.id = ${input.incident_id} AND ae.hospital_id = ${hospitalId};
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
        }

        const incident = rows[0];

        // Fetch audit trail
        const auditResult = await getSql()`
          SELECT * FROM adverse_events_audit
          WHERE adverse_event_id = ${input.incident_id}
          ORDER BY aea_changed_at DESC
          LIMIT 500;
        `;

        const auditRows = (auditResult as any);

        return {
          incident,
          auditTrail: auditRows || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get incident: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  incidentAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // By type
        const typeResult = await getSql()`
          SELECT incident_type, COUNT(*) as count
          FROM adverse_events
          WHERE hospital_id = ${hospitalId}
          GROUP BY incident_type;
        `;

        const typeRows = (typeResult as any);

        // By severity
        const severityResult = await getSql()`
          SELECT ae_severity, COUNT(*) as count
          FROM adverse_events
          WHERE hospital_id = ${hospitalId}
          GROUP BY ae_severity;
        `;

        const severityRows = (severityResult as any);

        // By department (via incident_location_id)
        const deptResult = await getSql()`
          SELECT COALESCE(l.location_name, 'Unknown') as dept, COUNT(*) as count
          FROM adverse_events ae
          LEFT JOIN locations l ON ae.incident_location_id = l.id
          WHERE ae.hospital_id = ${hospitalId}
          GROUP BY l.location_name;
        `;

        const deptRows = (deptResult as any);

        // Trend by month
        const trendResult = await getSql()`
          SELECT
            DATE_TRUNC('month', incident_date) as month,
            COUNT(*) as count
          FROM adverse_events
          WHERE hospital_id = ${hospitalId}
          GROUP BY DATE_TRUNC('month', incident_date)
          ORDER BY month DESC
          LIMIT 12;
        `;

        const trendRows = (trendResult as any);

        // Avg time-to-close (for closed incidents)
        const timeResult = await getSql()`
          SELECT
            AVG(EXTRACT(DAY FROM (ae_updated_at - incident_date))) as avg_days_to_close
          FROM adverse_events
          WHERE hospital_id = ${hospitalId} AND ae_status = 'closed';
        `;

        const timeRows = (timeResult as any);

        return {
          byType: typeRows || [],
          bySeverity: severityRows || [],
          byDept: deptRows || [],
          trend: trendRows || [],
          avgDaysToClose: timeRows?.[0]?.avg_days_to_close || 0,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get incident analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── MEDICATION ERRORS ────────────────────────────────────────────────

  reportMedError: protectedProcedure
    .input(reportMedErrorInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const severity = input.ae_severity || 'moderate';

        // Insert adverse event first
        const aeResult = await getSql()`
          INSERT INTO adverse_events (
            hospital_id, incident_type, ae_severity, incident_description,
            incident_date, incident_location_text, involved_staff_ids,
            witness_names, ae_patient_id, ae_encounter_id, anonymous,
            ae_status, has_rca, reported_at, reported_by_user_id,
            ae_created_at, ae_updated_at
          )
          VALUES (
            ${hospitalId}, 'medication_error', ${severity}, ${input.incident_description},
            ${input.incident_date}, ${input.incident_location_text || null}, ${input.involved_staff_ids || null},
            ${input.witness_names || null}, ${input.ae_patient_id || null}, ${input.ae_encounter_id || null},
            ${input.anonymous}, 'open', false, NOW(), ${ctx.user.sub},
            NOW(), NOW()
          )
          RETURNING *;
        `;

        const aeRows = (aeResult as any);
        if (!aeRows || aeRows.length === 0) {
          throw new Error('Failed to create adverse event');
        }

        const adverseEvent = aeRows[0];

        // Insert medication error record
        const meResult = await getSql()`
          INSERT INTO medication_errors (
            hospital_id, me_adverse_event_id, error_types, me_severity,
            prescribed_medication, dispensed_medication, me_created_at
          )
          VALUES (
            ${hospitalId}, ${adverseEvent.id}, ${input.error_types}, ${input.me_severity},
            ${input.prescribed_medication}, ${input.dispensed_medication}, NOW()
          )
          RETURNING *;
        `;

        const meRows = (meResult as any);
        if (!meRows || meRows.length === 0) {
          throw new Error('Failed to create medication error record');
        }

        // Create audit record
        await createAuditRecord(
          hospitalId,
          adverseEvent.id,
          'CREATE',
          'incident_type',
          null,
          'medication_error',
          ctx.user.sub,
        );

        return { success: true, adverseEvent, medicationError: meRows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to report medication error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listMedErrors: protectedProcedure
    .input(listMedErrorsInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ae.*,
            me.error_types,
            me.me_severity,
            me.prescribed_medication,
            me.dispensed_medication,
            p.name_full as patient_name
          FROM adverse_events ae
          JOIN medication_errors me ON ae.id = me.me_adverse_event_id
          LEFT JOIN patients p ON ae.ae_patient_id = p.id
          WHERE ae.hospital_id = ${hospitalId}
            AND ae.incident_type = 'medication_error'
            AND (${input.error_type ?? null} IS NULL OR me.error_types LIKE ${input.error_type ? `'%' || ${input.error_type} || '%'` : null})
            AND (${input.me_severity ?? null}::med_error_severity IS NULL OR me.me_severity = ${input.me_severity ?? null}::med_error_severity)
            AND (${input.date_from ?? null}::timestamptz IS NULL OR ae.incident_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR ae.incident_date <= ${input.date_to ?? null}::timestamptz)
          ORDER BY ae.incident_date DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        const countResult = await getSql()`
          SELECT COUNT(*) as count FROM adverse_events ae
          JOIN medication_errors me ON ae.id = me.me_adverse_event_id
          WHERE ae.hospital_id = ${hospitalId}
            AND ae.incident_type = 'medication_error'
            AND (${input.error_type ?? null} IS NULL OR me.error_types LIKE ${input.error_type ? `'%' || ${input.error_type} || '%'` : null})
            AND (${input.me_severity ?? null}::med_error_severity IS NULL OR me.me_severity = ${input.me_severity ?? null}::med_error_severity)
            AND (${input.date_from ?? null}::timestamptz IS NULL OR ae.incident_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR ae.incident_date <= ${input.date_to ?? null}::timestamptz);
        `;

        const countRows = (countResult as any);
        const total = countRows[0]?.count || 0;

        return {
          medicationErrors: rows || [],
          total,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list medication errors: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  medErrorAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Error type distribution
        const typeResult = await getSql()`
          SELECT
            UNNEST(STRING_TO_ARRAY(error_types, ',')) as error_type,
            COUNT(*) as count
          FROM medication_errors
          WHERE hospital_id = ${hospitalId}
          GROUP BY error_type
          ORDER BY count DESC;
        `;

        const typeRows = (typeResult as any);

        // Severity distribution
        const severityResult = await getSql()`
          SELECT me_severity, COUNT(*) as count
          FROM medication_errors
          WHERE hospital_id = ${hospitalId}
          GROUP BY me_severity;
        `;

        const severityRows = (severityResult as any);

        // Trend by month
        const trendResult = await getSql()`
          SELECT
            DATE_TRUNC('month', ae.incident_date) as month,
            COUNT(*) as count
          FROM medication_errors me
          JOIN adverse_events ae ON me.me_adverse_event_id = ae.id
          WHERE ae.hospital_id = ${hospitalId}
          GROUP BY DATE_TRUNC('month', ae.incident_date)
          ORDER BY month DESC
          LIMIT 12;
        `;

        const trendRows = (trendResult as any);

        return {
          byType: typeRows || [],
          bySeverity: severityRows || [],
          trend: trendRows || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get medication error analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── FALL ASSESSMENTS ──────────────────────────────────────────────────

  assessFallRisk: protectedProcedure
    .input(assessFallRiskInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Calculate Morse score
        const morseScore = input.history_of_falls
          + input.secondary_diagnosis
          + input.ambulatory_aid
          + input.iv_or_heparin_lock
          + input.gait
          + input.mental_status;

        // Determine risk category
        let riskCategory: 'no_risk' | 'low_risk' | 'high_risk';
        if (morseScore < 25) {
          riskCategory = 'no_risk';
        } else if (morseScore >= 25 && morseScore < 45) {
          riskCategory = 'low_risk';
        } else {
          riskCategory = 'high_risk';
        }

        const result = await getSql()`
          INSERT INTO fall_assessments (
            hospital_id, fa_patient_id, fa_encounter_id,
            history_of_falls, secondary_diagnosis, ambulatory_aid,
            iv_or_heparin_lock, gait, mental_status,
            morse_score, risk_category, assessment_notes,
            assessed_by_user_id, assessed_at, fa_created_at
          )
          VALUES (
            ${hospitalId}, ${input.fa_patient_id}, ${input.fa_encounter_id || null},
            ${input.history_of_falls}, ${input.secondary_diagnosis}, ${input.ambulatory_aid},
            ${input.iv_or_heparin_lock}, ${input.gait}, ${input.mental_status},
            ${morseScore}, ${riskCategory}, ${input.assessment_notes || null},
            ${ctx.user.sub}, NOW(), NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create fall assessment');
        }

        return { success: true, assessment: rows[0], morseScore, riskCategory };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to assess fall risk: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listFallAssessments: protectedProcedure
    .input(listFallAssessmentsInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            fa.*,
            p.name_full as patient_name
          FROM fall_assessments fa
          LEFT JOIN patients p ON fa.fa_patient_id = p.id
          WHERE fa.hospital_id = ${hospitalId}
            AND (${input.fa_patient_id ?? null}::uuid IS NULL OR fa.fa_patient_id = ${input.fa_patient_id ?? null}::uuid)
            AND (${input.fa_encounter_id ?? null}::uuid IS NULL OR fa.fa_encounter_id = ${input.fa_encounter_id ?? null}::uuid)
            AND (${input.risk_category ?? null}::fall_risk_category IS NULL OR fa.risk_category = ${input.risk_category ?? null}::fall_risk_category)
          ORDER BY fa.assessed_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        const countResult = await getSql()`
          SELECT COUNT(*) as count FROM fall_assessments fa
          WHERE fa.hospital_id = ${hospitalId}
            AND (${input.fa_patient_id ?? null}::uuid IS NULL OR fa.fa_patient_id = ${input.fa_patient_id ?? null}::uuid)
            AND (${input.fa_encounter_id ?? null}::uuid IS NULL OR fa.fa_encounter_id = ${input.fa_encounter_id ?? null}::uuid)
            AND (${input.risk_category ?? null}::fall_risk_category IS NULL OR fa.risk_category = ${input.risk_category ?? null}::fall_risk_category);
        `;

        const countRows = (countResult as any);
        const total = countRows[0]?.count || 0;

        return {
          assessments: rows || [],
          total,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list fall assessments: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  getLatestAssessment: protectedProcedure
    .input(getLatestAssessmentInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            fa.*,
            p.name_full as patient_name
          FROM fall_assessments fa
          LEFT JOIN patients p ON fa.fa_patient_id = p.id
          WHERE fa.fa_patient_id = ${input.fa_patient_id}
            AND fa.hospital_id = ${hospitalId}
          ORDER BY fa.assessed_at DESC
          LIMIT 1;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          return { assessment: null };
        }

        return { assessment: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get latest assessment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  fallRiskAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Risk distribution
        const riskResult = await getSql()`
          SELECT risk_category, COUNT(*) as count
          FROM fall_assessments
          WHERE hospital_id = ${hospitalId}
          GROUP BY risk_category;
        `;

        const riskRows = (riskResult as any);

        // Avg score by ward/department
        const deptResult = await getSql()`
          SELECT
            COALESCE(l.location_name, 'Unknown') as dept,
            AVG(morse_score) as avg_morse_score,
            COUNT(*) as assessment_count
          FROM fall_assessments fa
          LEFT JOIN encounters e ON fa.fa_encounter_id = e.id
          LEFT JOIN locations l ON e.location_id = l.id
          WHERE fa.hospital_id = ${hospitalId}
          GROUP BY l.location_name;
        `;

        const deptRows = (deptResult as any);

        // High-risk patient count
        const highRiskResult = await getSql()`
          SELECT COUNT(DISTINCT fa_patient_id) as high_risk_count
          FROM fall_assessments
          WHERE hospital_id = ${hospitalId}
            AND risk_category = 'high_risk'
            AND assessed_at > (NOW() - INTERVAL '30 days');
        `;

        const highRiskRows = (highRiskResult as any);
        const highRiskCount = highRiskRows?.[0]?.high_risk_count || 0;

        return {
          riskDistribution: riskRows || [],
          byDept: deptRows || [],
          highRiskPatientCount: highRiskCount,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get fall risk analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── FALL EVENTS ───────────────────────────────────────────────────────

  reportFall: protectedProcedure
    .input(reportFallInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const severity = input.ae_severity || 'major';

        // Insert adverse event
        const aeResult = await getSql()`
          INSERT INTO adverse_events (
            hospital_id, incident_type, ae_severity, incident_description,
            incident_date, incident_location_text, involved_staff_ids,
            witness_names, immediate_actions_taken, ae_patient_id,
            ae_encounter_id, anonymous, ae_status, has_rca,
            reported_at, reported_by_user_id, ae_created_at, ae_updated_at
          )
          VALUES (
            ${hospitalId}, 'fall', ${severity}, ${input.incident_description},
            ${input.incident_date}, ${input.incident_location_text || null}, ${input.involved_staff_ids || null},
            ${input.witness_names || null}, ${input.immediate_actions_taken || null}, ${input.fe_patient_id},
            ${input.fe_encounter_id || null}, ${input.anonymous}, 'open', false,
            NOW(), ${ctx.user.sub}, NOW(), NOW()
          )
          RETURNING *;
        `;

        const aeRows = (aeResult as any);
        if (!aeRows || aeRows.length === 0) {
          throw new Error('Failed to create adverse event');
        }

        const adverseEvent = aeRows[0];

        // Insert fall event record
        const feResult = await getSql()`
          INSERT INTO fall_events (
            hospital_id, fe_adverse_event_id, fe_patient_id, fe_encounter_id,
            fall_date, witnessed, fall_location, fall_cause, injury_severity,
            contributing_factors, interventions_taken, morse_score_at_fall,
            fe_recorded_by_user_id, fe_recorded_at, fe_created_at
          )
          VALUES (
            ${hospitalId}, ${adverseEvent.id}, ${input.fe_patient_id}, ${input.fe_encounter_id || null},
            ${input.fall_date}, ${input.witnessed}, ${input.fall_location || null}, ${input.fall_cause || null},
            ${input.injury_severity}, ${input.contributing_factors || null}, ${input.interventions_taken || null},
            ${input.morse_score_at_fall || null}, ${ctx.user.sub}, NOW(), NOW()
          )
          RETURNING *;
        `;

        const feRows = (feResult as any);
        if (!feRows || feRows.length === 0) {
          throw new Error('Failed to create fall event record');
        }

        // Create audit record
        await createAuditRecord(
          hospitalId,
          adverseEvent.id,
          'CREATE',
          'incident_type',
          null,
          'fall',
          ctx.user.sub,
        );

        return { success: true, adverseEvent, fallEvent: feRows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to report fall: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listFallEvents: protectedProcedure
    .input(listFallEventsInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ae.*,
            fe.fall_date,
            fe.witnessed,
            fe.fall_location,
            fe.fall_cause,
            fe.injury_severity,
            fe.contributing_factors,
            fe.morse_score_at_fall,
            p.name_full as patient_name
          FROM adverse_events ae
          JOIN fall_events fe ON ae.id = fe.fe_adverse_event_id
          LEFT JOIN patients p ON ae.ae_patient_id = p.id
          WHERE ae.hospital_id = ${hospitalId}
            AND ae.incident_type = 'fall'
            AND (${input.injury_severity ?? null}::fall_injury_severity IS NULL OR fe.injury_severity = ${input.injury_severity ?? null}::fall_injury_severity)
            AND (${input.fall_location ?? null} IS NULL OR fe.fall_location LIKE ${input.fall_location ? `'%' || ${input.fall_location} || '%'` : null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR ae.incident_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR ae.incident_date <= ${input.date_to ?? null}::timestamptz)
          ORDER BY ae.incident_date DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        const countResult = await getSql()`
          SELECT COUNT(*) as count FROM adverse_events ae
          JOIN fall_events fe ON ae.id = fe.fe_adverse_event_id
          WHERE ae.hospital_id = ${hospitalId}
            AND ae.incident_type = 'fall'
            AND (${input.injury_severity ?? null}::fall_injury_severity IS NULL OR fe.injury_severity = ${input.injury_severity ?? null}::fall_injury_severity)
            AND (${input.fall_location ?? null} IS NULL OR fe.fall_location LIKE ${input.fall_location ? `'%' || ${input.fall_location} || '%'` : null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR ae.incident_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR ae.incident_date <= ${input.date_to ?? null}::timestamptz);
        `;

        const countRows = (countResult as any);
        const total = countRows[0]?.count || 0;

        return {
          fallEvents: rows || [],
          total,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list fall events: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  fallEventAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // By severity
        const severityResult = await getSql()`
          SELECT injury_severity, COUNT(*) as count
          FROM fall_events
          WHERE hospital_id = ${hospitalId}
          GROUP BY injury_severity;
        `;

        const severityRows = (severityResult as any);

        // By location
        const locationResult = await getSql()`
          SELECT fall_location, COUNT(*) as count
          FROM fall_events
          WHERE hospital_id = ${hospitalId} AND fall_location IS NOT NULL
          GROUP BY fall_location
          ORDER BY count DESC
          LIMIT 10;
        `;

        const locationRows = (locationResult as any);

        // Correlation with Morse score
        const morseResult = await getSql()`
          SELECT
            CASE
              WHEN fe.morse_score_at_fall IS NULL THEN 'unknown'
              WHEN fe.morse_score_at_fall < 25 THEN 'no_risk'
              WHEN fe.morse_score_at_fall >= 25 AND fe.morse_score_at_fall < 45 THEN 'low_risk'
              ELSE 'high_risk'
            END as risk_category,
            COUNT(*) as fall_count
          FROM fall_events fe
          WHERE fe.hospital_id = ${hospitalId}
          GROUP BY risk_category;
        `;

        const morseRows = (morseResult as any);

        return {
          bySeverity: severityRows || [],
          byLocation: locationRows || [],
          morseRiskCorrelation: morseRows || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get fall event analytics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── QUALITY INDICATOR VALUES ──────────────────────────────────────────

  submitIndicatorValue: protectedProcedure
    .input(submitIndicatorValueInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Calculate value = numerator / denominator
        const value = Number(input.numerator) / Number(input.denominator);

        const result = await getSql()`
          INSERT INTO quality_indicator_values (
            hospital_id, qiv_indicator_id, period_start, period_end,
            numerator, denominator, qiv_value, qiv_source,
            submitted_by_user_id, submitted_at, approval_status,
            evidence_notes, qiv_created_at
          )
          VALUES (
            ${hospitalId}, ${input.qiv_indicator_id}, ${input.period_start}, ${input.period_end},
            ${input.numerator}, ${input.denominator}, ${value}, 'manual_entry',
            ${ctx.user.sub}, NOW(), 'draft',
            ${input.evidence_notes || null}, NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to submit indicator value');
        }

        return { success: true, value: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to submit indicator value: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  approveIndicatorValue: adminProcedure
    .input(approveIndicatorValueInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          UPDATE quality_indicator_values
          SET
            approval_status = 'approved',
            approved_by_user_id = ${ctx.user.sub},
            approved_at = NOW()
          WHERE id = ${input.qiv_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Indicator value not found' });
        }

        return { success: true, value: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to approve indicator value: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  rejectIndicatorValue: adminProcedure
    .input(rejectIndicatorValueInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          UPDATE quality_indicator_values
          SET
            approval_status = 'rejected',
            approved_by_user_id = ${ctx.user.sub},
            approved_at = NOW(),
            rejection_reason = ${input.rejection_reason}
          WHERE id = ${input.qiv_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Indicator value not found' });
        }

        return { success: true, value: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to reject indicator value: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listIndicatorValues: protectedProcedure
    .input(listIndicatorValuesInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT *
          FROM quality_indicator_values
          WHERE hospital_id = ${hospitalId}
            AND (${input.qiv_indicator_id ?? null}::uuid IS NULL OR qiv_indicator_id = ${input.qiv_indicator_id ?? null}::uuid)
            AND (${input.period_start ?? null}::timestamptz IS NULL OR period_start >= ${input.period_start ?? null}::timestamptz)
            AND (${input.period_end ?? null}::timestamptz IS NULL OR period_end <= ${input.period_end ?? null}::timestamptz)
            AND (${input.qiv_source ?? null}::qiv_source IS NULL OR qiv_source = ${input.qiv_source ?? null}::qiv_source)
            AND (${input.approval_status ?? null}::qiv_approval_status IS NULL OR approval_status = ${input.approval_status ?? null}::qiv_approval_status)
          ORDER BY period_start DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        const countResult = await getSql()`
          SELECT COUNT(*) as count FROM quality_indicator_values
          WHERE hospital_id = ${hospitalId}
            AND (${input.qiv_indicator_id ?? null}::uuid IS NULL OR qiv_indicator_id = ${input.qiv_indicator_id ?? null}::uuid)
            AND (${input.period_start ?? null}::timestamptz IS NULL OR period_start >= ${input.period_start ?? null}::timestamptz)
            AND (${input.period_end ?? null}::timestamptz IS NULL OR period_end <= ${input.period_end ?? null}::timestamptz)
            AND (${input.qiv_source ?? null}::qiv_source IS NULL OR qiv_source = ${input.qiv_source ?? null}::qiv_source)
            AND (${input.approval_status ?? null}::qiv_approval_status IS NULL OR approval_status = ${input.approval_status ?? null}::qiv_approval_status);
        `;

        const countRows = (countResult as any);
        const total = countRows[0]?.count || 0;

        return {
          values: rows || [],
          total,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list indicator values: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  indicatorTrend: protectedProcedure
    .input(indicatorTrendInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            qiv_indicator_id,
            period_start,
            period_end,
            qiv_value,
            numerator,
            denominator,
            approval_status,
            submitted_at
          FROM quality_indicator_values
          WHERE hospital_id = ${hospitalId}
            AND qiv_indicator_id = ${input.qiv_indicator_id}
            AND approval_status = 'approved'
          ORDER BY period_start DESC
          LIMIT ${input.limit};
        `;

        const rows = (result as any);

        return {
          trend: rows || [],
          indicator_id: input.qiv_indicator_id,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get indicator trend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── DASHBOARD ────────────────────────────────────────────────────────

  safetyDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Open incidents
        const openResult = await getSql()`
          SELECT COUNT(*) as count FROM adverse_events
          WHERE hospital_id = ${hospitalId} AND ae_status = 'open';
        `;

        // High-risk falls (last 30 days)
        const highRiskResult = await getSql()`
          SELECT COUNT(DISTINCT fe_patient_id) as count
          FROM fall_events
          WHERE hospital_id = ${hospitalId}
            AND fe_recorded_at > (NOW() - INTERVAL '30 days')
            AND morse_score_at_fall >= 45;
        `;

        // Pending indicator approvals
        const pendingIndicatorsResult = await getSql()`
          SELECT COUNT(*) as count FROM quality_indicator_values
          WHERE hospital_id = ${hospitalId} AND approval_status = 'draft';
        `;

        // Incidents by type (this month)
        const incidentsByTypeResult = await getSql()`
          SELECT incident_type, COUNT(*) as count
          FROM adverse_events
          WHERE hospital_id = ${hospitalId}
            AND incident_date >= DATE_TRUNC('month', NOW())
          GROUP BY incident_type;
        `;

        const openRows = (openResult as any);
        const highRiskRows = (highRiskResult as any);
        const pendingRows = (pendingIndicatorsResult as any);
        const typeRows = (incidentsByTypeResult as any);

        return {
          openIncidents: openRows?.[0]?.count || 0,
          highRiskFallPatients: highRiskRows?.[0]?.count || 0,
          pendingIndicatorApprovals: pendingRows?.[0]?.count || 0,
          incidentsByType: typeRows || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get safety dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  incidentTimeline: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ae.id,
            ae.incident_type,
            ae.ae_severity,
            ae.incident_date,
            ae.incident_description,
            ae.incident_location_text,
            ae.ae_status,
            p.name_full as patient_name,
            u.email as reported_by_email
          FROM adverse_events ae
          LEFT JOIN patients p ON ae.ae_patient_id = p.id
          LEFT JOIN users u ON ae.reported_by_user_id = u.id
          WHERE ae.hospital_id = ${hospitalId}
          ORDER BY ae.incident_date DESC
          LIMIT 50;
        `;

        const rows = (result as any);

        return {
          incidents: rows || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get incident timeline: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),
});
