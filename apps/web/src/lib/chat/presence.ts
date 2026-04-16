/**
 * Presence Tracker — OC.1c
 *
 * Derives online/away/offline status from last_seen_at timestamps.
 * Status is updated as a side-effect of each poll (heartbeat in poll endpoint).
 *
 * Thresholds:
 *   online:  last_seen_at < 10 seconds ago
 *   away:    last_seen_at 10-60 seconds ago
 *   offline: last_seen_at > 60 seconds ago
 */

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface UserPresence {
  userId: string;
  name: string;
  department?: string;
  status: PresenceStatus;
}

// ── Thresholds (seconds) ────────────────────────────────────────────────────

const ONLINE_THRESHOLD = 10;
const AWAY_THRESHOLD = 60;

/**
 * Derive presence status from a last_seen_at timestamp string.
 */
export function derivePresence(lastSeenAt: string | null): PresenceStatus {
  if (!lastSeenAt) return 'offline';
  const diff = (Date.now() - new Date(lastSeenAt).getTime()) / 1000;
  if (diff <= ONLINE_THRESHOLD) return 'online';
  if (diff <= AWAY_THRESHOLD) return 'away';
  return 'offline';
}

/**
 * Given a list of members with presence info from the server,
 * return sorted by online → away → offline, then alphabetical.
 */
export function sortByPresence(members: UserPresence[]): UserPresence[] {
  const order: Record<PresenceStatus, number> = { online: 0, away: 1, offline: 2 };
  return [...members].sort((a, b) => {
    const statusDiff = order[a.status] - order[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Count online users from a presence array.
 */
export function countOnline(members: UserPresence[]): number {
  return members.filter(m => m.status === 'online').length;
}
