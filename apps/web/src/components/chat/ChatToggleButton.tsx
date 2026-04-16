'use client';

/**
 * ChatToggleButton — OC.2a
 *
 * Floating button pinned to the left edge of the viewport (vertically centered).
 * Shows chat icon + unread count badge. Click toggles sidebar open/closed.
 * Only visible in the "collapsed" state (hidden when sidebar is open).
 */

import { useChat } from '@/providers/ChatProvider';

export function ChatToggleButton() {
  const { chatState, setChatState, unreadTotal, isAuthenticated, isLoading } = useChat();

  // Don't render if not authenticated or still loading
  if (!isAuthenticated || isLoading) return null;

  // Hide when sidebar or chatroom is open (ChatShell handles those states)
  if (chatState !== 'collapsed') return null;

  return (
    <button
      onClick={() => setChatState('sidebar')}
      className="fixed left-0 top-1/2 -translate-y-1/2 z-50
        flex items-center gap-1.5 px-2.5 py-3
        bg-[#0A1628] hover:bg-[#132040] text-white
        rounded-r-xl shadow-lg hover:shadow-xl
        transition-all duration-200 ease-out
        hover:pl-3.5 group"
      aria-label={`Open chat${unreadTotal > 0 ? ` (${unreadTotal} unread)` : ''}`}
      title="Open chat (Ctrl+Shift+M)"
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

      {/* Unread badge */}
      {unreadTotal > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1
          flex items-center justify-center
          bg-pink-500 text-white text-[11px] font-bold
          rounded-full shadow-sm">
          {unreadTotal > 99 ? '99+' : unreadTotal}
        </span>
      )}
    </button>
  );
}
