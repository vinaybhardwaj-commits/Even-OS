'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// /admin/scm/grns — Phase 3.5
//
// GRN list + state-aware drill modal: addLine / startInspection /
// runInspection (10-item KPMG) / recordInvoice / submit / accept / approveVariance.
// 3-way match status displayed; variance bucket color-coded.
// ============================================================

interface User { sub: string; hospital_id: string; role: string; email: string; name: string; }

interface GrnRow {
  id: string;
  grn_number: string;
  status: string;
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  vendor_invoice_number: string | null;
  vendor_invoice_amount: string | number | null;
  three_way_match_status: string | null;
  variance_amount: string | number | null;
  inspection_passed: boolean | null;
  received_at: string | null;
  created_by_name: string | null;
  created_at: string;
}

const GRN_STATE_COLORS: Record<string, string> = {
  draft: '#9ca3af', inspection_in_progress: '#f59e0b', submitted: '#3b82f6',
  accepted: '#10b981', partially_accepted: '#06b6d4', rejected: '#ef4444',
};
const MATCH_STATUS_COLORS: Record<string, string> = {
  pending: '#9ca3af', matched: '#10b981', variance_flagged: '#f59e0b',
  variance_approved: '#3b82f6', variance_rejected: '#ef4444',
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

// ============================================================

export default function ScmGrnsClient({ user }: { user: User }) {
  const [rows, setRows] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMatchStatus, setFilterMatchStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [drillFor, setDrillFor] = useState<GrnRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await trpcQuery('scm.grns.list', { status: filterStatus || undefined, three_way_match_status: filterMatchStatus || undefined }) || []);
    } catch (e: any) { setError(e?.message); } finally { setLoading(false); }
  }, [filterStatus, filterMatchStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6' }}>SCM</Link> › Goods Receipts
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📦 Goods Receipt Notes</h1>
        <button onClick={() => setShowCreate(true)} style={btnPrimary(false)}>+ New GRN (against PO)</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: 220 }}>
          <option value="">All states</option>
          {['draft', 'inspection_in_progress', 'submitted', 'accepted', 'partially_accepted', 'rejected'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterMatchStatus} onChange={(e) => setFilterMatchStatus(e.target.value)} style={{ ...inputStyle, width: 220 }}>
          <option value="">All match states</option>
          {['pending', 'matched', 'variance_flagged', 'variance_approved', 'variance_rejected'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <button onClick={load} style={{ ...btnSecondary, marginLeft: 'auto' }}>Refresh</button>
      </div>

      {error ? <ErrorBox msg={error} /> : null}

      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr><Th>GRN #</Th><Th>PO #</Th><Th>Vendor</Th><Th>State</Th><Th>Inspection</Th><Th>3-way match</Th><Th style={{ textAlign: 'right' }}>Invoice ₹</Th><Th>Created</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {loading ? <tr><Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td></tr>
              : rows.length === 0 ? <tr><Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>No GRNs.</Td></tr>
              : rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <Td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{r.grn_number}</code></Td>
                  <Td style={{ fontSize: 12 }}>{r.po_number || '—'}</Td>
                  <Td style={{ fontSize: 12 }}>{r.vendor_name || '—'}</Td>
                  <Td><Pill label={r.status.replace(/_/g, ' ')} color={GRN_STATE_COLORS[r.status] || '#6b7280'} /></Td>
                  <Td>{r.inspection_passed === true ? <span style={{ color: '#10b981' }}>✓ pass</span> : r.inspection_passed === false ? <span style={{ color: '#ef4444' }}>✗ fail</span> : <span style={{ color: '#9ca3af' }}>pending</span>}</Td>
                  <Td>{r.three_way_match_status ? <Pill label={r.three_way_match_status.replace(/_/g, ' ')} color={MATCH_STATUS_COLORS[r.three_way_match_status] || '#6b7280'} /> : <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>}</Td>
                  <Td style={{ textAlign: 'right' }}>{fmtCurrency(r.vendor_invoice_amount)}</Td>
                  <Td style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(r.created_at)}</Td>
                  <Td><button onClick={() => setDrillFor(r)} style={btnSecondarySmall}>Open</button></Td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showCreate ? <CreateGrnModal onClose={() => setShowCreate(false)} onCreated={load} /> : null}
      {drillFor ? <GrnDrillModal user={user} grn={drillFor} onClose={() => setDrillFor(null)} onChanged={load} /> : null}
    </div>
  );
}

function CreateGrnModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [pos, setPos] = useState<any[]>([]);
  const [poId, setPoId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => { try { setPos(await trpcQuery('scm.purchaseOrders.list', { status: 'sent_to_vendor' }) || []); } catch {} })();
  }, []);

  async function submit() {
    setSubmitting(true);
    try { await trpcMutate('scm.grns.create', { po_id: poId, notes: notes || undefined }); onCreated(); onClose(); } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="New Goods Receipt Note" onClose={onClose}>
      <div style={infoBox}>Select a PO that has been sent to the vendor. Phase 3 v1 supports 1 GRN per receipt event; multiple GRNs against one PO for partial deliveries are allowed.</div>
      <Field label="PO">
        <select value={poId} onChange={(e) => setPoId(e.target.value)} style={inputStyle}>
          <option value="">— select PO sent to vendor —</option>
          {pos.map((p: any) => <option key={p.id} value={p.id}>{p.po_number} — {p.vendor_name} (₹{Number(p.total_amount).toLocaleString('en-IN')})</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 50 }} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !poId} style={btnPrimary(submitting || !poId)}>{submitting ? 'Creating…' : 'Create draft GRN'}</button>
      </div>
    </Modal>
  );
}

function GrnDrillModal({ user, grn: initial, onClose, onChanged }: { user: User; grn: GrnRow; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showVarianceApprove, setShowVarianceApprove] = useState(false);

  const load = useCallback(async () => {
    try { setDetail(await trpcQuery('scm.grns.detail', initial.id)); } catch (e: any) { setErr(e?.message); } finally { setLoading(false); }
  }, [initial.id]);

  useEffect(() => { load(); }, [load]);

  async function startInspection() { setBusy('start'); try { await trpcMutate('scm.grns.startInspection', initial.id); load(); onChanged(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); } }
  async function submitGrn() { setBusy('submit'); try { await trpcMutate('scm.grns.submit', initial.id); load(); onChanged(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); } }
  async function acceptGrn() { setBusy('accept'); try { await trpcMutate('scm.grns.accept', { grn_id: initial.id, receive_location: 'warehouse' }); load(); onChanged(); } catch (e: any) { setErr(e?.message); } finally { setBusy(null); } }

  if (loading || !detail) return <Modal title={`GRN ${initial.grn_number}`} onClose={onClose}><div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>{err || 'Loading…'}</div></Modal>;

  const lines = detail.lines as any[];
  const inspection = detail.inspection;
  const state = detail.status;

  return (
    <Modal title={`GRN ${detail.grn_number}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 16 }}>
        <div><strong>State:</strong> <Pill label={state.replace(/_/g, ' ')} color={GRN_STATE_COLORS[state] || '#6b7280'} /></div>
        <div><strong>PO:</strong> <code>{detail.po_number}</code> · {fmtCurrency(detail.po_total_amount)}</div>
        <div><strong>Vendor:</strong> {detail.vendor_name}</div>
        <div><strong>Created:</strong> {detail.created_by_name} · {fmtDate(detail.created_at)}</div>
        <div><strong>Inspection:</strong> {detail.inspection_passed === true ? <span style={{ color: '#10b981' }}>✓ pass</span> : detail.inspection_passed === false ? <span style={{ color: '#ef4444' }}>✗ fail</span> : <span style={{ color: '#9ca3af' }}>not run</span>}</div>
        {detail.three_way_match_status ? <div><strong>3-way match:</strong> <Pill label={detail.three_way_match_status.replace(/_/g, ' ')} color={MATCH_STATUS_COLORS[detail.three_way_match_status] || '#6b7280'} /></div> : null}
        {detail.vendor_invoice_number ? <div><strong>Vendor invoice:</strong> {detail.vendor_invoice_number} · {fmtCurrency(detail.vendor_invoice_amount)}</div> : null}
        {detail.variance_amount ? <div style={{ color: '#92400e' }}><strong>Variance:</strong> {fmtCurrency(detail.variance_amount)}</div> : null}
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Lines ({lines.length})</div>
      {lines.length === 0 ? <div style={{ padding: 12, color: '#6b7280', fontSize: 13 }}>No lines yet. {state === 'draft' ? <button onClick={() => setShowAddLine(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Add a line</button> : null}</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <thead style={{ background: '#f3f4f6' }}>
              <tr><Th>Item</Th><Th>Batch</Th><Th>Expiry</Th><Th style={{ textAlign: 'right' }}>Recv</Th><Th style={{ textAlign: 'right' }}>Acc</Th><Th style={{ textAlign: 'right' }}>Rej</Th><Th style={{ textAlign: 'right' }}>Cost</Th></tr>
            </thead>
            <tbody>
              {lines.map((l: any) => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <Td><div style={{ fontWeight: 500 }}>{l.item_name}</div>{l.kind ? <span style={{ fontSize: 10, color: '#6366f1' }}>[{l.kind}]</span> : null}</Td>
                  <Td style={{ fontSize: 11 }}>{l.batch_number}</Td>
                  <Td style={{ fontSize: 11 }}>{fmtDate(l.expiry_date)}</Td>
                  <Td style={{ textAlign: 'right' }}>{fmtNum(l.quantity_received)}</Td>
                  <Td style={{ textAlign: 'right', color: '#10b981' }}>{fmtNum(l.quantity_accepted)}</Td>
                  <Td style={{ textAlign: 'right', color: Number(l.quantity_rejected) > 0 ? '#ef4444' : '#9ca3af' }}>{fmtNum(l.quantity_rejected)}</Td>
                  <Td style={{ textAlign: 'right' }}>{fmtCurrency(l.total_cost)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {inspection ? (
        <div style={{ marginBottom: 16, padding: 12, background: inspection.overall_pass ? '#f0fdf4' : '#fef2f2', border: `1px solid ${inspection.overall_pass ? '#86efac' : '#fca5a5'}`, borderRadius: 6, fontSize: 12 }}>
          <strong>KPMG 10-item inspection:</strong> {inspection.overall_pass ? '✓ all checks pass' : '✗ failures recorded'}
          {inspection.failure_notes ? <div style={{ marginTop: 4, fontStyle: 'italic' }}>{inspection.failure_notes}</div> : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        {state === 'draft' && <button onClick={() => setShowAddLine(true)} style={btnSecondary}>+ Add line</button>}
        {state === 'draft' && <button onClick={startInspection} disabled={busy === 'start' || lines.length === 0} style={btnPrimary(busy === 'start' || lines.length === 0)}>{busy === 'start' ? 'Starting…' : 'Start inspection'}</button>}
        {state === 'inspection_in_progress' && <button onClick={() => setShowInspection(true)} style={btnPrimary(false)}>Run KPMG checklist</button>}
        {(state === 'inspection_in_progress' || state === 'submitted') && !detail.vendor_invoice_number && <button onClick={() => setShowInvoice(true)} style={btnSecondary}>Record invoice</button>}
        {state === 'inspection_in_progress' && <button onClick={submitGrn} disabled={busy === 'submit' || detail.inspection_passed == null} style={btnPrimary(busy === 'submit' || detail.inspection_passed == null)}>{busy === 'submit' ? 'Submitting…' : 'Submit GRN'}</button>}
        {state === 'submitted' && <button onClick={acceptGrn} disabled={busy === 'accept'} style={btnPrimary(busy === 'accept')}>{busy === 'accept' ? 'Accepting…' : 'Accept (write inventory + 3-way match)'}</button>}
        {detail.three_way_match_status === 'variance_flagged' && <button onClick={() => setShowVarianceApprove(true)} style={btnPrimary(false)}>Approve / reject variance</button>}
        <button onClick={onClose} style={{ ...btnSecondary, marginLeft: 'auto' }}>Close</button>
      </div>

      {err ? <ErrorBox msg={err} /> : null}

      {showAddLine ? <AddGrnLineModal grnId={initial.id} poId={detail.po_id} onClose={() => setShowAddLine(false)} onAdded={() => { setShowAddLine(false); load(); onChanged(); }} /> : null}
      {showInspection ? <RunInspectionModal grnId={initial.id} onClose={() => setShowInspection(false)} onDone={() => { setShowInspection(false); load(); onChanged(); }} /> : null}
      {showInvoice ? <RecordInvoiceModal grnId={initial.id} onClose={() => setShowInvoice(false)} onSaved={() => { setShowInvoice(false); load(); onChanged(); }} /> : null}
      {showVarianceApprove ? <ApproveVarianceModal grnId={initial.id} variance={Number(detail.variance_amount || 0)} onClose={() => setShowVarianceApprove(false)} onDone={() => { setShowVarianceApprove(false); load(); onChanged(); }} /> : null}
    </Modal>
  );
}

function AddGrnLineModal({ grnId, poId, onClose, onAdded }: { grnId: string; poId: string; onClose: () => void; onAdded: () => void }) {
  const [poItems, setPoItems] = useState<any[]>([]);
  const [poItemId, setPoItemId] = useState('');
  const [qtyReceived, setQtyReceived] = useState('');
  const [qtyAccepted, setQtyAccepted] = useState('');
  const [batch, setBatch] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [expiry, setExpiry] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => { try { setPoItems(await trpcQuery('scm.purchaseOrders.listItems', poId) || []); } catch {} })();
  }, [poId]);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.grns.addLine', {
        grn_id: grnId, po_item_id: poItemId,
        quantity_received: Number(qtyReceived), quantity_accepted: Number(qtyAccepted),
        batch_number: batch, manufacturer: manufacturer || undefined,
        expiry_date: expiry, rejection_reason: rejectionReason || undefined,
      });
      onAdded();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  const rejected = Number(qtyReceived) - Number(qtyAccepted);
  return (
    <Modal title="Add GRN line" onClose={onClose} wide>
      <Field label="PO line item">
        <select value={poItemId} onChange={(e) => setPoItemId(e.target.value)} style={inputStyle}>
          <option value="">— select PO line —</option>
          {poItems.map((p: any) => <option key={p.id} value={p.id}>{p.item_name} — ordered {Number(p.quantity_ordered)} @ {fmtCurrency(p.unit_cost)}</option>)}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Quantity received"><input type="number" step="0.001" value={qtyReceived} onChange={(e) => setQtyReceived(e.target.value)} style={inputStyle} /></Field>
        <Field label="Quantity accepted"><input type="number" step="0.001" value={qtyAccepted} onChange={(e) => setQtyAccepted(e.target.value)} style={inputStyle} /></Field>
        <Field label="Batch number"><input value={batch} onChange={(e) => setBatch(e.target.value)} style={inputStyle} /></Field>
        <Field label="Expiry date"><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle} /></Field>
        <Field label="Manufacturer (optional)"><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} style={inputStyle} /></Field>
      </div>
      {rejected > 0 ? (
        <Field label={`Rejection reason (required — ${rejected} units rejected)`}>
          <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} style={{ ...inputStyle, minHeight: 50 }} />
        </Field>
      ) : null}
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>{submitting ? 'Adding…' : 'Add line'}</button>
      </div>
    </Modal>
  );
}

const KPMG_CHECKLIST_LABELS: Record<string, string> = {
  visual_quantity_tally_pass: 'Visual quantity tally',
  invoice_match_pass: 'Invoice ↔ delivery match',
  damage_check_pass: 'No damage on packaging',
  po_invoice_receipt_pass: 'PO ↔ invoice ↔ receipt match',
  packaging_integrity_pass: 'Packaging integrity intact',
  mfr_brand_batch_expiry_markings_pass: 'Mfr / brand / batch / expiry markings legible',
  shelf_life_180_days_pass: 'Shelf life ≥ 180 days',
  broken_bottles_pass: 'No broken bottles / vials',
  iv_fluid_fungus_pass: 'No fungus visible (IV fluids)',
  cold_chain_indicators_pass: 'Cold-chain indicators OK',
};

function RunInspectionModal({ grnId, onClose, onDone }: { grnId: string; onClose: () => void; onDone: () => void }) {
  const [checks, setChecks] = useState<Record<string, boolean | null>>(
    Object.fromEntries(Object.keys(KPMG_CHECKLIST_LABELS).map(k => [k, null]))
  );
  const [failureNotes, setFailureNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allDecided = Object.values(checks).every(v => v !== null);
  const allPass = Object.values(checks).every(v => v === true);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.grns.runInspection', { grn_id: grnId, ...checks, failure_notes: failureNotes || undefined });
      onDone();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="KPMG 10-item inspection checklist" onClose={onClose} wide>
      <div style={infoBox}>Tick PASS or FAIL for each item. Failing items require a failure_notes entry. Overall pass = all 10 PASS.</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {Object.entries(KPMG_CHECKLIST_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 8, alignItems: 'center', padding: '6px 10px', background: checks[key] === true ? '#f0fdf4' : checks[key] === false ? '#fef2f2' : '#fafafa', borderRadius: 4 }}>
            <span style={{ fontSize: 13 }}>{label}</span>
            <button onClick={() => setChecks({ ...checks, [key]: true })} style={{ ...btnSecondarySmall, background: checks[key] === true ? '#10b981' : 'white', color: checks[key] === true ? 'white' : '#374151' }}>PASS</button>
            <button onClick={() => setChecks({ ...checks, [key]: false })} style={{ ...btnSecondarySmall, background: checks[key] === false ? '#ef4444' : 'white', color: checks[key] === false ? 'white' : '#374151' }}>FAIL</button>
          </div>
        ))}
      </div>
      {!allPass && allDecided ? (
        <Field label="Failure notes (required when any item fails)">
          <textarea value={failureNotes} onChange={(e) => setFailureNotes(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
        </Field>
      ) : null}
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !allDecided || (!allPass && !failureNotes.trim())} style={btnPrimary(submitting || !allDecided || (!allPass && !failureNotes.trim()))}>
          {submitting ? 'Saving…' : `Submit (${allPass ? 'all pass' : 'with failures'})`}
        </button>
      </div>
    </Modal>
  );
}

function RecordInvoiceModal({ grnId, onClose, onSaved }: { grnId: string; onClose: () => void; onSaved: () => void }) {
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    try {
      await trpcMutate('scm.grns.recordInvoice', { grn_id: grnId, vendor_invoice_number: number, vendor_invoice_date: date, vendor_invoice_amount: Number(amount) });
      onSaved();
    } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Record vendor invoice" onClose={onClose}>
      <div style={infoBox}>Stored denormalized on the GRN (B1 lock). 3-way match auto-runs on accept.</div>
      <Field label="Invoice number"><input value={number} onChange={(e) => setNumber(e.target.value)} style={inputStyle} /></Field>
      <Field label="Invoice date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
      <Field label="Invoice amount (₹)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting || !number || !date || !amount} style={btnPrimary(submitting || !number || !date || !amount)}>{submitting ? 'Saving…' : 'Save invoice'}</button>
      </div>
    </Modal>
  );
}

function ApproveVarianceModal({ grnId, variance, onClose, onDone }: { grnId: string; variance: number; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    try { await trpcMutate('scm.grns.approveVariance', { grn_id: grnId, decision, notes: notes || undefined }); onDone(); } catch (e: any) { setErr(e?.message); } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Variance approval (3-way match flagged)" onClose={onClose}>
      <div style={infoBox}>Flagged variance: <strong>{fmtCurrency(variance)}</strong>. Approve unblocks payment; reject keeps it blocked.</div>
      <Field label="Decision">
        <select value={decision} onChange={(e) => setDecision(e.target.value as any)} style={inputStyle}>
          <option value="approved">Approve variance — unblock payment</option>
          <option value="rejected">Reject variance — keep blocked</option>
        </select>
      </Field>
      <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} /></Field>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={decision === 'approved' ? btnPrimary(submitting) : btnDanger(submitting)}>{submitting ? 'Saving…' : `Confirm ${decision}`}</button>
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
