'use client';
import { useState, useEffect, useCallback } from 'react';

interface Breadcrumb { label: string; href?: string }
interface Props { userId: string; userRole: string; userName: string; breadcrumbs: Breadcrumb[] }

async function trpcQuery(path: string, input?: any) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'Query failed');
  return json?.result?.data?.json ?? json?.result?.data;
}
async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: input }) });
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'Mutation failed');
  return json?.result?.data?.json ?? json?.result?.data;
}

const INR = (v: any) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const statusColors: Record<string, string> = { draft: '#6b7280', reviewed: '#3b82f6', approved: '#059669', published: '#8b5cf6' };

// Current month defaults
const now = new Date();
const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
const endOfMonth = `${lastOfMonth.getFullYear()}-${String(lastOfMonth.getMonth() + 1).padStart(2, '0')}-${String(lastOfMonth.getDate()).padStart(2, '0')}`;

export default function FinancialStatementsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [tab, setTab] = useState<'pl' | 'bs' | 'cf' | 'tb' | 'snapshots' | 'budget'>('pl');

  // Period inputs
  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(endOfMonth);
  const [compStart, setCompStart] = useState('');
  const [compEnd, setCompEnd] = useState('');
  const [asOfDate, setAsOfDate] = useState(endOfMonth);

  // Statement data
  const [plData, setPlData] = useState<any>(null);
  const [bsData, setBsData] = useState<any>(null);
  const [cfData, setCfData] = useState<any>(null);
  const [tbData, setTbData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Snapshots
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // Budget
  const [budgets, setBudgets] = useState<any[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [bf, setBf] = useState<any>({});

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Generate P&L ──
  const generatePL = async () => {
    setLoading(true); setError('');
    try {
      const input: any = { period_start: periodStart, period_end: periodEnd };
      if (compStart && compEnd) { input.comparison_period_start = compStart; input.comparison_period_end = compEnd; }
      const data = await trpcQuery('financialStatements.generateIncomeStatement', input);
      setPlData(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  // ── Generate Balance Sheet ──
  const generateBS = async () => {
    setLoading(true); setError('');
    try {
      const data = await trpcQuery('financialStatements.generateBalanceSheet', { as_of_date: asOfDate });
      setBsData(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  // ── Generate Cash Flow ──
  const generateCF = async () => {
    setLoading(true); setError('');
    try {
      const data = await trpcQuery('financialStatements.generateCashFlow', { period_start: periodStart, period_end: periodEnd });
      setCfData(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  // ── Generate Trial Balance ──
  const generateTB = async () => {
    setLoading(true); setError('');
    try {
      const data = await trpcQuery('financialStatements.generateTrialBalance', { period_start: periodStart, period_end: periodEnd });
      setTbData(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  // Auto-generate on tab switch
  useEffect(() => {
    if (tab === 'pl') generatePL();
    else if (tab === 'bs') generateBS();
    else if (tab === 'cf') generateCF();
    else if (tab === 'tb') generateTB();
    else if (tab === 'snapshots') loadSnapshots();
    else if (tab === 'budget') loadBudgets();
  }, [tab]);

  const loadSnapshots = async () => {
    setSnapshotLoading(true);
    try {
      const data = await trpcQuery('financialStatements.listSnapshots');
      setSnapshots(data.items || []);
    } catch (e: any) { setError(e.message); }
    setSnapshotLoading(false);
  };

  const loadBudgets = async () => {
    setBudgetLoading(true);
    try {
      const data = await trpcQuery('financialStatements.listBudgets', { period_start: periodStart });
      setBudgets(data.items || []);
    } catch (e: any) { setError(e.message); }
    setBudgetLoading(false);
  };

  const saveSnapshot = async (type: string, title: string, data: any, extras?: any) => {
    try {
      await trpcMutate('financialStatements.saveSnapshot', {
        statement_type: type, title, period_start: periodStart, period_end: periodEnd,
        data, ...extras,
      });
      setSuccess('Snapshot saved');
    } catch (e: any) { setError(e.message); }
  };

  const saveBudget = async () => {
    setError('');
    try {
      await trpcMutate('financialStatements.createBudget', {
        account_id: bf.account_id, account_code: bf.account_code, account_name: bf.account_name,
        period_start: bf.period_start, period_end: bf.period_end, budget_amount: Number(bf.budget_amount),
        notes: bf.notes || undefined,
      });
      setSuccess('Budget entry created');
      setShowBudgetModal(false);
      loadBudgets();
    } catch (e: any) { setError(e.message); }
  };

  // ── Styles ──
  const tabStyle = (active: boolean): React.CSSProperties => ({ padding: '10px 16px', cursor: 'pointer', border: 'none', background: active ? '#1e40af' : '#f1f5f9', color: active ? '#fff' : '#374151', borderRadius: '8px 8px 0 0', fontWeight: active ? 600 : 400, fontSize: '13px' });
  const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px' };
  const btnPrimary: React.CSSProperties = { background: '#1e40af', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' };
  const btnSecondary: React.CSSProperties = { background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 };
  const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' };
  const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left' as const, borderBottom: '2px solid #e2e8f0', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '13px' };
  const tdRight: React.CSSProperties = { ...tdStyle, textAlign: 'right' as const, fontFamily: 'monospace' };
  const thRight: React.CSSProperties = { ...thStyle, textAlign: 'right' as const };
  const sectionHeader: React.CSSProperties = { fontSize: '14px', fontWeight: 700, color: '#1e293b', padding: '12px 12px 4px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' };
  const totalRow: React.CSSProperties = { fontWeight: 700, fontSize: '14px', borderTop: '2px solid #1e40af' };
  const badge = (s: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, color: '#fff', background: statusColors[s] || '#6b7280' });
  const modalOverlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const modalContent: React.CSSProperties = { background: '#fff', borderRadius: '12px', padding: '24px', width: '90%', maxWidth: '550px', maxHeight: '85vh', overflowY: 'auto' as const };
  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' };
  const fieldRow: React.CSSProperties = { display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' as const };
  const fieldCol: React.CSSProperties = { flex: '1 1 200px', minWidth: '160px' };

  const balanceIndicator = (isBalanced: boolean) => (
    <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, color: '#fff', background: isBalanced ? '#059669' : '#dc2626' }}>
      {isBalanced ? '✓ Balanced' : '✗ Out of Balance'}
    </span>
  );

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' as const, gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {breadcrumbs.map((b, i) => (<span key={i}>{b.href ? <a href={b.href} style={{ color: '#3b82f6', textDecoration: 'none' }}>{b.label}</a> : <span style={{ fontWeight: 600, color: '#1e293b' }}>{b.label}</span>}{i < breadcrumbs.length - 1 && ' / '}</span>))}
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>Financial Statements</h1>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', cursor: 'pointer' }} onClick={() => setError('')}>{error}</div>}
      {success && <div style={{ background: '#f0fdf4', color: '#059669', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', cursor: 'pointer' }} onClick={() => setSuccess('')}>{success}</div>}

      {/* Period selector */}
      <div style={{ ...cardStyle, display: 'flex', gap: '12px', flexWrap: 'wrap' as const, alignItems: 'flex-end' }}>
        {tab !== 'bs' ? (
          <>
            <div><label style={fieldLabel}>Period Start</label><input style={inputStyle} type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
            <div><label style={fieldLabel}>Period End</label><input style={inputStyle} type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
          </>
        ) : (
          <div><label style={fieldLabel}>As of Date</label><input style={inputStyle} type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} /></div>
        )}
        {tab === 'pl' && (
          <>
            <div><label style={fieldLabel}>Compare Start</label><input style={inputStyle} type="date" value={compStart} onChange={e => setCompStart(e.target.value)} /></div>
            <div><label style={fieldLabel}>Compare End</label><input style={inputStyle} type="date" value={compEnd} onChange={e => setCompEnd(e.target.value)} /></div>
          </>
        )}
        <button style={btnPrimary} onClick={() => {
          if (tab === 'pl') generatePL(); else if (tab === 'bs') generateBS();
          else if (tab === 'cf') generateCF(); else if (tab === 'tb') generateTB();
          else if (tab === 'budget') loadBudgets();
        }}>Generate</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0', flexWrap: 'wrap' as const }}>
        <button style={tabStyle(tab === 'pl')} onClick={() => setTab('pl')}>Income Statement</button>
        <button style={tabStyle(tab === 'bs')} onClick={() => setTab('bs')}>Balance Sheet</button>
        <button style={tabStyle(tab === 'cf')} onClick={() => setTab('cf')}>Cash Flow</button>
        <button style={tabStyle(tab === 'tb')} onClick={() => setTab('tb')}>Trial Balance</button>
        <button style={tabStyle(tab === 'snapshots')} onClick={() => setTab('snapshots')}>Saved</button>
        <button style={tabStyle(tab === 'budget')} onClick={() => setTab('budget')}>Budget</button>
      </div>

      {loading && <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', color: '#64748b' }}>Generating...</div>}

      {/* ═══════════ P&L ═══════════ */}
      {tab === 'pl' && !loading && plData && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Income Statement (P&L)</h2>
            <button style={btnSecondary} onClick={() => saveSnapshot('income_statement', `P&L — ${periodStart} to ${periodEnd}`, plData, { net_profit: plData.net_profit })}>Save Snapshot</button>
          </div>

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' as const }}>Revenue</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#059669' }}>{INR(plData.revenue.total)}</div>
            </div>
            <div style={{ background: '#fef2f2', padding: '16px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' as const }}>Expenses</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#dc2626' }}>{INR(plData.expenses.total)}</div>
            </div>
            <div style={{ background: plData.net_profit >= 0 ? '#f0fdf4' : '#fef2f2', padding: '16px', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' as const }}>Net Profit</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: plData.net_profit >= 0 ? '#059669' : '#dc2626' }}>{INR(plData.net_profit)}</div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thStyle}>Account</th>
              <th style={thRight}>Amount</th>
              {plData.comparison && <th style={thRight}>Comparison</th>}
              {plData.revenue.items.some((r: any) => r.budget) && <th style={thRight}>Budget</th>}
              {plData.revenue.items.some((r: any) => r.budget) && <th style={thRight}>Variance</th>}
            </tr></thead>
            <tbody>
              <tr><td colSpan={5} style={sectionHeader}>REVENUE</td></tr>
              {plData.revenue.items.map((r: any, i: number) => (
                <tr key={`r-${i}`}>
                  <td style={tdStyle}><span style={{ color: '#64748b', fontSize: '11px' }}>{r.code}</span> {r.name}</td>
                  <td style={tdRight}>{INR(r.amount)}</td>
                  {plData.comparison && <td style={tdRight}>{INR(plData.comparison.revenue_items.find((c: any) => c.code === r.code)?.amount || 0)}</td>}
                  {r.budget != null && <td style={tdRight}>{INR(r.budget)}</td>}
                  {r.variance != null && <td style={{ ...tdRight, color: r.variance >= 0 ? '#059669' : '#dc2626' }}>{r.variance >= 0 ? '+' : ''}{INR(r.variance)}</td>}
                </tr>
              ))}
              <tr style={totalRow}><td style={tdStyle}>Total Revenue</td><td style={tdRight}>{INR(plData.revenue.total)}</td>
                {plData.comparison && <td style={tdRight}>{INR(plData.comparison.total_revenue)}</td>}
                {plData.revenue.items.some((r: any) => r.budget) && <td colSpan={2} />}
              </tr>

              <tr><td colSpan={5} style={{ ...sectionHeader, marginTop: '8px' }}>EXPENSES</td></tr>
              {plData.expenses.items.map((e: any, i: number) => (
                <tr key={`e-${i}`}>
                  <td style={tdStyle}><span style={{ color: '#64748b', fontSize: '11px' }}>{e.code}</span> {e.name}</td>
                  <td style={tdRight}>{INR(e.amount)}</td>
                  {plData.comparison && <td style={tdRight}>{INR(plData.comparison.expense_items.find((c: any) => c.code === e.code)?.amount || 0)}</td>}
                  {e.budget != null && <td style={tdRight}>{INR(e.budget)}</td>}
                  {e.variance != null && <td style={{ ...tdRight, color: e.variance <= 0 ? '#059669' : '#dc2626' }}>{e.variance >= 0 ? '+' : ''}{INR(e.variance)}</td>}
                </tr>
              ))}
              <tr style={totalRow}><td style={tdStyle}>Total Expenses</td><td style={tdRight}>{INR(plData.expenses.total)}</td>
                {plData.comparison && <td style={tdRight}>{INR(plData.comparison.total_expenses)}</td>}
                {plData.expenses.items.some((e: any) => e.budget) && <td colSpan={2} />}
              </tr>

              <tr style={{ ...totalRow, background: plData.net_profit >= 0 ? '#f0fdf4' : '#fef2f2' }}>
                <td style={{ ...tdStyle, fontSize: '16px' }}>NET PROFIT</td>
                <td style={{ ...tdRight, fontSize: '16px', color: plData.net_profit >= 0 ? '#059669' : '#dc2626' }}>{INR(plData.net_profit)}</td>
                {plData.comparison && <td style={{ ...tdRight, fontSize: '16px' }}>{INR(plData.comparison.net_profit)}</td>}
                {plData.expenses.items.some((e: any) => e.budget) && <td colSpan={2} />}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════ BALANCE SHEET ═══════════ */}
      {tab === 'bs' && !loading && bsData && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Balance Sheet as of {bsData.as_of_date}</h2>
              <div style={{ marginTop: '4px' }}>{balanceIndicator(bsData.is_balanced)}</div>
            </div>
            <button style={btnSecondary} onClick={() => saveSnapshot('balance_sheet', `Balance Sheet — ${asOfDate}`, bsData, { is_balanced: bsData.is_balanced })}>Save Snapshot</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Assets */}
            <div>
              <div style={{ ...sectionHeader, background: '#f0fdf4' }}>ASSETS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {bsData.assets.items.map((a: any, i: number) => (
                    <tr key={i}><td style={tdStyle}><span style={{ color: '#64748b', fontSize: '11px' }}>{a.code}</span> {a.name}</td><td style={tdRight}>{INR(a.balance)}</td></tr>
                  ))}
                  <tr style={totalRow}><td style={tdStyle}>Total Assets</td><td style={tdRight}>{INR(bsData.assets.total)}</td></tr>
                </tbody>
              </table>
            </div>

            {/* Liabilities + Equity */}
            <div>
              <div style={{ ...sectionHeader, background: '#fef2f2' }}>LIABILITIES</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {bsData.liabilities.items.map((l: any, i: number) => (
                    <tr key={i}><td style={tdStyle}><span style={{ color: '#64748b', fontSize: '11px' }}>{l.code}</span> {l.name}</td><td style={tdRight}>{INR(l.balance)}</td></tr>
                  ))}
                  <tr style={totalRow}><td style={tdStyle}>Total Liabilities</td><td style={tdRight}>{INR(bsData.liabilities.total)}</td></tr>
                </tbody>
              </table>

              <div style={{ ...sectionHeader, background: '#f0f9ff', marginTop: '12px' }}>EQUITY</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {bsData.equity.items.map((e: any, i: number) => (
                    <tr key={i}><td style={tdStyle}><span style={{ color: '#64748b', fontSize: '11px' }}>{e.code}</span> {e.name}</td><td style={tdRight}>{INR(e.balance)}</td></tr>
                  ))}
                  <tr style={totalRow}><td style={tdStyle}>Total Equity</td><td style={tdRight}>{INR(bsData.equity.total)}</td></tr>
                </tbody>
              </table>

              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>L + E = {INR(bsData.accounting_equation.liabilities_plus_equity)}</div>
                {!bsData.is_balanced && <div style={{ color: '#dc2626', fontSize: '12px' }}>Difference: {INR(bsData.accounting_equation.difference)}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CASH FLOW ═══════════ */}
      {tab === 'cf' && !loading && cfData && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Cash Flow Statement</h2>
            <button style={btnSecondary} onClick={() => saveSnapshot('cash_flow', `Cash Flow — ${periodStart} to ${periodEnd}`, cfData)}>Save Snapshot</button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td colSpan={2} style={sectionHeader}>OPERATING ACTIVITIES</td></tr>
              <tr><td style={tdStyle}>Net Income</td><td style={tdRight}>{INR(cfData.operating.net_income)}</td></tr>
              {cfData.operating.add_back_depreciation > 0 && <tr><td style={tdStyle}>Add: Depreciation</td><td style={tdRight}>{INR(cfData.operating.add_back_depreciation)}</td></tr>}
              {cfData.operating.add_back_interest > 0 && <tr><td style={tdStyle}>Add: Interest</td><td style={tdRight}>{INR(cfData.operating.add_back_interest)}</td></tr>}
              {cfData.operating.ebitda !== cfData.operating.net_income && <tr style={{ fontWeight: 600 }}><td style={tdStyle}>EBITDA</td><td style={tdRight}>{INR(cfData.operating.ebitda)}</td></tr>}
              <tr style={totalRow}><td style={tdStyle}>Net Cash from Operations</td><td style={tdRight}>{INR(cfData.operating.total)}</td></tr>

              <tr><td colSpan={2} style={{ ...sectionHeader, marginTop: '8px' }}>INVESTING ACTIVITIES</td></tr>
              {cfData.investing.items.map((i: any, idx: number) => (
                <tr key={idx}><td style={tdStyle}>{i.name}</td><td style={tdRight}>{INR(i.amount)}</td></tr>
              ))}
              {cfData.investing.items.length === 0 && <tr><td style={tdStyle} colSpan={2}>No investing activities</td></tr>}
              <tr style={totalRow}><td style={tdStyle}>Net Cash from Investing</td><td style={tdRight}>{INR(cfData.investing.total)}</td></tr>

              <tr><td colSpan={2} style={{ ...sectionHeader, marginTop: '8px' }}>FINANCING ACTIVITIES</td></tr>
              {cfData.financing.items.map((f: any, idx: number) => (
                <tr key={idx}><td style={tdStyle}>{f.name}</td><td style={tdRight}>{INR(f.amount)}</td></tr>
              ))}
              {cfData.financing.items.length === 0 && <tr><td style={tdStyle} colSpan={2}>No financing activities</td></tr>}
              <tr style={totalRow}><td style={tdStyle}>Net Cash from Financing</td><td style={tdRight}>{INR(cfData.financing.total)}</td></tr>

              <tr style={{ ...totalRow, background: cfData.net_cash_change >= 0 ? '#f0fdf4' : '#fef2f2' }}>
                <td style={{ ...tdStyle, fontSize: '16px' }}>NET CHANGE IN CASH</td>
                <td style={{ ...tdRight, fontSize: '16px', color: cfData.net_cash_change >= 0 ? '#059669' : '#dc2626' }}>{INR(cfData.net_cash_change)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════ TRIAL BALANCE ═══════════ */}
      {tab === 'tb' && !loading && tbData && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Trial Balance</h2>
              <div style={{ marginTop: '4px' }}>{balanceIndicator(tbData.is_balanced)}</div>
            </div>
            <button style={btnSecondary} onClick={() => saveSnapshot('trial_balance', `Trial Balance — ${periodStart} to ${periodEnd}`, tbData, { total_debit: tbData.total_debit, total_credit: tbData.total_credit, is_balanced: tbData.is_balanced })}>Save Snapshot</button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Account</th>
              <th style={thStyle}>Type</th>
              <th style={thRight}>Debit</th>
              <th style={thRight}>Credit</th>
              <th style={thRight}>Balance</th>
            </tr></thead>
            <tbody>
              {tbData.items.map((r: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>{r.account_code}</td>
                  <td style={tdStyle}>{r.account_name}</td>
                  <td style={tdStyle}><span style={{ fontSize: '11px', color: '#64748b' }}>{label(r.account_type)}</span></td>
                  <td style={tdRight}>{r.debit > 0 ? INR(r.debit) : '—'}</td>
                  <td style={tdRight}>{r.credit > 0 ? INR(r.credit) : '—'}</td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>{INR(r.closing_balance)}</td>
                </tr>
              ))}
              {tbData.items.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No posted journal entries in this period</td></tr>}
              <tr style={{ ...totalRow, background: '#f8fafc' }}>
                <td style={tdStyle} colSpan={3}>TOTALS</td>
                <td style={tdRight}>{INR(tbData.total_debit)}</td>
                <td style={tdRight}>{INR(tbData.total_credit)}</td>
                <td style={{ ...tdRight, color: tbData.is_balanced ? '#059669' : '#dc2626' }}>{tbData.is_balanced ? '✓' : INR(tbData.difference)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════ SNAPSHOTS ═══════════ */}
      {tab === 'snapshots' && (
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Saved Statements</h2>
          {snapshotLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created</th>
              </tr></thead>
              <tbody>
                {snapshots.map((s: any) => (
                  <tr key={s.id}>
                    <td style={tdStyle}><span style={{ fontWeight: 600 }}>{s.title}</span></td>
                    <td style={tdStyle}>{label(s.statement_type)}</td>
                    <td style={tdStyle}>{s.period_start} → {s.period_end}</td>
                    <td style={tdStyle}><span style={badge(s.status)}>{label(s.status)}</span></td>
                    <td style={tdStyle}>{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {snapshots.length === 0 && <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No saved statements</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══════════ BUDGET ═══════════ */}
      {tab === 'budget' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Budget Entries</h2>
            <button style={btnPrimary} onClick={() => { setBf({ account_id: '', account_code: '', account_name: '', period_start: periodStart, period_end: periodEnd, budget_amount: '', notes: '' }); setShowBudgetModal(true); }}>+ New Budget Entry</button>
          </div>
          {budgetLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Account</th>
                <th style={thRight}>Budget</th>
                <th style={thRight}>Revised</th>
                <th style={thStyle}>Status</th>
              </tr></thead>
              <tbody>
                {budgets.map((b: any) => (
                  <tr key={b.id}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>{b.account_code}</td>
                    <td style={tdStyle}>{b.account_name}</td>
                    <td style={tdRight}>{INR(b.budget_amount)}</td>
                    <td style={tdRight}>{b.revised_amount ? INR(b.revised_amount) : '—'}</td>
                    <td style={tdStyle}><span style={badge(b.status)}>{label(b.status)}</span></td>
                  </tr>
                ))}
                {budgets.length === 0 && <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No budget entries for this period</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══════════ BUDGET MODAL ═══════════ */}
      {showBudgetModal && (
        <div style={modalOverlay} onClick={() => setShowBudgetModal(false)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>New Budget Entry</h2>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Account ID (UUID) *</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} value={bf.account_id} onChange={e => setBf({ ...bf, account_id: e.target.value })} placeholder="Paste from CoA" /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Account Code *</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} value={bf.account_code} onChange={e => setBf({ ...bf, account_code: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Account Name *</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} value={bf.account_name} onChange={e => setBf({ ...bf, account_name: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Period Start *</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} type="date" value={bf.period_start} onChange={e => setBf({ ...bf, period_start: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Period End *</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} type="date" value={bf.period_end} onChange={e => setBf({ ...bf, period_end: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Budget Amount *</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} type="number" value={bf.budget_amount} onChange={e => setBf({ ...bf, budget_amount: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={{ flex: '1 1 100%' }}><label style={fieldLabel}>Notes</label><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }} value={bf.notes} onChange={e => setBf({ ...bf, notes: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowBudgetModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={saveBudget}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
