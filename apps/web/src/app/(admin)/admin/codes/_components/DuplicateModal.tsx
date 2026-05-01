"use client";

import { useEffect } from "react";

type Props = {
  existing: {
    id: string;
    item_code: string;
    item_display_name: string;
  };
  onModify: () => void;
  onCancel: () => void;
};

/**
 * Modal shown when the API returns 409 duplicate_display_name.
 * Three actions: View existing (new tab), Modify form, Cancel.
 */
export function DuplicateModal({ existing, onModify, onCancel }: Props) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-modal-title"
      onMouseDown={(e) => {
        // Click outside the card cancels
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-rose-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-xl text-rose-600">
            ⚠
          </div>
          <div className="flex-1">
            <h3 id="dup-modal-title" className="text-base font-semibold text-slate-900">
              Display Name already exists
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              An item with this exact Display Name (case-insensitive) is
              already in the master. To prevent duplicates, you must either
              look up the existing item or change Brand / Pack Size / Strength
              to differentiate before saving.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <code className="block font-mono text-xs font-semibold text-slate-900">
            {existing.item_code}
          </code>
          <p className="mt-1 break-words font-mono text-xs text-slate-700">
            {existing.item_display_name}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onModify}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Modify form to differentiate
          </button>
          <a
            href={`/item/${existing.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            View existing →
          </a>
        </div>
      </div>
    </div>
  );
}
