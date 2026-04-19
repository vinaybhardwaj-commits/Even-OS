'use client';

/**
 * PC.4.B.4 — Chart-scoped notification bell (pill in chart header).
 *
 * Sits between HealthDots and QueuedDraftsBadge on the dark-blue chart
 * header row. Inverted styling (translucent light pill on dark backdrop).
 * Click → open NotificationDrawer.
 *
 * Badge grammar:
 *   - total unread count
 *   - colour = max severity (critical red pulse, high orange, normal slate, info blue)
 *   - hidden entirely when count === 0
 */
import { useMemo } from 'react';
import type { UnreadCounts } from './use-chart-notifications';

interface NotificationBellProps {
  counts: UnreadCounts;
  maxSeverity: 'critical' | 'high' | 'normal' | 'info' | null;
  /** PC.4.D.1: when true, bell is muted — counts hidden, shows z-z marker. */
  silenced?: boolean;
  onClick: () => void;
}

const SEVERITY_FILL: Record<string, { bg: string; border: string; text: string; label: string; pulse?: boolean }> = {
  critical: { bg: 'rgba(248, 113, 113, 0.28)', border: 'rgba(248, 113, 113, 0.7)', text: '#FCA5A5', label: 'Critical', pulse: true },
  high:     { bg: 'rgba(251, 146, 60, 0.22)', border: 'rgba(251, 146, 60, 0.55)', text: '#FDBA74', label: 'High' },
  normal:   { bg: 'rgba(148, 163, 184, 0.22)', border: 'rgba(148, 163, 184, 0.55)', text: '#CBD5E1', label: 'Normal' },
  info:     { bg: 'rgba(96, 165, 250, 0.22)', border: 'rgba(96, 165, 250, 0.55)', text: '#BFDBFE', label: 'Info' },
};

export function NotificationBell({ counts, maxSeverity, silenced = false, onClick }: NotificationBellProps) {
  const total = counts.total;

  const style = useMemo(() => {
    if (!maxSeverity) return null;
    return SEVERITY_FILL[maxSeverity];
  }, [maxSeverity]);

  // PC.4.D.1: silenced variant — quiet muted-bell with z-z marker.
  if (silenced) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Chart notifications silenced for this patient"
        title="Silenced — click to open drawer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(71, 85, 105, 0.22)',
          border: '1px dashed rgba(148, 163, 184, 0.45)',
          color: 'rgba(203, 213, 225, 0.75)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          lineHeight: 1,
          opacity: 0.82,
        }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>🔕</span>
        <span style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.85 }}>zZ</span>
      </button>
    );
  }

  if (!total || !style) {
    // Still render a quiet bell so users can open the drawer for read/dismissed tabs.
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Chart notifications (none unread)"
        title="Notifications"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(148, 163, 184, 0.14)',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          color: 'rgba(226, 232, 240, 0.85)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>🔔</span>
      </button>
    );
  }

  const pulse = style.pulse;

  return (
    <>
      {pulse ? (
        <style>{`
          @keyframes chartBellPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.55); }
            50%      { box-shadow: 0 0 0 5px rgba(248, 113, 113, 0); }
          }
        `}</style>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        aria-label={`${total} unread notifications, max severity ${style.label}`}
        title={`Notifications · ${total} unread${counts.critical ? ` · ${counts.critical} critical` : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: style.bg,
          border: `1px solid ${style.border}`,
          color: style.text,
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          lineHeight: 1,
          animation: pulse ? 'chartBellPulse 1.6s ease-in-out infinite' : undefined,
        }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>🔔</span>
        <span>{total > 99 ? '99+' : total}</span>
      </button>
    </>
  );
}
