import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { assertRoleCanWrite } from '@/lib/chart/can-write';
import { db } from '@/lib/db';
import {
  clinicalOrders, vitalSigns, nursingNotes,
  encounters, patients,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, count } from 'drizzle-orm';

const orderTypeValues = ['lab', 'radiology', 'pharmacy', 'procedure', 'diet', 'nursing'] as const;
const orderStatusValues = ['draft', 'ordered', 'in_progress', 'completed', 'cancelled'] as const;
const orderPriorityValues = ['routine', 'urgent', 'stat'] as const;

// Valid status transitions
const validStatusTransitions: Record<string, string[]> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [], // terminal
  cancelled: [], // terminal
};

export const clinicalOrdersRouter = router({

  // ─── CREATE ORDER ─────────────────────────────────────────
  createOrder: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      order_type: z.enum(orderTypeValues),
      priority: z.enum(orderPriorityValues).default('routine'),
      order_name: z.string().min(1).max(500),
      order_code: z.string().max(50).optional(),
      description: z.string().max(2000).optional(),
      quantity: z.number().int().min(1).default(1),
      frequency: z.string().max(100).optional(),
      duration_days: z.number().int().min(1).optional(),
      instructions: z.string().max(2000).optional(),
      // Drug-specific (pharmacy)
      drug_id: z.string().uuid().optional(),
      route: z.string().max(50).optional(),
      dosage: z.string().max(100).optional(),
      // Charge
      charge_master_id: z.string().uuid().optional(),
      unit_price: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRoleCanWrite(ctx.user, 'order.place'); // PC.3.4.C
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is active
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
        status: encounters.status,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });

      // 2. Create order
      const [order] = await db.insert(clinicalOrders).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        order_type: input.order_type,
        order_status: 'ordered',
        priority: input.priority,
        order_code: input.order_code || null,
        order_name: input.order_name,
        description: input.description || null,
        quantity: input.quantity,
        frequency: input.frequency || null,
        duration_days: input.duration_days || null,
        instructions: input.instructions || null,
        drug_id: input.drug_id ? (input.drug_id as any) : null,
        route: input.route || null,
        dosage: input.dosage || null,
        charge_master_id: input.charge_master_id ? (input.charge_master_id as any) : null,
        unit_price: input.unit_price ? (input.unit_price as any) : null,
        ordered_by_user_id: ctx.user.sub,
        ordered_at: new Date(),
      }).returning();

      // 3. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'clinical_orders',
        row_id: order.id,
        new_values: {
          encounter_id: input.encounter_id,
          order_type: input.order_type,
          order_name: input.order_name,
          priority: input.priority,
        },
      });

      return {
        order_id: order.id,
        encounter_id: order.encounter_id,
        order_status: order.order_status,
        ordered_at: order.ordered_at,
      };
    }),

  // ─── LIST ORDERS ──────────────────────────────────────────
  listOrders: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      type: z.enum(orderTypeValues).optional(),
      status: z.enum(orderStatusValues).optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      const typeFilter = input.type ? sql`AND co.order_type = ${input.type}` : sql``;
      const statusFilter = input.status ? sql`AND co.order_status = ${input.status}` : sql``;

      const result = await db.execute(sql`
        SELECT
          co.id, co.encounter_id, co.patient_id,
          co.order_type, co.order_status, co.priority,
          co.order_code, co.order_name, co.description,
          co.quantity, co.frequency, co.duration_days, co.instructions,
          co.drug_id, co.route, co.dosage,
          co.charge_master_id, co.unit_price,
          co.result_text, co.result_json, co.result_at,
          co.ordered_at, co.completed_at, co.cancelled_at, co.cancel_reason,
          p.uhid, p.name_full as patient_name
        FROM clinical_orders co
        JOIN patients p ON co.patient_id = p.id
        WHERE co.encounter_id = ${input.encounter_id}::uuid
          AND co.hospital_id = ${hospitalId}
          ${typeFilter}
          ${statusFilter}
        ORDER BY co.ordered_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM clinical_orders co
        WHERE co.encounter_id = ${input.encounter_id}::uuid
          AND co.hospital_id = ${hospitalId}
          ${typeFilter}
          ${statusFilter}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
    }),

  // ─── UPDATE ORDER STATUS ──────────────────────────────────
  updateOrderStatus: protectedProcedure
    .input(z.object({
      order_id: z.string().uuid(),
      new_status: z.enum(orderStatusValues),
      cancel_reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRoleCanWrite(ctx.user, 'order.cancel'); // PC.3.4.C
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify order exists
      const [order] = await db.select({
        id: clinicalOrders.id,
        order_status: clinicalOrders.order_status,
        encounter_id: clinicalOrders.encounter_id,
      })
        .from(clinicalOrders)
        .where(and(
          eq(clinicalOrders.id, input.order_id as any),
          eq(clinicalOrders.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

      // 2. Validate status transition
      const allowedNextStatuses = validStatusTransitions[order.order_status];
      if (!allowedNextStatuses.includes(input.new_status)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Cannot transition from ${order.order_status} to ${input.new_status}`,
        });
      }

      // 3. Require cancel_reason if cancelling
      if (input.new_status === 'cancelled' && !input.cancel_reason) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'cancel_reason is required when cancelling an order',
        });
      }

      // 4. Update order
      const updateData: any = {
        order_status: input.new_status,
      };

      if (input.new_status === 'completed') {
        updateData.completed_at = new Date();
      } else if (input.new_status === 'cancelled') {
        updateData.cancelled_at = new Date();
        updateData.cancel_reason = input.cancel_reason || null;
      }

      await db.update(clinicalOrders)
        .set(updateData)
        .where(eq(clinicalOrders.id, input.order_id as any));

      // 5. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'clinical_orders',
        row_id: order.id,
        new_values: {
          order_status: input.new_status,
          cancel_reason: input.cancel_reason || null,
        },
      });

      return {
        order_id: order.id,
        order_status: input.new_status,
        updated_at: new Date(),
      };
    }),

  // ─── ADD RESULT ────────────────────────────────────────────
  addResult: protectedProcedure
    .input(z.object({
      order_id: z.string().uuid(),
      result_text: z.string().max(5000).optional(),
      result_json: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRoleCanWrite(ctx.user, 'lab.release'); // PC.3.4.C
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify order exists and is lab/radiology
      const [order] = await db.select({
        id: clinicalOrders.id,
        order_type: clinicalOrders.order_type,
        order_status: clinicalOrders.order_status,
        encounter_id: clinicalOrders.encounter_id,
      })
        .from(clinicalOrders)
        .where(and(
          eq(clinicalOrders.id, input.order_id as any),
          eq(clinicalOrders.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

      if (!['lab', 'radiology'].includes(order.order_type)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Results can only be added to lab or radiology orders',
        });
      }

      // 2. Update order with result
      await db.update(clinicalOrders)
        .set({
          result_text: input.result_text || null,
          result_json: input.result_json ? (input.result_json as any) : null,
          result_at: new Date(),
          order_status: 'completed',
          completed_at: new Date(),
        })
        .where(eq(clinicalOrders.id, input.order_id as any));

      // 3. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'clinical_orders',
        row_id: order.id,
        new_values: {
          order_status: 'completed',
          result_text: input.result_text ? input.result_text.substring(0, 100) : null,
          has_result_json: !!input.result_json,
        },
      });

      return {
        order_id: order.id,
        order_status: 'completed',
        result_at: new Date(),
      };
    }),

  // ─── RECORD VITALS ────────────────────────────────────────
  recordVitals: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      temperature_c: z.number().optional(),
      pulse_bpm: z.number().int().optional(),
      resp_rate: z.number().int().optional(),
      bp_systolic: z.number().int().optional(),
      bp_diastolic: z.number().int().optional(),
      spo2_percent: z.number().optional(),
      blood_glucose: z.number().optional(),
      weight_kg: z.number().optional(),
      height_cm: z.number().optional(),
      pain_score: z.number().int().min(0).max(10).optional(),
      gcs_score: z.number().int().min(3).max(15).optional(),
      avpu: z.enum(['A', 'V', 'P', 'U']).optional(),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRoleCanWrite(ctx.user, 'vitals.record'); // PC.3.4.C
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is active
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

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });

      // 2. Create vital signs record
      const [vital] = await db.insert(vitalSigns).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        temperature_c: input.temperature_c ? (input.temperature_c as any) : null,
        pulse_bpm: input.pulse_bpm || null,
        resp_rate: input.resp_rate || null,
        bp_systolic: input.bp_systolic || null,
        bp_diastolic: input.bp_diastolic || null,
        spo2_percent: input.spo2_percent ? (input.spo2_percent as any) : null,
        blood_glucose: input.blood_glucose ? (input.blood_glucose as any) : null,
        weight_kg: input.weight_kg ? (input.weight_kg as any) : null,
        height_cm: input.height_cm ? (input.height_cm as any) : null,
        pain_score: input.pain_score || null,
        gcs_score: input.gcs_score || null,
        avpu: input.avpu || null,
        notes: input.notes || null,
        recorded_by_user_id: ctx.user.sub,
        recorded_at: new Date(),
      }).returning();

      // 3. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'vital_signs',
        row_id: vital.id,
        new_values: {
          encounter_id: input.encounter_id,
          temperature_c: input.temperature_c,
          pulse_bpm: input.pulse_bpm,
          bp: input.bp_systolic && input.bp_diastolic ? `${input.bp_systolic}/${input.bp_diastolic}` : null,
        },
      });

      return {
        vital_id: vital.id,
        encounter_id: vital.encounter_id,
        recorded_at: vital.recorded_at,
      };
    }),

  // ─── GET VITALS HISTORY ───────────────────────────────────
  getVitals: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {

      const result = await db.execute(sql`
        SELECT
          id, hospital_id, encounter_id, patient_id,
          temperature_c, pulse_bpm, resp_rate,
          bp_systolic, bp_diastolic, spo2_percent, blood_glucose,
          weight_kg, height_cm, pain_score, gcs_score, avpu,
          notes, recorded_by_user_id, recorded_at, created_at
        FROM vital_signs
        WHERE encounter_id = ${input.encounter_id}::uuid
          AND hospital_id = ${ctx.user.hospital_id}
        ORDER BY recorded_at DESC
        LIMIT ${input.limit}
      `);

      return (result as any).rows || result;
    }),

  // ─── GET LATEST VITALS ────────────────────────────────────
  getLatestVitals: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {

      const result = await db.execute(sql`
        SELECT
          id, hospital_id, encounter_id, patient_id,
          temperature_c, pulse_bpm, resp_rate,
          bp_systolic, bp_diastolic, spo2_percent, blood_glucose,
          weight_kg, height_cm, pain_score, gcs_score, avpu,
          notes, recorded_by_user_id, recorded_at, created_at
        FROM vital_signs
        WHERE encounter_id = ${input.encounter_id}::uuid
          AND hospital_id = ${ctx.user.hospital_id}
        ORDER BY recorded_at DESC
        LIMIT 1
      `);

      const rows = (result as any).rows || result;
      return rows.length > 0 ? rows[0] : null;
    }),

  // ─── ADD NURSING NOTE ─────────────────────────────────────
  addNursingNote: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      note_type: z.string().max(50).default('general'),
      content: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRoleCanWrite(ctx.user, 'note.create'); // PC.3.4.C
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is active
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

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });

      // 2. Create nursing note
      const [note] = await db.insert(nursingNotes).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        patient_id: encounter.patient_id,
        note_type: input.note_type,
        content: input.content,
        recorded_by_user_id: ctx.user.sub,
        recorded_at: new Date(),
      }).returning();

      // 3. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'nursing_notes',
        row_id: note.id,
        new_values: {
          encounter_id: input.encounter_id,
          note_type: input.note_type,
          content_length: input.content.length,
        },
      });

      return {
        note_id: note.id,
        encounter_id: note.encounter_id,
        note_type: note.note_type,
        recorded_at: note.recorded_at,
      };
    }),

  // ─── LIST NURSING NOTES ───────────────────────────────────
  listNursingNotes: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.limit;

      const result = await db.execute(sql`
        SELECT
          nn.id, nn.encounter_id, nn.patient_id,
          nn.note_type, nn.content,
          nn.recorded_by_user_id, nn.recorded_at, nn.created_at,
          u.display_name as recorded_by_name
        FROM nursing_notes nn
        LEFT JOIN users u ON nn.recorded_by_user_id = u.id
        WHERE nn.encounter_id = ${input.encounter_id}::uuid
          AND nn.hospital_id = ${hospitalId}
        ORDER BY nn.recorded_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM nursing_notes
        WHERE encounter_id = ${input.encounter_id}::uuid
          AND hospital_id = ${hospitalId}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
    }),

  // ─── ORDER STATS ──────────────────────────────────────────
  orderStats: protectedProcedure.query(async ({ ctx }) => {
    const hospitalId = ctx.user.hospital_id;

    const result = await db.execute(sql`
      SELECT
        order_type,
        order_status,
        count(*)::int as count
      FROM clinical_orders
      WHERE hospital_id = ${hospitalId}
      GROUP BY order_type, order_status
    `);

    const rows = (result as any).rows || result;

    // Transform into a more usable structure
    const stats: Record<string, Record<string, number>> = {};
    rows.forEach((row: any) => {
      if (!stats[row.order_type]) {
        stats[row.order_type] = {};
      }
      stats[row.order_type][row.order_status] = row.count;
    });

    // Also get totals
    const totalResult = await db.execute(sql`
      SELECT count(*)::int as total FROM clinical_orders WHERE hospital_id = ${hospitalId}
    `);
    const totalRows = (totalResult as any).rows || totalResult;
    const total = Number(totalRows[0]?.total ?? 0);

    return { stats, total };
  }),
});
