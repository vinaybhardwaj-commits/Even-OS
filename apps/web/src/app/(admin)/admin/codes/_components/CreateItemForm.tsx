"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lookups } from "./lookups-types";
import {
import { compatFetch } from "./api-shim";
  type CompositionInput,
  buildDisplayName,
  bucketKey,
  validateForm,
} from "@/lib/codes/code-utils";
import { LivePreview } from "./LivePreview";
import { SuccessCard } from "./SuccessCard";
import { DuplicateModal } from "./DuplicateModal";

type FormState = {
  item_type: string;
  category: string;
  storage: string;
  classification: string;
  compositions: CompositionInput[];
  form: string;
  brand: string;
  pack_size: string;
  // Optional details
  item_name: string;
  manufacturer: string;
  hsn_code: string;
  tax_detail: string;
  issue_unit: string;
  conversion: string;
  purchase_unit: string;
  close_for_sale: string;
  item_category: string;
  item_sub_category: string;
};

const EMPTY_COMP: CompositionInput = {
  generic_name: "",
  strength_value: "",
  strength_unit: "",
};

const INITIAL_STATE: FormState = {
  item_type: "",
  category: "",
  storage: "",
  classification: "",
  compositions: [{ ...EMPTY_COMP }],
  form: "",
  brand: "",
  pack_size: "",
  item_name: "",
  manufacturer: "",
  hsn_code: "",
  tax_detail: "",
  issue_unit: "",
  conversion: "",
  purchase_unit: "",
  close_for_sale: "N",
  item_category: "",
  item_sub_category: "",
};

type SuccessState = {
  itemCode: string;
  displayName: string;
  firstUseOfBucket: boolean;
};

type DuplicateState = {
  existing_code: string;
  existing_display_name: string;
  existing_id: string;
};

