'use client';

/**
 * ChatSidebar — OC.2b
 *
 * Assembles the sidebar body: search bar + channel groups.
 * Reads channels/state from ChatProvider, manages search query locally.
 */

import { useState, useCallback, useEffect } from 'react';
import { useChat } from '@/providers/ChatProvider';
import { ChatSearch } from './ChatSearch';
import { ChannelGroups } from './ChannelGroups';
import { NewDMPicker } from './NewDMPicker';
import { NotificationSettings } from './NotificationSettings';

export function ChatSidebar() {
  const { channels, activeChannelId, openChannel } = useChat();

  const defaultGroups = { my_patients: [], departments: [], direct_messages: [], broadcast: [], archived: [] };
  const groups = channels ?? defaultGroups;
  const [searchQuery, setSearchQuery] = useState('');
  const [showDMPicker, setShowDMPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Listen for Ctrl+Shift+N keyboard shortcut
  useEffect(() => {
    const handler = () => setShowDMPicker(true);
    window.addEventListener('open-new-dm', handler);
    return () => window.removeEventListener('open-new-dm', handler);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleChannelClick = useCallback(
    (channelId: string) => {
      openChannel(channelId);
    },
    [openChannel],
  );

  return (
    <div className="flex flex-col h-full relative">
      {/* Search + New DM button */}
      <div className="flex items-center gap-1 px-2 mb-1">
        <div className="flex-1">
          <ChatSearch onSearch={handleSearch} />
        </div>
        <button
          onClick={() => setShowDMPicker(true)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white/70 shrink-0"
          aria-label="New direct message"
          title="New DM (Ctrl+Shift+N)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className="w-4 h-4">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ChannelGroups
          groups={groups}
          activeChannelId={activeChannelId}
          searchQuery={searchQuery}
          onChannelClick={handleChannelClick}
        />
      </div>

      {/* Settings gear at bottom */}
      <div className="px-3 py-2 border-t border-white/10 shrink-0">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 text-[11px] text-white/40 hover:text-white/70 transition-colors"
          title="Notification settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className="w-3.5 h-3.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </button>
      </div>

      {/* DM user picker overlay */}
      <NewDMPicker visible={showDMPicker} onClose={() => setShowDMPicker(false)} />

      {/* Notification settings overlay */}
      <NotificationSettings visible={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
