'use client';

/**
 * ChatProvider — OC.1c → OC.8c (SSE real-time)
 *
 * Root-level React context that powers the omnipresent chat system.
 * Provides: channels, messages, unread counts, presence, typing indicators,
 * and actions (sendMessage, markRead, setTyping, openChannel, etc.).
 *
 * Mounts at root layout level. Wrapped in error boundary — if this crashes,
 * the rest of the app continues to function normally without chat.
 *
 * OC.8: Replaced ChatPollEngine (2-5s polling) with ChatStreamEngine (SSE, ~300ms).
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
  fetchChannels,
  trpcMutate,
  type ChatUIState,
  type PollMessage,
  type PollResult,
  type TypingIndicator,
  type UnreadSummary,
} from '@/lib/chat/poll';
import { ChatStreamEngine } from '@/lib/chat/stream';

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
  /** CHAT.X.2 — A/B/C badge summary. A=total, B=role-scoped, C=DMs. */
  unreadSummary: UnreadSummary;
  typing: TypingIndicator[];
  isLoading: boolean;
  isAuthenticated: boolean;
  currentUserId: string | null;
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
    attachments?: { file_name: string; file_type: string; file_size: number; file_url: string; thumbnail_url?: string }[];
  }) => Promise<any>;
  markRead: (channelId: string) => Promise<void>;
  setTyping: (channelId: string, isTyping: boolean) => Promise<void>;
  refreshChannels: () => Promise<void>;
  loadOlderMessages: (channelId: string) => Promise<boolean>; // returns true if more exist
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
      unreadSummary: { a: 0, b: 0, c: 0 },
      typing: [],
      isLoading: false,
      isAuthenticated: false,
      currentUserId: null,
      error: null,
      setChatState: () => {},
      openChannel: () => {},
      closeChannel: () => {},
      sendMessage: async () => null,
      markRead: async () => {},
      setTyping: async () => {},
      refreshChannels: async () => {},
      loadOlderMessages: async () => false,
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

