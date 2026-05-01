/** Mirrored from CodeCreator src/lib/lookups.ts — client-side type only. */
export type LookupRow = {
  code: string;
  label: string;
  description?: string | null;
};

export type Lookups = {
  categories: LookupRow[];
  storage_codes: LookupRow[];
  classification_codes: LookupRow[];
  item_types: LookupRow[];
  forms: LookupRow[];
  strength_units: LookupRow[];
  issue_units: LookupRow[];
  manufacturers: string[];
};
