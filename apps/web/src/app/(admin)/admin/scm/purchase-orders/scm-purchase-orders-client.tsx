'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Purchase Orders — Phase 1.5b
//
// PO lifecycle CRUD against canonical purchase_orders + purchase_order_items.
// All 6 scm.purchaseOrders.* procedures wired:
//   - list (with status / vendor filters)
//   - create (draft PO; auto PO number PO-YYYY-{HOSPITAL}-NNNNN)
//   - addItem (line items; only on draft POs)
//   - approve (draft → approved; KPMG approver_role tier captured)
//   - sendToVendor (approved → sent_to_vendor)
//   - receive (sent_to_vendor / partially_received → partially_received / received;
//     creates inventory rows + grn_receive ledger entries)
//
// State machine: draft → approved → sent_to_vendor → partially_received → received → closed
//                                  └─→ cancelled (any state with appropriate role)
// KPMG approval matrix (RBAC enforcement deferred to Phase 1.6):
//   ≤₹50K: HOD  /  ₹50K-2L: Procurement Head  /  ₹2L-10L: Finance  /  ≥₹10L: Facility Director (+ CMS-GM co-approval)
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  hospital_id: string;
  po_number: string;
  pr_id: string | null;
  vendor_id: string;
  vendor_name: string | null;
  status: string;
  total_items: number;
  total_amount: string | number;
  expected_delivery: string | null;
  delivery_address: string | null;
  approver_role: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_to_vendor_at: string | null;
  first_received_at: string | null;
  fully_received_at: string | null;
  created_by_name: string | null;
  created_at: string;
  notes: string | null;
}

interface VendorOption {
  id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_is_active: boolean;
}

interface ItemOption {
  id: string;
  code: string;
  display_name: string;
  kind: string;
  unit_of_measure: string;
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

const PO_STATUS_COLORS: Record<string, string> = {
  draft: '#9ca3af',
  approved: '#3b82f6',
  sent_to_vendor: '#8b5cf6',
  partially_received: '#f59e0b',
  received: '#10b981',
  closed: '#6b7280',
  cancelled: '#ef4444',
};

const PO_STATUSES = ['draft', 'approved', 'sent_to_vendor', 'partially_received', 'received', 'closed', 'cancelled'] as const;

// KPMG approver tier suggestion (advisory only; Phase 1.6 enforces)
function suggestApproverRole(amount: number): string {
  if (amount <= 50_000) return 'hod';
  if (amount <= 200_000) return 'procurement_head';
  if (amount <= 1_000_000) return 'finance_in_charge';
  return 'facility_director';
}

function fmtCurrency(n: any): string {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN');
  } catch {
    return d;
  }
}

