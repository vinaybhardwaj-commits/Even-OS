import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';
import { SERVICE_TYPES, bucketKey } from '@/lib/codes/service-code-utils';

// =============================================================================
// codes.services.* — service code catalog router (Phase 3)
// =============================================================================
// Symmetric to codes.items.* (Phase 1). Atomic CTE-based create with bucket
// counter increment, mirroring inventory_serial_counters / inventory_items
// pattern from CodeCreator.
//
// Approval workflow: services share inventory_items.status state machine;
// new rows insert with status='draft'. Submit / approve / reject go through
// codes.approvals.* (Phase 2 router) — service_codes lives in same bucket
// as inventory_items there. NB: Phase 2's codes.approvals router currently
// reads inventory_items only; cross-table support lands in Phase 3.B.
// =============================================================================

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

function assertAdmin(ctx: { user: { role: string } }) {
  if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Codes Phase 3: only super_admin / hospital_admin may write. RBAC roles refine this in Phase 6 module-wide refactor.',
    });
  }
}

// ─── services.create — atomic CTE: counter UPSERT + insert ──────────────────

const serviceCreateSchema = z.object({
  service_type_code: z.enum(SERVICE_TYPES),
  department_code: z.string().regex(/^[A-Z]{3,5}$/),
  subdepartment_id: z.string().uuid().optional(),
  service_name: z.string().min(1).max(500),
  legacy_code: z.string().optional(),
  is_prescription_required: z.boolean().default(false),
  is_orderable: z.boolean().default(true),
  is_chargeable: z.boolean().default(true),
  is_searchable: z.boolean().default(true),
  is_validity_period_required: z.boolean().default(false),
  validity_period_days: z.number().int().positive().optional(),
  patient_type: z.enum(['all','ipd','opd','er','daycare']).default('all'),
  gender: z.enum(['all','male','female','other']).default('all'),
  is_tax_applicable: z.boolean().default(false),
  unit_tax_amount: z.number().nonnegative().default(0),
  tax_type: z.enum(['GST','CESS','IGST','SGST','CGST','NA']).default('NA'),
  tax_value_percent: z.number().nonnegative().default(0),
  is_hospital_cost_applicable: z.boolean().default(false),
  nurse_remark: z.string().optional(),
  patient_billing_remark: z.string().optional(),
  ordering_department: z.string().optional(),
  ordering_specialty: z.string().optional(),
  is_reason_for_request_mandatory: z.boolean().default(false),
  package_type: z.enum(['opd','ipd','health_check','NA']).default('NA'),
  package_subtype: z.string().optional(),
  show_online: z.boolean().default(false),
  part_of_package: z.boolean().default(false),
  is_editable_price: z.boolean().default(false),
  order_frequency: z.enum(['STAT','BID','TID','QID','DAILY','PRN','NA']).default('NA'),
  order_quantity_default: z.number().int().min(1).default(1),
  is_cosmetic: z.boolean().default(false),
  notes: z.string().optional(),
});

export const servicesCreateProcedure = protectedProcedure
  .input(serviceCreateSchema)
  .mutation(async ({ ctx, input }) => {
    assertAdmin(ctx);
    const sql = getSql();
    const bucket = bucketKey({
      service_type_code: input.service_type_code,
      department_code: input.department_code,
    });
    const hospital_id = ctx.user.hospital_id;

    // Atomic CTE: increment counter, format service_code, insert with status='draft'
    const result = (await sql`
      WITH next_serial AS (
        INSERT INTO service_serial_counters (bucket, last_serial)
        VALUES (${bucket}, 1)
        ON CONFLICT (bucket) DO UPDATE
          SET last_serial = service_serial_counters.last_serial + 1,
              updated_at = NOW()
        RETURNING last_serial
      )
      INSERT INTO service_codes (
        hospital_id, service_code, service_type_code, department_code,
        subdepartment_id, serial,
        service_name, legacy_code,
        is_prescription_required, is_orderable, is_chargeable, is_searchable,
        is_validity_period_required, validity_period_days,
        status,
        patient_type, gender,
        is_tax_applicable, unit_tax_amount, tax_type, tax_value_percent,
        is_hospital_cost_applicable,
        nurse_remark, patient_billing_remark,
        ordering_department, ordering_specialty, is_reason_for_request_mandatory,
        package_type, package_subtype, show_online, part_of_package, is_editable_price,
        order_frequency, order_quantity_default,
        is_cosmetic, source, notes,
        created_by, updated_by
      )
      SELECT
        ${hospital_id},
        'S-' || ${input.service_type_code} || '-' || ${input.department_code} || '-' || lpad(ns.last_serial::text, 4, '0'),
        ${input.service_type_code}, ${input.department_code},
        ${input.subdepartment_id ?? null}, ns.last_serial,
        ${input.service_name}, ${input.legacy_code ?? null},
        ${input.is_prescription_required}, ${input.is_orderable}, ${input.is_chargeable}, ${input.is_searchable},
        ${input.is_validity_period_required}, ${input.validity_period_days ?? null},
        'draft',
        ${input.patient_type}, ${input.gender},
        ${input.is_tax_applicable}, ${input.unit_tax_amount.toFixed(2)}, ${input.tax_type}, ${input.tax_value_percent.toFixed(2)},
        ${input.is_hospital_cost_applicable},
        ${input.nurse_remark ?? null}, ${input.patient_billing_remark ?? null},
        ${input.ordering_department ?? null}, ${input.ordering_specialty ?? null}, ${input.is_reason_for_request_mandatory},
        ${input.package_type}, ${input.package_subtype ?? null}, ${input.show_online}, ${input.part_of_package}, ${input.is_editable_price},
        ${input.order_frequency}, ${input.order_quantity_default},
        ${input.is_cosmetic}, 'manual', ${input.notes ?? null},
        ${ctx.user.sub}, ${ctx.user.sub}
      FROM next_serial ns
      RETURNING id, service_code, service_name, status, serial
    `) as any[];

    if (!result.length) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Service create returned no row' });
    }
    return result[0];
  });

