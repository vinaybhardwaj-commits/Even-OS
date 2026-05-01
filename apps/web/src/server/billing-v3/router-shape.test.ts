import { describe, expect, it } from 'vitest';
import { billingV3Router } from '@/server/routers/billing-v3';

// =============================================================================
// Billing v3 — router shape tests
// =============================================================================
// Type-safe assertions that the read-mostly Phase 1 router exposes the
// procedures admin pages + chart will rely on. If a procedure is renamed or
// removed, the test fails loudly.
// =============================================================================

const EXPECTED_PROCEDURES = [
  // bootstrap
  'bootstrap.status',
  // items
  'items.list',
  'items.detail',
  // rooms
  'rooms.list',
  // packages
  'packages.list',
  // discountPolicies
  'discountPolicies.list',
  // hospitalSetting
  'hospitalSetting.get',
  // charges
  'charges.list',
  // tariffImports
  'tariffImports.list',
  // accountPayers
  'accountPayers.list',
];

function flatten(router: any, prefix = ''): string[] {
  // tRPC router internals: _def.procedures (procedures + subrouters)
  const def = (router as any)._def?.procedures ?? {};
  const out: string[] = [];
  for (const [k, v] of Object.entries(def)) {
    const path = prefix ? `${prefix}.${k}` : k;
    // Subrouter? It will have _def.procedures as well.
    if ((v as any)?._def?.procedures) {
      out.push(...flatten(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('billingV3Router shape', () => {
  const surfaces = flatten(billingV3Router);

  for (const p of EXPECTED_PROCEDURES) {
    it(`exposes billingV3.${p}`, () => {
      expect(surfaces).toContain(p);
    });
  }

  it('exposes exactly the expected procedure surface (no surprise mutations)', () => {
    // Phase 1 is read-mostly — assert there are no `mutation` typed entries.
    // tRPC v11: procedure has `_def.type: 'query' | 'mutation' | 'subscription'`
    function visit(router: any, prefix = ''): Array<[string, string]> {
      const def = (router as any)._def?.procedures ?? {};
      const found: Array<[string, string]> = [];
      for (const [k, v] of Object.entries(def)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if ((v as any)?._def?.procedures) {
          found.push(...visit(v, path));
        } else {
          const t = (v as any)?._def?.type ?? 'query';
          found.push([path, t]);
        }
      }
      return found;
    }
    const all = visit(billingV3Router);
    const mutations = all.filter(([, t]) => t === 'mutation');
    expect(mutations).toEqual([]); // Phase 1 must ship zero mutations
  });

  it('procedure count matches expectation (regression guard)', () => {
    expect(surfaces.length).toBe(EXPECTED_PROCEDURES.length);
  });
});
