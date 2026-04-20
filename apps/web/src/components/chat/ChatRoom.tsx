'use client';

/**
 * ChatRoom — OC.3a + OC.3b + SC.2
 *
 * Container component for the chatroom view.
 * SC.2: Form-backed slash commands open FormModal instead of executing SQL.
 */

import { useMemo, useCallback, useEffect, useState } from 'react';
import { useChat, ChatChannel } from '@/providers/ChatProvider';
import { ChatRoomHeader } from './ChatRoomHeader';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';
import { TypingIndicator } from './TypingIndicator';
import { FormModal } from '@/components/forms/FormModal';
import { trpcMutate } from '@/lib/chat/poll';
import type { SlashCommandDef } from './SlashCommandMenu';
import type { FormDefinition } from '@/lib/forms/types';

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
    markRead,
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
  }, []);

  // CHAT.X.2 — mark the active channel read once its bottom has been on
  // screen for ~800ms. MessageList does the timing + tab-visibility gate.
  const handleViewportRead = useCallback(() => {
    if (activeChannelId) {
      markRead(activeChannelId);
    }
  }, [activeChannelId, markRead]);

  // ── Slash commands (SC.2) ──────────────────────────────
  const [slashCommands, setSlashCommands] = useState<SlashCommandDef[]>([]);

  useEffect(() => {
    // Fetch available slash commands for current user's role
    const input = encodeURIComponent(JSON.stringify({ json: {} }));
    fetch(`/api/trpc/chat.getSlashCommands?input=${input}`)
      .then(r => r.json())
      .then((data: any) => {
        if (data?.result?.data?.json) {
          setSlashCommands(data.result.data.json);
        }
      })
      .catch(() => {});
  }, []);

  // Handle read-only slash commands (execute SQL, post card)
  const handleSlashCommand = useCallback(async (channelId: string, commandText: string) => {
    await trpcMutate('chat.executeSlashCommand', { channelId, commandText });
  }, []);

  // ── Form Modal state (SC.2) ────────────────────────────
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [activeFormDef, setActiveFormDef] = useState<FormDefinition | null>(null);
  const [formPatientContext, setFormPatientContext] = useState<{ patientId: string; encounterId?: string } | null>(null);

  // Handle form-backed slash command selection
  const handleFormCommand = useCallback(async (command: SlashCommandDef) => {
    if (!command.formDefinitionId) return;

    try {
      // Fetch the full form definition from the server
      const input = encodeURIComponent(JSON.stringify({
        json: { definitionId: command.formDefinitionId }
      }));
      const res = await fetch(`/api/trpc/forms.getDefinition?input=${input}`);
      const data = await res.json();
      const formDef = data?.result?.data?.json;

      if (!formDef) {
        console.error('[ChatRoom] Failed to load form definition for', command.name);
        return;
      }

      // Extract patient context from channel if available
      // Patient channels have a patient_id in their metadata
      let patientCtx = null;
      if (activeChannel?.channel_type === 'patient' && activeChannel?.metadata) {
        const meta = typeof activeChannel.metadata === 'string'
          ? JSON.parse(activeChannel.metadata)
          : activeChannel.metadata;
        if (meta?.patient_id) {
          patientCtx = {
            patientId: meta.patient_id,
            encounterId: meta.encounter_id,
          };
        }
      }

      setActiveFormDef(formDef);
      setFormPatientContext(patientCtx);
      setFormModalOpen(true);

      // Log form_opened audit event
      await fetch('/api/trpc/forms.logFormOpen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            formDefinitionId: command.formDefinitionId,
            patientId: patientCtx?.patientId,
          }
        }),
      }).catch(() => {});
    } catch (err) {
      console.error('[ChatRoom] Error opening form command:', err);
    }
  }, [activeChannel]);

  // Handle form submission confirmation card
  const handleFormSubmitted = useCallback(async (submissionId: string) => {
    setFormModalOpen(false);
    setActiveFormDef(null);
    setFormPatientContext(null);

    // Post confirmation card to chat channel
    if (activeChannelId && activeFormDef) {
      try {
        await trpcMutate('chat.postFormConfirmation', {
          channelId: activeChannelId,
          formName: activeFormDef.name,
          submissionId,
        });
      } catch (err) {
        // Non-critical — confirmation card is nice-to-have
        console.warn('[ChatRoom] Failed to post form confirmation card:', err);
      }
    }
  }, [activeChannelId, activeFormDef]);

  const handleFormModalClose = useCallback(() => {
    setFormModalOpen(false);
    setActiveFormDef(null);
    setFormPatientContext(null);
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
        onViewportRead={handleViewportRead}
      />

      {/* Typing indicator */}
      <TypingIndicator names={typingNames} />

      {/* Composer */}
      <MessageComposer
        channelId={activeChannel.channel_id}
        channelType={activeChannel.channel_type}
        slashCommands={slashCommands}
        onSend={sendMessage}
        onSlashCommand={handleSlashCommand}
        onFormCommand={handleFormCommand}
        onTyping={setTypingAction}
      />

      {/* Form Modal (SC.2) — opens when form-backed slash command selected */}
      {activeFormDef && (
        <FormModal
          isOpen={formModalOpen}
          onClose={handleFormModalClose}
          formDefinition={activeFormDef}
          patientContext={formPatientContext}
          channelId={activeChannel.channel_id}
          channelType={activeChannel.channel_type}
          onSubmitted={handleFormSubmitted}
        />
      )}
    </div>
  );
}
