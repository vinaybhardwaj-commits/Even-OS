/**
 * Patient Chart Overhaul — PC.4.D.3.1 — Calculators PDF template.
 *
 * Scope: tab_calculators / calculators. Shows the most recent run of each
 * calculator used for this patient (one row per calc_id, ordered by ran_at
 * desc). This matches the Calculators tab's default surface where pinned +
 * recently-run calcs are surfaced first.
 *
 * Each result renders:
 *   - Calc name + slug + version
 *   - Score + band label (colored)
 *   - Inputs snapshot (key/value from frozen jsonb)
 *   - Prose interpretation if `prose_status` in ('reviewed', 'added')
 *   - Run metadata (run_by_user_name, role, ran_at IST)
 *
 * Prose that's still 'pending' or 'declined' is NOT printed — falls back to
 * the band's default interpretation text.
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
import type { ChartBundle, CalcResultRow } from '../render';

export type CalculatorsProps = {
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

function bandColor(c: string | null | undefined): string {
  switch ((c ?? '').toLowerCase()) {
    case 'green': return palette.accent;
    case 'yellow': return palette.warn;
    case 'red': return palette.danger;
    default: return palette.ink;
  }
}

function formatInputVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function CalcRow({ c }: { c: CalcResultRow }) {
  const bcolor = bandColor(c.band_color);
  const showProse = (c.prose_status === 'reviewed' || c.prose_status === 'added') && !!c.prose_text;
  const interp = showProse ? c.prose_text! : (c.band_interpretation_default ?? '');

  // Turn inputs jsonb into a compact "key: value · key: value" list.
  const inputEntries = Object.entries(c.inputs ?? {});
  const inputLine = inputEntries.length > 0
    ? inputEntries.map(([k, v]) => `${k}: ${formatInputVal(v)}`).join(' · ')
    : '—';

  return (
    <View wrap={false} style={{ marginBottom: 10, paddingBottom: 6, borderBottomWidth: 0.5, borderBottomColor: palette.lineSoft }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 2 }}>
        <Text style={{ flex: 1, fontSize: 10.5, color: palette.ink }}>
          {c.calc_name ?? c.calc_slug}
          <Text style={{ fontSize: 8.5, color: palette.inkMuted }}>
            {'  '}· v{c.calc_version}
          </Text>
        </Text>
        <Text style={{ fontSize: 11, color: bcolor, fontWeight: 'bold' }}>
          Score {c.score}  ·  {c.band_label ?? c.band_key}
        </Text>
      </View>

      {/* Run metadata */}
      <Text style={{ ...styles.subtle, marginBottom: 3 }}>
        Run by {c.run_by_user_name} ({c.run_by_user_role}) · {formatTs(c.ran_at)}
      </Text>

      {/* Inputs */}
      <Text style={{ fontSize: 9, color: palette.inkSoft, marginBottom: 3 }}>
        <Text style={{ color: palette.inkMuted }}>Inputs: </Text>{inputLine}
      </Text>

      {/* Interpretation */}
      {interp ? (
        <Text style={styles.para}>
          <Text style={{ color: palette.inkMuted }}>
            {showProse ? 'Interpretation (reviewed): ' : 'Default interpretation: '}
          </Text>
          {interp}
        </Text>
      ) : null}

      {c.prose_status === 'declined' ? (
        <Text style={{ ...styles.subtle, color: palette.warn }}>
          LLM prose was declined by reviewer — showing band default only.
        </Text>
      ) : null}
    </View>
  );
}

export function CalculatorsTemplate({ bundle, chrome }: CalculatorsProps) {
  const { calcResults, patient } = bundle;
  void patient;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Clinical calculators — most recent per calc (${calcResults.length})`}
        empty="No calculator runs recorded for this patient."
        wrap={true}
      >
        {calcResults.length > 0 ? (
          <View>
            <Text style={{ ...styles.subtle, marginBottom: 6 }}>
              One row per calculator, showing the most recent run. Older runs are
              preserved in the audit trail (calculator_results table) but not printed.
            </Text>
            {calcResults.map((c) => (
              <CalcRow key={c.id} c={c} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 8 }}>
        <Text style={styles.subtle}>
          Scores are computed deterministically from frozen inputs. LLM prose
          is only printed when a clinician has clicked "I've reviewed"; otherwise
          the band's default interpretation text is shown.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
