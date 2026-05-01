"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { compatFetch } from "./api-shim";

type Result = {
  id: string;
  item_code: string;
  item_display_name: string;
  item_type: string;
  source: string;
  brand: string | null;
};

const DEBOUNCE_MS = 200;

export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounced fetch
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      compatFetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=10`, {
        signal: ac.signal,
      })
        .then((r) => r.json())
        .then((d) => {
          if (ac.signal.aborted) return;
          setResults(Array.isArray(d.results) ? d.results : []);
          setHighlight(0);
          setLoading(false);
        })
        .catch(() => {
          /* aborted or net error */
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [q]);

  // Click-outside to close
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onSelect = (r: Result) => {
    setOpen(false);
    setQ("");
    router.push(`/item/${r.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[highlight];
      if (r) onSelect(r);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown =
    open && q.trim().length >= 2 && (loading || results.length > 0 || results.length === 0);

  return (
    <div ref={containerRef} className="relative w-72">
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search by name / code / generic / brand…"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        aria-label="Search items"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        autoComplete="off"
      />

      {showDropdown && (
        <div className="absolute right-0 z-20 mt-1 w-[28rem] max-w-[90vw] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-xs text-slate-500">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">
              No matches for <span className="font-mono">{q.trim()}</span>.
            </div>
          )}
          {!loading && results.length > 0 && (
            <ul role="listbox" className="max-h-96 overflow-y-auto">
              {results.map((r, i) => (
                <li
                  key={r.id}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    // mousedown rather than click — fires before the input blur
                    e.preventDefault();
                    onSelect(r);
                  }}
                  className={[
                    "cursor-pointer border-b border-slate-100 px-3 py-2 text-sm last:border-b-0",
                    i === highlight ? "bg-blue-50" : "bg-white",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-xs font-semibold text-slate-900">
                      {r.item_code}
                    </code>
                    <span
                      className={[
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        r.source === "codecreator"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600",
                      ].join(" ")}
                    >
                      {r.source === "codecreator" ? "new" : "legacy"}
                    </span>
                  </div>
                  <div className="mt-0.5 break-words text-xs text-slate-700">
                    {r.item_display_name}
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[11px] text-slate-500">
                    <span>{r.item_type}</span>
                    {r.brand && <span>· {r.brand}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && results.length === 10 && (
            <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
              Showing top 10. Refine your query for more.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
