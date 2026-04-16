'use client';

/**
 * MessageComposer — OC.3b
 *
 * Auto-resizing textarea with:
 * - Message type selector dropdown (chat, request, update, escalation, etc.)
 * - Send button (Enter to send, Shift+Enter for newline)
 * - Typing indicator push (debounced)
 * - Priority selector for escalation/request types
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────

interface MessageComposerProps {
  channelId: string;
  channelType: string;
  onSend: (params: {
    channelId: string;
    content: string;
    messageType?: string;
    priority?: string;
  }) => Promise<any>;
  onTyping: (channelId: string, isTyping: boolean) => Promise<void>;
}

const MESSAGE_TYPES = [
  { value: 'chat',            label: 'Chat',            icon: '💬', color: 'text-white/60' },
  { value: 'request',         label: 'Request',         icon: '📋', color: 'text-blue-400' },
  { value: 'update',          label: 'Update',          icon: '📢', color: 'text-green-400' },
  { value: 'escalation',      label: 'Escalation',      icon: '🚨', color: 'text-red-400' },
  { value: 'fyi',             label: 'FYI',             icon: 'ℹ️', color: 'text-gray-400' },
  { value: 'decision_needed', label: 'Decision Needed', icon: '⚖️', color: 'text-amber-400' },
  { value: 'handoff',         label: 'Handoff',         icon: '🤝', color: 'text-purple-400' },
];

const PRIORITY_OPTIONS = [
  { value: 'normal',   label: 'Normal' },
  { value: 'high',     label: 'High' },
  { value: 'urgent',   label: 'Urgent' },
  { value: 'stat',     label: 'STAT' },
];

// ── Component ─────────────────────────────────────────────

export function MessageComposer({ channelId, channelType, onSend, onTyping }: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [messageType, setMessageType] = useState('chat');
  const [priority, setPriority] = useState('normal');
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, []);

  // ── Typing indicator management ────────────────────────
  const startTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTyping(channelId, true).catch(() => {});
    }
    // Reset stop timer
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      onTyping(channelId, false).catch(() => {});
    }, 3000);
  }, [channelId, onTyping]);

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping(channelId, false).catch(() => {});
    }
  }, [channelId, onTyping]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  // ── Send handler ───────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    stopTyping();

    try {
      await onSend({
        channelId,
        content: trimmed,
        messageType: messageType !== 'chat' ? messageType : undefined,
        priority: priority !== 'normal' ? priority : undefined,
      });
      setContent('');
      setMessageType('chat');
      setPriority('normal');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      console.error('[Composer] Send failed:', err);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }, [content, isSending, channelId, messageType, priority, onSend, stopTyping]);

  // ── Keyboard handling ──────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      resize();
      if (e.target.value.trim()) {
        startTyping();
      }
    },
    [resize, startTyping],
  );

  const selectedType = MESSAGE_TYPES.find(t => t.value === messageType) || MESSAGE_TYPES[0];
  const showPriority = messageType === 'escalation' || messageType === 'request';

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#0A1628]">
      {/* Type selector row */}
      <div className="flex items-center gap-2 px-4 pt-2 pb-1">
        {/* Message type button */}
        <div className="relative">
          <button
            onClick={() => setShowTypeMenu(!showTypeMenu)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
              ${messageType !== 'chat' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
          >
            <span>{selectedType.icon}</span>
            <span>{selectedType.label}</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {/* Dropdown */}
          {showTypeMenu && (
            <div className="absolute bottom-full left-0 mb-1 bg-[#1A2A40] border border-white/10 rounded-lg shadow-xl py-1 min-w-[180px] z-50">
              {MESSAGE_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => {
                    setMessageType(t.value);
                    setShowTypeMenu(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 transition-colors
                    ${t.value === messageType ? 'bg-white/10 text-white' : 'text-white/60'}`}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority selector (only for escalation/request) */}
        {showPriority && (
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none"
          >
            {PRIORITY_OPTIONS.map(p => (
              <option key={p.value} value={p.value} className="bg-[#0A1628]">
                {p.label}
              </option>
            ))}
          </select>
        )}

        {/* Patient channel info */}
        {channelType === 'patient' && (
          <span className="text-[10px] text-emerald-400/60 ml-auto">
            🔒 Medical record — messages cannot be deleted
          </span>
        )}
      </div>

      {/* Textarea + send */}
      <div className="flex items-end gap-2 px-4 pb-3">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows={1}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
            placeholder:text-white/25 outline-none resize-none
            focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20
            transition-colors"
          style={{ minHeight: 38, maxHeight: 160 }}
          disabled={isSending}
        />
        <button
          onClick={handleSend}
          disabled={!content.trim() || isSending}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg
            bg-blue-500 text-white disabled:opacity-30 disabled:cursor-not-allowed
            hover:bg-blue-400 transition-colors"
          title="Send (Enter)"
        >
          {isSending ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
