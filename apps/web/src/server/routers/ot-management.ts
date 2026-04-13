import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ─── ENUMS ──────────────────────────────────────────────────────────
const otRoomStatusEnum = z.enum(['available', 'occupied', 'cleaning', 'maintenance', 'reserved']);
const otScheduleStatusEnum = z.enum(['requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'postponed']);
const otPriorityEnum = z.enum(['emergency', 'urgent', 'elective']);
const otChecklistPhaseEnum = z.enum(['sign_in', 'time_out', 'sign_out']);
const anesthesiaTypeEnum = z.enum(['general', 'spinal', 'epidural', 'regional_block', 'local', 'sedation', 'combined']);
const asaClassEnum = z.enum(['I', 'II', 'III', 'IV', 'V', 'VI']);
const recoveryStatusEnum = z.enum(['in_ot', 'in_pacu', 'stable', 'discharged_to_ward', 'icu_transfer', 'complication']);
const equipmentActionEnum = z.enum(['checked_out', 'returned', 'malfunction', 'maintenance']);
const equipmentConditionEnum = z.enum(['good', 'needs_repair', 'out_of_service']);

export const otManagementRouter = router({

  // ═══════════════════════════════════════════════════════════════════
  // OT ROOMS
  // ═══════════════════════════════════════════════════════════════════

  listRooms: protectedProcedure
    .input(z.object({
      status: otRoomStatusEnum.optional(),
      room_type: z.string().optional(),
      is_active: z.boolean().optional(),
      limit: z.number().int().max(500).default(50),
      offset: z.number().int().default(0),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          id,
          room_name,
          room_number,
          ot_room_type,
          ot_floor,
          otr_status,
          ot_equipment,
          ot_specialties,
          otr_is_active,
          otr_created_at,
          otr_updated_at
        FROM ot_rooms
        WHERE hospital_id = ${hospitalId}
          ${input?.status ? `AND otr_status = ${input.status}` : ''}
          ${input?.room_type ? `AND ot_room_type = ${input.room_type}` : ''}
          ${input?.is_active !== undefined ? `AND otr_is_active = ${input.is_active}` : ''}
        ORDER BY room_number ASC
        LIMIT ${input?.limit || 50} OFFSET ${input?.offset || 0}
      `;

      const rows = (result as any);
      return {
        rooms: rows || [],
        count: rows?.length || 0,
      };
    }),

  getRoom: protectedProcedure
    .input(z.object({ room_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          id,
          room_name,
          room_number,
          ot_room_type,
          ot_floor,
          otr_status,
          ot_equipment,
          ot_specialties,
          otr_is_active,
          otr_created_at,
          otr_updated_at
        FROM ot_rooms
        WHERE id = ${input.room_id}::uuid
          AND hospital_id = ${hospitalId}
        LIMIT 1
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'OT room not found' });
      }
      return rows[0];
    }),

  createRoom: adminProcedure
    .input(z.object({
      room_name: z.string().max(50),
      room_number: z.string().max(20),
      room_type: z.string().max(30),
      floor: z.string().max(10),
      equipment: z.record(z.any()).optional(),
      specialties: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        INSERT INTO ot_rooms (
          hospital_id, room_name, room_number, ot_room_type, ot_floor,
          otr_status, ot_equipment, ot_specialties, otr_is_active,
          otr_created_at, otr_updated_at
        )
        VALUES (
          ${hospitalId},
          ${input.room_name},
          ${input.room_number},
          ${input.room_type},
          ${input.floor},
          'available',
          ${JSON.stringify(input.equipment || {})},
          ${JSON.stringify(input.specialties || [])},
          true,
          NOW(),
          NOW()
        )
        RETURNING id, room_name, room_number
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create room' });
      }
      return rows[0];
    }),

  updateRoom: adminProcedure
    .input(z.object({
      room_id: z.string().uuid(),
      room_name: z.string().max(50).optional(),
      room_type: z.string().max(30).optional(),
      floor: z.string().max(10).optional(),
      status: otRoomStatusEnum.optional(),
      equipment: z.record(z.any()).optional(),
      specialties: z.array(z.string()).optional(),
      is_active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify room exists
      const checkResult = await getSql()`
        SELECT id FROM ot_rooms
        WHERE id = ${input.room_id}::uuid AND hospital_id = ${hospitalId}
        LIMIT 1
      `;
      const rows = (checkResult as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'OT room not found' });
      }

      const updateParts: string[] = [];
      const params: any[] = [];

      if (input.room_name !== undefined) {
        updateParts.push(`room_name = $${params.length + 1}`);
        params.push(input.room_name);
      }
      if (input.room_type !== undefined) {
        updateParts.push(`ot_room_type = $${params.length + 1}`);
        params.push(input.room_type);
      }
      if (input.floor !== undefined) {
        updateParts.push(`ot_floor = $${params.length + 1}`);
        params.push(input.floor);
      }
      if (input.status !== undefined) {
        updateParts.push(`otr_status = $${params.length + 1}`);
        params.push(input.status);
      }
      if (input.equipment !== undefined) {
        updateParts.push(`ot_equipment = $${params.length + 1}`);
        params.push(JSON.stringify(input.equipment));
      }
      if (input.specialties !== undefined) {
        updateParts.push(`ot_specialties = $${params.length + 1}`);
        params.push(JSON.stringify(input.specialties));
      }
      if (input.is_active !== undefined) {
        updateParts.push(`otr_is_active = $${params.length + 1}`);
        params.push(input.is_active);
      }

      updateParts.push(`otr_updated_at = NOW()`);

      const updateResult = await getSql()`
        UPDATE ot_rooms
        SET ${updateParts.join(', ')}
        WHERE id = ${input.room_id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, room_name, otr_status
      `;

      const updatedRows = (updateResult as any);
      if (!updatedRows || updatedRows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update room' });
      }
      return updatedRows[0];
    }),

  roomUtilization: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          r.id,
          r.room_name,
          r.room_number,
          COUNT(s.id)::int as cases_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (t.cleaning_end - t.cleaning_start))/60)::numeric, 1)::float as avg_turnover_minutes,
          ROUND((COUNT(s.id)::numeric / (SELECT COUNT(*) FROM ot_schedule os WHERE os.hospital_id = ${hospitalId}) * 100)::numeric, 1)::float as utilization_percent
        FROM ot_rooms r
        LEFT JOIN ot_schedule s ON r.id = s.ots_room_id AND s.hospital_id = ${hospitalId}
        LEFT JOIN ot_turnover_log t ON r.id = t.otl_room_id AND t.hospital_id = ${hospitalId}
        WHERE r.hospital_id = ${hospitalId}
          ${input?.date_from ? `AND DATE(s.scheduled_date) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(s.scheduled_date) <= ${input.date_to}::date` : ''}
        GROUP BY r.id, r.room_name, r.room_number
        ORDER BY cases_count DESC
      `;

      const rows = (result as any);
      return { utilization: rows || [] };
    }),

  // ═══════════════════════════════════════════════════════════════════
  // OT SCHEDULE
  // ═══════════════════════════════════════════════════════════════════

  listSchedule: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      room_id: z.string().uuid().optional(),
      surgeon_id: z.string().uuid().optional(),
      status: otScheduleStatusEnum.optional(),
      priority: otPriorityEnum.optional(),
      limit: z.number().int().max(500).default(50),
      offset: z.number().int().default(0),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          s.id,
          s.schedule_number,
          s.ots_patient_id,
          s.ots_encounter_id,
          s.ots_room_id,
          s.ots_status,
          s.ots_procedure_name,
          s.ots_procedure_code,
          s.ots_laterality,
          s.estimated_duration_min,
          s.actual_duration_min,
          s.primary_surgeon,
          s.scheduled_date,
          s.scheduled_start,
          s.scheduled_end,
          s.ots_priority,
          p.name_full as patient_name,
          p.uhid,
          r.room_name,
          ps.name_full as surgeon_name
        FROM ot_schedule s
        LEFT JOIN patients p ON s.ots_patient_id = p.id
        LEFT JOIN ot_rooms r ON s.ots_room_id = r.id
        LEFT JOIN users ps ON s.primary_surgeon = ps.id
        WHERE s.hospital_id = ${hospitalId}
          ${input?.date_from ? `AND DATE(s.scheduled_date) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(s.scheduled_date) <= ${input.date_to}::date` : ''}
          ${input?.room_id ? `AND s.ots_room_id = ${input.room_id}::uuid` : ''}
          ${input?.surgeon_id ? `AND s.primary_surgeon = ${input.surgeon_id}::uuid` : ''}
          ${input?.status ? `AND s.ots_status = ${input.status}` : ''}
          ${input?.priority ? `AND s.ots_priority = ${input.priority}` : ''}
        ORDER BY s.scheduled_date DESC, s.scheduled_start ASC
        LIMIT ${input?.limit || 50} OFFSET ${input?.offset || 0}
      `;

      const rows = (result as any);
      return { schedule: rows || [], count: rows?.length || 0 };
    }),

  getSchedule: protectedProcedure
    .input(z.object({ schedule_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          s.id,
          s.schedule_number,
          s.ots_patient_id,
          s.ots_encounter_id,
          s.ots_room_id,
          s.ots_status,
          s.ots_procedure_name,
          s.ots_procedure_code,
          s.ots_laterality,
          s.estimated_duration_min,
          s.actual_duration_min,
          s.primary_surgeon,
          s.assistant_surgeon,
          s.ots_anesthetist,
          s.scrub_nurse,
          s.circulating_nurse,
          s.scheduled_date,
          s.scheduled_start,
          s.scheduled_end,
          s.ots_actual_start,
          s.ots_actual_end,
          s.wheels_in,
          s.wheels_out,
          s.consent_obtained,
          s.site_marked,
          s.blood_arranged,
          s.special_equipment,
          s.pre_op_diagnosis,
          s.post_op_diagnosis,
          s.ots_priority,
          s.ots_notes,
          s.ots_created_at,
          s.ots_updated_at,
          p.name_full as patient_name,
          p.uhid,
          r.room_name,
          ps.name_full as surgeon_name,
          us.name_full as assistant_name,
          ua.name_full as anesthetist_name,
          usn.name_full as scrub_nurse_name,
          ucn.name_full as circulating_nurse_name
        FROM ot_schedule s
        LEFT JOIN patients p ON s.ots_patient_id = p.id
        LEFT JOIN ot_rooms r ON s.ots_room_id = r.id
        LEFT JOIN users ps ON s.primary_surgeon = ps.id
        LEFT JOIN users us ON s.assistant_surgeon = us.id
        LEFT JOIN users ua ON s.ots_anesthetist = ua.id
        LEFT JOIN users usn ON s.scrub_nurse = usn.id
        LEFT JOIN users ucn ON s.circulating_nurse = ucn.id
        WHERE s.id = ${input.schedule_id}::uuid
          AND s.hospital_id = ${hospitalId}
        LIMIT 1
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }
      return rows[0];
    }),

  createSchedule: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      room_id: z.string().uuid(),
      procedure_name: z.string(),
      procedure_code: z.string().max(20),
      laterality: z.string().max(20).optional(),
      estimated_duration_min: z.number().int().optional(),
      primary_surgeon: z.string().uuid(),
      assistant_surgeon: z.string().uuid().optional(),
      anesthetist: z.string().uuid().optional(),
      scrub_nurse: z.string().uuid().optional(),
      circulating_nurse: z.string().uuid().optional(),
      scheduled_date: z.string(),
      scheduled_start: z.string().datetime(),
      scheduled_end: z.string().datetime(),
      priority: otPriorityEnum.default('elective'),
      pre_op_diagnosis: z.string().optional(),
      blood_arranged: z.boolean().default(false),
      special_equipment: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Generate schedule_number: OTS-YYYYMMDD-NNN
      const dateStr = new Date(input.scheduled_date).toISOString().split('T')[0].replace(/-/g, '');
      const countResult = await getSql()`
        SELECT COUNT(*)::int as cnt
        FROM ot_schedule
        WHERE hospital_id = ${hospitalId}
          AND DATE(scheduled_date) = ${input.scheduled_date}::date
      `;
      const countRows = (countResult as any);
      const seqNum = ((countRows?.[0]?.cnt || 0) + 1).toString().padStart(3, '0');
      const scheduleNumber = `OTS-${dateStr}-${seqNum}`;

      const result = await getSql()`
        INSERT INTO ot_schedule (
          hospital_id, ots_patient_id, ots_encounter_id, ots_room_id,
          schedule_number, ots_status, ots_procedure_name, ots_procedure_code,
          ots_laterality, estimated_duration_min,
          primary_surgeon, assistant_surgeon, ots_anesthetist,
          scrub_nurse, circulating_nurse,
          scheduled_date, scheduled_start, scheduled_end,
          consent_obtained, site_marked, blood_arranged, special_equipment,
          pre_op_diagnosis, ots_priority, ots_notes,
          ots_created_by, ots_created_at, ots_updated_at
        )
        VALUES (
          ${hospitalId},
          ${input.patient_id}::uuid,
          ${input.encounter_id || null}::uuid,
          ${input.room_id}::uuid,
          ${scheduleNumber},
          'confirmed',
          ${input.procedure_name},
          ${input.procedure_code},
          ${input.laterality || null},
          ${input.estimated_duration_min || null},
          ${input.primary_surgeon}::uuid,
          ${input.assistant_surgeon || null}::uuid,
          ${input.anesthetist || null}::uuid,
          ${input.scrub_nurse || null}::uuid,
          ${input.circulating_nurse || null}::uuid,
          ${input.scheduled_date}::date,
          ${input.scheduled_start}::timestamptz,
          ${input.scheduled_end}::timestamptz,
          false, false, ${input.blood_arranged},
          ${input.special_equipment || null},
          ${input.pre_op_diagnosis || null},
          ${input.priority},
          ${input.notes || null},
          ${ctx.user.sub}::uuid,
          NOW(),
          NOW()
        )
        RETURNING id, schedule_number, ots_status
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create schedule' });
      }
      return rows[0];
    }),

  updateSchedule: protectedProcedure
    .input(z.object({
      schedule_id: z.string().uuid(),
      room_id: z.string().uuid().optional(),
      procedure_name: z.string().optional(),
      primary_surgeon: z.string().uuid().optional(),
      assistant_surgeon: z.string().uuid().optional(),
      anesthetist: z.string().uuid().optional(),
      scrub_nurse: z.string().uuid().optional(),
      circulating_nurse: z.string().uuid().optional(),
      scheduled_date: z.string().optional(),
      scheduled_start: z.string().datetime().optional(),
      scheduled_end: z.string().datetime().optional(),
      status: otScheduleStatusEnum.optional(),
      priority: otPriorityEnum.optional(),
      consent_obtained: z.boolean().optional(),
      site_marked: z.boolean().optional(),
      blood_arranged: z.boolean().optional(),
      pre_op_diagnosis: z.string().optional(),
      post_op_diagnosis: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify schedule exists
      const checkResult = await getSql()`
        SELECT id FROM ot_schedule
        WHERE id = ${input.schedule_id}::uuid AND hospital_id = ${hospitalId}
        LIMIT 1
      `;
      const checkRows = (checkResult as any);
      if (!checkRows || checkRows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      const updateParts: string[] = [];
      const params: any[] = [];

      if (input.room_id !== undefined) {
        updateParts.push(`ots_room_id = $${params.length + 1}`);
        params.push(input.room_id);
      }
      if (input.procedure_name !== undefined) {
        updateParts.push(`ots_procedure_name = $${params.length + 1}`);
        params.push(input.procedure_name);
      }
      if (input.primary_surgeon !== undefined) {
        updateParts.push(`primary_surgeon = $${params.length + 1}`);
        params.push(input.primary_surgeon);
      }
      if (input.assistant_surgeon !== undefined) {
        updateParts.push(`assistant_surgeon = $${params.length + 1}`);
        params.push(input.assistant_surgeon);
      }
      if (input.anesthetist !== undefined) {
        updateParts.push(`ots_anesthetist = $${params.length + 1}`);
        params.push(input.anesthetist);
      }
      if (input.scrub_nurse !== undefined) {
        updateParts.push(`scrub_nurse = $${params.length + 1}`);
        params.push(input.scrub_nurse);
      }
      if (input.circulating_nurse !== undefined) {
        updateParts.push(`circulating_nurse = $${params.length + 1}`);
        params.push(input.circulating_nurse);
      }
      if (input.scheduled_date !== undefined) {
        updateParts.push(`scheduled_date = $${params.length + 1}`);
        params.push(input.scheduled_date);
      }
      if (input.scheduled_start !== undefined) {
        updateParts.push(`scheduled_start = $${params.length + 1}`);
        params.push(input.scheduled_start);
      }
      if (input.scheduled_end !== undefined) {
        updateParts.push(`scheduled_end = $${params.length + 1}`);
        params.push(input.scheduled_end);
      }
      if (input.status !== undefined) {
        updateParts.push(`ots_status = $${params.length + 1}`);
        params.push(input.status);
      }
      if (input.priority !== undefined) {
        updateParts.push(`ots_priority = $${params.length + 1}`);
        params.push(input.priority);
      }
      if (input.consent_obtained !== undefined) {
        updateParts.push(`consent_obtained = $${params.length + 1}`);
        params.push(input.consent_obtained);
      }
      if (input.site_marked !== undefined) {
        updateParts.push(`site_marked = $${params.length + 1}`);
        params.push(input.site_marked);
      }
      if (input.blood_arranged !== undefined) {
        updateParts.push(`blood_arranged = $${params.length + 1}`);
        params.push(input.blood_arranged);
      }
      if (input.pre_op_diagnosis !== undefined) {
        updateParts.push(`pre_op_diagnosis = $${params.length + 1}`);
        params.push(input.pre_op_diagnosis);
      }
      if (input.post_op_diagnosis !== undefined) {
        updateParts.push(`post_op_diagnosis = $${params.length + 1}`);
        params.push(input.post_op_diagnosis);
      }
      if (input.notes !== undefined) {
        updateParts.push(`ots_notes = $${params.length + 1}`);
        params.push(input.notes);
      }

      if (updateParts.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });
      }

      updateParts.push(`ots_updated_at = NOW()`);

      const updateResult = await getSql()`
        UPDATE ot_schedule
        SET ${updateParts.join(', ')}
        WHERE id = ${input.schedule_id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, schedule_number, ots_status
      `;

      const rows = (updateResult as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update schedule' });
      }
      return rows[0];
    }),

  updateTiming: protectedProcedure
    .input(z.object({
      schedule_id: z.string().uuid(),
      wheels_in: z.string().datetime().optional(),
      wheels_out: z.string().datetime().optional(),
      actual_start: z.string().datetime().optional(),
      actual_end: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify schedule exists
      const checkResult = await getSql()`
        SELECT id, ots_actual_start FROM ot_schedule
        WHERE id = ${input.schedule_id}::uuid AND hospital_id = ${hospitalId}
        LIMIT 1
      `;
      const checkRows = (checkResult as any);
      if (!checkRows || checkRows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      let actualDuration: number | null = null;
      if (input.actual_start && input.actual_end) {
        const start = new Date(input.actual_start).getTime();
        const end = new Date(input.actual_end).getTime();
        actualDuration = Math.round((end - start) / 60000); // minutes
      }

      const updateParts: string[] = [];
      const params: any[] = [];

      if (input.wheels_in !== undefined) {
        updateParts.push(`wheels_in = $${params.length + 1}`);
        params.push(input.wheels_in);
      }
      if (input.wheels_out !== undefined) {
        updateParts.push(`wheels_out = $${params.length + 1}`);
        params.push(input.wheels_out);
      }
      if (input.actual_start !== undefined) {
        updateParts.push(`ots_actual_start = $${params.length + 1}`);
        params.push(input.actual_start);
      }
      if (input.actual_end !== undefined) {
        updateParts.push(`ots_actual_end = $${params.length + 1}`);
        params.push(input.actual_end);
      }
      if (actualDuration !== null) {
        updateParts.push(`actual_duration_min = $${params.length + 1}`);
        params.push(actualDuration);
      }

      if (updateParts.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No timing fields to update' });
      }

      updateParts.push(`ots_updated_at = NOW()`);

      const updateResult = await getSql()`
        UPDATE ot_schedule
        SET ${updateParts.join(', ')}
        WHERE id = ${input.schedule_id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, ots_actual_start, ots_actual_end, actual_duration_min
      `;

      const rows = (updateResult as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update timing' });
      }
      return rows[0];
    }),

  todayBoard: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          r.id as room_id,
          r.room_name,
          r.room_number,
          r.otr_status,
          json_agg(
            json_build_object(
              'id', s.id,
              'schedule_number', s.schedule_number,
              'patient_name', p.name_full,
              'uhid', p.uhid,
              'procedure_name', s.ots_procedure_name,
              'scheduled_start', s.scheduled_start,
              'scheduled_end', s.scheduled_end,
              'actual_start', s.ots_actual_start,
              'actual_end', s.ots_actual_end,
              'status', s.ots_status,
              'priority', s.ots_priority,
              'surgeon_name', ps.name_full
            ) ORDER BY s.scheduled_start ASC
          ) as cases
        FROM ot_rooms r
        LEFT JOIN ot_schedule s ON r.id = s.ots_room_id
          AND s.hospital_id = ${hospitalId}
          AND DATE(s.scheduled_date) = CURRENT_DATE
        LEFT JOIN patients p ON s.ots_patient_id = p.id
        LEFT JOIN users ps ON s.primary_surgeon = ps.id
        WHERE r.hospital_id = ${hospitalId}
          AND r.otr_is_active = true
        GROUP BY r.id, r.room_name, r.room_number, r.otr_status
        ORDER BY r.room_number ASC
      `;

      const rows = (result as any);
      return { board: rows || [] };
    }),

  scheduleAnalytics: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const statusResult = await getSql()`
        SELECT
          ots_status,
          COUNT(*)::int as count
        FROM ot_schedule
        WHERE hospital_id = ${hospitalId}
          ${input?.date_from ? `AND DATE(scheduled_date) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(scheduled_date) <= ${input.date_to}::date` : ''}
        GROUP BY ots_status
      `;
      const statusRows = (statusResult as any);

      const timingResult = await getSql()`
        SELECT
          ROUND(AVG(actual_duration_min)::numeric, 1)::float as avg_duration_min,
          ROUND((SUM(CASE WHEN ots_actual_start <= scheduled_start THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float as on_time_start_percent,
          ROUND((SUM(CASE WHEN ots_status = 'cancelled' THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float as cancellation_rate
        FROM ot_schedule
        WHERE hospital_id = ${hospitalId}
          AND ots_status IN ('completed', 'cancelled')
          ${input?.date_from ? `AND DATE(scheduled_date) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(scheduled_date) <= ${input.date_to}::date` : ''}
      `;
      const timingRows = (timingResult as any);

      return {
        by_status: statusRows || [],
        analytics: timingRows?.[0] || {},
      };
    }),

  // ═══════════════════════════════════════════════════════════════════
  // WHO CHECKLIST
  // ═══════════════════════════════════════════════════════════════════

  getChecklist: protectedProcedure
    .input(z.object({
      schedule_id: z.string().uuid(),
      phase: otChecklistPhaseEnum,
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          id,
          otc_schedule_id,
          otc_phase,
          identity_confirmed,
          cl_site_marked,
          consent_signed,
          anesthesia_checked,
          pulse_ox_ok,
          allergies_known,
          airway_risk,
          blood_loss_risk,
          team_introduced,
          name_procedure_confirmed,
          antibiotics_given,
          imaging_displayed,
          critical_steps_discussed,
          equipment_issues,
          instrument_count_ok,
          specimen_labeled,
          equipment_problems,
          recovery_plan,
          otc_completed_by,
          otc_completed_at,
          otc_notes,
          otc_created_at
        FROM ot_checklists
        WHERE otc_schedule_id = ${input.schedule_id}::uuid
          AND otc_phase = ${input.phase}
          AND hospital_id = ${hospitalId}
        LIMIT 1
      `;

      const rows = (result as any);
      return rows?.[0] || null;
    }),

  saveChecklist: protectedProcedure
    .input(z.object({
      schedule_id: z.string().uuid(),
      phase: otChecklistPhaseEnum,
      identity_confirmed: z.boolean().optional(),
      site_marked: z.boolean().optional(),
      consent_signed: z.boolean().optional(),
      anesthesia_checked: z.boolean().optional(),
      pulse_ox_ok: z.boolean().optional(),
      allergies_known: z.boolean().optional(),
      airway_risk: z.boolean().optional(),
      blood_loss_risk: z.boolean().optional(),
      team_introduced: z.boolean().optional(),
      name_procedure_confirmed: z.boolean().optional(),
      antibiotics_given: z.boolean().optional(),
      imaging_displayed: z.boolean().optional(),
      critical_steps_discussed: z.boolean().optional(),
      equipment_issues: z.boolean().optional(),
      instrument_count_ok: z.boolean().optional(),
      specimen_labeled: z.boolean().optional(),
      equipment_problems: z.boolean().optional(),
      recovery_plan: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Check if checklist exists
      const checkResult = await getSql()`
        SELECT id FROM ot_checklists
        WHERE otc_schedule_id = ${input.schedule_id}::uuid
          AND otc_phase = ${input.phase}
          AND hospital_id = ${hospitalId}
        LIMIT 1
      `;
      const checkRows = (checkResult as any);

      if (checkRows && checkRows.length > 0) {
        // Update
        const updateParts: string[] = [];
        const params: any[] = [];

        if (input.identity_confirmed !== undefined) {
          updateParts.push(`identity_confirmed = $${params.length + 1}`);
          params.push(input.identity_confirmed);
        }
        if (input.site_marked !== undefined) {
          updateParts.push(`cl_site_marked = $${params.length + 1}`);
          params.push(input.site_marked);
        }
        if (input.consent_signed !== undefined) {
          updateParts.push(`consent_signed = $${params.length + 1}`);
          params.push(input.consent_signed);
        }
        if (input.anesthesia_checked !== undefined) {
          updateParts.push(`anesthesia_checked = $${params.length + 1}`);
          params.push(input.anesthesia_checked);
        }
        if (input.pulse_ox_ok !== undefined) {
          updateParts.push(`pulse_ox_ok = $${params.length + 1}`);
          params.push(input.pulse_ox_ok);
        }
        if (input.allergies_known !== undefined) {
          updateParts.push(`allergies_known = $${params.length + 1}`);
          params.push(input.allergies_known);
        }
        if (input.airway_risk !== undefined) {
          updateParts.push(`airway_risk = $${params.length + 1}`);
          params.push(input.airway_risk);
        }
        if (input.blood_loss_risk !== undefined) {
          updateParts.push(`blood_loss_risk = $${params.length + 1}`);
          params.push(input.blood_loss_risk);
        }
        if (input.team_introduced !== undefined) {
          updateParts.push(`team_introduced = $${params.length + 1}`);
          params.push(input.team_introduced);
        }
        if (input.name_procedure_confirmed !== undefined) {
          updateParts.push(`name_procedure_confirmed = $${params.length + 1}`);
          params.push(input.name_procedure_confirmed);
        }
        if (input.antibiotics_given !== undefined) {
          updateParts.push(`antibiotics_given = $${params.length + 1}`);
          params.push(input.antibiotics_given);
        }
        if (input.imaging_displayed !== undefined) {
          updateParts.push(`imaging_displayed = $${params.length + 1}`);
          params.push(input.imaging_displayed);
        }
        if (input.critical_steps_discussed !== undefined) {
          updateParts.push(`critical_steps_discussed = $${params.length + 1}`);
          params.push(input.critical_steps_discussed);
        }
        if (input.equipment_issues !== undefined) {
          updateParts.push(`equipment_issues = $${params.length + 1}`);
          params.push(input.equipment_issues);
        }
        if (input.instrument_count_ok !== undefined) {
          updateParts.push(`instrument_count_ok = $${params.length + 1}`);
          params.push(input.instrument_count_ok);
        }
        if (input.specimen_labeled !== undefined) {
          updateParts.push(`specimen_labeled = $${params.length + 1}`);
          params.push(input.specimen_labeled);
        }
        if (input.equipment_problems !== undefined) {
          updateParts.push(`equipment_problems = $${params.length + 1}`);
          params.push(input.equipment_problems);
        }
        if (input.recovery_plan !== undefined) {
          updateParts.push(`recovery_plan = $${params.length + 1}`);
          params.push(input.recovery_plan);
        }
        if (input.notes !== undefined) {
          updateParts.push(`otc_notes = $${params.length + 1}`);
          params.push(input.notes);
        }

        if (updateParts.length > 0) {
          updateParts.push(`otc_completed_by = $${params.length + 1}`);
          params.push(ctx.user.sub);
          updateParts.push(`otc_completed_at = NOW()`);

          const updateResult = await getSql()`
            UPDATE ot_checklists
            SET ${updateParts.join(', ')}
            WHERE otc_schedule_id = ${input.schedule_id}::uuid
              AND otc_phase = ${input.phase}
              AND hospital_id = ${hospitalId}
            RETURNING id
          `;
          return { id: (updateResult as any)?.[0]?.id || input.schedule_id };
        }
      } else {
        // Insert
        const insertResult = await getSql()`
          INSERT INTO ot_checklists (
            hospital_id, otc_schedule_id, otc_phase,
            identity_confirmed, cl_site_marked, consent_signed,
            anesthesia_checked, pulse_ox_ok, allergies_known,
            airway_risk, blood_loss_risk, team_introduced,
            name_procedure_confirmed, antibiotics_given, imaging_displayed,
            critical_steps_discussed, equipment_issues, instrument_count_ok,
            specimen_labeled, equipment_problems, recovery_plan,
            otc_completed_by, otc_completed_at, otc_notes, otc_created_at
          )
          VALUES (
            ${hospitalId},
            ${input.schedule_id}::uuid,
            ${input.phase},
            ${input.identity_confirmed || false},
            ${input.site_marked || false},
            ${input.consent_signed || false},
            ${input.anesthesia_checked || false},
            ${input.pulse_ox_ok || false},
            ${input.allergies_known || false},
            ${input.airway_risk || false},
            ${input.blood_loss_risk || false},
            ${input.team_introduced || false},
            ${input.name_procedure_confirmed || false},
            ${input.antibiotics_given || false},
            ${input.imaging_displayed || false},
            ${input.critical_steps_discussed || false},
            ${input.equipment_issues || false},
            ${input.instrument_count_ok || false},
            ${input.specimen_labeled || false},
            ${input.equipment_problems || false},
            ${input.recovery_plan || false},
            ${ctx.user.sub}::uuid,
            NOW(),
            ${input.notes || null},
            NOW()
          )
          RETURNING id
        `;
        return { id: (insertResult as any)?.[0]?.id || input.schedule_id };
      }
      return { id: input.schedule_id };
    }),

  checklistCompliance: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      phase: otChecklistPhaseEnum.optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          otc_phase,
          COUNT(*)::int as total,
          SUM(CASE WHEN otc_completed_at IS NOT NULL THEN 1 ELSE 0 END)::int as completed,
          ROUND((SUM(CASE WHEN otc_completed_at IS NOT NULL THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float as compliance_percent
        FROM ot_checklists c
        JOIN ot_schedule s ON c.otc_schedule_id = s.id
        WHERE c.hospital_id = ${hospitalId}
          ${input?.date_from ? `AND DATE(s.scheduled_date) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(s.scheduled_date) <= ${input.date_to}::date` : ''}
          ${input?.phase ? `AND c.otc_phase = ${input.phase}` : ''}
        GROUP BY c.otc_phase
      `;

      const rows = (result as any);
      return { compliance: rows || [] };
    }),

  // ═══════════════════════════════════════════════════════════════════
  // ANESTHESIA
  // ═══════════════════════════════════════════════════════════════════

  getAnesthesiaRecord: protectedProcedure
    .input(z.object({ schedule_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          id,
          ar_schedule_id,
          ar_patient_id,
          ar_asa_class,
          ar_anesthesia_type,
          airway_assessment,
          fasting_hours,
          pre_medications,
          ar_allergies,
          ar_comorbidities,
          induction_time,
          intubation_time,
          extubation_time,
          agents_used,
          fluids_given,
          blood_products,
          ebl_ml,
          urine_output_ml,
          vitals_timeline,
          ar_complications,
          difficult_airway,
          anaphylaxis,
          ar_recovery_status,
          aldrete_score,
          pacu_admission_time,
          pacu_discharge_time,
          post_op_orders,
          ar_anesthetist_id,
          ar_notes,
          ar_created_at,
          ar_updated_at
        FROM anesthesia_records
        WHERE ar_schedule_id = ${input.schedule_id}::uuid
          AND hospital_id = ${hospitalId}
        LIMIT 1
      `;

      const rows = (result as any);
      return rows?.[0] || null;
    }),

  saveAnesthesiaRecord: protectedProcedure
    .input(z.object({
      schedule_id: z.string().uuid(),
      patient_id: z.string().uuid(),
      asa_class: asaClassEnum.optional(),
      anesthesia_type: anesthesiaTypeEnum.optional(),
      airway_assessment: z.string().optional(),
      fasting_hours: z.number().int().optional(),
      pre_medications: z.record(z.any()).optional(),
      allergies: z.string().optional(),
      comorbidities: z.string().optional(),
      induction_time: z.string().datetime().optional(),
      intubation_time: z.string().datetime().optional(),
      extubation_time: z.string().datetime().optional(),
      agents_used: z.record(z.any()).optional(),
      fluids_given: z.record(z.any()).optional(),
      blood_products: z.array(z.string()).optional(),
      ebl_ml: z.number().int().optional(),
      urine_output_ml: z.number().int().optional(),
      vitals_timeline: z.array(z.record(z.any())).optional(),
      complications: z.string().optional(),
      difficult_airway: z.boolean().optional(),
      anaphylaxis: z.boolean().optional(),
      post_op_orders: z.string().optional(),
      anesthetist_id: z.string().uuid().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Check if record exists
      const checkResult = await getSql()`
        SELECT id FROM anesthesia_records
        WHERE ar_schedule_id = ${input.schedule_id}::uuid
          AND hospital_id = ${hospitalId}
        LIMIT 1
      `;
      const checkRows = (checkResult as any);

      if (checkRows && checkRows.length > 0) {
        // Update
        const updateParts: string[] = [];
        const params: any[] = [];

        if (input.asa_class !== undefined) {
          updateParts.push(`ar_asa_class = $${params.length + 1}`);
          params.push(input.asa_class);
        }
        if (input.anesthesia_type !== undefined) {
          updateParts.push(`ar_anesthesia_type = $${params.length + 1}`);
          params.push(input.anesthesia_type);
        }
        if (input.airway_assessment !== undefined) {
          updateParts.push(`airway_assessment = $${params.length + 1}`);
          params.push(input.airway_assessment);
        }
        if (input.fasting_hours !== undefined) {
          updateParts.push(`fasting_hours = $${params.length + 1}`);
          params.push(input.fasting_hours);
        }
        if (input.pre_medications !== undefined) {
          updateParts.push(`pre_medications = $${params.length + 1}`);
          params.push(JSON.stringify(input.pre_medications));
        }
        if (input.allergies !== undefined) {
          updateParts.push(`ar_allergies = $${params.length + 1}`);
          params.push(input.allergies);
        }
        if (input.comorbidities !== undefined) {
          updateParts.push(`ar_comorbidities = $${params.length + 1}`);
          params.push(input.comorbidities);
        }
        if (input.induction_time !== undefined) {
          updateParts.push(`induction_time = $${params.length + 1}`);
          params.push(input.induction_time);
        }
        if (input.intubation_time !== undefined) {
          updateParts.push(`intubation_time = $${params.length + 1}`);
          params.push(input.intubation_time);
        }
        if (input.extubation_time !== undefined) {
          updateParts.push(`extubation_time = $${params.length + 1}`);
          params.push(input.extubation_time);
        }
        if (input.agents_used !== undefined) {
          updateParts.push(`agents_used = $${params.length + 1}`);
          params.push(JSON.stringify(input.agents_used));
        }
        if (input.fluids_given !== undefined) {
          updateParts.push(`fluids_given = $${params.length + 1}`);
          params.push(JSON.stringify(input.fluids_given));
        }
        if (input.blood_products !== undefined) {
          updateParts.push(`blood_products = $${params.length + 1}`);
          params.push(JSON.stringify(input.blood_products));
        }
        if (input.ebl_ml !== undefined) {
          updateParts.push(`ebl_ml = $${params.length + 1}`);
          params.push(input.ebl_ml);
        }
        if (input.urine_output_ml !== undefined) {
          updateParts.push(`urine_output_ml = $${params.length + 1}`);
          params.push(input.urine_output_ml);
        }
        if (input.vitals_timeline !== undefined) {
          updateParts.push(`vitals_timeline = $${params.length + 1}`);
          params.push(JSON.stringify(input.vitals_timeline));
        }
        if (input.complications !== undefined) {
          updateParts.push(`ar_complications = $${params.length + 1}`);
          params.push(input.complications);
        }
        if (input.difficult_airway !== undefined) {
          updateParts.push(`difficult_airway = $${params.length + 1}`);
          params.push(input.difficult_airway);
        }
        if (input.anaphylaxis !== undefined) {
          updateParts.push(`anaphylaxis = $${params.length + 1}`);
          params.push(input.anaphylaxis);
        }
        if (input.post_op_orders !== undefined) {
          updateParts.push(`post_op_orders = $${params.length + 1}`);
          params.push(input.post_op_orders);
        }
        if (input.anesthetist_id !== undefined) {
          updateParts.push(`ar_anesthetist_id = $${params.length + 1}`);
          params.push(input.anesthetist_id);
        }
        if (input.notes !== undefined) {
          updateParts.push(`ar_notes = $${params.length + 1}`);
          params.push(input.notes);
        }

        if (updateParts.length > 0) {
          updateParts.push(`ar_updated_at = NOW()`);

          const updateResult = await getSql()`
            UPDATE anesthesia_records
            SET ${updateParts.join(', ')}
            WHERE ar_schedule_id = ${input.schedule_id}::uuid
              AND hospital_id = ${hospitalId}
            RETURNING id
          `;
          return { id: (updateResult as any)?.[0]?.id || input.schedule_id };
        }
      } else {
        // Insert
        const insertResult = await getSql()`
          INSERT INTO anesthesia_records (
            hospital_id, ar_schedule_id, ar_patient_id,
            ar_asa_class, ar_anesthesia_type, airway_assessment,
            fasting_hours, pre_medications, ar_allergies, ar_comorbidities,
            induction_time, intubation_time, extubation_time,
            agents_used, fluids_given, blood_products,
            ebl_ml, urine_output_ml, vitals_timeline,
            ar_complications, difficult_airway, anaphylaxis,
            post_op_orders, ar_anesthetist_id, ar_notes,
            ar_created_at, ar_updated_at
          )
          VALUES (
            ${hospitalId},
            ${input.schedule_id}::uuid,
            ${input.patient_id}::uuid,
            ${input.asa_class || null},
            ${input.anesthesia_type || null},
            ${input.airway_assessment || null},
            ${input.fasting_hours || null},
            ${input.pre_medications ? JSON.stringify(input.pre_medications) : null},
            ${input.allergies || null},
            ${input.comorbidities || null},
            ${input.induction_time || null},
            ${input.intubation_time || null},
            ${input.extubation_time || null},
            ${input.agents_used ? JSON.stringify(input.agents_used) : null},
            ${input.fluids_given ? JSON.stringify(input.fluids_given) : null},
            ${input.blood_products ? JSON.stringify(input.blood_products) : null},
            ${input.ebl_ml || null},
            ${input.urine_output_ml || null},
            ${input.vitals_timeline ? JSON.stringify(input.vitals_timeline) : null},
            ${input.complications || null},
            ${input.difficult_airway || false},
            ${input.anaphylaxis || false},
            ${input.post_op_orders || null},
            ${input.anesthetist_id || null}::uuid,
            ${input.notes || null},
            NOW(),
            NOW()
          )
          RETURNING id
        `;
        return { id: (insertResult as any)?.[0]?.id || input.schedule_id };
      }
      return { id: input.schedule_id };
    }),

  updateRecovery: protectedProcedure
    .input(z.object({
      schedule_id: z.string().uuid(),
      recovery_status: recoveryStatusEnum,
      aldrete_score: z.number().int().min(0).max(10).optional(),
      pacu_admission_time: z.string().datetime().optional(),
      pacu_discharge_time: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const updateResult = await getSql()`
        UPDATE anesthesia_records
        SET
          ar_recovery_status = ${input.recovery_status},
          ${input.aldrete_score !== undefined ? `aldrete_score = ${input.aldrete_score},` : ''}
          ${input.pacu_admission_time ? `pacu_admission_time = ${input.pacu_admission_time},` : ''}
          ${input.pacu_discharge_time ? `pacu_discharge_time = ${input.pacu_discharge_time},` : ''}
          ar_updated_at = NOW()
        WHERE ar_schedule_id = ${input.schedule_id}::uuid
          AND hospital_id = ${hospitalId}
        RETURNING id, ar_recovery_status
      `;

      const rows = (updateResult as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Anesthesia record not found' });
      }
      return rows[0];
    }),

  anesthesiaAnalytics: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const asaResult = await getSql()`
        SELECT
          ar_asa_class,
          COUNT(*)::int as count
        FROM anesthesia_records
        WHERE hospital_id = ${hospitalId}
          ${input?.date_from ? `AND ar_created_at >= ${input.date_from}::timestamptz` : ''}
          ${input?.date_to ? `AND ar_created_at <= ${input.date_to}::timestamptz` : ''}
        GROUP BY ar_asa_class
      `;
      const asaRows = (asaResult as any);

      const typeResult = await getSql()`
        SELECT
          ar_anesthesia_type,
          COUNT(*)::int as count
        FROM anesthesia_records
        WHERE hospital_id = ${hospitalId}
          ${input?.date_from ? `AND ar_created_at >= ${input.date_from}::timestamptz` : ''}
          ${input?.date_to ? `AND ar_created_at <= ${input.date_to}::timestamptz` : ''}
        GROUP BY ar_anesthesia_type
      `;
      const typeRows = (typeResult as any);

      const complicationResult = await getSql()`
        SELECT
          ROUND((SUM(CASE WHEN ar_complications IS NOT NULL THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float as complication_rate,
          ROUND((SUM(CASE WHEN difficult_airway THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float as difficult_airway_rate,
          ROUND((SUM(CASE WHEN anaphylaxis THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float as anaphylaxis_rate
        FROM anesthesia_records
        WHERE hospital_id = ${hospitalId}
          ${input?.date_from ? `AND ar_created_at >= ${input.date_from}::timestamptz` : ''}
          ${input?.date_to ? `AND ar_created_at <= ${input.date_to}::timestamptz` : ''}
      `;
      const complicationRows = (complicationResult as any);

      return {
        asa_distribution: asaRows || [],
        anesthesia_distribution: typeRows || [],
        complications: complicationRows?.[0] || {},
      };
    }),

  // ═══════════════════════════════════════════════════════════════════
  // EQUIPMENT
  // ═══════════════════════════════════════════════════════════════════

  logEquipment: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid(),
      schedule_id: z.string().uuid().optional(),
      equipment_name: z.string(),
      equipment_code: z.string().max(30),
      action: equipmentActionEnum,
      condition: equipmentConditionEnum,
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        INSERT INTO ot_equipment_log (
          hospital_id, oel_schedule_id, oel_room_id,
          equipment_name, equipment_code,
          oel_action, oel_condition,
          oel_logged_by, oel_logged_at, oel_notes
        )
        VALUES (
          ${hospitalId},
          ${input.schedule_id || null}::uuid,
          ${input.room_id}::uuid,
          ${input.equipment_name},
          ${input.equipment_code},
          ${input.action},
          ${input.condition},
          ${ctx.user.sub}::uuid,
          NOW(),
          ${input.notes || null}
        )
        RETURNING id
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log equipment' });
      }
      return { id: rows[0].id };
    }),

  listEquipmentLog: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid().optional(),
      schedule_id: z.string().uuid().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().int().max(500).default(50),
      offset: z.number().int().default(0),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          id,
          oel_schedule_id,
          oel_room_id,
          equipment_name,
          equipment_code,
          oel_action,
          oel_condition,
          oel_logged_by,
          oel_logged_at,
          oel_notes
        FROM ot_equipment_log
        WHERE hospital_id = ${hospitalId}
          ${input?.room_id ? `AND oel_room_id = ${input.room_id}::uuid` : ''}
          ${input?.schedule_id ? `AND oel_schedule_id = ${input.schedule_id}::uuid` : ''}
          ${input?.date_from ? `AND DATE(oel_logged_at) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(oel_logged_at) <= ${input.date_to}::date` : ''}
        ORDER BY oel_logged_at DESC
        LIMIT ${input?.limit || 50} OFFSET ${input?.offset || 0}
      `;

      const rows = (result as any);
      return { equipment_log: rows || [], count: rows?.length || 0 };
    }),

  equipmentStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          equipment_code,
          equipment_name,
          oel_condition,
          COUNT(*)::int as count,
          MAX(oel_logged_at) as last_logged
        FROM ot_equipment_log
        WHERE hospital_id = ${hospitalId}
        GROUP BY equipment_code, equipment_name, oel_condition
        ORDER BY last_logged DESC
      `;

      const rows = (result as any);
      return { equipment_status: rows || [] };
    }),

  // ═══════════════════════════════════════════════════════════════════
  // TURNOVER
  // ═══════════════════════════════════════════════════════════════════

  logTurnover: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid(),
      prev_schedule_id: z.string().uuid().optional(),
      next_schedule_id: z.string().uuid().optional(),
      cleaning_start: z.string().datetime(),
      cleaning_end: z.string().datetime(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const startTime = new Date(input.cleaning_start).getTime();
      const endTime = new Date(input.cleaning_end).getTime();
      const turnoverMinutes = Math.round((endTime - startTime) / 60000);

      const result = await getSql()`
        INSERT INTO ot_turnover_log (
          hospital_id, otl_room_id,
          prev_schedule_id, next_schedule_id,
          cleaning_start, cleaning_end,
          turnover_minutes,
          cleaned_by, otl_verified_by,
          otl_notes, otl_created_at
        )
        VALUES (
          ${hospitalId},
          ${input.room_id}::uuid,
          ${input.prev_schedule_id || null}::uuid,
          ${input.next_schedule_id || null}::uuid,
          ${input.cleaning_start}::timestamptz,
          ${input.cleaning_end}::timestamptz,
          ${turnoverMinutes},
          ${ctx.user.sub}::uuid,
          ${ctx.user.sub}::uuid,
          ${input.notes || null},
          NOW()
        )
        RETURNING id
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log turnover' });
      }
      return { id: rows[0].id };
    }),

  listTurnovers: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      limit: z.number().int().max(500).default(50),
      offset: z.number().int().default(0),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await getSql()`
        SELECT
          id,
          otl_room_id,
          prev_schedule_id,
          next_schedule_id,
          cleaning_start,
          cleaning_end,
          turnover_minutes,
          cleaned_by,
          otl_verified_by,
          otl_verified_at,
          otl_notes,
          otl_created_at
        FROM ot_turnover_log
        WHERE hospital_id = ${hospitalId}
          ${input?.room_id ? `AND otl_room_id = ${input.room_id}::uuid` : ''}
          ${input?.date_from ? `AND DATE(cleaning_start) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(cleaning_start) <= ${input.date_to}::date` : ''}
        ORDER BY cleaning_start DESC
        LIMIT ${input?.limit || 50} OFFSET ${input?.offset || 0}
      `;

      const rows = (result as any);
      return { turnovers: rows || [], count: rows?.length || 0 };
    }),

  turnoverAnalytics: protectedProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const byRoomResult = await getSql()`
        SELECT
          r.id as room_id,
          r.room_name,
          r.room_number,
          ROUND(AVG(t.turnover_minutes)::numeric, 1)::float as avg_turnover_minutes,
          COUNT(*)::int as turnover_count,
          MIN(t.turnover_minutes) as min_turnover,
          MAX(t.turnover_minutes) as max_turnover
        FROM ot_rooms r
        LEFT JOIN ot_turnover_log t ON r.id = t.otl_room_id
          AND t.hospital_id = ${hospitalId}
          ${input?.date_from ? `AND DATE(t.cleaning_start) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(t.cleaning_start) <= ${input.date_to}::date` : ''}
        WHERE r.hospital_id = ${hospitalId}
        GROUP BY r.id, r.room_name, r.room_number
        ORDER BY avg_turnover_minutes DESC
      `;
      const byRoomRows = (byRoomResult as any);

      const trendResult = await getSql()`
        SELECT
          DATE_TRUNC('day', cleaning_start)::date as date,
          ROUND(AVG(turnover_minutes)::numeric, 1)::float as avg_turnover_minutes,
          COUNT(*)::int as count
        FROM ot_turnover_log
        WHERE hospital_id = ${hospitalId}
          ${input?.date_from ? `AND DATE(cleaning_start) >= ${input.date_from}::date` : ''}
          ${input?.date_to ? `AND DATE(cleaning_start) <= ${input.date_to}::date` : ''}
        GROUP BY DATE_TRUNC('day', cleaning_start)
        ORDER BY date DESC
      `;
      const trendRows = (trendResult as any);

      return {
        by_room: byRoomRows || [],
        trend: trendRows || [],
      };
    }),
});
