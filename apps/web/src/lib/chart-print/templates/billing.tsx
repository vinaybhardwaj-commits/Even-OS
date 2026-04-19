/**
 * Patient Chart Overhaul — PC.4.D.3.3 — Billing PDF template.
 *
 * Scope: tab_billing / billing. V's design lock: "Full financial picture".
 *
 * Sections rendered (in order):
 *   1. Account header KVs (account_type, insurer, TPA, policy, sum_insured,
 *      running totals, balance_due)
 *   2. Charge lines grouped by category (room / procedure / lab / pharmacy /
 *      consultation / nursing / other) with per-group subtotal
 *   3. Deposits (amount, method, receipt, status, date)
 *   4. Insurance claims (status, pre-auth / enhancement / approved /
 *      deductions / settled / patient_liability, diagnosis + ICD)
 *   5. Invoices (number, status, grand_total, amount_paid, balance_due)
 *   6. Refunds (number, reason, status, amount / approved_amount)
 *
 * Pulls data from ChartBundle.billing (assembled by render.ts). No queries here.
 */

/* eslint-disable react/no-unknown-property */
import React from 'react';
import { Text, View } from '@react-pdf/renderer';
import {
  ChartPrintPage, SectionCard, KV, styles, palette,
  type ChartPrintPageProps,
} from '../pdf-components';
import type {
  ChartBundle,
  BillingChargeRow,
  BillingDepositRow,
  BillingClaimRow,
  BillingInvoiceRow,
  BillingRefundRow,
} from '../render';

export type BillingProps = {
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

function formatDay(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: '2-digit',
    });
  } catch {
    return ts;
  }
}

/** Format INR amount with Indian grouping. Accepts string/number/null. */
function inr(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Claim status coloring — mirrors insurance_claim_status enum. */
function claimStatusColor(s: string): string {
  const sl = s.toLowerCase();
  if (sl === 'settled' || sl === 'approved') return palette.accent;
  if (sl === 'rejected' || sl === 'closed_rejected') return palette.danger;
  if (sl === 'submitted' || sl === 'in_review' || sl === 'enhancement_requested') return palette.warn;
  return palette.inkSoft;
}

function depositStatusColor(s: string): string {
  const sl = s.toLowerCase();
  if (sl === 'applied' || sl === 'collected') return palette.accent;
  if (sl === 'refunded' || sl === 'cancelled') return palette.inkSoft;
  return palette.ink;
}

function refundStatusColor(s: string): string {
  const sl = s.toLowerCase();
  if (sl === 'processed' || sl === 'approved') return palette.accent;
  if (sl === 'rejected' || sl === 'cancelled') return palette.danger;
  if (sl === 'requested' || sl === 'pending_approval') return palette.warn;
  return palette.inkSoft;
}

/** Canonical category order for charges. Anything unknown falls in 'other'. */
const CATEGORY_ORDER = [
  'room', 'procedure', 'lab', 'pharmacy', 'consultation', 'nursing', 'other',
];
const CATEGORY_LABELS: Record<string, string> = {
  room: 'Room & Bed',
  procedure: 'Procedures',
  lab: 'Laboratory',
  pharmacy: 'Pharmacy',
  consultation: 'Consultations',
  nursing: 'Nursing',
  other: 'Other',
};

function categoryKey(c: string | null): string {
  if (!c) return 'other';
  const lc = c.toLowerCase();
  return CATEGORY_ORDER.includes(lc) ? lc : 'other';
}

function sumNet(rows: BillingChargeRow[]): number {
  return rows.reduce((acc, r) => acc + (Number(r.net_amount) || 0), 0);
}

function ChargeGroup({
  category, rows,
}: { category: string; rows: BillingChargeRow[] }) {
  if (rows.length === 0) return null;
  const subtotal = sumNet(rows);
  return (
    <View wrap={false} style={{ marginBottom: 8 }}>
      <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 3 }}>
        {CATEGORY_LABELS[category] ?? category}  ({rows.length} line{rows.length === 1 ? '' : 's'} · subtotal {inr(subtotal)})
      </Text>
      <View style={styles.tableHead}>
        <Text style={{ flex: 2 }}>Charge</Text>
        <Text style={{ width: 64 }}>Code</Text>
        <Text style={{ width: 36, textAlign: 'right' }}>Qty</Text>
        <Text style={{ width: 70, textAlign: 'right' }}>Unit ₹</Text>
        <Text style={{ width: 74, textAlign: 'right' }}>Net ₹</Text>
        <Text style={{ width: 70 }}>Date</Text>
      </View>
      {rows.map((c) => (
        <View key={c.id} style={styles.tableRow} wrap={false}>
          <Text style={{ flex: 2, color: palette.ink }}>{c.charge_name}</Text>
          <Text style={{ width: 64, color: palette.inkSoft }}>{c.charge_code ?? '—'}</Text>
          <Text style={{ width: 36, textAlign: 'right', color: palette.inkSoft }}>{c.quantity ?? 1}</Text>
          <Text style={{ width: 70, textAlign: 'right', color: palette.inkSoft }}>{inr(c.unit_price)}</Text>
          <Text style={{ width: 74, textAlign: 'right', color: palette.ink, fontWeight: 700 }}>{inr(c.net_amount)}</Text>
          <Text style={{ width: 70, color: palette.inkSoft }}>{formatDay(c.service_date)}</Text>
        </View>
      ))}
    </View>
  );
}

