import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  patientAssignments, shiftHandoffs, nursingAssessments,
  patients, encounters, locations, users, shiftInstances, shiftRoster,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, inArray, count } from 'drizzle-orm';

// ============================================================
// PATIENT ASSIGNMENTS — NS.1
// Procedures: assign, reassign, myPatients, wardAssignments,
//   unassignedPatients, stats, submitHandoff, getHandoffs
// ============================================================

// Nursing roles that can be assigned patients
const NURSING_ROLES = [
  'nurse', 'charge_nurse', 'icu_nurse', 'ot_nurse',
  'nicu_nurse', 'dialysis_nurse', 'cath_lab_nurse', 'endoscopy_nurse',
];

// Roles that can assign patients (charge nurse, admin, supervisors)
const ASSIGNER_ROLES = [
  'charge_nurse', 'nursing_supervisor', 'hospital_admin', 'super_admin',
  'medical_director', 'unit_head',
];

export const patientAssignmentsRouter = router({

  // ── Assign a patient to a nurse ───────────────────────────────────────

  assign: protectedProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid(),
      nurse_id: z.string().uuid(),
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      ward_id: z.string().uuid(),
      bed_label: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify assigner has permission
      if (!ASSIGNER_ROLES.includes(ctx.user.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only charge nurses, supervisors, and admins can assign patients',
        });
      }

      // Verify the shift instance belongs to this hospital
      const [shift] = await db.select({ id: shiftInstances.id, hospital_id: shiftInstances.hospital_id })
        .from(shiftInstances)
        .where(and(
          eq(shiftInstances.id, input.shift_instance_id),
          eq(shiftInstances.hospital_id, ctx.user.hospital_id),
        ));

      if (!shift) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift instance not found' });
      }

      // Verify nurse is rostered on this shift
      const [rostered] = await db.select({ id: shiftRoster.id })
        .from(shiftRoster)
        .where(and(
          eq(shiftRoster.shift_instance_id, input.shift_instance_id),
          eq(shiftRoster.user_id, input.nurse_id),
          eq(shiftRoster.status, 'scheduled'),
        ));

      if (!rostered) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Nurse is not rostered on this shift',
        });
      }

      // Insert assignment
      const [assignment] = await db.insert(patientAssignments).values({
        hospital_id: ctx.user.hospital_id,
        shift_instance_id: input.shift_instance_id,
        nurse_id: input.nurse_id,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id,
        ward_id: input.ward_id,
        bed_label: input.bed_label || null,
        status: 'active',
        assigned_by: ctx.user.sub,
        notes: input.notes || null,
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'patient_assignments',
        row_id: assignment.id,
        new_values: { nurse_id: input.nurse_id, patient_id: input.patient_id, shift_instance_id: input.shift_instance_id },
        reason: 'Patient assigned to nurse',
      });

      return assignment;
    }),

  // ── Reassign patient to a different nurse ─────────────────────────────

  reassign: protectedProcedure
    .input(z.object({
      assignment_id: z.string().uuid(),
      new_nurse_id: z.string().uuid(),
      reason: z.string().min(1, 'Reason is required'),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ASSIGNER_ROLES.includes(ctx.user.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only charge nurses, supervisors, and admins can reassign patients',
        });
      }

      // Fetch existing assignment
      const [existing] = await db.select()
        .from(patientAssignments)
        .where(and(
          eq(patientAssignments.id, input.assignment_id),
          eq(patientAssignments.hospital_id, ctx.user.hospital_id),
          eq(patientAssignments.status, 'active'),
        ));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Active assignment not found' });
      }

      // Verify new nurse is rostered
      const [rostered] = await db.select({ id: shiftRoster.id })
        .from(shiftRoster)
        .where(and(
          eq(shiftRoster.shift_instance_id, existing.shift_instance_id),
          eq(shiftRoster.user_id, input.new_nurse_id),
          eq(shiftRoster.status, 'scheduled'),
        ));

      if (!rostered) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'New nurse is not rostered on this shift',
        });
      }

      // Mark old assignment as transferred
      await db.update(patientAssignments)
        .set({
          status: 'transferred',
          completed_at: new Date(),
          notes: `Reassigned to another nurse. Reason: ${input.reason}`,
          updated_at: new Date(),
        })
        .where(eq(patientAssignments.id, input.assignment_id));

      // Create new assignment
      const [newAssignment] = await db.insert(patientAssignments).values({
        hospital_id: ctx.user.hospital_id,
        shift_instance_id: existing.shift_instance_id,
        nurse_id: input.new_nurse_id,
        patient_id: existing.patient_id,
        encounter_id: existing.encounter_id,
        ward_id: existing.ward_id,
        bed_label: existing.bed_label,
        status: 'active',
        assigned_by: ctx.user.sub,
        notes: `Reassigned from previous nurse. Reason: ${input.reason}`,
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'patient_assignments',
        row_id: newAssignment.id,
        old_values: { assignment_id: input.assignment_id, nurse_id: existing.nurse_id },
        new_values: { nurse_id: input.new_nurse_id },
        reason: `Reassignment: ${input.reason}`,
      });

      return newAssignment;
    }),

  // ── Get my patients (for the logged-in nurse) ─────────────────────────

  myPatients: protectedProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      // Build conditions
      const conditions = [
        eq(patientAssignments.hospital_id, ctx.user.hospital_id),
        eq(patientAssignments.nurse_id, ctx.user.sub),
        eq(patientAssignments.status, 'active'),
      ];

      if (input.shift_instance_id) {
        conditions.push(eq(patientAssignments.shift_instance_id, input.shift_instance_id));
      }

      const rows = await db.select({
        assignment: patientAssignments,
        patient_name: sql<string>`${patients.name_given} || ' ' || COALESCE(${patients.name_family}, '')`.as('patient_name'),
        patient_uhid: patients.uhid,
        patient_gender: patients.gender,
        patient_dob: patients.dob,
        patient_phone: patients.phone,
        encounter_status: encounters.status,
        encounter_class: encounters.encounter_class,
        chief_complaint: encounters.chief_complaint,
        admission_at: encounters.admission_at,
        diet_type: encounters.diet_type,
        ward_name: locations.name,
      })
        .from(patientAssignments)
        .innerJoin(patients, eq(patientAssignments.patient_id, patients.id))
        .innerJoin(encounters, eq(patientAssignments.encounter_id, encounters.id))
        .innerJoin(locations, eq(patientAssignments.ward_id, locations.id))
        .where(and(...conditions))
        .orderBy(asc(patientAssignments.bed_label));

      return rows;
    }),

  // ── Ward assignments (all active assignments for a ward + shift) ──────

  wardAssignments: protectedProcedure
    .input(z.object({
      ward_id: z.string().uuid(),
      shift_instance_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select({
        assignment: patientAssignments,
        patient_name: sql<string>`${patients.name_given} || ' ' || COALESCE(${patients.name_family}, '')`.as('patient_name'),
        patient_uhid: patients.uhid,
        patient_gender: patients.gender,
        patient_dob: patients.dob,
        encounter_status: encounters.status,
        encounter_class: encounters.encounter_class,
        chief_complaint: encounters.chief_complaint,
        admission_at: encounters.admission_at,
        diet_type: encounters.diet_type,
        nurse_name: users.full_name,
        nurse_email: users.email,
        ward_name: locations.name,
      })
        .from(patientAssignments)
        .innerJoin(patients, eq(patientAssignments.patient_id, patients.id))
        .innerJoin(encounters, eq(patientAssignments.encounter_id, encounters.id))
        .innerJoin(locations, eq(patientAssignments.ward_id, locations.id))
        .innerJoin(users, eq(patientAssignments.nurse_id, users.id))
        .where(and(
          eq(patientAssignments.hospital_id, ctx.user.hospital_id),
          eq(patientAssignments.ward_id, input.ward_id),
          eq(patientAssignments.shift_instance_id, input.shift_instance_id),
          eq(patientAssignments.status, 'active'),
        ))
        .orderBy(asc(patientAssignments.bed_label));

      return rows;
    }),

  // ── Unassigned patients in ward (for charge nurse to assign) ──────────

  unassignedPatients: protectedProcedure
    .input(z.object({
      ward_id: z.string().uuid(),
      shift_instance_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      // Get active inpatient encounters at this ward that don't have assignments for this shift
      const assigned = db.select({ patient_id: patientAssignments.patient_id })
        .from(patientAssignments)
        .where(and(
          eq(patientAssignments.shift_instance_id, input.shift_instance_id),
          eq(patientAssignments.status, 'active'),
        ));

      const rows = await db.select({
        patient_id: patients.id,
        patient_name: sql<string>`${patients.name_given} || ' ' || COALESCE(${patients.name_family}, '')`.as('patient_name'),
        patient_uhid: patients.uhid,
        patient_gender: patients.gender,
        patient_dob: patients.dob,
        encounter_id: encounters.id,
        encounter_class: encounters.encounter_class,
        chief_complaint: encounters.chief_complaint,
        admission_at: encounters.admission_at,
        diet_type: encounters.diet_type,
        current_location_id: encounters.current_location_id,
      })
        .from(encounters)
        .innerJoin(patients, eq(encounters.patient_id, patients.id))
        .where(and(
          eq(encounters.hospital_id, ctx.user.hospital_id),
          eq(encounters.status, 'in-progress'),
          eq(encounters.current_location_id, input.ward_id),
          sql`${patients.id} NOT IN (${assigned})`,
        ))
        .orderBy(asc(encounters.admission_at));

      return rows;
    }),

  // ── Stats for ward dashboard ──────────────────────────────────────────

  stats: protectedProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid(),
      ward_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(patientAssignments.hospital_id, ctx.user.hospital_id),
        eq(patientAssignments.shift_instance_id, input.shift_instance_id),
      ];
      if (input.ward_id) {
        conditions.push(eq(patientAssignments.ward_id, input.ward_id));
      }

      // Total active assignments
      const [totalResult] = await db.select({ count: count() })
        .from(patientAssignments)
        .where(and(...conditions, eq(patientAssignments.status, 'active')));

      // Assignments per nurse
      const nurseLoads = await db.select({
        nurse_id: patientAssignments.nurse_id,
        nurse_name: users.full_name,
        patient_count: count(),
      })
        .from(patientAssignments)
        .innerJoin(users, eq(patientAssignments.nurse_id, users.id))
        .where(and(...conditions, eq(patientAssignments.status, 'active')))
        .groupBy(patientAssignments.nurse_id, users.full_name)
        .orderBy(desc(count()));

      // Pending handoffs for this shift
      const [handoffResult] = await db.select({ count: count() })
        .from(shiftHandoffs)
        .where(and(
          eq(shiftHandoffs.hospital_id, ctx.user.hospital_id),
          eq(shiftHandoffs.outgoing_shift_id, input.shift_instance_id),
          eq(shiftHandoffs.status, 'draft'),
        ));

      return {
        total_assigned: totalResult?.count ?? 0,
        nurse_loads: nurseLoads,
        pending_handoffs: handoffResult?.count ?? 0,
      };
    }),

  // ── Submit shift handoff (SBAR) ───────────────────────────────────────

  submitHandoff: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      outgoing_shift_id: z.string().uuid(),
      incoming_shift_id: z.string().uuid().optional(),
      situation: z.string().optional(),
      background: z.string().optional(),
      assessment: z.string().optional(),
      recommendation: z.string().optional(),
      priority: z.enum(['routine', 'watch', 'critical']).default('routine'),
      pending_tasks: z.array(z.object({
        task: z.string(),
        due_by: z.string().optional(),
        priority: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [handoff] = await db.insert(shiftHandoffs).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id,
        outgoing_shift_id: input.outgoing_shift_id,
        incoming_shift_id: input.incoming_shift_id || null,
        outgoing_nurse_id: ctx.user.sub,
        situation: input.situation || null,
        background: input.background || null,
        assessment: input.assessment || null,
        recommendation: input.recommendation || null,
        priority: input.priority,
        status: 'submitted',
        pending_tasks: input.pending_tasks ? JSON.stringify(input.pending_tasks) : null,
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'shift_handoffs',
        row_id: handoff.id,
        new_values: { patient_id: input.patient_id, priority: input.priority },
        reason: 'Shift handoff submitted',
      });

      return handoff;
    }),

  // ── Get handoffs for incoming shift ───────────────────────────────────

  getHandoffs: protectedProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid(),
      as_incoming: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const shiftField = input.as_incoming
        ? shiftHandoffs.incoming_shift_id
        : shiftHandoffs.outgoing_shift_id;

      const rows = await db.select({
        handoff: shiftHandoffs,
        patient_name: sql<string>`${patients.name_given} || ' ' || COALESCE(${patients.name_family}, '')`.as('patient_name'),
        patient_uhid: patients.uhid,
        outgoing_nurse_name: users.full_name,
      })
        .from(shiftHandoffs)
        .innerJoin(patients, eq(shiftHandoffs.patient_id, patients.id))
        .innerJoin(users, eq(shiftHandoffs.outgoing_nurse_id, users.id))
        .where(and(
          eq(shiftHandoffs.hospital_id, ctx.user.hospital_id),
          eq(shiftField, input.shift_instance_id),
        ))
        .orderBy(
          desc(sql`CASE ${shiftHandoffs.priority} WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END`),
          asc(shiftHandoffs.created_at),
        );

      return rows;
    }),
});
