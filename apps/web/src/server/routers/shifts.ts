import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  shiftTemplates, shiftInstances, shiftRoster, shiftSwaps,
  leaveRequests, staffingTargets, overtimeLog,
  locations, users,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, inArray, gte, lte, count } from 'drizzle-orm';

// ============================================================
// SHIFTS & WORKFORCE MANAGEMENT — SM.1 Foundation
// Procedures: templates CRUD, instance generation, roster ops,
//   current-shift lookup, staffing stats
// ============================================================

// Default shift templates for seeding
const DEFAULT_SHIFTS = [
  { name: 'Morning', shift_name: 'morning' as const, start_time: '06:00', end_time: '14:00', duration_hours: 8, color: '#22C55E' },
  { name: 'Evening', shift_name: 'evening' as const, start_time: '14:00', end_time: '22:00', duration_hours: 8, color: '#F59E0B' },
  { name: 'Night', shift_name: 'night' as const, start_time: '22:00', end_time: '06:00', duration_hours: 8, color: '#6366F1' },
  { name: 'General', shift_name: 'general' as const, start_time: '09:00', end_time: '17:00', duration_hours: 8, color: '#3B82F6' },
];

export const shiftsRouter = router({

  // ── Template Management ────────────────────────────────────────────────

  /**
   * List all shift templates for this hospital.
   */
  getTemplates: protectedProcedure
    .input(z.object({
      active_only: z.boolean().default(true),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(shiftTemplates.hospital_id, ctx.user.hospital_id)];
      if (input.active_only) {
        conditions.push(eq(shiftTemplates.is_active, true));
      }

      const rows = await db.select()
        .from(shiftTemplates)
        .where(and(...conditions))
        .orderBy(asc(shiftTemplates.start_time));

      return rows;
    }),

  /**
   * Create a new shift template.
   */
  createTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      shift_name: z.enum(['morning', 'evening', 'night', 'general', 'custom']),
      start_time: z.string().regex(/^\d{2}:\d{2}$/),
      end_time: z.string().regex(/^\d{2}:\d{2}$/),
      duration_hours: z.number().min(1).max(24).default(8),
      ward_type: z.enum(['icu', 'general', 'step_down', 'ot', 'er', 'all']).default('all'),
      is_default: z.boolean().default(false),
      color: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [template] = await db.insert(shiftTemplates).values({
        hospital_id: ctx.user.hospital_id,
        ...input,
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'shift_templates',
        row_id: template.id,
        new_values: input,
        reason: `Shift template "${input.name}" created`,
      });

      return template;
    }),

  /**
   * Update a shift template.
   */
  updateTemplate: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      shift_name: z.enum(['morning', 'evening', 'night', 'general', 'custom']).optional(),
      start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      duration_hours: z.number().min(1).max(24).optional(),
      ward_type: z.enum(['icu', 'general', 'step_down', 'ot', 'er', 'all']).optional(),
      is_default: z.boolean().optional(),
      is_active: z.boolean().optional(),
      color: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [existing] = await db.select()
        .from(shiftTemplates)
        .where(and(eq(shiftTemplates.id, id), eq(shiftTemplates.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift template not found' });

      const setValues: Record<string, any> = { updated_at: new Date() };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) setValues[key] = value;
      }

      await db.update(shiftTemplates).set(setValues).where(eq(shiftTemplates.id, id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'shift_templates',
        row_id: id,
        old_values: { name: existing.name, start_time: existing.start_time, end_time: existing.end_time },
        new_values: updates,
        reason: `Shift template "${existing.name}" updated`,
      });

      return { success: true };
    }),

  /**
   * Seed default shift templates (Morning, Evening, Night, General).
   * Only creates if none exist for this hospital.
   */
  seedDefaults: adminProcedure
    .mutation(async ({ ctx }) => {
      const existing = await db.select({ id: shiftTemplates.id })
        .from(shiftTemplates)
        .where(eq(shiftTemplates.hospital_id, ctx.user.hospital_id))
        .limit(1);

      if (existing.length > 0) {
        return { seeded: false, message: 'Templates already exist for this hospital' };
      }

      const values = DEFAULT_SHIFTS.map(s => ({
        hospital_id: ctx.user.hospital_id,
        name: s.name,
        shift_name: s.shift_name,
        start_time: s.start_time,
        end_time: s.end_time,
        duration_hours: s.duration_hours,
        ward_type: 'all' as const,
        is_default: true,
        is_active: true,
        color: s.color,
      }));

      await db.insert(shiftTemplates).values(values);

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'shift_templates',
        row_id: 'seed',
        new_values: { templates: DEFAULT_SHIFTS.map(s => s.name) },
        reason: 'Default shift templates seeded',
      });

      return { seeded: true, count: DEFAULT_SHIFTS.length };
    }),

  // ── Instance Management ────────────────────────────────────────────────

  /**
   * Generate shift instances for a date range and set of wards.
   * Creates one instance per template × ward × date (skips duplicates).
   */
  generateInstances: adminProcedure
    .input(z.object({
      start_date: z.string(), // YYYY-MM-DD
      end_date: z.string(),
      ward_ids: z.array(z.string().uuid()).min(1),
      template_ids: z.array(z.string().uuid()).optional(), // if not provided, uses all active defaults
    }))
    .mutation(async ({ ctx, input }) => {
      // Get templates
      let templates;
      if (input.template_ids && input.template_ids.length > 0) {
        templates = await db.select()
          .from(shiftTemplates)
          .where(and(
            eq(shiftTemplates.hospital_id, ctx.user.hospital_id),
            eq(shiftTemplates.is_active, true),
            inArray(shiftTemplates.id, input.template_ids),
          ));
      } else {
        templates = await db.select()
          .from(shiftTemplates)
          .where(and(
            eq(shiftTemplates.hospital_id, ctx.user.hospital_id),
            eq(shiftTemplates.is_active, true),
            eq(shiftTemplates.is_default, true),
          ));
      }

      if (templates.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active templates found. Seed defaults first.' });
      }

      // Generate date range
      const dates: string[] = [];
      const start = new Date(input.start_date);
      const end = new Date(input.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }

      if (dates.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid date range' });
      }

      if (dates.length > 31) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Maximum 31 days per generation batch' });
      }

      // Build instance values
      const values: Array<{
        hospital_id: string;
        template_id: string;
        ward_id: string;
        shift_date: string;
        status: 'planned';
      }> = [];

      for (const date of dates) {
        for (const ward_id of input.ward_ids) {
          for (const template of templates) {
            values.push({
              hospital_id: ctx.user.hospital_id,
              template_id: template.id,
              ward_id,
              shift_date: date,
              status: 'planned',
            });
          }
        }
      }

      // Insert with ON CONFLICT DO NOTHING (unique constraint handles dedup)
      const result = await db.insert(shiftInstances)
        .values(values)
        .onConflictDoNothing({ target: [shiftInstances.template_id, shiftInstances.ward_id, shiftInstances.shift_date] })
        .returning({ id: shiftInstances.id });

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'shift_instances',
        row_id: 'batch',
        new_values: {
          date_range: `${input.start_date} to ${input.end_date}`,
          ward_count: input.ward_ids.length,
          template_count: templates.length,
          instances_created: result.length,
        },
        reason: `Generated ${result.length} shift instances for ${dates.length} days × ${input.ward_ids.length} wards`,
      });

      return { created: result.length, total_attempted: values.length, skipped: values.length - result.length };
    }),

  /**
   * List shift instances for a date/ward/template combination.
   */
  listInstances: protectedProcedure
    .input(z.object({
      ward_id: z.string().uuid().optional(),
      start_date: z.string(), // YYYY-MM-DD
      end_date: z.string().optional(),
      status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(shiftInstances.hospital_id, ctx.user.hospital_id),
        gte(shiftInstances.shift_date, input.start_date),
      ];

      if (input.end_date) {
        conditions.push(lte(shiftInstances.shift_date, input.end_date));
      } else {
        conditions.push(lte(shiftInstances.shift_date, input.start_date));
      }

      if (input.ward_id) {
        conditions.push(eq(shiftInstances.ward_id, input.ward_id));
      }

      if (input.status) {
        conditions.push(eq(shiftInstances.status, input.status));
      }

      const rows = await db.select({
        id: shiftInstances.id,
        template_id: shiftInstances.template_id,
        ward_id: shiftInstances.ward_id,
        shift_date: shiftInstances.shift_date,
        status: shiftInstances.status,
        charge_nurse_id: shiftInstances.charge_nurse_id,
        actual_start: shiftInstances.actual_start,
        actual_end: shiftInstances.actual_end,
        notes: shiftInstances.notes,
        // Join template info
        template_name: shiftTemplates.name,
        shift_name: shiftTemplates.shift_name,
        start_time: shiftTemplates.start_time,
        end_time: shiftTemplates.end_time,
        color: shiftTemplates.color,
      })
        .from(shiftInstances)
        .innerJoin(shiftTemplates, eq(shiftInstances.template_id, shiftTemplates.id))
        .where(and(...conditions))
        .orderBy(asc(shiftInstances.shift_date), asc(shiftTemplates.start_time));

      return rows;
    }),

  /**
   * Update shift instance (status, charge nurse, notes, actual times).
   */
  updateInstance: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
      charge_nurse_id: z.string().uuid().nullable().optional(),
      notes: z.string().nullable().optional(),
      actual_start: z.string().datetime().nullable().optional(),
      actual_end: z.string().datetime().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [existing] = await db.select()
        .from(shiftInstances)
        .where(and(eq(shiftInstances.id, id), eq(shiftInstances.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift instance not found' });

      const setValues: Record<string, any> = { updated_at: new Date() };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) setValues[key] = value;
      }

      await db.update(shiftInstances).set(setValues).where(eq(shiftInstances.id, id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'shift_instances',
        row_id: id,
        old_values: { status: existing.status },
        new_values: updates,
        reason: `Shift instance updated`,
      });

      return { success: true };
    }),

  // ── Roster Management ──────────────────────────────────────────────────

  /**
   * Get roster for a shift instance (all assigned staff).
   */
  getRoster: protectedProcedure
    .input(z.object({ shift_instance_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify instance belongs to hospital
      const [instance] = await db.select({ id: shiftInstances.id })
        .from(shiftInstances)
        .where(and(
          eq(shiftInstances.id, input.shift_instance_id),
          eq(shiftInstances.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift instance not found' });

      const roster = await db.select({
        id: shiftRoster.id,
        user_id: shiftRoster.user_id,
        role_during_shift: shiftRoster.role_during_shift,
        status: shiftRoster.status,
        assigned_by: shiftRoster.assigned_by,
        assigned_at: shiftRoster.assigned_at,
        notes: shiftRoster.notes,
        // Join user info
        user_name: users.full_name,
        user_email: users.email,
        user_department: users.department,
      })
        .from(shiftRoster)
        .innerJoin(users, eq(shiftRoster.user_id, users.id))
        .where(eq(shiftRoster.shift_instance_id, input.shift_instance_id))
        .orderBy(asc(shiftRoster.role_during_shift));

      return roster;
    }),

  /**
   * Assign a staff member to a shift instance.
   */
  assignStaff: adminProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid(),
      user_id: z.string().uuid(),
      role_during_shift: z.string().default('nurse'),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify instance
      const [instance] = await db.select({ id: shiftInstances.id, shift_date: shiftInstances.shift_date })
        .from(shiftInstances)
        .where(and(
          eq(shiftInstances.id, input.shift_instance_id),
          eq(shiftInstances.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shift instance not found' });

      // Check user exists
      const [user] = await db.select({ id: users.id, full_name: users.full_name })
        .from(users)
        .where(and(eq(users.id, input.user_id), eq(users.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      // Insert (unique constraint prevents double-assignment)
      try {
        const [assignment] = await db.insert(shiftRoster).values({
          shift_instance_id: input.shift_instance_id,
          user_id: input.user_id,
          role_during_shift: input.role_during_shift,
          assigned_by: ctx.user.sub,
          notes: input.notes,
        }).returning();

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'shift_roster',
          row_id: assignment.id,
          new_values: { user_id: input.user_id, user_name: user.full_name, role: input.role_during_shift, shift_date: instance.shift_date },
          reason: `Assigned ${user.full_name} to shift as ${input.role_during_shift}`,
        });

        return { success: true, id: assignment.id };
      } catch (err: any) {
        if (err.code === '23505') { // unique constraint violation
          throw new TRPCError({ code: 'CONFLICT', message: 'Staff member already assigned to this shift' });
        }
        throw err;
      }
    }),

  /**
   * Remove a staff member from a shift instance.
   */
  removeStaff: adminProcedure
    .input(z.object({
      roster_id: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get existing assignment with instance check
      const [assignment] = await db.select({
        id: shiftRoster.id,
        user_id: shiftRoster.user_id,
        shift_instance_id: shiftRoster.shift_instance_id,
        role_during_shift: shiftRoster.role_during_shift,
        hospital_id: shiftInstances.hospital_id,
      })
        .from(shiftRoster)
        .innerJoin(shiftInstances, eq(shiftRoster.shift_instance_id, shiftInstances.id))
        .where(eq(shiftRoster.id, input.roster_id))
        .limit(1);

      if (!assignment || assignment.hospital_id !== ctx.user.hospital_id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Roster entry not found' });
      }

      await db.update(shiftRoster)
        .set({ status: 'cancelled', updated_at: new Date(), notes: input.reason || 'Removed by admin' })
        .where(eq(shiftRoster.id, input.roster_id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'shift_roster',
        row_id: input.roster_id,
        old_values: { status: 'scheduled' },
        new_values: { status: 'cancelled' },
        reason: input.reason || `Staff removed from shift`,
      });

      return { success: true };
    }),

  // ── Current Shift Lookup ───────────────────────────────────────────────

  /**
   * Get the current shift for the logged-in user (based on time of day).
   * Returns the active/planned shift instance for today where user is rostered.
   */
  getCurrentShift: protectedProcedure
    .query(async ({ ctx }) => {
      const today = new Date().toISOString().split('T')[0];

      const rows = await db.select({
        roster_id: shiftRoster.id,
        roster_status: shiftRoster.status,
        role_during_shift: shiftRoster.role_during_shift,
        instance_id: shiftInstances.id,
        instance_status: shiftInstances.status,
        ward_id: shiftInstances.ward_id,
        shift_date: shiftInstances.shift_date,
        template_name: shiftTemplates.name,
        shift_name: shiftTemplates.shift_name,
        start_time: shiftTemplates.start_time,
        end_time: shiftTemplates.end_time,
        color: shiftTemplates.color,
        charge_nurse_id: shiftInstances.charge_nurse_id,
      })
        .from(shiftRoster)
        .innerJoin(shiftInstances, eq(shiftRoster.shift_instance_id, shiftInstances.id))
        .innerJoin(shiftTemplates, eq(shiftInstances.template_id, shiftTemplates.id))
        .where(and(
          eq(shiftRoster.user_id, ctx.user.sub),
          eq(shiftInstances.shift_date, today),
          inArray(shiftRoster.status, ['scheduled', 'confirmed']),
          inArray(shiftInstances.status, ['planned', 'active']),
        ))
        .orderBy(asc(shiftTemplates.start_time))
        .limit(3); // A user could have 1-2 shifts per day at most

      return rows;
    }),

  /**
   * Get "My Schedule" — shifts for the current user in a date range.
   */
  getMyShifts: protectedProcedure
    .input(z.object({
      start_date: z.string(),
      end_date: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select({
        roster_id: shiftRoster.id,
        roster_status: shiftRoster.status,
        role_during_shift: shiftRoster.role_during_shift,
        instance_id: shiftInstances.id,
        instance_status: shiftInstances.status,
        ward_id: shiftInstances.ward_id,
        shift_date: shiftInstances.shift_date,
        template_name: shiftTemplates.name,
        shift_name: shiftTemplates.shift_name,
        start_time: shiftTemplates.start_time,
        end_time: shiftTemplates.end_time,
        color: shiftTemplates.color,
        charge_nurse_id: shiftInstances.charge_nurse_id,
        notes: shiftRoster.notes,
      })
        .from(shiftRoster)
        .innerJoin(shiftInstances, eq(shiftRoster.shift_instance_id, shiftInstances.id))
        .innerJoin(shiftTemplates, eq(shiftInstances.template_id, shiftTemplates.id))
        .where(and(
          eq(shiftRoster.user_id, ctx.user.sub),
          gte(shiftInstances.shift_date, input.start_date),
          lte(shiftInstances.shift_date, input.end_date),
          inArray(shiftRoster.status, ['scheduled', 'confirmed', 'swapped']),
        ))
        .orderBy(asc(shiftInstances.shift_date), asc(shiftTemplates.start_time));

      return rows;
    }),

  // ── Staffing Targets ───────────────────────────────────────────────────

  /**
   * Get staffing targets for this hospital.
   */
  getStaffingTargets: adminProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select()
        .from(staffingTargets)
        .where(and(
          eq(staffingTargets.hospital_id, ctx.user.hospital_id),
          eq(staffingTargets.is_active, true),
        ))
        .orderBy(asc(staffingTargets.ward_type));

      return rows;
    }),

  /**
   * Upsert a staffing target.
   */
  upsertStaffingTarget: adminProcedure
    .input(z.object({
      ward_type: z.enum(['icu', 'general', 'step_down', 'ot', 'er', 'all']),
      role: z.string().default('nurse'),
      min_ratio: z.number().min(0).max(10),
      optimal_ratio: z.number().min(0).max(10),
      amber_threshold_pct: z.number().min(0).max(100).default(20),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if exists
      const [existing] = await db.select({ id: staffingTargets.id })
        .from(staffingTargets)
        .where(and(
          eq(staffingTargets.hospital_id, ctx.user.hospital_id),
          eq(staffingTargets.ward_type, input.ward_type),
          eq(staffingTargets.role, input.role),
        ))
        .limit(1);

      if (existing) {
        await db.update(staffingTargets)
          .set({
            min_ratio: input.min_ratio,
            optimal_ratio: input.optimal_ratio,
            amber_threshold_pct: input.amber_threshold_pct,
            notes: input.notes,
            updated_at: new Date(),
          })
          .where(eq(staffingTargets.id, existing.id));

        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'staffing_targets',
          row_id: existing.id,
          new_values: input,
          reason: `Updated staffing target for ${input.ward_type} ${input.role}`,
        });

        return { id: existing.id, action: 'updated' };
      } else {
        const [inserted] = await db.insert(staffingTargets).values({
          hospital_id: ctx.user.hospital_id,
          ...input,
        }).returning({ id: staffingTargets.id });

        await writeAuditLog(ctx.user, {
          action: 'INSERT',
          table_name: 'staffing_targets',
          row_id: inserted.id,
          new_values: input,
          reason: `Created staffing target for ${input.ward_type} ${input.role}`,
        });

        return { id: inserted.id, action: 'created' };
      }
    }),

  // ── Ward List (for shift pages) ─────────────────────────────────────────

  /**
   * Get wards for the hospital (from locations table).
   */
  getWards: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select({
        id: locations.id,
        name: locations.name,
        location_type: locations.location_type,
        parent_location_id: locations.parent_location_id,
        capacity: locations.capacity,
        status: locations.status,
      })
        .from(locations)
        .where(and(
          eq(locations.hospital_id, ctx.user.hospital_id),
          eq(locations.location_type, 'ward'),
          eq(locations.status, 'active'),
        ))
        .orderBy(asc(locations.name));

      return rows;
    }),

  // ── Stats ──────────────────────────────────────────────────────────────

  /**
   * Shift management dashboard stats.
   */
  stats: adminProcedure
    .query(async ({ ctx }) => {
      const today = new Date().toISOString().split('T')[0];

      // Template count
      const [templateCount] = await db.select({ count: count() })
        .from(shiftTemplates)
        .where(and(eq(shiftTemplates.hospital_id, ctx.user.hospital_id), eq(shiftTemplates.is_active, true)));

      // Today's instances
      const [todayInstances] = await db.select({ count: count() })
        .from(shiftInstances)
        .where(and(
          eq(shiftInstances.hospital_id, ctx.user.hospital_id),
          eq(shiftInstances.shift_date, today),
        ));

      // Today's rostered staff
      const todayRostered = await db.select({ count: count() })
        .from(shiftRoster)
        .innerJoin(shiftInstances, eq(shiftRoster.shift_instance_id, shiftInstances.id))
        .where(and(
          eq(shiftInstances.hospital_id, ctx.user.hospital_id),
          eq(shiftInstances.shift_date, today),
          inArray(shiftRoster.status, ['scheduled', 'confirmed']),
        ));

      // Pending leave requests
      const [pendingLeave] = await db.select({ count: count() })
        .from(leaveRequests)
        .where(and(
          eq(leaveRequests.hospital_id, ctx.user.hospital_id),
          eq(leaveRequests.status, 'pending'),
        ));

      // Pending swap requests
      const [pendingSwaps] = await db.select({ count: count() })
        .from(shiftSwaps)
        .where(and(
          eq(shiftSwaps.hospital_id, ctx.user.hospital_id),
          inArray(shiftSwaps.status, ['pending_target', 'pending_approval']),
        ));

      // Flagged overtime
      const [flaggedOvertime] = await db.select({ count: count() })
        .from(overtimeLog)
        .where(and(
          eq(overtimeLog.hospital_id, ctx.user.hospital_id),
          eq(overtimeLog.is_flagged, true),
        ));

      return {
        active_templates: templateCount.count,
        today_instances: todayInstances.count,
        today_rostered: todayRostered[0]?.count ?? 0,
        pending_leave_requests: pendingLeave.count,
        pending_swap_requests: pendingSwaps.count,
        flagged_overtime: flaggedOvertime.count,
      };
    }),
});
