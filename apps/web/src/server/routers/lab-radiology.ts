import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// Validation Schemas
const panelCreateSchema = z.object({
  panel_code: z.string().min(1),
  panel_name: z.string().min(1),
  lp_department: z.string().min(1),
  lp_description: z.string().optional(),
  lp_loinc_code: z.string().optional(),
  sample_type: z.string().min(1),
  container_type: z.string().min(1),
  tat_minutes: z.number().int().positive(),
  lp_price: z.number().nonnegative(),
});

const panelUpdateSchema = panelCreateSchema.partial().extend({
  id: z.string(),
});

const panelComponentSchema = z.object({
  lpc_panel_id: z.string(),
  test_code: z.string().min(1),
  test_name: z.string().min(1),
  lpc_loinc_code: z.string().optional(),
  test_unit: z.string().optional(),
  ref_range_low: z.number().nullable().optional(),
  ref_range_high: z.number().nullable().optional(),
  ref_range_text: z.string().optional(),
  critical_low: z.number().nullable().optional(),
  critical_high: z.number().nullable().optional(),
  test_data_type: z.enum(['numeric', 'text', 'coded']),
  lpc_sort_order: z.number().int().nonnegative(),
});

const labOrderCreateSchema = z.object({
  lo_patient_id: z.string(),
  lo_encounter_id: z.string(),
  lo_service_request_id: z.string().optional(),
  lo_panel_id: z.string(),
  lo_urgency: z.enum(['routine', 'urgent', 'stat', 'asap']).default('routine'),
  lo_clinical_notes: z.string().optional(),
  lo_ordered_by: z.string(),
});

const labOrderStatusUpdateSchema = z.object({
  id: z.string(),
  status: z.enum(['ordered', 'collected', 'received', 'processing', 'resulted', 'verified', 'cancelled']),
});

const specimenCollectionSchema = z.object({
  sp_order_id: z.string(),
  sp_collected_by: z.string(),
  collection_site: z.string().optional(),
  sp_notes: z.string().optional(),
});

const specimenReceptionSchema = z.object({
  sp_order_id: z.string(),
  sp_received_by: z.string(),
  sp_notes: z.string().optional(),
});

const labResultEntrySchema = z.object({
  lr_order_id: z.string(),
  lr_component_id: z.string(),
  lr_test_code: z.string(),
  lr_test_name: z.string(),
  value_numeric: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  value_coded: z.string().nullable().optional(),
  lr_unit: z.string().optional(),
  lr_ref_range_text: z.string().optional(),
  lr_notes: z.string().optional(),
  lr_resulted_by: z.string(),
});

const radiologyOrderCreateSchema = z.object({
  ro_patient_id: z.string(),
  ro_encounter_id: z.string(),
  ro_service_request_id: z.string().optional(),
  ro_modality: z.enum(['xray', 'ct', 'mri', 'ultrasound', 'fluoroscopy', 'mammography', 'dexa', 'pet_ct', 'interventional']),
  study_description: z.string().min(1),
  body_part: z.string().optional(),
  laterality: z.enum(['left', 'right', 'bilateral', 'na']).default('na'),
  ro_urgency: z.enum(['routine', 'urgent', 'stat', 'asap']).default('routine'),
  clinical_indication: z.string().optional(),
  contrast_required: z.boolean().default(false),
  ro_ordered_by: z.string(),
});

const radiologyScheduleSchema = z.object({
  id: z.string(),
  scheduled_at: z.string().datetime(),
  ro_room: z.string().optional(),
});

const radiologyReportSchema = z.object({
  rr2_order_id: z.string(),
  rr2_findings: z.string(),
  rr2_impression: z.string(),
  rr2_recommendation: z.string().optional(),
  birads_category: z.enum(['0', '1', '2', '3', '4', '5', '6', 'na']).default('na'),
  li_rads_category: z.enum(['1', '2', '3', '4', '5', 'na']).default('na'),
  lung_rads_category: z.enum(['1', '2', '3', '4a', '4b', '4x', 'na']).default('na'),
  rr2_is_critical: z.boolean().default(false),
  critical_notified_to: z.string().optional(),
  rr2_reported_by: z.string(),
});

const radiologyAddendumSchema = z.object({
  id: z.string(),
  rr2_addendum: z.string().min(1),
  rr2_addendum_by: z.string(),
});

