'use client';

/**
 * MessageComposer — OC.3b + OC.4c
 *
 * Auto-resizing textarea with:
 * - Message type selector dropdown (chat, request, update, escalation, etc.)
 * - Send button (Enter to send, Shift+Enter for newline)
 * - Typing indicator push (debounced)
 * - Priority selector for escalation/request types
 * - File attachment upload (OC.4c)
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { SlashCommandMenu } from './SlashCommandMenu';

// ── Types ─────────────────────────────────────────────────

interface AttachmentPreview {
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  thumbnail_url?: string;
}

interface SlashCommandDef {
  name: string;
  description: string;
  usage: string;
  icon: string;
}

interface MessageComposerProps {
  channelId: string;
  channelType: string;
  slashCommands?: SlashCommandDef[];
  onSend: (params: {
    channelId: string;
    content: string;
    messageType?: string;
    priority?: string;
    attachments?: AttachmentPreview[];
  }) => Promise<any>;
  onSlashCommand?: (channelId: string, commandText: string) => Promise<any>;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Component ─────────────────────────────────────────────

export function MessageComposer({ channelId, channelType, slashCommands, onSend, onSlashCommand, onTyping }: MessageComposerProps) {
  const [content, setContent] = useState('');
  const [messageType, setMessageType] = useState('chat');
  const [priority, setPriority] = useState('normal');
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // ── File upload handler ────────────────────────────────
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          console.warn(`[Composer] File too large (${(file.size / 1024 / 1024).toFixed(1)}MB): ${file.name}`);
          continue;
        }
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/chat/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          console.error('[Composer] Upload failed:', err.error);
          continue;
        }

        const data = await res.json();
        setAttachments(prev => [...prev, {
          file_name: data.file_name,
          file_type: data.file_type,
          file_size: data.file_size,
          file_url: data.file_url,
          thumbnail_url: data.thumbnail_url,
        }]);
      }
    } catch (err) {
      console.error('[Composer] Upload error:', err);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── Slash command selection ──────────────────────────────
  const handleSlashSelect = useCallback((commandName: string) => {
    setContent(`/${commandName} `);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  }, []);

  // ── Send handler ───────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || isSending) return;

    setIsSending(true);
    stopTyping();
    setShowSlashMenu(false);

    try {
      // Detect slash command
      if (trimmed.startsWith('/') && onSlashCommand) {
        await onSlashCommand(channelId, trimmed);
      } else {
        await onSend({
          channelId,
          content: trimmed || (attachments.length > 0 ? `📎 ${attachments.map(a => a.file_name).join(', ')}` : ''),
          messageType: messageType !== 'chat' ? messageType : undefined,
          priority: priority !== 'normal' ? priority : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }
      setContent('');
      setMessageType('chat');
      setPriority('normal');
      setAttachments([]);
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
  }, [content, attachments, isSending, channelId, messageType, priority, onSend, onSlashCommand, stopTyping]);

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
      const val = e.target.value;
      setContent(val);
      resize();

      // Slash command detection
      if (val.startsWith('/') && !val.includes('\n') && slashCommands && slashCommands.length > 0) {
        const spaceIdx = val.indexOf(' ');
        const query = spaceIdx === -1 ? val.slice(1) : '';
        if (spaceIdx === -1) {
          setSlashQuery(query);
          setShowSlashMenu(true);
        } else {
          setShowSlashMenu(false);
        }
      } else {
        setShowSlashMenu(false);
      }

      if (val.trim()) {
        startTyping();
      }
    },
    [resize, startTyping, slashCommands],
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

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
              {att.file_type.startsWith('image/') && att.thumbnail_url ? (
                <img src={att.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover" />
              ) : (
                <span className="text-lg">
                  {att.file_type === 'application/pdf' ? '📄' : '📎'}
                </span>
              )}
              <div className="flex flex-col">
                <span className="text-white/80 truncate max-w-[120px]">{att.file_name}</span>
                <span className="text-white/30">{formatFileSize(att.file_size)}</span>
              </div>
              <button
                onClick={() => removeAttachment(i)}
                className="text-white/30 hover:text-red-400 transition-colors ml-1"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea + attach + send */}
      <div className="relative flex items-end gap-2 px-4 pb-3">
        {/* Slash command autocomplete menu */}
        {slashCommands && slashCommands.length > 0 && (
          <SlashCommandMenu
            query={slashQuery}
            commands={slashCommands}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashMenu(false)}
            visible={showSlashMenu}
          />
        )}
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          multiple
          className="hidden"
        />

        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg
            text-white/40 hover:text-white/70 hover:bg-white/5
            disabled:opacity-30 transition-colors"
          title="Attach file"
        >
          {isUploading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>

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
          disabled={(!content.trim() && attachments.length === 0) || isSending}
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
