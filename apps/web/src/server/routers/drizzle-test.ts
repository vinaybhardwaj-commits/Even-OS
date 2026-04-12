/**
 * Drizzle ORM integration test router.
 * Proves the db client works with type-safe queries.
 * Can be removed after verification.
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { users, safetyRounds } from '@db/schema';
import { eq, and, desc, count, sql } from 'drizzle-orm';

export const drizzleTestRouter = router({
  // 1. Type-safe select with where clause
  listUsers: protectedProcedure
    .input(z.object({ limit: z.number().int().max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          full_name: users.full_name,
          department: users.department,
          status: users.status,
        })
        .from(users)
        .where(eq(users.hospital_id, ctx.user.hospital_id))
        .orderBy(desc(users.last_active_at))
        .limit(input.limit);

      return { users: rows, count: rows.length };
    }),

  // 2. Aggregate query
  countByDepartment: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db
        .select({
          department: users.department,
          total: count(users.id),
        })
        .from(users)
        .where(eq(users.hospital_id, ctx.user.hospital_id))
        .groupBy(users.department)
        .orderBy(desc(count(users.id)));

      return rows;
    }),

  // 3. Raw SQL via Drizzle (for complex queries)
  tableStats: protectedProcedure
    .query(async () => {
      const result = await db.execute(
        sql`SELECT COUNT(*) as total FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      );
      const rows = result.rows as Array<{ total: string }>;
      return { tables: rows[0]?.total ?? 'unknown' };
    }),
});
