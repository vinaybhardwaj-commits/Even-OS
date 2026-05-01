import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoomTariff } from '../room-tariff-parser';
import { parsePackageTariff } from '../package-tariff-parser';
import { parseInvestigationsTariff } from '../investigations-parser';
import { classifyServiceType } from '../tariff-parser-types';

const FIXTURES = join(__dirname, 'fixtures');

describe('parseRoomTariff', () => {
  const text = readFileSync(join(FIXTURES, 'rooms.txt'), 'utf8');
  const result = parseRoomTariff(text);

  it('parses all 7 EHRC room classes', () => {
    expect(result.records).toHaveLength(7);
    const classes = result.records.map((r) => r.room_class).sort();
    expect(classes).toEqual([
      'DAY_CARE', 'GENERAL', 'HDU', 'ICU', 'PRIVATE', 'SUITE', 'TWIN_SHARING',
    ]);
  });

  it('captures bed/nursing/total/consultation correctly for DAY_CARE', () => {
    const dc = result.records.find((r) => r.room_class === 'DAY_CARE')!;
    expect(dc.bed_charges).toBe(1300);
    expect(dc.nursing_charges).toBe(1050);
    expect(dc.tariff).toBe(2350);
    expect(dc.consultation_charge).toBe(900);
  });

  it('captures HDU correctly (last row)', () => {
    const hdu = result.records.find((r) => r.room_class === 'HDU')!;
    expect(hdu.tariff).toBe(9850);
    expect(hdu.consultation_charge).toBe(2000);
  });

  it('produces zero errors and minimal skipped on clean fixture', () => {
    expect(result.errored).toHaveLength(0);
  });
});

describe('parsePackageTariff', () => {
  const text = readFileSync(join(FIXTURES, 'packages.txt'), 'utf8');
  const result = parsePackageTariff(text);

  it('parses at least 6 packages from the fixture', () => {
    expect(result.records.length).toBeGreaterThanOrEqual(6);
  });

  it('extracts package_code in canonical DEPT-PKG-NNN form', () => {
    for (const r of result.records) {
      expect(r.package_code).toMatch(/^[A-Z][A-Z0-9]*-PKG-\d+$/);
    }
  });

  it('treats Suite as Open Billing when only 5 numbers in tail', () => {
    const ent001 = result.records.find((r) => r.package_code === 'ENT-PKG-001')!;
    expect(ent001).toBeDefined();
    expect(ent001.suite_open_billing).toBe(true);
    expect(ent001.suite_price).toBeNull();
    expect(ent001.prices.GENERAL).toBe(88000);
    expect(ent001.prices.SEMI_PVT).toBe(98000);
    expect(ent001.prices.PVT).toBe(117600);
  });

  it('captures Suite as fixed price when 6 numbers in tail (ENT-PKG-003)', () => {
    const ent003 = result.records.find((r) => r.package_code === 'ENT-PKG-003')!;
    expect(ent003).toBeDefined();
    expect(ent003.suite_open_billing).toBe(false);
    expect(ent003.suite_price).toBe(229440);
  });

  it('strips Open/Billing tokens from wrapped names', () => {
    const ent010 = result.records.find((r) => r.package_code === 'ENT-PKG-010')!;
    expect(ent010).toBeDefined();
    expect(ent010.package_name).not.toMatch(/\bOpen\b/);
    expect(ent010.package_name).not.toMatch(/\bBilling\b/);
    // Name should mention MICROLARYNGEAL.
    expect(ent010.package_name.toUpperCase()).toContain('MICROLARYNGEAL');
  });

  it('extracts dept_code from CODES column', () => {
    const depts = new Set(result.records.map((r) => r.dept_code));
    expect(depts.has('ENT')).toBe(true);
  });
});

describe('parseInvestigationsTariff', () => {
  const text = readFileSync(join(FIXTURES, 'investigations.txt'), 'utf8');
  const result = parseInvestigationsTariff(text);

  it('parses lab + radiology + cardiology + admin rows from the fixture', () => {
    expect(result.records.length).toBeGreaterThanOrEqual(8);
  });

  it('classifies LAB rows correctly', () => {
    const lha1 = result.records.find((r) => r.charge_code === 'LHA00001')!;
    expect(lha1.category).toBe('lab');
    expect(lha1.dept_code).toBe('LAB');
    expect(lha1.charge_name).toContain('ABSOLUTE EOSINOPHIL COUNT');
  });

  it('writes ICU + HDU prices both from "All ICU" column', () => {
    const lha1 = result.records.find((r) => r.charge_code === 'LHA00001')!;
    expect(lha1.prices.ICU).toBe(656);
    expect(lha1.prices.HDU).toBe(656);
  });

  it('classifies Radiology rows correctly', () => {
    const rad = result.records.find((r) => r.charge_code === 'RAD00001')!;
    expect(rad.category).toBe('radiology');
    expect(rad.dept_code).toBe('RADIO');
    expect(rad.charge_name).toContain('X-RAY');
  });

  it('classifies Cardiology rows correctly', () => {
    const cad = result.records.find((r) => r.charge_code === 'CAD00001')!;
    expect(cad.category).toBe('cardiology');
    expect(cad.dept_code).toBe('CARDIO');
  });

  it('captures all 5 numeric price classes (OPD/GENERAL/SEMI_PVT/PVT/SUITE) for LAB', () => {
    const lha1 = result.records.find((r) => r.charge_code === 'LHA00001')!;
    expect(lha1.prices.OPD).toBe(422);
    expect(lha1.prices.GENERAL).toBe(528);
    expect(lha1.prices.SEMI_PVT).toBe(592);
    expect(lha1.prices.PVT).toBe(656);
    expect(lha1.prices.SUITE).toBe(718);
  });

  it('handles all-zero rows (Administrative ADM00007) without erroring', () => {
    const adm = result.records.find((r) => r.charge_code === 'ADM00007');
    expect(adm).toBeDefined();
    expect(adm!.dept_code).toBe('ADMIN');
    // All-zero prices → empty prices object after filter
    expect(Object.keys(adm!.prices).length).toBe(0);
  });
});

describe('classifyServiceType', () => {
  it('handles the 7 known PDF service types', () => {
    expect(classifyServiceType('LAB')).toEqual({ category: 'lab', dept_code: 'LAB' });
    expect(classifyServiceType('Radiology')).toEqual({ category: 'radiology', dept_code: 'RADIO' });
    expect(classifyServiceType('Cardiology')).toEqual({ category: 'cardiology', dept_code: 'CARDIO' });
    expect(classifyServiceType('Urology')).toEqual({ category: 'urology', dept_code: 'URO' });
    expect(classifyServiceType('Orthopeadic')).toEqual({ category: 'orthopedic', dept_code: 'ORTHO' });
    expect(classifyServiceType('Accident')).toEqual({ category: 'emergency', dept_code: 'ER' });
    expect(classifyServiceType('Administrative')).toEqual({ category: 'admin', dept_code: 'ADMIN' });
  });

  it('coerces unknowns to a slug + UNCLASSIFIED dept', () => {
    const r = classifyServiceType('Some New Type');
    expect(r.dept_code).toBe('UNCLASSIFIED');
    expect(r.category).toBe('some_new_type');
  });
});
