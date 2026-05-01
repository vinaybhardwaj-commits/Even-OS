"use client";

import { useState } from "react";

type Props = {
  reason: string;
  reasonLabel: string;
  originalCode: string | null;
  detail: string | null;
  importedAt: string;
  sourceRow: Record<string, unknown>;
};

/**
 * One row of the bad-codes review table. Click "view" to expand the original
 * xlsx row data inline (useful for debugging the legacy data without leaving
 * the page).
 */
export function BadCodeRow({
  reason,
  reasonLabel,
  originalCode,
  detail,
  importedAt,
  sourceRow,
}: Props) {
  const [open, setOpen] = useState(false);
  const date = importedAt.split(" ")[0] ?? importedAt.split("T")[0] ?? importedAt;

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-2">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
            {reason}
          </span>
          <p className="mt-0.5 text-xs text-slate-500">{reasonLabel}</p>
        </td>
        <td className="px-4 py-2 align-top">
          {originalCode ? (
            <code className="font-mono text-xs text-slate-900">{originalCode}</code>
          ) : (
            <span className="italic text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-2 align-top">
          {detail ? (
            <span className="text-xs text-slate-700">{detail}</span>
          ) : (
            <span className="italic text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-2 align-top text-xs text-slate-500">{date}</td>
        <td className="px-4 py-2 text-right align-top">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            {open ? "hide" : "view"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-3">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700">
              {JSON.stringify(sourceRow, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
