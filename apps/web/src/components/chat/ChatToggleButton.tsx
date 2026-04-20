'use client';

/**
 * ChatToggleButton — OC.2a + CHAT.X.2
 *
 * Floating button pinned to the left edge of the viewport (vertically centered).
 * Shows chat icon + 3-number unread badge (A/B/C). Click toggles sidebar open/closed.
 * Only visible in the "collapsed" state (hidden when sidebar is open).
 *
 * CHAT.X.2 badge layout:
 *   • Large A in centre — "how much am I ignoring?"
 *   • B (blue) stacked above — "how much is for my role?"
 *   • C (red)  stacked below — "how many DMs to me?"
 *   • Tooltip spells out the decomposition.
 */

import { useChat } from '@/providers/ChatProvider';

function cap(n: number): string {
  if (n <= 0) return '0';
  return n > 99 ? '99+' : String(n);
}

export function ChatToggleButton() {
  const { chatState, setChatState, unreadSummary, isAuthenticated, isLoading } = useChat();

  // Don't render if not authenticated or still loading
  if (!isAuthenticated || isLoading) return null;

  // Hide when sidebar or chatroom is open (ChatShell handles those states)
  if (chatState !== 'collapsed') return null;

  const { a, b, c } = unreadSummary;
  const hasUnread = a > 0;
  const tooltip = hasUnread
    ? `${a} unread total · ${b} in your role · ${c} DMs to you (Ctrl+Shift+M)`
    : 'Open chat (Ctrl+Shift+M)';

  return (
    <button
      onClick={() => setChatState('sidebar')}
      className="fixed left-0 top-1/2 -translate-y-1/2 z-50
        flex items-center gap-1.5 px-2.5 py-3
        bg-[#0A1628] hover:bg-[#132040] text-white
        rounded-r-xl shadow-lg hover:shadow-xl
        transition-all duration-200 ease-out
        hover:pl-3.5 group"
      aria-label={
        hasUnread
          ? `Open chat. ${a} unread total, ${b} in your role, ${c} direct messages`
          : 'Open chat'
      }
      title={tooltip}
    >
      {/* Chat icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>

      {/* CHAT.X.2 — 3-number unread badge (A centre, B top, C bottom) */}
      {hasUnread && (
        <span
          className="absolute -top-2 -right-2 pointer-events-none
            flex flex-col items-center justify-center"
          aria-hidden
        >
          {/* B (role-scoped) — small, blue, above */}
          {b > 0 && (
            <span className="min-w-[16px] h-[14px] px-1 -mb-0.5
              flex items-center justify-center
              bg-sky-500 text-white text-[9px] leading-none font-semibold
              rounded-full shadow-sm ring-1 ring-[#0A1628]">
              {cap(b)}
            </span>
          )}
          {/* A (total) — large, pink, centre */}
          <span className="min-w-[20px] h-5 px-1
            flex items-center justify-center
            bg-pink-500 text-white text-[11px] font-bold
            rounded-full shadow-sm ring-1 ring-[#0A1628]">
            {cap(a)}
          </span>
          {/* C (DMs) — small, red, below */}
          {c > 0 && (
            <span className="min-w-[16px] h-[14px] px-1 -mt-0.5
              flex items-center justify-center
              bg-rose-600 text-white text-[9px] leading-none font-semibold
              rounded-full shadow-sm ring-1 ring-[#0A1628]">
              {cap(c)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