function fmtNum(n: any): string {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

// ============================================================

export default function ScmPurchaseOrdersClient({ user }: { user: User }) {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVendor, setFilterVendor] = useState('');

  // Vendors loaded once (used by create modal + filter)
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const data = await trpcQuery('scm.vendors.list', { is_active: true });
        setVendors(Array.isArray(data) ? data : []);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  const [showCreate, setShowCreate] = useState(false);
  const [drillFor, setDrillFor] = useState<PurchaseOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery('scm.purchaseOrders.list', {
        status: filterStatus || undefined,
        vendor_id: filterVendor || undefined,
      });
      setPos(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterVendor]);

  useEffect(() => {
    load();
  }, [load]);

  // KPIs
  const totalValue = pos.reduce((s, p) => s + Number(p.total_amount || 0), 0);
  const openCount = pos.filter((p) => !['received', 'closed', 'cancelled'].includes(p.status)).length;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Purchase Orders</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📋 Purchase Orders</h1>
        <button onClick={() => setShowCreate(true)} style={btnNew}>+ New PO (draft)</button>
      </div>

      {/* ─── KPI strip ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Total POs" value={fmtNum(pos.length)} color="#3b82f6" />
        <Kpi label="Open POs" value={fmtNum(openCount)} color={openCount > 0 ? '#f59e0b' : '#10b981'} />
        <Kpi label="Total value" value={fmtCurrency(totalValue)} color="#10b981" />
      </div>

      {/* ─── Filters ──────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: 200 }}>
          <option value="">All statuses</option>
          {PO_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} style={{ ...inputStyle, width: 280 }}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
        </select>
        <button onClick={load} style={{ ...btnSecondarySmall, marginLeft: 'auto' }}>Refresh</button>
      </div>

      {error ? <ErrorBox msg={error} /> : null}

      {/* ─── PO table ──────────────── */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>PO #</Th>
              <Th>Vendor</Th>
              <Th>Status</Th>
              <Th style={{ textAlign: 'right' }}>Lines</Th>
              <Th style={{ textAlign: 'right' }}>Total</Th>
              <Th>Expected</Th>
              <Th>Created</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td></tr>
            ) : pos.length === 0 ? (
              <tr><Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                No purchase orders match the current filters.{' '}
                <button onClick={() => setShowCreate(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Create one</button>?
              </Td></tr>
            ) : (
              pos.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <Td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{p.po_number}</code></Td>
                  <Td>{p.vendor_name || <span style={{ color: '#9ca3af' }}>(unknown)</span>}</Td>
                  <Td>
                    <span
                      style={{
                        padding: '2px 8px',
                        background: `${PO_STATUS_COLORS[p.status] || '#6b7280'}22`,
                        color: PO_STATUS_COLORS[p.status] || '#6b7280',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td style={{ textAlign: 'right' }}>{p.total_items}</Td>
                  <Td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtCurrency(p.total_amount)}</Td>
                  <Td>{fmtDate(p.expected_delivery)}</Td>
                  <Td style={{ color: '#6b7280', fontSize: 12 }}>
                    {fmtDate(p.created_at)}
                    {p.created_by_name ? <div style={{ fontSize: 11, color: '#9ca3af' }}>by {p.created_by_name}</div> : null}
                  </Td>
                  <Td>
                    <button onClick={() => setDrillFor(p)} style={btnSecondarySmall}>Open</button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>Showing {pos.length} PO{pos.length === 1 ? '' : 's'}</div>

      {/* ─── Modals ─────────────────── */}
      {showCreate ? <CreatePOModal vendors={vendors} onClose={() => setShowCreate(false)} onCreated={load} /> : null}
      {drillFor ? <PODrillModal po={drillFor} onClose={() => setDrillFor(null)} onChanged={load} /> : null}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────

function CreatePOModal({ vendors, onClose, onCreated }: { vendors: VendorOption[]; onClose: () => void; onCreated: () => void }) {
  const [vendorId, setVendorId] = useState('');
  const [expected, setExpected] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.purchaseOrders.create', {
        vendor_id: vendorId,
        expected_delivery: expected,
        delivery_address: deliveryAddress || undefined,
        notes: notes || undefined,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New purchase order (draft)" onClose={onClose}>
      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
        Creates a draft PO with auto-generated number <code>PO-YYYY-{`{HOSPITAL}`}-NNNNN</code>. Add line items in the next step (Open the PO from the list).
      </p>
      <Field label="Vendor">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inputStyle}>
          <option value="">— select an active vendor —</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name} ({v.vendor_code})</option>)}
        </select>
      </Field>
      <Field label="Expected delivery">
        <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Delivery address (optional)">
        <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} style={{ ...inputStyle, minHeight: 50 }} />
      </Field>
      <Field label="Notes (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 50 }} />
      </Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !vendorId || !expected} style={btnPrimary(submitting || !vendorId || !expected)}>
          {submitting ? 'Creating…' : 'Create draft PO'}
        </button>
      </div>
    </Modal>
  );
}

