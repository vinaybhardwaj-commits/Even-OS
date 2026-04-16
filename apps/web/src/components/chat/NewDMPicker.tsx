'use client';

/**
 * NewDMPicker — OC.6a
 *
 * Modal/popover that lets users search hospital staff and start a DM.
 * Searches by name or department. Creates deterministic DM channel via
 * `chat.createDM` endpoint, then opens the channel.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useChat } from '@/providers/ChatProvider';
import { trpcMutate } from '@/lib/chat/poll';

interface UserResult {
  id: string;
  full_name: string;
  department: string;
  role: string;
}

interface NewDMPickerProps {
  visible: boolean;
  onClose: () => void;
}

export function NewDMPicker({ visible, onClose }: NewDMPickerProps) {
  const { openChannel, refreshChannels } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  // Debounced search
  const searchUsers = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const input = encodeURIComponent(JSON.stringify({ json: { query: q } }));
      const res = await fetch(`/api/trpc/chat.searchUsers?input=${input}`);
      const data = await res.json();
      if (data?.result?.data?.json) {
        setResults(data.result.data.json);
        setSelectedIdx(0);
      }
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => searchUsers(val.trim()), 200);
  }, [searchUsers]);

  const handleSelectUser = useCallback(async (user: UserResult) => {
    setIsCreating(true);
    try {
      const result = await trpcMutate('chat.createDM', { targetUserId: user.id });
      const channelId = result?.channel?.channel_id;
      if (channelId) {
        await refreshChannels();
        openChannel(channelId);
        onClose();
      }
    } catch (err) {
      console.error('[NewDMPicker] Failed to create DM:', err);
    } finally {
      setIsCreating(false);
    }
  }, [openChannel, refreshChannels, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      handleSelectUser(results[selectedIdx]);
    }
  }, [results, selectedIdx, handleSelectUser, onClose]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 bg-[#0A1628]/95 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
        <span className="text-sm font-semibold text-white">New Message</span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Search input */}
      <div className="px-3 py-2 border-b border-white/10">
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Search by name or department..."
            className="w-full pl-8 pr-3 py-2 text-xs rounded-md
              bg-white/8 border border-white/10
              text-white placeholder:text-white/30
              focus:outline-none focus:border-blue-400/50 focus:bg-white/12
              transition-colors"
          />
        </div>
        {isSearching && (
          <p className="text-[10px] text-white/30 mt-1 px-1">Searching...</p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto py-1">
        {query.length < 2 && (
          <p className="text-[11px] text-white/30 px-4 py-6 text-center">
            Type at least 2 characters to search
          </p>
        )}

        {query.length >= 2 && !isSearching && results.length === 0 && (
          <p className="text-[11px] text-white/30 px-4 py-6 text-center">
            No users found
          </p>
        )}

        {results.map((user, idx) => (
          <button
            key={user.id}
            onClick={() => handleSelectUser(user)}
            disabled={isCreating}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
              ${idx === selectedIdx ? 'bg-white/10' : 'hover:bg-white/5'}
              ${isCreating ? 'opacity-50 cursor-wait' : ''}`}
          >
            {/* Avatar circle */}
            <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-400/30
              flex items-center justify-center text-blue-300 text-xs font-bold shrink-0">
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{user.full_name}</div>
              <div className="text-[10px] text-white/40 truncate">
                {user.department} &middot; {user.role.replace(/_/g, ' ')}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Keyboard hints */}
      <div className="px-4 py-2 border-t border-white/10 text-[10px] text-white/25 flex gap-3">
        <span>↑↓ Navigate</span>
        <span>Enter Select</span>
        <span>Esc Close</span>
      </div>
    </div>
  );
}
