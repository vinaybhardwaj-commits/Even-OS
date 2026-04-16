/**
 * Adaptive Polling Engine — OC.1c
 *
 * Manages poll intervals based on chat UI state:
 *   Chat room open → 2s (active conversation)
 *   Sidebar open   → 3s (browsing channels)
 *   Collapsed      → 5s (badge updates)
 *   Tab hidden     → 15s (background)
 *   Tab refocused  → immediate poll
 *
 * Uses cursor-based polling (last_event_id) to avoid gaps/duplicates.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type ChatUIState = 'collapsed' | 'sidebar' | 'chatroom';

export interface PollResult {
  messages: PollMessage[];
  typing: TypingIndicator[];
  unreadCounts: Record<string, number>;
  lastEventId: number;
  serverTime: string;
}

export interface PollMessage {
  id: number;
  channel_id: string;
  sender_id: string | null;
  message_type: string;
  priority: string;
  content_preview: string;
  created_at: string;
  is_retracted: boolean;
  metadata: Record<string, any>;
  sender_name: string;
  sender_department: string;
}

export interface TypingIndicator {
  channel_id: string;
  user_id: string;
  user_name: string;
}

// ── Interval Constants ──────────────────────────────────────────────────────

const POLL_INTERVALS: Record<ChatUIState, number> = {
  chatroom: 2000,
  sidebar: 3000,
  collapsed: 5000,
};
const BACKGROUND_INTERVAL = 15000;

// ── tRPC helpers (match existing Even OS pattern) ───────────────────────────

async function trpcQuery(path: string, input?: any): Promise<any> {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Poll error');
  return json.result?.data?.json;
}

export async function trpcMutate(path: string, input: any): Promise<any> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(`Mutation failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Mutation error');
  return json.result?.data?.json;
}

// ── Polling Engine ──────────────────────────────────────────────────────────

export class ChatPollEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastEventId = 0;
  private uiState: ChatUIState = 'collapsed';
  private isTabVisible = true;
  private onPollResult: ((result: PollResult) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private isPolling = false;
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 5;

  constructor() {
    // Track tab visibility for background throttling
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
  }

  /** Start the polling loop */
  start(
    onResult: (result: PollResult) => void,
    onError: (error: Error) => void,
    initialLastEventId = 0,
  ) {
    this.onPollResult = onResult;
    this.onError = onError;
    this.lastEventId = initialLastEventId;
    this.consecutiveErrors = 0;
    this.scheduleNext();
  }

  /** Stop polling */
  stop() {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  }

  /** Update UI state → changes poll interval on next tick */
  setUIState(state: ChatUIState) {
    if (this.uiState !== state) {
      this.uiState = state;
      // Restart with new interval
      if (this.intervalId) {
        clearTimeout(this.intervalId);
        this.scheduleNext();
      }
    }
  }

  /** Get current last_event_id (for external use) */
  getLastEventId() {
    return this.lastEventId;
  }

  /** Force an immediate poll (e.g., after sending a message) */
  async pollNow(): Promise<PollResult | null> {
    return this.executePoll();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private getInterval(): number {
    if (!this.isTabVisible) return BACKGROUND_INTERVAL;
    return POLL_INTERVALS[this.uiState];
  }

  private scheduleNext() {
    this.intervalId = setTimeout(async () => {
      await this.executePoll();
      if (this.intervalId !== null) this.scheduleNext();
    }, this.getInterval());
  }

  private async executePoll(): Promise<PollResult | null> {
    if (this.isPolling) return null; // Skip overlapping polls
    this.isPolling = true;

    try {
      const result: PollResult = await trpcQuery('chat.poll', {
        lastEventId: this.lastEventId,
      });

      this.consecutiveErrors = 0;

      if (result.lastEventId > this.lastEventId) {
        this.lastEventId = result.lastEventId;
      }

      this.onPollResult?.(result);
      return result;
    } catch (err) {
      this.consecutiveErrors++;
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError?.(error);

      // After too many consecutive errors, slow down polling
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.warn('[ChatPoll] Too many consecutive errors, slowing to 30s');
      }
      return null;
    } finally {
      this.isPolling = false;
    }
  }

  private handleVisibility = () => {
    const wasHidden = !this.isTabVisible;
    this.isTabVisible = document.visibilityState === 'visible';

    if (this.isTabVisible && wasHidden) {
      // Tab refocused — poll immediately
      this.executePoll();
      // Restart with active interval
      if (this.intervalId) {
        clearTimeout(this.intervalId);
        this.scheduleNext();
      }
    } else if (!this.isTabVisible) {
      // Tab hidden — switch to background interval
      if (this.intervalId) {
        clearTimeout(this.intervalId);
        this.scheduleNext();
      }
    }
  };
}

// ── Channel list fetch (initial load) ───────────────────────────────────────

export async function fetchChannels() {
  return trpcQuery('chat.listChannels');
}

export async function fetchChannelDetails(channelId: string) {
  return trpcQuery('chat.getChannel', { channelId });
}
