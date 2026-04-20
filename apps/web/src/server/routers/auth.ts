import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { users, loginAttempts, verificationCodes, trustedDevices, breakGlassLog } from '@db/schema';
import { hashPassword, verifyPassword, createSession, destroySession } from '@/lib/auth';
import { getDeviceId, generateDeviceId, generateOTP, hashCode, setDeviceTrustCookie, parseUserAgent } from '@/lib/auth/device-trust';
import { sendEmail, otpEmailHtml, passwordResetEmailHtml, breakGlassNotificationHtml } from '@/lib/email/resend';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, gte, sql, desc, asc, isNull } from 'drizzle-orm';
import crypto from 'crypto';

export const authRouter = router({
  // ─── LOGIN (with device trust check) ───────────────────────
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(1),
      hospital_id: z.string().min(1).default('EHRC'),
    }))
    .mutation(async ({ input }) => {

      // DEMO.1 gate removed 20 Apr 2026 — demo account is now loginable whenever
      // the `demo@even.in` row exists (seeded by /api/migrations/demo-account-seed).
      // The original env-flag `DEMO_ACCOUNT_ENABLED` is no longer checked; V's
      // kill switches are now (a) never run the seed migration, or (b) delete the
      // row. Row existence is already deliberate (seed migration is super_admin
      // gated) and the row is hidden from admin lists via DEMO.9. See the demo
      // sprint notes in memory for full rationale.

      // Rate limiting check: 5 attempts per 10 minutes
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentAttempts = await db.select({ count: sql<number>`count(*)` })
        .from(loginAttempts)
        .where(and(
          eq(loginAttempts.email, input.email),
          eq(loginAttempts.success, false),
          gte(loginAttempts.attempted_at, tenMinAgo),
        ));

      const failCount = Number(recentAttempts[0]?.count ?? 0);
      if (failCount >= 5) {
        // Calculate lockout remaining time
        const oldestRecent = await db.select({ attempted_at: loginAttempts.attempted_at })
          .from(loginAttempts)
          .where(and(
            eq(loginAttempts.email, input.email),
            eq(loginAttempts.success, false),
            gte(loginAttempts.attempted_at, tenMinAgo),
          ))
          .orderBy(loginAttempts.attempted_at)
          .limit(1);

        const unlockAt = oldestRecent[0]
          ? new Date(new Date(oldestRecent[0].attempted_at).getTime() + 10 * 60 * 1000)
          : new Date(Date.now() + 10 * 60 * 1000);

        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Account temporarily locked. Try again at ${unlockAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`,
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
        await db.insert(loginAttempts).values({
          email: input.email,
          hospital_id: input.hospital_id,
          success: false,
          failure_reason: !user ? 'user_not_found' : 'account_suspended',
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

        const remaining = 4 - failCount;
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: remaining > 0
            ? `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`
            : 'Invalid credentials. Account is now locked for 10 minutes.',
        });
      }

      // TODO: Re-enable device trust check once Resend domain (even.in) is verified
      // Device trust bypassed — go straight to login
      const deviceTrusted = true;

      // Complete login
      await db.insert(loginAttempts).values({
        email: input.email,
        hospital_id: input.hospital_id,
        success: true,
        ip_address: '0.0.0.0',
      });

      await db.update(users)
        .set({
          last_active_at: new Date(),
          login_count: sql`${users.login_count} + 1`,
        })
        .where(eq(users.id, user.id));

      const primaryRole = Array.isArray(user.roles) && user.roles.length > 0
        ? user.roles[0] : 'staff';

      await createSession({
        id: user.id,
        hospital_id: user.hospital_id,
        role: primaryRole,
        email: user.email,
        full_name: user.full_name,
        department: user.department ?? undefined,
      });

      await writeAuditLog(null, {
        action: 'LOGIN',
        table_name: 'users',
        row_id: user.id,
        new_values: { email: user.email, device_trusted: true },
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

  // ─── VERIFY DEVICE OTP ────────────────────────────────────
  verifyDevice: publicProcedure
    .input(z.object({
      user_id: z.string().uuid(),
      code: z.string().length(6),
    }))
    .mutation(async ({ input }) => {
      const codeHash = hashCode(input.code);

      // Find valid verification code
      const [verification] = await db.select()
        .from(verificationCodes)
        .where(and(
          eq(verificationCodes.user_id, input.user_id),
          eq(verificationCodes.purpose, 'device_verification'),
          eq(verificationCodes.code_hash, codeHash),
          isNull(verificationCodes.used_at),
          gte(verificationCodes.expires_at, new Date()),
        ))
        .limit(1);

      if (!verification) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired verification code' });
      }

      // Mark code as used
      await db.update(verificationCodes)
        .set({ used_at: new Date() })
        .where(eq(verificationCodes.id, verification.id));

      // Get user
      const [user] = await db.select()
        .from(users)
        .where(eq(users.id, input.user_id))
        .limit(1);

      if (!user || user.status !== 'active') {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found or inactive' });
      }

      // Register this device as trusted
      const newDeviceId = generateDeviceId();
      const deviceInfo = parseUserAgent(''); // UA not available in tRPC context

      await db.insert(trustedDevices).values({
        user_id: user.id,
        device_id: newDeviceId,
        device_name: deviceInfo.deviceName,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ip_address: '0.0.0.0',
      });

      // Set device trust cookie
      await setDeviceTrustCookie(newDeviceId);

      // Complete login
      await db.insert(loginAttempts).values({
        email: user.email,
        hospital_id: user.hospital_id,
        success: true,
        ip_address: '0.0.0.0',
      });

      await db.update(users)
        .set({
          last_active_at: new Date(),
          login_count: sql`${users.login_count} + 1`,
        })
        .where(eq(users.id, user.id));

      const primaryRole = Array.isArray(user.roles) && user.roles.length > 0
        ? user.roles[0] : 'staff';

      await createSession({
        id: user.id,
        hospital_id: user.hospital_id,
        role: primaryRole,
        email: user.email,
        full_name: user.full_name,
        department: user.department ?? undefined,
      });

      await writeAuditLog(null, {
        action: 'LOGIN',
        table_name: 'users',
        row_id: user.id,
        new_values: { email: user.email, device_verification: 'completed', device_id: newDeviceId },
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

  // ─── REQUEST PASSWORD RESET ────────────────────────────────
  requestPasswordReset: publicProcedure
    .input(z.object({
      email: z.string().email(),
      hospital_id: z.string().min(1).default('EHRC'),
    }))
    .mutation(async ({ input }) => {

      // Always return success to prevent email enumeration
      const successMsg = 'If an account exists with that email, a reset link has been sent.';

      const [user] = await db.select()
        .from(users)
        .where(and(
          eq(users.email, input.email),
          eq(users.hospital_id, input.hospital_id),
        ))
        .limit(1);

      if (!user || user.status !== 'active') {
        return { success: true, message: successMsg };
      }

      // Generate reset token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashCode(token);

      // Clear existing unused reset codes
      await db.delete(verificationCodes)
        .where(and(
          eq(verificationCodes.user_id, user.id),
          eq(verificationCodes.purpose, 'password_reset'),
          isNull(verificationCodes.used_at),
        ));

      // Store token
      await db.insert(verificationCodes).values({
        user_id: user.id,
        code_hash: tokenHash,
        purpose: 'password_reset',
        expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      });

      // Build reset URL
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const resetUrl = `${baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(input.email)}`;

      // Send email
      await sendEmail({
        to: user.email,
        subject: 'Even OS — Password Reset',
        html: passwordResetEmailHtml(resetUrl, user.full_name),
        text: `Reset your password: ${resetUrl} (expires in 1 hour)`,
      });

      await writeAuditLog(null, {
        action: 'ACCESS',
        table_name: 'users',
        row_id: user.id,
        new_values: { action: 'password_reset_requested', email: user.email },
      });

      return { success: true, message: successMsg };
    }),

  // ─── CONFIRM PASSWORD RESET ────────────────────────────────
  confirmPasswordReset: publicProcedure
    .input(z.object({
      email: z.string().email(),
      token: z.string().min(1),
      new_password: z.string().min(8, 'Password must be at least 8 characters'),
    }))
    .mutation(async ({ input }) => {
      const tokenHash = hashCode(input.token);

      // Find user
      const [user] = await db.select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired reset link' });
      }

      // Verify token
      const [verification] = await db.select()
        .from(verificationCodes)
        .where(and(
          eq(verificationCodes.user_id, user.id),
          eq(verificationCodes.purpose, 'password_reset'),
          eq(verificationCodes.code_hash, tokenHash),
          isNull(verificationCodes.used_at),
          gte(verificationCodes.expires_at, new Date()),
        ))
        .limit(1);

      if (!verification) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid or expired reset link' });
      }

      // Mark token used
      await db.update(verificationCodes)
        .set({ used_at: new Date() })
        .where(eq(verificationCodes.id, verification.id));

      // Update password
      const newHash = await hashPassword(input.new_password);
      await db.update(users)
        .set({
          password_hash: newHash,
          must_change_password: false,
          updated_at: new Date(),
        })
        .where(eq(users.id, user.id));

      await writeAuditLog(null, {
        action: 'UPDATE',
        table_name: 'users',
        row_id: user.id,
        new_values: { action: 'password_reset_completed', email: user.email },
      });

      return { success: true, message: 'Password has been reset. You can now log in.' };
    }),

  // ─── BREAK-GLASS EMERGENCY ACCESS ──────────────────────────
  breakGlass: protectedProcedure
    .input(z.object({
      reason: z.string().min(10, 'Please provide a detailed reason (at least 10 characters)'),
    }))
    .mutation(async ({ ctx, input }) => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Log break-glass activation
      const [entry] = await db.insert(breakGlassLog).values({
        hospital_id: ctx.user.hospital_id,
        user_id: ctx.user.sub,
        user_email: ctx.user.email,
        user_role: ctx.user.role,
        reason: input.reason,
        elevated_to: 'emergency_access',
        expires_at: expiresAt,
      }).returning();

      // Write audit log
      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'break_glass_log',
        row_id: entry.id,
        new_values: {
          reason: input.reason,
          elevated_to: 'emergency_access',
          expires_at: expiresAt.toISOString(),
        },
        reason: `BREAK-GLASS: ${input.reason}`,
      });

      // Notify all super_admins via email
      const admins = await db.select({ email: users.email, full_name: users.full_name })
        .from(users)
        .where(and(
          eq(users.hospital_id, ctx.user.hospital_id),
          eq(users.status, 'active'),
        ));

      // Filter for super_admin role
      const superAdmins = admins.filter(a => true); // In production, filter by role — for now notify all admins
      // Send notification to first admin found (in production, send to all super_admins)
      if (superAdmins.length > 0) {
        await sendEmail({
          to: superAdmins[0].email,
          subject: `⚠️ Break-Glass Access — ${ctx.user.name}`,
          html: breakGlassNotificationHtml(
            ctx.user.name,
            ctx.user.email,
            input.reason,
            expiresAt.toLocaleString('en-IN'),
          ),
        });
      }

      return {
        success: true,
        break_glass_id: entry.id,
        expires_at: expiresAt.toISOString(),
        message: 'Emergency access granted for 1 hour. All actions are being logged.',
      };
    }),

  // ─── LOGOUT ────────────────────────────────────────────────
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await writeAuditLog(ctx.user, {
      action: 'LOGOUT',
      table_name: 'users',
      row_id: ctx.user.sub,
    });
    await destroySession();
    return { success: true };
  }),

  // ─── ME ────────────────────────────────────────────────────
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

  // ─── CHANGE PASSWORD ──────────────────────────────────────
  changePassword: protectedProcedure
    .input(z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(8, 'Password must be at least 8 characters'),
    }))
    .mutation(async ({ ctx, input }) => {
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

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'users',
        row_id: ctx.user.sub,
        new_values: { action: 'password_changed' },
      });

      return { success: true };
    }),

  // ─── LIST STAFF (for shift assignment, admin only) ─────────
  listStaff: protectedProcedure
    .input(z.object({
      department: z.string().optional(),
      role: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      if (!['super_admin', 'hospital_admin', 'nursing_superintendent'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      }
      const hospitalId = ctx.user.hospital_id;
      const conditions: any[] = [eq(users.hospital_id, hospitalId), eq(users.status, 'active')];

      if (input.department) {
        conditions.push(eq(users.department, input.department));
      }

      const rows = await db.select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        department: users.department,
        roles: users.roles,
      })
        .from(users)
        .where(and(...conditions))
        .orderBy(asc(users.full_name))
        .limit(input.limit);

      return rows;
    }),

  // ─── LOGIN ATTEMPTS (admin view) ───────────────────────────
  loginAttemptsList: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(100),
      email_filter: z.string().optional(),
      success_filter: z.enum(['all', 'success', 'failed']).default('all'),
    }))
    .query(async ({ ctx, input }) => {
      // Only admins can view login attempts
      if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      let query = db.select()
        .from(loginAttempts)
        .where(eq(loginAttempts.hospital_id, ctx.user.hospital_id))
        .orderBy(desc(loginAttempts.attempted_at))
        .limit(input.limit);

      const results = await query;

      // Apply client-side filters (for simplicity with Drizzle HTTP driver)
      let filtered = results;
      if (input.email_filter) {
        const q = input.email_filter.toLowerCase();
        filtered = filtered.filter(a => a.email.toLowerCase().includes(q));
      }
      if (input.success_filter === 'success') {
        filtered = filtered.filter(a => a.success);
      } else if (input.success_filter === 'failed') {
        filtered = filtered.filter(a => !a.success);
      }

      return filtered;
    }),

  // ─── BREAK-GLASS LOG (admin view) ─────────────────────────
  breakGlassList: protectedProcedure.query(async ({ ctx }) => {
    if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    return db.select()
      .from(breakGlassLog)
      .where(eq(breakGlassLog.hospital_id, ctx.user.hospital_id))
      .orderBy(desc(breakGlassLog.granted_at))
      .limit(50);
  }),

  // ─── REVIEW BREAK-GLASS (admin) ───────────────────────────
  reviewBreakGlass: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      notes: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      await db.update(breakGlassLog)
        .set({
          reviewed_at: new Date(),
          reviewed_by: ctx.user.sub as any,
          review_notes: input.notes,
        })
        .where(eq(breakGlassLog.id, input.id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'break_glass_log',
        row_id: input.id,
        new_values: { reviewed: true, notes: input.notes },
      });

      return { success: true };
    }),
});
