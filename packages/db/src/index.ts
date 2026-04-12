import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

export function getDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql);
}

export type Database = ReturnType<typeof getDb>;
