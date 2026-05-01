'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Indents — Phase 2.3 Procurement Officer admin queue
//
// List, filter, drill, and act on indents across the hospital. Per Q-A2
// admin assigns source_location at approve time. Per Q-A8 per-line
// approval lets approver tweak quantity_approved per line before the
// chain-completion flip to 'approved'. Per Q-A10 v1 only single-tier
// matrix is in play; the UI nevertheless renders the approval chain
// visualization so Phase 9 KPMG ABSORPTION lights up without UI rework.
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface IndentRow {
  id: string;
  indent_number: string;
  state: string;
  priority: string;
  source_location: string;
  destination_location: string;
  raised_by: string;
  raised_by_name: string | null;
  approved_by_name: string | null;
  reason: string | null;
  notes: string | null;
  sla_due_at: string | null;
  sla_breached_at: string | null;
  approved_at: string | null;
  issued_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

interface IndentItem {
  id: string;
  indent_id: string;
  item_id: string;
  item_name: string;
  kind: string | null;
  unit_of_measure: string | null;
  quantity_requested: string | number;
  quantity_approved: string | number | null;
  quantity_issued: string | number;
  quantity_acknowledged: string | number;
  notes: string | null;
}

interface IndentApproval {
  id: string;
  approver_role: string;
  decision: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  tier_order: number;
}

interface StateLogEntry {
  from_state: string | null;
  to_state: string;
  actor_name: string | null;
  actor_role: string | null;
  reason: string | null;
  transitioned_at: string;
}

const STATE_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#3b82f6',
  issued: '#8b5cf6',
  in_transit: '#06b6d4',
  received: '#10b981',
  closed: '#6b7280',
  rejected: '#ef4444',
  cancelled: '#9ca3af',
};

const PRIORITY_COLORS: Record<string, string> = {
  emergency: '#dc2626',
  stat: '#ef4444',
  urgent: '#f59e0b',
  routine: '#6b7280',
};

const PRIORITY_ORDER = ['emergency', 'stat', 'urgent', 'routine'];

