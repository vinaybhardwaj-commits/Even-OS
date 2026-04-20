'use client';

/**
 * ChatRoomHeader — OC.3a
 *
 * Channel name, member count, channel type icon, and
 * "← Back to [Page Name]" button. Page name read from pathname.
 */

import { useState, useCallback } from 'react';
import { ChatChannel } from '@/providers/ChatProvider';
import { trpcMutate } from '@/lib/chat/poll';

interface ChatRoomHeaderProps {
  channel: ChatChannel;
  onBack: () => void;
  /** CHAT.X.6 UI.b — when true, render the Messages / Tasks tab pill. */
  showTabs?: boolean;
  roomView?: 'messages' | 'tasks';
  onRoomViewChange?: (view: 'messages' | 'tasks') => void;
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

export function ChatRoomHeader({
  channel,
  onBack,
  showTabs = false,
  roomView = 'messages',
  onRoomViewChange,
}: ChatRoomHeaderProps) {
  const [showMuteMenu, setShowMuteMenu] = useState(false);
  const [isMuted, setIsMuted] = useState(channel.is_muted);

  const handleMute = useCallback(async (duration: string) => {
    try {
      await trpcMutate('chat.muteChannel', { channelId: channel.channel_id, duration });
      setIsMuted(duration !== 'unmute');
    } catch (err) {
      console.error('[ChatRoomHeader] Mute failed:', err);
    }
    setShowMuteMenu(false);
  }, [channel.channel_id]);

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

      {/* Tabs (CHAT.X.6 UI.b — Messages / Tasks) — patient channels only */}
      {showTabs && onRoomViewChange && (
        <div className="flex items-center rounded-md border border-white/10 bg-white/5 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onRoomViewChange('messages')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              roomView === 'messages' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Messages
          </button>
          <button
            type="button"
            onClick={() => onRoomViewChange('tasks')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              roomView === 'tasks' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Tasks
          </button>
        </div>
      )}

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

      {/* Mute/bell button */}
      <div className="relative shrink-0">
        <button
          onClick={() => isMuted ? handleMute('unmute') : setShowMuteMenu(!showMuteMenu)}
          className={`p-1.5 rounded-lg transition-colors
            ${isMuted ? 'text-amber-400 hover:bg-amber-400/10' : 'text-white/40 hover:bg-white/10 hover:text-white/70'}`}
          title={isMuted ? 'Unmute channel' : 'Mute channel'}
        >
          {isMuted ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              className="w-4 h-4">
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
              <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
              <path d="M18 8a6 6 0 0 0-9.33-5" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              className="w-4 h-4">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          )}
        </button>

        {/* Mute duration menu */}
        {showMuteMenu && (
          <div className="absolute right-0 top-full mt-1 w-36 bg-[#1A2744] border border-white/10 rounded-lg shadow-xl py-1 z-50">
            {[
              { label: '1 hour', value: '1h' },
              { label: '8 hours', value: '8h' },
              { label: '24 hours', value: '24h' },
              { label: '7 days', value: '7d' },
              { label: 'Until I unmute', value: 'forever' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => handleMute(opt.value)}
                className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
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
