'use client';

/**
 * PC.4.D.1 — Watch button for chart header.
 *
 * Sits in the dark-blue chart header between NotificationBell and the
 * complaints SLA badge. Inverted visual grammar (translucent pill on dark).
 *
 * State grammar:
 *   - Filled ★ amber = "watching" (has subscription + not silenced)
 *   - Outlined ☆ slate = not subscribed, or subscribed but silenced
 *   - AUTO badge appended when source=auto_care_team (user can still
 *     unwatch; backend flips to silenced rather than deleting the
 *     care-team audit row).
 *
 * Click always calls `onToggle()`, which in turn calls either
 * chartSubscriptions.watch (when flipping ON) or unwatch (when flipping OFF)
 * via the `useChartSubscription` hook the parent owns.
 */
interface WatchButtonProps {
  isWatching: boolean;
  isSilenced: boolean;
  source: 'auto_care_team' | 'watch' | null;
  loading: boolean;
  onToggle: () => Promise<void> | void;
}

export function WatchButton({
  isWatching,
  isSilenced,
  source,
  loading,
  onToggle,
}: WatchButtonProps) {
  const label = isWatching
    ? source === 'auto_care_team'
      ? 'On care team — click to silence'
      : 'Watching — click to unwatch'
    : isSilenced
      ? 'Silenced — click to re-enable'
      : 'Watch this patient';

  const tone = isWatching
    ? {
        bg: 'rgba(251, 191, 36, 0.22)',
        border: 'rgba(251, 191, 36, 0.6)',
        text: '#FEF3C7',
      }
    : {
        bg: 'rgba(148, 163, 184, 0.14)',
        border: 'rgba(148, 163, 184, 0.35)',
        text: 'rgba(226, 232, 240, 0.85)',
      };

  return (
    <button
      type="button"
      onClick={() => { void onToggle(); }}
      disabled={loading}
      aria-pressed={isWatching}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 999,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.text,
        fontSize: 11,
        fontWeight: 700,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.55 : 1,
        lineHeight: 1,
        letterSpacing: 0.1,
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>
        {isWatching ? '\u2605' : '\u2606'}
      </span>
      {source === 'auto_care_team' && isWatching ? (
        <span style={{ fontSize: 9, opacity: 0.8, letterSpacing: 0.4 }}>AUTO</span>
      ) : null}
    </button>
  );
}
