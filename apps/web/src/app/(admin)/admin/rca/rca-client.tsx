'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── TYPES ────────────────────────────────────────────────────
type RcaStatus = 'not_started' | 'timeline_in_progress' | 'fishbone_in_progress' | 'analysis_in_progress' | 'draft_report' | 'rca_complete';
type CapaType = 'corrective' | 'preventive';
type FishboneCategory = 'People' | 'Process' | 'Systems' | 'Environment' | 'Training' | 'Communication';

interface Rca {
  id: string;
  adverse_event_id: string;
  adverse_event_description: string;
  incident_type: string;
  status: RcaStatus;
  deadline: string;
  team_size: number;
  created_at: string;
  updated_at: string;
}

interface TimelineEvent {
  id: string;
  rca_id: string;
  sequence: number;
  event_time: string;
  description: string;
  source: string;
}

interface FishboneFactor {
  id: string;
  rca_id: string;
  category: FishboneCategory;
  factor_description: string;
  is_root_cause: boolean;
  sequence: number;
}

interface FiveWhyRow {
  id: string;
  rca_id: string;
  sequence: number;
  why_question: string;
  answer: string;
  is_root_cause: boolean;
}

interface CapaItem {
  id: string;
  rca_id: string;
  description: string;
  type: CapaType;
  responsible_person: string;
  target_date: string;
  status: 'open' | 'in_progress' | 'completed' | 'deferred';
  completion_percent: number;
  created_at: string;
}

interface TeamMember {
  id: string;
  rca_id: string;
  user_id: string;
  user_name: string;
  role: string;
  added_at: string;
}

interface RcaDashboard {
  open_rcas: number;
  overdue_rcas: number;
  avg_days_to_complete: number;
  status_distribution: Record<RcaStatus, number>;
  capa_status_distribution: Record<string, number>;
}

interface OverdueAlert {
  rca_id: string;
  adverse_event_description: string;
  deadline: string;
  days_overdue: number;
}

// ─── HELPERS ────────────────────────────────────────────────────
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
    case 'not_started': return '#6b7280';
    case 'timeline_in_progress': return '#eab308';
    case 'fishbone_in_progress': return '#eab308';
    case 'analysis_in_progress': return '#eab308';
    case 'draft_report': return '#f59e0b';
    case 'rca_complete': return '#10b981';
    case 'open': return '#3b82f6';
    case 'in_progress': return '#eab308';
    case 'completed': return '#10b981';
    case 'deferred': return '#6b7280';
    case 'corrective': return '#3b82f6';
    case 'preventive': return '#10b981';
    default: return '#6b7280';
  }
}