function PODrillModal({ po: initialPo, onClose, onChanged }: { po: PurchaseOrder; onClose: () => void; onChanged: () => void }) {
  // Re-fetched via list so the modal reflects the freshest data
  const [po, setPo] = useState<PurchaseOrder>(initialPo);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Per-PO line items fetched via scm.purchaseOrders.listItems (Phase 1.6).
  const [items, setItems] = useState<POLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsErr, setItemsErr] = useState<string | null>(null);

  const reloadItems = useCallback(async () => {
    setLoadingItems(true);
    setItemsErr(null);
    try {
      const data = await trpcQuery('scm.purchaseOrders.listItems', po.id);
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setItemsErr(e?.message || 'Failed to load line items');
    } finally {
      setLoadingItems(false);
    }
  }, [po.id]);

  useEffect(() => {
    reloadItems();
  }, [reloadItems]);

  const [showAdd, setShowAdd] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  async function approve() {
    setBusy('approve');
    setActionErr(null);
    try {
      const suggested = suggestApproverRole(Number(po.total_amount || 0));
      const updated = await trpcMutate('scm.purchaseOrders.approve', { po_id: po.id, approver_role: suggested });
      setPo({ ...po, ...updated, vendor_name: po.vendor_name, created_by_name: po.created_by_name });
      onChanged();
    } catch (e: any) {
      setActionErr(e?.message || 'Approve failed');
    } finally {
      setBusy(null);
    }
  }

  async function sendToVendor() {
    setBusy('send');
    setActionErr(null);
    try {
      const updated = await trpcMutate('scm.purchaseOrders.sendToVendor', po.id);
      setPo({ ...po, ...updated, vendor_name: po.vendor_name, created_by_name: po.created_by_name });
      onChanged();
    } catch (e: any) {
      setActionErr(e?.message || 'Send to vendor failed');
    } finally {
      setBusy(null);
    }
  }

  const canAddItems = po.status === 'draft';
  const canApprove = po.status === 'draft';
  const canSend = po.status === 'approved';
  const canReceive = po.status === 'sent_to_vendor' || po.status === 'partially_received';

  return (
    <Modal title={`PO ${po.po_number}`} onClose={onClose}>
      <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
        <div><strong>Vendor:</strong> {po.vendor_name || '—'}</div>
        <div>
          <strong>Status:</strong>{' '}
          <span style={{ padding: '2px 8px', background: `${PO_STATUS_COLORS[po.status] || '#6b7280'}22`, color: PO_STATUS_COLORS[po.status] || '#6b7280', borderRadius: 999, fontSize: 11, fontWeight: 500 }}>
            {po.status.replace(/_/g, ' ')}
          </span>
        </div>
        <div><strong>Lines:</strong> {po.total_items}</div>
        <div><strong>Total:</strong> {fmtCurrency(po.total_amount)}</div>
        <div><strong>Expected:</strong> {fmtDate(po.expected_delivery)}</div>
        <div><strong>Created:</strong> {fmtDate(po.created_at)}</div>
        {po.approved_at ? <div><strong>Approved:</strong> {fmtDate(po.approved_at)} ({po.approver_role || 'role n/a'})</div> : null}
        {po.sent_to_vendor_at ? <div><strong>Sent:</strong> {fmtDate(po.sent_to_vendor_at)}</div> : null}
        {po.first_received_at ? <div><strong>First received:</strong> {fmtDate(po.first_received_at)}</div> : null}
        {po.fully_received_at ? <div><strong>Fully received:</strong> {fmtDate(po.fully_received_at)}</div> : null}
      </div>

      {/* ─── Action buttons ──────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {canAddItems ? <button onClick={() => setShowAdd(true)} style={btnSecondary}>+ Add line item</button> : null}
        {canApprove ? (
          <button onClick={approve} disabled={busy === 'approve' || po.total_items === 0} style={btnPrimary(busy === 'approve' || po.total_items === 0)}>
            {busy === 'approve' ? 'Approving…' : `Approve (suggested: ${suggestApproverRole(Number(po.total_amount || 0)).replace(/_/g, ' ')})`}
          </button>
        ) : null}
        {canSend ? (
          <button onClick={sendToVendor} disabled={busy === 'send'} style={btnPrimary(busy === 'send')}>
            {busy === 'send' ? 'Sending…' : 'Send to vendor'}
          </button>
        ) : null}
        {canReceive ? <button onClick={() => setShowReceive(true)} style={btnPrimary(false)}>Receive items</button> : null}
        <button onClick={onChanged} style={{ ...btnSecondary, marginLeft: 'auto' }}>Refresh</button>
      </div>

      {actionErr ? <ErrorBox msg={actionErr} /> : null}

      {/* ─── Line items (scm.purchaseOrders.listItems) ───── */}
      <div style={{ marginTop: 16, marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#374151' }}>
        Line items {items.length > 0 ? <span style={{ color: '#9ca3af', fontWeight: 400 }}>({items.length})</span> : null}
      </div>
      {loadingItems ? (
        <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Loading line items…</div>
      ) : itemsErr ? (
        <ErrorBox msg={itemsErr} />
      ) : items.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 13, background: '#fafafa', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
          {po.status === 'draft' ? 'No line items yet. Click + Add line item.' : 'This PO has no line items.'}
        </div>
      ) : (
        <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
              <tr>
                <Th>Item</Th>
                <Th style={{ textAlign: 'right' }}>Ordered</Th>
                <Th style={{ textAlign: 'right' }}>Received</Th>
                <Th style={{ textAlign: 'right' }}>Remaining</Th>
                <Th style={{ textAlign: 'right' }}>Unit cost</Th>
                <Th style={{ textAlign: 'right' }}>Total</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const ordered = Number(it.quantity_ordered);
                const received = Number(it.quantity_received);
                const remaining = ordered - received;
                const fully = remaining <= 0;
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{it.item_name}</div>
                      {it.kind ? <span style={{ fontSize: 10, color: '#6366f1' }}>[{it.kind}]</span> : null}
                    </Td>
                    <Td style={{ textAlign: 'right' }}>{ordered} {it.unit_of_measure || ''}</Td>
                    <Td style={{ textAlign: 'right', color: fully ? '#10b981' : received > 0 ? '#f59e0b' : '#9ca3af' }}>{received}</Td>
                    <Td style={{ textAlign: 'right', fontWeight: 500, color: fully ? '#10b981' : '#374151' }}>
                      {fully ? '✓ done' : remaining}
                    </Td>
                    <Td style={{ textAlign: 'right' }}>{fmtCurrency(it.unit_cost)}</Td>
                    <Td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtCurrency(it.total_cost ?? Number(it.unit_cost) * ordered)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Add item modal ─────── */}
      {showAdd ? (
        <AddPOItemModal
          poId={po.id}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            reloadItems();
            onChanged();
          }}
        />
      ) : null}
      {showReceive ? (
        <ReceiveModal
          po={po}
          onClose={() => setShowReceive(false)}
          onReceived={() => {
            setShowReceive(false);
            reloadItems();
            onChanged();
          }}
        />
      ) : null}
    </Modal>
  );
}

