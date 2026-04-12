import { z } from 'zod';
import { router, adminProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { gstRates } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { recordVersion } from '@/lib/master-data/version-history';
import { eq, and, sql, desc, lte } from 'drizzle-orm';

export const gstRatesRouter = router({

  // ─── LIST (all rates, grouped by category) ────────────────
  list: adminProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(gstRates)
      .where(eq(gstRates.hospital_id, ctx.user.hospital_id))
      .orderBy(gstRates.category, desc(gstRates.effective_date));
    return rows;
  }),

  // ─── CURRENT RATES (effective now, one per category) ──────
  currentRates: adminProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const now = new Date();
    // Get the most recent effective rate per category
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (category) *
      FROM gst_rates
      WHERE hospital_id = ${ctx.user.hospital_id}
        AND effective_date <= ${now}
      ORDER BY category, effective_date DESC
    `);
    return rows.rows;
  }),

  // ─── CREATE / SCHEDULE NEW RATE ───────────────────────────
  create: adminProcedure
    .input(z.object({
      category: z.string().min(1),
      percentage: z.string().regex(/^\d+(\.\d{1,2})?$/),
      effective_date: z.string(), // ISO date string
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db.insert(gstRates).values({
        hospital_id: ctx.user.hospital_id,
        category: input.category,
        percentage: input.percentage,
        effective_date: new Date(input.effective_date),
        description: input.description,
        created_by: ctx.user.sub as any,
      }).returning();

      await recordVersion(ctx.user, 'gst_rate', row.id, row as any);
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'gst_rates', row_id: row.id,
        new_values: row as any,
        reason: `GST rate ${input.percentage}% for ${input.category}, effective ${input.effective_date}`,
      });
      return row;
    }),

  // ─── HISTORY (per category) ───────────────────────────────
  history: adminProcedure
    .input(z.object({ category: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      return db.select().from(gstRates)
        .where(and(
          eq(gstRates.hospital_id, ctx.user.hospital_id),
          eq(gstRates.category, input.category),
        ))
        .orderBy(desc(gstRates.effective_date));
    }),

  // ─── CATEGORIES (distinct list) ───────────────────────────
  categories: adminProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.selectDistinct({ category: gstRates.category })
      .from(gstRates)
      .where(eq(gstRates.hospital_id, ctx.user.hospital_id))
      .orderBy(gstRates.category);
    return rows.map(r => r.category);
  }),
});
