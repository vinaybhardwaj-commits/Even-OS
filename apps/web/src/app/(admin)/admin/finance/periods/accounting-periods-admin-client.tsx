'use client';
import { useState, useEffect, useCallback } from 'react';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

async function trpcQuery(path: string, input?: any) {
  const params = input !== undefined ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '';
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
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_COLORS: Record<string, string> = {
  open: '#16a34a',
  soft_closed: '#f59e0b',
  hard_closed: '#ef4444',
};

function Badge({ status }: { status: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: `${STATUS_COLORS[status] || '#6b7280'}18`, color: STATUS_COLORS[status] || '#6b7280' }}>
      {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
    </span>
  );
}

export default function AccountingPeriodsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const now = new Date();
  const [fiscalYear, setFiscalYear] = useState(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [acting, setActing] = useState(false);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  const loadPeriods = async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('accountingPeriods.list', { fiscal_year: fiscalYear });
      setPeriods(data || []);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { loadPeriods(); }, [fiscalYear]);

  const handleCreate = async (month: number, year: number) => {
    try {
      await trpcMutate('accountingPeriods.create', { month, year });
      showToast(`${MONTHS[month]} ${year} created`);
      setShowCreate(false);
      loadPeriods();
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const handleAction = async (action: 'softClose' | 'hardClose' | 'reopen') => {
    if (!selectedPeriod) return;
    if (action === 'reopen' && !actionNotes.trim()) { showToast('Reopen reason required'); return; }
    setActing(true);
    try {
      if (action === 'softClose') {
        await trpcMutate('accountingPeriods.softClose', { id: selectedPeriod.id, notes: actionNotes || undefined });
        showToast('Period soft-closed');
      } else if (action === 'hardClose') {
        await trpcMutate('accountingPeriods.hardClose', { id: selectedPeriod.id, notes: actionNotes || undefined });
        showToast('Period hard-closed');
      } else {
        await trpcMutate('accountingPeriods.reopen', { id: selectedPeriod.id, reason: actionNotes });
        showToast('Period reopened');
      }
      setSelectedPeriod(null);
      setActionNotes('');
      loadPeriods();
    } catch (e: any) { showToast('Error: ' + e.message); }
    setActing(false);
  };

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

      {toast && <div style={{ position: 'fixed', top: 20, right: 20, background: '#111827', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 9999, fontSize: 14 }}>{toast}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Accounting Periods</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>FY {y}-{String(y + 1).slice(2)}</option>)}
          </select>
          <button onClick={() => setShowCreate(true)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13 }}>+ New Period</button>
        </div>
      </div>

      {/* Summary cards */}
      {(() => {
        const open = periods.filter(p => p.status === 'open').length;
        const soft = periods.filter(p => p.status === 'soft_closed').length;
        const hard = periods.filter(p => p.status === 'hard_closed').length;
        return (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' as const }}>
            {[
              { label: 'Total Periods', value: String(periods.length), color: '#374151' },
              { label: 'Open', value: String(open), color: '#16a34a' },
              { label: 'Soft Closed', value: String(soft), color: '#f59e0b' },
              { label: 'Hard Closed', value: String(hard), color: '#ef4444' },
            ].map((c, i) => (
              <div key={i} style={{ flex: '1 1 120px', padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Period</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Code</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Dates</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Revenue</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Expense</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Net Income</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p: any) => {
                const summary = p.close_summary as any;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{p.period_name}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{p.period_code}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>{p.start_date} → {p.end_date}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}><Badge status={p.status} /></td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{summary?.revenue ? INR.format(summary.revenue) : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{summary?.expense ? INR.format(summary.expense) : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: (summary?.net_income ?? 0) >= 0 ? '#16a34a' : '#ef4444' }}>
                      {summary?.net_income != null ? INR.format(summary.net_income) : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <button onClick={() => { setSelectedPeriod(p); setActionNotes(''); }} style={{ padding: '2px 10px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
                        Manage
                      </button>
                    </td>
                  </tr>
                );
              })}
              {periods.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No periods for FY {fiscalYear}-{String(fiscalYear + 1).slice(2)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreatePeriodModal onClose={() => setShowCreate(false)} onCreate={handleCreate} fiscalYear={fiscalYear} />
      )}

      {/* Manage Modal */}
      {selectedPeriod && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 480, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{selectedPeriod.period_name}</h3>
            <div style={{ marginBottom: 16 }}>
              <Badge status={selectedPeriod.status} />
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>{selectedPeriod.start_date} → {selectedPeriod.end_date}</span>
            </div>

            {selectedPeriod.close_summary && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
                {[
                  { label: 'JEs', value: String(selectedPeriod.close_summary.total_je || 0) },
                  { label: 'Revenue', value: INR.format(selectedPeriod.close_summary.revenue || 0) },
                  { label: 'Expense', value: INR.format(selectedPeriod.close_summary.expense || 0) },
                  { label: 'Net', value: INR.format(selectedPeriod.close_summary.net_income || 0) },
                ].map((c, i) => (
                  <div key={i} style={{ flex: '1 1 90px', padding: 8, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{c.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{c.value}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Notes / Reason</label>
              <textarea value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} rows={2}
                placeholder={selectedPeriod.status !== 'open' ? 'Reopen reason (required)' : 'Optional notes'}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' as const }}>
              <button onClick={() => setSelectedPeriod(null)} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Close</button>

              {selectedPeriod.status === 'open' && (
                <>
                  <button onClick={() => handleAction('softClose')} disabled={acting} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                    {acting ? '…' : 'Soft Close'}
                  </button>
                  <button onClick={() => handleAction('hardClose')} disabled={acting} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                    {acting ? '…' : 'Hard Close'}
                  </button>
                </>
              )}

              {selectedPeriod.status === 'soft_closed' && (
                <>
                  <button onClick={() => handleAction('hardClose')} disabled={acting} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                    {acting ? '…' : 'Hard Close'}
                  </button>
                  <button onClick={() => handleAction('reopen')} disabled={acting} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                    {acting ? '…' : 'Reopen'}
                  </button>
                </>
              )}

              {selectedPeriod.status === 'hard_closed' && (
                <button onClick={() => handleAction('reopen')} disabled={acting} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                  {acting ? '…' : 'Reopen'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePeriodModal({ onClose, onCreate, fiscalYear }: { onClose: () => void; onCreate: (m: number, y: number) => void; fiscalYear: number }) {
  // Generate months for the fiscal year (Apr Y to Mar Y+1)
  const fyMonths = [];
  for (let m = 4; m <= 12; m++) fyMonths.push({ month: m, year: fiscalYear, label: `${MONTHS[m]} ${fiscalYear}` });
  for (let m = 1; m <= 3; m++) fyMonths.push({ month: m, year: fiscalYear + 1, label: `${MONTHS[m]} ${fiscalYear + 1}` });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 400, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Create Period — FY {fiscalYear}-{String(fiscalYear + 1).slice(2)}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fyMonths.map((fm) => (
            <button key={`${fm.month}-${fm.year}`} onClick={() => onCreate(fm.month, fm.year)}
              style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}>
              {fm.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
