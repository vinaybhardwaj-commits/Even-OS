import { describe, expect, it } from 'vitest';
import {
  tierAt,
  resolveTierWithEmpanelment,
  validateExactlyOneFk,
  type ChargeTierRow,
} from './charge-tier-resolver';

const SVC_A = '00000000-0000-0000-0000-00000000000a';
const SVC_B = '00000000-0000-0000-0000-00000000000b';
const EMP_X = '00000000-0000-0000-0000-00000000000e';

const baseRow = (over: Partial<ChargeTierRow>): ChargeTierRow => ({
  id: 'r' + Math.random().toString(36).slice(2, 8),
  service_id: SVC_A,
  item_id: null,
  code_kind: 'service',
  class_code: 'GENERAL',
  empanelment_id: null,
  effective_from: '2026-01-01T00:00:00Z',
  effective_to: null,
  price_inr: 100,
  is_open_billing: false,
  package_member_count: 0,
  gst_percentage: 0,
  ...over,
});

describe('tierAt', () => {
  it('returns the current tier when no at is provided (defaults to NOW)', () => {
    const rows = [baseRow({ price_inr: 100 })];
    const r = tierAt({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL' });
    expect(r?.price_inr).toBe(100);
  });

  it('returns null when no class_code matches', () => {
    const rows = [baseRow({ class_code: 'GENERAL' })];
    expect(tierAt({ rows, target: { service_id: SVC_A }, class_code: 'PVT' })).toBeNull();
  });

  it('returns null when no service_id matches', () => {
    const rows = [baseRow({ service_id: SVC_A })];
    expect(tierAt({ rows, target: { service_id: SVC_B }, class_code: 'GENERAL' })).toBeNull();
  });

  it('respects historical bill resolution (picks tier valid at the bill date)', () => {
    const rows = [
      baseRow({ id: 'old', effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-04-01T00:00:00Z', price_inr: 80 }),
      baseRow({ id: 'new', effective_from: '2026-04-01T00:00:00Z', effective_to: null, price_inr: 100 }),
    ];
    // Bill from Feb 2026 should resolve the old tier
    const old = tierAt({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', at: new Date('2026-02-15T12:00:00Z') });
    expect(old?.id).toBe('old');
    expect(old?.price_inr).toBe(80);
    // Bill from May 2026 should resolve the new tier
    const fresh = tierAt({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', at: new Date('2026-05-15T12:00:00Z') });
    expect(fresh?.id).toBe('new');
    expect(fresh?.price_inr).toBe(100);
  });

  it('matches empanelment_id (null = standard, set = override)', () => {
    const rows = [
      baseRow({ id: 'std', empanelment_id: null, price_inr: 100 }),
      baseRow({ id: 'emp', empanelment_id: EMP_X, price_inr: 80 }),
    ];
    expect(tierAt({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', empanelment_id: null })?.id).toBe('std');
    expect(tierAt({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', empanelment_id: EMP_X })?.id).toBe('emp');
  });

  it('picks the most recent effective_from when multiple match', () => {
    const rows = [
      baseRow({ id: 'old', effective_from: '2026-01-01T00:00:00Z', price_inr: 80 }),
      baseRow({ id: 'mid', effective_from: '2026-03-01T00:00:00Z', price_inr: 90 }),
      baseRow({ id: 'newer', effective_from: '2026-04-01T00:00:00Z', price_inr: 100 }),
    ];
    const r = tierAt({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', at: new Date('2026-05-01T00:00:00Z') });
    expect(r?.id).toBe('newer');
  });
});

describe('resolveTierWithEmpanelment', () => {
  it('prefers empanelment override when present', () => {
    const rows = [
      baseRow({ id: 'std', empanelment_id: null, price_inr: 100 }),
      baseRow({ id: 'emp', empanelment_id: EMP_X, price_inr: 75 }),
    ];
    const r = resolveTierWithEmpanelment({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', empanelment_id: EMP_X });
    expect(r.tier?.id).toBe('emp');
    expect(r.resolved_via).toBe('empanelment_override');
  });

  it('falls back to standard when no empanelment override', () => {
    const rows = [baseRow({ id: 'std', empanelment_id: null, price_inr: 100 })];
    const r = resolveTierWithEmpanelment({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', empanelment_id: EMP_X });
    expect(r.tier?.id).toBe('std');
    expect(r.resolved_via).toBe('standard');
  });

  it('returns none when neither empanelment nor standard match', () => {
    const r = resolveTierWithEmpanelment({ rows: [], target: { service_id: SVC_A }, class_code: 'GENERAL', empanelment_id: null });
    expect(r.tier).toBeNull();
    expect(r.resolved_via).toBe('none');
  });

  it('uses standard when empanelment_id arg is null', () => {
    const rows = [baseRow({ id: 'std', empanelment_id: null, price_inr: 100 })];
    const r = resolveTierWithEmpanelment({ rows, target: { service_id: SVC_A }, class_code: 'GENERAL', empanelment_id: null });
    expect(r.tier?.id).toBe('std');
    expect(r.resolved_via).toBe('standard');
  });
});

describe('validateExactlyOneFk', () => {
  it('returns null on exactly-one (item)', () => {
    expect(validateExactlyOneFk({ item_id: 'x', service_id: null, code_kind: 'item' })).toBeNull();
  });
  it('returns null on exactly-one (service)', () => {
    expect(validateExactlyOneFk({ service_id: 'x', item_id: null, code_kind: 'service' })).toBeNull();
  });
  it('rejects both', () => {
    expect(validateExactlyOneFk({ item_id: 'x', service_id: 'y' })).toMatch(/both/);
  });
  it('rejects neither', () => {
    expect(validateExactlyOneFk({ item_id: null, service_id: null })).toMatch(/neither/);
  });
  it('rejects code_kind item with no item_id', () => {
    expect(validateExactlyOneFk({ service_id: 'x', code_kind: 'item' })).toMatch(/item_id is NULL/);
  });
});
