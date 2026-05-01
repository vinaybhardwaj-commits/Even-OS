'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Items — Phase 1.5 first cut
//
// Universal item master CRUD + lifecycle transitions (Codes Q3 5-state
// machine). Pulls from canonical scm.items.* tRPC procedures.
//
// First cut scope:
//   ✅ List with kind/status/search filters
//   ✅ Create (essential fields only — kind, code, display_name,
//      unit_of_measure, generic_name, etc.)
//   ✅ Status transition button (calls scm.items.transitionStatus)
//   ⏭ Phase 1.6 adds full edit form, deprecation flow with reason +
//      urgency_tier, RBAC gates per role.
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface Item {
  id: string;
  hospital_id: string | null;
  code: string;
  display_name: string;
  kind: string;
  status: string;
  storage_class: string | null;
  classification_code: string | null;
  generic_name: string | null;
  form: string | null;
  strength: string | null;
  brand: string | null;
  pack_size: string | null;
  unit_of_measure: string;
  hsn_code: string | null;
  gst_percentage: number | null;
  manufacturer: string | null;
  default_reorder_level: number | null;
  default_reorder_quantity: number | null;
  default_max_stock_level: number | null;
  auto_reorder_enabled: boolean;
  deprecation_reason: string | null;
  deprecation_urgency_tier: string | null;
  created_at: string;
}

const ITEM_KINDS = [
  'drug',
  'consumable',
  'implant',
  'reagent',
  'linen',
  'cssd_pack',
  'equipment_spare',
  'general',
] as const;

const ITEM_STATUSES = [
  'pending_clinical_review',
  'pending_master_data_review',
  'pending_cms_gm_review',
  'active',
  'deprecated_grace',
  'deprecated',
  'archived',
  'rejected',
] as const;

// --- tRPC HTTP helpers ---
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error?.json?.message || json.error?.message || 'Mutation failed');
  }
  return json.result?.data?.json;
}

const STATUS_COLORS: Record<string, string> = {
  pending_clinical_review: '#9ca3af',
  pending_master_data_review: '#f59e0b',
  pending_cms_gm_review: '#8b5cf6',
  active: '#10b981',
  deprecated_grace: '#f97316',
  deprecated: '#ef4444',
  archived: '#6b7280',
  rejected: '#dc2626',
};

const KIND_COLORS: Record<string, string> = {
  drug: '#3b82f6',
  consumable: '#06b6d4',
  implant: '#ef4444',
  reagent: '#8b5cf6',
  linen: '#10b981',
  cssd_pack: '#f59e0b',
  equipment_spare: '#6366f1',
  general: '#6b7280',
};

// Codes Q3 valid transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending_clinical_review: ['pending_master_data_review', 'rejected'],
  pending_master_data_review: ['pending_cms_gm_review', 'rejected'],
  pending_cms_gm_review: ['active', 'rejected'],
  active: ['deprecated_grace'],
  deprecated_grace: ['deprecated'],
  deprecated: ['archived'],
  archived: [],
  rejected: [],
};

// ============================================================

