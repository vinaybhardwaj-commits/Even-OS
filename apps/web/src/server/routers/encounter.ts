import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  encounters, patients, locations, bedAssignments, bedStatusHistory,
  admissionChecklists, dischargeMilestones, coverages,
  transferHistory, dischargeOrders,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';

const encounterClassValues = ['IMP', 'AMB', 'ED', 'HH', 'OBSENC'] as const;
const admissionTypeValues = ['elective', 'emergency', 'day_care'] as const;

// Default checklist items — 'pre_auth_obtained' is conditional on insured patients
const DEFAULT_CHECKLIST_ITEMS = [
  { key: 'identity_docs', label: 'Identity documents collected', mandatory: true },
  { key: 'insurance_verified', label: 'Insurance status verified', mandatory: true },
  { key: 'pre_auth_obtained', label: 'Pre-authorization obtained', mandatory: true, insuredOnly: true },
  { key: 'consent_signed', label: 'General consent signed', mandatory: true },
  { key: 'emergency_contact', label: 'Emergency contact confirmed', mandatory: true },
  { key: 'allergies_reviewed', label: 'Allergies reviewed', mandatory: false },
  { key: 'medications_reviewed', label: 'Current medications reviewed', mandatory: false },
];

export const encounterRouter = router({

  // ─── ADMIT (create encounter + checklist + bed assignment) ──
  admit: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_class: z.enum(encounterClassValues),
      admission_type: z.enum(admissionTypeValues),
      chief_complaint: z.string().min(1).max(500),
      preliminary_diagnosis: z.string().max(500).optional(),
      clinical_notes: z.string().max(2000).optional(),
      diet_type: z.string().max(50).optional(),
      expected_los_days: z.number().min(1).max(365).optional(),
      bed_id: z.string().uuid(),
      // Insurance / pre-auth
      pre_auth_status: z.enum(['not_required', 'obtained', 'override']).default('not_required'),
      pre_auth_number: z.string().max(100).optional(),
      pre_auth_override_reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify patient exists and is active
      const [patient] = await db.select({
        id: patients.id,
        uhid: patients.uhid,
        name_full: patients.name_full,
        patient_category: patients.patient_category,
      })
        .from(patients)
        .where(and(
          eq(patients.id, input.patient_id as any),
          eq(patients.hospital_id, hospitalId),
          eq(patients.status, 'active'),
        ))
        .limit(1);

      if (!patient) throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found or inactive' });

      // 2. Check no active encounter exists
      const [activeEncounter] = await db.select({ id: encounters.id })
        .from(encounters)
        .where(and(
          eq(encounters.patient_id, input.patient_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (activeEncounter) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Patient already has an active admission' });
      }

      // 3. PRE-AUTH HARD GATE for insured patients
      if (patient.patient_category === 'insured') {
        if (input.pre_auth_status === 'not_required') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Insured patient requires pre-authorization before admission. Use emergency override if urgent.',
          });
        }
      }

      // 4. Verify bed is available
      const [bed] = await db.select({
        id: locations.id,
        code: locations.code,
        bed_status: locations.bed_status,
      })
        .from(locations)
        .where(and(
          eq(locations.id, input.bed_id as any),
          eq(locations.hospital_id, hospitalId),
          eq(locations.location_type, 'bed'),
        ))
        .limit(1);

      if (!bed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bed not found' });
      if (bed.bed_status !== 'available' && bed.bed_status !== 'reserved') {
        throw new TRPCError({ code: 'CONFLICT', message: `Bed ${bed.code} is currently ${bed.bed_status}` });
      }

      // 5. Create encounter
      const [encounter] = await db.insert(encounters).values({
        hospital_id: hospitalId,
        patient_id: input.patient_id,
        encounter_class: input.encounter_class,
        status: 'in-progress',
        admission_type: input.admission_type,
        chief_complaint: input.chief_complaint,
        preliminary_diagnosis_icd10: input.preliminary_diagnosis || null,
        clinical_notes: input.clinical_notes || null,
        diet_type: input.diet_type || null,
        expected_los_days: input.expected_los_days || null,
        current_location_id: input.bed_id,
        attending_practitioner_id: ctx.user.sub,
        pre_auth_status: input.pre_auth_status as any,
        pre_auth_number: input.pre_auth_number || null,
        pre_auth_override_reason: input.pre_auth_override_reason || null,
        pre_auth_override_by: input.pre_auth_status === 'override' ? ctx.user.sub : null,
        admission_at: new Date(),
        created_by_user_id: ctx.user.sub,
      }).returning();

      // 6. Assign bed
      await db.insert(bedAssignments).values({
        hospital_id: hospitalId,
        location_id: input.bed_id,
        encounter_id: encounter.id,
        assigned_by_user_id: ctx.user.sub,
      });

      // Mark bed as occupied
      await db.update(locations)
        .set({ bed_status: 'occupied' })
        .where(eq(locations.id, input.bed_id as any));

      // Log bed status change
      await db.insert(bedStatusHistory).values({
        hospital_id: hospitalId,
        location_id: input.bed_id,
        status: 'occupied',
        reason: `Admitted patient ${patient.uhid}`,
        changed_by_user_id: ctx.user.sub,
      });

      // 7. Create checklist items
      const isInsured = patient.patient_category === 'insured';
      const checklistItems = DEFAULT_CHECKLIST_ITEMS
        .filter(item => !item.insuredOnly || isInsured)
        .map(item => ({
          hospital_id: hospitalId,
          encounter_id: encounter.id,
          item_key: item.key,
          item_label: item.label,
          is_mandatory: item.mandatory,
          status: 'done' as const, // Pre-admission checklist was completed before calling admit
          completed_at: new Date(),
          completed_by_user_id: ctx.user.sub,
        }));

      if (checklistItems.length > 0) {
        await db.insert(admissionChecklists).values(checklistItems);
      }

      // 8. Pre-create discharge milestones (all pending)
      const milestones = [
        { milestone: 'clinical_clearance', sequence: 1 },
        { milestone: 'financial_settlement', sequence: 2 },
        { milestone: 'discharge_summary', sequence: 3 },
        { milestone: 'medication_reconciliation', sequence: 4 },
        { milestone: 'patient_education', sequence: 5 },
        { milestone: 'documents_ready', sequence: 6 },
        { milestone: 'bed_cleaned', sequence: 7 },
        { milestone: 'followup_scheduled', sequence: 8 },
      ] as const;

      await db.insert(dischargeMilestones).values(
        milestones.map(m => ({
          hospital_id: hospitalId,
          encounter_id: encounter.id,
          milestone: m.milestone,
          sequence: m.sequence,
        }))
      );

      // 9. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'encounters',
        row_id: encounter.id,
        new_values: {
          patient_uhid: patient.uhid,
          bed: bed.code,
          admission_type: input.admission_type,
          pre_auth_status: input.pre_auth_status,
        },
      });

      return {
        encounter_id: encounter.id,
        patient_uhid: patient.uhid,
        patient_name: patient.name_full,
        bed_code: bed.code,
        admission_at: encounter.admission_at,
      };
    }),

  // ─── GET ACTIVE (current admission for a patient) ──────────
  getActive: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const result = await db.execute(sql`
        SELECT
          e.*,
          p.uhid, p.name_full as patient_name, p.phone, p.gender, p.dob,
          p.blood_group, p.patient_category,
          l.code as bed_code, l.name as bed_name,
          w.code as ward_code, w.name as ward_name
        FROM encounters e
        JOIN patients p ON e.patient_id = p.id
        LEFT JOIN locations l ON e.current_location_id = l.id
        LEFT JOIN locations w ON l.parent_location_id = w.id
        WHERE e.patient_id = ${input.patient_id}::uuid
          AND e.hospital_id = ${hospitalId}
          AND e.status = 'in-progress'
        LIMIT 1
      `);

      const rows = (result as any).rows || result;
      if (rows.length === 0) return null;

      // Get checklist items
      const checklist = await db.select().from(admissionChecklists)
        .where(eq(admissionChecklists.encounter_id, rows[0].id));

      // Get discharge milestones
      const milestones = await db.select().from(dischargeMilestones)
        .where(eq(dischargeMilestones.encounter_id, rows[0].id))
        .orderBy(dischargeMilestones.sequence);

      return { ...rows[0], checklist, milestones };
    }),

  // ─── GET HISTORY (past admissions for a patient) ───────────
  getHistory: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      return db.execute(sql`
        SELECT
          e.id, e.encounter_class, e.status, e.admission_type,
          e.chief_complaint, e.preliminary_diagnosis_icd10,
          e.admission_at, e.discharge_at,
          l.code as bed_code, w.name as ward_name
        FROM encounters e
        LEFT JOIN locations l ON e.current_location_id = l.id
        LEFT JOIN locations w ON l.parent_location_id = w.id
        WHERE e.patient_id = ${input.patient_id}::uuid
          AND e.hospital_id = ${ctx.user.hospital_id}
        ORDER BY e.admission_at DESC NULLS LAST
        LIMIT ${input.limit}
      `).then(r => ((r as any).rows || r));
    }),

  // ─── LIST ACTIVE (all current admissions) ──────────────────
  listActive: protectedProcedure
    .input(z.object({
      ward_code: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { ward_code, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const wardFilter = ward_code ? sql`AND w.code = ${ward_code}` : sql``;

      const result = await db.execute(sql`
        SELECT
          e.id as encounter_id,
          e.encounter_class, e.admission_type, e.chief_complaint,
          e.admission_at, e.expected_los_days, e.pre_auth_status,
          p.id as patient_id, p.uhid, p.name_full as patient_name,
          p.phone, p.gender, p.patient_category,
          l.code as bed_code, l.name as bed_name,
          w.code as ward_code, w.name as ward_name
        FROM encounters e
        JOIN patients p ON e.patient_id = p.id
        LEFT JOIN locations l ON e.current_location_id = l.id
        LEFT JOIN locations w ON l.parent_location_id = w.id
        WHERE e.hospital_id = ${hospitalId}
          AND e.status = 'in-progress'
          ${wardFilter}
        ORDER BY e.admission_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM encounters e
        LEFT JOIN locations l ON e.current_location_id = l.id
        LEFT JOIN locations w ON l.parent_location_id = w.id
        WHERE e.hospital_id = ${hospitalId}
          AND e.status = 'in-progress'
          ${wardFilter}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── ADMISSION STATS ──────────────────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const hospitalId = ctx.user.hospital_id;

    const result = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'in-progress')::int as active,
        count(*) FILTER (WHERE status = 'in-progress' AND admission_type = 'emergency')::int as emergency,
        count(*) FILTER (WHERE status = 'in-progress' AND admission_type = 'elective')::int as elective,
        count(*) FILTER (WHERE status = 'in-progress' AND pre_auth_status = 'override')::int as pre_auth_overrides,
        count(*) FILTER (WHERE status = 'finished' AND discharge_at >= NOW() - INTERVAL '24 hours')::int as discharged_today,
        count(*) FILTER (WHERE status = 'in-progress' AND admission_at >= NOW() - INTERVAL '24 hours')::int as admitted_today
      FROM encounters
      WHERE hospital_id = ${hospitalId}
    `);

    const rows = (result as any).rows || result;
    return rows[0] || { active: 0, emergency: 0, elective: 0, pre_auth_overrides: 0, discharged_today: 0, admitted_today: 0 };
  }),

  // ─── GET AVAILABLE BEDS (for admission wizard) ─────────────
  availableBeds: protectedProcedure
    .input(z.object({ ward_code: z.string().optional() }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const wardFilter = input.ward_code ? sql`AND w.code = ${input.ward_code}` : sql``;

      const result = await db.execute(sql`
        SELECT
          b.id, b.code, b.name, b.bed_status,
          w.code as ward_code, w.name as ward_name
        FROM locations b
        JOIN locations w ON b.parent_location_id = w.id
        WHERE b.location_type = 'bed'
          AND b.hospital_id = ${hospitalId}
          AND b.status = 'active'
          AND b.bed_status IN ('available', 'reserved')
          ${wardFilter}
        ORDER BY w.code, b.code
      `);

      return (result as any).rows || result;
    }),

  // ═══════════════════════════════════════════════════════════
  // S4b — TRANSFER ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  // ─── TRANSFER (move patient to a different bed) ───────────
  transfer: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      to_bed_id: z.string().uuid(),
      transfer_type: z.enum(['bed', 'ward', 'floor']).default('bed'),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter exists and is active
      const [encounter] = await db.select({
        id: encounters.id,
        patient_id: encounters.patient_id,
        current_location_id: encounters.current_location_id,
      })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });

      // 2. Verify new bed is available
      const [toBed] = await db.select({
        id: locations.id,
        code: locations.code,
        name: locations.name,
        bed_status: locations.bed_status,
      })
        .from(locations)
        .where(and(
          eq(locations.id, input.to_bed_id as any),
          eq(locations.hospital_id, hospitalId),
          eq(locations.location_type, 'bed'),
        ))
        .limit(1);

      if (!toBed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Destination bed not found' });
      if (toBed.bed_status !== 'available' && toBed.bed_status !== 'reserved') {
        throw new TRPCError({ code: 'CONFLICT', message: `Bed ${toBed.code} is currently ${toBed.bed_status}` });
      }

      const fromLocationId = encounter.current_location_id;

      // 3. Update encounter location
      await db.update(encounters)
        .set({ current_location_id: input.to_bed_id })
        .where(eq(encounters.id, input.encounter_id as any));

      // 4. End current bed assignment
      await db.update(bedAssignments)
        .set({
          released_at: new Date(),
          reason_released: 'transfer',
          transfer_to_location_id: input.to_bed_id,
        })
        .where(and(
          eq(bedAssignments.encounter_id, input.encounter_id as any),
          isNull(bedAssignments.released_at),
        ));

      // 5. Create new bed assignment
      await db.insert(bedAssignments).values({
        hospital_id: hospitalId,
        location_id: input.to_bed_id,
        encounter_id: input.encounter_id,
        assigned_by_user_id: ctx.user.sub,
      });

      // 6. Release old bed
      if (fromLocationId) {
        await db.update(locations)
          .set({ bed_status: 'available' })
          .where(eq(locations.id, fromLocationId as any));

        await db.insert(bedStatusHistory).values({
          hospital_id: hospitalId,
          location_id: fromLocationId,
          status: 'available',
          reason: `Patient transferred out`,
          changed_by_user_id: ctx.user.sub,
        });
      }

      // 7. Mark new bed as occupied
      await db.update(locations)
        .set({ bed_status: 'occupied' })
        .where(eq(locations.id, input.to_bed_id as any));

      await db.insert(bedStatusHistory).values({
        hospital_id: hospitalId,
        location_id: input.to_bed_id,
        status: 'occupied',
        reason: `Patient transferred in`,
        changed_by_user_id: ctx.user.sub,
      });

      // 8. Record transfer history
      await db.insert(transferHistory).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        from_location_id: fromLocationId!,
        to_location_id: input.to_bed_id,
        transfer_type: input.transfer_type,
        reason: input.reason || null,
        transferred_by_user_id: ctx.user.sub,
      });

      // 9. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'encounters',
        row_id: encounter.id,
        new_values: {
          transfer_type: input.transfer_type,
          from_bed: fromLocationId,
          to_bed: toBed.code,
          reason: input.reason,
        },
      });

      return { encounter_id: encounter.id, from_bed: fromLocationId, to_bed_code: toBed.code };
    }),

  // ─── TRANSFER HISTORY (for an encounter) ──────────────────
  getTransferHistory: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await db.execute(sql`
        SELECT
          th.id, th.transfer_type, th.reason, th.transfer_at,
          fl.code as from_bed_code, fl.name as from_bed_name,
          fw.name as from_ward_name,
          tl.code as to_bed_code, tl.name as to_bed_name,
          tw.name as to_ward_name,
          u.display_name as transferred_by
        FROM transfer_history th
        JOIN locations fl ON th.from_location_id = fl.id
        JOIN locations tl ON th.to_location_id = tl.id
        LEFT JOIN locations fw ON fl.parent_location_id = fw.id
        LEFT JOIN locations tw ON tl.parent_location_id = tw.id
        LEFT JOIN users u ON th.transferred_by_user_id = u.id
        WHERE th.encounter_id = ${input.encounter_id}::uuid
          AND th.hospital_id = ${ctx.user.hospital_id}
        ORDER BY th.transfer_at DESC
      `);
      return (result as any).rows || result;
    }),

  // ═══════════════════════════════════════════════════════════
  // S4b — DISCHARGE ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  // ─── INITIATE DISCHARGE (create discharge order) ──────────
  initiateDischarge: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      reason: z.enum(['recovered', 'referred', 'self_discharge', 'death', 'lama']),
      summary: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify encounter is active
      const [encounter] = await db.select({ id: encounters.id })
        .from(encounters)
        .where(and(
          eq(encounters.id, input.encounter_id as any),
          eq(encounters.hospital_id, hospitalId),
          eq(encounters.status, 'in-progress'),
        ))
        .limit(1);

      if (!encounter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active encounter not found' });

      // Check no existing active discharge order
      const [existingOrder] = await db.select({ id: dischargeOrders.id })
        .from(dischargeOrders)
        .where(and(
          eq(dischargeOrders.encounter_id, input.encounter_id as any),
          eq(dischargeOrders.hospital_id, hospitalId),
          sql`${dischargeOrders.status} != 'completed'`,
        ))
        .limit(1);

      if (existingOrder) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A discharge order already exists for this encounter' });
      }

      // Create discharge order
      const [order] = await db.insert(dischargeOrders).values({
        hospital_id: hospitalId,
        encounter_id: input.encounter_id,
        reason: input.reason,
        summary: input.summary || null,
        status: 'ordered',
        ordered_by_user_id: ctx.user.sub,
      }).returning();

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'discharge_orders',
        row_id: order.id,
        new_values: { reason: input.reason, encounter_id: input.encounter_id },
      });

      return { order_id: order.id, status: 'ordered' };
    }),

  // ─── COMPLETE MILESTONE ───────────────────────────────────
  completeMilestone: protectedProcedure
    .input(z.object({
      milestone_id: z.string().uuid(),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify milestone exists and belongs to this hospital
      const [milestone] = await db.select({
        id: dischargeMilestones.id,
        encounter_id: dischargeMilestones.encounter_id,
        milestone: dischargeMilestones.milestone,
        sequence: dischargeMilestones.sequence,
        completed_at: dischargeMilestones.completed_at,
      })
        .from(dischargeMilestones)
        .where(and(
          eq(dischargeMilestones.id, input.milestone_id as any),
          eq(dischargeMilestones.hospital_id, hospitalId),
        ))
        .limit(1);

      if (!milestone) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone not found' });
      if (milestone.completed_at) throw new TRPCError({ code: 'CONFLICT', message: 'Milestone already completed' });

      // Update milestone
      await db.update(dischargeMilestones)
        .set({
          completed_at: new Date(),
          completed_by_user_id: ctx.user.sub,
          notes: input.notes || null,
        })
        .where(eq(dischargeMilestones.id, input.milestone_id as any));

      return { milestone_id: milestone.id, milestone: milestone.milestone, completed: true };
    }),

  // ─── DISCHARGE STATUS (milestones + order for an encounter) ─
  dischargeStatus: protectedProcedure
    .input(z.object({ encounter_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Get milestones
      const milestones = await db.select()
        .from(dischargeMilestones)
        .where(and(
          eq(dischargeMilestones.encounter_id, input.encounter_id as any),
          eq(dischargeMilestones.hospital_id, hospitalId),
        ))
        .orderBy(dischargeMilestones.sequence);

      // Get discharge order
      const [order] = await db.select()
        .from(dischargeOrders)
        .where(and(
          eq(dischargeOrders.encounter_id, input.encounter_id as any),
          eq(dischargeOrders.hospital_id, hospitalId),
        ))
        .limit(1);

      const completed = milestones.filter(m => m.completed_at).length;
      const total = milestones.length;

      return { milestones, order: order || null, completed, total, all_complete: completed === total };
    }),

  // ─── COMPLETE DISCHARGE (finalize and close encounter) ────
  completeDischarge: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      force: z.boolean().default(false), // allow completing even if milestones incomplete
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Verify encounter is active
      const [encounter] = await db.select({
        id: encounters.id,
        current_location_id: encounters.current_location_id,
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

      // 2. Verify discharge order exists
      const [order] = await db.select({ id: dischargeOrders.id, status: dischargeOrders.status })
        .from(dischargeOrders)
        .where(and(
          eq(dischargeOrders.encounter_id, input.encounter_id as any),
          eq(dischargeOrders.hospital_id, hospitalId),
          sql`${dischargeOrders.status} = 'ordered'`,
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Discharge must be initiated first' });

      // 3. Check milestones (unless force)
      if (!input.force) {
        const incomplete = await db.select({ id: dischargeMilestones.id })
          .from(dischargeMilestones)
          .where(and(
            eq(dischargeMilestones.encounter_id, input.encounter_id as any),
            eq(dischargeMilestones.hospital_id, hospitalId),
            isNull(dischargeMilestones.completed_at),
          ))
          .limit(1);

        if (incomplete.length > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Not all discharge milestones are complete. Use force=true to override.',
          });
        }
      }

      const now = new Date();

      // 4. Close encounter
      await db.update(encounters)
        .set({ status: 'finished', discharge_at: now })
        .where(eq(encounters.id, input.encounter_id as any));

      // 5. Complete discharge order
      await db.update(dischargeOrders)
        .set({ status: 'completed' })
        .where(eq(dischargeOrders.id, order.id as any));

      // 6. End bed assignment
      await db.update(bedAssignments)
        .set({ released_at: now, reason_released: 'discharge' })
        .where(and(
          eq(bedAssignments.encounter_id, input.encounter_id as any),
          isNull(bedAssignments.released_at),
        ));

      // 7. Release bed
      if (encounter.current_location_id) {
        await db.update(locations)
          .set({ bed_status: 'available' })
          .where(eq(locations.id, encounter.current_location_id as any));

        await db.insert(bedStatusHistory).values({
          hospital_id: hospitalId,
          location_id: encounter.current_location_id,
          status: 'available',
          reason: 'Patient discharged',
          changed_by_user_id: ctx.user.sub,
        });
      }

      // 8. Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'encounters',
        row_id: encounter.id,
        new_values: { status: 'finished', discharge_at: now.toISOString(), forced: input.force },
      });

      return { encounter_id: encounter.id, status: 'finished', discharge_at: now };
    }),

  // ─── CANCEL DISCHARGE (revoke discharge order) ────────────
  cancelDischarge: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify active discharge order
      const [order] = await db.select({ id: dischargeOrders.id })
        .from(dischargeOrders)
        .where(and(
          eq(dischargeOrders.encounter_id, input.encounter_id as any),
          eq(dischargeOrders.hospital_id, hospitalId),
          sql`${dischargeOrders.status} = 'ordered'`,
        ))
        .limit(1);

      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active discharge order found' });

      // Cancel the order (keep record, just change status)
      await db.update(dischargeOrders)
        .set({ status: 'draft' }) // "draft" effectively means cancelled/revoked
        .where(eq(dischargeOrders.id, order.id as any));

      // Audit
      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'discharge_orders',
        row_id: order.id,
        new_values: { status: 'draft', cancel_reason: input.reason },
      });

      return { order_id: order.id, status: 'cancelled' };
    }),

  // ─── DISCHARGE QUEUE (all encounters with active discharge orders) ─
  dischargeQueue: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const result = await db.execute(sql`
        SELECT
          e.id as encounter_id, e.admission_at, e.chief_complaint,
          e.admission_type, e.pre_auth_status,
          p.uhid, p.name_full as patient_name, p.phone, p.patient_category,
          l.code as bed_code, w.name as ward_name,
          do.id as order_id, do.reason as discharge_reason, do.status as order_status, do.ordered_at,
          (SELECT count(*)::int FROM discharge_milestones dm WHERE dm.encounter_id = e.id AND dm.completed_at IS NOT NULL) as milestones_done,
          (SELECT count(*)::int FROM discharge_milestones dm WHERE dm.encounter_id = e.id) as milestones_total
        FROM discharge_orders do
        JOIN encounters e ON do.encounter_id = e.id
        JOIN patients p ON e.patient_id = p.id
        LEFT JOIN locations l ON e.current_location_id = l.id
        LEFT JOIN locations w ON l.parent_location_id = w.id
        WHERE do.hospital_id = ${hospitalId}
          AND do.status = 'ordered'
          AND e.status = 'in-progress'
        ORDER BY do.ordered_at ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM discharge_orders do
        JOIN encounters e ON do.encounter_id = e.id
        WHERE do.hospital_id = ${hospitalId}
          AND do.status = 'ordered'
          AND e.status = 'in-progress'
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),
});
