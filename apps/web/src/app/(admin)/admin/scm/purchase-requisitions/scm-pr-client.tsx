'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// /admin/scm/purchase-requisitions — Phase 3.5
//
// PR list + state-aware drill modal: submit / approve / reject / cancel /
// convertToPO. KPMG tier enforced server-side; UI shows expected tier and
// pre-fills the approver_role on the approve form.
// ============================================================

interface User { sub: string; hospital_id: string; role: string; email: string; name: string; }

interface PrRow {
  id: string;
  pr_number: string;
  status: string;
  requisition_type: string;
  priority: string;
  material_classification: string | null;
  estimated_total_amount: string | number;
  needed_by: string | null;
  approver_role: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  rejected_by_name: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface PrItem {
  id: string;
  item_id: string;
  item_name: string;
  kind: string | null;
  unit_of_measure: string | null;
  quantity_requested: string | number;
  estimated_unit_cost: string | number | null;
  estimated_total: string | number | null;
}

interface VendorOption { id: string; vendor_code: string; vendor_name: string; vendor_is_active: boolean; }
interface ItemOption { id: string; code: string; display_name: string; kind: string; unit_of_measure: string; }

const PR_STATE_COLORS: Record<string, string> = {
  draft: '#9ca3af', submitted: '#f59e0b', pr_approved: '#3b82f6',
  pr_rejected: '#ef4444', pr_converted_to_po: '#10b981', cancelled: '#6b7280',
};
const PRIORITY_COLORS: Record<string, string> = { emergency: '#dc2626', stat: '#ef4444', urgent: '#f59e0b', routine: '#6b7280' };
const APPROVER_LABELS: Record<string, string> = {
  hod: 'HOD', non_med_head: 'Non-Med Head', finance_in_charge: 'Finance', facility_director: 'Facility Director', procurement_head: 'Procurement Head',
};

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message || 'Request failed');
  return j.result?.data?.json;
}
async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: input !== undefined ? input : {} }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error?.json?.message || j.error?.message || 'Mutation failed');
  return j.result?.data?.json;
}

