'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// tRPC fetch helpers
// ============================================================
async function trpcQuery(path: string, input?: Record<string, unknown>) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
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

// ============================================================
// Types
// ============================================================
type TabType = 'reports' | 'outsourced' | 'generate' | 'analytics';

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  name: string;
}

interface Report {
  id: string;
  report_number: string;
  order_id: string;
  patient_id: string;
  status: string;
  panel_name: string | null;
  results_snapshot: ResultEntry[] | null;
  interpretation: string | null;
  has_critical: boolean;
  critical_count: number;
  abnormal_count: number;
  generated_at: string;
  verified_at: string | null;
  amendment_reason: string | null;
  previous_version_id: string | null;
}

interface ResultEntry {
  test_code: string;
  test_name: string;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  ref_range_low: string | null;
  ref_range_high: string | null;
  ref_range_text: string | null;
  flag: string;
  is_critical: boolean;
}

interface OutsourcedDoc {
  id: string;
  patient_id: string;
  external_lab_name: string;
  external_report_number: string | null;
  external_report_date: string | null;
  file_name: string;
  file_url: string;
  status: string;
  extracted_results: OutsourcedResult[] | null;
  entry_notes: string | null;
  uploaded_at: string;
  entered_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

interface OutsourcedResult {
  test_name: string;
  value: string;
  unit?: string;
  ref_range?: string;
  flag?: string;
}

interface Stats {
  total_reports: number;
  pending_verification: number;
  reports_today: number;
  critical_reports: number;
  total_outsourced: number;
  pending_entry: number;
}

// ============================================================
// Main Client
// ============================================================
export default function LabReportsClient({ user }: { user: User }) {
  const [tab, setTab] = useState<TabType>('reports');
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await trpcQuery('labReports.reportStats', { hospital_id: user.hospital_id });
      setStats(data);
    } catch { /* ignore */ }
  }, [user.hospital_id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'reports', label: 'Lab Reports' },
    { key: 'outsourced', label: 'Outsourced Labs' },
    { key: 'generate', label: 'Generate Report' },
    { key: 'analytics', label: 'Analytics' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Lab Reports &amp; Outsourced Labs</h1>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0' }}>
              Generate reports, manage outsourced lab documents, verify results
            </p>
          </div>
          <a href="/dashboard" style={{ color: '#60a5fa', fontSize: '13px', textDecoration: 'none' }}>
            ← Dashboard
          </a>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', padding: '16px 24px' }}>
          {[
            { label: 'Total Reports', value: stats.total_reports, color: '#3b82f6' },
            { label: 'Pending Verify', value: stats.pending_verification, color: '#f59e0b' },
            { label: 'Today', value: stats.reports_today, color: '#10b981' },
            { label: 'Critical', value: stats.critical_reports, color: '#ef4444' },
            { label: 'Outsourced', value: stats.total_outsourced, color: '#8b5cf6' },
            { label: 'Pending Entry', value: stats.pending_entry, color: '#06b6d4' },
          ].map((s) => (
            <div key={s.label} style={{
              background: '#1e293b', borderRadius: '8px', padding: '12px 16px',
              borderLeft: `3px solid ${s.color}`,
            }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>{s.label}</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #334155', padding: '0 24px' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              background: 'transparent', border: 'none',
              color: tab === t.key ? '#60a5fa' : '#94a3b8',
              borderBottom: tab === t.key ? '2px solid #60a5fa' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '24px' }}>
        {tab === 'reports' && <ReportsTab user={user} onUpdate={loadStats} />}
        {tab === 'outsourced' && <OutsourcedTab user={user} onUpdate={loadStats} />}
        {tab === 'generate' && <GenerateTab user={user} onUpdate={loadStats} />}
        {tab === 'analytics' && <AnalyticsTab stats={stats} />}
      </div>
    </div>
  );
}

// ============================================================
// REPORTS TAB
// ============================================================
function ReportsTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = { hospital_id: user.hospital_id };
      if (statusFilter) input.status = statusFilter;
      if (criticalOnly) input.has_critical = true;
      const data = await trpcQuery('labReports.list', input);
      setReports(data?.reports ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, statusFilter, criticalOnly]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handleVerify = async (reportId: string) => {
    if (!confirm('Verify this report?')) return;
    try {
      await trpcMutate('labReports.verify', { report_id: reportId });
      loadReports();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const statusColors: Record<string, string> = {
    draft: '#64748b', generated: '#f59e0b', verified: '#10b981', amended: '#3b82f6', cancelled: '#ef4444',
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading reports...</div>;

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All Statuses</option>
          <option value="generated">Pending Verification</option>
          <option value="verified">Verified</option>
          <option value="amended">Amended</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#94a3b8' }}>
          <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
          Critical only
        </label>
      </div>

      {reports.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>No reports found.</div>
      ) : (
        reports.map((report) => (
          <div key={report.id} style={{
            background: '#1e293b', borderRadius: '8px', marginBottom: '8px',
            border: `1px solid ${report.has_critical ? '#dc2626' : '#334155'}`,
            overflow: 'hidden',
          }}>
            {/* Report Header */}
            <div
              onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
              style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#60a5fa' }}>
                  {report.report_number}
                </span>
                <span style={{
                  fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                  background: statusColors[report.status] ?? '#64748b', color: '#fff',
                }}>
                  {report.status}
                </span>
                {report.has_critical && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444' }}>
                    {report.critical_count} CRITICAL
                  </span>
                )}
                {report.abnormal_count > 0 && (
                  <span style={{ fontSize: '11px', color: '#f59e0b' }}>
                    {report.abnormal_count} abnormal
                  </span>
                )}
                <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{report.panel_name ?? 'Unknown Panel'}</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  {new Date(report.generated_at).toLocaleString()}
                </span>
                {report.status === 'generated' && (
                  <button onClick={(e) => { e.stopPropagation(); handleVerify(report.id); }} style={{ ...smallBtnStyle, background: '#10b981' }}>
                    Verify
                  </button>
                )}
                {report.previous_version_id && (
                  <span style={{ fontSize: '10px', color: '#8b5cf6' }}>AMENDED</span>
                )}
                <span style={{ color: '#64748b' }}>{expandedReport === report.id ? '▼' : '▶'}</span>
              </div>
            </div>

            {/* Expanded: Results Table */}
            {expandedReport === report.id && report.results_snapshot && (
              <div style={{ borderTop: '1px solid #334155', padding: '12px 20px' }}>
                {report.interpretation && (
                  <div style={{ padding: '8px 12px', background: '#0f172a', borderRadius: '6px', marginBottom: '12px', fontSize: '13px', borderLeft: '3px solid #3b82f6' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Interpretation: </span>
                    {report.interpretation}
                  </div>
                )}

                {/* Results table */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '120px 1fr 100px 80px 140px 80px',
                  padding: '6px 0', fontSize: '11px', color: '#64748b', fontWeight: 600,
                  textTransform: 'uppercase', borderBottom: '1px solid #334155',
                }}>
                  <div>Code</div><div>Test</div><div>Result</div><div>Unit</div><div>Ref Range</div><div>Flag</div>
                </div>

                {(report.results_snapshot as ResultEntry[]).map((r, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '120px 1fr 100px 80px 140px 80px',
                    padding: '6px 0', fontSize: '13px', borderBottom: '1px solid #1e293b',
                    background: r.is_critical ? 'rgba(239,68,68,0.08)' : 'transparent',
                  }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#60a5fa' }}>{r.test_code}</div>
                    <div>{r.test_name}</div>
                    <div style={{ fontWeight: 600, color: r.is_critical ? '#ef4444' : r.flag !== 'normal' ? '#f59e0b' : '#e2e8f0' }}>
                      {r.value_numeric ?? r.value_text ?? '—'}
                    </div>
                    <div style={{ color: '#94a3b8' }}>{r.unit ?? '—'}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      {r.ref_range_text ?? (r.ref_range_low && r.ref_range_high ? `${r.ref_range_low} – ${r.ref_range_high}` : '—')}
                    </div>
                    <div>
                      {r.is_critical ? (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444' }}>CRITICAL</span>
                      ) : r.flag !== 'normal' ? (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b' }}>{r.flag?.toUpperCase()}</span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#64748b' }}>Normal</span>
                      )}
                    </div>
                  </div>
                ))}

                {report.amendment_reason && (
                  <div style={{ marginTop: '8px', padding: '6px 12px', background: '#1a1a2e', borderRadius: '6px', fontSize: '12px', borderLeft: '3px solid #8b5cf6' }}>
                    <span style={{ color: '#8b5cf6' }}>Amendment: </span>
                    <span style={{ color: '#94a3b8' }}>{report.amendment_reason}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================
// OUTSOURCED TAB
// ============================================================
function OutsourcedTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [docs, setDocs] = useState<OutsourcedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  // Result entry form
  const [entryDocId, setEntryDocId] = useState<string | null>(null);
  const [entryRows, setEntryRows] = useState<OutsourcedResult[]>([{ test_name: '', value: '', unit: '', ref_range: '', flag: 'normal' }]);
  const [entryNotes, setEntryNotes] = useState('');

  // Upload form
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    patient_id: '', external_lab_name: '', external_report_number: '',
    file_name: '', file_url: '',
  });

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = { hospital_id: user.hospital_id };
      if (statusFilter) input.status = statusFilter;
      const data = await trpcQuery('labReports.listOutsourced', input);
      setDocs(data?.docs ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, statusFilter]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleUpload = async () => {
    if (!uploadForm.patient_id || !uploadForm.external_lab_name || !uploadForm.file_url) {
      alert('Fill required fields: Patient ID, Lab Name, File URL');
      return;
    }
    try {
      await trpcMutate('labReports.uploadOutsourced', {
        hospital_id: user.hospital_id,
        patient_id: uploadForm.patient_id,
        external_lab_name: uploadForm.external_lab_name,
        external_report_number: uploadForm.external_report_number || undefined,
        file_name: uploadForm.file_name || 'external-report.pdf',
        file_url: uploadForm.file_url,
      });
      setShowUpload(false);
      setUploadForm({ patient_id: '', external_lab_name: '', external_report_number: '', file_name: '', file_url: '' });
      loadDocs();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleEnterResults = async (docId: string) => {
    try {
      const validRows = entryRows.filter((r) => r.test_name && r.value);
      if (validRows.length === 0) { alert('Enter at least one result'); return; }
      await trpcMutate('labReports.enterResults', {
        doc_id: docId,
        results: validRows,
        entry_notes: entryNotes || undefined,
      });
      setEntryDocId(null);
      setEntryRows([{ test_name: '', value: '', unit: '', ref_range: '', flag: 'normal' }]);
      setEntryNotes('');
      loadDocs();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleVerify = async (docId: string) => {
    try {
      await trpcMutate('labReports.verifyOutsourced', { doc_id: docId });
      loadDocs();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleReject = async (docId: string) => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      await trpcMutate('labReports.rejectOutsourced', { doc_id: docId, reason });
      loadDocs();
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  };

  const addEntryRow = () => {
    setEntryRows([...entryRows, { test_name: '', value: '', unit: '', ref_range: '', flag: 'normal' }]);
  };

  const updateEntryRow = (idx: number, field: string, val: string) => {
    const updated = [...entryRows];
    (updated[idx] as unknown as Record<string, string>)[field] = val;
    setEntryRows(updated);
  };

  const statusColors: Record<string, string> = {
    uploaded: '#64748b', pending_entry: '#f59e0b', results_entered: '#3b82f6', verified: '#10b981', rejected: '#ef4444',
  };

  if (loading) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      {/* Filters + Upload */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All Statuses</option>
          <option value="pending_entry">Pending Entry</option>
          <option value="results_entered">Results Entered</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={() => setShowUpload(!showUpload)} style={{ ...btnStyle, background: '#1e40af' }}>
          {showUpload ? 'Cancel' : '+ Upload External Report'}
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Upload External Lab Report</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <input placeholder="Patient ID (UUID)" value={uploadForm.patient_id} onChange={(e) => setUploadForm({ ...uploadForm, patient_id: e.target.value })} style={inputStyle} />
            <input placeholder="External Lab Name *" value={uploadForm.external_lab_name} onChange={(e) => setUploadForm({ ...uploadForm, external_lab_name: e.target.value })} style={inputStyle} />
            <input placeholder="Report Number" value={uploadForm.external_report_number} onChange={(e) => setUploadForm({ ...uploadForm, external_report_number: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <input placeholder="File Name" value={uploadForm.file_name} onChange={(e) => setUploadForm({ ...uploadForm, file_name: e.target.value })} style={inputStyle} />
            <input placeholder="File URL / Storage Path *" value={uploadForm.file_url} onChange={(e) => setUploadForm({ ...uploadForm, file_url: e.target.value })} style={inputStyle} />
          </div>
          <button onClick={handleUpload} style={{ ...btnStyle, background: '#10b981' }}>Upload</button>
        </div>
      )}

      {/* Doc List */}
      {docs.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>No outsourced documents found.</div>
      ) : (
        docs.map((doc) => (
          <div key={doc.id} style={{
            background: '#1e293b', borderRadius: '8px', marginBottom: '8px',
            border: '1px solid #334155', overflow: 'hidden',
          }}>
            <div
              onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
              style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>{doc.external_lab_name}</span>
                <span style={{
                  fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                  background: statusColors[doc.status] ?? '#64748b', color: '#fff',
                }}>
                  {doc.status.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>{doc.file_name}</span>
                {doc.external_report_number && (
                  <span style={{ fontSize: '12px', color: '#64748b' }}>#{doc.external_report_number}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{new Date(doc.uploaded_at).toLocaleDateString()}</span>
                {doc.status === 'pending_entry' && (
                  <button onClick={(e) => { e.stopPropagation(); setEntryDocId(doc.id); }} style={{ ...smallBtnStyle, background: '#3b82f6' }}>Enter Results</button>
                )}
                {doc.status === 'results_entered' && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); handleVerify(doc.id); }} style={{ ...smallBtnStyle, background: '#10b981' }}>Verify</button>
                    <button onClick={(e) => { e.stopPropagation(); handleReject(doc.id); }} style={{ ...smallBtnStyle, background: '#ef4444' }}>Reject</button>
                  </>
                )}
                <span style={{ color: '#64748b' }}>{expandedDoc === doc.id ? '▼' : '▶'}</span>
              </div>
            </div>

            {/* Expanded: Results or Entry Form */}
            {expandedDoc === doc.id && (
              <div style={{ borderTop: '1px solid #334155', padding: '12px 20px' }}>
                {doc.extracted_results && doc.extracted_results.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>Extracted Results</div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 100px 80px 120px 80px',
                      padding: '6px 0', fontSize: '11px', color: '#64748b', fontWeight: 600,
                      textTransform: 'uppercase', borderBottom: '1px solid #334155',
                    }}>
                      <div>Test</div><div>Value</div><div>Unit</div><div>Ref Range</div><div>Flag</div>
                    </div>
                    {doc.extracted_results.map((r, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '1fr 100px 80px 120px 80px',
                        padding: '6px 0', fontSize: '13px', borderBottom: '1px solid #1e293b',
                      }}>
                        <div>{r.test_name}</div>
                        <div style={{ fontWeight: 600 }}>{r.value}</div>
                        <div style={{ color: '#94a3b8' }}>{r.unit ?? '—'}</div>
                        <div style={{ color: '#64748b', fontSize: '12px' }}>{r.ref_range ?? '—'}</div>
                        <div style={{ fontSize: '11px', color: r.flag === 'critical_low' || r.flag === 'critical_high' ? '#ef4444' : r.flag === 'normal' ? '#64748b' : '#f59e0b' }}>
                          {r.flag ?? '—'}
                        </div>
                      </div>
                    ))}
                    {doc.entry_notes && (
                      <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>Notes: {doc.entry_notes}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>No results entered yet.</div>
                )}
                {doc.rejection_reason && (
                  <div style={{ marginTop: '8px', padding: '6px 12px', background: '#1a1a2e', borderRadius: '6px', fontSize: '12px', borderLeft: '3px solid #ef4444' }}>
                    <span style={{ color: '#ef4444' }}>Rejected: </span>{doc.rejection_reason}
                  </div>
                )}
              </div>
            )}

            {/* Result Entry Form (modal-like inline) */}
            {entryDocId === doc.id && (
              <div style={{ borderTop: '1px solid #334155', padding: '16px 20px', background: '#0f172a' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#60a5fa' }}>
                  Enter Results from {doc.external_lab_name}
                </div>
                {entryRows.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px 1fr 100px 30px', gap: '6px', marginBottom: '6px' }}>
                    <input placeholder="Test Name" value={row.test_name} onChange={(e) => updateEntryRow(i, 'test_name', e.target.value)} style={inputStyle} />
                    <input placeholder="Value" value={row.value} onChange={(e) => updateEntryRow(i, 'value', e.target.value)} style={inputStyle} />
                    <input placeholder="Unit" value={row.unit ?? ''} onChange={(e) => updateEntryRow(i, 'unit', e.target.value)} style={inputStyle} />
                    <input placeholder="Ref Range" value={row.ref_range ?? ''} onChange={(e) => updateEntryRow(i, 'ref_range', e.target.value)} style={inputStyle} />
                    <select value={row.flag ?? 'normal'} onChange={(e) => updateEntryRow(i, 'flag', e.target.value)} style={inputStyle}>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                      <option value="high">High</option>
                      <option value="critical_low">Crit Low</option>
                      <option value="critical_high">Crit High</option>
                      <option value="abnormal">Abnormal</option>
                    </select>
                    <button onClick={() => setEntryRows(entryRows.filter((_, idx) => idx !== i))} style={{ ...smallBtnStyle, background: '#ef4444' }}>X</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={addEntryRow} style={{ ...btnStyle, background: '#475569', fontSize: '12px' }}>+ Add Row</button>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <input placeholder="Notes (optional)" value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => handleEnterResults(doc.id)} style={{ ...btnStyle, background: '#10b981' }}>Save Results</button>
                  <button onClick={() => setEntryDocId(null)} style={{ ...btnStyle, background: '#475569' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================
// GENERATE TAB — Generate report from an order
// ============================================================
function GenerateTab({ user, onUpdate }: { user: User; onUpdate: () => void }) {
  const [orderId, setOrderId] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Report | null>(null);

  const handleGenerate = async () => {
    if (!orderId) { alert('Enter an Order ID'); return; }
    setGenerating(true);
    try {
      const data = await trpcMutate('labReports.generate', {
        hospital_id: user.hospital_id,
        order_id: orderId,
        interpretation: interpretation || undefined,
        clinical_notes: clinicalNotes || undefined,
      });
      setResult(data);
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate report');
    }
    setGenerating(false);
  };

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Generate Diagnostic Report</h2>

      <div style={{ background: '#1e293b', borderRadius: '8px', padding: '16px', border: '1px solid #334155', maxWidth: '600px' }}>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Lab Order ID</label>
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="UUID of the lab order" style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Interpretation (optional)</label>
          <textarea value={interpretation} onChange={(e) => setInterpretation(e.target.value)} placeholder="Pathologist interpretation..." rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Clinical Notes (optional)</label>
          <textarea value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} placeholder="Additional notes..." rows={2} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
        </div>
        <button onClick={handleGenerate} disabled={generating} style={{ ...btnStyle, background: generating ? '#475569' : '#10b981' }}>
          {generating ? 'Generating...' : 'Generate Report'}
        </button>
      </div>

      {result && (
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '16px', border: '1px solid #10b981', marginTop: '16px', maxWidth: '600px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#10b981', marginBottom: '8px' }}>Report Generated</div>
          <div style={{ fontSize: '13px' }}>
            Report #: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{result.report_number}</span>
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8' }}>
            Panel: {result.panel_name} | {result.has_critical ? `${result.critical_count} critical` : 'No critical values'}
            {result.abnormal_count > 0 && ` | ${result.abnormal_count} abnormal`}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ANALYTICS TAB
// ============================================================
function AnalyticsTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <div style={{ color: '#94a3b8', padding: '40px', textAlign: 'center' }}>Loading analytics...</div>;

  const metrics = [
    { label: 'Total Reports Generated', value: stats.total_reports, color: '#3b82f6', desc: 'All-time diagnostic reports' },
    { label: 'Pending Verification', value: stats.pending_verification, color: '#f59e0b', desc: 'Reports awaiting pathologist sign-off' },
    { label: 'Reports Today', value: stats.reports_today, color: '#10b981', desc: 'Generated in the last 24h' },
    { label: 'Critical Reports', value: stats.critical_reports, color: '#ef4444', desc: 'Reports containing critical values' },
    { label: 'Outsourced Documents', value: stats.total_outsourced, color: '#8b5cf6', desc: 'External lab reports uploaded' },
    { label: 'Pending Result Entry', value: stats.pending_entry, color: '#06b6d4', desc: 'Outsourced docs awaiting manual entry' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Report Analytics</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            background: '#1e293b', borderRadius: '8px', padding: '20px',
            border: '1px solid #334155', borderLeft: `4px solid ${m.color}`,
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase' }}>{m.label}</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: m.color, margin: '8px 0 4px' }}>{m.value}</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>{m.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Shared Styles
// ============================================================
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: '4px',
  background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: '13px',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: '6px', border: 'none',
  color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: '4px', border: 'none',
  color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
};
