'use client';
import { useState, useEffect, useCallback } from 'react';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── helpers ──────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const params = input !== undefined
    ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'Query failed');
  return json?.result?.data?.json ?? json?.result?.data ?? null;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'Mutation failed');
  return json?.result?.data?.json ?? json?.result?.data ?? null;
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280', generated: '#2563eb', reviewed: '#f59e0b', filed: '#16a34a', revised: '#8b5cf6',
  available: '#16a34a', claimed: '#2563eb', reversed: '#ef4444', ineligible: '#6b7280',
  matched: '#16a34a', mismatch: '#ef4444', pending: '#f59e0b', resolved: '#2563eb',
};

function Badge({ status }: { status: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: `${STATUS_COLORS[status] || '#6b7280'}18`, color: STATUS_COLORS[status] || '#6b7280', textTransform: 'capitalize' }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── period selector ──────────────────────────────
function PeriodSelector({ month, year, setMonth, setYear }: { month: number; year: number; setMonth: (m: number) => void; setYear: (y: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
          <option key={m} value={m}>{MONTHS[m]}</option>
        ))}
      </select>
      <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
        {[2024, 2025, 2026, 2027].map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────
export default function GstModuleAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [tab, setTab] = useState<'gstr1' | 'gstr3b' | 'itc' | 'recon' | 'returns'>('gstr1');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // GSTR-1 state
  const [gstr1Data, setGstr1Data] = useState<any>(null);
  const [gstr1Loading, setGstr1Loading] = useState(false);
  const [gstr1Sub, setGstr1Sub] = useState<'b2b' | 'b2c' | 'hsn'>('b2b');

  // GSTR-3B state
  const [gstr3bData, setGstr3bData] = useState<any>(null);
  const [gstr3bLoading, setGstr3bLoading] = useState(false);

  // ITC state
  const [itcItems, setItcItems] = useState<any[]>([]);
  const [itcTotals, setItcTotals] = useState<any>({});
  const [itcTotal, setItcTotal] = useState(0);
  const [itcPage, setItcPage] = useState(1);
  const [itcLoading, setItcLoading] = useState(false);
  const [showItcModal, setShowItcModal] = useState(false);

  // Reconciliation state
  const [reconItems, setReconItems] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);
  const [showReconModal, setShowReconModal] = useState(false);

  // Saved returns state
  const [savedReturns, setSavedReturns] = useState<any[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [detailReturn, setDetailReturn] = useState<any>(null);

  // Saving states
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  // ── GSTR-1 ─────────────────────────────────────
  const loadGstr1 = async () => {
    setGstr1Loading(true);
    try {
      const data = await trpcQuery('gstModule.generateGstr1', { month, year });
      setGstr1Data(data);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setGstr1Loading(false);
  };

  const saveGstr1 = async () => {
    if (!gstr1Data) return;
    setSaving(true);
    try {
      await trpcMutate('gstModule.saveReturn', {
        return_type: 'gstr_1', month, year, data: gstr1Data,
        total_taxable_value: gstr1Data.totals.taxable, total_cgst: gstr1Data.totals.cgst,
        total_sgst: gstr1Data.totals.sgst, total_igst: gstr1Data.totals.igst, total_tax: gstr1Data.totals.total_tax,
      });
      showToast('GSTR-1 snapshot saved');
    } catch (e: any) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  // ── GSTR-3B ────────────────────────────────────
  const loadGstr3b = async () => {
    setGstr3bLoading(true);
    try {
      const data = await trpcQuery('gstModule.generateGstr3b', { month, year });
      setGstr3bData(data);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setGstr3bLoading(false);
  };

  const saveGstr3b = async () => {
    if (!gstr3bData) return;
    setSaving(true);
    try {
      await trpcMutate('gstModule.saveReturn', {
        return_type: 'gstr_3b', month, year, data: gstr3bData,
        total_taxable_value: gstr3bData.outward_supplies.taxable_value,
        total_cgst: gstr3bData.outward_supplies.cgst, total_sgst: gstr3bData.outward_supplies.sgst,
        total_igst: 0, total_tax: gstr3bData.net_payable.total,
      });
      showToast('GSTR-3B snapshot saved');
    } catch (e: any) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  // ── ITC ────────────────────────────────────────
  const loadItc = async (pg = 1) => {
    setItcLoading(true);
    try {
      const data = await trpcQuery('gstModule.listItc', { month, year, page: pg, pageSize: 25 });
      setItcItems(data.items || []);
      setItcTotals(data.totals || {});
      setItcTotal(data.total || 0);
      setItcPage(pg);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setItcLoading(false);
  };

  // ── Recon ──────────────────────────────────────
  const loadRecon = async () => {
    setReconLoading(true);
    try {
      const data = await trpcQuery('gstModule.listReconciliations', { year });
      setReconItems(data || []);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setReconLoading(false);
  };

  // ── Saved Returns ──────────────────────────────
  const loadReturns = async () => {
    setReturnsLoading(true);
    try {
      const data = await trpcQuery('gstModule.listReturns', { year });
      setSavedReturns(data || []);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setReturnsLoading(false);
  };

  useEffect(() => {
    if (tab === 'gstr1') loadGstr1();
    else if (tab === 'gstr3b') loadGstr3b();
    else if (tab === 'itc') loadItc(1);
    else if (tab === 'recon') loadRecon();
    else if (tab === 'returns') loadReturns();
  }, [tab, month, year]);

  const tabs = [
    { key: 'gstr1', label: 'GSTR-1' },
    { key: 'gstr3b', label: 'GSTR-3B' },
    { key: 'itc', label: 'ITC Ledger' },
    { key: 'recon', label: 'Reconciliation' },
    { key: 'returns', label: 'Saved Returns' },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Breadcrumbs */}
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        {breadcrumbs.map((b, i) => (
          <span key={i}>
            {b.href ? <a href={b.href} style={{ color: '#2563eb', textDecoration: 'none' }}>{b.label}</a> : <span style={{ color: '#111827' }}>{b.label}</span>}
            {i < breadcrumbs.length - 1 && ' / '}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>GST Module</h1>
        <PeriodSelector month={month} year={year} setMonth={setMonth} setYear={setYear} />
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#111827', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 9999, fontSize: 14 }}>
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            style={{ padding: '10px 20px', border: 'none', borderBottom: tab === t.key ? '2px solid #2563eb' : '2px solid transparent', background: 'none', cursor: 'pointer', fontWeight: tab === t.key ? 600 : 400, color: tab === t.key ? '#2563eb' : '#6b7280', fontSize: 14, marginBottom: -2 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ GSTR-1 TAB ═══ */}
      {tab === 'gstr1' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>GSTR-1 — Outward Supplies ({MONTHS[month]} {year})</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={loadGstr1} disabled={gstr1Loading} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                {gstr1Loading ? 'Generating…' : 'Regenerate'}
              </button>
              {gstr1Data && (
                <button onClick={saveGstr1} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  {saving ? 'Saving…' : 'Save Snapshot'}
                </button>
              )}
            </div>
          </div>

          {gstr1Loading && <p style={{ color: '#6b7280' }}>Generating GSTR-1 from journal entries…</p>}

          {gstr1Data && !gstr1Loading && (
            <>
              {/* Summary cards */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' as const }}>
                {[
                  { label: 'Total Taxable', value: INR.format(gstr1Data.totals.taxable) },
                  { label: 'CGST', value: INR.format(gstr1Data.totals.cgst) },
                  { label: 'SGST', value: INR.format(gstr1Data.totals.sgst) },
                  { label: 'IGST', value: INR.format(gstr1Data.totals.igst) },
                  { label: 'Total Tax', value: INR.format(gstr1Data.totals.total_tax) },
                  { label: 'B2B Invoices', value: String(gstr1Data.b2b.count) },
                  { label: 'B2C Invoices', value: String(gstr1Data.b2c.count) },
                ].map((c, i) => (
                  <div key={i} style={{ flex: '1 1 130px', padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{c.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Sub-tabs */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[{ key: 'b2b', label: `B2B (${gstr1Data.b2b.count})` }, { key: 'b2c', label: `B2C (${gstr1Data.b2c.count})` }, { key: 'hsn', label: 'HSN Summary' }].map(s => (
                  <button key={s.key} onClick={() => setGstr1Sub(s.key as any)} style={{ padding: '4px 14px', borderRadius: 6, border: gstr1Sub === s.key ? '1px solid #2563eb' : '1px solid #d1d5db', background: gstr1Sub === s.key ? '#eff6ff' : '#fff', color: gstr1Sub === s.key ? '#2563eb' : '#374151', fontSize: 13, cursor: 'pointer' }}>
                    {s.label}
                  </button>
                ))}
              </div>

              {/* B2B / B2C table */}
              {(gstr1Sub === 'b2b' || gstr1Sub === 'b2c') && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Entry #</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Account</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>HSN</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Rate</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Taxable</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>CGST</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>SGST</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Invoice Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(gstr1Sub === 'b2b' ? gstr1Data.b2b.items : gstr1Data.b2c.items).map((item: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '8px 12px' }}>{item.entry_number}</td>
                          <td style={{ padding: '8px 12px' }}>{item.entry_date}</td>
                          <td style={{ padding: '8px 12px' }}>{item.account}</td>
                          <td style={{ padding: '8px 12px' }}>{item.hsn_code}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.gst_rate}%</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(item.taxable_value)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(item.cgst)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(item.sgst)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{INR2.format(item.invoice_value)}</td>
                        </tr>
                      ))}
                      {(gstr1Sub === 'b2b' ? gstr1Data.b2b.items : gstr1Data.b2c.items).length === 0 && (
                        <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No entries for this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* HSN Summary */}
              {gstr1Sub === 'hsn' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>HSN/SAC</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Invoices</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Taxable Value</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>CGST</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>SGST</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>IGST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gstr1Data.hsn_summary.map((h: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{h.hsn}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{h.count}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(h.taxable)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(h.cgst)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(h.sgst)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR2.format(h.igst)}</td>
                        </tr>
                      ))}
                      {gstr1Data.hsn_summary.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No HSN data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ GSTR-3B TAB ═══ */}
      {tab === 'gstr3b' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>GSTR-3B — Summary Return ({MONTHS[month]} {year})</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={loadGstr3b} disabled={gstr3bLoading} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                {gstr3bLoading ? 'Generating…' : 'Regenerate'}
              </button>
              {gstr3bData && (
                <button onClick={saveGstr3b} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  {saving ? 'Saving…' : 'Save Snapshot'}
                </button>
              )}
            </div>
          </div>

          {gstr3bLoading && <p style={{ color: '#6b7280' }}>Computing GSTR-3B from GL + ITC ledger…</p>}

          {gstr3bData && !gstr3bLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* 3.1 — Outward Supplies */}
              <div style={{ background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#374151' }}>3.1 — Outward Supplies (Output Tax)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Description</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>Taxable Value</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>CGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>SGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>IGST</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ fontWeight: 600 }}>
                      <td style={{ padding: '6px 12px' }}>Outward taxable supplies</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.outward_supplies.taxable_value)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.outward_supplies.cgst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.outward_supplies.sgst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.outward_supplies.igst)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 4 — ITC Available */}
              <div style={{ background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#374151' }}>4 — ITC Available</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Description</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>CGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>SGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>IGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>Total ITC</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ fontWeight: 600 }}>
                      <td style={{ padding: '6px 12px' }}>ITC from {gstr3bData.itc_available.invoice_count} invoices</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.itc_available.cgst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.itc_available.sgst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.itc_available.igst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.itc_available.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 6.1 — Net Payable */}
              <div style={{ background: '#fef3c7', borderRadius: 8, border: '1px solid #fcd34d', padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#92400e' }}>6.1 — Tax Payable</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #fcd34d' }}>
                      <th style={{ padding: '6px 12px', textAlign: 'left' }}>Description</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>CGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>SGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right' }}>IGST</th>
                      <th style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ fontWeight: 700, fontSize: 15 }}>
                      <td style={{ padding: '6px 12px' }}>Net Tax Payable</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.net_payable.cgst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.net_payable.sgst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>{INR.format(gstr3bData.net_payable.igst)}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', color: '#b45309' }}>{INR.format(gstr3bData.net_payable.total)}</td>
                    </tr>
                    {(gstr3bData.interest > 0 || gstr3bData.late_fee > 0) && (
                      <tr>
                        <td style={{ padding: '6px 12px', color: '#ef4444' }}>Interest + Late Fee</td>
                        <td colSpan={4} style={{ padding: '6px 12px', textAlign: 'right', color: '#ef4444' }}>{INR.format(gstr3bData.interest + gstr3bData.late_fee)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ ITC LEDGER TAB ═══ */}
      {tab === 'itc' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>ITC Ledger — {MONTHS[month]} {year}</h2>
            <button onClick={() => setShowItcModal(true)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
              + Add ITC Entry
            </button>
          </div>

          {/* ITC Summary */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const }}>
            {[
              { label: 'Total ITC', value: INR.format(itcTotals.itc || 0) },
              { label: 'CGST', value: INR.format(itcTotals.cgst || 0) },
              { label: 'SGST', value: INR.format(itcTotals.sgst || 0) },
              { label: 'Entries', value: String(itcTotal) },
            ].map((c, i) => (
              <div key={i} style={{ flex: '1 1 120px', padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{c.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {itcLoading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Vendor</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Invoice #</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>GSTIN</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Taxable</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Total ITC</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {itcItems.map((item: any) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 10px' }}>{item.vendor_name}</td>
                      <td style={{ padding: '8px 10px' }}>{item.invoice_number}</td>
                      <td style={{ padding: '8px 10px' }}>{item.invoice_date}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{item.vendor_gstin || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{INR.format(Number(item.taxable_value))}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{INR.format(Number(item.total_itc))}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}><Badge status={item.status} /></td>
                    </tr>
                  ))}
                  {itcItems.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No ITC entries for this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {itcTotal > 25 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
              <button disabled={itcPage <= 1} onClick={() => loadItc(itcPage - 1)} style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Prev</button>
              <span style={{ fontSize: 13, lineHeight: '28px' }}>Page {itcPage} of {Math.ceil(itcTotal / 25)}</span>
              <button disabled={itcPage >= Math.ceil(itcTotal / 25)} onClick={() => loadItc(itcPage + 1)} style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Next</button>
            </div>
          )}

          {/* Add ITC Modal */}
          {showItcModal && <ItcModal onClose={() => { setShowItcModal(false); loadItc(1); }} showToast={showToast} month={month} year={year} />}
        </div>
      )}

      {/* ═══ RECONCILIATION TAB ═══ */}
      {tab === 'recon' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>GST Reconciliation — {year}</h2>
            <button onClick={() => setShowReconModal(true)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
              + New Reconciliation
            </button>
          </div>

          {reconLoading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Period</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Books Taxable</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Books Tax</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Return Taxable</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Return Tax</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Taxable Diff</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Tax Diff</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reconItems.map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{MONTHS[r.period_month]} {r.period_year}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR.format(Number(r.books_taxable))}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{INR.format(Number(r.books_tax))}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.return_taxable ? INR.format(Number(r.return_taxable)) : '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.return_tax ? INR.format(Number(r.return_tax)) : '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: Number(r.taxable_diff || 0) !== 0 ? '#ef4444' : '#16a34a' }}>{r.taxable_diff ? INR.format(Number(r.taxable_diff)) : '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: Number(r.tax_diff || 0) !== 0 ? '#ef4444' : '#16a34a' }}>{r.tax_diff ? INR.format(Number(r.tax_diff)) : '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}><Badge status={r.status} /></td>
                    </tr>
                  ))}
                  {reconItems.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No reconciliations for {year}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {showReconModal && <ReconModal onClose={() => { setShowReconModal(false); loadRecon(); }} showToast={showToast} month={month} year={year} />}
        </div>
      )}

      {/* ═══ SAVED RETURNS TAB ═══ */}
      {tab === 'returns' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Saved Returns — {year}</h2>
          </div>

          {returnsLoading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Type</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Period</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Total Taxable</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Total Tax</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Filed ARN</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Saved</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {savedReturns.map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, textTransform: 'uppercase' }}>{r.return_type.replace('_', '-')}</td>
                      <td style={{ padding: '8px 12px' }}>{r.period_label}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.total_taxable_value ? INR.format(Number(r.total_taxable_value)) : '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.total_tax ? INR.format(Number(r.total_tax)) : '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}><Badge status={r.status} /></td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{r.filed_arn || '—'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <button onClick={() => setDetailReturn(r)} style={{ padding: '2px 10px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer' }}>View</button>
                      </td>
                    </tr>
                  ))}
                  {savedReturns.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No saved returns for {year}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Return Detail Modal */}
          {detailReturn && <ReturnDetailModal ret={detailReturn} onClose={() => { setDetailReturn(null); loadReturns(); }} showToast={showToast} />}
        </div>
      )}
    </div>
  );
}

// ── ITC MODAL ────────────────────────────────────
function ItcModal({ onClose, showToast, month, year }: { onClose: () => void; showToast: (s: string) => void; month: number; year: number }) {
  const [form, setForm] = useState({ vendor_name: '', vendor_gstin: '', invoice_number: '', invoice_date: '', taxable_value: '', cgst: '', sgst: '', igst: '0', cess: '0', hsn_code: '', gst_rate: '18' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.vendor_name || !form.invoice_number || !form.invoice_date || !form.taxable_value) { showToast('Fill required fields'); return; }
    setSaving(true);
    try {
      const taxable = Number(form.taxable_value);
      const rate = Number(form.gst_rate || 18);
      const cgst = form.cgst ? Number(form.cgst) : Math.round(taxable * rate / 2 / 100 * 100) / 100;
      const sgst = form.sgst ? Number(form.sgst) : cgst;
      await trpcMutate('gstModule.createItc', {
        vendor_name: form.vendor_name, vendor_gstin: form.vendor_gstin || undefined,
        invoice_number: form.invoice_number, invoice_date: form.invoice_date,
        taxable_value: taxable, cgst, sgst, igst: Number(form.igst || 0), cess: Number(form.cess || 0),
        hsn_code: form.hsn_code || undefined, gst_rate: rate,
        claim_month: month, claim_year: year,
      });
      showToast('ITC entry created');
      onClose();
    } catch (e: any) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 520, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Add ITC Entry — {MONTHS[month]} {year}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { label: 'Vendor Name *', key: 'vendor_name' },
            { label: 'Vendor GSTIN', key: 'vendor_gstin' },
            { label: 'Invoice Number *', key: 'invoice_number' },
            { label: 'Invoice Date *', key: 'invoice_date', type: 'date' },
            { label: 'Taxable Value *', key: 'taxable_value', type: 'number' },
            { label: 'GST Rate (%)', key: 'gst_rate', type: 'number' },
            { label: 'CGST (auto if blank)', key: 'cgst', type: 'number' },
            { label: 'SGST (auto if blank)', key: 'sgst', type: 'number' },
            { label: 'IGST', key: 'igst', type: 'number' },
            { label: 'Cess', key: 'cess', type: 'number' },
            { label: 'HSN/SAC Code', key: 'hsn_code' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{f.label}</label>
              <input type={f.type || 'text'} value={(form as any)[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RECON MODAL ──────────────────────────────────
function ReconModal({ onClose, showToast, month, year }: { onClose: () => void; showToast: (s: string) => void; month: number; year: number }) {
  const [form, setForm] = useState({ books_taxable: '', books_tax: '', return_taxable: '', return_tax: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.books_taxable || !form.books_tax) { showToast('Fill books values'); return; }
    setSaving(true);
    try {
      await trpcMutate('gstModule.createReconciliation', {
        month, year,
        books_taxable: Number(form.books_taxable), books_tax: Number(form.books_tax),
        return_taxable: form.return_taxable ? Number(form.return_taxable) : undefined,
        return_tax: form.return_tax ? Number(form.return_tax) : undefined,
      });
      showToast('Reconciliation created');
      onClose();
    } catch (e: any) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 440, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New Reconciliation — {MONTHS[month]} {year}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { label: 'Books Taxable Value *', key: 'books_taxable' },
            { label: 'Books Tax *', key: 'books_tax' },
            { label: 'Return Taxable Value', key: 'return_taxable' },
            { label: 'Return Tax', key: 'return_tax' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>{f.label}</label>
              <input type="number" value={(form as any)[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RETURN DETAIL MODAL ──────────────────────────
function ReturnDetailModal({ ret, onClose, showToast }: { ret: any; onClose: () => void; showToast: (s: string) => void }) {
  const [status, setStatus] = useState(ret.status);
  const [arn, setArn] = useState(ret.filed_arn || '');
  const [filedDate, setFiledDate] = useState(ret.filed_date || '');
  const [saving, setSaving] = useState(false);

  const handleUpdate = async () => {
    setSaving(true);
    try {
      await trpcMutate('gstModule.updateReturnStatus', {
        id: ret.id, status,
        filed_date: filedDate || undefined,
        filed_arn: arn || undefined,
      });
      showToast('Return updated');
      onClose();
    } catch (e: any) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 500, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
          {ret.return_type.replace('_', '-').toUpperCase()} — {ret.period_label}
        </h3>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const }}>
          <div style={{ flex: '1 1 120px', padding: 10, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Taxable</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{ret.total_taxable_value ? INR.format(Number(ret.total_taxable_value)) : '—'}</div>
          </div>
          <div style={{ flex: '1 1 120px', padding: 10, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Total Tax</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{ret.total_tax ? INR.format(Number(ret.total_tax)) : '—'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
              {['draft', 'generated', 'reviewed', 'filed', 'revised'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Filed Date</label>
            <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 }}>Filed ARN</label>
            <input type="text" value={arn} onChange={(e) => setArn(e.target.value)} placeholder="Acknowledgement Reference Number"
              style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button onClick={handleUpdate} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            {saving ? 'Updating…' : 'Update Status'}
          </button>
        </div>
      </div>
    </div>
  );
}
