'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Alerts — Phase 1.5b
//
// Auto-reorder draft alerts page. Maps to all 3 scm.alerts.* procedures:
//   - checkLowStock (mutation): scans inventory, generates pending_review
//                                drafts for items below reorder_level
//                                (idempotent — skips inventory rows that
//                                already have a pending draft)
//   - list (query): pending alerts with item/vendor/quantity context
//   - resolve (mutation): mark draft as 'rejected' (acknowledged, no action)
//
// Architectural note: the legacy `stock_alerts` table was dropped in 0060.
// Canonical equivalent is `auto_reorder_drafts` — same intent, forward-
// compatible with Phase 2 auto-PR / auto-PO conversion. Status mapping:
//   legacy 'unresolved' → 'pending_review'
//   legacy 'resolved'   → 'rejected' (this page) or 'converted_to_pr/po' (Phase 2)
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface AlertRow {
  id: string;
  hospital_id: string;
  item_id: string;
  inventory_id: string;
  current_quantity: string | number;
  reorder_level: string | number;
  suggested_quantity: string | number;
  suggested_vendor_id: string | null;
  suggested_vendor_name: string | null;
  suggested_unit_cost: string | number | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  generated_at: string;
  expires_at: string | null;
  // joined
  item_name: string | null;
  generic_name: string | null;
  kind: string | null;
  location: string | null;
  batch_number: string | null;
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

function fmtNum(n: any): string {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return num.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function fmtCurrency(n: any): string {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtRel(d: string | null): string {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-IN');
}

// ============================================================

export default function ScmAlertsClient({ user }: { user: User }) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ drafts_created: number; low_stock_inventory_rows: number } | null>(null);
  const [resolveFor, setResolveFor] = useState<AlertRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery('scm.alerts.list', { only_unreviewed: true, limit: 200 });
      setAlerts(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runScan() {
    setScanning(true);
    setScanResult(null);
    setError(null);
    try {
      const result = await trpcMutate('scm.alerts.checkLowStock');
      setScanResult(result);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  // KPIs
  const totalSuggestedValue = alerts.reduce(
    (s, a) => s + Number(a.suggested_quantity || 0) * Number(a.suggested_unit_cost || 0),
    0,
  );

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Alerts</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>🔔 Auto-reorder alerts</h1>
        <button onClick={runScan} disabled={scanning} style={btnPrimary(scanning)}>
          {scanning ? 'Scanning…' : 'Run low-stock scan'}
        </button>
      </div>

      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Scans every active inventory row and generates a <code>pending_review</code> draft when{' '}
        <code>quantity_on_hand ≤ COALESCE(inv.reorder_level, items.default_reorder_level, 0)</code>.
        Idempotent — only one pending draft per (hospital, inventory_row).
        Phase 2 adds <code>convertToPR</code> / <code>convertToPO</code> actions; for now resolve = acknowledge without action.
      </p>

      {/* ─── KPI strip ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Pending alerts" value={fmtNum(alerts.length)} color={alerts.length > 0 ? '#ef4444' : '#10b981'} />
        <Kpi label="Suggested order value" value={fmtCurrency(totalSuggestedValue)} color="#10b981" />
      </div>

      {/* ─── Scan result ────────────── */}
      {scanResult ? (
        <div style={{ padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, color: '#065f46', marginBottom: 16, fontSize: 13 }}>
          <strong>Scan complete:</strong> {scanResult.drafts_created} new draft{scanResult.drafts_created === 1 ? '' : 's'} created
          (out of {scanResult.low_stock_inventory_rows} inventory row{scanResult.low_stock_inventory_rows === 1 ? '' : 's'} below reorder level).
          {scanResult.low_stock_inventory_rows > scanResult.drafts_created ? (
            <span style={{ marginLeft: 8, color: '#9ca3af' }}>
              ({scanResult.low_stock_inventory_rows - scanResult.drafts_created} already had a pending draft.)
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      ) : null}

      {/* ─── Alerts table ────────────── */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>Item</Th>
              <Th>Location</Th>
              <Th style={{ textAlign: 'right' }}>On hand</Th>
              <Th style={{ textAlign: 'right' }}>Reorder lvl</Th>
              <Th style={{ textAlign: 'right' }}>Suggested qty</Th>
              <Th>Suggested vendor</Th>
              <Th style={{ textAlign: 'right' }}>Est. cost</Th>
              <Th>Generated</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td></tr>
            ) : alerts.length === 0 ? (
              <tr>
                <Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  No pending alerts. Run a scan to generate drafts for items below reorder level.
                </Td>
              </tr>
            ) : (
              alerts.map((a) => {
                const estCost = Number(a.suggested_quantity || 0) * Number(a.suggested_unit_cost || 0);
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{a.item_name || '—'}</div>
                      {a.generic_name ? <div style={{ fontSize: 11, color: '#9ca3af' }}>{a.generic_name}</div> : null}
                      {a.kind ? <div style={{ fontSize: 10, color: '#6366f1', marginTop: 2 }}>[{a.kind}]</div> : null}
                    </Td>
                    <Td>
                      <code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{a.location || '—'}</code>
                      {a.batch_number ? <div style={{ fontSize: 11, color: '#9ca3af' }}>batch {a.batch_number}</div> : null}
                    </Td>
                    <Td style={{ textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>{fmtNum(a.current_quantity)}</Td>
                    <Td style={{ textAlign: 'right', color: '#6b7280' }}>{fmtNum(a.reorder_level)}</Td>
                    <Td style={{ textAlign: 'right', fontWeight: 500, color: '#10b981' }}>{fmtNum(a.suggested_quantity)}</Td>
                    <Td>{a.suggested_vendor_name || <span style={{ color: '#9ca3af' }}>—</span>}</Td>
                    <Td style={{ textAlign: 'right' }}>{estCost > 0 ? fmtCurrency(estCost) : '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{fmtRel(a.generated_at)}</Td>
                    <Td>
                      <button onClick={() => setResolveFor(a)} style={btnSecondarySmall}>Resolve</button>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
        Showing {alerts.length} pending alert{alerts.length === 1 ? '' : 's'}
      </div>

      {/* ─── Phase 2 hint ────────────── */}
      <div style={{ marginTop: 24, padding: 16, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
        <strong>Phase 2 — auto-PR / auto-PO conversion:</strong> the <code>auto_reorder_drafts</code> table already supports{' '}
        <code>'converted_to_pr'</code> and <code>'converted_to_po'</code> statuses. Procedures to convert a draft into a PR (purchase requisition for KPMG SoD)
        or directly into a PO will land in Phase 2 once the PR router exposes its create flow.
      </div>

      {resolveFor ? (
        <ResolveModal
          alert={resolveFor}
          onClose={() => setResolveFor(null)}
          onResolved={() => {
            setResolveFor(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Modal ──────────────────────────────────────────────

function ResolveModal({ alert, onClose, onResolved }: { alert: AlertRow; onClose: () => void; onResolved: () => void }) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.alerts.resolve', { id: alert.id, notes: notes || undefined });
      onResolved();
    } catch (e: any) {
      setErr(e?.message || 'Resolve failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Resolve alert: ${alert.item_name || 'item'}`} onClose={onClose}>
      <div style={infoBox}>
        <div><strong>Item:</strong> {alert.item_name || '—'}</div>
        <div><strong>Location:</strong> <code>{alert.location || '—'}</code></div>
        <div><strong>Current on hand:</strong> {fmtNum(alert.current_quantity)} (reorder level {fmtNum(alert.reorder_level)})</div>
        <div><strong>Suggested:</strong> order {fmtNum(alert.suggested_quantity)} from {alert.suggested_vendor_name || 'no preferred vendor'}</div>
      </div>

      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 12 }}>
        Resolving sets the draft's status to <code>'rejected'</code> with your review notes — meaning <strong>acknowledged without action</strong>.
        Use this when you decide NOT to reorder right now (item being phased out, alternate sourcing, etc.). To actually order, wait for the
        Phase 2 convertToPR / convertToPO actions or create a PO manually from <Link href="/admin/scm/purchase-orders" style={{ color: '#3b82f6' }}>Purchase Orders</Link>.
      </p>

      <Field label="Resolution notes (optional but recommended for audit)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, minHeight: 80 }}
          placeholder="Why was this resolved without action? (e.g., 'item being phased out', 'sourced from alternate vendor', 'one-time stockout, no replenishment needed')"
        />
      </Field>

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>
          {submitting ? 'Resolving…' : 'Confirm resolution'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Atoms ──────────────────────────────────────────────

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
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 };
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
