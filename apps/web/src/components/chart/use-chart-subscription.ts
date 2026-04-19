'use client';

/**
 * PC.4.D.1 — Chart subscription hook.
 *
 * Wraps chartSubscriptions.mySubscription + watch/unwatch/silence/unsilence
 * into a single hook that WatchButton + NotificationBell + NotificationDrawer
 * share. Optimistic flips with rollback on error. Separate from
 * useChartNotifications (which handles events/counts) so subscription state
 * isn't coupled to the 30s poll cadence — subscription state is only
 * refetched on mutation.
 */
import { useCallback, useEffect, useState } from 'react';

export interface ChartSubscriptionRow {
  id: string;
  patient_id: string;
  user_id: string;
  source: 'auto_care_team' | 'watch';
  role_snapshot: string | null;
  silenced: boolean;
  silenced_at: string | null;
  silenced_reason: string | null;
  created_at: string;
  updated_at: string;
}

async function trpcQuery<T>(path: string, input: unknown): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`/api/trpc/${path}?input=${encoded}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error?.json?.message ?? json.error?.message ?? 'tRPC error');
  }
  return (json.result?.data?.json ?? json.result?.data) as T;
}

async function trpcMutate<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error?.json?.message ?? json.error?.message ?? 'tRPC error');
  }
  return (json.result?.data?.json ?? json.result?.data) as T;
}

export interface UseChartSubscriptionReturn {
  subscription: ChartSubscriptionRow | null;
  loading: boolean;
  error: string | null;
  isWatching: boolean;        // has a row AND not silenced
  isSilenced: boolean;
  source: 'auto_care_team' | 'watch' | null;
  refresh: () => Promise<void>;
  toggleWatch: () => Promise<void>;
  silence: (reason?: string | null) => Promise<void>;
  unsilence: () => Promise<void>;
}

export function useChartSubscription(patientId: string): UseChartSubscriptionReturn {
  const [subscription, setSubscription] = useState<ChartSubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!patientId) { setLoading(false); return; }
    try {
      const row = await trpcQuery<ChartSubscriptionRow | null>(
        'chartSubscriptions.mySubscription',
        { patient_id: patientId },
      );
      setSubscription(row);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleWatch = useCallback(async () => {
    const prev = subscription;
    const currentlyActive = !!prev && !prev.silenced;

    // Optimistic flip.
    if (currentlyActive) {
      if (prev?.source === 'auto_care_team') {
        setSubscription({ ...prev, silenced: true });
      } else {
        setSubscription(null);
      }
    } else {
      setSubscription({
        id: prev?.id ?? 'temp',
        patient_id: patientId,
        user_id: prev?.user_id ?? '',
        source: prev?.source ?? 'watch',
        role_snapshot: prev?.role_snapshot ?? null,
        silenced: false,
        silenced_at: null,
        silenced_reason: null,
        created_at: prev?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    try {
      if (currentlyActive) {
        await trpcMutate('chartSubscriptions.unwatch', { patient_id: patientId });
      } else {
        await trpcMutate('chartSubscriptions.watch', { patient_id: patientId });
      }
      await refresh();
    } catch (e) {
      setSubscription(prev);
      setError(e instanceof Error ? e.message : 'Subscription toggle failed');
    }
  }, [patientId, refresh, subscription]);

  const silence = useCallback(async (reason?: string | null) => {
    const prev = subscription;
    const normalised = reason ?? null;
    if (prev) setSubscription({ ...prev, silenced: true, silenced_reason: normalised });
    try {
      await trpcMutate('chartSubscriptions.silence', { patient_id: patientId, reason: normalised ?? undefined });
      await refresh();
    } catch (e) {
      setSubscription(prev);
      setError(e instanceof Error ? e.message : 'Silence failed');
    }
  }, [patientId, refresh, subscription]);

  const unsilence = useCallback(async () => {
    const prev = subscription;
    if (prev) setSubscription({ ...prev, silenced: false, silenced_reason: null });
    try {
      await trpcMutate('chartSubscriptions.unsilence', { patient_id: patientId });
      await refresh();
    } catch (e) {
      setSubscription(prev);
      setError(e instanceof Error ? e.message : 'Unsilence failed');
    }
  }, [patientId, refresh, subscription]);

  const isWatching = !!subscription && !subscription.silenced;
  const isSilenced = !!subscription?.silenced;
  const source = subscription?.source ?? null;

  return {
    subscription, loading, error,
    isWatching, isSilenced, source,
    refresh, toggleWatch, silence, unsilence,
  };
}
