/**
 * Patient Chart Overhaul — PC.4.D.2.2 — Shared PDF components + styles.
 *
 * Used by every chart-print template. Defines:
 *   - The Even-OS PDF page frame (A4 portrait, 48/36 margins)
 *   - Diagonal watermark repeated per page (10% black, 45° centered)
 *   - Header (logo-placeholder + patient identifiers + export timestamp)
 *   - Footer (page x/N + print-id short-8 + confidential banner)
 *   - SectionCard, KV (key-value pair), DataTable, Muted primitives
 *
 * All templates MUST wrap their content with <ChartPrintPage>. That guarantees
 * consistent frame + watermark + header/footer, and consistent audit-safe
 * rendering (the watermark string stored on the audit row matches the one
 * drawn here because it's passed in, not re-derived).
 *
 * Keep this file strictly presentational — no DB reads, no LLM calls.
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import {
  Document, Page, Text, View, StyleSheet, Font,
} from '@react-pdf/renderer';

// ────────────────────────────────────────────────────────────────────────
// Tokens
// ────────────────────────────────────────────────────────────────────────
export const palette = {
  ink: '#0F172A',
  inkSoft: '#334155',
  inkMuted: '#64748B',
  line: '#CBD5E1',
  lineSoft: '#E2E8F0',
  tint: '#F1F5F9',
  warn: '#B45309',
  danger: '#B91C1C',
  accent: '#0369A1',
  watermark: 'rgba(0,0,0,0.10)',
};

// @react-pdf/renderer's default font is "Helvetica" which has full Latin glyph
// coverage but no diacritics beyond Latin-1. We don't bundle custom fonts in
// D.2.2 to keep the dependency surface small. Upgrade path: add Noto Sans +
// Noto Sans Devanagari in a follow-up to support Hindi chart values.
Font.registerHyphenationCallback((word) => [word]);

// ────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────
export const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: palette.ink,
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 36,
    paddingRight: 36,
  },
  header: {
    position: 'absolute',
    top: 18,
    left: 36,
    right: 36,
    height: 30,
    flexDirection: 'row',
    borderBottomWidth: 0.75,
    borderBottomColor: palette.line,
    paddingBottom: 4,
    fontSize: 8.5,
  },
  headerLeft: { flex: 1 },
  headerRight: { flex: 1, textAlign: 'right' },
  headerTitle: { fontSize: 11, color: palette.ink, marginBottom: 1 },
  headerMeta: { color: palette.inkSoft },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 36,
    right: 36,
    fontSize: 8,
    color: palette.inkMuted,
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: palette.lineSoft,
    paddingTop: 4,
  },
  footerLeft: { flex: 1 },
  footerRight: { flex: 1, textAlign: 'right' },
  watermark: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 320,
    color: palette.watermark,
    transform: 'rotate(-30deg)',
    fontSize: 30,
    textAlign: 'center',
    letterSpacing: 1,
  },
  sectionTitle: {
    fontSize: 11,
    color: palette.ink,
    marginBottom: 4,
    marginTop: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.line,
    paddingBottom: 2,
  },
  subtle: { color: palette.inkMuted },
  kvRow: { flexDirection: 'row', marginBottom: 2 },
  kvKey: { width: 110, color: palette.inkSoft },
  kvVal: { flex: 1, color: palette.ink },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: palette.tint,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.line,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.25,
    borderBottomColor: palette.lineSoft,
    paddingVertical: 2.5,
    paddingHorizontal: 4,
  },
  pill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    fontSize: 8,
    color: '#FFFFFF',
    backgroundColor: palette.accent,
  },
  banner: {
    borderWidth: 0.75,
    borderColor: palette.warn,
    backgroundColor: '#FFFBEB',
    padding: 6,
    marginBottom: 8,
    marginTop: 4,
    fontSize: 9,
    color: palette.warn,
  },
  bannerDanger: {
    borderWidth: 0.75,
    borderColor: palette.danger,
    backgroundColor: '#FEF2F2',
    padding: 6,
    marginBottom: 8,
    marginTop: 4,
    fontSize: 9,
    color: palette.danger,
  },
  emptyState: { fontSize: 9, color: palette.inkMuted, fontStyle: 'italic', paddingVertical: 2 },
  para: { fontSize: 9.5, color: palette.ink, marginBottom: 4, lineHeight: 1.35 },
});

// ────────────────────────────────────────────────────────────────────────
// Primitives
// ────────────────────────────────────────────────────────────────────────
export function KV({ k, v }: { k: string; v?: string | number | null }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvVal}>{v === null || v === undefined || v === '' ? '—' : String(v)}</Text>
    </View>
  );
}

export function SectionCard({
  title,
  children,
  empty,
  wrap,
}: {
  title: string;
  children?: React.ReactNode;
  empty?: string;
  /** Allow the card to split across pages. Default false (kept together). */
  wrap?: boolean;
}) {
  return (
    <View wrap={wrap ?? false}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children ?? <Text style={styles.emptyState}>{empty ?? 'No data recorded.'}</Text>}
    </View>
  );
}

export function Banner({
  children,
  danger,
  warn,
}: {
  children: React.ReactNode;
  danger?: boolean;
  /** Yellow warn variant (default when neither prop is set). */
  warn?: boolean;
}) {
  // danger wins if both set; default style is warn-style (yellow).
  void warn;
  return (
    <View style={danger ? styles.bannerDanger : styles.banner}>
      <Text>{children}</Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page chrome: watermark + header + footer + frame
// ────────────────────────────────────────────────────────────────────────
export interface ChartPrintPageProps {
  hospitalName: string;
  patientNameUhid: string;           // "Ravi Kumar · UHID RC-00123"
  encounterLabel?: string;            // "IP #24-0815 · Admitted 17 Apr"
  tabLabel: string;                   // "Overview" / "Patient Brief"
  exportedByLine: string;             // "Printed by Dr. A Patel (doctor) · 19 Apr 2026, 14:22 IST"
  watermarkLine: string;              // The exact audit watermark string
  printIdShort: string;               // 8-char id for footer
  children: React.ReactNode;
}

export function ChartPrintPage({
  hospitalName, patientNameUhid, encounterLabel, tabLabel,
  exportedByLine, watermarkLine, printIdShort, children,
}: ChartPrintPageProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Fixed header — redraws on every page */}
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>{hospitalName} · {tabLabel}</Text>
            <Text style={styles.headerMeta}>{patientNameUhid}{encounterLabel ? ` · ${encounterLabel}` : ''}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerMeta}>{exportedByLine}</Text>
          </View>
        </View>

        {/* Diagonal watermark on every page */}
        <Text style={styles.watermark} fixed>
          {watermarkLine}
        </Text>

        {/* Body */}
        {children}

        {/* Fixed footer — page numbers + print id + confidentiality notice */}
        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber}/${totalPages} · Print ${printIdShort}`
            } />
          </View>
          <View style={styles.footerRight}>
            <Text>CONFIDENTIAL — do not redistribute</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
