/**
 * Patient Chart Overhaul — PC.4.D.2.3 — Labs PDF template.
 *
 * Scope: tab_labs / labs. Mirrors the Labs tab — lab_orders from the last
 * 30 days grouped by order → panel_name, with each order's results rendered
 * as a table. Rows are tinted red for high / low / critical_high /
 * critical_low / abnormal flags so the paper copy preserves the same
 * clinical-safety signal as the on-screen chart.
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
import type { ChartBundle, LabOrderRow, LabResultRow } from '../render';

export type LabsProps = {
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

function isAbnormalFlag(flag: string): boolean {
  return flag === 'high' || flag === 'low' || flag === 'critical_high'
      || flag === 'critical_low' || flag === 'abnormal';
}

function flagLabel(flag: string): string {
  switch (flag) {
    case 'high': return 'H';
    case 'low': return 'L';
    case 'critical_high': return 'H*';
    case 'critical_low': return 'L*';
    case 'abnormal': return 'A';
    case 'normal': return '';
    default: return flag;
  }
}

function valueString(r: LabResultRow): string {
  const v = r.value_numeric ?? r.value_text ?? '';
  const unit = r.unit ? ` ${r.unit}` : '';
  return v ? `${v}${unit}` : '—';
}

function refRangeString(r: LabResultRow): string {
  if (r.ref_range_low && r.ref_range_high) return `${r.ref_range_low}–${r.ref_range_high}`;
  if (r.ref_range_text) return r.ref_range_text;
  return '—';
}

function OrderBlock({
  order,
  results,
}: {
  order: LabOrderRow;
  results: LabResultRow[];
}) {
  return (
    <View wrap={true} style={{
      borderWidth: 0.5,
      borderColor: palette.lineSoft,
      borderRadius: 3,
      padding: 6,
      marginBottom: 6,
    }}>
      <View style={{ flexDirection: 'row', marginBottom: 3 }}>
        <Text style={{ flex: 1, fontSize: 10, color: order.is_critical ? palette.danger : palette.ink }}>
          {order.panel_name ?? 'Lab panel'}
          {order.urgency && order.urgency !== 'routine' ? ` · ${order.urgency.toUpperCase()}` : ''}
          {order.is_critical ? ' · CRITICAL' : ''}
        </Text>
        <Text style={{ fontSize: 8.5, color: palette.inkMuted }}>
          #{order.order_number} · {order.status}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        <Text style={{ flex: 1, fontSize: 8.5, color: palette.inkSoft }}>
          Ordered {formatTs(order.ordered_at)}
        </Text>
        <Text style={{ fontSize: 8.5, color: palette.inkSoft }}>
          {order.resulted_at ? `Resulted ${formatTs(order.resulted_at)}` : 'Not resulted'}
        </Text>
      </View>

      {results.length > 0 ? (
        <View>
          <View style={styles.tableHead}>
            <Text style={{ flex: 1.4 }}>Test</Text>
            <Text style={{ width: 90 }}>Value</Text>
            <Text style={{ width: 22 }}>Flag</Text>
            <Text style={{ width: 95 }}>Ref range</Text>
            <Text style={{ width: 85 }}>Resulted</Text>
          </View>
          {results.map((r, i) => {
            const abn = isAbnormalFlag(r.flag) || r.is_critical;
            const color = abn ? palette.danger : palette.ink;
            return (
              <View key={`${r.test_code}-${i}`} style={styles.tableRow} wrap={false}>
                <Text style={{ flex: 1.4, color }}>{r.test_name}</Text>
                <Text style={{ width: 90, color }}>{valueString(r)}</Text>
                <Text style={{ width: 22, color }}>{flagLabel(r.flag)}</Text>
                <Text style={{ width: 95, color: palette.inkSoft }}>{refRangeString(r)}</Text>
                <Text style={{ width: 85, color: palette.inkMuted }}>{formatTs(r.resulted_at).replace(' IST', '')}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.emptyState}>No results recorded for this order yet.</Text>
      )}
    </View>
  );
}

export function LabsTemplate({ bundle, chrome }: LabsProps) {
  const { labOrders, labResults } = bundle;

  // Group results by order_id
  const resultsByOrder = new Map<string, LabResultRow[]>();
  for (const r of labResults) {
    const bucket = resultsByOrder.get(r.order_id);
    if (bucket) bucket.push(r);
    else resultsByOrder.set(r.order_id, [r]);
  }

  return (
    <ChartPrintPage {...chrome}>
      <SectionCard
        title={`Lab orders — last 30 days (${labOrders.length})`}
        empty="No lab orders in the last 30 days."
      >
        {labOrders.length > 0 ? (
          <View>
            {labOrders.map((o) => (
              <OrderBlock key={o.id} order={o} results={resultsByOrder.get(o.id) ?? []} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.subtle}>
          Flag legend:  H = high   L = low   H* = critical high   L* = critical low   A = abnormal.
          Red rows indicate out-of-range or critical results.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
