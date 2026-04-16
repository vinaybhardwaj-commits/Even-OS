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

import { useRef, useEffect, useCallback, useState } from 'react';
import { ChatMessage } from '@/providers/ChatProvider';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  onLoadOlder: () => Promise<boolean>;
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

export function MessageList({ messages, currentUserId, onLoadOlder }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const prevMsgCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  // Track if user is near bottom
  const handleScroll = useCallback(() => {
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
        // Preserve scroll position after prepending older messages
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
          }
        });
      });
    }
  }, [hasMore, isLoadingOlder, onLoadOlder]);

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

  // ── Render messages with grouping + date separators ────────
  let lastSenderId: string | null = null;
  let lastDateKey: string | null = null;

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

      {messages.map((msg) => {
        const dateKey = getDateKey(msg.created_at);
        const showDateSeparator = dateKey !== lastDateKey;
        const isSystem = msg.message_type === 'system';
        const showSender = !isSystem && (msg.sender_id !== lastSenderId || showDateSeparator);
        const isOwnMessage = msg.sender_id === currentUserId;

        // Update tracking
        lastDateKey = dateKey;
        if (!isSystem) lastSenderId = msg.sender_id;

        return (
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
              />
            )}
          </div>
        );
      })}

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
