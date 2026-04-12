import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { users, trustedDevices, loginAttempts } from '@db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { writeAuditLog } from '@/lib/audit/logger';

export const profileRouter = router({
  // ─── GET PROFILE ───────────────────────────────────────────
  get: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      department: users.department,
      roles: users.roles,
      status: users.status,
      login_count: users.login_count,
      first_login_at: users.first_login_at,
      last_active_at: users.last_active_at,
      created_at: users.created_at,
    })
      .from(users)
      .where(eq(users.id, ctx.user.sub))
      .limit(1);

    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
    return user;
  }),

  // ─── LIST TRUSTED DEVICES ─────────────────────────────────
  devices: protectedProcedure.query(async ({ ctx }) => {
    return db.select()
      .from(trustedDevices)
      .where(and(
        eq(trustedDevices.user_id, ctx.user.sub),
        eq(trustedDevices.is_active, true),
      ))
      .orderBy(desc(trustedDevices.last_seen_at));
  }),

  // ─── REMOVE TRUSTED DEVICE ────────────────────────────────
  removeDevice: protectedProcedure
    .input(z.object({ device_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {

      const [device] = await db.select()
        .from(trustedDevices)
        .where(and(
          eq(trustedDevices.id, input.device_id),
          eq(trustedDevices.user_id, ctx.user.sub),
        ))
        .limit(1);

      if (!device) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Device not found' });
      }

      await db.update(trustedDevices)
        .set({ is_active: false })
        .where(eq(trustedDevices.id, input.device_id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'trusted_devices',
        row_id: input.device_id,
        new_values: { is_active: false, device_name: device.device_name },
        reason: 'User removed trusted device',
      });

      return { success: true };
    }),

  // ─── RECENT LOGIN ACTIVITY ────────────────────────────────
  recentLogins: protectedProcedure.query(async ({ ctx }) => {
    return db.select()
      .from(loginAttempts)
      .where(eq(loginAttempts.email, ctx.user.email))
      .orderBy(desc(loginAttempts.attempted_at))
      .limit(20);
  }),
});
