/**
 * Patient Chart Overhaul — PC.4.D.2.2 — Overview PDF template.
 *
 * Scope: tab_overview / overview. Mirrors the on-screen Overview tab —
 * patient header, active problems, allergies (criticality-sorted), current
 * encounter, care attending, latest vitals snapshot. Keeps to one page in
 * the common case; wrap=false on each card prevents awkward mid-card breaks.
 *
 * Pulls data from ChartBundle (assembled by render.ts). Adds no queries.
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, KV, Banner, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type { ChartBundle } from '../render';

export type OverviewProps = {
  bundle: ChartBundle;
  chrome: Omit<ChartPrintPageProps, 'children'>;
};

function formatDob(dob: string | null): string {
  if (!dob) return '—';
  try {
    const d = new Date(dob);
    const age = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} (${age}y)`;
  } catch {
    return dob;
  }
}

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

export function OverviewTemplate({ bundle, chrome }: OverviewProps) {
  const { patient, encounter, allergies, conditions, latestVitals } = bundle;
  const hasCriticalAllergy = allergies.some((a) => a.criticality === 'high');

  return (
    <ChartPrintPage {...chrome}>
      {hasCriticalAllergy && (
        <Banner danger>
          ⚠ Patient has HIGH-criticality allergy records. Verify before
          prescribing or administering medication.
        </Banner>
      )}

      <SectionCard title="Patient">
        <KV k="Name" v={patient.name_full} />
        <KV k="UHID" v={patient.uhid} />
        <KV k="DOB / Age" v={formatDob(patient.dob)} />
        <KV k="Gender" v={patient.gender ?? '—'} />
        <KV k="Blood group" v={patient.blood_group && patient.blood_group !== 'unknown' ? patient.blood_group : '—'} />
        <KV k="Phone" v={patient.phone ?? '—'} />
      </SectionCard>

      <SectionCard title="Current encounter" empty="No active encounter.">
        {encounter ? (
          <>
            <KV k="Encounter" v={`${encounter.encounter_class.toUpperCase()} · ${encounter.status}`} />
            <KV k="Admitted" v={formatTs(encounter.admission_at)} />
            <KV k="Chief complaint" v={encounter.chief_complaint ?? '—'} />
            <KV k="Provisional dx" v={encounter.preliminary_diagnosis_icd10 ?? '—'} />
            <KV k="Attending" v={encounter.attending_name ?? '—'} />
          </>
        ) : undefined}
      </SectionCard>

      <SectionCard title="Active problems" empty="No active conditions recorded.">
        {conditions.length > 0 ? (
          <View>
            <View style={styles.tableHead}>
              <Text style={{ width: 70 }}>ICD-10</Text>
              <Text style={{ flex: 1 }}>Condition</Text>
              <Text style={{ width: 60 }}>Status</Text>
              <Text style={{ width: 60 }}>Severity</Text>
              <Text style={{ width: 70 }}>Onset</Text>
            </View>
            {conditions.map((c, i) => (
              <View style={styles.tableRow} key={`c-${i}`}>
                <Text style={{ width: 70 }}>{c.icd10_code ?? '—'}</Text>
                <Text style={{ flex: 1 }}>{c.condition_name}</Text>
                <Text style={{ width: 60 }}>{c.clinical_status}</Text>
                <Text style={{ width: 60 }}>{c.severity ?? '—'}</Text>
                <Text style={{ width: 70 }}>{formatTs(c.onset_date).replace(' IST', '')}</Text>
              </View>
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <SectionCard title="Allergies" empty="No allergies on record.">
        {allergies.length > 0 ? (
          <View>
            <View style={styles.tableHead}>
              <Text style={{ flex: 1 }}>Substance</Text>
              <Text style={{ width: 110 }}>Reaction</Text>
              <Text style={{ width: 60 }}>Severity</Text>
              <Text style={{ width: 60 }}>Crit.</Text>
              <Text style={{ width: 80 }}>Verified</Text>
            </View>
            {allergies.map((a, i) => (
              <View style={styles.tableRow} key={`a-${i}`}>
                <Text style={{ flex: 1, color: a.criticality === 'high' ? palette.danger : palette.ink }}>
                  {a.substance}
                </Text>
                <Text style={{ width: 110 }}>{a.reaction ?? '—'}</Text>
                <Text style={{ width: 60 }}>{a.severity}</Text>
                <Text style={{ width: 60 }}>{a.criticality}</Text>
                <Text style={{ width: 80 }}>{a.verification_status}</Text>
              </View>
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <SectionCard title="Latest vitals" empty="No vitals recorded.">
        {latestVitals ? (
          <>
            <Text style={styles.subtle}>Recorded {formatTs(latestVitals.recorded_at)}</Text>
            <View style={{ flexDirection: 'row', marginTop: 2, flexWrap: 'wrap' }}>
              <View style={{ width: '25%' }}><KV k="Temp" v={latestVitals.temperature_c ? `${latestVitals.temperature_c} °C` : '—'} /></View>
              <View style={{ width: '25%' }}><KV k="Pulse" v={latestVitals.pulse_bpm ? `${latestVitals.pulse_bpm} bpm` : '—'} /></View>
              <View style={{ width: '25%' }}><KV k="RR" v={latestVitals.resp_rate ? `${latestVitals.resp_rate} / min` : '—'} /></View>
              <View style={{ width: '25%' }}><KV k="BP" v={latestVitals.bp ? `${latestVitals.bp} mmHg` : '—'} /></View>
              <View style={{ width: '25%' }}><KV k="SpO₂" v={latestVitals.spo2_percent ? `${latestVitals.spo2_percent} %` : '—'} /></View>
              <View style={{ width: '25%' }}><KV k="Pain" v={latestVitals.pain_score != null ? `${latestVitals.pain_score}/10` : '—'} /></View>
            </View>
          </>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.subtle}>
          This document is a point-in-time snapshot. Consult the live chart for current values.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
