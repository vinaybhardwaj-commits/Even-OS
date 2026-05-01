"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LookupRow, type LookupRowData } from "./LookupRow";
import { compatFetch } from "./api-shim";

type Props = {
  kind: string;
  label: string;
  hasDescription: boolean;
  codeHint: string;
  initialRows: LookupRowData[];
};

/**
 * One settings table — kind label + Add Row form + LookupRow children.
 * After Add succeeds, calls router.refresh() so the server component reloads
 * and new rows appear in the right sort order.
 */
export function LookupSection({
  kind,
  label,
  hasDescription,
  codeHint,
  initialRows,
}: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    code: "",
    label: "",
    description: "",
    sort_order: String(initialRows.length + 1),
  });
  const [addErr, setAddErr] = useState<string | null>(null);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddErr(null);
    try {
      const r = await compatFetch(`/api/lookups/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          label: draft.label,
          description: hasDescription ? draft.description : undefined,
          sort_order: parseInt(draft.sort_order, 10) || 0,
        }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        setDraft({
          code: "",
          label: "",
          description: "",
          sort_order: String(initialRows.length + 2),
        });
        router.refresh();
      } else if (r.status === 409) {
        setAddErr(`Code "${draft.code}" already exists.`);
      } else if (data?.errors) {
        setAddErr(
          Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(", "),
        );
      } else {
        setAddErr(data.code ?? "add failed");
      }
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "add failed");
    } finally {
      setAdding(false);
    }
  };

  const colSpan = hasDescription ? 6 : 5;

  return (
    <section
      id={kind}
      className="rounded-xl border border-slate-200 bg-white"
    >
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {label}
        </h2>
        <span className="font-mono text-xs text-slate-500">
          {initialRows.length} rows
        </span>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Label</th>
            {hasDescription && <th className="px-3 py-2 text-left">Description</th>}
            <th className="px-3 py-2 text-center">Sort</th>
            <th className="px-3 py-2 text-center">Status</th>
            <th className="px-3 py-2 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {/* Add row — inline form */}
          <tr className="bg-blue-50/30">
            <td className="px-3 py-2">
              <input
                type="text"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="code"
                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <p className="mt-1 text-[10px] text-slate-500">{codeHint}</p>
            </td>
            <td className="px-3 py-2">
              <input
                type="text"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="label"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </td>
            {hasDescription && (
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="description (optional)"
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </td>
            )}
            <td className="px-3 py-2 text-center">
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) =>
                  setDraft({ ...draft, sort_order: e.target.value })
                }
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </td>
            <td className="px-3 py-2 text-center text-xs text-slate-500">—</td>
            <td className="px-3 py-2 text-right">
              <button
                type="button"
                onClick={onAdd}
                disabled={adding || !draft.code.trim() || !draft.label.trim()}
                className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {adding ? "Adding…" : "+ Add"}
              </button>
            </td>
          </tr>
          {addErr && (
            <tr>
              <td colSpan={colSpan} className="bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                {addErr}
              </td>
            </tr>
          )}

          {initialRows.map((r) => (
            <LookupRow
              key={r.code}
              kind={kind}
              initial={r}
              hasDescription={hasDescription}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
