/**
 * Patient Chart Overhaul — PC.4.D.3.3 — Patient Complaints PDF template.
 *
 * Scope: tab_complaints / complaints. V's design lock: "All complaints, any
 * status (full lifecycle audit view)".
 *
 * Groups by status (open / in_progress / resolved / closed) in that order
 * so the pending work is on page 1. SLA breach = now() > sla_due_at AND
 * status IN ('open','in_progress') — highlighted in danger red.
 *
 * Per row: priority chip, subject, description, raised-by snapshot,
 * resolved-by snapshot (if resolved/closed), SLA due + breach flag.
 *
 * Pulls data from ChartBundle.complaints (assembled by render.ts). No
 * queries here.
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type { ChartBundle, ComplaintRow } from '../render';

export type ComplaintsProps = {
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

/** True iff complaint is past SLA and still unresolved. */
function isBreached(c: ComplaintRow): boolean {
  if (c.status !== 'open' && c.status !== 'in_progress') return false;
  if (!c.sla_due_at) return false;
  return Date.now() > new Date(c.sla_due_at).getTime();
}

function priorityColor(p: string): string {
  const pl = p.toLowerCase();
  if (pl === 'critical') return palette.danger;
  if (pl === 'high') return palette.warn;
  if (pl === 'low') return palette.inkMuted;
  return palette.inkSoft;
}

function statusColor(s: string): string {
  const sl = s.toLowerCase();
  if (sl === 'resolved' || sl === 'closed') return palette.accent;
  if (sl === 'in_progress') return palette.warn;
  return palette.danger; // open
}

const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'];
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

function ComplaintBlock({ c }: { c: ComplaintRow }) {
  const breached = isBreached(c);
  return (
    <View wrap={false} style={{
      borderWidth: 0.5,
      borderColor: breached ? palette.danger : palette.lineSoft,
      backgroundColor: breached ? '#FEF2F2' : undefined,
      padding: 6,
      marginBottom: 6,
    }}>
      <View style={{ flexDirection: 'row', marginBottom: 3 }}>
        <Text style={{ flex: 1, color: palette.ink, fontWeight: 700 }}>
          {c.subject}
        </Text>
        <Text style={{ width: 78, color: priorityColor(c.priority), fontWeight: 700, textAlign: 'right' }}>
          {c.priority.toUpperCase()}
        </Text>
      </View>
      <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 3 }}>
        Category: {c.category}
        {breached ? '  ·  ' : ''}
        {breached ? (
          <Text style={{ color: palette.danger, fontWeight: 700 }}>SLA BREACH</Text>
        ) : null}
      </Text>
      <Text style={{ ...styles.para, marginBottom: 4 }}>{c.description}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Text style={{ width: '50%', color: palette.inkSoft, fontSize: 8.5 }}>
          Raised: {formatTs(c.created_at)}
        </Text>
        <Text style={{ width: '50%', color: palette.inkSoft, fontSize: 8.5, textAlign: 'right' }}>
          By: {c.raised_by_user_name} ({c.raised_by_user_role})
        </Text>
        <Text style={{
          width: '50%',
          color: breached ? palette.danger : palette.inkSoft,
          fontSize: 8.5,
        }}>
          SLA due: {formatTs(c.sla_due_at)}
        </Text>
        {c.resolved_at ? (
          <Text style={{ width: '50%', color: palette.accent, fontSize: 8.5, textAlign: 'right' }}>
            Resolved: {formatTs(c.resolved_at)}
            {c.resolved_by_user_name ? ` by ${c.resolved_by_user_name}` : ''}
          </Text>
        ) : (
          <Text style={{ width: '50%', color: palette.inkSoft, fontSize: 8.5, textAlign: 'right' }}>
            {c.status === 'open' || c.status === 'in_progress' ? 'Awaiting resolution' : '—'}
          </Text>
        )}
        {c.resolution_note ? (
          <Text style={{ width: '100%', color: palette.inkSoft, fontSize: 8.5, marginTop: 2 }}>
            Resolution: {c.resolution_note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function StatusGroup({ status, rows }: { status: string; rows: ComplaintRow[] }) {
  if (rows.length === 0) return null;
  const breached = rows.filter(isBreached).length;
  const summary: string[] = [`${rows.length} complaint${rows.length === 1 ? '' : 's'}`];
  if (breached > 0) summary.push(`${breached} breached`);
  return (
    <View wrap={true} style={{ marginBottom: 10 }}>
      <Text style={{
        ...styles.subtle,
        color: statusColor(status),
        fontWeight: 700,
        marginBottom: 4,
      }}>
        {STATUS_LABELS[status] ?? status}  ({summary.join(' · ')})
      </Text>
      {rows.map((c) => <ComplaintBlock key={c.id} c={c} />)}
    </View>
  );
}

export function ComplaintsTemplate({ bundle, chrome }: ComplaintsProps) {
  const { complaints } = bundle;

  // Group by status, preserving canonical order.
  const byStatus: Record<string, ComplaintRow[]> = {};
  for (const s of STATUS_ORDER) byStatus[s] = [];
  for (const c of complaints) {
    if (!byStatus[c.status]) byStatus[c.status] = [];
    byStatus[c.status].push(c);
  }

  const total = complaints.length;
  const open = (byStatus.open?.length ?? 0) + (byStatus.in_progress?.length ?? 0);
  const breached = complaints.filter(isBreached).length;
  const critical = complaints.filter(
    (c) => c.priority === 'critical' && (c.status === 'open' || c.status === 'in_progress'),
  ).length;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Patient complaints — ${total} total`}
        empty="No complaints raised for this patient."
        wrap={true}
      >
        {total > 0 ? (
          <View>
            <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 6 }}>
              {open} unresolved
              {breached > 0 ? ` · ${breached} SLA breach${breached === 1 ? '' : 'es'}` : ''}
              {critical > 0 ? ` · ${critical} critical open` : ''}
            </Text>
            {(breached > 0 || critical > 0) && (
              <Text style={{ ...styles.subtle, color: palette.danger, marginBottom: 6 }}>
                {breached > 0
                  ? `${breached} complaint${breached === 1 ? '' : 's'} past SLA`
                  : ''}
                {breached > 0 && critical > 0 ? ' · ' : ''}
                {critical > 0
                  ? `${critical} critical open complaint${critical === 1 ? '' : 's'}`
                  : ''}
                {' — review first.'}
              </Text>
            )}
            {STATUS_ORDER.map((s) => (
              <StatusGroup key={s} status={s} rows={byStatus[s]} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 10 }}>
        <Text style={styles.subtle}>
          Source: patient_complaints. Priority → SLA map: critical 1h · high 4h ·
          normal 24h · low 72h. SLA breach highlighted in red when status is
          open/in_progress and clock has passed sla_due_at. Full lifecycle
          visible (open/in-progress/resolved/closed).
        </Text>
      </View>
    </ChartPrintPage>
  );
}
