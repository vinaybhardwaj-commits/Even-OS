'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── TYPES ────────────────────────────────────────────────────
type User = { sub: string; hospital_id: string; role: string; email: string; name: string; department?: string };

type ClaimStatus = 'draft' | 'pre_auth_pending' | 'admitted' | 'enhancement_pending' | 'discharge_pending' | 'query_raised' | 'under_review' | 'approved' | 'settled' | 'rejected';

interface Claim {
  id: string;
  claim_number: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  insurance_company: string;
  tpa_name: string | null;
  policy_number: string | null;
  member_id: string | null;
  claim_status: ClaimStatus;
  claimed_amount: string;
  approved_amount: string | null;
  settled_amount: string | null;
  pre_auth_id: string | null;
  encounter_id: string;
  submitted_at: string | null;
  approved_at: string | null;
  settled_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  days_in_status: number;
  created_at: string;
  updated_at: string;
}

interface PreAuth {
  id: string;
  claim_id: string;
  claim_number: string;
  tpa_name: string;
  submitted_amount: string;
  approved_amount: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'submitted';
  tpa_response_date: string | null;
  approval_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface Enhancement {
  id: string;
  claim_id: string;
  claim_number: string;
  reason: string;
  requested_amount: string;
  approved_amount: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface Deduction {
  id: string;
  claim_id: string;
  claim_number: string;
  category: string;
  amount: string;
  reason: string;
  dispute_status: 'pending' | 'disputed' | 'resolved';
  dispute_reason: string | null;
  resolved_amount: string | null;
  created_at: string;
}

interface ClaimTimeline {
  id: string;
  claim_id: string;
  event_type: string;
  description: string;
  performer_name: string;
  timestamp: string;
}

interface ClaimStats {
  total_claims: number;
  pre_auth_pending: number;
  approved_amount: string;
  total_deductions: string;
  avg_settlement_days: number;
}

interface TPAPerformance {
  tpa_name: string;
  claim_count: number;
  avg_turnaround_days: number;
  approval_rate_percent: number;
  avg_deduction_percent: number;
}

// ─── HELPERS ────────────────────────────────────────────────────
function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₹ 0.00';

  let absNum = Math.abs(num);
  let suffix = '';

  if (absNum >= 10000000) {
    absNum = absNum / 10000000;
    suffix = ' Cr';
  } else if (absNum >= 100000) {
    absNum = absNum / 100000;
    suffix = ' L';
  } else if (absNum >= 1000) {
    absNum = absNum / 1000;
    suffix = 'K';
  }

  const formatted = absNum.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `₹ ${formatted}${suffix}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pre_auth_pending': return '#3b82f6';
    case 'admitted': return '#10b981';
    case 'enhancement_pending': return '#f59e0b';
    case 'discharge_pending': return '#f59e0b';
    case 'query_raised': return '#ef4444';
    case 'under_review': return '#eab308';
    case 'approved': return '#10b981';
    case 'settled': return '#10b981';
    case 'rejected': return '#ef4444';
    case 'pending': return '#3b82f6';
    case 'disputed': return '#ef4444';
    case 'resolved': return '#10b981';
    default: return '#6b7280';
  }
}

function getStatusLabel(status: string): string {
  return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

// ─── MAIN COMPONENT ────────────────────────────────────────────
export default function InsuranceClaimsClient({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'board' | 'pre-auth' | 'deductions' | 'timeline' | 'analytics'>('board');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [preAuths, setPreAuths] = useState<PreAuth[]>([]);
  const [enhancements, setEnhancements] = useState<Enhancement[]>([]);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [claimTimeline, setClaimTimeline] = useState<ClaimTimeline[]>([]);
  const [stats, setStats] = useState<ClaimStats | null>(null);
  const [tpaPerformance, setTPAPerformance] = useState<TPAPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout>();

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('insuranceClaims.listClaims', { limit: 100 });
      setClaims(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPreAuths = useCallback(async () => {
    setLoading(true);
    try {
      const [preAuthData, enhancementData] = await Promise.all([
        trpcQuery('insuranceClaims.getPreAuth'),
        trpcQuery('insuranceClaims.listEnhancements'),
      ]);
      setPreAuths(preAuthData || []);
      setEnhancements(enhancementData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDeductions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('insuranceClaims.listDeductions', { limit: 100 });
      setDeductions(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTimeline = useCallback(async (claimId: string) => {
    setLoading(true);
    try {
      const data = await trpcQuery('insuranceClaims.getClaimTimeline', { claim_id: claimId });
      setClaimTimeline(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, tpaData] = await Promise.all([
        trpcQuery('insuranceClaims.claimStats'),
        trpcQuery('insuranceClaims.tpaPerformance'),
      ]);
      setStats(statsData);
      setTPAPerformance(tpaData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tab-specific effects
  useEffect(() => {
    if (activeTab === 'board') fetchClaims();
    else if (activeTab === 'pre-auth') fetchPreAuths();
    else if (activeTab === 'deductions') fetchDeductions();
    else if (activeTab === 'analytics') fetchAnalytics();
  }, [activeTab, fetchClaims, fetchPreAuths, fetchDeductions, fetchAnalytics]);

  const handleStatusUpdate = async (claimId: string, newStatus: ClaimStatus) => {
    setError('');
    try {
      await trpcMutate('insuranceClaims.updateClaimStatus', { claim_id: claimId, status: newStatus });
      setSuccess('Claim status updated');
      fetchClaims();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApprovePreAuth = async (preAuthId: string, approvedAmount: string) => {
    setError('');
    try {
      await trpcMutate('insuranceClaims.approvePreAuth', { pre_auth_id: preAuthId, approved_amount: approvedAmount });
      setSuccess('Pre-auth approved');
      fetchPreAuths();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRejectPreAuth = async (preAuthId: string, reason: string) => {
    setError('');
    try {
      await trpcMutate('insuranceClaims.rejectPreAuth', { pre_auth_id: preAuthId, rejection_reason: reason });
      setSuccess('Pre-auth rejected');
      fetchPreAuths();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDisputeDeduction = async (deductionId: string, reason: string) => {
    setError('');
    try {
      await trpcMutate('insuranceClaims.disputeDeduction', { deduction_id: deductionId, dispute_reason: reason });
      setSuccess('Deduction disputed');
      fetchDeductions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── RENDER TABS ────────────────────────────────────────────
  const renderBoardTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>Claims Board</h2>
        <button
          onClick={() => setSelectedClaim(null)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          &#10133; New Claim
        </button>
      </div>

      {/* Kanban columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        {(['pre_auth_pending', 'admitted', 'enhancement_pending', 'discharge_pending', 'query_raised', 'under_review', 'approved'] as ClaimStatus[]).map((status) => {
          const statusClaims = claims.filter((c) => c.claim_status === status);
          return (
            <div key={status} style={{ backgroundColor: '#f9fafb', borderRadius: '8px', padding: '12px', minHeight: '400px' }}>
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: getStatusColor(status),
                  color: '#fff',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                }}
              >
                {getStatusLabel(status)} ({statusClaims.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {statusClaims.map((claim) => (
                  <div
                    key={claim.id}
                    onClick={() => setSelectedClaim(claim)}
                    style={{
                      padding: '10px',
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>{claim.patient_name}</div>
                    <div style={{ color: '#6b7280', marginBottom: '2px' }}>#{claim.claim_number}</div>
                    <div style={{ color: '#6b7280', marginBottom: '2px' }}>{claim.tpa_name || claim.insurance_company}</div>
                    <div style={{ fontWeight: '600', color: '#1f2937' }}>{formatCurrency(claim.claimed_amount)}</div>
                    <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>{claim.days_in_status} days in status</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Claim detail modal/section */}
      {selectedClaim && (
        <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>Claim Details: {selectedClaim.claim_number}</h3>
            <button
              onClick={() => setSelectedClaim(null)}
              style={{
                padding: '6px 12px',
                backgroundColor: '#e5e7eb',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              ✕ Close
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Patient</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{selectedClaim.patient_name}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>UHID</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{selectedClaim.uhid}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Insurance Company</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{selectedClaim.insurance_company}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>TPA</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{selectedClaim.tpa_name || 'N/A'}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Policy Number</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{selectedClaim.policy_number || 'N/A'}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Claimed Amount</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatCurrency(selectedClaim.claimed_amount)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Approved Amount</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatCurrency(selectedClaim.approved_amount || '0')}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>Status</div>
              <div style={{ fontSize: '14px', fontWeight: '600', color: getStatusColor(selectedClaim.claim_status) }}>
                {getStatusLabel(selectedClaim.claim_status)}
              </div>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>Update Status</label>
            <select
              value={selectedClaim.claim_status}
              onChange={(e) => handleStatusUpdate(selectedClaim.id, e.target.value as ClaimStatus)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                width: '100%',
              }}
            >
              {(['draft', 'pre_auth_pending', 'admitted', 'enhancement_pending', 'discharge_pending', 'query_raised', 'under_review', 'approved', 'settled', 'rejected'] as ClaimStatus[]).map((s) => (
                <option key={s} value={s}>
                  {getStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );

  const renderPreAuthTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Pre-Auth & Enhancement Requests</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Pre-Auth column */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>Pre-Auth Requests</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {preAuths.map((pa) => (
              <div key={pa.id} style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontWeight: '600' }}>#{pa.claim_number}</div>
                  <span
                    style={{
                      padding: '2px 8px',
                      backgroundColor: getStatusColor(pa.status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                    }}
                  >
                    {getStatusLabel(pa.status)}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>{pa.tpa_name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: '#9ca3af', fontSize: '11px' }}>Submitted</div>
                    <div style={{ fontWeight: '600' }}>{formatCurrency(pa.submitted_amount)}</div>
                  </div>
                  <div>
                    <div style={{ color: '#9ca3af', fontSize: '11px' }}>Approved</div>
                    <div style={{ fontWeight: '600' }}>{formatCurrency(pa.approved_amount || '0')}</div>
                  </div>
                </div>
                {pa.approval_ref && <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>Ref: {pa.approval_ref}</div>}
                {pa.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="number"
                      placeholder="Approved amount"
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '12px',
                      }}
                      onBlur={(e) => {
                        if (e.target.value) handleApprovePreAuth(pa.id, e.target.value);
                      }}
                    />
                    <button
                      onClick={() => handleRejectPreAuth(pa.id, 'Insufficient documentation')}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Enhancement column */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>Enhancement Requests</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {enhancements.map((enh) => (
              <div key={enh.id} style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontWeight: '600' }}>#{enh.claim_number}</div>
                  <span
                    style={{
                      padding: '2px 8px',
                      backgroundColor: getStatusColor(enh.status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                    }}
                  >
                    {getStatusLabel(enh.status)}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>{enh.reason}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: '#9ca3af', fontSize: '11px' }}>Requested</div>
                    <div style={{ fontWeight: '600' }}>{formatCurrency(enh.requested_amount)}</div>
                  </div>
                  <div>
                    <div style={{ color: '#9ca3af', fontSize: '11px' }}>Approved</div>
                    <div style={{ fontWeight: '600' }}>{formatCurrency(enh.approved_amount || '0')}</div>
                  </div>
                </div>
                {enh.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => handleApprovePreAuth(enh.id, enh.requested_amount)}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectPreAuth(enh.id, 'Cannot approve at this time')}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        backgroundColor: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDeductionsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>TPA Deductions</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Claim #</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Category</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Amount</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Reason</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Dispute Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deductions.map((ded) => (
              <tr key={ded.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '12px' }}>{ded.claim_number}</td>
                <td style={{ padding: '12px' }}>{ded.category}</td>
                <td style={{ padding: '12px', fontWeight: '600' }}>{formatCurrency(ded.amount)}</td>
                <td style={{ padding: '12px', color: '#6b7280' }}>{ded.reason}</td>
                <td style={{ padding: '12px' }}>
                  <span
                    style={{
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(ded.dispute_status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                    }}
                  >
                    {getStatusLabel(ded.dispute_status)}
                  </span>
                </td>
                <td style={{ padding: '12px' }}>
                  {ded.dispute_status === 'pending' && (
                    <button
                      onClick={() => handleDisputeDeduction(ded.id, 'Reviewing documentation')}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#f59e0b',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Dispute
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTimelineTab = () => (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Claim Timeline</h2>
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Select Claim</label>
        <select
          value={selectedClaim?.id || ''}
          onChange={(e) => {
            const claim = claims.find((c) => c.id === e.target.value);
            if (claim) {
              setSelectedClaim(claim);
              fetchTimeline(claim.id);
            }
          }}
          style={{
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          <option value="">-- Select a claim --</option>
          {claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.claim_number} - {c.patient_name}
            </option>
          ))}
        </select>
      </div>

      {claimTimeline.length > 0 && (
        <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          {claimTimeline.map((event, idx) => (
            <div key={event.id} style={{ paddingBottom: '16px', paddingLeft: '24px', position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#3b82f6',
                  borderRadius: '50%',
                  border: '3px solid #fff',
                }}
              />
              {idx < claimTimeline.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: '5px',
                    top: '12px',
                    width: '2px',
                    height: 'calc(100% + 16px)',
                    backgroundColor: '#d1d5db',
                  }}
                />
              )}
              <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px' }}>{event.event_type}</div>
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>{event.description}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
                <span>{event.performer_name}</span>
                <span>{formatDate(event.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderAnalyticsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600' }}>Analytics</h2>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {stats && [
          { label: 'Total Claims', value: stats.total_claims, format: 'number' },
          { label: 'Pre-Auth Pending', value: stats.pre_auth_pending, format: 'number' },
          { label: 'Approved Amount', value: stats.approved_amount, format: 'currency' },
          { label: 'Total Deductions', value: stats.total_deductions, format: 'currency' },
          { label: 'Avg Settlement Days', value: stats.avg_settlement_days, format: 'number' },
        ].map((stat) => (
          <div key={stat.label} style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{stat.label}</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#1f2937' }}>
              {stat.format === 'currency' ? formatCurrency(stat.value) : stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* TPA Performance table */}
      <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>TPA Performance</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>TPA Name</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Claim Count</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Avg Turnaround (days)</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Approval Rate %</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600' }}>Avg Deduction %</th>
              </tr>
            </thead>
            <tbody>
              {tpaPerformance.map((tpa) => (
                <tr key={tpa.tpa_name} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '12px', fontWeight: '600' }}>{tpa.tpa_name}</td>
                  <td style={{ padding: '12px' }}>{tpa.claim_count}</td>
                  <td style={{ padding: '12px' }}>{tpa.avg_turnaround_days.toFixed(1)}</td>
                  <td style={{ padding: '12px', color: '#10b981', fontWeight: '600' }}>{tpa.approval_rate_percent.toFixed(1)}%</td>
                  <td style={{ padding: '12px', color: tpa.avg_deduction_percent > 10 ? '#ef4444' : '#1f2937' }}>
                    {tpa.avg_deduction_percent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ─── MAIN RENDER ────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f3f4f6' }}>
      {/* Header with tabs */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px 20px' }}>
          <h1 style={{ margin: '0 0 16px 0', fontSize: '24px', fontWeight: '700' }}>Insurance Claims Management</h1>
          <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #e5e7eb' }}>
            {[
              { id: 'board', label: '📊 Claims Board' },
              { id: 'pre-auth', label: '📋 Pre-Auth & Enhancement' },
              { id: 'deductions', label: '✂️ TPA Deductions' },
              { id: 'timeline', label: '📅 Claim Timeline' },
              { id: 'analytics', label: '📈 Analytics' },
            ].map((tab: any) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '12px 20px',
                  backgroundColor: activeTab === tab.id ? '#3b82f6' : 'transparent',
                  color: activeTab === tab.id ? '#fff' : '#6b7280',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  borderRadius: '0',
                  transition: 'all 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ backgroundColor: '#f3f4f6' }}>
        {loading && <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>}
        {error && <div style={{ padding: '12px 20px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '6px', margin: '16px 20px' }}>Error: {error}</div>}
        {success && <div style={{ padding: '12px 20px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '6px', margin: '16px 20px' }}>{success}</div>}

        {!loading && activeTab === 'board' && renderBoardTab()}
        {!loading && activeTab === 'pre-auth' && renderPreAuthTab()}
        {!loading && activeTab === 'deductions' && renderDeductionsTab()}
        {!loading && activeTab === 'timeline' && renderTimelineTab()}
        {!loading && activeTab === 'analytics' && renderAnalyticsTab()}
      </div>
    </div>
  );
}
