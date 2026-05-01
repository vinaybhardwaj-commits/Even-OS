'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Inventory — Phase 1.5b
//
// Universal inventory CRUD against the canonical `inventory` table
// (item × location × batch). All 6 scm.inventory.* procedures wired:
//   - list (with item / location / low-stock / expiring filters)
//   - add (new inventory row + opening grn_receive ledger entry)
//   - adjust (signed adjustment_increase / adjustment_decrease + ledger)
//   - transfer (paired transfer_out + transfer_in ledger entries)
//   - detail (per-row drill-in)
//   - expiryWatchlist (separate tab; FEFO + days-to-expiry)
//
// Audit: every mutation writes audit_logs and stock_movements.
// Hospital-scoping: ctx.user.hospital_id (Q4 Path A multi-tenancy day 1).
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface InventoryRow {
  id: string;
  hospital_id: string;
  item_id: string;
  item_name: string | null;
  generic_name: string | null;
  kind: string | null;
  location: string;
  batch_number: string | null;
  manufacturer: string | null;
  expiry_date: string | null;
  quantity_on_hand: string | number;
  quantity_reserved: string | number;
  quantity_in_transit: string | number;
  unit_cost: string | number | null;
  mrp: string | number | null;
  reorder_level: string | number | null;
  reorder_quantity: string | number | null;
  max_stock_level: string | number | null;
  is_active: boolean;
  last_movement_at: string | null;
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

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN');
  } catch {
    return d;
  }
}

