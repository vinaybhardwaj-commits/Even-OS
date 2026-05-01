'use client';

import { useCallback, useEffect, useState } from 'react';

// ============================================================
// /care/indent — caregiver indent raise + my-list + acknowledge
//
// Phase 2.4. Tabs:
//   1. My indents (list of indents I raised; status timeline + acknowledge)
//   2. New indent (raise form)
//
// Per Q-A2 the destination is required at create time; source_location is
// assigned by SCM at approve time. Per Q-A7 mixed-kind allowed.
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
  reason: string | null;
  created_at: string;
  approved_at: string | null;
  issued_at: string | null;
  acknowledged_at: string | null;
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

interface ItemOption {
  id: string;
  code: string;
  display_name: string;
  kind: string;
  unit_of_measure: string;
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
function fmtNum(n: any): string {
  const num = Number(n);
  return Number.isNaN(num) ? '—' : num.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

// ============================================================

export default function CareIndentClient({ user }: { user: User }) {
  type Tab = 'mine' | 'new';
  const [tab, setTab] = useState<Tab>('mine');

  return (
    <div style={{ padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>📥 Indents</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
        Raise an indent for items your department needs from pharmacy / store / CSSD / lab. Track status here and acknowledge receipt when stock arrives.
      </p>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>My indents</TabButton>
        <TabButton active={tab === 'new'} onClick={() => setTab('new')}>+ Raise new indent</TabButton>
      </div>

      {tab === 'mine' ? <MyIndentsTab user={user} /> : <NewIndentTab user={user} onCreated={() => setTab('mine')} />}
    </div>
  );
}

// ─── My indents tab ────────────────────────────────────

function MyIndentsTab({ user }: { user: User }) {
  const [rows, setRows] = useState<IndentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillFor, setDrillFor] = useState<IndentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery('scm.indents.list', { raised_by: user.sub, limit: 200 });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [user.sub]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={load} style={btnSecondarySmall}>Refresh</button>
      </div>
      {error ? <ErrorBox msg={error} /> : null}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', background: '#fafafa', border: '1px dashed #e5e7eb', borderRadius: 8 }}>
          You haven't raised any indents yet. Use the "+ Raise new indent" tab.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(r => (
            <div key={r.id} onClick={() => setDrillFor(r)} style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <code style={{ fontSize: 13, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{r.indent_number}</code>
                <Pill label={r.state.replace(/_/g, ' ')} color={STATE_COLORS[r.state] || '#6b7280'} />
              </div>
              <div style={{ fontSize: 13, color: '#374151' }}>
                {r.priority} · destination <code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{r.destination_location}</code>
              </div>
              {r.reason ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>{r.reason}</div> : null}
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>raised {fmtDateTime(r.created_at)}</div>
            </div>
          ))}
        </div>
      )}
      {drillFor ? <IndentDetailModal user={user} indent={drillFor} onClose={() => setDrillFor(null)} onChanged={load} /> : null}
    </div>
  );
}

