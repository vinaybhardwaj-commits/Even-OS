'use client';

/**
 * MessageBubble — OC.3a + OC.3b (immutable chat)
 *
 * Single message row: initials avatar, sender name + role badge,
 * timestamp, type badge, message content with basic markdown.
 *
 * IMMUTABILITY RULES:
 * - Messages CANNOT be deleted or edited
 * - Messages CAN be retracted (strikethrough) with original preserved
 * - Retracted messages show original content struck-through + reason
 * - All actions are audit-logged server-side
 */

import { useState, useCallback } from 'react';
import { ChatMessage } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
import { TaskCard } from './TaskCard';
import { SlashResultCard } from './SlashResultCard';
import { trpcMutate } from '@/lib/chat/poll';

// ── Helpers ───────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function avatarColor(name: string): string {
  const colors = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function renderContent(text: string, strikethrough?: boolean): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    if (li > 0) parts.push(<br key={`br-${li}`} />);
    const segments = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    segments.forEach((seg, si) => {
      const key = `${li}-${si}`;
      if (seg.startsWith('**') && seg.endsWith('**')) {
        parts.push(<strong key={key} className="font-semibold">{seg.slice(2, -2)}</strong>);
      } else if (seg.startsWith('*') && seg.endsWith('*')) {
        parts.push(<em key={key}>{seg.slice(1, -1)}</em>);
      } else if (seg.startsWith('`') && seg.endsWith('`')) {
        parts.push(
          <code key={key} className="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">
            {seg.slice(1, -1)}
          </code>,
        );
      } else {
        parts.push(<span key={key}>{seg}</span>);
      }
    });
  });
  return parts;
}

// ── Component ─────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  showSender: boolean;
  channelType: string;
  channelId: string;
  currentUserId: string;
  onMessageUpdated?: () => void;
}

