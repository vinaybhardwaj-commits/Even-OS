/**
 * Patient Chart Overhaul — PC.4.D.3.2 — Journey PDF template.
 *
 * Scope: tab_journey / journey. Mirrors the Journey tab but pulls REAL data
 * from patient_journey_steps (the UI tab currently renders hardcoded demo
 * phase cards — this PDF uses the DB-backed source of truth instead).
 *
 * Groups steps by journey_phase (9 phases: PHASE_1_PRE_ADMISSION ..
 * PHASE_9_BILLING_CLOSURE). Per step: status chip, owner role, TAT target
 * vs actual with overdue highlight, timestamps (started/completed IST),
 * blocked/skipped reasons if present.
 *
 * Pulls data from ChartBundle (assembled by render.ts). Adds no queries.
 * Empty state: "No journey initiated for this patient." — renders when
 * patient_journey_steps returns 0 rows (journey never started, or LSQ
 * intake but no elective_surgical/medical/etc template instantiated).
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type { ChartBundle, JourneyStepRow } from '../render';

export type JourneyProps = {
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

/** Human-readable phase labels, ordered to match the journey_phase enum. */
const PHASE_LABELS: Record<string, string> = {
  PHASE_1_PRE_ADMISSION:       'Phase 1 — Pre-Admission',
  PHASE_2_ADMISSION:           'Phase 2 — Admission',
  PHASE_3_CLINICAL_ASSESSMENT: 'Phase 3 — Clinical Assessment',
  PHASE_4_PRE_OP:              'Phase 4 — Pre-Op',
  PHASE_5_INTRA_OP:            'Phase 5 — Intra-Op',
  PHASE_6_POST_OP:             'Phase 6 — Post-Op',
  PHASE_7_WARD_CARE:           'Phase 7 — Ward Care',
  PHASE_8_DISCHARGE:           'Phase 8 — Discharge',
  PHASE_9_BILLING_CLOSURE:     'Phase 9 — Billing Closure',
};

const PHASE_ORDER = [
  'PHASE_1_PRE_ADMISSION',
  'PHASE_2_ADMISSION',
  'PHASE_3_CLINICAL_ASSESSMENT',
  'PHASE_4_PRE_OP',
  'PHASE_5_INTRA_OP',
  'PHASE_6_POST_OP',
  'PHASE_7_WARD_CARE',
  'PHASE_8_DISCHARGE',
  'PHASE_9_BILLING_CLOSURE',
];

/** Colour a status chip by status value. */
function statusColor(s: string): string {
  const sl = s.toLowerCase();
  if (sl === 'completed') return palette.accent;
  if (sl === 'in_progress') return palette.warn;
  if (sl === 'blocked') return palette.danger;
  if (sl === 'skipped' || sl === 'not_applicable') return palette.inkSoft;
  return palette.ink; // pending
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    completed: 'DONE',
    in_progress: 'IN PROG',
    blocked: 'BLOCKED',
    skipped: 'SKIPPED',
    not_applicable: 'N/A',
    pending: 'PENDING',
  };
  return map[s.toLowerCase()] ?? s.toUpperCase().slice(0, 8);
}

/** True iff step is running and past its TAT target. */
function isOverdue(step: JourneyStepRow): boolean {
  if (step.status !== 'in_progress' || !step.tat_target_mins || !step.started_at) return false;
  const startedMs = new Date(step.started_at).getTime();
  const elapsedMins = Math.round((Date.now() - startedMs) / 60000);
  return elapsedMins > step.tat_target_mins;
}

function StepRow({ s }: { s: JourneyStepRow }) {
  const chipColor = statusColor(s.status);
  const overdue = isOverdue(s);
  const tatLine: string[] = [];
  if (s.tat_target_mins != null) tatLine.push(`target ${s.tat_target_mins}m`);
  if (s.tat_actual_mins != null) tatLine.push(`actual ${s.tat_actual_mins}m`);
  if (overdue) tatLine.push('OVERDUE');
  const reason = s.blocked_reason || s.skipped_reason;
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ width: 36, color: palette.inkSoft }}>{s.step_number}</Text>
      <Text style={{ flex: 1.7, color: palette.ink }}>
        {s.step_name}
        {reason ? ` · ${reason}` : ''}
      </Text>
      <Text style={{ width: 72, color: palette.inkSoft }}>{s.owner_role}</Text>
      <Text style={{ width: 56, color: chipColor, fontWeight: 700 }}>{statusLabel(s.status)}</Text>
      <Text style={{ width: 92, color: overdue ? palette.danger : palette.inkSoft }}>
        {tatLine.length > 0 ? tatLine.join(' · ') : '—'}
      </Text>
      <Text style={{ width: 96, color: palette.inkSoft }}>
        {s.completed_at
          ? formatTs(s.completed_at).replace(' IST', '')
          : s.started_at
          ? formatTs(s.started_at).replace(' IST', '')
          : '—'}
      </Text>
    </View>
  );
}

