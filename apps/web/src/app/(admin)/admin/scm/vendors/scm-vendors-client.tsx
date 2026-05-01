'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Vendors — Phase 1.5 first cut
//
// Vendor master CRUD, hospital-scoped. Calls scm.vendors.* directly
// (NOT pharmacy.* re-exports — new code goes on canonical namespace).
// Same vendor row used by Pharmacy clinical AND SCM procurement; the
// table itself still lives in 12-pharmacy.ts (relocation reviewed in
// Phase 2 cross-PRD review).
//
// Phase 1.6 follow-ups:
//   - License-expiry alerting + visual badges
//   - Vendor performance metrics view
//   - Contract linkage (vendor_contracts)
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface Vendor {
  id: string;
  hospital_id: string;
  vendor_code: string;
  vendor_name: string;
  contact_person: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_address: string | null;
  vendor_gst: string | null;
  drug_license: string | null;
  license_expiry: string | null;
  payment_terms_days: number | null;
  vendor_is_active: boolean;
  vendor_created_at: string;
}

// --- tRPC HTTP helpers ---
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Mutation failed');
  return json.result?.data?.json;
}

function isExpiringSoon(d: string | null): boolean {
  if (!d) return false;
  const days = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 60;
}

function isExpired(d: string | null): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

// ============================================================

