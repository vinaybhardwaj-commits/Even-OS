'use client';

/**
 * ChatRoom — OC.3a
 *
 * Container component for the chatroom view (State 3).
 * Fetches channel details, renders header + message list.
 * Composer placeholder included for OC.3b.
 */

import { useMemo, useCallback } from 'react';
import { useChat, ChatChannel } from '@/providers/ChatProvider';
import { ChatRoomHeader } from './ChatRoomHeader';
import { MessageList } from './MessageList';

export function ChatRoom() {
  const {
    activeChannelId,
    activeMessages,
    channels,
    currentUserId,
    typing,
    closeChannel,
    loadOlderMessages,
  } = useChat();

  // Find active channel object from groups
  const activeChannel = useMemo((): ChatChannel | null => {
    if (!channels || !activeChannelId) return null;
    const allChannels = [
      ...channels.my_patients,
      ...channels.departments,
      ...channels.direct_messages,
      ...channels.broadcast,
      ...channels.archived,
    ];
    return allChannels.find(c => c.channel_id === activeChannelId) || null;
  }, [channels, activeChannelId]);

  const handleLoadOlder = useCallback(async (): Promise<boolean> => {
    if (!activeChannelId) return false;
    return loadOlderMessages(activeChannelId);
  }, [activeChannelId, loadOlderMessages]);

  // Active typing users (exclude self)
  const typingNames = useMemo(() => {
    return typing
      .filter(t => t.channel_id === activeChannelId && t.user_id !== currentUserId)
      .map(t => t.user_name);
  }, [typing, activeChannelId, currentUserId]);

  if (!activeChannel) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0D1B2A] text-white/30">
        <div className="text-center">
          <div className="text-4xl mb-3">💬</div>
          <div className="text-sm">Select a channel to start chatting</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0D1B2A]">
      {/* Header */}
      <ChatRoomHeader channel={activeChannel} onBack={closeChannel} />

      {/* Messages */}
      <MessageList
        messages={activeMessages}
        currentUserId={currentUserId || ''}
        onLoadOlder={handleLoadOlder}
      />

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1.5 border-t border-white/5">
          <span className="text-xs text-white/40 italic">
            {typingNames.length === 1
              ? `${typingNames[0]} is typing...`
              : typingNames.length === 2
                ? `${typingNames[0]} and ${typingNames[1]} are typing...`
                : `${typingNames[0]} and ${typingNames.length - 1} others are typing...`}
          </span>
        </div>
      )}

      {/* Composer placeholder — will be built in OC.3b */}
      <div className="shrink-0 border-t border-white/10 px-4 py-3">
        <div className="bg-white/5 rounded-lg px-4 py-2.5 text-sm text-white/30">
          Message composer coming in OC.3b...
        </div>
      </div>
    </div>
  );
}
