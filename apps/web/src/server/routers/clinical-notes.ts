import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// TYPE DEFINITIONS & VALIDATORS
// ============================================================

const noteTypeEnum = z.enum([
  'soap_note',
  'nursing_note',
  'operative_note',
  'discharge_summary',
]);

const noteStatusEnum = z.enum(['draft', 'signed', 'archived']);

const cosignStatusEnum = z.enum(['pending', 'signed', 'declined']);

// ============================================================
// TRPC ROUTER
// ============================================================

export const clinicalNotesRouter = router({
  // ─────────────────────────────────────────────────────────
  // 1. CREATE SOAP NOTE (mutation)
  // ─────────────────────────────────────────────────────────
  createSoap: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      subjective: z.string().min(1).max(5000),
      objective: z.string().min(1).max(5000),
      assessment: z.string().min(1).max(5000),
      plan: z.string().min(1).max(5000),
      required_signer_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const noteId = crypto.randomUUID();
        const queueId = crypto.randomUUID();

        // 1. Insert clinical impression (SOAP note)
        const noteResult = await sql`
          INSERT INTO clinical_impressions (
            id,
            hospital_id,
            patient_id,
            encounter_id,
            note_type,
            status,
            author_id,
            subjective,
            objective,
            assessment,
            plan,
            created_at,
            updated_at
          )
          VALUES (
            ${noteId},
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            'soap_note',
            'draft',
            ${userId},
            ${input.subjective},
            ${input.objective},
            ${input.assessment},
            ${input.plan},
            NOW(),
            NOW()
          )
          RETURNING id, created_at;
        `;

        const noteRows = (noteResult as any);
        if (!noteRows || noteRows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create SOAP note',
          });
        }

        // 2. Create co-signature queue entry
        const queueResult = await sql`
          INSERT INTO co_signature_queue (
            id,
            hospital_id,
            note_id,
            cosign_note_type,
            author_id,
            required_signer_id,
            cosign_status,
            created_at,
            updated_at
          )
          VALUES (
            ${queueId},
            ${hospitalId},
            ${noteId},
            'soap_note',
            ${userId},
            ${input.required_signer_id},
            'pending',
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const queueRows = (queueResult as any);
        if (!queueRows || queueRows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create co-signature queue entry',
          });
        }

        // 3. Audit log
        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'clinical_impression',
          row_id: noteId,
          new_values: { patient_id: input.patient_id, encounter_id: input.encounter_id },
        });

        return {
          note_id: noteId,
          queue_id: queueId,
          status: 'draft',
          created_at: noteRows[0].created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create SOAP note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 2. CREATE NURSING NOTE (mutation)
  // ─────────────────────────────────────────────────────────
  createNursing: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      shift_summary: z.string().min(1).max(5000),
      pain_assessment: z.string().min(1).max(2000),
      wound_assessment: z.string().max(2000).optional(),
      fall_risk_assessment: z.string().max(2000).optional(),
      skin_integrity_assessment: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const noteId = crypto.randomUUID();

        const result = await sql`
          INSERT INTO clinical_impressions (
            id,
            hospital_id,
            patient_id,
            encounter_id,
            note_type,
            status,
            author_id,
            shift_summary,
            pain_assessment,
            wound_assessment,
            fall_risk_assessment,
            skin_integrity_assessment,
            created_at,
            updated_at
          )
          VALUES (
            ${noteId},
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            'nursing_note',
            'draft',
            ${userId},
            ${input.shift_summary},
            ${input.pain_assessment},
            ${input.wound_assessment || null},
            ${input.fall_risk_assessment || null},
            ${input.skin_integrity_assessment || null},
            NOW(),
            NOW()
          )
          RETURNING id, created_at;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create nursing note',
          });
        }

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'clinical_impression',
          row_id: noteId,
          new_values: { patient_id: input.patient_id, encounter_id: input.encounter_id },
        });

        return {
          note_id: noteId,
          status: 'draft',
          created_at: rows[0].created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create nursing note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 3. CREATE OPERATIVE NOTE (mutation)
  // ─────────────────────────────────────────────────────────
  createOperative: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      procedure_name: z.string().min(1).max(255),
      surgeon_id: z.string().uuid(),
      co_surgeon_ids: z.array(z.string().uuid()).optional(),
      anesthesia_type: z.string().min(1).max(100),
      operative_findings: z.string().min(1).max(5000),
      specimens_list: z.array(z.string()).optional(),
      implants_list: z.array(z.string()).optional(),
      blood_loss_ml: z.number().int().nonnegative().optional(),
      complications: z.string().max(2000).optional(),
      operation_start_datetime: z.string().datetime(),
      operation_end_datetime: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const noteId = crypto.randomUUID();

        // Calculate operation duration in minutes
        const startTime = new Date(input.operation_start_datetime).getTime();
        const endTime = new Date(input.operation_end_datetime).getTime();
        const operationDurationMinutes = Math.round((endTime - startTime) / 60000);

        const result = await sql`
          INSERT INTO clinical_impressions (
            id,
            hospital_id,
            patient_id,
            encounter_id,
            note_type,
            status,
            author_id,
            procedure_name,
            surgeon_id,
            co_surgeon_ids,
            anesthesia_type,
            operative_findings,
            specimens_list,
            implants_list,
            blood_loss_ml,
            complications,
            operation_start_datetime,
            operation_end_datetime,
            operation_duration_minutes,
            created_at,
            updated_at
          )
          VALUES (
            ${noteId},
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            'operative_note',
            'draft',
            ${userId},
            ${input.procedure_name},
            ${input.surgeon_id},
            ${JSON.stringify(input.co_surgeon_ids || [])}::jsonb,
            ${input.anesthesia_type},
            ${input.operative_findings},
            ${JSON.stringify(input.specimens_list || [])}::jsonb,
            ${JSON.stringify(input.implants_list || [])}::jsonb,
            ${input.blood_loss_ml || null},
            ${input.complications || null},
            ${input.operation_start_datetime},
            ${input.operation_end_datetime},
            ${operationDurationMinutes},
            NOW(),
            NOW()
          )
          RETURNING id, created_at;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create operative note',
          });
        }

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'clinical_impression',
          row_id: noteId,
          new_values: {
            patient_id: input.patient_id,
            encounter_id: input.encounter_id,
            procedure_name: input.procedure_name,
            duration_minutes: operationDurationMinutes,
          },
        });

        return {
          note_id: noteId,
          status: 'draft',
          created_at: rows[0].created_at,
          operation_duration_minutes: operationDurationMinutes,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create operative note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 4. CREATE DISCHARGE SUMMARY (mutation)
  // ─────────────────────────────────────────────────────────
  createDischarge: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      admission_details: z.string().min(1).max(2000),
      diagnosis_list: z.array(z.string()).min(1),
      procedures_performed: z.array(z.string()).optional(),
      course_in_hospital: z.string().min(1).max(5000),
      condition_at_discharge: z.string().min(1).max(2000),
      medications_at_discharge: z.array(
        z.object({
          medication_name: z.string(),
          dosage: z.string(),
          frequency: z.string(),
          duration: z.string(),
        })
      ).optional(),
      followup_instructions: z.string().min(1).max(3000),
      discharge_destination: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const noteId = crypto.randomUUID();

        const result = await sql`
          INSERT INTO clinical_impressions (
            id,
            hospital_id,
            patient_id,
            encounter_id,
            note_type,
            status,
            author_id,
            admission_details,
            diagnosis_list,
            procedures_performed,
            course_in_hospital,
            condition_at_discharge,
            medications_at_discharge,
            followup_instructions,
            discharge_destination,
            created_at,
            updated_at
          )
          VALUES (
            ${noteId},
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            'discharge_summary',
            'draft',
            ${userId},
            ${input.admission_details},
            ${JSON.stringify(input.diagnosis_list)}::jsonb,
            ${JSON.stringify(input.procedures_performed || [])}::jsonb,
            ${input.course_in_hospital},
            ${input.condition_at_discharge},
            ${JSON.stringify(input.medications_at_discharge || [])}::jsonb,
            ${input.followup_instructions},
            ${input.discharge_destination},
            NOW(),
            NOW()
          )
          RETURNING id, created_at;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create discharge summary',
          });
        }

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'clinical_impression',
          row_id: noteId,
          new_values: { patient_id: input.patient_id, encounter_id: input.encounter_id },
        });

        return {
          note_id: noteId,
          status: 'draft',
          created_at: rows[0].created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create discharge summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 5. UPDATE NOTE (mutation)
  // ─────────────────────────────────────────────────────────
  updateNote: protectedProcedure
    .input(z.object({
      note_id: z.string().uuid(),
      subjective: z.string().max(5000).optional(),
      objective: z.string().max(5000).optional(),
      assessment: z.string().max(5000).optional(),
      plan: z.string().max(5000).optional(),
      shift_summary: z.string().max(5000).optional(),
      pain_assessment: z.string().max(2000).optional(),
      wound_assessment: z.string().max(2000).optional(),
      fall_risk_assessment: z.string().max(2000).optional(),
      skin_integrity_assessment: z.string().max(2000).optional(),
      operative_findings: z.string().max(5000).optional(),
      complications: z.string().max(2000).optional(),
      course_in_hospital: z.string().max(5000).optional(),
      condition_at_discharge: z.string().max(2000).optional(),
      followup_instructions: z.string().max(3000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // 1. Verify note exists and is in draft status
        const checkResult = await sql`
          SELECT id, status, note_type FROM clinical_impressions
          WHERE id = ${input.note_id} AND hospital_id = ${hospitalId};
        `;

        const checkRows = (checkResult as any);
        if (!checkRows || checkRows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Clinical note not found',
          });
        }

        if (checkRows[0].status !== 'draft') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Can only update notes in draft status',
          });
        }

        // 2. Build dynamic update query
        const updates: string[] = [];
        const values: any[] = [];

        if (input.subjective !== undefined) {
          updates.push(`subjective = $${updates.length + 1}`);
          values.push(input.subjective);
        }
        if (input.objective !== undefined) {
          updates.push(`objective = $${updates.length + 1}`);
          values.push(input.objective);
        }
        if (input.assessment !== undefined) {
          updates.push(`assessment = $${updates.length + 1}`);
          values.push(input.assessment);
        }
        if (input.plan !== undefined) {
          updates.push(`plan = $${updates.length + 1}`);
          values.push(input.plan);
        }
        if (input.shift_summary !== undefined) {
          updates.push(`shift_summary = $${updates.length + 1}`);
          values.push(input.shift_summary);
        }
        if (input.pain_assessment !== undefined) {
          updates.push(`pain_assessment = $${updates.length + 1}`);
          values.push(input.pain_assessment);
        }
        if (input.wound_assessment !== undefined) {
          updates.push(`wound_assessment = $${updates.length + 1}`);
          values.push(input.wound_assessment);
        }
        if (input.fall_risk_assessment !== undefined) {
          updates.push(`fall_risk_assessment = $${updates.length + 1}`);
          values.push(input.fall_risk_assessment);
        }
        if (input.skin_integrity_assessment !== undefined) {
          updates.push(`skin_integrity_assessment = $${updates.length + 1}`);
          values.push(input.skin_integrity_assessment);
        }
        if (input.operative_findings !== undefined) {
          updates.push(`operative_findings = $${updates.length + 1}`);
          values.push(input.operative_findings);
        }
        if (input.complications !== undefined) {
          updates.push(`complications = $${updates.length + 1}`);
          values.push(input.complications);
        }
        if (input.course_in_hospital !== undefined) {
          updates.push(`course_in_hospital = $${updates.length + 1}`);
          values.push(input.course_in_hospital);
        }
        if (input.condition_at_discharge !== undefined) {
          updates.push(`condition_at_discharge = $${updates.length + 1}`);
          values.push(input.condition_at_discharge);
        }
        if (input.followup_instructions !== undefined) {
          updates.push(`followup_instructions = $${updates.length + 1}`);
          values.push(input.followup_instructions);
        }

        if (updates.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No fields to update',
          });
        }

        // Add updated_at and hospital_id filter
        updates.push('updated_at = NOW()');

        const updateQuery = `
          UPDATE clinical_impressions
          SET ${updates.join(', ')}
          WHERE id = $${values.length + 1} AND hospital_id = $${values.length + 2}
          RETURNING id, updated_at;
        `;

        const updateResult = await sql(updateQuery, [...values, input.note_id, hospitalId]);

        const rows = (updateResult as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update note',
          });
        }

        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'clinical_impression',
          row_id: input.note_id,
          new_values: { updated_fields: Object.keys(input).filter(k => input[k as keyof typeof input] !== undefined) },
        });

        return {
          note_id: input.note_id,
          updated_at: rows[0].updated_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 6. SIGN NOTE (mutation)
  // ─────────────────────────────────────────────────────────
  signNote: protectedProcedure
    .input(z.object({
      note_id: z.string().uuid(),
      signature_hash: z.string().min(1).max(512),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // 1. Verify note exists and is in draft status
        const checkResult = await sql`
          SELECT id, status FROM clinical_impressions
          WHERE id = ${input.note_id} AND hospital_id = ${hospitalId};
        `;

        const checkRows = (checkResult as any);
        if (!checkRows || checkRows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Clinical note not found',
          });
        }

        if (checkRows[0].status !== 'draft') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Can only sign notes in draft status',
          });
        }

        // 2. Sign note
        const signResult = await sql`
          UPDATE clinical_impressions
          SET status = 'signed',
              signed_by_user_id = ${userId},
              signed_at = NOW(),
              signature_hash = ${input.signature_hash},
              updated_at = NOW()
          WHERE id = ${input.note_id} AND hospital_id = ${hospitalId}
          RETURNING id, signed_at;
        `;

        const signRows = (signResult as any);
        if (!signRows || signRows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to sign note',
          });
        }

        // 3. Update co-signature queue entry if exists
        const queueUpdateResult = await sql`
          UPDATE co_signature_queue
          SET cosign_status = 'signed',
              signed_at = NOW(),
              updated_at = NOW()
          WHERE note_id = ${input.note_id} AND required_signer_id = ${userId};
        `;

        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'clinical_impression',
          row_id: input.note_id,
          new_values: { signature_hash: input.signature_hash },
        });

        return {
          note_id: input.note_id,
          status: 'signed',
          signed_at: signRows[0].signed_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to sign note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 7. LIST NOTES (query)
  // ─────────────────────────────────────────────────────────
  listNotes: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      note_type: noteTypeEnum.optional(),
      status: noteStatusEnum.optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().nonnegative().default(0),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Build query with optional filters
        let whereConditions = `hospital_id = '${hospitalId}' AND patient_id = '${input.patient_id}'`;

        if (input.encounter_id) {
          whereConditions += ` AND encounter_id = '${input.encounter_id}'`;
        }
        if (input.note_type) {
          whereConditions += ` AND note_type = '${input.note_type}'`;
        }
        if (input.status) {
          whereConditions += ` AND status = '${input.status}'`;
        }

        const result = await sql`
          SELECT
            id,
            note_type,
            status,
            author_id,
            created_at,
            updated_at,
            signed_at,
            procedure_name,
            subjective,
            objective,
            assessment,
            plan,
            shift_summary
          FROM clinical_impressions
          WHERE ${sql(whereConditions)}
          ORDER BY created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        return {
          notes: rows || [],
          count: rows?.length || 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 8. GET DETAIL (query)
  // ─────────────────────────────────────────────────────────
  getDetail: protectedProcedure
    .input(z.object({
      note_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT *
          FROM clinical_impressions
          WHERE id = ${input.note_id} AND hospital_id = ${hospitalId};
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Clinical note not found',
          });
        }

        const note = rows[0];

        // Fetch version history if available
        const versionResult = await sql`
          SELECT id, version_number, created_at FROM clinical_impression_versions
          WHERE clinical_impression_id = ${input.note_id}
          ORDER BY version_number DESC
          LIMIT 10;
        `;

        const versions = (versionResult as any) || [];

        return {
          note,
          versions,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch note new_values: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 9. LIST UNSIGNED (query) - Co-signature queue
  // ─────────────────────────────────────────────────────────
  listUnsigned: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().nonnegative().default(0),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await sql`
          SELECT
            csq.id as queue_id,
            csq.note_id,
            csq.cosign_note_type,
            csq.author_id,
            csq.cosign_status,
            csq.created_at as queued_at,
            ci.patient_id,
            ci.encounter_id,
            ci.procedure_name,
            ci.subjective,
            ci.objective,
            ci.assessment,
            ci.plan,
            ci.created_at as note_created_at
          FROM co_signature_queue csq
          JOIN clinical_impressions ci ON csq.note_id = ci.id
          WHERE csq.hospital_id = ${hospitalId}
            AND csq.required_signer_id = ${userId}
            AND csq.cosign_status = 'pending'
          ORDER BY csq.created_at ASC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        return {
          pending_notes: rows || [],
          count: rows?.length || 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list unsigned notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 10. COSIGN STATS (query)
  // ─────────────────────────────────────────────────────────
  cosignStats: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // 1. Count pending
        const pendingResult = await sql`
          SELECT COUNT(*) as count FROM co_signature_queue
          WHERE hospital_id = ${hospitalId}
            AND required_signer_id = ${userId}
            AND cosign_status = 'pending';
        `;

        const pendingRows = (pendingResult as any);
        const pendingCount = pendingRows?.[0]?.count || 0;

        // 2. Count signed today
        const signedTodayResult = await sql`
          SELECT COUNT(*) as count FROM co_signature_queue
          WHERE hospital_id = ${hospitalId}
            AND required_signer_id = ${userId}
            AND cosign_status = 'signed'
            AND DATE(signed_at) = CURRENT_DATE;
        `;

        const signedTodayRows = (signedTodayResult as any);
        const signedTodayCount = signedTodayRows?.[0]?.count || 0;

        // 3. Count overdue (pending for > 4 hours)
        const overdueResult = await sql`
          SELECT COUNT(*) as count FROM co_signature_queue
          WHERE hospital_id = ${hospitalId}
            AND required_signer_id = ${userId}
            AND cosign_status = 'pending'
            AND created_at < NOW() - INTERVAL '4 hours';
        `;

        const overdueRows = (overdueResult as any);
        const overdueCount = overdueRows?.[0]?.count || 0;

        return {
          pending: Number(pendingCount),
          signed_today: Number(signedTodayCount),
          overdue_4h: Number(overdueCount),
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch cosign stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 11. CREATE DOCUMENT (mutation)
  // ─────────────────────────────────────────────────────────
  createDocument: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      document_type: z.string().min(1).max(100),
      title: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
      attachment_url: z.string().url(),
      attachment_filename: z.string().min(1).max(255),
      attachment_mimetype: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const docId = crypto.randomUUID();

        const result = await sql`
          INSERT INTO document_references (
            id,
            hospital_id,
            patient_id,
            encounter_id,
            document_type,
            title,
            description,
            attachment_url,
            attachment_filename,
            attachment_mimetype,
            uploaded_by_user_id,
            created_at,
            updated_at
          )
          VALUES (
            ${docId},
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            ${input.document_type},
            ${input.title},
            ${input.description || null},
            ${input.attachment_url},
            ${input.attachment_filename},
            ${input.attachment_mimetype},
            ${userId},
            NOW(),
            NOW()
          )
          RETURNING id, created_at;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create document reference',
          });
        }

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'document_reference',
          row_id: docId,
          new_values: {
            patient_id: input.patient_id,
            encounter_id: input.encounter_id,
            document_type: input.document_type,
            filename: input.attachment_filename,
          },
        });

        return {
          document_id: docId,
          created_at: rows[0].created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create document reference: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 12. LIST DOCUMENTS (query)
  // ─────────────────────────────────────────────────────────
  listDocuments: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      document_type: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().nonnegative().default(0),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Build query with optional filters
        let whereConditions = `hospital_id = '${hospitalId}' AND patient_id = '${input.patient_id}'`;

        if (input.encounter_id) {
          whereConditions += ` AND encounter_id = '${input.encounter_id}'`;
        }
        if (input.document_type) {
          whereConditions += ` AND document_type = '${input.document_type}'`;
        }

        const result = await sql`
          SELECT
            id,
            document_type,
            title,
            description,
            attachment_filename,
            attachment_mimetype,
            uploaded_by_user_id,
            created_at,
            updated_at
          FROM document_references
          WHERE ${sql(whereConditions)}
          ORDER BY created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const rows = (result as any);

        return {
          documents: rows || [],
          count: rows?.length || 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),
});
