'use client';

/**
 * PC.3.4 Track B — PreviewRoleBanner.
 *
 * Mounted in the root layout. Only renders when the super_admin has the
 * `even_preview_role` cookie active; otherwise returns null (zero visual
 * cost for every other user).
 *
 * Displays a sticky top strip: "Previewing as [role]" + an [Exit preview]
 * button. Clicking exit calls `previewRole.clear` and reloads so stale
 * React Query / tRPC caches don't keep serving the previewed payload.
 *
 * The banner is 32px tall with an amber background — distinguishable from
 * the admin HealthBar (which is 48px and blue/green). Visual hierarchy:
 * if both are present, preview banner sits above HealthBar.
 */

import { useEffect, useState } from 'react';

type PreviewState = {
  active: boolean;
  preview: { role: string; role_tag: string | null; hospital_id: string | null } | null;
  realRole: string;
};

async function trpcQuery<T>(path: string): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'GET',
    credentials: 'same-origin',
  });
  const body = await res.json();
  return body.result?.data as T;
}

async function trpcMutate<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input ?? {}),
  });
  const body = await res.json();
  return body.result?.data as T;
}

export default function PreviewRoleBanner() {
  const [state, setState] = useState<PreviewState | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Query the server for current preview state. Cheap — the handler reads
    // two cookies and returns a struct.
    trpcQuery<PreviewState>('previewRole.current')
      .then((s) => setState(s ?? { active: false, preview: null, realRole: 'unknown' }))
      .catch(() => setState({ active: false, preview: null, realRole: 'unknown' }));
  }, []);

  if (!state || !state.active || !state.preview) return null;

  const exit = async () => {
    setExiting(true);
    try {
      await trpcMutate('previewRole.clear', {});
    } catch {
      // Even if the mutation fails, reload so the UI matches cookie state.
    }
    window.location.reload();
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-[60] w-full"
      style={{ backgroundColor: '#fffbeb', borderBottom: '1px solid #fbbf24' }}
    >
      <div className="mx-auto flex items-center justify-between px-4 py-1.5 text-sm text-amber-900">
        <div className="flex items-center gap-2">
          <span aria-hidden>👁</span>
          <span>
            Previewing as <strong className="font-semibold">{state.preview.role}</strong>
            {state.preview.role_tag ? (
              <span className="text-amber-700"> · {state.preview.role_tag}</span>
            ) : null}
            <span className="text-amber-700"> (real: {state.realRole})</span>
          </span>
        </div>
        <button
          type="button"
          onClick={exit}
          disabled={exiting}
          className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-60"
        >
          {exiting ? 'Exiting…' : 'Exit preview'}
        </button>
      </div>
    </div>
  );
}
