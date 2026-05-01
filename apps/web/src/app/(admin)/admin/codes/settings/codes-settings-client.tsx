'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LookupSection } from '../_components/LookupSection';

const LOOKUP_KINDS_META = [
  { kind: 'categories',           label: 'Categories',           hasDescription: true,  codeHint: 'Single uppercase letter (e.g. M, E, G, L, A)' },
  { kind: 'storage_codes',        label: 'Storage codes',        hasDescription: true,  codeHint: 'Single uppercase letter (e.g. N, T, C, O)' },
  { kind: 'classification_codes', label: 'Classification codes', hasDescription: true,  codeHint: 'Two uppercase letters (e.g. PH, SG, IM, LC)' },
  { kind: 'item_types',           label: 'Item types',           hasDescription: false, codeHint: 'Short label (1-50 chars)' },
  { kind: 'forms',                label: 'Forms (dosage)',       hasDescription: false, codeHint: 'e.g. Tablet, Syrup, Lozenge' },
  { kind: 'strength_units',       label: 'Strength units',       hasDescription: false, codeHint: 'e.g. mg, ml, IU, mcg' },
  { kind: 'issue_units',          label: 'Issue units',          hasDescription: false, codeHint: 'e.g. NOS, Each, Strip, Bottle' },
] as const;

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function CodesSettingsClient() {
  const [allRows, setAllRows] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // codes.lookups.list returns active-only; need full settings view of inactive too.
        // For Phase 1 first cut, we use the active list. Phase 1.B can add a `codes.lookups.listAll`
        // procedure that includes is_active=false rows; for now, soft-deactivated rows just
        // don't render (matches behavior of the home form's dropdown).
        const data = await trpcQuery('codes.lookups.list', undefined);
        setAllRows(data);
      } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> › Settings
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings · Lookup tables</h1>
        <p className="mt-1 text-sm text-slate-600">
          Edit the controlled vocabularies that drive the Create form dropdowns. Adding a new row makes it available immediately. Codes are immutable once saved (FK-style referenced by every existing item) — deactivate instead of delete.
        </p>
      </div>

      <nav className="mb-6 flex flex-wrap gap-2 text-xs">
        {LOOKUP_KINDS_META.map(k => (
          <Link key={k.kind} href={`#${k.kind}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50">
            {k.label}
            <span className="ml-1 font-mono text-slate-400">{(allRows[k.kind] || []).length}</span>
          </Link>
        ))}
      </nav>

      {err ? <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
      {loading ? <div className="py-12 text-center text-slate-500">Loading lookups…</div>
        : (
          <div className="space-y-6">
            {LOOKUP_KINDS_META.map(k => (
              <LookupSection
                key={k.kind}
                kind={k.kind}
                label={k.label}
                hasDescription={k.hasDescription}
                codeHint={k.codeHint}
                initialRows={(allRows[k.kind] || []).map((r: any) => ({ ...r, is_active: true, sort_order: 0 }))}
              />
            ))}
          </div>
        )
      }
    </div>
  );
}
