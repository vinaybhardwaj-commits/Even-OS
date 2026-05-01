'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// /care/pharmacy/indents — Phase 2.5 (Q-A5 Path A: SCM owns the page)
//
// Pharmacy fulfilment view. Filters by source_location ∈ pharmacy
// locations (default 'main_pharmacy', but parameterizable). Shows
// approved indents queued for issue + in_transit indents that pharmacy
// has already issued (waiting on raiser to acknowledge).
//
// Pharmacy v2 Phase 1 just deep-links here. Same code can serve OT /
// HK / Lab consumer views by parameterizing source_location.
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
  department?: string;
}

interface IndentRow {
  id: string;
  indent_number: string;
  state: string;
  priority: string;
  source_location: string;
  destination_location: string;
  raised_by_name: string | null;
  reason: string | null;
  sla_due_at: string | null;
  approved_at: string | null;
  issued_at: string | null;
  created_at: string;
}

interface IndentItem {
  id: string;
  item_id: string;
  item_name: string;
  kind: string | null;
  unit_of_measure: string | null;
  quantity_requested: string | number;
  quantity_approved: string | number | null;
  quantity_issued: string | number;
  quantity_acknowledged: string | number;
}

const STATE_COLORS: Record<string, string> = {
  pending: '#f59e0b', approved: '#3b82f6', issued: '#8b5cf6', in_transit: '#06b6d4',
  received: '#10b981', closed: '#6b7280', rejected: '#ef4444', cancelled: '#9ca3af',
};
const PRIORITY_COLORS: Record<string, string> = { emergency: '#dc2626', stat: '#ef4444', urgent: '#f59e0b', routine: '#6b7280' };

async function trpcQuery(path: string, input?: any) {
  const params = `?input=${encodeURIComponent(JSON.stringify(input !== undefined ? { json: input } : { json: {} }))}`;
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
function fmtDateTime(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }); } catch { return d; }
}
function fmtNum(n: any): string { const num = Number(n); return Number.isNaN(num) ? '—' : num.toLocaleString('en-IN', { maximumFractionDigits: 3 }); }

const PHARMACY_LOCATIONS = ['main_pharmacy', 'satellite_pharmacy_a', 'satellite_pharmacy_b'];

// ============================================================

export default function PharmacyIndentsClient({ user }: { user: User }) {
  const [sourceLocation, setSourceLocation] = useState<string>('main_pharmacy');
  const [rows, setRows] = useState<IndentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issueFor, setIssueFor] = useState<IndentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Show approved + issued + in_transit indents fulfilled FROM this location
      const data = await trpcQuery('scm.indents.list', {
        source_location: sourceLocation,
        limit: 200,
      });
      const filtered = (Array.isArray(data) ? data : []).filter((r: IndentRow) =>
        ['approved', 'issued', 'in_transit'].includes(r.state)
      );
      setRows(filtered);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [sourceLocation]);

  useEffect(() => { load(); }, [load]);

  const approvedQueue = rows.filter(r => r.state === 'approved');
  const inFlight = rows.filter(r => ['issued', 'in_transit'].includes(r.state));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/care/pharmacy" style={{ color: '#3b82f6', textDecoration: 'none' }}>Pharmacy</Link>
        <span>›</span>
        <span>Indents</span>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>💊 Pharmacy indents queue</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
        Approved indents waiting for stock issue from <code>{sourceLocation}</code>. Pick a batch + qty per line, confirm issue.
        Phase 2.B will add an FEFO-aware batch picker; today you paste the source inventory UUID.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)} style={{ ...inputStyle, width: 240 }}>
          {PHARMACY_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={load} style={{ ...btnSecondary, marginLeft: 'auto' }}>Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Approved (waiting issue)" value={approvedQueue.length} color={approvedQueue.length > 0 ? '#3b82f6' : '#10b981'} />
        <Kpi label="In flight (issued + in transit)" value={inFlight.length} color="#06b6d4" />
      </div>

      {error ? <ErrorBox msg={error} /> : null}

      <Section title={`Approved — pending issue (${approvedQueue.length})`}>
        {loading ? <div style={{ color: '#6b7280' }}>Loading…</div> : approvedQueue.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', background: '#f0fdf4', border: '1px dashed #86efac', borderRadius: 6 }}>
            ✓ No approved indents pending issue from {sourceLocation}.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {approvedQueue.map(r => <IndentCard key={r.id} indent={r} actionLabel="Issue stock" onAction={() => setIssueFor(r)} />)}
          </div>
        )}
      </Section>

      <Section title={`In flight (${inFlight.length}) — already issued from this location`}>
        {inFlight.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>—</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {inFlight.map(r => <IndentCard key={r.id} indent={r} actionLabel="View" onAction={() => setIssueFor(r)} dimmed />)}
          </div>
        )}
      </Section>

      {issueFor ? <PharmacyIssueModal user={user} indent={issueFor} onClose={() => setIssueFor(null)} onChanged={load} /> : null}
    </div>
  );
}

