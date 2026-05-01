'use client';

import { useCallback, useEffect, useState } from 'react';

interface User {
  sub: string;
  role: string;
  hospital_id: string;
  name?: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}
async function trpcMutation(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input ?? {} }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function PharmacyCodeApprovalsClient({ user }: { user: User }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stage, roles] = await Promise.all([
        trpcQuery('codes.approvals.listForStage', { stage: 'pending_clinical_review' }),
        trpcQuery('codes.approvals.listMyRoles'),
      ]);
      // Filter to drug kinds — Pharmacy Supervisor's domain
      const drugRows = (stage.items ?? []).filter((r: any) => r.code_kind === 'drug');
      setItems(drugRows);
      setMyRoles(roles.roles ?? []);
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onApprove = useCallback(async (id: string) => {
    setActing(id);
    try {
      await trpcMutation('codes.approvals.clinicalApprove', { item_id: id });
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActing(null); }
  }, [load]);

  const onReject = useCallback(async (id: string) => {
    const note = window.prompt('Rejection reason (required)?');
    if (!note || !note.trim()) return;
    setActing(id);
    try {
      await trpcMutation('codes.approvals.reject', { item_id: id, feedback_note: note });
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActing(null); }
  }, [load]);

  const isSupervisor = myRoles.includes('pharmacy_supervisor') || ['super_admin', 'hospital_admin'].includes(user.role);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Drug code approvals</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pharmacy Supervisor queue · Stage 1 of the SOP §5.6 approval flow.
          Approve clinically-reviewed drug codes and they advance to Master Data Officer for final activation.
        </p>
      </div>

      {!isSupervisor && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You don't currently hold the <code>pharmacy_supervisor</code> codes role. Contact your hospital admin to assign it via <code>/admin/codes/roles</code>.
        </div>
      )}

      {err && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      {loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
        : items.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No drug codes pending clinical review.</div>
        : <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Drug name</th>
                  <th className="px-3 py-2 text-left">Brand / Manufacturer</th>
                  <th className="px-3 py-2 text-left">SLA</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r: any) => {
                  const sla = r.sla;
                  const slaColor = !sla ? 'text-slate-400' : sla.severity === 'overdue' ? 'text-red-700' : sla.severity === 'red' ? 'text-red-700' : sla.severity === 'amber' ? 'text-amber-700' : 'text-emerald-700';
                  return (
                    <tr key={r.item.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.item.item_code}</td>
                      <td className="px-3 py-2">{r.item.item_display_name}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{r.item.brand ?? '—'} / {r.item.manufacturer ?? '—'}</td>
                      <td className={`px-3 py-2 text-xs ${slaColor}`}>
                        {sla ? `${Math.round(sla.remaining_pct)}% remaining` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          disabled={acting === r.item.id || !isSupervisor}
                          onClick={() => onApprove(r.item.id)}
                          className="mr-2 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve → MDO
                        </button>
                        <button
                          disabled={acting === r.item.id || !isSupervisor}
                          onClick={() => onReject(r.item.id)}
                          className="rounded border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </td>
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
