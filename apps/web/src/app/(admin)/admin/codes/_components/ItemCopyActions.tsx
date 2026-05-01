"use client";

import { useState } from "react";

type Props = { itemCode: string; displayName: string };

/** Copy buttons for the item detail page (client wrapper, used by the server component). */
export function ItemCopyActions({ itemCode, displayName }: Props) {
  const [copied, setCopied] = useState<"code" | "name" | "both" | null>(null);

  const copy = async (which: "code" | "name" | "both") => {
    const text =
      which === "code"
        ? itemCode
        : which === "name"
          ? displayName
          : `${itemCode}\t${displayName}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => copy("code")}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied === "code" ? "✓ copied" : "Copy code"}
      </button>
      <button
        type="button"
        onClick={() => copy("name")}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied === "name" ? "✓ copied" : "Copy name"}
      </button>
      <button
        type="button"
        onClick={() => copy("both")}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied === "both" ? "✓ copied" : "Copy both (TSV)"}
      </button>
    </div>
  );
}
