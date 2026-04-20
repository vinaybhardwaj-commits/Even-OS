'use client';

/**
 * MessageList — OC.3a
 *
 * Scrollable container for chat messages.
 * - Auto-scrolls to bottom on new messages (if already near bottom)
 * - Scroll-up triggers loading older messages (cursor pagination)
 * - Groups consecutive messages from same sender (hides repeated avatar/name)
 * - Date separators between different days
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { ChatMessage } from '@/providers/ChatProvider';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

const SCROLL_DEBOUNCE_MS = 50;

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  channelType: string;
  channelId: string;
  onLoadOlder: () => Promise<boolean>;
  onMessageUpdated?: () => void;
  /**
   * CHAT.X.2 — Fired when the bottom of the message list has been
   * continuously visible in the viewport for ~800ms. Consumer should
   * mark the channel as read. Debounced + resets on every newest-message
   * change so only the *latest* bottom triggers.
   */
  onViewportRead?: () => void;
}

// ── Helpers ─────────────────────────────────────────────────

function formatDateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = today.getTime() - msgDay.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toDateString();
}

// ── Component ───────────────────────────────────────────────

export function MessageList({ messages, currentUserId, channelType, channelId, onLoadOlder, onMessageUpdated, onViewportRead }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const prevMsgCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced scroll handler for performance
  const handleScrollRaw = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 120;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    // Load older on scroll to top
    if (el.scrollTop < 80 && hasMore && !isLoadingOlder) {
      setIsLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      onLoadOlder().then((more) => {
        setHasMore(more);
        setIsLoadingOlder(false);
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
          }
        });
      });
    }
  }, [hasMore, isLoadingOlder, onLoadOlder]);

  const handleScroll = useCallback(() => {
    // Fast-path: always track near-bottom immediately
    const el = scrollRef.current;
    if (el) {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    }
    // Debounce the expensive load-older check
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(handleScrollRaw, SCROLL_DEBOUNCE_MS);
  }, [handleScrollRaw]);

  useEffect(() => {
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
  }, []);

  // Auto-scroll to bottom when new messages arrive (only if near bottom)
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  // Initial scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  // ── CHAT.X.2 — Viewport-based mark-as-read ─────────────────
  // When the bottom sentinel is in view AND the tab is visible for 800ms
  // continuously, fire `onViewportRead`. Reset timer if scrolled away or
  // tab hidden. This is what flips "the user has actually seen this" vs
  // "the window is open but they tabbed away".
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMsgIdRef = useRef<number | null>(null);
  // Track newest message id so we reset the timer only when newer content arrives
  const newestId = messages.length > 0 ? messages[messages.length - 1].id : null;

  useEffect(() => {
    if (!onViewportRead || !bottomRef.current) return;
    const node = bottomRef.current;

    const clearTimer = () => {
      if (viewportTimerRef.current) {
        clearTimeout(viewportTimerRef.current);
        viewportTimerRef.current = null;
      }
    };

    const scheduleMark = () => {
      if (viewportTimerRef.current) return; // already scheduled
      viewportTimerRef.current = setTimeout(() => {
        viewportTimerRef.current = null;
        // Only fire if the bottom is *still* the current newest we saw
        // and the tab is still visible.
        if (
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          newestId !== null &&
          latestMsgIdRef.current !== newestId
        ) {
          latestMsgIdRef.current = newestId;
          onViewportRead();
        }
      }, 800);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && document.visibilityState === 'visible') {
            scheduleMark();
          } else {
            clearTimer();
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);

    // Also re-evaluate when the tab returns to the foreground: if the
    // bottom sentinel is still on screen, re-schedule.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const rect = node.getBoundingClientRect();
        const inView = rect.top < (window.innerHeight || 0) && rect.bottom > 0;
        if (inView) scheduleMark();
      } else {
        clearTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
    };
  }, [onViewportRead, newestId]);

  // When switching channels, reset the "already marked" memo so the new
  // channel gets a fresh viewport-read cycle.
  useEffect(() => {
    latestMsgIdRef.current = null;
  }, [channelId]);

  // ── Pre-compute message display metadata (memoized) ────────
  const messageItems = useMemo(() => {
    let lastSenderId: string | null = null;
    let lastDateKey: string | null = null;

    return messages.map((msg) => {
      const dateKey = getDateKey(msg.created_at);
      const showDateSeparator = dateKey !== lastDateKey;
      const isSystem = msg.message_type === 'system';
      const showSender = !isSystem && (msg.sender_id !== lastSenderId || showDateSeparator);
      const isOwnMessage = msg.sender_id === currentUserId;

      lastDateKey = dateKey;
      if (!isSystem) lastSenderId = msg.sender_id;

      return { msg, dateKey, showDateSeparator, isSystem, showSender, isOwnMessage };
    });
  }, [messages, currentUserId]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto"
      onScroll={handleScroll}
    >
      {/* Loading older indicator */}
      {isLoadingOlder && (
        <div className="text-center py-3">
          <span className="text-xs text-white/40">Loading older messages...</span>
        </div>
      )}
      {!hasMore && messages.length > 0 && (
        <div className="text-center py-3">
          <span className="text-xs text-white/30">Beginning of conversation</span>
        </div>
      )}

      {messageItems.map(({ msg, showDateSeparator, isSystem, showSender, isOwnMessage }) => (
        <div key={msg.id}>
          {/* Date separator */}
          {showDateSeparator && (
            <div className="flex items-center gap-3 py-3 px-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[11px] text-white/40 font-medium">
                {formatDateSeparator(msg.created_at)}
              </span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          )}

          {/* Message */}
          {isSystem ? (
            <SystemMessage content={msg.content} timestamp={msg.created_at} />
          ) : (
            <MessageBubble
              message={msg}
              isOwnMessage={isOwnMessage}
              showSender={showSender}
              channelType={channelType}
              channelId={channelId}
              currentUserId={currentUserId}
              onMessageUpdated={onMessageUpdated}
            />
          )}
        </div>
      ))}

      {/* Empty state */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-white/30">
          <div className="text-4xl mb-3">💬</div>
          <div className="text-sm">No messages yet</div>
          <div className="text-xs mt-1">Be the first to say something!</div>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
