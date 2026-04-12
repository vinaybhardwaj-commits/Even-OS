import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { users, roles } from '@db/schema';
import { hashPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

export const usersRouter = router({
  /**
   * List all users for the current hospital.
   * Supports search, status filter, role filter, department filter, and pagination.
   */
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(['active', 'suspended', 'deleted', 'all']).default('all'),
      role: z.string().optional(),
      department: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, status, role, department, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      // Build WHERE conditions
      const conditions = [eq(users.hospital_id, ctx.user.hospital_id)];

      if (status && status !== 'all') {
        conditions.push(eq(users.status, status as any));
      }

      if (department) {
        conditions.push(eq(users.department, department));
      }

      if (search) {
        conditions.push(
          or(
            ilike(users.full_name, `%${search}%`),
            ilike(users.email, `%${search}%`),
          )!
        );
      }

      const where = and(...conditions);

      // Get total count
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(users)
        .where(where);
      const total = Number(countResult[0]?.count ?? 0);

      // Get users
      const rows = await db.select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        department: users.department,
        roles: users.roles,
        status: users.status,
        last_active_at: users.last_active_at,
        login_count: users.login_count,
        must_change_password: users.must_change_password,
        created_at: users.created_at,
      })
        .from(users)
        .where(where)
        .orderBy(desc(users.last_active_at))
        .limit(pageSize)
        .offset(offset);

      // If role filter, filter in-memory (roles is a text[] column)
      const filtered = role
        ? rows.filter(u => u.roles && u.roles.includes(role))
        : rows;

      return {
        users: filtered,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  /**
   * Get a single user by ID.
   */
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [user] = await db.select()
        .from(users)
        .where(and(
          eq(users.id, input.id),
          eq(users.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      return {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        department: user.department,
        roles: user.roles,
        status: user.status,
        last_active_at: user.last_active_at,
        login_count: user.login_count,
        must_change_password: user.must_change_password,
        biometric_enrolled: user.biometric_enrolled,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };
    }),

  /**
   * Create a new user.
   */
  create: adminProcedure
    .input(z.object({
      email: z.string().email(),
      full_name: z.string().min(2),
      department: z.string().min(1),
      roles: z.array(z.string()).min(1),
      password: z.string().min(8),
    }))
    .mutation(async ({ ctx, input }) => {

      // Check for duplicate email in this hospital
      const existing = await db.select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.email, input.email),
          eq(users.hospital_id, ctx.user.hospital_id),
        ))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email already exists' });
      }

      const passwordHash = await hashPassword(input.password);

      const [newUser] = await db.insert(users).values({
        email: input.email,
        full_name: input.full_name,
        department: input.department,
        roles: input.roles,
        hospital_id: ctx.user.hospital_id,
        password_hash: passwordHash,
        must_change_password: true,
        status: 'active',
      }).returning({ id: users.id });

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'users',
        row_id: newUser.id,
        new_values: { email: input.email, full_name: input.full_name, department: input.department, roles: input.roles },
        reason: 'User created by admin',
      });

      return { id: newUser.id, success: true };
    }),

  /**
   * Update user details (name, department, roles).
   */
  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      full_name: z.string().min(2).optional(),
      department: z.string().min(1).optional(),
      roles: z.array(z.string()).min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Verify user belongs to this hospital
      const [user] = await db.select({ id: users.id, hospital_id: users.hospital_id })
        .from(users)
        .where(and(eq(users.id, id), eq(users.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      const setValues: Record<string, any> = { updated_at: new Date() };
      if (updates.full_name) setValues.full_name = updates.full_name;
      if (updates.department) setValues.department = updates.department;
      if (updates.roles) setValues.roles = updates.roles;

      await db.update(users).set(setValues).where(eq(users.id, id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'users',
        row_id: id,
        new_values: updates,
        reason: 'User updated by admin',
      });

      return { success: true };
    }),

  /**
   * Suspend a user — revokes access immediately.
   */
  suspend: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {

      const [user] = await db.select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      if (input.id === ctx.user.sub) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot suspend yourself' });
      }

      await db.update(users)
        .set({ status: 'suspended', updated_at: new Date() })
        .where(eq(users.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'users',
        row_id: input.id,
        old_values: { status: user.status },
        new_values: { status: 'suspended' },
        reason: input.reason || 'Suspended by admin',
      });

      return { success: true };
    }),

  /**
   * Activate a suspended user.
   */
  activate: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      const [user] = await db.select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      await db.update(users)
        .set({ status: 'active', updated_at: new Date() })
        .where(eq(users.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'users',
        row_id: input.id,
        old_values: { status: user.status },
        new_values: { status: 'active' },
        reason: 'Activated by admin',
      });

      return { success: true };
    }),

  /**
   * Reset a user's password (admin action — generates temp password).
   */
  resetPassword: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      new_password: z.string().min(8),
    }))
    .mutation(async ({ ctx, input }) => {

      const [user] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.hospital_id, ctx.user.hospital_id)))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      const hash = await hashPassword(input.new_password);
      await db.update(users)
        .set({ password_hash: hash, must_change_password: true, updated_at: new Date() })
        .where(eq(users.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'users',
        row_id: input.id,
        new_values: { must_change_password: true },
        reason: 'Password reset by admin',
      });

      return { success: true };
    }),

  /**
   * Get list of departments (distinct from users table).
   */
  departments: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.selectDistinct({ department: users.department })
      .from(users)
      .where(eq(users.hospital_id, ctx.user.hospital_id));
    return result.map(r => r.department).filter(Boolean).sort();
  }),

  /**
   * Get list of available roles for this hospital.
   */
  availableRoles: adminProcedure.query(async ({ ctx }) => {
    const result = await db.select({
      name: roles.name,
      description: roles.description,
      role_group: roles.role_group,
    })
      .from(roles)
      .where(and(
        eq(roles.hospital_id, ctx.user.hospital_id),
        eq(roles.is_active, true),
      ));
    return result;
  }),
});
