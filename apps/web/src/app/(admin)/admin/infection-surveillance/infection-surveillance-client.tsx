'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
type TabType = 'hai-board' | 'record-hai' | 'infection-rates' | 'antibiotic-stewardship' | 'approval-queue' | 'analytics';
type InfectionType = 'CLABSI' | 'CAUTI' | 'VAP' | 'SSI' | 'MRSA' | 'C_diff' | 'other';

interface InfectionSurveillanceRecord {
  id: string;
  patient_id: string;
  patient_name?: string;
  encounter_id: string;
  infection_type: InfectionType;
  organism: string;
  device_involved?: string;
  device_insertion_date?: string;
  onset_date: string;
  treatment_antibiotic?: string;
  outcome?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface InfectionRate {
  id: string;
  infection_type: InfectionType;
  period_start: string;
  period_end: string;
  numerator: number; // number of infections
  denominator: number; // device-days
  rate: number; // per 1000 device-days
  created_at: string;
}

interface AntibioticUsageLog {
  id: string;
  antibiotic_name: string;
  patient_id: string;
  patient_name?: string;
  dose: string;
  route: string;
  culture_status: string;
  ddd_count: number; // Defined Daily Dose
  is_restricted: boolean;
  dispensed_at: string;
  created_at: string;
}

interface AntibioticApproval {
  id: string;
  antibiotic_name: string;
  patient_id: string;
  patient_name?: string;
  justification_reason: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'denied';
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  review_notes?: string;
  created_at: string;
}

interface SurveillanceStats {
  total_hais_this_month: number;
  hai_rate_this_month: number;
  hai_rate_last_month: number;
  top_organisms: { organism: string; count: number }[];
  restricted_abx_percent: number;
  culture_sensitivity_match_rate: number;
  pending_approvals_count: number;
}

// ─── API Helpers ───────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ─── Helper Functions ───────────────────────────────────────
const getInfectionTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    CLABSI: '#EF4444', // red
    CAUTI: '#F97316', // orange
    VAP: '#EAB308', // yellow
    SSI: '#8B5CF6', // purple
    MRSA: '#EC4899', // pink
    C_diff: '#06B6D4', // cyan
    other: '#6B7280', // gray
  };
  return colors[type] || '#9CA3AF';
};

const getInfectionTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    CLABSI: 'Central Line Bloodstream Infection',
    CAUTI: 'Catheter-Associated Urinary Tract Infection',
    VAP: 'Ventilator-Associated Pneumonia',
    SSI: 'Surgical Site Infection',
    MRSA: 'Methicillin-Resistant S. aureus',
    C_diff: 'Clostridioides difficile',
    other: 'Other HAI',
  };
  return labels[type] || type;
};

const getRateColor = (rate: number): { bg: string; text: string; border: string } => {
  if (rate < 2) return { bg: '#ECFDF5', text: '#065F46', border: '#D1FAE5' }; // green
  if (rate < 5) return { bg: '#FFFBEB', text: '#78350F', border: '#FEE3B0' }; // yellow
  return { bg: '#FEE2E2', text: '#7F1D1D', border: '#FECACA' }; // red
};

const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDateTime = (dateString: string | undefined | null): string => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatNumber = (num: number | undefined | null): string => {
  if (num === undefined || num === null) return '0';
  return num.toLocaleString('en-IN');
};

const formatPercent = (num: number | undefined | null): string => {
  if (num === undefined || num === null) return '0%';
  return `${(num * 100).toFixed(1)}%`;
};

