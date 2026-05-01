'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadCodeRow } from '../_components/BadCodeRow';

type Tab = 'bad_codes' | 'approval_queue';

const REASON_LABELS: Record<string, string> = {
  unknown_classification: 'Unknown classification code',
  malformed_code: 'Malformed Item Code (regex failed)',
  hsn_in_code_column: 'HSN number in Item Code column',
  duplicate_display_name: 'Display Name duplicate (case-insensitive)',
  duplicate_code: 'Item Code duplicate within source',
  extra_segments: 'Too many dash-separated segments',
  unknown_storage: 'Unknown storage code',
  unknown_category: 'Unknown category code',
};

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
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

export default function CodesReviewClient() {
  const [tab, setTab] = useState<Tab>('approval_queue');
  const [groups, setGroups] = useState<Array<{ reason: string; count: number }>>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [approvalRows, setApprovalRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actingItemId, setActingItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'bad_codes') {
        const data = await trpcQuery('codes.badCodes.list', { reason: filter ?? undefined, status: 'open' });
        setGroups(data.groups);
        setRows(data.rows);
      } else {
        const data = await trpcQuery('codes.approvals.listForStage', {});
        setApprovalRows(data.items ?? []);
      }
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [filter, tab]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = useCallback(async (itemId: string, currentState: string) => {
    setActingItemId(itemId);
    try {
      const action =
        currentState === 'pending_clinical_review' ? 'codes.approvals.clinicalApprove'
        : currentState === 'pending_master_data_review' ? 'codes.approvals.mdoApprove'
        : currentState === 'pending_cms_gm_review' ? 'codes.approvals.cmsGmApprove'
        : null;
      if (!action) throw new Error(`Unknown current state: ${currentState}`);
      await trpcMutation(action, { item_id: itemId });
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActingItemId(null); }
  }, [load]);

  const handleReject = useCallback(async (itemId: string) => {
    const note = window.prompt('Rejection reason (required)?');
    if (!note || !note.trim()) return;
    setActingItemId(itemId);
    try {
      await trpcMutation('codes.approvals.reject', { item_id: itemId, feedback_note: note });
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActingItemId(null); }
  }, [load]);

  const total = groups.reduce((a, g) => a + g.count, 0);
  const approvalTotal = approvalRows.length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> › Review queue
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Codes review</h1>
        <p className="mt-1 text-sm text-slate-600">
          Master Data Officer surface — approve/reject codes pending review · resolve bad-code import flags.
        </p>
      </div>

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setTab('approval_queue')}
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === 'approval_queue' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Approval queue <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{approvalTotal}</span>
          </button>
          <button
            onClick={() => setTab('bad_codes')}
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === 'bad_codes' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Bad codes <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{total}</span>
          </button>
        </nav>
      </div>

      {err ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}

      {tab === 'approval_queue' ? (
        loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
        : approvalRows.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No items pending approval.</div>
        : <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Display name</th>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-3 py-2 text-left">Stage</th>
                  <th className="px-3 py-2 text-left">SLA</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {approvalRows.map((r: any) => {
                  const sla = r.sla;
                  const slaColor = !sla ? 'text-slate-400' : sla.severity === 'overdue' ? 'text-red-700' : sla.severity === 'red' ? 'text-red-700' : sla.severity === 'amber' ? 'text-amber-700' : 'text-emerald-700';
                  const stage = r.item.status as string;
                  return (
                    <tr key={r.item.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.item.item_code}</td>
                      <td className="px-3 py-2">{r.item.item_display_name}</td>
                      <td className="px-3 py-2 text-xs uppercase tracking-wide text-slate-600">{r.code_kind}</td>
                      <td className="px-3 py-2 text-xs">{stage.replace(/^pending_/, '').replace(/_/g, ' ')}</td>
                      <td className={`px-3 py-2 text-xs ${slaColor}`}>
                        {sla ? `${Math.round(sla.remaining_pct)}% remaining` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          disabled={actingItemId === r.item.id}
                          onClick={() => handleApprove(r.item.id, stage)}
                          className="mr-2 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={actingItemId === r.item.id}
                          onClick={() => handleReject(r.item.id)}
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
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2 text-xs">
            <button onClick={() => setFilter(null)} className={`rounded-full border px-3 py-1 ${filter === null ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
              All <span className="ml-1 font-mono opacity-70">{total}</span>
            </button>
            {groups.map(g => (
              <button key={g.reason} onClick={() => setFilter(g.reason)} className={`rounded-full border px-3 py-1 ${filter === g.reason ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                {REASON_LABELS[g.reason] || g.reason}
                <span className="ml-1 font-mono opacity-70">{g.count}</span>
              </button>
            ))}
          </div>
          {loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
            : rows.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No open bad-code rows{filter ? ` for ${REASON_LABELS[filter] || filter}` : ''}.</div>
            : <div className="space-y-3">{rows.map(r => (
                <BadCodeRow
                  key={r.id}
                  reason={r.flag_reason}
                  reasonLabel={REASON_LABELS[r.flag_reason] || r.flag_reason}
                  originalCode={r.original_item_code}
                  detail={r.flag_detail}
                  importedAt={r.imported_at}
                  sourceRow={r.original_row_data}
                />
              ))}</div>
          }
        </>
      )}
    </div>
  );
}
