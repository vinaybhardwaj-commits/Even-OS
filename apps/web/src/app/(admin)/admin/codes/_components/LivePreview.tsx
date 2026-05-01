"use client";

type Props = {
  displayName: string;
  bucket: string | null;
  nextSerial: number | null;
  firstUseOfBucket: boolean;
};

/**
 * Live preview card. Shows the computed Display Name and the (probably-) next
 * Item Code. Right column on desktop ≥1280px, below the form on smaller widths.
 */
export function LivePreview({
  displayName,
  bucket,
  nextSerial,
  firstUseOfBucket,
}: Props) {
  const codePreview =
    bucket && nextSerial !== null
      ? `${bucket}-${String(nextSerial).padStart(5, "0")}`
      : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
      <p className="font-mono text-xs uppercase tracking-wide text-slate-500">
        Live Preview
      </p>

      <dl className="mt-3 space-y-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Display Name
          </dt>
          <dd className="mt-1 break-words font-mono text-sm text-slate-900">
            {displayName || <span className="text-slate-400">—</span>}
          </dd>
        </div>

        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Item Code
          </dt>
          <dd className="mt-1 font-mono text-base font-semibold text-slate-900">
            {codePreview ?? <span className="text-slate-400">pick a bucket</span>}
          </dd>
          {bucket && (
            <p className="mt-1 text-xs text-slate-500">
              Allocated atomically on save · bucket{" "}
              <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-700">
                {bucket}
              </code>
            </p>
          )}
        </div>
      </dl>

      {firstUseOfBucket && bucket && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>First-use of bucket {bucket}:</strong> no items have been
          coded under this Category × Storage × Classification combination
          before. Confirm the classification is correct before saving.
        </div>
      )}
    </div>
  );
}