// ─── Main Component ───────────────────────────────────────────
export function InfectionSurveillanceClient() {
  const [activeTab, setActiveTab] = useState<TabType>('hai-board');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // HAI Board
  const [infections, setInfections] = useState<InfectionSurveillanceRecord[]>([]);
  const [filterInfectionType, setFilterInfectionType] = useState<string>('');

  // Record HAI Form
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordFormData, setRecordFormData] = useState({
    patient_id: '',
    encounter_id: '',
    infection_type: 'CLABSI' as InfectionType,
    organism: '',
    device_involved: '',
    device_insertion_date: '',
    onset_date: new Date().toISOString().split('T')[0],
    treatment_antibiotic: '',
    notes: '',
  });
  const [recordLoading, setRecordLoading] = useState(false);

  // Infection Rates
  const [infectionRates, setInfectionRates] = useState<InfectionRate[]>([]);

  // Antibiotic Stewardship
  const [antibioticUsage, setAntibioticUsage] = useState<AntibioticUsageLog[]>([]);
  const [filterIsRestricted, setFilterIsRestricted] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Approval Queue
  const [antibioticApprovals, setAntibioticApprovals] = useState<AntibioticApproval[]>([]);
  const [filterApprovalStatus, setFilterApprovalStatus] = useState<string>('pending');

  // Analytics
  const [stats, setStats] = useState<SurveillanceStats>({
    total_hais_this_month: 0,
    hai_rate_this_month: 0,
    hai_rate_last_month: 0,
    top_organisms: [],
    restricted_abx_percent: 0,
    culture_sensitivity_match_rate: 0,
    pending_approvals_count: 0,
  });

  // Fetch HAI Board
  const fetchInfections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('infectionSurveillance.listInfections', { limit: 100 });
      setInfections(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Infection Rates
  const fetchInfectionRates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('infectionSurveillance.listInfectionRates', { limit: 100 });
      setInfectionRates(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Antibiotic Usage
  const fetchAntibioticUsage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('infectionSurveillance.listAntibioticUsage', {
        limit: 100,
        is_restricted: filterIsRestricted === 'true' ? true : filterIsRestricted === 'false' ? false : undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined,
      });
      setAntibioticUsage(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterIsRestricted, filterDateFrom, filterDateTo]);

  // Fetch Antibiotic Approvals
  const fetchAntibioticApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('infectionSurveillance.listAntibioticApprovals', {
        limit: 100,
        status: filterApprovalStatus || undefined,
      });
      setAntibioticApprovals(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterApprovalStatus]);

  // Fetch Analytics
  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('infectionSurveillance.getSurveillanceStats');
      setStats(
        data || {
          total_hais_this_month: 0,
          hai_rate_this_month: 0,
          hai_rate_last_month: 0,
          top_organisms: [],
          restricted_abx_percent: 0,
          culture_sensitivity_match_rate: 0,
          pending_approvals_count: 0,
        }
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tab effects
  useEffect(() => {
    if (activeTab === 'hai-board') fetchInfections();
    else if (activeTab === 'infection-rates') fetchInfectionRates();
    else if (activeTab === 'antibiotic-stewardship') fetchAntibioticUsage();
    else if (activeTab === 'approval-queue') fetchAntibioticApprovals();
    else if (activeTab === 'analytics') fetchAnalytics();
  }, [activeTab, fetchInfections, fetchInfectionRates, fetchAntibioticUsage, fetchAntibioticApprovals, fetchAnalytics]);

  // Handle Record HAI
  const handleRecordHAI = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecordLoading(true);
    setError('');
    try {
      await trpcMutate('infectionSurveillance.recordInfection', recordFormData);
      setSuccess('HAI recorded successfully');
      setShowRecordModal(false);
      setRecordFormData({
        patient_id: '',
        encounter_id: '',
        infection_type: 'CLABSI',
        organism: '',
        device_involved: '',
        device_insertion_date: '',
        onset_date: new Date().toISOString().split('T')[0],
        treatment_antibiotic: '',
        notes: '',
      });
      fetchInfections();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRecordLoading(false);
    }
  };

  // Handle Approve/Deny Approval
  const handleApproveRequest = async (approvalId: string, approved: boolean) => {
    setError('');
    try {
      await trpcMutate('infectionSurveillance.updateApprovalStatus', {
        approval_id: approvalId,
        status: approved ? 'approved' : 'denied',
      });
      setSuccess(`Approval ${approved ? 'approved' : 'denied'}`);
      fetchAntibioticApprovals();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredInfections = filterInfectionType
    ? infections.filter((x) => x.infection_type === filterInfectionType)
    : infections;

  const filteredApprovals = antibioticApprovals.filter((x) => {
    if (filterApprovalStatus && x.status !== filterApprovalStatus) return false;
    return true;
  });

  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <div style={{ backgroundColor: '#0f172a', minHeight: '100vh', color: '#e2e8f0', padding: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          💉 Infection Surveillance & Antibiotic Stewardship
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Monitor HAIs, manage antibiotic usage, and track resistance patterns</p>
      </div>

      {/* Alerts */}
      {error && (
        <div
          style={{
            backgroundColor: '#7f1d1d',
            color: '#fecaca',
            padding: '1rem',
            borderRadius: '0.5rem',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            border: '1px solid #dc2626',
          }}
        >
          ⚠ {error}
        </div>
      )}
      {success && (
        <div
          style={{
            backgroundColor: '#064e3b',
            color: '#d1fae5',
            padding: '1rem',
            borderRadius: '0.5rem',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            border: '1px solid #10b981',
          }}
        >
          ✓ {success}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '2rem',
          borderBottom: '1px solid #334155',
          paddingBottom: '1rem',
          overflowX: 'auto',
        }}
      >
        {([
          ['hai-board', '🏥 HAI Board'],
          ['record-hai', '📝 Record HAI'],
          ['infection-rates', '📊 Infection Rates'],
          ['antibiotic-stewardship', '💊 Antibiotic Stewardship'],
          ['approval-queue', '✓ Approval Queue'],
          ['analytics', '📈 Analytics'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
              color: activeTab === id ? '#93c5fd' : '#cbd5e1',
              fontSize: '0.9rem',
              fontWeight: activeTab === id ? '600' : 'normal',
              borderBottom: activeTab === id ? '2px solid #3b82f6' : 'none',
              marginBottom: '-1rem',
              paddingBottom: 'calc(0.75rem + 1rem)',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {/* 1. HAI BOARD TAB */}
        {activeTab === 'hai-board' && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: 1 }}>
                <input
                  type="text"
                  placeholder="Search patient ID..."
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '0.5rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    color: '#e2e8f0',
                    fontSize: '0.9rem',
                    flex: 1,
                  }}
                />
                <select
                  value={filterInfectionType}
                  onChange={(e) => setFilterInfectionType(e.target.value)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '0.5rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    color: '#e2e8f0',
                    fontSize: '0.9rem',
                  }}
                >
                  <option value="">All Infection Types</option>
                  {(['CLABSI', 'CAUTI', 'VAP', 'SSI', 'MRSA', 'C_diff', 'other'] as const).map((type) => (
                    <option key={type} value={type}>
                      {getInfectionTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setShowRecordModal(true)}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.9rem',
                }}
              >
                + New HAI
              </button>
            </div>

            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    fontSize: '0.85rem',
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Patient ID</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Infection Type</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Organism</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Onset Date</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Device</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          Loading...
                        </td>
                      </tr>
                    ) : filteredInfections.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No infections recorded
                        </td>
                      </tr>
                    ) : (
                      filteredInfections.map((inf) => (
                        <tr key={inf.id} style={{ borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
                          <td style={{ padding: '0.75rem 1rem', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {inf.patient_id}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span
                              style={{
                                backgroundColor: getInfectionTypeColor(inf.infection_type),
                                color: 'white',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '0.375rem',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                display: 'inline-block',
                              }}
                            >
                              {inf.infection_type}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{inf.organism || '—'}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem' }}>
                            {formatDate(inf.onset_date)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem' }}>
                            {inf.device_involved || '—'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{inf.outcome || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#0f172a',
                  borderTop: '1px solid #334155',
                  color: '#64748b',
                  fontSize: '0.8rem',
                }}
              >
                Showing {filteredInfections.length} infections
              </div>
            </div>
          </div>
        )}

        {/* 2. RECORD HAI TAB */}
        {activeTab === 'record-hai' && (
          <div>
            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                padding: '2rem',
              }}
            >
              <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>Record New HAI</h2>
              <form onSubmit={handleRecordHAI} style={{ display: 'grid', gap: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Patient ID *
                    </label>
                    <input
                      type="text"
                      value={recordFormData.patient_id}
                      onChange={(e) => setRecordFormData({ ...recordFormData, patient_id: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Encounter ID *
                    </label>
                    <input
                      type="text"
                      value={recordFormData.encounter_id}
                      onChange={(e) => setRecordFormData({ ...recordFormData, encounter_id: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Infection Type *
                    </label>
                    <select
                      value={recordFormData.infection_type}
                      onChange={(e) => setRecordFormData({ ...recordFormData, infection_type: e.target.value as InfectionType })}
                      required
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    >
                      {(['CLABSI', 'CAUTI', 'VAP', 'SSI', 'MRSA', 'C_diff', 'other'] as const).map((type) => (
                        <option key={type} value={type}>
                          {getInfectionTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Organism *
                    </label>
                    <input
                      type="text"
                      value={recordFormData.organism}
                      onChange={(e) => setRecordFormData({ ...recordFormData, organism: e.target.value })}
                      placeholder="e.g., E. coli, MRSA, Klebsiella"
                      required
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Device Involved
                    </label>
                    <input
                      type="text"
                      value={recordFormData.device_involved}
                      onChange={(e) => setRecordFormData({ ...recordFormData, device_involved: e.target.value })}
                      placeholder="e.g., Central Line, Foley Catheter"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Device Insertion Date
                    </label>
                    <input
                      type="date"
                      value={recordFormData.device_insertion_date}
                      onChange={(e) => setRecordFormData({ ...recordFormData, device_insertion_date: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Onset Date *
                    </label>
                    <input
                      type="date"
                      value={recordFormData.onset_date}
                      onChange={(e) => setRecordFormData({ ...recordFormData, onset_date: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                      Treatment Antibiotic
                    </label>
                    <input
                      type="text"
                      value={recordFormData.treatment_antibiotic}
                      onChange={(e) => setRecordFormData({ ...recordFormData, treatment_antibiotic: e.target.value })}
                      placeholder="e.g., Meropenem"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        color: '#e2e8f0',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: '500' }}>
                    Notes
                  </label>
                  <textarea
                    value={recordFormData.notes}
                    onChange={(e) => setRecordFormData({ ...recordFormData, notes: e.target.value })}
                    placeholder="Additional notes..."
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      color: '#e2e8f0',
                      fontSize: '0.9rem',
                      minHeight: '100px',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    type="submit"
                    disabled={recordLoading}
                    style={{
                      padding: '0.75rem 2rem',
                      backgroundColor: recordLoading ? '#4b5563' : '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: recordLoading ? 'default' : 'pointer',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                    }}
                  >
                    {recordLoading ? 'Saving...' : 'Record HAI'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 3. INFECTION RATES TAB */}
        {activeTab === 'infection-rates' && (
          <div>
            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    fontSize: '0.85rem',
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Infection Type</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Period</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>Numerator</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>Denominator</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>Rate (per 1000)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          Loading...
                        </td>
                      </tr>
                    ) : infectionRates.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No infection rates calculated yet
                        </td>
                      </tr>
                    ) : (
                      infectionRates.map((rate) => {
                        const rateColor = getRateColor(rate.rate);
                        return (
                          <tr key={rate.id} style={{ borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <span
                                style={{
                                  backgroundColor: getInfectionTypeColor(rate.infection_type),
                                  color: 'white',
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '0.375rem',
                                  fontSize: '0.75rem',
                                  fontWeight: '600',
                                  display: 'inline-block',
                                }}
                              >
                                {rate.infection_type}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem' }}>
                              {formatDate(rate.period_start)} — {formatDate(rate.period_end)}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', textAlign: 'center' }}>
                              {formatNumber(rate.numerator)}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', textAlign: 'center' }}>
                              {formatNumber(rate.denominator)}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                              <span
                                style={{
                                  backgroundColor: rateColor.bg,
                                  color: rateColor.text,
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '0.375rem',
                                  fontSize: '0.75rem',
                                  fontWeight: '600',
                                  display: 'inline-block',
                                  border: `1px solid ${rateColor.border}`,
                                }}
                              >
                                {(rate.rate || 0).toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#0f172a',
                  borderTop: '1px solid #334155',
                  color: '#64748b',
                  fontSize: '0.8rem',
                }}
              >
                Showing {infectionRates.length} rate records
              </div>
            </div>
          </div>
        )}

        {/* 4. ANTIBIOTIC STEWARDSHIP TAB */}
        {activeTab === 'antibiotic-stewardship' && (
          <div>
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <select
                value={filterIsRestricted}
                onChange={(e) => setFilterIsRestricted(e.target.value)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                }}
              >
                <option value="">All Antibiotics</option>
                <option value="true">Restricted Only</option>
                <option value="false">Non-Restricted Only</option>
              </select>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                }}
              />
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                }}
              />
            </div>

            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    fontSize: '0.85rem',
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Antibiotic</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Patient</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Dose & Route</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Culture Status</th>
                      <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>DDD</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          Loading...
                        </td>
                      </tr>
                    ) : antibioticUsage.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No antibiotic usage records
                        </td>
                      </tr>
                    ) : (
                      antibioticUsage.map((usage) => (
                        <tr key={usage.id} style={{ borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
                          <td style={{ padding: '0.75rem 1rem', color: '#e2e8f0', fontWeight: '500' }}>{usage.antibiotic_name}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            {usage.patient_id}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem' }}>
                            {usage.dose} {usage.route}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem' }}>{usage.culture_status || '—'}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', textAlign: 'center' }}>
                            {formatNumber(usage.ddd_count)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            {usage.is_restricted ? (
                              <span
                                style={{
                                  backgroundColor: '#ec4899',
                                  color: 'white',
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '0.375rem',
                                  fontSize: '0.75rem',
                                  fontWeight: '600',
                                  display: 'inline-block',
                                }}
                              >
                                RESTRICTED
                              </span>
                            ) : (
                              <span
                                style={{
                                  backgroundColor: '#10b981',
                                  color: 'white',
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '0.375rem',
                                  fontSize: '0.75rem',
                                  fontWeight: '600',
                                  display: 'inline-block',
                                }}
                              >
                                Approved
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#0f172a',
                  borderTop: '1px solid #334155',
                  color: '#64748b',
                  fontSize: '0.8rem',
                }}
              >
                Showing {antibioticUsage.length} usage records
              </div>
            </div>
          </div>
        )}

        {/* 5. APPROVAL QUEUE TAB */}
        {activeTab === 'approval-queue' && (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <select
                value={filterApprovalStatus}
                onChange={(e) => setFilterApprovalStatus(e.target.value)}
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                }}
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
              </select>
            </div>

            <div
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    fontSize: '0.85rem',
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Antibiotic</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Patient</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Justification</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Requested By</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Status</th>
                      <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          Loading...
                        </td>
                      </tr>
                    ) : filteredApprovals.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No approval requests
                        </td>
                      </tr>
                    ) : (
                      filteredApprovals.map((approval) => (
                        <tr key={approval.id} style={{ borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
                          <td style={{ padding: '0.75rem 1rem', color: '#e2e8f0', fontWeight: '500' }}>{approval.antibiotic_name}</td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            {approval.patient_id}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem', maxWidth: '200px' }}>
                            {approval.justification_reason}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1', fontSize: '0.8rem' }}>{approval.requested_by}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span
                              style={{
                                backgroundColor:
                                  approval.status === 'approved'
                                    ? '#10b981'
                                    : approval.status === 'denied'
                                      ? '#ef4444'
                                      : '#eab308',
                                color: 'white',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '0.375rem',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                display: 'inline-block',
                              }}
                            >
                              {approval.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            {approval.status === 'pending' && (
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                  onClick={() => handleApproveRequest(approval.id, true)}
                                  style={{
                                    padding: '0.35rem 0.75rem',
                                    backgroundColor: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    cursor: 'pointer',
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                  }}
                                >
                                  ✓ Approve
                                </button>
                                <button
                                  onClick={() => handleApproveRequest(approval.id, false)}
                                  style={{
                                    padding: '0.35rem 0.75rem',
                                    backgroundColor: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    cursor: 'pointer',
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                  }}
                                >
                                  ✕ Deny
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#0f172a',
                  borderTop: '1px solid #334155',
                  color: '#64748b',
                  fontSize: '0.8rem',
                }}
              >
                Showing {filteredApprovals.length} approval requests
              </div>
            </div>
          </div>
        )}

        {/* 6. ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Loading...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                {/* Card 1: Total HAIs this month */}
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                  }}
                >
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.75rem' }}>Total HAIs This Month</p>
                  <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#e2e8f0' }}>
                    {formatNumber(stats.total_hais_this_month)}
                  </p>
                </div>

                {/* Card 2: HAI Rate Trend */}
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                  }}
                >
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.75rem' }}>HAI Rate Trend</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#e2e8f0' }}>
                    This: {(stats.hai_rate_this_month || 0).toFixed(2)} | Last: {(stats.hai_rate_last_month || 0).toFixed(2)}
                  </p>
                  <p
                    style={{
                      fontSize: '0.8rem',
                      color:
                        (stats.hai_rate_this_month || 0) < (stats.hai_rate_last_month || 0) ? '#10b981' : '#ef4444',
                      marginTop: '0.5rem',
                    }}
                  >
                    {(stats.hai_rate_this_month || 0) < (stats.hai_rate_last_month || 0) ? '✓ Improving' : '⚠ Worsening'}
                  </p>
                </div>

                {/* Card 3: Restricted Antibiotic Usage */}
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                  }}
                >
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.75rem' }}>Restricted Abx Usage</p>
                  <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#e2e8f0' }}>
                    {formatPercent(stats.restricted_abx_percent)}
                  </p>
                </div>

                {/* Card 4: Culture-Sensitivity Match Rate */}
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                  }}
                >
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.75rem' }}>Culture-Sensitivity Match</p>
                  <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#e2e8f0' }}>
                    {formatPercent(stats.culture_sensitivity_match_rate)}
                  </p>
                </div>

                {/* Card 5: Pending Approvals */}
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                  }}
                >
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.75rem' }}>Pending Approvals</p>
                  <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#eab308' }}>
                    {formatNumber(stats.pending_approvals_count)}
                  </p>
                </div>

                {/* Card 6: Top Organisms */}
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                  }}
                >
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.75rem' }}>Top 3 Organisms</p>
                  {stats.top_organisms && stats.top_organisms.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {stats.top_organisms.slice(0, 3).map((org, idx) => (
                        <p key={idx} style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                          {org.organism} — {formatNumber(org.count)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.9rem', color: '#64748b' }}>No data</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