export default function ScmVendorsClient({ user }: { user: User }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery('scm.vendors.list', showActiveOnly ? { is_active: true } : {});
      setVendors(Array.isArray(res) ? res : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, [showActiveOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // KPIs
  const expired = vendors.filter((v) => isExpired(v.license_expiry)).length;
  const expiringSoon = vendors.filter((v) => isExpiringSoon(v.license_expiry)).length;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Vendors</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🏢 Vendors</h1>
        <button onClick={() => setShowCreate(true)} style={btnNew}>+ New vendor</button>
      </div>

      {/* ─── KPI strip ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Total" value={vendors.length} color="#3b82f6" />
        <Kpi
          label="License expired"
          value={expired}
          color={expired > 0 ? '#ef4444' : '#10b981'}
          hint="Drug license past expiry"
        />
        <Kpi
          label="Expiring ≤60d"
          value={expiringSoon}
          color={expiringSoon > 0 ? '#f59e0b' : '#10b981'}
          hint="Renewal needed soon"
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showActiveOnly}
            onChange={(e) => setShowActiveOnly(e.target.checked)}
          />
          Active vendors only
        </label>
        <button onClick={load} style={{ marginLeft: 'auto', ...btnSecondarySmall }}>
          Refresh
        </button>
      </div>

      {error ? (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      ) : null}

      {/* ─── Vendors table ───────────────────────────── */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>GST</Th>
              <Th>Drug license</Th>
              <Th>License expiry</Th>
              <Th>Terms</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  Loading…
                </Td>
              </tr>
            ) : vendors.length === 0 ? (
              <tr>
                <Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  No vendors yet.{' '}
                  <button onClick={() => setShowCreate(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Create the first one
                  </button>
                  .
                </Td>
              </tr>
            ) : (
              vendors.map((v) => {
                const expirySoon = isExpiringSoon(v.license_expiry);
                const expiredV = isExpired(v.license_expiry);
                return (
                  <tr key={v.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <Td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{v.vendor_code}</code></Td>
                    <Td style={{ fontWeight: 500 }}>{v.vendor_name}</Td>
                    <Td style={{ color: '#6b7280' }}>
                      {v.contact_person || '—'}
                      {v.vendor_phone ? <div style={{ fontSize: 11, color: '#9ca3af' }}>{v.vendor_phone}</div> : null}
                    </Td>
                    <Td style={{ fontSize: 12, fontFamily: 'monospace' }}>{v.vendor_gst || '—'}</Td>
                    <Td style={{ fontSize: 12, fontFamily: 'monospace' }}>{v.drug_license || '—'}</Td>
                    <Td>
                      {v.license_expiry ? (
                        <span
                          style={{
                            color: expiredV ? '#ef4444' : expirySoon ? '#f59e0b' : '#374151',
                            fontWeight: expiredV || expirySoon ? 600 : 400,
                          }}
                        >
                          {new Date(v.license_expiry).toLocaleDateString('en-IN')}
                          {expiredV ? ' (expired)' : expirySoon ? ' (soon)' : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>{v.payment_terms_days ? `${v.payment_terms_days}d` : '—'}</Td>
                    <Td>
                      <span
                        style={{
                          padding: '2px 8px',
                          background: v.vendor_is_active ? '#d1fae5' : '#f3f4f6',
                          color: v.vendor_is_active ? '#065f46' : '#6b7280',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {v.vendor_is_active ? 'active' : 'inactive'}
                      </span>
                    </Td>
                    <Td>
                      <button onClick={() => setEditing(v)} style={btnSecondarySmall}>Edit</button>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
        Showing {vendors.length} vendor{vendors.length === 1 ? '' : 's'} for hospital <strong>{user.hospital_id}</strong>
      </div>

      {showCreate ? <VendorFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={load} /> : null}
      {editing ? <VendorFormModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={load} /> : null}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────

function VendorFormModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Vendor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    vendor_code: initial?.vendor_code || '',
    vendor_name: initial?.vendor_name || '',
    contact_person: initial?.contact_person || '',
    vendor_phone: initial?.vendor_phone || '',
    vendor_email: initial?.vendor_email || '',
    vendor_address: initial?.vendor_address || '',
    vendor_gst: initial?.vendor_gst || '',
    drug_license: initial?.drug_license || '',
    license_expiry: initial?.license_expiry || '',
    payment_terms_days: initial?.payment_terms_days?.toString() || '30',
    vendor_is_active: initial?.vendor_is_active ?? true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const payload: any = {
        vendor_code: form.vendor_code.trim(),
        vendor_name: form.vendor_name.trim(),
        contact_person: form.contact_person.trim(),
        vendor_phone: form.vendor_phone.trim(),
        vendor_email: form.vendor_email.trim(),
        vendor_address: form.vendor_address.trim(),
        payment_terms_days: Number(form.payment_terms_days) || 30,
        vendor_is_active: form.vendor_is_active,
      };
      if (form.vendor_gst.trim()) payload.vendor_gst = form.vendor_gst.trim();
      if (form.drug_license.trim()) payload.drug_license = form.drug_license.trim();
      if (form.license_expiry.trim()) payload.license_expiry = form.license_expiry.trim();

      if (mode === 'create') {
        await trpcMutate('scm.vendors.create', payload);
      } else {
        await trpcMutate('scm.vendors.update', { id: initial!.id, ...payload });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || `${mode === 'create' ? 'Create' : 'Update'} failed`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={mode === 'create' ? 'New vendor' : `Edit: ${initial?.vendor_name}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Vendor code">
          <input value={form.vendor_code} onChange={(e) => setForm({ ...form, vendor_code: e.target.value })} style={inputStyle} disabled={mode === 'edit'} />
        </Field>
        <Field label="Vendor name">
          <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Contact person">
          <input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Phone">
          <input value={form.vendor_phone} onChange={(e) => setForm({ ...form, vendor_phone: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.vendor_email} onChange={(e) => setForm({ ...form, vendor_email: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="GSTIN">
          <input value={form.vendor_gst} onChange={(e) => setForm({ ...form, vendor_gst: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Drug license number">
          <input value={form.drug_license} onChange={(e) => setForm({ ...form, drug_license: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="License expiry">
          <input type="date" value={form.license_expiry?.slice(0, 10) || ''} onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Payment terms (days)">
          <input type="number" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Active">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
            <input
              type="checkbox"
              checked={form.vendor_is_active}
              onChange={(e) => setForm({ ...form, vendor_is_active: e.target.checked })}
            />
            <span style={{ fontSize: 13, color: '#6b7280' }}>Vendor available for new POs</span>
          </label>
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Address">
            <textarea value={form.vendor_address} onChange={(e) => setForm({ ...form, vendor_address: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
          </Field>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button
          onClick={submit}
          disabled={submitting || !form.vendor_code.trim() || !form.vendor_name.trim()}
          style={btnPrimary(submitting)}
        >
          {submitting ? 'Saving…' : mode === 'create' ? 'Create vendor' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Atoms ────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, maxWidth: 720, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
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

function Kpi({ label, value, color, hint }: { label: string; value: number; color: string; hint?: string }) {
  return (
    <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{hint}</div> : null}
    </div>
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

const btnNew: React.CSSProperties = {
  padding: '8px 16px',
  background: '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
};

const btnSecondarySmall: React.CSSProperties = {
  padding: '4px 10px',
  background: 'white',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 12,
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