function IndentDetailModal({ user, indent, onClose, onChanged }: { user: User; indent: IndentRow; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAck, setShowAck] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await trpcQuery('scm.indents.detail', indent.id);
      setDetail(d);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [indent.id]);

  useEffect(() => { load(); }, [load]);

  if (loading || !detail) {
    return (
      <Modal title={`Indent ${indent.indent_number}`} onClose={onClose}>
        <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>{err || 'Loading…'}</div>
      </Modal>
    );
  }

  const items = detail.items as IndentItem[];
  const stateLog = detail.state_log as Array<{ from_state: string | null; to_state: string; transitioned_at: string; reason: string | null; actor_name: string | null }>;
  const canAcknowledge = detail.state === 'in_transit' && detail.raised_by === user.sub;

  return (
    <Modal title={`Indent ${detail.indent_number}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 16 }}>
        <div><strong>State:</strong> <Pill label={detail.state.replace(/_/g, ' ')} color={STATE_COLORS[detail.state] || '#6b7280'} /></div>
        <div><strong>Priority:</strong> {detail.priority}</div>
        <div><strong>Destination:</strong> <code>{detail.destination_location}</code></div>
        <div><strong>Source:</strong> <code>{detail.source_location}</code></div>
        {detail.reason ? <div style={{ gridColumn: 'span 2' }}><strong>Reason:</strong> {detail.reason}</div> : null}
        <div><strong>Raised:</strong> {fmtDateTime(detail.created_at)}</div>
        <div><strong>SLA due:</strong> {fmtDateTime(detail.sla_due_at)}</div>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Line items</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
        <thead style={{ background: '#f3f4f6' }}>
          <tr><Th>Item</Th><Th style={{ textAlign: 'right' }}>Requested</Th><Th style={{ textAlign: 'right' }}>Approved</Th><Th style={{ textAlign: 'right' }}>Issued</Th><Th style={{ textAlign: 'right' }}>Received</Th></tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <Td>{it.item_name}</Td>
              <Td style={{ textAlign: 'right' }}>{fmtNum(it.quantity_requested)} {it.unit_of_measure || ''}</Td>
              <Td style={{ textAlign: 'right' }}>{fmtNum(it.quantity_approved)}</Td>
              <Td style={{ textAlign: 'right', color: '#3b82f6' }}>{fmtNum(it.quantity_issued)}</Td>
              <Td style={{ textAlign: 'right', color: '#10b981' }}>{fmtNum(it.quantity_acknowledged)}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Status timeline</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12, marginBottom: 16 }}>
        {stateLog.map((s, i) => (
          <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
            <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{s.from_state || '∅'} → {s.to_state}</code>
            <span style={{ marginLeft: 8, color: '#6b7280' }}>{s.actor_name || '—'} · {fmtDateTime(s.transitioned_at)}</span>
            {s.reason ? <div style={{ fontSize: 11, color: '#9ca3af', marginLeft: 16, marginTop: 2 }}>"{s.reason}"</div> : null}
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        {canAcknowledge ? <button onClick={() => setShowAck(true)} style={btnPrimary(false)}>Acknowledge receipt</button> : null}
        <button onClick={onClose} style={btnSecondary}>Close</button>
      </div>

      {showAck ? <AcknowledgeModal indent={detail} items={items} onClose={() => setShowAck(false)} onAcknowledged={() => { setShowAck(false); load(); onChanged(); }} /> : null}
    </Modal>
  );
}

function AcknowledgeModal({ indent, items, onClose, onAcknowledged }: { indent: any; items: IndentItem[]; onClose: () => void; onAcknowledged: () => void }) {
  const [linesByItemId, setLinesByItemId] = useState<Record<string, string>>(
    Object.fromEntries(items
      .filter(it => Number(it.quantity_issued || 0) > Number(it.quantity_acknowledged || 0))
      .map(it => [it.item_id, String(Number(it.quantity_issued) - Number(it.quantity_acknowledged))])
    )
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const lines = Object.entries(linesByItemId)
        .filter(([_, qty]) => Number(qty) > 0)
        .map(([item_id, qty]) => ({ item_id, quantity_to_acknowledge: Number(qty) }));
      if (lines.length === 0) {
        setErr('Confirm at least one line received');
        setSubmitting(false);
        return;
      }
      await trpcMutate('scm.indents.acknowledge', { indent_id: indent.id, lines });
      onAcknowledged();
    } catch (e: any) {
      setErr(e?.message || 'Acknowledge failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Acknowledge receipt — ${indent.indent_number}`} onClose={onClose}>
      <div style={infoBox}>Confirms that stock has arrived at <code>{indent.destination_location}</code>. Flips quantity_in_transit → quantity_on_hand at your location.</div>
      {items.filter(it => Number(it.quantity_issued || 0) > Number(it.quantity_acknowledged || 0)).map(it => {
        const remaining = Number(it.quantity_issued) - Number(it.quantity_acknowledged);
        return (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{it.item_name}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>issued {fmtNum(it.quantity_issued)} · already acked {fmtNum(it.quantity_acknowledged)} · {fmtNum(remaining)} pending receipt</div>
            </div>
            <input
              type="number"
              step="0.001"
              max={remaining}
              value={linesByItemId[it.item_id] || ''}
              onChange={(e) => setLinesByItemId({ ...linesByItemId, [it.item_id]: e.target.value })}
              style={{ ...inputStyle, width: 100, textAlign: 'right' }}
            />
          </div>
        );
      })}
      {err ? <ErrorBox msg={err} /> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>{submitting ? 'Acknowledging…' : 'Confirm receipt'}</button>
      </div>
    </Modal>
  );
}

// ─── New indent tab ────────────────────────────────────

