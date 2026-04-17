'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type AdminTab = 'queue' | 'all' | 'new' | 'config';

const TYPE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  waiver: { label: 'Waiver', bg: '#dbeafe', color: '#1e40af' },
  discount: { label: 'Discount', bg: '#dcfce7', color: '#166534' },
  write_off: { label: 'Write-off', bg: '#fee2e2', color: '#991b1b' },
  hardship: { label: 'Hardship', bg: '#f3e8ff', color: '#6b21a8' },
  goodwill: { label: 'Goodwill', bg: '#ccfbf1', color: '#134e4a' },
  rounding: { label: 'Rounding', bg: '#f3f4f6', color: '#374151' },
};

const STATUS_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
  approved_tier1: { label: 'Auto-Approved', bg: '#dcfce7', color: '#166534' },
  approved_tier2: { label: 'Mgr Approved', bg: '#c7f0d8', color: '#065f46' },
  approved_tier3: { label: 'Accts Approved', bg: '#a7f3d0', color: '#065f46' },
  approved_tier4: { label: 'GM Approved', bg: '#6ee7b7', color: '#025341' },
  approved_gm: { label: 'GM Approved', bg: '#6ee7b7', color: '#025341' },
  rejected: { label: 'Rejected', bg: '#fecaca', color: '#7f1d1d' },
  revised: { label: 'Revised', bg: '#e5e7eb', color: '#374151' },
  cancelled: { label: 'Cancelled', bg: '#e5e7eb', color: '#374151' },
};

