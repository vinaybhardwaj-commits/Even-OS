'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── TYPES ────────────────────────────────────────────────────
interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
  department?: string;
}

interface RevenueOverviewData {
  today_collections: string;
  today_charges: string;
  net_revenue: string;
  outstanding: string;
  refunds: string;
  collection_efficiency: string;
  vs_yesterday_collections: string;
  vs_yesterday_charges: string;
  payer_mix: {
    self_pay: string;
    insurance: string;
    corporate: string;
    government: string;
  };
  department_breakdown: Array<{
    department: string;
    amount: string;
    count: number;
  }>;
}

interface OutstandingAnalysis {
  zero_30_days: string;
  days_31_60: string;
  days_61_90: string;
  days_90_plus: string;
  insurance_outstanding: string;
  patient_outstanding: string;
  top_accounts: Array<{
    id: string;
    patient_name: string;
    account_type: string;
    amount: string;
    days_outstanding: number;
  }>;
}

interface TPAPerformance {
  id: string;
  tpa_name: string;
  claims_count: number;
  avg_turnaround_days: number;
  approval_rate: string;
  avg_deduction_percent: string;
  outstanding: string;
}

interface InsurerPerformance {
  id: string;
  insurer_name: string;
  total_claims: number;
  approved_amount: string;
  deductions: string;
  net_settlement: string;
}

interface RefundRequest {
  id: string;
  refund_number: string;
  patient_name: string;
  amount: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'processing' | 'completed';
  requested_date: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  patient_name: string;
  invoice_type: string;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
  grand_total: string;
  paid: string;
  balance: string;
}

interface PaymentLog {
  id: string;
  receipt_number: string;
  patient_name: string;
  amount: string;
  payment_method: string;
  payment_date: string;
}

interface RevenueTrendRow {
  date: string;
  charges: string;
  collections: string;
  deposits: string;
  refunds: string;
  net: string;
}

interface RefundStats {
  pending_refunds: string;
  total_refunded: string;
  avg_processing_days: number;
}