function PhaseGroup({ phase, rows }: { phase: string; rows: JourneyStepRow[] }) {
  if (rows.length === 0) return null;
  const done = rows.filter((r) => r.status === 'completed' || r.status === 'skipped').length;
  const blocked = rows.filter((r) => r.status === 'blocked').length;
  const inProg = rows.filter((r) => r.status === 'in_progress').length;
  const summary: string[] = [`${done}/${rows.length} done`];
  if (inProg > 0) summary.push(`${inProg} in progress`);
  if (blocked > 0) summary.push(`${blocked} blocked`);
  return (
    <View wrap={false} style={{ marginBottom: 10 }}>
      <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 3 }}>
        {PHASE_LABELS[phase] ?? phase}  ({summary.join(' · ')})
      </Text>
      <View style={styles.tableHead}>
        <Text style={{ width: 36 }}>#</Text>
        <Text style={{ flex: 1.7 }}>Step</Text>
        <Text style={{ width: 72 }}>Owner</Text>
        <Text style={{ width: 56 }}>Status</Text>
        <Text style={{ width: 92 }}>TAT</Text>
        <Text style={{ width: 96 }}>Last update</Text>
      </View>
      {rows.map((s) => (
        <StepRow key={s.id} s={s} />
      ))}
    </View>
  );
}

export function JourneyTemplate({ bundle, chrome }: JourneyProps) {
  const { journeySteps } = bundle;

  // Group by phase preserving the canonical phase order.
  const byPhase: Record<string, JourneyStepRow[]> = {};
  for (const p of PHASE_ORDER) byPhase[p] = [];
  for (const s of journeySteps) {
    if (!byPhase[s.phase]) byPhase[s.phase] = [];
    byPhase[s.phase].push(s);
  }

  const totalSteps = journeySteps.length;
  const doneSteps = journeySteps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const blockedSteps = journeySteps.filter((s) => s.status === 'blocked').length;
  const overdueSteps = journeySteps.filter(isOverdue).length;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Patient journey — ${totalSteps} step${totalSteps === 1 ? '' : 's'} across 9 phases`}
        empty="No journey initiated for this patient. A journey is instantiated from a template when the patient is admitted or routed from LSQ intake."
        wrap={true}
      >
        {totalSteps > 0 ? (
          <View>
            <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 6 }}>
              {doneSteps}/{totalSteps} completed
              {blockedSteps > 0 ? ` · ${blockedSteps} blocked` : ''}
              {overdueSteps > 0 ? ` · ${overdueSteps} overdue` : ''}
            </Text>
            {(blockedSteps > 0 || overdueSteps > 0) && (
              <Text style={{ ...styles.subtle, color: palette.danger, marginBottom: 6 }}>
                {blockedSteps > 0
                  ? `${blockedSteps} blocked step${blockedSteps === 1 ? '' : 's'}`
                  : ''}
                {blockedSteps > 0 && overdueSteps > 0 ? ' · ' : ''}
                {overdueSteps > 0
                  ? `${overdueSteps} overdue step${overdueSteps === 1 ? '' : 's'}`
                  : ''}
                {' — review first.'}
              </Text>
            )}
            {PHASE_ORDER.map((p) => (
              <PhaseGroup key={p} phase={p} rows={byPhase[p]} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.subtle}>
          Source: patient_journey_steps (journey engine). Journey templates define the
          step sequence per journey_type (elective_surgical, emergency, day_care, medical).
          Each step tracks owner role, TAT target/actual, blocked/skipped reasons, and
          handoff timestamps.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
