/**
 * Patient Chart Overhaul — PC.4.D.2.3 — Meds PDF template.
 *
 * Scope: tab_meds / meds. Mirrors the Meds tab — currently active /
 * on-hold medication_requests (end_date in the future or null), followed
 * by the last-72h MAR strip from medication_administrations.
 *
 * High-alert meds and narcotics are badged in red so a paper copy still
 * carries the safety signal. PRN meds are labelled.
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
import type { ChartBundle, ActiveMedRow, MarRow } from '../render';

export type MedsProps = {
  bundle: ChartBundle;
  chrome: Omit<ChartPrintPageProps, 'children'>;
};

function formatTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }) + ' IST';
  } catch {
    return ts;
  }
}

function doseString(m: ActiveMedRow): string {
  const qty = m.dose_quantity ? m.dose_quantity : '';
  const unit = m.dose_unit ?? '';
  const route = m.route ? ` ${m.route}` : '';
  const freq = m.frequency_code ? ` ${m.frequency_code}` : '';
  return `${qty} ${unit}${route}${freq}`.trim() || '—';
}

function marStatusColor(s: string): string {
  switch (s) {
    case 'completed': return palette.accent;
    case 'not_done': return palette.danger;
    case 'held': return palette.warn;
    case 'in_progress': return palette.accent;
    case 'pending': return palette.inkMuted;
    case 'entered_in_error': return palette.danger;
    default: return palette.ink;
  }
}

function MedRow({ m }: { m: ActiveMedRow }) {
  const high = m.is_high_alert;
  const narc = m.narcotics_class && m.narcotics_class !== 'none';
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ flex: 1.6, color: high || narc ? palette.danger : palette.ink }}>
        {m.drug_name}
        {m.generic_name ? ` (${m.generic_name})` : ''}
        {m.is_prn ? ' · PRN' : ''}
        {high ? ' · HIGH-ALERT' : ''}
        {narc ? ` · Narcotic (${m.narcotics_class})` : ''}
      </Text>
      <Text style={{ flex: 1.1 }}>{doseString(m)}</Text>
      <Text style={{ width: 95 }}>{m.prescriber_name ?? '—'}</Text>
      <Text style={{ width: 70 }}>{formatTs(m.start_date).replace(' IST', '')}</Text>
      <Text style={{ width: 70 }}>{m.end_date ? formatTs(m.end_date).replace(' IST', '') : 'ongoing'}</Text>
    </View>
  );
}

function MarStripRow({ r }: { r: MarRow }) {
  const color = marStatusColor(r.status);
  const dose = r.dose_given ? `${r.dose_given}${r.dose_unit ? ' ' + r.dose_unit : ''}` : '—';
  const reason = r.not_done_reason ?? r.hold_reason ?? '';
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ flex: 1.4 }}>{r.drug_name}</Text>
      <Text style={{ width: 95 }}>{formatTs(r.scheduled_datetime).replace(' IST', '')}</Text>
      <Text style={{ width: 95 }}>{formatTs(r.administered_datetime).replace(' IST', '')}</Text>
      <Text style={{ width: 70, color }}>{r.status}</Text>
      <Text style={{ width: 80 }}>{dose}</Text>
      <Text style={{ flex: 1 }}>{r.administered_by_name ?? (reason ? `— ${reason}` : '—')}</Text>
    </View>
  );
}

export function MedsTemplate({ bundle, chrome }: MedsProps) {
  const { activeMeds, mar } = bundle;

  const highAlertCount = activeMeds.filter((m) => m.is_high_alert || (m.narcotics_class && m.narcotics_class !== 'none')).length;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Active medications (${activeMeds.length})`}
        empty="No active medications."
      >
        {activeMeds.length > 0 ? (
          <View>
            {highAlertCount > 0 && (
              <Text style={{ ...styles.subtle, color: palette.danger, marginBottom: 3 }}>
                {highAlertCount} high-alert / narcotic medication{highAlertCount === 1 ? '' : 's'} — verify before administration.
              </Text>
            )}
            <View style={styles.tableHead}>
              <Text style={{ flex: 1.6 }}>Drug</Text>
              <Text style={{ flex: 1.1 }}>Dose / Route / Freq</Text>
              <Text style={{ width: 95 }}>Prescriber</Text>
              <Text style={{ width: 70 }}>Start</Text>
              <Text style={{ width: 70 }}>End</Text>
            </View>
            {activeMeds.map((m) => (
              <MedRow key={m.id} m={m} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <SectionCard
        title={`MAR — last 72 hours (${mar.length})`}
        empty="No administrations recorded in the last 72 hours."
        wrap={true}
      >
        {mar.length > 0 ? (
          <View>
            <View style={styles.tableHead}>
              <Text style={{ flex: 1.4 }}>Drug</Text>
              <Text style={{ width: 95 }}>Scheduled</Text>
              <Text style={{ width: 95 }}>Administered</Text>
              <Text style={{ width: 70 }}>Status</Text>
              <Text style={{ width: 80 }}>Dose given</Text>
              <Text style={{ flex: 1 }}>By / Reason</Text>
            </View>
            {mar.map((r) => (
              <MarStripRow key={r.id} r={r} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.subtle}>
          Active meds shown are orders with status active/on_hold and end date in the future or unset.
          MAR shows scheduled administrations from the last 72 hours.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
