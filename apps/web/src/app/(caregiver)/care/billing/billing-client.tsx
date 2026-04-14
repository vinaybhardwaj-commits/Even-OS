'use client';

import { useState, useEffect, useCallback } from 'react';
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

// ── Types ───────────────────────────────────────────────────────────────────
type BillingTab = 'preauth' | 'discharge' | 'claims' | 'summary';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
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

// ── Component ───────────────────────────────────────────────────────────────
export default function BillingClient({ userId, userRole, userName }: Props) {
  const [activeTab, setActiveTab] = useState<BillingTab>('preauth');
  const [loading, setLoading] = useState(true);
  const [preAuthClaims, setPreAuthClaims] = useState<any[]>([]);
  const [dischargeQueue, setDischargeQueue] = useState<any[]>([]);
  const [tpaClaims, setTpaClaims] = useState<any[]>([]);
  const [billingStats, setBillingStats] = useState<any>(null);
  const [claimStats, setClaimStats] = useState<any>(null);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [preauth, dq, tpa, bstats, cstats] = await Promise.all([
        trpcQuery('insuranceClaims.listClaims', { status: 'pre_auth_pending' }),
        trpcQuery('encounter.dischargeQueue'),
        trpcQuery('billing.listTpaClaims', {}),
        trpcQuery('billing.billingStats'),
        trpcQuery('insuranceClaims.claimStats'),
      ]);
      setPreAuthClaims(Array.isArray(preauth) ? preauth : (preauth?.items || []));
      // encounter.dischargeQueue returns { items, ... } or array
      setDischargeQueue(Array.isArray(dq) ? dq : (dq?.items || []));
      // billing.listTpaClaims returns { claims, pagination } or array
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

  // ── Helpers ───────────────────────────────────────────────────────────
  const timeAgo = (dt: string | null) => {
    if (!dt) return '';
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading billing…</p></div>;
  }

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
            {preAuthClaims.length} pre-auth pending · {dischargeQueue.length} discharge billing
          </p>
        </div>
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
        ].map(kpi => (
          <div key={kpi.label} style={{
            flex: '1 1 180px', padding: '10px 14px', borderRadius: 8,
            border: '1px solid #e0e0e0', background: '#fafafa', textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        {([
          { key: 'preauth' as BillingTab, label: `📋 Pre-Auth (${preAuthClaims.length})` },
          { key: 'discharge' as BillingTab, label: `🏥 Discharge (${dischargeQueue.length})` },
          { key: 'claims' as BillingTab, label: `📄 TPA Claims (${tpaClaims.length})` },
          { key: 'summary' as BillingTab, label: '📊 Summary' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none',
            borderBottom: activeTab === tab.key ? '3px solid #1565c0' : '3px solid transparent',
            background: 'transparent', color: activeTab === tab.key ? '#1565c0' : '#888',
            cursor: 'pointer',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 24px 100px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ═══ PRE-AUTH TAB ═══ */}
        {activeTab === 'preauth' && (
          preAuthClaims.length === 0 ? (
            <EmptyState title="No Pre-Auth Pending" message="All pre-authorization requests have been processed." icon="✅" />
          ) : (
            preAuthClaims.map((claim: any, i: number) => {
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
            })
          )
        )}

        {/* ═══ DISCHARGE BILLING TAB ═══ */}
        {activeTab === 'discharge' && (
          dischargeQueue.length === 0 ? (
            <EmptyState title="No Discharge Billing" message="No patients pending discharge billing." icon="🏥" />
          ) : (
            dischargeQueue.map((enc: any, i: number) => (
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
            ))
          )
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

        {/* ═══ SUMMARY TAB ═══ */}
        {activeTab === 'summary' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>💰 Billing Overview</h3>
              {billingStats ? (
                <div style={{ fontSize: 13 }}>
                  <p>Total Charges: <strong>{formatINR(billingStats.total_charges)}</strong></p>
                  <p>Total Collected: <strong>{formatINR(billingStats.total_collected)}</strong></p>
                  <p>Outstanding: <strong style={{ color: '#e65100' }}>{formatINR(billingStats.total_outstanding)}</strong></p>
                  <p>Invoices Generated: <strong>{billingStats.invoice_count || 0}</strong></p>
                </div>
              ) : <p style={{ color: '#888' }}>No billing data available</p>}
            </div>
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>📄 Claims Overview</h3>
              {claimStats ? (
                <div style={{ fontSize: 13 }}>
                  <p>Total Claims: <strong>{claimStats.total_claims || 0}</strong></p>
                  <p>Pending: <strong style={{ color: '#e65100' }}>{claimStats.pending || claimStats.pending_count || 0}</strong></p>
                  <p>Approved: <strong style={{ color: '#2e7d32' }}>{claimStats.approved || claimStats.approved_count || 0}</strong></p>
                  <p>Denied: <strong style={{ color: '#c62828' }}>{claimStats.denied || claimStats.denied_count || 0}</strong></p>
                  <p>Settlement Rate: <strong>{claimStats.settlement_rate ? `${claimStats.settlement_rate}%` : 'N/A'}</strong></p>
                </div>
              ) : <p style={{ color: '#888' }}>No claim data available</p>}
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
