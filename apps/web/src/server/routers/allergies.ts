import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { neon } from '@neondatabase/serverless';
import { writeEvent } from '@/lib/event-log';

const sql = neon(process.env.DATABASE_URL!);

const severityEnum = z.enum(['mild', 'moderate', 'severe', 'life_threatening']);
const categoryEnum = z.enum(['medication', 'food', 'environment', 'biologic']);
const criticalityEnum = z.enum(['low', 'high', 'unable_to_assess']);
const verificationStatusEnum = z.enum(['unconfirmed', 'confirmed', 'refuted', 'entered_in_error']);

const createAllergyInput = z.object({
  patient_id: z.string().uuid(),
  encounter_id: z.string().uuid().optional(),
  substance: z.string().min(1, 'Substance name is required'),
  reaction: z.string().optional(),
  severity: severityEnum.default('moderate'),
  category: categoryEnum.default('medication'),
  criticality: criticalityEnum.default('low'),
  onset_date: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const updateAllergyInput = z.object({
  allergy_id: z.string().uuid(),
  severity: severityEnum.optional(),
  reaction: z.string().optional(),
  allergy_verification_status: verificationStatusEnum.optional(),
  notes: z.string().optional(),
});

const deleteAllergyInput = z.object({
  allergy_id: z.string().uuid(),
});

const listAllergiesInput = z.object({
  patient_id: z.string().uuid(),
});

const checkConflictInput = z.object({
  patient_id: z.string().uuid(),
  substance: z.string().min(1, 'Substance name is required'),
});

export const allergiesRouter = router({
  create: protectedProcedure
    .input(createAllergyInput)
    .mutation(async ({ ctx, input }) => {
      try {
        // Insert new allergy record
        const result = await sql`
          INSERT INTO allergy_intolerances (
            patient_id,
            encounter_id,
            substance,
            reaction,
            severity,
            category,
            criticality,
            onset_date,
            notes,
            recorded_by,
            hospital_id,
            allergy_verification_status,
            version,
            previous_version_id,
            is_deleted,
            created_at,
            updated_at
          )
          VALUES (
            ${input.patient_id},
            ${input.encounter_id || null},
            ${input.substance},
            ${input.reaction || null},
            ${input.severity},
            ${input.category},
            ${input.criticality},
            ${input.onset_date || null},
            ${input.notes || null},
            ${ctx.user.sub},
            ${ctx.user.hospital_id},
            'unconfirmed',
            1,
            NULL,
            false,
            NOW(),
            NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create allergy record');
        }

        // Log event (fire-and-forget)
        try {
          await writeEvent({
            hospital_id: ctx.user.hospital_id,
            resource_type: 'allergy',
            resource_id: rows[0].id,
            event_type: 'created',
            data: {
              patient_id: input.patient_id,
              encounter_id: input.encounter_id || null,
              substance: input.substance,
              reaction: input.reaction || null,
              severity: input.severity,
              category: input.category,
              criticality: input.criticality,
              onset_date: input.onset_date || null,
              notes: input.notes || null,
            },
            actor_id: ctx.user.sub,
            actor_email: ctx.user.email,
          });
        } catch (error) {
          console.error('Failed to write event log for allergy creation:', error);
        }

        return {
          success: true,
          allergy: rows[0],
        };
      } catch (error) {
        throw new Error(
          `Failed to create allergy: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

  update: protectedProcedure
    .input(updateAllergyInput)
    .mutation(async ({ ctx, input }) => {
      try {
        // Fetch current allergy record to validate ownership and prepare versioning
        const fetchResult = await sql`
          SELECT * FROM allergy_intolerances
          WHERE id = ${input.allergy_id}
          AND hospital_id = ${ctx.user.hospital_id}
          AND is_deleted = false;
        `;

        const rows = (fetchResult as any);
        if (!rows || rows.length === 0) {
          throw new Error('Allergy record not found');
        }

        const currentAllergy = rows[0];

        // Create new version row (event sourcing)
        const updateResult = await sql`
          INSERT INTO allergy_intolerances (
            patient_id,
            encounter_id,
            substance,
            reaction,
            severity,
            category,
            criticality,
            onset_date,
            notes,
            recorded_by,
            hospital_id,
            allergy_verification_status,
            version,
            previous_version_id,
            is_deleted,
            created_at,
            updated_at
          )
          VALUES (
            ${currentAllergy.patient_id},
            ${currentAllergy.encounter_id},
            ${currentAllergy.substance},
            ${input.reaction !== undefined ? input.reaction : currentAllergy.reaction},
            ${input.severity !== undefined ? input.severity : currentAllergy.severity},
            ${currentAllergy.category},
            ${currentAllergy.criticality},
            ${currentAllergy.onset_date},
            ${input.notes !== undefined ? input.notes : currentAllergy.notes},
            ${ctx.user.sub},
            ${ctx.user.hospital_id},
            ${input.allergy_verification_status !== undefined ? input.allergy_verification_status : currentAllergy.allergy_verification_status},
            ${currentAllergy.version + 1},
            ${input.allergy_id},
            false,
            NOW(),
            NOW()
          )
          RETURNING *;
        `;

        const updateRows = (updateResult as any);
        if (!updateRows || updateRows.length === 0) {
          throw new Error('Failed to update allergy record');
        }

        // Log event (fire-and-forget)
        try {
          await writeEvent({
            hospital_id: ctx.user.hospital_id,
            resource_type: 'allergy',
            resource_id: updateRows[0].id,
            event_type: 'updated',
            data: {
              patient_id: currentAllergy.patient_id,
              encounter_id: currentAllergy.encounter_id || null,
              substance: currentAllergy.substance,
              reaction: input.reaction !== undefined ? input.reaction : currentAllergy.reaction,
              severity: input.severity !== undefined ? input.severity : currentAllergy.severity,
              category: currentAllergy.category,
              criticality: currentAllergy.criticality,
              onset_date: currentAllergy.onset_date || null,
              allergy_verification_status: input.allergy_verification_status !== undefined ? input.allergy_verification_status : currentAllergy.allergy_verification_status,
              notes: input.notes !== undefined ? input.notes : currentAllergy.notes,
            },
            delta: {
              reaction: input.reaction,
              severity: input.severity,
              allergy_verification_status: input.allergy_verification_status,
              notes: input.notes,
            },
            actor_id: ctx.user.sub,
            actor_email: ctx.user.email,
          });
        } catch (error) {
          console.error('Failed to write event log for allergy update:', error);
        }

        return {
          success: true,
          allergy: updateRows[0],
        };
      } catch (error) {
        throw new Error(
          `Failed to update allergy: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

  delete: protectedProcedure
    .input(deleteAllergyInput)
    .mutation(async ({ ctx, input }) => {
      try {
        // Fetch current allergy for event log
        const currentResult = await sql`
          SELECT * FROM allergy_intolerances
          WHERE id = ${input.allergy_id}
          AND hospital_id = ${ctx.user.hospital_id}
          AND is_deleted = false;
        `;

        const currentRows = (currentResult as any);
        if (!currentRows || currentRows.length === 0) {
          throw new Error('Allergy record not found or already deleted');
        }

        const currentAllergy = currentRows[0];

        // Soft delete: set is_deleted = true
        const result = await sql`
          UPDATE allergy_intolerances
          SET is_deleted = true, updated_at = NOW()
          WHERE id = ${input.allergy_id}
          AND hospital_id = ${ctx.user.hospital_id}
          AND is_deleted = false
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Allergy record not found or already deleted');
        }

        // Log event (fire-and-forget)
        try {
          await writeEvent({
            hospital_id: ctx.user.hospital_id,
            resource_type: 'allergy',
            resource_id: rows[0].id,
            event_type: 'deleted',
            data: currentAllergy,
            actor_id: ctx.user.sub,
            actor_email: ctx.user.email,
          });
        } catch (error) {
          console.error('Failed to write event log for allergy deletion:', error);
        }

        return {
          success: true,
          message: 'Allergy record deleted successfully',
        };
      } catch (error) {
        throw new Error(
          `Failed to delete allergy: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

  list: protectedProcedure
    .input(listAllergiesInput)
    .query(async ({ ctx, input }) => {
      try {
        // Get all non-deleted allergies for patient, ordered by severity (descending) then created_at (descending)
        const result = await sql`
          SELECT *
          FROM allergy_intolerances
          WHERE patient_id = ${input.patient_id}
          AND hospital_id = ${ctx.user.hospital_id}
          AND is_deleted = false
          ORDER BY
            CASE severity
              WHEN 'life_threatening' THEN 0
              WHEN 'severe' THEN 1
              WHEN 'moderate' THEN 2
              WHEN 'mild' THEN 3
              ELSE 4
            END ASC,
            created_at DESC;
        `;

        const rows = (result as any);
        return {
          success: true,
          allergies: rows || [],
          count: (rows || []).length,
        };
      } catch (error) {
        throw new Error(
          `Failed to fetch allergies: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),

  checkConflict: protectedProcedure
    .input(checkConflictInput)
    .query(async ({ ctx, input }) => {
      try {
        // Check if patient has any allergy where substance matches (case-insensitive)
        const result = await sql`
          SELECT
            id,
            substance,
            reaction,
            severity
          FROM allergy_intolerances
          WHERE patient_id = ${input.patient_id}
          AND hospital_id = ${ctx.user.hospital_id}
          AND is_deleted = false
          AND substance ILIKE ${`%${input.substance}%`};
        `;

        const rows = (result as any);
        const conflicts = rows || [];

        return {
          success: true,
          has_conflict: conflicts.length > 0,
          conflicts: conflicts.map((conflict: any) => ({
            id: conflict.id,
            substance: conflict.substance,
            reaction: conflict.reaction,
            severity: conflict.severity,
          })),
        };
      } catch (error) {
        throw new Error(
          `Failed to check allergy conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }),
});