function DepositRow({ d }: { d: BillingDepositRow }) {
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ flex: 1.6, color: palette.ink }}>
        {d.receipt_number ?? '—'}
        {d.reference_number ? ` · ${d.reference_number}` : ''}
      </Text>
      <Text style={{ width: 72, color: palette.inkSoft }}>{d.payment_method}</Text>
      <Text style={{ width: 78, textAlign: 'right', color: palette.ink, fontWeight: 700 }}>{inr(d.amount)}</Text>
      <Text style={{ width: 64, color: depositStatusColor(d.status), fontWeight: 700 }}>
        {d.status.toUpperCase()}
      </Text>
      <Text style={{ width: 108, color: palette.inkSoft }}>{formatTs(d.collected_at).replace(' IST', '')}</Text>
    </View>
  );
}

function ClaimBlock({ c }: { c: BillingClaimRow }) {
  return (
    <View wrap={false} style={{
      borderWidth: 0.5,
      borderColor: palette.lineSoft,
      padding: 6,
      marginBottom: 6,
    }}>
      <View style={{ flexDirection: 'row', marginBottom: 3 }}>
        <Text style={{ flex: 1, color: palette.ink, fontWeight: 700 }}>
          {c.claim_number ?? '(draft)'}  ·  {c.insurer_name}
          {c.tpa ? ` · TPA: ${c.tpa}` : ''}
        </Text>
        <Text style={{ width: 96, color: claimStatusColor(c.status), fontWeight: 700, textAlign: 'right' }}>
          {c.status.replace(/_/g, ' ').toUpperCase()}
        </Text>
      </View>
      {c.tpa_claim_ref ? (
        <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 2 }}>TPA ref: {c.tpa_claim_ref}</Text>
      ) : null}
      {c.primary_diagnosis ? (
        <Text style={{ ...styles.subtle, color: palette.inkSoft, marginBottom: 2 }}>
          Dx: {c.primary_diagnosis}
          {c.icd_code ? ` (${c.icd_code})` : ''}
          {c.procedure_name ? ` · Proc: ${c.procedure_name}` : ''}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
        <Text style={{ width: '33%', color: palette.inkSoft }}>Bill total: <Text style={{ color: palette.ink }}>{inr(c.total_bill_amount)}</Text></Text>
        <Text style={{ width: '33%', color: palette.inkSoft }}>Pre-auth: <Text style={{ color: palette.ink }}>{inr(c.pre_auth_amount)}</Text></Text>
        <Text style={{ width: '34%', color: palette.inkSoft }}>Enhancement: <Text style={{ color: palette.ink }}>{inr(c.enhancement_total)}</Text></Text>
        <Text style={{ width: '33%', color: palette.inkSoft }}>Approved: <Text style={{ color: palette.accent, fontWeight: 700 }}>{inr(c.approved_amount)}</Text></Text>
        <Text style={{ width: '33%', color: palette.inkSoft }}>Deductions: <Text style={{ color: palette.warn }}>{inr(c.total_deductions)}</Text></Text>
        <Text style={{ width: '34%', color: palette.inkSoft }}>Settled: <Text style={{ color: palette.ink, fontWeight: 700 }}>{inr(c.settled_amount)}</Text></Text>
        <Text style={{ width: '100%', color: palette.inkSoft, marginTop: 1 }}>
          Patient liability: <Text style={{ color: palette.ink, fontWeight: 700 }}>{inr(c.patient_liability)}</Text>
          {c.admission_date ? `  ·  Admission: ${formatDay(c.admission_date)}` : ''}
          {c.discharge_date ? `  ·  Discharge: ${formatDay(c.discharge_date)}` : ''}
          {c.settled_at ? `  ·  Settled: ${formatDay(c.settled_at)}` : ''}
        </Text>
      </View>
    </View>
  );
}