const TIER_ROLES: Record<number, string> = {
  1: 'Billing Manager',
  2: 'Accounts Manager',
  3: 'Billing Executive',
  4: 'General Manager',
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ApprovalsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('queue');
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<any[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [config, setConfig] = useState<Record<string, any>>({});

  // Pagination for All Requests tab
  const [allPage, setAllPage] = useState(0);
  const [allTotalCount, setAllTotalCount] = useState(0);
  const [allStatusFilter, setAllStatusFilter] = useState('');
  const [allTypeFilter, setAllTypeFilter] = useState('');
  const [allDaysFilter, setAllDaysFilter] = useState('all');

  // Detail panel state
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Approve/Reject state
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject' | null>(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // New Request form state
  const [newType, setNewType] = useState('waiver');
  const [newOriginalAmount, setNewOriginalAmount] = useState('');
  const [newAdjustmentAmount, setNewAdjustmentAmount] = useState('');
  const [newReason, setNewReason] = useState('');
  const [newCategory, setNewCategory] = useState('service_issue');
  const [newJustification, setNewJustification] = useState('');
  const [newPatientId, setNewPatientId] = useState('');
  const [newEncounterId, setNewEncounterId] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Alerts
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // ── Load My Queue ─────────────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      const data = await trpcQuery('billAdjustments.myQueue');
      setQueue(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Queue load error:', err);
      setAlert({ type: 'error', msg: 'Failed to load queue' });
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load All Requests ─────────────────────────────────────────────────────
  const loadAllRequests = useCallback(async () => {
    try {
      setLoading(true);
      const input: any = {
        limit: 20,
        offset: allPage * 20,
      };
      if (allStatusFilter) input.status = allStatusFilter;
      if (allTypeFilter) input.type = allTypeFilter;
      if (allDaysFilter !== 'all') input.days = parseInt(allDaysFilter);

      const data = await trpcQuery('billAdjustments.list', input);
      // Handle both data.items or data directly as array
      if (data?.items) {
        setAllRequests(data.items);
        setAllTotalCount(data.total || 0);
      } else if (Array.isArray(data)) {
        setAllRequests(data);
        setAllTotalCount(data.length);
      } else {
        setAllRequests([]);
      }
    } catch (err) {
      console.error('All requests load error:', err);
      setAlert({ type: 'error', msg: 'Failed to load requests' });
    } finally {
      setLoading(false);
    }
  }, [allPage, allStatusFilter, allTypeFilter, allDaysFilter]);

  // ── Load Config (only for super_admin/hospital_admin) ─────────────────────
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const data = await trpcQuery('billAdjustments.getConfig');
      setConfig(data || {});
    } catch (err) {
      console.error('Config load error:', err);
      setAlert({ type: 'error', msg: 'Failed to load config' });
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load data based on active tab ──────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'queue') loadQueue();
    else if (activeTab === 'all') loadAllRequests();
    else if (activeTab === 'config') loadConfig();
    else setLoading(false);
  }, [activeTab, loadQueue, loadAllRequests, loadConfig]);

  // ── Auto-dismiss alerts ───────────────────────────────────────────────────
  useEffect(() => {
    if (alert?.type === 'success') {
      const timer = setTimeout(() => setAlert(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  // ── Select request for detail panel ───────────────────────────────────────
  const selectRequest = (req: any) => {
    setSelectedRequest(req);
    setApprovalMode(null);
    setApprovalNotes('');
    setRejectionReason('');
  };

  // ── Compute tier for new request ──────────────────────────────────────────
  const computeTier = (amount: number, type: string): number => {
    if (type === 'hardship') return 4;
    if (amount <= 5000) return 1;
    if (amount <= 50000) return 2;
    if (amount <= 200000) return 3;
    return 4;
  };

  const adjustmentAmtNum = parseFloat(newAdjustmentAmount) || 0;
  const currentTier = computeTier(adjustmentAmtNum, newType);
  const adjustedAmount = (parseFloat(newOriginalAmount) || 0) - adjustmentAmtNum;

  // ── Submit approval ───────────────────────────────────────────────────────
  const submitApproval = async () => {
    if (!selectedRequest) return;
    if (approvalMode === 'approve') {
      try {
        setSubmittingApproval(true);
        await trpcMutate('billAdjustments.approve', {
          adjustment_id: selectedRequest.id,
          notes: approvalNotes || undefined,
        });
        setAlert({ type: 'success', msg: 'Approval submitted' });
        setSelectedRequest(null);
        setApprovalMode(null);
        loadQueue();
        loadAllRequests();
      } catch (err) {
        setAlert({ type: 'error', msg: 'Failed to approve' });
      } finally {
        setSubmittingApproval(false);
      }
    } else if (approvalMode === 'reject') {
      if (!rejectionReason.trim()) {
        setAlert({ type: 'error', msg: 'Rejection reason required' });
        return;
      }
      try {
        setSubmittingApproval(true);
        await trpcMutate('billAdjustments.reject', {
          adjustment_id: selectedRequest.id,
          rejection_reason: rejectionReason,
        });
        setAlert({ type: 'success', msg: 'Rejection submitted' });
        setSelectedRequest(null);
        setApprovalMode(null);
        loadQueue();
        loadAllRequests();
      } catch (err) {
        setAlert({ type: 'error', msg: 'Failed to reject' });
      } finally {
        setSubmittingApproval(false);
      }
    }
  };

  // ── Submit new request ────────────────────────────────────────────────────
  const submitNewRequest = async () => {
    if (!newReason.trim()) {
      setAlert({ type: 'error', msg: 'Reason required' });
      return;
    }
    const adjAmt = parseFloat(newAdjustmentAmount) || 0;
    if (adjAmt <= 0) {
      setAlert({ type: 'error', msg: 'Adjustment amount must be > 0' });
      return;
    }
    try {
      setSubmittingRequest(true);
      const res = await trpcMutate('billAdjustments.request', {
        type: newType,
        original_amount: parseFloat(newOriginalAmount) || 0,
        adjustment_amount: adjAmt,
        reason: newReason,
        category: newCategory,
        justification: newJustification || undefined,
        patient_id: newPatientId || undefined,
        encounter_id: newEncounterId || undefined,
      });
      if (res?.auto_approved) {
        setAlert({ type: 'success', msg: 'Auto-approved!' });
      } else {
        setAlert({ type: 'success', msg: `Pending Tier ${res?.required_tier || 2} approval` });
      }
      // Reset form
      setNewType('waiver');
      setNewOriginalAmount('');
      setNewAdjustmentAmount('');
      setNewReason('');
      setNewCategory('service_issue');
      setNewJustification('');
      setNewPatientId('');
      setNewEncounterId('');
    } catch (err) {
      setAlert({ type: 'error', msg: 'Failed to submit request' });
    } finally {
      setSubmittingRequest(false);
    }
  };

  // ── Update config value ───────────────────────────────────────────────────
  const updateConfigValue = async (key: string, newValue: any) => {
    try {
      await trpcMutate('billAdjustments.updateConfig', { key, value: newValue });
      setAlert({ type: 'success', msg: 'Config updated' });
      loadConfig();
    } catch (err) {
      setAlert({ type: 'error', msg: 'Failed to update config' });
    }
  };

  const canSeeConfig = ['super_admin', 'hospital_admin'].includes(userRole);

  const formatINR = (amt: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt);

  const truncate = (s: string, len: number) => (s.length > len ? s.slice(0, len) + '...' : s);

  // ── Render Approval Chain Timeline ──────────────────────────────────────
  const renderApprovalChain = (chain: any[] | undefined) => {
    if (!chain || chain.length === 0) return <p style={{ color: '#6b7280', marginTop: '12px' }}>No chain yet</p>;
    return (
      <div style={{ marginTop: '12px' }}>
        {chain.map((entry: any, idx: number) => {
          const dotColor =
            entry.action === 'requested' ? '#2563eb' : entry.action === 'approved' ? '#059669' : '#dc2626';
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '10px' }}>
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: dotColor,
                  marginRight: '10px',
                  marginTop: '3px',
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontSize: '14px', color: '#111827' }}>
                  <strong>{entry.user_name}</strong> {entry.action}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
                {entry.notes && <div style={{ fontSize: '13px', color: '#4b5563', marginTop: '4px' }}>{entry.notes}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Render detail panel ─────────────────────────────────────────────────
  const renderDetailPanel = () => {
    if (!selectedRequest) return null;
    const req = selectedRequest;
    const badge = TYPE_BADGES[req.type] || TYPE_BADGES.waiver;
    const statusBadge = STATUS_BADGES[req.status] || STATUS_BADGES.pending;

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '480px',
          height: '100vh',
          backgroundColor: 'white',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.1)',
          overflowY: 'auto',
          zIndex: 100,
        }}
      >
        <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>Request Details</h3>
            <button
              onClick={() => setSelectedRequest(null)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#6b7280',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '20px' }}>
          {/* Badges */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: badge.bg,
                color: badge.color,
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '500',
              }}
            >
              {badge.label}
            </span>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: statusBadge.bg,
                color: statusBadge.color,
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '500',
              }}
            >
              {statusBadge.label}
            </span>
          </div>

          {/* Basic Info */}
          <div style={{ backgroundColor: '#f9fafb', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Original Amount</div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                  {formatINR(req.original_amount || 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Adjustment Amount</div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>
                  {formatINR(req.adjustment_amount || 0)}
                </div>
              </div>
            </div>
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Adjusted Amount</div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#2563eb' }}>
                {formatINR((req.original_amount || 0) - (req.adjustment_amount || 0))}
              </div>
            </div>
          </div>

          {/* Tier & Requester */}
          <div style={{ backgroundColor: '#f9fafb', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Approval Tier</div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
                  Tier {req.approval_tier} ({TIER_ROLES[req.approval_tier] || '?'})
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Requester</div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
                  {req.approval_chain?.[0]?.user_name || 'Unknown'}
                </div>
              </div>
            </div>
          </div>

          {/* Reason & Category */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: '500' }}>Reason</div>
            <div style={{ fontSize: '14px', color: '#111827', backgroundColor: '#f9fafb', padding: '8px', borderRadius: '6px' }}>
              {req.reason}
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: '500' }}>Category</div>
            <div style={{ fontSize: '14px', color: '#111827' }}>{req.category}</div>
          </div>

          {/* Approval Chain Timeline */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px', fontWeight: '500' }}>Approval Chain</div>
            {renderApprovalChain(req.approval_chain)}
          </div>

          {/* Approval/Reject Buttons */}
          {approvalMode === null && req.status === 'pending' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setApprovalMode('approve')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Approve
              </button>
              <button
                onClick={() => setApprovalMode('reject')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                Reject
              </button>
            </div>
          )}

          {/* Approval mode: notes ────────────────────────────────────────────*/}
          {approvalMode === 'approve' && (
            <div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
                  Approval Notes (optional)
                </label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    minHeight: '80px',
                    boxSizing: 'border-box',
                  }}
                  placeholder="Enter any notes..."
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={submitApproval}
                  disabled={submittingApproval}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#059669',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: submittingApproval ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    opacity: submittingApproval ? 0.7 : 1,
                  }}
                >
                  {submittingApproval ? 'Confirming...' : 'Confirm Approval'}
                </button>
                <button
                  onClick={() => setApprovalMode(null)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#e5e7eb',
                    color: '#111827',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Rejection mode ─────────────────────────────────────────────────*/}
          {approvalMode === 'reject' && (
            <div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
                  Rejection Reason (required)
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    minHeight: '100px',
                    boxSizing: 'border-box',
                  }}
                  placeholder="Enter rejection reason..."
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={submitApproval}
                  disabled={submittingApproval || !rejectionReason.trim()}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: submittingApproval || !rejectionReason.trim() ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    opacity: submittingApproval || !rejectionReason.trim() ? 0.7 : 1,
                  }}
                >
                  {submittingApproval ? 'Confirming...' : 'Confirm Rejection'}
                </button>
                <button
                  onClick={() => setApprovalMode(null)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#e5e7eb',
                    color: '#111827',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', padding: '20px' }}>
      {/* Breadcrumbs */}
      <div style={{ marginBottom: '20px', fontSize: '14px', color: '#6b7280' }}>
        {breadcrumbs.map((b, idx) => (
          <span key={idx}>
            {b.href ? (
              <a href={b.href} style={{ color: '#2563eb', textDecoration: 'none', marginRight: '4px' }}>
                {b.label}
              </a>
            ) : (
              <span>{b.label}</span>
            )}
            {idx < breadcrumbs.length - 1 && <span style={{ margin: '0 8px', color: '#d1d5db' }}>/</span>}
          </span>
        ))}
      </div>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#111827' }}>
          Billing Approvals
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          Manage adjustment requests and approvals
        </p>
      </div>

      {/* Alerts */}
      {alert && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            borderRadius: '8px',
            backgroundColor: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: alert.type === 'success' ? '#166534' : '#991b1b',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          {alert.msg}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '24px',
          backgroundColor: 'white',
          padding: '4px',
          borderRadius: '8px',
          width: 'fit-content',
        }}
      >
        {['queue', 'all', 'new', ...(canSeeConfig ? ['config'] : [])].map((tab: any) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setAllPage(0);
              setSelectedRequest(null);
            }}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? '600' : '400',
              backgroundColor: activeTab === tab ? '#2563eb' : 'transparent',
              color: activeTab === tab ? 'white' : '#6b7280',
              fontSize: '14px',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'queue' ? 'My Queue' : tab === 'all' ? 'All Requests' : tab === 'new' ? 'New Request' : 'Config'}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && activeTab !== 'new' && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading...
        </div>
      )}

      {/* Tab: My Queue ────────────────────────────────────────────────────────*/}
      {activeTab === 'queue' && !loading && (
        <div>
          {queue.length === 0 ? (
            <div
              style={{
                backgroundColor: 'white',
                padding: '40px',
                borderRadius: '12px',
                textAlign: 'center',
                color: '#6b7280',
              }}
            >
              No pending approvals in your queue.
            </div>
          ) : (
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Requester
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Type
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Amount
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Original
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Reason
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Tier
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((req: any) => {
                    const badge = TYPE_BADGES[req.type];
                    return (
                      <tr
                        key={req.id}
                        onClick={() => selectRequest(req)}
                        style={{
                          borderBottom: '1px solid #e5e7eb',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        }}
                      >
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827' }}>
                          {req.approval_chain?.[0]?.user_name || '-'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              backgroundColor: badge.bg,
                              color: badge.color,
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500',
                            }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827', textAlign: 'right' }}>
                          {formatINR(req.adjustment_amount || 0)}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827', textAlign: 'right' }}>
                          {formatINR(req.original_amount || 0)}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>
                          {truncate(req.reason, 50)}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827' }}>
                          Tier {req.approval_tier}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>
                          {new Date(req.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: All Requests ────────────────────────────────────────────────────*/}
      {activeTab === 'all' && !loading && (
        <div>
          {/* Filters */}
          <div
            style={{
              backgroundColor: 'white',
              padding: '16px',
              borderRadius: '12px',
              marginBottom: '16px',
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
                Status
              </label>
              <select
                value={allStatusFilter}
                onChange={(e) => {
                  setAllStatusFilter(e.target.value);
                  setAllPage(0);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '14px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved_tier1">Auto-Approved</option>
                <option value="approved_tier2">Mgr Approved</option>
                <option value="approved_tier3">Accts Approved</option>
                <option value="approved_tier4">GM Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
                Type
              </label>
              <select
                value={allTypeFilter}
                onChange={(e) => {
                  setAllTypeFilter(e.target.value);
                  setAllPage(0);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '14px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="">All</option>
                <option value="waiver">Waiver</option>
                <option value="discount">Discount</option>
                <option value="write_off">Write-off</option>
                <option value="hardship">Hardship</option>
                <option value="goodwill">Goodwill</option>
                <option value="rounding">Rounding</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
                Days
              </label>
              <select
                value={allDaysFilter}
                onChange={(e) => {
                  setAllDaysFilter(e.target.value);
                  setAllPage(0);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '14px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All Time</option>
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
            </div>
          </div>

          {/* Table */}
          {allRequests.length === 0 ? (
            <div
              style={{
                backgroundColor: 'white',
                padding: '40px',
                borderRadius: '12px',
                textAlign: 'center',
                color: '#6b7280',
              }}
            >
              No requests found.
            </div>
          ) : (
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      ID
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Type
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Amount
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Status
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Tier
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Requester
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Created
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>
                      Resolved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allRequests.map((req: any) => {
                    const typeBadge = TYPE_BADGES[req.type];
                    const statusBadge = STATUS_BADGES[req.status];
                    return (
                      <tr
                        key={req.id}
                        onClick={() => selectRequest(req)}
                        style={{
                          borderBottom: '1px solid #e5e7eb',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        }}
                      >
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280', fontFamily: 'monospace' }}>
                          {(req.id || '').substring(0, 8)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              backgroundColor: typeBadge.bg,
                              color: typeBadge.color,
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500',
                            }}
                          >
                            {typeBadge.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827', textAlign: 'right' }}>
                          {formatINR(req.adjustment_amount || 0)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              backgroundColor: statusBadge.bg,
                              color: statusBadge.color,
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500',
                            }}
                          >
                            {statusBadge.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#111827' }}>
                          Tier {req.approval_tier}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>
                          {req.approval_chain?.[0]?.user_name || '-'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>
                          {new Date(req.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: '#6b7280' }}>
                          {req.resolved_at ? new Date(req.resolved_at).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  Page {allPage + 1} of {Math.ceil(allTotalCount / 20)}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setAllPage(Math.max(0, allPage - 1))}
                    disabled={allPage === 0}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '4px',
                      border: '1px solid #d1d5db',
                      cursor: allPage === 0 ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      backgroundColor: 'white',
                      opacity: allPage === 0 ? 0.5 : 1,
                    }}
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setAllPage(allPage + 1)}
                    disabled={allPage >= Math.ceil(allTotalCount / 20) - 1}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '4px',
                      border: '1px solid #d1d5db',
                      cursor: allPage >= Math.ceil(allTotalCount / 20) - 1 ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      backgroundColor: 'white',
                      opacity: allPage >= Math.ceil(allTotalCount / 20) - 1 ? 0.5 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: New Request ─────────────────────────────────────────────────────*/}
      {activeTab === 'new' && (
        <div
          style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '12px',
            maxWidth: '600px',
          }}
        >
          <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600', color: '#111827' }}>
            New Adjustment Request
          </h2>

          {/* Type */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Adjustment Type
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                backgroundColor: 'white',
                cursor: 'pointer',
                boxSizing: 'border-box',
              }}
            >
              <option value="waiver">Waiver</option>
              <option value="discount">Discount</option>
              <option value="write_off">Write-off</option>
              <option value="hardship">Hardship</option>
              <option value="goodwill">Goodwill</option>
              <option value="rounding">Rounding</option>
            </select>
          </div>

          {/* Original Amount */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Original Amount (₹)
            </label>
            <input
              type="number"
              value={newOriginalAmount}
              onChange={(e) => setNewOriginalAmount(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              placeholder="0"
            />
          </div>

          {/* Adjustment Amount */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Adjustment Amount (₹)
            </label>
            <input
              type="number"
              value={newAdjustmentAmount}
              onChange={(e) => setNewAdjustmentAmount(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              placeholder="0"
            />
          </div>

          {/* Adjusted Amount Preview */}
          <div
            style={{
              backgroundColor: '#f3f4f6',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '14px',
              color: '#111827',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Adjusted Amount</span>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#2563eb' }}>
                {formatINR(adjustedAmount)}
              </span>
            </div>
          </div>

          {/* Reason */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Reason (required)
            </label>
            <textarea
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                fontFamily: 'inherit',
                minHeight: '80px',
                boxSizing: 'border-box',
              }}
              placeholder="Enter reason for adjustment..."
            />
          </div>

          {/* Category */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Category
            </label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                backgroundColor: 'white',
                cursor: 'pointer',
                boxSizing: 'border-box',
              }}
            >
              <option value="service_issue">Service Issue</option>
              <option value="financial_hardship">Financial Hardship</option>
              <option value="staff_error">Staff Error</option>
              <option value="insurance_gap">Insurance Gap</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Justification */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Justification
            </label>
            <textarea
              value={newJustification}
              onChange={(e) => setNewJustification(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                fontFamily: 'inherit',
                minHeight: '80px',
                boxSizing: 'border-box',
              }}
              placeholder="Enter detailed justification..."
            />
          </div>

          {/* Patient ID */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Patient ID (optional)
            </label>
            <input
              type="text"
              value={newPatientId}
              onChange={(e) => setNewPatientId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              placeholder="Leave blank if unknown"
            />
          </div>

          {/* Encounter ID */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '6px', fontWeight: '500' }}>
              Encounter ID (optional)
            </label>
            <input
              type="text"
              value={newEncounterId}
              onChange={(e) => setNewEncounterId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              placeholder="Leave blank if unknown"
            />
          </div>

          {/* Tier Preview */}
          <div
            style={{
              backgroundColor: '#f0f9ff',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '20px',
              border: '1px solid #bfdbfe',
              color: '#1e40af',
              fontSize: '14px',
            }}
          >
            <strong>This requires Tier {currentTier} approval</strong>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              {TIER_ROLES[currentTier] || 'Unknown'}
            </div>
          </div>

          {/* Tier Reference Card */}
          <div
            style={{
              backgroundColor: '#f9fafb',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '20px',
              fontSize: '12px',
              color: '#6b7280',
            }}
          >
            <strong style={{ color: '#111827' }}>Approval Tiers</strong>
            <div style={{ marginTop: '8px', lineHeight: '1.6' }}>
              <div>Tier 1: ≤₹5,000 (Auto-approved)</div>
              <div>Tier 2: ₹5,001–₹50,000 (Billing Manager)</div>
              <div>Tier 3: ₹50,001–₹2,00,000 (Accounts Manager)</div>
              <div>Tier 4: &gt;₹2,00,000 or Hardship (GM)</div>
            </div>
          </div>

          {/* Submit button */}
          <button
            onClick={submitNewRequest}
            disabled={submittingRequest || !newReason.trim() || !newAdjustmentAmount || parseFloat(newAdjustmentAmount) <= 0}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor:
                submittingRequest || !newReason.trim() || !newAdjustmentAmount || parseFloat(newAdjustmentAmount) <= 0
                  ? 'not-allowed'
                  : 'pointer',
              fontWeight: '500',
              fontSize: '14px',
              opacity:
                submittingRequest || !newReason.trim() || !newAdjustmentAmount || parseFloat(newAdjustmentAmount) <= 0
                  ? 0.7
                  : 1,
            }}
          >
            {submittingRequest ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      )}

      {/* Tab: Config ──────────────────────────────────────────────────────────*/}
      {activeTab === 'config' && canSeeConfig && !loading && (
        <div>
          {Object.keys(config).length === 0 ? (
            <div
              style={{
                backgroundColor: 'white',
                padding: '40px',
                borderRadius: '12px',
                textAlign: 'center',
                color: '#6b7280',
              }}
            >
              No configuration found.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {Object.entries(config).map(([key, value]: [string, any]) => (
                <ConfigCard key={key} keyName={key} value={value} onUpdate={(v) => updateConfigValue(key, v)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail panel overlay */}
      {renderDetailPanel()}
    </div>
  );
}

// ── Config Card Component ──────────────────────────────────────────────────
function ConfigCard({ keyName, value, onUpdate }: { keyName: string; value: any; onUpdate: (v: any) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState(JSON.stringify(value, null, 2));

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editValue);
      onUpdate(parsed);
      setEditMode(false);
    } catch (err) {
      alert('Invalid JSON');
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'white',
        padding: '16px',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#111827' }}>{keyName}</h3>
        {!editMode && (
          <button
            onClick={() => setEditMode(true)}
            style={{
              padding: '4px 8px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '500',
            }}
          >
            Edit
          </button>
        )}
      </div>

      {editMode ? (
        <div>
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '12px',
              fontFamily: 'monospace',
              minHeight: '120px',
              boxSizing: 'border-box',
              marginBottom: '8px',
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSave}
              style={{
                flex: 1,
                padding: '6px',
                backgroundColor: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500',
              }}
            >
              Save
            </button>
            <button
              onClick={() => setEditMode(false)}
              style={{
                flex: 1,
                padding: '6px',
                backgroundColor: '#e5e7eb',
                color: '#111827',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: '#f9fafb',
            padding: '8px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#6b7280',
            wordBreak: 'break-all',
          }}
        >
          {JSON.stringify(value, null, 2)}
        </div>
      )}
    </div>
  );
}