export function MessageBubble({ message, isOwnMessage, showSender, channelType, channelId, currentUserId, onMessageUpdated }: MessageBubbleProps) {
  const { id, sender_name, sender_department, sender_roles, message_type, content, created_at, is_retracted, retracted_reason } = message;

  // CHAT.X.0a — optimistic send status (temp rows carry metadata.status='sending' | 'failed')
  const sendStatus = (message.metadata as any)?.status as 'sending' | 'failed' | undefined;
  const isPending = sendStatus === 'sending';
  const isFailed = sendStatus === 'failed';

  const [showActions, setShowActions] = useState(false);
  const [showRetractModal, setShowRetractModal] = useState(false);
  const [retractReason, setRetractReason] = useState('');

  // ── Actions ────────────────────────────────────────────
  const handleRetract = useCallback(async () => {
    if (!retractReason.trim()) return;
    try {
      await trpcMutate('chat.retractMessage', { messageId: id, channelId, reason: retractReason.trim() });
      setShowRetractModal(false);
      setRetractReason('');
      onMessageUpdated?.();
    } catch (err) {
      console.error('[MessageBubble] Retract failed:', err);
    }
  }, [id, channelId, retractReason, onMessageUpdated]);

  // Only action available: retract own messages (all channel types)
  const canRetract = isOwnMessage && !is_retracted;

  const initials = getInitials(sender_name || 'U');
  const color = avatarColor(sender_name || 'User');
  const primaryRole = sender_roles?.[0];

  return (
    <>
      <div
        className={`group px-4 py-0.5 hover:bg-white/[0.03] transition-colors relative ${showSender ? 'mt-3' : 'mt-0'} ${isPending || isFailed ? 'opacity-60' : ''}`}
        onMouseEnter={() => canRetract && setShowActions(true)}
        onMouseLeave={() => { setShowActions(false); }}
      >
        <div className="flex gap-2.5">
          {/* Avatar */}
          <div className="w-8 shrink-0">
            {showSender ? (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
                style={{ background: color }}
              >
                {initials}
              </div>
            ) : (
              <div className="w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] text-white/30">{formatTime(created_at)}</span>
              </div>
            )}
          </div>

          {/* Message body */}
          <div className="flex-1 min-w-0">
            {showSender && (
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-sm font-semibold ${isOwnMessage ? 'text-blue-300' : 'text-white'}`}>
                  {sender_name}
                </span>
                {primaryRole && (
                  <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">
                    {primaryRole}
                  </span>
                )}
                {sender_department && (
                  <span className="text-[10px] text-white/30">
                    {sender_department}
                  </span>
                )}
                <MessageTypeBadge type={message_type} />
                <span className="text-[10px] text-white/30">
                  {formatTime(created_at)}
                </span>
              </div>
            )}

            {/* Content — retracted shows strikethrough with original preserved */}
            {is_retracted ? (
              <div>
                <div className="text-[13px] text-white/40 leading-relaxed break-words line-through decoration-amber-500/60">
                  {renderContent(content)}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[10px] text-amber-400 font-medium">Retracted by {sender_name}</span>
                  {retracted_reason && (
                    <span className="text-[10px] text-amber-300/50">— {retracted_reason}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-white/85 leading-relaxed break-words">
                {renderContent(content)}
              </div>
            )}

            {/* CHAT.X.0a.1 — send-status indicator (always renders, independent of showSender) */}
            {(isPending || isFailed) && (
              <div className="mt-0.5 flex items-center gap-1.5">
                {isPending && (
                  <span className="text-[10px] text-white/40 italic" title="Sending…">
                    sending…
                  </span>
                )}
                {isFailed && (
                  <span className="text-[10px] text-red-400 font-medium" title="Send failed — message stayed local">
                    ⚠ failed
                  </span>
                )}
              </div>
            )}

            {/* OC.5: Task card */}
            {message_type === 'task' && message.metadata && (
              <TaskCard
                messageId={id}
                metadata={message.metadata as any}
                currentUserId={currentUserId}
                onComplete={async (msgId) => {
                  await trpcMutate('chat.completeTask', { messageId: msgId });
                  onMessageUpdated?.();
                }}
              />
            )}

            {/* OC.5: Slash result card */}
            {message_type === 'slash_result' && message.metadata && (
              <SlashResultCard metadata={message.metadata as any} />
            )}

            {!showSender && message_type !== 'chat' && message_type !== 'task' && message_type !== 'slash_result' && (
              <div className="mt-0.5">
                <MessageTypeBadge type={message_type} />
              </div>
            )}
          </div>
        </div>

        {/* Action button — retract only (no edit, no delete) */}
        {showActions && (
          <div className="absolute top-0 right-4 -translate-y-1/2 flex gap-0.5 bg-[#1A2A40] border border-white/10 rounded-lg p-0.5 shadow-lg z-10">
            <button
              onClick={() => { setShowRetractModal(true); setShowActions(false); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-amber-500/10 text-white/40 hover:text-amber-400 transition-colors"
              title="Retract message (strikethrough — original preserved)"
            >
              ⏪
            </button>
          </div>
        )}
      </div>

      {/* Retraction modal */}
      {showRetractModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1A2A40] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-white/10">
            <h3 className="text-white font-semibold mb-1">Retract Message</h3>
            <p className="text-xs text-white/50 mb-4">
              The original message will be preserved but shown with a strikethrough.
              A retraction notice with your reason will appear below it. This action
              is logged in the audit trail and cannot be undone.
            </p>
            <textarea
              value={retractReason}
              onChange={e => setRetractReason(e.target.value)}
              placeholder="Reason for retraction (required)..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
                placeholder:text-white/25 outline-none resize-none mb-4"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRetractModal(false); setRetractReason(''); }}
                className="px-3 py-1.5 rounded text-sm text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRetract}
                disabled={!retractReason.trim()}
                className="px-3 py-1.5 rounded text-sm bg-amber-500 text-white disabled:opacity-30
                  hover:bg-amber-400 transition-colors"
              >
                Retract Message
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
