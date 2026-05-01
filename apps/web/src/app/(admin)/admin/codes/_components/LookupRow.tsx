"use client";

import { useState } from "react";
import { compatFetch } from "./api-shim";

export type LookupRowData = {
  code: string;
  label: string;
  description?: string | null;
  is_active: boolean;
  sort_order: number;
};

type Props = {
  kind: string;
  initial: LookupRowData;
  hasDescription: boolean;
};

/** One row of a lookup table. Save button activates when any field is dirty. */
export function LookupRow({ kind, initial, hasDescription }: Props) {
  const [row, setRow] = useState<LookupRowData>(initial);
  const [saved, setSaved] = useState<LookupRowData>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    row.label !== saved.label ||
    (hasDescription && (row.description ?? "") !== (saved.description ?? "")) ||
    row.is_active !== saved.is_active ||
    row.sort_order !== saved.sort_order;

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await compatFetch(
        `/api/lookups/${kind}/${encodeURIComponent(row.code)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: row.label,
            description: hasDescription ? row.description : undefined,
            is_active: row.is_active,
            sort_order: row.sort_order,
          }),
        },
      );
      const data = await r.json();
      if (r.ok && data.ok) {
        setSaved(row);
      } else {
        setErr(
          data?.errors
            ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(", ")
            : (data.code ?? "save failed"),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const inactive = !row.is_active;

  return (
    <tr className={inactive ? "bg-slate-50/50 text-slate-500" : ""}>
      <td className="px-3 py-2 align-top">
        <code className="font-mono text-xs font-semibold">{row.code}</code>
      </td>
      <td className="px-3 py-2 align-top">
        <input
          type="text"
          value={row.label}
          onChange={(e) => setRow({ ...row, label: e.target.value })}
          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </td>
      {hasDescription && (
        <td className="px-3 py-2 align-top">
          <input
            type="text"
            value={row.description ?? ""}
            onChange={(e) => setRow({ ...row, description: e.target.value })}
            placeholder="—"
            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </td>
      )}
      <td className="px-3 py-2 align-top text-center">
        <input
          type="number"
          value={row.sort_order}
          onChange={(e) =>
            setRow({ ...row, sort_order: parseInt(e.target.value, 10) || 0 })
          }
          className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </td>
      <td className="px-3 py-2 text-center align-top">
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={row.is_active}
            onChange={(e) => setRow({ ...row, is_active: e.target.checked })}
          />
          {row.is_active ? "active" : "inactive"}
        </label>
      </td>
      <td className="px-3 py-2 text-right align-top">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
      </td>
    </tr>
  );
}
