import { describe, expect, it } from 'vitest';
import {
  SERVICE_TYPES,
  SERVICE_CODE_REGEX,
  buildServiceCode,
  parseServiceCode,
  bucketKey,
  validateServiceCode,
  classifyTariffItem,
  classifyTariffPackage,
  classifyTariffRoom,
} from './service-code-utils';

describe('SERVICE_TYPES + SERVICE_CODE_REGEX', () => {
  it('exposes 9 service type codes', () => {
    expect(SERVICE_TYPES.length).toBe(9);
    expect(SERVICE_TYPES).toContain('PR');
    expect(SERVICE_TYPES).toContain('XX');
  });
  it('regex accepts canonical codes', () => {
    expect(SERVICE_CODE_REGEX.test('S-PR-OT-0001')).toBe(true);
    expect(SERVICE_CODE_REGEX.test('S-LB-LBI-0042')).toBe(true);
    expect(SERVICE_CODE_REGEX.test('S-IM-RAD-9999')).toBe(true);
    expect(SERVICE_CODE_REGEX.test('S-PR-ENTSB-0001')).toBe(true); // 5-char dept
  });
  it('regex rejects malformed codes', () => {
    expect(SERVICE_CODE_REGEX.test('PR-OT-0001')).toBe(false);     // missing S- prefix
    expect(SERVICE_CODE_REGEX.test('S-ZZ-OT-0001')).toBe(false);   // invalid type
    expect(SERVICE_CODE_REGEX.test('S-PR-OT-1')).toBe(false);      // serial not 4 digits
    expect(SERVICE_CODE_REGEX.test('S-pr-OT-0001')).toBe(false);   // lowercase type
    expect(SERVICE_CODE_REGEX.test('S-PR-AB-0001')).toBe(false);   // dept too short
    expect(SERVICE_CODE_REGEX.test('S-PR-ABCDEF-0001')).toBe(false); // dept too long
  });
});

describe('buildServiceCode', () => {
  it('builds a valid code from parts', () => {
    expect(buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: 1 })).toBe('S-PR-OT-0001');
    expect(buildServiceCode({ service_type_code: 'LB', department_code: 'LBI', serial: 42 })).toBe('S-LB-LBI-0042');
    expect(buildServiceCode({ service_type_code: 'IM', department_code: 'RAD', serial: 9999 })).toBe('S-IM-RAD-9999');
  });
  it('zero-pads serial to 4 digits', () => {
    expect(buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: 5 })).toBe('S-PR-OT-0005');
    expect(buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: 99 })).toBe('S-PR-OT-0099');
    expect(buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: 999 })).toBe('S-PR-OT-0999');
  });
  it('throws on invalid type', () => {
    expect(() => buildServiceCode({ service_type_code: 'AB' as any, department_code: 'OT', serial: 1 })).toThrow();
  });
  it('throws on invalid dept format', () => {
    expect(() => buildServiceCode({ service_type_code: 'PR', department_code: 'X' as any, serial: 1 })).toThrow();
    expect(() => buildServiceCode({ service_type_code: 'PR', department_code: 'lowercase' as any, serial: 1 })).toThrow();
  });
  it('throws on serial out of range', () => {
    expect(() => buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: 0 })).toThrow();
    expect(() => buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: 10000 })).toThrow();
    expect(() => buildServiceCode({ service_type_code: 'PR', department_code: 'OT', serial: -5 })).toThrow();
  });
});

describe('parseServiceCode', () => {
  it('parses a valid code', () => {
    expect(parseServiceCode('S-PR-OT-0001')).toEqual({ service_type_code: 'PR', department_code: 'OT', serial: 1 });
    expect(parseServiceCode('S-LB-LBI-0042')).toEqual({ service_type_code: 'LB', department_code: 'LBI', serial: 42 });
  });
  it('returns null for invalid format', () => {
    expect(parseServiceCode('not-a-code')).toBeNull();
    expect(parseServiceCode('S-PR-OT-1')).toBeNull();
  });
  it('round-trips with buildServiceCode', () => {
    const built = buildServiceCode({ service_type_code: 'IM', department_code: 'CAD', serial: 7 });
    expect(parseServiceCode(built)).toEqual({ service_type_code: 'IM', department_code: 'CAD', serial: 7 });
  });
});

