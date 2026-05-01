import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';

// ============================================================
// SCM › VENDORS — Phase 1.4 router split (Q2 Path C)
//
// Extracted from pharmacy.ts (4 procedures: createVendor, listVendors,
// updateVendor, vendorDetail). Vendors live in 12-pharmacy.ts schema for
// now (used by both Pharmacy clinical AND SCM); cross-PRD review in
// Phase 2 may relocate the table to 63-scm-core.ts.
//
// Procedures are exported BOTH as named constants (vendorCreateProcedure,
// etc.) AND through scmVendorsRouter. This dual-export pattern lets
// pharmacy-clinical.ts re-export the same procedure objects under the
// legacy pharmacy.* namespace for backward compat — no logic duplication.
// Phase 8 removes those deprecation re-exports.
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Validation schemas ----------

export const vendorSchema = z.object({
  vendor_code: z.string().min(1),
  vendor_name: z.string().min(1),
  contact_person: z.string().min(1),
  vendor_phone: z.string().min(1),
  vendor_email: z.string().email(),
  vendor_address: z.string().min(1),
  vendor_gst: z.string().optional(),
  drug_license: z.string().optional(),
  license_expiry: z.string().optional(),
  payment_terms_days: z.number().int().positive(),
  vendor_is_active: z.boolean().default(true),
});

// ---------- Named procedure exports (shared with pharmacy-clinical re-exports) ----------

/** Create a vendor. Hospital-scoped via JWT.hospital_id (4-tenant Day-1 multi-tenancy). */
export const vendorCreateProcedure = protectedProcedure
  .input(vendorSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['scm_admin']);
      const result = await getSql()(
        `INSERT INTO vendors
        (hospital_id, vendor_code, vendor_name, contact_person, vendor_phone, vendor_email,
         vendor_address, vendor_gst, drug_license, license_expiry, payment_terms_days, vendor_is_active, vendor_created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING *`,
        [
          ctx.user.hospital_id,
          input.vendor_code,
          input.vendor_name,
          input.contact_person,
          input.vendor_phone,
          input.vendor_email,
          input.vendor_address,
          input.vendor_gst || null,
          input.drug_license || null,
          input.license_expiry || null,
          input.payment_terms_days,
          input.vendor_is_active,
        ]
      );

      // Audit log (every mutation per V's standing rule)
      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'vendors', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          result[0].id,
          JSON.stringify({ vendor_code: input.vendor_code, vendor_name: input.vendor_name }),
        ]
      );

      return result[0];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create vendor',
        cause: error,
      });
    }
  });

/** List vendors for the current hospital. Optional filter: is_active. */
export const vendorListProcedure = protectedProcedure
  .input(
    z.object({
      is_active: z.boolean().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    try {
      const vendors = await getSql()(
        `SELECT * FROM vendors
        WHERE hospital_id = $1
        AND (${input.is_active ?? null}::boolean IS NULL OR vendor_is_active = ${input.is_active ?? null})
        ORDER BY vendor_name ASC`,
        [ctx.user.hospital_id]
      );
      return vendors;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list vendors',
        cause: error,
      });
    }
  });

/** Update a vendor (partial fields). */
export const vendorUpdateProcedure = protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      ...vendorSchema.partial().shape,
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    try {
      await assertHasScmRole(ctx, ['scm_admin']);
      const setClause = Object.keys(updates)
        .map((key, idx) => `${key} = $${idx + 2}`)
        .join(', ');

      const result = await getSql()(
        `UPDATE vendors
        SET ${setClause}
        WHERE id = $1 AND hospital_id = $${Object.keys(updates).length + 2}
        RETURNING *`,
        [id, ...Object.values(updates), ctx.user.hospital_id]
      );

      if (!result.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Vendor not found',
        });
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'vendors', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          id,
          JSON.stringify(updates),
        ]
      );

      return result[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update vendor',
        cause: error,
      });
    }
  });

/** Get a single vendor by id (hospital-scoped). */
export const vendorDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    try {
      const vendor = await getSql()(
        `SELECT * FROM vendors
        WHERE id = $1 AND hospital_id = $2`,
        [input, ctx.user.hospital_id]
      );

      if (!vendor.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Vendor not found',
        });
      }
      return vendor[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch vendor details',
        cause: error,
      });
    }
  });

// ---------- Router ----------

export const scmVendorsRouter = router({
  create: vendorCreateProcedure,
  list: vendorListProcedure,
  update: vendorUpdateProcedure,
  detail: vendorDetailProcedure,
});
