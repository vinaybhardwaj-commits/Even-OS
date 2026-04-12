'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── TYPES ────────────────────────────────────────────────────
type TabType = 'safety-rounds' | 'round-findings' | 'templates' | 'clinical-audits' | 'complaints' | 'indicators' | 'analytics';

interface SafetyRound {
  id: string;
  department: string;
  scheduled_date: string;
  template_name: string;
  assigned_to: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  findings_count: number;
}

interface Findings {
  id: string;
  round_id: string;
  round_department: string;
  checklist_item: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  responsible_person: string;
  target_date: string;
  status: 'open' | 'in_progress' | 'closed';
}

interface Template {
  id: string;
  template_name: string;
  description: string;
  checklist_items: string[];
  item_count: number;
}

interface ClinicalAudit {
  id: string;
  nabh_chapter: string;
  audit_type: string;
  scheduled_date: string;
  sample_size: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  compliance_score: number | null;
}

interface Complaint {
  id: string;
  complaint_id: string;
  category: string;
  department: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'escalated';
  submitted_date: string;
  due_date: string;
  overdue: boolean;
}

interface IndicatorDefinition {
  id: string;
  indicator_id: string;
  name: string;
  nabh_chapter: string;
  department: string;
  frequency: string;
  data_source: string;
  definition_status: 'assumed' | 'confirmed';
}

interface AnalyticsData {
  total_rounds_month: number;
  open_findings: number;
  avg_audit_compliance: number;
  open_complaints: number;
  sla_breach_rate: number;
  confirmed_indicators: number;
}

// ─── HELPERS ────────────────────────────────────────────────────
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatNumber(num: number | null | undefined): number {
  return num ?? 0;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    'scheduled': '#3b82f6',
    'in_progress': '#f59e0b',
    'completed': '#10b981',
    'cancelled': '#ef4444',
    'open': '#ef4444',
    'acknowledged': '#3b82f6',
    'resolved': '#10b981',
    'escalated': '#ef4444',
    'pending': '#9ca3af',
    'low': '#10b981',
    'medium': '#f59e0b',
    'high': '#ef4444',
    'critical': '#dc2626',
    'assumed': '#eab308',
    'confirmed': '#10b981',
  };
  return colors[status] || '#6b7280';
}

function getStatusLabel(status: string): string {
  return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Query failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Mutation failed');
  return json.result?.data;
}

