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

const AR_TYPES = ['patient', 'insurance'] as const;
const AR_STATUSES = ['open', 'partially_paid', 'paid', 'written_off', 'disputed'] as const;
const AGING_BUCKETS = ['current', '1_30', '31_60', '61_90', '91_plus'] as const;
const ACTION_TYPES = ['phone_call', 'sms', 'email', 'letter', 'dunning_notice', 'legal_notice', 'write_off_request', 'escalation', 'note'] as const;

const statusColors: Record<string, string> = {
  open: '#3b82f6', partially_paid: '#d97706', paid: '#059669', written_off: '#6b7280', disputed: '#dc2626',
  current: '#059669', '1_30': '#84cc16', '31_60': '#eab308', '61_90': '#f97316', '91_plus': '#dc2626',
  matched: '#059669', partial: '#d97706', unidentified: '#dc2626', overpayment: '#8b5cf6',
};
const bucketLabels: Record<string, string> = {
  current: 'Current', '1_30': '1-30 Days', '31_60': '31-60 Days', '61_90': '61-90 Days', '91_plus': '90+ Days',
};

export default function AccountsReceivableAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [tab, setTab] = useState<'ledger' | 'aging' | 'unidentified' | 'tpa'>('ledger');

  // Ledger state
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bucketFilter, setBucketFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);

  // Aging state
  const [agingData, setAgingData] = useState<any>(null);
  const [agingType, setAgingType] = useState('');
  const [agingLoading, setAgingLoading] = useState(false);

  // Unidentified state
  const [unidentified, setUnidentified] = useState<any[]>([]);
  const [unidLoading, setUnidLoading] = useState(false);

  // TPA state
  const [tpaData, setTpaData] = useState<any[]>([]);
  const [tpaLoading, setTpaLoading] = useState(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showWriteOffModal, setShowWriteOffModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [showUnidModal, setShowUnidModal] = useState(false);
  const [selectedAr, setSelectedAr] = useState<any>(null);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Load ledger ──
  const loadLedger = useCallback(async () => {
    setLoading(true);
    try {
      const input: any = { page, pageSize: 25 };
      if (search) input.search = search;
      if (typeFilter) input.ar_type = typeFilter;
      if (statusFilter) input.status = statusFilter;
      if (bucketFilter) input.aging_bucket = bucketFilter;
      const data = await trpcQuery('accountsReceivable.list', input);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [page, search, typeFilter, statusFilter, bucketFilter]);

  const loadAging = useCallback(async () => {
    setAgingLoading(true);
    try {
      const input: any = {};
      if (agingType) input.ar_type = agingType;
      const data = await trpcQuery('accountsReceivable.agingSummary', input);
      setAgingData(data);
    } catch (e: any) { setError(e.message); }
    setAgingLoading(false);
  }, [agingType]);

  const loadUnidentified = useCallback(async () => {
    setUnidLoading(true);
    try {
      const data = await trpcQuery('accountsReceivable.listUnidentifiedPayments');
      setUnidentified(data || []);
    } catch (e: any) { setError(e.message); }
    setUnidLoading(false);
  }, []);

  const loadTpa = useCallback(async () => {
    setTpaLoading(true);
    try {
      const data = await trpcQuery('accountsReceivable.tpaAgingSummary');
      setTpaData(data || []);
    } catch (e: any) { setError(e.message); }
    setTpaLoading(false);
  }, []);

  useEffect(() => { if (tab === 'ledger') loadLedger(); }, [tab, loadLedger]);
  useEffect(() => { if (tab === 'aging') loadAging(); }, [tab, loadAging]);
  useEffect(() => { if (tab === 'unidentified') loadUnidentified(); }, [tab, loadUnidentified]);
  useEffect(() => { if (tab === 'tpa') loadTpa(); }, [tab, loadTpa]);

  // ── View detail ──
  const viewDetail = async (id: string) => {
    try {
      const data = await trpcQuery('accountsReceivable.get', { id });
      setDetailItem(data);
    } catch (e: any) { setError(e.message); }
  };

  // ── Create form ──
  const [cf, setCf] = useState<any>({});
  const resetCreate = () => setCf({ ar_type: 'patient', patient_name: '', invoice_number: '', tpa_name: '', claim_number: '', policy_number: '', original_amount: '', invoice_date: '', due_date: '', notes: '' });

  const saveCreate = async () => {
    setError('');
    try {
      const input: any = {
        ar_type: cf.ar_type,
        original_amount: Number(cf.original_amount),
        invoice_date: cf.invoice_date,
        due_date: cf.due_date,
        notes: cf.notes || undefined,
      };
      if (cf.ar_type === 'patient') {
        input.patient_name = cf.patient_name;
        input.invoice_number = cf.invoice_number || undefined;
      } else {
        input.tpa_name = cf.tpa_name;
        input.claim_number = cf.claim_number || undefined;
        input.policy_number = cf.policy_number || undefined;
      }
      await trpcMutate('accountsReceivable.create', input);
      setSuccess('AR entry created');
      setShowCreateModal(false);
      loadLedger();
    } catch (e: any) { setError(e.message); }
  };

  // ── Record payment ──
  const [pf, setPf] = useState<any>({});
  const savePayment = async () => {
    setError('');
    try {
      await trpcMutate('accountsReceivable.recordPayment', {
        ar_ledger_id: selectedAr.id,
        amount: Number(pf.amount),
        payment_reference: pf.payment_reference,
        payment_date: pf.payment_date,
        payment_method: pf.payment_method || undefined,
        payer_name: pf.payer_name || undefined,
      });
      setSuccess('Payment recorded');
      setShowPaymentModal(false);
      loadLedger();
      if (detailItem) viewDetail(detailItem.id);
    } catch (e: any) { setError(e.message); }
  };

  // ── Collection action ──
  const [af, setAf] = useState<any>({});
  const saveAction = async () => {
    setError('');
    try {
      await trpcMutate('accountsReceivable.addCollectionAction', {
        ar_ledger_id: selectedAr.id,
        action_type: af.action_type,
        action_date: af.action_date,
        scheduled_date: af.scheduled_date || undefined,
        outcome: af.outcome || undefined,
        notes: af.notes || undefined,
        completed: af.completed || false,
      });
      setSuccess('Collection action recorded');
      setShowActionModal(false);
      if (detailItem) viewDetail(detailItem.id);
    } catch (e: any) { setError(e.message); }
  };

  // ── Write-off ──
  const [wf, setWf] = useState<any>({});
  const saveWriteOff = async () => {
    setError('');
    try {
      await trpcMutate('accountsReceivable.writeOff', { id: selectedAr.id, amount: Number(wf.amount), reason: wf.reason });
      setSuccess('Write-off recorded');
      setShowWriteOffModal(false);
      loadLedger();
    } catch (e: any) { setError(e.message); }
  };

  // ── Match payment ──
  const matchPayment = async (arId: string) => {
    setError('');
    try {
      await trpcMutate('accountsReceivable.matchPayment', { payment_id: selectedPayment.id, ar_ledger_id: arId });
      setSuccess('Payment matched');
      setShowMatchModal(false);
      loadUnidentified();
      loadLedger();
    } catch (e: any) { setError(e.message); }
  };

  // ── Unidentified payment ──
  const [uf, setUf] = useState<any>({});
  const saveUnidentified = async () => {
    setError('');
    try {
      await trpcMutate('accountsReceivable.recordUnidentifiedPayment', {
        payment_reference: uf.payment_reference,
        payment_date: uf.payment_date,
        payment_method: uf.payment_method || undefined,
        payer_name: uf.payer_name || undefined,
        amount: Number(uf.amount),
      });
      setSuccess('Payment recorded');
      setShowUnidModal(false);
      loadUnidentified();
    } catch (e: any) { setError(e.message); }
  };

  // Refresh aging
  const doRefreshAging = async () => {
    try {
      const result = await trpcMutate('accountsReceivable.refreshAging');
      setSuccess(`Aging refreshed: ${result.updated} entries updated`);
      loadAging();
      loadLedger();
    } catch (e: any) { setError(e.message); }
  };

  // ── Styles ──
  const tabStyle = (active: boolean): React.CSSProperties => ({ padding: '10px 20px', cursor: 'pointer', border: 'none', background: active ? '#1e40af' : '#f1f5f9', color: active ? '#fff' : '#374151', borderRadius: '8px 8px 0 0', fontWeight: active ? 600 : 400, fontSize: '14px' });
  const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px' };
  const btnPrimary: React.CSSProperties = { background: '#1e40af', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' };
  const btnSecondary: React.CSSProperties = { background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 };
  const btnDanger: React.CSSProperties = { background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' as const };
  const selectStyle: React.CSSProperties = { ...inputStyle };
  const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left' as const, borderBottom: '2px solid #e2e8f0', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '13px' };
  const badge = (status: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, color: '#fff', background: statusColors[status] || '#6b7280' });
  const modalOverlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const modalContent: React.CSSProperties = { background: '#fff', borderRadius: '12px', padding: '24px', width: '90%', maxWidth: '650px', maxHeight: '85vh', overflowY: 'auto' as const };
  const fieldRow: React.CSSProperties = { display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' as const };
  const fieldCol: React.CSSProperties = { flex: '1 1 200px', minWidth: '200px' };
  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' as const, gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {breadcrumbs.map((b, i) => (
              <span key={i}>{b.href ? <a href={b.href} style={{ color: '#3b82f6', textDecoration: 'none' }}>{b.label}</a> : <span style={{ fontWeight: 600, color: '#1e293b' }}>{b.label}</span>}{i < breadcrumbs.length - 1 && ' / '}</span>
            ))}
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>Accounts Receivable</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {tab === 'ledger' && <button style={btnPrimary} onClick={() => { resetCreate(); setShowCreateModal(true); }}>+ New AR Entry</button>}
          {tab === 'unidentified' && <button style={btnPrimary} onClick={() => { setUf({}); setShowUnidModal(true); }}>+ Record Payment</button>}
          {tab === 'aging' && <button style={btnSecondary} onClick={doRefreshAging}>Refresh Aging</button>}
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', cursor: 'pointer' }} onClick={() => setError('')}>{error}</div>}
      {success && <div style={{ background: '#f0fdf4', color: '#059669', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', cursor: 'pointer' }} onClick={() => setSuccess('')}>{success}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0' }}>
        <button style={tabStyle(tab === 'ledger')} onClick={() => setTab('ledger')}>AR Ledger</button>
        <button style={tabStyle(tab === 'aging')} onClick={() => setTab('aging')}>Aging Analysis</button>
        <button style={tabStyle(tab === 'tpa')} onClick={() => setTab('tpa')}>TPA Summary</button>
        <button style={tabStyle(tab === 'unidentified')} onClick={() => setTab('unidentified')}>Unidentified Payments</button>
      </div>

      {/* ═══════════ AR LEDGER TAB ═══════════ */}
      {tab === 'ledger' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
            <input style={{ ...inputStyle, maxWidth: '250px' }} placeholder="Search name, AR#, invoice, TPA..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            <select style={{ ...selectStyle, maxWidth: '140px' }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">All Types</option>
              {AR_TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
            </select>
            <select style={{ ...selectStyle, maxWidth: '150px' }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All Statuses</option>
              {AR_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <select style={{ ...selectStyle, maxWidth: '140px' }} value={bucketFilter} onChange={e => { setBucketFilter(e.target.value); setPage(1); }}>
              <option value="">All Aging</option>
              {AGING_BUCKETS.map(b => <option key={b} value={b}>{bucketLabels[b]}</option>)}
            </select>
          </div>

          {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <>
              <div style={{ overflowX: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thStyle}>AR #</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Name / TPA</th>
                    <th style={thStyle}>Original</th>
                    <th style={thStyle}>Outstanding</th>
                    <th style={thStyle}>Aging</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {items.map((r: any) => (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => viewDetail(r.id)}>
                        <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.ar_number}</span></td>
                        <td style={tdStyle}><span style={badge(r.ar_type === 'patient' ? 'open' : '61_90')}>{label(r.ar_type)}</span></td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{r.ar_type === 'patient' ? r.patient_name : r.tpa_name}</div>
                          {r.invoice_number && <div style={{ fontSize: '11px', color: '#64748b' }}>Inv: {r.invoice_number}</div>}
                          {r.claim_number && <div style={{ fontSize: '11px', color: '#64748b' }}>Claim: {r.claim_number}</div>}
                        </td>
                        <td style={tdStyle}>{INR(r.original_amount)}</td>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: Number(r.outstanding_amount) > 0 ? '#dc2626' : '#059669' }}>{INR(r.outstanding_amount)}</span></td>
                        <td style={tdStyle}>
                          <span style={badge(r.aging_bucket)}>{bucketLabels[r.aging_bucket] || r.aging_bucket}</span>
                          {r.days_outstanding > 0 && <div style={{ fontSize: '11px', color: '#64748b' }}>{r.days_outstanding}d</div>}
                        </td>
                        <td style={tdStyle}><span style={badge(r.status)}>{label(r.status)}</span></td>
                        <td style={tdStyle} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' as const }}>
                            {!['paid', 'written_off'].includes(r.status) && (
                              <>
                                <button style={btnSecondary} onClick={() => { setSelectedAr(r); setPf({ amount: '', payment_reference: '', payment_date: '', payment_method: '', payer_name: '' }); setShowPaymentModal(true); }}>Pay</button>
                                <button style={{ ...btnDanger, fontSize: '11px', padding: '4px 8px' }} onClick={() => { setSelectedAr(r); setWf({ amount: r.outstanding_amount, reason: '' }); setShowWriteOffModal(true); }}>W/O</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {items.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No AR entries found</td></tr>}
                  </tbody>
                </table>
              </div>
              {total > 25 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                  <button style={btnSecondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ padding: '6px 12px', fontSize: '13px', color: '#475569' }}>Page {page} of {Math.ceil(total / 25)}</span>
                  <button style={btnSecondary} disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════ AGING TAB ═══════════ */}
      {tab === 'aging' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <select style={{ ...selectStyle, maxWidth: '180px' }} value={agingType} onChange={e => setAgingType(e.target.value)}>
              <option value="">All Types</option>
              <option value="patient">Patient AR</option>
              <option value="insurance">Insurance AR</option>
            </select>
          </div>
          {agingLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : agingData && (
            <>
              {/* Totals */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: '#f0f9ff', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' as const }}>Total Receivable</div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#1e40af' }}>{INR(agingData.total_receivable)}</div>
                  <div style={{ fontSize: '13px', color: '#475569' }}>{agingData.total_entries} open entries</div>
                </div>
                <div style={{ background: '#fefce8', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' as const }}>Aging Distribution</div>
                  <div style={{ marginTop: '8px' }}>
                    {agingData.buckets.map((b: any) => {
                      const pct = agingData.total_receivable > 0 ? (b.total / agingData.total_receivable * 100) : 0;
                      return (
                        <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ ...badge(b.bucket), minWidth: '80px', textAlign: 'center' as const }}>{bucketLabels[b.bucket]}</span>
                          <div style={{ flex: 1, background: '#e2e8f0', borderRadius: '4px', height: '16px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, background: statusColors[b.bucket], height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '100px', textAlign: 'right' as const }}>{INR(b.total)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Top overdue */}
              {agingData.top_overdue.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Top Overdue (by Amount)</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={thStyle}>Name / TPA</th>
                      <th style={thStyle}>AR #</th>
                      <th style={thStyle}>Outstanding</th>
                      <th style={thStyle}>Days</th>
                      <th style={thStyle}>Bucket</th>
                    </tr></thead>
                    <tbody>
                      {agingData.top_overdue.map((r: any) => (
                        <tr key={r.id}>
                          <td style={tdStyle}><span style={{ fontWeight: 600 }}>{r.patient_name || r.tpa_name}</span></td>
                          <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.ar_number}</span></td>
                          <td style={tdStyle}><span style={{ fontWeight: 600, color: '#dc2626' }}>{INR(r.outstanding_amount)}</span></td>
                          <td style={tdStyle}>{r.days_outstanding}d</td>
                          <td style={tdStyle}><span style={badge(r.aging_bucket)}>{bucketLabels[r.aging_bucket]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════ TPA TAB ═══════════ */}
      {tab === 'tpa' && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Insurance AR by TPA</h3>
          {tpaLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>TPA / Insurer</th>
                <th style={thStyle}>Open Claims</th>
                <th style={thStyle}>Outstanding</th>
                <th style={thStyle}>Avg Days</th>
              </tr></thead>
              <tbody>
                {tpaData.map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={tdStyle}><span style={{ fontWeight: 600 }}>{r.tpa_name}</span></td>
                    <td style={tdStyle}>{r.count}</td>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#dc2626' }}>{INR(r.total_outstanding)}</span></td>
                    <td style={tdStyle}><span style={{ color: r.avg_days > 60 ? '#dc2626' : r.avg_days > 30 ? '#d97706' : '#059669' }}>{r.avg_days}d</span></td>
                  </tr>
                ))}
                {tpaData.length === 0 && <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No insurance AR entries</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══════════ UNIDENTIFIED TAB ═══════════ */}
      {tab === 'unidentified' && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Unidentified Payments Queue</h3>
          {unidLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Payer</th>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Actions</th>
              </tr></thead>
              <tbody>
                {unidentified.map((p: any) => (
                  <tr key={p.id}>
                    <td style={tdStyle}><span style={{ fontFamily: 'monospace' }}>{p.payment_reference}</span></td>
                    <td style={tdStyle}>{p.payment_date}</td>
                    <td style={tdStyle}>{p.payer_name || '—'}</td>
                    <td style={tdStyle}>{p.payment_method || '—'}</td>
                    <td style={tdStyle}><span style={{ fontWeight: 600 }}>{INR(p.amount)}</span></td>
                    <td style={tdStyle}>
                      <button style={btnSecondary} onClick={() => { setSelectedPayment(p); setShowMatchModal(true); }}>Match</button>
                    </td>
                  </tr>
                ))}
                {unidentified.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No unidentified payments</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══════════ DETAIL MODAL ═══════════ */}
      {detailItem && (
        <div style={modalOverlay} onClick={() => setDetailItem(null)}>
          <div style={{ ...modalContent, maxWidth: '750px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{detailItem.ar_number}</h2>
              <button style={btnSecondary} onClick={() => setDetailItem(null)}>✕</button>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><span style={fieldLabel}>Type</span><span style={badge(detailItem.ar_type === 'patient' ? 'open' : '61_90')}>{label(detailItem.ar_type)}</span></div>
              <div style={fieldCol}><span style={fieldLabel}>Name</span>{detailItem.patient_name || detailItem.tpa_name || '—'}</div>
              <div style={fieldCol}><span style={fieldLabel}>Status</span><span style={badge(detailItem.status)}>{label(detailItem.status)}</span></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><span style={fieldLabel}>Original</span>{INR(detailItem.original_amount)}</div>
              <div style={fieldCol}><span style={fieldLabel}>Paid</span><span style={{ color: '#059669' }}>{INR(detailItem.paid_amount)}</span></div>
              <div style={fieldCol}><span style={fieldLabel}>Adjusted</span>{INR(detailItem.adjusted_amount)}</div>
              <div style={fieldCol}><span style={fieldLabel}>Outstanding</span><span style={{ fontWeight: 700, color: '#dc2626' }}>{INR(detailItem.outstanding_amount)}</span></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><span style={fieldLabel}>Invoice Date</span>{detailItem.invoice_date}</div>
              <div style={fieldCol}><span style={fieldLabel}>Due Date</span>{detailItem.due_date}</div>
              <div style={fieldCol}><span style={fieldLabel}>Aging</span><span style={badge(detailItem.aging_bucket)}>{bucketLabels[detailItem.aging_bucket]}</span> ({detailItem.days_outstanding}d)</div>
            </div>

            {/* Action buttons */}
            {!['paid', 'written_off'].includes(detailItem.status) && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', marginBottom: '16px' }}>
                <button style={btnPrimary} onClick={() => { setSelectedAr(detailItem); setPf({ amount: '', payment_reference: '', payment_date: '', payment_method: '', payer_name: '' }); setShowPaymentModal(true); }}>Record Payment</button>
                <button style={btnSecondary} onClick={() => { setSelectedAr(detailItem); setAf({ action_type: 'phone_call', action_date: new Date().toISOString().split('T')[0], scheduled_date: '', outcome: '', notes: '' }); setShowActionModal(true); }}>+ Collection Action</button>
                <button style={btnDanger} onClick={() => { setSelectedAr(detailItem); setWf({ amount: detailItem.outstanding_amount, reason: '' }); setShowWriteOffModal(true); }}>Write Off</button>
              </div>
            )}

            {/* Collection History */}
            {detailItem.collection_actions?.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>Collection History ({detailItem.collection_actions.length})</div>
                {detailItem.collection_actions.map((a: any) => (
                  <div key={a.id} style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', marginBottom: '4px', fontSize: '12px' }}>
                    <span style={{ fontWeight: 600 }}>{a.action_date}</span> — {label(a.action_type)}
                    {a.outcome && <span style={{ color: '#475569' }}> — {a.outcome}</span>}
                    {a.completed && <span style={{ color: '#059669' }}> ✓</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Payment History */}
            {detailItem.payment_matches?.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>Payments ({detailItem.payment_matches.length})</div>
                {detailItem.payment_matches.map((p: any) => (
                  <div key={p.id} style={{ background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', marginBottom: '4px', fontSize: '12px' }}>
                    <span style={{ fontWeight: 600 }}>{p.payment_date}</span> — {INR(p.matched_amount)} via {p.payment_method || '—'} — Ref: {p.payment_reference}
                    <span style={badge(p.match_status)}> {label(p.match_status)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ CREATE MODAL ═══════════ */}
      {showCreateModal && (
        <div style={modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>New AR Entry</h2>
            <div style={fieldRow}>
              <div style={fieldCol}>
                <label style={fieldLabel}>Type *</label>
                <select style={selectStyle} value={cf.ar_type} onChange={e => setCf({ ...cf, ar_type: e.target.value })}>
                  <option value="patient">Patient</option>
                  <option value="insurance">Insurance</option>
                </select>
              </div>
            </div>
            {cf.ar_type === 'patient' ? (
              <div style={fieldRow}>
                <div style={fieldCol}><label style={fieldLabel}>Patient Name *</label><input style={inputStyle} value={cf.patient_name} onChange={e => setCf({ ...cf, patient_name: e.target.value })} /></div>
                <div style={fieldCol}><label style={fieldLabel}>Invoice #</label><input style={inputStyle} value={cf.invoice_number} onChange={e => setCf({ ...cf, invoice_number: e.target.value })} /></div>
              </div>
            ) : (
              <div style={fieldRow}>
                <div style={fieldCol}><label style={fieldLabel}>TPA / Insurer *</label><input style={inputStyle} value={cf.tpa_name} onChange={e => setCf({ ...cf, tpa_name: e.target.value })} /></div>
                <div style={fieldCol}><label style={fieldLabel}>Claim #</label><input style={inputStyle} value={cf.claim_number} onChange={e => setCf({ ...cf, claim_number: e.target.value })} /></div>
                <div style={fieldCol}><label style={fieldLabel}>Policy #</label><input style={inputStyle} value={cf.policy_number} onChange={e => setCf({ ...cf, policy_number: e.target.value })} /></div>
              </div>
            )}
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Amount *</label><input style={inputStyle} type="number" value={cf.original_amount} onChange={e => setCf({ ...cf, original_amount: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Invoice Date *</label><input style={inputStyle} type="date" value={cf.invoice_date} onChange={e => setCf({ ...cf, invoice_date: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Due Date *</label><input style={inputStyle} type="date" value={cf.due_date} onChange={e => setCf({ ...cf, due_date: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={{ flex: '1 1 100%' }}><label style={fieldLabel}>Notes</label><input style={inputStyle} value={cf.notes} onChange={e => setCf({ ...cf, notes: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={saveCreate}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ PAYMENT MODAL ═══════════ */}
      {showPaymentModal && selectedAr && (
        <div style={modalOverlay} onClick={() => setShowPaymentModal(false)}>
          <div style={{ ...modalContent, maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Record Payment</h2>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
              {selectedAr.ar_number} — Outstanding: <strong style={{ color: '#dc2626' }}>{INR(selectedAr.outstanding_amount)}</strong>
            </p>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Amount *</label><input style={inputStyle} type="number" value={pf.amount} onChange={e => setPf({ ...pf, amount: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Payment Date *</label><input style={inputStyle} type="date" value={pf.payment_date} onChange={e => setPf({ ...pf, payment_date: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Reference / UTR *</label><input style={inputStyle} value={pf.payment_reference} onChange={e => setPf({ ...pf, payment_reference: e.target.value })} /></div>
              <div style={fieldCol}>
                <label style={fieldLabel}>Method</label>
                <select style={selectStyle} value={pf.payment_method} onChange={e => setPf({ ...pf, payment_method: e.target.value })}>
                  <option value="">—</option>
                  <option value="neft">NEFT</option><option value="rtgs">RTGS</option><option value="cheque">Cheque</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="dd">DD</option>
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Payer Name</label><input style={inputStyle} value={pf.payer_name} onChange={e => setPf({ ...pf, payer_name: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowPaymentModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={savePayment}>Record Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ COLLECTION ACTION MODAL ═══════════ */}
      {showActionModal && selectedAr && (
        <div style={modalOverlay} onClick={() => setShowActionModal(false)}>
          <div style={{ ...modalContent, maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Collection Action</h2>
            <div style={fieldRow}>
              <div style={fieldCol}>
                <label style={fieldLabel}>Action Type *</label>
                <select style={selectStyle} value={af.action_type} onChange={e => setAf({ ...af, action_type: e.target.value })}>
                  {ACTION_TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </div>
              <div style={fieldCol}><label style={fieldLabel}>Date *</label><input style={inputStyle} type="date" value={af.action_date} onChange={e => setAf({ ...af, action_date: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Follow-up Date</label><input style={inputStyle} type="date" value={af.scheduled_date} onChange={e => setAf({ ...af, scheduled_date: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Outcome</label><input style={inputStyle} value={af.outcome} onChange={e => setAf({ ...af, outcome: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={{ flex: '1 1 100%' }}><label style={fieldLabel}>Notes</label><input style={inputStyle} value={af.notes} onChange={e => setAf({ ...af, notes: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowActionModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={saveAction}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ WRITE-OFF MODAL ═══════════ */}
      {showWriteOffModal && selectedAr && (
        <div style={modalOverlay} onClick={() => setShowWriteOffModal(false)}>
          <div style={{ ...modalContent, maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#dc2626' }}>Write Off</h2>
            <p style={{ fontSize: '13px', color: '#475569' }}>{selectedAr.ar_number} — Outstanding: {INR(selectedAr.outstanding_amount)}</p>
            <div style={{ marginBottom: '12px' }}><label style={fieldLabel}>Amount *</label><input style={inputStyle} type="number" value={wf.amount} onChange={e => setWf({ ...wf, amount: e.target.value })} /></div>
            <div style={{ marginBottom: '12px' }}><label style={fieldLabel}>Reason *</label><input style={inputStyle} value={wf.reason} onChange={e => setWf({ ...wf, reason: e.target.value })} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={btnSecondary} onClick={() => setShowWriteOffModal(false)}>Cancel</button>
              <button style={btnDanger} onClick={saveWriteOff}>Write Off</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ MATCH PAYMENT MODAL ═══════════ */}
      {showMatchModal && selectedPayment && (
        <div style={modalOverlay} onClick={() => setShowMatchModal(false)}>
          <div style={{ ...modalContent, maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Match Payment to AR</h2>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
              Ref: {selectedPayment.payment_reference} — {INR(selectedPayment.amount)} from {selectedPayment.payer_name || 'Unknown'}
            </p>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
              Select an open AR entry from the ledger to match this payment against. Use the AR Ledger tab to find the correct entry, then enter its ID below.
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={fieldLabel}>AR Ledger ID (UUID)</label>
              <input style={inputStyle} id="match-ar-id" placeholder="Paste AR entry ID..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={btnSecondary} onClick={() => setShowMatchModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={() => {
                const arId = (document.getElementById('match-ar-id') as HTMLInputElement).value;
                if (!arId) { setError('Enter AR ID'); return; }
                matchPayment(arId);
              }}>Match</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ UNIDENTIFIED PAYMENT MODAL ═══════════ */}
      {showUnidModal && (
        <div style={modalOverlay} onClick={() => setShowUnidModal(false)}>
          <div style={{ ...modalContent, maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Record Unidentified Payment</h2>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Reference / UTR *</label><input style={inputStyle} value={uf.payment_reference || ''} onChange={e => setUf({ ...uf, payment_reference: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Date *</label><input style={inputStyle} type="date" value={uf.payment_date || ''} onChange={e => setUf({ ...uf, payment_date: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Amount *</label><input style={inputStyle} type="number" value={uf.amount || ''} onChange={e => setUf({ ...uf, amount: e.target.value })} /></div>
              <div style={fieldCol}>
                <label style={fieldLabel}>Method</label>
                <select style={selectStyle} value={uf.payment_method || ''} onChange={e => setUf({ ...uf, payment_method: e.target.value })}>
                  <option value="">—</option>
                  <option value="neft">NEFT</option><option value="rtgs">RTGS</option><option value="cheque">Cheque</option><option value="upi">UPI</option>
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Payer Name</label><input style={inputStyle} value={uf.payer_name || ''} onChange={e => setUf({ ...uf, payer_name: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowUnidModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={saveUnidentified}>Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
