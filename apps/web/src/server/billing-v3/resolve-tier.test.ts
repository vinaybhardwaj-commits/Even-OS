import { describe, expect, it } from 'vitest';
import { resolveTierWithEmpanelment, type ChargeTierRow } from '@/server/codes/charge-tier-resolver';

// =============================================================================
// BV3 Phase 2 — resolveTier flow integration tests
// =============================================================================
// The router-level resolveTier wraps charge_tier_resolver with the
// billing_charge → charge_master_item → service_codes → code_charge_tiers
// FK bridge. These tests exercise the resolver with realistic shapes that
// match what the router-level procedure feeds in.
// =============================================================================

const SVC = '00000000-0000-0000-0000-000000000aaa';

function tier(over: Partial<ChargeTierRow>): ChargeTierRow {
  return {
    id: over.id ?? `t-${Math.random().toString(36).slice(2, 8)}`,
    service_id: SVC,
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
  };
}

describe('resolveTier flow — historical bill resolution', () => {
  it('picks the tier in effect at posted_at', () => {
    const rows = [
      tier({ id: 'before-march', effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-03-01T00:00:00Z', price_inr: 80 }),
      tier({ id: 'after-march', effective_from: '2026-03-01T00:00:00Z', effective_to: null, price_inr: 100 }),
    ];
    const r = resolveTierWithEmpanelment({
      rows,
      target: { service_id: SVC },
      class_code: 'GENERAL',
      empanelment_id: null,
      at: new Date('2026-02-15T10:00:00Z'),
    });
    expect(r.tier?.id).toBe('before-march');
    expect(r.tier?.price_inr).toBe(80);
    expect(r.resolved_via).toBe('standard');
  });

  it('returns null when posted_at is before any tier became effective', () => {
    const rows = [tier({ effective_from: '2026-06-01T00:00:00Z', price_inr: 100 })];
    const r = resolveTierWithEmpanelment({
      rows,
      target: { service_id: SVC },
      class_code: 'GENERAL',
      empanelment_id: null,
      at: new Date('2026-04-01T00:00:00Z'),
    });
    expect(r.tier).toBeNull();
    expect(r.resolved_via).toBe('none');
  });

  it('class_code mismatch returns null even when tier exists for other classes', () => {
    const rows = [tier({ class_code: 'PVT', price_inr: 200 })];
    const r = resolveTierWithEmpanelment({
      rows,
      target: { service_id: SVC },
      class_code: 'GENERAL',
      empanelment_id: null,
    });
    expect(r.tier).toBeNull();
  });
});

describe('resolveTier flow — empanelment override', () => {
  it('picks corporate-empanelment tier over standard when empanelment_id passed', () => {
    const EMP_BHEL = '00000000-0000-0000-0000-00000000bbb1';
    const rows = [
      tier({ id: 'standard', empanelment_id: null, price_inr: 100 }),
      tier({ id: 'bhel-override', empanelment_id: EMP_BHEL, price_inr: 75 }),
    ];
    const r = resolveTierWithEmpanelment({
      rows,
      target: { service_id: SVC },
      class_code: 'GENERAL',
      empanelment_id: EMP_BHEL,
    });
    expect(r.tier?.id).toBe('bhel-override');
    expect(r.tier?.price_inr).toBe(75);
    expect(r.resolved_via).toBe('empanelment_override');
  });

  it('falls back to standard when empanelment has no override for this class', () => {
    const EMP_BHEL = '00000000-0000-0000-0000-00000000bbb1';
    const rows = [
      tier({ id: 'standard', empanelment_id: null, price_inr: 100 }),
      tier({ id: 'bhel-pvt-only', empanelment_id: EMP_BHEL, class_code: 'PVT', price_inr: 150 }),
    ];
    const r = resolveTierWithEmpanelment({
      rows,
      target: { service_id: SVC },
      class_code: 'GENERAL', // BHEL has no GENERAL override
      empanelment_id: EMP_BHEL,
    });
    expect(r.tier?.id).toBe('standard');
    expect(r.resolved_via).toBe('standard');
  });
});

describe('reconciliation flag (router-level)', () => {
  // This emulates what billingV3.charges.resolveTier returns
  it('matches when historical price equals current tier', () => {
    const tierRows = [tier({ price_inr: 528 })];
    const r = resolveTierWithEmpanelment({
      rows: tierRows, target: { service_id: SVC }, class_code: 'GENERAL', empanelment_id: null,
    });
    const expected = String(r.tier?.price_inr ?? '');
    const actual = '528.00';
    const matches = parseFloat(expected).toFixed(2) === parseFloat(actual).toFixed(2);
    expect(matches).toBe(true);
  });
  it('flags mismatch when prices diverge by even 1 paisa', () => {
    const tierRows = [tier({ price_inr: 528 })];
    const r = resolveTierWithEmpanelment({
      rows: tierRows, target: { service_id: SVC }, class_code: 'GENERAL', empanelment_id: null,
    });
    const expected = String(r.tier?.price_inr ?? '');
    const actual = '528.01';
    const matches = parseFloat(expected).toFixed(2) === parseFloat(actual).toFixed(2);
    expect(matches).toBe(false);
  });
});

describe('searchUnified dedup logic (model)', () => {
  // The router-level dedup compares legacy charge_master.charge_code against
  // service_codes.legacy_code; if a service_code reclaims a legacy code, the
  // tier-backed row wins. This test models that behavior.
  it('tier row wins when its service_code.legacy_code equals legacy charge_code', () => {
    const legacyRows = [
      { source: 'charge_master', charge_code: 'LHA00001', charge_name: 'ABS EOS COUNT', price: '422.00' },
    ];
    const tierRowsEntities = [
      { source: 'code_charge_tiers', charge_code: 'S-LB-LBI-0001', charge_name: 'ABSOLUTE EOSINOPHIL COUNT', service_code_legacy: 'LHA00001', price: '422.00' },
    ];
    const tierLegacyCodes = new Set(tierRowsEntities.map((r) => r.service_code_legacy));
    const dedupedLegacy = legacyRows.filter((r) => !tierLegacyCodes.has(r.charge_code));
    expect(dedupedLegacy).toHaveLength(0);
    expect(tierRowsEntities).toHaveLength(1);
  });
});
