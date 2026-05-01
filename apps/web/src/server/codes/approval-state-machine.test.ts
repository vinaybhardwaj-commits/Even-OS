import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STATES,
  CODE_KINDS,
  findTransition,
  resolveTo,
  denialReason,
  routingNextStage,
  assertCanTransitionAndResolve,
  type RoutingConfig,
} from './approval-state-machine';

const drugRouting: RoutingConfig = {
  code_kind: 'drug',
  clinical_role: 'pharmacy_supervisor',
  requires_cms_gm_for_high_impact: false,
  sla_clinical_working_days: 3,
  sla_mdo_working_days: 2,
  sla_cms_gm_working_days: 2,
};

const consumableRouting: RoutingConfig = {
  code_kind: 'consumable',
  clinical_role: null,
  requires_cms_gm_for_high_impact: false,
  sla_clinical_working_days: 0,
  sla_mdo_working_days: 2,
  sla_cms_gm_working_days: 2,
};

describe('routingNextStage', () => {
  it('drug → pending_clinical_review (Stage 1)', () => {
    expect(routingNextStage(drugRouting)).toBe('pending_clinical_review');
  });
  it('consumable → pending_master_data_review (skip clinical)', () => {
    expect(routingNextStage(consumableRouting)).toBe('pending_master_data_review');
  });
});

describe('findTransition', () => {
  it('finds clinical_approve from pending_clinical_review', () => {
    const r = findTransition('clinical_approve', 'pending_clinical_review');
    expect(r.action).toBe('clinical_approve');
    expect(r.to).toBe('pending_master_data_review');
  });
  it('throws on invalid transition (cms_gm_approve from draft)', () => {
    expect(() => findTransition('cms_gm_approve', 'draft')).toThrow();
  });
  it('finds reject from each pending_*review state', () => {
    expect(findTransition('reject', 'pending_clinical_review').to).toBe('rejected');
    expect(findTransition('reject', 'pending_master_data_review').to).toBe('rejected');
    expect(findTransition('reject', 'pending_cms_gm_review').to).toBe('rejected');
  });
  it('finds resubmit from rejected → draft', () => {
    expect(findTransition('resubmit', 'rejected').to).toBe('draft');
  });
});

describe('resolveTo (mdo_approve high-impact branching)', () => {
  it('mdo_approve non-high-impact → active', () => {
    const r = findTransition('mdo_approve', 'pending_master_data_review');
    expect(resolveTo(r, { kind: 'drug', isHighImpact: false })).toBe('active');
  });
  it('mdo_approve high-impact → pending_cms_gm_review (Phase 3+)', () => {
    const r = findTransition('mdo_approve', 'pending_master_data_review');
    expect(resolveTo(r, { kind: 'drug', isHighImpact: true })).toBe('pending_cms_gm_review');
  });
});

describe('denialReason RBAC', () => {
  it('super_admin bypass — always allowed', () => {
    const r = findTransition('mdo_approve', 'pending_master_data_review');
    expect(denialReason(r, [], 'super_admin')).toBeNull();
  });
  it('hospital_admin bypass', () => {
    const r = findTransition('clinical_approve', 'pending_clinical_review');
    expect(denialReason(r, [], 'hospital_admin')).toBeNull();
  });
  it('caller without required role denied', () => {
    const r = findTransition('mdo_approve', 'pending_master_data_review');
    const reason = denialReason(r, ['pharmacy_supervisor'], 'pharmacist');
    expect(reason).not.toBeNull();
    expect(reason).toContain('master_data_officer');
  });
  it('caller with required role allowed', () => {
    const r = findTransition('mdo_approve', 'pending_master_data_review');
    expect(denialReason(r, ['master_data_officer'], 'pharmacist')).toBeNull();
  });
  it('system_bootstrap restricted to super_admin only', () => {
    const r = findTransition('system_bootstrap', '__bootstrap');
    expect(denialReason(r, [], 'super_admin')).toBeNull();
    expect(denialReason(r, [], 'hospital_admin')).not.toBeNull();
    expect(denialReason(r, ['master_data_officer'], 'pharmacist')).not.toBeNull();
  });
  it('clinical_approve accepts any of the 4 clinical-stage roles', () => {
    const r = findTransition('clinical_approve', 'pending_clinical_review');
    expect(denialReason(r, ['pharmacy_supervisor'], 'pharmacist')).toBeNull();
    expect(denialReason(r, ['lab_lead'], 'lab_technician')).toBeNull();
    expect(denialReason(r, ['radiology_lead'], 'radiology_technician')).toBeNull();
    expect(denialReason(r, ['cath_lab_lead'], 'surgeon')).toBeNull();
  });
});

describe('assertCanTransitionAndResolve', () => {
  it('drug submit from draft resolves to pending_clinical_review', () => {
    const { toState } = assertCanTransitionAndResolve({
      action: 'submit',
      fromState: 'draft',
      routing: drugRouting,
      isHighImpact: false,
      callerCodesRoles: [],
      callerSystemRole: 'super_admin',
    });
    expect(toState).toBe('pending_clinical_review');
  });
  it('consumable submit from draft resolves to pending_master_data_review (skip clinical)', () => {
    const { toState } = assertCanTransitionAndResolve({
      action: 'submit',
      fromState: 'draft',
      routing: consumableRouting,
      isHighImpact: false,
      callerCodesRoles: [],
      callerSystemRole: 'super_admin',
    });
    expect(toState).toBe('pending_master_data_review');
  });
  it('mdo_approve non-high-impact reaches active', () => {
    const { toState } = assertCanTransitionAndResolve({
      action: 'mdo_approve',
      fromState: 'pending_master_data_review',
      routing: drugRouting,
      isHighImpact: false,
      callerCodesRoles: ['master_data_officer'],
      callerSystemRole: 'pharmacist',
    });
    expect(toState).toBe('active');
  });
  it('reject without feedback throws', () => {
    expect(() => assertCanTransitionAndResolve({
      action: 'reject',
      fromState: 'pending_clinical_review',
      routing: drugRouting,
      isHighImpact: false,
      callerCodesRoles: ['pharmacy_supervisor'],
      callerSystemRole: 'pharmacist',
      feedbackNote: '',
    })).toThrow(/feedback_note/);
  });
  it('reject with feedback succeeds', () => {
    const { toState } = assertCanTransitionAndResolve({
      action: 'reject',
      fromState: 'pending_clinical_review',
      routing: drugRouting,
      isHighImpact: false,
      callerCodesRoles: ['pharmacy_supervisor'],
      callerSystemRole: 'pharmacist',
      feedbackNote: 'Generic name missing',
    });
    expect(toState).toBe('rejected');
  });
});

describe('APPROVAL_STATES + CODE_KINDS shape', () => {
  it('exposes 6 states', () => {
    expect(APPROVAL_STATES).toContain('draft');
    expect(APPROVAL_STATES).toContain('active');
    expect(APPROVAL_STATES).toContain('rejected');
    expect(APPROVAL_STATES.length).toBe(6);
  });
  it('exposes 10 code kinds (per Q3 routing matrix)', () => {
    expect(CODE_KINDS.length).toBe(10);
    expect(CODE_KINDS).toContain('drug');
    expect(CODE_KINDS).toContain('implant');
    expect(CODE_KINDS).toContain('charge_tier');
    expect(CODE_KINDS).toContain('lookup');
  });
});
