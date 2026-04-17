/**
 * ChatStreamEngine — OC.8b
 *
 * Client-side EventSource wrapper that replaces ChatPollEngine.
 * Connects to /api/chat/stream (SSE) for real-time message delivery.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff (EventSource built-in + custom)
 *   - Last-Event-ID cursor tracking (no missed messages across reconnects)
 *   - Tab visibility awareness (closes stream when hidden, reopens on focus)
 *   - UI state awareness (different poll intervals for chatroom vs collapsed)
 *
 * The provider API stays identical — components don't know whether data
 * comes from polling or SSE.
 */

import type { ChatUIState, PollResult } from './poll';

// ── Types ──────────────────────────────────────────────────────────────────

type OnMessageCallback = (result: PollResult) => void;
type OnTypingCallback = (data: { typing: Array<{ channel_id: string; user_id: string; user_name: string }> }) => void;
type OnErrorCallback = (error: Error) => void;

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

// ── Engine ─────────────────────────────────────────────────────────────────

export class ChatStreamEngine {
  private eventSource: EventSource | null = null;
  private lastEventId = 0;
  private uiState: ChatUIState = 'collapsed';
  private isTabVisible = true;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private onMessage: OnMessageCallback | null = null;
  private onTyping: OnTypingCallback | null = null;
  private onError: OnErrorCallback | null = null;

  private boundVisibilityHandler: (() => void) | null = null;

  /** Start the SSE stream */
  start(
    onMessage: OnMessageCallback,
    onError: OnErrorCallback,
    initialLastEventId = 0,
  ) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.lastEventId = initialLastEventId;
    this.reconnectAttempts = 0;

    // Track tab visibility
    if (typeof document !== 'undefined') {
      this.boundVisibilityHandler = this.handleVisibility.bind(this);
      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }

    this.connect();
  }

  /** Stop the stream and clean up */
  stop() {
    this.disconnect();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof document !== 'undefined' && this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    this.onMessage = null;
    this.onTyping = null;
    this.onError = null;
  }

  /** Update UI state → reconnects with new interval param */
  setUIState(state: ChatUIState) {
    if (this.uiState !== state) {
      this.uiState = state;
      // Reconnect with new interval (server uses uiState to set poll speed)
      if (this.eventSource) {
        this.disconnect();
        this.connect();
      }
    }
  }

  /** Set a typing callback (separate from message callback) */
  setOnTyping(cb: OnTypingCallback) {
    this.onTyping = cb;
  }

  /** Get current cursor for external use */
  getLastEventId() {
    return this.lastEventId;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private connect() {
    if (typeof window === 'undefined') return;
    if (!this.isTabVisible) return; // Don't connect when tab is hidden

    const url = `/api/chat/stream?lastEventId=${this.lastEventId}&uiState=${this.uiState}`;
    const es = new EventSource(url);
    this.eventSource = es;

    es.addEventListener('messages', (e: MessageEvent) => {
      this.reconnectAttempts = 0; // Reset backoff on success

      try {
        const data: PollResult = JSON.parse(e.data);

        // Track cursor
        if (data.lastEventId > this.lastEventId) {
          this.lastEventId = data.lastEventId;
        }

        this.onMessage?.(data);
      } catch (err) {
        console.warn('[ChatStream] Failed to parse messages event:', err);
      }
    });

    es.addEventListener('typing', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.onTyping?.(data);
      } catch (err) {
        console.warn('[ChatStream] Failed to parse typing event:', err);
      }
    });

    es.onerror = () => {
      // EventSource fires error on close, reconnect attempt, or actual failure.
      // readyState === CLOSED means the server closed the connection (e.g., Vercel 300s limit).
      // readyState === CONNECTING means EventSource is already trying to reconnect.
      if (es.readyState === EventSource.CLOSED) {
        // Server closed the stream — reconnect manually with backoff
        this.disconnect();
        this.scheduleReconnect();
      }
      // If CONNECTING, let EventSource handle it (built-in reconnect)
    };

    es.onopen = () => {
      this.reconnectAttempts = 0;
    };
  }

  private disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return; // Already scheduled

    const delay = Math.min(
      BASE_RECONNECT_MS * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_MS,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isTabVisible) {
        this.connect();
      }
    }, delay);
  }

  private handleVisibility() {
    const wasHidden = !this.isTabVisible;
    this.isTabVisible = document.visibilityState === 'visible';

    if (this.isTabVisible && wasHidden) {
      // Tab refocused — reconnect if not connected
      if (!this.eventSource || this.eventSource.readyState === EventSource.CLOSED) {
        this.reconnectAttempts = 0; // Fresh start on focus
        this.connect();
      }
    } else if (!this.isTabVisible) {
      // Tab hidden — close stream to save server resources
      this.disconnect();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }
  }
}