function fmtCurrency(n: any): string { const num = Number(n); if (Number.isNaN(num)) return '—'; return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`; }
function fmtDate(d: string | null): string { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-IN'); } catch { return d; } }
function fmtNum(n: any): string { const num = Number(n); return Number.isNaN(num) ? '—' : num.toLocaleString('en-IN', { maximumFractionDigits: 3 }); }

// Tier-vs-amount labels (mirrors server-side kpmg-approval-matrix.ts)
function expectedTier(amount: number): string {
  if (amount <= 50_000) return 'hod';
  if (amount <= 200_000) return 'procurement_head';
  if (amount <= 1_000_000) return 'finance_in_charge';
  return 'facility_director';
}

// ============================================================

export default function ScmPrClient({ user }: { user: User }) {
  const [rows, setRows] = useState<PrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [drillFor, setDrillFor] = useState<PrRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('scm.purchaseRequisitions.list', { status: filterStatus || undefined });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6' }}>SCM</Link> › Purchase Requisitions
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📑 Purchase Requisitions</h1>
        <button onClick={() => setShowCreate(true)} style={btnPrimary(false)}>+ New PR (draft)</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: 220 }}>
          <option value="">All states</option>
          {['draft', 'submitted', 'pr_approved', 'pr_rejected', 'pr_converted_to_po', 'cancelled'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <button onClick={load} style={{ ...btnSecondary, marginLeft: 'auto' }}>Refresh</button>
      </div>

      {error ? <ErrorBox msg={error} /> : null}

      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr><Th>PR #</Th><Th>Type</Th><Th>State</Th><Th>Priority</Th><Th style={{ textAlign: 'right' }}>Estimate</Th><Th>Tier</Th><Th>Created</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {loading ? <tr><Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td></tr>
              : rows.length === 0 ? <tr><Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>No PRs match the filter.</Td></tr>
              : rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <Td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{r.pr_number}</code></Td>
                  <Td style={{ fontSize: 12 }}>{r.requisition_type.replace(/_/g, ' ')}</Td>
                  <Td><Pill label={r.status.replace(/_/g, ' ')} color={PR_STATE_COLORS[r.status] || '#6b7280'} /></Td>
                  <Td><Pill label={r.priority} color={PRIORITY_COLORS[r.priority] || '#6b7280'} /></Td>
                  <Td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtCurrency(r.estimated_total_amount)}</Td>
                  <Td style={{ fontSize: 12 }}>{r.approver_role ? APPROVER_LABELS[r.approver_role] || r.approver_role : '—'}</Td>
                  <Td style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(r.created_at)}</Td>
                  <Td><button onClick={() => setDrillFor(r)} style={btnSecondarySmall}>Open</button></Td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showCreate ? <CreatePrModal onClose={() => setShowCreate(false)} onCreated={load} /> : null}
      {drillFor ? <PrDrillModal user={user} pr={drillFor} onClose={() => setDrillFor(null)} onChanged={load} /> : null}
    </div>
  );
}

function CreatePrModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<'inventory_replenishment' | 'capex' | 'service' | 'consumable_emergency' | 'consignment' | 'tender_based'>('inventory_replenishment');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'emergency' | 'stat'>('routine');
  const [classification, setClassification] = useState<'standard' | 'emergency' | 'vital'>('standard');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.purchaseRequisitions.create', {
        requisition_type: type, priority, material_classification: classification,
        needed_by: neededBy || undefined, notes: notes || undefined,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setErr(e?.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New Purchase Requisition (draft)" onClose={onClose}>
      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
        Creates a draft PR with auto-generated number <code>PR-YYYY-{`{HOSPITAL}`}-NNNNN</code>. Add line items in the next step.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Requisition type">
          <select value={type} onChange={(e) => setType(e.target.value as any)} style={inputStyle}>
            <option value="inventory_replenishment">Inventory replenishment</option>
            <option value="capex">Capex</option>
            <option value="service">Service</option>
            <option value="consumable_emergency">Consumable emergency</option>
            <option value="consignment">Consignment</option>
            <option value="tender_based">Tender-based</option>
          </select>
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={inputStyle}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">Stat</option>
            <option value="emergency">Emergency</option>
          </select>
        </Field>
        <Field label="Material classification">
          <select value={classification} onChange={(e) => setClassification(e.target.value as any)} style={inputStyle}>
            <option value="standard">Standard</option>
            <option value="emergency">Emergency</option>
            <option value="vital">Vital</option>
          </select>
        </Field>
        <Field label="Needed by (optional)">
          <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 50 }} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>{submitting ? 'Creating…' : 'Create draft PR'}</button>
      </div>
    </Modal>
  );
}

function PrDrillModal({ user, pr: initial, onClose, onChanged }: { user: User; pr: PrRow; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await trpcQuery('scm.purchaseRequisitions.detail', initial.id));
    } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [initial.id]);

  useEffect(() => { load(); }, [load]);

  async function submitPr() {
    setBusy('submit');
    try { await trpcMutate('scm.purchaseRequisitions.submit', initial.id); load(); onChanged(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); }
  }
  async function cancelPr(reason: string) {
    setBusy('cancel');
    try { await trpcMutate('scm.purchaseRequisitions.cancel', { pr_id: initial.id, cancellation_reason: reason }); onClose(); onChanged(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); }
  }

  if (loading || !detail) return <Modal title={`PR ${initial.pr_number}`} onClose={onClose}><div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>{err || 'Loading…'}</div></Modal>;

  const items = detail.items as PrItem[];
  const state = detail.status;
  const amount = Number(detail.estimated_total_amount || 0);
  const tier = expectedTier(amount);

  return (
    <Modal title={`PR ${detail.pr_number}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 16 }}>
        <div><strong>State:</strong> <Pill label={state.replace(/_/g, ' ')} color={PR_STATE_COLORS[state] || '#6b7280'} /></div>
        <div><strong>Priority:</strong> <Pill label={detail.priority} color={PRIORITY_COLORS[detail.priority] || '#6b7280'} /></div>
        <div><strong>Type:</strong> {detail.requisition_type.replace(/_/g, ' ')}</div>
        <div><strong>Material class:</strong> {detail.material_classification || '—'}</div>
        <div><strong>Estimate:</strong> {fmtCurrency(amount)}</div>
        <div><strong>KPMG tier required:</strong> <code>{APPROVER_LABELS[tier]}</code></div>
        <div><strong>Created:</strong> {detail.created_by_name} · {fmtDate(detail.created_at)}</div>
        {detail.approved_by_name ? <div><strong>Approved:</strong> {detail.approved_by_name} · as {APPROVER_LABELS[detail.approver_role!] || detail.approver_role}</div> : null}
        {detail.rejection_reason ? <div style={{ gridColumn: 'span 2', color: '#991b1b' }}><strong>Rejected:</strong> {detail.rejection_reason}</div> : null}
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Line items ({items.length})</div>
      {items.length === 0 ? <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', background: '#fafafa', borderRadius: 6 }}>No items yet. {state === 'draft' ? <button onClick={() => setShowAddItem(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Add one</button> : null}</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <thead style={{ background: '#f3f4f6' }}>
              <tr><Th>Item</Th><Th style={{ textAlign: 'right' }}>Qty</Th><Th style={{ textAlign: 'right' }}>Unit cost</Th><Th style={{ textAlign: 'right' }}>Total</Th></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <Td><div style={{ fontWeight: 500 }}>{it.item_name}</div>{it.kind ? <span style={{ fontSize: 10, color: '#6366f1' }}>[{it.kind}]</span> : null}</Td>
                  <Td style={{ textAlign: 'right' }}>{fmtNum(it.quantity_requested)} {it.unit_of_measure || ''}</Td>
                  <Td style={{ textAlign: 'right' }}>{fmtCurrency(it.estimated_unit_cost)}</Td>
                  <Td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtCurrency(it.estimated_total)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {state === 'draft' && <button onClick={() => setShowAddItem(true)} style={btnSecondary}>+ Add line item</button>}
        {state === 'draft' && <button onClick={submitPr} disabled={busy === 'submit' || items.length === 0} style={btnPrimary(busy === 'submit' || items.length === 0)}>{busy === 'submit' ? 'Submitting…' : 'Submit for approval'}</button>}
        {state === 'submitted' && <><button onClick={() => setShowApprove(true)} style={btnPrimary(false)}>Approve…</button><button onClick={() => setShowReject(true)} style={btnSecondary}>Reject…</button></>}
        {state === 'pr_approved' && <button onClick={() => setShowConvert(true)} style={btnPrimary(false)}>Convert to PO…</button>}
        {(['draft', 'submitted', 'pr_approved'].includes(state)) && (initial.created_by_name || ['super_admin', 'hospital_admin'].includes(user.role)) && <button onClick={() => { const r = prompt('Cancellation reason?'); if (r) cancelPr(r); }} style={btnSecondary}>Cancel PR…</button>}
        <button onClick={onClose} style={{ ...btnSecondary, marginLeft: 'auto' }}>Close</button>
      </div>

      {err ? <ErrorBox msg={err} /> : null}

      {showAddItem ? <AddPrItemModal prId={initial.id} onClose={() => setShowAddItem(false)} onAdded={() => { setShowAddItem(false); load(); onChanged(); }} /> : null}
      {showApprove ? <ApprovePrModal prId={initial.id} amount={amount} expectedTier={tier} onClose={() => setShowApprove(false)} onApproved={() => { setShowApprove(false); load(); onChanged(); }} /> : null}
      {showReject ? <RejectPrModal prId={initial.id} onClose={() => setShowReject(false)} onRejected={() => { setShowReject(false); load(); onChanged(); }} /> : null}
      {showConvert ? <ConvertPrToPoModal prId={initial.id} onClose={() => setShowConvert(false)} onConverted={() => { setShowConvert(false); onClose(); onChanged(); }} /> : null}
    </Modal>
  );
}

