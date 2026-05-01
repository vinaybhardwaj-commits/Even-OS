/**
 * Pure helpers for building Display Name + Item Code previews.
 * No DB / network access — safe to use on the client.
 */

/** Width of the serial portion in new codes (PRD §4 decision #1). */
export const SERIAL_WIDTH = 5;

export type CompositionInput = {
  generic_name: string;
  strength_value: string; // form-level string for inputability
  strength_unit: string;
};

/**
 * Build a Display Name from the SOP form template:
 *   `{generic_chain} - {form|.} - {strength_chain}{unit_chain} - {brand|name} - {pack}'s`
 *
 * Multi-comp generics are joined with `+`, strengths likewise (with unit appended once).
 *
 * Always returns a string — empty fields are rendered as `.` placeholders so the
 * preview shows what's missing.
 */
export function buildDisplayName(input: {
  compositions: CompositionInput[];
  form: string;
  brand: string;
  pack_size: string | number;
}): string {
  const comps = input.compositions.filter((c) => c.generic_name.trim() !== "");

  const generic = comps.length > 0
    ? comps.map((c) => c.generic_name.trim()).join("+")
    : ".";

  const strengthChain = comps.length > 0 && comps.some((c) => c.strength_value.trim() !== "")
    ? comps
        .map((c) => {
          const v = c.strength_value.trim();
          const u = c.strength_unit.trim();
          if (!v) return "";
          return u ? `${v}${u}` : v;
        })
        .filter((s) => s !== "")
        .join("+")
    : ".";

  const formStr = input.form.trim() || ".";
  const brand = input.brand.trim() || ".";
  const pack = (() => {
    const p = String(input.pack_size).trim();
    if (!p) return ".";
    const n = parseInt(p, 10);
    if (Number.isNaN(n) || n < 0) return p;
    return `${n}'s`;
  })();

  return `${generic}-${formStr}-${strengthChain}-${brand}-${pack}`;
}

/** Build the canonical Item Code given a bucket triple and a serial integer. */
export function buildItemCode(
  bucket: { category: string; storage: string; classification: string },
  serial: number,
): string {
  const ser = String(serial).padStart(SERIAL_WIDTH, "0");
  return `${bucket.category}-${bucket.storage}-${bucket.classification}-${ser}`;
}

/** Bucket key as used by inventory_serial_counters.bucket. */
export function bucketKey(b: {
  category: string;
  storage: string;
  classification: string;
}): string {
  return `${b.category}-${b.storage}-${b.classification}`;
}

/** Validation rules for the form (mirrored client + server). */
export type FormValidation = {
  ok: boolean;
  errors: Record<string, string>;
};

export function validateForm(input: {
  item_type: string;
  category: string;
  storage: string;
  classification: string;
  compositions: CompositionInput[];
  form: string;
  brand: string;
  pack_size: string;
}): FormValidation {
  const errors: Record<string, string> = {};

  if (!input.item_type.trim()) errors.item_type = "Required";
  if (!input.category.trim()) errors.category = "Required";
  if (!input.storage.trim()) errors.storage = "Required";
  if (!input.classification.trim()) errors.classification = "Required";

  // At least one composition must have a generic name
  const hasComp = input.compositions.some((c) => c.generic_name.trim() !== "");
  if (!hasComp) errors.compositions = "At least one generic name is required";

  // Strength + unit must be coherent for each composition that has a generic
  for (let i = 0; i < input.compositions.length; i++) {
    const c = input.compositions[i];
    if (c.generic_name.trim() === "") continue;
    if (!c.strength_value.trim()) {
      errors[`compositions.${i}.strength_value`] = "Required";
    } else if (Number.isNaN(parseFloat(c.strength_value))) {
      errors[`compositions.${i}.strength_value`] = "Must be a number";
    }
    if (!c.strength_unit.trim()) {
      errors[`compositions.${i}.strength_unit`] = "Required";
    }
  }

  if (!input.form.trim()) errors.form = "Required (use a placeholder if N/A)";
  if (!input.brand.trim()) errors.brand = "Required";

  // Pack size: positive integer
  const packStr = input.pack_size.trim();
  if (!packStr) {
    errors.pack_size = "Required";
  } else {
    const n = parseInt(packStr, 10);
    if (Number.isNaN(n) || n < 1 || String(n) !== packStr) {
      errors.pack_size = "Must be a positive integer";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
