'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Props { userId: string; userRole: string; hospitalId: string; }

const STATE_LABELS: Record<string, { label: string; tone: string }> = {
  draft:          { label: 'Draft',          tone: 'bg-slate-100 text-slate-700' },
  pending_review: { label: 'Pending review', tone: 'bg-amber-100 text-amber-700' },
  finalized:      { label: 'Finalized',      tone: 'bg-blue-100 text-blue-700' },
  settled:        { label: 'Settled',        tone: 'bg-emerald-100 text-emerald-700' },
  closed:         { label: 'Closed',         tone: 'bg-slate-200 text-slate-700' },
  archived:       { label: 'Archived',       tone: 'bg-slate-300 text-slate-600' },
};

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function BillsClient({ userId, userRole, hospitalId }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [stateFilter, setStateFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await trpcQuery('billingV3.bills.list', stateFilter ? { state: stateFilter, limit: 200 } : { limit: 200 });
      setItems(r.bills);
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [stateFilter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/billing" className="text-blue-600 hover:underline">Billing</Link> › Bills (BV3)
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Bills (BV3)</h1>
        <p className="mt-1 text-sm text-slate-600">
          Bill builder · 6-state machine · {items.length} listed{stateFilter ? ` · state=${stateFilter}` : ''}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          <option value="">All states</option>
          <option value="draft">Draft</option>
          <option value="pending_review">Pending review</option>
          <option value="finalized">Finalized</option>
          <option value="settled">Settled</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {err && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}
      {loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
        : items.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No bills yet. Build one via billingV3.bills.build(encounter_id).</div>
        : <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Bill #</th>
                  <th className="px-3 py-2 text-left">State</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                  <th className="px-3 py-2 text-right">GST</th>
                  <th className="px-3 py-2 text-right">Concession</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const lbl = STATE_LABELS[b.state] ?? { label: b.state, tone: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/admin/billing/bills/${b.id}`} className="text-blue-600 hover:underline">
                          {b.bill_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${lbl.tone}`}>{lbl.label}</span>
                        {b.amended && <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">amended</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">₹{parseFloat(b.subtotal_inr).toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">₹{parseFloat(b.gst_amount_inr).toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{parseFloat(b.concession_amount_inr) > 0 ? `-₹${parseFloat(b.concession_amount_inr).toFixed(0)}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">₹{parseFloat(b.total_amount_inr).toFixed(0)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{b.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}
