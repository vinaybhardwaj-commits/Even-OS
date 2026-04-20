import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { roles, rolePermissions, permissions, users } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, inArray, count } from 'drizzle-orm';

// ============================================================
// ROLE TEMPLATES — pre-built permission sets for quick role setup
// ============================================================

const ROLE_TEMPLATES: Record<string, {
  name: string;
  description: string;
  role_group: string;
  session_timeout_minutes: number;
  permissions: string[]; // "resource.action" strings
}> = {
  standard_nurse: {
    name: 'Standard Nurse',
    description: 'Ward nurse — vitals, meds, assessments, handoff, I/O charting',
    role_group: 'nursing',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'observation.view', 'observation.create', 'observation.update',
      'medication_order.view', 'medication_administration.create', 'medication_administration.view',
      'nursing_assessment.view', 'nursing_assessment.create', 'nursing_assessment.update',
      'clinical_note.view', 'clinical_note.create',
      'shift_handoff.view', 'shift_handoff.create', 'shift_handoff.update',
      'encounter.view',
      'bed.view',
      'allergy.view',
      'condition.view',
      'escalation.create', 'escalation.view',
    ],
  },
  icu_nurse: {
    name: 'ICU Nurse',
    description: 'ICU nurse — all standard nurse permissions plus hourly vitals, ventilator, invasive monitoring',
    role_group: 'nursing',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'observation.view', 'observation.create', 'observation.update',
      'medication_order.view', 'medication_administration.create', 'medication_administration.view',
      'nursing_assessment.view', 'nursing_assessment.create', 'nursing_assessment.update',
      'clinical_note.view', 'clinical_note.create',
      'shift_handoff.view', 'shift_handoff.create', 'shift_handoff.update',
      'encounter.view',
      'bed.view',
      'allergy.view',
      'condition.view',
      'escalation.create', 'escalation.view',
      'ventilator.view', 'ventilator.create',
      'blood_gas.view', 'blood_gas.create',
      'procedure.view', 'procedure.create',
    ],
  },
  charge_nurse_template: {
    name: 'Charge Nurse',
    description: 'Ward charge nurse — assignments, staffing, escalation management, all standard nurse permissions',
    role_group: 'nursing',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'observation.view', 'observation.create', 'observation.update',
      'medication_order.view', 'medication_administration.create', 'medication_administration.view',
      'nursing_assessment.view', 'nursing_assessment.create', 'nursing_assessment.update',
      'clinical_note.view', 'clinical_note.create',
      'shift_handoff.view', 'shift_handoff.create', 'shift_handoff.update',
      'encounter.view',
      'bed.view', 'bed.assign',
      'allergy.view',
      'condition.view',
      'escalation.create', 'escalation.view', 'escalation.manage',
      'patient_assignment.view', 'patient_assignment.create', 'patient_assignment.update', 'patient_assignment.delete',
      'shift_roster.view', 'shift_roster.update',
      'staffing.view',
    ],
  },
  ward_pharmacist: {
    name: 'Ward Pharmacist',
    description: 'Pharmacist — order verification, dispensing, inventory, narcotics register',
    role_group: 'pharmacy',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'medication_order.view', 'medication_order.verify', 'medication_order.reject', 'medication_order.clarify',
      'dispensing.view', 'dispensing.create',
      'inventory.view', 'inventory.update',
      'narcotics.view', 'narcotics.dispense', 'narcotics.count',
      'pharmacy_return.view', 'pharmacy_return.create',
      'allergy.view',
      'cds_alert.view',
      'encounter.view',
    ],
  },
  lab_technician_template: {
    name: 'Lab Technician',
    description: 'Lab tech — worklist, specimen tracking, results entry, critical value alerting',
    role_group: 'lab',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'lab_order.view',
      'specimen.view', 'specimen.collect', 'specimen.receive',
      'lab_result.view', 'lab_result.create', 'lab_result.verify',
      'critical_value.view', 'critical_value.alert',
      'encounter.view',
    ],
  },
  resident_doctor: {
    name: 'Resident Doctor',
    description: 'RMO/Resident — patient list, SOAP notes, orders, co-sign, rounds companion',
    role_group: 'clinical',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'observation.view',
      'clinical_note.view', 'clinical_note.create', 'clinical_note.update',
      'medication_order.view', 'medication_order.create',
      'clinical_order.view', 'clinical_order.create',
      'lab_result.view', 'lab_result.acknowledge',
      'encounter.view',
      'discharge.initiate',
      'allergy.view', 'allergy.create',
      'condition.view', 'condition.create',
      'procedure.view', 'procedure.create',
      'escalation.view', 'escalation.respond',
      'cosign.view',
    ],
  },
  attending_consultant: {
    name: 'Attending Consultant',
    description: 'Consultant — rounds view, quick notes, co-sign approval, discharge approval',
    role_group: 'clinical',
    session_timeout_minutes: 1440,
    permissions: [
      'patient.view', 'patient.search',
      'observation.view',
      'clinical_note.view', 'clinical_note.create', 'clinical_note.update',
      'medication_order.view', 'medication_order.create', 'medication_order.approve',
      'clinical_order.view', 'clinical_order.create', 'clinical_order.approve',
      'lab_result.view', 'lab_result.acknowledge',
      'encounter.view',
      'discharge.initiate', 'discharge.approve',
      'allergy.view',
      'condition.view',
      'procedure.view',
      'cosign.view', 'cosign.approve', 'cosign.reject',
      'escalation.view',
    ],
  },
  customer_care: {
    name: 'Customer Care / IP Coordinator',
    description: 'Front desk — patient journey, registration, bed allocation, OPD queue, discharge coordination',
    role_group: 'support',
    session_timeout_minutes: 720,
    permissions: [
      'patient.view', 'patient.search', 'patient.create', 'patient.update',
      'encounter.view', 'encounter.create',
      'bed.view', 'bed.assign',
      'opd_queue.view', 'opd_queue.create', 'opd_queue.update',
      'discharge.view', 'discharge.coordinate',
      'billing.view',
      'insurance.view',
      'lsq_lead.view',
      'escalation.view', 'escalation.create',
    ],
  },
  billing_exec: {
    name: 'Billing Executive',
    description: 'Billing — pre-auth, charges, discharge billing, claims, collections',
    role_group: 'billing',
    session_timeout_minutes: 720,
    permissions: [
      'patient.view', 'patient.search',
      'billing.view', 'billing.create', 'billing.update',
      'insurance.view', 'insurance.create', 'insurance.update',
      'encounter.view',
      'discharge.view',
      'refund.view', 'refund.create',
      'invoice.view', 'invoice.create',
    ],
  },
  ot_surgeon: {
    name: 'Surgeon',
    description: 'Surgeon — OT schedule, WHO checklist, operative notes, pre-op status',
    role_group: 'clinical',
    session_timeout_minutes: 480,
    permissions: [
      'patient.view', 'patient.search',
      'ot_schedule.view',
      'who_checklist.view', 'who_checklist.sign',
      'operative_note.view', 'operative_note.create',
      'clinical_note.view', 'clinical_note.create',
      'medication_order.view', 'medication_order.create',
      'clinical_order.view', 'clinical_order.create',
      'encounter.view',
      'consent.view',
    ],
  },
};

