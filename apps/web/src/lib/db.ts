import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@db/schema';

/**
 * Drizzle ORM client for Even OS.
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

const client = neon(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });

// Re-export schema for convenience
export { schema };
