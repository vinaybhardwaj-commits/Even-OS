'use client';

/**
 * MessageBubble — OC.3a
 *
 * Single message row: initials avatar, sender name + role badge,
 * timestamp, type badge, message content with basic markdown.
 * Handles deleted, retracted, and edited states.
 */

import { ChatMessage } from '@/providers/ChatProvider';
import { MessageTypeBadge } from './MessageTypeBadge';

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

/** Deterministic pastel color from name string */
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

/**
 * Very lightweight markdown: **bold**, *italic*, `code`, line breaks.
 * Returns an array of React nodes.
 */
function renderContent(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split by line for line breaks
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    if (li > 0) parts.push(<br key={`br-${li}`} />);
    // Bold: **text**
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
  /** Show sender info (hidden when consecutive messages from same sender) */
  showSender: boolean;
}

export function MessageBubble({ message, isOwnMessage, showSender }: MessageBubbleProps) {
  const { sender_name, sender_department, sender_roles, message_type, content, created_at, is_edited, is_deleted, is_retracted, retracted_reason } = message;

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

  // ── Retracted message (patient channels — original preserved in DB) ─
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

  // ── Normal message ─────────────────────────────────────
  const initials = getInitials(sender_name || 'U');
  const color = avatarColor(sender_name || 'User');
  const primaryRole = sender_roles?.[0];

  return (
    <div className={`group px-4 py-0.5 hover:bg-white/[0.03] transition-colors ${showSender ? 'mt-3' : 'mt-0'}`}>
      <div className="flex gap-2.5">
        {/* Avatar — only shown on first message in a group */}
        <div className="w-8 shrink-0">
          {showSender ? (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
              style={{ background: color }}
            >
              {initials}
            </div>
          ) : (
            // Hover time on grouped messages
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

          {/* Content */}
          <div className="text-[13px] text-white/85 leading-relaxed break-words">
            {renderContent(content)}
            {is_edited && (
              <span className="text-[10px] text-white/30 ml-1">(edited)</span>
            )}
          </div>

          {/* Non-chat type badge on grouped messages (no sender row) */}
          {!showSender && message_type !== 'chat' && (
            <div className="mt-0.5">
              <MessageTypeBadge type={message_type} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