// ─── FORMATTING HELPERS ────────────────────────────────────────
function formatCurrency(amount: string | number | undefined | null): string {
  if (amount === undefined || amount === null) amount = 0;
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₹0.00';

  let absNum = Math.abs(num);
  let suffix = '';

  if (absNum >= 10000000) {
    absNum = absNum / 10000000;
    suffix = 'Cr';
  } else if (absNum >= 100000) {
    absNum = absNum / 100000;
    suffix = 'L';
  } else if (absNum >= 1000) {
    absNum = absNum / 1000;
    suffix = 'K';
  }

  if (suffix) {
    return `₹${absNum.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${suffix}`;
  }

  return `₹${absNum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatPercent(value: string | number | undefined | null): string {
  if (value === undefined || value === null) value = 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0%';
  return `${num.toFixed(1)}%`;
}

function getStatusBadgeColor(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: '#78350f', text: '#fbbf24' },
    approved: { bg: '#065f46', text: '#6ee7b7' },
    rejected: { bg: '#7f1d1d', text: '#fca5a5' },
    processing: { bg: '#1e40af', text: '#93c5fd' },
    completed: { bg: '#065f46', text: '#6ee7b7' },
    draft: { bg: '#374151', text: '#d1d5db' },
    issued: { bg: '#1e3a8a', text: '#93c5fd' },
    partially_paid: { bg: '#78350f', text: '#fbbf24' },
    paid: { bg: '#065f46', text: '#6ee7b7' },
    overdue: { bg: '#7f1d1d', text: '#fca5a5' },
    cancelled: { bg: '#4b5563', text: '#9ca3af' },
  };
  return colors[status] || { bg: '#374151', text: '#d1d5db' };
}

// ─── API FETCHER ────────────────────────────────────────────────
async function fetchAPI(endpoint: string): Promise<any> {
  try {
    const response = await fetch(`/api/trpc/refundRevenue.${endpoint}`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    return data.result?.data || null;
  } catch (error) {
    console.error(`Failed to fetch ${endpoint}:`, error);
    return null;
  }
}

// ─── TAB 1: REVENUE OVERVIEW ───────────────────────────────────
function RevenueOverviewTab({ data }: { data: RevenueOverviewData | null }) {
  const isLoading = !data;

  return (
    <div style={{ padding: '24px' }}>
      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: "Today's Collections", value: data?.today_collections, trend: data?.vs_yesterday_collections },
          { label: "Today's Charges", value: data?.today_charges, trend: data?.vs_yesterday_charges },
          { label: 'Net Revenue', value: data?.net_revenue },
          { label: 'Outstanding', value: data?.outstanding },
          { label: 'Refunds', value: data?.refunds },
          { label: 'Collection Efficiency', value: data?.collection_efficiency, isPercent: true },
        ].map((stat, i) => {
          const numValue = typeof stat.value === 'string' ? parseFloat(stat.value) : 0;
          const trendNum = typeof stat.trend === 'string' ? parseFloat(stat.trend) : 0;
          const isPositive = trendNum >= 0;

          return (
            <div key={i} style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>{stat.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#e2e8f0', marginBottom: '8px' }}>
                {isLoading ? '...' : stat.isPercent ? formatPercent(stat.value || 0) : formatCurrency(stat.value || 0)}
              </div>
              {stat.trend !== undefined && (
                <div style={{ fontSize: '12px', color: isPositive ? '#10b981' : '#ef4444', fontWeight: 500 }}>
                  {isPositive ? '↑' : '↓'} {Math.abs(trendNum).toFixed(1)}% vs yesterday
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payer Mix */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Payer Mix</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', height: '24px', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#0f172a' }}>
            {data?.payer_mix && [
              { label: 'Self Pay', value: parseFloat(data.payer_mix.self_pay || '0'), color: '#10b981' },
              { label: 'Insurance', value: parseFloat(data.payer_mix.insurance || '0'), color: '#3b82f6' },
              { label: 'Corporate', value: parseFloat(data.payer_mix.corporate || '0'), color: '#f59e0b' },
              { label: 'Government', value: parseFloat(data.payer_mix.government || '0'), color: '#8b5cf6' },
            ].map((payer, i) => {
              const total = parseFloat(data.payer_mix.self_pay || '0') + parseFloat(data.payer_mix.insurance || '0') + parseFloat(data.payer_mix.corporate || '0') + parseFloat(data.payer_mix.government || '0');
              const percent = total > 0 ? (payer.value / total) * 100 : 0;
              return <div key={i} style={{ flex: percent, backgroundColor: payer.color }} title={`${payer.label}: ${percent.toFixed(1)}%`} />;
            })}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '12px' }}>
          {!isLoading && data?.payer_mix && [
            { label: 'Self Pay', value: data.payer_mix.self_pay, color: '#10b981' },
            { label: 'Insurance', value: data.payer_mix.insurance, color: '#3b82f6' },
            { label: 'Corporate', value: data.payer_mix.corporate, color: '#f59e0b' },
            { label: 'Government', value: data.payer_mix.government, color: '#8b5cf6' },
          ].map((payer, i) => (
            <div key={i} style={{ fontSize: '12px', color: '#94a3b8' }}>
              <span style={{ color: payer.color, fontWeight: 600 }}>●</span> {payer.label}: {formatCurrency(payer.value)}
            </div>
          ))}
        </div>
      </div>

      {/* Department Breakdown */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Department Revenue Breakdown</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Department</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Amount</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {data?.department_breakdown?.map((dept, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{dept.department}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>{formatCurrency(dept.amount)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#94a3b8' }}>{dept.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB 2: OUTSTANDING ANALYSIS ───────────────────────────────
function OutstandingAnalysisTab({ data }: { data: OutstandingAnalysis | null }) {
  const isLoading = !data;

  return (
    <div style={{ padding: '24px' }}>
      {/* Aging Buckets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: '0-30 Days', value: data?.zero_30_days },
          { label: '31-60 Days', value: data?.days_31_60 },
          { label: '61-90 Days', value: data?.days_61_90 },
          { label: '90+ Days', value: data?.days_90_plus },
        ].map((bucket, i) => (
          <div key={i} style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>{bucket.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#e2e8f0' }}>{isLoading ? '...' : formatCurrency(bucket.value)}</div>
          </div>
        ))}
      </div>

      {/* Split Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>Insurance Outstanding</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#3b82f6' }}>{isLoading ? '...' : formatCurrency(data?.insurance_outstanding)}</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>Patient Outstanding</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>{isLoading ? '...' : formatCurrency(data?.patient_outstanding)}</div>
        </div>
      </div>

      {/* Top 10 Outstanding */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Top 10 Outstanding Accounts</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Patient Name</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Account Type</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Amount</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Days Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {data?.top_accounts?.map((account, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{account.patient_name}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#94a3b8' }}>{account.account_type}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#f59e0b', fontWeight: 600 }}>{formatCurrency(account.amount)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: account.days_outstanding > 90 ? '#ef4444' : '#94a3b8' }}>
                    {account.days_outstanding}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB 3: INSURANCE PERFORMANCE ──────────────────────────────
function InsurancePerformanceTab({ tpaData, insurerData }: { tpaData: TPAPerformance[] | null; insurerData: InsurerPerformance[] | null }) {
  const isLoading = !tpaData || !insurerData;

  return (
    <div style={{ padding: '24px' }}>
      {/* TPA Performance */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>TPA Performance</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>TPA Name</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Claims</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Avg Turnaround (days)</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Approval Rate</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Avg Deduction %</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {tpaData?.map((tpa, i) => {
                const approvalRate = parseFloat(tpa.approval_rate || '0');
                const rateColor = approvalRate > 80 ? '#10b981' : approvalRate >= 60 ? '#f59e0b' : '#ef4444';

                return (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{tpa.tpa_name}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>{tpa.claims_count}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>{tpa.avg_turnaround_days}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px', color: rateColor, fontWeight: 600 }}>
                      {formatPercent(tpa.approval_rate)}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>{formatPercent(tpa.avg_deduction_percent)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#3b82f6', fontWeight: 600 }}>{formatCurrency(tpa.outstanding)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Insurer Performance */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Insurer Performance</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Insurer Name</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Total Claims</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Approved Amount</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Deductions</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Net Settlement</th>
              </tr>
            </thead>
            <tbody>
              {insurerData?.map((insurer, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{insurer.insurer_name}</td>
                  <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>{insurer.total_claims}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>{formatCurrency(insurer.approved_amount)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#ef4444', fontWeight: 600 }}>{formatCurrency(insurer.deductions)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#3b82f6', fontWeight: 600 }}>{formatCurrency(insurer.net_settlement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB 4: REFUND MANAGEMENT ──────────────────────────────────
function RefundManagementTab({ refundStats, refundQueue }: { refundStats: RefundStats | null; refundQueue: RefundRequest[] | null }) {
  const [showNewRefundForm, setShowNewRefundForm] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('patient_request');
  const [detail, setDetail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNewRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('/api/trpc/refundRevenue.requestRefund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_search: patientSearch, amount, reason, detail }),
      });
      if (response.ok) {
        setPatientSearch('');
        setAmount('');
        setReason('patient_request');
        setDetail('');
        setShowNewRefundForm(false);
        alert('Refund request created');
      }
    } catch (error) {
      console.error('Failed to create refund request:', error);
    } finally {
      setLoading(false);
    }
  };

  const isLoading = !refundStats || !refundQueue;

  return (
    <div style={{ padding: '24px' }}>
      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>Pending Refunds</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>{isLoading ? '...' : formatCurrency(refundStats?.pending_refunds)}</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>Total Refunded</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>{isLoading ? '...' : formatCurrency(refundStats?.total_refunded)}</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', fontWeight: 500 }}>Avg Processing Days</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#3b82f6' }}>{isLoading ? '...' : refundStats?.avg_processing_days}</div>
        </div>
      </div>

      {/* New Refund Button & Form */}
      <div style={{ marginBottom: '24px' }}>
        {!showNewRefundForm ? (
          <button
            onClick={() => setShowNewRefundForm(true)}
            style={{
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            + New Refund
          </button>
        ) : (
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', padding: '16px', marginBottom: '16px' }}>
            <form onSubmit={handleNewRefund} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#94a3b8' }}>Patient Search</label>
                <input
                  type="text"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Search patient name or UHID"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '4px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#94a3b8' }}>Amount</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      color: '#e2e8f0',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                    }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#94a3b8' }}>Reason</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      color: '#e2e8f0',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="patient_request">Patient Request</option>
                    <option value="insurance_reversal">Insurance Reversal</option>
                    <option value="overpayment">Overpayment</option>
                    <option value="error">Billing Error</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#94a3b8' }}>Details</label>
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Additional notes"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '4px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    minHeight: '60px',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowNewRefundForm(false)}
                  style={{
                    backgroundColor: '#374151',
                    color: '#ffffff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  {loading ? 'Creating...' : 'Create Refund'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Refund Queue */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Refund Queue</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Refund #</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Patient</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Reason</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Status</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Requested</th>
              </tr>
            </thead>
            <tbody>
              {refundQueue?.map((refund, i) => {
                const statusColor = getStatusBadgeColor(refund.status);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>{refund.refund_number}</td>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{refund.patient_name}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#ef4444', fontWeight: 600 }}>{formatCurrency(refund.amount)}</td>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#94a3b8' }}>{refund.reason}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '12px' }}>
                      <span style={{ backgroundColor: statusColor.bg, color: statusColor.text, padding: '4px 8px', borderRadius: '3px', fontWeight: 600 }}>
                        {refund.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>{formatDate(refund.requested_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB 5: INVOICES & PAYMENTS ─────────────────────────────────
function InvoicesPaymentsTab({ invoices, payments }: { invoices: Invoice[] | null; payments: PaymentLog[] | null }) {
  const [statusFilter, setStatusFilter] = useState('all');

  const isLoading = !invoices || !payments;

  const filteredInvoices = statusFilter === 'all' ? invoices : invoices?.filter((inv) => inv.status === statusFilter);

  return (
    <div style={{ padding: '24px' }}>
      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          style={{
            backgroundColor: '#10b981',
            color: '#ffffff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          + Generate Invoice
        </button>
      </div>

      {/* Status Filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['all', 'draft', 'issued', 'partially_paid', 'overdue'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              backgroundColor: statusFilter === status ? '#3b82f6' : '#374151',
              color: '#ffffff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: statusFilter === status ? 600 : 500,
            }}
          >
            {status.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Invoices Table */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Invoices</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Invoice #</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Patient</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Type</th>
                <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Grand Total</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Paid</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices?.map((invoice, i) => {
                const statusColor = getStatusBadgeColor(invoice.status);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>{invoice.invoice_number}</td>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{invoice.patient_name}</td>
                    <td style={{ padding: '8px', fontSize: '13px', color: '#94a3b8' }}>{invoice.invoice_type}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '12px' }}>
                      <span style={{ backgroundColor: statusColor.bg, color: statusColor.text, padding: '4px 8px', borderRadius: '3px', fontWeight: 600 }}>
                        {invoice.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(invoice.grand_total)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>{formatCurrency(invoice.paid)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: invoice.status === 'overdue' ? '#ef4444' : '#94a3b8', fontWeight: 600 }}>
                      {formatCurrency(invoice.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Payment Log */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>Payment Log</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Receipt #</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Patient</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Method</th>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments?.map((payment, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>{payment.receipt_number}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{payment.patient_name}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>{formatCurrency(payment.amount)}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#94a3b8' }}>{payment.payment_method}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#94a3b8' }}>{formatDate(payment.payment_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB 6: TRENDS & REPORTS ────────────────────────────────────
function TrendsReportsTab({ trendData }: { trendData: RevenueTrendRow[] | null }) {
  const isLoading = !trendData;

  return (
    <div style={{ padding: '24px' }}>
      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          style={{
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ↓ Generate Snapshot
        </button>
      </div>

      {/* Revenue Timeline */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#e2e8f0' }}>14-Day Revenue Trend</h3>
        {isLoading ? (
          <div style={{ color: '#94a3b8' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Date</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Charges</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Collections</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Deposits</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Refunds</th>
                <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>Net Revenue</th>
              </tr>
            </thead>
            <tbody>
              {trendData?.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#e2e8f0' }}>{formatDate(row.date)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(row.charges)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>{formatCurrency(row.collections)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#3b82f6', fontWeight: 600 }}>{formatCurrency(row.deposits)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#ef4444', fontWeight: 600 }}>{formatCurrency(row.refunds)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontSize: '13px', color: '#fbbf24', fontWeight: 600 }}>{formatCurrency(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────
export default function RevenueDashboardClient({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [overviewData, setOverviewData] = useState<RevenueOverviewData | null>(null);
  const [outstandingData, setOutstandingData] = useState<OutstandingAnalysis | null>(null);
  const [tpaData, setTPAData] = useState<TPAPerformance[] | null>(null);
  const [insurerData, setInsurerData] = useState<InsurerPerformance[] | null>(null);
  const [refundStats, setRefundStats] = useState<RefundStats | null>(null);
  const [refundQueue, setRefundQueue] = useState<RefundRequest[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [payments, setPayments] = useState<PaymentLog[] | null>(null);
  const [trendData, setTrendData] = useState<RevenueTrendRow[] | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (activeTab === 'overview') {
        const data = await fetchAPI('revenueSummary');
        setOverviewData(data);
      } else if (activeTab === 'outstanding') {
        const data = await fetchAPI('outstandingAnalysis');
        setOutstandingData(data);
      } else if (activeTab === 'insurance') {
        const tpa = await fetchAPI('tpaSettlementAnalysis');
        const insurer = await fetchAPI('insurerPerformance');
        setTPAData(tpa);
        setInsurerData(insurer);
      } else if (activeTab === 'refund') {
        const stats = await fetchAPI('refundStats');
        const queue = await fetchAPI('listRefunds');
        setRefundStats(stats);
        setRefundQueue(queue);
      } else if (activeTab === 'invoices') {
        const invs = await fetchAPI('listInvoices');
        const pays = await fetchAPI('listPayments');
        setInvoices(invs);
        setPayments(pays);
      } else if (activeTab === 'trends') {
        const data = await fetchAPI('revenueTimeline');
        setTrendData(data);
      }
    };

    loadData();
  }, [activeTab]);

  return (
    <div style={{ backgroundColor: '#0f172a', color: '#e2e8f0', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', padding: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>Revenue Intelligence Dashboard</h1>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Hospital: {user.hospital_id} | User: {user.name}</div>
      </div>

      {/* Tabs */}
      <div style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', overflow: 'auto' }}>
        {[
          { id: 'overview', label: 'Revenue Overview' },
          { id: 'outstanding', label: 'Outstanding Analysis' },
          { id: 'insurance', label: 'Insurance Performance' },
          { id: 'refund', label: 'Refund Management' },
          { id: 'invoices', label: 'Invoices & Payments' },
          { id: 'trends', label: 'Trends & Reports' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: '16px 20px',
              backgroundColor: activeTab === tab.id ? '#0f172a' : 'transparent',
              color: activeTab === tab.id ? '#10b981' : '#94a3b8',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #10b981' : 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <RevenueOverviewTab data={overviewData} />}
      {activeTab === 'outstanding' && <OutstandingAnalysisTab data={outstandingData} />}
      {activeTab === 'insurance' && <InsurancePerformanceTab tpaData={tpaData} insurerData={insurerData} />}
      {activeTab === 'refund' && <RefundManagementTab refundStats={refundStats} refundQueue={refundQueue} />}
      {activeTab === 'invoices' && <InvoicesPaymentsTab invoices={invoices} payments={payments} />}
      {activeTab === 'trends' && <TrendsReportsTab trendData={trendData} />}
    </div>
  );
}
