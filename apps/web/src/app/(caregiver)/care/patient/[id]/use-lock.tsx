'use client';

/**
 * useLock(surface) — PC.1b2 client hook for chart_edit_locks
 *
 * Wraps the chartLocks tRPC router (acquire / extend / release / getCurrent)
 * with React lifecycle. One instance of the hook owns one lock row for the
 * lifetime of the calling component.
 *
 * Semantics:
 *   - When `active === true`, tries to acquire the lock on mount and on
 *     surface/active changes. Releases automatically on unmount and when
 *     `active` flips to false.
 *   - Auto-extends every 3 min (60% of the 5-min TTL) so the lock won't
 *     expire while the user is still interacting.
 *   - On contention, `status === 'conflict'` and `current` holds the
 *     existing holder — the UI is expected to render <LockBanner /> and
 *     disable write controls.
 *   - Acquire returns `{ok:true, lock}` on success or
 *     `{ok:false, current}` on contention (router contract).
 *
 * Consumer shape:
 *   const lock = useLock({
 *     patient_id, encounter_id, surface: 'notes', active: editorOpen,
 *   });
 *   if (lock.status === 'conflict') return <LockBanner current={lock.current!} />;
 *   <button disabled={lock.status !== 'held'}>Save</button>
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// Lightweight tRPC callers (match the pattern used in patient-chart-client.tsx).
async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.message || json.error?.json?.message || 'Lock mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
export type LockStatus = 'idle' | 'acquiring' | 'held' | 'conflict' | 'error' | 'released';

export interface LockHolder {
  id: string;
  hospital_id: string;
  patient_id: string;
  encounter_id: string | null;
  surface: string;
  locked_by_user_id: string;
  locked_by_user_name: string;
  locked_by_user_role: string;
  reason: string | null;
  locked_at: string;
  expires_at: string;
}

export interface UseLockArgs {
  patient_id: string;
  encounter_id?: string | null;
  surface: string;           // e.g. 'notes', `emar-${med_id}`, 'vitals'
  active?: boolean;          // when false, hook is dormant (no acquire)
  reason?: string;           // optional free-text stored on the row
}

export interface UseLockReturn {
  status: LockStatus;
  current: LockHolder | null;    // holder info (self if held; other if conflict)
  lockId: string | null;         // id of the held lock row (null until held)
  error: string | null;
  acquire: () => Promise<void>;
  release: () => Promise<void>;
}

// Extend every 3 minutes; server TTL is 5 min — plenty of headroom for jitter.
const EXTEND_INTERVAL_MS = 3 * 60 * 1000;

// ── Hook ────────────────────────────────────────────────────────────────────
export function useLock(args: UseLockArgs): UseLockReturn {
  const { patient_id, encounter_id = null, surface, active = true, reason } = args;

  const [status, setStatus] = useState<LockStatus>('idle');
  const [current, setCurrent] = useState<LockHolder | null>(null);
  const [lockId, setLockId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs used in cleanup (setState closures would be stale).
  const heldLockId = useRef<string | null>(null);
  const extendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Compose a stable slot key to re-run the effect when surface changes.
  const slotKey = `${patient_id}|${encounter_id || ''}|${surface}|${active ? '1' : '0'}`;

  const doAcquire = useCallback(async () => {
    if (!patient_id || !surface) return;
    setStatus('acquiring');
    setError(null);
    try {
      const res = await trpcMutate('chartLocks.acquire', {
        patient_id,
        encounter_id: encounter_id || null,
        surface,
        reason: reason || undefined,
      }) as { ok: true; lock: LockHolder } | { ok: false; current: LockHolder };

      if (!mountedRef.current) {
        // Raced to unmount — release what we just acquired.
        if (res && (res as any).ok && (res as any).lock) {
          try {
            await trpcMutate('chartLocks.release', { lock_id: (res as any).lock.id });
          } catch { /* ignore */ }
        }
        return;
      }

      if (res.ok) {
        heldLockId.current = res.lock.id;
        setLockId(res.lock.id);
        setCurrent(res.lock);
        setStatus('held');
      } else {
        heldLockId.current = null;
        setLockId(null);
        setCurrent(res.current);
        setStatus('conflict');
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'Failed to acquire lock');
      setStatus('error');
    }
  }, [patient_id, encounter_id, surface, reason]);

  const doRelease = useCallback(async () => {
    const id = heldLockId.current;
    heldLockId.current = null;
    if (extendTimer.current) {
      clearInterval(extendTimer.current);
      extendTimer.current = null;
    }
    if (id) {
      try { await trpcMutate('chartLocks.release', { lock_id: id }); } catch { /* ignore */ }
    }
    if (mountedRef.current) {
      setLockId(null);
      setCurrent(null);
      setStatus('released');
    }
  }, []);

  // Primary lifecycle: acquire on mount/slot-change, release on unmount/slot-change.
  useEffect(() => {
    mountedRef.current = true;
    if (!active) {
      // When going dormant, drop any held lock.
      if (heldLockId.current) {
        void doRelease();
      } else {
        setStatus('idle');
      }
      return;
    }
    void doAcquire();
    return () => {
      mountedRef.current = false;
      // Fire and forget — component is tearing down anyway.
      const id = heldLockId.current;
      heldLockId.current = null;
      if (extendTimer.current) {
        clearInterval(extendTimer.current);
        extendTimer.current = null;
      }
      if (id) {
        void trpcMutate('chartLocks.release', { lock_id: id }).catch(() => { /* ignore */ });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

  // Auto-extend pinger while we're holding the lock.
  useEffect(() => {
    if (status !== 'held' || !lockId) return;
    const timer = setInterval(async () => {
      if (!mountedRef.current || heldLockId.current !== lockId) return;
      try {
        const lock = await trpcMutate('chartLocks.extend', { lock_id: lockId }) as LockHolder;
        if (mountedRef.current) setCurrent(lock);
      } catch (err: any) {
        // Lock expired or stolen — fall back to re-acquire to discover conflict state.
        if (!mountedRef.current) return;
        try {
          const cur = await trpcQuery('chartLocks.getCurrent', {
            patient_id, encounter_id: encounter_id || null, surface,
          }) as LockHolder | null;
          if (!mountedRef.current) return;
          if (cur && cur.id !== lockId) {
            heldLockId.current = null;
            setLockId(null);
            setCurrent(cur);
            setStatus('conflict');
          } else {
            void doAcquire();
          }
        } catch {
          setError(err?.message || 'Lock extend failed');
          setStatus('error');
        }
      }
    }, EXTEND_INTERVAL_MS);
    extendTimer.current = timer;
    return () => {
      clearInterval(timer);
      if (extendTimer.current === timer) extendTimer.current = null;
    };
  }, [status, lockId, patient_id, encounter_id, surface, doAcquire]);

  return {
    status,
    current,
    lockId,
    error,
    acquire: doAcquire,
    release: doRelease,
  };
}

// ── Banner component (shared) ───────────────────────────────────────────────
// Small presentational helper — importers can style around it. Kept in the
// same file so consumers get one import for PC.1b2.

export interface LockBannerProps {
  current: LockHolder | null;
  surfaceLabel?: string;         // friendly name of the surface (e.g. "this note")
  onRetry?: () => void;
}

export function LockBanner({ current, surfaceLabel = 'this section', onRetry }: LockBannerProps) {
  if (!current) return null;
  const who = current.locked_by_user_name || 'another user';
  const role = current.locked_by_user_role ? ` (${current.locked_by_user_role})` : '';
  const since = relativeTimeFrom(current.locked_at);
  return (
    <div
      role="status"
      style={{
        padding: '10px 14px',
        border: '1px solid #FDE68A',
        background: '#FFFBEB',
        color: '#92400E',
        borderRadius: 10,
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ lineHeight: 1.4 }}>
        <strong style={{ fontWeight: 700 }}>{surfaceLabel} is locked</strong>
        <span> — {who}{role} started editing {since}. You can view but not save until they're done.</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            background: '#FBBF24',
            color: '#78350F',
            border: 'none',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function relativeTimeFrom(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const secs = Math.max(0, Math.floor((now - then) / 1000));
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleString();
  } catch { return 'just now'; }
}
