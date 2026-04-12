import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const frequencyCodeEnum = z.enum([
  'OD', 'BD', 'TDS', 'QID', 'Q4H', 'Q6H', 'Q8H', 'STAT', 'HS'
]);

const routeEnum = z.enum([
  'oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'sublingual',
  'rectal', 'ophthalmic', 'otic', 'nasal', 'transdermal'
]);

const medicationStatusEnum = z.enum(['active', 'on_hold', 'completed', 'cancelled', 'draft']);
const administrationStatusEnum = z.enum(['pending', 'completed', 'not_done', 'held']);
const serviceRequestStatusEnum = z.enum(['active', 'completed', 'cancelled', 'on_hold']);
const dietStatusEnum = z.enum(['active', 'completed', 'cancelled']);
const nursingStatusEnum = z.enum(['active', 'completed', 'cancelled']);

export const medicationOrdersRouter = router({

  // ─── 1. CREATE MEDICATION ORDER ────────────────────────────────
  createMedicationOrder: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      drug_name: z.string().min(1),
      generic_name: z.string().optional(),
      drug_code: z.string().optional(),
      dose_quantity: z.number().optional(),
      dose_unit: z.string().optional(),
      route: routeEnum.optional(),
      frequency_code: frequencyCodeEnum.optional(),
      frequency_value: z.number().optional(),
      frequency_unit: z.string().optional(),
      duration_days: z.number().int().optional(),
      max_dose_per_day: z.number().optional(),
      is_prn: z.boolean().default(false),
      prn_indication: z.string().optional(),
      is_high_alert: z.boolean().default(false),
      is_lasa: z.boolean().default(false),
      narcotics_class: z.string().optional(),
      instructions: z.string().optional(),
      substitution_allowed: z.boolean().default(true),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const cdsAlerts: any[] = [];

        // CDS Check (a): Check allergy intolerances
        const allergyCheckResult = await sql`
          SELECT id, substance, severity, criticality
          FROM allergy_intolerances
          WHERE patient_id = ${input.patient_id}::uuid
            AND hospital_id = ${hospitalId}
            AND is_deleted = false
            AND (substance ILIKE ${'%' + input.drug_name + '%'}
                 OR substance ILIKE ${'%' + (input.generic_name || '') + '%'})
          LIMIT 1;
        `;

        const allergyRows = (allergyCheckResult as any);
        let allergyMatched = false;
        if (allergyRows && allergyRows.length > 0) {
          allergyMatched = true;
          // Log CDS alert - allergy
          const alertResult = await sql`
            INSERT INTO cds_alerts (
              patient_id, encounter_id, hospital_id,
              alert_type, severity, title, description,
              related_to_table, related_to_id, created_at
            )
            VALUES (
              ${input.patient_id}::uuid,
              ${input.encounter_id || null}::uuid,
              ${hospitalId},
              'allergy',
              'critical',
              'Allergy Conflict',
              ${'Patient has allergy to ' + allergyRows[0].substance},
              'medication_requests',
              NULL,
              NOW()
            )
            RETURNING id, alert_type, severity;
          `;
          const alertRows = (alertResult as any);
          if (alertRows && alertRows.length > 0) {
            cdsAlerts.push(alertRows[0]);
          }
        }

        // CDS Check (b): Check for duplicate active medication orders
        const duplicateCheckResult = await sql`
          SELECT id
          FROM medication_requests
          WHERE patient_id = ${input.patient_id}::uuid
            AND hospital_id = ${hospitalId}
            AND drug_name = ${input.drug_name}
            AND status = 'active'
            AND is_deleted = false
          LIMIT 1;
        `;

        const dupRows = (duplicateCheckResult as any);
        if (dupRows && dupRows.length > 0) {
          // Log CDS alert - duplicate_order
          const alertResult = await sql`
            INSERT INTO cds_alerts (
              patient_id, encounter_id, hospital_id,
              alert_type, severity, title, description,
              related_to_table, related_to_id, created_at
            )
            VALUES (
              ${input.patient_id}::uuid,
              ${input.encounter_id || null}::uuid,
              ${hospitalId},
              'duplicate_order',
              'warning',
              'Duplicate Medication Order',
              ${'Patient already has active order for ' + input.drug_name},
              'medication_requests',
              ${dupRows[0].id}::uuid,
              NOW()
            )
            RETURNING id, alert_type, severity;
          `;
          const alertRows = (alertResult as any);
          if (alertRows && alertRows.length > 0) {
            cdsAlerts.push(alertRows[0]);
          }
        }

        // CDS Check (c): Log high alert if applicable
        if (input.is_high_alert) {
          const alertResult = await sql`
            INSERT INTO cds_alerts (
              patient_id, encounter_id, hospital_id,
              alert_type, severity, title, description,
              related_to_table, related_to_id, created_at
            )
            VALUES (
              ${input.patient_id}::uuid,
              ${input.encounter_id || null}::uuid,
              ${hospitalId},
              'high_alert',
              'warning',
              'High Alert Medication',
              ${'High alert medication being ordered: ' + input.drug_name},
              'medication_requests',
              NULL,
              NOW()
            )
            RETURNING id, alert_type, severity;
          `;
          const alertRows = (alertResult as any);
          if (alertRows && alertRows.length > 0) {
            cdsAlerts.push(alertRows[0]);
          }
        }

        // Create medication request
        const result = await sql`
          INSERT INTO medication_requests (
            patient_id, encounter_id, hospital_id,
            drug_name, generic_name, drug_code,
            dose_quantity, dose_unit, route,
            frequency_code, frequency_value, frequency_unit,
            duration_days, max_dose_per_day,
            is_prn, prn_indication, is_high_alert, is_lasa,
            narcotics_class, instructions, substitution_allowed,
            start_date, end_date,
            status, prescriber_id,
            version, is_deleted,
            created_at, updated_at
          )
          VALUES (
            ${input.patient_id}::uuid,
            ${input.encounter_id || null}::uuid,
            ${hospitalId},
            ${input.drug_name},
            ${input.generic_name || null},
            ${input.drug_code || null},
            ${input.dose_quantity || null},
            ${input.dose_unit || null},
            ${input.route || null},
            ${input.frequency_code || null},
            ${input.frequency_value || null},
            ${input.frequency_unit || null},
            ${input.duration_days || null},
            ${input.max_dose_per_day || null},
            ${input.is_prn},
            ${input.prn_indication || null},
            ${input.is_high_alert},
            ${input.is_lasa},
            ${input.narcotics_class || null},
            ${input.instructions || null},
            ${input.substitution_allowed},
            ${input.start_date || null},
            ${input.end_date || null},
            'active',
            ${ctx.user.sub},
            1,
            false,
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create medication order');
        }

        // Audit log
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'INSERT',
            'medication_requests',
            ${rows[0].id}::uuid,
            ${{ drug_name: input.drug_name, route: input.route, frequency_code: input.frequency_code }},
            '0.0.0.0',
            NOW()
          );
        `;

        return {
          id: rows[0].id,
          cds_alerts: cdsAlerts,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create medication order: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 2. UPDATE MEDICATION ORDER ────────────────────────────────
  updateMedicationOrder: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: medicationStatusEnum.optional(),
      cancel_reason: z.string().optional(),
      dose_quantity: z.number().optional(),
      dose_unit: z.string().optional(),
      route: routeEnum.optional(),
      frequency_code: frequencyCodeEnum.optional(),
      instructions: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Fetch current order to check status and enable event sourcing
        const fetchResult = await sql`
          SELECT * FROM medication_requests
          WHERE id = ${input.id}::uuid
            AND hospital_id = ${hospitalId}
            AND is_deleted = false
          LIMIT 1;
        `;

        const rows = (fetchResult as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Medication order not found' });
        }

        const current = rows[0];

        // Validate status transitions
        if (input.status && current.status !== 'draft' && current.status !== 'active') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot update order with status '${current.status}'`,
          });
        }

        // Create new version (event sourcing)
        const updateResult = await sql`
          INSERT INTO medication_requests (
            patient_id, encounter_id, hospital_id,
            drug_name, generic_name, drug_code,
            dose_quantity, dose_unit, route,
            frequency_code, frequency_value, frequency_unit,
            duration_days, max_dose_per_day,
            is_prn, prn_indication, is_high_alert, is_lasa,
            narcotics_class, instructions, substitution_allowed,
            start_date, end_date,
            status, prescriber_id, cancel_reason,
            version, previous_version_id, is_deleted,
            created_at, updated_at
          )
          VALUES (
            ${current.patient_id},
            ${current.encounter_id},
            ${hospitalId},
            ${current.drug_name},
            ${current.generic_name},
            ${current.drug_code},
            ${input.dose_quantity !== undefined ? input.dose_quantity : current.dose_quantity},
            ${input.dose_unit !== undefined ? input.dose_unit : current.dose_unit},
            ${input.route !== undefined ? input.route : current.route},
            ${input.frequency_code !== undefined ? input.frequency_code : current.frequency_code},
            ${current.frequency_value},
            ${current.frequency_unit},
            ${current.duration_days},
            ${current.max_dose_per_day},
            ${current.is_prn},
            ${current.prn_indication},
            ${current.is_high_alert},
            ${current.is_lasa},
            ${current.narcotics_class},
            ${input.instructions !== undefined ? input.instructions : current.instructions},
            ${current.substitution_allowed},
            ${current.start_date},
            ${current.end_date},
            ${input.status || current.status},
            ${current.prescriber_id},
            ${input.cancel_reason || null},
            ${current.version + 1},
            ${input.id}::uuid,
            false,
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const updateRows = (updateResult as any);
        if (!updateRows || updateRows.length === 0) {
          throw new Error('Failed to update medication order');
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'UPDATE',
            'medication_requests',
            ${input.id}::uuid,
            ${ { status: input.status, cancel_reason: input.cancel_reason, dose_quantity: input.dose_quantity } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { success: true, id: input.id };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update medication order: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 3. LIST MEDICATION ORDERS ────────────────────────────────
  listMedicationOrders: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      status: medicationStatusEnum.optional(),
      include_completed: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const encounterFilter = input.encounter_id
          ? sql`AND mr.encounter_id = ${input.encounter_id}::uuid`
          : sql``;

        const statusFilter = input.status
          ? sql`AND mr.status = ${input.status}`
          : input.include_completed
            ? sql``
            : sql`AND mr.status NOT IN ('completed', 'cancelled')`;

        const result = await sql`
          SELECT
            mr.id, mr.patient_id, mr.encounter_id,
            mr.drug_name, mr.generic_name, mr.drug_code,
            mr.dose_quantity, mr.dose_unit, mr.route,
            mr.frequency_code, mr.frequency_value, mr.frequency_unit,
            mr.duration_days, mr.max_dose_per_day,
            mr.is_prn, mr.prn_indication, mr.is_high_alert, mr.is_lasa,
            mr.narcotics_class, mr.instructions, mr.substitution_allowed,
            mr.start_date, mr.end_date, mr.status,
            mr.created_at, mr.updated_at,
            u.name_full as prescriber_name
          FROM medication_requests mr
          LEFT JOIN users u ON mr.prescriber_id = u.sub
          WHERE mr.patient_id = ${input.patient_id}::uuid
            AND mr.hospital_id = ${hospitalId}
            AND mr.is_deleted = false
            ${encounterFilter}
            ${statusFilter}
          ORDER BY mr.created_at DESC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list medication orders: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 4. GET MEDICATION ORDER DETAIL ────────────────────────────
  getDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            mr.id, mr.patient_id, mr.encounter_id,
            mr.drug_name, mr.generic_name, mr.drug_code,
            mr.dose_quantity, mr.dose_unit, mr.route,
            mr.frequency_code, mr.frequency_value, mr.frequency_unit,
            mr.duration_days, mr.max_dose_per_day,
            mr.is_prn, mr.prn_indication, mr.is_high_alert, mr.is_lasa,
            mr.narcotics_class, mr.instructions, mr.substitution_allowed,
            mr.start_date, mr.end_date, mr.status,
            mr.created_at, mr.updated_at, mr.version,
            u.name_full as prescriber_name, u.sub as prescriber_id
          FROM medication_requests mr
          LEFT JOIN users u ON mr.prescriber_id = u.sub
          WHERE mr.id = ${input.id}::uuid
            AND mr.hospital_id = ${hospitalId}
            AND mr.is_deleted = false
          LIMIT 1;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Medication order not found' });
        }

        const order = rows[0];

        // Fetch linked CDS alerts
        const alertsResult = await sql`
          SELECT id, alert_type, severity, title, description
          FROM cds_alerts
          WHERE patient_id = ${order.patient_id}
            AND related_to_id = ${input.id}::uuid
            AND hospital_id = ${hospitalId}
          ORDER BY created_at DESC;
        `;

        const alerts = ((alertsResult as any) || []);

        return {
          ...order,
          cds_alerts: alerts,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get medication order detail: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 5. LIST ADMINISTRATIONS ────────────────────────────────────
  listAdministrations: protectedProcedure
    .input(z.object({ medication_request_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          SELECT
            id, medication_request_id, patient_id,
            scheduled_datetime, administered_datetime,
            dose_given, dose_unit, route,
            patient_barcode_scanned, medication_barcode_scanned,
            manual_entry, witness_id, dose_confirmed,
            prn_indication_given, not_done_reason, hold_reason,
            administration_site, notes, status,
            created_at, updated_at
          FROM medication_administrations
          WHERE medication_request_id = ${input.medication_request_id}::uuid
            AND hospital_id = ${hospitalId}
          ORDER BY scheduled_datetime ASC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list administrations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 6. RECORD ADMINISTRATION ──────────────────────────────────
  recordAdministration: protectedProcedure
    .input(z.object({
      medication_request_id: z.string().uuid(),
      scheduled_datetime: z.string().datetime(),
      administered_datetime: z.string().datetime().optional(),
      dose_given: z.number().optional(),
      dose_unit: z.string().optional(),
      route: routeEnum.optional(),
      patient_barcode_scanned: z.boolean().optional(),
      medication_barcode_scanned: z.boolean().optional(),
      manual_entry: z.boolean().default(false),
      witness_id: z.string().optional(),
      dose_confirmed: z.boolean().default(false),
      prn_indication_given: z.string().optional(),
      not_done_reason: z.string().optional(),
      hold_reason: z.string().optional(),
      administration_site: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get patient_id and encounter_id from medication_request
        const mrResult = await sql`
          SELECT patient_id, encounter_id
          FROM medication_requests
          WHERE id = ${input.medication_request_id}::uuid
            AND hospital_id = ${hospitalId}
          LIMIT 1;
        `;

        const mrRows = (mrResult as any);
        if (!mrRows || mrRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Medication request not found' });
        }

        const { patient_id, encounter_id } = mrRows[0];

        // Determine status
        let status: 'pending' | 'completed' | 'not_done' | 'held' = 'pending';
        if (input.not_done_reason) status = 'not_done';
        else if (input.hold_reason) status = 'held';
        else if (input.administered_datetime) status = 'completed';

        const result = await sql`
          INSERT INTO medication_administrations (
            medication_request_id, patient_id, encounter_id, hospital_id,
            scheduled_datetime, administered_datetime,
            dose_given, dose_unit, route,
            patient_barcode_scanned, medication_barcode_scanned,
            manual_entry, witness_id, dose_confirmed,
            prn_indication_given, not_done_reason, hold_reason,
            administration_site, notes, status,
            recorded_by,
            created_at, updated_at
          )
          VALUES (
            ${input.medication_request_id}::uuid,
            ${patient_id}::uuid,
            ${encounter_id}::uuid,
            ${hospitalId},
            ${input.scheduled_datetime},
            ${input.administered_datetime || null},
            ${input.dose_given || null},
            ${input.dose_unit || null},
            ${input.route || null},
            ${input.patient_barcode_scanned || false},
            ${input.medication_barcode_scanned || false},
            ${input.manual_entry},
            ${input.witness_id || null},
            ${input.dose_confirmed},
            ${input.prn_indication_given || null},
            ${input.not_done_reason || null},
            ${input.hold_reason || null},
            ${input.administration_site || null},
            ${input.notes || null},
            ${status},
            ${ctx.user.sub},
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to record administration');
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'INSERT',
            'medication_administrations',
            ${rows[0].id}::uuid,
            ${ { status, administered_datetime: input.administered_datetime } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { id: rows[0].id };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to record administration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 7. GENERATE SCHEDULE ────────────────────────────────────────
  generateSchedule: protectedProcedure
    .input(z.object({ medication_request_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get medication request details
        const mrResult = await sql`
          SELECT
            patient_id, encounter_id,
            frequency_code, start_date, duration_days, is_prn
          FROM medication_requests
          WHERE id = ${input.medication_request_id}::uuid
            AND hospital_id = ${hospitalId}
          LIMIT 1;
        `;

        const mrRows = (mrResult as any);
        if (!mrRows || mrRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Medication request not found' });
        }

        const mr = mrRows[0];

        // Skip if PRN
        if (mr.is_prn) {
          return { count: 0 };
        }

        const startDate = new Date(mr.start_date || new Date());
        const durationDays = mr.duration_days || 7;
        const freqCode = mr.frequency_code || 'OD';

        // Generate datetime slots based on frequency
        const slots: Date[] = [];

        for (let day = 0; day < durationDays; day++) {
          const baseDate = new Date(startDate);
          baseDate.setDate(baseDate.getDate() + day);

          switch (freqCode) {
            case 'OD':
              baseDate.setHours(8, 0, 0, 0);
              slots.push(new Date(baseDate));
              break;
            case 'BD':
              baseDate.setHours(8, 0, 0, 0);
              slots.push(new Date(baseDate));
              baseDate.setHours(20, 0, 0, 0);
              slots.push(new Date(baseDate));
              break;
            case 'TDS':
              baseDate.setHours(8, 0, 0, 0);
              slots.push(new Date(baseDate));
              baseDate.setHours(14, 0, 0, 0);
              slots.push(new Date(baseDate));
              baseDate.setHours(20, 0, 0, 0);
              slots.push(new Date(baseDate));
              break;
            case 'QID':
              baseDate.setHours(6, 0, 0, 0);
              slots.push(new Date(baseDate));
              baseDate.setHours(12, 0, 0, 0);
              slots.push(new Date(baseDate));
              baseDate.setHours(18, 0, 0, 0);
              slots.push(new Date(baseDate));
              baseDate.setHours(24, 0, 0, 0);
              slots.push(new Date(baseDate));
              break;
            case 'Q4H':
              for (let hour = 0; hour < 24; hour += 4) {
                baseDate.setHours(hour, 0, 0, 0);
                slots.push(new Date(baseDate));
              }
              break;
            case 'Q6H':
              for (let hour = 0; hour < 24; hour += 6) {
                baseDate.setHours(hour, 0, 0, 0);
                slots.push(new Date(baseDate));
              }
              break;
            case 'Q8H':
              for (let hour = 0; hour < 24; hour += 8) {
                baseDate.setHours(hour, 0, 0, 0);
                slots.push(new Date(baseDate));
              }
              break;
            case 'STAT':
              // Single dose at start_date
              slots.push(new Date(startDate));
              day = durationDays; // Exit loop
              break;
            case 'HS':
              baseDate.setHours(22, 0, 0, 0);
              slots.push(new Date(baseDate));
              break;
            default:
              baseDate.setHours(8, 0, 0, 0);
              slots.push(new Date(baseDate));
          }
        }

        // Insert medication_administrations
        let count = 0;
        for (const slot of slots) {
          try {
            await sql`
              INSERT INTO medication_administrations (
                medication_request_id, patient_id, encounter_id, hospital_id,
                scheduled_datetime, status,
                created_at, updated_at
              )
              VALUES (
                ${input.medication_request_id}::uuid,
                ${mr.patient_id}::uuid,
                ${mr.encounter_id}::uuid,
                ${hospitalId},
                ${slot.toISOString()},
                'pending',
                NOW(),
                NOW()
              );
            `;
            count++;
          } catch (e) {
            // Skip duplicates, continue
          }
        }

        return { count };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to generate schedule: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 8. MEDICATION STATS ──────────────────────────────────────
  medicationStats: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      encounter_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const patientFilter = input.patient_id
          ? sql`AND mr.patient_id = ${input.patient_id}::uuid`
          : sql``;
        const encounterFilter = input.encounter_id
          ? sql`AND mr.encounter_id = ${input.encounter_id}::uuid`
          : sql``;

        // Count active medications
        const activeResult = await sql`
          SELECT COUNT(*) as count
          FROM medication_requests mr
          WHERE mr.hospital_id = ${hospitalId}
            AND mr.status = 'active'
            AND mr.is_deleted = false
            ${patientFilter}
            ${encounterFilter};
        `;

        const activeRows = (activeResult as any);
        const totalActive = parseInt(activeRows[0]?.count || 0, 10);

        // Count pending administrations
        const pendingResult = await sql`
          SELECT COUNT(*) as count
          FROM medication_administrations ma
          JOIN medication_requests mr ON ma.medication_request_id = mr.id
          WHERE ma.hospital_id = ${hospitalId}
            AND ma.status = 'pending'
            ${patientFilter}
            ${encounterFilter};
        `;

        const pendingRows = (pendingResult as any);
        const totalPendingAdmin = parseInt(pendingRows[0]?.count || 0, 10);

        // Count overdue
        const overdueResult = await sql`
          SELECT COUNT(*) as count
          FROM medication_administrations ma
          JOIN medication_requests mr ON ma.medication_request_id = mr.id
          WHERE ma.hospital_id = ${hospitalId}
            AND ma.status = 'pending'
            AND ma.scheduled_datetime < NOW()
            ${patientFilter}
            ${encounterFilter};
        `;

        const overdueRows = (overdueResult as any);
        const overdueCount = parseInt(overdueRows[0]?.count || 0, 10);

        // Count high alert
        const highAlertResult = await sql`
          SELECT COUNT(*) as count
          FROM medication_requests mr
          WHERE mr.hospital_id = ${hospitalId}
            AND mr.is_high_alert = true
            AND mr.status = 'active'
            AND mr.is_deleted = false
            ${patientFilter}
            ${encounterFilter};
        `;

        const highAlertRows = (highAlertResult as any);
        const highAlertCount = parseInt(highAlertRows[0]?.count || 0, 10);

        // Count narcotics
        const narcoticsResult = await sql`
          SELECT COUNT(*) as count
          FROM medication_requests mr
          WHERE mr.hospital_id = ${hospitalId}
            AND mr.narcotics_class IS NOT NULL
            AND mr.status = 'active'
            AND mr.is_deleted = false
            ${patientFilter}
            ${encounterFilter};
        `;

        const narcoticsRows = (narcoticsResult as any);
        const narcoticsCount = parseInt(narcoticsRows[0]?.count || 0, 10);

        return {
          total_active: totalActive,
          total_pending_admin: totalPendingAdmin,
          overdue_count: overdueCount,
          high_alert_count: highAlertCount,
          narcotics_count: narcoticsCount,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get medication stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 9. CREATE SERVICE REQUEST ────────────────────────────────
  createServiceRequest: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      request_type: z.enum(['lab', 'imaging', 'referral', 'consult']),
      order_name: z.string().min(1),
      order_code: z.string().optional(),
      clinical_indication: z.string().optional(),
      instructions: z.string().optional(),
      priority: z.enum(['routine', 'urgent', 'stat']).default('routine'),
      test_code: z.string().optional(),
      specimen_type: z.string().optional(),
      fasting_required: z.boolean().optional(),
      modality: z.string().optional(),
      body_part: z.string().optional(),
      contrast_required: z.boolean().optional(),
      pregnancy_check: z.boolean().optional(),
      renal_function_check: z.boolean().optional(),
      referral_to_department: z.string().optional(),
      referral_to_provider_id: z.string().uuid().optional(),
      referral_reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          INSERT INTO service_requests (
            patient_id, encounter_id, hospital_id,
            request_type, order_name, order_code,
            clinical_indication, instructions, priority,
            test_code, specimen_type, fasting_required,
            modality, body_part, contrast_required,
            pregnancy_check, renal_function_check,
            referral_to_department, referral_to_provider_id, referral_reason,
            status, requester_id,
            sr_ordered_at, created_at, updated_at
          )
          VALUES (
            ${input.patient_id}::uuid,
            ${input.encounter_id || null}::uuid,
            ${hospitalId},
            ${input.request_type},
            ${input.order_name},
            ${input.order_code || null},
            ${input.clinical_indication || null},
            ${input.instructions || null},
            ${input.priority},
            ${input.test_code || null},
            ${input.specimen_type || null},
            ${input.fasting_required || false},
            ${input.modality || null},
            ${input.body_part || null},
            ${input.contrast_required || false},
            ${input.pregnancy_check || false},
            ${input.renal_function_check || false},
            ${input.referral_to_department || null},
            ${input.referral_to_provider_id || null}::uuid,
            ${input.referral_reason || null},
            'active',
            ${ctx.user.sub},
            NOW(),
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create service request');
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'INSERT',
            'service_requests',
            ${rows[0].id}::uuid,
            ${ { request_type: input.request_type, order_name: input.order_name } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { id: rows[0].id };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create service request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 10. LIST SERVICE REQUESTS ─────────────────────────────────
  listServiceRequests: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      request_type: z.enum(['lab', 'imaging', 'referral', 'consult']).optional(),
      status: serviceRequestStatusEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const encounterFilter = input.encounter_id
          ? sql`AND sr.encounter_id = ${input.encounter_id}::uuid`
          : sql``;

        const typeFilter = input.request_type
          ? sql`AND sr.request_type = ${input.request_type}`
          : sql``;

        const statusFilter = input.status
          ? sql`AND sr.status = ${input.status}`
          : sql``;

        const result = await sql`
          SELECT
            sr.id, sr.patient_id, sr.encounter_id,
            sr.request_type, sr.order_name, sr.order_code,
            sr.clinical_indication, sr.instructions, sr.priority,
            sr.status, sr.sr_ordered_at, sr.created_at,
            u.name_full as requester_name
          FROM service_requests sr
          LEFT JOIN users u ON sr.requester_id = u.sub
          WHERE sr.patient_id = ${input.patient_id}::uuid
            AND sr.hospital_id = ${hospitalId}
            ${encounterFilter}
            ${typeFilter}
            ${statusFilter}
          ORDER BY sr.sr_ordered_at DESC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list service requests: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 11. ADD RESULT ────────────────────────────────────────────
  addResult: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      result_value: z.string().optional(),
      result_json: z.any().optional(),
      reference_range: z.string().optional(),
      is_critical: z.boolean().default(false),
      result_status: z.enum(['preliminary', 'final', 'corrected']),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Update service request with results
        const result = await sql`
          UPDATE service_requests
          SET
            result_value = ${input.result_value || null},
            result_json = ${input.result_json || null},
            reference_range = ${input.reference_range || null},
            result_status = ${input.result_status},
            reported_by = ${ctx.user.sub},
            result_datetime = NOW(),
            updated_at = NOW()
          WHERE id = ${input.id}::uuid
            AND hospital_id = ${hospitalId}
          RETURNING patient_id, encounter_id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Service request not found' });
        }

        const { patient_id, encounter_id } = rows[0];

        // If critical, create clinical alert
        if (input.is_critical) {
          await sql`
            INSERT INTO clinical_alert_logs (
              patient_id, encounter_id, hospital_id,
              alert_type, severity, title, description,
              acknowledged, created_at
            )
            VALUES (
              ${patient_id}::uuid,
              ${encounter_id}::uuid,
              ${hospitalId},
              'critical_result',
              'critical',
              'Critical Lab Result',
              ${'Critical result reported for service request'},
              false,
              NOW()
            );
          `;
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'UPDATE',
            'service_requests',
            ${input.id}::uuid,
            ${ { result_status: input.result_status, is_critical: input.is_critical } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add result: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 12. CREATE DIET ORDER ────────────────────────────────────
  createDietOrder: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      diet_type: z.string().min(1),
      custom_description: z.string().optional(),
      restrictions: z.string().optional(),
      supplements: z.string().optional(),
      calorie_target: z.number().optional(),
      fluid_restriction_ml: z.number().optional(),
      start_date: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          INSERT INTO diet_orders (
            patient_id, encounter_id, hospital_id,
            diet_type, custom_description, restrictions,
            supplements, calorie_target, fluid_restriction_ml,
            diet_start_date, status, ordered_by,
            created_at, updated_at
          )
          VALUES (
            ${input.patient_id}::uuid,
            ${input.encounter_id || null}::uuid,
            ${hospitalId},
            ${input.diet_type},
            ${input.custom_description || null},
            ${input.restrictions || null},
            ${input.supplements || null},
            ${input.calorie_target || null},
            ${input.fluid_restriction_ml || null},
            ${input.start_date},
            'active',
            ${ctx.user.sub},
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create diet order');
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'INSERT',
            'diet_orders',
            ${rows[0].id}::uuid,
            ${ { diet_type: input.diet_type } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { id: rows[0].id };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create diet order: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 13. LIST DIET ORDERS ────────────────────────────────────
  listDietOrders: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      status: dietStatusEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const encounterFilter = input.encounter_id
          ? sql`AND do.encounter_id = ${input.encounter_id}::uuid`
          : sql``;

        const statusFilter = input.status
          ? sql`AND do.status = ${input.status}`
          : sql``;

        const result = await sql`
          SELECT
            id, patient_id, encounter_id,
            diet_type, custom_description, restrictions,
            supplements, calorie_target, fluid_restriction_ml,
            diet_start_date, status, created_at
          FROM diet_orders
          WHERE patient_id = ${input.patient_id}::uuid
            AND hospital_id = ${hospitalId}
            ${encounterFilter}
            ${statusFilter}
          ORDER BY diet_start_date DESC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list diet orders: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 14. CREATE NURSING ORDER ────────────────────────────────
  createNursingOrder: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      task_type: z.string().min(1),
      description: z.string().min(1),
      frequency_code: frequencyCodeEnum.optional(),
      instructions: z.string().optional(),
      start_date: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await sql`
          INSERT INTO nursing_orders (
            patient_id, encounter_id, hospital_id,
            task_type, description, frequency_code,
            instructions, nursing_start_date,
            status, ordered_by,
            created_at, updated_at
          )
          VALUES (
            ${input.patient_id}::uuid,
            ${input.encounter_id || null}::uuid,
            ${hospitalId},
            ${input.task_type},
            ${input.description},
            ${input.frequency_code || null},
            ${input.instructions || null},
            ${input.start_date},
            'active',
            ${ctx.user.sub},
            NOW(),
            NOW()
          )
          RETURNING id;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new Error('Failed to create nursing order');
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'INSERT',
            'nursing_orders',
            ${rows[0].id}::uuid,
            ${ { task_type: input.task_type } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { id: rows[0].id };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create nursing order: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 15. COMPLETE NURSING TASK ────────────────────────────────
  completeNursingTask: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Fetch current order to get completion_log
        const fetchResult = await sql`
          SELECT completion_log, completion_count
          FROM nursing_orders
          WHERE id = ${input.id}::uuid
            AND hospital_id = ${hospitalId}
          LIMIT 1;
        `;

        const rows = (fetchResult as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Nursing order not found' });
        }

        const current = rows[0];
        const completionLog = (current.completion_log || []) as any[];
        completionLog.push({
          completed_at: new Date().toISOString(),
          completed_by: ctx.user.sub,
          notes: input.notes || null,
        });

        // Update nursing order
        const result = await sql`
          UPDATE nursing_orders
          SET
            last_completed_at = NOW(),
            completion_count = ${(current.completion_count || 0) + 1},
            completion_log = ${JSON.stringify(completionLog)},
            updated_at = NOW()
          WHERE id = ${input.id}::uuid
            AND hospital_id = ${hospitalId}
          RETURNING id;
        `;

        const updateRows = (result as any);
        if (!updateRows || updateRows.length === 0) {
          throw new Error('Failed to complete nursing task');
        }

        // Audit
        await sql`
          INSERT INTO audit_logs (
            hospital_id, user_id, action, table_name, row_id,
            new_values, ip_address, created_at
          )
          VALUES (
            ${hospitalId},
            ${ctx.user.sub},
            'UPDATE',
            'nursing_orders',
            ${input.id}::uuid,
            ${ { last_completed_at: new Date() } },
            '0.0.0.0',
            NOW()
          );
        `;

        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to complete nursing task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── 16. LIST NURSING ORDERS ──────────────────────────────────
  listNursingOrders: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      status: nursingStatusEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const encounterFilter = input.encounter_id
          ? sql`AND no.encounter_id = ${input.encounter_id}::uuid`
          : sql``;

        const statusFilter = input.status
          ? sql`AND no.status = ${input.status}`
          : sql``;

        const result = await sql`
          SELECT
            id, patient_id, encounter_id,
            task_type, description, frequency_code,
            instructions, nursing_start_date,
            status, last_completed_at, completion_count,
            created_at
          FROM nursing_orders
          WHERE patient_id = ${input.patient_id}::uuid
            AND hospital_id = ${hospitalId}
            ${encounterFilter}
            ${statusFilter}
          ORDER BY nursing_start_date DESC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list nursing orders: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

});
