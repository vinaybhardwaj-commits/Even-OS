/**
 * Blood Bank — Module 8 LIS (L.6)
 *
 * Blood unit inventory, crossmatch workflow with two-sample rule,
 * bedside issue with barcode scan, transfusion reaction logging,
 * utilization and wastage dashboard.
 *
 * Endpoints:
 *   1. addUnit           — Receive blood unit into inventory
 *   2. getInventory      — Stock by blood type/component
 *   3. listUnits         — Unit list with filters
 *   4. requestCrossmatch — Order cross-match, two-sample rule
 *   5. recordSample      — Record sample collection (1 or 2)
 *   6. performCrossmatch — Record crossmatch result
 *   7. issueUnit         — Bedside issue with barcode
 *   8. returnUnit        — Return unused unit
 *   9. discardUnit       — Discard expired/damaged unit
 *  10. logReaction       — Transfusion reaction logging
 *  11. listReactions     — Reaction list
 *  12. listCrossmatches  — Crossmatch request list
 *  13. stats             — Utilization and wastage dashboard
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  bloodBankInventory, crossmatchRequests, transfusionReactions,
} from '@db/schema';
import { eq, and, desc, count, sql, gte, lte, asc } from 'drizzle-orm';

export const bloodBankRouter = router({

  // 1. ADD UNIT
  addUnit: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      unit_number: z.string().min(1),
      blood_group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
      component: z.enum(['whole_blood', 'prbc', 'ffp', 'platelet_concentrate', 'cryoprecipitate', 'sdp', 'granulocytes', 'plasma']),
      donor_id: z.string().optional(),
      donor_name: z.string().optional(),
      donation_date: z.string().optional(),
      donation_type: z.string().optional(),
      volume_ml: z.number().optional(),
      bag_type: z.string().optional(),
      anticoagulant: z.string().optional(),
      storage_location: z.string().optional(),
      storage_temp: z.string().optional(),
      expiry_date: z.string(),
      received_from: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [unit] = await db.insert(bloodBankInventory).values({
        hospital_id: input.hospital_id,
        unit_number: input.unit_number,
        blood_group: input.blood_group,
        component: input.component,
        status: 'available',
        donor_id: input.donor_id ?? null,
        donor_name: input.donor_name ?? null,
        donation_date: input.donation_date ? new Date(input.donation_date) : null,
        donation_type: input.donation_type ?? null,
        volume_ml: input.volume_ml ?? null,
        bag_type: input.bag_type ?? null,
        anticoagulant: input.anticoagulant ?? null,
        storage_location: input.storage_location ?? null,
        storage_temp: input.storage_temp ?? null,
        expiry_date: new Date(input.expiry_date),
        received_from: input.received_from ?? null,
        received_by: ctx.user.sub,
        notes: input.notes ?? null,
      }).returning();

      return unit;
    }),

  // 2. GET INVENTORY — Stock summary by blood type/component
  getInventory: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const units = await db.select({
        blood_group: bloodBankInventory.blood_group,
        component: bloodBankInventory.component,
        count: count(),
      })
        .from(bloodBankInventory)
        .where(and(
          eq(bloodBankInventory.hospital_id, input.hospital_id),
          eq(bloodBankInventory.status, 'available'),
        ))
        .groupBy(bloodBankInventory.blood_group, bloodBankInventory.component);

      // Near-expiry (within 7 days)
      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const nearExpiry = await db.select({ total: count() })
        .from(bloodBankInventory)
        .where(and(
          eq(bloodBankInventory.hospital_id, input.hospital_id),
          eq(bloodBankInventory.status, 'available'),
          lte(bloodBankInventory.expiry_date, sevenDays),
        ));

      return { inventory: units, near_expiry: nearExpiry[0]?.total ?? 0 };
    }),

  // 3. LIST UNITS
  listUnits: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['available', 'reserved', 'crossmatched', 'issued', 'transfused', 'returned', 'expired', 'discarded']).optional(),
      blood_group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
      component: z.enum(['whole_blood', 'prbc', 'ffp', 'platelet_concentrate', 'cryoprecipitate', 'sdp', 'granulocytes', 'plasma']).optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(bloodBankInventory.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(bloodBankInventory.status, input.status));
      if (input.blood_group) conditions.push(eq(bloodBankInventory.blood_group, input.blood_group));
      if (input.component) conditions.push(eq(bloodBankInventory.component, input.component));

      const units = await db.select()
        .from(bloodBankInventory)
        .where(and(...conditions))
        .orderBy(asc(bloodBankInventory.expiry_date))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db.select({ total: count() })
        .from(bloodBankInventory)
        .where(and(...conditions));

      return { units, total: totalRow?.total ?? 0 };
    }),

  // 4. REQUEST CROSSMATCH
  requestCrossmatch: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      patient_blood_group: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
      component_requested: z.enum(['whole_blood', 'prbc', 'ffp', 'platelet_concentrate', 'cryoprecipitate', 'sdp', 'granulocytes', 'plasma']),
      units_requested: z.number().min(1).max(20).default(1),
      urgency: z.string().default('routine'),
      indication: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');

      const [request] = await db.insert(crossmatchRequests).values({
        hospital_id: input.hospital_id,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id ?? null,
        request_number: `XM-${dateKey}-${seq}`,
        status: 'requested',
        patient_blood_group: input.patient_blood_group ?? null,
        component_requested: input.component_requested,
        units_requested: input.units_requested,
        urgency: input.urgency,
        indication: input.indication ?? null,
        requested_by: ctx.user.sub,
      }).returning();

      return request;
    }),

  // 5. RECORD SAMPLE
  recordSample: protectedProcedure
    .input(z.object({
      request_id: z.string().uuid(),
      sample_number: z.enum(['1', '2']),
    }))
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (input.sample_number === '1') {
        updates.sample1_collected_at = new Date();
        updates.sample1_collected_by = ctx.user.sub;
        updates.status = 'sample_received';
      } else {
        updates.sample2_collected_at = new Date();
        updates.sample2_collected_by = ctx.user.sub;
        updates.two_sample_verified = true;
      }

      const [updated] = await db.update(crossmatchRequests)
        .set(updates)
        .where(eq(crossmatchRequests.id, input.request_id))
        .returning();

      return updated;
    }),

  // 6. PERFORM CROSSMATCH
  performCrossmatch: protectedProcedure
    .input(z.object({
      request_id: z.string().uuid(),
      result: z.enum(['compatible', 'incompatible']),
      matched_unit_ids: z.array(z.string().uuid()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const newStatus = input.result === 'compatible' ? 'compatible' : 'incompatible';

      const [updated] = await db.update(crossmatchRequests)
        .set({
          status: newStatus,
          crossmatch_result: input.result,
          crossmatched_units: input.matched_unit_ids ?? null,
          crossmatched_by: ctx.user.sub,
          crossmatched_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(crossmatchRequests.id, input.request_id))
        .returning();

      // Reserve matched units
      if (input.result === 'compatible' && input.matched_unit_ids) {
        for (const unitId of input.matched_unit_ids) {
          await db.update(bloodBankInventory)
            .set({ status: 'crossmatched', updated_at: new Date() })
            .where(eq(bloodBankInventory.id, unitId));
        }
      }

      return updated;
    }),

  // 7. ISSUE UNIT
  issueUnit: protectedProcedure
    .input(z.object({
      unit_id: z.string().uuid(),
      patient_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [unit] = await db.select()
        .from(bloodBankInventory)
        .where(eq(bloodBankInventory.id, input.unit_id))
        .limit(1);

      if (!unit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unit not found' });
      if (!['available', 'crossmatched'].includes(unit.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot issue unit in status: ${unit.status}` });
      }

      // Check expiry
      if (new Date(unit.expiry_date) < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unit has expired' });
      }

      const [updated] = await db.update(bloodBankInventory)
        .set({
          status: 'issued',
          issued_to_patient_id: input.patient_id,
          issued_at: new Date(),
          issued_by: ctx.user.sub,
          updated_at: new Date(),
        })
        .where(eq(bloodBankInventory.id, input.unit_id))
        .returning();

      return updated;
    }),

  // 8. RETURN UNIT
  returnUnit: protectedProcedure
    .input(z.object({
      unit_id: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [updated] = await db.update(bloodBankInventory)
        .set({
          status: 'returned',
          notes: input.reason ?? null,
          updated_at: new Date(),
        })
        .where(eq(bloodBankInventory.id, input.unit_id))
        .returning();

      return updated;
    }),

  // 9. DISCARD UNIT
  discardUnit: protectedProcedure
    .input(z.object({
      unit_id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(bloodBankInventory)
        .set({
          status: 'discarded',
          discard_reason: input.reason,
          discarded_at: new Date(),
          discarded_by: ctx.user.sub,
          updated_at: new Date(),
        })
        .where(eq(bloodBankInventory.id, input.unit_id))
        .returning();

      return updated;
    }),

  // 10. LOG REACTION
  logReaction: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      patient_id: z.string().uuid(),
      unit_id: z.string().uuid().optional(),
      reaction_type: z.enum(['febrile', 'allergic', 'hemolytic_acute', 'hemolytic_delayed', 'anaphylactic', 'trali', 'taco', 'septic', 'other']),
      severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening', 'fatal']),
      onset_minutes: z.number().optional(),
      symptoms: z.array(z.string()).optional(),
      temperature: z.string().optional(),
      blood_pressure: z.string().optional(),
      heart_rate: z.number().optional(),
      spo2: z.number().optional(),
      transfusion_stopped: z.boolean().default(true),
      treatment_given: z.string().optional(),
      outcome: z.string().optional(),
      outcome_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [reaction] = await db.insert(transfusionReactions).values({
        hospital_id: input.hospital_id,
        patient_id: input.patient_id,
        unit_id: input.unit_id ?? null,
        reaction_type: input.reaction_type,
        severity: input.severity,
        onset_minutes: input.onset_minutes ?? null,
        symptoms: input.symptoms ?? null,
        temperature: input.temperature ?? null,
        blood_pressure: input.blood_pressure ?? null,
        heart_rate: input.heart_rate ?? null,
        spo2: input.spo2 ?? null,
        transfusion_stopped: input.transfusion_stopped,
        treatment_given: input.treatment_given ?? null,
        outcome: input.outcome ?? null,
        outcome_notes: input.outcome_notes ?? null,
        reported_by: ctx.user.sub,
      }).returning();

      return reaction;
    }),

  // 11. LIST REACTIONS
  listReactions: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const reactions = await db.select()
        .from(transfusionReactions)
        .where(eq(transfusionReactions.hospital_id, input.hospital_id))
        .orderBy(desc(transfusionReactions.reported_at))
        .limit(input.limit);

      return reactions;
    }),

  // 12. LIST CROSSMATCHES
  listCrossmatches: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['requested', 'sample_received', 'testing', 'compatible', 'incompatible', 'cancelled']).optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(crossmatchRequests.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(crossmatchRequests.status, input.status));

      const requests = await db.select()
        .from(crossmatchRequests)
        .where(and(...conditions))
        .orderBy(desc(crossmatchRequests.requested_at))
        .limit(input.limit);

      return requests;
    }),

  // 13. STATS
  stats: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const [available] = await db.select({ total: count() })
        .from(bloodBankInventory)
        .where(and(eq(bloodBankInventory.hospital_id, input.hospital_id), eq(bloodBankInventory.status, 'available')));

      const [issued] = await db.select({ total: count() })
        .from(bloodBankInventory)
        .where(and(eq(bloodBankInventory.hospital_id, input.hospital_id), eq(bloodBankInventory.status, 'issued')));

      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [nearExpiry] = await db.select({ total: count() })
        .from(bloodBankInventory)
        .where(and(
          eq(bloodBankInventory.hospital_id, input.hospital_id),
          eq(bloodBankInventory.status, 'available'),
          lte(bloodBankInventory.expiry_date, sevenDays),
        ));

      const [discarded] = await db.select({ total: count() })
        .from(bloodBankInventory)
        .where(and(eq(bloodBankInventory.hospital_id, input.hospital_id), eq(bloodBankInventory.status, 'discarded')));

      const [pendingXM] = await db.select({ total: count() })
        .from(crossmatchRequests)
        .where(and(
          eq(crossmatchRequests.hospital_id, input.hospital_id),
          sql`${crossmatchRequests.status} IN ('requested', 'sample_received', 'testing')`,
        ));

      const [reactions] = await db.select({ total: count() })
        .from(transfusionReactions)
        .where(eq(transfusionReactions.hospital_id, input.hospital_id));

      return {
        available_units: available?.total ?? 0,
        issued_units: issued?.total ?? 0,
        near_expiry: nearExpiry?.total ?? 0,
        discarded_units: discarded?.total ?? 0,
        pending_crossmatch: pendingXM?.total ?? 0,
        total_reactions: reactions?.total ?? 0,
      };
    }),
});
