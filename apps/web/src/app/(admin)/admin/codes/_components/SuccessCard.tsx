"use client";

import { useState } from "react";

type Props = {
  itemCode: string;
  displayName: string;
  firstUseOfBucket: boolean;
  onCreateAnother: () => void;
};

/**
 * Replaces the form after a successful save. Big monospace code, three copy
 * buttons, and "Create another" CTA that resets the form.
 */
export function SuccessCard({
  itemCode,
  displayName,
  firstUseOfBucket,
  onCreateAnother,
}: Props) {
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
      // Browsers may block clipboard write without user gesture in some contexts.
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
        ✓
      </div>
      <h2 className="mt-3 text-lg font-semibold text-emerald-900">Code saved</h2>
      {firstUseOfBucket && (
        <p className="mt-1 text-xs text-amber-700">
          (First item under this bucket.)
        </p>
      )}
      <p className="mt-4 break-all font-mono text-3xl font-bold text-emerald-900">
        {itemCode}
      </p>
      <p className="mt-2 break-words font-mono text-sm text-emerald-800/80">
        {displayName}
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => copy("code")}
          className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
        >
          {copied === "code" ? "✓ copied" : "Copy code"}
        </button>
        <button
          type="button"
          onClick={() => copy("name")}
          className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
        >
          {copied === "name" ? "✓ copied" : "Copy name"}
        </button>
        <button
          type="button"
          onClick={() => copy("both")}
          className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
        >
          {copied === "both" ? "✓ copied" : "Copy both (TSV)"}
        </button>
      </div>

      <button
        type="button"
        onClick={onCreateAnother}
        className="mt-6 inline-flex items-center justify-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        autoFocus
      >
        Create another →
      </button>
    </div>
  );
}
