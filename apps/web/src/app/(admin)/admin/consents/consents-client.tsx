'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Consent = {
  id: string;
  template_name: string;
  template_id: string;
  template_category: string;
  consent_status: 'pending' | 'signed' | 'refused' | 'revoked';
  signed_by_name: string | null;
  relationship: string | null;
  signed_at: string | null;
  refused_reason: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
};

type Form = {
  id: string;
  template_name: string;
  template_id: string;
  template_category: string;
  form_status: 'draft' | 'submitted' | 'reviewed' | 'locked';
  submitted_at: string | null;
  reviewed_at: string | null;
  locked_at: string | null;
  created_at: string;
};

type FormTemplate = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  version: number;
  status: 'active' | 'draft' | 'archived';
  created_at: string;
};

type Stats = {
  consents: { pending: number; signed: number; refused: number; revoked: number };
  forms: { draft: number; submitted: number; reviewed: number; locked: number };
};

const COLORS = {
  bg: '#1a1a2e',
  card: '#16213e',
  accent: '#0f3460',
  text: '#e0e0e0',
  success: '#4caf50',
  warning: '#ff9800',
  error: '#f44336',
  info: '#2196f3',
};

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

export default function ConsentsClient() {
  const [activeTab, setActiveTab] = useState<'consents' | 'forms' | 'templates'>('consents');
  const [stats, setStats] = useState<Stats>({
    consents: { pending: 0, signed: 0, refused: 0, revoked: 0 },
    forms: { draft: 0, submitted: 0, reviewed: 0, locked: 0 },
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  // Consents state
  const [consents, setConsents] = useState<Consent[]>([]);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentForm, setConsentForm] = useState({
    encounter_id: '',
    template_id: '',
    consent_status: 'pending' as 'pending' | 'signed',
    signed_by_name: '',
    relationship: '',
    signature_data: '',
  });

  // Forms state
  const [forms, setForms] = useState<Form[]>([]);
  const [showFormModal, setShowFormModal] = useState(false);
  const [formForm, setFormForm] = useState({
    encounter_id: '',
    template_id: '',
    form_data: '{}',
  });

  // Templates state
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    category: 'intake',
    description: '',
    fields_schema: JSON.stringify([
      { key: 'field1', label: 'Field 1', type: 'text', required: true },
    ], null, 2),
  });

  const fetchStats = useCallback(async () => {
    try {
      const data = await trpcQuery('clinicalForms.formStats');
      setStats(data);
    } catch (err: any) {
      console.error('Error fetching stats:', err.message);
    }
  }, []);

  const fetchConsents = useCallback(async () => {
    try {
      const data = await trpcQuery('clinicalForms.listConsents', { page: 1, limit: 50 });
      setConsents(data.items);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const fetchForms = useCallback(async () => {
    try {
      const data = await trpcQuery('clinicalForms.listForms', { page: 1, limit: 50 });
      setForms(data.items);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await trpcQuery('clinicalForms.listFormTemplates', {});
      setTemplates(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchStats(), fetchConsents(), fetchForms(), fetchTemplates()]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchStats, fetchConsents, fetchForms, fetchTemplates]);

  const handleCreateConsent = async () => {
    setError('');
    setSuccess('');
    try {
      if (!consentForm.encounter_id || !consentForm.template_id) {
        throw new Error('Encounter ID and Template ID are required');
      }
      const input: any = {
        encounter_id: consentForm.encounter_id,
        template_id: consentForm.template_id,
        consent_status: consentForm.consent_status,
      };
      if (consentForm.signed_by_name) input.signed_by_name = consentForm.signed_by_name;
      if (consentForm.relationship) input.relationship = consentForm.relationship;
      if (consentForm.signature_data) input.signature_data = consentForm.signature_data;

      await trpcMutate('clinicalForms.createConsent', input);
      setSuccess('Consent created successfully');
      setShowConsentModal(false);
      setConsentForm({
        encounter_id: '',
        template_id: '',
        consent_status: 'pending',
        signed_by_name: '',
        relationship: '',
        signature_data: '',
      });
      await fetchConsents();
      await fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateConsentStatus = async (consentId: string, action: 'sign' | 'refuse' | 'revoke') => {
    setError('');
    setSuccess('');
    try {
      const input: any = { consent_id: consentId, action };
      if (action === 'sign') {
        input.signed_by_name = 'Signed';
        input.relationship = 'self';
      }
      await trpcMutate('clinicalForms.updateConsentStatus', input);
      setSuccess(`Consent ${action}ed successfully`);
      await fetchConsents();
      await fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateForm = async () => {
    setError('');
    setSuccess('');
    try {
      if (!formForm.encounter_id || !formForm.template_id) {
        throw new Error('Encounter ID and Template ID are required');
      }
      let formData: any = {};
      try {
        formData = JSON.parse(formForm.form_data);
      } catch {
        throw new Error('Invalid JSON in form data');
      }

      await trpcMutate('clinicalForms.submitForm', {
        encounter_id: formForm.encounter_id,
        template_id: formForm.template_id,
        form_data: formData,
        form_status: 'submitted',
      });
      setSuccess('Form submitted successfully');
      setShowFormModal(false);
      setFormForm({ encounter_id: '', template_id: '', form_data: '{}' });
      await fetchForms();
      await fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReviewForm = async (formId: string, action: 'review' | 'lock') => {
    setError('');
    setSuccess('');
    try {
      await trpcMutate('clinicalForms.reviewForm', {
        form_id: formId,
        action,
      });
      setSuccess(`Form ${action === 'review' ? 'reviewed' : 'locked'} successfully`);
      await fetchForms();
      await fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateTemplate = async () => {
    setError('');
    setSuccess('');
    try {
      if (!templateForm.name || !templateForm.category) {
        throw new Error('Name and Category are required');
      }
      let fieldsSchema: any[] = [];
      try {
        fieldsSchema = JSON.parse(templateForm.fields_schema);
        if (!Array.isArray(fieldsSchema) || fieldsSchema.length === 0) {
          throw new Error('Fields schema must be a non-empty array');
        }
      } catch (e) {
        throw new Error('Invalid JSON in fields schema');
      }

      await trpcMutate('clinicalForms.createFormTemplate', {
        name: templateForm.name,
        category: templateForm.category,
        description: templateForm.description || undefined,
        fields_schema: fieldsSchema,
      });
      setSuccess('Template created successfully');
      setShowTemplateModal(false);
      setTemplateForm({
        name: '',
        category: 'intake',
        description: '',
        fields_schema: JSON.stringify([
          { key: 'field1', label: 'Field 1', type: 'text', required: true },
        ], null, 2),
      });
      await fetchTemplates();
      await fetchStats();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div
      style={{
        backgroundColor: COLORS.card,
        borderLeft: `4px solid ${color}`,
        padding: '16px',
        borderRadius: '8px',
        flex: '1',
      }}
    >
      <p style={{ fontSize: '12px', color: COLORS.text, opacity: 0.7, marginBottom: '8px' }}>{label}</p>
      <p style={{ fontSize: '28px', fontWeight: 'bold', color: color }}>{value}</p>
    </div>
  );

  const Badge = ({ text, variant }: { text: string; variant: 'pending' | 'signed' | 'refused' | 'revoked' | 'draft' | 'submitted' | 'reviewed' | 'locked' }) => {
    const colors: any = {
      pending: { bg: '#ff9800', fg: '#000' },
      signed: { bg: '#4caf50', fg: '#fff' },
      refused: { bg: '#f44336', fg: '#fff' },
      revoked: { bg: '#9e9e9e', fg: '#fff' },
      draft: { bg: '#2196f3', fg: '#fff' },
      submitted: { bg: '#ff9800', fg: '#000' },
      reviewed: { bg: '#4caf50', fg: '#fff' },
      locked: { bg: '#9e9e9e', fg: '#fff' },
    };
    return (
      <span
        style={{
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: '600',
          backgroundColor: colors[variant].bg,
          color: colors[variant].fg,
        }}
      >
        {text}
      </span>
    );
  };

  return (
    <div style={{ backgroundColor: COLORS.bg, minHeight: '100vh', color: COLORS.text }}>
      {/* Header */}
      <header
        style={{
          backgroundColor: COLORS.accent,
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${COLORS.card}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a
            href="/dashboard"
            style={{
              color: COLORS.text,
              opacity: 0.7,
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            ← Dashboard
          </a>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>Consents & Forms</h1>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Alerts */}
        {error && (
          <div
            style={{
              marginBottom: '16px',
              padding: '12px 16px',
              backgroundColor: COLORS.error,
              borderRadius: '8px',
              fontSize: '14px',
            }}
          >
            {error}
            <button
              onClick={() => setError('')}
              style={{
                marginLeft: '12px',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              dismiss
            </button>
          </div>
        )}
        {success && (
          <div
            style={{
              marginBottom: '16px',
              padding: '12px 16px',
              backgroundColor: COLORS.success,
              borderRadius: '8px',
              fontSize: '14px',
              color: '#000',
            }}
          >
            {success}
            <button
              onClick={() => setSuccess('')}
              style={{
                marginLeft: '12px',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              dismiss
            </button>
          </div>
        )}

        {/* Stats */}
        {!loading && (
          <>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', opacity: 0.7 }}>CONSENTS</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <StatCard label="Pending" value={stats.consents.pending} color={COLORS.warning} />
                <StatCard label="Signed" value={stats.consents.signed} color={COLORS.success} />
                <StatCard label="Refused" value={stats.consents.refused} color={COLORS.error} />
                <StatCard label="Revoked" value={stats.consents.revoked} color="#9e9e9e" />
              </div>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', opacity: 0.7 }}>FORMS</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <StatCard label="Draft" value={stats.forms.draft} color={COLORS.info} />
                <StatCard label="Submitted" value={stats.forms.submitted} color={COLORS.warning} />
                <StatCard label="Reviewed" value={stats.forms.reviewed} color={COLORS.success} />
                <StatCard label="Locked" value={stats.forms.locked} color="#9e9e9e" />
              </div>
            </div>
          </>
        )}

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '24px',
            borderBottom: `1px solid ${COLORS.card}`,
          }}
        >
          {(['consents', 'forms', 'templates'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 16px',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? `2px solid ${COLORS.accent}` : 'none',
                color: activeTab === tab ? COLORS.text : COLORS.text,
                opacity: activeTab === tab ? 1 : 0.6,
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activeTab === tab ? '600' : '400',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* CONSENTS TAB */}
        {activeTab === 'consents' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={() => setShowConsentModal(true)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: COLORS.accent,
                  border: 'none',
                  borderRadius: '6px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                + Create Consent
              </button>
            </div>

            <div
              style={{
                backgroundColor: COLORS.card,
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.bg}` }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Template</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Status</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Signed By</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Signed At</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', opacity: 0.7 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                          Loading...
                        </td>
                      </tr>
                    ) : consents.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                          No consents found
                        </td>
                      </tr>
                    ) : (
                      consents.map((consent) => (
                        <tr key={consent.id} style={{ borderTop: `1px solid ${COLORS.bg}` }}>
                          <td style={{ padding: '12px 16px' }}>{consent.template_name}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <Badge text={consent.consent_status} variant={consent.consent_status} />
                          </td>
                          <td style={{ padding: '12px 16px' }}>{consent.signed_by_name || '-'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', opacity: 0.7 }}>
                            {consent.signed_at ? new Date(consent.signed_at).toLocaleDateString() : '-'}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {consent.consent_status === 'pending' && (
                              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                <button
                                  onClick={() => handleUpdateConsentStatus(consent.id, 'sign')}
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    backgroundColor: COLORS.success,
                                    color: '#000',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Sign
                                </button>
                                <button
                                  onClick={() => handleUpdateConsentStatus(consent.id, 'refuse')}
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    backgroundColor: COLORS.error,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Refuse
                                </button>
                              </div>
                            )}
                            {consent.consent_status === 'signed' && (
                              <button
                                onClick={() => handleUpdateConsentStatus(consent.id, 'revoke')}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '12px',
                                  backgroundColor: '#9e9e9e',
                                  color: '#000',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* FORMS TAB */}
        {activeTab === 'forms' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={() => setShowFormModal(true)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: COLORS.accent,
                  border: 'none',
                  borderRadius: '6px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                + Submit Form
              </button>
            </div>

            <div
              style={{
                backgroundColor: COLORS.card,
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.bg}` }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Template</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Status</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Submitted At</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Reviewed At</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', opacity: 0.7 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                          Loading...
                        </td>
                      </tr>
                    ) : forms.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                          No forms found
                        </td>
                      </tr>
                    ) : (
                      forms.map((form) => (
                        <tr key={form.id} style={{ borderTop: `1px solid ${COLORS.bg}` }}>
                          <td style={{ padding: '12px 16px' }}>{form.template_name}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <Badge text={form.form_status} variant={form.form_status} />
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', opacity: 0.7 }}>
                            {form.submitted_at ? new Date(form.submitted_at).toLocaleDateString() : '-'}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', opacity: 0.7 }}>
                            {form.reviewed_at ? new Date(form.reviewed_at).toLocaleDateString() : '-'}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {form.form_status === 'submitted' && (
                              <button
                                onClick={() => handleReviewForm(form.id, 'review')}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '12px',
                                  backgroundColor: COLORS.success,
                                  color: '#000',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  marginRight: '8px',
                                }}
                              >
                                Review
                              </button>
                            )}
                            {(form.form_status === 'submitted' || form.form_status === 'reviewed') && (
                              <button
                                onClick={() => handleReviewForm(form.id, 'lock')}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '12px',
                                  backgroundColor: '#9e9e9e',
                                  color: '#000',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                }}
                              >
                                Lock
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={() => setShowTemplateModal(true)}
                style={{
                  padding: '10px 16px',
                  backgroundColor: COLORS.accent,
                  border: 'none',
                  borderRadius: '6px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                + Create Template
              </button>
            </div>

            <div
              style={{
                backgroundColor: COLORS.card,
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.bg}` }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Name</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Category</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Version</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Status</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', opacity: 0.7 }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                          Loading...
                        </td>
                      </tr>
                    ) : templates.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                          No templates found
                        </td>
                      </tr>
                    ) : (
                      templates.map((template) => (
                        <tr key={template.id} style={{ borderTop: `1px solid ${COLORS.bg}` }}>
                          <td style={{ padding: '12px 16px' }}>{template.name}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ padding: '4px 8px', backgroundColor: COLORS.accent, borderRadius: '4px', fontSize: '12px' }}>
                              {template.category}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>v{template.version}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <Badge
                              text={template.status}
                              variant={template.status === 'active' ? 'signed' : template.status === 'draft' ? 'draft' : 'revoked'}
                            />
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', opacity: 0.7 }}>
                            {new Date(template.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* CONSENT MODAL */}
      {showConsentModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowConsentModal(false)}
        >
          <div
            style={{
              backgroundColor: COLORS.card,
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '100%',
              margin: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Create Consent</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Encounter ID *</label>
                <input
                  type="text"
                  value={consentForm.encounter_id}
                  onChange={(e) => setConsentForm({ ...consentForm, encounter_id: e.target.value })}
                  placeholder="UUID"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Template ID *</label>
                <input
                  type="text"
                  value={consentForm.template_id}
                  onChange={(e) => setConsentForm({ ...consentForm, template_id: e.target.value })}
                  placeholder="UUID"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Status</label>
                <select
                  value={consentForm.consent_status}
                  onChange={(e) => setConsentForm({ ...consentForm, consent_status: e.target.value as 'pending' | 'signed' })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="signed">Signed</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Signed By Name</label>
                <input
                  type="text"
                  value={consentForm.signed_by_name}
                  onChange={(e) => setConsentForm({ ...consentForm, signed_by_name: e.target.value })}
                  placeholder="Full name"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Relationship</label>
                <input
                  type="text"
                  value={consentForm.relationship}
                  onChange={(e) => setConsentForm({ ...consentForm, relationship: e.target.value })}
                  placeholder="self/parent/spouse/guardian"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Signature Data</label>
                <textarea
                  value={consentForm.signature_data}
                  onChange={(e) => setConsentForm({ ...consentForm, signature_data: e.target.value })}
                  placeholder="Base64 or verbal"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConsentModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: COLORS.bg,
                  border: `1px solid ${COLORS.accent}`,
                  borderRadius: '4px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateConsent}
                style={{
                  padding: '8px 16px',
                  backgroundColor: COLORS.accent,
                  border: 'none',
                  borderRadius: '4px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FORM MODAL */}
      {showFormModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowFormModal(false)}
        >
          <div
            style={{
              backgroundColor: COLORS.card,
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '100%',
              margin: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Submit Form</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Encounter ID *</label>
                <input
                  type="text"
                  value={formForm.encounter_id}
                  onChange={(e) => setFormForm({ ...formForm, encounter_id: e.target.value })}
                  placeholder="UUID"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Template ID *</label>
                <input
                  type="text"
                  value={formForm.template_id}
                  onChange={(e) => setFormForm({ ...formForm, template_id: e.target.value })}
                  placeholder="UUID"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Form Data (JSON)</label>
                <textarea
                  value={formForm.form_data}
                  onChange={(e) => setFormForm({ ...formForm, form_data: e.target.value })}
                  placeholder='{"field_key": "value"}'
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowFormModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: COLORS.bg,
                  border: `1px solid ${COLORS.accent}`,
                  borderRadius: '4px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateForm}
                style={{
                  padding: '8px 16px',
                  backgroundColor: COLORS.accent,
                  border: 'none',
                  borderRadius: '4px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEMPLATE MODAL */}
      {showTemplateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowTemplateModal(false)}
        >
          <div
            style={{
              backgroundColor: COLORS.card,
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '100%',
              margin: '16px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Create Template</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Name *</label>
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                  placeholder="Template name"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Category</label>
                <select
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                >
                  <option value="intake">Intake</option>
                  <option value="assessment">Assessment</option>
                  <option value="screening">Screening</option>
                  <option value="discharge">Discharge</option>
                  <option value="followup">Followup</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Description</label>
                <input
                  type="text"
                  value={templateForm.description}
                  onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                  placeholder="Optional description"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Fields Schema (JSON) *</label>
                <textarea
                  value={templateForm.fields_schema}
                  onChange={(e) => setTemplateForm({ ...templateForm, fields_schema: e.target.value })}
                  placeholder='[{"key": "field1", "label": "Field 1", "type": "text", "required": true}]'
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.accent}`,
                    borderRadius: '4px',
                    color: COLORS.text,
                    fontSize: '12px',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              <p style={{ fontSize: '11px', opacity: 0.6, margin: 0 }}>
                Each field: key, label, type (text/textarea/number/date/select/radio/checkbox/email/phone), required (boolean), options (array for select/radio/checkbox)
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowTemplateModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: COLORS.bg,
                  border: `1px solid ${COLORS.accent}`,
                  borderRadius: '4px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTemplate}
                style={{
                  padding: '8px 16px',
                  backgroundColor: COLORS.accent,
                  border: 'none',
                  borderRadius: '4px',
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
