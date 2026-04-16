'use client';

/**
 * ChannelGroups — OC.2b
 *
 * Renders channels in collapsible sections:
 *   ∿  My Patients   — patient channels (active encounters)
 *   #  Departments    — department channels
 *   ●  Direct Messages — DM channels
 *   📢  Broadcast      — broadcast channels
 *
 * Collapse state persisted in sessionStorage.
 * Channels sorted by last_message_at DESC; unread float to top.
 */

import { useState, useCallback, useEffect } from 'react';
import type { ChatChannel, ChannelGroups as ChannelGroupsType } from '@/providers/ChatProvider';
import { ChannelItem } from './ChannelItem';

interface ChannelGroupsProps {
  groups: ChannelGroupsType;
  activeChannelId: string | null;
  searchQuery: string;
  onChannelClick: (channelId: string) => void;
}

interface GroupConfig {
  key: keyof ChannelGroupsType;
  label: string;
  icon: string;
  iconClass: string;
}

const GROUP_CONFIG: GroupConfig[] = [
  { key: 'my_patients', label: 'My Patients', icon: '∿', iconClass: 'text-emerald-400' },
  { key: 'departments', label: 'Departments', icon: '#', iconClass: 'text-white/50' },
  { key: 'direct_messages', label: 'Direct Messages', icon: '●', iconClass: 'text-blue-400' },
  { key: 'broadcast', label: 'Broadcast', icon: '📢', iconClass: '' },
];

const STORAGE_KEY = 'even_chat_collapsed_groups';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCollapsed(state: Record<string, boolean>) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

function sortChannels(channels: ChatChannel[]): ChatChannel[] {
  return [...channels].sort((a, b) => {
    // Unread first
    if (a.unread_count > 0 && b.unread_count === 0) return -1;
    if (a.unread_count === 0 && b.unread_count > 0) return 1;
    // Then by last_message_at DESC
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bTime - aTime;
  });
}

function filterChannels(channels: ChatChannel[], query: string): ChatChannel[] {
  if (!query) return channels;
  const lower = query.toLowerCase();
  return channels.filter(c => c.name.toLowerCase().includes(lower));
}

export function ChannelGroups({ groups, activeChannelId, searchQuery, onChannelClick }: ChannelGroupsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  // Persist collapse state
  useEffect(() => { saveCollapsed(collapsed); }, [collapsed]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="flex flex-col gap-1">
      {GROUP_CONFIG.map(({ key, label, icon, iconClass }) => {
        const raw = groups[key] || [];
        const filtered = filterChannels(raw, searchQuery);
        const sorted = sortChannels(filtered);
        const isCollapsed = collapsed[key] ?? false;
        const groupUnread = raw.reduce((sum, c) => sum + (c.unread_count || 0), 0);

        // Hide empty groups (unless it's departments which always shows)
        if (sorted.length === 0 && key !== 'departments') return null;

        return (
          <div key={key} className="mb-1">
            {/* Group header */}
            <button
              onClick={() => toggleGroup(key)}
              className="w-full flex items-center justify-between px-3 py-1.5
                text-[11px] font-semibold uppercase tracking-wider
                text-white/40 hover:text-white/60 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {/* Chevron */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-3 h-3 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className={iconClass}>{icon}</span>
                <span>{label}</span>
                <span className="text-white/20">({sorted.length})</span>
              </div>

              {/* Group unread badge */}
              {groupUnread > 0 && !isCollapsed && (
                <span className="min-w-[16px] h-4 px-1 flex items-center justify-center
                  bg-pink-500/80 text-white text-[9px] font-bold rounded-full">
                  {groupUnread > 99 ? '99+' : groupUnread}
                </span>
              )}
              {groupUnread > 0 && isCollapsed && (
                <span className="min-w-[16px] h-4 px-1 flex items-center justify-center
                  bg-pink-500 text-white text-[9px] font-bold rounded-full">
                  {groupUnread > 99 ? '99+' : groupUnread}
                </span>
              )}
            </button>

            {/* Channel list (collapsible) */}
            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 px-1">
                {sorted.length === 0 ? (
                  <p className="text-[11px] text-white/20 px-2.5 py-2">
                    {searchQuery ? 'No matches' : 'No channels yet'}
                  </p>
                ) : (
                  sorted.map(channel => (
                    <ChannelItem
                      key={channel.channel_id}
                      channel={channel}
                      isActive={channel.channel_id === activeChannelId}
                      onClick={onChannelClick}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
