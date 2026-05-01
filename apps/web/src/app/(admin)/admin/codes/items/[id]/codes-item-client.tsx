'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ItemCopyActions } from '../../_components/ItemCopyActions';

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function CodesItemClient({ itemId }: { itemId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await trpcQuery('codes.items.detail', itemId));
      } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
    })();
  }, [itemId]);

  if (loading) return <div className="mx-auto max-w-3xl px-6 py-8"><p className="text-slate-500">Loading…</p></div>;
  if (err || !data) return <div className="mx-auto max-w-3xl px-6 py-8"><p className="text-red-700">{err || 'Not found'}</p></div>;

  const { item, compositions } = data;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> ›{' '}
        <span className="font-mono">{item.item_code}</span>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-slate-900">{item.item_code}</h1>
          <p className="mt-1 break-words text-base text-slate-700">{item.item_display_name}</p>
          <p className="mt-1 text-xs text-slate-500">
            <span className="font-mono">{item.category_code}-{item.storage_code}-{item.classification_code}</span> · serial {item.serial} · source {item.source}
          </p>
        </div>
        <ItemCopyActions item={item} />
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <Field label="Item type">{item.item_type}</Field>
        <Field label="Form">{item.form || '—'}</Field>
        <Field label="Brand">{item.brand || '—'}</Field>
        <Field label="Pack size">{item.pack_size || '—'}</Field>
        <Field label="Manufacturer">{item.manufacturer || '—'}</Field>
        <Field label="HSN">{item.hsn_code || '—'}</Field>
        <Field label="Tax">{item.tax_detail || '—'}</Field>
        <Field label="Price type">{item.price_type || '—'}</Field>
        <Field label="Issue unit">{item.issue_unit || '—'}</Field>
        <Field label="Generic chain"><code className="text-xs">{item.generic_name_chain || '—'}</code></Field>
        <Field label="Strength chain"><code className="text-xs">{item.strength_chain || '—'}</code></Field>
        <Field label="Created">{new Date(item.created_at).toLocaleString('en-IN')}</Field>
      </dl>

      {compositions?.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-base font-semibold text-slate-900">Compositions</h2>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Generic</th><th className="p-2 text-right">Strength</th><th className="p-2">Unit</th></tr>
            </thead>
            <tbody>
              {compositions.map((c: any) => (
                <tr key={c.id} className="border-t border-slate-200">
                  <td className="p-2">{c.position}</td>
                  <td className="p-2 font-mono">{c.generic_name}</td>
                  <td className="p-2 text-right">{c.strength_value}</td>
                  <td className="p-2 text-center">{c.strength_unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}
