'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ─── tRPC helpers ───────────────────────────
async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json ?? json.result?.data ?? json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json ?? json.result?.data ?? json;
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  narration: string;
  total_debit: string;
  total_credit: string;
  status: string;
  reference_type: string | null;
  created_at: string;
}

interface LedgerAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: string;
}

interface LineItem {
  account_id: string;
  account_label: string;
  debit_amount: number;
  credit_amount: number;
  narration: string;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft: { bg: '#fef3c7', color: '#92400e' },
  posted: { bg: '#dcfce7', color: '#166534' },
  reversed: { bg: '#fce7f3', color: '#9d174d' },
  voided: { bg: '#f3f4f6', color: '#6b7280' },
};

const TYPE_LABELS: Record<string, string> = {
  auto_billing: 'Auto — Billing',
  auto_collection: 'Auto — Collection',
  auto_deposit: 'Auto — Deposit',
  auto_refund: 'Auto — Refund',
  auto_waiver: 'Auto — Waiver',
  auto_pharmacy: 'Auto — Pharmacy',
  auto_payroll: 'Auto — Payroll',
  auto_vendor: 'Auto — Vendor',
  manual: 'Manual',
  adjustment: 'Adjustment',
  opening_balance: 'Opening Balance',
  closing: 'Closing',
};

function formatCurrency(val: string | number): string {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num);
}

