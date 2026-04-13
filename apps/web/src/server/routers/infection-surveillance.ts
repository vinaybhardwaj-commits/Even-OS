import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';


let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ─── ENUMS ───────────────────────────────────────────────────────
const haiTypeEnum = z.enum(['CLABSI', 'CAUTI', 'VAP', 'SSI', 'MRSA', 'C_diff', 'other']);
const haiOutcomeEnum = z.enum(['resolved', 'ongoing', 'death']);
const abxJustificationReasonEnum = z.enum(['confirmed_mdr_organism', 'empiric_febrile_neutropenia', 'high_risk_without_coverage', 'other']);
const abxApprovalStatusEnum = z.enum(['pending', 'approved', 'denied']);
const cultureStatusAtOrderEnum = z.enum(['not_sent', 'pending', 'positive', 'negative', 'unknown']);

// ─── INFECTION SURVEILLANCE ROUTER ───────────────────────────────

export const infectionSurveillanceRouter = router({

  // ════════════════════════════════════════════════════════════════
  // INFECTION SURVEILLANCE (6 endpoints)
  // ════════════════════════════════════════════════════════════════

  // 1. RECORD INFECTION ─────────────────────────────────────────────
  recordInfection: protectedProcedure
    .input(z.object({
      is_patient_id: z.string().uuid(),
      is_encounter_id: z.string().uuid(),
      infection_type: haiTypeEnum,
      organism: z.string().min(1),
      organism_display_name: z.string().optional(),
      susceptibility_json: z.string().optional(),
      antibiotic_treated_with: z.string().optional(),
      device_involved: z.string().optional(),
      device_insertion_date: z.string().datetime().optional(),
      device_removal_date: z.string().datetime().optional(),
      onset_date: z.string().datetime(),
      identified_date: z.string().datetime(),
      treatment_antibiotic: z.string().optional(),
      treatment_duration_days: z.number().int().min(0).max(365).optional(),
      is_outcome: haiOutcomeEnum.optional(),
      is_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await getSql()`
          INSERT INTO infection_surveillance (
            hospital_id, is_patient_id, is_encounter_id,
            infection_type, organism, organism_display_name,
            susceptibility_json, antibiotic_treated_with,
            device_involved, device_insertion_date, device_removal_date,
            onset_date, identified_date,
            treatment_antibiotic, treatment_duration_days,
            is_outcome, is_recorded_by_user_id, is_recorded_at, is_notes,
            is_created_at
          )
          VALUES (
            ${hospitalId}, ${input.is_patient_id}::uuid, ${input.is_encounter_id}::uuid,
            ${input.infection_type}, ${input.organism}, ${input.organism_display_name || null},
            ${input.susceptibility_json || null}, ${input.antibiotic_treated_with || null},
            ${input.device_involved || null}, ${input.device_insertion_date || null}::timestamptz, ${input.device_removal_date || null}::timestamptz,
            ${input.onset_date}::timestamptz, ${input.identified_date}::timestamptz,
            ${input.treatment_antibiotic || null}, ${input.treatment_duration_days || null},
            ${input.is_outcome || null}, ${userId}, NOW(), ${input.is_notes || null},
            NOW()
          )
          RETURNING id, infection_type, organism, is_created_at;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create infection surveillance record',
          });
        }

        return {
          id: rows[0].id,
          infection_type: rows[0].infection_type,
          organism: rows[0].organism,
          created_at: rows[0].is_created_at,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error recording infection surveillance event',
        });
      }
    }),

  // 2. GET INFECTION ────────────────────────────────────────────────
  getInfection: protectedProcedure
    .input(z.object({ infection_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, hospital_id, is_patient_id, is_encounter_id,
            infection_type, organism, organism_display_name,
            susceptibility_json, antibiotic_treated_with,
            device_involved, device_insertion_date, device_removal_date,
            onset_date, identified_date,
            treatment_antibiotic, treatment_duration_days,
            is_outcome, is_recorded_by_user_id, is_recorded_at, is_notes,
            is_created_at
          FROM infection_surveillance
          WHERE id = ${input.infection_id}::uuid AND hospital_id = ${hospitalId}
          LIMIT 1;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Infection surveillance record not found',
          });
        }

        return rows[0];
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching infection record',
        });
      }
    }),

  // 3. LIST INFECTIONS ──────────────────────────────────────────────
  listInfections: protectedProcedure
    .input(z.object({
      infection_type: haiTypeEnum.optional(),
      is_outcome: haiOutcomeEnum.optional(),
      date_from: z.string().datetime().optional(),
      date_to: z.string().datetime().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const offset = (input.page - 1) * input.pageSize;

        // Count total
        const countResult = await getSql()`
          SELECT COUNT(*) as total
          FROM infection_surveillance
          WHERE hospital_id = ${hospitalId}
            AND (${input.infection_type ?? null}::text IS NULL OR infection_type = ${input.infection_type ?? null})
            AND (${input.is_outcome ?? null}::text IS NULL OR is_outcome = ${input.is_outcome ?? null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR identified_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR identified_date <= ${input.date_to ?? null}::timestamptz);
        `;

        const countRows = (countResult as any);
        const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

        // Fetch records
        const result = await getSql()`
          SELECT
            id, infection_type, organism, organism_display_name,
            device_involved, onset_date, identified_date,
            treatment_antibiotic, treatment_duration_days,
            is_outcome, is_notes, is_created_at
          FROM infection_surveillance
          WHERE hospital_id = ${hospitalId}
            AND (${input.infection_type ?? null}::text IS NULL OR infection_type = ${input.infection_type ?? null})
            AND (${input.is_outcome ?? null}::text IS NULL OR is_outcome = ${input.is_outcome ?? null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR identified_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR identified_date <= ${input.date_to ?? null}::timestamptz)
          ORDER BY identified_date DESC
          LIMIT ${input.pageSize} OFFSET ${offset};
        `;

        const rows = (result as any) || [];

        return {
          data: rows,
          pagination: {
            total,
            page: input.page,
            pageSize: input.pageSize,
            totalPages: Math.ceil(total / input.pageSize),
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing infections',
        });
      }
    }),

  // 4. UPDATE INFECTION ─────────────────────────────────────────────
  updateInfection: protectedProcedure
    .input(z.object({
      infection_id: z.string().uuid(),
      treatment_antibiotic: z.string().optional(),
      treatment_duration_days: z.number().int().min(0).max(365).optional(),
      is_outcome: haiOutcomeEnum.optional(),
      is_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await getSql()`
          UPDATE infection_surveillance
          SET
            treatment_antibiotic = COALESCE(${input.treatment_antibiotic || null}, treatment_antibiotic),
            treatment_duration_days = COALESCE(${input.treatment_duration_days || null}::int, treatment_duration_days),
            is_outcome = COALESCE(${input.is_outcome || null}, is_outcome),
            is_notes = COALESCE(${input.is_notes || null}, is_notes)
          WHERE id = ${input.infection_id}::uuid AND hospital_id = ${hospitalId}
          RETURNING id, infection_type, organism;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Infection record not found',
          });
        }

        return { id: rows[0].id, updated: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating infection record',
        });
      }
    }),

  // 5. DELETE INFECTION (admin only) ────────────────────────────────
  deleteInfection: adminProcedure
    .input(z.object({ infection_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await getSql()`
          DELETE FROM infection_surveillance
          WHERE id = ${input.infection_id}::uuid AND hospital_id = ${hospitalId}
          RETURNING id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Infection record not found',
          });
        }

        return { deleted: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error deleting infection record',
        });
      }
    }),

  // 6. INFECTION TIMELINE (all infections for a patient) ────────────
  infectionTimeline: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, infection_type, organism, organism_display_name,
            device_involved, onset_date, identified_date,
            treatment_antibiotic, is_outcome, is_notes
          FROM infection_surveillance
          WHERE hospital_id = ${hospitalId} AND is_patient_id = ${input.patient_id}::uuid
          ORDER BY identified_date DESC;
        `;

        const rows = (result as any) || [];
        return rows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching infection timeline',
        });
      }
    }),

  // ════════════════════════════════════════════════════════════════
  // INFECTION RATES (3 endpoints)
  // ════════════════════════════════════════════════════════════════

  // 7. COMPUTE RATES (admin only) ───────────────────────────────────
  computeRates: adminProcedure
    .input(z.object({
      period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get all unique infection types for the period
        const infectionTypesResult = await getSql()`
          SELECT DISTINCT infection_type FROM infection_surveillance
          WHERE hospital_id = ${hospitalId}
            AND DATE(identified_date) >= ${input.period_start}::date
            AND DATE(identified_date) <= ${input.period_end}::date;
        `;

        const infectionTypes = ((infectionTypesResult as any) || []).map((r: any) => r.infection_type);

        const results = [];

        for (const infType of infectionTypes) {
          // Count infections
          const countResult = await getSql()`
            SELECT COUNT(*) as numerator FROM infection_surveillance
            WHERE hospital_id = ${hospitalId}
              AND infection_type = ${infType}
              AND DATE(identified_date) >= ${input.period_start}::date
              AND DATE(identified_date) <= ${input.period_end}::date;
          `;

          const countRows = (countResult as any);
          const numerator = countRows && countRows.length > 0 ? parseInt(countRows[0].numerator) : 0;

          // Estimate denominator (device-days or patient-days)
          // For simplicity, using encounter count as proxy for patient-days
          const denomResult = await getSql()`
            SELECT COUNT(DISTINCT is_encounter_id) as denominator FROM infection_surveillance
            WHERE hospital_id = ${hospitalId}
              AND DATE(identified_date) >= ${input.period_start}::date
              AND DATE(identified_date) <= ${input.period_end}::date;
          `;

          const denomRows = (denomResult as any);
          const denominator = denomRows && denomRows.length > 0 ? Math.max(1, parseInt(denomRows[0].denominator)) : 1;

          const ratePerThousand = (numerator / denominator) * 1000;

          // Upsert into infection_rates
          await getSql()`
            INSERT INTO infection_rates (
              hospital_id, period_start, period_end,
              ir_infection_type, ir_numerator, ir_denominator,
              rate_per_1000, denominator_sufficiency, ir_computed_at
            )
            VALUES (
              ${hospitalId}, ${input.period_start}::date, ${input.period_end}::date,
              ${infType}, ${numerator}, ${denominator},
              ${ratePerThousand}, 'adequate', NOW()
            )
            ON CONFLICT (hospital_id, ir_infection_type, period_start, period_end)
            DO UPDATE SET
              ir_numerator = EXCLUDED.ir_numerator,
              ir_denominator = EXCLUDED.ir_denominator,
              rate_per_1000 = EXCLUDED.rate_per_1000,
              ir_computed_at = NOW();
          `;

          results.push({
            infection_type: infType,
            numerator,
            denominator,
            rate_per_1000: ratePerThousand,
          });
        }

        return { computed: results };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error computing infection rates',
        });
      }
    }),

  // 8. LIST RATES ───────────────────────────────────────────────────
  listRates: protectedProcedure
    .input(z.object({
      infection_type: haiTypeEnum.optional(),
      period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, period_start, period_end,
            ir_infection_type, ir_numerator, ir_denominator,
            rate_per_1000, denominator_sufficiency, ir_computed_at
          FROM infection_rates
          WHERE hospital_id = ${hospitalId}
            AND (${input.infection_type ?? null}::text IS NULL OR ir_infection_type = ${input.infection_type ?? null})
            AND (${input.period_start ?? null}::date IS NULL OR period_start >= ${input.period_start ?? null}::date)
            AND (${input.period_end ?? null}::date IS NULL OR period_end <= ${input.period_end ?? null}::date)
          ORDER BY period_end DESC;
        `;

        const rows = (result as any) || [];
        return rows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing infection rates',
        });
      }
    }),

  // 9. GET RATE TREND ───────────────────────────────────────────────
  getRateTrend: protectedProcedure
    .input(z.object({
      infection_type: haiTypeEnum,
      months: z.number().int().min(1).max(60).default(12),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            period_start, period_end,
            ir_numerator, ir_denominator, rate_per_1000
          FROM infection_rates
          WHERE hospital_id = ${hospitalId}
            AND ir_infection_type = ${input.infection_type}
            AND period_end >= NOW() - INTERVAL '1 month' * ${input.months}::int
          ORDER BY period_start ASC;
        `;

        const rows = (result as any) || [];
        return {
          infection_type: input.infection_type,
          trend: rows,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching rate trend',
        });
      }
    }),

  // ════════════════════════════════════════════════════════════════
  // ANTIBIOTIC USAGE (5 endpoints)
  // ════════════════════════════════════════════════════════════════

  // 10. LOG USAGE ───────────────────────────────────────────────────
  logUsage: protectedProcedure
    .input(z.object({
      aul_patient_id: z.string().uuid(),
      aul_encounter_id: z.string().uuid(),
      medication_order_id: z.string().uuid().optional(),
      antibiotic_name: z.string().min(1),
      is_restricted: z.boolean().default(false),
      restriction_approval_id: z.string().uuid().optional(),
      dose_mg: z.number().optional(),
      frequency_per_day: z.number().optional(),
      aul_route: z.string().optional(),
      aul_start_date: z.string().datetime(),
      aul_end_date: z.string().datetime().optional(),
      aul_duration_days: z.number().int().optional(),
      culture_status_at_order: cultureStatusAtOrderEnum.default('unknown'),
      organism_if_known: z.string().optional(),
      susceptible_to_antibiotic: z.boolean().optional(),
      justification_text: z.string().optional(),
      ddd_standard_mg: z.number().optional(),
      ddd_count: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const durationDays = input.aul_duration_days ?? (input.aul_end_date ? Math.ceil(
          (new Date(input.aul_end_date).getTime() - new Date(input.aul_start_date).getTime()) / (1000 * 60 * 60 * 24)
        ) : null);

        const result = await getSql()`
          INSERT INTO antibiotic_usage_log (
            hospital_id, aul_patient_id, aul_encounter_id,
            medication_order_id, antibiotic_name, is_restricted,
            restriction_approval_id, dose_mg, frequency_per_day,
            aul_route, aul_start_date, aul_end_date, aul_duration_days,
            culture_status_at_order, organism_if_known, susceptible_to_antibiotic,
            justification_text, ddd_standard_mg, ddd_count,
            aul_prescribed_by_user_id, aul_prescribed_at, aul_created_at
          )
          VALUES (
            ${hospitalId}, ${input.aul_patient_id}::uuid, ${input.aul_encounter_id}::uuid,
            ${input.medication_order_id || null}::uuid, ${input.antibiotic_name}, ${input.is_restricted},
            ${input.restriction_approval_id || null}::uuid, ${input.dose_mg || null}, ${input.frequency_per_day || null},
            ${input.aul_route || null}, ${input.aul_start_date}::timestamptz, ${input.aul_end_date || null}::timestamptz, ${durationDays},
            ${input.culture_status_at_order}, ${input.organism_if_known || null}, ${input.susceptible_to_antibiotic || null},
            ${input.justification_text || null}, ${input.ddd_standard_mg || null}, ${input.ddd_count || null},
            ${userId}, NOW(), NOW()
          )
          RETURNING id, antibiotic_name, aul_duration_days;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to log antibiotic usage',
          });
        }

        return { id: rows[0].id, antibiotic_name: rows[0].antibiotic_name };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error logging antibiotic usage',
        });
      }
    }),

  // 11. LIST USAGE ──────────────────────────────────────────────────
  listUsage: protectedProcedure
    .input(z.object({
      aul_patient_id: z.string().uuid().optional(),
      antibiotic_name: z.string().optional(),
      is_restricted: z.boolean().optional(),
      date_from: z.string().datetime().optional(),
      date_to: z.string().datetime().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const offset = (input.page - 1) * input.pageSize;

        const countResult = await getSql()`
          SELECT COUNT(*) as total FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND (${input.aul_patient_id ?? null}::uuid IS NULL OR aul_patient_id = ${input.aul_patient_id ?? null}::uuid)
            AND (${input.antibiotic_name ?? null}::text IS NULL OR antibiotic_name ILIKE ${'%' + (input.antibiotic_name ?? '') + '%'})
            AND (${input.is_restricted ?? null}::boolean IS NULL OR is_restricted = ${input.is_restricted ?? null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR aul_start_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR aul_start_date <= ${input.date_to ?? null}::timestamptz);
        `;

        const countRows = (countResult as any);
        const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

        const result = await getSql()`
          SELECT
            id, antibiotic_name, is_restricted,
            dose_mg, frequency_per_day, aul_route,
            aul_start_date, aul_end_date, aul_duration_days,
            culture_status_at_order, organism_if_known, susceptible_to_antibiotic,
            justification_text, ddd_count, aul_prescribed_at
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND (${input.aul_patient_id ?? null}::uuid IS NULL OR aul_patient_id = ${input.aul_patient_id ?? null}::uuid)
            AND (${input.antibiotic_name ?? null}::text IS NULL OR antibiotic_name ILIKE ${'%' + (input.antibiotic_name ?? '') + '%'})
            AND (${input.is_restricted ?? null}::boolean IS NULL OR is_restricted = ${input.is_restricted ?? null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR aul_start_date >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR aul_start_date <= ${input.date_to ?? null}::timestamptz)
          ORDER BY aul_start_date DESC
          LIMIT ${input.pageSize} OFFSET ${offset};
        `;

        const rows = (result as any) || [];

        return {
          data: rows,
          pagination: {
            total,
            page: input.page,
            pageSize: input.pageSize,
            totalPages: Math.ceil(total / input.pageSize),
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing antibiotic usage',
        });
      }
    }),

  // 12. GET USAGE STATS ─────────────────────────────────────────────
  getUsageStats: protectedProcedure
    .input(z.object({
      period_start: z.string().datetime(),
      period_end: z.string().datetime(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get total DDD count for period
        const dddResult = await getSql()`
          SELECT
            COALESCE(SUM(CAST(ddd_count AS NUMERIC)), 0) as total_ddd,
            COUNT(*) as record_count
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND aul_start_date >= ${input.period_start}::timestamptz
            AND aul_start_date <= ${input.period_end}::timestamptz;
        `;

        const dddRows = (dddResult as any);
        const totalDdd = dddRows && dddRows.length > 0 ? parseFloat(dddRows[0].total_ddd || 0) : 0;
        const recordCount = dddRows && dddRows.length > 0 ? parseInt(dddRows[0].record_count || 0) : 0;

        // Get distinct patients in period (proxy for patient-days)
        const patientsResult = await getSql()`
          SELECT COUNT(DISTINCT aul_patient_id) as patient_count FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND aul_start_date >= ${input.period_start}::timestamptz
            AND aul_start_date <= ${input.period_end}::timestamptz;
        `;

        const patientRows = (patientsResult as any);
        const patientCount = patientRows && patientRows.length > 0 ? parseInt(patientRows[0].patient_count || 1) : 1;

        // DDD per 1000 patient-days (rough estimate)
        const dddPer1000 = (totalDdd / Math.max(1, patientCount)) * 1000;

        // Get restricted antibiotic usage
        const restrictedResult = await getSql()`
          SELECT
            COUNT(*) as restricted_count,
            COUNT(DISTINCT antibiotic_name) as distinct_restricted
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND is_restricted = true
            AND aul_start_date >= ${input.period_start}::timestamptz
            AND aul_start_date <= ${input.period_end}::timestamptz;
        `;

        const restrictedRows = (restrictedResult as any);
        const restrictedCount = restrictedRows && restrictedRows.length > 0 ? parseInt(restrictedRows[0].restricted_count || 0) : 0;

        const restrictedPercent = recordCount > 0 ? (restrictedCount / recordCount) * 100 : 0;

        return {
          total_ddd: totalDdd,
          ddd_per_1000_patients: dddPer1000,
          total_prescriptions: recordCount,
          restricted_prescriptions: restrictedCount,
          restricted_percentage: restrictedPercent,
          unique_patients: patientCount,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error calculating usage stats',
        });
      }
    }),

  // 13. UPDATE USAGE ────────────────────────────────────────────────
  updateUsage: protectedProcedure
    .input(z.object({
      usage_id: z.string().uuid(),
      aul_end_date: z.string().datetime().optional(),
      aul_duration_days: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await getSql()`
          UPDATE antibiotic_usage_log
          SET
            aul_end_date = COALESCE(${input.aul_end_date || null}::timestamptz, aul_end_date),
            aul_duration_days = COALESCE(${input.aul_duration_days || null}::int, aul_duration_days)
          WHERE id = ${input.usage_id}::uuid AND hospital_id = ${hospitalId}
          RETURNING id, antibiotic_name;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Antibiotic usage record not found',
          });
        }

        return { id: rows[0].id, updated: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error updating antibiotic usage',
        });
      }
    }),

  // 14. GET PATIENT ABX HISTORY ────────────────────────────────────
  getPatientAbxHistory: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            id, antibiotic_name, dose_mg, frequency_per_day,
            aul_route, aul_start_date, aul_end_date, aul_duration_days,
            is_restricted, culture_status_at_order, organism_if_known,
            susceptible_to_antibiotic, justification_text
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId} AND aul_patient_id = ${input.patient_id}::uuid
          ORDER BY aul_start_date DESC;
        `;

        const rows = (result as any) || [];
        return rows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching patient antibiotic history',
        });
      }
    }),

  // ════════════════════════════════════════════════════════════════
  // ANTIBIOTIC APPROVALS (5 endpoints)
  // ════════════════════════════════════════════════════════════════

  // 15. REQUEST APPROVAL ────────────────────────────────────────────
  requestApproval: protectedProcedure
    .input(z.object({
      aa_medication_order_id: z.string().uuid(),
      aa_antibiotic_name: z.string().min(1),
      justification_reason: abxJustificationReasonEnum,
      aa_justification_text: z.string().min(10),
      aa_culture_status: cultureStatusAtOrderEnum.default('unknown'),
      culture_result_text: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await getSql()`
          INSERT INTO antibiotic_approvals (
            hospital_id, aa_medication_order_id, aa_antibiotic_name,
            justification_reason, aa_justification_text,
            aa_culture_status, culture_result_text,
            aa_status, aa_requested_by_user_id, aa_requested_at
          )
          VALUES (
            ${hospitalId}, ${input.aa_medication_order_id}::uuid, ${input.aa_antibiotic_name},
            ${input.justification_reason}, ${input.aa_justification_text},
            ${input.aa_culture_status}, ${input.culture_result_text || null},
            'pending', ${userId}, NOW()
          )
          RETURNING id, aa_antibiotic_name, aa_status;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create approval request',
          });
        }

        return { id: rows[0].id, status: rows[0].aa_status };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error requesting antibiotic approval',
        });
      }
    }),

  // 16. LIST APPROVALS ──────────────────────────────────────────────
  listApprovals: protectedProcedure
    .input(z.object({
      aa_status: abxApprovalStatusEnum.optional(),
      date_from: z.string().datetime().optional(),
      date_to: z.string().datetime().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const offset = (input.page - 1) * input.pageSize;

        const countResult = await getSql()`
          SELECT COUNT(*) as total FROM antibiotic_approvals
          WHERE hospital_id = ${hospitalId}
            AND (${input.aa_status ?? null}::text IS NULL OR aa_status = ${input.aa_status ?? null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR aa_requested_at >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR aa_requested_at <= ${input.date_to ?? null}::timestamptz);
        `;

        const countRows = (countResult as any);
        const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

        const result = await getSql()`
          SELECT
            id, aa_antibiotic_name, justification_reason,
            aa_justification_text, aa_culture_status,
            aa_status, approval_valid_until, requires_reapproval_at,
            aa_requested_at, denial_reason, suggested_alternative
          FROM antibiotic_approvals
          WHERE hospital_id = ${hospitalId}
            AND (${input.aa_status ?? null}::text IS NULL OR aa_status = ${input.aa_status ?? null})
            AND (${input.date_from ?? null}::timestamptz IS NULL OR aa_requested_at >= ${input.date_from ?? null}::timestamptz)
            AND (${input.date_to ?? null}::timestamptz IS NULL OR aa_requested_at <= ${input.date_to ?? null}::timestamptz)
          ORDER BY aa_requested_at DESC
          LIMIT ${input.pageSize} OFFSET ${offset};
        `;

        const rows = (result as any) || [];

        return {
          data: rows,
          pagination: {
            total,
            page: input.page,
            pageSize: input.pageSize,
            totalPages: Math.ceil(total / input.pageSize),
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing approvals',
        });
      }
    }),

  // 17. APPROVE REQUEST (admin only) ────────────────────────────────
  approveRequest: adminProcedure
    .input(z.object({
      approval_id: z.string().uuid(),
      approval_valid_until: z.string().datetime().optional(),
      approval_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const validUntil = input.approval_valid_until || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const result = await getSql()`
          UPDATE antibiotic_approvals
          SET
            aa_status = 'approved',
            approval_valid_until = ${validUntil}::timestamptz,
            requires_reapproval_at = (${validUntil}::timestamptz - INTERVAL '3 days'),
            aa_approved_by_user_id = ${userId},
            aa_approved_at = NOW(),
            approval_notes = ${input.approval_notes || null}
          WHERE id = ${input.approval_id}::uuid AND hospital_id = ${hospitalId}
          RETURNING id, aa_antibiotic_name;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Approval request not found',
          });
        }

        return { id: rows[0].id, status: 'approved' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error approving request',
        });
      }
    }),

  // 18. DENY REQUEST (admin only) ──────────────────────────────────
  denyRequest: adminProcedure
    .input(z.object({
      approval_id: z.string().uuid(),
      denial_reason: z.string().min(10),
      suggested_alternative: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const result = await getSql()`
          UPDATE antibiotic_approvals
          SET
            aa_status = 'denied',
            denial_reason = ${input.denial_reason},
            suggested_alternative = ${input.suggested_alternative || null},
            aa_approved_by_user_id = ${userId},
            aa_approved_at = NOW()
          WHERE id = ${input.approval_id}::uuid AND hospital_id = ${hospitalId}
          RETURNING id, aa_antibiotic_name;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Approval request not found',
          });
        }

        return { id: rows[0].id, status: 'denied' };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error denying request',
        });
      }
    }),

  // 19. GET PENDING COUNT ───────────────────────────────────────────
  getPendingCount: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT COUNT(*) as count FROM antibiotic_approvals
          WHERE hospital_id = ${hospitalId} AND aa_status = 'pending';
        `;

        const rows = (result as any);
        const count = rows && rows.length > 0 ? parseInt(rows[0].count) : 0;
        return { pending_count: count };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error getting pending count',
        });
      }
    }),

  // ════════════════════════════════════════════════════════════════
  // ANTIBIOGRAM (3 endpoints)
  // ════════════════════════════════════════════════════════════════

  // 20. COMPUTE ANTIBIOGRAM (admin only) ────────────────────────────
  computeAntibiogram: adminProcedure
    .input(z.object({
      ag_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ag_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        // Get distinct organisms and antibiotics from usage logs
        const combosResult = await getSql()`
          SELECT DISTINCT organism_if_known, antibiotic_name
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND organism_if_known IS NOT NULL
            AND aul_start_date >= ${input.ag_period_start}::date
            AND aul_start_date <= ${input.ag_period_end}::date
            AND (susceptible_to_antibiotic IS NOT NULL);
        `;

        const combos = (combosResult as any) || [];
        let computed = 0;

        for (const combo of combos) {
          const organism = combo.organism_if_known;
          const antibiotic = combo.antibiotic_name;

          // Count susceptibility outcomes
          const suceptResult = await getSql()`
            SELECT
              COUNT(CASE WHEN susceptible_to_antibiotic = true THEN 1 END) as susceptible,
              COUNT(CASE WHEN susceptible_to_antibiotic = false THEN 1 END) as resistant,
              COUNT(*) as total
            FROM antibiotic_usage_log
            WHERE hospital_id = ${hospitalId}
              AND organism_if_known = ${organism}
              AND antibiotic_name = ${antibiotic}
              AND aul_start_date >= ${input.ag_period_start}::date
              AND aul_start_date <= ${input.ag_period_end}::date;
          `;

          const suceptRows = (suceptResult as any);
          const row = suceptRows && suceptRows.length > 0 ? suceptRows[0] : { susceptible: 0, resistant: 0, total: 0 };

          const susceptCount = parseInt(row.susceptible || 0);
          const resistCount = parseInt(row.resistant || 0);
          const total = parseInt(row.total || 1);

          const pctSuscept = (susceptCount / total) * 100;
          const pctResist = (resistCount / total) * 100;

          // Upsert antibiogram
          await getSql()`
            INSERT INTO antibiogram_results (
              hospital_id, ag_period_start, ag_period_end,
              ag_organism, ag_antibiotic,
              count_susceptible, count_resistant, count_intermediate,
              pct_susceptible, pct_resistant, pct_intermediate,
              ag_computed_at
            )
            VALUES (
              ${hospitalId}, ${input.ag_period_start}::date, ${input.ag_period_end}::date,
              ${organism}, ${antibiotic},
              ${susceptCount}, ${resistCount}, 0,
              ${pctSuscept}, ${pctResist}, 0,
              NOW()
            )
            ON CONFLICT (hospital_id, ag_organism, ag_antibiotic, ag_period_start, ag_period_end)
            DO UPDATE SET
              count_susceptible = EXCLUDED.count_susceptible,
              count_resistant = EXCLUDED.count_resistant,
              pct_susceptible = EXCLUDED.pct_susceptible,
              pct_resistant = EXCLUDED.pct_resistant,
              ag_computed_at = NOW();
          `;

          computed++;
        }

        return { computed };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error computing antibiogram',
        });
      }
    }),

  // 21. GET ANTIBIOGRAM ────────────────────────────────────────────
  getAntibiogram: protectedProcedure
    .input(z.object({
      ag_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ag_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ag_organism, ag_antibiotic,
            count_susceptible, count_resistant, count_intermediate,
            pct_susceptible, pct_resistant, pct_intermediate
          FROM antibiogram_results
          WHERE hospital_id = ${hospitalId}
            AND ag_period_start = ${input.ag_period_start}::date
            AND ag_period_end = ${input.ag_period_end}::date
          ORDER BY ag_organism, ag_antibiotic;
        `;

        const rows = (result as any) || [];
        return {
          period: {
            start: input.ag_period_start,
            end: input.ag_period_end,
          },
          matrix: rows,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching antibiogram',
        });
      }
    }),

  // 22. LIST ORGANISMS ──────────────────────────────────────────────
  listOrganisms: protectedProcedure
    .input(z.object({
      ag_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ag_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT DISTINCT ag_organism
          FROM antibiogram_results
          WHERE hospital_id = ${hospitalId}
            AND (${input.ag_period_start ?? null}::date IS NULL OR ag_period_start >= ${input.ag_period_start ?? null}::date)
            AND (${input.ag_period_end ?? null}::date IS NULL OR ag_period_end <= ${input.ag_period_end ?? null}::date)
          ORDER BY ag_organism;
        `;

        const rows = (result as any) || [];
        return rows.map((r: any) => r.ag_organism);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error listing organisms',
        });
      }
    }),

  // ════════════════════════════════════════════════════════════════
  // DASHBOARD (2 endpoints)
  // ════════════════════════════════════════════════════════════════

  // 23. INFECTION DASHBOARD ────────────────────────────────────────
  infectionDashboard: protectedProcedure
    .input(z.object({
      period_days: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Count by infection type
        const typeCountResult = await getSql()`
          SELECT infection_type, COUNT(*) as count
          FROM infection_surveillance
          WHERE hospital_id = ${hospitalId}
            AND identified_date >= NOW() - INTERVAL '1 day' * ${input.period_days}::int
          GROUP BY infection_type
          ORDER BY count DESC;
        `;

        const typeCounts = ((typeCountResult as any) || []).reduce((acc: any, row: any) => {
          acc[row.infection_type] = parseInt(row.count);
          return acc;
        }, {});

        // Top organisms
        const orgResult = await getSql()`
          SELECT organism, COUNT(*) as count
          FROM infection_surveillance
          WHERE hospital_id = ${hospitalId}
            AND identified_date >= NOW() - INTERVAL '1 day' * ${input.period_days}::int
          GROUP BY organism
          ORDER BY count DESC
          LIMIT 10;
        `;

        const topOrganisms = ((orgResult as any) || []).map((r: any) => ({
          organism: r.organism,
          count: parseInt(r.count),
        }));

        // Device-associated rate
        const deviceResult = await getSql()`
          SELECT
            COUNT(CASE WHEN device_involved IS NOT NULL THEN 1 END) as device_count,
            COUNT(*) as total
          FROM infection_surveillance
          WHERE hospital_id = ${hospitalId}
            AND identified_date >= NOW() - INTERVAL '1 day' * ${input.period_days}::int;
        `;

        const deviceRows = (deviceResult as any);
        const deviceRow = deviceRows && deviceRows.length > 0 ? deviceRows[0] : { device_count: 0, total: 0 };
        const deviceAssocPercent = parseInt(deviceRow.total) > 0 ? (parseInt(deviceRow.device_count) / parseInt(deviceRow.total)) * 100 : 0;

        return {
          period_days: input.period_days,
          counts_by_type: typeCounts,
          top_organisms: topOrganisms,
          device_associated_percent: deviceAssocPercent,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching infection dashboard',
        });
      }
    }),

  // 24. STEWARDSHIP DASHBOARD ──────────────────────────────────────
  stewardshipDashboard: protectedProcedure
    .input(z.object({
      period_days: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Restricted antibiotic usage %
        const restrictedResult = await getSql()`
          SELECT
            COUNT(CASE WHEN is_restricted = true THEN 1 END) as restricted_count,
            COUNT(*) as total
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND aul_start_date >= NOW() - INTERVAL '1 day' * ${input.period_days}::int;
        `;

        const restrictedRows = (restrictedResult as any);
        const restrictedRow = restrictedRows && restrictedRows.length > 0 ? restrictedRows[0] : { restricted_count: 0, total: 0 };
        const restrictedPercent = parseInt(restrictedRow.total) > 0 ? (parseInt(restrictedRow.restricted_count) / parseInt(restrictedRow.total)) * 100 : 0;

        // Culture-sensitivity match rate
        const matchResult = await getSql()`
          SELECT
            COUNT(CASE WHEN culture_status_at_order = 'positive' AND susceptible_to_antibiotic = true THEN 1 END) as match_count,
            COUNT(CASE WHEN culture_status_at_order = 'positive' THEN 1 END) as culture_positive
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND aul_start_date >= NOW() - INTERVAL '1 day' * ${input.period_days}::int;
        `;

        const matchRows = (matchResult as any);
        const matchRow = matchRows && matchRows.length > 0 ? matchRows[0] : { match_count: 0, culture_positive: 0 };
        const matchPercent = parseInt(matchRow.culture_positive) > 0 ? (parseInt(matchRow.match_count) / parseInt(matchRow.culture_positive)) * 100 : 0;

        // DDD trends
        const dddResult = await getSql()`
          SELECT
            COALESCE(SUM(CAST(ddd_count AS NUMERIC)), 0) as total_ddd,
            COUNT(DISTINCT aul_patient_id) as patient_count
          FROM antibiotic_usage_log
          WHERE hospital_id = ${hospitalId}
            AND aul_start_date >= NOW() - INTERVAL '1 day' * ${input.period_days}::int;
        `;

        const dddRows = (dddResult as any);
        const dddRow = dddRows && dddRows.length > 0 ? dddRows[0] : { total_ddd: 0, patient_count: 1 };
        const dddPer1000 = (parseFloat(dddRow.total_ddd) / Math.max(1, parseInt(dddRow.patient_count))) * 1000;

        // Pending approvals
        const pendingResult = await getSql()`
          SELECT COUNT(*) as count FROM antibiotic_approvals
          WHERE hospital_id = ${hospitalId} AND aa_status = 'pending';
        `;

        const pendingRows = (pendingResult as any);
        const pendingCount = pendingRows && pendingRows.length > 0 ? parseInt(pendingRows[0].count) : 0;

        return {
          period_days: input.period_days,
          restricted_antibiotic_percent: restrictedPercent,
          culture_sensitivity_match_percent: matchPercent,
          ddd_per_1000_patients: dddPer1000,
          pending_approvals_count: pendingCount,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error fetching stewardship dashboard',
        });
      }
    }),
});
