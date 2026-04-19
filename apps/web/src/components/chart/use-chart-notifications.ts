'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * PC.4.B.4 — chart-scoped notification hook.
 *
 * Wraps the 5 chartSubscriptions endpoints shipped in PC.4.B.3:
 *   listEvents, countUnread, markRead, markAllRead, dismiss
 *
 * Polling:
 *   - 30s interval
 *   - paused when document.hidden (tab in background)
 *   - paused when `dbStatus === 'red'` (degraded mode)
 *
 * Scope:
 *   - all endpoints accept an optional patient_id — when provided,
 *     the drawer/bell are patient-scoped (only that chart's events).
 */
const POLL_MS = 30_000;

export interface ChartNotificationEventRow {
  id: string;
  hospital_id: string;
  patient_id: string;
  encounter_id: string | null;
  event_type: string;
  severity: 'critical' | 'high' | 'normal' | 'info';
  source_kind: string;
  source_id: string | null;
  dedup_key: string | null;
  payload: Record<string, unknown> | null;
  fired_at: string;
  fired_by_user_id: string | null;
  read_state?: 'unread' | 'read' | 'dismissed' | null;
  seen_at?: string | null;
  dismissed_at?: string | null;
  ack_reason?: string | null;
}

export interface UnreadCounts {
  total: number;
  critical: number;
  high: number;
  normal: number;
  info: number;
}

type ListStatus = 'unread' | 'read' | 'dismissed' | 'all';

async function trpcQuery<T = any>(path: string, input?: any): Promise<T | null> {
  try {
    const wrapped = input !== undefined ? { json: input } : { json: {} };
    const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
    const res = await fetch(`/api/trpc/${path}${params}`);
    const json = await res.json();
    if (json.error) return null;
    return json.result?.data?.json ?? null;
  } catch {
    return null;
  }
}

async function trpcMutate<T = any>(path: string, input?: any): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: input ?? {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || 'mutation_failed';
    throw new Error(msg);
  }
  return json.result?.data?.json as T;
}

export interface UseChartNotificationsOpts {
  patientId?: string;
  dbStatus?: 'green' | 'yellow' | 'red';
  limit?: number;
}

export function useChartNotifications(opts: UseChartNotificationsOpts = {}) {
  const { patientId, dbStatus, limit = 50 } = opts;

  const [counts, setCounts] = useState<UnreadCounts>({
    total: 0, critical: 0, high: 0, normal: 0, info: 0,
  });
  const [events, setEvents] = useState<ChartNotificationEventRow[]>([]);
  const [status, setStatus] = useState<ListStatus>('unread');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countsRef = useRef<UnreadCounts>(counts);
  countsRef.current = counts;

  const shouldPoll = dbStatus !== 'red';

  // --- queries ------------------------------------------------------------
  const refreshCounts = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const data = await trpcQuery<UnreadCounts>(
      'chartSubscriptions.countUnread',
      patientId ? { patient_id: patientId } : {},
    );
    if (data) setCounts(data);
  }, [patientId]);

  const refreshList = useCallback(async (overrideStatus?: ListStatus) => {
    const targetStatus = overrideStatus ?? status;
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery<ChartNotificationEventRow[]>(
        'chartSubscriptions.listEvents',
        {
          patient_id: patientId,
          status: targetStatus === 'all' ? undefined : targetStatus,
          limit,
        },
      );
      setEvents(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? 'list_failed');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, status, limit]);

  // --- mutations (optimistic) --------------------------------------------
  const markRead = useCallback(async (event_ids: string[]) => {
    if (!event_ids.length) return;
    // optimistic: flip rows locally + decrement counts
    setEvents((rows) =>
      rows.map((r) =>
        event_ids.includes(r.id) && r.read_state !== 'dismissed'
          ? { ...r, read_state: 'read', seen_at: new Date().toISOString() }
          : r,
      ),
    );
    try {
      await trpcMutate('chartSubscriptions.markRead', { event_ids });
      await refreshCounts();
    } catch (e: any) {
      setError(e?.message ?? 'mark_read_failed');
      await refreshList();
      await refreshCounts();
    }
  }, [refreshCounts, refreshList]);

  const markAllRead = useCallback(async () => {
    // optimistic wipe
    setEvents((rows) =>
      rows.map((r) =>
        r.read_state === 'dismissed'
          ? r
          : { ...r, read_state: 'read', seen_at: new Date().toISOString() },
      ),
    );
    setCounts({ total: 0, critical: 0, high: 0, normal: 0, info: 0 });
    try {
      await trpcMutate(
        'chartSubscriptions.markAllRead',
        patientId ? { patient_id: patientId } : {},
      );
      await refreshCounts();
    } catch (e: any) {
      setError(e?.message ?? 'mark_all_read_failed');
      await refreshList();
      await refreshCounts();
    }
  }, [patientId, refreshCounts, refreshList]);

  const dismiss = useCallback(async (event_ids: string[], ack_reason?: string) => {
    if (!event_ids.length) return;
    setEvents((rows) =>
      rows.map((r) =>
        event_ids.includes(r.id)
          ? { ...r, read_state: 'dismissed', dismissed_at: new Date().toISOString(), ack_reason: ack_reason ?? r.ack_reason ?? null }
          : r,
      ),
    );
    try {
      await trpcMutate('chartSubscriptions.dismiss', { event_ids, ack_reason });
      await refreshCounts();
    } catch (e: any) {
      setError(e?.message ?? 'dismiss_failed');
      await refreshList();
      await refreshCounts();
    }
  }, [refreshCounts, refreshList]);

  // --- polling ------------------------------------------------------------
  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || !document.hidden) {
        await refreshCounts();
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    // fire-and-forget initial load
    refreshCounts();
    timer = setTimeout(tick, POLL_MS);

    const onVisibility = () => {
      if (!cancelled && typeof document !== 'undefined' && !document.hidden) {
        refreshCounts();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [refreshCounts, shouldPoll]);

  // derived severity for bell colour
  const maxSeverity = useMemo<'critical' | 'high' | 'normal' | 'info' | null>(() => {
    if (counts.critical > 0) return 'critical';
    if (counts.high > 0) return 'high';
    if (counts.normal > 0) return 'normal';
    if (counts.info > 0) return 'info';
    return null;
  }, [counts]);

  return {
    counts,
    maxSeverity,
    events,
    status,
    setStatus,
    loading,
    error,
    refreshCounts,
    refreshList,
    markRead,
    markAllRead,
    dismiss,
  };
}