function InvoiceRow({ i }: { i: BillingInvoiceRow }) {
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ flex: 1.4, color: palette.ink }}>{i.invoice_number}</Text>
      <Text style={{ width: 86, color: palette.inkSoft }}>{i.invoice_status.toUpperCase()}</Text>
      <Text style={{ width: 80, textAlign: 'right', color: palette.ink, fontWeight: 700 }}>{inr(i.grand_total)}</Text>
      <Text style={{ width: 80, textAlign: 'right', color: palette.accent }}>{inr(i.amount_paid)}</Text>
      <Text style={{
        width: 80, textAlign: 'right',
        color: Number(i.balance_due) > 0 ? palette.danger : palette.inkSoft,
        fontWeight: Number(i.balance_due) > 0 ? 700 : 400,
      }}>
        {inr(i.balance_due)}
      </Text>
      <Text style={{ width: 70, color: palette.inkSoft }}>{formatDay(i.generated_at)}</Text>
    </View>
  );
}

function RefundRow({ r }: { r: BillingRefundRow }) {
  return (
    <View style={styles.tableRow} wrap={false}>
      <Text style={{ flex: 1.2, color: palette.ink }}>{r.refund_number ?? '(pending)'}</Text>
      <Text style={{ flex: 1.1, color: palette.inkSoft }}>{r.reason.replace(/_/g, ' ')}</Text>
      <Text style={{ width: 80, color: refundStatusColor(r.status), fontWeight: 700 }}>
        {r.status.replace(/_/g, ' ').toUpperCase()}
      </Text>
      <Text style={{ width: 78, textAlign: 'right', color: palette.ink, fontWeight: 700 }}>{inr(r.amount)}</Text>
      <Text style={{ width: 78, textAlign: 'right', color: palette.accent }}>{inr(r.approved_amount)}</Text>
      <Text style={{ width: 100, color: palette.inkSoft }}>{formatTs(r.processed_at ?? r.created_at).replace(' IST', '')}</Text>
    </View>
  );
}

