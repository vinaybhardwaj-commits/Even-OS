'use client';

/**
 * FormHistoryPanel — SC.5
 *
 * Patient chart "Forms" tab showing unified submission history.
 * Displays all form submissions for a patient with expandable data view.
 */

import React, { useState, useEffect, useCallback } from 'react';

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

const CATEGORY_ICONS: Record<string, string> = {
  clinical: '\u{1FA7A}', operational: '\u2699\uFE0F', administrative: '\u{1F4CB}', custom: '\u{1F527}',
};

interface FormHistoryPanelProps {
  patientId: string;
  encounterId?: string;
}

export const FormHistoryPanel: React.FC<FormHistoryPanelProps> = ({ patientId, encounterId }) => {
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, any[]>>({});
  const [expandedForm, setExpandedForm] = useState<string | null>(null);
  const [expandedSubmission, setExpandedSubmission] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      // Get all active form definitions
      const formResult = await trpcQuery('forms.listDefinitions', { status: 'active', limit: 200 });
      const allForms = formResult?.items || [];

      // For each form, get submissions for this patient
      const subMap: Record<string, any[]> = {};
      const formsWithSubs: any[] = [];

      await Promise.all(
        allForms.map(async (form: any) => {
          const result = await trpcQuery('forms.listSubmissions', {
            form_definition_id: form.id,
            patient_id: patientId,
            limit: 20,
          });
          const items = result?.items || [];
          if (items.length > 0) {
            subMap[form.id] = items;
            formsWithSubs.push({ ...form, submissionCount: items.length });
          }
        })
      );

      // Sort by most recent submission
      formsWithSubs.sort((a, b) => {
        const aLatest = subMap[a.id]?.[0]?.submitted_at || '';
        const bLatest = subMap[b.id]?.[0]?.submitted_at || '';
        return bLatest.localeCompare(aLatest);
      });

      setForms(formsWithSubs);
      setSubmissions(subMap);
    } catch (err) {
      console.error('FormHistoryPanel load error:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
        Loading form history...
      </div>
    );
  }

  if (forms.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#x1F4CB;</div>
        <div>No form submissions found for this patient</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>
        {forms.length} form{forms.length !== 1 ? 's' : ''} with submissions
      </div>

      {forms.map((form) => {
        const formSubs = submissions[form.id] || [];
        const isExpanded = expandedForm === form.id;

        return (
          <div key={form.id} style={{
            marginBottom: '8px', borderRadius: '8px', border: '1px solid #e5e7eb',
            overflow: 'hidden',
          }}>
            {/* Form header */}
            <div
              onClick={() => setExpandedForm(isExpanded ? null : form.id)}
              style={{
                padding: '12px 16px', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isExpanded ? '#f0f7ff' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{CATEGORY_ICONS[form.category] || '\u{1F4CB}'}</span>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{form.name}</span>
                {form.slash_command && (
                  <code style={{
                    padding: '1px 5px', borderRadius: '3px', background: '#f3e5f5',
                    color: '#7b1fa2', fontSize: '11px',
                  }}>
                    {form.slash_command}
                  </code>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '12px', background: '#e3f2fd',
                  color: '#1565c0', fontSize: '12px', fontWeight: 600,
                }}>
                  {form.submissionCount}
                </span>
                <span style={{ fontSize: '14px', color: '#999' }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
              </div>
            </div>

            {/* Submissions list */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid #e5e7eb' }}>
                {formSubs.map((sub) => {
                  const isSubExpanded = expandedSubmission === sub.id;
                  return (
                    <div key={sub.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <div
                        onClick={() => setExpandedSubmission(isSubExpanded ? null : sub.id)}
                        style={{
                          padding: '10px 16px', cursor: 'pointer',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          fontSize: '13px', background: isSubExpanded ? '#fafbfc' : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <span style={{ color: '#999', fontSize: '12px' }}>v{sub.version}</span>
                          <span>
                            {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('en-IN', {
                              day: '2-digit', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            }) : 'Draft'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '11px',
                            background: sub.status === 'submitted' ? '#e8f5e9' : sub.status === 'locked' ? '#e3f2fd' : '#fff3e0',
                            color: sub.status === 'submitted' ? '#2e7d32' : sub.status === 'locked' ? '#1565c0' : '#e65100',
                          }}>
                            {sub.status}
                          </span>
                          <span style={{ fontSize: '12px', color: '#999' }}>{isSubExpanded ? '\u25BE' : '\u25B8'}</span>
                        </div>
                      </div>

                      {/* Submission data */}
                      {isSubExpanded && sub.form_data && (
                        <div style={{ padding: '12px 16px', background: '#fafbfc' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', marginBottom: '8px', textTransform: 'uppercase' }}>
                            Form Data
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            {Object.entries(sub.form_data).map(([key, value]) => (
                              <div key={key} style={{
                                padding: '6px 10px', background: '#fff', borderRadius: '4px',
                                border: '1px solid #e5e7eb', fontSize: '12px',
                              }}>
                                <div style={{ color: '#999', fontSize: '10px', marginBottom: '2px' }}>{key}</div>
                                <div style={{ fontWeight: 500 }}>{String(value)}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: '8px', fontSize: '10px', color: '#ccc' }}>
                            Hash: {sub.form_data_hash?.slice(0, 12)}...
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FormHistoryPanel;