export default function ScmItemsClient({ user }: { user: User }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [transitionFor, setTransitionFor] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery('scm.items.list', {
        kind: filterKind || undefined,
        status: filterStatus || undefined,
        search: search || undefined,
        include_network: true,
        limit: 200,
      });
      setItems(Array.isArray(res) ? res : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [filterKind, filterStatus, search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Items</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📚 Items master</h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + New item
        </button>
      </div>

      {/* ─── Filters ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        >
          <option value="">All kinds</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        >
          <option value="">All statuses</option>
          {ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search code / display_name / generic_name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 240, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
        <button
          onClick={load}
          style={{ padding: '6px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      ) : null}

      {/* ─── Items table ─────────────────────────────── */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>Code</Th>
              <Th>Display name</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              <Th>UoM</Th>
              <Th>Manufacturer</Th>
              <Th>Reorder lvl</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  Loading items…
                </Td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  No items match the current filters.{' '}
                  <button onClick={() => setShowCreate(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Create one
                  </button>
                  ?
                </Td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <Td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{it.code}</code></Td>
                  <Td style={{ fontWeight: 500 }}>
                    {it.display_name}
                    {it.hospital_id === null ? (
                      <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: 999 }}>
                        network
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span
                      style={{
                        padding: '2px 8px',
                        background: `${KIND_COLORS[it.kind] || '#6b7280'}22`,
                        color: KIND_COLORS[it.kind] || '#6b7280',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {it.kind.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td>
                    <span
                      style={{
                        padding: '2px 8px',
                        background: `${STATUS_COLORS[it.status] || '#6b7280'}22`,
                        color: STATUS_COLORS[it.status] || '#6b7280',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {it.status.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td>{it.unit_of_measure}</Td>
                  <Td style={{ color: '#6b7280' }}>{it.manufacturer || '—'}</Td>
                  <Td>{it.default_reorder_level ?? '—'}</Td>
                  <Td>
                    {(ALLOWED_TRANSITIONS[it.status] || []).length > 0 ? (
                      <button
                        onClick={() => setTransitionFor(it)}
                        style={{
                          padding: '4px 10px',
                          background: '#fff',
                          border: '1px solid #d1d5db',
                          borderRadius: 4,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Transition…
                      </button>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>terminal</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
        Showing {items.length} item{items.length === 1 ? '' : 's'} {filterKind || filterStatus || search ? '(filtered)' : ''}
      </div>

      {/* ─── Modals ──────────────────────────────────── */}
      {showCreate ? <CreateItemModal user={user} onClose={() => setShowCreate(false)} onCreated={load} /> : null}
      {transitionFor ? (
        <TransitionModal
          item={transitionFor}
          onClose={() => setTransitionFor(null)}
          onTransitioned={() => {
            setTransitionFor(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────

function CreateItemModal({ user, onClose, onCreated }: { user: User; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    code: '',
    display_name: '',
    kind: 'drug' as (typeof ITEM_KINDS)[number],
    unit_of_measure: 'unit',
    generic_name: '',
    form: '',
    strength: '',
    brand: '',
    pack_size: '',
    manufacturer: '',
    storage_class: 'N',
    classification_code: '',
    hsn_code: '',
    gst_percentage: '',
    default_reorder_level: '',
    default_reorder_quantity: '',
    default_max_stock_level: '',
    auto_reorder_enabled: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const payload: any = {
        code: form.code.trim(),
        display_name: form.display_name.trim(),
        kind: form.kind,
        unit_of_measure: form.unit_of_measure.trim(),
        auto_reorder_enabled: form.auto_reorder_enabled,
      };
      // Optionals
      const optionalText: (keyof typeof form)[] = [
        'generic_name', 'form', 'strength', 'brand', 'pack_size',
        'manufacturer', 'storage_class', 'classification_code', 'hsn_code',
      ];
      for (const k of optionalText) {
        const v = (form[k] as string).trim();
        if (v) payload[k] = v;
      }
      const optionalNum: (keyof typeof form)[] = [
        'gst_percentage', 'default_reorder_level', 'default_reorder_quantity', 'default_max_stock_level',
      ];
      for (const k of optionalNum) {
        const v = (form[k] as string).trim();
        if (v) payload[k] = Number(v);
      }
      await trpcMutate('scm.items.create', payload);
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create item" onClose={onClose}>
      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
        New items default to <code>pending_master_data_review</code>. Use the Transition button on the row to advance through the Codes Q3 lifecycle.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Code (SOP format, e.g. M-N-PH-00001)">
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Display name">
          <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Kind">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as any })} style={inputStyle}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </Field>
        <Field label="Unit of measure">
          <input value={form.unit_of_measure} onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })} style={inputStyle} placeholder="tab / ml / vial / box" />
        </Field>
        <Field label="Generic name">
          <input value={form.generic_name} onChange={(e) => setForm({ ...form, generic_name: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Brand">
          <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Form">
          <input value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })} style={inputStyle} placeholder="tab / cap / inj" />
        </Field>
        <Field label="Strength">
          <input value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} style={inputStyle} placeholder="500mg" />
        </Field>
        <Field label="Pack size">
          <input value={form.pack_size} onChange={(e) => setForm({ ...form, pack_size: e.target.value })} style={inputStyle} placeholder="10 tabs" />
        </Field>
        <Field label="Manufacturer">
          <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Storage class (N / T / O / C)">
          <input value={form.storage_class} onChange={(e) => setForm({ ...form, storage_class: e.target.value })} style={inputStyle} maxLength={1} />
        </Field>
        <Field label="Classification code (PH / SG / CH / RG / IM …)">
          <input value={form.classification_code} onChange={(e) => setForm({ ...form, classification_code: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="HSN code">
          <input value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="GST %">
          <input type="number" step="0.01" value={form.gst_percentage} onChange={(e) => setForm({ ...form, gst_percentage: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Default reorder level">
          <input type="number" step="0.001" value={form.default_reorder_level} onChange={(e) => setForm({ ...form, default_reorder_level: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Default reorder qty">
          <input type="number" step="0.001" value={form.default_reorder_quantity} onChange={(e) => setForm({ ...form, default_reorder_quantity: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Default max stock">
          <input type="number" step="0.001" value={form.default_max_stock_level} onChange={(e) => setForm({ ...form, default_max_stock_level: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Auto-reorder enabled">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
            <input
              type="checkbox"
              checked={form.auto_reorder_enabled}
              onChange={(e) => setForm({ ...form, auto_reorder_enabled: e.target.checked })}
            />
            <span style={{ fontSize: 13, color: '#6b7280' }}>Phase 2 auto-PR conversion</span>
          </label>
        </Field>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !form.code.trim() || !form.display_name.trim()} style={btnPrimary(submitting)}>
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Modal>
  );
}

function TransitionModal({ item, onClose, onTransitioned }: { item: Item; onClose: () => void; onTransitioned: () => void }) {
  const allowed = ALLOWED_TRANSITIONS[item.status] || [];
  const [toStatus, setToStatus] = useState(allowed[0] || '');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'emergency'>('routine');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isDeprecation = toStatus === 'deprecated_grace';

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const payload: any = { id: item.id, to_status: toStatus };
      if (isDeprecation) {
        payload.reason = reason;
        payload.urgency_tier = urgency;
      }
      await trpcMutate('scm.items.transitionStatus', payload);
      onTransitioned();
    } catch (e: any) {
      setErr(e?.message || 'Transition failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Transition: ${item.display_name}`} onClose={onClose}>
      <div style={{ marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
        <strong>Current status:</strong>{' '}
        <span style={{ color: STATUS_COLORS[item.status], fontWeight: 600 }}>{item.status.replace(/_/g, ' ')}</span>
      </div>

      <Field label="Transition to">
        <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} style={inputStyle}>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </Field>

      {isDeprecation ? (
        <>
          <Field label="Deprecation reason (required)">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
          </Field>
          <Field label="Urgency tier (Codes Q12)">
            <select value={urgency} onChange={(e) => setUrgency(e.target.value as any)} style={inputStyle}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </select>
          </Field>
        </>
      ) : null}

      {err ? (
        <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button
          onClick={submit}
          disabled={submitting || !toStatus || (isDeprecation && !reason.trim())}
          style={btnPrimary(submitting)}
        >
          {submitting ? 'Transitioning…' : `Transition to ${toStatus.replace(/_/g, ' ')}`}
        </button>
      </div>
    </Modal>
  );
}

// ─── Shared atoms ──────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 12, padding: 24, maxWidth: 720, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      <span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>{children}</th>;
}

function Td({ children, colSpan, style }: { children: React.ReactNode; colSpan?: number; style?: React.CSSProperties }) {
  return <td colSpan={colSpan} style={{ padding: '10px 12px', verticalAlign: 'middle', ...style }}>{children}</td>;
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
};

const btnPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  background: disabled ? '#93c5fd' : '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