export const rolesRouter = router({
  /**
   * List all roles for the current hospital with permission counts and user counts.
   */
  list: adminProcedure.query(async ({ ctx }) => {
    const roleRows = await db.select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      role_group: roles.role_group,
      session_timeout_minutes: roles.session_timeout_minutes,
      is_active: roles.is_active,
      is_system_role: roles.is_system_role,
      created_at: roles.created_at,
      updated_at: roles.updated_at,
    })
      .from(roles)
      .where(eq(roles.hospital_id, ctx.user.hospital_id));

    // Get permission counts per role
    const permCounts = await db.select({
      role_id: rolePermissions.role_id,
      perm_count: sql<number>`count(*)`,
    })
      .from(rolePermissions)
      .groupBy(rolePermissions.role_id);

    const countMap = new Map(permCounts.map(pc => [pc.role_id, Number(pc.perm_count)]));

    // Get user counts per role (users.roles is text[], need to check array contains)
    // DEMO.9 — exclude hidden rows (demo@even.in + 4 persona targets) from
    // admin display counts. Enforcement queries elsewhere still see them.
    const allUsers = await db.select({
      id: users.id,
      userRoles: users.roles,
    })
      .from(users)
      .where(and(
        eq(users.hospital_id, ctx.user.hospital_id),
        eq(users.status, 'active'),
        eq(users.hidden, false),
      ));

    const userCountMap = new Map<string, number>();
    for (const u of allUsers) {
      if (u.userRoles) {
        for (const r of u.userRoles) {
          userCountMap.set(r, (userCountMap.get(r) || 0) + 1);
        }
      }
    }

    return roleRows.map(role => ({
      ...role,
      permission_count: countMap.get(role.id) || 0,
      user_count: userCountMap.get(role.name) || 0,
    }));
  }),

  /**
   * Get a single role with its full permission list.
   */
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [role] = await db.select()
        .from(roles)
        .where(and(
          eq(roles.id, input.id),
          eq(roles.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });

      // Get permissions for this role
      const perms = await db.select({
        id: permissions.id,
        resource: permissions.resource,
        action: permissions.action,
        description: permissions.description,
      })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permission_id, permissions.id))
        .where(eq(rolePermissions.role_id, role.id));

      // Get users with this role
      // DEMO.9 — exclude hidden rows from role drill-down so demo/test
      // accounts don't appear in the "Users with this role" panel.
      const roleUsers = await db.select({
        id: users.id,
        full_name: users.full_name,
        email: users.email,
        department: users.department,
      })
        .from(users)
        .where(and(
          eq(users.hospital_id, ctx.user.hospital_id),
          eq(users.status, 'active'),
          eq(users.hidden, false),
          sql`${users.roles} @> ARRAY[${role.name}]::text[]`,
        ));

      return {
        ...role,
        permissions: perms,
        users: roleUsers,
      };
    }),

  /**
   * Create a new custom role.
   */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(2).max(100),
      description: z.string().optional(),
      role_group: z.enum(['clinical', 'nursing', 'admin', 'billing', 'pharmacy', 'lab', 'radiology', 'support', 'executive', 'system']),
      session_timeout_minutes: z.number().min(30).max(1440).default(480),
      permission_ids: z.array(z.string().uuid()).optional().default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate name
      const existing = await db.select({ id: roles.id })
        .from(roles)
        .where(and(
          eq(roles.name, input.name.toLowerCase().replace(/\s+/g, '_')),
          eq(roles.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A role with this name already exists' });
      }

      const roleName = input.name.toLowerCase().replace(/\s+/g, '_');

      const [newRole] = await db.insert(roles).values({
        name: roleName,
        description: input.description || '',
        role_group: input.role_group,
        session_timeout_minutes: input.session_timeout_minutes,
        hospital_id: ctx.user.hospital_id,
        is_active: true,
        is_system_role: false,
      }).returning({ id: roles.id });

      // Assign permissions if provided
      if (input.permission_ids.length > 0) {
        await db.insert(rolePermissions).values(
          input.permission_ids.map(pid => ({
            role_id: newRole.id,
            permission_id: pid,
          }))
        );
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'roles',
        row_id: newRole.id,
        new_values: { name: roleName, role_group: input.role_group, permissions: input.permission_ids.length },
        reason: 'Role created',
      });

      return { id: newRole.id, name: roleName, success: true };
    }),

  /**
   * Update a custom role. System roles cannot be updated.
   */
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      description: z.string().optional(),
      role_group: z.enum(['clinical', 'nursing', 'admin', 'billing', 'pharmacy', 'lab', 'radiology', 'support', 'executive', 'system']).optional(),
      session_timeout_minutes: z.number().min(30).max(1440).optional(),
      is_active: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [role] = await db.select()
        .from(roles)
        .where(and(eq(roles.id, input.id), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      if (role.is_system_role) throw new TRPCError({ code: 'FORBIDDEN', message: 'System roles cannot be modified' });

      const setValues: Record<string, any> = { updated_at: new Date() };
      if (input.description !== undefined) setValues.description = input.description;
      if (input.role_group !== undefined) setValues.role_group = input.role_group;
      if (input.session_timeout_minutes !== undefined) setValues.session_timeout_minutes = input.session_timeout_minutes;
      if (input.is_active !== undefined) setValues.is_active = input.is_active;

      await db.update(roles).set(setValues).where(eq(roles.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'roles',
        row_id: input.id,
        old_values: { description: role.description, session_timeout_minutes: role.session_timeout_minutes, is_active: role.is_active },
        new_values: setValues,
        reason: 'Role updated',
      });

      return { success: true };
    }),

  /**
   * Clone an existing role (including permissions). Creates a custom copy.
   */
  clone: adminProcedure
    .input(z.object({
      source_role_id: z.string().uuid(),
      new_name: z.string().min(2).max(100),
      new_description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [source] = await db.select()
        .from(roles)
        .where(and(eq(roles.id, input.source_role_id), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source role not found' });

      const newName = input.new_name.toLowerCase().replace(/\s+/g, '_');

      // Check for duplicate
      const existing = await db.select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.name, newName), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A role with this name already exists' });
      }

      // Create the new role
      const [newRole] = await db.insert(roles).values({
        name: newName,
        description: input.new_description || `Copy of ${source.name}`,
        role_group: source.role_group,
        session_timeout_minutes: source.session_timeout_minutes,
        hospital_id: ctx.user.hospital_id,
        is_active: true,
        is_system_role: false,
      }).returning({ id: roles.id });

      // Copy all permissions from source
      const sourcePerms = await db.select({ permission_id: rolePermissions.permission_id })
        .from(rolePermissions)
        .where(eq(rolePermissions.role_id, source.id));

      if (sourcePerms.length > 0) {
        await db.insert(rolePermissions).values(
          sourcePerms.map(sp => ({
            role_id: newRole.id,
            permission_id: sp.permission_id,
          }))
        );
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'roles',
        row_id: newRole.id,
        new_values: { name: newName, cloned_from: source.name, permissions_copied: sourcePerms.length },
        reason: `Cloned from ${source.name}`,
      });

      return { id: newRole.id, name: newName, permissions_copied: sourcePerms.length, success: true };
    }),

  /**
   * Delete a custom role. System roles cannot be deleted.
   * Warns if users are assigned to this role.
   */
  delete: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      force: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const [role] = await db.select()
        .from(roles)
        .where(and(eq(roles.id, input.id), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      if (role.is_system_role) throw new TRPCError({ code: 'FORBIDDEN', message: 'System roles cannot be deleted' });

      // Check for users with this role
      const assignedUsers = await db.select({ id: users.id, full_name: users.full_name })
        .from(users)
        .where(and(
          eq(users.hospital_id, ctx.user.hospital_id),
          sql`${users.roles} @> ARRAY[${role.name}]::text[]`,
        ));

      if (assignedUsers.length > 0 && !input.force) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${assignedUsers.length} user(s) have this role assigned. Use force=true to delete anyway.`,
          cause: { affected_users: assignedUsers },
        });
      }

      // Delete role_permissions first (cascade should handle this, but be explicit)
      await db.delete(rolePermissions).where(eq(rolePermissions.role_id, input.id));
      await db.delete(roles).where(eq(roles.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'DELETE',
        table_name: 'roles',
        row_id: input.id,
        old_values: { name: role.name, role_group: role.role_group },
        reason: `Role deleted${input.force ? ' (forced, ' + assignedUsers.length + ' users affected)' : ''}`,
      });

      return { success: true, affected_users: assignedUsers.length };
    }),

  /**
   * Toggle role active/inactive.
   */
  toggleActive: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [role] = await db.select({ id: roles.id, is_active: roles.is_active, is_system_role: roles.is_system_role })
        .from(roles)
        .where(and(eq(roles.id, input.id), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      if (role.is_system_role) throw new TRPCError({ code: 'FORBIDDEN', message: 'System roles cannot be deactivated' });

      const newState = !role.is_active;
      await db.update(roles).set({ is_active: newState, updated_at: new Date() }).where(eq(roles.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'roles',
        row_id: input.id,
        old_values: { is_active: role.is_active },
        new_values: { is_active: newState },
        reason: newState ? 'Role activated' : 'Role deactivated',
      });

      return { success: true, is_active: newState };
    }),

  /**
   * Update permissions for a role (replace entire permission set).
   * Returns diff of what changed.
   */
  setPermissions: adminProcedure
    .input(z.object({
      role_id: z.string().uuid(),
      permission_ids: z.array(z.string().uuid()),
    }))
    .mutation(async ({ ctx, input }) => {
      const [role] = await db.select({ id: roles.id, name: roles.name, is_system_role: roles.is_system_role })
        .from(roles)
        .where(and(eq(roles.id, input.role_id), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      if (role.is_system_role) throw new TRPCError({ code: 'FORBIDDEN', message: 'System role permissions cannot be modified' });

      // Get current permissions
      const currentPerms = await db.select({ permission_id: rolePermissions.permission_id })
        .from(rolePermissions)
        .where(eq(rolePermissions.role_id, input.role_id));

      const currentSet = new Set(currentPerms.map(p => p.permission_id));
      const newSet = new Set(input.permission_ids);

      const added = input.permission_ids.filter(id => !currentSet.has(id));
      const removed = currentPerms.filter(p => !newSet.has(p.permission_id)).map(p => p.permission_id);

      // Delete removed permissions
      if (removed.length > 0) {
        await db.delete(rolePermissions).where(
          and(
            eq(rolePermissions.role_id, input.role_id),
            inArray(rolePermissions.permission_id, removed),
          )
        );
      }

      // Add new permissions
      if (added.length > 0) {
        await db.insert(rolePermissions).values(
          added.map(pid => ({
            role_id: input.role_id,
            permission_id: pid,
          }))
        );
      }

      // Count affected users
      const affectedUsers = await db.select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.hospital_id, ctx.user.hospital_id),
          sql`${users.roles} @> ARRAY[${role.name}]::text[]`,
        ));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'role_permissions',
        row_id: input.role_id,
        old_values: { permission_count: currentPerms.length },
        new_values: { permission_count: input.permission_ids.length, added: added.length, removed: removed.length },
        reason: `Permissions updated for role ${role.name}`,
      });

      return {
        success: true,
        added: added.length,
        removed: removed.length,
        total: input.permission_ids.length,
        affected_users: affectedUsers.length,
      };
    }),

  /**
   * Get all permissions (for the permission designer UI).
   * Grouped by resource.
   */
  allPermissions: adminProcedure.query(async () => {
    const perms = await db.select({
      id: permissions.id,
      resource: permissions.resource,
      action: permissions.action,
      description: permissions.description,
    }).from(permissions);

    // Group by resource
    const grouped: Record<string, { id: string; action: string; description: string | null }[]> = {};
    for (const p of perms) {
      if (!grouped[p.resource]) grouped[p.resource] = [];
      grouped[p.resource].push({ id: p.id, action: p.action, description: p.description });
    }

    return {
      permissions: perms,
      grouped,
      resources: Object.keys(grouped).sort(),
      total: perms.length,
    };
  }),

  /**
   * List available role templates.
   */
  templates: adminProcedure.query(async () => {
    return Object.entries(ROLE_TEMPLATES).map(([key, template]) => ({
      key,
      name: template.name,
      description: template.description,
      role_group: template.role_group,
      session_timeout_minutes: template.session_timeout_minutes,
      permissions: template.permissions,
      permission_count: template.permissions.length,
    }));
  }),

  /**
   * Create a role from a template.
   * Matches template permission strings against existing permissions in DB.
   */
  createFromTemplate: adminProcedure
    .input(z.object({
      template_key: z.string(),
      custom_name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const template = ROLE_TEMPLATES[input.template_key];
      if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });

      const roleName = (input.custom_name || template.name).toLowerCase().replace(/\s+/g, '_');

      // Check for duplicate
      const existing = await db.select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.name, roleName), eq(roles.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A role with this name already exists' });
      }

      // Create role
      const [newRole] = await db.insert(roles).values({
        name: roleName,
        description: template.description,
        role_group: template.role_group as any,
        session_timeout_minutes: template.session_timeout_minutes,
        hospital_id: ctx.user.hospital_id,
        is_active: true,
        is_system_role: false,
      }).returning({ id: roles.id });

      // Match template permissions to existing permission IDs
      let matchedCount = 0;
      for (const permString of template.permissions) {
        const [resource, action] = permString.split('.');
        const [perm] = await db.select({ id: permissions.id })
          .from(permissions)
          .where(and(eq(permissions.resource, resource), eq(permissions.action, action)))
          .limit(1);

        if (perm) {
          await db.insert(rolePermissions).values({
            role_id: newRole.id,
            permission_id: perm.id,
          }).onConflictDoNothing();
          matchedCount++;
        }
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'roles',
        row_id: newRole.id,
        new_values: {
          name: roleName,
          template: input.template_key,
          permissions_matched: matchedCount,
          permissions_requested: template.permissions.length,
        },
        reason: `Created from template: ${template.name}`,
      });

      return {
        id: newRole.id,
        name: roleName,
        success: true,
        permissions_matched: matchedCount,
        permissions_requested: template.permissions.length,
      };
    }),

  /**
   * Get stats for the roles dashboard.
   */
  stats: adminProcedure.query(async ({ ctx }) => {
    const roleCount = await db.select({ c: sql<number>`count(*)` })
      .from(roles)
      .where(eq(roles.hospital_id, ctx.user.hospital_id));

    const permCount = await db.select({ c: sql<number>`count(*)` })
      .from(permissions);

    const mappingCount = await db.select({ c: sql<number>`count(*)` })
      .from(rolePermissions);

    const activeRoles = await db.select({ c: sql<number>`count(*)` })
      .from(roles)
      .where(and(eq(roles.hospital_id, ctx.user.hospital_id), eq(roles.is_active, true)));

    return {
      total_roles: Number(roleCount[0]?.c ?? 0),
      active_roles: Number(activeRoles[0]?.c ?? 0),
      total_permissions: Number(permCount[0]?.c ?? 0),
      total_mappings: Number(mappingCount[0]?.c ?? 0),
    };
  }),
});
