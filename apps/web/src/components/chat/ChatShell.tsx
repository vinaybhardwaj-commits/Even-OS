'use client';

/**
 * ChatShell — OC.2a
 *
 * Root container for the omnipresent chat system. Manages 3 states:
 *
 *   1. COLLAPSED: Only ChatToggleButton visible (floating left edge).
 *      Content renders at full width.
 *
 *   2. SIDEBAR: 300px dark blue panel slides from left.
 *      Content pushes right and reflows responsively.
 *
 *   3. CHATROOM: Chat takes over the main content area.
 *      Sidebar remains visible. "Back to HIS" button to return.
 *
 * CSS transitions for smooth 300ms slide animation.
 * Keyboard shortcut: Ctrl+Shift+M toggles sidebar.
 */

import { useEffect, useCallback } from 'react';
import { useChat } from '@/providers/ChatProvider';
import { ChatToggleButton } from './ChatToggleButton';
import { ChatSidebar } from './ChatSidebar';
import { ChatRoom } from './ChatRoom';

const SIDEBAR_WIDTH = 300;

export function ChatShell({ children }: { children: React.ReactNode }) {
  const { chatState, setChatState, isAuthenticated, isLoading } = useChat();

  const isSidebarOpen = chatState === 'sidebar' || chatState === 'chatroom';

  // ── Keyboard shortcut: Ctrl+Shift+M ──────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        if (chatState === 'collapsed') {
          setChatState('sidebar');
        } else {
          setChatState('collapsed');
        }
      }
      // Ctrl+Shift+N — new DM
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        if (chatState === 'collapsed') setChatState('sidebar');
        // Dispatch event for ChatSidebar to open the DM picker
        window.dispatchEvent(new CustomEvent('open-new-dm'));
      }
      // Escape closes sidebar/chatroom
      if (e.key === 'Escape' && isSidebarOpen) {
        setChatState('collapsed');
      }
    },
    [chatState, setChatState, isSidebarOpen],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Don't render chat UI for unauthenticated users
  const showChat = isAuthenticated && !isLoading;

  return (
    <>
      {/* ── Sidebar panel (slides from left) ──────────────────── */}
      {showChat && (
        <div
          className="fixed top-0 left-0 h-full z-40 flex flex-col
            bg-[#0A1628] text-white shadow-2xl
            transition-transform duration-300 ease-in-out"
          style={{
            width: SIDEBAR_WIDTH,
            transform: isSidebarOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
          }}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5 text-blue-400"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="font-semibold text-sm tracking-wide">EVEN CHAT</span>
            </div>
            <button
              onClick={() => setChatState('collapsed')}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Close chat sidebar"
              title="Close (Esc)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>

          {/* Sidebar body — channel list (OC.2b) */}
          <div className="flex-1 overflow-y-auto py-2">
            <ChatSidebar />
          </div>

          {/* Sidebar footer — user presence indicator */}
          <div className="px-4 py-2 border-t border-white/10 text-xs text-white/50 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              <span>Online</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Toggle button (collapsed state only) ──────────────── */}
      {showChat && <ChatToggleButton />}

      {/* ── Main content wrapper (pushes right when sidebar open) ─ */}
      <div
        className="transition-[margin-left] duration-300 ease-in-out min-h-screen"
        style={{
          marginLeft: showChat && isSidebarOpen ? SIDEBAR_WIDTH : 0,
          containerType: 'inline-size',
        }}
      >
        {/* State 3: chatroom replaces main content; State 1/2: normal page */}
        {showChat && chatState === 'chatroom' ? (
          <div className="h-screen">
            <ChatRoom />
          </div>
        ) : (
          children
        )}
      </div>
    </>
  );
}
