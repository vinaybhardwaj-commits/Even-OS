import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { getCurrentUser, type JWTPayload } from '@/lib/auth';
import { getPreviewRole } from '@/lib/chart/preview-role';

export interface Context {
  /** Real authenticated user — use this for mutations and audit attribution. */
  user: JWTPayload | null;
  /**
   * Effective user for read-path projection. Equals `user` unless the real
   * user is super_admin AND has set the preview-role cookie, in which case
   * it carries the impersonated role/role_tag/hospital_id while preserving
   * the real user's sub/email/name. PC.3.4 Track B.
   */
  effectiveUser: JWTPayload | null;
}

export async function createContext(): Promise<Context> {
  const user = await getCurrentUser();
  let effectiveUser = user;
  if (user && user.role === 'super_admin') {
    const preview = await getPreviewRole();
    if (preview) {
      effectiveUser = {
        ...user,
        role: preview.role,
        role_tag: preview.role_tag ?? (user as any).role_tag ?? null,
        hospital_id: preview.hospital_id ?? user.hospital_id,
      } as JWTPayload;
    }
  }
  return { user, effectiveUser };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Authenticated procedure — requires valid session
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Admin procedure — requires super_admin or hospital_admin role
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const adminRoles = ['super_admin', 'hospital_admin'];
  if (!adminRoles.includes(ctx.user.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

// Department-scoped procedure — auto-filters by department for non-admin roles
export const departmentProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const globalRoles = ['super_admin', 'hospital_admin', 'medical_director'];
  const department = globalRoles.includes(ctx.user.role) ? undefined : ctx.user.department;
  return next({ ctx: { ...ctx, departmentFilter: department } });
});