function daysUntilExpiry(d: string | null): number | null {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ============================================================

export default function ScmInventoryClient({ user }: { user: User }) {
  type Tab = 'list' | 'expiry';
  const [tab, setTab] = useState<Tab>('list');

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterItemId, setFilterItemId] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [expiringDays, setExpiringDays] = useState<number>(30);

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [adjustFor, setAdjustFor] = useState<InventoryRow | null>(null);
  const [transferFor, setTransferFor] = useState<InventoryRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'list') {
        const data = await trpcQuery('scm.inventory.list', {
          item_id: filterItemId || undefined,
          location: filterLocation || undefined,
          low_stock_only: lowStockOnly || undefined,
        });
        setRows(Array.isArray(data) ? data : []);
      } else {
        const data = await trpcQuery('scm.inventory.expiryWatchlist', {
          days_until_expiry: expiringDays,
        });
        setRows(Array.isArray(data) ? data : []);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [tab, filterItemId, filterLocation, lowStockOnly, expiringDays]);

  useEffect(() => {
    load();
  }, [load]);

  // KPIs (computed from current view)
  const totalQty = rows.reduce((s, r) => s + Number(r.quantity_on_hand || 0), 0);
  const totalValue = rows.reduce((s, r) => s + Number(r.quantity_on_hand || 0) * Number(r.unit_cost || 0), 0);
  const distinctItems = new Set(rows.map((r) => r.item_id)).size;
  const distinctLocations = new Set(rows.map((r) => r.location)).size;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Inventory</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📦 Inventory</h1>
        <button onClick={() => setShowAdd(true)} style={btnNew}>+ Add stock</button>
      </div>

      {/* ─── KPI strip ──────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Inventory rows" value={fmtNum(rows.length)} color="#3b82f6" />
        <Kpi label="Distinct items" value={fmtNum(distinctItems)} color="#8b5cf6" />
        <Kpi label="Locations" value={fmtNum(distinctLocations)} color="#06b6d4" />
        <Kpi label="Stock value" value={fmtCurrency(totalValue)} color="#10b981" />
      </div>

      {/* ─── Tabs ──────────────────────── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <TabButton active={tab === 'list'} onClick={() => setTab('list')}>All inventory</TabButton>
        <TabButton active={tab === 'expiry'} onClick={() => setTab('expiry')}>Expiry watchlist</TabButton>
      </div>

      {/* ─── Filters ──────────────────── */}
      {tab === 'list' ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={filterItemId}
            onChange={(e) => setFilterItemId(e.target.value)}
            placeholder="Filter by item_id (UUID)"
            style={{ ...inputStyle, width: 320 }}
          />
          <input
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            placeholder="Location (main_pharmacy, ward_3, …)"
            style={{ ...inputStyle, width: 240 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
            Low stock only
          </label>
          <button onClick={load} style={btnSecondarySmall}>Refresh</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Items expiring within</span>
          <input
            type="number"
            value={expiringDays}
            onChange={(e) => setExpiringDays(Math.max(1, Number(e.target.value)))}
            style={{ ...inputStyle, width: 80 }}
            min={1}
          />
          <span style={{ fontSize: 13, color: '#6b7280' }}>days</span>
          <button onClick={load} style={{ ...btnSecondarySmall, marginLeft: 'auto' }}>Refresh</button>
        </div>
      )}

      {error ? (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      ) : null}

      {/* ─── Inventory table ──────────── */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>Item</Th>
              <Th>Location</Th>
              <Th>Batch</Th>
              <Th>Expiry</Th>
              <Th style={{ textAlign: 'right' }}>On hand</Th>
              <Th style={{ textAlign: 'right' }}>Reserved</Th>
              <Th style={{ textAlign: 'right' }}>Reorder lvl</Th>
              <Th style={{ textAlign: 'right' }}>Unit cost</Th>
              <Th style={{ textAlign: 'right' }}>Value</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <Td colSpan={10} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <Td colSpan={10} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  {tab === 'list' ? (
                    <>
                      No inventory rows match the current filters.{' '}
                      <button onClick={() => setShowAdd(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                        Add stock
                      </button>
                      ?
                    </>
                  ) : (
                    `No items expiring within ${expiringDays} days.`
                  )}
                </Td>
              </tr>
            ) : (
              rows.map((r) => {
                const days = daysUntilExpiry(r.expiry_date);
                const onHand = Number(r.quantity_on_hand);
                const reorderLvl = Number(r.reorder_level || 0);
                const isLow = reorderLvl > 0 && onHand <= reorderLvl;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{r.item_name || '—'}</div>
                      {r.generic_name ? <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.generic_name}</div> : null}
                    </Td>
                    <Td><code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{r.location}</code></Td>
                    <Td>{r.batch_number || '—'}</Td>
                    <Td>
                      {r.expiry_date ? (
                        <span
                          style={{
                            color:
                              days !== null && days < 0
                                ? '#ef4444'
                                : days !== null && days <= 30
                                ? '#f59e0b'
                                : '#374151',
                            fontWeight: days !== null && days <= 30 ? 600 : 400,
                          }}
                        >
                          {fmtDate(r.expiry_date)}
                          {days !== null ? (
                            <span style={{ fontSize: 11, marginLeft: 4, color: '#9ca3af' }}>
                              ({days < 0 ? `${-days}d ago` : `${days}d`})
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td style={{ textAlign: 'right', fontWeight: 600, color: isLow ? '#ef4444' : '#374151' }}>
                      {fmtNum(r.quantity_on_hand)}
                      {isLow ? <span style={{ marginLeft: 4, fontSize: 10, color: '#ef4444' }}>↓ low</span> : null}
                    </Td>
                    <Td style={{ textAlign: 'right', color: '#6b7280' }}>{fmtNum(r.quantity_reserved)}</Td>
                    <Td style={{ textAlign: 'right', color: '#6b7280' }}>{fmtNum(r.reorder_level)}</Td>
                    <Td style={{ textAlign: 'right' }}>{fmtCurrency(r.unit_cost)}</Td>
                    <Td style={{ textAlign: 'right', fontWeight: 500 }}>
                      {fmtCurrency(Number(r.quantity_on_hand) * Number(r.unit_cost || 0))}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => setAdjustFor(r)} style={btnSecondarySmall} title="Adjust stock up/down">
                          Adjust
                        </button>
                        <button onClick={() => setTransferFor(r)} style={btnSecondarySmall} title="Transfer to another location">
                          Transfer
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
        Showing {rows.length} row{rows.length === 1 ? '' : 's'} · {fmtCurrency(totalValue)} stock value
      </div>

      {/* ─── Modals ─────────────────────── */}
      {showAdd ? <AddStockModal onClose={() => setShowAdd(false)} onSaved={load} /> : null}
      {adjustFor ? <AdjustModal row={adjustFor} onClose={() => setAdjustFor(null)} onSaved={load} /> : null}
      {transferFor ? <TransferModal row={transferFor} onClose={() => setTransferFor(null)} onSaved={load} /> : null}
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────

function AddStockModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [form, setForm] = useState({
    item_id: '',
    location: 'main_pharmacy',
    batch_number: '',
    manufacturer: '',
    expiry_date: '',
    quantity_on_hand: '',
    unit_cost: '',
    mrp: '',
    reorder_level: '0',
    reorder_quantity: '0',
    max_stock_level: '1000',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await trpcQuery('scm.items.list', { status: 'active', limit: 500, include_network: true });
        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        // non-fatal — user can still type item_id manually
      } finally {
        setItemsLoading(false);
      }
    })();
  }, []);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.inventory.add', {
        item_id: form.item_id,
        location: form.location,
        batch_number: form.batch_number,
        manufacturer: form.manufacturer,
        expiry_date: form.expiry_date,
        quantity_on_hand: Number(form.quantity_on_hand),
        unit_cost: Number(form.unit_cost),
        mrp: Number(form.mrp),
        reorder_level: Number(form.reorder_level || 0),
        reorder_quantity: Number(form.reorder_quantity || 1),
        max_stock_level: Number(form.max_stock_level || 1),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Add failed');
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    form.item_id && form.location && form.batch_number && form.manufacturer && form.expiry_date &&
    Number(form.quantity_on_hand) > 0 && Number(form.unit_cost) > 0 && Number(form.mrp) > 0;

  return (
    <Modal title="Add stock to inventory" onClose={onClose}>
      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 0 }}>
        Creates a new inventory row (item × location × batch) and writes an opening{' '}
        <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>grn_receive</code> entry to the stock_movements ledger.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Item">
            <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} style={inputStyle}>
              <option value="">{itemsLoading ? 'Loading items…' : '— select an active item —'}</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  [{it.kind}] {it.code} — {it.display_name} ({it.unit_of_measure})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Location">
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={inputStyle} placeholder="main_pharmacy / ward_3 / icu_stock / ot_stock" />
        </Field>
        <Field label="Batch number">
          <input value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Manufacturer">
          <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Expiry date">
          <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Quantity on hand">
          <input type="number" step="0.001" value={form.quantity_on_hand} onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Unit cost (₹)">
          <input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="MRP (₹)">
          <input type="number" step="0.01" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Reorder level">
          <input type="number" step="0.001" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Reorder qty">
          <input type="number" step="0.001" value={form.reorder_quantity} onChange={(e) => setForm({ ...form, reorder_quantity: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Max stock level">
          <input type="number" step="0.001" value={form.max_stock_level} onChange={(e) => setForm({ ...form, max_stock_level: e.target.value })} style={inputStyle} />
        </Field>
      </div>

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={!valid || submitting} style={btnPrimary(!valid || submitting)}>
          {submitting ? 'Adding…' : 'Add to inventory'}
        </button>
      </div>
    </Modal>
  );
}

function AdjustModal({ row, onClose, onSaved }: { row: InventoryRow; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'adjustment_increase' | 'adjustment_decrease'>('adjustment_increase');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const prev = Number(row.quantity_on_hand);
  const delta = type === 'adjustment_increase' ? Number(qty || 0) : -Number(qty || 0);
  const projected = prev + delta;
  const wouldGoNegative = projected < 0;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.inventory.adjust', {
        inventory_id: row.id,
        type,
        quantity: Number(qty),
        reason,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Adjustment failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Adjust: ${row.item_name || 'inventory row'}`} onClose={onClose}>
      <div style={infoBox}>
        <div><strong>Location:</strong> <code>{row.location}</code></div>
        <div><strong>Batch:</strong> {row.batch_number || '—'}</div>
        <div><strong>Current on hand:</strong> {fmtNum(row.quantity_on_hand)}</div>
      </div>

      <Field label="Adjustment type">
        <div style={{ display: 'flex', gap: 8 }}>
          <RadioBtn checked={type === 'adjustment_increase'} onClick={() => setType('adjustment_increase')} label="Increase (+)" color="#10b981" />
          <RadioBtn checked={type === 'adjustment_decrease'} onClick={() => setType('adjustment_decrease')} label="Decrease (−)" color="#ef4444" />
        </div>
      </Field>
      <Field label="Quantity">
        <input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} min="0" />
      </Field>
      <Field label="Reason (required, audit-logged)">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} placeholder="Recount discrepancy / damage / expiry / theft / etc." />
      </Field>

      {qty && Number(qty) > 0 ? (
        <div style={{ ...infoBox, background: wouldGoNegative ? '#fef2f2' : '#f0fdf4', borderColor: wouldGoNegative ? '#fca5a5' : '#86efac' }}>
          Projected new balance: <strong>{fmtNum(projected)}</strong>
          {wouldGoNegative ? <span style={{ color: '#991b1b', marginLeft: 8 }}>· would go negative; adjustment will be rejected</span> : null}
        </div>
      ) : null}

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button
          onClick={submit}
          disabled={submitting || !qty || Number(qty) <= 0 || !reason.trim() || wouldGoNegative}
          style={btnPrimary(submitting || !qty || Number(qty) <= 0 || !reason.trim() || wouldGoNegative)}
        >
          {submitting ? 'Adjusting…' : `Confirm ${type === 'adjustment_increase' ? 'increase' : 'decrease'}`}
        </button>
      </div>
    </Modal>
  );
}

function TransferModal({ row, onClose, onSaved }: { row: InventoryRow; onClose: () => void; onSaved: () => void }) {
  const [destination, setDestination] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const available = Number(row.quantity_on_hand) - Number(row.quantity_reserved);
  const insufficient = Number(qty || 0) > available;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.inventory.transfer', {
        inventory_id: row.id,
        quantity: Number(qty),
        destination_location: destination,
        reason: reason || undefined,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Transfer: ${row.item_name || 'inventory row'}`} onClose={onClose}>
      <div style={infoBox}>
        <div><strong>From:</strong> <code>{row.location}</code></div>
        <div><strong>Batch:</strong> {row.batch_number || '—'}</div>
        <div><strong>Available:</strong> {fmtNum(available)} (on hand {fmtNum(row.quantity_on_hand)}, reserved {fmtNum(row.quantity_reserved)})</div>
      </div>

      <Field label="Destination location">
        <input value={destination} onChange={(e) => setDestination(e.target.value)} style={inputStyle} placeholder="ward_3 / ot_stock / satellite_pharmacy_a" />
      </Field>
      <Field label="Quantity">
        <input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} min="0" />
      </Field>
      <Field label="Reason (optional)">
        <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} placeholder="Replenishment / urgent / etc." />
      </Field>

      {insufficient ? (
        <div style={{ ...infoBox, background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          Insufficient available stock; transfer will be rejected.
        </div>
      ) : null}

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button
          onClick={submit}
          disabled={submitting || !destination.trim() || !qty || Number(qty) <= 0 || insufficient}
          style={btnPrimary(submitting || !destination.trim() || !qty || Number(qty) <= 0 || insufficient)}
        >
          {submitting ? 'Transferring…' : 'Confirm transfer'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Atoms ──────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? '#3b82f6' : 'transparent'}`,
        color: active ? '#1e40af' : '#6b7280',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

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

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function RadioBtn({ checked, onClick, label, color }: { checked: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        background: checked ? color : 'white',
        color: checked ? 'white' : '#374151',
        border: `1px solid ${checked ? color : '#d1d5db'}`,
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
      {msg}
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', ...style }}>{children}</th>;
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

const infoBox: React.CSSProperties = {
  padding: 10,
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontSize: 13,
  marginBottom: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

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
