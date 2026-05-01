'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Props { userId: string; userRole: string; hospitalId: string; }

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-slate-100 text-slate-700' },
  pending_clinical_review: { label: 'Pending clinical', tone: 'bg-amber-100 text-amber-700' },
  pending_master_data_review: { label: 'Pending MDO', tone: 'bg-amber-100 text-amber-700' },
  pending_cms_gm_review: { label: 'Pending CMS/GM', tone: 'bg-amber-100 text-amber-700' },
  active: { label: 'Active', tone: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', tone: 'bg-red-100 text-red-700' },
};

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function CodesServicesClient({ hospitalId }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [filters, setFilters] = useState<{ type?: string; dept?: string; status?: string[] }>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, tps, dps] = await Promise.all([
        trpcQuery('codes.services.list', {
          service_type_code: filters.type,
          department_code: filters.dept,
          status: filters.status,
          limit: 200,
        }),
        trpcQuery('codes.services.lookups.types'),
        trpcQuery('codes.services.lookups.departments'),
      ]);
      setItems(list);
      setTypes(tps);
      setDepts(dps);
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [filters.type, filters.dept, filters.status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/admin/codes" className="text-blue-600 hover:underline">Codes</Link> › Services
      </div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Service codes</h1>
          <p className="mt-1 text-sm text-slate-600">
            Procedures, consultations, labs, imaging, packages, room/bed days, fees · {items.length} listed{filters.status?.length ? ` · ${filters.status.join(', ')}` : ''}
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Format: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">S-XX-DEPT-9999</code>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <select
          value={filters.type ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          <option value="">All types</option>
          {types.map((t) => <option key={t.code} value={t.code}>{t.code} — {t.label}</option>)}
        </select>
        <select
          value={filters.dept ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, dept: e.target.value || undefined }))}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          <option value="">All departments</option>
          {depts.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
        </select>
        <select
          value={filters.status?.[0] ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value ? [e.target.value] : undefined }))}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="pending_clinical_review">Pending clinical</option>
          <option value="pending_master_data_review">Pending MDO</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {err && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}
      {loading ? <div className="py-12 text-center text-slate-500">Loading…</div>
        : items.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">No services match these filters.</div>
        : <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Service name</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Dept</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const lbl = STATUS_LABELS[s.status] ?? { label: s.status, tone: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{s.service_code}</td>
                      <td className="px-3 py-2">{s.service_name}</td>
                      <td className="px-3 py-2 text-xs">{s.service_type_code}</td>
                      <td className="px-3 py-2 text-xs">{s.department_code}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${lbl.tone}`}>{lbl.label}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{s.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      }

      <p className="mt-6 text-xs text-slate-400">
        Phase 3 — read-only browse. Create / edit modal lands in Phase 3.B alongside the bulk import UI.
      </p>
    </div>
  );
}