function IndentCard({ indent, actionLabel, onAction, dimmed }: { indent: IndentRow; actionLabel: string; onAction: () => void; dimmed?: boolean }) {
  return (
    <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, opacity: dimmed ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div>
          <code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{indent.indent_number}</code>
          <span style={{ marginLeft: 8 }}><Pill label={indent.state.replace(/_/g, ' ')} color={STATE_COLORS[indent.state] || '#6b7280'} /></span>
          <span style={{ marginLeft: 4 }}><Pill label={indent.priority} color={PRIORITY_COLORS[indent.priority] || '#6b7280'} /></span>
        </div>
        <button onClick={onAction} style={btnPrimary(false)}>{actionLabel}</button>
      </div>
      <div style={{ fontSize: 13, color: '#374151' }}>
        → <code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{indent.destination_location}</code>
        <span style={{ marginLeft: 8, color: '#6b7280' }}>raised by {indent.raised_by_name || '—'}</span>
      </div>
      {indent.reason ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>{indent.reason}</div> : null}
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        approved {fmtDateTime(indent.approved_at)} · SLA {fmtDateTime(indent.sla_due_at)}
      </div>
    </div>
  );
}

function PharmacyIssueModal({ user, indent: initial, onClose, onChanged }: { user: User; indent: IndentRow; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<IndentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [linesByItemId, setLinesByItemId] = useState<Record<string, { source_inventory_id: string; quantity_to_issue: string }>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await trpcQuery('scm.indents.listItems', initial.id);
        const arr: IndentItem[] = Array.isArray(data) ? data : [];
        setItems(arr);
        setLinesByItemId(Object.fromEntries(
          arr.filter(it => Number(it.quantity_approved || 0) > Number(it.quantity_issued || 0))
            .map(it => [it.item_id, {
              source_inventory_id: '',
              quantity_to_issue: String(Number(it.quantity_approved || 0) - Number(it.quantity_issued || 0)),
            }])
        ));
      } catch (e: any) {
        setErr(e?.message || 'Failed to load line items');
      } finally {
        setLoading(false);
      }
    })();
  }, [initial.id]);

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
      await trpcMutate('scm.indents.issue', { indent_id: initial.id, lines });
      onChanged();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Issue failed');
    } finally {
      setSubmitting(false);
    }
  }

  const isReadOnly = ['issued', 'in_transit'].includes(initial.state);

  return (
    <Modal title={`Issue: ${initial.indent_number}`} onClose={onClose} wide>
      <div style={infoBox}>
        Source: <code>{initial.source_location}</code> → Destination: <code>{initial.destination_location}</code>.
        {' '}Pair-writes <code>transfer_out</code> + <code>transfer_in</code> with <code>quantity_in_transit</code> tracking the gap until the destination acknowledges.
      </div>
      {loading ? <div style={{ padding: 16, color: '#6b7280' }}>Loading line items…</div> : items.map(it => {
        const remaining = Number(it.quantity_approved || 0) - Number(it.quantity_issued || 0);
        const v = linesByItemId[it.item_id];
        if (remaining <= 0) {
          return (
            <div key={it.id} style={{ padding: 8, marginBottom: 6, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 12 }}>
              <strong>{it.item_name}</strong> — fully issued ({fmtNum(it.quantity_issued)}/{fmtNum(it.quantity_approved)})
            </div>
          );
        }
        return (
          <div key={it.id} style={{ padding: 10, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <strong>{it.item_name}</strong>
              <span style={{ color: '#6b7280', fontSize: 12 }}>approved {fmtNum(it.quantity_approved)} · issued {fmtNum(it.quantity_issued)} · remaining <strong>{fmtNum(remaining)}</strong></span>
            </div>
            {!isReadOnly && v ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
                <Field label="Source inventory row UUID">
                  <input
                    value={v.source_inventory_id}
                    onChange={(e) => setLinesByItemId({ ...linesByItemId, [it.item_id]: { ...v, source_inventory_id: e.target.value } })}
                    style={inputStyle}
                    placeholder="UUID — copy from /admin/scm/inventory"
                  />
                </Field>
                <Field label={`Qty (max ${remaining})`}>
                  <input
                    type="number"
                    step="0.001"
                    max={remaining}
                    value={v.quantity_to_issue}
                    onChange={(e) => setLinesByItemId({ ...linesByItemId, [it.item_id]: { ...v, quantity_to_issue: e.target.value } })}
                    style={inputStyle}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        );
      })}
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Close</button>
        {!isReadOnly ? (
          <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>{submitting ? 'Issuing…' : 'Confirm issue'}</button>
        ) : null}
      </div>
    </Modal>
  );
}

// ─── Atoms ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}
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
function Kpi({ label, value, color }: { label: string; value: number; color: string }) { return <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}><div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div><div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div></div>; }
function Pill({ label, color }: { label: string; color: string }) { return <span style={{ padding: '2px 8px', background: `${color}22`, color, borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{label}</span>; }
function ErrorBox({ msg }: { msg: string }) { return <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>{msg}</div>; }
const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, marginBottom: 12 };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' };
const btnPrimary = (disabled: boolean): React.CSSProperties => ({ padding: '8px 16px', background: disabled ? '#93c5fd' : '#3b82f6', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' });
