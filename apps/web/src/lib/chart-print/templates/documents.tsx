/**
 * Patient Chart Overhaul — PC.4.D.3.1 — Documents MANIFEST PDF template.
 *
 * Scope: tab_documents / documents. V's D.3 lock: MANIFEST ONLY — no
 * source-PDF merging, no OCR text dump. This keeps print size bounded
 * and avoids a pdf-lib dep; and it's what a discharge packet actually
 * needs (proof that documents exist + traceable blob_url + hash).
 *
 * Shows every non-deleted mrd_document_references row for this patient,
 * grouped by document_type. Columns: title/type · uploaded · classifier
 * confidence · file-size · hash prefix.
 *
 * The underlying files themselves are NOT embedded. A reader with chart
 * access can pull them from blob_url via the normal Documents tab.
 *
 * Pulls data from ChartBundle (assembled by render.ts). Adds no queries.
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type { ChartBundle, DocumentManifestRow } from '../render';

export type DocumentsProps = {
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

function fmtBytes(raw: string | null | undefined): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function confidenceColor(c: string | null | undefined): string {
  switch ((c ?? '').toLowerCase()) {
    case 'high': return palette.accent;
    case 'medium': return palette.warn;
    case 'low': return palette.danger;
    default: return palette.inkMuted;
  }
}

function DocRowView({ d }: { d: DocumentManifestRow }) {
  const hashShort = d.blob_hash ? d.blob_hash.slice(0, 8) : '—';
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ flex: 1.4 }}>
        {d.document_type}
        {d.contains_phi ? ' · PHI' : ''}
      </Text>
      <Text style={{ width: 105 }}>{formatTs(d.scanned_at ?? d.created_at).replace(' IST', '')}</Text>
      <Text style={{ width: 80 }}>{d.uploaded_by ?? '—'}</Text>
      <Text style={{ width: 70, color: confidenceColor(d.document_class_confidence) }}>
        {d.document_class_confidence ?? '—'}
      </Text>
      <Text style={{ width: 60 }}>{fmtBytes(d.file_size_bytes)}</Text>
      <Text style={{ width: 70, color: palette.inkMuted }}>{hashShort}</Text>
    </View>
  );
}

function TypeGroup({ typeLabel, rows }: { typeLabel: string; rows: DocumentManifestRow[] }) {
  return (
    <View wrap={false} style={{ marginBottom: 8 }}>
      <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 3 }}>
        {typeLabel} ({rows.length})
      </Text>
      <View style={styles.tableHead}>
        <Text style={{ flex: 1.4 }}>Document type</Text>
        <Text style={{ width: 105 }}>Scanned / uploaded</Text>
        <Text style={{ width: 80 }}>By</Text>
        <Text style={{ width: 70 }}>Class conf.</Text>
        <Text style={{ width: 60 }}>Size</Text>
        <Text style={{ width: 70 }}>Hash (8)</Text>
      </View>
      {rows.map((d) => (
        <DocRowView key={d.id} d={d} />
      ))}
    </View>
  );
}

export function DocumentsTemplate({ bundle, chrome }: DocumentsProps) {
  const { documents } = bundle;

  // Group by document_type, keeping groups in count-desc order.
  const byType: Record<string, DocumentManifestRow[]> = {};
  for (const d of documents) {
    const t = d.document_type || 'other';
    (byType[t] ||= []).push(d);
  }
  const groupKeys = Object.keys(byType).sort((a, b) => byType[b].length - byType[a].length);

  const phiCount = documents.filter((d) => d.contains_phi).length;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Document manifest (${documents.length})`}
        empty="No documents on file for this patient."
        wrap={true}
      >
        {documents.length > 0 ? (
          <View>
            <Text style={{ ...styles.subtle, marginBottom: 6 }}>
              Manifest only — source files are NOT embedded in this PDF. Each entry
              is retrievable from its blob_url (audit-logged access) via the
              Documents tab. Integrity: SHA-256 hash truncated to first 8 chars.
              {phiCount > 0 ? ` ${phiCount} record${phiCount === 1 ? '' : 's'} flagged PHI.` : ''}
            </Text>
            {groupKeys.map((k) => (
              <TypeGroup key={k} typeLabel={k} rows={byType[k]} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 8 }}>
        <Text style={styles.subtle}>
          Includes all mrd_document_references rows with status != 'deleted'.
          Classification confidence is from the document-intake LLM — low-confidence
          items are flagged for manual review in the classification queue.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