async function checkAuth(): Promise<{ ok: boolean; userId?: string }> {
  try {
    const res = await fetch('/api/trpc/auth.me', { credentials: 'same-origin' });
    if (!res.ok) return { ok: false };
    const json = await res.json();
    const id = json.result?.data?.json?.id;
    return id ? { ok: true, userId: id } : { ok: false };
  } catch {
    return { ok: false };
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
  const [unreadSummary, setUnreadSummary] = useState<UnreadSummary>({ a: 0, b: 0, c: 0 });
  const [typing, setTyping] = useState<TypingIndicator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamEngineRef = useRef<ChatStreamEngine | null>(null);
  const activeChannelRef = useRef<string | null>(null);

  // Keep ref in sync
  activeChannelRef.current = activeChannelId;

  // ── Chat state with sessionStorage persistence ──────────────
  const setChatState = useCallback((state: ChatUIState) => {
    setChatStateRaw(state);
    try {
      sessionStorage.setItem('even_chat_state', state);
    } catch { /* noop */ }
    // Update stream interval (triggers reconnect with new uiState param)
    streamEngineRef.current?.setUIState(state);
  }, []);

  // ── Handle SSE stream results ───────────────────────────────
  const handleStreamMessage = useCallback((result: PollResult) => {
    // Update typing indicators
    setTyping(result.typing);

    // CHAT.X.2 — sync A/B/C badge from server snapshot. The server pushes this
    // on every batch so the badge stays correct without a separate query.
    if (result.unreadSummary) {
      setUnreadSummary(result.unreadSummary);
    }

    // If there are new messages, update unread counts and channel list
    if (result.messages.length > 0) {
      // Update active channel messages if any new messages belong to it
      const activeId = activeChannelRef.current;
      if (activeId) {
        // Merge new messages from stream (CHAT.X.0a optimistic-aware dedup):
        // 1. If server id already present → skip
        // 2. If incoming metadata.client_temp_id matches an optimistic temp row → replace it in-place
        // 3. Otherwise → append
        setActiveMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const tempIdToIndex = new Map<string, number>();
          prev.forEach((m, i) => {
            const t = (m.metadata as any)?.client_temp_id;
            if (typeof t === 'string' && m.id < 0) tempIdToIndex.set(t, i);
          });

          let next = prev;
          let mutated = false;
          for (const m of result.messages as PollMessage[]) {
            if (existingIds.has(m.id)) continue;

            const incomingTempId = (m.metadata as any)?.client_temp_id;
            const converted: ChatMessage = {
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
            };

            if (
              typeof incomingTempId === 'string' &&
              tempIdToIndex.has(incomingTempId)
            ) {
              // Reconcile — replace optimistic row with server row
              if (!mutated) {
                next = [...next];
                mutated = true;
              }
              next[tempIdToIndex.get(incomingTempId)!] = converted;
              tempIdToIndex.delete(incomingTempId);
            } else {
              if (!mutated) {
                next = [...next];
                mutated = true;
              }
              next.push(converted);
            }
          }
          return mutated ? next : prev;
        });
      }

      // Refresh channel list to update unread counts and ordering
      loadChannels();
    }
  }, []);

  const handleStreamError = useCallback((err: Error) => {
    console.warn('[ChatStream] Error:', err.message);
    // Don't set error state for transient stream failures — engine auto-reconnects
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

  // CHAT.X.2 — Cheap dedicated fetch for the A/B/C badge. Used on bootstrap
  // and tab refocus where we want a fresh snapshot without re-pulling the
  // full channel list.
  const refreshUnreadSummary = useCallback(async () => {
    try {
      const params = `?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`;
      const res = await fetch(`/api/trpc/chat.getUnreadSummary${params}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const json = await res.json();
      const summary = json.result?.data?.json as UnreadSummary | undefined;
      if (summary) setUnreadSummary(summary);
    } catch { /* silent — badge is non-critical */ }
  }, []);

  // ── Initialize ──────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function init() {
      // 1. Check authentication
      const authResult = await checkAuth();
      if (!mounted) return;

      if (!authResult.ok) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);
      setCurrentUserId(authResult.userId || null);

      // 2. Restore chat state from sessionStorage
      let restoredState: ChatUIState = 'collapsed';
      try {
        const saved = sessionStorage.getItem('even_chat_state') as ChatUIState | null;
        if (saved && ['collapsed', 'sidebar', 'chatroom'].includes(saved)) {
          setChatStateRaw(saved);
          restoredState = saved;
        }
      } catch { /* noop */ }

      // 3. Load initial channels + unread summary in parallel
      await Promise.all([loadChannels(), refreshUnreadSummary()]);
      if (!mounted) return;

      setIsLoading(false);

      // 4. Start SSE stream (replaces polling engine)
      const engine = new ChatStreamEngine();
      streamEngineRef.current = engine;
      engine.setUIState(restoredState);
      engine.start(handleStreamMessage, handleStreamError, 0);
    }

    init();

    return () => {
      mounted = false;
      streamEngineRef.current?.stop();
      streamEngineRef.current = null;
    };
  }, [loadChannels, refreshUnreadSummary, handleStreamMessage, handleStreamError]);

  // ── Actions ─────────────────────────────────────────────────

  const openChannel = useCallback(async (channelId: string) => {
    setActiveChannelId(channelId);
    setChatState('chatroom');

    // Optimistically zero this channel's unread count in the sidebar so the
    // dot disappears the instant the user clicks in — matches CHAT.X.2 intent.
    setChannels(prev => {
      if (!prev) return prev;
      const zero = (list: ChatChannel[]) =>
        list.map(c => c.channel_id === channelId ? { ...c, unread_count: 0 } : c);
      return {
        my_patients: zero(prev.my_patients),
        departments: zero(prev.departments),
        direct_messages: zero(prev.direct_messages),
        broadcast: zero(prev.broadcast),
        archived: zero(prev.archived),
      };
    });

    // Load full message history for the channel
    try {
      const data = await trpcMutate('chat.markRead', { channelId });
      // CHAT.X.2 — sync A/B/C badge from server's authoritative post-mark snapshot
      if (data?.unreadSummary) {
        setUnreadSummary(data.unreadSummary);
      }
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
    attachments?: { file_name: string; file_type: string; file_size: number; file_url: string; thumbnail_url?: string }[];
  }) => {
    // CHAT.X.0a — TRUE optimistic send.
    // 1. Build optimistic row with client_temp_id + status='sending'
    // 2. Insert into activeMessages BEFORE awaiting network
    // 3. On server ack: reconcile temp row → real server row (keep client_temp_id in metadata so SSE echo is a no-op)
    // 4. On error: flip metadata.status='failed', surface error
    // SSE dedup is handled in handleStreamMessage by matching metadata.client_temp_id.

    const tempId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tempNumericId = -(Math.floor(Math.random() * 1e9) + Date.now());
    const nowIso = new Date().toISOString();

    const optimisticMetadata: Record<string, any> = {
      ...(params.metadata || {}),
      client_temp_id: tempId,
      status: 'sending',
    };

    const optimisticMessage: ChatMessage = {
      id: tempNumericId,
      sender_id: currentUserId,
      message_type: params.messageType || 'chat',
      priority: params.priority || 'normal',
      content: params.content,
      metadata: optimisticMetadata,
      reply_to_id: params.replyToId,
      is_edited: false,
      is_deleted: false,
      is_retracted: false,
      created_at: nowIso,
      updated_at: nowIso,
      sender_name: 'You',
      sender_department: '',
    };

    // Insert immediately so UI renders in <16ms (no network roundtrip).
    if (activeChannelRef.current === params.channelId) {
      setActiveMessages(prev => [...prev, optimisticMessage]);
    }

    try {
      const result = await trpcMutate('chat.sendMessage', {
        channelId: params.channelId,
        content: params.content,
        messageType: params.messageType || 'chat',
        priority: params.priority || 'normal',
        metadata: { ...(params.metadata || {}), client_temp_id: tempId },
        replyToId: params.replyToId,
        attachments: params.attachments,
      });

      // Reconcile: replace the optimistic row with the server row.
      // If SSE already swapped it in (matched by client_temp_id), the temp row is gone
      // and we skip the replace — the server row is already present.
      if (result && activeChannelRef.current === params.channelId) {
        setActiveMessages(prev => {
          const tempIdx = prev.findIndex(m => m.id === tempNumericId);
          if (tempIdx === -1) return prev; // SSE already reconciled
          // Guard against a race where the real server row arrived via SSE
          // with a different lookup (shouldn't happen, but belt-and-braces).
          if (prev.some(m => m.id === result.id)) {
            // Real row already present — just drop the temp.
            const next = [...prev];
            next.splice(tempIdx, 1);
            return next;
          }
          const replaced: ChatMessage = {
            id: result.id,
            sender_id: result.sender_id,
            message_type: result.message_type,
            priority: result.priority,
            content: params.content,
            // Keep client_temp_id in metadata so a late SSE echo dedups correctly.
            metadata: { ...(result.metadata || {}), client_temp_id: tempId },
            reply_to_id: result.reply_to_id,
            is_edited: false,
            is_deleted: false,
            is_retracted: false,
            created_at: result.created_at,
            updated_at: result.created_at,
            sender_name: result.sender_name || 'You',
            sender_department: result.sender_department || '',
          };
          const next = [...prev];
          next[tempIdx] = replaced;
          return next;
        });
      }

      return result;
    } catch (err) {
      // Mark the optimistic row as failed (keeps it visible, user can retry).
      if (activeChannelRef.current === params.channelId) {
        setActiveMessages(prev =>
          prev.map(m =>
            m.id === tempNumericId
              ? { ...m, metadata: { ...(m.metadata || {}), status: 'failed' } }
              : m
          )
        );
      }
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setError(msg);
      throw err;
    }
  }, [currentUserId]);

  const markRead = useCallback(async (channelId: string) => {
    // CHAT.X.2 — optimistic decrement: snapshot the channel's current unread_count
    // and its channel_type, then subtract from A (and B or C) in the same paint.
    // Reconcile against the server-returned summary when the mutation resolves.
    let optimisticDelta: { a: number; b: number; c: number } | null = null;

    setChannels(prev => {
      if (!prev) return prev;
      const allLists: ChatChannel[] = [
        ...prev.my_patients,
        ...prev.departments,
        ...prev.direct_messages,
        ...prev.broadcast,
      ];
      const target = allLists.find(c => c.channel_id === channelId);
      if (target && target.unread_count > 0) {
        const n = target.unread_count;
        optimisticDelta = { a: n, b: 0, c: 0 };
        if (target.channel_type === 'department' || target.channel_type === 'patient') optimisticDelta.b = n;
        else if (target.channel_type === 'direct') optimisticDelta.c = n;
      }
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

    if (optimisticDelta) {
      const { a, b, c } = optimisticDelta;
      setUnreadSummary(prev => ({
        a: Math.max(0, prev.a - a),
        b: Math.max(0, prev.b - b),
        c: Math.max(0, prev.c - c),
      }));
    }

    try {
      const result = await trpcMutate('chat.markRead', { channelId });
      // Reconcile with authoritative server snapshot.
      if (result?.unreadSummary) {
        setUnreadSummary(result.unreadSummary);
      }
    } catch {
      // Mutation failed — pull fresh server state so we don't drift.
      refreshUnreadSummary();
    }
  }, [refreshUnreadSummary]);

  // ---------------------------------------------------------------
  // CHAT.X.0c — Typing debounce
  //
  // We used to fire `chat.setTyping` on every keystroke, which on a busy
  // channel meant dozens of DB writes per second per user. The new contract
  // (per CHAT-X-SPRINT-PRD.md):
  //
  //   - Coalesce rapid keystrokes behind a 250ms debounce before the first
  //     `isTyping=true` write actually hits the server.
  //   - After 1.5s with no further typing calls, auto-send `isTyping=false`
  //     so stale "still typing…" indicators don't linger.
  //   - Hard rate-limit: max 1 server write per 2s per (channel, user).
  //     Second and subsequent `isTyping=true` calls within that window are
  //     silently absorbed (the idle timer keeps the indicator fresh).
  //   - Explicit `isTyping=false` bypasses the rate-limit and always sends
  //     immediately (user clicked away / switched channels).
  //
  // All state is per-channel so switching channels doesn't leak timers.
  // Presence heartbeat is NOT touched here — it's already driven by the
  // SSE connect/disconnect lifecycle in /api/chat/stream/route.ts.
  // ---------------------------------------------------------------
  const typingStateRef = useRef<Map<string, {
    debounceTimer: ReturnType<typeof setTimeout> | null;
    idleTimer: ReturnType<typeof setTimeout> | null;
    lastSentValue: boolean | null;
    lastWriteTs: number;
  }>>(new Map());

  const sendTypingWrite = useCallback((channelId: string, isTyping: boolean) => {
    const st = typingStateRef.current.get(channelId);
    if (st) {
      st.lastSentValue = isTyping;
      st.lastWriteTs = Date.now();
    }
    // Fire-and-forget — typing is ephemeral, we don't care about the result.
    void trpcMutate('chat.setTyping', { channelId, isTyping }).catch(() => {});
  }, []);

  const setTypingAction = useCallback(async (channelId: string, isTyping: boolean): Promise<void> => {
    let st = typingStateRef.current.get(channelId);
    if (!st) {
      st = { debounceTimer: null, idleTimer: null, lastSentValue: null, lastWriteTs: 0 };
      typingStateRef.current.set(channelId, st);
    }

    if (isTyping) {
      // Refresh 1.5s idle timer — auto-stop if no further keystrokes arrive.
      if (st.idleTimer) clearTimeout(st.idleTimer);
      st.idleTimer = setTimeout(() => {
        const cur = typingStateRef.current.get(channelId);
        if (cur?.lastSentValue === true) {
          sendTypingWrite(channelId, false);
        }
        if (cur) cur.idleTimer = null;
      }, 1500);

      // Rate-limit: if we already told the server we're typing and did so
      // within the last 2s, swallow — idle timer will close us out.
      const now = Date.now();
      if (st.lastSentValue === true && (now - st.lastWriteTs) < 2000) {
        return;
      }

      // Debounce 250ms to coalesce rapid keystrokes into one write.
      if (st.debounceTimer) return;
      st.debounceTimer = setTimeout(() => {
        const cur = typingStateRef.current.get(channelId);
        if (!cur) return;
        cur.debounceTimer = null;
        // Re-check rate-limit at fire time (another call may have written in-between).
        const now2 = Date.now();
        if (cur.lastSentValue === true && (now2 - cur.lastWriteTs) < 2000) return;
        sendTypingWrite(channelId, true);
      }, 250);
    } else {
      // Explicit stop — cancel pending timers and flush false if needed.
      if (st.debounceTimer) { clearTimeout(st.debounceTimer); st.debounceTimer = null; }
      if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null; }
      if (st.lastSentValue === true) {
        sendTypingWrite(channelId, false);
      }
    }
  }, [sendTypingWrite]);

  const refreshChannels = useCallback(async () => {
    await loadChannels();
  }, [loadChannels]);

  const loadOlderMessages = useCallback(async (channelId: string): Promise<boolean> => {
    try {
      const oldestMsg = activeMessages[0];
      if (!oldestMsg) return false;

      const params = `?input=${encodeURIComponent(JSON.stringify({ json: { channelId, cursor: oldestMsg.id, limit: 50 } }))}`;
      const res = await fetch(`/api/trpc/chat.listMessages${params}`);
      const json = await res.json();
      const older: ChatMessage[] = json.result?.data?.json || [];

      if (older.length === 0) return false;

      setActiveMessages(prev => [...older, ...prev]);
      return older.length >= 50; // more might exist
    } catch (err) {
      console.error('[ChatProvider] Failed to load older messages:', err);
      return false;
    }
  }, [activeMessages]);

  // ── CHAT.X.2 — Tab title 3-number badge (A · B · C) Even OS ──
  // Format: `(12 · 4 · 2) Even OS` so the user sees, at a glance, total
  // unread / role-scoped / DMs even when this tab is in the background.
  // Falls back to plain title when A=0.
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!originalTitleRef.current && typeof document !== 'undefined') {
      originalTitleRef.current = document.title;
    }
    if (typeof document !== 'undefined') {
      const base = originalTitleRef.current || 'Even OS';
      const { a, b, c } = unreadSummary;
      if (a > 0) {
        const cap = (n: number) => (n > 99 ? '99+' : String(n));
        document.title = `(${cap(a)} · ${cap(b)} · ${cap(c)}) ${base}`;
      } else {
        document.title = base;
      }
    }
  }, [unreadSummary]);

  // ── OC.6: Sound notification for new messages ─────────────
  const prevUnreadRef = useRef(0);
  useEffect(() => {
    // Play subtle notification when unread count increases (not on initial load)
    if (prevUnreadRef.current > 0 || unreadTotal === 0) {
      if (unreadTotal > prevUnreadRef.current && typeof window !== 'undefined') {
        // Check if sound is enabled (stored as preference, default true)
        try {
          // Use a subtle web audio beep (no external file needed)
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 800;
          osc.type = 'sine';
          gain.gain.value = 0.08;
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
        } catch { /* Audio not available — silent fail */ }
      }
    }
    prevUnreadRef.current = unreadTotal;
  }, [unreadTotal]);

  // ── OC.4c: Listen for open-patient-chat custom events ──────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.channelId) {
        openChannel(detail.channelId);
      }
    };
    window.addEventListener('open-patient-chat', handler);
    return () => window.removeEventListener('open-patient-chat', handler);
  }, [openChannel]);

  // ── CHAT.X.2 — Re-sync badge on tab refocus ────────────────
  // While the tab is backgrounded, browsers throttle timers + SSE can
  // stall. When the user comes back we do a single authoritative fetch
  // so the A/B/C badge matches reality before they look at it.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isAuthenticated) {
        refreshUnreadSummary();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isAuthenticated, refreshUnreadSummary]);

  // ── Context value ───────────────────────────────────────────
  const value: ChatContextValue = {
    chatState,
    channels,
    activeChannelId,
    activeMessages,
    unreadTotal,
    unreadSummary,
    typing,
    isLoading,
    isAuthenticated,
    currentUserId,
    error,
    setChatState,
    openChannel,
    closeChannel,
    sendMessage,
    markRead,
    setTyping: setTypingAction,
    refreshChannels,
    loadOlderMessages,
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
