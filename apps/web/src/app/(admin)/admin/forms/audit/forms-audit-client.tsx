'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  form_opened: '📂 Opened',
  form_submitted: '✅ Submitted',
  form_viewed: '👁 Viewed',
  status_changed: '🔄 Status Changed',
  version_created: '📝 Version Created',
  export_pdf: '📄 PDF Export',
};

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href: string }[];
}

export default function FormsAuditClient({ userId, userRole, userName, breadcrumbs }: Props) {
  const [loading, setLoading] = useState(true);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [forms, setForms] = useState<any[]>([]);

  // Filters
  const [filterForm, setFilterForm] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterDays, setFilterDays] = useState(30);
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const PAGE_SIZE = 50;

  // Load form list for filter dropdown
  useEffect(() => {
    trpcQuery('forms.listDefinitions', { limit: 200 }).then((r) => {
      if (r?.items) setForms(r.items);
    });
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      setLoading(true);
      const result = await trpcQuery('forms.listAuditLog', {
        form_definition_id: filterForm || undefined,
        action: filterAction || undefined,
        days: filterDays,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (result) {
        setAuditLog(result.items || []);
        setAuditTotal(result.total || 0);
      }
    } catch (err) {
      console.error('Audit load error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterForm, filterAction, filterDays, page]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  const totalPages = Math.ceil(auditTotal / PAGE_SIZE);

  return (
    <div style={{ fontFamily: 'system-ui', padding: '24px', maxWidth: '1400px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>📜 Form Audit Log</h1>
          <p style={{ color: '#666', fontSize: '14px', margin: '4px 0 0' }}>
            Complete trail of all form interactions across the hospital
          </p>
        </div>
        <div style={{
          padding: '8px 16px', background: '#f0f7ff', borderRadius: '8px', fontSize: '14px',
        }}>
          {auditTotal} records ({filterDays}d)
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap',
        padding: '16px', background: '#f9fafb', borderRadius: '10px',
      }}>
        <select
          value={filterForm}
          onChange={(e) => { setFilterForm(e.target.value); setPage(0); }}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', minWidth: '200px' }}
        >
          <option value="">All Forms</option>
          {forms.map((f: any) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <select
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
        >
          <option value="">All Actions</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterDays}
          onChange={(e) => { setFilterDays(Number(e.target.value)); setPage(0); }}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#999' }}>Loading audit records...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', width: '160px' }}>Timestamp</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', width: '140px' }}>Action</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Form</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Patient</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Performed By</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', width: '60px' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '60px', textAlign: 'center', color: '#999' }}>
                    No audit records found for the selected filters
                  </td>
                </tr>
              ) : (
                auditLog.map((entry, i) => (
                  <React.Fragment key={entry.id || i}>
                    <tr
                      style={{
                        borderBottom: '1px solid #f0f0f0',
                        cursor: entry.field_snapshot ? 'pointer' : 'default',
                        background: expandedRow === i ? '#f8f9ff' : undefined,
                      }}
                      onClick={() => entry.field_snapshot && setExpandedRow(expandedRow === i ? null : i)}
                    >
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: '12px' }}>
                        {entry.performed_at ? new Date(entry.performed_at).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        }) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: '6px', fontSize: '12px',
                          background: entry.action === 'form_submitted' ? '#e8f5e9' : '#f5f5f5',
                          color: entry.action === 'form_submitted' ? '#2e7d32' : '#666',
                        }}>
                          {AUDIT_ACTION_LABELS[entry.action] || entry.action}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                        {entry.form_name || '—'}
                        {entry.form_slug && (
                          <span style={{ color: '#999', fontSize: '11px', marginLeft: '4px' }}>
                            ({entry.form_slug})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>{entry.patient_name || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{entry.performer_name || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {entry.field_snapshot && (
                          <span style={{ fontSize: '14px' }}>{expandedRow === i ? '▾' : '▸'}</span>
                        )}
                      </td>
                    </tr>
                    {expandedRow === i && entry.field_snapshot && (
                      <tr key={`${entry.id || i}-detail`}>
                        <td colSpan={6} style={{
                          padding: '12px 24px', background: '#f8f9ff', borderBottom: '1px solid #e5e7eb',
                        }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#666' }}>
                            Field Snapshot:
                          </div>
                          <pre style={{
                            margin: 0, padding: '12px', background: '#fff', borderRadius: '6px',
                            border: '1px solid #e5e7eb', fontSize: '12px', overflowX: 'auto',
                            maxHeight: '200px', overflowY: 'auto',
                          }}>
                            {JSON.stringify(entry.field_snapshot, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px', alignItems: 'center',
        }}>
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid #ddd',
              background: '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer',
              opacity: page === 0 ? 0.5 : 1, fontSize: '13px',
            }}
          >
            ← Previous
          </button>
          <span style={{ fontSize: '13px', color: '#666' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid #ddd',
              background: '#fff', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
              opacity: page >= totalPages - 1 ? 0.5 : 1, fontSize: '13px',
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
