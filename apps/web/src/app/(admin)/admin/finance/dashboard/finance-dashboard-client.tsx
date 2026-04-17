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

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function FinanceDashboardClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const d = await trpcQuery('accountingPeriods.financeDashboard', { month, year });
      setData(d);
    } catch (e: any) { showToast('Error: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [month, year]);

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Finance Dashboard</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MONTHS[m]}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Refresh</button>
        </div>
      </div>

      {loading && <p style={{ color: '#6b7280' }}>Loading dashboard…</p>}

      {data && !loading && (
        <>
          {/* Period status bar */}
          {data.current_period && (
            <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 20, background: data.current_period.status === 'open' ? '#f0fdf4' : data.current_period.status === 'soft_closed' ? '#fefce8' : '#fef2f2', border: `1px solid ${data.current_period.status === 'open' ? '#86efac' : data.current_period.status === 'soft_closed' ? '#fde047' : '#fca5a5'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Period: {data.current_period.period_name}
              </span>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: data.current_period.status === 'open' ? '#16a34a18' : data.current_period.status === 'soft_closed' ? '#f59e0b18' : '#ef444418', color: data.current_period.status === 'open' ? '#16a34a' : data.current_period.status === 'soft_closed' ? '#f59e0b' : '#ef4444' }}>
                {data.current_period.status.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
          )}

          {/* Top row: P&L + Cash */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' as const }}>
            {/* P&L Card */}
            <div style={{ flex: '1 1 300px', padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 16, marginTop: 0 }}>P&L Summary — {MONTHS[month]} {year}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280', fontSize: 13 }}>Revenue</span>
                  <span style={{ fontWeight: 600, fontSize: 15, color: '#16a34a' }}>{INR.format(data.pnl.revenue)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280', fontSize: 13 }}>Expenses</span>
                  <span style={{ fontWeight: 600, fontSize: 15, color: '#ef4444' }}>{INR.format(data.pnl.expense)}</span>
                </div>
                <div style={{ borderTop: '2px solid #e5e7eb', paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Net Income</span>
                  <span style={{ fontWeight: 700, fontSize: 18, color: data.pnl.net_income >= 0 ? '#16a34a' : '#ef4444' }}>{INR.format(data.pnl.net_income)}</span>
                </div>
              </div>
            </div>

            {/* Cash Position Card */}
            <div style={{ flex: '1 1 200px', padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 16, marginTop: 0 }}>Cash Position</h3>
              <div style={{ fontSize: 28, fontWeight: 700, color: data.cash_position >= 0 ? '#16a34a' : '#ef4444' }}>
                {INR.format(data.cash_position)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Bank + Cash accounts cumulative</div>
            </div>

            {/* JE Stats Card */}
            <div style={{ flex: '1 1 200px', padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 16, marginTop: 0 }}>Journal Entries</h3>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#2563eb' }}>{data.je_stats.count}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Posted this month | {INR.format(data.je_stats.volume)} volume</div>
            </div>
          </div>

          {/* Bottom row: AR + AP */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
            {/* AR Card */}
            <div style={{ flex: '1 1 280px', padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 16, marginTop: 0 }}>Accounts Receivable</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{INR.format(data.ar.outstanding)}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Outstanding from {data.ar.count} entries</div>
                </div>
                <a href="/admin/finance/receivables" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>View AR →</a>
              </div>
            </div>

            {/* AP Card */}
            <div style={{ flex: '1 1 280px', padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 16, marginTop: 0 }}>Accounts Payable</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{INR.format(data.ap.due)}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Due on {data.ap.count} invoices</div>
                </div>
                <a href="/admin/finance/vendors" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>View AP →</a>
              </div>
            </div>

            {/* Quick Links */}
            <div style={{ flex: '1 1 200px', padding: 20, background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 12, marginTop: 0 }}>Quick Links</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Chart of Accounts', href: '/admin/finance/chart' },
                  { label: 'Journal Entries', href: '/admin/finance/journal' },
                  { label: 'Financial Statements', href: '/admin/finance/statements' },
                  { label: 'GST Module', href: '/admin/finance/gst' },
                  { label: 'Accounting Periods', href: '/admin/finance/periods' },
                ].map(l => (
                  <a key={l.href} href={l.href} style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
                    {l.label} →
                  </a>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
