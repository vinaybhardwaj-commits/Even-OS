/**
 * Unit tests for indent SLA arithmetic (Phase 2 per A9 lock).
 */
import { describe, expect, it } from 'vitest';
import { computeSlaDueAt, isSlaBreached, slaTimeRemainingMs } from './indent-sla';

const RAISED = new Date('2026-05-01T09:00:00.000Z');

describe('computeSlaDueAt — base SLAs by priority', () => {
  it('routine + standard = 24h × 2.0 = 48h', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'routine', material_classification: 'standard' });
    expect(due.getTime() - RAISED.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('urgent + standard = 4h × 2.0 = 8h', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'urgent', material_classification: 'standard' });
    expect(due.getTime() - RAISED.getTime()).toBe(8 * 60 * 60 * 1000);
  });

  it('stat + standard = 1h × 2.0 = 2h', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'stat', material_classification: 'standard' });
    expect(due.getTime() - RAISED.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it('emergency + standard = 30min × 2.0 = 1h', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'emergency', material_classification: 'standard' });
    expect(due.getTime() - RAISED.getTime()).toBe(60 * 60 * 1000);
  });
});

describe('computeSlaDueAt — material-class multipliers', () => {
  it('emergency classification = 1.0× (no change)', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'urgent', material_classification: 'emergency' });
    expect(due.getTime() - RAISED.getTime()).toBe(4 * 60 * 60 * 1000);
  });

  it('vital classification = 0.5× (tightened)', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'stat', material_classification: 'vital' });
    expect(due.getTime() - RAISED.getTime()).toBe(30 * 60 * 1000);  // 1h × 0.5 = 30 min
  });

  it('emergency priority + vital classification = 30min × 0.5 = 15 min', () => {
    const due = computeSlaDueAt({ raised_at: RAISED, priority: 'emergency', material_classification: 'vital' });
    expect(due.getTime() - RAISED.getTime()).toBe(15 * 60 * 1000);
  });

  it('null classification defaults to standard 2.0× multiplier', () => {
    const dueNull = computeSlaDueAt({ raised_at: RAISED, priority: 'routine', material_classification: null });
    const dueStandard = computeSlaDueAt({ raised_at: RAISED, priority: 'routine', material_classification: 'standard' });
    expect(dueNull.getTime()).toBe(dueStandard.getTime());
  });
});

describe('isSlaBreached', () => {
  it('null due_at → not breached', () => {
    expect(isSlaBreached({ now: new Date(), sla_due_at: null, state: 'pending' })).toBe(false);
  });

  it('past due in pending → breached', () => {
    const due = new Date('2026-05-01T08:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(isSlaBreached({ now, sla_due_at: due, state: 'pending' })).toBe(true);
  });

  it('future due in pending → not breached', () => {
    const due = new Date('2026-05-01T10:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(isSlaBreached({ now, sla_due_at: due, state: 'pending' })).toBe(false);
  });

  it('past due but received → not breached (terminal good states)', () => {
    const due = new Date('2026-05-01T08:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(isSlaBreached({ now, sla_due_at: due, state: 'received' })).toBe(false);
    expect(isSlaBreached({ now, sla_due_at: due, state: 'closed' })).toBe(false);
  });

  it('past due but rejected/cancelled → not breached (terminal failure states)', () => {
    const due = new Date('2026-05-01T08:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(isSlaBreached({ now, sla_due_at: due, state: 'rejected' })).toBe(false);
    expect(isSlaBreached({ now, sla_due_at: due, state: 'cancelled' })).toBe(false);
  });

  it('past due in approved/issued/in_transit → breached (still in-flight)', () => {
    const due = new Date('2026-05-01T08:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(isSlaBreached({ now, sla_due_at: due, state: 'approved' })).toBe(true);
    expect(isSlaBreached({ now, sla_due_at: due, state: 'issued' })).toBe(true);
    expect(isSlaBreached({ now, sla_due_at: due, state: 'in_transit' })).toBe(true);
  });
});

describe('slaTimeRemainingMs', () => {
  it('null due → null', () => {
    expect(slaTimeRemainingMs({ now: new Date(), sla_due_at: null })).toBeNull();
  });

  it('positive when due in future', () => {
    const due = new Date('2026-05-01T10:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(slaTimeRemainingMs({ now, sla_due_at: due })).toBe(60 * 60 * 1000);
  });

  it('negative when past due', () => {
    const due = new Date('2026-05-01T08:00:00.000Z');
    const now = new Date('2026-05-01T09:00:00.000Z');
    expect(slaTimeRemainingMs({ now, sla_due_at: due })).toBe(-(60 * 60 * 1000));
  });
});
