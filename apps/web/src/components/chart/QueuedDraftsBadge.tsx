/**
 * PC.4.C.3 — QueuedDraftsBadge.
 *
 * Tiny amber pill that sits next to HealthDots in the chart Row 1 header
 * when the offline queue has rows for this patient. Reads count via
 * `useOfflineQueue(patientId)` and hides itself when count === 0.
 *
 * Copy:
 *   "1 save queued · retrying…"   (singular)
 *   "N saves queued · retrying…"  (plural)
 *
 * It is intentionally read-only — the actual replay is driven by the
 * write-path component (e.g. the vitals form) via its own
 * `useOfflineQueue({ onRecover })` instance so that the mutation handler
 * stays co-located with the form logic.
 */

'use client';

import { useOfflineQueue } from './use-offline-queue';

export function QueuedDraftsBadge({
  patientId,
  inverted = false,
}: {
  patientId: string;
  inverted?: boolean;
}) {
  const { count, busy } = useOfflineQueue(patientId);
  if (!count) return null;

  const label = `${count} save${count === 1 ? '' : 's'} queued${busy ? ' · retrying…' : ''}`;

  // Inverted variant for the dark-blue chart header.
  const styles = inverted
    ? {
        background: 'rgba(251, 191, 36, 0.22)',
        border: '1px solid rgba(251, 191, 36, 0.55)',
        color: '#FDE68A',
      }
    : {
        background: '#FEF3C7',
        border: '1px solid #FCD34D',
        color: '#92400E',
      };

  return (
    <span
      role="status"
      aria-live="polite"
      title={
        busy
          ? 'Replaying queued writes now that the database is back.'
          : 'These saves were made while the database was unavailable and will retry automatically.'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        ...styles,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 999,
          background: '#F59E0B',
          boxShadow: busy ? '0 0 0 0 rgba(245, 158, 11, 0.6)' : undefined,
          animation: busy ? 'queuedDraftsPulse 1.6s ease-out infinite' : undefined,
        }}
      />
      {label}
      <style jsx>{`
        @keyframes queuedDraftsPulse {
          0%   { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }
          70%  { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);   }
          100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);     }
        }
      `}</style>
    </span>
  );
}
