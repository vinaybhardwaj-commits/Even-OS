import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { users, loginAttempts } from '@db/schema';
import { hashPassword, verifyPassword, createSession, destroySession } from '@/lib/auth';
import { eq, and, gte, sql } from 'drizzle-orm';

export const authRouter = router({
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(1),
      hospital_id: z.string().min(1).default('EHRC'),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // Rate limiting check: 5 attempts per 10 minutes
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentAttempts = await db.select({ count: sql<number>`count(*)` })
        .from(loginAttempts)
        .where(and(
          eq(loginAttempts.email, input.email),
          eq(loginAttempts.success, false),
          gte(loginAttempts.attempted_at, tenMinAgo),
        ));

      if (recentAttempts[0]?.count >= 5) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Account temporarily locked. Try again in 10 minutes.',
        });
      }

      // Find user by email and hospital_id
      const [user] = await db.select()
        .from(users)
        .where(and(
          eq(users.email, input.email),
          eq(users.hospital_id, input.hospital_id),
        ))
        .limit(1);

      if (!user || user.status !== 'active') {
        // Log failed attempt
        await db.insert(loginAttempts).values({
          email: input.email,
          hospital_id: input.hospital_id,
          success: false,
          failure_reason: !user ? 'user_not_found' : 'account_disabled',
          ip_address: '0.0.0.0',
        });
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
      }

      // Verify password
      const passwordHash = user.password_hash;
      if (!passwordHash) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Password auth not configured' });
      }

      const valid = await verifyPassword(input.password, passwordHash);
      if (!valid) {
        await db.insert(loginAttempts).values({
          email: input.email,
          hospital_id: input.hospital_id,
          success: false,
          failure_reason: 'wrong_password',
          ip_address: '0.0.0.0',
        });
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
      }

      // Success: record attempt and create session
      await db.insert(loginAttempts).values({
        email: input.email,
        hospital_id: input.hospital_id,
        success: true,
        ip_address: '0.0.0.0',
      });

      // Update last_active_at and increment login_count
      await db.update(users)
        .set({
          last_active_at: new Date(),
          login_count: sql`${users.login_count} + 1`,
        })
        .where(eq(users.id, user.id));

      // Determine primary role (first in array)
      const primaryRole = Array.isArray(user.roles) && user.roles.length > 0
        ? user.roles[0]
        : 'staff';

      // Create session cookie
      await createSession({
        id: user.id,
        hospital_id: user.hospital_id,
        role: primaryRole,
        email: user.email,
        full_name: user.full_name,
        department: user.department ?? undefined,
      });

      return {
        success: true,
        must_change_password: user.must_change_password,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: primaryRole,
          department: user.department,
        },
      };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await destroySession();
    return { success: true };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.sub,
      email: ctx.user.email,
      name: ctx.user.name,
      role: ctx.user.role,
      hospital_id: ctx.user.hospital_id,
      department: ctx.user.department,
    };
  }),

  changePassword: protectedProcedure
    .input(z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(8, 'Password must be at least 8 characters'),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, ctx.user.sub))
        .limit(1);

      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

      const passwordHash = user.password_hash;
      if (!passwordHash) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password auth not configured' });
      }

      const valid = await verifyPassword(input.current_password, passwordHash);
      if (!valid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Current password is incorrect' });
      }

      const newHash = await hashPassword(input.new_password);
      await db.update(users)
        .set({ password_hash: newHash, must_change_password: false, updated_at: new Date() })
        .where(eq(users.id, ctx.user.sub));

      return { success: true };
    }),
});
