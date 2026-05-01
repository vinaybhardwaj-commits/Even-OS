'use client';

import { useState, useMemo } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { trpc } from '@/lib/trpc-client';

interface Crumb { label: string; href?: string }

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  hospitalId: string;
  breadcrumbs: Crumb[];
}

const TABLE_LABELS: Record<string, string> = {
  charge_master_item: 'Charge Master · Items',
  charge_master_price: 'Charge Master · Prices',
  charge_master_package: 'Charge Master · Packages',
  charge_master_room: 'Charge Master · Rooms',
  charge_master_tariff_import: 'Tariff Import audit log',
  charge_master_hospital_setting: 'Hospital business-rule settings',
  discount_policy: 'Discount Policies',
  discount_application: 'Discount Applications',
  billing_charge: 'Billing Charges (event log)',
  billing_account_payer: 'Account Payers (multi-payer split)',
};

// =============================================================================
// /admin/billing/v3-bootstrap
// =============================================================================
// Phase-1 verification + re-run surface for the BV3.1 foundation migration +
// EHRC bootstrap seed. Read-mostly: the migration runner is the existing
// /api/migrations/billing-v3-foundation route. This page just shows state +
// fires the endpoints if a re-run is needed (both are idempotent).
//
// Out of scope: tariff PDF import (BV3.2), bill builder UI (Phase 4),
// pre-auth / claim / refund (Phases 5-6).
// =============================================================================
export default function V3BootstrapClient({
  userId, userRole, userName, hospitalId, breadcrumbs,
}: Props) {
  const status = trpc.billingV3.bootstrap.status.useQuery();
  const [running, setRunning] = useState<null | 'migration' | 'seed'>(null);
  const [output, setOutput] = useState<string>('');

  const refetch = status.refetch;

  async function runEndpoint(kind: 'migration' | 'seed') {
    setRunning(kind);
    setOutput('Running ' + kind + ' endpoint...\n');
    try {
      const path = kind === 'migration'
        ? '/api/migrations/billing-v3-foundation'
        : '/api/migrations/billing-v3-ehrc-seed';
      const resp = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Endpoints accept the legacy admin-key for now (idempotent);
          // a follow-up PR will wire them through super_admin session cookie.
          'x-admin-key': 'helloeven1981!',
        },
      });
      const text = await resp.text();
      setOutput('HTTP ' + resp.status + '\n\n' + text);
      await refetch();
    } catch (err: any) {
      setOutput('Error: ' + (err?.message || String(err)));
    } finally {
      setRunning(null);
    }
  }

  const data = status.data;
  const allPresent = useMemo(() => data ? data.tables_missing.length === 0 : false, [data]);
  const totalRows = useMemo(() => {
    if (!data) return 0;
    return Object.values(data.counts).reduce(
      (acc: number, n: any) => acc + (typeof n === 'number' && n > 0 ? n : 0),
      0,
    );
  }, [data]);

  return (
    <AdminShell
      breadcrumbs={breadcrumbs}
      userId={userId}
      userRole={userRole}
      userName={userName}
      hospitalId={hospitalId}
    >
      <div className="px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Billing v3 — Phase 1 Bootstrap</h1>
          <p className="mt-1 text-sm text-slate-600">
            Foundation schema (10 tables) + EHRC bootstrap seed verification. Both
            underlying API endpoints are idempotent — re-running them is safe.
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiTile
            label="Schema state"
            value={status.isLoading ? '…' : (allPresent ? 'All 10 tables present' : `${data?.tables_missing.length ?? '?'} missing`)}
            tone={allPresent ? 'green' : 'red'}
          />
          <KpiTile
            label="Self-FK + check constraints"
            value={status.isLoading ? '…' : (data?.self_fk_present ? 'OK' : 'MISSING')}
            tone={data?.self_fk_present ? 'green' : 'red'}
          />
          <KpiTile
            label="Partial indexes"
            value={status.isLoading ? '…' : `${data?.partial_indexes.length ?? 0} present`}
            tone={(data?.partial_indexes.length ?? 0) >= 3 ? 'green' : 'amber'}
          />
          <KpiTile
            label="Total rows (this hospital)"
            value={status.isLoading ? '…' : String(totalRows)}
            tone="slate"
          />
        </div>

        {/* Action buttons */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Re-run endpoints</h2>
          <p className="mt-1 text-xs text-slate-600">
            Both routes use IF NOT EXISTS / ON CONFLICT DO NOTHING and write zero
            rows on a no-op pass. Output appears below.
          </p>
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => runEndpoint('migration')}
              disabled={running !== null}
              className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running === 'migration' ? 'Running migration…' : 'Re-run migration'}
            </button>
            <button
              type="button"
              onClick={() => runEndpoint('seed')}
              disabled={running !== null}
              className="px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running === 'seed' ? 'Running seed…' : 'Re-run EHRC bootstrap seed'}
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={status.isFetching}
              className="px-3 py-1.5 text-sm font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              {status.isFetching ? 'Refreshing…' : 'Refresh status'}
            </button>
          </div>
          {output && (
            <pre className="mt-3 text-xs bg-slate-900 text-slate-100 p-3 rounded overflow-x-auto max-h-72">
{output}
            </pre>
          )}
        </div>

        {/* Per-table presence + counts */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Per-table state (scoped to {hospitalId})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Table</th>
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-right">Rows ({hospitalId})</th>
                <th className="px-4 py-2 text-left">Present</th>
              </tr>
            </thead>
            <tbody>
              {data && Object.entries(data.counts).map(([t, count]) => (
                <tr key={t} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{t}</td>
                  <td className="px-4 py-2 text-slate-600">{TABLE_LABELS[t] ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {count === -1 ? '—' : count}
                  </td>
                  <td className="px-4 py-2">
                    {count === -1 ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">missing</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">present</span>
                    )}
                  </td>
                </tr>
              ))}
              {!data && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-400 italic">
                    {status.isLoading ? 'Loading…' : 'No data'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Partial indexes */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Partial indexes</h2>
          <p className="mt-1 text-xs text-slate-600">
            Hot-path indexes for current price lookup, collection-fee triggers, and source-ref filtering.
          </p>
          <ul className="mt-2 text-xs font-mono text-slate-700 space-y-0.5">
            {data?.partial_indexes.map((i) => (
              <li key={i}>• {i}</li>
            ))}
            {(!data || data.partial_indexes.length === 0) && (
              <li className="italic text-slate-400">none</li>
            )}
          </ul>
        </div>

        <p className="text-xs text-slate-500">
          Last refreshed: {data?.timestamp ?? '—'}
        </p>
      </div>
    </AdminShell>
  );
}

function KpiTile({
  label, value, tone,
}: { label: string; value: string; tone: 'green' | 'red' | 'amber' | 'slate' }) {
  const palette = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    slate: 'border-slate-200 bg-white text-slate-900',
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${palette}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
