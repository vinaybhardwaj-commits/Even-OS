/**
 * Patient Chart Overhaul — PC.4.D.3.1 — Orders PDF template.
 *
 * Scope: tab_orders / orders. Mirrors the Orders tab but intentionally
 * excludes medication_requests (those live in the Meds PDF — D.2.3). This
 * template shows clinical_orders + service_requests merged into a single
 * "non-medication orders" view, grouped by status so a paper copy tells a
 * clinician what's still open vs. completed at a glance.
 *
 * Time window: last 30 days (matches labs + orders UI default).
 * Limit: 100 rows total to keep print lengths manageable.
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
import type { ChartBundle, OrderRow } from '../render';

export type OrdersProps = {
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

function priorityColor(p: string | null | undefined): string {
  if (!p) return palette.ink;
  const pp = p.toLowerCase();
  if (pp === 'stat') return palette.danger;
  if (pp === 'urgent') return palette.warn;
  return palette.ink;
}

function typeBadge(t: string): string {
  // Normalise both clinical_orders.order_type + service_requests.request_type.
  const map: Record<string, string> = {
    lab: 'LAB',
    radiology: 'RAD',
    imaging: 'RAD',
    pharmacy: 'RX',
    procedure: 'PROC',
    diet: 'DIET',
    nursing: 'NUR',
    referral: 'REF',
  };
  return map[t.toLowerCase()] ?? t.toUpperCase().slice(0, 4);
}

/** Status groups, ordered from most operationally relevant → least. */
const STATUS_GROUPS: Array<{ key: string; label: string; match: (s: string) => boolean }> = [
  { key: 'active',    label: 'Active / in progress', match: (s) => ['draft', 'ordered', 'requested', 'in_progress', 'in-progress', 'active'].includes(s) },
  { key: 'completed', label: 'Completed',            match: (s) => ['completed', 'fulfilled', 'resulted'].includes(s) },
  { key: 'cancelled', label: 'Cancelled / revoked',  match: (s) => ['cancelled', 'canceled', 'revoked', 'entered_in_error'].includes(s) },
];

function classifyStatus(s: string): string {
  const sl = s.toLowerCase();
  for (const g of STATUS_GROUPS) if (g.match(sl)) return g.key;
  return 'other';
}

function OrderRowView({ o }: { o: OrderRow }) {
  const prioColor = priorityColor(o.priority);
  const subtitleParts = [
    o.test_code,
    o.modality,
    o.body_part,
    o.route,
    o.dosage,
    o.frequency,
    o.duration_days ? `${o.duration_days}d` : null,
    o.instructions,
    o.clinical_indication,
  ].filter(Boolean);
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ width: 32, color: palette.inkSoft }}>{typeBadge(o.order_type)}</Text>
      <Text style={{ flex: 1.5, color: prioColor }}>
        {o.order_name || '—'}
        {o.priority && o.priority.toLowerCase() !== 'routine' ? ` · ${o.priority.toUpperCase()}` : ''}
      </Text>
      <Text style={{ flex: 1.4, color: palette.inkSoft }}>
        {subtitleParts.length > 0 ? subtitleParts.join(' · ') : '—'}
      </Text>
      <Text style={{ width: 90 }}>{o.ordered_by_name ?? '—'}</Text>
      <Text style={{ width: 80 }}>{formatTs(o.ordered_at).replace(' IST', '')}</Text>
    </View>
  );
}

function StatusGroup({ title, rows }: { title: string; rows: OrderRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View wrap={false} style={{ marginBottom: 8 }}>
      <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 3 }}>
        {title} ({rows.length})
      </Text>
      <View style={styles.tableHead}>
        <Text style={{ width: 32 }}>Type</Text>
        <Text style={{ flex: 1.5 }}>Order</Text>
        <Text style={{ flex: 1.4 }}>Details</Text>
        <Text style={{ width: 90 }}>Ordered by</Text>
        <Text style={{ width: 80 }}>Ordered</Text>
      </View>
      {rows.map((o) => (
        <OrderRowView key={`${o.source}-${o.id}`} o={o} />
      ))}
    </View>
  );
}

export function OrdersTemplate({ bundle, chrome }: OrdersProps) {
  const { orders } = bundle;

  const grouped: Record<string, OrderRow[]> = { active: [], completed: [], cancelled: [], other: [] };
  for (const o of orders) grouped[classifyStatus(o.order_status)].push(o);

  const statCount = orders.filter((o) => (o.priority ?? '').toLowerCase() === 'stat').length;
  const criticalCount = orders.filter((o) => o.is_critical).length;

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Non-medication orders — last 30 days (${orders.length})`}
        empty="No orders in the last 30 days (excluding medications)."
        wrap={true}
      >
        {orders.length > 0 ? (
          <View>
            {(statCount > 0 || criticalCount > 0) && (
              <Text style={{ ...styles.subtle, color: palette.danger, marginBottom: 4 }}>
                {statCount > 0 ? `${statCount} STAT order${statCount === 1 ? '' : 's'}` : ''}
                {statCount > 0 && criticalCount > 0 ? ' · ' : ''}
                {criticalCount > 0 ? `${criticalCount} critical result${criticalCount === 1 ? '' : 's'}` : ''}
                {' — review first.'}
              </Text>
            )}
            <StatusGroup title="Active / in progress" rows={grouped.active} />
            <StatusGroup title="Completed"            rows={grouped.completed} />
            <StatusGroup title="Cancelled / revoked"  rows={grouped.cancelled} />
            <StatusGroup title="Other"                rows={grouped.other} />
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.subtle}>
          Includes clinical_orders (lab / radiology / procedure / diet / nursing) and
          service_requests (lab / imaging / referral) from the last 30 days. Medications
          are printed separately in the Medications PDF.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
