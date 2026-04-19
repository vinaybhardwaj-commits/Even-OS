'use client';

/**
 * PrintTabButton — PC.4.D.2.4
 *
 * Mounted in each patient-chart tab header (Overview / Brief / Notes / Meds /
 * Labs). Fires `chartPrint.generateTab` on click, opens the returned PDF
 * `fileUrl` in a new tab when ready. 4-state machine (idle → generating →
 * ready → failed). Light/dark variant for placement inside header bars.
 */

import { useCallback, useRef, useState } from 'react';

export type PrintScope = 'overview' | 'brief' | 'notes' | 'meds' | 'labs';

type ButtonState =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

interface PrintTabButtonProps {
  patientId: string;
  scope: PrintScope;
  tabLabel: string;
  variant?: 'light' | 'dark';
  className?: string;
}

interface GenerateTabResponse {
  id: string;
  status: 'ready' | 'failed' | 'generating';
  error: string | null;
  createdAt: string | null;
  readyAt: string | null;
  fileUrl: string | null;
  pageCount: number | null;
  bytes: number | null;
}

function labelFor(state: ButtonState, scope: PrintScope): string {
  const base = titleCase(scope);
  switch (state.kind) {
    case 'idle':
      return `Print ${base}`;
    case 'generating':
      return 'Generating…';
    case 'ready':
      return 'Opened ↗';
    case 'failed':
      return 'Retry print';
  }
}

function titleCase(scope: PrintScope): string {
  switch (scope) {
    case 'overview':
      return 'Overview';
    case 'brief':
      return 'Brief';
    case 'notes':
      return 'Notes';
    case 'meds':
      return 'Meds';
    case 'labs':
      return 'Labs';
  }
}

export default function PrintTabButton({
  patientId,
  scope,
  tabLabel,
  variant = 'light',
  className,
}: PrintTabButtonProps) {
  const [state, setState] = useState<ButtonState>({ kind: 'idle' });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onClick = useCallback(async () => {
    if (state.kind === 'generating') return;
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    setState({ kind: 'generating' });

    try {
      const res = await fetch('/api/trpc/chartPrint.generateTab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            patient_id: patientId,
            scope,
            tab_name: tabLabel,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`
        );
      }

      const payload = (await res.json()) as {
        result?: { data?: { json?: GenerateTabResponse } };
        error?: { message?: string };
      };

      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      const data = payload.result?.data?.json;
      if (!data) {
        throw new Error('Malformed response from chartPrint.generateTab');
      }

      if (data.status === 'ready' && data.fileUrl) {
        try {
          window.open(data.fileUrl, '_blank', 'noopener,noreferrer');
        } catch {
          /* pop-up blocker — user can click again to retry */
        }
        setState({ kind: 'ready' });
        resetTimer.current = setTimeout(() => {
          setState({ kind: 'idle' });
        }, 1800);
        return;
      }

      if (data.status === 'failed') {
        throw new Error(data.error ?? 'Print export failed');
      }

      // status === 'generating' but we already awaited render; treat as failure
      throw new Error('Print export did not complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'failed', message });
      resetTimer.current = setTimeout(() => {
        setState({ kind: 'idle' });
      }, 3200);
    }
  }, [patientId, scope, tabLabel, state.kind]);

  const isDark = variant === 'dark';
  const baseBtn =
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed';
  const stateClass =
    state.kind === 'failed'
      ? isDark
        ? 'border-red-400/60 bg-red-500/15 text-red-200 hover:bg-red-500/25'
        : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
      : state.kind === 'ready'
        ? isDark
          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
          : 'border-emerald-300 bg-emerald-50 text-emerald-700'
        : state.kind === 'generating'
          ? isDark
            ? 'border-white/20 bg-white/10 text-white/80'
            : 'border-gray-300 bg-gray-100 text-gray-600'
          : isDark
            ? 'border-white/25 bg-white/5 text-white hover:bg-white/15'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

  const title =
    state.kind === 'failed'
      ? `Print failed: ${state.message}`
      : state.kind === 'ready'
        ? `${titleCase(scope)} PDF opened in a new tab`
        : `Download a PDF of the ${tabLabel} tab`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.kind === 'generating'}
      className={`${baseBtn} ${stateClass} ${className ?? ''}`.trim()}
      title={title}
      aria-busy={state.kind === 'generating'}
      data-scope={scope}
    >
      {state.kind === 'generating' ? (
        <span
          aria-hidden
          className={`inline-block h-3 w-3 animate-spin rounded-full border-2 ${
            isDark
              ? 'border-white/30 border-t-white'
              : 'border-gray-300 border-t-gray-700'
          }`}
        />
      ) : (
        <span aria-hidden>🖨️</span>
      )}
      <span>{labelFor(state, scope)}</span>
    </button>
  );
}
