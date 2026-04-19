/**
 * Patient Chart Overhaul — PC.4.D.2.2 — Brief PDF template.
 *
 * Scope: tab_brief / brief. Renders the latest non-stale patient_brief row
 * (AI-generated synthesis across all clinical notes + documents). This one
 * MUST carry a prominent "verify clinically before acting" banner — the
 * brief is probabilistic summarisation, not a signed clinical record.
 *
 * Data contract (from ChartBundle.brief):
 *   narrative: free-text prose
 *   structured: jsonb, shape depends on N.4 generator. We render common
 *               keys if present: active_problems, key_allergies, recent_events,
 *               medications_of_note, followups — all as bullet lists.
 *   hallucination_flags_count: number of doctor-raised flags on this brief.
 *   generated_at: when Qwen produced this version.
 *   version: monotonic version # within patient.
 *
 * If no brief exists, renders a "No brief available yet" card so the audit
 * row still reads status='ready' (legitimate empty state — D.2.3/D.3 will
 * allow callers to decide whether to block on this).
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, Banner, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type { ChartBundle } from '../render';

export type BriefProps = {
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
    });
  } catch {
    return String(ts);
  }
}

/** Render a jsonb bullet list if the key exists and is a non-empty array. */
function StructuredList({
  label, items,
}: { label: string; items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={[styles.kvKey, { marginBottom: 2 }]}>{label}</Text>
      {items.slice(0, 15).map((item, i) => {
        const s = typeof item === 'string'
          ? item
          : typeof item === 'object' && item !== null
            ? ('label' in item ? String((item as any).label) : JSON.stringify(item))
            : String(item);
        return (
          <View
            key={i}
            style={{ flexDirection: 'row', marginBottom: 1.5, paddingLeft: 6 }}
          >
            <Text style={{ color: palette.inkMuted, width: 8 }}>•</Text>
            <Text style={{ flex: 1 }}>{s}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function BriefTemplate({ bundle, chrome }: BriefProps) {
  const brief = bundle.brief;

  // Render-always verify banner on top of every brief export.
  const topBanner = (
    <Banner danger>
      ⚠ AI-generated synthesis. Verify clinically before acting — not a signed
      clinical record. Discrepancies must be raised via the “Flag” action on
      the Brief tab.
    </Banner>
  );

  if (!brief) {
    return (
      <ChartPrintPage {...chrome}>
        {topBanner}
        <SectionCard title="Patient brief">
          <Text style={{ color: palette.inkMuted }}>
            No brief is available for this patient yet. Briefs are regenerated
            automatically as new notes and documents are ingested. If this is
            unexpected, open the Brief tab and click “Regenerate”.
          </Text>
        </SectionCard>

        <SectionCard title="Patient">
          <Text style={styles.kvVal}>
            {bundle.patient.name_full} · UHID {bundle.patient.uhid}
          </Text>
        </SectionCard>
      </ChartPrintPage>
    );
  }

  const structured = (brief.structured ?? {}) as Record<string, unknown>;

  return (
    <ChartPrintPage {...chrome}>
      {topBanner}

      {brief.hallucination_flags_count > 0 && (
        <Banner warn>
          This brief has {brief.hallucination_flags_count} open accuracy flag
          {brief.hallucination_flags_count === 1 ? '' : 's'} raised by
          clinicians. Review flagged sections before acting.
        </Banner>
      )}

      <SectionCard title="Brief summary" wrap>
        <Text style={{ marginBottom: 4, color: palette.inkMuted, fontSize: 8.5 }}>
          Version {brief.version} · generated {formatTs(brief.generated_at)} IST
          {brief.is_stale ? ' · STALE' : ''}
        </Text>
        <Text style={{ lineHeight: 1.35 }}>
          {brief.narrative || 'No narrative produced.'}
        </Text>
      </SectionCard>

      <SectionCard title="Structured highlights" wrap>
        <StructuredList label="Active problems" items={structured.active_problems} />
        <StructuredList label="Key allergies" items={structured.key_allergies} />
        <StructuredList label="Recent events" items={structured.recent_events} />
        <StructuredList label="Medications of note" items={structured.medications_of_note} />
        <StructuredList label="Follow-ups" items={structured.followups} />
        {!Array.isArray(structured.active_problems)
          && !Array.isArray(structured.key_allergies)
          && !Array.isArray(structured.recent_events)
          && !Array.isArray(structured.medications_of_note)
          && !Array.isArray(structured.followups) && (
            <Text style={{ color: palette.inkMuted, fontSize: 8.5 }}>
              The brief generator did not emit structured sections for this
              version. See narrative above.
            </Text>
          )}
      </SectionCard>

      <SectionCard title="Provenance" wrap={false}>
        <Text style={{ fontSize: 8.5, color: palette.inkMuted }}>
          Brief ID {brief.id.slice(0, 8)} · version {brief.version} · generated
          by the Even OS Patient Brief engine (Qwen-2.5-14B). This document is
          a point-in-time snapshot; newer notes or documents after the
          generation timestamp are not reflected.
        </Text>
      </SectionCard>
    </ChartPrintPage>
  );
}
