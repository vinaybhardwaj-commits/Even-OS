'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadCodeRow } from '../_components/BadCodeRow';

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

export default function CodesReviewClient() {
  const [groups, setGroups] = useState<Array<{ reason: string; count: number }>>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('codes.badCodes.list', { reason: filter ?? undefined, status: 'open' });
      setGroups(data.groups);
      setRows(data.rows);
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const total = groups.reduce((a, g) => a + g.count, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> › Review queue
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Bad codes review</h1>
        <p className="mt-1 text-sm text-slate-600">
          {total} open · legacy rows that broke validation on import. Resolve by editing the original data or marking <code>ignored</code>.
        </p>
      </div>

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

      {err ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
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
    </div>
  );
}