function getStatusLabel(status: string): string {
  return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getDaysRemaining(deadline: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(deadline);
  deadlineDate.setHours(0, 0, 0, 0);
  return Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
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
export function RcaClient() {
  type TabType = 'board' | 'detail' | 'team' | 'capa' | 'analytics';

  const [activeTab, setActiveTab] = useState<TabType>('board');
  const [rcas, setRcas] = useState<Rca[]>([]);
  const [selectedRca, setSelectedRca] = useState<Rca | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [fishbone, setFishbone] = useState<FishboneFactor[]>([]);
  const [fiveWhyChain, setFiveWhyChain] = useState<FiveWhyRow[]>([]);
  const [capaItems, setCapaItems] = useState<CapaItem[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [dashboard, setDashboard] = useState<RcaDashboard | null>(null);
  const [overdueAlerts, setOverdueAlerts] = useState<OverdueAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState<RcaStatus | 'all'>('all');
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [newAdverseEventId, setNewAdverseEventId] = useState('');
  const searchTimeout = useRef<NodeJS.Timeout>();

  const fetchRcas = useCallback(async () => {
    setLoading(true);
    try {
      const data = await trpcQuery('rca.listRcas', { limit: 100 });
      setRcas(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRcaDetail = useCallback(async (rcaId: string) => {
    setLoading(true);
    try {
      const [rcaData, timelineData, fishboneData, fiveWhyData, capaData, teamData] = await Promise.all([
        trpcQuery('rca.getRca', { rca_id: rcaId }),
        trpcQuery('rca.listTimeline', { rca_id: rcaId }),
        trpcQuery('rca.getFishbone', { rca_id: rcaId }),
        trpcQuery('rca.getFiveWhyChain', { rca_id: rcaId }),
        trpcQuery('rca.listCapaItems', { rca_id: rcaId }),
        trpcQuery('rca.listTeamMembers', { rca_id: rcaId }),
      ]);
      setSelectedRca(rcaData);
      setTimeline(timelineData || []);
      setFishbone(fishboneData || []);
      setFiveWhyChain(fiveWhyData || []);
      setCapaItems(capaData || []);
      setTeamMembers(teamData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dashData, alertsData] = await Promise.all([
        trpcQuery('rca.rcaDashboard'),
        trpcQuery('rca.rcaOverdueAlerts'),
      ]);
      setDashboard(dashData);
      setOverdueAlerts(alertsData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'board') {
      fetchRcas();
    } else if (activeTab === 'analytics') {
      fetchDashboard();
    }
  }, [activeTab, fetchRcas, fetchDashboard]);

  const handleInitiateRca = async () => {
    if (!newAdverseEventId.trim()) {
      setError('Please select an adverse event');
      return;
    }
    setLoading(true);
    try {
      await trpcMutate('rca.initiateRca', { adverse_event_id: newAdverseEventId });
      setSuccess('RCA initiated successfully');
      setNewAdverseEventId('');
      setShowInitiateModal(false);
      await fetchRcas();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTimelineEvent = async (time: string, description: string, source: string) => {
    if (!selectedRca) return;
    setLoading(true);
    try {
      await trpcMutate('rca.addTimelineEvent', {
        rca_id: selectedRca.id,
        event_time: time,
        description,
        source,
      });
      setSuccess('Timeline event added');
      await fetchRcaDetail(selectedRca.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddFishboneFactor = async (category: FishboneCategory, description: string) => {
    if (!selectedRca) return;
    setLoading(true);
    try {
      await trpcMutate('rca.addFishboneFactor', {
        rca_id: selectedRca.id,
        category,
        factor_description: description,
      });
      setSuccess('Fishbone factor added');
      await fetchRcaDetail(selectedRca.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddFiveWhy = async (question: string, answer: string) => {
    if (!selectedRca) return;
    setLoading(true);
    try {
      await trpcMutate('rca.addFiveWhy', {
        rca_id: selectedRca.id,
        why_question: question,
        answer,
      });
      setSuccess('Why question added');
      await fetchRcaDetail(selectedRca.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCapaItem = async (description: string, type: CapaType, responsible: string, targetDate: string) => {
    if (!selectedRca) return;
    setLoading(true);
    try {
      await trpcMutate('rca.addCapaItem', {
        rca_id: selectedRca.id,
        description,
        type,
        responsible_person: responsible,
        target_date: targetDate,
      });
      setSuccess('CAPA item added');
      await fetchRcaDetail(selectedRca.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTeamMember = async (userId: string, role: string) => {
    if (!selectedRca) return;
    setLoading(true);
    try {
      await trpcMutate('rca.addTeamMember', {
        rca_id: selectedRca.id,
        user_id: userId,
        role,
      });
      setSuccess('Team member added');
      await fetchRcaDetail(selectedRca.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCapaStatus = async (capaId: string, status: string, completionPercent: number) => {
    setLoading(true);
    try {
      await trpcMutate('rca.updateCapaStatus', {
        rci_id: capaId,
        status,
        completion_percent: completionPercent,
      });
      setSuccess('CAPA status updated');
      if (selectedRca) await fetchRcaDetail(selectedRca.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRcaStatus = async (rcaId: string, status: RcaStatus) => {
    setLoading(true);
    try {
      await trpcMutate('rca.updateRcaStatus', { rca_id: rcaId, rca_inv_status: status });
      setSuccess('RCA status updated');
      await fetchRcas();
      if (selectedRca?.id === rcaId) {
        await fetchRcaDetail(rcaId);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredRcas = statusFilter === 'all' ? rcas : rcas.filter(r => r.status === statusFilter);

  const styles = {
    container: {
      minHeight: '100vh',
      background: '#16213e',
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#e0e0e0',
    },
    header: {
      marginBottom: '30px',
      borderBottom: `2px solid #0f3460`,
      paddingBottom: '20px',
    },
    title: {
      fontSize: '32px',
      fontWeight: 'bold',
      color: '#e0e0e0',
      margin: '0 0 10px 0',
    },
    subtitle: {
      fontSize: '14px',
      color: '#9ca3af',
      margin: '0',
    },
    tabContainer: {
      display: 'flex',
      gap: '10px',
      marginBottom: '30px',
      borderBottom: `1px solid #0f3460`,
      paddingBottom: '10px',
    },
    tab: (isActive: boolean) => ({
      padding: '12px 20px',
      background: isActive ? '#0f3460' : 'transparent',
      color: isActive ? '#10b981' : '#9ca3af',
      border: 'none',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: isActive ? '600' : '400',
      borderRadius: '4px',
      transition: 'all 0.2s',
    }),
    card: {
      background: '#1a1a2e',
      border: `1px solid #0f3460`,
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px',
    },
    button: {
      padding: '10px 16px',
      background: '#0f3460',
      color: '#e0e0e0',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      transition: 'all 0.2s',
    },
    buttonPrimary: {
      padding: '10px 16px',
      background: '#10b981',
      color: '#16213e',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      transition: 'all 0.2s',
    },
    statusBadge: (color: string) => ({
      display: 'inline-block',
      padding: '4px 8px',
      background: color + '20',
      color,
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '600',
      border: `1px solid ${color}`,
    }),
    input: {
      padding: '8px 12px',
      background: '#0f3460',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '4px',
      fontSize: '14px',
      marginBottom: '10px',
    },
    textarea: {
      padding: '8px 12px',
      background: '#0f3460',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      minHeight: '80px',
      marginBottom: '10px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      fontSize: '14px',
    },
    th: {
      textAlign: 'left' as const,
      padding: '12px',
      background: '#0f3460',
      color: '#e0e0e0',
      fontWeight: '600',
      borderBottom: `1px solid #0f3460`,
    },
    td: {
      padding: '12px',
      borderBottom: `1px solid #0f3460`,
      color: '#e0e0e0',
    },
    alert: (color: string) => ({
      padding: '12px 16px',
      background: color + '20',
      color,
      border: `1px solid ${color}`,
      borderRadius: '4px',
      marginBottom: '15px',
      fontSize: '14px',
    }),
    modal: {
      position: 'fixed' as const,
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    },
    modalContent: {
      background: '#1a1a2e',
      border: `1px solid #0f3460`,
      borderRadius: '8px',
      padding: '30px',
      maxWidth: '500px',
      width: '90%',
    },
    modalTitle: {
      fontSize: '20px',
      fontWeight: 'bold',
      marginBottom: '20px',
      color: '#e0e0e0',
    },
    section: {
      marginBottom: '30px',
    },
    sectionTitle: {
      fontSize: '18px',
      fontWeight: 'bold',
      color: '#e0e0e0',
      marginBottom: '15px',
      borderBottom: `1px solid #0f3460`,
      paddingBottom: '10px',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '15px',
      marginBottom: '20px',
    },
    stat: {
      background: '#0f3460',
      padding: '15px',
      borderRadius: '4px',
      textAlign: 'center' as const,
    },
    statValue: {
      fontSize: '28px',
      fontWeight: 'bold',
      color: '#10b981',
      margin: '0',
    },
    statLabel: {
      fontSize: '12px',
      color: '#9ca3af',
      margin: '5px 0 0 0',
    },
  };

  // ─── BOARD TAB ────────────────────────────────────────────────
  if (activeTab === 'board') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>&#x1F525; RCA (Root Cause Analysis) Board</h1>
          <p style={styles.subtitle}>Manage adverse event investigations and corrective actions</p>
        </div>

        {error && <div style={styles.alert('#ef4444')}>{error}</div>}
        {success && <div style={styles.alert('#10b981')}>{success}</div>}

        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button
            style={styles.buttonPrimary}
            onClick={() => setShowInitiateModal(true)}
          >
            &#x2795; Initiate RCA
          </button>
          <select
            style={{ ...styles.input, padding: '8px 12px', marginBottom: '0' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">All Status</option>
            <option value="not_started">Not Started</option>
            <option value="timeline_in_progress">Timeline In Progress</option>
            <option value="fishbone_in_progress">Fishbone In Progress</option>
            <option value="analysis_in_progress">Analysis In Progress</option>
            <option value="draft_report">Draft Report</option>
            <option value="rca_complete">Complete</option>
          </select>
        </div>

        {showInitiateModal && (
          <div style={styles.modal}>
            <div style={styles.modalContent}>
              <h3 style={styles.modalTitle}>Initiate New RCA</h3>
              <input
                type="text"
                placeholder="Adverse Event ID"
                style={styles.input}
                value={newAdverseEventId}
                onChange={(e) => setNewAdverseEventId(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  style={styles.buttonPrimary}
                  onClick={handleInitiateRca}
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create RCA'}
                </button>
                <button
                  style={styles.button}
                  onClick={() => setShowInitiateModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && <div style={styles.alert('#3b82f6')}>Loading RCAs...</div>}

        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Event Description</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Deadline</th>
                <th style={styles.th}>Days Remaining</th>
                <th style={styles.th}>Team Size</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRcas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>
                    No RCAs found
                  </td>
                </tr>
              ) : (
                filteredRcas.map((rca) => {
                  const daysRemaining = getDaysRemaining(rca.deadline);
                  const isOverdue = daysRemaining < 0;
                  return (
                    <tr key={rca.id}>
                      <td style={styles.td}>{rca.adverse_event_description}</td>
                      <td style={styles.td}>{rca.incident_type}</td>
                      <td style={styles.td}>
                        <div style={styles.statusBadge(getStatusColor(rca.status))}>
                          {getStatusLabel(rca.status)}
                        </div>
                      </td>
                      <td style={styles.td}>{formatDate(rca.deadline)}</td>
                      <td style={{ ...styles.td, color: isOverdue ? '#ef4444' : '#e0e0e0' }}>
                        {isOverdue ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining} days`}
                      </td>
                      <td style={styles.td}>{rca.team_size} members</td>
                      <td style={styles.td}>
                        <button
                          style={{ ...styles.button, fontSize: '12px', padding: '6px 10px' }}
                          onClick={() => {
                            fetchRcaDetail(rca.id);
                            setActiveTab('detail');
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ─── DETAIL TAB ────────────────────────────────────────────────
  if (activeTab === 'detail') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>&#x1F50D; RCA Investigation Detail</h1>
          <p style={styles.subtitle}>Review and manage investigation sections</p>
        </div>

        {error && <div style={styles.alert('#ef4444')}>{error}</div>}
        {success && <div style={styles.alert('#10b981')}>{success}</div>}

        {!selectedRca ? (
          <div style={styles.card}>
            <p style={{ color: '#9ca3af', margin: '0' }}>Select an RCA from the Board tab to view details</p>
          </div>
        ) : (
          <>
            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <div>
                  <h3 style={{ margin: '0 0 5px 0', color: '#e0e0e0' }}>{selectedRca.adverse_event_description}</h3>
                  <p style={{ margin: '0', fontSize: '12px', color: '#9ca3af' }}>Type: {selectedRca.incident_type}</p>
                </div>
                <div style={styles.statusBadge(getStatusColor(selectedRca.status))}>
                  {getStatusLabel(selectedRca.status)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', fontSize: '14px' }}>
                <div>
                  <p style={{ margin: '0 0 5px 0', color: '#9ca3af', fontSize: '12px' }}>Deadline</p>
                  <p style={{ margin: '0', color: '#e0e0e0', fontWeight: '600' }}>{formatDate(selectedRca.deadline)}</p>
                </div>
                <div>
                  <p style={{ margin: '0 0 5px 0', color: '#9ca3af', fontSize: '12px' }}>Days Remaining</p>
                  <p style={{ margin: '0', color: getDaysRemaining(selectedRca.deadline) < 0 ? '#ef4444' : '#e0e0e0', fontWeight: '600' }}>
                    {getDaysRemaining(selectedRca.deadline) < 0 ? `${Math.abs(getDaysRemaining(selectedRca.deadline))}d overdue` : `${getDaysRemaining(selectedRca.deadline)} days`}
                  </p>
                </div>
                <div>
                  <p style={{ margin: '0 0 5px 0', color: '#9ca3af', fontSize: '12px' }}>Team Size</p>
                  <p style={{ margin: '0', color: '#e0e0e0', fontWeight: '600' }}>{selectedRca.team_size} members</p>
                </div>
              </div>
            </div>

            {/* SECTION A: TIMELINE */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>&#x23F3; Section A: Timeline</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Time</th>
                    <th style={styles.th}>Description</th>
                    <th style={styles.th}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((event) => (
                    <tr key={event.id}>
                      <td style={styles.td}>{event.sequence}</td>
                      <td style={styles.td}>{formatDate(event.event_time)}</td>
                      <td style={styles.td}>{event.description}</td>
                      <td style={styles.td}>{event.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: '15px', padding: '15px', background: '#0f3460', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '600', color: '#9ca3af' }}>Add Event</p>
                <TimelineEventForm onSubmit={handleAddTimelineEvent} />
              </div>
            </div>

            {/* SECTION B: FISHBONE DIAGRAM */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>&#x1F41E; Section B: Fishbone Diagram</h3>
              <div style={styles.grid}>
                {(['People', 'Process', 'Systems', 'Environment', 'Training', 'Communication'] as FishboneCategory[]).map((category) => (
                  <div key={category} style={{ background: '#0f3460', padding: '15px', borderRadius: '4px', border: `1px solid #0f3460` }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#e0e0e0', fontSize: '14px', fontWeight: '600' }}>{category}</h4>
                    <div style={{ marginBottom: '10px' }}>
                      {fishbone.filter(f => f.category === category).map((factor) => (
                        <div key={factor.id} style={{ padding: '8px', background: '#16213e', borderRadius: '3px', marginBottom: '5px', fontSize: '12px', color: '#e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{factor.factor_description}</span>
                          {factor.is_root_cause && <span style={{ background: '#ef4444', padding: '2px 6px', borderRadius: '2px', fontSize: '10px' }}>ROOT</span>}
                        </div>
                      ))}
                    </div>
                    <AddFishboneForm category={category} onSubmit={(desc) => handleAddFishboneFactor(category, desc)} />
                  </div>
                ))}
              </div>
            </div>

            {/* SECTION C: 5-WHY ANALYSIS */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>❓ Section C: 5-Why Analysis</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Why Question</th>
                    <th style={styles.th}>Answer</th>
                    <th style={styles.th}>Root Cause</th>
                  </tr>
                </thead>
                <tbody>
                  {fiveWhyChain.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>{row.sequence}</td>
                      <td style={styles.td}>{row.why_question}</td>
                      <td style={styles.td}>{row.answer}</td>
                      <td style={styles.td}>{row.is_root_cause ? '✓ Yes' : '−'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: '15px', padding: '15px', background: '#0f3460', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '600', color: '#9ca3af' }}>Add Why Question</p>
                <FiveWhyForm onSubmit={handleAddFiveWhy} />
              </div>
            </div>

            {/* SECTION D: CAPA */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>&#x1F4CB; Section D: CAPA (Corrective & Preventive Actions)</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Description</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Responsible</th>
                    <th style={styles.th}>Target Date</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {capaItems.map((capa) => (
                    <tr key={capa.id}>
                      <td style={styles.td}>{capa.description}</td>
                      <td style={styles.td}>
                        <div style={styles.statusBadge(getStatusColor(capa.type))}>
                          {getStatusLabel(capa.type)}
                        </div>
                      </td>
                      <td style={styles.td}>{capa.responsible_person}</td>
                      <td style={styles.td}>{formatDate(capa.target_date)}</td>
                      <td style={styles.td}>
                        <div style={styles.statusBadge(getStatusColor(capa.status))}>
                          {getStatusLabel(capa.status)}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={{ width: '100px', height: '8px', background: '#0f3460', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${capa.completion_percent}%`, height: '100%', background: '#10b981', transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: '#9ca3af' }}>{capa.completion_percent}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: '15px', padding: '15px', background: '#0f3460', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '600', color: '#9ca3af' }}>Add CAPA Item</p>
                <CapaForm onSubmit={handleAddCapaItem} />
              </div>
            </div>

            <button style={styles.button} onClick={() => setActiveTab('board')}>
              ← Back to Board
            </button>
          </>
        )}
      </div>
    );
  }

  // ─── TEAM TAB ────────────────────────────────────────────────
  if (activeTab === 'team') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>👥 RCA Team Management</h1>
          <p style={styles.subtitle}>Manage team members for investigations</p>
        </div>

        {error && <div style={styles.alert('#ef4444')}>{error}</div>}
        {success && <div style={styles.alert('#10b981')}>{success}</div>}

        {!selectedRca ? (
          <div style={styles.card}>
            <p style={{ color: '#9ca3af', margin: '0' }}>Select an RCA from the Board tab to view team</p>
          </div>
        ) : (
          <>
            <div style={styles.card}>
              <h3 style={{ margin: '0 0 15px 0', color: '#e0e0e0' }}>{selectedRca.adverse_event_description}</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Added</th>
                    <th style={styles.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((member) => (
                    <tr key={member.id}>
                      <td style={styles.td}>{member.user_name}</td>
                      <td style={styles.td}>
                        <div style={styles.statusBadge('#3b82f6')}>{member.role}</div>
                      </td>
                      <td style={styles.td}>{formatDate(member.added_at)}</td>
                      <td style={styles.td}>
                        <button style={{ ...styles.button, fontSize: '12px', padding: '6px 10px' }}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: '20px', padding: '15px', background: '#0f3460', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '600', color: '#9ca3af' }}>Add Team Member</p>
                <AddTeamMemberForm onSubmit={handleAddTeamMember} />
              </div>
            </div>

            <button style={styles.button} onClick={() => setActiveTab('board')}>
              ← Back to Board
            </button>
          </>
        )}
      </div>
    );
  }

  // ─── CAPA TRACKER TAB ────────────────────────────────────────
  if (activeTab === 'capa') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>✅ CAPA Tracker (Cross-RCA)</h1>
          <p style={styles.subtitle}>Track all corrective and preventive actions across RCAs</p>
        </div>

        {error && <div style={styles.alert('#ef4444')}>{error}</div>}
        {success && <div style={styles.alert('#10b981')}>{success}</div>}

        {loading && <div style={styles.alert('#3b82f6')}>Loading CAPA items...</div>}

        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Filter by status..." style={styles.input} />
          <input type="text" placeholder="Filter by responsible..." style={styles.input} />
        </div>

        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>RCA</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Responsible</th>
                <th style={styles.th}>Target Date</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {capaItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>
                    No CAPA items found
                  </td>
                </tr>
              ) : (
                capaItems.map((capa) => (
                  <tr key={capa.id}>
                    <td style={styles.td}>{capa.rca_id.substring(0, 8)}...</td>
                    <td style={styles.td}>{capa.description.substring(0, 30)}...</td>
                    <td style={styles.td}>
                      <div style={styles.statusBadge(getStatusColor(capa.type))}>
                        {getStatusLabel(capa.type)}
                      </div>
                    </td>
                    <td style={styles.td}>{capa.responsible_person}</td>
                    <td style={styles.td}>{formatDate(capa.target_date)}</td>
                    <td style={styles.td}>
                      <div style={styles.statusBadge(getStatusColor(capa.status))}>
                        {getStatusLabel(capa.status)}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={{ width: '100px', height: '8px', background: '#0f3460', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${capa.completion_percent}%`, height: '100%', background: '#10b981', transition: 'width 0.3s' }} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <button style={styles.button} onClick={() => setActiveTab('board')}>
          ← Back to Board
        </button>
      </div>
    );
  }

  // ─── ANALYTICS TAB ─────────────────────────────────────────────
  if (activeTab === 'analytics') {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>📊 RCA Analytics Dashboard</h1>
          <p style={styles.subtitle}>Insights on investigations and action tracking</p>
        </div>

        {error && <div style={styles.alert('#ef4444')}>{error}</div>}
        {success && <div style={styles.alert('#10b981')}>{success}</div>}

        {loading && <div style={styles.alert('#3b82f6')}>Loading analytics...</div>}

        {dashboard && (
          <>
            <div style={styles.grid}>
              <div style={styles.stat}>
                <p style={styles.statValue}>{dashboard.open_rcas}</p>
                <p style={styles.statLabel}>Open RCAs</p>
              </div>
              <div style={styles.stat}>
                <p style={{ ...styles.statValue, color: dashboard.overdue_rcas > 0 ? '#ef4444' : '#10b981' }}>
                  {dashboard.overdue_rcas}
                </p>
                <p style={styles.statLabel}>Overdue RCAs</p>
              </div>
              <div style={styles.stat}>
                <p style={styles.statValue}>{dashboard.avg_days_to_complete}</p>
                <p style={styles.statLabel}>Avg Days to Complete</p>
              </div>
            </div>

            {overdueAlerts.length > 0 && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitle}>⚠️ Overdue RCA Alerts</h3>
                {overdueAlerts.map((alert) => (
                  <div key={alert.rca_id} style={styles.alert('#ef4444')}>
                    <strong>{alert.adverse_event_description}</strong> — {Math.abs(alert.days_overdue)} days overdue (Deadline: {formatDate(alert.deadline)})
                  </div>
                ))}
              </div>
            )}

            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>Status Distribution</h3>
              <div style={styles.grid}>
                {Object.entries(dashboard.status_distribution).map(([status, count]) => (
                  <div key={status} style={styles.stat}>
                    <p style={styles.statValue}>{count}</p>
                    <p style={styles.statLabel}>{getStatusLabel(status)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>CAPA Status Distribution</h3>
              <div style={styles.grid}>
                {Object.entries(dashboard.capa_status_distribution).map(([status, count]) => (
                  <div key={status} style={styles.stat}>
                    <p style={styles.statValue}>{count}</p>
                    <p style={styles.statLabel}>{getStatusLabel(status)}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <button style={styles.button} onClick={() => setActiveTab('board')}>
          ← Back to Board
        </button>
      </div>
    );
  }

  // ─── TABS HEADER ───────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>RCA Management System</h1>
      </div>

      <div style={styles.tabContainer}>
        <button style={styles.tab(activeTab === 'board')} onClick={() => setActiveTab('board')}>
          📋 RCA Board
        </button>
        <button style={styles.tab(activeTab === 'detail')} onClick={() => setActiveTab('detail')}>
          🔍 Investigation Detail
        </button>
        <button style={styles.tab(activeTab === 'team')} onClick={() => setActiveTab('team')}>
          👥 Team
        </button>
        <button style={styles.tab(activeTab === 'capa')} onClick={() => setActiveTab('capa')}>
          ✅ CAPA Tracker
        </button>
        <button style={styles.tab(activeTab === 'analytics')} onClick={() => setActiveTab('analytics')}>
          📊 Analytics
        </button>
      </div>

      {activeTab === 'board' && (
        <div style={styles.card}>
          <p style={{ color: '#9ca3af', margin: '0' }}>Loading board...</p>
        </div>
      )}
    </div>
  );
}

// ─── HELPER FORMS ──────────────────────────────────────────────

function TimelineEventForm({ onSubmit }: { onSubmit: (time: string, description: string, source: string) => void }) {
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');

  const styles = {
    input: {
      padding: '8px 12px',
      background: '#16213e',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '4px',
      fontSize: '14px',
      marginBottom: '10px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    button: {
      padding: '8px 16px',
      background: '#10b981',
      color: '#16213e',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    },
  };

  return (
    <div>
      <input type="datetime-local" style={styles.input} value={time} onChange={(e) => setTime(e.target.value)} placeholder="Event Time" />
      <input type="text" style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
      <input type="text" style={styles.input} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source" />
      <button style={styles.button} onClick={() => { onSubmit(time, description, source); setTime(''); setDescription(''); setSource(''); }}>
        Add Event
      </button>
    </div>
  );
}

function AddFishboneForm({ category, onSubmit }: { category: string; onSubmit: (description: string) => void }) {
  const [description, setDescription] = useState('');

  const styles = {
    input: {
      padding: '6px 8px',
      background: '#16213e',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '3px',
      fontSize: '12px',
      marginBottom: '8px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    button: {
      padding: '6px 10px',
      background: '#10b981',
      color: '#16213e',
      border: 'none',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '600',
      width: '100%',
    },
  };

  return (
    <div>
      <input type="text" style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Factor..." />
      <button style={styles.button} onClick={() => { onSubmit(description); setDescription(''); }}>
        Add
      </button>
    </div>
  );
}

function FiveWhyForm({ onSubmit }: { onSubmit: (question: string, answer: string) => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const styles = {
    input: {
      padding: '8px 12px',
      background: '#16213e',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '4px',
      fontSize: '14px',
      marginBottom: '10px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    button: {
      padding: '8px 16px',
      background: '#10b981',
      color: '#16213e',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    },
  };

  return (
    <div>
      <input type="text" style={styles.input} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Why Question?" />
      <input type="text" style={styles.input} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer" />
      <button style={styles.button} onClick={() => { onSubmit(question, answer); setQuestion(''); setAnswer(''); }}>
        Add Why
      </button>
    </div>
  );
}

function CapaForm({ onSubmit }: { onSubmit: (description: string, type: CapaType, responsible: string, targetDate: string) => void }) {
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CapaType>('corrective');
  const [responsible, setResponsible] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const styles = {
    input: {
      padding: '8px 12px',
      background: '#16213e',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '4px',
      fontSize: '14px',
      marginBottom: '10px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    button: {
      padding: '8px 16px',
      background: '#10b981',
      color: '#16213e',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    },
  };

  return (
    <div>
      <input type="text" style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="CAPA Description" />
      <select style={styles.input} value={type} onChange={(e) => setType(e.target.value as CapaType)}>
        <option value="corrective">Corrective</option>
        <option value="preventive">Preventive</option>
      </select>
      <input type="text" style={styles.input} value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Responsible Person" />
      <input type="date" style={styles.input} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} placeholder="Target Date" />
      <button style={styles.button} onClick={() => { onSubmit(description, type, responsible, targetDate); setDescription(''); setResponsible(''); setTargetDate(''); }}>
        Add CAPA
      </button>
    </div>
  );
}

function AddTeamMemberForm({ onSubmit }: { onSubmit: (userId: string, role: string) => void }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');

  const styles = {
    input: {
      padding: '8px 12px',
      background: '#16213e',
      border: `1px solid #0f3460`,
      color: '#e0e0e0',
      borderRadius: '4px',
      fontSize: '14px',
      marginBottom: '10px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    button: {
      padding: '8px 16px',
      background: '#10b981',
      color: '#16213e',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    },
  };

  return (
    <div>
      <input type="text" style={styles.input} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID" />
      <input type="text" style={styles.input} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g., Lead, Member, Observer)" />
      <button style={styles.button} onClick={() => { onSubmit(userId, role); setUserId(''); setRole(''); }}>
        Add Member
      </button>
    </div>
  );
}