function NewIndentTab({ user, onCreated }: { user: User; onCreated: () => void }) {
  const [destination, setDestination] = useState(user.department || 'ward_3');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat' | 'emergency'>('routine');
  const [classification, setClassification] = useState<'standard' | 'emergency' | 'vital'>('standard');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemOption[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [lines, setLines] = useState<Array<{ item_id: string; quantity_requested: string; notes: string }>>([
    { item_id: '', quantity_requested: '', notes: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await trpcQuery('scm.items.list', { status: 'active', limit: 500, include_network: true });
        setItems(Array.isArray(data) ? data : []);
      } catch {
        // non-fatal
      } finally {
        setItemsLoading(false);
      }
    })();
  }, []);

  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) {
    const next = [...lines];
    next[i] = { ...next[i], ...patch };
    setLines(next);
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const cleanLines = lines
        .filter(l => l.item_id && Number(l.quantity_requested) > 0)
        .map(l => ({
          item_id: l.item_id,
          quantity_requested: Number(l.quantity_requested),
          notes: l.notes || undefined,
        }));
      if (cleanLines.length === 0) {
        setErr('At least one line item is required');
        setSubmitting(false);
        return;
      }
      await trpcMutate('scm.indents.create', {
        destination_location: destination.trim(),
        priority,
        material_classification: classification,
        reason: reason || undefined,
        notes: notes || undefined,
        items: cleanLines,
      });
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Field label="Destination location (where stock should land)">
          <input value={destination} onChange={(e) => setDestination(e.target.value)} style={inputStyle} placeholder="ward_3 / icu_stock / ot_stock / lab_cold_storage" />
        </Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={inputStyle}>
            <option value="routine">Routine (24h SLA)</option>
            <option value="urgent">Urgent (4h SLA)</option>
            <option value="stat">Stat (1h SLA)</option>
            <option value="emergency">Emergency (30 min SLA)</option>
          </select>
        </Field>
        <Field label="Material classification">
          <select value={classification} onChange={(e) => setClassification(e.target.value as any)} style={inputStyle}>
            <option value="standard">Standard (relaxed SLA × 2.0)</option>
            <option value="emergency">Emergency item (× 1.0)</option>
            <option value="vital">Vital (tightened × 0.5)</option>
          </select>
        </Field>
        <Field label="Reason (optional)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} placeholder="e.g., ward stock replenishment" />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 50 }} />
      </Field>

      <div style={{ marginTop: 16, marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Line items</div>
      {lines.map((l, i) => (
        <div key={i} style={{ padding: 10, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 200px', gap: 8 }}>
            <Field label="Item">
              <select value={l.item_id} onChange={(e) => updateLine(i, { item_id: e.target.value })} style={inputStyle}>
                <option value="">{itemsLoading ? 'Loading items…' : '— select active item —'}</option>
                {items.map(it => <option key={it.id} value={it.id}>[{it.kind}] {it.code} — {it.display_name} ({it.unit_of_measure})</option>)}
              </select>
            </Field>
            <Field label="Quantity">
              <input type="number" step="0.001" value={l.quantity_requested} onChange={(e) => updateLine(i, { quantity_requested: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Line note (optional)">
              <input value={l.notes} onChange={(e) => updateLine(i, { notes: e.target.value })} style={inputStyle} />
            </Field>
          </div>
          {lines.length > 1 ? (
            <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} style={{ ...btnSecondarySmall, marginTop: 6, color: '#991b1b' }}>Remove line</button>
          ) : null}
        </div>
      ))}
      <button onClick={() => setLines([...lines, { item_id: '', quantity_requested: '', notes: '' }])} style={btnSecondary}>+ Add another line</button>

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>
          {submitting ? 'Raising…' : 'Raise indent'}
        </button>
      </div>
    </div>
  );
}

// ─── Atoms (shared with admin) ──────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${active ? '#3b82f6' : 'transparent'}`, color: active ? '#1e40af' : '#6b7280', fontSize: 14, fontWeight: active ? 600 : 500, cursor: 'pointer' }}>{children}</button>
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
function Pill({ label, color }: { label: string; color: string }) { return <span style={{ padding: '2px 8px', background: `${color}22`, color, borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{label}</span>; }
function ErrorBox({ msg }: { msg: string }) { return <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>{msg}</div>; }
function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) { return <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase', ...style }}>{children}</th>; }
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) { return <td style={{ padding: '6px 10px', verticalAlign: 'middle', ...style }}>{children}</td>; }
const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, marginBottom: 12 };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' };
const btnSecondarySmall: React.CSSProperties = { padding: '4px 10px', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
const btnPrimary = (disabled: boolean): React.CSSProperties => ({ padding: '8px 16px', background: disabled ? '#93c5fd' : '#3b82f6', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' });
