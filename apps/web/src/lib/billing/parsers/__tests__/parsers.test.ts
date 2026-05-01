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

  it('handles pending-finance rows (ADM00007 has no prices in real PDF)', () => {
    const adm = result.records.find((r) => r.charge_code === 'ADM00007');
    expect(adm).toBeDefined();
    expect(adm!.dept_code).toBe('ADMIN');
    expect(adm!.status).toBe('pending_finance');
    expect(adm!.source_pattern).toBe('pending_finance');
    expect(Object.keys(adm!.prices).length).toBe(0);
  });

  it('classifies "Accident & ER" Service Type as ER (multi-token)', () => {
    const emr = result.records.find((r) => r.charge_code === 'EMR00034');
    expect(emr).toBeDefined();
    expect(emr!.dept_code).toBe('ER');
    expect(emr!.category).toBe('emergency');
    // The longer "Accident & ER" must be matched, not just "Accident".
    expect(emr!.charge_name).toBe('ABG');
  });

  it('captures Mortuary pending-finance rows (Service Type stays Administrative)', () => {
    const adm45 = result.records.find((r) => r.charge_code === 'ADM00045');
    expect(adm45).toBeDefined();
    expect(adm45!.dept_code).toBe('ADMIN');
    expect(adm45!.status).toBe('pending_finance');
    expect(adm45!.charge_name).toContain('Mortuary');
  });

  it('captures AMB pending-finance rows', () => {
    const amb = result.records.find((r) => r.charge_code === 'AMB00034');
    expect(amb).toBeDefined();
    expect(amb!.status).toBe('pending_finance');
    expect(amb!.charge_name).toBe('MLC Charges');
  });

  it('stitches orphan-pair rows (data on line above, code on line below)', () => {
    const lbi947 = result.records.find((r) => r.charge_code === 'LBI00947');
    expect(lbi947).toBeDefined();
    expect(lbi947!.source_pattern).toBe('orphan_pair');
    expect(lbi947!.charge_name).toBe('AMINO ACID QUALITATIVE');
    expect(lbi947!.prices.OPD).toBe(1755);
    expect(lbi947!.prices.GENERAL).toBe(2194);
  });

  it('does not double-attribute the orphan data line to the next inline row', () => {
    // LBI00946's prices come from its own inline row.
    const lbi946 = result.records.find((r) => r.charge_code === 'LBI00946');
    expect(lbi946).toBeDefined();
    expect(lbi946!.source_pattern).toBe('inline');
    expect(lbi946!.prices.OPD).toBe(2834);
    // LBI00948's prices come from its own inline row, NOT the orphan data
    // line that LBI00947 already consumed.
    const lbi948 = result.records.find((r) => r.charge_code === 'LBI00948');
    expect(lbi948).toBeDefined();
    expect(lbi948!.source_pattern).toBe('inline');
    expect(lbi948!.prices.OPD).toBe(8114);
  });

  it('inline rows are tagged with source_pattern=inline', () => {
    const lha1 = result.records.find((r) => r.charge_code === 'LHA00001')!;
    expect(lha1.source_pattern).toBe('inline');
    expect(lha1.status).toBe('active');
  });
});

describe('classifyServiceType', () => {
  it('handles all 9 known PDF service types', () => {
    expect(classifyServiceType('LAB')).toEqual({ category: 'lab', dept_code: 'LAB' });
    expect(classifyServiceType('Radiology')).toEqual({ category: 'radiology', dept_code: 'RADIO' });
    expect(classifyServiceType('Cardiology')).toEqual({ category: 'cardiology', dept_code: 'CARDIO' });
    expect(classifyServiceType('Urology')).toEqual({ category: 'urology', dept_code: 'URO' });
    expect(classifyServiceType('Orthopeadic')).toEqual({ category: 'orthopedic', dept_code: 'ORTHO' });
    expect(classifyServiceType('Accident')).toEqual({ category: 'emergency', dept_code: 'ER' });
    expect(classifyServiceType('Accident & ER')).toEqual({ category: 'emergency', dept_code: 'ER' });
    expect(classifyServiceType('Administrative')).toEqual({ category: 'admin', dept_code: 'ADMIN' });
    expect(classifyServiceType('Administrative Mortuary')).toEqual({ category: 'mortuary', dept_code: 'MORTUARY' });
  });

  it('coerces unknowns to a slug + UNCLASSIFIED dept', () => {
    const r = classifyServiceType('Some New Type');
    expect(r.dept_code).toBe('UNCLASSIFIED');
    expect(r.category).toBe('some_new_type');
  });
});

describe('matchServiceTypeAtStart (longest-first ordering)', () => {
  // Use the function via the parser's classifyServiceType + matcher path.
  // We import directly to avoid relying on a re-export.
  // The longest-first invariant is the one V's review found important.
  it('matches "Accident & ER" before "Accident"', () => {
    // We already have an investigations test that exercises EMR rows; this is
    // an additional unit-level guard against regression in the matcher.
    const types = require('../tariff-parser-types');
    const m = types.matchServiceTypeAtStart('Accident & ER ABG');
    expect(m.type).toBe('Accident & ER');
    expect(m.name).toBe('ABG');
  });

  it('matches "Administrative Mortuary" before "Administrative"', () => {
    const types = require('../tariff-parser-types');
    const m = types.matchServiceTypeAtStart('Administrative Mortuary Body Storage 24h');
    expect(m.type).toBe('Administrative Mortuary');
    expect(m.name).toBe('Body Storage 24h');
  });

  it('matches "Administrative" alone when no Mortuary suffix', () => {
    const types = require('../tariff-parser-types');
    const m = types.matchServiceTypeAtStart('Administrative Medical Certificate Charges');
    expect(m.type).toBe('Administrative');
    expect(m.name).toBe('Medical Certificate Charges');
  });
});
