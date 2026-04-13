'use client';

import { useState, useEffect } from 'react';

interface ChecklistItem {
  id: string;
  item_code: string;
  title: string;
  section: string;
  status: string;
  evidence_url?: string;
  assigned_to?: string;
  notes?: string;
}

interface ComplianceSummary {
  checklist_type: string;
  total: number;
  compliant: number;
  non_compliant: number;
  in_progress: number;
  not_started: number;
  na: number;
  compliance_pct: string;
}

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
    body: JSON.stringify(input || {}),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

export default function ComplianceClient() {
  const [summaries, setSummaries] = useState<ComplianceSummary[]>([]);
  const [items, setItems] = useState<Record<string, ChecklistItem[]>>({
    owasp: [],
    nabh: [],
    dpdp: [],
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('owasp');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const summaryData = await trpcQuery('hardening.getComplianceSummary', {});
      setSummaries(summaryData);

      const owasp = await trpcQuery('hardening.listChecklistItems', {
        checklist_type: 'owasp',
        limit: 100,
      });
      const nabh = await trpcQuery('hardening.listChecklistItems', {
        checklist_type: 'nabh',
        limit: 100,
      });
      const dpdp = await trpcQuery('hardening.listChecklistItems', {
        checklist_type: 'dpdp',
        limit: 100,
      });

      setItems({
        owasp: owasp.items || [],
        nabh: nabh.items || [],
        dpdp: dpdp.items || [],
      });
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function updateItem(id: string, status: string, notes: string) {
    try {
      await trpcMutate('hardening.updateChecklistItem', { id, status, notes });
      loadData();
    } catch (err) {
      console.error('Error updating item:', err);
    }
  }

  const statusColor: Record<string, string> = {
    compliant: 'color: #166534; background: #dcfce7;',
    non_compliant: 'color: #7f1d1d; background: #fee2e2;',
    in_progress: 'color: #713f12; background: #fef08a;',
    not_started: 'color: #374151; background: #f3f4f6;',
    na: 'color: #0c4a6e; background: #bfdbfe;',
  };

  const getSummary = (type: string) => summaries.find(s => s.checklist_type === type);

  if (loading) return <div style={{ padding: '1rem' }}>Loading...</div>;

  const renderChecklistTable = (type: string) => {
    const tableItems = items[type as keyof typeof items] || [];
    const summary = getSummary(type);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#16a34a' }}>{summary.compliance_pct}%</div>
              <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Compliance Rate</p>
            </div>
            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.875rem', fontWeight: 'bold' }}>{summary.compliant}</div>
              <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>of {summary.total} items compliant</p>
            </div>
            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <p style={{ fontSize: '0.875rem' }}>In Progress: {summary.in_progress}</p>
              <p style={{ fontSize: '0.875rem' }}>Not Started: {summary.not_started}</p>
            </div>
          </div>
        )}

        <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem' }}>
              <thead style={{ borderBottom: '1px solid #e5e7eb' }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Evidence</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{item.item_code}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <div>
                        <p style={{ fontWeight: '600' }}>{item.title}</p>
                        <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{item.section}</p>
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', ...{ style: statusColor[item.status] || '' } }}>
                        {item.status === 'not_started' ? 'Not Started' : item.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      {item.evidence_url ? (
                        <a
                          href={item.evidence_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#2563eb', textDecoration: 'underline', fontSize: '0.75rem' }}
                        >
                          View
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>None</span>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <select
                        value={item.status}
                        onChange={(e) => updateItem(item.id, e.target.value, item.notes || '')}
                        style={{ fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', padding: '0.25rem 0.5rem' }}
                      >
                        <option value="not_started">Not Started</option>
                        <option value="in_progress">In Progress</option>
                        <option value="compliant">Compliant</option>
                        <option value="non_compliant">Non-Compliant</option>
                        <option value="na">N/A</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>Compliance Framework Status</h2>
        <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Track compliance across OWASP, NABH, and DPDP frameworks</p>
      </div>

      {/* Tabs */}
      <div>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>
          {['owasp', 'nabh', 'dpdp'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.75rem 1rem',
                fontSize: '0.875rem',
                fontWeight: activeTab === tab ? '600' : '400',
                color: activeTab === tab ? '#1f2937' : '#6b7280',
                borderBottom: activeTab === tab ? '2px solid #2563eb' : 'none',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {tab === 'owasp' ? 'OWASP Top 10' : tab === 'nabh' ? 'NABH Standards' : 'DPDP Guidelines'}
            </button>
          ))}
        </div>
        <div style={{ marginTop: '1rem' }}>
          {renderChecklistTable(activeTab)}
        </div>
      </div>
    </div>
  );
}