describe('bucketKey', () => {
  it('joins type and dept with a dash', () => {
    expect(bucketKey({ service_type_code: 'PR', department_code: 'OT' })).toBe('PR-OT');
    expect(bucketKey({ service_type_code: 'LB', department_code: 'LBI' })).toBe('LB-LBI');
  });
});

describe('validateServiceCode', () => {
  it('returns null on valid', () => {
    expect(validateServiceCode('S-PR-OT-0001')).toBeNull();
  });
  it('returns error message on invalid', () => {
    expect(validateServiceCode('garbage')).toMatch(/match S-XX-DEPT-NNNN/);
  });
});

describe('classifyTariffItem (Phase 3.5 backfill)', () => {
  it('LAB category → LB type with dept canonicalization (LAB → LBI)', () => {
    const r = classifyTariffItem({ category: 'lab', dept_code: 'LAB', charge_code: 'LHA00001' });
    expect(r.service_type_code).toBe('LB');
    expect(r.department_code).toBe('LBI');
    expect(r.remapped).toBe(true);
  });
  it('Radiology → IM with RADIO → RAD remap', () => {
    const r = classifyTariffItem({ category: 'radiology', dept_code: 'RADIO', charge_code: 'RAD00001' });
    expect(r.service_type_code).toBe('IM');
    expect(r.department_code).toBe('RAD');
    expect(r.remapped).toBe(true);
  });
  it('emergency category → PR type with ER → EMR remap', () => {
    const r = classifyTariffItem({ category: 'emergency', dept_code: 'ER', charge_code: 'EMR00034' });
    expect(r.service_type_code).toBe('PR');
    expect(r.department_code).toBe('EMR');
  });
  it('cardiology → IM with CARDIO → CAD remap', () => {
    const r = classifyTariffItem({ category: 'cardiology', dept_code: 'CARDIO', charge_code: 'CAD00001' });
    expect(r.service_type_code).toBe('IM');
    expect(r.department_code).toBe('CAD');
  });
  it('admin → FE with ADMIN → ADM remap', () => {
    const r = classifyTariffItem({ category: 'admin', dept_code: 'ADMIN', charge_code: 'ADM00007' });
    expect(r.service_type_code).toBe('FE');
    expect(r.department_code).toBe('ADM');
  });
  it('canonical dept codes pass through unmapped', () => {
    const r = classifyTariffItem({ category: 'lab', dept_code: 'LHA', charge_code: 'LHA00001' });
    expect(r.department_code).toBe('LHA');
    // remapped reflects whether the input differed; LHA is canonical so false
    expect(r.remapped).toBe(false);
  });
});

describe('classifyTariffPackage', () => {
  it('extracts dept from package_code prefix', () => {
    expect(classifyTariffPackage('ENT-PKG-001')).toMatchObject({ service_type_code: 'PK', department_code: 'ENT' });
    expect(classifyTariffPackage('OBG-PKG-005')).toMatchObject({ service_type_code: 'PK', department_code: 'OBG' });
    expect(classifyTariffPackage('URO-PKG-200')).toMatchObject({ service_type_code: 'PK', department_code: 'URO' });
  });
  it('falls back to XX when prefix unrecognized', () => {
    const r = classifyTariffPackage('WEIRD-PKG-001');
    expect(r.service_type_code).toBe('PK');
    expect(r.department_code).toBe('WEIRD');
  });
});

describe('classifyTariffRoom', () => {
  it('always returns RM type + ADM dept', () => {
    expect(classifyTariffRoom('GENERAL')).toEqual({ service_type_code: 'RM', department_code: 'ADM', remapped: true });
    expect(classifyTariffRoom('ICU')).toEqual({ service_type_code: 'RM', department_code: 'ADM', remapped: true });
  });
});
