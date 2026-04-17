'use client';
import { useState, useEffect, useCallback } from 'react';

interface Breadcrumb { label: string; href?: string }
interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: Breadcrumb[];
}

// ── helpers ──────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'Query failed');
  return json?.result?.data?.json ?? json?.result?.data;
}
async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'Mutation failed');
  return json?.result?.data?.json ?? json?.result?.data;
}

const INR = (v: any) => {
  const n = Number(v || 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
};

const CONTRACT_TYPES = ['supply','service','lease','amc','consulting','outsourced_lab','catering','housekeeping','laundry','other'];
const CONTRACT_STATUSES = ['draft','active','expiring_soon','expired','terminated'];
const PAYMENT_TERMS = ['net_15','net_30','net_45','net_60','advance','milestone'];
const PAYMENT_FREQUENCIES = ['one_time','monthly','quarterly','annual','per_invoice'];
const INVOICE_STATUSES = ['received','verified','approved','scheduled','paid','disputed','cancelled'];

const statusColors: Record<string, string> = {
  draft: '#6b7280', active: '#059669', expiring_soon: '#d97706', expired: '#dc2626', terminated: '#991b1b',
  received: '#3b82f6', verified: '#8b5cf6', approved: '#059669', scheduled: '#d97706', paid: '#10b981', disputed: '#dc2626', cancelled: '#6b7280',
};

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function VendorApAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [tab, setTab] = useState<'contracts' | 'invoices' | 'summary'>('contracts');

  // ─── Contracts state ───
  const [contracts, setContracts] = useState<any[]>([]);
  const [contractTotal, setContractTotal] = useState(0);
  const [contractPage, setContractPage] = useState(1);
  const [contractSearch, setContractSearch] = useState('');
  const [contractTypeFilter, setContractTypeFilter] = useState('');
  const [contractStatusFilter, setContractStatusFilter] = useState('');
  const [contractLoading, setContractLoading] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [editingContract, setEditingContract] = useState<any>(null);
  const [contractDetail, setContractDetail] = useState<any>(null);

  // ─── Invoices state ───
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('');
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<any>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState<any>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputingInvoice, setDisputingInvoice] = useState<any>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedulingInvoice, setSchedulingInvoice] = useState<any>(null);

  // ─── Summary state ───
  const [summary, setSummary] = useState<any>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ─── Load contracts ───
  const loadContracts = useCallback(async () => {
    setContractLoading(true);
    try {
      const input: any = { page: contractPage, pageSize: 25 };
      if (contractSearch) input.search = contractSearch;
      if (contractTypeFilter) input.contract_type = contractTypeFilter;
      if (contractStatusFilter) input.status = contractStatusFilter;
      const data = await trpcQuery('vendorAp.listContracts', input);
      setContracts(data.items || []);
      setContractTotal(data.total || 0);
    } catch (e: any) { setError(e.message); }
    setContractLoading(false);
  }, [contractPage, contractSearch, contractTypeFilter, contractStatusFilter]);

  // ─── Load invoices ───
  const loadInvoices = useCallback(async () => {
    setInvoiceLoading(true);
    try {
      const input: any = { page: invoicePage, pageSize: 25 };
      if (invoiceSearch) input.search = invoiceSearch;
      if (invoiceStatusFilter) input.status = invoiceStatusFilter;
      const data = await trpcQuery('vendorAp.listInvoices', input);
      setInvoices(data.items || []);
      setInvoiceTotal(data.total || 0);
    } catch (e: any) { setError(e.message); }
    setInvoiceLoading(false);
  }, [invoicePage, invoiceSearch, invoiceStatusFilter]);

  // ─── Load summary ───
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const [s, p] = await Promise.all([
        trpcQuery('vendorAp.apSummary'),
        trpcQuery('vendorAp.paymentSchedule'),
      ]);
      setSummary(s);
      setSchedule(p);
    } catch (e: any) { setError(e.message); }
    setSummaryLoading(false);
  }, []);

  useEffect(() => { if (tab === 'contracts') loadContracts(); }, [tab, loadContracts]);
  useEffect(() => { if (tab === 'invoices') loadInvoices(); }, [tab, loadInvoices]);
  useEffect(() => { if (tab === 'summary') loadSummary(); }, [tab, loadSummary]);

  // ── Contract form ──
  const [cf, setCf] = useState<any>({});
  const resetContractForm = () => setCf({
    vendor_name: '', vendor_code: '', vendor_gstin: '', vendor_pan: '',
    vendor_contact: '', vendor_email: '', vendor_phone: '', vendor_address: '',
    contract_number: '', contract_type: 'service', description: '',
    start_date: '', end_date: '', auto_renewal: false, renewal_notice_days: 30,
    payment_terms: 'net_30', payment_frequency: 'monthly',
    contract_value: '', monthly_value: '', gst_percent: '18',
    tds_applicable: false, tds_percent: '', tds_section: '',
    status: 'active',
  });

  const openNewContract = () => { resetContractForm(); setEditingContract(null); setShowContractModal(true); };
  const openEditContract = (c: any) => {
    setCf({
      vendor_name: c.vendor_name || '', vendor_code: c.vendor_code || '',
      vendor_gstin: c.vendor_gstin || '', vendor_pan: c.vendor_pan || '',
      vendor_contact: c.vendor_contact || '', vendor_email: c.vendor_email || '',
      vendor_phone: c.vendor_phone || '', vendor_address: c.vendor_address || '',
      contract_number: c.contract_number, contract_type: c.contract_type,
      description: c.description || '',
      start_date: c.start_date || '', end_date: c.end_date || '',
      auto_renewal: c.auto_renewal || false, renewal_notice_days: c.renewal_notice_days || 30,
      payment_terms: c.payment_terms || 'net_30', payment_frequency: c.payment_frequency || '',
      contract_value: c.contract_value || '', monthly_value: c.monthly_value || '',
      gst_percent: c.gst_percent || '', tds_applicable: c.tds_applicable || false,
      tds_percent: c.tds_percent || '', tds_section: c.tds_section || '',
      status: c.status,
    });
    setEditingContract(c);
    setShowContractModal(true);
  };

  const saveContract = async () => {
    setError('');
    try {
      if (editingContract) {
        await trpcMutate('vendorAp.updateContract', { id: editingContract.id, ...cf });
        setSuccess('Contract updated');
      } else {
        await trpcMutate('vendorAp.createContract', cf);
        setSuccess('Contract created');
      }
      setShowContractModal(false);
      loadContracts();
    } catch (e: any) { setError(e.message); }
  };

  const viewContractDetail = async (id: string) => {
    try {
      const data = await trpcQuery('vendorAp.getContract', { id });
      setContractDetail(data);
    } catch (e: any) { setError(e.message); }
  };

  // ── Invoice form ──
  const [inf, setInf] = useState<any>({});
  const resetInvoiceForm = () => setInf({
    contract_id: '', vendor_name: '', invoice_number: '', our_reference: '',
    invoice_date: '', due_date: '', amount: '', gst_amount: '0', tds_amount: '0', notes: '',
  });

  const openNewInvoice = () => { resetInvoiceForm(); setShowInvoiceModal(true); };

  const saveInvoice = async () => {
    setError('');
    try {
      const input: any = {
        vendor_name: inf.vendor_name,
        invoice_number: inf.invoice_number,
        our_reference: inf.our_reference || undefined,
        invoice_date: inf.invoice_date,
        due_date: inf.due_date,
        amount: Number(inf.amount),
        gst_amount: Number(inf.gst_amount || 0),
        tds_amount: Number(inf.tds_amount || 0),
        notes: inf.notes || undefined,
      };
      if (inf.contract_id) input.contract_id = inf.contract_id;
      await trpcMutate('vendorAp.createInvoice', input);
      setSuccess('Invoice recorded');
      setShowInvoiceModal(false);
      loadInvoices();
    } catch (e: any) { setError(e.message); }
  };

  // ── Workflow actions ──
  const doWorkflow = async (action: string, id: string, extra?: any) => {
    setError('');
    try {
      await trpcMutate(`vendorAp.${action}`, { id, ...extra });
      setSuccess(`Invoice ${action.replace(/([A-Z])/g, ' $1').toLowerCase()} successful`);
      loadInvoices();
      if (tab === 'summary') loadSummary();
    } catch (e: any) { setError(e.message); }
  };

  // ── styles ──
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 20px', cursor: 'pointer', border: 'none',
    background: active ? '#1e40af' : '#f1f5f9', color: active ? '#fff' : '#374151',
    borderRadius: '8px 8px 0 0', fontWeight: active ? 600 : 400, fontSize: '14px',
  });
  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: '10px', padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px',
  };
  const btnPrimary: React.CSSProperties = {
    background: '#1e40af', color: '#fff', border: 'none', borderRadius: '6px',
    padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '13px',
  };
  const btnSecondary: React.CSSProperties = {
    background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px',
    padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500,
  };
  const btnDanger: React.CSSProperties = {
    background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px',
    padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 500,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
    fontSize: '13px', boxSizing: 'border-box' as const,
  };
  const selectStyle: React.CSSProperties = { ...inputStyle };
  const thStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left' as const, borderBottom: '2px solid #e2e8f0',
    fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const,
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '13px',
  };
  const badge = (status: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
    fontWeight: 600, color: '#fff', background: statusColors[status] || '#6b7280',
  });
  const modalOverlay: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  };
  const modalContent: React.CSSProperties = {
    background: '#fff', borderRadius: '12px', padding: '24px', width: '90%', maxWidth: '700px',
    maxHeight: '85vh', overflowY: 'auto' as const,
  };
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
              <span key={i}>
                {b.href ? <a href={b.href} style={{ color: '#3b82f6', textDecoration: 'none' }}>{b.label}</a> : <span style={{ fontWeight: 600, color: '#1e293b' }}>{b.label}</span>}
                {i < breadcrumbs.length - 1 && ' / '}
              </span>
            ))}
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>Vendors & Accounts Payable</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {tab === 'contracts' && <button style={btnPrimary} onClick={openNewContract}>+ New Contract</button>}
          {tab === 'invoices' && <button style={btnPrimary} onClick={openNewInvoice}>+ Record Invoice</button>}
        </div>
      </div>

      {/* Alerts */}
      {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px' }} onClick={() => setError('')}>{error}</div>}
      {success && <div style={{ background: '#f0fdf4', color: '#059669', padding: '10px 16px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px' }} onClick={() => setSuccess('')}>{success}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0' }}>
        <button style={tabStyle(tab === 'contracts')} onClick={() => setTab('contracts')}>Contracts</button>
        <button style={tabStyle(tab === 'invoices')} onClick={() => setTab('invoices')}>Invoices</button>
        <button style={tabStyle(tab === 'summary')} onClick={() => setTab('summary')}>AP Summary</button>
      </div>

      {/* ═══════════════════════ CONTRACTS TAB ═══════════════════════ */}
      {tab === 'contracts' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
            <input style={{ ...inputStyle, maxWidth: '250px' }} placeholder="Search vendor or contract..." value={contractSearch} onChange={e => { setContractSearch(e.target.value); setContractPage(1); }} />
            <select style={{ ...selectStyle, maxWidth: '160px' }} value={contractTypeFilter} onChange={e => { setContractTypeFilter(e.target.value); setContractPage(1); }}>
              <option value="">All Types</option>
              {CONTRACT_TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
            </select>
            <select style={{ ...selectStyle, maxWidth: '150px' }} value={contractStatusFilter} onChange={e => { setContractStatusFilter(e.target.value); setContractPage(1); }}>
              <option value="">All Statuses</option>
              {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>

          {contractLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <>
              <div style={{ overflowX: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Vendor</th>
                      <th style={thStyle}>Contract #</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Value</th>
                      <th style={thStyle}>Period</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((c: any) => (
                      <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => viewContractDetail(c.id)}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{c.vendor_name}</div>
                          {c.vendor_code && <div style={{ fontSize: '11px', color: '#64748b' }}>{c.vendor_code}</div>}
                        </td>
                        <td style={tdStyle}>{c.contract_number}</td>
                        <td style={tdStyle}><span style={{ fontSize: '12px' }}>{label(c.contract_type)}</span></td>
                        <td style={tdStyle}>
                          {c.contract_value ? INR(c.contract_value) : '—'}
                          {c.monthly_value && <div style={{ fontSize: '11px', color: '#64748b' }}>{INR(c.monthly_value)}/mo</div>}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontSize: '12px' }}>{c.start_date} → {c.end_date || '∞'}</div>
                          {c.is_expiring && <div style={{ fontSize: '11px', color: '#d97706', fontWeight: 600 }}>⚠ Expires in {c.days_to_expiry}d</div>}
                        </td>
                        <td style={tdStyle}><span style={badge(c.status)}>{label(c.status)}</span></td>
                        <td style={tdStyle} onClick={e => e.stopPropagation()}>
                          <button style={btnSecondary} onClick={() => openEditContract(c)}>Edit</button>
                        </td>
                      </tr>
                    ))}
                    {contracts.length === 0 && (
                      <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No contracts found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {contractTotal > 25 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                  <button style={btnSecondary} disabled={contractPage <= 1} onClick={() => setContractPage(p => p - 1)}>← Prev</button>
                  <span style={{ padding: '6px 12px', fontSize: '13px', color: '#475569' }}>Page {contractPage} of {Math.ceil(contractTotal / 25)}</span>
                  <button style={btnSecondary} disabled={contractPage >= Math.ceil(contractTotal / 25)} onClick={() => setContractPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Contract Detail Panel */}
      {contractDetail && (
        <div style={modalOverlay} onClick={() => setContractDetail(null)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{contractDetail.vendor_name}</h2>
              <button style={btnSecondary} onClick={() => setContractDetail(null)}>✕</button>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><span style={fieldLabel}>Contract #</span>{contractDetail.contract_number}</div>
              <div style={fieldCol}><span style={fieldLabel}>Type</span>{label(contractDetail.contract_type)}</div>
              <div style={fieldCol}><span style={fieldLabel}>Status</span><span style={badge(contractDetail.status)}>{label(contractDetail.status)}</span></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><span style={fieldLabel}>GSTIN</span>{contractDetail.vendor_gstin || '—'}</div>
              <div style={fieldCol}><span style={fieldLabel}>PAN</span>{contractDetail.vendor_pan || '—'}</div>
              <div style={fieldCol}><span style={fieldLabel}>Phone</span>{contractDetail.vendor_phone || '—'}</div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><span style={fieldLabel}>Period</span>{contractDetail.start_date} → {contractDetail.end_date || '∞'}</div>
              <div style={fieldCol}><span style={fieldLabel}>Payment</span>{label(contractDetail.payment_terms)}{contractDetail.payment_frequency ? `, ${label(contractDetail.payment_frequency)}` : ''}</div>
              <div style={fieldCol}><span style={fieldLabel}>Contract Value</span>{contractDetail.contract_value ? INR(contractDetail.contract_value) : '—'}</div>
            </div>
            {contractDetail.tds_applicable && (
              <div style={fieldRow}>
                <div style={fieldCol}><span style={fieldLabel}>TDS</span>{contractDetail.tds_percent}% — Section {contractDetail.tds_section || '—'}</div>
                <div style={fieldCol}><span style={fieldLabel}>GST</span>{contractDetail.gst_percent || 0}%</div>
              </div>
            )}
            {contractDetail.invoice_summary && (
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '16px', marginTop: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>Invoice Summary</div>
                <div style={fieldRow}>
                  <div style={fieldCol}><span style={fieldLabel}>Total Invoices</span>{contractDetail.invoice_summary.total_invoices}</div>
                  <div style={fieldCol}><span style={fieldLabel}>Total Amount</span>{INR(contractDetail.invoice_summary.total_amount)}</div>
                  <div style={fieldCol}><span style={fieldLabel}>Paid</span>{INR(contractDetail.invoice_summary.total_paid)}</div>
                  <div style={fieldCol}><span style={fieldLabel}>Pending</span><span style={{ color: '#d97706', fontWeight: 600 }}>{INR(contractDetail.invoice_summary.pending_amount)}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════ INVOICES TAB ═══════════════════════ */}
      {tab === 'invoices' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
            <input style={{ ...inputStyle, maxWidth: '250px' }} placeholder="Search vendor or invoice..." value={invoiceSearch} onChange={e => { setInvoiceSearch(e.target.value); setInvoicePage(1); }} />
            <select style={{ ...selectStyle, maxWidth: '150px' }} value={invoiceStatusFilter} onChange={e => { setInvoiceStatusFilter(e.target.value); setInvoicePage(1); }}>
              <option value="">All Statuses</option>
              {INVOICE_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>

          {invoiceLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : (
            <>
              <div style={{ overflowX: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Vendor</th>
                      <th style={thStyle}>Invoice #</th>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Due</th>
                      <th style={thStyle}>Amount</th>
                      <th style={thStyle}>Net Payable</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv: any) => (
                      <tr key={inv.id}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{inv.vendor_name}</div>
                          {inv.our_reference && <div style={{ fontSize: '11px', color: '#64748b' }}>Ref: {inv.our_reference}</div>}
                        </td>
                        <td style={tdStyle}>{inv.invoice_number}</td>
                        <td style={tdStyle}>{inv.invoice_date}</td>
                        <td style={tdStyle}>
                          <div>{inv.due_date}</div>
                          {inv.is_overdue && <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>⚠ {inv.days_overdue}d overdue</div>}
                        </td>
                        <td style={tdStyle}>{INR(inv.amount)}</td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600 }}>{INR(inv.net_payable)}</span>
                          {(Number(inv.gst_amount) > 0 || Number(inv.tds_amount) > 0) && (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {Number(inv.gst_amount) > 0 && `+GST ${INR(inv.gst_amount)} `}
                              {Number(inv.tds_amount) > 0 && `-TDS ${INR(inv.tds_amount)}`}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}><span style={badge(inv.status)}>{label(inv.status)}</span></td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' as const }}>
                            {inv.status === 'received' && <button style={btnSecondary} onClick={() => doWorkflow('verifyInvoice', inv.id)}>Verify</button>}
                            {inv.status === 'verified' && <button style={btnSecondary} onClick={() => doWorkflow('approveInvoice', inv.id)}>Approve</button>}
                            {inv.status === 'approved' && (
                              <>
                                <button style={btnSecondary} onClick={() => { setSchedulingInvoice(inv); setShowScheduleModal(true); }}>Schedule</button>
                                <button style={{ ...btnPrimary, fontSize: '12px', padding: '6px 12px' }} onClick={() => { setPayingInvoice(inv); setShowPayModal(true); }}>Pay</button>
                              </>
                            )}
                            {inv.status === 'scheduled' && <button style={{ ...btnPrimary, fontSize: '12px', padding: '6px 12px' }} onClick={() => { setPayingInvoice(inv); setShowPayModal(true); }}>Pay</button>}
                            {!['paid', 'cancelled', 'disputed'].includes(inv.status) && (
                              <button style={{ ...btnDanger, fontSize: '11px', padding: '4px 8px' }} onClick={() => { setDisputingInvoice(inv); setShowDisputeModal(true); }}>Dispute</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {invoices.length === 0 && (
                      <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No invoices found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {invoiceTotal > 25 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                  <button style={btnSecondary} disabled={invoicePage <= 1} onClick={() => setInvoicePage(p => p - 1)}>← Prev</button>
                  <span style={{ padding: '6px 12px', fontSize: '13px', color: '#475569' }}>Page {invoicePage} of {Math.ceil(invoiceTotal / 25)}</span>
                  <button style={btnSecondary} disabled={invoicePage >= Math.ceil(invoiceTotal / 25)} onClick={() => setInvoicePage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════ SUMMARY TAB ═══════════════════════ */}
      {tab === 'summary' && (
        <div style={cardStyle}>
          {summaryLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading...</div> : summary && (
            <>
              {/* KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {summary.by_status.map((s: any) => (
                  <div key={s.status} style={{ background: '#f8fafc', borderRadius: '8px', padding: '16px', borderLeft: `4px solid ${statusColors[s.status] || '#6b7280'}` }}>
                    <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' as const }}>{label(s.status)}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>{s.count}</div>
                    <div style={{ fontSize: '14px', color: '#475569' }}>{INR(s.total)}</div>
                  </div>
                ))}
              </div>

              {/* Overdue & Expiring */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: summary.overdue.count > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: summary.overdue.count > 0 ? '#dc2626' : '#059669' }}>
                    {summary.overdue.count > 0 ? '⚠ Overdue Invoices' : '✓ No Overdue Invoices'}
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px' }}>{summary.overdue.count}</div>
                  {summary.overdue.count > 0 && <div style={{ fontSize: '14px', color: '#dc2626' }}>Total: {INR(summary.overdue.total)}</div>}
                </div>
                <div style={{ background: summary.expiring_contracts > 0 ? '#fffbeb' : '#f0fdf4', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: summary.expiring_contracts > 0 ? '#d97706' : '#059669' }}>
                    {summary.expiring_contracts > 0 ? '⚠ Contracts Expiring (30d)' : '✓ No Expiring Contracts'}
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px' }}>{summary.expiring_contracts}</div>
                </div>
              </div>

              {/* Payment Schedule */}
              {schedule && schedule.items.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Payment Schedule (Approved & Scheduled)</h3>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e40af', marginBottom: '12px' }}>Total Payable: {INR(schedule.total_payable)}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Vendor</th>
                        <th style={thStyle}>Invoice #</th>
                        <th style={thStyle}>Due Date</th>
                        <th style={thStyle}>Net Payable</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.items.map((inv: any) => (
                        <tr key={inv.id}>
                          <td style={tdStyle}>{inv.vendor_name}</td>
                          <td style={tdStyle}>{inv.invoice_number}</td>
                          <td style={tdStyle}>{inv.due_date}</td>
                          <td style={tdStyle}><span style={{ fontWeight: 600 }}>{INR(inv.net_payable)}</span></td>
                          <td style={tdStyle}><span style={badge(inv.status)}>{label(inv.status)}</span></td>
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

      {/* ═══════════════════════ CONTRACT MODAL ═══════════════════════ */}
      {showContractModal && (
        <div style={modalOverlay} onClick={() => setShowContractModal(false)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>{editingContract ? 'Edit Contract' : 'New Contract'}</h2>

            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af', marginBottom: '8px' }}>Vendor Details</div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Vendor Name *</label><input style={inputStyle} value={cf.vendor_name} onChange={e => setCf({ ...cf, vendor_name: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Vendor Code</label><input style={inputStyle} value={cf.vendor_code} onChange={e => setCf({ ...cf, vendor_code: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>GSTIN</label><input style={inputStyle} value={cf.vendor_gstin} onChange={e => setCf({ ...cf, vendor_gstin: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>PAN</label><input style={inputStyle} value={cf.vendor_pan} onChange={e => setCf({ ...cf, vendor_pan: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Contact Person</label><input style={inputStyle} value={cf.vendor_contact} onChange={e => setCf({ ...cf, vendor_contact: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Email</label><input style={inputStyle} value={cf.vendor_email} onChange={e => setCf({ ...cf, vendor_email: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Phone</label><input style={inputStyle} value={cf.vendor_phone} onChange={e => setCf({ ...cf, vendor_phone: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={{ flex: '1 1 100%' }}><label style={fieldLabel}>Address</label><input style={inputStyle} value={cf.vendor_address} onChange={e => setCf({ ...cf, vendor_address: e.target.value })} /></div>
            </div>

            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af', marginBottom: '8px', marginTop: '12px' }}>Contract Details</div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Contract # *</label><input style={inputStyle} value={cf.contract_number} onChange={e => setCf({ ...cf, contract_number: e.target.value })} disabled={!!editingContract} /></div>
              <div style={fieldCol}>
                <label style={fieldLabel}>Type *</label>
                <select style={selectStyle} value={cf.contract_type} onChange={e => setCf({ ...cf, contract_type: e.target.value })}>
                  {CONTRACT_TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </div>
              <div style={fieldCol}>
                <label style={fieldLabel}>Status</label>
                <select style={selectStyle} value={cf.status} onChange={e => setCf({ ...cf, status: e.target.value })}>
                  {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div style={{ flex: '1 1 100%' }}><label style={fieldLabel}>Description</label><input style={inputStyle} value={cf.description} onChange={e => setCf({ ...cf, description: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Start Date *</label><input style={inputStyle} type="date" value={cf.start_date} onChange={e => setCf({ ...cf, start_date: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>End Date</label><input style={inputStyle} type="date" value={cf.end_date} onChange={e => setCf({ ...cf, end_date: e.target.value })} /></div>
              <div style={fieldCol}>
                <label style={fieldLabel}>Auto-renewal</label>
                <label style={{ fontSize: '13px' }}><input type="checkbox" checked={cf.auto_renewal} onChange={e => setCf({ ...cf, auto_renewal: e.target.checked })} /> Yes</label>
              </div>
            </div>

            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af', marginBottom: '8px', marginTop: '12px' }}>Payment & Tax</div>
            <div style={fieldRow}>
              <div style={fieldCol}>
                <label style={fieldLabel}>Payment Terms *</label>
                <select style={selectStyle} value={cf.payment_terms} onChange={e => setCf({ ...cf, payment_terms: e.target.value })}>
                  {PAYMENT_TERMS.map(t => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </div>
              <div style={fieldCol}>
                <label style={fieldLabel}>Frequency</label>
                <select style={selectStyle} value={cf.payment_frequency} onChange={e => setCf({ ...cf, payment_frequency: e.target.value })}>
                  <option value="">—</option>
                  {PAYMENT_FREQUENCIES.map(f => <option key={f} value={f}>{label(f)}</option>)}
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Contract Value</label><input style={inputStyle} type="number" value={cf.contract_value} onChange={e => setCf({ ...cf, contract_value: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Monthly Value</label><input style={inputStyle} type="number" value={cf.monthly_value} onChange={e => setCf({ ...cf, monthly_value: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>GST %</label><input style={inputStyle} type="number" value={cf.gst_percent} onChange={e => setCf({ ...cf, gst_percent: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}>
                <label style={fieldLabel}>TDS Applicable</label>
                <label style={{ fontSize: '13px' }}><input type="checkbox" checked={cf.tds_applicable} onChange={e => setCf({ ...cf, tds_applicable: e.target.checked })} /> Yes</label>
              </div>
              {cf.tds_applicable && (
                <>
                  <div style={fieldCol}><label style={fieldLabel}>TDS %</label><input style={inputStyle} type="number" value={cf.tds_percent} onChange={e => setCf({ ...cf, tds_percent: e.target.value })} /></div>
                  <div style={fieldCol}><label style={fieldLabel}>TDS Section</label><input style={inputStyle} placeholder="e.g. 194C" value={cf.tds_section} onChange={e => setCf({ ...cf, tds_section: e.target.value })} /></div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowContractModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={saveContract}>{editingContract ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ INVOICE MODAL ═══════════════════════ */}
      {showInvoiceModal && (
        <div style={modalOverlay} onClick={() => setShowInvoiceModal(false)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Record Invoice</h2>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Vendor Name *</label><input style={inputStyle} value={inf.vendor_name} onChange={e => setInf({ ...inf, vendor_name: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Invoice # *</label><input style={inputStyle} value={inf.invoice_number} onChange={e => setInf({ ...inf, invoice_number: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Our Reference (PO/GRN)</label><input style={inputStyle} value={inf.our_reference} onChange={e => setInf({ ...inf, our_reference: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Contract</label>
                <select style={selectStyle} value={inf.contract_id} onChange={e => setInf({ ...inf, contract_id: e.target.value })}>
                  <option value="">— No contract —</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {c.contract_number}</option>)}
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Invoice Date *</label><input style={inputStyle} type="date" value={inf.invoice_date} onChange={e => setInf({ ...inf, invoice_date: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>Due Date *</label><input style={inputStyle} type="date" value={inf.due_date} onChange={e => setInf({ ...inf, due_date: e.target.value })} /></div>
            </div>
            <div style={fieldRow}>
              <div style={fieldCol}><label style={fieldLabel}>Amount *</label><input style={inputStyle} type="number" value={inf.amount} onChange={e => setInf({ ...inf, amount: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>GST Amount</label><input style={inputStyle} type="number" value={inf.gst_amount} onChange={e => setInf({ ...inf, gst_amount: e.target.value })} /></div>
              <div style={fieldCol}><label style={fieldLabel}>TDS Amount</label><input style={inputStyle} type="number" value={inf.tds_amount} onChange={e => setInf({ ...inf, tds_amount: e.target.value })} /></div>
            </div>
            {inf.amount && (
              <div style={{ background: '#f0f9ff', padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>
                <span style={{ fontWeight: 600, color: '#1e40af' }}>Net Payable: {INR(Number(inf.amount || 0) + Number(inf.gst_amount || 0) - Number(inf.tds_amount || 0))}</span>
              </div>
            )}
            <div style={fieldRow}>
              <div style={{ flex: '1 1 100%' }}><label style={fieldLabel}>Notes</label><input style={inputStyle} value={inf.notes} onChange={e => setInf({ ...inf, notes: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button style={btnSecondary} onClick={() => setShowInvoiceModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={saveInvoice}>Record Invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ PAY MODAL ═══════════════════════ */}
      {showPayModal && payingInvoice && (
        <div style={modalOverlay} onClick={() => setShowPayModal(false)}>
          <div style={{ ...modalContent, maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Mark as Paid</h2>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              {payingInvoice.vendor_name} — {payingInvoice.invoice_number} — {INR(payingInvoice.net_payable)}
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={fieldLabel}>Payment Method *</label>
              <select style={selectStyle} id="pay-method" defaultValue="">
                <option value="">Select...</option>
                <option value="neft">NEFT</option>
                <option value="rtgs">RTGS</option>
                <option value="cheque">Cheque</option>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={fieldLabel}>Payment Reference / UTR</label>
              <input style={inputStyle} id="pay-ref" placeholder="Transaction reference..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={btnSecondary} onClick={() => setShowPayModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={() => {
                const method = (document.getElementById('pay-method') as HTMLSelectElement).value;
                const ref = (document.getElementById('pay-ref') as HTMLInputElement).value;
                if (!method) { setError('Select payment method'); return; }
                doWorkflow('markPaid', payingInvoice.id, { payment_method: method, payment_reference: ref || undefined });
                setShowPayModal(false);
              }}>Confirm Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ DISPUTE MODAL ═══════════════════════ */}
      {showDisputeModal && disputingInvoice && (
        <div style={modalOverlay} onClick={() => setShowDisputeModal(false)}>
          <div style={{ ...modalContent, maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#dc2626' }}>Dispute Invoice</h2>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              {disputingInvoice.vendor_name} — {disputingInvoice.invoice_number}
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={fieldLabel}>Dispute Reason *</label>
              <input style={inputStyle} id="dispute-reason" placeholder="Enter reason for dispute..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={btnSecondary} onClick={() => setShowDisputeModal(false)}>Cancel</button>
              <button style={btnDanger} onClick={() => {
                const reason = (document.getElementById('dispute-reason') as HTMLInputElement).value;
                if (!reason) { setError('Enter dispute reason'); return; }
                doWorkflow('disputeInvoice', disputingInvoice.id, { reason });
                setShowDisputeModal(false);
              }}>Dispute</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ SCHEDULE MODAL ═══════════════════════ */}
      {showScheduleModal && schedulingInvoice && (
        <div style={modalOverlay} onClick={() => setShowScheduleModal(false)}>
          <div style={{ ...modalContent, maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px' }}>Schedule Payment</h2>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              {schedulingInvoice.vendor_name} — {schedulingInvoice.invoice_number} — {INR(schedulingInvoice.net_payable)}
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={fieldLabel}>Payment Date *</label>
              <input style={inputStyle} type="date" id="schedule-date" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={btnSecondary} onClick={() => setShowScheduleModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={() => {
                const dateVal = (document.getElementById('schedule-date') as HTMLInputElement).value;
                if (!dateVal) { setError('Select payment date'); return; }
                doWorkflow('schedulePayment', schedulingInvoice.id, { payment_scheduled_date: dateVal });
                setShowScheduleModal(false);
              }}>Schedule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
