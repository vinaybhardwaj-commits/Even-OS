'use client';

import { useState, useEffect, useCallback } from 'react';

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
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Constants ───────────────────────────────────────────────────────────────
type AdminTab = 'forms' | 'audit' | 'analytics';

const CATEGORY_ICONS: Record<string, string> = {
  clinical: '🩺', operational: '⚙️', administrative: '📋', custom: '🔧',
};

const STATUS_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  active: { label: '● Active', bg: '#e8f5e9', color: '#2e7d32' },
  draft: { label: '○ Draft', bg: '#fff3e0', color: '#e65100' },
  archived: { label: '✕ Archived', bg: '#f5f5f5', color: '#757575' },
};

const TARGET_LABELS: Record<string, string> = {
  form_submissions: '📥 Stored',
  his_router: '🏥 HIS Route',
  clinical_template: '📄 Template',
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  form_opened: '📂 Opened',
  form_submitted: '✅ Submitted',
  form_viewed: '👁 Viewed',
  status_changed: '🔄 Status Changed',
  version_created: '📝 Version Created',
  export_pdf: '📄 PDF Export',
};

// ── Props ───────────────────────────────────────────────────────────────────
interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href: string }[];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function FormsAdminClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('forms');
  const [loading, setLoading] = useState(true);

  // Form list state
  const [forms, setForms] = useState<any[]>([]);
  const [formTotal, setFormTotal] = useState(0);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedForm, setSelectedForm] = useState<any>(null);

  // Submission stats
  const [submissionStats, setSubmissionStats] = useState<any>(null);
  const [statsDays, setStatsDays] = useState(7);

  // Audit log state
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilterForm, setAuditFilterForm] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditDays, setAuditDays] = useState(30);

  // Form detail / analytics
  const [formAnalytics, setFormAnalytics] = useState<any>(null);

  // ── Load forms ──────────────────────────────────────────────────────────
  const loadForms = useCallback(async () => {
    try {
      setLoading(true);
      const result = await trpcQuery('forms.listDefinitions', {
        category: filterCategory !== 'all' ? filterCategory : undefined,
        status: filterStatus !== 'all' ? filterStatus : undefined,
        search: search || undefined,
        limit: 100,
      });
      if (result) {
        setForms(result.items || []);
        setFormTotal(result.total || 0);
      }
    } catch (err) {
      console.error('Load forms error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterStatus, search]);

  // ── Load submission stats ───────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try {
      const result = await trpcQuery('forms.getSubmissionStats', { days: statsDays });
      if (result) setSubmissionStats(result);
    } catch (err) {
      console.error('Load stats error:', err);
    }
  }, [statsDays]);

  // ── Load audit log ──────────────────────────────────────────────────────
  const loadAudit = useCallback(async () => {
    try {
      const result = await trpcQuery('forms.listAuditLog', {
        form_definition_id: auditFilterForm || undefined,
        action: auditFilterAction || undefined,
        days: auditDays,
        limit: 100,
      });
      if (result) {
        setAuditLog(result.items || []);
        setAuditTotal(result.total || 0);
      }
    } catch (err) {
      console.error('Load audit error:', err);
    }
  }, [auditFilterForm, auditFilterAction, auditDays]);

  // ── Load form analytics ──────────────────────────────────────────────────
  const loadFormAnalytics = useCallback(async (formId: string) => {
    try {
      const result = await trpcQuery('forms.getAnalytics', { form_definition_id: formId });
      if (result) setFormAnalytics(result);
    } catch (err) {
      console.error('Load analytics error:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadForms();
    loadStats();
  }, [loadForms, loadStats]);

  useEffect(() => {
    if (activeTab === 'audit') loadAudit();
  }, [activeTab, loadAudit]);

  // ── Archive form ──────────────────────────────────────────────────────────
  const handleArchive = async (formId: string) => {
    if (!confirm('Archive this form? It will no longer appear in slash commands.')) return;
    try {
      await trpcMutate('forms.archiveDefinition', { id: formId });
      loadForms();
      loadStats();
      setSelectedForm(null);
    } catch (err) {
      alert('Failed to archive form');
    }
  };

  // ── Select form for detail view ──────────────────────────────────────────
  const selectForm = async (form: any) => {
    setSelectedForm(form);
    await loadFormAnalytics(form.id);
  };

  // ── Render Tabs ──────────────────────────────────────────────────────────
  const tabs: { key: AdminTab; label: string; count?: number }[] = [
    { key: 'forms', label: '📋 Form Definitions', count: formTotal },
    { key: 'audit', label: '📜 Audit Log', count: auditTotal },
    { key: 'analytics', label: '📊 Analytics' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui', padding: '24px', maxWidth: '1400px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Form Engine</h1>
          <p style={{ color: '#666', fontSize: '14px', margin: '4px 0 0' }}>
            Manage form definitions, view submissions, and review audit logs
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href="/admin/forms/audit"
            style={{
              padding: '8px 16px', borderRadius: '8px', border: '1px solid #ddd',
              textDecoration: 'none', color: '#333', fontSize: '14px',
            }}
          >
            📜 Full Audit View
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid #e5e7eb', marginBottom: '20px' }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px', border: 'none', cursor: 'pointer', fontSize: '14px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#1976d2' : '#666',
              borderBottom: activeTab === tab.key ? '2px solid #1976d2' : '2px solid transparent',
              background: 'none', marginBottom: '-2px',
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span style={{
                marginLeft: '6px', padding: '2px 8px', borderRadius: '12px',
                background: '#e3f2fd', color: '#1565c0', fontSize: '12px',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ────── FORMS TAB ────── */}
      {activeTab === 'forms' && (
        <div style={{ display: 'flex', gap: '20px' }}>
          {/* Left: Form list */}
          <div style={{ flex: selectedForm ? '0 0 55%' : '1' }}>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search forms..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd',
                  fontSize: '14px', flex: '1', minWidth: '160px',
                }}
              />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
              >
                <option value="all">All Categories</option>
                <option value="clinical">🩺 Clinical</option>
                <option value="operational">⚙️ Operational</option>
                <option value="administrative">📋 Administrative</option>
                <option value="custom">🔧 Custom</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {/* Form list */}
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading forms...</div>
            ) : forms.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>No forms found</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {forms.map((form) => {
                  const stat = submissionStats?.per_form?.find((s: any) => s.id === form.id);
                  const badge = STATUS_BADGES[form.status] || STATUS_BADGES.draft;
                  const isSelected = selectedForm?.id === form.id;

                  return (
                    <div
                      key={form.id}
                      onClick={() => selectForm(form)}
                      style={{
                        padding: '14px 16px', borderRadius: '10px', cursor: 'pointer',
                        border: isSelected ? '2px solid #1976d2' : '1px solid #e5e7eb',
                        background: isSelected ? '#f0f7ff' : '#fff',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '16px' }}>
                              {CATEGORY_ICONS[form.category] || '📋'}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: '15px' }}>{form.name}</span>
                            {form.slash_command && (
                              <code style={{
                                padding: '2px 6px', borderRadius: '4px', background: '#f3e5f5',
                                color: '#7b1fa2', fontSize: '12px', fontFamily: 'monospace',
                              }}>
                                {form.slash_command}
                              </code>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '12px',
                              background: badge.bg, color: badge.color,
                            }}>
                              {badge.label}
                            </span>
                            <span style={{ color: '#999' }}>
                              {TARGET_LABELS[form.submission_target] || form.submission_target}
                            </span>
                            <span style={{ color: '#999' }}>v{form.version}</span>
                            {form.requires_patient && (
                              <span style={{ color: '#999' }}>👤 Patient</span>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '13px' }}>
                          <div style={{ fontWeight: 600, color: '#1976d2' }}>
                            {stat ? Number(stat.submission_count) : 0}
                          </div>
                          <div style={{ fontSize: '11px', color: '#999' }}>
                            {statsDays}d submissions
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Form detail panel */}
          {selectedForm && (
            <div style={{
              flex: '0 0 43%', position: 'sticky', top: '80px', alignSelf: 'flex-start',
              background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb',
              padding: '20px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '18px' }}>{selectedForm.name}</h3>
                <button
                  onClick={() => setSelectedForm(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#999' }}
                >✕</button>
              </div>

              {selectedForm.description && (
                <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>{selectedForm.description}</p>
              )}

              {/* Form metadata */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
                padding: '16px', background: '#f9fafb', borderRadius: '8px', marginBottom: '16px',
              }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>Category</div>
                  <div style={{ fontSize: '14px' }}>{CATEGORY_ICONS[selectedForm.category]} {selectedForm.category}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>Target</div>
                  <div style={{ fontSize: '14px' }}>{TARGET_LABELS[selectedForm.submission_target]}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>Layout</div>
                  <div style={{ fontSize: '14px' }}>{selectedForm.layout}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>Version</div>
                  <div style={{ fontSize: '14px' }}>v{selectedForm.version}</div>
                </div>
                {selectedForm.slash_command && (
                  <div>
                    <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>Slash Command</div>
                    <code style={{ fontSize: '14px', color: '#7b1fa2' }}>{selectedForm.slash_command}</code>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase' }}>Roles</div>
                  <div style={{ fontSize: '13px' }}>
                    {Array.isArray(selectedForm.applicable_roles) && selectedForm.applicable_roles.length > 0
                      ? selectedForm.applicable_roles.slice(0, 4).join(', ') +
                        (selectedForm.applicable_roles.length > 4 ? ` +${selectedForm.applicable_roles.length - 4}` : '')
                      : 'All roles'}
                  </div>
                </div>
              </div>

              {/* Sections overview */}
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                  Sections ({Array.isArray(selectedForm.sections) ? selectedForm.sections.length : 0})
                </h4>
                {Array.isArray(selectedForm.sections) && selectedForm.sections.map((section: any, i: number) => (
                  <div key={section.id || i} style={{
                    padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5e7eb',
                    marginBottom: '4px', fontSize: '13px',
                  }}>
                    <span style={{ fontWeight: 500 }}>{section.title}</span>
                    <span style={{ color: '#999', marginLeft: '8px' }}>
                      {section.fields?.length || 0} fields
                    </span>
                  </div>
                ))}
              </div>

              {/* Analytics summary */}
              {formAnalytics && (
                <div style={{
                  padding: '16px', background: '#f0f7ff', borderRadius: '8px', marginBottom: '16px',
                }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Analytics (30d)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '13px' }}>
                    <div>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#1976d2' }}>
                        {formAnalytics.submissions?.total_submissions || 0}
                      </div>
                      <div style={{ color: '#666' }}>Submissions</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32' }}>
                        {formAnalytics.submissions?.unique_patients || 0}
                      </div>
                      <div style={{ color: '#666' }}>Patients</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#e65100' }}>
                        {formAnalytics.submissions?.avg_completion_time_sec
                          ? `${Math.round(Number(formAnalytics.submissions.avg_completion_time_sec))}s`
                          : '—'}
                      </div>
                      <div style={{ color: '#666' }}>Avg Time</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedForm.status === 'active' && (
                  <button
                    onClick={() => handleArchive(selectedForm.id)}
                    style={{
                      padding: '8px 16px', borderRadius: '8px', border: '1px solid #ef5350',
                      background: '#fff', color: '#ef5350', fontSize: '13px', cursor: 'pointer',
                    }}
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ────── AUDIT TAB ────── */}
      {activeTab === 'audit' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select
              value={auditFilterForm}
              onChange={(e) => setAuditFilterForm(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
            >
              <option value="">All Forms</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select
              value={auditFilterAction}
              onChange={(e) => setAuditFilterAction(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
            >
              <option value="">All Actions</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={auditDays}
              onChange={(e) => setAuditDays(Number(e.target.value))}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button
              onClick={loadAudit}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: '1px solid #1976d2',
                background: '#1976d2', color: '#fff', fontSize: '14px', cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>

          {/* Audit table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Time</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Action</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Form</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Patient</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>By</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                      No audit records found
                    </td>
                  </tr>
                ) : (
                  auditLog.map((entry, i) => (
                    <tr key={entry.id || i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {entry.performed_at ? new Date(entry.performed_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        }) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {AUDIT_ACTION_LABELS[entry.action] || entry.action}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                        {entry.form_name || '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {entry.patient_name || '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {entry.performer_name || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {auditTotal > 0 && (
            <div style={{ padding: '12px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
              Showing {auditLog.length} of {auditTotal} records
            </div>
          )}
        </div>
      )}

      {/* ────── ANALYTICS TAB ────── */}
      {activeTab === 'analytics' && (
        <div>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>Period:</span>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setStatsDays(d)}
                style={{
                  padding: '6px 14px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
                  border: statsDays === d ? '1px solid #1976d2' : '1px solid #ddd',
                  background: statsDays === d ? '#e3f2fd' : '#fff',
                  color: statsDays === d ? '#1976d2' : '#666',
                }}
              >
                {d}d
              </button>
            ))}
          </div>

          {!submissionStats ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading analytics...</div>
          ) : (
            <>
              {/* Status breakdown cards */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                {(submissionStats.status_breakdown || []).map((s: any) => {
                  const badge = STATUS_BADGES[s.status] || { label: s.status, bg: '#f5f5f5', color: '#666' };
                  return (
                    <div key={s.status} style={{
                      padding: '16px 24px', borderRadius: '12px', background: badge.bg,
                      minWidth: '120px',
                    }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: badge.color }}>{Number(s.count)}</div>
                      <div style={{ fontSize: '13px', color: badge.color }}>{badge.label}</div>
                    </div>
                  );
                })}
                {(submissionStats.status_breakdown || []).length === 0 && (
                  <div style={{ padding: '16px 24px', borderRadius: '12px', background: '#f9fafb', color: '#999' }}>
                    No submissions in period
                  </div>
                )}
              </div>

              {/* Per-form table */}
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Submissions by Form</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Form</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Command</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Submissions</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Submitters</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Last Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(submissionStats.per_form || []).map((row: any) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                          {CATEGORY_ICONS[row.category] || '📋'} {row.name}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {row.slash_command ? (
                            <code style={{
                              padding: '2px 6px', borderRadius: '4px', background: '#f3e5f5',
                              color: '#7b1fa2', fontSize: '12px',
                            }}>{row.slash_command}</code>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                          {Number(row.submission_count)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          {Number(row.unique_submitters)}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#999' }}>
                          {row.last_submission
                            ? new Date(row.last_submission).toLocaleString('en-IN', {
                                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Daily sparkline (text-based) */}
              {(submissionStats.daily_totals || []).length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Daily Trend</h3>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '80px' }}>
                    {(submissionStats.daily_totals || []).map((d: any, i: number) => {
                      const maxCount = Math.max(...(submissionStats.daily_totals || []).map((dd: any) => Number(dd.count)));
                      const height = maxCount > 0 ? (Number(d.count) / maxCount) * 60 + 4 : 4;
                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                          <div style={{
                            width: '100%', maxWidth: '30px', height: `${height}px`,
                            background: '#1976d2', borderRadius: '4px 4px 0 0', minHeight: '4px',
                          }} title={`${d.day}: ${d.count}`} />
                          <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                            {new Date(d.day).getDate()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
