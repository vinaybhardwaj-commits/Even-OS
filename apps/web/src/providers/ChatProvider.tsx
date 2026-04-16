'use client';

/**
 * ChatProvider — OC.1c
 *
 * Root-level React context that powers the omnipresent chat system.
 * Provides: channels, messages, unread counts, presence, typing indicators,
 * and actions (sendMessage, markRead, setTyping, openChannel, etc.).
 *
 * Mounts at root layout level. Wrapped in error boundary — if this crashes,
 * the rest of the app continues to function normally without chat.
 *
 * Only activates when the user is authenticated (checks /api/trpc/auth.me).
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ChatPollEngine,
  fetchChannels,
  trpcMutate,
  type ChatUIState,
  type PollMessage,
  type PollResult,
  type TypingIndicator,
} from '@/lib/chat/poll';

// ============================================================
// TYPES
// ============================================================

export interface ChatChannel {
  id: string;
  channel_id: string;
  channel_type: 'department' | 'patient' | 'direct' | 'broadcast';
  name: string;
  description?: string;
  is_archived: boolean;
  last_message_at: string | null;
  encounter_id?: string;
  metadata?: Record<string, any>;
  is_pinned: boolean;
  is_muted: boolean;
  last_read_at: string | null;
  unread_count: number;
  member_count: number;
}

export interface ChannelGroups {
  my_patients: ChatChannel[];
  departments: ChatChannel[];
  direct_messages: ChatChannel[];
  broadcast: ChatChannel[];
  archived: ChatChannel[];
}

export interface ChatMessage {
  id: number;
  sender_id: string | null;
  message_type: string;
  priority: string;
  content: string;
  metadata?: Record<string, any>;
  reply_to_id?: number;
  is_edited: boolean;
  is_deleted: boolean;
  is_retracted: boolean;
  retracted_reason?: string;
  created_at: string;
  updated_at: string;
  sender_name: string;
  sender_department: string;
  sender_roles?: string[];
}

export interface ChatContextValue {
  // State
  chatState: ChatUIState;
  channels: ChannelGroups | null;
  activeChannelId: string | null;
  activeMessages: ChatMessage[];
  unreadTotal: number;
  typing: TypingIndicator[];
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Actions
  setChatState: (state: ChatUIState) => void;
  openChannel: (channelId: string) => void;
  closeChannel: () => void;
  sendMessage: (params: {
    channelId: string;
    content: string;
    messageType?: string;
    priority?: string;
    metadata?: Record<string, any>;
    replyToId?: number;
  }) => Promise<any>;
  markRead: (channelId: string) => Promise<void>;
  setTyping: (channelId: string, isTyping: boolean) => Promise<void>;
  refreshChannels: () => Promise<void>;
}

// ============================================================
// CONTEXT
// ============================================================

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    // Return a no-op context when outside provider (e.g., error boundary fallback)
    return {
      chatState: 'collapsed',
      channels: null,
      activeChannelId: null,
      activeMessages: [],
      unreadTotal: 0,
      typing: [],
      isLoading: false,
      isAuthenticated: false,
      error: null,
      setChatState: () => {},
      openChannel: () => {},
      closeChannel: () => {},
      sendMessage: async () => null,
      markRead: async () => {},
      setTyping: async () => {},
      refreshChannels: async () => {},
    };
  }
  return ctx;
}

// ============================================================
// ERROR BOUNDARY
// ============================================================

interface ErrorBoundaryState {
  hasError: boolean;
}

class ChatErrorBoundary extends React.Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ChatProvider] Error boundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      // Chat is broken — render nothing. App continues normally.
      return null;
    }
    return this.props.children;
  }
}

// ============================================================
// AUTH CHECK (lightweight — just verifies cookie is valid)
// ============================================================

async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/trpc/auth.me', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.result?.data?.json?.id;
  } catch {
    return false;
  }
}

// ============================================================
// PROVIDER COMPONENT
// ============================================================

function ChatProviderInner({ children }: { children: ReactNode }) {
  // ── State ───────────────────────────────────────────────────
  const [chatState, setChatStateRaw] = useState<ChatUIState>('collapsed');
  const [channels, setChannels] = useState<ChannelGroups | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [typing, setTyping] = useState<TypingIndicator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollEngineRef = useRef<ChatPollEngine | null>(null);
  const activeChannelRef = useRef<string | null>(null);

  // Keep ref in sync
  activeChannelRef.current = activeChannelId;

  // ── Chat state with sessionStorage persistence ──────────────
  const setChatState = useCallback((state: ChatUIState) => {
    setChatStateRaw(state);
    try {
      sessionStorage.setItem('even_chat_state', state);
    } catch { /* noop */ }
    // Update poll interval
    pollEngineRef.current?.setUIState(state);
  }, []);

  // ── Handle poll results ─────────────────────────────────────
  const handlePollResult = useCallback((result: PollResult) => {
    // Update typing indicators
    setTyping(result.typing);

    // If there are new messages, update unread counts and channel list
    if (result.messages.length > 0) {
      // Update active channel messages if any new messages belong to it
      const activeId = activeChannelRef.current;
      if (activeId) {
        const relevantMsgs = result.messages.filter(
          (m: PollMessage) => {
            // We need to match on channel UUID — messages come with channel_id (UUID)
            // This is handled by refreshing channel details when active
            return true; // We'll filter properly when we have the UUID mapping
          }
        );
        if (relevantMsgs.length > 0) {
          // Append new messages from poll (deduplicate by ID)
          setActiveMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newMsgs: ChatMessage[] = relevantMsgs
              .filter((m: PollMessage) => !existingIds.has(m.id))
              .map((m: PollMessage) => ({
                id: m.id,
                sender_id: m.sender_id,
                message_type: m.message_type,
                priority: m.priority,
                content: m.content_preview,
                metadata: m.metadata,
                is_edited: false,
                is_deleted: false,
                is_retracted: m.is_retracted,
                created_at: m.created_at,
                updated_at: m.created_at,
                sender_name: m.sender_name,
                sender_department: m.sender_department,
              }));
            return [...prev, ...newMsgs];
          });
        }
      }

      // Refresh channel list to update unread counts and ordering
      loadChannels();
    }
  }, []);

  const handlePollError = useCallback((err: Error) => {
    console.warn('[ChatPoll] Error:', err.message);
    // Don't set error state for transient poll failures
  }, []);

  // ── Load channels ───────────────────────────────────────────
  const loadChannels = useCallback(async () => {
    try {
      const data = await fetchChannels();
      if (data) {
        setChannels(data.channels);
        setUnreadTotal(data.unreadTotal);
      }
    } catch (err) {
      console.warn('[ChatProvider] Failed to load channels:', err);
    }
  }, []);

  // ── Initialize ──────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function init() {
      // 1. Check authentication
      const authed = await checkAuth();
      if (!mounted) return;

      if (!authed) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);

      // 2. Restore chat state from sessionStorage
      try {
        const saved = sessionStorage.getItem('even_chat_state') as ChatUIState | null;
        if (saved && ['collapsed', 'sidebar', 'chatroom'].includes(saved)) {
          setChatStateRaw(saved);
        }
      } catch { /* noop */ }

      // 3. Load initial channels
      await loadChannels();
      if (!mounted) return;

      setIsLoading(false);

      // 4. Start polling
      const engine = new ChatPollEngine();
      pollEngineRef.current = engine;
      engine.start(handlePollResult, handlePollError, 0);
    }

    init();

    return () => {
      mounted = false;
      pollEngineRef.current?.stop();
      pollEngineRef.current = null;
    };
  }, [loadChannels, handlePollResult, handlePollError]);

  // ── Actions ─────────────────────────────────────────────────

  const openChannel = useCallback(async (channelId: string) => {
    setActiveChannelId(channelId);
    setChatState('chatroom');

    // Load full message history for the channel
    try {
      const data = await trpcMutate('chat.markRead', { channelId });
      // Fetch via query, not mutation
      const params = `?input=${encodeURIComponent(JSON.stringify({ json: { channelId } }))}`;
      const res = await fetch(`/api/trpc/chat.getChannel${params}`);
      const json = await res.json();
      const channelData = json.result?.data?.json;

      if (channelData?.messages) {
        setActiveMessages(channelData.messages);
      }
    } catch (err) {
      console.error('[ChatProvider] Failed to open channel:', err);
    }
  }, [setChatState]);

  const closeChannel = useCallback(() => {
    setActiveChannelId(null);
    setActiveMessages([]);
    setChatState('sidebar');
  }, [setChatState]);

  const sendMessage = useCallback(async (params: {
    channelId: string;
    content: string;
    messageType?: string;
    priority?: string;
    metadata?: Record<string, any>;
    replyToId?: number;
  }) => {
    try {
      const result = await trpcMutate('chat.sendMessage', {
        channelId: params.channelId,
        content: params.content,
        messageType: params.messageType || 'chat',
        priority: params.priority || 'normal',
        metadata: params.metadata,
        replyToId: params.replyToId,
      });

      // Optimistic insert into active messages
      if (result && activeChannelRef.current === params.channelId) {
        setActiveMessages(prev => [
          ...prev,
          {
            id: result.id,
            sender_id: result.sender_id,
            message_type: result.message_type,
            priority: result.priority,
            content: params.content,
            metadata: result.metadata,
            reply_to_id: result.reply_to_id,
            is_edited: false,
            is_deleted: false,
            is_retracted: false,
            created_at: result.created_at,
            updated_at: result.created_at,
            sender_name: result.sender_name || 'You',
            sender_department: result.sender_department || '',
          },
        ]);
      }

      // Force immediate poll to sync state
      pollEngineRef.current?.pollNow();

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setError(msg);
      throw err;
    }
  }, []);

  const markRead = useCallback(async (channelId: string) => {
    try {
      await trpcMutate('chat.markRead', { channelId });
      // Update local unread count
      setChannels(prev => {
        if (!prev) return prev;
        const update = (list: ChatChannel[]) =>
          list.map(c => c.channel_id === channelId ? { ...c, unread_count: 0 } : c);
        return {
          my_patients: update(prev.my_patients),
          departments: update(prev.departments),
          direct_messages: update(prev.direct_messages),
          broadcast: update(prev.broadcast),
          archived: update(prev.archived),
        };
      });
    } catch { /* silent */ }
  }, []);

  const setTypingAction = useCallback(async (channelId: string, isTyping: boolean) => {
    try {
      await trpcMutate('chat.setTyping', { channelId, isTyping });
    } catch { /* silent — typing is ephemeral */ }
  }, []);

  const refreshChannels = useCallback(async () => {
    await loadChannels();
  }, [loadChannels]);

  // ── Context value ───────────────────────────────────────────
  const value: ChatContextValue = {
    chatState,
    channels,
    activeChannelId,
    activeMessages,
    unreadTotal,
    typing,
    isLoading,
    isAuthenticated,
    error,
    setChatState,
    openChannel,
    closeChannel,
    sendMessage,
    markRead,
    setTyping: setTypingAction,
    refreshChannels,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// ============================================================
// EXPORTED WRAPPER (with error boundary)
// ============================================================

export function ChatProvider({ children }: { children: ReactNode }) {
  return (
    <ChatErrorBoundary>
      <ChatProviderInner>
        {children}
      </ChatProviderInner>
    </ChatErrorBoundary>
  );
}
