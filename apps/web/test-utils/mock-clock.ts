/**
 * Deterministic timestamps for SLA / working-day / expiry tests.
 *
 * Uses Vitest's fake-timers with a default mock instant of
 * **1 May 2026 09:00:00 IST** — first business day post our 30 Apr 2026
 * PRD-wave lock. Adjust per-test if needed.
 *
 * USAGE:
 *
 *   import { withMockClock, advanceClock } from '@/test-utils/mock-clock';
 *
 *   describe('indent SLA', () => {
 *     withMockClock();  // pins time to 1 May 2026 09:00 IST
 *
 *     it('breaches SLA after 24h', () => {
 *       const indent = createIndent({ priority: 'urgent' });
 *       advanceClock({ hours: 25 });
 *       expect(isSlaBreached(indent)).toBe(true);
 *     });
 *   });
 *
 * NOTE: Mocks Date, setTimeout, setInterval, queueMicrotask, etc. — the full
 *       set Vitest supports. `vi.useRealTimers()` restored automatically.
 */
import { afterEach, beforeEach, vi } from 'vitest';

export const DEFAULT_MOCK_INSTANT = new Date('2026-05-01T03:30:00.000Z'); // 09:00 IST

export function withMockClock(initial: Date | string | number = DEFAULT_MOCK_INSTANT): void {
  beforeEach(() => {
    vi.useFakeTimers({
      now: initial instanceof Date ? initial : new Date(initial),
      shouldAdvanceTime: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

export function advanceClock(by: {
  ms?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
}): void {
  const ms =
    (by.ms ?? 0) +
    (by.seconds ?? 0) * 1000 +
    (by.minutes ?? 0) * 60_000 +
    (by.hours ?? 0) * 3_600_000 +
    (by.days ?? 0) * 86_400_000;
  vi.advanceTimersByTime(ms);
}

export function setMockInstant(instant: Date | string | number): void {
  vi.setSystemTime(instant instanceof Date ? instant : new Date(instant));
}

/**
 * Number of "working days" between two timestamps, IST.
 * Used by SLA tests for indents / approvals / dead-letter retention.
 */
export function workingDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endNorm = new Date(end);
  endNorm.setHours(0, 0, 0, 0);

  while (cursor < endNorm) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
