import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  externalLabs, externalLabPricing, externalLabOrders, labPanels, labOrders, patients, encounters, users,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, or, sql, desc, asc, inArray, count, like, gte, lte, not } from 'drizzle-orm';

// ============================================================
// EXTERNAL LAB MASTER — B.1
// 14 endpoints: labs, pricing, orders, stats
// ============================================================

export const externalLabsRouter = router({

  // ──────────────────────────────────────────────────────────────────
  // LAB MANAGEMENT
  // ──────────────────────────────────────────────────────────────────

  // List external labs with filters
  listLabs: protectedProcedure
    .input(z.object({
      skip: z.number().int().min(0).default(0),
      take: z.number().int().min(1).max(100).default(20),
      is_active: z.boolean().optional(),
      city: z.string().optional(),
      nabl_accredited: z.boolean().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [
        eq(externalLabs.hospital_id, ctx.user.hospital_id),
      ];

      if (input.is_active !== undefined) {
        filters.push(eq(externalLabs.is_active, input.is_active));
      }
      if (input.city) {
        filters.push(eq(externalLabs.city, input.city));
      }
      if (input.nabl_accredited !== undefined) {
        filters.push(eq(externalLabs.nabl_accredited, input.nabl_accredited));
      }
      if (input.search) {
        const searchFilter = or(
          like(externalLabs.lab_name, `%${input.search}%`),
          like(externalLabs.lab_code, `%${input.search}%`),
          like(externalLabs.contact_person, `%${input.search}%`),
        );
        if (searchFilter) filters.push(searchFilter);
      }

      const rows = await db.select().from(externalLabs)
        .where(and(...filters))
        .orderBy(desc(externalLabs.created_at))
        .limit(input.take)
        .offset(input.skip);

      const countRes = await db.select({ count: count() })
        .from(externalLabs)
        .where(and(...filters));

      return {
        data: rows,
        total: countRes[0]?.count || 0,
      };
    }),

  // Get single lab by id
  getLab: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const [lab] = await db.select().from(externalLabs)
        .where(and(
          eq(externalLabs.id, input.id as any),
          eq(externalLabs.hospital_id, ctx.user.hospital_id),
        ));

      if (!lab) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
      }

      return lab;
    }),

  // Create new external lab
  createLab: adminProcedure
    .input(z.object({
      lab_name: z.string().min(1),
      lab_code: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      contact_person: z.string().optional(),
      contact_phone: z.string().optional(),
      contact_email: z.string().email().optional(),
      nabl_accredited: z.boolean().default(false),
      nabl_certificate_number: z.string().optional(),
      nabl_valid_until: z.string().optional(), // ISO date
      cap_accredited: z.boolean().default(false),
      contract_type: z.enum(['monthly', 'per_test', 'annual', 'panel_rate']).optional(),
      contract_start: z.string().optional(), // ISO date
      contract_end: z.string().optional(), // ISO date
      default_tat_hours: z.number().int().min(1).default(48),
      payment_terms: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [lab] = await db.insert(externalLabs).values({
        hospital_id: ctx.user.hospital_id,
        lab_name: input.lab_name,
        lab_code: input.lab_code || null,
        address: input.address || null,
        city: input.city || null,
        state: input.state || null,
        pincode: input.pincode || null,
        contact_person: input.contact_person || null,
        contact_phone: input.contact_phone || null,
        contact_email: input.contact_email || null,
        nabl_accredited: input.nabl_accredited,
        nabl_certificate_number: input.nabl_certificate_number || null,
        nabl_valid_until: input.nabl_valid_until || null,
        cap_accredited: input.cap_accredited,
        contract_type: input.contract_type || null,
        contract_start: input.contract_start || null,
        contract_end: input.contract_end || null,
        default_tat_hours: input.default_tat_hours,
        payment_terms: input.payment_terms || null,
        notes: input.notes || null,
        is_active: true,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'external_labs',
        row_id: lab.id,
        new_values: { lab_name: lab.lab_name, city: lab.city },
        reason: 'Created external lab',
      });

      return lab;
    }),

  // Update lab details
  updateLab: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      lab_name: z.string().min(1).optional(),
      lab_code: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      contact_person: z.string().optional(),
      contact_phone: z.string().optional(),
      contact_email: z.string().email().optional(),
      nabl_accredited: z.boolean().optional(),
      nabl_certificate_number: z.string().optional(),
      nabl_valid_until: z.string().optional(),
      cap_accredited: z.boolean().optional(),
      contract_type: z.enum(['monthly', 'per_test', 'annual', 'panel_rate']).optional(),
      contract_start: z.string().optional(),
      contract_end: z.string().optional(),
      default_tat_hours: z.number().int().min(1).optional(),
      payment_terms: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      // Verify lab exists and belongs to hospital
      const [existing] = await db.select().from(externalLabs)
        .where(and(
          eq(externalLabs.id, id as any),
          eq(externalLabs.hospital_id, ctx.user.hospital_id),
        ));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
      }

      const updates: any = {
        updated_at: new Date(),
      };

      if (updateData.lab_name !== undefined) updates.lab_name = updateData.lab_name;
      if (updateData.lab_code !== undefined) updates.lab_code = updateData.lab_code || null;
      if (updateData.address !== undefined) updates.address = updateData.address || null;
      if (updateData.city !== undefined) updates.city = updateData.city || null;
      if (updateData.state !== undefined) updates.state = updateData.state || null;
      if (updateData.pincode !== undefined) updates.pincode = updateData.pincode || null;
      if (updateData.contact_person !== undefined) updates.contact_person = updateData.contact_person || null;
      if (updateData.contact_phone !== undefined) updates.contact_phone = updateData.contact_phone || null;
      if (updateData.contact_email !== undefined) updates.contact_email = updateData.contact_email || null;
      if (updateData.nabl_accredited !== undefined) updates.nabl_accredited = updateData.nabl_accredited;
      if (updateData.nabl_certificate_number !== undefined) updates.nabl_certificate_number = updateData.nabl_certificate_number || null;
      if (updateData.nabl_valid_until !== undefined) updates.nabl_valid_until = updateData.nabl_valid_until ? new Date(updateData.nabl_valid_until) : null;
      if (updateData.cap_accredited !== undefined) updates.cap_accredited = updateData.cap_accredited;
      if (updateData.contract_type !== undefined) updates.contract_type = updateData.contract_type || null;
      if (updateData.contract_start !== undefined) updates.contract_start = updateData.contract_start ? new Date(updateData.contract_start) : null;
      if (updateData.contract_end !== undefined) updates.contract_end = updateData.contract_end ? new Date(updateData.contract_end) : null;
      if (updateData.default_tat_hours !== undefined) updates.default_tat_hours = updateData.default_tat_hours;
      if (updateData.payment_terms !== undefined) updates.payment_terms = updateData.payment_terms || null;
      if (updateData.notes !== undefined) updates.notes = updateData.notes || null;

      const [lab] = await db.update(externalLabs)
        .set(updates)
        .where(eq(externalLabs.id, id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_labs',
        row_id: id,
        new_values: Object.fromEntries(
          Object.entries(updates).filter(([k]) => !['updated_at'].includes(k))
        ),
        reason: 'Updated external lab details',
      });

      return lab;
    }),

  // Toggle is_active
  toggleActive: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      is_active: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [lab] = await db.update(externalLabs)
        .set({ is_active: input.is_active, updated_at: new Date() })
        .where(and(
          eq(externalLabs.id, input.id as any),
          eq(externalLabs.hospital_id, ctx.user.hospital_id),
        ))
        .returning();

      if (!lab) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
      }

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_labs',
        row_id: input.id,
        new_values: { is_active: input.is_active },
        reason: input.is_active ? 'Reactivated lab' : 'Deactivated lab',
      });

      return lab;
    }),

  // ──────────────────────────────────────────────────────────────────
  // PRICING MANAGEMENT
  // ──────────────────────────────────────────────────────────────────

  // List pricing for a lab or test
  listPricing: protectedProcedure
    .input(z.object({
      external_lab_id: z.string().uuid().optional(),
      panel_id: z.string().uuid().optional(),
      is_active: z.boolean().optional(),
      skip: z.number().int().min(0).default(0),
      take: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [
        eq(externalLabPricing.hospital_id, ctx.user.hospital_id),
      ];

      if (input.external_lab_id) {
        filters.push(eq(externalLabPricing.external_lab_id, input.external_lab_id as any));
      }
      if (input.panel_id) {
        filters.push(eq(externalLabPricing.panel_id, input.panel_id as any));
      }
      if (input.is_active !== undefined) {
        filters.push(eq(externalLabPricing.is_active, input.is_active));
      }

      const rows = await db.select().from(externalLabPricing)
        .where(and(...filters))
        .orderBy(desc(externalLabPricing.created_at))
        .limit(input.take)
        .offset(input.skip);

      const countRes = await db.select({ count: count() })
        .from(externalLabPricing)
        .where(and(...filters));

      return {
        data: rows,
        total: countRes[0]?.count || 0,
      };
    }),

  // Create or update pricing (upsert)
  setPricing: adminProcedure
    .input(z.object({
      external_lab_id: z.string().uuid(),
      panel_id: z.string().uuid().optional(),
      test_code: z.string(),
      test_name: z.string(),
      cost_price: z.string(), // decimal from form
      patient_price: z.string(),
      is_preferred: z.boolean().default(false),
      tat_hours: z.number().int().optional(),
      effective_from: z.string().optional(),
      effective_to: z.string().optional(),
      notes: z.string().optional(),
      id: z.string().uuid().optional(), // For update
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify lab exists
      const [lab] = await db.select().from(externalLabs)
        .where(and(
          eq(externalLabs.id, input.external_lab_id as any),
          eq(externalLabs.hospital_id, ctx.user.hospital_id),
        ));

      if (!lab) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab not found' });
      }

      const now = new Date();
      const data: any = {
        hospital_id: ctx.user.hospital_id,
        external_lab_id: input.external_lab_id,
        panel_id: input.panel_id || null,
        test_code: input.test_code,
        test_name: input.test_name,
        cost_price: String(input.cost_price),
        patient_price: String(input.patient_price),
        is_preferred: input.is_preferred,
        tat_hours: input.tat_hours || null,
        effective_from: input.effective_from || null,
        effective_to: input.effective_to || null,
        notes: input.notes || null,
        is_active: true,
        updated_at: now,
      };

      let pricing;
      if (input.id) {
        // Update
        [pricing] = await db.update(externalLabPricing)
          .set(data)
          .where(and(
            eq(externalLabPricing.id, input.id as any),
            eq(externalLabPricing.hospital_id, ctx.user.hospital_id),
          ))
          .returning();

        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'external_lab_pricing',
          row_id: input.id,
          new_values: { test_name: input.test_name, cost_price: input.cost_price, patient_price: input.patient_price },
          reason: 'Updated pricing',
        });
      } else {
        // Insert
        [pricing] = await db.insert(externalLabPricing).values({
          ...data,
          created_by: ctx.user.sub as any,
          created_at: now,
        }).returning();

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'external_lab_pricing',
          row_id: pricing.id,
          new_values: { test_name: input.test_name, cost_price: input.cost_price },
          reason: 'Created pricing entry',
        });
      }

      return pricing;
    }),

  // Remove pricing (soft-delete)
  removePricing: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [pricing] = await db.update(externalLabPricing)
        .set({ is_active: false, updated_at: new Date() })
        .where(and(
          eq(externalLabPricing.id, input.id as any),
          eq(externalLabPricing.hospital_id, ctx.user.hospital_id),
        ))
        .returning();

      if (!pricing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pricing not found' });
      }

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_lab_pricing',
        row_id: input.id,
        new_values: { is_active: false },
        reason: 'Removed pricing',
      });

      return pricing;
    }),

  // Get preferred lab for a test
  getPreferredLab: protectedProcedure
    .input(z.object({
      panel_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const [pricing] = await db.select().from(externalLabPricing)
        .where(and(
          eq(externalLabPricing.hospital_id, ctx.user.hospital_id),
          eq(externalLabPricing.panel_id, input.panel_id as any),
          eq(externalLabPricing.is_preferred, true),
          eq(externalLabPricing.is_active, true),
        ));

      return pricing || null;
    }),

  // ──────────────────────────────────────────────────────────────────
  // ORDER MANAGEMENT
  // ──────────────────────────────────────────────────────────────────

  // Create external lab order
  createOrder: protectedProcedure
    .input(z.object({
      lab_order_id: z.string().uuid(),
      external_lab_id: z.string().uuid(),
      external_lab_pricing_id: z.string().uuid().optional(),
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify lab_order exists
      const [labOrder] = await db.select().from(labOrders)
        .where(eq(labOrders.id, input.lab_order_id as any));

      if (!labOrder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab order not found' });
      }

      // Get TAT from external lab
      const [lab] = await db.select().from(externalLabs)
        .where(eq(externalLabs.id, input.external_lab_id as any));

      const tatPromisedHours = lab?.default_tat_hours || 48;

      const [order] = await db.insert(externalLabOrders).values({
        hospital_id: ctx.user.hospital_id,
        lab_order_id: input.lab_order_id,
        external_lab_id: input.external_lab_id,
        external_lab_pricing_id: input.external_lab_pricing_id || null,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id || null,
        status: 'pending_dispatch',
        tat_promised_hours: tatPromisedHours,
        tat_breach: false,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'external_lab_orders',
        row_id: order.id,
        new_values: { status: 'pending_dispatch', external_lab_id: input.external_lab_id },
        reason: 'Created external lab order',
      });

      return order;
    }),

  // Update order status
  updateOrderStatus: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum([
        'pending_dispatch', 'dispatched', 'received_by_lab', 'processing',
        'results_received', 'results_entered', 'verified', 'cancelled', 'rejected'
      ]),
      dispatch_date: z.string().optional(),
      dispatch_method: z.enum(['courier', 'pickup', 'digital']).optional(),
      dispatch_tracking: z.string().optional(),
      received_at: z.string().optional(),
      processing_at: z.string().optional(),
      results_received_at: z.string().optional(),
      results_entered_at: z.string().optional(),
      verified_at: z.string().optional(),
      rejection_reason: z.string().optional(),
      document_url: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      const updates: any = {
        status: input.status,
        updated_at: new Date(),
      };

      if (input.dispatch_date) updates.dispatch_date = new Date(input.dispatch_date);
      if (input.dispatch_method) updates.dispatch_method = input.dispatch_method;
      if (input.dispatch_tracking) updates.dispatch_tracking = input.dispatch_tracking;
      if (input.received_at) updates.received_at = new Date(input.received_at);
      if (input.processing_at) updates.processing_at = new Date(input.processing_at);
      if (input.results_received_at) {
        updates.results_received_at = new Date(input.results_received_at);
        // Calculate TAT breach if dispatch_date exists
        if (existing.dispatch_date && existing.tat_promised_hours) {
          const actualMs = new Date(input.results_received_at).getTime() - existing.dispatch_date.getTime();
          const actualHours = Math.round(actualMs / (1000 * 60 * 60) * 100) / 100;
          updates.tat_actual_hours = actualHours;
          updates.tat_breach = actualHours > existing.tat_promised_hours;
        }
      }
      if (input.results_entered_at) updates.results_entered_at = new Date(input.results_entered_at);
      if (input.results_entered_at) updates.results_entered_by = ctx.user.sub as any;
      if (input.verified_at) updates.verified_at = new Date(input.verified_at);
      if (input.verified_at) updates.verified_by = ctx.user.sub as any;
      if (input.rejection_reason) updates.rejection_reason = input.rejection_reason;
      if (input.document_url) updates.document_url = input.document_url;
      if (input.notes) updates.notes = input.notes;

      const [order] = await db.update(externalLabOrders)
        .set(updates)
        .where(eq(externalLabOrders.id, input.id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'external_lab_orders',
        row_id: input.id,
        new_values: { status: input.status },
        reason: `Updated status to ${input.status}`,
      });

      return order;
    }),

  // List orders with filters
  listOrders: protectedProcedure
    .input(z.object({
      skip: z.number().int().min(0).default(0),
      take: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      external_lab_id: z.string().uuid().optional(),
      tat_breach: z.boolean().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const filters = [
        eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
      ];

      if (input.status) {
        filters.push(eq(externalLabOrders.status, input.status as any));
      }
      if (input.external_lab_id) {
        filters.push(eq(externalLabOrders.external_lab_id, input.external_lab_id as any));
      }
      if (input.tat_breach !== undefined) {
        filters.push(eq(externalLabOrders.tat_breach, input.tat_breach));
      }
      if (input.from_date) {
        filters.push(gte(externalLabOrders.created_at, new Date(input.from_date)));
      }
      if (input.to_date) {
        filters.push(lte(externalLabOrders.created_at, new Date(input.to_date)));
      }

      const rows = await db.select().from(externalLabOrders)
        .where(and(...filters))
        .orderBy(desc(externalLabOrders.created_at))
        .limit(input.take)
        .offset(input.skip);

      const countRes = await db.select({ count: count() })
        .from(externalLabOrders)
        .where(and(...filters));

      return {
        data: rows,
        total: countRes[0]?.count || 0,
      };
    }),

  // Get single order with details
  getOrder: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const [order] = await db.select().from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.id, input.id as any),
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
        ));

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      // Get related data
      const [lab] = await db.select().from(externalLabs).where(eq(externalLabs.id, order.external_lab_id));
      const [pricing] = order.external_lab_pricing_id
        ? await db.select().from(externalLabPricing).where(eq(externalLabPricing.id, order.external_lab_pricing_id))
        : [null];

      return {
        ...order,
        lab,
        pricing,
      };
    }),

  // ──────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ──────────────────────────────────────────────────────────────────

  // Stats dashboard
  stats: protectedProcedure
    .input(z.object({
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Total active labs
      const [{ count: totalLabs }] = await db.select({ count: count() })
        .from(externalLabs)
        .where(and(
          eq(externalLabs.hospital_id, ctx.user.hospital_id),
          eq(externalLabs.is_active, true),
        ));

      // Orders this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [{ count: ordersThisMonth }] = await db.select({ count: count() })
        .from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          gte(externalLabOrders.created_at, monthStart),
        ));

      // TAT compliance & breaches
      const [{ count: completedOrders }] = await db.select({ count: count() })
        .from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          inArray(externalLabOrders.status, ['verified', 'results_entered']),
        ));

      const [{ count: breachCount }] = await db.select({ count: count() })
        .from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          eq(externalLabOrders.tat_breach, true),
        ));

      const tatCompliance = completedOrders > 0
        ? Math.round(((completedOrders - breachCount) / completedOrders) * 100)
        : 100;

      // Avg cost
      const costRows = await db.select({ avg: sql`AVG(CAST(cost_amount as FLOAT))` })
        .from(externalLabOrders)
        .where(and(
          eq(externalLabOrders.hospital_id, ctx.user.hospital_id),
          not(sql`cost_amount IS NULL`),
        ));

      const avgCost = costRows[0]?.avg ? parseFloat(String(costRows[0].avg)) : 0;

      // Top labs by volume
      const topLabs = await db.select({
        lab_id: externalLabOrders.external_lab_id,
        count: count(),
      })
        .from(externalLabOrders)
        .innerJoin(externalLabs, eq(externalLabOrders.external_lab_id, externalLabs.id))
        .where(eq(externalLabOrders.hospital_id, ctx.user.hospital_id))
        .groupBy(externalLabOrders.external_lab_id)
        .orderBy(desc(count()))
        .limit(5);

      return {
        total_labs: totalLabs || 0,
        orders_this_month: ordersThisMonth || 0,
        tat_compliance_percent: tatCompliance,
        breach_count: breachCount || 0,
        avg_cost: avgCost,
        completed_orders: completedOrders || 0,
        top_labs: topLabs,
      };
    }),

});
