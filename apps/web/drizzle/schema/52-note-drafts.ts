/**
 * Notes v2 — Sprint N.3 — Draft autosave surface
 *
 * Server-side backing store for the Notes v2 editor's autosave. Paired with a
 * localStorage fallback in the client so editors remain useful when the
 * network hiccups. Pattern chosen: one row per (patient, encounter, note_type,
 * author) — drafts are per-author-per-note-type so the same doctor can have
 * an in-flight progress note and admission note on the same patient without
 * collision, but two authors each get their own slot.
 *
 * `body` is a free-form jsonb blob — the editor stores labeled sections keyed
 * by the section name ({ subjective, objective, assessment, plan, ... }) or
 * whatever the selected note type needs. `template_id` is tracked so the
 * editor can re-hydrate the original template instruction when a user reopens
 * a partial draft.
 */

import {
  pgTable, text, timestamp, jsonb, uuid, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';
import { noteTypeEnum } from './06-notes';

export const clinicalNoteDrafts = pgTable(
  'clinical_note_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    noteType: noteTypeEnum('note_type').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id'),
    body: jsonb('body').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqSlot: uniqueIndex('uniq_note_draft_slot').on(
      t.patientId,
      t.encounterId,
      t.noteType,
      t.authorId,
    ),
    authorIdx: index('idx_note_drafts_author').on(t.authorId),
    encIdx: index('idx_note_drafts_encounter').on(t.encounterId),
  }),
);
