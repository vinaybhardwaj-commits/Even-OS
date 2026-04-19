import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { resolveChartConfigForUser } from '@/lib/chart/selectors';
import { projectRowsForRole, projectRowForRole } from '@/lib/chart/redact';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';
import { writeEvent } from '@/lib/event-log';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// TYPE DEFINITIONS & VALIDATORS
// ============================================================

const procedureStatusEnum = z.enum([
  'preparation', 'in_progress', 'not_done', 'on_hold', 'stopped', 'completed', 'entered_in_error',
]);

const mlcInjuryTypeEnum = z.enum([
  'burn', 'cut', 'blunt_trauma', 'gunshot', 'stab', 'poison', 'sexual_assault', 'other',
]);

const mlcStatusEnum = z.enum(['draft', 'completed', 'signed', 'locked']);

// ============================================================
// TRPC ROUTER
// ============================================================

export const proceduresRouter = router({
  // ─────────────────────────────────────────────────────────
  // 1. CREATE PROCEDURE (mutation)
  // ─────────────────────────────────────────────────────────
  createProcedure: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      procedure_code: z.string().max(20).optional(),
      procedure_name: z.string().min(1).max(500),
      performer_id: z.string().uuid(),
      performer_role: z.string().max(50),
      performed_datetime: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // 1. Verify patient exists
        const patientCheck = await getSql()`
          SELECT id FROM patients
          WHERE id = ${input.patient_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const rows = (patientCheck as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });
        }

        // 2. Verify encounter exists
        const encounterCheck = await getSql()`
          SELECT id FROM encounters
          WHERE id = ${input.encounter_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const encRows = (encounterCheck as any);
        if (!encRows || encRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });
        }

        // 3. Insert procedure
        const result = await getSql()`
          INSERT INTO procedures (
            hospital_id, patient_id, encounter_id,
            procedure_code, procedure_name, status,
            performed_datetime, performer_id, performer_role,
            created_by, created_at, updated_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}::uuid, ${input.encounter_id}::uuid,
            ${input.procedure_code || null}, ${input.procedure_name}, 'preparation',
            ${input.performed_datetime || null}, ${input.performer_id}::uuid, ${input.performer_role},
            ${userId}::uuid, NOW(), NOW()
          )
          RETURNING id, procedure_name, status, created_at
        `;
        const procRows = (result as any);
        if (!procRows || procRows.length === 0) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create procedure' });
        }

        const procedure = procRows[0];

        // 4. Audit
        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'procedures',
          row_id: procedure.id,
          new_values: {
            procedure_name: input.procedure_name,
            status: 'preparation',
            performer_id: input.performer_id,
          },
        });

        // 5. Log event (fire-and-forget)
        try {
          await writeEvent({
            hospital_id: hospitalId,
            resource_type: 'procedure',
            resource_id: procedure.id,
            event_type: 'created',
            data: {
              patient_id: input.patient_id,
              encounter_id: input.encounter_id,
              procedure_code: input.procedure_code || null,
              procedure_name: input.procedure_name,
              status: 'preparation',
              performer_id: input.performer_id,
              performer_role: input.performer_role,
              performed_datetime: input.performed_datetime || null,
            },
            actor_id: userId,
            actor_email: ctx.user.email,
          });
        } catch (error) {
          console.error('Failed to write event log for procedure creation:', error);
        }

        return {
          procedure_id: procedure.id,
          procedure_name: procedure.procedure_name,
          status: procedure.status,
          created_at: procedure.created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('createProcedure error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create procedure',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 2. UPDATE PROCEDURE STATUS (mutation)
  // ─────────────────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(z.object({
      procedure_id: z.string().uuid(),
      status: procedureStatusEnum,
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // 1. Fetch current procedure
        const currentResult = await getSql()`
          SELECT id, status, version FROM procedures
          WHERE id = ${input.procedure_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const currentRows = (currentResult as any);
        if (!currentRows || currentRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Procedure not found' });
        }

        const current = currentRows[0];
        const currentVersion = current.version || 1;

        // 2. Create version (event sourcing)
        await getSql()`
          UPDATE procedures
          SET previous_version_id = id, version = version + 1
          WHERE id = ${input.procedure_id}::uuid
        `;

        // 3. Update status
        const updateResult = await getSql()`
          UPDATE procedures
          SET status = ${input.status}, updated_at = NOW()
          WHERE id = ${input.procedure_id}::uuid
          RETURNING id, status, updated_at
        `;
        const updateRows = (updateResult as any);
        if (!updateRows || updateRows.length === 0) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update procedure status' });
        }

        // 4. Audit
        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'procedures',
          row_id: input.procedure_id,
          old_values: { status: current.status },
          new_values: { status: input.status },
        });

        // 5. Log event (fire-and-forget)
        try {
          const procDetail = await getSql()`
            SELECT id, patient_id, encounter_id, procedure_code, procedure_name,
                   performer_id, performer_role, performed_datetime
            FROM procedures
            WHERE id = ${input.procedure_id}::uuid
            AND hospital_id = ${hospitalId}
            LIMIT 1
          `;
          const procRows = (procDetail as any);
          if (procRows && procRows.length > 0) {
            const proc = procRows[0];
            await writeEvent({
              hospital_id: hospitalId,
              resource_type: 'procedure',
              resource_id: proc.id,
              event_type: 'status_changed',
              data: {
                patient_id: proc.patient_id,
                encounter_id: proc.encounter_id,
                procedure_code: proc.procedure_code,
                procedure_name: proc.procedure_name,
                status: input.status,
                performer_id: proc.performer_id,
                performer_role: proc.performer_role,
                performed_datetime: proc.performed_datetime,
              },
              delta: {
                status: input.status,
              },
              actor_id: userId,
              actor_email: ctx.user.email,
            });
          }
        } catch (error) {
          console.error('Failed to write event log for procedure status change:', error);
        }

        return {
          procedure_id: updateRows[0].id,
          status: updateRows[0].status,
          updated_at: updateRows[0].updated_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('updateStatus error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update procedure status',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 3. LIST PROCEDURES (query)
  // ─────────────────────────────────────────────────────────
  listProcedures: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      status: procedureStatusEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Build dynamic query filters
        let query = `
          SELECT
            id, patient_id, encounter_id,
            procedure_code, procedure_name, status,
            performed_datetime, performer_id, performer_role,
            clinical_impression_id, created_at, updated_at
          FROM procedures
          WHERE hospital_id = $1 AND patient_id = $2::uuid
        `;
        const params: any[] = [hospitalId, input.patient_id];

        if (input.encounter_id) {
          query += ` AND encounter_id = $${params.length + 1}::uuid`;
          params.push(input.encounter_id);
        }

        if (input.status) {
          query += ` AND status = $${params.length + 1}`;
          params.push(input.status);
        }

        query += ` ORDER BY created_at DESC`;

        const result = await getSql()(query, params);
        const procedures = (result as any) || [];

        const lp_rows = procedures.map((p: any) => ({
          id: p.id,
          patient_id: p.patient_id,
          encounter_id: p.encounter_id,
          procedure_code: p.procedure_code,
          procedure_name: p.procedure_name,
          status: p.status,
          performed_datetime: p.performed_datetime,
          performer_id: p.performer_id,
          performer_role: p.performer_role,
          clinical_impression_id: p.clinical_impression_id,
          created_at: p.created_at,
          updated_at: p.updated_at,
        }));
        const lp_config = await resolveChartConfigForUser(ctx.effectiveUser);
        return projectRowsForRole(lp_rows, { procedure_name: 'procedures' }, lp_config);
      } catch (error) {
        console.error('listProcedures error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list procedures',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 4. GET PROCEDURE DETAIL (query)
  // ─────────────────────────────────────────────────────────
  getDetail: protectedProcedure
    .input(z.object({
      procedure_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Join with clinical_impressions if linked
        const result = await getSql()`
          SELECT
            p.id, p.patient_id, p.encounter_id,
            p.procedure_code, p.procedure_name, p.status,
            p.performed_datetime, p.performer_id, p.performer_role,
            p.clinical_impression_id, p.version, p.created_by, p.created_at, p.updated_at,
            ci.id as note_id, ci.note_type, ci.status as note_status,
            ci.operative_findings, ci.blood_loss_ml, ci.complications,
            ci.operation_start_datetime, ci.operation_end_datetime, ci.operation_duration_minutes
          FROM procedures p
          LEFT JOIN clinical_impressions ci ON p.clinical_impression_id = ci.id
          WHERE p.id = ${input.procedure_id}::uuid
          AND p.hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Procedure not found' });
        }

        const proc = rows[0];

        const gd_config = await resolveChartConfigForUser(ctx.effectiveUser);
        const gd_base = projectRowForRole(
          {
            id: proc.id,
            patient_id: proc.patient_id,
            encounter_id: proc.encounter_id,
            procedure_code: proc.procedure_code,
            procedure_name: proc.procedure_name,
            status: proc.status,
            performed_datetime: proc.performed_datetime,
            performer_id: proc.performer_id,
            performer_role: proc.performer_role,
            version: proc.version,
            created_by: proc.created_by,
            created_at: proc.created_at,
            updated_at: proc.updated_at,
          },
          { procedure_name: 'procedures' },
          gd_config,
        );
        const gd_note = proc.note_id
          ? projectRowForRole(
              {
                id: proc.note_id,
                note_type: proc.note_type,
                status: proc.note_status,
                operative_findings: proc.operative_findings,
                blood_loss_ml: proc.blood_loss_ml,
                complications: proc.complications,
                operation_start_datetime: proc.operation_start_datetime,
                operation_end_datetime: proc.operation_end_datetime,
                operation_duration_minutes: proc.operation_duration_minutes,
              },
              {
                operative_findings: 'notes_snippet',
                complications: 'notes_snippet',
              },
              gd_config,
            )
          : null;
        return { ...gd_base, operativeNote: gd_note };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('getDetail error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get procedure detail',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 5. PROCEDURE STATS (query)
  // ─────────────────────────────────────────────────────────
  procedureStats: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            status,
            COUNT(*) as count
          FROM procedures
          WHERE hospital_id = ${hospitalId}
          GROUP BY status
          ORDER BY status
        `;
        const rows = (result as any) || [];

        const stats: Record<string, number> = {
          preparation: 0,
          in_progress: 0,
          not_done: 0,
          on_hold: 0,
          stopped: 0,
          completed: 0,
          entered_in_error: 0,
        };

        rows.forEach((row: any) => {
          stats[row.status] = parseInt(row.count, 10);
        });

        return stats;
      } catch (error) {
        console.error('procedureStats error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get procedure stats',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 6. CREATE MLC FORM (mutation)
  // ─────────────────────────────────────────────────────────
  createMlc: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      injury_description: z.string().min(1).max(2000),
      injury_type: mlcInjuryTypeEnum,
      injury_datetime: z.string().datetime().optional(),
      injury_location_on_body: z.string().max(500).optional(),
      age_estimation: z.string().max(50).optional(),
      estimated_age_years: z.number().int().min(0).max(150).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // 1. Verify patient exists
        const patientCheck = await getSql()`
          SELECT id FROM patients
          WHERE id = ${input.patient_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const patRows = (patientCheck as any);
        if (!patRows || patRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });
        }

        // 2. Insert MLC form
        const result = await getSql()`
          INSERT INTO mlc_forms (
            hospital_id, patient_id, encounter_id,
            injury_description, injury_type, injury_datetime, injury_location_on_body,
            age_estimation, estimated_age_years,
            status, created_by, created_at, updated_at
          ) VALUES (
            ${hospitalId}, ${input.patient_id}::uuid, ${input.encounter_id}::uuid,
            ${input.injury_description}, ${input.injury_type}, ${input.injury_datetime || null},
            ${input.injury_location_on_body || null},
            ${input.age_estimation || null}, ${input.estimated_age_years || null},
            'draft', ${userId}::uuid, NOW(), NOW()
          )
          RETURNING id, injury_type, status, created_at
        `;
        const mlcRows = (result as any);
        if (!mlcRows || mlcRows.length === 0) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create MLC form' });
        }

        const mlc = mlcRows[0];

        // 3. Audit
        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'mlc_forms',
          row_id: mlc.id,
          new_values: {
            injury_type: input.injury_type,
            status: 'draft',
          },
        });

        return {
          mlc_id: mlc.id,
          injury_type: mlc.injury_type,
          status: mlc.status,
          created_at: mlc.created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('createMlc error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create MLC form',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 7. UPDATE MLC FORM (mutation)
  // ─────────────────────────────────────────────────────────
  updateMlc: protectedProcedure
    .input(z.object({
      mlc_id: z.string().uuid(),
      injury_description: z.string().min(1).max(2000).optional(),
      injury_location_on_body: z.string().max(500).optional(),
      estimated_age_years: z.number().int().min(0).max(150).optional(),
      police_notified: z.boolean().optional(),
      police_officer_name: z.string().max(200).optional(),
      police_officer_badge: z.string().max(50).optional(),
      police_station: z.string().max(500).optional(),
      case_number: z.string().max(50).optional(),
      notification_datetime: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // 1. Verify MLC exists and is in draft status
        const mlcCheck = await getSql()`
          SELECT id, status FROM mlc_forms
          WHERE id = ${input.mlc_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const mlcRows = (mlcCheck as any);
        if (!mlcRows || mlcRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'MLC form not found' });
        }

        const mlc = mlcRows[0];
        if (mlc.status !== 'draft') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'MLC form can only be edited while in draft status',
          });
        }

        // 2. Build update query dynamically
        const updates: string[] = [];
        const values: any[] = [input.mlc_id];
        let paramIndex = 2;

        if (input.injury_description !== undefined) {
          updates.push(`injury_description = $${paramIndex}::text`);
          values.push(input.injury_description);
          paramIndex++;
        }
        if (input.injury_location_on_body !== undefined) {
          updates.push(`injury_location_on_body = $${paramIndex}::text`);
          values.push(input.injury_location_on_body);
          paramIndex++;
        }
        if (input.estimated_age_years !== undefined) {
          updates.push(`estimated_age_years = $${paramIndex}::integer`);
          values.push(input.estimated_age_years);
          paramIndex++;
        }
        if (input.police_notified !== undefined) {
          updates.push(`police_notified = $${paramIndex}::boolean`);
          values.push(input.police_notified);
          paramIndex++;
        }
        if (input.police_officer_name !== undefined) {
          updates.push(`police_officer_name = $${paramIndex}::text`);
          values.push(input.police_officer_name);
          paramIndex++;
        }
        if (input.police_officer_badge !== undefined) {
          updates.push(`police_officer_badge = $${paramIndex}::varchar(50)`);
          values.push(input.police_officer_badge);
          paramIndex++;
        }
        if (input.police_station !== undefined) {
          updates.push(`police_station = $${paramIndex}::text`);
          values.push(input.police_station);
          paramIndex++;
        }
        if (input.case_number !== undefined) {
          updates.push(`case_number = $${paramIndex}::varchar(50)`);
          values.push(input.case_number);
          paramIndex++;
        }
        if (input.notification_datetime !== undefined) {
          updates.push(`notification_datetime = $${paramIndex}::timestamp with time zone`);
          values.push(input.notification_datetime);
          paramIndex++;
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length === 1) {
          return { mlc_id: input.mlc_id, message: 'No fields to update' };
        }

        // 3. Execute update
        const updateQuery = `
          UPDATE mlc_forms
          SET ${updates.join(', ')}
          WHERE id = $1::uuid
          RETURNING id, status, updated_at
        `;

        const result = await getSql()(updateQuery, values);
        const updateRows = (result as any);
        if (!updateRows || updateRows.length === 0) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update MLC form' });
        }

        // 4. Audit
        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'mlc_forms',
          row_id: input.mlc_id,
          new_values: {
            injury_description: input.injury_description,
            police_notified: input.police_notified,
            case_number: input.case_number,
          },
        });

        return {
          mlc_id: updateRows[0].id,
          status: updateRows[0].status,
          updated_at: updateRows[0].updated_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('updateMlc error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update MLC form',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 8. SIGN MLC FORM (mutation)
  // ─────────────────────────────────────────────────────────
  signMlc: protectedProcedure
    .input(z.object({
      mlc_id: z.string().uuid(),
      signature_hash: z.string().min(1).max(128),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // 1. Verify MLC exists and is in draft status
        const mlcCheck = await getSql()`
          SELECT id, status FROM mlc_forms
          WHERE id = ${input.mlc_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const mlcRows = (mlcCheck as any);
        if (!mlcRows || mlcRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'MLC form not found' });
        }

        const mlc = mlcRows[0];
        if (mlc.status !== 'draft') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only draft MLC forms can be signed',
          });
        }

        // 2. Sign the form
        const result = await getSql()`
          UPDATE mlc_forms
          SET status = 'signed',
              signed_by_user_id = ${userId}::uuid,
              signed_at = NOW(),
              signature_hash = ${input.signature_hash},
              updated_at = NOW()
          WHERE id = ${input.mlc_id}::uuid
          RETURNING id, status, signed_at
        `;
        const signRows = (result as any);
        if (!signRows || signRows.length === 0) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to sign MLC form' });
        }

        // 3. Audit
        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'mlc_forms',
          row_id: input.mlc_id,
          old_values: { status: 'draft' },
          new_values: { status: 'signed' },
        });

        return {
          mlc_id: signRows[0].id,
          status: signRows[0].status,
          signed_at: signRows[0].signed_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('signMlc error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to sign MLC form',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 9. LOCK MLC FORM (mutation)
  // ─────────────────────────────────────────────────────────
  lockMlc: protectedProcedure
    .input(z.object({
      mlc_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // 1. Verify MLC exists and is in signed status
        const mlcCheck = await getSql()`
          SELECT id, status FROM mlc_forms
          WHERE id = ${input.mlc_id}::uuid
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;
        const mlcRows = (mlcCheck as any);
        if (!mlcRows || mlcRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'MLC form not found' });
        }

        const mlc = mlcRows[0];
        if (mlc.status !== 'signed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only signed MLC forms can be locked',
          });
        }

        // 2. Lock the form
        const result = await getSql()`
          UPDATE mlc_forms
          SET status = 'locked', locked_at = NOW(), updated_at = NOW()
          WHERE id = ${input.mlc_id}::uuid
          RETURNING id, status, locked_at
        `;
        const lockRows = (result as any);
        if (!lockRows || lockRows.length === 0) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to lock MLC form' });
        }

        // 3. Audit
        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'mlc_forms',
          row_id: input.mlc_id,
          old_values: { status: 'signed' },
          new_values: { status: 'locked' },
        });

        return {
          mlc_id: lockRows[0].id,
          status: lockRows[0].status,
          locked_at: lockRows[0].locked_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('lockMlc error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to lock MLC form',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 10. LIST MLC FORMS (query)
  // ─────────────────────────────────────────────────────────
  listMlc: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      status: mlcStatusEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Build dynamic query
        let query = `
          SELECT
            id, patient_id, encounter_id,
            injury_description, injury_type, injury_datetime, injury_location_on_body,
            age_estimation, estimated_age_years,
            police_notified, police_officer_name, case_number,
            status, signed_at, locked_at, created_at, updated_at
          FROM mlc_forms
          WHERE hospital_id = $1
        `;
        const params: any[] = [hospitalId];

        if (input.patient_id) {
          query += ` AND patient_id = $${params.length + 1}::uuid`;
          params.push(input.patient_id);
        }

        if (input.status) {
          query += ` AND status = $${params.length + 1}`;
          params.push(input.status);
        }

        query += ` ORDER BY created_at DESC`;

        const result = await getSql()(query, params);
        const forms = (result as any) || [];

        const lm_rows = forms.map((f: any) => ({
          id: f.id,
          patient_id: f.patient_id,
          encounter_id: f.encounter_id,
          injury_description: f.injury_description,
          injury_type: f.injury_type,
          injury_datetime: f.injury_datetime,
          injury_location_on_body: f.injury_location_on_body,
          age_estimation: f.age_estimation,
          estimated_age_years: f.estimated_age_years,
          police_notified: f.police_notified,
          police_officer_name: f.police_officer_name,
          case_number: f.case_number,
          status: f.status,
          signed_at: f.signed_at,
          locked_at: f.locked_at,
          created_at: f.created_at,
          updated_at: f.updated_at,
        }));
        const lm_config = await resolveChartConfigForUser(ctx.effectiveUser);
        return projectRowsForRole(
          lm_rows,
          {
            injury_description: 'mlc_reason',
            injury_type: 'mlc_reason',
            injury_location_on_body: 'mlc_reason',
            police_officer_name: 'mlc_reason',
            case_number: 'mlc_reason',
          },
          lm_config,
        );
      } catch (error) {
        console.error('listMlc error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list MLC forms',
        });
      }
    }),
});