export function CreateItemForm({ lookups }: { lookups: Lookups }) {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showOptional, setShowOptional] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const [bucketInfo, setBucketInfo] = useState<{
    bucket: string;
    nextSerial: number;
    firstUse: boolean;
  } | null>(null);
  const peekAbort = useRef<AbortController | null>(null);
  const brandInputRef = useRef<HTMLInputElement | null>(null);

  // Live-computed Display Name
  const displayName = useMemo(
    () =>
      buildDisplayName({
        compositions: state.compositions,
        form: state.form,
        brand: state.brand,
        pack_size: state.pack_size,
      }),
    [state.compositions, state.form, state.brand, state.pack_size],
  );

  // Whenever the bucket triple changes, peek the next serial
  useEffect(() => {
    const cat = state.category.trim();
    const sto = state.storage.trim();
    const cls = state.classification.trim();
    if (!cat || !sto || !cls) {
      setBucketInfo(null);
      return;
    }
    const bucket = bucketKey({
      category: cat,
      storage: sto,
      classification: cls,
    });

    if (peekAbort.current) peekAbort.current.abort();
    const ac = new AbortController();
    peekAbort.current = ac;

    compatFetch(`/api/buckets/${bucket}/peek`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        if (typeof d.next_serial === "number") {
          setBucketInfo({
            bucket,
            nextSerial: d.next_serial,
            firstUse: !!d.first_use,
          });
        }
      })
      .catch(() => {
        // Aborted or network error — silently leave preview stale.
      });

    return () => ac.abort();
  }, [state.category, state.storage, state.classification]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const updateComp = (i: number, patch: Partial<CompositionInput>) => {
    setState((s) => ({
      ...s,
      compositions: s.compositions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));
  };

  const addComp = () => {
    setState((s) => ({ ...s, compositions: [...s.compositions, { ...EMPTY_COMP }] }));
  };

  const removeComp = (i: number) => {
    setState((s) => ({
      ...s,
      compositions: s.compositions.length === 1 ? s.compositions : s.compositions.filter((_, idx) => idx !== i),
    }));
  };

  const reset = () => {
    setState(INITIAL_STATE);
    setErrors({});
    setSuccess(null);
    setDuplicate(null);
    setShowOptional(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDuplicate(null);
    const v = validateForm(state);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const r = await compatFetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        setSuccess({
          itemCode: data.item.item_code,
          displayName: data.item.item_display_name,
          firstUseOfBucket: data.first_use_of_bucket,
        });
      } else if (r.status === 409 && data.code === "duplicate_display_name") {
        setDuplicate({
          existing_code: data.existing.item_code,
          existing_display_name: data.existing.item_display_name,
          existing_id: data.existing.id,
        });
      } else if (data.errors) {
        setErrors(data.errors);
      } else {
        setErrors({ _root: data.message ?? "Save failed. Try again." });
      }
    } catch (err) {
      setErrors({ _root: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <SuccessCard
        itemCode={success.itemCode}
        displayName={success.displayName}
        firstUseOfBucket={success.firstUseOfBucket}
        onCreateAnother={reset}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Item Type */}
      <Section title="Item Type">
        <Select
          value={state.item_type}
          onChange={(v) => update("item_type", v)}
          options={lookups.item_types.map((it) => ({ value: it.code, label: it.label }))}
          placeholder="Select item type…"
          error={errors.item_type}
        />
      </Section>

      {/* Code components */}
      <Section title="Code Components">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Category *"
            value={state.category}
            onChange={(v) => update("category", v)}
            options={lookups.categories.map((c) => ({
              value: c.code,
              label: `${c.code} — ${c.label}`,
            }))}
            placeholder="Pick"
            error={errors.category}
          />
          <Select
            label="Storage *"
            value={state.storage}
            onChange={(v) => update("storage", v)}
            options={lookups.storage_codes.map((c) => ({
              value: c.code,
              label: `${c.code} — ${c.label}`,
            }))}
            placeholder="Pick"
            error={errors.storage}
          />
          <Select
            label="Classification *"
            value={state.classification}
            onChange={(v) => update("classification", v)}
            options={lookups.classification_codes.map((c) => ({
              value: c.code,
              label: `${c.code} — ${c.label}`,
            }))}
            placeholder="Pick"
            error={errors.classification}
          />
        </div>
      </Section>

      {/* Identity */}
      <Section title="Identity">
        <div className="space-y-4">
          {state.compositions.map((c, i) => (
            <div
              key={i}
              className="rounded-md border border-slate-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Generic {i + 1}
                </span>
                {state.compositions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeComp(i)}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <TextInput
                  label="Generic Name *"
                  value={c.generic_name}
                  onChange={(v) => updateComp(i, { generic_name: v })}
                  placeholder="e.g. Paracetamol"
                  error={errors[`compositions.${i}.generic_name`] ?? (i === 0 ? errors.compositions : undefined)}
                />
                <TextInput
                  label="Strength *"
                  value={c.strength_value}
                  onChange={(v) => updateComp(i, { strength_value: v })}
                  placeholder="500"
                  error={errors[`compositions.${i}.strength_value`]}
                />
                <Select
                  label="Unit *"
                  value={c.strength_unit}
                  onChange={(v) => updateComp(i, { strength_unit: v })}
                  options={lookups.strength_units.map((u) => ({
                    value: u.code,
                    label: u.label,
                  }))}
                  placeholder="—"
                  error={errors[`compositions.${i}.strength_unit`]}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addComp}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            + Add another generic
          </button>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComboInput
              label="Form *"
              value={state.form}
              onChange={(v) => update("form", v)}
              options={lookups.forms.map((f) => f.label)}
              placeholder="Tablet"
              listId="form-options"
              error={errors.form}
            />
            <TextInput
              label="Brand *"
              value={state.brand}
              onChange={(v) => update("brand", v)}
              placeholder="Crocin"
              error={errors.brand}
              inputRef={brandInputRef}
            />
            <NumberInput
              label="Pack Size * (positive integer; renders as Ns)"
              value={state.pack_size}
              onChange={(v) => update("pack_size", v)}
              placeholder="10"
              error={errors.pack_size}
            />
          </div>
        </div>
      </Section>

      {/* Optional details */}
      <Section
        title={
          <button
            type="button"
            onClick={() => setShowOptional((s) => !s)}
            className="flex items-center gap-2 text-left text-sm font-semibold text-slate-700"
          >
            <span aria-hidden>{showOptional ? "▾" : "▸"}</span>
            Optional details (HSN, tax, manufacturer, units…)
          </button>
        }
      >
        {showOptional && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput
              label="Item Name (colloquial)"
              value={state.item_name}
              onChange={(v) => update("item_name", v)}
              placeholder="defaults to Display Name"
            />
            <ComboInput
              label="Manufacturer"
              value={state.manufacturer}
              onChange={(v) => update("manufacturer", v)}
              options={lookups.manufacturers}
              placeholder="GSK"
              listId="manufacturer-options"
            />
            <TextInput
              label="HSN Code"
              value={state.hsn_code}
              onChange={(v) => update("hsn_code", v)}
              placeholder="30049099"
            />
            <TextInput
              label="Tax Detail"
              value={state.tax_detail}
              onChange={(v) => update("tax_detail", v)}
              placeholder="igst:5,cgst:2.5,sgst:2.5"
            />
            <ComboInput
              label="Issue Unit"
              value={state.issue_unit}
              onChange={(v) => update("issue_unit", v)}
              options={lookups.issue_units.map((u) => u.label)}
              placeholder="Each"
              listId="issue-unit-options"
            />
            <NumberInput
              label="Conversion"
              value={state.conversion}
              onChange={(v) => update("conversion", v)}
              placeholder="1.0"
            />
            <ComboInput
              label="Purchase Unit"
              value={state.purchase_unit}
              onChange={(v) => update("purchase_unit", v)}
              options={lookups.issue_units.map((u) => u.label)}
              placeholder="Strip"
              listId="purchase-unit-options"
            />
            <Select
              label="Close For Sale"
              value={state.close_for_sale}
              onChange={(v) => update("close_for_sale", v)}
              options={[
                { value: "N", label: "N — open" },
                { value: "Y", label: "Y — closed" },
              ]}
            />
            <TextInput
              label="Item Category"
              value={state.item_category}
              onChange={(v) => update("item_category", v)}
            />
            <TextInput
              label="Item Sub-Category"
              value={state.item_sub_category}
              onChange={(v) => update("item_sub_category", v)}
            />
          </div>
        )}
      </Section>

      {/* Live preview */}
      <LivePreview
        displayName={displayName}
        bucket={bucketInfo?.bucket ?? null}
        nextSerial={bucketInfo?.nextSerial ?? null}
        firstUseOfBucket={!!bucketInfo?.firstUse}
      />

      {duplicate && (
        <DuplicateModal
          existing={{
            id: duplicate.existing_id,
            item_code: duplicate.existing_code,
            item_display_name: duplicate.existing_display_name,
          }}
          onCancel={() => setDuplicate(null)}
          onModify={() => {
            setDuplicate(null);
            // Scroll to brand field and focus it; the operator can change
            // Brand / Pack / Strength to differentiate.
            setTimeout(() => {
              brandInputRef.current?.focus();
              brandInputRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }, 50);
          }}
        />
      )}

      {errors._root && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {errors._root}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={reset}
          disabled={submitting}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save Code"}
        </button>
      </div>
    </form>
  );
}

/* -------------------- field primitives -------------------- */

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function fieldFrameClass(error?: string) {
  return [
    "w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2",
    error
      ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200"
      : "border-slate-300 focus:border-blue-500 focus:ring-blue-200",
  ].join(" ");
}

function FieldLabel({ label, error }: { label?: string; error?: string }) {
  if (!label && !error) return null;
  return (
    <div className="mb-1 flex items-center justify-between">
      {label && (
        <label className="text-xs font-medium text-slate-700">{label}</label>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  inputRef,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div>
      <FieldLabel label={label} error={error} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={fieldFrameClass(error)}
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} error={error} />
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={fieldFrameClass(error)}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} error={error} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldFrameClass(error)}
      >
        <option value="">{placeholder ?? "—"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ComboInput({
  label,
  value,
  onChange,
  options,
  placeholder,
  listId,
  error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  listId: string;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} error={error} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder}
        className={fieldFrameClass(error)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}
