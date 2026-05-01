'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function CodesBucketClient({ bucket }: { bucket: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [peek, setPeek] = useState<{ next_serial: number; first_use: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [list, peekData] = await Promise.all([
          trpcQuery('codes.items.list', { bucket, limit: 200 }),
          trpcQuery('codes.buckets.peek', bucket),
        ]);
        setItems(Array.isArray(list) ? list : []);
        setPeek(peekData);
      } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
    })();
  }, [bucket]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> › Buckets › <code>{bucket}</code>
      </div>
      <div className="mb-6">
        <h1 className="font-mono text-2xl font-semibold text-slate-900">{bucket}</h1>
        {peek ? (
          <p className="mt-1 text-sm text-slate-600">
            Next serial: <code className="font-mono font-semibold">{String(peek.next_serial).padStart(5, '0')}</code>
            {peek.first_use ? <span className="ml-2 text-amber-700">· first use of bucket</span> : null}
            {' · '}{items.length} item{items.length === 1 ? '' : 's'} listed
          </p>
        ) : null}
      </div>

      {err ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
      {loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
        : items.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No items in this bucket yet.</div>
        : (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="p-2 text-left">Code</th><th className="p-2 text-left">Display name</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Brand</th><th className="p-2 text-left">Source</th></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="p-2"><Link href={`/admin/codes/items/${it.id}`} className="font-mono text-blue-600 hover:underline">{it.item_code}</Link></td>
                  <td className="p-2">{it.item_display_name}</td>
                  <td className="p-2 text-slate-600">{it.item_type}</td>
                  <td className="p-2 text-slate-600">{it.brand || '—'}</td>
                  <td className="p-2 text-xs text-slate-500">{it.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}