// Generate order numbers in format XXX-YYYYMMDD-NNNN
async function generateOrderNumber(prefix: string, hospital_id: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const countQuery = `
    SELECT COUNT(*) as cnt FROM ${prefix === 'LO' ? 'lab_orders' : 'radiology_orders'}
    WHERE hospital_id = $1 AND ${prefix === 'LO' ? 'lo_order_number' : 'ro_order_number'} LIKE $2
  `;
  const result = await sql(countQuery, [hospital_id, `${prefix}-${today}-%`]);
  const count = (result[0]?.cnt || 0) as number;
  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}-${today}-${sequence}`;
}

export const labRadiologyRouter = router({
  // ===== LAB PANELS =====

  createPanel: protectedProcedure
    .input(panelCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await sql(
        `INSERT INTO lab_panels (
          id, hospital_id, panel_code, panel_name, lp_department, lp_description,
          lp_loinc_code, sample_type, container_type, tat_minutes, lp_price,
          lp_is_active, lp_created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12
        )`,
        [
          id,
          ctx.user.hospital_id,
          input.panel_code,
          input.panel_name,
          input.lp_department,
          input.lp_description || null,
          input.lp_loinc_code || null,
          input.sample_type,
          input.container_type,
          input.tat_minutes,
          input.lp_price,
          now,
        ]
      );

      return { id };
    }),

  updatePanel: protectedProcedure
    .input(panelUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const setClauses: string[] = [];
      const values: unknown[] = [id, ctx.user.hospital_id];
      let paramIndex = 3;

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          setClauses.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClauses.length === 0) {
        return { updated: 0 };
      }

      const query = `
        UPDATE lab_panels
        SET ${setClauses.join(', ')}
        WHERE id = $1 AND hospital_id = $2
      `;

      await sql(query, values);
      return { updated: 1 };
    }),

  listPanels: protectedProcedure
    .input(
      z.object({
        department: z.string().optional(),
        is_active: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT id, panel_code, panel_name, lp_department, lp_description,
               sample_type, container_type, tat_minutes, lp_price, lp_is_active, lp_created_at
        FROM lab_panels
        WHERE hospital_id = $1
          AND (${input.department ?? null}::text IS NULL OR lp_department = ${input.department ?? null})
          AND (${input.is_active ?? null}::boolean IS NULL OR lp_is_active = ${input.is_active ?? null})
        ORDER BY lp_created_at DESC
      `;

      const panels = await sql(query, [ctx.user.hospital_id]);
      return panels;
    }),

  getPanelDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const panelQuery = `
        SELECT id, panel_code, panel_name, lp_department, lp_description,
               lp_loinc_code, sample_type, container_type, tat_minutes, lp_price, lp_is_active
        FROM lab_panels
        WHERE id = $1 AND hospital_id = $2
      `;

      const componentQuery = `
        SELECT id, test_code, test_name, lpc_loinc_code, test_unit,
               ref_range_low, ref_range_high, ref_range_text,
               critical_low, critical_high, test_data_type, lpc_sort_order, lpc_is_active
        FROM lab_panel_components
        WHERE lpc_panel_id = $1 AND hospital_id = $2
        ORDER BY lpc_sort_order ASC
      `;

      const panels = await sql(panelQuery, [input.id, ctx.user.hospital_id]);
      const components = await sql(componentQuery, [input.id, ctx.user.hospital_id]);

      if (panels.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Panel not found' });
      }

      return { panel: panels[0], components };
    }),

  addComponent: protectedProcedure
    .input(panelComponentSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify panel exists
      const panelCheck = await sql(
        `SELECT id FROM lab_panels WHERE id = $1 AND hospital_id = $2`,
        [input.lpc_panel_id, ctx.user.hospital_id]
      );

      if (panelCheck.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Panel not found' });
      }

      const id = crypto.randomUUID();

      await sql(
        `INSERT INTO lab_panel_components (
          id, hospital_id, lpc_panel_id, test_code, test_name, lpc_loinc_code,
          test_unit, ref_range_low, ref_range_high, ref_range_text,
          critical_low, critical_high, test_data_type, lpc_sort_order, lpc_is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true
        )`,
        [
          id,
          ctx.user.hospital_id,
          input.lpc_panel_id,
          input.test_code,
          input.test_name,
          input.lpc_loinc_code || null,
          input.test_unit || null,
          input.ref_range_low ?? null,
          input.ref_range_high ?? null,
          input.ref_range_text || null,
          input.critical_low ?? null,
          input.critical_high ?? null,
          input.test_data_type,
          input.lpc_sort_order,
        ]
      );

      return { id };
    }),

  updateComponent: protectedProcedure
    .input(panelComponentSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const setClauses: string[] = [];
      const values: unknown[] = [id, ctx.user.hospital_id];
      let paramIndex = 3;

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          setClauses.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClauses.length === 0) return { updated: 0 };

      const query = `
        UPDATE lab_panel_components
        SET ${setClauses.join(', ')}
        WHERE id = $1 AND hospital_id = $2
      `;

      await sql(query, values);
      return { updated: 1 };
    }),

  // ===== LAB ORDERS =====

  createLabOrder: protectedProcedure
    .input(labOrderCreateSchema)
    .mutation(async ({ ctx, input }) => {
      // Get panel details
      const panelQuery = await sql(
        `SELECT panel_code, panel_name, sample_type, container_type FROM lab_panels WHERE id = $1 AND hospital_id = $2`,
        [input.lo_panel_id, ctx.user.hospital_id]
      );

      if (panelQuery.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Panel not found' });
      }

      const panel = panelQuery[0];
      const orderNumber = await generateOrderNumber('LO', ctx.user.hospital_id);
      const loId = crypto.randomUUID();
      const spId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Create lab order
      await sql(
        `INSERT INTO lab_orders (
          id, hospital_id, lo_patient_id, lo_encounter_id, lo_service_request_id,
          lo_panel_id, lo_order_number, lo_status, lo_urgency, lo_panel_code, lo_panel_name,
          lo_clinical_notes, lo_ordered_by, lo_ordered_at, lo_is_critical
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false
        )`,
        [
          loId,
          ctx.user.hospital_id,
          input.lo_patient_id,
          input.lo_encounter_id,
          input.lo_service_request_id || null,
          input.lo_panel_id,
          orderNumber,
          'ordered',
          input.lo_urgency,
          panel.panel_code,
          panel.panel_name,
          input.lo_clinical_notes || null,
          input.lo_ordered_by,
          now,
        ]
      );

      // Create specimen record
      await sql(
        `INSERT INTO specimens (
          id, hospital_id, sp_order_id, sp_patient_id, sp_sample_type,
          sp_container_type, sp_status, collection_site
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )`,
        [
          spId,
          ctx.user.hospital_id,
          loId,
          input.lo_patient_id,
          panel.sample_type,
          panel.container_type,
          'pending_collection',
          null,
        ]
      );

      return { id: loId, order_number: orderNumber, specimen_id: spId };
    }),

  listLabOrders: protectedProcedure
    .input(
      z.object({
        status: z.enum(['ordered', 'collected', 'received', 'processing', 'resulted', 'verified', 'cancelled']).optional(),
        urgency: z.enum(['routine', 'urgent', 'stat', 'asap']).optional(),
        patient_id: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT lo.id, lo.lo_order_number, lo.lo_patient_id, lo.lo_status, lo.lo_urgency,
               lo.lo_panel_name, lo.lo_ordered_at, lo.lo_is_critical,
               p.patient_name
        FROM lab_orders lo
        JOIN patients p ON lo.lo_patient_id = p.id
        WHERE lo.hospital_id = $1
          AND (${input.status ?? null}::text IS NULL OR lo.lo_status = ${input.status ?? null})
          AND (${input.urgency ?? null}::text IS NULL OR lo.lo_urgency = ${input.urgency ?? null})
          AND (${input.patient_id ?? null}::text IS NULL OR lo.lo_patient_id = ${input.patient_id ?? null})
        ORDER BY lo.lo_ordered_at DESC
        LIMIT $2 OFFSET $3
      `;

      const orders = await sql(query, [ctx.user.hospital_id, input.limit, input.offset]);
      return orders;
    }),

  getLabOrderDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const orderQuery = `
        SELECT lo.*, p.patient_name
        FROM lab_orders lo
        JOIN patients p ON lo.lo_patient_id = p.id
        WHERE lo.id = $1 AND lo.hospital_id = $2
      `;

      const resultsQuery = `
        SELECT id, lr_component_id, lr_test_code, lr_test_name, value_numeric, value_text,
               value_coded, lr_unit, lr_ref_range_text, lr_flag, lr_is_critical, lr_resulted_at
        FROM lab_results
        WHERE lr_order_id = $1 AND hospital_id = $2
        ORDER BY lr_resulted_at DESC
      `;

      const specimenQuery = `
        SELECT sp_status, sp_collected_at, sp_received_at, sp_rejection_reason
        FROM specimens
        WHERE sp_order_id = $1 AND hospital_id = $2
      `;

      const order = await sql(orderQuery, [input.id, ctx.user.hospital_id]);
      const results = await sql(resultsQuery, [input.id, ctx.user.hospital_id]);
      const specimen = await sql(specimenQuery, [input.id, ctx.user.hospital_id]);

      if (order.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      return {
        order: order[0],
        results,
        specimen: specimen[0] || null,
      };
    }),

  collectSpecimen: protectedProcedure
    .input(specimenCollectionSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      // Update specimen
      await sql(
        `UPDATE specimens
         SET sp_status = 'collected', sp_collected_by = $1, sp_collected_at = $2, collection_site = $3
         WHERE sp_order_id = $4 AND hospital_id = $5`,
        [input.sp_collected_by, now, input.collection_site || null, input.sp_order_id, ctx.user.hospital_id]
      );

      // Update lab order status
      await sql(
        `UPDATE lab_orders SET lo_status = 'collected' WHERE id = $1 AND hospital_id = $2`,
        [input.sp_order_id, ctx.user.hospital_id]
      );

      return { updated: 1 };
    }),

  receiveSpecimen: protectedProcedure
    .input(specimenReceptionSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      // Update specimen
      await sql(
        `UPDATE specimens
         SET sp_status = 'received_lab', sp_received_by = $1, sp_received_at = $2
         WHERE sp_order_id = $3 AND hospital_id = $4`,
        [input.sp_received_by, now, input.sp_order_id, ctx.user.hospital_id]
      );

      // Update lab order status
      await sql(
        `UPDATE lab_orders SET lo_status = 'received', lo_received_at = $1 WHERE id = $2 AND hospital_id = $3`,
        [now, input.sp_order_id, ctx.user.hospital_id]
      );

      return { updated: 1 };
    }),

  enterResults: protectedProcedure
    .input(z.object({ results: z.array(labResultEntrySchema) }))
    .mutation(async ({ ctx, input }) => {
      if (input.results.length === 0) {
        return { inserted: 0 };
      }

      const now = new Date().toISOString();
      const inserted: string[] = [];

      for (const result of input.results) {
        // Get component details to compute flag
        const componentQuery = await sql(
          `SELECT critical_low, critical_high, ref_range_low, ref_range_high FROM lab_panel_components WHERE id = $1 AND hospital_id = $2`,
          [result.lr_component_id, ctx.user.hospital_id]
        );

        let flag = 'normal';
        let is_critical = false;

        if (result.value_numeric !== null && result.value_numeric !== undefined && componentQuery.length > 0) {
          const comp = componentQuery[0];
          const val = result.value_numeric as number;

          if (comp.critical_low !== null && val < comp.critical_low) {
            flag = 'critical_low';
            is_critical = true;
          } else if (comp.critical_high !== null && val > comp.critical_high) {
            flag = 'critical_high';
            is_critical = true;
          } else if (comp.ref_range_low !== null && val < comp.ref_range_low) {
            flag = 'low';
          } else if (comp.ref_range_high !== null && val > comp.ref_range_high) {
            flag = 'high';
          }
        }

        const resultId = crypto.randomUUID();

        await sql(
          `INSERT INTO lab_results (
            id, hospital_id, lr_order_id, lr_component_id, lr_test_code, lr_test_name,
            value_numeric, value_text, value_coded, lr_unit, lr_ref_range_text, lr_flag,
            lr_is_critical, lr_resulted_by, lr_resulted_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
          )`,
          [
            resultId,
            ctx.user.hospital_id,
            result.lr_order_id,
            result.lr_component_id,
            result.lr_test_code,
            result.lr_test_name,
            result.value_numeric ?? null,
            result.value_text ?? null,
            result.value_coded ?? null,
            result.lr_unit || null,
            result.lr_ref_range_text || null,
            flag,
            is_critical,
            result.lr_resulted_by,
            now,
          ]
        );

        inserted.push(resultId);

        // Update order if critical
        if (is_critical) {
          await sql(
            `UPDATE lab_orders SET lo_is_critical = true WHERE id = $1`,
            [result.lr_order_id]
          );
        }
      }

      // Update order status to resulted
      const orderIds = [...new Set(input.results.map((r) => r.lr_order_id))];
      for (const orderId of orderIds) {
        await sql(`UPDATE lab_orders SET lo_status = 'resulted', lo_resulted_at = $1 WHERE id = $2`, [now, orderId]);
      }

      return { inserted: inserted.length };
    }),

  verifyResults: protectedProcedure
    .input(z.object({ id: z.string(), verified_by: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      // Get order details
      const orderQuery = await sql(
        `SELECT lo_ordered_at FROM lab_orders WHERE id = $1 AND hospital_id = $2`,
        [input.id, ctx.user.hospital_id]
      );

      if (orderQuery.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      const ordered_at = new Date(orderQuery[0].lo_ordered_at as string);
      const verified_at = new Date(now);
      const tat_minutes_actual = Math.round((verified_at.getTime() - ordered_at.getTime()) / 60000);

      await sql(
        `UPDATE lab_orders
         SET lo_status = 'verified', lo_verified_by = $1, lo_verified_at = $2, tat_minutes_actual = $3
         WHERE id = $4 AND hospital_id = $5`,
        [input.verified_by, now, tat_minutes_actual, input.id, ctx.user.hospital_id]
      );

      return { updated: 1, tat_minutes_actual };
    }),

  // ===== SPECIMENS =====

  listSpecimens: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(['pending_collection', 'collected', 'in_transit', 'received_lab', 'processing', 'completed', 'rejected'])
          .optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT sp.id, sp.sp_barcode, sp.sp_order_id, sp.sp_status, sp.sp_collected_at, sp.sp_received_at,
               sp.sp_rejection_reason, p.patient_name
        FROM specimens sp
        JOIN lab_orders lo ON sp.sp_order_id = lo.id
        JOIN patients p ON sp.sp_patient_id = p.id
        WHERE sp.hospital_id = $1
          AND (${input.status ?? null}::text IS NULL OR sp.sp_status = ${input.status ?? null})
        ORDER BY sp.sp_collected_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `;

      const specimens = await sql(query, [ctx.user.hospital_id, input.limit, input.offset]);
      return specimens;
    }),

  // ===== RADIOLOGY ORDERS =====

  createRadiologyOrder: protectedProcedure
    .input(radiologyOrderCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const orderNumber = await generateOrderNumber('RO', ctx.user.hospital_id);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await sql(
        `INSERT INTO radiology_orders (
          id, hospital_id, ro_patient_id, ro_encounter_id, ro_service_request_id,
          ro_order_number, ro_modality, study_description, body_part, laterality,
          ro_status, ro_urgency, clinical_indication, contrast_required,
          ro_ordered_by, ro_ordered_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )`,
        [
          id,
          ctx.user.hospital_id,
          input.ro_patient_id,
          input.ro_encounter_id,
          input.ro_service_request_id || null,
          orderNumber,
          input.ro_modality,
          input.study_description,
          input.body_part || null,
          input.laterality,
          'ordered',
          input.ro_urgency,
          input.clinical_indication || null,
          input.contrast_required,
          input.ro_ordered_by,
          now,
        ]
      );

      return { id, order_number: orderNumber };
    }),

  listRadiologyOrders: protectedProcedure
    .input(
      z.object({
        status: z.enum(['ordered', 'scheduled', 'in_progress', 'completed', 'reported', 'verified', 'cancelled']).optional(),
        modality: z.string().optional(),
        urgency: z.enum(['routine', 'urgent', 'stat', 'asap']).optional(),
        patient_id: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT ro.id, ro.ro_order_number, ro.ro_patient_id, ro.ro_modality, ro.study_description,
               ro.ro_status, ro.ro_urgency, ro.scheduled_at, ro.ro_ordered_at,
               p.patient_name
        FROM radiology_orders ro
        JOIN patients p ON ro.ro_patient_id = p.id
        WHERE ro.hospital_id = $1
          AND (${input.status ?? null}::text IS NULL OR ro.ro_status = ${input.status ?? null})
          AND (${input.modality ?? null}::text IS NULL OR ro.ro_modality = ${input.modality ?? null})
          AND (${input.urgency ?? null}::text IS NULL OR ro.ro_urgency = ${input.urgency ?? null})
          AND (${input.patient_id ?? null}::text IS NULL OR ro.ro_patient_id = ${input.patient_id ?? null})
        ORDER BY ro.ro_ordered_at DESC
        LIMIT $2 OFFSET $3
      `;

      const orders = await sql(query, [ctx.user.hospital_id, input.limit, input.offset]);
      return orders;
    }),

  getRadiologyOrderDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const orderQuery = `
        SELECT ro.*, p.patient_name
        FROM radiology_orders ro
        JOIN patients p ON ro.ro_patient_id = p.id
        WHERE ro.id = $1 AND ro.hospital_id = $2
      `;

      const reportQuery = `
        SELECT id, rr2_findings, rr2_impression, rr2_recommendation,
               birads_category, li_rads_category, lung_rads_category,
               rr2_is_critical, rr2_reported_at, rr2_verified_at, rr2_addendum
        FROM radiology_reports
        WHERE rr2_order_id = $1 AND hospital_id = $2
      `;

      const order = await sql(orderQuery, [input.id, ctx.user.hospital_id]);
      const report = await sql(reportQuery, [input.id, ctx.user.hospital_id]);

      if (order.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      return {
        order: order[0],
        report: report[0] || null,
      };
    }),

  scheduleStudy: protectedProcedure
    .input(radiologyScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      await sql(
        `UPDATE radiology_orders
         SET ro_status = 'scheduled', scheduled_at = $1, ro_room = $2
         WHERE id = $3 AND hospital_id = $4`,
        [input.scheduled_at, input.ro_room || null, input.id, ctx.user.hospital_id]
      );

      return { updated: 1 };
    }),

  completeStudy: protectedProcedure
    .input(z.object({ id: z.string(), performed_by: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      await sql(
        `UPDATE radiology_orders
         SET ro_status = 'completed', ro_performed_by = $1, ro_performed_at = $2
         WHERE id = $3 AND hospital_id = $4`,
        [input.performed_by, now, input.id, ctx.user.hospital_id]
      );

      return { updated: 1 };
    }),

  createReport: protectedProcedure
    .input(radiologyReportSchema)
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await sql(
        `INSERT INTO radiology_reports (
          id, hospital_id, rr2_order_id, rr2_findings, rr2_impression, rr2_recommendation,
          birads_category, li_rads_category, lung_rads_category, rr2_is_critical,
          critical_notified_to, rr2_reported_by, rr2_reported_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )`,
        [
          id,
          ctx.user.hospital_id,
          input.rr2_order_id,
          input.rr2_findings,
          input.rr2_impression,
          input.rr2_recommendation || null,
          input.birads_category,
          input.li_rads_category,
          input.lung_rads_category,
          input.rr2_is_critical,
          input.critical_notified_to || null,
          input.rr2_reported_by,
          now,
        ]
      );

      // Update order status
      await sql(
        `UPDATE radiology_orders SET ro_status = 'reported' WHERE id = $1 AND hospital_id = $2`,
        [input.rr2_order_id, ctx.user.hospital_id]
      );

      return { id };
    }),

  verifyReport: protectedProcedure
    .input(z.object({ id: z.string(), verified_by: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      await sql(
        `UPDATE radiology_reports
         SET rr2_verified_by = $1, rr2_verified_at = $2
         WHERE id = $3 AND hospital_id = $4`,
        [input.verified_by, now, input.id, ctx.user.hospital_id]
      );

      // Get order ID and update order status
      const reportQuery = await sql(
        `SELECT rr2_order_id FROM radiology_reports WHERE id = $1 AND hospital_id = $2`,
        [input.id, ctx.user.hospital_id]
      );

      if (reportQuery.length > 0) {
        await sql(
          `UPDATE radiology_orders SET ro_status = 'verified' WHERE id = $1`,
          [reportQuery[0].rr2_order_id]
        );
      }

      return { updated: 1 };
    }),

  addAddendum: protectedProcedure
    .input(radiologyAddendumSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();

      await sql(
        `UPDATE radiology_reports
         SET rr2_addendum = $1, rr2_addendum_by = $2, rr2_addendum_at = $3
         WHERE id = $4 AND hospital_id = $5`,
        [input.rr2_addendum, input.rr2_addendum_by, now, input.id, ctx.user.hospital_id]
      );

      return { updated: 1 };
    }),

  // ===== ANALYTICS =====

  labTATStats: protectedProcedure
    .input(
      z.object({
        days: z.number().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT
          lp.panel_name,
          AVG(lo.tat_minutes_actual) as avg_tat,
          lp.tat_minutes as target_tat,
          COUNT(lo.id) as total_orders,
          SUM(CASE WHEN lo.tat_minutes_actual <= lp.tat_minutes THEN 1 ELSE 0 END)::float / COUNT(lo.id) * 100 as pct_within_target
        FROM lab_orders lo
        JOIN lab_panels lp ON lo.lo_panel_id = lp.id
        WHERE lo.hospital_id = $1
          AND lo.lo_verified_at >= NOW() - INTERVAL '${input.days} days'
          AND lo.lo_status = 'verified'
        GROUP BY lp.panel_name, lp.tat_minutes
        ORDER BY avg_tat DESC
      `;

      const stats = await sql(query, [ctx.user.hospital_id]);
      return stats;
    }),

  criticalValueLog: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT
          lr.id, lr.lr_test_name, lr.value_numeric, lr.lr_flag, lr.lr_resulted_at,
          lo.lo_order_number, p.patient_name
        FROM lab_results lr
        JOIN lab_orders lo ON lr.lr_order_id = lo.id
        JOIN patients p ON lo.lo_patient_id = p.id
        WHERE lr.hospital_id = $1 AND lr.lr_is_critical = true
        ORDER BY lr.lr_resulted_at DESC
        LIMIT $2
      `;

      const results = await sql(query, [ctx.user.hospital_id, input.limit]);
      return results;
    }),

  labWorkload: protectedProcedure
    .input(
      z.object({
        date: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const dateFilter = input.date ? `DATE(lo.lo_ordered_at) = $2` : `DATE(lo.lo_ordered_at) = CURRENT_DATE`;
      const params = input.date ? [ctx.user.hospital_id, input.date] : [ctx.user.hospital_id];

      const query = `
        SELECT
          lo.lo_status,
          lp.lp_department,
          COUNT(lo.id) as order_count
        FROM lab_orders lo
        JOIN lab_panels lp ON lo.lo_panel_id = lp.id
        WHERE lo.hospital_id = $1 AND ${dateFilter}
        GROUP BY lo.lo_status, lp.lp_department
        ORDER BY order_count DESC
      `;

      const workload = await sql(query, params);
      return workload;
    }),

  radiologyWorkload: protectedProcedure
    .input(
      z.object({
        date: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const dateFilter = input.date ? `DATE(ro.ro_ordered_at) = $2` : `DATE(ro.ro_ordered_at) = CURRENT_DATE`;
      const params = input.date ? [ctx.user.hospital_id, input.date] : [ctx.user.hospital_id];

      const query = `
        SELECT
          ro.ro_modality,
          ro.ro_status,
          ro.ro_room,
          COUNT(ro.id) as order_count
        FROM radiology_orders ro
        WHERE ro.hospital_id = $1 AND ${dateFilter}
        GROUP BY ro.ro_modality, ro.ro_status, ro.ro_room
        ORDER BY order_count DESC
      `;

      const workload = await sql(query, params);
      return workload;
    }),

  specimenRejectionRate: protectedProcedure
    .input(
      z.object({
        days: z.number().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const query = `
        SELECT
          sp.sp_rejection_reason,
          COUNT(sp.id) as rejection_count,
          COUNT(sp.id)::float / (SELECT COUNT(*) FROM specimens WHERE hospital_id = $1 AND sp_collected_at >= NOW() - INTERVAL '${input.days} days') * 100 as pct_of_total
        FROM specimens sp
        WHERE sp.hospital_id = $1
          AND sp.sp_status = 'rejected'
          AND sp.sp_collected_at >= NOW() - INTERVAL '${input.days} days'
        GROUP BY sp.sp_rejection_reason
        ORDER BY rejection_count DESC
      `;

      const stats = await sql(query, [ctx.user.hospital_id]);
      return stats;
    }),
});
