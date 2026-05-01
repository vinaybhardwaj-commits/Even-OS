/**
 * Unit tests for SCM SoD logic — pure functions, no DB.
 *
 * Phase 1.7. Mirrors the conflict matrix from /admin/scm/roles spec and
 * the production module sod-permissions.ts.
 *
 * Scope:
 *   ✓ findSoDConflicts() — exhaustive check across the 7-role matrix
 *   ✓ assertNoSoDConflict() — throws BAD_REQUEST on conflict, passes otherwise
 *   ✓ isAppAdmin() — only super_admin / hospital_admin pass
 *   ✓ SCM_ROLES + SCM_SOD_CONFLICTS shape invariants
 *
 * Out of scope (covered by integration suite):
 *   - listUserScmRoles (DB-backed)
 *   - assertHasScmRole (DB-backed; stack: listUserScmRoles → permission check)
 */
import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  type ScmRole,
  SCM_ROLES,
  SCM_SOD_CONFLICTS,
  SCM_ROLE_LABELS,
  findSoDConflicts,
  assertNoSoDConflict,
  isAppAdmin,
} from './sod-permissions';

describe('SCM_ROLES + SCM_SOD_CONFLICTS shape invariants', () => {
  it('SCM_ROLES contains exactly the 7 expected roles', () => {
    expect(SCM_ROLES).toHaveLength(7);
    expect(new Set(SCM_ROLES)).toEqual(
      new Set([
        'pr_creator',
        'po_approver',
        'po_creator',
        'grn_creator',
        'inventory_manager',
        'item_master_steward',
        'scm_admin',
      ])
    );
  });

  it('SCM_SOD_CONFLICTS has an entry for every role', () => {
    for (const role of SCM_ROLES) {
      expect(SCM_SOD_CONFLICTS[role]).toBeDefined();
    }
  });

  it('SCM_ROLE_LABELS has an entry for every role', () => {
    for (const role of SCM_ROLES) {
      expect(SCM_ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('conflict matrix is symmetric (A conflicts with B ⇒ B conflicts with A)', () => {
    for (const a of SCM_ROLES) {
      for (const b of SCM_SOD_CONFLICTS[a]) {
        expect(SCM_SOD_CONFLICTS[b]).toContain(a);
      }
    }
  });

  it('item_master_steward has no SoD conflicts (oversight pillar)', () => {
    expect(SCM_SOD_CONFLICTS.item_master_steward).toEqual([]);
  });

  it('scm_admin has no SoD conflicts (oversight pillar)', () => {
    expect(SCM_SOD_CONFLICTS.scm_admin).toEqual([]);
  });

  it('procurement-pillar roles encode the KPMG SoD spec', () => {
    expect(new Set(SCM_SOD_CONFLICTS.pr_creator)).toEqual(new Set(['po_approver', 'grn_creator']));
    expect(new Set(SCM_SOD_CONFLICTS.po_creator)).toEqual(new Set(['po_approver', 'grn_creator']));
    expect(new Set(SCM_SOD_CONFLICTS.po_approver)).toEqual(
      new Set(['pr_creator', 'po_creator', 'grn_creator'])
    );
    expect(new Set(SCM_SOD_CONFLICTS.grn_creator)).toEqual(
      new Set(['pr_creator', 'po_creator', 'po_approver'])
    );
  });

  it('inventory_manager cannot also be in the procurement chain', () => {
    expect(new Set(SCM_SOD_CONFLICTS.inventory_manager)).toEqual(
      new Set(['pr_creator', 'po_creator', 'grn_creator'])
    );
  });
});

describe('findSoDConflicts(role, existingRoles)', () => {
  it('returns empty when user holds no roles', () => {
    expect(findSoDConflicts('po_approver', [])).toEqual([]);
  });

  it('returns empty when assigning a role that has no conflicts (item_master_steward)', () => {
    expect(findSoDConflicts('item_master_steward', SCM_ROLES.filter(r => r !== 'item_master_steward'))).toEqual([]);
  });

  it('returns empty when assigning a role that has no conflicts (scm_admin)', () => {
    expect(findSoDConflicts('scm_admin', SCM_ROLES.filter(r => r !== 'scm_admin'))).toEqual([]);
  });

  it('returns the conflicting roles when there is overlap', () => {
    const conflicts = findSoDConflicts('po_approver', ['pr_creator', 'item_master_steward']);
    expect(conflicts).toEqual(['pr_creator']);
  });

  it('returns multiple conflicts when multiple are held', () => {
    const conflicts = findSoDConflicts('po_approver', ['pr_creator', 'po_creator', 'grn_creator']);
    expect(new Set(conflicts)).toEqual(new Set(['pr_creator', 'po_creator', 'grn_creator']));
  });

  it('does not consider non-conflicting roles', () => {
    expect(findSoDConflicts('pr_creator', ['item_master_steward', 'scm_admin'])).toEqual([]);
  });

  it('exhaustive matrix: 7×7 product matches SCM_SOD_CONFLICTS', () => {
    for (const role of SCM_ROLES) {
      for (const candidate of SCM_ROLES) {
        const conflicts = findSoDConflicts(role, [candidate]);
        const expected = SCM_SOD_CONFLICTS[role].includes(candidate) ? [candidate] : [];
        expect(conflicts).toEqual(expected);
      }
    }
  });
});

describe('assertNoSoDConflict(role, existingRoles)', () => {
  it('passes silently when no conflict', () => {
    expect(() => assertNoSoDConflict('po_approver', [])).not.toThrow();
    expect(() => assertNoSoDConflict('item_master_steward', SCM_ROLES)).not.toThrow();
  });

  it('throws BAD_REQUEST on conflict', () => {
    expect(() => assertNoSoDConflict('po_approver', ['pr_creator'])).toThrowError(TRPCError);
    try {
      assertNoSoDConflict('po_approver', ['pr_creator', 'grn_creator']);
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('BAD_REQUEST');
      expect((e as TRPCError).message).toContain('pr_creator');
      expect((e as TRPCError).message).toContain('grn_creator');
    }
  });

  it('error message lists each conflicting role', () => {
    try {
      assertNoSoDConflict('grn_creator', ['pr_creator', 'po_creator', 'po_approver']);
    } catch (e) {
      const msg = (e as TRPCError).message;
      expect(msg).toContain('pr_creator');
      expect(msg).toContain('po_creator');
      expect(msg).toContain('po_approver');
    }
  });
});

describe('isAppAdmin(userRole)', () => {
  it('returns true for super_admin', () => {
    expect(isAppAdmin('super_admin')).toBe(true);
  });

  it('returns true for hospital_admin', () => {
    expect(isAppAdmin('hospital_admin')).toBe(true);
  });

  it('returns false for dept_head', () => {
    expect(isAppAdmin('dept_head')).toBe(false);
  });

  it('returns false for ALL_STAFF / unknown roles', () => {
    expect(isAppAdmin('clinician')).toBe(false);
    expect(isAppAdmin('nurse')).toBe(false);
    expect(isAppAdmin('')).toBe(false);
    expect(isAppAdmin('some_random_role')).toBe(false);
  });

  it('does not bypass for any SCM role on its own (those are application-level)', () => {
    for (const role of SCM_ROLES) {
      // SCM roles are NOT app-level admin overrides — they apply through
      // assertHasScmRole, not isAppAdmin
      expect(isAppAdmin(role as string)).toBe(false);
    }
  });
});

describe('Phase 1.7 acceptance — KPMG IFC v1 SoD requirements', () => {
  it('Originator (pr_creator) cannot also approve own request (po_approver)', () => {
    expect(SCM_SOD_CONFLICTS.pr_creator).toContain('po_approver');
  });

  it('Originator (pr_creator) cannot also receive own goods (grn_creator)', () => {
    expect(SCM_SOD_CONFLICTS.pr_creator).toContain('grn_creator');
  });

  it('Approver (po_approver) is independent of all upstream and receipt steps', () => {
    expect(SCM_SOD_CONFLICTS.po_approver).toContain('pr_creator');
    expect(SCM_SOD_CONFLICTS.po_approver).toContain('po_creator');
    expect(SCM_SOD_CONFLICTS.po_approver).toContain('grn_creator');
  });

  it('Goods receiver (grn_creator) is independent of procurement chain', () => {
    expect(SCM_SOD_CONFLICTS.grn_creator).toContain('pr_creator');
    expect(SCM_SOD_CONFLICTS.grn_creator).toContain('po_creator');
    expect(SCM_SOD_CONFLICTS.grn_creator).toContain('po_approver');
  });

  it('Stock-adjustment authority (inventory_manager) is independent of procurement chain', () => {
    expect(SCM_SOD_CONFLICTS.inventory_manager).toContain('pr_creator');
    expect(SCM_SOD_CONFLICTS.inventory_manager).toContain('po_creator');
    expect(SCM_SOD_CONFLICTS.inventory_manager).toContain('grn_creator');
  });

  it('Item-master steward + SCM admin are oversight roles with no SoD constraints', () => {
    // Deliberately permissive — these roles need to coexist with operational
    // roles for proper governance
    expect(SCM_SOD_CONFLICTS.item_master_steward).toEqual([]);
    expect(SCM_SOD_CONFLICTS.scm_admin).toEqual([]);
  });
});
