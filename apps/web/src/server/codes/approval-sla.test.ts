import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  slaRemainingPct,
  slaSeverity,
  describeSla,
} from './approval-sla';

// Pin a known weekday for deterministic tests. Mon 2026-05-04 = day-of-week 1.
const MON = new Date('2026-05-04T09:00:00Z');
const TUE = new Date('2026-05-05T09:00:00Z');
const WED = new Date('2026-05-06T09:00:00Z');
const THU = new Date('2026-05-07T09:00:00Z');
const FRI = new Date('2026-05-08T09:00:00Z');
const NEXT_MON = new Date('2026-05-11T09:00:00Z');

describe('addWorkingDays', () => {
  it('+1 from Mon → Tue', () => {
    expect(addWorkingDays(MON, 1).toISOString()).toBe(TUE.toISOString());
  });
  it('+5 from Mon → next Mon (skips Sat+Sun)', () => {
    expect(addWorkingDays(MON, 5).toISOString()).toBe(NEXT_MON.toISOString());
  });
  it('+1 from Fri → next Mon (skips Sat+Sun)', () => {
    expect(addWorkingDays(FRI, 1).toISOString()).toBe(NEXT_MON.toISOString());
  });
  it('+0 → unchanged', () => {
    expect(addWorkingDays(MON, 0).toISOString()).toBe(MON.toISOString());
  });
});

describe('slaRemainingPct', () => {
  it('100% at start', () => {
    expect(slaRemainingPct(MON, 3, MON)).toBe(100);
  });
  it('~50% halfway through', () => {
    // SLA window: Mon → Thu (3 working days). Halfway = Tue evening / Wed early.
    const midpoint = new Date('2026-05-05T21:00:00Z'); // ~36h in
    const pct = slaRemainingPct(MON, 3, midpoint);
    expect(pct).toBeLessThan(70);
    expect(pct).toBeGreaterThan(30);
  });
  it('0% at deadline', () => {
    expect(slaRemainingPct(MON, 3, THU)).toBeCloseTo(0, 1);
  });
  it('negative past deadline', () => {
    const pastDeadline = new Date('2026-05-09T09:00:00Z'); // Sat after Thu deadline
    expect(slaRemainingPct(MON, 3, pastDeadline)).toBeLessThan(0);
  });
  it('returns 100 for slaWorkingDays=0', () => {
    expect(slaRemainingPct(MON, 0)).toBe(100);
  });
});

describe('slaSeverity', () => {
  it('green > 50%', () => {
    expect(slaSeverity(80)).toBe('green');
    expect(slaSeverity(51)).toBe('green');
  });
  it('amber 0-50%', () => {
    expect(slaSeverity(50)).toBe('amber');
    expect(slaSeverity(25)).toBe('amber');
    expect(slaSeverity(0.1)).toBe('amber');
  });
  it('red exactly at 0', () => {
    expect(slaSeverity(0)).toBe('red');
  });
  it('overdue < 0', () => {
    expect(slaSeverity(-1)).toBe('overdue');
    expect(slaSeverity(-50)).toBe('overdue');
  });
});

describe('describeSla', () => {
  it('returns soft_escalate flag at 50%', () => {
    const midpoint = new Date('2026-05-05T21:00:00Z');
    const r = describeSla(MON, 3, midpoint);
    expect(r.soft_escalate || r.severity === 'amber').toBe(true);
    expect(r.hard_escalate).toBe(false);
  });
  it('returns hard_escalate flag past deadline', () => {
    const overdue = new Date('2026-05-15T09:00:00Z');
    const r = describeSla(MON, 3, overdue);
    expect(r.hard_escalate).toBe(true);
    expect(r.severity).toBe('overdue');
  });
  it('produces a deadline that is `slaWorkingDays` working days after start', () => {
    const r = describeSla(MON, 3);
    expect(r.deadline.toISOString()).toBe(THU.toISOString());
  });
});
