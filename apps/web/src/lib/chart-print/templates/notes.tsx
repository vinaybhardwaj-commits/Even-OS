/**
 * Patient Chart Overhaul — PC.4.D.2.3 — Notes PDF template.
 *
 * Scope: tab_notes / notes. Mirrors the clinical Notes tab — up to 30 most-
 * recent clinical_impressions (ordered by signed_at DESC, then created_at
 * DESC), grouped visually by note_type with author, timestamp, and status.
 * Renders SOAP fields, shift summary, procedure name, or free-text content
 * depending on what's populated on the row — reflecting the multi-shape
 * note_type enum (SOAP, nursing, operative, discharge, death, progress).
 *
 * Pulls data from ChartBundle (assembled by render.ts). Adds no queries.
 *
 * Redaction-aware: this template does not draw PII beyond patient header
 * (which is in the page chrome); the bundle itself is already tenant-scoped.
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type { ChartBundle, NoteRow } from '../render';

export type NotesProps = {
  bundle: ChartBundle;
  chrome: Omit<ChartPrintPageProps, 'children'>;
};

function formatTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) + ' IST';
  } catch {
    return ts;
  }
}

function labelForType(t: string): string {
  switch (t) {
    case 'soap': return 'SOAP Note';
    case 'nursing': return 'Nursing Note';
    case 'operative': return 'Operative Note';
    case 'discharge': return 'Discharge Summary';
    case 'death': return 'Death Summary';
    case 'progress': return 'Progress Note';
    case 'consultation': return 'Consultation';
    default: return t.replace(/_/g, ' ');
  }
}

function NoteBlock({ note }: { note: NoteRow }) {
  const signed = note.status === 'signed' || note.status === 'final';
  const effectiveTs = note.signed_at ?? note.created_at;

  return (
    <View wrap={true} style={{
      borderWidth: 0.5,
      borderColor: palette.lineSoft,
      borderRadius: 3,
      padding: 6,
      marginBottom: 6,
    }}>
      <View style={{ flexDirection: 'row', marginBottom: 3 }}>
        <Text style={{ flex: 1, fontSize: 10, color: palette.ink }}>
          {labelForType(note.note_type)}
        </Text>
        <Text style={{ fontSize: 8.5, color: signed ? palette.accent : palette.inkMuted }}>
          {signed ? 'Signed' : note.status}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        <Text style={{ flex: 1, fontSize: 8.5, color: palette.inkSoft }}>
          {note.author_name ?? 'Unknown author'}
          {signed && note.signed_by_name && note.signed_by_name !== note.author_name
            ? `  ·  signed by ${note.signed_by_name}` : ''}
        </Text>
        <Text style={{ fontSize: 8.5, color: palette.inkMuted }}>
          {formatTs(effectiveTs)}
        </Text>
      </View>

      {note.note_type === 'soap' && (
        <View>
          {note.subjective && (
            <View style={{ marginBottom: 3 }}>
              <Text style={{ fontSize: 9, color: palette.inkSoft }}>Subjective</Text>
              <Text style={styles.para}>{note.subjective}</Text>
            </View>
          )}
          {note.objective && (
            <View style={{ marginBottom: 3 }}>
              <Text style={{ fontSize: 9, color: palette.inkSoft }}>Objective</Text>
              <Text style={styles.para}>{note.objective}</Text>
            </View>
          )}
          {note.assessment && (
            <View style={{ marginBottom: 3 }}>
              <Text style={{ fontSize: 9, color: palette.inkSoft }}>Assessment</Text>
              <Text style={styles.para}>{note.assessment}</Text>
            </View>
          )}
          {note.plan && (
            <View>
              <Text style={{ fontSize: 9, color: palette.inkSoft }}>Plan</Text>
              <Text style={styles.para}>{note.plan}</Text>
            </View>
          )}
        </View>
      )}

      {note.note_type === 'nursing' && note.shift_summary && (
        <Text style={styles.para}>{note.shift_summary}</Text>
      )}

      {note.note_type === 'operative' && (
        <View>
          {note.procedure_name && (
            <Text style={{ ...styles.para, fontSize: 10 }}>
              Procedure: {note.procedure_name}
            </Text>
          )}
          {note.free_text_content && <Text style={styles.para}>{note.free_text_content}</Text>}
        </View>
      )}

      {(note.note_type === 'discharge' || note.note_type === 'death' ||
        note.note_type === 'progress' || note.note_type === 'consultation') &&
        note.free_text_content && (
        <Text style={styles.para}>{note.free_text_content}</Text>
      )}

      {/* Fallback: if nothing rendered above, show whatever free text exists */}
      {note.note_type !== 'soap' &&
       note.note_type !== 'nursing' &&
       note.note_type !== 'operative' &&
       note.note_type !== 'discharge' &&
       note.note_type !== 'death' &&
       note.note_type !== 'progress' &&
       note.note_type !== 'consultation' &&
       note.free_text_content && (
        <Text style={styles.para}>{note.free_text_content}</Text>
      )}

      {!note.subjective && !note.objective && !note.assessment && !note.plan &&
       !note.shift_summary && !note.procedure_name && !note.free_text_content && (
        <Text style={styles.emptyState}>(No content recorded.)</Text>
      )}
    </View>
  );
}

export function NotesTemplate({ bundle, chrome }: NotesProps) {
  const notes = bundle.notes;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard title={`Clinical notes (${notes.length})`} empty="No clinical notes recorded.">
        {notes.length > 0 ? (
          <View>
            {notes.map((n) => (
              <NoteBlock key={n.id} note={n} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.subtle}>
          Showing the most recent {notes.length} notes. Older notes are available in the live chart.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
