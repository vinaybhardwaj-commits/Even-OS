'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { EmptyState } from '@/components/caregiver';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Mutation failed');
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type BillingTab = 'preauth' | 'clearance' | 'discharge' | 'claims' | 'dashboard';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

interface JourneyStep {
  id: string;
  patient_id: string;
  encounter_id: string;
  phase: string;
  step_number: string;
  step_name: string;
  status: string;
  owner_role: string;
  owner_user_id: string | null;
  tat_target_mins: number | null;
  started_at: string | null;
  patient_name: string;
  patient_uhid: string;
  elapsed_mins: number;
  is_overdue: boolean;
}

// ── Indian number formatting ────────────────────────────────────────────────
function formatINR(amount: number | null | undefined): string {
  if (amount == null) return '₹0';
  const abs = Math.abs(amount);
  if (abs >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

function tatColor(elapsed: number, target: number | null): string {
  if (!target) return '#888';
  const pct = elapsed / target;
  if (pct > 1) return '#c62828';
  if (pct > 0.75) return '#e65100';
  return '#2e7d32';
}

function tatLabel(elapsed: number, target: number | null): string {
  if (!target) return '';
  const remaining = target - elapsed;
  if (remaining <= 0) return `⏰ ${formatMins(Math.abs(remaining))} overdue`;
  return `${formatMins(remaining)} remaining`;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function BillingClient({ userId, userRole, userName }: Props) {
  const [activeTab, setActiveTab] = useState<BillingTab>('preauth');
  const [loading, setLoading] = useState(true);
  const [journeySteps, setJourneySteps] = useState<JourneyStep[]>([]);
  const [preAuthClaims, setPreAuthClaims] = useState<any[]>([]);
  const [dischargeQueue, setDischargeQueue] = useState<any[]>([]);
  const [tpaClaims, setTpaClaims] = useState<any[]>([]);
  const [billingStats, setBillingStats] = useState<any>(null);
  const [claimStats, setClaimStats] = useState<any>(null);
  const [completing, setCompleting] = useState<string | null>(null);

  // ── Derived: split journey steps into billing queues ──────────────────
  const preAuthSteps = useMemo(() =>
    journeySteps.filter(s => s.step_number === '1.5'),
    [journeySteps]
  );

  const clearanceSteps = useMemo(() =>
    journeySteps.filter(s => s.step_number === '4.3'),
    [journeySteps]
  );

  const dischargeBillingSteps = useMemo(() =>
    journeySteps.filter(s => s.step_number === '8.4'),
    [journeySteps]
  );

  // ── Claim ratio computation ───────────────────────────────────────────
  const claimRatio = useMemo(() => {
    if (!claimStats) return null;
    const total = claimStats.total_claims || 0;
    const approved = claimStats.approved || claimStats.approved_count || 0;
    const denied = claimStats.denied || claimStats.denied_count || 0;
    const pending = claimStats.pending || claimStats.pending_count || 0;
    const settled = claimStats.settled || claimStats.settled_count || 0;
    const settlementRate = total > 0 ? Math.round((approved / total) * 100) : 0;
    const denialRate = total > 0 ? Math.round((denied / total) * 100) : 0;
    return { total, approved, denied, pending, settled, settlementRate, denialRate };
  }, [claimStats]);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [steps, preauth, dq, tpa, bstats, cstats] = await Promise.all([
        trpcQuery('journeyEngine.getMyPendingSteps', { limit: 100 }),
        trpcQuery('insuranceClaims.listClaims', { status: 'pre_auth_pending' }),
        trpcQuery('encounter.dischargeQueue'),
        trpcQuery('billing.listTpaClaims', {}),
        trpcQuery('billing.billingStats'),
        trpcQuery('insuranceClaims.claimStats'),
      ]);
      // Journey steps for billing roles — filter to steps 1.5, 4.3, 8.4
      const billingStepNums = ['1.5', '4.3', '8.4', '9.1'];
      const allSteps: JourneyStep[] = Array.isArray(steps) ? steps : [];
      setJourneySteps(allSteps.filter(s => billingStepNums.includes(s.step_number)));
      setPreAuthClaims(Array.isArray(preauth) ? preauth : (preauth?.items || []));
      setDischargeQueue(Array.isArray(dq) ? dq : (dq?.items || []));
      setTpaClaims(Array.isArray(tpa) ? tpa : (tpa?.claims || tpa?.items || []));
      setBillingStats(bstats);
      setClaimStats(cstats);
    } catch (err) {
      console.error('Billing load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Complete journey step ─────────────────────────────────────────────
  const handleCompleteStep = async (stepId: string, notes?: string) => {
    setCompleting(stepId);
    try {
      await trpcMutate('journeyEngine.completeStep', {
        step_id: stepId,
        completed_notes: notes || `Completed by ${userName}`,
      });
      await loadData();
    } catch (err) {
      console.error('Complete step error:', err);
      alert('Failed to complete step. Please retry.');
    } finally {
      setCompleting(null);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const timeAgo = (dt: string | null) => {
    if (!dt) return '';
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  // ── Journey Step Card ─────────────────────────────────────────────────
  const JourneyStepCard = ({ step, actionLabel, actionColor }: {
    step: JourneyStep; actionLabel: string; actionColor: string;
  }) => (
    <div style={{
      background: '#fff',
      border: `1px solid ${step.is_overdue ? '#ef9a9a' : '#e0e0e0'}`,
      borderLeft: `4px solid ${step.is_overdue ? '#c62828' : step.status === 'in_progress' ? '#1565c0' : '#ff9800'}`,
      borderRadius: 8, padding: '12px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          {/* Journey context badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 8px', borderRadius: 4, marginBottom: 6,
            background: '#e3f2fd', color: '#1565c0',
          }}>
            STEP {step.step_number} · {step.phase.replace('PHASE_', '').replace(/_/g, ' ')}
          </div>

          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {step.patient_name || 'Patient'}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {step.patient_uhid || ''} · {step.step_name}
          </div>

          {/* TAT indicator */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600,
              color: tatColor(step.elapsed_mins, step.tat_target_mins),
            }}>
              {tatLabel(step.elapsed_mins, step.tat_target_mins)}
            </div>
            {step.tat_target_mins && (
              <div style={{
                flex: '0 0 80px', height: 4, borderRadius: 2,
                background: '#e0e0e0', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${Math.min(100, (step.elapsed_mins / step.tat_target_mins) * 100)}%`,
                  background: tatColor(step.elapsed_mins, step.tat_target_mins),
                }} />
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => handleCompleteStep(step.id)}
          disabled={completing === step.id}
          style={{
            padding: '8px 16px', fontSize: 12, fontWeight: 700,
            background: completing === step.id ? '#ccc' : actionColor,
            color: '#fff', border: 'none', borderRadius: 8,
            cursor: completing === step.id ? 'default' : 'pointer',
            whiteSpace: 'nowrap', minWidth: 100,
          }}
        >
          {completing === step.id ? '⏳ ...' : actionLabel}
        </button>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading billing…</p></div>;
  }

  const totalBillingSteps = preAuthSteps.length + clearanceSteps.length + dischargeBillingSteps.length;

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>💰 Billing Station</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {totalBillingSteps} journey steps · {preAuthClaims.length} insurance claims · {dischargeQueue.length} discharge
          </p>
        </div>
        {/* Claim ratio badge */}
        {claimRatio && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 8,
            background: claimRatio.settlementRate >= 70 ? '#e8f5e9' : claimRatio.settlementRate >= 60 ? '#fff3e0' : '#ffebee',
            border: `1px solid ${claimRatio.settlementRate >= 70 ? '#a5d6a7' : claimRatio.settlementRate >= 60 ? '#ffcc80' : '#ef9a9a'}`,
          }}>
            <span style={{ fontSize: 11, color: '#666' }}>Claim Ratio</span>
            <span style={{
              fontSize: 18, fontWeight: 800,
              color: claimRatio.settlementRate >= 70 ? '#2e7d32' : claimRatio.settlementRate >= 60 ? '#e65100' : '#c62828',
            }}>
              {claimRatio.settlementRate}%
            </span>
          </div>
        )}
      </header>

      {/* Daily Summary Bar */}
      <div style={{
        display: 'flex', gap: 10, padding: '12px 24px', background: '#fff',
        borderBottom: '1px solid #eee', flexWrap: 'wrap',
      }}>
        {[
          { label: 'Charges Today', value: formatINR(billingStats?.charges_today || billingStats?.total_charges), color: '#1565c0' },
          { label: 'Collections Today', value: formatINR(billingStats?.collections_today || billingStats?.total_collected), color: '#2e7d32' },
          { label: 'Outstanding', value: formatINR(billingStats?.outstanding || billingStats?.total_outstanding), color: '#e65100' },
          { label: 'TPA Pending', value: formatINR(claimStats?.pending_amount || claimStats?.total_pending), color: '#7b1fa2' },
          { label: 'Pre-Auth Queue', value: `${preAuthSteps.length}`, color: '#ff6f00' },
          { label: 'Clearance Pending', value: `${clearanceSteps.length}`, color: '#0277bd' },
        ].map(kpi => (
          <div key={kpi.label} style={{
            flex: '1 1 140px', padding: '10px 14px', borderRadius: 8,
            border: '1px solid #e0e0e0', background: '#fafafa', textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0', overflowX: 'auto' }}>
        {([
          { key: 'preauth' as BillingTab, label: `📋 Pre-Auth (${preAuthSteps.length || preAuthClaims.length})` },
          { key: 'clearance' as BillingTab, label: `🔓 Clearance (${clearanceSteps.length})` },
          { key: 'discharge' as BillingTab, label: `🏥 DC Billing (${dischargeBillingSteps.length || dischargeQueue.length})` },
          { key: 'claims' as BillingTab, label: `📄 TPA (${tpaClaims.length})` },
          { key: 'dashboard' as BillingTab, label: '📊 Dashboard' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: '0 0 auto', padding: '10px 16px', fontSize: 13, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 24px 100px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ═══ PRE-AUTH TAB ═══ */}
        {activeTab === 'preauth' && (
          <>
            {/* Journey-driven pre-auth steps */}
            {preAuthSteps.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', marginBottom: 8, letterSpacing: 0.5 }}>
                  🔵 JOURNEY — STEP 1.5: INSURANCE PRE-AUTHORIZATION
                </h3>
                {preAuthSteps.map(step => (
                  <JourneyStepCard
                    key={step.id}
                    step={step}
                    actionLabel="✅ Pre-Auth Done"
                    actionColor="#2e7d32"
                  />
                ))}
              </div>
            )}

            {/* Existing insurance claims queue */}
            {preAuthClaims.length > 0 && (
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#ff9800', marginBottom: 8, letterSpacing: 0.5 }}>
                  🟡 INSURANCE CLAIMS — PRE-AUTH PENDING
                </h3>
                {preAuthClaims.map((claim: any, i: number) => {
                  const isSurgeryTmrw = claim.surgery_date && daysUntil(claim.surgery_date) <= 1;
                  return (
                    <div key={claim.id || i} style={{
                      background: '#fff',
                      border: `1px solid ${isSurgeryTmrw ? '#ef9a9a' : '#e0e0e0'}`,
                      borderLeft: `4px solid ${isSurgeryTmrw ? '#c62828' : claim.ic_status === 'tpa_approved' ? '#4caf50' : '#ff9800'}`,
                      borderRadius: 8, padding: '12px 16px', marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>
                            {claim.patient_name || claim.name_full || 'Patient'}
                          </div>
                          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                            {claim.uhid || ''} · {claim.insurer_name || claim.ic_tpa_name || 'Unknown TPA'}
                            · Amount: {formatINR(claim.approved_amount || claim.ic_approved_amount || claim.requested_amount || claim.ic_requested_amount)}
                          </div>
                          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                            Submitted {timeAgo(claim.submitted_at || claim.ic_created_at || claim.created_at)}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                          background: isSurgeryTmrw ? '#ffebee' : '#fff3e0',
                          color: isSurgeryTmrw ? '#c62828' : '#e65100',
                        }}>
                          {isSurgeryTmrw ? '🔴 Surgery Tomorrow' : '🟡 Pending'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {preAuthSteps.length === 0 && preAuthClaims.length === 0 && (
              <EmptyState title="No Pre-Auth Pending" message="All pre-authorization requests have been processed." icon="✅" />
            )}
          </>
        )}

        {/* ═══ FINANCIAL CLEARANCE TAB ═══ */}
        {activeTab === 'clearance' && (
          clearanceSteps.length === 0 ? (
            <EmptyState title="No Financial Clearance Pending" message="No patients waiting for surgical financial clearance (Step 4.3)." icon="🔓" />
          ) : (
            <>
              <div style={{
                background: '#e3f2fd', borderRadius: 8, padding: '10px 16px', marginBottom: 12,
                border: '1px solid #90caf9', fontSize: 12, color: '#1565c0',
              }}>
                ℹ️ <strong>Step 4.3 — Surgical Financial Clearance:</strong> Confirm pre-auth is approved (insurance) or advance is collected (cash), then issue OT Clearance Slip. The OT cannot proceed until this step is completed.
              </div>
              {clearanceSteps.map(step => (
                <JourneyStepCard
                  key={step.id}
                  step={step}
                  actionLabel="🔓 Grant Clearance"
                  actionColor="#1565c0"
                />
              ))}
            </>
          )
        )}

        {/* ═══ DISCHARGE BILLING TAB ═══ */}
        {activeTab === 'discharge' && (
          <>
            {/* Journey-driven discharge billing steps (8.4) */}
            {dischargeBillingSteps.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', marginBottom: 8, letterSpacing: 0.5 }}>
                  🔵 JOURNEY — STEP 8.4: FINAL BILL & SETTLEMENT
                </h3>
                {dischargeBillingSteps.map(step => (
                  <JourneyStepCard
                    key={step.id}
                    step={step}
                    actionLabel="💰 Bill Settled"
                    actionColor="#2e7d32"
                  />
                ))}
              </div>
            )}

            {/* Existing discharge queue */}
            {dischargeQueue.length > 0 && (
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#ff9800', marginBottom: 8, letterSpacing: 0.5 }}>
                  🟡 DISCHARGE QUEUE
                </h3>
                {dischargeQueue.map((enc: any, i: number) => (
                  <div key={enc.id || i} style={{
                    background: '#fff', border: '1px solid #e0e0e0',
                    borderRadius: 8, padding: '12px 16px', marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>
                          {enc.patient_name || enc.name_full || 'Patient'}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                          {enc.bed_label || enc.bed_code || ''} · {enc.ward_name || ''}
                          · {enc.primary_diagnosis || enc.chief_complaint || enc.discharge_reason || 'N/A'}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          Discharge initiated {timeAgo(enc.discharge_initiated_at || enc.ordered_at || enc.updated_at)}
                        </div>
                      </div>
                      <button style={{
                        padding: '8px 16px', fontSize: 13, fontWeight: 600,
                        background: '#2e7d32', color: '#fff', border: 'none',
                        borderRadius: 8, cursor: 'pointer',
                      }}>💰 Finalize Bill</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dischargeBillingSteps.length === 0 && dischargeQueue.length === 0 && (
              <EmptyState title="No Discharge Billing" message="No patients pending discharge billing." icon="🏥" />
            )}
          </>
        )}

        {/* ═══ TPA CLAIMS TAB ═══ */}
        {activeTab === 'claims' && (
          tpaClaims.length === 0 ? (
            <EmptyState title="No TPA Claims" message="No active TPA claims." icon="📄" />
          ) : (
            tpaClaims.map((claim: any, i: number) => (
              <div key={claim.id || i} style={{
                background: '#fff', border: '1px solid #e0e0e0',
                borderRadius: 8, padding: '10px 14px', marginBottom: 6,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {claim.patient_name || claim.name_full || 'Patient'}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {claim.tpa_name || claim.tc_tpa_name || ''} · {formatINR(claim.claim_amount || claim.tc_amount)}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                  background: (claim.status || claim.tc_status) === 'settled' ? '#e8f5e9'
                    : (claim.status || claim.tc_status) === 'denied' ? '#ffebee' : '#fff3e0',
                  color: (claim.status || claim.tc_status) === 'settled' ? '#2e7d32'
                    : (claim.status || claim.tc_status) === 'denied' ? '#c62828' : '#e65100',
                }}>
                  {claim.status || claim.tc_status || 'pending'}
                </span>
              </div>
            ))
          )
        )}

        {/* ═══ DASHBOARD TAB ═══ */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Claim Ratio — North Star KPI */}
            {claimRatio && (
              <div style={{
                background: '#fff', borderRadius: 12, border: '1px solid #e0e0e0',
                padding: 20, marginBottom: 16,
              }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>
                  🎯 Claim Ratio — North Star KPI
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                  {/* Big number */}
                  <div style={{ textAlign: 'center', minWidth: 120 }}>
                    <div style={{
                      fontSize: 48, fontWeight: 900, lineHeight: 1,
                      color: claimRatio.settlementRate >= 70 ? '#2e7d32'
                        : claimRatio.settlementRate >= 60 ? '#e65100' : '#c62828',
                    }}>
                      {claimRatio.settlementRate}%
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Approval Rate</div>
                    <div style={{
                      fontSize: 11, fontWeight: 600, marginTop: 4,
                      color: claimRatio.settlementRate >= 70 ? '#2e7d32' : '#c62828',
                    }}>
                      Target: 70% → 60%
                    </div>
                  </div>

                  {/* Horizontal bar breakdown */}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{
                      display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden',
                      background: '#e0e0e0', marginBottom: 10,
                    }}>
                      {claimRatio.total > 0 && (
                        <>
                          <div style={{
                            width: `${(claimRatio.approved / claimRatio.total) * 100}%`,
                            background: '#4caf50', transition: 'width 0.3s',
                          }} />
                          <div style={{
                            width: `${(claimRatio.pending / claimRatio.total) * 100}%`,
                            background: '#ff9800', transition: 'width 0.3s',
                          }} />
                          <div style={{
                            width: `${(claimRatio.denied / claimRatio.total) * 100}%`,
                            background: '#f44336', transition: 'width 0.3s',
                          }} />
                        </>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Approved', value: claimRatio.approved, color: '#4caf50' },
                        { label: 'Pending', value: claimRatio.pending, color: '#ff9800' },
                        { label: 'Denied', value: claimRatio.denied, color: '#f44336' },
                        { label: 'Settled', value: claimRatio.settled, color: '#1565c0' },
                      ].map(item => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2, background: item.color }} />
                          <span style={{ fontSize: 12, color: '#666' }}>
                            {item.label}: <strong>{item.value}</strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Billing + Claims grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>💰 Revenue Summary</h3>
                {billingStats ? (
                  <div style={{ fontSize: 13 }}>
                    <p>Total Charges: <strong>{formatINR(billingStats.total_charges)}</strong></p>
                    <p>Total Collected: <strong>{formatINR(billingStats.total_collected)}</strong></p>
                    <p>Outstanding: <strong style={{ color: '#e65100' }}>{formatINR(billingStats.total_outstanding)}</strong></p>
                    <p>Invoices: <strong>{billingStats.invoice_count || 0}</strong></p>
                  </div>
                ) : <p style={{ color: '#888' }}>No billing data available</p>}
              </div>

              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>📋 Journey Steps Active</h3>
                <div style={{ fontSize: 13 }}>
                  <p>Pre-Auth (1.5): <strong style={{ color: preAuthSteps.length > 0 ? '#e65100' : '#2e7d32' }}>
                    {preAuthSteps.length} pending
                  </strong></p>
                  <p>Financial Clearance (4.3): <strong style={{ color: clearanceSteps.length > 0 ? '#e65100' : '#2e7d32' }}>
                    {clearanceSteps.length} pending
                  </strong></p>
                  <p>Discharge Billing (8.4): <strong style={{ color: dischargeBillingSteps.length > 0 ? '#e65100' : '#2e7d32' }}>
                    {dischargeBillingSteps.length} pending
                  </strong></p>
                  <p style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
                    Overdue: <strong style={{ color: journeySteps.filter(s => s.is_overdue).length > 0 ? '#c62828' : '#2e7d32' }}>
                      {journeySteps.filter(s => s.is_overdue).length}
                    </strong>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'billing', label: 'Billing', icon: '💰', href: '/care/billing' },
          { key: 'home', label: 'Home', icon: '⌂', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'billing' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'billing' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function daysUntil(dt: string): number {
  return Math.ceil((new Date(dt).getTime() - Date.now()) / 86400000);
}