// ─── services.detail ────────────────────────────────────────────────────────

export const servicesDetailProcedure = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    const rows = (await sql`
      SELECT * FROM service_codes WHERE id = ${input.id} AND hospital_id = ${ctx.user.hospital_id} LIMIT 1
    `) as any[];
    if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service not found' });
    return rows[0];
  });

// ─── services.list ──────────────────────────────────────────────────────────

export const servicesListProcedure = protectedProcedure
  .input(z.object({
    service_type_code: z.enum(SERVICE_TYPES).optional(),
    department_code: z.string().optional(),
    status: z.array(z.string()).optional(),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  }))
  .query(async ({ ctx, input }) => {
    const sql = getSql();
    // Phase 3 default: show all statuses for admin browse. Caregiver-facing
    // surfaces should pass status=['active'] explicitly (see codes.items.list
    // pattern from Phase 2.4).
    const effectiveStatus = input.status ?? null;
    const params: any[] = [ctx.user.hospital_id];
    let where = 'hospital_id = $1';
    let p = 2;
    if (input.service_type_code) { where += ` AND service_type_code = $${p++}`; params.push(input.service_type_code); }
    if (input.department_code) { where += ` AND department_code = $${p++}`; params.push(input.department_code); }
    if (effectiveStatus && effectiveStatus.length) {
      where += ` AND status = ANY($${p++}::text[])`;
      params.push(effectiveStatus);
    }
    params.push(input.limit, input.offset);
    return sql(
      `SELECT id, service_code, service_type_code, department_code, service_name,
              status, is_orderable, is_chargeable, source, created_at
         FROM service_codes
        WHERE ${where}
        ORDER BY service_code ASC
        LIMIT $${p++} OFFSET $${p++}`,
      params,
    );
  });

// ─── services.search ────────────────────────────────────────────────────────

export const servicesSearchProcedure = protectedProcedure
  .input(z.object({
    q: z.string(),
    limit: z.number().int().positive().max(50).default(10),
    /** Caregiver-safe default — pass true on admin surfaces. */
    include_drafts: z.boolean().default(false),
  }))
  .query(async ({ ctx, input }) => {
    const q = input.q.trim();
    if (q.length < 2) return { results: [], q };
    const pat = `%${q}%`;
    const sql = getSql();
    const rows = (await sql`
      SELECT id, service_code, service_type_code, department_code, service_name, status
      FROM service_codes
      WHERE hospital_id = ${ctx.user.hospital_id}
        AND (service_code ILIKE ${pat} OR service_name ILIKE ${pat} OR legacy_code ILIKE ${pat})
        AND (${input.include_drafts}::boolean OR status = 'active')
      ORDER BY
        CASE
          WHEN service_code ILIKE ${pat} THEN 1
          WHEN service_name ILIKE ${pat} THEN 2
          ELSE 3
        END,
        length(service_name)
      LIMIT ${input.limit}
    `) as any[];
    return { results: rows, q };
  });

// ─── services.lookups.* (read-only for now; CRUD lands in Phase 4) ──────────

export const servicesLookupsTypesProcedure = protectedProcedure.query(async () => {
  const sql = getSql();
  return (await sql`SELECT * FROM service_lookup_types WHERE is_active = TRUE ORDER BY sort_order, code`) as any[];
});

export const servicesLookupsDepartmentsProcedure = protectedProcedure.query(async () => {
  const sql = getSql();
  return (await sql`SELECT * FROM service_lookup_departments WHERE is_active = TRUE ORDER BY sort_order, code`) as any[];
});

export const servicesLookupsSubdepartmentsProcedure = protectedProcedure
  .input(z.object({ department_code: z.string().optional() }).optional())
  .query(async ({ input }) => {
    const sql = getSql();
    if (input?.department_code) {
      return (await sql`
        SELECT * FROM service_lookup_subdepartments
         WHERE department_code = ${input.department_code} AND is_active = TRUE
        ORDER BY sort_order
      `) as any[];
    }
    return (await sql`SELECT * FROM service_lookup_subdepartments WHERE is_active = TRUE ORDER BY department_code, sort_order`) as any[];
  });

// ─── Composed router ───────────────────────────────────────────────────────

export const codesServicesRouter = router({
  create: servicesCreateProcedure,
  detail: servicesDetailProcedure,
  list: servicesListProcedure,
  search: servicesSearchProcedure,
  lookups: router({
    types: servicesLookupsTypesProcedure,
    departments: servicesLookupsDepartmentsProcedure,
    subdepartments: servicesLookupsSubdepartmentsProcedure,
  }),
});
