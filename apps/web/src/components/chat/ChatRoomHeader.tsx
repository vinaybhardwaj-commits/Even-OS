'use client';

/**
 * ChatRoomHeader — OC.3a
 *
 * Channel name, member count, channel type icon, and
 * "← Back to [Page Name]" button. Page name read from pathname.
 */

import { ChatChannel } from '@/providers/ChatProvider';

interface ChatRoomHeaderProps {
  channel: ChatChannel;
  onBack: () => void;
}

function channelIcon(type: string): string {
  switch (type) {
    case 'patient': return '∿';
    case 'direct': return '●';
    case 'broadcast': return '📢';
    default: return '#';
  }
}

function channelIconColor(type: string): string {
  switch (type) {
    case 'patient': return 'text-emerald-400';
    case 'direct': return 'text-blue-400';
    case 'broadcast': return 'text-amber-400';
    default: return 'text-white/50';
  }
}

export function ChatRoomHeader({ channel, onBack }: ChatRoomHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 h-12 border-b border-white/10 shrink-0 bg-[#0A1628]">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors shrink-0"
        title="Back to sidebar"
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
        <span className="text-xs">Back</span>
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-white/10" />

      {/* Channel info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={`text-base ${channelIconColor(channel.channel_type)}`}>
          {channelIcon(channel.channel_type)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">
            {channel.name}
          </div>
        </div>
      </div>

      {/* Member count */}
      <div className="flex items-center gap-1 text-xs text-white/40 shrink-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>{channel.member_count}</span>
      </div>

      {/* Patient channel indicator */}
      {channel.channel_type === 'patient' && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-medium shrink-0">
          <span>🔒</span>
          <span>Medical Record</span>
        </div>
      )}
    </div>
  );
}