// ─── MAIN COMPONENT ────────────────────────────────────────────
export function SafetyAuditsClient() {
  const [activeTab, setActiveTab] = useState<TabType>('safety-rounds');
  const [safetyRounds, setSafetyRounds] = useState<SafetyRound[]>([]);
  const [roundFindings, setRoundFindings] = useState<Findings[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [clinicalAudits, setClinicalAudits] = useState<ClinicalAudit[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [indicators, setIndicators] = useState<IndicatorDefinition[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showNewRoundForm, setShowNewRoundForm] = useState(false);
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const [showNewAuditForm, setShowNewAuditForm] = useState(false);
  const [newRound, setNewRound] = useState({ department: '', scheduled_date: '', template_id: '' });
  const [newTemplate, setNewTemplate] = useState({ template_name: '', description: '', checklist_items: '' });
  const [newAudit, setNewAudit] = useState({ nabh_chapter: '', audit_type: '', scheduled_date: '', sample_size: 10 });

  const fetchSafetyRounds = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.listRounds', { limit: 100 });
      setSafetyRounds(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRoundFindings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.listFindings', { limit: 100 });
      setRoundFindings(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.listTemplates', { limit: 100 });
      setTemplates(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchClinicalAudits = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.listAudits', { limit: 100 });
      setClinicalAudits(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.listComplaints', { limit: 100 });
      setComplaints(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIndicators = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.listIndicators', { limit: 100 });
      setIndicators(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trpcQuery('safetyAudits.analytics');
      setAnalytics(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tab-specific effects
  useEffect(() => {
    if (activeTab === 'safety-rounds') fetchSafetyRounds();
    else if (activeTab === 'round-findings') fetchRoundFindings();
    else if (activeTab === 'templates') fetchTemplates();
    else if (activeTab === 'clinical-audits') fetchClinicalAudits();
    else if (activeTab === 'complaints') fetchComplaints();
    else if (activeTab === 'indicators') fetchIndicators();
    else if (activeTab === 'analytics') fetchAnalytics();
  }, [activeTab, fetchSafetyRounds, fetchRoundFindings, fetchTemplates, fetchClinicalAudits, fetchComplaints, fetchIndicators, fetchAnalytics]);

  // ─── ACTIONS ────────────────────────────────────────────────
  const handleScheduleRound = async () => {
    if (!newRound.department || !newRound.scheduled_date || !newRound.template_id) {
      setError('Please fill all fields');
      return;
    }
    setError('');
    try {
      await trpcMutate('safetyAudits.scheduleRound', newRound);
      setSuccess('Safety round scheduled');
      setNewRound({ department: '', scheduled_date: '', template_id: '' });
      setShowNewRoundForm(false);
      fetchSafetyRounds();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStartRound = async (roundId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.startRound', { round_id: roundId });
      setSuccess('Safety round started');
      fetchSafetyRounds();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCompleteRound = async (roundId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.completeRound', { round_id: roundId });
      setSuccess('Safety round completed');
      fetchSafetyRounds();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCloseFinding = async (findingId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.closeFinding', { finding_id: findingId });
      setSuccess('Finding closed');
      fetchRoundFindings();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplate.template_name || !newTemplate.checklist_items) {
      setError('Please fill all fields');
      return;
    }
    setError('');
    try {
      const items = newTemplate.checklist_items.split('\n').filter((item): item is string => !!item.trim());
      await trpcMutate('safetyAudits.createTemplate', {
        template_name: newTemplate.template_name,
        description: newTemplate.description,
        checklist_items: items,
      });
      setSuccess('Template created');
      setNewTemplate({ template_name: '', description: '', checklist_items: '' });
      setShowNewTemplateForm(false);
      fetchTemplates();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleScheduleAudit = async () => {
    if (!newAudit.nabh_chapter || !newAudit.audit_type || !newAudit.scheduled_date) {
      setError('Please fill all fields');
      return;
    }
    setError('');
    try {
      await trpcMutate('safetyAudits.scheduleAudit', newAudit);
      setSuccess('Clinical audit scheduled');
      setNewAudit({ nabh_chapter: '', audit_type: '', scheduled_date: '', sample_size: 10 });
      setShowNewAuditForm(false);
      fetchClinicalAudits();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCompleteAudit = async (auditId: string, complianceScore: number) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.completeAudit', { audit_id: auditId, compliance_score: complianceScore });
      setSuccess('Clinical audit completed');
      fetchClinicalAudits();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAcknowledgeComplaint = async (complaintId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.acknowledgeComplaint', { complaint_id: complaintId });
      setSuccess('Complaint acknowledged');
      fetchComplaints();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResolveComplaint = async (complaintId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.resolveComplaint', { complaint_id: complaintId });
      setSuccess('Complaint resolved');
      fetchComplaints();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEscalateComplaint = async (complaintId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.escalateComplaint', { complaint_id: complaintId });
      setSuccess('Complaint escalated');
      fetchComplaints();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleConfirmIndicator = async (indicatorId: string) => {
    setError('');
    try {
      await trpcMutate('safetyAudits.confirmIndicator', { indicator_id: indicatorId });
      setSuccess('Indicator confirmed');
      fetchIndicators();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── RENDER TABS ────────────────────────────────────────────

  const renderSafetyRoundsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#fff' }}>Safety Rounds</h2>
        <button
          onClick={() => setShowNewRoundForm(!showNewRoundForm)}
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
          &#10133; Schedule Round
        </button>
      </div>

      {showNewRoundForm && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#fff' }}>Schedule New Safety Round</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="Department"
              value={newRound.department}
              onChange={(e) => setNewRound({ ...newRound, department: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <input
              type="date"
              value={newRound.scheduled_date}
              onChange={(e) => setNewRound({ ...newRound, scheduled_date: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <input
              type="text"
              placeholder="Template ID"
              value={newRound.template_id}
              onChange={(e) => setNewRound({ ...newRound, template_id: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleScheduleRound}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Schedule
            </button>
            <button
              onClick={() => setShowNewRoundForm(false)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <option value="all">All Status</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Department</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Scheduled Date</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Template</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Assigned To</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Findings</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(statusFilter === 'all'
              ? safetyRounds
              : safetyRounds.filter((r) => r.status === statusFilter)
            ).map((round) => (
              <tr key={round.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{round.department}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{formatDate(round.scheduled_date)}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{round.template_name}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{round.assigned_to}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(round.status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(round.status)}
                  </div>
                </td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{round.findings_count}</td>
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {round.status === 'scheduled' && (
                      <button
                        onClick={() => handleStartRound(round.id)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        Start
                      </button>
                    )}
                    {round.status === 'in_progress' && (
                      <button
                        onClick={() => handleCompleteRound(round.id)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: '#10b981',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        Complete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderRoundFindingsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#fff' }}>Round Findings</h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Round Department</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Checklist Item</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Description</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Severity</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Responsible Person</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Target Date</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(statusFilter === 'all'
              ? roundFindings
              : roundFindings.filter((f) => f.status === statusFilter)
            ).map((finding) => (
              <tr key={finding.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{finding.round_department}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{finding.checklist_item}</td>
                <td style={{ padding: '12px', color: '#cbd5e1', maxWidth: '200px' }}>{finding.description}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(finding.severity),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(finding.severity)}
                  </div>
                </td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{finding.responsible_person}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{formatDate(finding.target_date)}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(finding.status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(finding.status)}
                  </div>
                </td>
                <td style={{ padding: '12px' }}>
                  {finding.status !== 'closed' && (
                    <button
                      onClick={() => handleCloseFinding(finding.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Close
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

  const renderTemplatesTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#fff' }}>Safety Round Templates</h2>
        <button
          onClick={() => setShowNewTemplateForm(!showNewTemplateForm)}
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
          &#10133; New Template
        </button>
      </div>

      {showNewTemplateForm && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#fff' }}>Create New Template</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="Template Name"
              value={newTemplate.template_name}
              onChange={(e) => setNewTemplate({ ...newTemplate, template_name: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <input
              type="text"
              placeholder="Description"
              value={newTemplate.description}
              onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <textarea
              placeholder="Checklist Items (one per line)"
              value={newTemplate.checklist_items}
              onChange={(e) => setNewTemplate({ ...newTemplate, checklist_items: e.target.value })}
              rows={6}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'monospace',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleCreateTemplate}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Create
            </button>
            <button
              onClick={() => setShowNewTemplateForm(false)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {templates.map((template) => (
          <div key={template.id} style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: '#fff' }}>{template.template_name}</h3>
            <p style={{ margin: '0 0 12px 0', color: '#cbd5e1', fontSize: '13px' }}>{template.description}</p>
            <div style={{ backgroundColor: '#0f172a', borderRadius: '6px', padding: '12px', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>{template.item_count} checklist items</div>
              <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                {template.checklist_items.slice(0, 3).map((item, idx) => (
                  <div key={idx} style={{ marginTop: idx > 0 ? '4px' : 0 }}>• {item}</div>
                ))}
                {template.checklist_items.length > 3 && <div style={{ marginTop: '4px', color: '#94a3b8' }}>... and {template.checklist_items.length - 3} more</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderClinicalAuditsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#fff' }}>Clinical Audits</h2>
        <button
          onClick={() => setShowNewAuditForm(!showNewAuditForm)}
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
          &#10133; Schedule Audit
        </button>
      </div>

      {showNewAuditForm && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#fff' }}>Schedule New Clinical Audit</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="NABH Chapter"
              value={newAudit.nabh_chapter}
              onChange={(e) => setNewAudit({ ...newAudit, nabh_chapter: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <input
              type="text"
              placeholder="Audit Type"
              value={newAudit.audit_type}
              onChange={(e) => setNewAudit({ ...newAudit, audit_type: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <input
              type="date"
              value={newAudit.scheduled_date}
              onChange={(e) => setNewAudit({ ...newAudit, scheduled_date: e.target.value })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <input
              type="number"
              placeholder="Sample Size"
              value={newAudit.sample_size}
              onChange={(e) => setNewAudit({ ...newAudit, sample_size: parseInt(e.target.value) || 10 })}
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleScheduleAudit}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Schedule
            </button>
            <button
              onClick={() => setShowNewAuditForm(false)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <option value="all">All Status</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>NABH Chapter</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Audit Type</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Scheduled Date</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Sample Size</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Compliance Score</th>
            </tr>
          </thead>
          <tbody>
            {(statusFilter === 'all'
              ? clinicalAudits
              : clinicalAudits.filter((a) => a.status === statusFilter)
            ).map((audit) => (
              <tr key={audit.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{audit.nabh_chapter}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{audit.audit_type}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{formatDate(audit.scheduled_date)}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{audit.sample_size}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(audit.status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(audit.status)}
                  </div>
                </td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>
                  {audit.compliance_score !== null ? `${audit.compliance_score}%` : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderComplaintsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#fff' }}>Complaints</h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Complaint ID</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Category</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Department</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Severity</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Submitted</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>SLA Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(statusFilter === 'all'
              ? complaints
              : complaints.filter((c) => c.status === statusFilter)
            ).map((complaint) => (
              <tr key={complaint.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{complaint.complaint_id}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{complaint.category}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{complaint.department}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(complaint.severity),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(complaint.severity)}
                  </div>
                </td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(complaint.status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(complaint.status)}
                  </div>
                </td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{formatDate(complaint.submitted_date)}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: complaint.overdue ? '#ef4444' : '#10b981',
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {complaint.overdue ? 'Overdue' : 'On Track'}
                  </div>
                </td>
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {complaint.status === 'open' && (
                      <button
                        onClick={() => handleAcknowledgeComplaint(complaint.id)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '11px',
                        }}
                      >
                        Ack
                      </button>
                    )}
                    {complaint.status !== 'resolved' && complaint.status !== 'escalated' && (
                      <>
                        <button
                          onClick={() => handleResolveComplaint(complaint.id)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: '#10b981',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => handleEscalateComplaint(complaint.id)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: '#ef4444',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                          }}
                        >
                          Escalate
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderIndicatorsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#fff' }}>Quality Indicator Definitions</h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          <option value="all">All Status</option>
          <option value="assumed">Assumed</option>
          <option value="confirmed">Confirmed</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Indicator ID</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>NABH Chapter</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Department</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Frequency</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Data Source</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#94a3b8' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(statusFilter === 'all'
              ? indicators
              : indicators.filter((ind) => ind.definition_status === statusFilter)
            ).map((indicator) => (
              <tr key={indicator.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{indicator.indicator_id}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{indicator.name}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{indicator.nabh_chapter}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{indicator.department}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{indicator.frequency}</td>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{indicator.data_source}</td>
                <td style={{ padding: '12px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      padding: '4px 8px',
                      backgroundColor: getStatusColor(indicator.definition_status),
                      color: '#fff',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                    }}
                  >
                    {getStatusLabel(indicator.definition_status)}
                  </div>
                </td>
                <td style={{ padding: '12px' }}>
                  {indicator.definition_status === 'assumed' && (
                    <button
                      onClick={() => handleConfirmIndicator(indicator.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Confirm
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

  const renderAnalyticsTab = () => (
    <div style={{ padding: '20px', maxWidth: '1400px' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600', color: '#fff' }}>Safety & Quality Analytics</h2>

      {analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Total Safety Rounds (This Month)</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: '#3b82f6' }}>{formatNumber(analytics.total_rounds_month)}</div>
          </div>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Open Findings</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: '#ef4444' }}>{formatNumber(analytics.open_findings)}</div>
          </div>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Avg Audit Compliance</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: '#10b981' }}>{formatNumber(analytics.avg_audit_compliance)}%</div>
          </div>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Open Complaints</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: '#f59e0b' }}>{formatNumber(analytics.open_complaints)}</div>
          </div>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>SLA Breach Rate</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: '#ef4444' }}>{formatNumber(analytics.sla_breach_rate)}%</div>
          </div>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Confirmed Indicators</div>
            <div style={{ fontSize: '32px', fontWeight: '700', color: '#10b981' }}>{formatNumber(analytics.confirmed_indicators)}%</div>
          </div>
        </div>
      )}
    </div>
  );

  // ─── MAIN RENDER ────────────────────────────────────────────
  return (
    <div style={{ backgroundColor: '#0f172a', minHeight: '100vh', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 20px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: '#fff' }}>Safety Rounds, Clinical Audits & Complaints</h1>
      </div>

      {/* Alerts */}
      {error && (
        <div style={{ backgroundColor: '#7f1d1d', color: '#fca5a5', padding: '12px 20px', borderBottom: '1px solid #991b1b', margin: 0 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ backgroundColor: '#064e3b', color: '#86efac', padding: '12px 20px', borderBottom: '1px solid #047857', margin: 0 }}>
          {success}
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #334155', backgroundColor: '#1e293b' }}>
        <div style={{ display: 'flex', overflowX: 'auto', maxWidth: '100%' }}>
          {(['safety-rounds', 'round-findings', 'templates', 'clinical-audits', 'complaints', 'indicators', 'analytics'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setStatusFilter('all'); setError(''); setSuccess(''); }}
              style={{
                padding: '12px 16px',
                backgroundColor: activeTab === tab ? '#334155' : 'transparent',
                color: activeTab === tab ? '#fff' : '#94a3b8',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #3b82f6' : 'none',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === tab ? '600' : '400',
                whiteSpace: 'nowrap',
              }}
            >
              {tab === 'safety-rounds' && 'Safety Rounds'}
              {tab === 'round-findings' && 'Round Findings'}
              {tab === 'templates' && 'Templates'}
              {tab === 'clinical-audits' && 'Clinical Audits'}
              {tab === 'complaints' && 'Complaints'}
              {tab === 'indicators' && 'Indicators'}
              {tab === 'analytics' && 'Analytics'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ minHeight: 'calc(100vh - 160px)' }}>
        {loading && <div style={{ padding: '20px', color: '#94a3b8' }}>Loading...</div>}
        {!loading && activeTab === 'safety-rounds' && renderSafetyRoundsTab()}
        {!loading && activeTab === 'round-findings' && renderRoundFindingsTab()}
        {!loading && activeTab === 'templates' && renderTemplatesTab()}
        {!loading && activeTab === 'clinical-audits' && renderClinicalAuditsTab()}
        {!loading && activeTab === 'complaints' && renderComplaintsTab()}
        {!loading && activeTab === 'indicators' && renderIndicatorsTab()}
        {!loading && activeTab === 'analytics' && renderAnalyticsTab()}
      </div>
    </div>
  );
}
