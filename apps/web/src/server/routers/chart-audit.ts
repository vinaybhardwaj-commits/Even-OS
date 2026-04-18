/**
 * Chart Audit Router — PC.3.2.3.
 *
 * Surfaces a single mutation for the client-side SensitiveText component to
 * log sensitive-field views into `chart_view_audit`. Underlying insert is
 * done by `logChartFieldView` which swallows errors — the UI will never
 * throw from an audit-write failure.
 *
 * Endpoints:
 *   - logFieldView(patient_id, field_name, tab_id?, access_reason?)
 *       → { ok: true }
 *
 * Deduping happens on the client (`useLogFieldView`). The router is just a
 * thin writer; if the client sends duplicate events we'll have duplicate
 * rows, which is acceptable (audit-heavy is better than audit-light).
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { logChartFieldView } from '@/lib/chart/audit';

export const chartAuditRouter = router({
  logFieldView: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      field_name: z.string().min(1).max(80),
      tab_id: z.string().max(40).optional(),
      access_reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await logChartFieldView({
        patient_id: input.patient_id,
        hospital_id: ctx.user.hospital_id ?? 'unknown',
        user_id: ctx.user.sub ?? null,
        user_role: ctx.user.role ?? 'unknown',
        field_name: input.field_name,
        tab_id: input.tab_id ?? null,
        access_reason: input.access_reason ?? null,
      });
      return { ok: true as const };
    }),
});