export function BillingTemplate({ bundle, chrome }: BillingProps) {
  const { billing } = bundle;
  const account = billing?.account ?? null;

  // Group charges by category, preserving canonical order.
  const byCategory: Record<string, BillingChargeRow[]> = {};
  for (const c of CATEGORY_ORDER) byCategory[c] = [];
  for (const row of billing?.charges ?? []) {
    const key = categoryKey(row.category);
    byCategory[key].push(row);
  }
  const totalCharges = sumNet(billing?.charges ?? []);
  const claimCount = billing?.claims.length ?? 0;
  const openBalance = account ? Number(account.balance_due) : null;

  return (
    <ChartPrintPage {...chrome}>
      {/* ── Account summary ────────────────────────────────────────────── */}
      <SectionCard
        title="Account summary"
        empty="No billing account has been opened for this patient."
      >
        {account ? (
          <View>
            <KV k="Account type" v={account.account_type.replace(/_/g, ' ')} />
            <KV k="Insurer" v={account.insurer_name ?? '—'} />
            <KV k="TPA" v={account.tpa_name ?? '—'} />
            <KV k="Policy #" v={account.policy_number ?? '—'} />
            <KV k="Member ID" v={account.member_id ?? '—'} />
            <KV k="Sum insured" v={inr(account.sum_insured)} />
            <KV k="Total charges" v={inr(account.total_charges)} />
            <KV k="Total deposits" v={inr(account.total_deposits)} />
            <KV k="Total payments" v={inr(account.total_payments)} />
            <KV k="Total approved" v={inr(account.total_approved)} />
            <View style={{
              ...styles.kvRow,
              marginTop: 4,
              borderTopWidth: 0.5,
              borderTopColor: palette.line,
              paddingTop: 3,
            }}>
              <Text style={{ ...styles.kvKey, color: palette.ink, fontWeight: 700 }}>Balance due</Text>
              <Text style={{
                ...styles.kvVal,
                color: openBalance != null && openBalance > 0 ? palette.danger : palette.accent,
                fontWeight: 700,
              }}>
                {inr(account.balance_due)}
              </Text>
            </View>
          </View>
        ) : undefined}
      </SectionCard>

      {/* ── Charges by category ────────────────────────────────────────── */}
      <SectionCard
        title={`Charges — ${(billing?.charges.length ?? 0)} line${(billing?.charges.length ?? 0) === 1 ? '' : 's'} · total ${inr(totalCharges)}`}
        empty="No charges posted on this encounter."
        wrap={true}
      >
        {(billing?.charges.length ?? 0) > 0 ? (
          <View>
            {CATEGORY_ORDER.map((c) => (
              <ChargeGroup key={c} category={c} rows={byCategory[c]} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      {/* ── Deposits ───────────────────────────────────────────────────── */}
      <SectionCard
        title={`Deposits — ${(billing?.deposits.length ?? 0)} row${(billing?.deposits.length ?? 0) === 1 ? '' : 's'}`}
        empty="No deposits recorded."
        wrap={true}
      >
        {(billing?.deposits.length ?? 0) > 0 ? (
          <View>
            <View style={styles.tableHead}>
              <Text style={{ flex: 1.6 }}>Receipt · Ref</Text>
              <Text style={{ width: 72 }}>Method</Text>
              <Text style={{ width: 78, textAlign: 'right' }}>Amount</Text>
              <Text style={{ width: 64 }}>Status</Text>
              <Text style={{ width: 108 }}>Collected</Text>
            </View>
            {(billing!.deposits).map((d) => (
              <DepositRow key={d.id} d={d} />
            ))}
          </View>
        ) : undefined}
      </SectionCard>

      {/* ── Insurance claims ───────────────────────────────────────────── */}
      <SectionCard
        title={`Insurance claims — ${claimCount}`}
        empty="No insurance claim raised on this encounter."
        wrap={true}
      >
        {claimCount > 0 ? (
          <View>
            {(billing!.claims).map((c) => <ClaimBlock key={c.id} c={c} />)}
          </View>
        ) : undefined}
      </SectionCard>

      {/* ── Invoices ───────────────────────────────────────────────────── */}
      <SectionCard
        title={`Invoices — ${(billing?.invoices.length ?? 0)}`}
        empty="No invoices generated."
        wrap={true}
      >
        {(billing?.invoices.length ?? 0) > 0 ? (
          <View>
            <View style={styles.tableHead}>
              <Text style={{ flex: 1.4 }}>Invoice #</Text>
              <Text style={{ width: 86 }}>Status</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>Total</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>Paid</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>Due</Text>
              <Text style={{ width: 70 }}>Generated</Text>
            </View>
            {(billing!.invoices).map((i) => <InvoiceRow key={i.id} i={i} />)}
          </View>
        ) : undefined}
      </SectionCard>

      {/* ── Refunds ────────────────────────────────────────────────────── */}
      <SectionCard
        title={`Refunds — ${(billing?.refunds.length ?? 0)}`}
        empty="No refund requests raised."
        wrap={true}
      >
        {(billing?.refunds.length ?? 0) > 0 ? (
          <View>
            <View style={styles.tableHead}>
              <Text style={{ flex: 1.2 }}>Refund #</Text>
              <Text style={{ flex: 1.1 }}>Reason</Text>
              <Text style={{ width: 80 }}>Status</Text>
              <Text style={{ width: 78, textAlign: 'right' }}>Requested</Text>
              <Text style={{ width: 78, textAlign: 'right' }}>Approved</Text>
              <Text style={{ width: 100 }}>Processed</Text>
            </View>
            {(billing!.refunds).map((r) => <RefundRow key={r.id} r={r} />)}
          </View>
        ) : undefined}
      </SectionCard>

      <View style={{ marginTop: 10 }}>
        <Text style={styles.subtle}>
          Sources: billing_accounts · encounter_charges · deposits · insurance_claims ·
          invoices · refund_requests. Amounts in ₹ (INR). Balance due = charges − approved
          insurance amount − patient payments. Claim deductions include co-pay,
          room-rent differential, and TPA-flagged non-payable items.
        </Text>
      </View>
    </ChartPrintPage>
  );
}
