'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreateItemForm } from './_components/CreateItemForm';
import { SearchBar } from './_components/SearchBar';
import type { Lookups } from './_components/lookups-types';

interface User { sub: string; hospital_id: string; role: string; email: string; name: string; }

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function CodesHomeClient({ user }: { user: User }) {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLookups(await trpcQuery('codes.lookups.list', undefined));
      } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin" className="text-blue-600 hover:underline">Admin</Link> ›{' '}
        <span>Codes</span>
      </div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Codes — New Item</h1>
          <p className="mt-1 text-sm text-slate-600">Generate a SOP-compliant Item Code. Fields with <span className="font-medium">*</span> are required.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href="/admin/codes/review" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50">Review queue</Link>
          <Link href="/admin/codes/settings" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50">Settings</Link>
        </div>
      </div>

      <div className="mb-6"><SearchBar /></div>

      {err ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
      {loading || !lookups ? (
        <div className="py-12 text-center text-slate-500">Loading lookups…</div>
      ) : (
        <CreateItemForm lookups={lookups} />
      )}
    </div>
  );
}
