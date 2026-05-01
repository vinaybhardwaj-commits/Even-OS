/**
 * Unit tests for Codes Phase 1 — pure helpers.
 * No DB / network. Mirrors the validation rules used both client + server.
 */
import { describe, expect, it } from 'vitest';
import { bucketKey, buildItemCode, buildDisplayName, validateForm, SERIAL_WIDTH } from './code-utils';

describe('SERIAL_WIDTH', () => {
  it('is 5 per PRD §4 decision #1', () => {
    expect(SERIAL_WIDTH).toBe(5);
  });
});

describe('bucketKey', () => {
  it('joins category-storage-classification with hyphens', () => {
    expect(bucketKey({ category: 'M', storage: 'N', classification: 'PH' })).toBe('M-N-PH');
  });
});

describe('buildItemCode', () => {
  it('zero-pads serial to 5 digits', () => {
    expect(buildItemCode({ category: 'M', storage: 'N', classification: 'PH' }, 1)).toBe('M-N-PH-00001');
    expect(buildItemCode({ category: 'M', storage: 'N', classification: 'PH' }, 99)).toBe('M-N-PH-00099');
    expect(buildItemCode({ category: 'L', storage: 'T', classification: 'LC' }, 12345)).toBe('L-T-LC-12345');
  });
});

describe('buildDisplayName', () => {
  it('SOP format: generic-form-strength_chain-brand-pack\'s', () => {
    const name = buildDisplayName({
      compositions: [{ generic_name: 'Paracetamol', strength_value: '500', strength_unit: 'mg' }],
      form: 'Tablet',
      brand: 'Crocin',
      pack_size: '10',
    });
    expect(name).toBe("Paracetamol-Tablet-500mg-Crocin-10's");
  });

  it('multi-composition joins generics with + and strengths with +', () => {
    const name = buildDisplayName({
      compositions: [
        { generic_name: 'Amoxicillin', strength_value: '500', strength_unit: 'mg' },
        { generic_name: 'Clavulanic Acid', strength_value: '125', strength_unit: 'mg' },
      ],
      form: 'Tablet',
      brand: 'Augmentin',
      pack_size: '20',
    });
    expect(name).toBe("Amoxicillin+Clavulanic Acid-Tablet-500mg+125mg-Augmentin-20's");
  });

  it('renders empty fields as . placeholder so missing data is visible', () => {
    const name = buildDisplayName({
      compositions: [],
      form: '',
      brand: '',
      pack_size: '',
    });
    expect(name).toBe('.-.-.-.-.');
  });

  it('strips empty composition rows', () => {
    const name = buildDisplayName({
      compositions: [
        { generic_name: '', strength_value: '', strength_unit: '' },
        { generic_name: 'Paracetamol', strength_value: '500', strength_unit: 'mg' },
      ],
      form: 'Tablet',
      brand: 'Crocin',
      pack_size: '10',
    });
    expect(name).toBe("Paracetamol-Tablet-500mg-Crocin-10's");
  });

  it("pack 0's renders as 0's", () => {
    const name = buildDisplayName({
      compositions: [{ generic_name: 'X', strength_value: '1', strength_unit: 'mg' }],
      form: 'Tab', brand: 'B', pack_size: '0',
    });
    expect(name).toBe("X-Tab-1mg-B-0's");
  });
});

describe('validateForm', () => {
  const baseValid = {
    item_type: 'Drug',
    category: 'M',
    storage: 'N',
    classification: 'PH',
    compositions: [{ generic_name: 'Paracetamol', strength_value: '500', strength_unit: 'mg' }],
    form: 'Tablet',
    brand: 'Crocin',
    pack_size: '10',
  };

  it('valid form returns ok=true', () => {
    expect(validateForm(baseValid).ok).toBe(true);
  });

  it('missing item_type fails', () => {
    expect(validateForm({ ...baseValid, item_type: '' }).errors.item_type).toBeTruthy();
  });

  it('missing category/storage/classification fails', () => {
    expect(validateForm({ ...baseValid, category: '' }).errors.category).toBeTruthy();
    expect(validateForm({ ...baseValid, storage: '' }).errors.storage).toBeTruthy();
    expect(validateForm({ ...baseValid, classification: '' }).errors.classification).toBeTruthy();
  });

  it('no generic name fails', () => {
    const r = validateForm({ ...baseValid, compositions: [{ generic_name: '', strength_value: '', strength_unit: '' }] });
    expect(r.ok).toBe(false);
    expect(r.errors.compositions).toBeTruthy();
  });

  it('non-numeric strength fails', () => {
    const r = validateForm({ ...baseValid, compositions: [{ generic_name: 'Paracetamol', strength_value: 'lots', strength_unit: 'mg' }] });
    expect(r.ok).toBe(false);
    expect(r.errors['compositions.0.strength_value']).toBeTruthy();
  });

  it('missing strength unit fails', () => {
    const r = validateForm({ ...baseValid, compositions: [{ generic_name: 'Paracetamol', strength_value: '500', strength_unit: '' }] });
    expect(r.ok).toBe(false);
    expect(r.errors['compositions.0.strength_unit']).toBeTruthy();
  });

  it('non-positive-integer pack_size fails', () => {
    expect(validateForm({ ...baseValid, pack_size: '0' }).errors.pack_size).toBeTruthy();
    expect(validateForm({ ...baseValid, pack_size: '1.5' }).errors.pack_size).toBeTruthy();
    expect(validateForm({ ...baseValid, pack_size: 'abc' }).errors.pack_size).toBeTruthy();
    expect(validateForm({ ...baseValid, pack_size: '' }).errors.pack_size).toBeTruthy();
  });

  it('happy path with multiple compositions passes', () => {
    const r = validateForm({
      ...baseValid,
      compositions: [
        { generic_name: 'Amoxicillin', strength_value: '500', strength_unit: 'mg' },
        { generic_name: 'Clavulanic Acid', strength_value: '125', strength_unit: 'mg' },
      ],
    });
    expect(r.ok).toBe(true);
  });
});
