'use client';

import { useCallback, useEffect, useState } from 'react';

interface Props { encounterId: string; userId: string; userRole: string; hospitalId: string; }

const STEP_LABELS: Record<string, string> = {
  charge_reconciliation: 'Reconcile charges',
  bill_build: 'Build bill',
  settlement_presentation: 'Present settlement',
  payment_collection: 'Collect payment',
  document_pack: 'Document pack',
  bill_close: 'Close bill',
};

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-300',
  complete: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  error: 'bg-red-50 text-red-800 border-red-300',
  skipped: 'bg-slate-50 text-slate-400 border-slate-200',
};

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}
async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input ?? {} }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message);
  return j.result?.data?.json;
}

export default function DischargeClient({ encounterId }: Props) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await trpcQuery('billingV3.discharge.status', { encounter_id: encounterId });
      setStatus(r);
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [encounterId]);
  useEffect(() => { load(); }, [load]);

  const start = useCallback(async () => {
    setActing('start');
    try {
      await trpcMutate('billingV3.discharge.start', { encounter_id: encounterId });
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActing(null); }
  }, [encounterId, load]);

  const runReconciliation = useCallback(async () => {
    setActing('charge_reconciliation');
    try {
      const r = await trpcMutate('billingV3.discharge.runReconciliation', { encounter_id: encounterId });
      console.log('Reconciliation result:', r);
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActing(null); }
  }, [encounterId, load]);

  const advance = useCallback(async (step: string) => {
    setActing(step);
    try {
      await trpcMutate('billingV3.discharge.advanceStep', { encounter_id: encounterId, step });
      await load();
    } catch (e: any) { setErr(e?.message); } finally { setActing(null); }
  }, [encounterId, load]);

  const orchestrationStarted = (status?.steps?.length ?? 0) > 0;
  const currentStep = status?.current_step;
  const isComplete = status?.is_complete;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-2 text-xs text-slate-500">Discharge billing closure</div>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-slate-900">Encounter <span className="font-mono text-base">{encounterId.slice(0, 8)}…</span></h1>

      {err && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      {!orchestrationStarted ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-600">Discharge orchestration not started.</p>
          <button
            onClick={start}
            disabled={acting === 'start'}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {acting === 'start' ? 'Starting…' : 'Start discharge orchestration'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {status.steps.map((s: any) => {
            const tone = STATUS_TONE[s.status] ?? STATUS_TONE.pending;
            const isCurrent = s.step === currentStep;
            return (
              <div key={s.step} className={`rounded-lg border p-4 ${tone} ${isCurrent ? 'ring-2 ring-blue-400' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{STEP_LABELS[s.step] ?? s.step}</div>
                    <div className="text-xs opacity-70">Status: {s.status}{s.attempts > 0 ? ` · ${s.attempts} attempt(s)` : ''}</div>
                  </div>
                  {s.status === 'pending' && isCurrent && (
                    <button
                      onClick={() => s.step === 'charge_reconciliation' ? runReconciliation() : advance(s.step)}
                      disabled={acting === s.step}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {acting === s.step ? 'Running…' : (s.step === 'charge_reconciliation' ? 'Reconcile' : 'Advance')}
                    </button>
                  )}
                </div>
                {s.result && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-white/50 p-2 text-xs">
{JSON.stringify(s.result, null, 2)}
                  </pre>
                )}
                {s.error_message && (
                  <div className="mt-2 rounded bg-red-100 p-2 text-xs text-red-800">{s.error_message}</div>
                )}
              </div>
            );
          })}

          {isComplete && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              ✓ Orchestration complete. Patient may be discharged.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
