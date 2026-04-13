'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────
type TabType = 'board' | 'report' | 'falls_risk' | 'med_errors' | 'falls' | 'analytics' | 'ai-insights';

interface Incident {
  id: string;
  incident_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  incident_date: string;
  location: string;
  status: 'open' | 'under_investigation' | 'closed' | 'resolved';
  patient_id?: string;
  patient_name?: string;
  is_anonymous: boolean;
  reported_by: string;
  created_at: string;
  medication_error_types?: string[];
  prescribed_medication?: string;
  dispensed_medication?: string;
  fall_morse_score?: number;
  fall_location?: string;
  fall_cause?: string;
  injury_severity?: string;
  contributing_factors?: string[];
}

interface FallAssessment {
  id: string;
  patient_id: string;
  patient_name: string;
  morse_score: number;
  risk_category: 'no_risk' | 'low_risk' | 'high_risk';
  history_of_falls: number;
  secondary_diagnosis: number;
  ambulatory_aid: number;
  iv_or_heparin: number;
  gait: number;
  mental_status: number;
  assessed_at: string;
  created_at: string;
}

interface IncidentStats {
  total_open: number;
  sentinel_events_this_month: number;
  high_risk_fall_patients: number;
  pending_approvals: number;
}

interface IncidentAnalytics {
  incidents_by_type: { type: string; count: number }[];
  incidents_by_severity: { severity: string; count: number }[];
  incidents_by_department: { department: string; count: number }[];
  monthly_trend: { month: string; count: number }[];
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
const getIncidentTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    near_miss: '#FCD34D',
    adverse_event: '#FB923C',
    sentinel_event: '#EF4444',
    medication_error: '#A855F7',
    fall: '#3B82F6',
    infection: '#10B981',
    equipment_failure: '#6B7280',
    surgical_complication: '#DC2626',
    patient_complaint: '#06B6D4',
  };
  return colors[type] || '#9CA3AF';
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const getRiskCategoryColor = (category: string): { bg: string; text: string; border: string } => {
  switch (category) {
    case 'no_risk':
      return { bg: '#ECFDF5', text: '#065F46', border: '#D1FAE5' };
    case 'low_risk':
      return { bg: '#FFFBEB', text: '#78350F', border: '#FEE3B0' };
    case 'high_risk':
      return { bg: '#FEE2E2', text: '#7F1D1D', border: '#FECACA' };
    default:
      return { bg: '#F3F4F6', text: '#1F2937', border: '#E5E7EB' };
  }
};

const calculateMorseScore = (
  history: number,
  secondary: number,
  ambulatory: number,
  iv: number,
  gait: number,
  mental: number
): { score: number; category: 'no_risk' | 'low_risk' | 'high_risk' } => {
  const score = history + secondary + ambulatory + iv + gait + mental;
  let category: 'no_risk' | 'low_risk' | 'high_risk' = 'no_risk';
  if (score >= 25 && score < 50) category = 'low_risk';
  if (score >= 50) category = 'high_risk';
  return { score, category };
};