function AddPrItemModal({ prId, onClose, onAdded }: { prId: string; onClose: () => void; onAdded: () => void }) {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [form, setForm] = useState({ item_id: '', quantity_requested: '', estimated_unit_cost: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setItems(await trpcQuery('scm.items.list', { status: 'active', limit: 500, include_network: true }) || []); } catch {}
    })();
  }, []);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.purchaseRequisitions.addItem', {
        pr_id: prId, item_id: form.item_id, quantity_requested: Number(form.quantity_requested),
        estimated_unit_cost: form.estimated_unit_cost ? Number(form.estimated_unit_cost) : undefined, notes: form.notes || undefined,
      });
      onAdded();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Add line item" onClose={onClose}>
      <Field label="Item">
        <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} style={inputStyle}>
          <option value="">— select active item —</option>
          {items.map(it => <option key={it.id} value={it.id}>[{it.kind}] {it.code} — {it.display_name} ({it.unit_of_measure})</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Quantity"><input type="number" step="0.001" value={form.quantity_requested} onChange={(e) => setForm({ ...form, quantity_requested: e.target.value })} style={inputStyle} /></Field>
        <Field label="Estimated unit cost (₹, optional)"><input type="number" step="0.01" value={form.estimated_unit_cost} onChange={(e) => setForm({ ...form, estimated_unit_cost: e.target.value })} style={inputStyle} /></Field>
      </div>
      <Field label="Notes (optional)"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={inputStyle} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !form.item_id || Number(form.quantity_requested) <= 0} style={btnPrimary(submitting || !form.item_id || Number(form.quantity_requested) <= 0)}>{submitting ? 'Adding…' : 'Add line'}</button>
      </div>
    </Modal>
  );
}

