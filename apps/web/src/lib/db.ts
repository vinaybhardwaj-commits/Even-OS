import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '@db/schema';

/**
 * Drizzle ORM client for Even OS.
 *
 * Uses lazy initialization so the neon client is only created when
 * first accessed at runtime — NOT at module-import time. This prevents
 * build failures when DATABASE_URL is unavailable during `next build`.
 *
 * Usage in tRPC routers:
 *
 *   import { db } from '@/lib/db';
 *   import { users, encounters } from '@db/schema';
 *   import { eq, and, sql, isNull, gte, lte, desc, count } from 'drizzle-orm';
 *
 *   // Select with filters
 *   const rows = await db.select().from(users)
 *     .where(and(eq(users.hospitalId, hospitalId), eq(users.role, 'doctor')))
 *     .limit(50);
 *
 *   // Insert
 *   const [row] = await db.insert(encounters).values({ ... }).returning();
 *
 *   // Update
 *   await db.update(encounters)
 *     .set({ status: 'discharged' })
 *     .where(eq(encounters.id, encounterId))
 *     .returning();
 *
 *   // Delete
 *   await db.delete(encounters).where(eq(encounters.id, id));
 *
 *   // Raw SQL (when you need it)
 *   const result = await db.execute(sql`SELECT NOW()`);
 *
 * The schema import gives you full type safety — column names autocomplete,
 * return types are inferred, and where clauses are type-checked.
 */

let _client: NeonQueryFunction<false, false> | null = null;
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. This should only happen during build — ' +
        'if you see this at runtime, check your environment variables.'
      );
    }
    _client = neon(process.env.DATABASE_URL);
    _db = drizzle(_client, { schema });
  }
  return _db;
}

/**
 * Lazy-initialized Drizzle client. Safe to import at module scope —
 * the actual neon connection is only created on first property access.
 */
export const db: NeonHttpDatabase<typeof schema> = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const val = Reflect.get(real, prop, receiver);
    return typeof val === 'function' ? val.bind(real) : val;
  },
});

// Re-export schema for convenience
export { schema };

/**
 * Lazy neon SQL tagged-template function for raw SQL queries.
 * Use this instead of `const sql = neon(process.env.DATABASE_URL!)` at module scope.
 *
 * Usage:
 *   import { getSql } from '@/lib/db';
 *   // inside a handler:
 *   const sql = getSql();
 *   const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
 */
let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