const APPROVER_LABELS: Record<string, string> = {
  hod: 'HOD',
  non_med_head: 'Non-Med Head',
  finance_in_charge: 'Finance',
  facility_director: 'Facility Director',
  procurement_head: 'Procurement Head',
};

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

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN'); } catch { return d; }
}
function fmtDateTime(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }); } catch { return d; }
}
function fmtNum(n: any): string {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  return Number.isNaN(num) ? '—' : num.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function slaBucket(due: string | null, state: string): { color: string; label: string } {
  if (['received', 'closed', 'rejected', 'cancelled'].includes(state) || !due) return { color: '#9ca3af', label: '—' };
  const ms = new Date(due).getTime() - Date.now();
  if (ms <= 0) return { color: '#ef4444', label: 'BREACHED' };
  const min = ms / 60_000;
  if (min <= 30) return { color: '#f59e0b', label: 'critical' };
  if (min <= 120) return { color: '#fbbf24', label: 'warning' };
  return { color: '#10b981', label: 'on track' };
}

// ============================================================

export default function ScmIndentsClient({ user }: { user: User }) {
  const [rows, setRows] = useState<IndentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [slaBreachedOnly, setSlaBreachedOnly] = useState(false);
  const [drillFor, setDrillFor] = useState<IndentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery('scm.indents.list', {
        state: filterState || undefined,
        priority: filterPriority || undefined,
        sla_breached_only: slaBreachedOnly || undefined,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load indents');
    } finally {
      setLoading(false);
    }
  }, [filterState, filterPriority, slaBreachedOnly]);

  useEffect(() => { load(); }, [load]);

  // KPIs
  const kpis = useMemo(() => {
    const pending = rows.filter(r => r.state === 'pending').length;
    const approved = rows.filter(r => r.state === 'approved').length;
    const inFlight = rows.filter(r => ['issued', 'in_transit'].includes(r.state)).length;
    const breached = rows.filter(r => r.sla_breached_at && !['received', 'closed', 'rejected', 'cancelled'].includes(r.state)).length;
    return { pending, approved, inFlight, breached };
  }, [rows]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Indents</span>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 16px 0' }}>📥 Indents (Procurement Queue)</h1>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Pending approval" value={kpis.pending} color="#f59e0b" />
        <Kpi label="Approved (awaiting issue)" value={kpis.approved} color="#3b82f6" />
        <Kpi label="In flight (issued / in transit)" value={kpis.inFlight} color="#06b6d4" />
        <Kpi label="SLA breached" value={kpis.breached} color={kpis.breached > 0 ? '#ef4444' : '#10b981'} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filterState} onChange={(e) => setFilterState(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">All states</option>
          {['pending', 'approved', 'issued', 'in_transit', 'received', 'closed', 'rejected', 'cancelled'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} style={{ ...inputStyle, width: 160 }}>
          <option value="">All priorities</option>
          {PRIORITY_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={slaBreachedOnly} onChange={(e) => setSlaBreachedOnly(e.target.checked)} />
          SLA breached only
        </label>
        <button onClick={load} style={{ ...btnSecondarySmall, marginLeft: 'auto' }}>Refresh</button>
      </div>

      {error ? <ErrorBox msg={error} /> : null}

      {/* Table */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>Indent #</Th>
              <Th>State</Th>
              <Th>Priority</Th>
              <Th>Destination</Th>
              <Th>Raised by</Th>
              <Th>SLA</Th>
              <Th>Created</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td></tr>
            ) : rows.length === 0 ? (
              <tr><Td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>No indents match the current filters.</Td></tr>
            ) : (
              rows.map(r => {
                const sla = slaBucket(r.sla_due_at, r.state);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <Td><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{r.indent_number}</code></Td>
                    <Td><Pill label={r.state.replace(/_/g, ' ')} color={STATE_COLORS[r.state] || '#6b7280'} /></Td>
                    <Td><Pill label={r.priority} color={PRIORITY_COLORS[r.priority] || '#6b7280'} /></Td>
                    <Td><code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{r.destination_location}</code></Td>
                    <Td>{r.raised_by_name || '—'}</Td>
                    <Td><span style={{ color: sla.color, fontWeight: 600, fontSize: 11 }}>{sla.label}</span><div style={{ fontSize: 10, color: '#9ca3af' }}>{fmtDateTime(r.sla_due_at)}</div></Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{fmtDateTime(r.created_at)}</Td>
                    <Td><button onClick={() => setDrillFor(r)} style={btnSecondarySmall}>Open</button></Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>Showing {rows.length} indent{rows.length === 1 ? '' : 's'}</div>

      {drillFor ? <IndentDrillModal user={user} indent={drillFor} onClose={() => setDrillFor(null)} onChanged={load} /> : null}
    </div>
  );
}

// ─── Drill modal ────────────────────────────────────────

function IndentDrillModal({ user, indent: initial, onClose, onChanged }: { user: User; indent: IndentRow; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await trpcQuery('scm.indents.detail', initial.id);
      setDetail(data);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load indent detail');
    } finally {
      setLoading(false);
    }
  }, [initial.id]);

  useEffect(() => { load(); }, [load]);

  if (loading || !detail) {
    return (
      <Modal title={`Indent ${initial.indent_number}`} onClose={onClose}>
        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Loading…</div>
        {err ? <ErrorBox msg={err} /> : null}
      </Modal>
    );
  }

  const items = detail.items as IndentItem[];
  const approvals = detail.approvals as IndentApproval[];
  const stateLog = detail.state_log as StateLogEntry[];

  const state = detail.state as string;
  const canApprove = state === 'pending';
  const canIssue = state === 'approved' || state === 'issued';
  const canCancel = ['pending', 'approved'].includes(state) && (initial.raised_by === user.sub || ['super_admin', 'hospital_admin'].includes(user.role));
  const canClose = state === 'received';

  return (
    <Modal title={`Indent ${detail.indent_number}`} onClose={onClose} wide>
      {/* Header summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 16 }}>
        <div><strong>State:</strong> <Pill label={state.replace(/_/g, ' ')} color={STATE_COLORS[state] || '#6b7280'} /></div>
        <div><strong>Priority:</strong> <Pill label={detail.priority} color={PRIORITY_COLORS[detail.priority] || '#6b7280'} /></div>
        <div><strong>Source:</strong> <code>{detail.source_location}</code></div>
        <div><strong>Destination:</strong> <code>{detail.destination_location}</code></div>
        <div><strong>Raised by:</strong> {detail.raised_by_name || '—'}</div>
        <div><strong>Raised:</strong> {fmtDateTime(detail.created_at)}</div>
        <div><strong>SLA due:</strong> {fmtDateTime(detail.sla_due_at)}</div>
        {detail.approved_at ? <div><strong>Approved:</strong> {fmtDateTime(detail.approved_at)} by {detail.approved_by_name}</div> : null}
        {detail.issued_at ? <div><strong>Issued:</strong> {fmtDateTime(detail.issued_at)} by {detail.issued_by_name}</div> : null}
        {detail.acknowledged_at ? <div><strong>Received:</strong> {fmtDateTime(detail.acknowledged_at)} by {detail.acknowledged_by_name}</div> : null}
        {detail.reason ? <div style={{ gridColumn: 'span 2' }}><strong>Reason:</strong> {detail.reason}</div> : null}
        {detail.rejection_reason ? <div style={{ gridColumn: 'span 2', color: '#991b1b' }}><strong>Rejection:</strong> {detail.rejection_reason}</div> : null}
        {detail.cancellation_reason ? <div style={{ gridColumn: 'span 2', color: '#6b7280' }}><strong>Cancelled:</strong> {detail.cancellation_reason}</div> : null}
      </div>

      {/* Approval chain */}
      <Section title="Approval chain">
        {approvals.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>No approvers required.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {approvals.sort((a, b) => a.tier_order - b.tier_order).map((a) => (
              <div key={a.id} style={{
                padding: 10,
                background: a.decision === 'approved' ? '#f0fdf4' : a.decision === 'rejected' ? '#fef2f2' : '#fffbeb',
                border: `1px solid ${a.decision === 'approved' ? '#86efac' : a.decision === 'rejected' ? '#fca5a5' : '#fde68a'}`,
                borderRadius: 6,
                fontSize: 12,
                minWidth: 180,
              }}>
                <div style={{ fontWeight: 600 }}>{APPROVER_LABELS[a.approver_role] || a.approver_role}</div>
                <div style={{ color: a.decision === 'approved' ? '#065f46' : a.decision === 'rejected' ? '#991b1b' : '#92400e' }}>
                  {a.decision ? `${a.decision === 'approved' ? '✓' : '✗'} ${a.decision}` : '⏳ pending'}
                </div>
                {a.decided_by_name ? <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{a.decided_by_name} · {fmtDateTime(a.decided_at)}</div> : null}
                {a.decision_reason ? <div style={{ fontSize: 11, fontStyle: 'italic', marginTop: 4 }}>"{a.decision_reason}"</div> : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Line items */}
      <Section title={`Line items (${items.length})`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: '#f3f4f6' }}>
            <tr>
              <Th>Item</Th>
              <Th style={{ textAlign: 'right' }}>Requested</Th>
              <Th style={{ textAlign: 'right' }}>Approved</Th>
              <Th style={{ textAlign: 'right' }}>Issued</Th>
              <Th style={{ textAlign: 'right' }}>Acknowledged</Th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td>
                  <div style={{ fontWeight: 500 }}>{it.item_name}</div>
                  {it.kind ? <span style={{ fontSize: 10, color: '#6366f1' }}>[{it.kind}]</span> : null}
                </Td>
                <Td style={{ textAlign: 'right' }}>{fmtNum(it.quantity_requested)} {it.unit_of_measure || ''}</Td>
                <Td style={{ textAlign: 'right', color: it.quantity_approved == null ? '#9ca3af' : '#374151' }}>{fmtNum(it.quantity_approved)}</Td>
                <Td style={{ textAlign: 'right', color: '#3b82f6' }}>{fmtNum(it.quantity_issued)}</Td>
                <Td style={{ textAlign: 'right', color: '#10b981' }}>{fmtNum(it.quantity_acknowledged)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* State log */}
      <Section title={`State history (${stateLog.length})`}>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
          {stateLog.map((s, i) => (
            <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>
                {s.from_state || '∅'} → {s.to_state}
              </code>
              <span style={{ marginLeft: 8, color: '#6b7280' }}>{s.actor_name || '—'} ({s.actor_role || '?'}) · {fmtDateTime(s.transitioned_at)}</span>
              {s.reason ? <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', marginLeft: 16, marginTop: 2 }}>"{s.reason}"</div> : null}
            </li>
          ))}
        </ul>
      </Section>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {canApprove ? <ApproveAction user={user} indent={detail} items={items} approvals={approvals} onChanged={() => { load(); onChanged(); }} /> : null}
        {canIssue ? <IssueAction user={user} indent={detail} items={items} onChanged={() => { load(); onChanged(); }} /> : null}
        {canCancel ? <CancelAction indent={detail} onChanged={() => { onClose(); onChanged(); }} /> : null}
        {canClose ? <CloseAction indent={detail} onChanged={() => { load(); onChanged(); }} /> : null}
        <button onClick={onClose} style={{ ...btnSecondary, marginLeft: 'auto' }}>Close</button>
      </div>
    </Modal>
  );
}

// ─── Action sub-components ──────────────────────────

function ApproveAction({ user, indent, items, approvals, onChanged }: { user: User; indent: any; items: IndentItem[]; approvals: IndentApproval[]; onChanged: () => void }) {
  const [showModal, setShowModal] = useState(false);
  const myPending = approvals.find(a => a.decision === null);

  if (!myPending) return null;

  return (
    <>
      <button onClick={() => setShowModal(true)} style={btnPrimary(false)}>Approve as {APPROVER_LABELS[myPending.approver_role] || myPending.approver_role}</button>
      {showModal ? <ApproveModal user={user} indent={indent} items={items} approval={myPending} isFirstTier={myPending.tier_order === 1} onClose={() => setShowModal(false)} onApproved={() => { setShowModal(false); onChanged(); }} /> : null}
    </>
  );
}

function ApproveModal({ user, indent, items, approval, isFirstTier, onClose, onApproved }: { user: User; indent: any; items: IndentItem[]; approval: IndentApproval; isFirstTier: boolean; onClose: () => void; onApproved: () => void }) {
  const [sourceLocation, setSourceLocation] = useState(indent.source_location === 'tbd_at_approval' ? 'main_pharmacy' : indent.source_location);
  const [decisionReason, setDecisionReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [lineApprovals, setLineApprovals] = useState<Record<string, string>>(
    Object.fromEntries(items.map(it => [it.item_id, String(it.quantity_approved ?? it.quantity_requested)]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function approve() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.indents.approve', {
        indent_id: indent.id,
        approver_role: approval.approver_role,
        source_location: sourceLocation.trim(),
        decision_reason: decisionReason || undefined,
        line_approvals: Object.entries(lineApprovals).map(([item_id, qty]) => ({
          item_id,
          quantity_approved: Number(qty),
        })),
      });
      onApproved();
    } catch (e: any) {
      setErr(e?.message || 'Approve failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function reject() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.indents.reject', {
        indent_id: indent.id,
        approver_role: approval.approver_role,
        reason: rejectReason,
      });
      onApproved();
    } catch (e: any) {
      setErr(e?.message || 'Reject failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`${showReject ? 'Reject' : 'Approve'} indent ${indent.indent_number}`} onClose={onClose} wide>
      {showReject ? (
        <>
          <div style={infoBox}>You are rejecting as <strong>{APPROVER_LABELS[approval.approver_role]}</strong>. Any rejection sends the WHOLE indent to terminal state.</div>
          <Field label="Rejection reason (required)">
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} />
          </Field>
          {err ? <ErrorBox msg={err} /> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setShowReject(false)} style={btnSecondary}>Back</button>
            <button onClick={reject} disabled={submitting || !rejectReason.trim()} style={btnDanger(submitting || !rejectReason.trim())}>
              {submitting ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </div>
        </>
      ) : (
        <>
          {isFirstTier ? (
            <>
              <div style={infoBox}>
                <strong>First-tier approval:</strong> you set source_location and per-line quantity_approved. Subsequent tiers (if any) only sign off.
              </div>
              <Field label="Source location (where stock will come from)">
                <input value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)} style={inputStyle} placeholder="main_pharmacy / cssd_store / lab_cold_storage / …" />
              </Field>
              <div style={{ marginTop: 12, marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#374151' }}>Per-line approval</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
                <thead style={{ background: '#f3f4f6' }}>
                  <tr>
                    <Th>Item</Th>
                    <Th style={{ textAlign: 'right' }}>Requested</Th>
                    <Th style={{ textAlign: 'right' }}>Approving</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <Td><div style={{ fontWeight: 500 }}>{it.item_name}</div>{it.kind ? <span style={{ fontSize: 10, color: '#6366f1' }}>[{it.kind}]</span> : null}</Td>
                      <Td style={{ textAlign: 'right' }}>{fmtNum(it.quantity_requested)} {it.unit_of_measure || ''}</Td>
                      <Td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.001"
                          value={lineApprovals[it.item_id] || '0'}
                          onChange={(e) => setLineApprovals({ ...lineApprovals, [it.item_id]: e.target.value })}
                          style={{ ...inputStyle, width: 100, textAlign: 'right' }}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div style={infoBox}>
              <strong>Subsequent-tier approval:</strong> you sign off on already-approved line quantities. To change quantities, reject and start over.
            </div>
          )}
          <Field label="Decision reason (optional, audit-logged)">
            <input value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} style={inputStyle} placeholder="e.g., reviewed and approved per protocol" />
          </Field>
          {err ? <ErrorBox msg={err} /> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setShowReject(true)} style={btnSecondary}>Reject instead…</button>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={approve} disabled={submitting || !sourceLocation.trim()} style={btnPrimary(submitting || !sourceLocation.trim())}>
              {submitting ? 'Approving…' : `Approve as ${APPROVER_LABELS[approval.approver_role]}`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function IssueAction({ user, indent, items, onChanged }: { user: User; indent: any; items: IndentItem[]; onChanged: () => void }) {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <button onClick={() => setShowModal(true)} style={btnPrimary(false)}>Issue stock</button>
      {showModal ? <IssueModal indent={indent} items={items} onClose={() => setShowModal(false)} onIssued={() => { setShowModal(false); onChanged(); }} /> : null}
    </>
  );
}

function IssueModal({ indent, items, onClose, onIssued }: { indent: any; items: IndentItem[]; onClose: () => void; onIssued: () => void }) {
  const [linesByItemId, setLinesByItemId] = useState<Record<string, { source_inventory_id: string; quantity_to_issue: string }>>(
    Object.fromEntries(items.map(it => [it.item_id, { source_inventory_id: '', quantity_to_issue: '' }]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const lines = Object.entries(linesByItemId)
        .filter(([_, v]) => v.source_inventory_id && Number(v.quantity_to_issue) > 0)
        .map(([item_id, v]) => ({
          item_id,
          source_inventory_id: v.source_inventory_id,
          quantity_to_issue: Number(v.quantity_to_issue),
        }));
      if (lines.length === 0) {
        setErr('At least one line with source_inventory_id + quantity is required');
        setSubmitting(false);
        return;
      }
      await trpcMutate('scm.indents.issue', { indent_id: indent.id, lines });
      onIssued();
    } catch (e: any) {
      setErr(e?.message || 'Issue failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Issue stock for ${indent.indent_number}`} onClose={onClose} wide>
      <div style={infoBox}>
        Pair-writes <code>transfer_out</code> at source + <code>transfer_in</code> at <code>{indent.destination_location}</code> with <code>quantity_in_transit</code> tracking the gap until acknowledge.
      </div>
      {items.filter(it => Number(it.quantity_approved || 0) > 0 && Number(it.quantity_issued || 0) < Number(it.quantity_approved || 0)).map(it => {
        const remaining = Number(it.quantity_approved || 0) - Number(it.quantity_issued || 0);
        const v = linesByItemId[it.item_id];
        return (
          <div key={it.id} style={{ padding: 10, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <strong>{it.item_name}</strong>
              <span style={{ color: '#6b7280', fontSize: 12 }}>approved {fmtNum(it.quantity_approved)} · issued {fmtNum(it.quantity_issued)} · remaining {fmtNum(remaining)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
              <Field label="Source inventory row UUID">
                <input value={v.source_inventory_id} onChange={(e) => setLinesByItemId({ ...linesByItemId, [it.item_id]: { ...v, source_inventory_id: e.target.value } })} style={inputStyle} placeholder="UUID of inventory row to draw from" />
              </Field>
              <Field label={`Qty (max ${remaining})`}>
                <input type="number" step="0.001" max={remaining} value={v.quantity_to_issue} onChange={(e) => setLinesByItemId({ ...linesByItemId, [it.item_id]: { ...v, quantity_to_issue: e.target.value } })} style={inputStyle} />
              </Field>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        Note: source_inventory_id is required because Phase 2 doesn't yet auto-pick batches. Phase 2.B will add a per-line batch picker (FEFO).
      </div>
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>{submitting ? 'Issuing…' : 'Confirm issue'}</button>
      </div>
    </Modal>
  );
}

function CancelAction({ indent, onChanged }: { indent: any; onChanged: () => void }) {
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.indents.cancel', { indent_id: indent.id, cancellation_reason: reason });
      onChanged();
    } catch (e: any) {
      setErr(e?.message || 'Cancel failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button onClick={() => setShowModal(true)} style={btnSecondary}>Cancel indent…</button>
      {showModal ? (
        <Modal title={`Cancel ${indent.indent_number}`} onClose={() => setShowModal(false)}>
          <Field label="Cancellation reason (required)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} /></Field>
          {err ? <ErrorBox msg={err} /> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setShowModal(false)} style={btnSecondary}>Back</button>
            <button onClick={submit} disabled={submitting || !reason.trim()} style={btnDanger(submitting || !reason.trim())}>{submitting ? 'Cancelling…' : 'Confirm cancel'}</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function CloseAction({ indent, onChanged }: { indent: any; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await trpcMutate('scm.indents.close', indent.id);
      onChanged();
    } catch (e: any) {
      alert(e?.message || 'Close failed');
    } finally {
      setBusy(false);
    }
  }
  return <button onClick={submit} disabled={busy} style={btnPrimary(busy)}>{busy ? 'Closing…' : 'Close indent'}</button>;
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</div>
      {children}
    </section>
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

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ padding: '2px 8px', background: `${color}22`, color, borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{label}</span>;
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
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, marginBottom: 12 };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' };
const btnSecondarySmall: React.CSSProperties = { padding: '4px 10px', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
const btnPrimary = (disabled: boolean): React.CSSProperties => ({ padding: '8px 16px', background: disabled ? '#93c5fd' : '#3b82f6', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' });
const btnDanger = (disabled: boolean): React.CSSProperties => ({ padding: '8px 16px', background: disabled ? '#fca5a5' : '#dc2626', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' });
