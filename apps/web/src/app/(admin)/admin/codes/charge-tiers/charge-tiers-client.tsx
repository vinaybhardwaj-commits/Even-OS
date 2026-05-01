'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Props { userId: string; userRole: string; hospitalId: string; }

const CLASS_ORDER = ['OPD','GENERAL','SEMI_PVT','PVT','SUITE','ICU','HDU','ER','_PACKAGE','_ANY'];

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function ChargeTiersClient({ hospitalId }: Props) {
  const [tiers, setTiers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [empanelments, setEmpanelments] = useState<any[]>([]);
  const [tab, setTab] = useState<'tiers' | 'rules' | 'empanelments'>('tiers');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tList, sList, rList, eList] = await Promise.all([
        trpcQuery('codes.chargeTiers.list', { limit: 500, include_history: false }),
        trpcQuery('codes.services.list', { limit: 500, status: ['active'] }),
        trpcQuery('codes.rules.list'),
        trpcQuery('codes.empanelments.list'),
      ]);
      setTiers(tList);
      setServices(sList);
      setRules(rList);
      setEmpanelments(eList);
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group tiers by service_id; format as a grid (service × class)
  const tiersByService = new Map<string, Map<string, any>>();
  for (const t of tiers) {
    const sid = t.service_id ?? t.item_id;
    if (!sid) continue;
    if (!tiersByService.has(sid)) tiersByService.set(sid, new Map());
    tiersByService.get(sid)!.set(t.class_code, t);
  }
  const servicesById = new Map(services.map((s: any) => [s.id, s]));

  // Render up to 200 services with at least one tier
  const renderable = [...tiersByService.entries()]
    .filter(([sid]) => servicesById.has(sid))
    .slice(0, 200);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> › Charge Tiers
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Charge tiers</h1>
        <p className="mt-1 text-sm text-slate-600">
          Unified per-class pricing · {tiers.length} tier rows · {empanelments.length} empanelments · {rules.length} Billing Manual rules
        </p>
      </div>

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          <button onClick={() => setTab('tiers')} className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === 'tiers' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Price tiers <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{tiers.length}</span>
          </button>
          <button onClick={() => setTab('rules')} className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === 'rules' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Billing rules <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{rules.length}</span>
          </button>
          <button onClick={() => setTab('empanelments')} className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === 'empanelments' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Empanelments <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{empanelments.length}</span>
          </button>
        </nav>
      </div>

      {err && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      {loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
        : tab === 'tiers' ? (
          renderable.length === 0
            ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No price tiers yet.</div>
            : <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Service code</th>
                      <th className="px-3 py-2 text-left">Service name</th>
                      {CLASS_ORDER.map(c => <th key={c} className="px-2 py-2 text-right">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {renderable.map(([sid, tierMap]) => {
                      const svc = servicesById.get(sid);
                      return (
                        <tr key={sid} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-xs">{svc?.service_code ?? '—'}</td>
                          <td className="px-3 py-2">{svc?.service_name ?? '—'}</td>
                          {CLASS_ORDER.map(c => {
                            const t = tierMap.get(c);
                            return <td key={c} className="px-2 py-2 text-right text-xs tabular-nums">
                              {t ? `₹${parseFloat(t.price_inr).toFixed(0)}` : <span className="text-slate-300">—</span>}
                            </td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Showing {renderable.length} services with active tiers (cap 200). Phase 4.B adds filter + edit.
                </div>
              </div>
        )
        : tab === 'rules' ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Rule</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Applies to</th>
                  <th className="px-3 py-2 text-left">Priority</th>
                  <th className="px-3 py-2 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">{r.rule_name}</td>
                    <td className="px-3 py-2 text-xs">{r.rule_type}</td>
                    <td className="px-3 py-2 text-xs">{r.applies_to_code_kind}</td>
                    <td className="px-3 py-2 text-xs">{r.priority}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {rules.length} rules — read-only. Eval engine ships with BV3 Phase 4 bill builder.
            </div>
          </div>
        )
        : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            {empanelments.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">No empanelments yet. Use API <code className="font-mono">codes.empanelments.create</code> to add corporate / TPA agreements.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Agreement #</th>
                    <th className="px-3 py-2 text-left">Effective from</th>
                  </tr>
                </thead>
                <tbody>
                  {empanelments.map((e: any) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{e.empanelment_name}</td>
                      <td className="px-3 py-2 text-xs">{e.empanelment_type}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.agreement_number ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{e.effective_from?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      }
    </div>
  );
}