function AddPOItemModal({ poId, onClose, onAdded }: { poId: string; onClose: () => void; onAdded: () => void }) {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    item_id: '',
    quantity_ordered: '',
    unit_cost: '',
    preferred_manufacturer: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await trpcQuery('scm.items.list', { status: 'active', limit: 500, include_network: true });
        setItems(Array.isArray(data) ? data : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.purchaseOrders.addItem', {
        po_id: poId,
        item_id: form.item_id,
        quantity_ordered: Number(form.quantity_ordered),
        unit_cost: Number(form.unit_cost),
        preferred_manufacturer: form.preferred_manufacturer || undefined,
        notes: form.notes || undefined,
      });
      onAdded();
    } catch (e: any) {
      setErr(e?.message || 'Add item failed');
    } finally {
      setSubmitting(false);
    }
  }

  const total = Number(form.quantity_ordered || 0) * Number(form.unit_cost || 0);

  return (
    <Modal title="Add line item to PO" onClose={onClose}>
      <Field label="Item">
        <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} style={inputStyle}>
          <option value="">{loading ? 'Loading items…' : '— select an active item —'}</option>
          {items.map((it) => <option key={it.id} value={it.id}>[{it.kind}] {it.code} — {it.display_name} ({it.unit_of_measure})</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Quantity ordered">
          <input type="number" step="0.001" value={form.quantity_ordered} onChange={(e) => setForm({ ...form, quantity_ordered: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Unit cost (₹)">
          <input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} style={inputStyle} />
        </Field>
      </div>
      <Field label="Preferred manufacturer (optional)">
        <input value={form.preferred_manufacturer} onChange={(e) => setForm({ ...form, preferred_manufacturer: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Notes (optional)">
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={inputStyle} />
      </Field>
      <div style={{ ...infoBox, marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          Line total: <span style={{ color: '#10b981', fontWeight: 700 }}>{fmtCurrency(total)}</span>
        </div>
      </div>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button
          onClick={submit}
          disabled={submitting || !form.item_id || Number(form.quantity_ordered) <= 0 || Number(form.unit_cost) <= 0}
          style={btnPrimary(submitting || !form.item_id || Number(form.quantity_ordered) <= 0 || Number(form.unit_cost) <= 0)}
        >
          {submitting ? 'Adding…' : 'Add item'}
        </button>
      </div>
    </Modal>
  );
}

interface POLineItem {
  id: string;
  po_id: string;
  item_id: string;
  item_name: string;
  kind: string | null;
  unit_of_measure: string | null;
  quantity_ordered: string | number;
  quantity_received: string | number;
  unit_cost: string | number;
  total_cost: string | number | null;
}

function ReceiveModal({ po, onClose, onReceived }: { po: PurchaseOrder; onClose: () => void; onReceived: () => void }) {
  // Phase 1.6: line items fetched inline via scm.purchaseOrders.listItems.
  // User picks remaining quantity per line; no manual UUID entry.
  const [poItems, setPoItems] = useState<POLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsErr, setItemsErr] = useState<string | null>(null);

  // Per-line input state, keyed by poi_id (only for the lines the user
  // wants to receive against — others left blank).
  const [linesByPoiId, setLinesByPoiId] = useState<Record<string, {
    quantity_received: string;
    batch_number: string;
    expiry_date: string;
    manufacturer: string;
    receive_location: string;
  }>>({});

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await trpcQuery('scm.purchaseOrders.listItems', po.id);
        const arr: POLineItem[] = Array.isArray(data) ? data : [];
        setPoItems(arr);
        // Pre-populate input rows with empty defaults
        const initial: typeof linesByPoiId = {};
        for (const it of arr) {
          initial[it.id] = { quantity_received: '', batch_number: '', expiry_date: '', manufacturer: '', receive_location: 'warehouse' };
        }
        setLinesByPoiId(initial);
      } catch (e: any) {
        setItemsErr(e?.message || 'Failed to load PO line items');
      } finally {
        setLoadingItems(false);
      }
    })();
  }, [po.id]);

  function updateLine(poiId: string, patch: Partial<(typeof linesByPoiId)[string]>) {
    setLinesByPoiId((prev) => ({ ...prev, [poiId]: { ...prev[poiId], ...patch } }));
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const items = Object.entries(linesByPoiId)
        .filter(([, l]) => Number(l.quantity_received) > 0)
        .map(([poi_id, l]) => ({
          poi_id,
          quantity_received: Number(l.quantity_received),
          batch_number: l.batch_number || undefined,
          expiry_date: l.expiry_date || undefined,
          manufacturer: l.manufacturer || undefined,
          receive_location: l.receive_location || 'warehouse',
        }));
      if (items.length === 0) {
        setErr('Enter a quantity > 0 for at least one line');
        setSubmitting(false);
        return;
      }
      // Validate per-line: cannot receive more than (ordered − already_received)
      for (const it of items) {
        const poItem = poItems.find((p) => p.id === it.poi_id);
        if (!poItem) continue;
        const remaining = Number(poItem.quantity_ordered) - Number(poItem.quantity_received);
        if (it.quantity_received > remaining) {
          setErr(`Line "${poItem.item_name}": cannot receive ${it.quantity_received}, only ${remaining} remaining of ${poItem.quantity_ordered} ordered`);
          setSubmitting(false);
          return;
        }
      }
      await trpcMutate('scm.purchaseOrders.receive', { po_id: po.id, items });
      onReceived();
    } catch (e: any) {
      setErr(e?.message || 'Receive failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Receive against ${po.po_number}`} onClose={onClose}>
      <div style={{ ...infoBox, marginBottom: 16 }}>
        <div style={{ fontSize: 13 }}>
          Each line below creates / updates an <code>inventory</code> row and writes a <code>grn_receive</code> entry to the stock_movements ledger
          (<code>source_module='scm'</code>, <code>source_ref_id={`{po.id}`}</code>). PO transitions to <strong>partially_received</strong> or <strong>received</strong> based on cumulative receipt vs ordered quantity. RBAC: requires the <code>grn_creator</code> SCM role (Phase 1.6).
        </div>
      </div>

      {loadingItems ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading line items…</div>
      ) : itemsErr ? (
        <ErrorBox msg={itemsErr} />
      ) : poItems.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          This PO has no line items. Add line items first (PO must be in <code>draft</code> state to add items).
        </div>
      ) : (
        poItems.map((poi) => {
          const ordered = Number(poi.quantity_ordered);
          const alreadyReceived = Number(poi.quantity_received);
          const remaining = ordered - alreadyReceived;
          const fullyReceived = remaining <= 0;
          const line = linesByPoiId[poi.id] || { quantity_received: '', batch_number: '', expiry_date: '', manufacturer: '', receive_location: 'warehouse' };
          return (
            <div
              key={poi.id}
              style={{
                marginBottom: 12,
                padding: 12,
                background: fullyReceived ? '#f0fdf4' : '#fafafa',
                border: `1px solid ${fullyReceived ? '#86efac' : '#e5e7eb'}`,
                borderRadius: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                <div>
                  <strong>{poi.item_name}</strong>
                  {poi.kind ? <span style={{ marginLeft: 6, fontSize: 11, color: '#6366f1' }}>[{poi.kind}]</span> : null}
                  <span style={{ marginLeft: 8, color: '#9ca3af' }}>· {ordered} {poi.unit_of_measure || 'unit'} ordered @ {fmtCurrency(poi.unit_cost)}</span>
                </div>
                <div style={{ fontSize: 12 }}>
                  {fullyReceived ? (
                    <span style={{ color: '#10b981', fontWeight: 600 }}>✓ fully received</span>
                  ) : (
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{remaining} remaining</span>
                  )}
                </div>
              </div>
              {fullyReceived ? null : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label={`Quantity received (max ${remaining})`}>
                    <input
                      type="number"
                      step="0.001"
                      max={remaining}
                      value={line.quantity_received}
                      onChange={(e) => updateLine(poi.id, { quantity_received: e.target.value })}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Receive location">
                    <input value={line.receive_location} onChange={(e) => updateLine(poi.id, { receive_location: e.target.value })} style={inputStyle} placeholder="warehouse / main_pharmacy / ot_stock" />
                  </Field>
                  <Field label="Batch number">
                    <input value={line.batch_number} onChange={(e) => updateLine(poi.id, { batch_number: e.target.value })} style={inputStyle} />
                  </Field>
                  <Field label="Expiry date">
                    <input type="date" value={line.expiry_date} onChange={(e) => updateLine(poi.id, { expiry_date: e.target.value })} style={inputStyle} />
                  </Field>
                  <Field label="Manufacturer">
                    <input value={line.manufacturer} onChange={(e) => updateLine(poi.id, { manufacturer: e.target.value })} style={inputStyle} />
                  </Field>
                </div>
              )}
            </div>
          );
        })
      )}

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>
          {submitting ? 'Receiving…' : 'Confirm receipt'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Atoms (shared with other SCM pages — kept inline for now) ──────

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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
      <span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>{msg}</div>;
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', ...style }}>{children}</th>;
}

function Td({ children, colSpan, style }: { children: React.ReactNode; colSpan?: number; style?: React.CSSProperties }) {
  return <td colSpan={colSpan} style={{ padding: '10px 12px', verticalAlign: 'middle', ...style }}>{children}</td>;
}

const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13 };
const btnNew: React.CSSProperties = { padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' };
const btnSecondarySmall: React.CSSProperties = { padding: '4px 10px', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
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
