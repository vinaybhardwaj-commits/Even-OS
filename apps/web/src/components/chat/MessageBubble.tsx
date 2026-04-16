'use client';

/**
 * MessageBubble — OC.3a + OC.3b
 *
 * Single message row: initials avatar, sender name + role badge,
 * timestamp, type badge, message content with basic markdown.
 * Handles deleted, retracted, and edited states.
 * OC.3b: action menu (edit, delete, retract) + inline edit mode.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatMessage } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';
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

function renderContent(text: string): React.ReactNode[] {
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

/** Check if message is within 24h edit window */
function isWithinEditWindow(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

// ── Component ─────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  showSender: boolean;
  channelType: string;
  channelId: string;
  onMessageUpdated?: () => void;
}

export function MessageBubble({ message, isOwnMessage, showSender, channelType, channelId, onMessageUpdated }: MessageBubbleProps) {
  const { id, sender_name, sender_department, sender_roles, message_type, content, created_at, is_edited, is_deleted, is_retracted, retracted_reason } = message;

  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [showRetractModal, setShowRetractModal] = useState(false);
  const [retractReason, setRetractReason] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Focus edit textarea when entering edit mode
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [isEditing]);

  // ── Actions ────────────────────────────────────────────
  const handleEdit = useCallback(async () => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === content) {
      setIsEditing(false);
      return;
    }
    try {
      await trpcMutate('chat.editMessage', { messageId: id, channelId, content: trimmed });
      setIsEditing(false);
      onMessageUpdated?.();
    } catch (err) {
      console.error('[MessageBubble] Edit failed:', err);
    }
  }, [id, channelId, editContent, content, onMessageUpdated]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this message?')) return;
    try {
      await trpcMutate('chat.deleteMessage', { messageId: id, channelId });
      onMessageUpdated?.();
    } catch (err) {
      console.error('[MessageBubble] Delete failed:', err);
    }
    setShowActions(false);
  }, [id, channelId, onMessageUpdated]);

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

  // ── Deleted message ─────────────────────────────────────
  if (is_deleted) {
    return (
      <div className="px-4 py-1">
        <div className="text-xs text-white/30 italic ml-10">
          [Message deleted]
        </div>
      </div>
    );
  }

  // ── Retracted message ─────────────────────────────────
  if (is_retracted) {
    return (
      <div className="px-4 py-1">
        <div className="ml-10 rounded-lg bg-amber-900/20 border border-amber-500/20 px-3 py-2">
          <div className="text-[11px] text-amber-400 font-medium">
            Message retracted by {sender_name}
          </div>
          {retracted_reason && (
            <div className="text-[11px] text-amber-300/60 mt-0.5">
              Reason: {retracted_reason}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Determine available actions ────────────────────────
  const canEdit = isOwnMessage && channelType !== 'patient' && isWithinEditWindow(created_at);
  const canDelete = isOwnMessage && channelType !== 'patient';
  const canRetract = isOwnMessage && channelType === 'patient';
  const hasActions = canEdit || canDelete || canRetract;

  const initials = getInitials(sender_name || 'U');
  const color = avatarColor(sender_name || 'User');
  const primaryRole = sender_roles?.[0];

  return (
    <>
      <div
        className={`group px-4 py-0.5 hover:bg-white/[0.03] transition-colors relative ${showSender ? 'mt-3' : 'mt-0'}`}
        onMouseEnter={() => hasActions && setShowActions(true)}
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

            {/* Content — edit mode or display mode */}
            {isEditing ? (
              <div className="mt-1">
                <textarea
                  ref={editRef}
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(); }
                    if (e.key === 'Escape') { setIsEditing(false); setEditContent(content); }
                  }}
                  className="w-full bg-white/5 border border-blue-500/30 rounded px-2 py-1.5 text-[13px] text-white
                    outline-none resize-none"
                  rows={2}
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={handleEdit}
                    className="text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    Save (Enter)
                  </button>
                  <button
                    onClick={() => { setIsEditing(false); setEditContent(content); }}
                    className="text-[10px] text-white/40 hover:text-white/60"
                  >
                    Cancel (Esc)
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-white/85 leading-relaxed break-words">
                {renderContent(content)}
                {is_edited && (
                  <span className="text-[10px] text-white/30 ml-1">(edited)</span>
                )}
              </div>
            )}

            {!showSender && message_type !== 'chat' && (
              <div className="mt-0.5">
                <MessageTypeBadge type={message_type} />
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — hover tooltip bar */}
        {showActions && !isEditing && (
          <div className="absolute top-0 right-4 -translate-y-1/2 flex gap-0.5 bg-[#1A2A40] border border-white/10 rounded-lg p-0.5 shadow-lg z-10">
            {canEdit && (
              <button
                onClick={() => { setIsEditing(true); setEditContent(content); setShowActions(false); }}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
                title="Edit"
              >
                ✏️
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors"
                title="Delete"
              >
                🗑️
              </button>
            )}
            {canRetract && (
              <button
                onClick={() => { setShowRetractModal(true); setShowActions(false); }}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-amber-500/10 text-white/40 hover:text-amber-400 transition-colors"
                title="Retract (medical record)"
              >
                ⏪
              </button>
            )}
          </div>
        )}
      </div>

      {/* Retraction modal */}
      {showRetractModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1A2A40] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-white/10">
            <h3 className="text-white font-semibold mb-1">Retract Message</h3>
            <p className="text-xs text-white/50 mb-4">
              This is a patient channel. The original message will be preserved in the medical record
              but hidden from view. A retraction notice will appear in its place.
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
