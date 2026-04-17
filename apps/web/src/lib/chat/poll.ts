/**
 * Chat API helpers — OC.1c → OC.8 (SSE)
 *
 * tRPC query/mutation wrappers and type definitions used across chat components.
 * The ChatPollEngine class was removed in OC.8 — real-time delivery now uses
 * ChatStreamEngine (SSE) in @/lib/chat/stream.
 *
 * This file is kept as `poll.ts` to avoid breaking 7+ component import paths.
 * It exports: types, trpcMutate, trpcQuery, fetchChannels, fetchChannelDetails.
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

// ── tRPC helpers (used by 7+ components for mutations & queries) ────────────

async function trpcQuery(path: string, input?: any): Promise<any> {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Query error');
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

// ── Channel list fetch (initial load + refresh) ─────────────────────────────

export async function fetchChannels() {
  return trpcQuery('chat.listChannels');
}

export async function fetchChannelDetails(channelId: string) {
  return trpcQuery('chat.getChannel', { channelId });
}
