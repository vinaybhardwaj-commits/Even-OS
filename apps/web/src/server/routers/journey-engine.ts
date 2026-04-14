import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  journeyTemplates, patientJourneySteps, journeyNotifications, journeyEscalations,
  patients, encounters, users,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, count, isNull, ne, inArray } from 'drizzle-orm';

// ============================================================
// JOURNEY ENGINE — JE.2 Core Router
// The state machine that tracks every patient through 9 phases
// and 50 steps. Central to the entire orchestration layer.
//
// 10 procedures:
//   1. startJourney — instantiate from template for a patient/encounter
//   2. getPatientJourney — all steps for a patient
//   3. getCurrentStep — current active step + owner + TAT
//   4. getMyPendingSteps — all steps assigned to current user across patients
//   5. completeStep — the core engine: mark done, evaluate next, assign, notify
//   6. blockStep — mark blocked with reason, trigger escalation
//   7. skipStep — skip with reason (supervisor only)
//   8. assignStep — assign specific user to a step
//   9. getPhaseOverview — aggregate stats per phase (pipeline view)
//  10. getNotifications — notifications for current user
// ============================================================

export const journeyEngineRouter = router({

  // ── 1. Start Journey ──────────────────────────────────────────────────
  // Instantiates a journey from a template for a patient.
  // Called when a patient enters the system (from LSQ or manual admission).
  // Creates one patient_journey_steps row per template step.

  startJourney: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      journey_type: z.enum(['elective_surgical', 'emergency', 'day_care', 'medical']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Fetch template steps for this hospital + journey type
      const templateSteps = await db.select()
        .from(journeyTemplates)
        .where(and(
          eq(journeyTemplates.hospital_id, ctx.user.hospital_id),
          eq(journeyTemplates.journey_type, input.journey_type),
        ))
        .orderBy(asc(journeyTemplates.sort_order));

      if (templateSteps.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No journey template found for type '${input.journey_type}' at hospital '${ctx.user.hospital_id}'. Run the migration first.`,
        });
      }

      // Check if journey already exists for this patient + encounter
      const existingSteps = await db.select({ id: patientJourneySteps.id })
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
          eq(patientJourneySteps.patient_id, input.patient_id),
          input.encounter_id ? eq(patientJourneySteps.encounter_id, input.encounter_id) : sql`true`,
        ))
        .limit(1);

      if (existingSteps.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Journey already exists for this patient. Use getPatientJourney to view it.',
        });
      }

      // Create patient_journey_steps from template
      const insertedIds: string[] = [];
      for (const tmpl of templateSteps) {
        const result = await db.insert(patientJourneySteps).values({
          hospital_id: ctx.user.hospital_id,
          patient_id: input.patient_id,
          encounter_id: input.encounter_id || null,
          template_step_id: tmpl.id,
          phase: tmpl.phase,
          step_number: tmpl.step_number,
          step_name: tmpl.step_name,
          status: 'pending',
          owner_role: tmpl.owner_role,
          tat_target_mins: tmpl.tat_target_mins,
        }).returning({ id: patientJourneySteps.id });
        insertedIds.push(result[0].id);
      }

      // Set first step to in_progress
      if (insertedIds.length > 0) {
        await db.update(patientJourneySteps)
          .set({ status: 'in_progress', started_at: new Date() })
          .where(eq(patientJourneySteps.id, insertedIds[0]));
      }

      // Update patient's journey tracking columns
      await db.update(patients)
        .set({
          journey_current_phase: templateSteps[0].phase,
          journey_current_step: templateSteps[0].step_number,
        })
        .where(eq(patients.id, input.patient_id));

      // Create notification for first step owner
      await db.insert(journeyNotifications).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id || null,
        step_number: templateSteps[0].step_number,
        step_name: templateSteps[0].step_name,
        recipient_role: templateSteps[0].owner_role,
        notification_type: 'step_assigned',
        title: `New journey started: Step ${templateSteps[0].step_number}`,
        body: `Patient journey started. First step: ${templateSteps[0].step_name}. Assigned to role: ${templateSteps[0].owner_role}.`,
      });

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'patient_journey_steps',
        row_id: insertedIds[0],
        new_values: { patient_id: input.patient_id, journey_type: input.journey_type, steps_created: insertedIds.length },
      });

      return { steps_created: insertedIds.length, first_step: templateSteps[0].step_number };
    }),

  // ── 2. Get Patient Journey ────────────────────────────────────────────
  // Returns all steps for a patient, sorted by phase/step_number.

  getPatientJourney: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
        eq(patientJourneySteps.patient_id, input.patient_id),
      ];
      if (input.encounter_id) {
        conditions.push(eq(patientJourneySteps.encounter_id, input.encounter_id));
      }

      const steps = await db.select({
        id: patientJourneySteps.id,
        phase: patientJourneySteps.phase,
        step_number: patientJourneySteps.step_number,
        step_name: patientJourneySteps.step_name,
        status: patientJourneySteps.status,
        owner_role: patientJourneySteps.owner_role,
        owner_user_id: patientJourneySteps.owner_user_id,
        tat_target_mins: patientJourneySteps.tat_target_mins,
        started_at: patientJourneySteps.started_at,
        completed_at: patientJourneySteps.completed_at,
        completed_by: patientJourneySteps.completed_by,
        tat_actual_mins: patientJourneySteps.tat_actual_mins,
        blocked_reason: patientJourneySteps.blocked_reason,
        skipped_reason: patientJourneySteps.skipped_reason,
        step_data: patientJourneySteps.step_data,
      })
        .from(patientJourneySteps)
        .where(and(...conditions))
        .orderBy(asc(patientJourneySteps.phase), asc(patientJourneySteps.step_number));

      // Compute phase summary
      const phases = new Map<string, { total: number; completed: number; in_progress: number; blocked: number }>();
      for (const s of steps) {
        if (!phases.has(s.phase)) phases.set(s.phase, { total: 0, completed: 0, in_progress: 0, blocked: 0 });
        const p = phases.get(s.phase)!;
        p.total++;
        if (s.status === 'completed' || s.status === 'skipped') p.completed++;
        if (s.status === 'in_progress') p.in_progress++;
        if (s.status === 'blocked') p.blocked++;
      }

      return {
        steps,
        phase_summary: Object.fromEntries(phases),
        total_steps: steps.length,
        completed_steps: steps.filter(s => s.status === 'completed' || s.status === 'skipped').length,
        current_step: steps.find(s => s.status === 'in_progress') || null,
      };
    }),

  // ── 3. Get Current Step ───────────────────────────────────────────────

  getCurrentStep: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const step = await db.select()
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
          eq(patientJourneySteps.patient_id, input.patient_id),
          eq(patientJourneySteps.status, 'in_progress'),
        ))
        .orderBy(asc(patientJourneySteps.phase), asc(patientJourneySteps.step_number))
        .limit(1);

      if (step.length === 0) return null;

      // Calculate elapsed time
      const elapsed = step[0].started_at
        ? Math.round((Date.now() - new Date(step[0].started_at).getTime()) / 60000)
        : 0;

      return {
        ...step[0],
        elapsed_mins: elapsed,
        tat_remaining_mins: step[0].tat_target_mins ? step[0].tat_target_mins - elapsed : null,
        is_overdue: step[0].tat_target_mins ? elapsed > step[0].tat_target_mins : false,
      };
    }),

  // ── 4. Get My Pending Steps ───────────────────────────────────────────
  // All steps assigned to the current user (by role or direct assignment)
  // across ALL patients. This drives each persona's task queue.

  getMyPendingSteps: protectedProcedure
    .input(z.object({
      status_filter: z.array(z.enum(['pending', 'in_progress', 'blocked'])).default(['in_progress', 'pending']),
      limit: z.number().min(1).max(100).default(50),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      // Get steps where user is directly assigned OR where their role matches
      const steps = await db.select({
        id: patientJourneySteps.id,
        patient_id: patientJourneySteps.patient_id,
        encounter_id: patientJourneySteps.encounter_id,
        phase: patientJourneySteps.phase,
        step_number: patientJourneySteps.step_number,
        step_name: patientJourneySteps.step_name,
        status: patientJourneySteps.status,
        owner_role: patientJourneySteps.owner_role,
        owner_user_id: patientJourneySteps.owner_user_id,
        tat_target_mins: patientJourneySteps.tat_target_mins,
        started_at: patientJourneySteps.started_at,
        // Join patient info
        patient_name: sql<string>`(SELECT name_given || ' ' || name_family FROM patients WHERE id = ${patientJourneySteps.patient_id})`,
        patient_uhid: sql<string>`(SELECT uhid FROM patients WHERE id = ${patientJourneySteps.patient_id})`,
      })
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
          inArray(patientJourneySteps.status, input.status_filter),
          sql`(${patientJourneySteps.owner_user_id} = ${ctx.user.sub} OR ${patientJourneySteps.owner_role} = ${ctx.user.role})`,
        ))
        .orderBy(asc(patientJourneySteps.phase), asc(patientJourneySteps.step_number))
        .limit(input.limit);

      // Add elapsed time to each
      return steps.map(s => {
        const elapsed = s.started_at
          ? Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000)
          : 0;
        return {
          ...s,
          elapsed_mins: elapsed,
          is_overdue: s.tat_target_mins ? elapsed > s.tat_target_mins : false,
        };
      });
    }),

  // ── 5. Complete Step ──────────────────────────────────────────────────
  // THE CORE ENGINE. Marks a step done, evaluates the next step,
  // assigns it, creates notifications, updates patient tracking columns.

  completeStep: protectedProcedure
    .input(z.object({
      step_id: z.string().uuid(),
      step_data: z.record(z.unknown()).optional(), // Any form data, selections, notes from this step
    }))
    .mutation(async ({ ctx, input }) => {
      // Get the step
      const [step] = await db.select()
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.id, input.step_id),
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
        ));

      if (!step) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Step not found' });
      }
      if (step.status === 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Step already completed' });
      }

      // Calculate actual TAT
      const tat_actual = step.started_at
        ? Math.round((Date.now() - new Date(step.started_at).getTime()) / 60000)
        : null;

      // Mark step complete
      await db.update(patientJourneySteps)
        .set({
          status: 'completed',
          completed_at: new Date(),
          completed_by: ctx.user.sub,
          tat_actual_mins: tat_actual,
          step_data: input.step_data || step.step_data,
          updated_at: new Date(),
        })
        .where(eq(patientJourneySteps.id, input.step_id));

      // Create completion notification
      await db.insert(journeyNotifications).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: step.patient_id,
        encounter_id: step.encounter_id,
        step_number: step.step_number,
        step_name: step.step_name,
        recipient_role: step.owner_role,
        notification_type: 'step_completed',
        title: `Step ${step.step_number} completed`,
        body: `${step.step_name} completed by ${ctx.user.name || ctx.user.role}. TAT: ${tat_actual || '?'} min.`,
      });

      // Check if TAT was exceeded → create escalation record
      if (tat_actual && step.tat_target_mins && tat_actual > step.tat_target_mins) {
        await db.insert(journeyEscalations).values({
          hospital_id: ctx.user.hospital_id,
          patient_id: step.patient_id,
          encounter_id: step.encounter_id,
          step_number: step.step_number,
          step_name: step.step_name,
          step_id: step.id,
          escalation_level: 1,
          escalated_to_role: 'operations_manager',
          reason: `TAT exceeded: target ${step.tat_target_mins} min, actual ${tat_actual} min`,
          resolved_at: new Date(), // Auto-resolved since step completed
          resolved_by: ctx.user.sub,
        });
      }

      // ── Find and activate the next step ──
      const nextSteps = await db.select()
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
          eq(patientJourneySteps.patient_id, step.patient_id),
          eq(patientJourneySteps.status, 'pending'),
        ))
        .orderBy(asc(patientJourneySteps.phase), asc(patientJourneySteps.step_number))
        .limit(1);

      let nextStep = null;
      if (nextSteps.length > 0) {
        nextStep = nextSteps[0];

        // Activate next step
        await db.update(patientJourneySteps)
          .set({ status: 'in_progress', started_at: new Date(), updated_at: new Date() })
          .where(eq(patientJourneySteps.id, nextStep.id));

        // Update patient tracking columns
        await db.update(patients)
          .set({
            journey_current_phase: nextStep.phase,
            journey_current_step: nextStep.step_number,
          })
          .where(eq(patients.id, step.patient_id));

        // Notify next step owner
        await db.insert(journeyNotifications).values({
          hospital_id: ctx.user.hospital_id,
          patient_id: step.patient_id,
          encounter_id: step.encounter_id,
          step_number: nextStep.step_number,
          step_name: nextStep.step_name,
          recipient_role: nextStep.owner_role,
          notification_type: 'step_assigned',
          title: `Step ${nextStep.step_number} assigned to you`,
          body: `${nextStep.step_name} is now active. Previous step (${step.step_name}) completed by ${ctx.user.name || ctx.user.role}.`,
        });
      } else {
        // Journey complete — no more pending steps
        await db.update(patients)
          .set({
            journey_current_phase: null,
            journey_current_step: null,
          })
          .where(eq(patients.id, step.patient_id));
      }

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'patient_journey_steps',
        row_id: step.id,
        new_values: { status: 'completed', tat_actual_mins: tat_actual, next_step: nextStep?.step_number || 'JOURNEY_COMPLETE' },
      });

      return {
        completed_step: step.step_number,
        tat_actual_mins: tat_actual,
        tat_exceeded: tat_actual && step.tat_target_mins ? tat_actual > step.tat_target_mins : false,
        next_step: nextStep ? { number: nextStep.step_number, name: nextStep.step_name, owner_role: nextStep.owner_role } : null,
        journey_complete: nextSteps.length === 0,
      };
    }),

  // ── 6. Block Step ─────────────────────────────────────────────────────

  blockStep: protectedProcedure
    .input(z.object({
      step_id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [step] = await db.select()
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.id, input.step_id),
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
        ));

      if (!step) throw new TRPCError({ code: 'NOT_FOUND', message: 'Step not found' });

      await db.update(patientJourneySteps)
        .set({ status: 'blocked', blocked_reason: input.reason, updated_at: new Date() })
        .where(eq(patientJourneySteps.id, input.step_id));

      // Create escalation
      await db.insert(journeyEscalations).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: step.patient_id,
        encounter_id: step.encounter_id,
        step_number: step.step_number,
        step_name: step.step_name,
        step_id: step.id,
        escalation_level: 1,
        escalated_to_role: 'operations_manager',
        reason: `Step blocked: ${input.reason}`,
      });

      // Notify operations manager
      await db.insert(journeyNotifications).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: step.patient_id,
        encounter_id: step.encounter_id,
        step_number: step.step_number,
        step_name: step.step_name,
        recipient_role: 'operations_manager',
        notification_type: 'escalation',
        title: `Step ${step.step_number} BLOCKED`,
        body: `${step.step_name} blocked by ${ctx.user.name || ctx.user.role}. Reason: ${input.reason}`,
      });

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'patient_journey_steps',
        row_id: step.id,
        new_values: { status: 'blocked', reason: input.reason },
      });

      return { blocked: true, step_number: step.step_number };
    }),

  // ── 7. Skip Step ──────────────────────────────────────────────────────
  // Requires supervisor-level role

  skipStep: protectedProcedure
    .input(z.object({
      step_id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const supervisorRoles = ['super_admin', 'hospital_admin', 'medical_director', 'operations_manager', 'coo'];
      if (!supervisorRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only supervisors can skip journey steps' });
      }

      const [step] = await db.select()
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.id, input.step_id),
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
        ));

      if (!step) throw new TRPCError({ code: 'NOT_FOUND', message: 'Step not found' });

      await db.update(patientJourneySteps)
        .set({
          status: 'skipped',
          skipped_reason: input.reason,
          completed_at: new Date(),
          completed_by: ctx.user.sub,
          updated_at: new Date(),
        })
        .where(eq(patientJourneySteps.id, input.step_id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'patient_journey_steps',
        row_id: step.id,
        new_values: { status: 'skipped', reason: input.reason },
      });

      return { skipped: true, step_number: step.step_number };
    }),

  // ── 8. Assign Step ────────────────────────────────────────────────────
  // Assign a specific user to a step (instead of role-based)

  assignStep: protectedProcedure
    .input(z.object({
      step_id: z.string().uuid(),
      user_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.update(patientJourneySteps)
        .set({ owner_user_id: input.user_id, updated_at: new Date() })
        .where(and(
          eq(patientJourneySteps.id, input.step_id),
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
        ));

      // Notify assigned user
      const [step] = await db.select()
        .from(patientJourneySteps)
        .where(eq(patientJourneySteps.id, input.step_id));

      if (step) {
        await db.insert(journeyNotifications).values({
          hospital_id: ctx.user.hospital_id,
          patient_id: step.patient_id,
          encounter_id: step.encounter_id,
          step_number: step.step_number,
          step_name: step.step_name,
          recipient_user_id: input.user_id,
          notification_type: 'step_assigned',
          title: `Step ${step.step_number} assigned to you`,
          body: `${step.step_name} has been assigned to you by ${ctx.user.name || ctx.user.role}.`,
        });
      }

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'patient_journey_steps',
        row_id: input.step_id,
        new_values: { owner_user_id: input.user_id },
      });

      return { assigned: true };
    }),

  // ── 9. Get Phase Overview ─────────────────────────────────────────────
  // Aggregate stats per phase across all active patients.
  // Drives the IP Coordinator's pipeline view.

  getPhaseOverview: protectedProcedure
    .query(async ({ ctx }) => {
      const results = await db.select({
        phase: patientJourneySteps.phase,
        status: patientJourneySteps.status,
        count: count(),
      })
        .from(patientJourneySteps)
        .where(eq(patientJourneySteps.hospital_id, ctx.user.hospital_id))
        .groupBy(patientJourneySteps.phase, patientJourneySteps.status);

      // Reshape into phase → { pending, in_progress, completed, blocked, skipped, total }
      const phases: Record<string, Record<string, number>> = {};
      for (const row of results) {
        if (!phases[row.phase]) phases[row.phase] = { pending: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0, not_applicable: 0, total: 0 };
        phases[row.phase][row.status] = Number(row.count);
        phases[row.phase].total += Number(row.count);
      }

      // Count distinct patients per phase (for pipeline card counts)
      const patientsByPhase = await db.select({
        phase: patientJourneySteps.phase,
        patient_count: sql<number>`COUNT(DISTINCT ${patientJourneySteps.patient_id})`,
      })
        .from(patientJourneySteps)
        .where(and(
          eq(patientJourneySteps.hospital_id, ctx.user.hospital_id),
          inArray(patientJourneySteps.status, ['in_progress', 'pending', 'blocked']),
        ))
        .groupBy(patientJourneySteps.phase);

      return { phases, patients_by_phase: patientsByPhase };
    }),

  // ── 10. Get Notifications ─────────────────────────────────────────────

  getNotifications: protectedProcedure
    .input(z.object({
      unread_only: z.boolean().default(true),
      limit: z.number().min(1).max(100).default(20),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(journeyNotifications.hospital_id, ctx.user.hospital_id),
        sql`(${journeyNotifications.recipient_user_id} = ${ctx.user.sub} OR ${journeyNotifications.recipient_role} = ${ctx.user.role})`,
      ];

      if (input.unread_only) {
        conditions.push(isNull(journeyNotifications.read_at));
      }

      const notifications = await db.select()
        .from(journeyNotifications)
        .where(and(...conditions))
        .orderBy(desc(journeyNotifications.created_at))
        .limit(input.limit);

      return notifications;
    }),

  // ── Mark Notification Read ────────────────────────────────────────────

  markNotificationRead: protectedProcedure
    .input(z.object({
      notification_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.update(journeyNotifications)
        .set({ read_at: new Date() })
        .where(and(
          eq(journeyNotifications.id, input.notification_id),
          eq(journeyNotifications.hospital_id, ctx.user.hospital_id),
        ));
      return { read: true };
    }),
});
