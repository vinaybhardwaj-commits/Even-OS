'use client';

/**
 * MessageList — OC.3a + CHAT.X.2 + CHAT.X.0b
 *
 * Scrollable, virtualized container for chat messages.
 * - CHAT.X.0b: `useVirtualizer` with dynamic row heights (measureElement),
 *   overscan 5 — keeps DOM tiny even with thousands of messages.
 * - Auto-scrolls to bottom on new messages only if user is within 60px of
 *   bottom (PRD tightened from the old 120px threshold).
 * - Shows a "N new messages ↓" pill when new messages arrive while the user
 *   is scrolled up.
 * - Preserves scroll anchor (bottom-delta) when older messages load.
 * - Groups consecutive messages from same sender; date separators between
 *   different days.
 * - CHAT.X.2: IntersectionObserver on a bottom sentinel with 800ms timer
 *   + tab-visibility gate fires `onViewportRead` to mark channel read.
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChatMessage } from '@/providers/ChatProvider';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

const SCROLL_DEBOUNCE_MS = 50;
const NEAR_BOTTOM_PX = 60; // CHAT.X.0b — tightened from 120px
const ROW_ESTIMATE_PX = 72;
const OVERSCAN = 5;

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
   * mark the channel as read.
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
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toDateString();
}

// ── Component ───────────────────────────────────────────────

export function MessageList({
  messages,
  currentUserId,
  channelType,
  channelId,
  onLoadOlder,
  onMessageUpdated,
  onViewportRead,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const prevMsgCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const initialScrolledRef = useRef(false);

  // ── Pre-compute message display metadata ───────────────────
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

  // ── Virtualizer (CHAT.X.0b) ─────────────────────────────────
  const virtualizer = useVirtualizer({
    count: messageItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    // Use msg.id as the stable virtual-item key so indexes can shift on
    // prepend without remounting existing rows.
    getItemKey: (index) => messageItems[index]?.msg.id ?? index,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // ── Scroll handler: near-bottom tracking + load-older trigger ──
  const handleScrollRaw = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    isNearBottomRef.current = atBottom;
    if (atBottom && unseenCount !== 0) setUnseenCount(0);

    // Load older on scroll to top
    if (el.scrollTop < 80 && hasMore && !isLoadingOlder) {
      setIsLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      onLoadOlder()
        .then((more) => {
          setHasMore(more);
          setIsLoadingOlder(false);
          // Preserve scroll anchor: keep the same bottom-delta across prepend.
          // Double-rAF lets the virtualizer measure the newly-visible items
          // before we restore scrollTop.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const cur = scrollRef.current;
              if (cur) cur.scrollTop = cur.scrollHeight - prevHeight;
            });
          });
        })
        .catch(() => {
          setIsLoadingOlder(false);
        });
    }
  }, [hasMore, isLoadingOlder, onLoadOlder, unseenCount]);

  const handleScroll = useCallback(() => {
    // Fast-path: always track near-bottom immediately (so the pill hides
    // without waiting for the debounce to fire)
    const el = scrollRef.current;
    if (el) {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      isNearBottomRef.current = atBottom;
      if (atBottom && unseenCount !== 0) setUnseenCount(0);
    }
    // Debounce the expensive load-older check
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(handleScrollRaw, SCROLL_DEBOUNCE_MS);
  }, [handleScrollRaw, unseenCount]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  // ── Initial scroll to bottom (per channel) ──────────────────
  useEffect(() => {
    initialScrolledRef.current = false;
    setUnseenCount(0);
    isNearBottomRef.current = true;
    prevMsgCountRef.current = 0;
  }, [channelId]);

  useEffect(() => {
    if (initialScrolledRef.current) return;
    if (messageItems.length === 0) return;
    // Defer past first paint so the virtualizer has measured at least the
    // bottom overscan window — otherwise `scrollToIndex(end)` may land short.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        virtualizer.scrollToIndex(messageItems.length - 1, { align: 'end' });
        initialScrolledRef.current = true;
      });
      // no-op cleanup; the outer rAF cleanup cancels whichever is pending
      void raf2;
    });
    return () => cancelAnimationFrame(raf1);
  }, [channelId, messageItems.length, virtualizer]);

  // ── Auto-scroll on new message (or accumulate "N new" pill) ──
  useEffect(() => {
    const prev = prevMsgCountRef.current;
    const now = messages.length;
    if (now > prev && initialScrolledRef.current) {
      const newCount = now - prev;
      if (isNearBottomRef.current) {
        // Smooth-scroll to the newest message
        virtualizer.scrollToIndex(now - 1, { align: 'end', behavior: 'smooth' });
        // New messages viewed immediately — pill stays at 0
      } else {
        setUnseenCount((c) => c + newCount);
      }
    }
    prevMsgCountRef.current = now;
  }, [messages.length, virtualizer]);

  // ── CHAT.X.2 — Viewport-based mark-as-read ─────────────────
  // When the bottom sentinel is in view AND the tab is visible for 800ms
  // continuously, fire `onViewportRead`. Reset timer if scrolled away or
  // tab hidden. This is what flips "the user has actually seen this" vs
  // "the window is open but they tabbed away".
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMsgIdRef = useRef<number | null>(null);
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

    // Also re-evaluate when the tab returns to the foreground
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

  // Reset mark-read memo on channel switch
  useEffect(() => {
    latestMsgIdRef.current = null;
  }, [channelId]);

  // ── "N new messages ↓" pill handler ────────────────────────
  const scrollToBottom = useCallback(() => {
    if (messageItems.length > 0) {
      virtualizer.scrollToIndex(messageItems.length - 1, {
        align: 'end',
        behavior: 'smooth',
      });
    }
    setUnseenCount(0);
  }, [messageItems.length, virtualizer]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex-1 relative overflow-hidden bg-[#0D1B2A]">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto"
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

        {/* Empty state */}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/30">
            <div className="text-4xl mb-3">💬</div>
            <div className="text-sm">No messages yet</div>
            <div className="text-xs mt-1">Be the first to say something!</div>
          </div>
        ) : (
          <div
            style={{
              height: `${totalSize}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((vi) => {
              const item = messageItems[vi.index];
              if (!item) return null;
              const { msg, showDateSeparator, isSystem, showSender, isOwnMessage } = item;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
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
              );
            })}
          </div>
        )}

        {/* Scroll anchor + mark-read sentinel */}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* "N new messages ↓" pill — only when scrolled up and new msgs arrive */}
      {unseenCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10
            flex items-center gap-1.5 px-3 py-1.5
            bg-pink-500 hover:bg-pink-600 text-white text-xs font-semibold
            rounded-full shadow-lg shadow-black/40 transition-all
            ring-1 ring-white/10"
          aria-label={`Scroll to ${unseenCount} new message${unseenCount === 1 ? '' : 's'}`}
        >
          {unseenCount > 99 ? '99+' : unseenCount} new message{unseenCount === 1 ? '' : 's'} ↓
        </button>
      )}
    </div>
  );
}
