'use client';

/**
 * MessageReactions — OC.3b
 *
 * Quick emoji picker (6 common reactions) + reaction count pills.
 * Shows on message hover. Calls tRPC to toggle reaction.
 */

import { useState, useCallback } from 'react';
import { trpcMutate } from '@/lib/chat/poll';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean; // whether current user has reacted with this emoji
}

interface MessageReactionsProps {
  messageId: number;
  channelId: string;
  reactions: Reaction[];
  onReactionUpdate?: () => void;
}

export function MessageReactions({ messageId, channelId, reactions, onReactionUpdate }: MessageReactionsProps) {
  const [showPicker, setShowPicker] = useState(false);

  const toggleReaction = useCallback(async (emoji: string) => {
    try {
      await trpcMutate('chat.toggleReaction', { messageId, channelId, emoji });
      onReactionUpdate?.();
    } catch (err) {
      console.error('[Reactions] Failed to toggle:', err);
    }
    setShowPicker(false);
  }, [messageId, channelId, onReactionUpdate]);

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {/* Existing reactions */}
      {reactions.map(r => (
        <button
          key={r.emoji}
          onClick={() => toggleReaction(r.emoji)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] transition-colors
            ${r.reacted
              ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300'
              : 'bg-white/5 border border-white/10 text-white/50 hover:bg-white/10'
            }`}
        >
          <span>{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}

      {/* Add reaction button */}
      <div className="relative">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="w-6 h-6 flex items-center justify-center rounded-full
            text-white/20 hover:text-white/50 hover:bg-white/5 transition-colors text-xs"
          title="Add reaction"
        >
          +
        </button>

        {/* Quick picker */}
        {showPicker && (
          <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 bg-[#1A2A40] border border-white/10 rounded-lg p-1 shadow-xl z-50">
            {QUICK_REACTIONS.map(emoji => (
              <button
                key={emoji}
                onClick={() => toggleReaction(emoji)}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-sm"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
