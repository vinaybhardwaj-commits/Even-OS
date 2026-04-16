'use client';

/**
 * ChatRoom — OC.3a + OC.3b
 *
 * Container component for the chatroom view (State 3).
 * Renders header + message list + typing indicator + composer.
 */

import { useMemo, useCallback } from 'react';
import { useChat, ChatChannel } from '@/providers/ChatProvider';
import { ChatRoomHeader } from './ChatRoomHeader';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';
import { TypingIndicator } from './TypingIndicator';

export function ChatRoom() {
  const {
    activeChannelId,
    activeMessages,
    channels,
    currentUserId,
    typing,
    closeChannel,
    loadOlderMessages,
    sendMessage,
    setTyping: setTypingAction,
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

  const handleMessageUpdated = useCallback(() => {
    // Force a poll to refresh messages after edit/delete/retract
    // The poll engine will pick up changes on next tick
  }, []);

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
        channelType={activeChannel.channel_type}
        channelId={activeChannel.channel_id}
        onLoadOlder={handleLoadOlder}
        onMessageUpdated={handleMessageUpdated}
      />

      {/* Typing indicator */}
      <TypingIndicator names={typingNames} />

      {/* Composer */}
      <MessageComposer
        channelId={activeChannel.channel_id}
        channelType={activeChannel.channel_type}
        onSend={sendMessage}
        onTyping={setTypingAction}
      />
    </div>
  );
}
