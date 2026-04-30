/**
 * Phase 0 smoke test — proves the test infra works.
 *
 * If this passes:
 *   - Vitest config loads
 *   - Setup file runs
 *   - Factories instantiate with deterministic defaults
 *   - Mock clock pinning works
 *   - Working-day arithmetic is correct
 *
 * Does NOT touch the DB. DB integration verification lives in
 * tests/db-smoke.test.ts (gated behind VITEST_INTEGRATION=1).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  makeVendor,
  makeItem,
  makeIndent,
  makePurchaseOrder,
  makeHospital,
  makeAllFourHospitals,
  resetFactoryCounters,
} from '../test-utils/factories';
import {
  DEFAULT_MOCK_INSTANT,
  workingDaysBetween,
} from '../test-utils/mock-clock';

describe('Phase 0 smoke — factories', () => {
  it('makeHospital returns EHRC by default', () => {
    const h = makeHospital();
    expect(h.hospital_id).toBe('EHRC');
    expect(h.is_active).toBe(true);
  });

  it('makeAllFourHospitals returns the December launch network', () => {
    const all = makeAllFourHospitals();
    expect(all).toHaveLength(4);
    const ids = all.map((h) => h.hospital_id);
    expect(ids).toContain('EHRC');
    expect(ids).toContain('EHIN');
    // EHBR / EHBF naming TBD — see factories.ts comment
  });

  it('makeVendor produces unique vendor_codes', () => {
    resetFactoryCounters();
    const v1 = makeVendor();
    const v2 = makeVendor();
    expect(v1.vendor_code).not.toBe(v2.vendor_code);
    expect(v1.vendor_code).toMatch(/^V\d{4}$/);
  });

  it('makeVendor honors overrides', () => {
    const v = makeVendor({ vendor_name: 'Specific Pharma', is_active: false });
    expect(v.vendor_name).toBe('Specific Pharma');
    expect(v.is_active).toBe(false);
  });

  it('makeItem defaults to drug kind with SOP-format code', () => {
    resetFactoryCounters();
    const item = makeItem();
    expect(item.kind).toBe('drug');
    expect(item.code).toMatch(/^M-N-PH-\d{5}$/);
    expect(item.hospital_id).toBeNull(); // network-shared per Codes Q8
  });

  it('makeIndent starts in pending state with routine priority', () => {
    const indent = makeIndent();
    expect(indent.state).toBe('pending');
    expect(indent.priority).toBe('routine');
  });

  it('makePurchaseOrder starts in draft', () => {
    const po = makePurchaseOrder();
    expect(po.status).toBe('draft');
    expect(po.po_number).toMatch(/^PO-2026-\d{5}$/);
  });
});

describe('Phase 0 smoke — mock clock', () => {
  it('DEFAULT_MOCK_INSTANT is 1 May 2026 09:00 IST', () => {
    // 09:00 IST = 03:30 UTC
    expect(DEFAULT_MOCK_INSTANT.toISOString()).toBe('2026-05-01T03:30:00.000Z');
  });

  it('workingDaysBetween counts Mon-Fri only', () => {
    // Friday 1 May 2026 → Monday 4 May 2026 = 1 working day (Friday counted; weekend skipped; Monday is end exclusive in this impl)
    const start = new Date('2026-05-01T00:00:00+05:30'); // Fri
    const end = new Date('2026-05-04T00:00:00+05:30'); // Mon
    expect(workingDaysBetween(start, end)).toBe(1);
  });

  it('workingDaysBetween returns 5 for a full work week', () => {
    const monday = new Date('2026-05-04T00:00:00+05:30');
    const nextMonday = new Date('2026-05-11T00:00:00+05:30');
    expect(workingDaysBetween(monday, nextMonday)).toBe(5);
  });
});

describe('Phase 0 smoke — vitest features wired', () => {
  it('vi.fn works', () => {
    const fn = vi.fn(() => 42);
    expect(fn()).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('async test works', async () => {
    const promise = Promise.resolve('phase-0');
    await expect(promise).resolves.toBe('phase-0');
  });
});
