import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const clinicalStatusValues = ['active', 'inactive', 'resolved', 'remission'] as const;
const verificationStatusValues = ['unconfirmed', 'provisional', 'differential', 'confirmed'] as const;
const severityValues = ['mild', 'moderate', 'severe'] as const;

export const conditionsRouter = router({

  // ─── CREATE ─────────────────────────────────────────────────
  create: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      icd10_code: z.string().max(10).optional(),
      condition_name: z.string().min(1).max(255),
      clinical_status: z.enum(clinicalStatusValues).default('active'),
      verification_status: z.enum(verificationStatusValues).default('unconfirmed'),
      severity: z.enum(severityValues).optional(),
      onset_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Verify patient exists in this hospital
        const patientCheck = await sql`
          SELECT id FROM patients
          WHERE id = ${input.patient_id}
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!patientCheck || patientCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Patient not found in this hospital',
          });
        }

        // Verify encounter if provided
        if (input.encounter_id) {
          const encounterCheck = await sql`
            SELECT id FROM encounters
            WHERE id = ${input.encounter_id}
            AND hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}
            LIMIT 1
          `;

          if (!encounterCheck || encounterCheck.length === 0) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Encounter not found for this patient',
            });
          }
        }

        // Insert condition
        const result = await sql`
          INSERT INTO conditions (
            hospital_id,
            patient_id,
            encounter_id,
            icd10_code,
            condition_name,
            clinical_status,
            verification_status,
            severity,
            onset_date,
            notes,
            recorded_by,
            is_deleted,
            version,
            previous_version_id,
            created_at,
            updated_at
          ) VALUES (
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id || null},
            ${input.icd10_code || null},
            ${input.condition_name},
            ${input.clinical_status},
            ${input.verification_status},
            ${input.severity || null},
            ${input.onset_date || null},
            ${input.notes || null},
            ${userId},
            false,
            1,
            null,
            NOW(),
            NOW()
          )
          RETURNING id, condition_name, clinical_status, created_at
        `;

        const rows = (result as any);

        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create condition',
          });
        }

        return {
          condition_id: rows[0].id,
          condition_name: rows[0].condition_name,
          clinical_status: rows[0].clinical_status,
          created_at: rows[0].created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error creating condition',
        });
      }
    }),

  // ─── UPDATE ─────────────────────────────────────────────────
  update: protectedProcedure
    .input(z.object({
      condition_id: z.string().uuid(),
      clinical_status: z.enum(clinicalStatusValues).optional(),
      verification_status: z.enum(verificationStatusValues).optional(),
      severity: z.enum(severityValues).optional(),
      abatement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get current condition
        const currentCondition = await sql`
          SELECT
            id, hospital_id, patient_id, encounter_id, icd10_code,
            condition_name, clinical_status, verification_status, severity,
            onset_date, notes, version
          FROM conditions
          WHERE id = ${input.condition_id}
          AND hospital_id = ${hospitalId}
          AND is_deleted = false
          LIMIT 1
        `;

        if (!currentCondition || currentCondition.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Condition not found',
          });
        }

        const condition = currentCondition[0];

        // Create new version (event sourcing)
        const result = await sql`
          INSERT INTO conditions (
            hospital_id,
            patient_id,
            encounter_id,
            icd10_code,
            condition_name,
            clinical_status,
            verification_status,
            severity,
            onset_date,
            abatement_date,
            notes,
            recorded_by,
            is_deleted,
            version,
            previous_version_id,
            created_at,
            updated_at
          ) VALUES (
            ${hospitalId},
            ${condition.patient_id},
            ${condition.encounter_id},
            ${condition.icd10_code},
            ${condition.condition_name},
            ${input.clinical_status !== undefined ? input.clinical_status : condition.clinical_status},
            ${input.verification_status !== undefined ? input.verification_status : condition.verification_status},
            ${input.severity !== undefined ? input.severity : condition.severity},
            ${condition.onset_date},
            ${input.abatement_date || null},
            ${input.notes !== undefined ? input.notes : condition.notes},
            ${userId},
            false,
            ${condition.version + 1},
            ${input.condition_id},
            NOW(),
            NOW()
          )
          RETURNING id, version, clinical_status, created_at
        `;

        const rows = (result as any);

        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update condition',
          });
        }

        return {
          condition_id: rows[0].id,
          version: rows[0].version,
          clinical_status: rows[0].clinical_status,
          created_at: rows[0].created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating condition',
        });
      }
    }),

  // ─── DELETE (SOFT) ──────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({
      condition_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Verify condition exists
        const condition = await sql`
          SELECT id FROM conditions
          WHERE id = ${input.condition_id}
          AND hospital_id = ${hospitalId}
          AND is_deleted = false
          LIMIT 1
        `;

        if (!condition || condition.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Condition not found',
          });
        }

        // Soft delete
        const result = await sql`
          UPDATE conditions
          SET is_deleted = true, updated_at = NOW()
          WHERE id = ${input.condition_id}
          AND hospital_id = ${hospitalId}
          RETURNING id, is_deleted
        `;

        const rows = (result as any);

        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to delete condition',
          });
        }

        return {
          condition_id: rows[0].id,
          deleted: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error deleting condition',
        });
      }
    }),

  // ─── LIST ───────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      include_resolved: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        let query = `
          SELECT
            id, patient_id, encounter_id, icd10_code, condition_name,
            clinical_status, verification_status, severity,
            onset_date, abatement_date, notes, version, recorded_by,
            created_at, updated_at
          FROM conditions
          WHERE hospital_id = $1
          AND patient_id = $2
          AND is_deleted = false
        `;

        const params: any[] = [hospitalId, input.patient_id];

        if (!input.include_resolved) {
          query += ` AND clinical_status NOT IN ('resolved', 'inactive', 'remission')`;
        }

        query += ` ORDER BY created_at DESC`;

        const result = await sql(query, params);
        const rows = (result as any);

        return {
          conditions: rows || [],
          count: (rows || []).length,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching conditions',
        });
      }
    }),

  // ─── GET DETAIL ──────────────────────────────────────────────
  getDetail: protectedProcedure
    .input(z.object({
      condition_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get the current condition
        const condition = await sql`
          SELECT
            id, patient_id, encounter_id, icd10_code, condition_name,
            clinical_status, verification_status, severity,
            onset_date, abatement_date, notes, version, recorded_by,
            previous_version_id, created_at, updated_at
          FROM conditions
          WHERE id = ${input.condition_id}
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!condition || condition.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Condition not found',
          });
        }

        const current = condition[0];

        // Get version history by following the chain
        const history = await sql`
          WITH RECURSIVE version_chain AS (
            SELECT
              id, version, clinical_status, verification_status, severity,
              notes, recorded_by, created_at, previous_version_id
            FROM conditions
            WHERE id = ${input.condition_id}
            AND hospital_id = ${hospitalId}
            UNION ALL
            SELECT
              c.id, c.version, c.clinical_status, c.verification_status,
              c.severity, c.notes, c.recorded_by, c.created_at, c.previous_version_id
            FROM conditions c
            INNER JOIN version_chain vc ON c.id = vc.previous_version_id
            WHERE c.hospital_id = ${hospitalId}
          )
          SELECT
            id, version, clinical_status, verification_status, severity,
            notes, recorded_by, created_at
          FROM version_chain
          ORDER BY version ASC
        `;

        const versionHistory = (history as any) || [];

        return {
          condition: {
            id: current.id,
            patient_id: current.patient_id,
            encounter_id: current.encounter_id,
            icd10_code: current.icd10_code,
            condition_name: current.condition_name,
            clinical_status: current.clinical_status,
            verification_status: current.verification_status,
            severity: current.severity,
            onset_date: current.onset_date,
            abatement_date: current.abatement_date,
            notes: current.notes,
            version: current.version,
            recorded_by: current.recorded_by,
            created_at: current.created_at,
            updated_at: current.updated_at,
          },
          version_history: versionHistory,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching condition details',
        });
      }
    }),

  // ─── GET HISTORY ────────────────────────────────────────────
  getHistory: protectedProcedure
    .input(z.object({
      condition_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Verify condition exists
        const conditionCheck = await sql`
          SELECT id FROM conditions
          WHERE id = ${input.condition_id}
          AND hospital_id = ${hospitalId}
          LIMIT 1
        `;

        if (!conditionCheck || conditionCheck.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Condition not found',
          });
        }

        // Get full version history
        const result = await sql`
          WITH RECURSIVE version_chain AS (
            SELECT
              id, version, clinical_status, verification_status, severity,
              onset_date, abatement_date, notes, recorded_by,
              created_at, previous_version_id
            FROM conditions
            WHERE id = ${input.condition_id}
            AND hospital_id = ${hospitalId}
            UNION ALL
            SELECT
              c.id, c.version, c.clinical_status, c.verification_status,
              c.severity, c.onset_date, c.abatement_date, c.notes,
              c.recorded_by, c.created_at, c.previous_version_id
            FROM conditions c
            INNER JOIN version_chain vc ON c.id = vc.previous_version_id
            WHERE c.hospital_id = ${hospitalId}
          )
          SELECT
            id, version, clinical_status, verification_status, severity,
            onset_date, abatement_date, notes, recorded_by, created_at
          FROM version_chain
          ORDER BY version ASC
        `;

        const rows = (result as any) || [];

        return {
          condition_id: input.condition_id,
          versions: rows,
          total_versions: rows.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching condition history',
        });
      }
    }),

});