function ApprovePrModal({ prId, amount, expectedTier, onClose, onApproved }: { prId: string; amount: number; expectedTier: string; onClose: () => void; onApproved: () => void }) {
  const [role, setRole] = useState(expectedTier);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.purchaseRequisitions.approve', { pr_id: prId, approver_role: role });
      onApproved();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Approve PR" onClose={onClose}>
      <div style={infoBox}>
        Estimated total: <strong>{fmtCurrency(amount)}</strong>. KPMG matrix tier required: <code>{APPROVER_LABELS[expectedTier]}</code> or higher.
        Server enforces tier-vs-amount; rejecting if you sign as a lower-rank role.
      </div>
      <Field label="Sign as">
        <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
          {['hod', 'procurement_head', 'finance_in_charge', 'facility_director'].map(r => <option key={r} value={r}>{APPROVER_LABELS[r]}</option>)}
        </select>
      </Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>{submitting ? 'Approving…' : `Approve as ${APPROVER_LABELS[role]}`}</button>
      </div>
    </Modal>
  );
}

function RejectPrModal({ prId, onClose, onRejected }: { prId: string; onClose: () => void; onRejected: () => void }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.purchaseRequisitions.reject', { pr_id: prId, rejection_reason: reason });
      onRejected();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Reject PR" onClose={onClose}>
      <Field label="Reason (required)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !reason.trim()} style={btnDanger(submitting || !reason.trim())}>{submitting ? 'Rejecting…' : 'Confirm reject'}</button>
      </div>
    </Modal>
  );
}

function ConvertPrToPoModal({ prId, onClose, onConverted }: { prId: string; onClose: () => void; onConverted: () => void }) {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setVendors(await trpcQuery('scm.vendors.list', { is_active: true }) || []); } catch {}
    })();
  }, []);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.purchaseRequisitions.convertToPO', { pr_id: prId, vendor_id: vendorId, expected_delivery: expectedDelivery });
      onConverted();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Convert PR → PO (draft)" onClose={onClose}>
      <Field label="Vendor">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inputStyle}>
          <option value="">— select vendor —</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.vendor_name} ({v.vendor_code})</option>)}
        </select>
      </Field>
      <Field label="Expected delivery"><input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} style={inputStyle} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !vendorId || !expectedDelivery} style={btnPrimary(submitting || !vendorId || !expectedDelivery)}>{submitting ? 'Converting…' : 'Create draft PO'}</button>
      </div>
    </Modal>
  );
}

// ─── Atoms ──────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, maxWidth: wide ? 960 : 720, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}><span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>{children}</label>; }
function Pill({ label, color }: { label: string; color: string }) { return <span style={{ padding: '2px 8px', background: `${color}22`, color, borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{label}</span>; }
function ErrorBox({ msg }: { msg: string }) { return <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>{msg}</div>; }
function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', ...style }}>{children}</th>; }
function Td({ children, colSpan, style }: { children: React.ReactNode; colSpan?: number; style?: React.CSSProperties }) { return <td colSpan={colSpan} style={{ padding: '10px 12px', ...style }}>{children}</td>; }
const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, marginBottom: 12 };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' };
const btnSecondarySmall: React.CSSProperties = { padding: '4px 10px', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
const btnPrimary = (disabled: boolean): React.CSSProperties => ({ padding: '8px 16px', background: disabled ? '#93c5fd' : '#3b82f6', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' });
const btnDanger = (disabled: boolean): React.CSSProperties => ({ padding: '8px 16px', background: disabled ? '#fca5a5' : '#dc2626', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' });
