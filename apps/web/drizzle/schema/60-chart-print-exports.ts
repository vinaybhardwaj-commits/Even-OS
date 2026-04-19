/**
 * Patient Chart Overhaul — PC.4.D.2 — Chart print exports (audit + file log)
 *
 * V's PRD v2.0 locked decision #4 (18 Apr 2026): role-scoped quick-print per tab
 * + admin full-MRD bundle, watermarked `{user.name} · {role} · {timestamp} · UHID {uhid}`,
 * stored in chart_print_exports.
 *
 * V's PC.4.D.2 locks (19 Apr 2026) relevant to this table:
 *   - Lock #3 Storage: Vercel Blob, 1h signed URL TTL, 90-day file retention
 *     then auto-purge. chart_print_exports rows retained forever for audit.
 *   - Lock #4 Watermark: full rendered string stored on the row (denorm, audit).
 *   - Lock #5 Audit: every print = row; every file re-fetch via chartPrint.getById
 *     writes a chart_view_audit row (not duplicated here).
 *   - Lock #7 Concurrency: allowed; each click = new row. No dedup.
 *   - Lock #9 Error path: status='failed' + error text; no auto-retry.
 *
 * Why denorm user_name / user_role / uhid_at_time:
 *   Prints are legal records. User profile edits and UHID changes (rare, but
 *   possible on merge-dedup) must not retroactively mutate the audit trail.
 *   Denorm captures the values AT THE TIME the print was generated.
 *
 * Why `scope` as text (not pg enum):
 *   D.2 ships 5 tabs; D.3 will add ~8 more + full_mrd bundle; PC.5 may add
 *   patient-portal print scopes. A pg enum would require migrations every time.
 *   zod enum validation in the router catches typos at the API boundary;
 *   the DB just records what was printed. Matches the precedent of
 *   chart_notification_events.source_kind (text, validated at router edge).
 *
 * Index plan:
 *   - (patient_id, created_at DESC)  — per-chart print history / future Audit tab
 *   - (user_id, created_at DESC)      — per-user audit queries
 *   - (hospital_id, created_at DESC)  — admin /admin/chart/prints surface (D.3)
 */

import {
  pgTable, pgEnum, text, timestamp, uuid, integer, index,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients } from './03-registration';

// ── Enum: status ──────────────────────────────────────────────────────
// Three-state lifecycle. Row is created in 'generating' before the PDF
// renderer starts, flipped to 'ready' on successful upload to Blob, or
// 'failed' if render/upload throws.
export const chartPrintStatusEnum = pgEnum(
  'cpe_status',
  ['generating', 'ready', 'failed'],
);

// ── chart_print_exports ───────────────────────────────────────────────
export const chartPrintExports = pgTable(
  'chart_print_exports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

    // Who printed (FK kept for joins) + denorm snapshot for audit immutability.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull(),

    // What was printed.
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    uhidAtTime: text('uhid_at_time').notNull(),

    /**
     * Scope of the export. Validated by zod on the router:
     *   tab_overview | tab_brief | tab_notes | tab_meds | tab_labs
     *   (D.3 adds: tab_orders | tab_cosign | tab_calculators | tab_documents
     *    | tab_complaints | tab_forms | tab_bill | full_mrd)
     */
    scope: text('scope').notNull(),
    /** Human-friendly label for the admin surface. e.g. "Overview". */
    tabName: text('tab_name').notNull(),

    /**
     * Full watermark string as rendered into the PDF footer. Stored for
     * audit so the exact displayed text is recoverable even if the
     * watermark template changes later. Format (D.2 lock #4):
     *   "{user.name} · {role} · {ISO timestamp IST} · UHID {uhid}"
     */
    watermark: text('watermark').notNull(),

    /** Vercel Blob URL; accessed via 1h signed proxy in chartPrint.getById. */
    fileUrl: text('file_url'),
    fileSizeBytes: integer('file_size_bytes'),
    pageCount: integer('page_count'),

    status: chartPrintStatusEnum('status').notNull().default('generating'),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
  },
  (t) => ({
    byPatient: index('idx_chart_print_patient_created').on(t.patientId, t.createdAt),
    byUser: index('idx_chart_print_user_created').on(t.userId, t.createdAt),
    byHospital: index('idx_chart_print_hospital_created').on(t.hospitalId, t.createdAt),
  }),
);