export function IncidentReportingClient() {
  // ──────────── STATE ────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabType>('board');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [fallAssessments, setFallAssessments] = useState<FallAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<IncidentStats>({
    total_open: 0,
    sentinel_events_this_month: 0,
    high_risk_fall_patients: 0,
    pending_approvals: 0,
  });
  const [analytics, setAnalytics] = useState<IncidentAnalytics>({
    incidents_by_type: [],
    incidents_by_severity: [],
    incidents_by_department: [],
    monthly_trend: [],
  });

  // Report Form State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportFormData, setReportFormData] = useState({
    incident_type: 'adverse_event',
    severity: 'medium',
    description: '',
    incident_date: new Date().toISOString().split('T')[0],
    location: '',
    patient_id: '',
    is_anonymous: false,
    involved_staff_ids: '',
    witness_names: '',
    immediate_actions: '',
    patient_outcome: '',
    // Medication error conditional
    medication_error_types: [] as string[],
    prescribed_medication: '',
    dispensed_medication: '',
    // Fall conditional
    fall_morse_score: 0,
    fall_location: '',
    fall_cause: '',
    fall_injury_severity: 'none',
    fall_contributing_factors: [] as string[],
  });

  // Fall Risk Assessment State
  const [morseFormData, setMorseFormData] = useState({
    patient_id: '',
    history_of_falls: 0,
    secondary_diagnosis: 0,
    ambulatory_aid: 0,
    iv_or_heparin: 0,
    gait: 0,
    mental_status: 0,
  });
  const [morseScore, setMorseScore] = useState(0);
  const [morseRiskCategory, setMorseRiskCategory] = useState<'no_risk' | 'low_risk' | 'high_risk'>('no_risk');
  const [submittingMorse, setSubmittingMorse] = useState(false);

  // Filter State
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  // AI Insights State
  const [aiIncidentReport, setAiIncidentReport] = useState<any>(null);
  const [aiQualityCards, setAiQualityCards] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // ──────────── LOAD DATA ────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'board' || activeTab === 'med_errors' || activeTab === 'falls') {
      loadIncidents();
    } else if (activeTab === 'falls_risk') {
      loadFallAssessments();
    } else if (activeTab === 'analytics') {
      loadAnalytics();
    }
  }, [activeTab]);

  const loadIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('incidentReporting.listIncidents', {
        type: filterType || undefined,
        status: filterStatus || undefined,
        severity: filterSeverity || undefined,
        limit: 50,
      });
      setIncidents(data?.incidents || []);
      setStats(data?.stats || {});
    } catch (err) {
      console.error('Load incidents error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterStatus, filterSeverity]);

  const loadFallAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('incidentReporting.listFallAssessments', { limit: 50 });
      setFallAssessments(data?.assessments || []);
    } catch (err) {
      console.error('Load fall assessments error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('incidentReporting.getAnalytics');
      setAnalytics(data?.analytics || {});
      setStats(data?.stats || {});
    } catch (err) {
      console.error('Load analytics error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ──────────── HANDLERS ─────────────────────────────────────
  const handleReportIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportFormData.description || !reportFormData.incident_type) {
      setReportError('Description and incident type are required');
      return;
    }

    setReportLoading(true);
    setReportError('');
    try {
      await trpcMutate('incidentReporting.reportIncident', {
        incident_type: reportFormData.incident_type,
        severity: reportFormData.severity,
        description: reportFormData.description,
        incident_date: reportFormData.incident_date,
        location: reportFormData.location,
        patient_id: reportFormData.patient_id || null,
        is_anonymous: reportFormData.is_anonymous,
        involved_staff_ids: reportFormData.involved_staff_ids || null,
        witness_names: reportFormData.witness_names || null,
        immediate_actions: reportFormData.immediate_actions || null,
        patient_outcome: reportFormData.patient_outcome || null,
        medication_error_types: reportFormData.incident_type === 'medication_error' ? reportFormData.medication_error_types : undefined,
        prescribed_medication: reportFormData.incident_type === 'medication_error' ? reportFormData.prescribed_medication : undefined,
        dispensed_medication: reportFormData.incident_type === 'medication_error' ? reportFormData.dispensed_medication : undefined,
        fall_morse_score: reportFormData.incident_type === 'fall' ? reportFormData.fall_morse_score : undefined,
        fall_location: reportFormData.incident_type === 'fall' ? reportFormData.fall_location : undefined,
        fall_cause: reportFormData.incident_type === 'fall' ? reportFormData.fall_cause : undefined,
        fall_injury_severity: reportFormData.incident_type === 'fall' ? reportFormData.fall_injury_severity : undefined,
        fall_contributing_factors: reportFormData.incident_type === 'fall' ? reportFormData.fall_contributing_factors : undefined,
      });

      setShowReportModal(false);
      setReportFormData({
        incident_type: 'adverse_event',
        severity: 'medium',
        description: '',
        incident_date: new Date().toISOString().split('T')[0],
        location: '',
        patient_id: '',
        is_anonymous: false,
        involved_staff_ids: '',
        witness_names: '',
        immediate_actions: '',
        patient_outcome: '',
        medication_error_types: [],
        prescribed_medication: '',
        dispensed_medication: '',
        fall_morse_score: 0,
        fall_location: '',
        fall_cause: '',
        fall_injury_severity: 'none',
        fall_contributing_factors: [],
      });
      await loadIncidents();
    } catch (err: any) {
      setReportError(err.message || 'Failed to report incident');
    } finally {
      setReportLoading(false);
    }
  };

  const handleSubmitMorseAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!morseFormData.patient_id) {
      alert('Patient ID is required');
      return;
    }

    setSubmittingMorse(true);
    try {
      await trpcMutate('incidentReporting.submitFallAssessment', {
        patient_id: morseFormData.patient_id,
        history_of_falls: morseFormData.history_of_falls,
        secondary_diagnosis: morseFormData.secondary_diagnosis,
        ambulatory_aid: morseFormData.ambulatory_aid,
        iv_or_heparin: morseFormData.iv_or_heparin,
        gait: morseFormData.gait,
        mental_status: morseFormData.mental_status,
        morse_score: morseScore,
        risk_category: morseRiskCategory,
      });

      setMorseFormData({
        patient_id: '',
        history_of_falls: 0,
        secondary_diagnosis: 0,
        ambulatory_aid: 0,
        iv_or_heparin: 0,
        gait: 0,
        mental_status: 0,
      });
      setMorseScore(0);
      setMorseRiskCategory('no_risk');
      await loadFallAssessments();
    } catch (err) {
      console.error('Morse assessment error:', err);
      alert('Failed to submit assessment');
    } finally {
      setSubmittingMorse(false);
    }
  };

  const handleMorseChange = (field: keyof typeof morseFormData, value: number) => {
    const newData = { ...morseFormData, [field]: value };
    setMorseFormData(newData);
    const calc = calculateMorseScore(
      newData.history_of_falls,
      newData.secondary_diagnosis,
      newData.ambulatory_aid,
      newData.iv_or_heparin,
      newData.gait,
      newData.mental_status
    );
    setMorseScore(calc.score);
    setMorseRiskCategory(calc.category);
  };

  const toggleMedicationErrorType = (type: string) => {
    setReportFormData({
      ...reportFormData,
      medication_error_types: reportFormData.medication_error_types.includes(type)
        ? reportFormData.medication_error_types.filter((t) => t !== type)
        : [...reportFormData.medication_error_types, type],
    });
  };

  const toggleFallContributingFactor = (factor: string) => {
    setReportFormData({
      ...reportFormData,
      fall_contributing_factors: reportFormData.fall_contributing_factors.includes(factor)
        ? reportFormData.fall_contributing_factors.filter((f) => f !== factor)
        : [...reportFormData.fall_contributing_factors, factor],
    });
  };

  const filteredIncidents = incidents.filter((inc) => {
    if (filterType && inc.incident_type !== filterType) return false;
    if (filterStatus && inc.status !== filterStatus) return false;
    if (filterSeverity && inc.severity !== filterSeverity) return false;
    return true;
  });

  // ──────────── RENDER ───────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#16213e' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#1a1a2e', borderBottomColor: '#0f3460', borderBottomWidth: 1, borderBottomStyle: 'solid' }}>
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#e0e0e0' }}>
            Incident Reporting &amp; Patient Safety
          </h1>
          <p style={{ color: '#a0a0a0', marginTop: '0.5rem' }}>
            Monitor and manage safety incidents across the hospital
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
        <div
          style={{
            backgroundColor: '#1a1a2e',
            borderBottomColor: '#0f3460',
            borderBottomWidth: 1,
            borderBottomStyle: 'solid',
            borderRadius: '0.5rem 0.5rem 0 0',
            display: 'flex',
            gap: '0.25rem',
            padding: '0 1.5rem',
          }}
        >
          {(
            [
              { id: 'board', label: '📋 Incident Board' },
              { id: 'report', label: '✏️ Report Incident' },
              { id: 'falls_risk', label: '⚠️ Fall Risk' },
              { id: 'med_errors', label: '💊 Medication Errors' },
              { id: 'falls', label: '👥 Falls' },
              { id: 'analytics', label: '📊 Analytics' },
              { id: 'ai-insights', label: '🤖 AI Insights' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '1rem 1.5rem',
                fontWeight: '500',
                borderBottom: activeTab === tab.id ? '2px solid #0f3460' : '2px solid transparent',
                color: activeTab === tab.id ? '#e0e0e0' : '#a0a0a0',
                backgroundColor: activeTab === tab.id ? '#0f3460' : 'transparent',
                transition: 'all 200ms',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB: INCIDENT BOARD */}
      {activeTab === 'board' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          {/* Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ backgroundColor: '#1a1a2e', borderColor: '#0f3460', borderWidth: 1, borderStyle: 'solid', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0' }}>Open Incidents</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#FF6B6B', marginTop: '0.5rem' }}>{stats.total_open}</div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', borderColor: '#0f3460', borderWidth: 1, borderStyle: 'solid', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0' }}>Sentinel Events</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#DC2626', marginTop: '0.5rem' }}>
                {stats.sentinel_events_this_month}
              </div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', borderColor: '#0f3460', borderWidth: 1, borderStyle: 'solid', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0' }}>High-Risk Fall Patients</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#F59E0B', marginTop: '0.5rem' }}>
                {stats.high_risk_fall_patients}
              </div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', borderColor: '#0f3460', borderWidth: 1, borderStyle: 'solid', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0' }}>Pending Approvals</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#3B82F6', marginTop: '0.5rem' }}>
                {stats.pending_approvals}
              </div>
            </div>
          </div>

          {/* Filters & Action Button */}
          <div
            style={{
              backgroundColor: '#1a1a2e',
              borderColor: '#0f3460',
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: '0.5rem',
              padding: '1.5rem',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Type
                </label>
                <select
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: '#16213e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    color: '#e0e0e0',
                    fontSize: '0.875rem',
                  }}
                >
                  <option value="">All Types</option>
                  <option value="near_miss">Near Miss</option>
                  <option value="adverse_event">Adverse Event</option>
                  <option value="sentinel_event">Sentinel Event</option>
                  <option value="medication_error">Medication Error</option>
                  <option value="fall">Fall</option>
                  <option value="infection">Infection</option>
                  <option value="equipment_failure">Equipment Failure</option>
                  <option value="surgical_complication">Surgical Complication</option>
                  <option value="patient_complaint">Patient Complaint</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Status
                </label>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: '#16213e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    color: '#e0e0e0',
                    fontSize: '0.875rem',
                  }}
                >
                  <option value="">All Status</option>
                  <option value="open">Open</option>
                  <option value="under_investigation">Under Investigation</option>
                  <option value="closed">Closed</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Severity
                </label>
                <select
                  value={filterSeverity}
                  onChange={(e) => {
                    setFilterSeverity(e.target.value);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: '#16213e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    color: '#e0e0e0',
                    fontSize: '0.875rem',
                  }}
                >
                  <option value="">All Severities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  onClick={() => {
                    setFilterType('');
                    setFilterStatus('');
                    setFilterSeverity('');
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#0f3460',
                    color: '#e0e0e0',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    border: 'none',
                  }}
                >
                  Clear Filters
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowReportModal(true)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: '#FF6B6B',
                color: 'white',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              ✏️ Report Incident
            </button>
          </div>

          {/* Incidents List */}
          {loading ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>Loading incidents...</div>
          ) : filteredIncidents.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>No incidents found</div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {filteredIncidents.map((incident) => (
                <div
                  key={incident.id}
                  style={{
                    backgroundColor: '#1a1a2e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.5rem',
                    padding: '1.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.25rem 0.75rem',
                            backgroundColor: getIncidentTypeColor(incident.incident_type),
                            color: '#000',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            borderRadius: '9999px',
                          }}
                        >
                          {incident.incident_type.replace('_', ' ').toUpperCase()}
                        </span>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.25rem 0.75rem',
                            backgroundColor:
                              incident.severity === 'critical'
                                ? '#DC2626'
                                : incident.severity === 'high'
                                  ? '#EA580C'
                                  : incident.severity === 'medium'
                                    ? '#F59E0B'
                                    : '#10B981',
                            color: 'white',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            borderRadius: '9999px',
                          }}
                        >
                          {incident.severity.toUpperCase()}
                        </span>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.25rem 0.75rem',
                            backgroundColor:
                              incident.status === 'open'
                                ? '#EF4444'
                                : incident.status === 'under_investigation'
                                  ? '#F59E0B'
                                  : incident.status === 'closed'
                                    ? '#10B981'
                                    : '#3B82F6',
                            color: 'white',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            borderRadius: '9999px',
                          }}
                        >
                          {incident.status.replace('_', ' ').toUpperCase()}
                        </span>
                      </div>
                      <p style={{ color: '#e0e0e0', marginBottom: '0.5rem' }}>{incident.description}</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.875rem', color: '#a0a0a0' }}>
                        <div>
                          <span style={{ fontWeight: '500' }}>Date:</span> {formatDateTime(incident.incident_date)}
                        </div>
                        <div>
                          <span style={{ fontWeight: '500' }}>Location:</span> {incident.location || 'Not specified'}
                        </div>
                        {incident.patient_name && (
                          <div>
                            <span style={{ fontWeight: '500' }}>Patient:</span> {incident.patient_name}
                          </div>
                        )}
                        {incident.is_anonymous && (
                          <div style={{ color: '#FCD34D' }}>
                            <span style={{ fontWeight: '500' }}>🔒 Anonymous Report</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: '#0f3460',
                        color: '#e0e0e0',
                        borderRadius: '0.375rem',
                        fontSize: '0.875rem',
                        fontWeight: '500',
                        cursor: 'pointer',
                        border: 'none',
                      }}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: REPORT INCIDENT */}
      {activeTab === 'report' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          <div
            style={{
              backgroundColor: '#1a1a2e',
              borderColor: '#0f3460',
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: '0.5rem',
              padding: '2rem',
            }}
          >
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1.5rem' }}>Report an Incident</h2>

            <form onSubmit={handleReportIncident} style={{ display: 'grid', gap: '1.5rem' }}>
              {/* Incident Type & Severity */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Incident Type *
                  </label>
                  <select
                    value={reportFormData.incident_type}
                    onChange={(e) => setReportFormData({ ...reportFormData, incident_type: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value="near_miss">Near Miss</option>
                    <option value="adverse_event">Adverse Event</option>
                    <option value="sentinel_event">Sentinel Event</option>
                    <option value="medication_error">Medication Error</option>
                    <option value="fall">Fall</option>
                    <option value="infection">Infection</option>
                    <option value="equipment_failure">Equipment Failure</option>
                    <option value="surgical_complication">Surgical Complication</option>
                    <option value="patient_complaint">Patient Complaint</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Severity *
                  </label>
                  <select
                    value={reportFormData.severity}
                    onChange={(e) => setReportFormData({ ...reportFormData, severity: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Description *
                </label>
                <textarea
                  value={reportFormData.description}
                  onChange={(e) => setReportFormData({ ...reportFormData, description: e.target.value })}
                  placeholder="Detailed description of the incident..."
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#16213e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    color: '#e0e0e0',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Incident Date & Location */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Incident Date
                  </label>
                  <input
                    type="date"
                    value={reportFormData.incident_date}
                    onChange={(e) => setReportFormData({ ...reportFormData, incident_date: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Location
                  </label>
                  <input
                    type="text"
                    placeholder="Ward, ICU, OT, etc..."
                    value={reportFormData.location}
                    onChange={(e) => setReportFormData({ ...reportFormData, location: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  />
                </div>
              </div>

              {/* Patient ID */}
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Patient ID (optional)
                </label>
                <input
                  type="text"
                  placeholder="Patient ID or MRN"
                  value={reportFormData.patient_id}
                  onChange={(e) => setReportFormData({ ...reportFormData, patient_id: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#16213e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    color: '#e0e0e0',
                  }}
                />
              </div>

              {/* Anonymous Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={reportFormData.is_anonymous}
                  onChange={(e) => setReportFormData({ ...reportFormData, is_anonymous: e.target.checked })}
                  style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
                />
                <label style={{ fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', cursor: 'pointer' }}>
                  Submit anonymously
                </label>
              </div>

              {/* Medication Error Conditional */}
              {reportFormData.incident_type === 'medication_error' && (
                <div
                  style={{
                    backgroundColor: '#16213e',
                    borderColor: '#A855F7',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    padding: '1rem',
                  }}
                >
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#e0e0e0', marginBottom: '0.75rem' }}>
                    Medication Error Details
                  </h3>

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                      Error Types
                    </label>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {['wrong_drug', 'wrong_dose', 'wrong_time', 'wrong_patient', 'wrong_route', 'medication_omitted'].map((type) => (
                        <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input
                            type="checkbox"
                            checked={reportFormData.medication_error_types.includes(type)}
                            onChange={() => toggleMedicationErrorType(type)}
                            style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.875rem', color: '#a0a0a0', cursor: 'pointer' }}>
                            {type.replace('_', ' ').toUpperCase()}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                        Prescribed Medication
                      </label>
                      <input
                        type="text"
                        value={reportFormData.prescribed_medication}
                        onChange={(e) => setReportFormData({ ...reportFormData, prescribed_medication: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#16213e',
                          borderColor: '#0f3460',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderRadius: '0.375rem',
                          color: '#e0e0e0',
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                        Dispensed Medication
                      </label>
                      <input
                        type="text"
                        value={reportFormData.dispensed_medication}
                        onChange={(e) => setReportFormData({ ...reportFormData, dispensed_medication: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#16213e',
                          borderColor: '#0f3460',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderRadius: '0.375rem',
                          color: '#e0e0e0',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Fall Conditional */}
              {reportFormData.incident_type === 'fall' && (
                <div
                  style={{
                    backgroundColor: '#16213e',
                    borderColor: '#3B82F6',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    padding: '1rem',
                  }}
                >
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#e0e0e0', marginBottom: '0.75rem' }}>
                    Fall Incident Details
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                        Location
                      </label>
                      <input
                        type="text"
                        value={reportFormData.fall_location}
                        onChange={(e) => setReportFormData({ ...reportFormData, fall_location: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#16213e',
                          borderColor: '#0f3460',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderRadius: '0.375rem',
                          color: '#e0e0e0',
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                        Cause
                      </label>
                      <input
                        type="text"
                        value={reportFormData.fall_cause}
                        onChange={(e) => setReportFormData({ ...reportFormData, fall_cause: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#16213e',
                          borderColor: '#0f3460',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderRadius: '0.375rem',
                          color: '#e0e0e0',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                        Injury Severity
                      </label>
                      <select
                        value={reportFormData.fall_injury_severity}
                        onChange={(e) => setReportFormData({ ...reportFormData, fall_injury_severity: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#16213e',
                          borderColor: '#0f3460',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderRadius: '0.375rem',
                          color: '#e0e0e0',
                        }}
                      >
                        <option value="none">None</option>
                        <option value="minor">Minor</option>
                        <option value="moderate">Moderate</option>
                        <option value="severe">Severe</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                        Morse Score
                      </label>
                      <input
                        type="number"
                        value={reportFormData.fall_morse_score}
                        onChange={(e) => setReportFormData({ ...reportFormData, fall_morse_score: parseInt(e.target.value) })}
                        min="0"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          backgroundColor: '#16213e',
                          borderColor: '#0f3460',
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderRadius: '0.375rem',
                          color: '#e0e0e0',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                      Contributing Factors
                    </label>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {['poor_lighting', 'wet_floor', 'obstacles', 'weak_muscles', 'dizziness', 'confusion'].map((factor) => (
                        <label key={factor} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input
                            type="checkbox"
                            checked={reportFormData.fall_contributing_factors.includes(factor)}
                            onChange={() => toggleFallContributingFactor(factor)}
                            style={{ width: '1rem', height: '1rem', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.875rem', color: '#a0a0a0', cursor: 'pointer' }}>
                            {factor.replace('_', ' ').toUpperCase()}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Optional Fields */}
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Involved Staff IDs (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Comma-separated staff IDs"
                    value={reportFormData.involved_staff_ids}
                    onChange={(e) => setReportFormData({ ...reportFormData, involved_staff_ids: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Witness Names (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Comma-separated names"
                    value={reportFormData.witness_names}
                    onChange={(e) => setReportFormData({ ...reportFormData, witness_names: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Immediate Actions Taken (optional)
                  </label>
                  <textarea
                    placeholder="Describe immediate actions taken..."
                    value={reportFormData.immediate_actions}
                    onChange={(e) => setReportFormData({ ...reportFormData, immediate_actions: e.target.value })}
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                      resize: 'vertical',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                    Patient Outcome (optional)
                  </label>
                  <textarea
                    placeholder="Describe patient outcome..."
                    value={reportFormData.patient_outcome}
                    onChange={(e) => setReportFormData({ ...reportFormData, patient_outcome: e.target.value })}
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#16213e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>

              {reportError && (
                <div
                  style={{
                    backgroundColor: '#7F1D1D',
                    borderColor: '#DC2626',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    padding: '0.75rem',
                    color: '#FECACA',
                    fontSize: '0.875rem',
                  }}
                >
                  {reportError}
                </div>
              )}

              <button
                type="submit"
                disabled={reportLoading}
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: reportLoading ? '#6B7280' : '#FF6B6B',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: reportLoading ? 'not-allowed' : 'pointer',
                  border: 'none',
                }}
              >
                {reportLoading ? 'Submitting...' : '✓ Submit Incident Report'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB: FALL RISK */}
      {activeTab === 'falls_risk' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          <div
            style={{
              backgroundColor: '#1a1a2e',
              borderColor: '#0f3460',
              borderWidth: 1,
              borderStyle: 'solid',
              borderRadius: '0.5rem',
              padding: '2rem',
              marginBottom: '1.5rem',
            }}
          >
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1.5rem' }}>
              Morse Fall Scale Assessment
            </h2>

            <form onSubmit={handleSubmitMorseAssessment} style={{ display: 'grid', gap: '1.5rem' }}>
              {/* Patient ID */}
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                  Patient ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter patient ID"
                  value={morseFormData.patient_id}
                  onChange={(e) => setMorseFormData({ ...morseFormData, patient_id: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#16213e',
                    borderColor: '#0f3460',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: '0.375rem',
                    color: '#e0e0e0',
                  }}
                />
              </div>

              {/* Morse Scale Items */}
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ backgroundColor: '#16213e', padding: '1rem', borderRadius: '0.375rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#e0e0e0', marginBottom: '0.5rem' }}>
                    History of Falls
                  </label>
                  <select
                    value={morseFormData.history_of_falls}
                    onChange={(e) => handleMorseChange('history_of_falls', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#0f3460',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value={0}>No (0)</option>
                    <option value={25}>Yes (25)</option>
                  </select>
                </div>

                <div style={{ backgroundColor: '#16213e', padding: '1rem', borderRadius: '0.375rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#e0e0e0', marginBottom: '0.5rem' }}>
                    Secondary Diagnosis
                  </label>
                  <select
                    value={morseFormData.secondary_diagnosis}
                    onChange={(e) => handleMorseChange('secondary_diagnosis', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#0f3460',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value={0}>No (0)</option>
                    <option value={15}>Yes (15)</option>
                  </select>
                </div>

                <div style={{ backgroundColor: '#16213e', padding: '1rem', borderRadius: '0.375rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#e0e0e0', marginBottom: '0.5rem' }}>
                    Ambulatory Aid
                  </label>
                  <select
                    value={morseFormData.ambulatory_aid}
                    onChange={(e) => handleMorseChange('ambulatory_aid', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#0f3460',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value={0}>None/Bedrest/Nurse assist (0)</option>
                    <option value={15}>Crutches/Cane/Walker (15)</option>
                    <option value={30}>Furniture (30)</option>
                  </select>
                </div>

                <div style={{ backgroundColor: '#16213e', padding: '1rem', borderRadius: '0.375rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#e0e0e0', marginBottom: '0.5rem' }}>
                    IV or Heparin Lock
                  </label>
                  <select
                    value={morseFormData.iv_or_heparin}
                    onChange={(e) => handleMorseChange('iv_or_heparin', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#0f3460',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value={0}>No (0)</option>
                    <option value={20}>Yes (20)</option>
                  </select>
                </div>

                <div style={{ backgroundColor: '#16213e', padding: '1rem', borderRadius: '0.375rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#e0e0e0', marginBottom: '0.5rem' }}>
                    Gait
                  </label>
                  <select
                    value={morseFormData.gait}
                    onChange={(e) => handleMorseChange('gait', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#0f3460',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value={0}>Normal/Bedrest/Wheelchair (0)</option>
                    <option value={10}>Weak (10)</option>
                    <option value={20}>Impaired (20)</option>
                  </select>
                </div>

                <div style={{ backgroundColor: '#16213e', padding: '1rem', borderRadius: '0.375rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#e0e0e0', marginBottom: '0.5rem' }}>
                    Mental Status
                  </label>
                  <select
                    value={morseFormData.mental_status}
                    onChange={(e) => handleMorseChange('mental_status', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      backgroundColor: '#0f3460',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.375rem',
                      color: '#e0e0e0',
                    }}
                  >
                    <option value={0}>Oriented (0)</option>
                    <option value={15}>Forgets limitations (15)</option>
                  </select>
                </div>
              </div>

              {/* Score Display */}
              <div
                style={{
                  backgroundColor: getRiskCategoryColor(morseRiskCategory).bg,
                  borderColor: getRiskCategoryColor(morseRiskCategory).border,
                  borderWidth: 2,
                  borderStyle: 'solid',
                  borderRadius: '0.375rem',
                  padding: '1rem',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '500', color: getRiskCategoryColor(morseRiskCategory).text }}>
                      Morse Score
                    </div>
                    <div style={{ fontSize: '2.25rem', fontWeight: 'bold', color: getRiskCategoryColor(morseRiskCategory).text, marginTop: '0.25rem' }}>
                      {morseScore}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '500', color: getRiskCategoryColor(morseRiskCategory).text }}>
                      Risk Category
                    </div>
                    <div
                      style={{
                        fontSize: '1.25rem',
                        fontWeight: 'bold',
                        color: getRiskCategoryColor(morseRiskCategory).text,
                        marginTop: '0.25rem',
                      }}
                    >
                      {morseRiskCategory === 'no_risk'
                        ? 'NO RISK (< 25)'
                        : morseRiskCategory === 'low_risk'
                          ? 'LOW RISK (25-50)'
                          : 'HIGH RISK (> 50)'}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingMorse}
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: submittingMorse ? '#6B7280' : '#3B82F6',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: submittingMorse ? 'not-allowed' : 'pointer',
                  border: 'none',
                }}
              >
                {submittingMorse ? 'Submitting...' : '✓ Submit Assessment'}
              </button>
            </form>
          </div>

          {/* Recent Assessments */}
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
              Recent Fall Assessments
            </h2>
            {loading ? (
              <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>Loading assessments...</div>
            ) : fallAssessments.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>No assessments found</div>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {fallAssessments.map((assessment) => {
                  const colors = getRiskCategoryColor(assessment.risk_category);
                  return (
                    <div
                      key={assessment.id}
                      style={{
                        backgroundColor: '#1a1a2e',
                        borderColor: '#0f3460',
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderRadius: '0.5rem',
                        padding: '1.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <div>
                          <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#e0e0e0' }}>
                            {assessment.patient_name}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#a0a0a0', marginTop: '0.25rem' }}>
                            ID: {assessment.patient_id}
                          </div>
                        </div>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.5rem 1rem',
                            backgroundColor: colors.bg,
                            color: colors.text,
                            fontSize: '0.875rem',
                            fontWeight: '600',
                            borderRadius: '9999px',
                          }}
                        >
                          {assessment.risk_category === 'no_risk'
                            ? 'NO RISK'
                            : assessment.risk_category === 'low_risk'
                              ? 'LOW RISK'
                              : 'HIGH RISK'}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', fontSize: '0.875rem' }}>
                        <div style={{ color: '#a0a0a0' }}>
                          <span style={{ fontWeight: '500' }}>Score:</span> {assessment.morse_score}
                        </div>
                        <div style={{ color: '#a0a0a0' }}>
                          <span style={{ fontWeight: '500' }}>Assessed:</span> {formatDateTime(assessment.assessed_at)}
                        </div>
                        <div style={{ color: '#a0a0a0' }}>
                          <span style={{ fontWeight: '500' }}>Created:</span> {formatDate(assessment.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: MEDICATION ERRORS */}
      {activeTab === 'med_errors' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1.5rem' }}>
            Medication Errors
          </h2>

          {loading ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>Loading errors...</div>
          ) : incidents.filter((i) => i.incident_type === 'medication_error').length === 0 ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>No medication errors reported</div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {incidents
                .filter((i) => i.incident_type === 'medication_error')
                .map((error) => (
                  <div
                    key={error.id}
                    style={{
                      backgroundColor: '#1a1a2e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.5rem',
                      padding: '1.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.25rem 0.75rem',
                              backgroundColor: '#A855F7',
                              color: 'white',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              borderRadius: '9999px',
                            }}
                          >
                            {error.severity.toUpperCase()}
                          </span>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.25rem 0.75rem',
                              backgroundColor:
                                error.status === 'open'
                                  ? '#EF4444'
                                  : error.status === 'under_investigation'
                                    ? '#F59E0B'
                                    : error.status === 'closed'
                                      ? '#10B981'
                                      : '#3B82F6',
                              color: 'white',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              borderRadius: '9999px',
                            }}
                          >
                            {error.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        <p style={{ color: '#e0e0e0', marginBottom: '0.75rem' }}>{error.description}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.875rem', color: '#a0a0a0' }}>
                          {error.prescribed_medication && (
                            <div>
                              <span style={{ fontWeight: '500' }}>Prescribed:</span> {error.prescribed_medication}
                            </div>
                          )}
                          {error.dispensed_medication && (
                            <div>
                              <span style={{ fontWeight: '500' }}>Dispensed:</span> {error.dispensed_medication}
                            </div>
                          )}
                          <div>
                            <span style={{ fontWeight: '500' }}>Date:</span> {formatDate(error.incident_date)}
                          </div>
                          {error.medication_error_types && error.medication_error_types.length > 0 && (
                            <div>
                              <span style={{ fontWeight: '500' }}>Types:</span> {error.medication_error_types.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: FALLS */}
      {activeTab === 'falls' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1.5rem' }}>
            Fall Events
          </h2>

          {loading ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>Loading falls...</div>
          ) : incidents.filter((i) => i.incident_type === 'fall').length === 0 ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>No fall events reported</div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {incidents
                .filter((i) => i.incident_type === 'fall')
                .map((fall) => (
                  <div
                    key={fall.id}
                    style={{
                      backgroundColor: '#1a1a2e',
                      borderColor: '#0f3460',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: '0.5rem',
                      padding: '1.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.25rem 0.75rem',
                              backgroundColor: fall.injury_severity === 'severe' ? '#DC2626' : fall.injury_severity === 'moderate' ? '#F59E0B' : '#10B981',
                              color: 'white',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              borderRadius: '9999px',
                            }}
                          >
                            {fall.injury_severity ? fall.injury_severity.toUpperCase() : 'UNKNOWN'}
                          </span>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.25rem 0.75rem',
                              backgroundColor:
                                fall.status === 'open'
                                  ? '#EF4444'
                                  : fall.status === 'under_investigation'
                                    ? '#F59E0B'
                                    : fall.status === 'closed'
                                      ? '#10B981'
                                      : '#3B82F6',
                              color: 'white',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              borderRadius: '9999px',
                            }}
                          >
                            {fall.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                        <p style={{ color: '#e0e0e0', marginBottom: '0.75rem' }}>{fall.description}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.875rem', color: '#a0a0a0' }}>
                          {fall.fall_location && (
                            <div>
                              <span style={{ fontWeight: '500' }}>Location:</span> {fall.fall_location}
                            </div>
                          )}
                          {fall.fall_cause && (
                            <div>
                              <span style={{ fontWeight: '500' }}>Cause:</span> {fall.fall_cause}
                            </div>
                          )}
                          <div>
                            <span style={{ fontWeight: '500' }}>Date:</span> {formatDate(fall.incident_date)}
                          </div>
                          {fall.fall_morse_score && (
                            <div>
                              <span style={{ fontWeight: '500' }}>Morse Score:</span> {fall.fall_morse_score}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: ANALYTICS */}
      {activeTab === 'analytics' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1.5rem' }}>
            Safety Analytics
          </h2>

          {loading ? (
            <div style={{ textAlign: 'center', color: '#a0a0a0', padding: '3rem' }}>Loading analytics...</div>
          ) : (
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              {/* Incidents by Type */}
              <div
                style={{
                  backgroundColor: '#1a1a2e',
                  borderColor: '#0f3460',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderRadius: '0.5rem',
                  padding: '1.5rem',
                }}
              >
                <h3 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
                  Incidents by Type
                </h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {analytics.incidents_by_type.map((item) => (
                    <div key={item.type} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ fontSize: '0.875rem', color: '#a0a0a0', minWidth: '150px' }}>
                        {item.type.replace('_', ' ').toUpperCase()}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          backgroundColor: '#0f3460',
                          borderRadius: '0.375rem',
                          height: '1.5rem',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            width: `${(item.count / Math.max(...(analytics.incidents_by_type.map((i) => i.count) || [1])) * 100)}%`,
                            backgroundColor: getIncidentTypeColor(item.type),
                            height: '100%',
                            borderRadius: '0.375rem',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#e0e0e0', minWidth: '40px', textAlign: 'right' }}>
                        {item.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Incidents by Severity */}
              <div
                style={{
                  backgroundColor: '#1a1a2e',
                  borderColor: '#0f3460',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderRadius: '0.5rem',
                  padding: '1.5rem',
                }}
              >
                <h3 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
                  Incidents by Severity
                </h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {analytics.incidents_by_severity.map((item) => {
                    const severityColor =
                      item.severity === 'critical'
                        ? '#DC2626'
                        : item.severity === 'high'
                          ? '#EA580C'
                          : item.severity === 'medium'
                            ? '#F59E0B'
                            : '#10B981';
                    return (
                      <div key={item.severity} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ fontSize: '0.875rem', color: '#a0a0a0', minWidth: '100px' }}>
                          {item.severity.toUpperCase()}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            backgroundColor: '#0f3460',
                            borderRadius: '0.375rem',
                            height: '1.5rem',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              width: `${(item.count / Math.max(...(analytics.incidents_by_severity.map((i) => i.count) || [1])) * 100)}%`,
                              backgroundColor: severityColor,
                              height: '100%',
                              borderRadius: '0.375rem',
                            }}
                          />
                        </div>
                        <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#e0e0e0', minWidth: '40px', textAlign: 'right' }}>
                          {item.count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Departments */}
              <div
                style={{
                  backgroundColor: '#1a1a2e',
                  borderColor: '#0f3460',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderRadius: '0.5rem',
                  padding: '1.5rem',
                }}
              >
                <h3 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
                  Top 5 Departments by Incident Count
                </h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {analytics.incidents_by_department.slice(0, 5).map((item) => (
                    <div key={item.department} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ fontSize: '0.875rem', color: '#a0a0a0', minWidth: '150px' }}>
                        {item.department}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          backgroundColor: '#0f3460',
                          borderRadius: '0.375rem',
                          height: '1.5rem',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            width: `${(item.count / Math.max(...(analytics.incidents_by_department.map((i) => i.count) || [1])) * 100)}%`,
                            backgroundColor: '#3B82F6',
                            height: '100%',
                            borderRadius: '0.375rem',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#e0e0e0', minWidth: '40px', textAlign: 'right' }}>
                        {item.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly Trend */}
              <div
                style={{
                  backgroundColor: '#1a1a2e',
                  borderColor: '#0f3460',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderRadius: '0.5rem',
                  padding: '1.5rem',
                }}
              >
                <h3 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
                  Monthly Trend
                </h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {analytics.monthly_trend.slice(-6).map((item) => (
                    <div key={item.month} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ fontSize: '0.875rem', color: '#a0a0a0', minWidth: '100px' }}>
                        {item.month}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          backgroundColor: '#0f3460',
                          borderRadius: '0.375rem',
                          height: '1.5rem',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            width: `${(item.count / Math.max(...(analytics.monthly_trend.map((i) => i.count) || [1])) * 100)}%`,
                            backgroundColor: '#10B981',
                            height: '100%',
                            borderRadius: '0.375rem',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#e0e0e0', minWidth: '40px', textAlign: 'right' }}>
                        {item.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: AI INSIGHTS */}
      {activeTab === 'ai-insights' && (
        <div style={{ maxWidth: '90rem', margin: '0 auto', padding: '1.5rem 1.5rem' }}>
          {/* Error Display */}
          {aiError && (
            <div
              style={{
                backgroundColor: '#FEE2E2',
                borderColor: '#FCA5A5',
                borderWidth: 1,
                borderStyle: 'solid',
                borderRadius: '0.5rem',
                padding: '1rem',
                marginBottom: '1.5rem',
                color: '#991B1B',
              }}
            >
              {aiError}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={async () => {
                setAiLoading(true);
                setAiError(null);
                try {
                  const res = await fetch('/api/trpc/evenAI.generateIncidentReport', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ json: { days: 30 } }),
                  });
                  const data = await res.json();
                  const result = data.result?.data?.json;
                  if (result?.success) {
                    setAiIncidentReport(result);
                  } else {
                    setAiError('Failed to generate incident report');
                  }
                } catch (err) {
                  setAiError(err instanceof Error ? err.message : 'Error generating report');
                } finally {
                  setAiLoading(false);
                }
              }}
              disabled={aiLoading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#7C3AED',
                color: '#e0e0e0',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: aiLoading ? 'not-allowed' : 'pointer',
                opacity: aiLoading ? 0.6 : 1,
                fontWeight: '500',
              }}
            >
              {aiLoading ? 'Loading...' : 'Generate Incident Report (30d)'}
            </button>
            <button
              onClick={async () => {
                setAiLoading(true);
                setAiError(null);
                try {
                  const res = await fetch('/api/trpc/evenAI.runQualityMonitor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ json: {} }),
                  });
                  const data = await res.json();
                  const result = data.result?.data?.json;
                  if (result?.success) {
                    setAiQualityCards(result.cards || []);
                  } else {
                    setAiError('Failed to run quality monitor');
                  }
                } catch (err) {
                  setAiError(err instanceof Error ? err.message : 'Error running monitor');
                } finally {
                  setAiLoading(false);
                }
              }}
              disabled={aiLoading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#7C3AED',
                color: '#e0e0e0',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: aiLoading ? 'not-allowed' : 'pointer',
                opacity: aiLoading ? 0.6 : 1,
                fontWeight: '500',
              }}
            >
              {aiLoading ? 'Loading...' : 'Run Quality Monitor'}
            </button>
          </div>

          {/* Incident Report Display */}
          {aiIncidentReport && (
            <div
              style={{
                backgroundColor: '#1a1a2e',
                borderColor: '#0f3460',
                borderWidth: 1,
                borderStyle: 'solid',
                borderRadius: '0.5rem',
                padding: '1.5rem',
                marginBottom: '1.5rem',
              }}
            >
              <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
                Incident Trend Report
              </h3>
              <div style={{ fontSize: '0.875rem', color: '#a0a0a0', marginBottom: '1rem' }}>
                Period: {aiIncidentReport.period?.start} to {aiIncidentReport.period?.end}
              </div>
              <div
                style={{
                  backgroundColor: '#0f3460',
                  borderRadius: '0.375rem',
                  padding: '1rem',
                  marginBottom: '1rem',
                  color: '#e0e0e0',
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                }}
              >
                {aiIncidentReport.narrative}
              </div>
              {aiIncidentReport.metrics && Object.keys(aiIncidentReport.metrics).length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  {Object.entries(aiIncidentReport.metrics).map(([key, value]: [string, any]) => (
                    <div
                      key={key}
                      style={{
                        backgroundColor: '#16213e',
                        borderRadius: '0.375rem',
                        padding: '0.75rem',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: '#a0a0a0', marginBottom: '0.25rem' }}>
                        {key.replace(/_/g, ' ').toUpperCase()}
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#7C3AED' }}>
                        {typeof value === 'object' ? JSON.stringify(value) : value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quality Monitor Alerts */}
          {aiQualityCards.length > 0 && (
            <div
              style={{
                backgroundColor: '#1a1a2e',
                borderColor: '#0f3460',
                borderWidth: 1,
                borderStyle: 'solid',
                borderRadius: '0.5rem',
                padding: '1.5rem',
              }}
            >
              <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '1rem' }}>
                Quality Monitor Alerts
              </h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {aiQualityCards.map((card) => {
                  const severityColors: Record<string, string> = {
                    critical: '#DC2626',
                    high: '#EA580C',
                    medium: '#F59E0B',
                    low: '#7C3AED',
                    info: '#7C3AED',
                  };
                  return (
                    <div
                      key={card.id}
                      style={{
                        backgroundColor: '#16213e',
                        borderColor: severityColors[card.severity] || '#7C3AED',
                        borderLeftWidth: '4px',
                        borderLeftStyle: 'solid',
                        borderRadius: '0.375rem',
                        padding: '1rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                        <div
                          style={{
                            width: '2rem',
                            height: '2rem',
                            borderRadius: '0.375rem',
                            backgroundColor: severityColors[card.severity] || '#7C3AED',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ color: 'white', fontSize: '0.875rem', fontWeight: 'bold' }}>
                            {card.severity[0].toUpperCase()}
                          </span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#e0e0e0', fontWeight: '600', marginBottom: '0.25rem' }}>
                            {card.title}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#a0a0a0', marginBottom: '0.5rem' }}>
                            {card.body}
                          </div>
                          {card.action_url && (
                            <a
                              href={card.action_url}
                              style={{
                                fontSize: '0.875rem',
                                color: '#7C3AED',
                                textDecoration: 'none',
                                fontWeight: '500',
                              }}
                            >
                              View Details
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
