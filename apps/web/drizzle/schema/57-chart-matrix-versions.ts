/**
 * PC.3.4 Track E — chart_permission_matrix_versions
 *
 * Append-only snapshot log for every committed edit of
 * `chart_permission_matrix`. One row per chartMatrix.update, containing:
 *
 *   - the post-update snapshot (full jsonb),
 *   - the list of changed keys (vs previous version),
 *   - who committed it and why (optional change_note).
 *
 * Gives super_admin a walkable timeline of role preset evolution on the
 * /admin/chart/roles page and unblocks "roll this role back to Monday's
 * config" without needing DB-level PITR.
 *
 * Design notes
 *  - `version_number` is per-matrix-row, monotonically increasing. v1 is
 *    the first post-update snapshot; the pre-migration seed state is
 *    implicit (no v0).
 *  - `changed_keys` is computed server-side in chartMatrix.update by
 *    diffing the pre-update row against the Zod-validated partial.
 *  - `snapshot` is a jsonb copy of the row state post-update (tabs,
 *    overview_layout, action_bar_preset, sensitive_fields,
 *    allowed_write_actions, description, updated_at).
 */

import {
  pgTable, text, timestamp, uuid, jsonb, integer, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { chartPermissionMatrix } from './55-chart-role';

export const chartPermissionMatrixVersions = pgTable('chart_permission_matrix_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  matrix_id: uuid('matrix_id').notNull().references(() => chartPermissionMatrix.id, { onDelete: 'cascade' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  version_number: integer('version_number').notNull(),

  // Full post-update row snapshot (fields the editor can write).
  snapshot: jsonb('snapshot').notNull().default({} as any),

  // e.g. ['tabs', 'sensitive_fields'] — keys that differ from the
  // previous snapshot for this matrix_id.
  changed_keys: text('changed_keys').array().notNull().default([] as any),

  // Optional free-text audit note submitted by the editor.
  change_note: text('change_note'),

  changed_by: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
  changed_by_name: text('changed_by_name'),
  changed_by_role: text('changed_by_role'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  matrixIdx: index('idx_matrix_versions_matrix').on(t.matrix_id, t.version_number),
  hospitalIdx: index('idx_matrix_versions_hospital').on(t.hospital_id, t.created_at),
  uniqVersion: uniqueIndex('uniq_matrix_version').on(t.matrix_id, t.version_number),
}));
