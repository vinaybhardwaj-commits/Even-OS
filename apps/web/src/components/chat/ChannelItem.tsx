'use client';

/**
 * ChannelItem — OC.2b
 *
 * Single channel row in the sidebar. Shows:
 * - Channel icon (based on type)
 * - Channel name (bold if unread)
 * - Last message preview (truncated)
 * - Relative timestamp
 * - Pink unread count badge (Rounds style)
 * - Muted/pinned indicators
 */

import type { ChatChannel } from '@/providers/ChatProvider';

interface ChannelItemProps {
  channel: ChatChannel;
  isActive: boolean;
  onClick: (channelId: string) => void;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function channelIcon(type: string): string {
  switch (type) {
    case 'department': return '#';
    case 'patient': return '∿';
    case 'direct': return '●';
    case 'broadcast': return '📢';
    default: return '#';
  }
}

export function ChannelItem({ channel, isActive, onClick }: ChannelItemProps) {
  const hasUnread = channel.unread_count > 0;

  return (
    <button
      onClick={() => onClick(channel.channel_id)}
      className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left
        transition-colors duration-100 group
        ${isActive
          ? 'bg-blue-500/20 text-white'
          : 'hover:bg-white/8 text-white/80 hover:text-white'
        }`}
    >
      {/* Channel type icon */}
      <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs mt-0.5
        ${channel.channel_type === 'patient' ? 'bg-emerald-500/20 text-emerald-400' :
          channel.channel_type === 'direct' ? 'bg-blue-500/20 text-blue-400' :
          channel.channel_type === 'broadcast' ? 'text-amber-400' :
          'bg-white/10 text-white/50'}`}
      >
        {channelIcon(channel.channel_type)}
      </span>

      {/* Name + preview */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className={`text-[13px] leading-tight truncate
            ${hasUnread ? 'font-semibold text-white' : 'font-normal'}`}>
            {channel.name}
          </span>
          <span className="text-[10px] text-white/30 shrink-0">
            {relativeTime(channel.last_message_at)}
          </span>
        </div>

        {/* Bottom row: muted indicator + unread badge */}
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 text-[11px] text-white/30 truncate">
            {channel.is_muted && (
              <span title="Muted">🔇</span>
            )}
            {channel.is_pinned && (
              <span title="Pinned">📌</span>
            )}
            {channel.member_count > 0 && (
              <span>{channel.member_count} members</span>
            )}
          </div>

          {/* Unread badge (pink, like Rounds) */}
          {hasUnread && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1
              flex items-center justify-center
              bg-pink-500 text-white text-[10px] font-bold
              rounded-full">
              {channel.unread_count > 99 ? '99+' : channel.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