export default function JournalEntriesAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [tab, setTab] = useState<'list' | 'create' | 'gl' | 'trial'>('list');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');

  // Detail view
  const [detail, setDetail] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);

  // GL View
  const [glAccounts, setGlAccounts] = useState<LedgerAccount[]>([]);
  const [glAccountId, setGlAccountId] = useState('');
  const [glData, setGlData] = useState<any>(null);

  // Trial Balance
  const [trialData, setTrialData] = useState<any>(null);

  // Create form
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize: 25 };
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.entry_type = filterType;
      if (search) params.search = search;
      const data = await trpcQuery('journalEntries.list', params);
      setEntries(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error('Load entries:', err);
    }
    setLoading(false);
  }, [page, filterStatus, filterType, search]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await trpcQuery('financeChart.ledgerAccounts', {});
      setAccounts(data || []);
      setGlAccounts(data || []);
    } catch (err: any) {
      console.error('Load accounts:', err);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (tab === 'list') loadEntries();
  }, [tab, loadEntries]);

  const viewDetail = async (id: string) => {
    try {
      const data = await trpcQuery('journalEntries.get', { id });
      setDetail(data);
      setShowDetail(true);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const postEntry = async (id: string) => {
    if (!confirm('Post this journal entry? Posted entries affect the general ledger.')) return;
    try {
      await trpcMutate('journalEntries.post', { id });
      loadEntries();
      if (showDetail) viewDetail(id);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const reverseEntry = async (id: string) => {
    const reason = prompt('Reason for reversal:');
    if (!reason) return;
    try {
      const result = await trpcMutate('journalEntries.reverse', { id, reason });
      alert(`Reversed. New entry: ${result.reversal_number}`);
      loadEntries();
      setShowDetail(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const voidEntry = async (id: string) => {
    const reason = prompt('Reason for voiding:');
    if (!reason) return;
    try {
      await trpcMutate('journalEntries.void', { id, reason });
      loadEntries();
      setShowDetail(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const loadGl = async () => {
    if (!glAccountId) return;
    setLoading(true);
    try {
      const data = await trpcQuery('journalEntries.glView', { account_id: glAccountId });
      setGlData(data);
    } catch (err: any) {
      console.error('GL view:', err);
    }
    setLoading(false);
  };

  const loadTrialBalance = async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('journalEntries.trialBalance', {});
      setTrialData(data);
    } catch (err: any) {
      console.error('Trial balance:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (tab === 'trial') loadTrialBalance();
  }, [tab]);

  // ─── RENDER ───────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Breadcrumbs */}
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
        {breadcrumbs.map((b, i) => (
          <span key={i}>
            {b.href ? <a href={b.href} style={{ color: '#2563eb', textDecoration: 'none' }}>{b.label}</a> : <span style={{ color: '#111827' }}>{b.label}</span>}
            {i < breadcrumbs.length - 1 && ' / '}
          </span>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: 0 }}>Journal Entries & General Ledger</h1>
          <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Double-entry accounting with balanced constraint</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', borderBottom: '2px solid #e5e7eb' }}>
        {[
          { key: 'list', label: 'Journal Entries' },
          { key: 'create', label: '+ New Entry' },
          { key: 'gl', label: 'GL View' },
          { key: 'trial', label: 'Trial Balance' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            style={{
              padding: '8px 20px',
              background: tab === t.key ? '#2563eb' : 'transparent',
              color: tab === t.key ? 'white' : '#6b7280',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              fontSize: '14px',
              fontWeight: tab === t.key ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── LIST TAB ─────────────── */}
      {tab === 'list' && (
        <div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
              <option value="voided">Voided</option>
            </select>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}>
              <option value="">All Types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input
              type="text" placeholder="Search by number or narration..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', width: '250px' }}
            />
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' as const, color: '#6b7280' }}>Loading...</div>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Entry #</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Date</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Type</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Narration</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Amount</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(je => {
                    const sc = STATUS_COLORS[je.status] || STATUS_COLORS.draft;
                    return (
                      <tr key={je.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                          <a onClick={() => viewDetail(je.id)} style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'none' }}>{je.entry_number}</a>
                        </td>
                        <td style={{ padding: '8px 12px' }}>{je.entry_date}</td>
                        <td style={{ padding: '8px 12px', fontSize: '12px' }}>{TYPE_LABELS[je.entry_type] || je.entry_type}</td>
                        <td style={{ padding: '8px 12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{je.narration}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace' }}>{formatCurrency(je.total_debit)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
                          <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '11px', background: sc.bg, color: sc.color, fontWeight: 600 }}>{je.status}</span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
                          {je.status === 'draft' && (
                            <>
                              <button onClick={() => postEntry(je.id)} style={{ padding: '2px 8px', fontSize: '11px', background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: '4px', cursor: 'pointer', marginRight: '4px' }}>Post</button>
                              <button onClick={() => voidEntry(je.id)} style={{ padding: '2px 8px', fontSize: '11px', background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}>Void</button>
                            </>
                          )}
                          {je.status === 'posted' && (
                            <button onClick={() => reverseEntry(je.id)} style={{ padding: '2px 8px', fontSize: '11px', background: '#fce7f3', color: '#9d174d', border: '1px solid #fbcfe8', borderRadius: '4px', cursor: 'pointer' }}>Reverse</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {entries.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: '24px', textAlign: 'center' as const, color: '#9ca3af' }}>No journal entries found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '13px', color: '#6b7280' }}>
            <span>Showing {entries.length} of {total}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>Prev</button>
              <span style={{ padding: '4px 8px' }}>Page {page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={entries.length < 25} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: entries.length < 25 ? 'not-allowed' : 'pointer', opacity: entries.length < 25 ? 0.5 : 1 }}>Next</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CREATE TAB ─────────────── */}
      {tab === 'create' && (
        <CreateJournalEntry accounts={accounts} onCreated={() => { setTab('list'); loadEntries(); }} />
      )}

      {/* ─── GL VIEW TAB ─────────────── */}
      {tab === 'gl' && (
        <div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Select Account</label>
              <select value={glAccountId} onChange={e => setGlAccountId(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}>
                <option value="">— Select an account —</option>
                {glAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
                ))}
              </select>
            </div>
            <button onClick={loadGl} disabled={!glAccountId} style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: glAccountId ? 'pointer' : 'not-allowed', opacity: glAccountId ? 1 : 0.5, fontWeight: 500 }}>
              View Ledger
            </button>
          </div>

          {loading && <div style={{ padding: '40px', textAlign: 'center' as const, color: '#6b7280' }}>Loading...</div>}

          {glData && !loading && (
            <div>
              <div style={{ padding: '16px', background: '#f9fafb', borderRadius: '8px', marginBottom: '16px', display: 'flex', gap: '24px', flexWrap: 'wrap' as const }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Account</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>{glData.account.account_code} — {glData.account.account_name}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Debit</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#2563eb' }}>{formatCurrency(glData.summary.total_debit)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Credit</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#dc2626' }}>{formatCurrency(glData.summary.total_credit)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Balance ({glData.summary.balance_type})</div>
                  <div style={{ fontSize: '16px', fontWeight: 700 }}>{formatCurrency(glData.summary.balance)}</div>
                </div>
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Date</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Entry #</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Narration</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Debit</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Credit</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glData.lines.map((line: any) => (
                      <tr key={line.line_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px' }}>{line.entry_date}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{line.entry_number}</td>
                        <td style={{ padding: '8px 12px' }}>{line.je_narration}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: Number(line.debit_amount) > 0 ? '#2563eb' : '#d1d5db' }}>
                          {Number(line.debit_amount) > 0 ? formatCurrency(line.debit_amount) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: Number(line.credit_amount) > 0 ? '#dc2626' : '#d1d5db' }}>
                          {Number(line.credit_amount) > 0 ? formatCurrency(line.credit_amount) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', fontWeight: 600 }}>
                          {formatCurrency(line.running_balance)}
                        </td>
                      </tr>
                    ))}
                    {glData.lines.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' as const, color: '#9ca3af' }}>No posted transactions for this account</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TRIAL BALANCE TAB ─────────────── */}
      {tab === 'trial' && (
        <div>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' as const, color: '#6b7280' }}>Loading...</div>
          ) : trialData ? (
            <div>
              <div style={{ padding: '16px', background: trialData.is_balanced ? '#dcfce7' : '#fef2f2', borderRadius: '8px', marginBottom: '16px', display: 'flex', gap: '24px', alignItems: 'center' }}>
                <span style={{ fontSize: '20px' }}>{trialData.is_balanced ? '✓' : '!'}</span>
                <div>
                  <div style={{ fontWeight: 600, color: trialData.is_balanced ? '#166534' : '#991b1b' }}>
                    {trialData.is_balanced ? 'Trial Balance is BALANCED' : 'Trial Balance IMBALANCE DETECTED'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    Total Debit: {formatCurrency(trialData.grand_total_debit)} | Total Credit: {formatCurrency(trialData.grand_total_credit)}
                  </div>
                </div>
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Code</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Account</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' as const, fontWeight: 600, color: '#6b7280' }}>Type</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Debit</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialData.accounts.map((a: any) => (
                      <tr key={a.account_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{a.account_code}</td>
                        <td style={{ padding: '8px 12px' }}>{a.account_name}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' as const, textTransform: 'capitalize' as const, fontSize: '12px' }}>{a.account_type}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: a.tb_debit > 0 ? '#111827' : '#d1d5db' }}>
                          {a.tb_debit > 0 ? formatCurrency(a.tb_debit) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: a.tb_credit > 0 ? '#111827' : '#d1d5db' }}>
                          {a.tb_credit > 0 ? formatCurrency(a.tb_credit) : '—'}
                        </td>
                      </tr>
                    ))}
                    {trialData.accounts.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center' as const, color: '#9ca3af' }}>No posted entries yet</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
                      <td colSpan={3} style={{ padding: '10px 12px', textAlign: 'right' as const }}>TOTALS</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' as const, fontFamily: 'monospace' }}>{formatCurrency(trialData.grand_total_debit)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' as const, fontFamily: 'monospace' }}>{formatCurrency(trialData.grand_total_credit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ─── Detail Modal ─────────────── */}
      {showDetail && detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '700px', maxHeight: '80vh', overflowY: 'auto' as const }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{detail.entry_number}</h2>
              <button onClick={() => setShowDetail(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#6b7280' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px', fontSize: '13px' }}>
              <div><span style={{ color: '#6b7280' }}>Date:</span> {detail.entry_date}</div>
              <div><span style={{ color: '#6b7280' }}>Type:</span> {TYPE_LABELS[detail.entry_type] || detail.entry_type}</div>
              <div><span style={{ color: '#6b7280' }}>Status:</span> <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', background: STATUS_COLORS[detail.status]?.bg, color: STATUS_COLORS[detail.status]?.color, fontWeight: 600 }}>{detail.status}</span></div>
              <div><span style={{ color: '#6b7280' }}>Amount:</span> {formatCurrency(detail.total_debit)}</div>
            </div>

            <div style={{ marginBottom: '16px', fontSize: '13px' }}>
              <span style={{ color: '#6b7280' }}>Narration:</span> {detail.narration}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Account</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Debit</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280' }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines?.map((line: any) => (
                  <tr key={line.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px' }}><span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#6b7280' }}>{line.account_code}</span> {line.account_name}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: Number(line.debit_amount) > 0 ? '#2563eb' : '#d1d5db' }}>
                      {Number(line.debit_amount) > 0 ? formatCurrency(line.debit_amount) : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: Number(line.credit_amount) > 0 ? '#dc2626' : '#d1d5db' }}>
                      {Number(line.credit_amount) > 0 ? formatCurrency(line.credit_amount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
                  <td style={{ padding: '8px 12px' }}>TOTAL</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace' }}>{formatCurrency(detail.total_debit)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' as const, fontFamily: 'monospace' }}>{formatCurrency(detail.total_credit)}</td>
                </tr>
              </tfoot>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              {detail.status === 'draft' && (
                <>
                  <button onClick={() => postEntry(detail.id)} style={{ padding: '8px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}>Post Entry</button>
                  <button onClick={() => voidEntry(detail.id)} style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>Void</button>
                </>
              )}
              {detail.status === 'posted' && (
                <button onClick={() => reverseEntry(detail.id)} style={{ padding: '8px 16px', background: '#9d174d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}>Reverse</button>
              )}
              <button onClick={() => setShowDetail(false)} style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Create Journal Entry Form ───────────────────────────
function CreateJournalEntry({ accounts, onCreated }: { accounts: LedgerAccount[]; onCreated: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<LineItem[]>([
    { account_id: '', account_label: '', debit_amount: 0, credit_amount: 0, narration: '' },
    { account_id: '', account_label: '', debit_amount: 0, credit_amount: 0, narration: '' },
  ]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const totalDebit = lines.reduce((s, l) => s + l.debit_amount, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit_amount, 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = Math.abs(difference) < 0.01;

  const updateLine = (idx: number, field: string, value: any) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addLine = () => {
    setLines(prev => [...prev, { account_id: '', account_label: '', debit_amount: 0, credit_amount: 0, narration: '' }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 2) return;
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setError('');
    if (!narration.trim()) { setError('Narration is required'); return; }
    if (!isBalanced) { setError(`Entry must balance. Difference: ${formatCurrency(difference)}`); return; }

    const validLines = lines.filter(l => l.account_id && (l.debit_amount > 0 || l.credit_amount > 0));
    if (validLines.length < 2) { setError('At least 2 lines with amounts are required'); return; }

    setSaving(true);
    try {
      await trpcMutate('journalEntries.create', {
        entry_date: date,
        narration,
        lines: validLines.map(l => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount,
          credit_amount: l.credit_amount,
          narration: l.narration || undefined,
        })),
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create');
    }
    setSaving(false);
  };

  const inputStyle = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', width: '100%', boxSizing: 'border-box' as const };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px', marginBottom: '20px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Entry Date *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Narration *</label>
          <input type="text" value={narration} onChange={e => setNarration(e.target.value)} style={inputStyle} placeholder="e.g., Manual adjustment for prepaid insurance" />
        </div>
      </div>

      {/* Line items */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280', width: '40%' }}>Account</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280', width: '20%' }}>Debit</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' as const, fontWeight: 600, color: '#6b7280', width: '20%' }}>Credit</th>
              <th style={{ padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, color: '#6b7280' }}>Note</th>
              <th style={{ padding: '8px 12px', width: '40px' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 8px' }}>
                  <select
                    value={line.account_id}
                    onChange={e => {
                      const acct = accounts.find(a => a.id === e.target.value);
                      updateLine(idx, 'account_id', e.target.value);
                      updateLine(idx, 'account_label', acct ? `${acct.account_code} — ${acct.account_name}` : '');
                    }}
                    style={{ ...inputStyle, fontSize: '12px' }}
                  >
                    <option value="">Select account...</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input
                    type="number" min="0" step="0.01"
                    value={line.debit_amount || ''}
                    onChange={e => { updateLine(idx, 'debit_amount', parseFloat(e.target.value) || 0); if (parseFloat(e.target.value) > 0) updateLine(idx, 'credit_amount', 0); }}
                    style={{ ...inputStyle, textAlign: 'right' as const }}
                    placeholder="0.00"
                  />
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input
                    type="number" min="0" step="0.01"
                    value={line.credit_amount || ''}
                    onChange={e => { updateLine(idx, 'credit_amount', parseFloat(e.target.value) || 0); if (parseFloat(e.target.value) > 0) updateLine(idx, 'debit_amount', 0); }}
                    style={{ ...inputStyle, textAlign: 'right' as const }}
                    placeholder="0.00"
                  />
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input type="text" value={line.narration} onChange={e => updateLine(idx, 'narration', e.target.value)} style={{ ...inputStyle, fontSize: '12px' }} placeholder="Optional" />
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center' as const }}>
                  {lines.length > 2 && (
                    <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '16px' }}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
              <td style={{ padding: '10px 12px' }}>
                <button onClick={addLine} style={{ padding: '4px 12px', fontSize: '12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer' }}>+ Add Line</button>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: '#2563eb' }}>{formatCurrency(totalDebit)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right' as const, fontFamily: 'monospace', color: '#dc2626' }}>{formatCurrency(totalCredit)}</td>
              <td colSpan={2} style={{ padding: '10px 12px', fontSize: '12px' }}>
                {isBalanced ? (
                  <span style={{ color: '#059669', fontWeight: 600 }}>Balanced ✓</span>
                ) : (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>Diff: {formatCurrency(difference)}</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px', fontSize: '13px', marginBottom: '12px' }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          onClick={handleSubmit}
          disabled={saving || !isBalanced}
          style={{
            padding: '10px 24px',
            background: isBalanced ? '#2563eb' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: saving || !isBalanced ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving...' : 'Save as Draft'}
        </button>
      </div>
    </div>
  );
}

