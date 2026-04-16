'use client';

/**
 * ChatSidebar — OC.2b
 *
 * Assembles the sidebar body: search bar + channel groups.
 * Reads channels/state from ChatProvider, manages search query locally.
 */

import { useState, useCallback } from 'react';
import { useChat } from '@/providers/ChatProvider';
import { ChatSearch } from './ChatSearch';
import { ChannelGroups } from './ChannelGroups';

export function ChatSidebar() {
  const { channels, activeChannelId, openChannel } = useChat();

  const defaultGroups = { my_patients: [], departments: [], direct_messages: [], broadcast: [], archived: [] };
  const groups = channels ?? defaultGroups;
  const [searchQuery, setSearchQuery] = useState('');

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
    <div className="flex flex-col h-full">
      <ChatSearch onSearch={handleSearch} />
      <div className="flex-1 overflow-y-auto">
        <ChannelGroups
          groups={groups}
          activeChannelId={activeChannelId}
          searchQuery={searchQuery}
          onChannelClick={handleChannelClick}
        />
      </div>
    </div>
  );
}
