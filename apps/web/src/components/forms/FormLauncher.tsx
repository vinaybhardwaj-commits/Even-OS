'use client';

/**
 * FormLauncher — SC.5
 *
 * Reusable button that opens a form modal from any HIS page (without chat context).
 * Can be used standalone or as part of a button group.
 *
 * Usage:
 *   <FormLauncher slug="vitals" label="Log Vitals" icon="📊" patientId="..." encounterId="..." />
 *   <FormLauncher formDefinitionId="uuid" label="Custom Form" />
 */

import React, { useState, useCallback } from 'react';

// tRPC helpers
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
  if (json.error) throw new Error(json.error?.message || 'Submission failed');
  return json.result?.data?.json;
}

interface FormLauncherProps {
  /** Form slug (e.g., 'vitals', 'discharge') — used to look up form def */
  slug?: string;
  /** Direct form definition ID (alternative to slug) */
  formDefinitionId?: string;
  /** Button label */
  label: string;
  /** Button icon (emoji) */
  icon?: string;
  /** Patient context */
  patientId?: string;
  encounterId?: string;
  /** Visual style */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  /** Full width */
  fullWidth?: boolean;
  /** Callback after successful submission */
  onSubmitted?: (submissionId: string) => void;
}

// FormRenderer inline (lightweight version for non-chat context)
function InlineFormRenderer({
  definition,
  onSubmit,
  readOnly,
}: {
  definition: any;
  onSubmit: (data: Record<string, any>) => void;
  readOnly: boolean;
}) {
  const [formData, setFormData] = React.useState<Record<string, any>>({});

  const handleFieldChange = (fieldId: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {(definition.sections || []).map((section: any) => (
        <div key={section.id} style={{ marginBottom: '20px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#333', marginBottom: '12px', borderBottom: '1px solid #eee', paddingBottom: '6px' }}>
            {section.title}
          </h4>
          {(section.fields || []).map((field: any) => {
            if (field.type === 'section_header') {
              return (
                <div key={field.id} style={{ fontSize: '13px', fontWeight: 600, color: '#666', margin: '12px 0 8px' }}>
                  {field.label}
                </div>
              );
            }
            return (
              <div key={field.id} style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#444', marginBottom: '4px' }}>
                  {field.label}
                  {field.required && <span style={{ color: '#ef5350', marginLeft: '2px' }}>*</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={formData[field.id] || ''}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    placeholder={field.placeholder}
                    disabled={readOnly}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd',
                      fontSize: '14px', minHeight: '80px', resize: 'vertical',
                    }}
                  />
                ) : field.type === 'dropdown' || field.type === 'radio' ? (
                  <select
                    value={formData[field.id] || ''}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    disabled={readOnly}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd',
                      fontSize: '14px', background: '#fff',
                    }}
                  >
                    <option value="">Select...</option>
                    {(field.options || []).map((opt: any) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : field.type === 'toggle' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!formData[field.id]}
                      onChange={(e) => handleFieldChange(field.id, e.target.checked)}
                      disabled={readOnly}
                    />
                    <span style={{ fontSize: '13px', color: '#666' }}>{field.description || 'Yes'}</span>
                  </label>
                ) : field.type === 'number' || field.type === 'currency' ? (
                  <input
                    type="number"
                    value={formData[field.id] || ''}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    placeholder={field.placeholder}
                    disabled={readOnly}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd',
                      fontSize: '14px',
                    }}
                  />
                ) : field.type === 'date' ? (
                  <input
                    type="date"
                    value={formData[field.id] || ''}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    disabled={readOnly}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd',
                      fontSize: '14px',
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={formData[field.id] || ''}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    placeholder={field.placeholder}
                    disabled={readOnly}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd',
                      fontSize: '14px',
                    }}
                  />
                )}
                {field.description && field.type !== 'toggle' && (
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{field.description}</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <button
        type="submit"
        disabled={readOnly}
        style={{
          width: '100%', padding: '12px', borderRadius: '8px', border: 'none',
          background: '#1976d2', color: '#fff', fontSize: '15px', fontWeight: 600,
          cursor: readOnly ? 'not-allowed' : 'pointer', opacity: readOnly ? 0.6 : 1,
        }}
      >
        Submit
      </button>
    </form>
  );
}

export const FormLauncher: React.FC<FormLauncherProps> = ({
  slug,
  formDefinitionId,
  label,
  icon,
  patientId,
  encounterId,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  onSubmitted,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formDef, setFormDef] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load form definition
  const openForm = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let def: any = null;
      if (formDefinitionId) {
        def = await trpcQuery('forms.getDefinition', { id: formDefinitionId });
      } else if (slug) {
        def = await trpcQuery('forms.getDefinition', { slug });
      }

      if (!def) {
        setError('Form not found');
        return;
      }

      setFormDef(def);
      setIsOpen(true);
    } catch (err) {
      setError('Failed to load form');
    } finally {
      setLoading(false);
    }
  }, [slug, formDefinitionId]);

  // Submit form
  const handleSubmit = useCallback(async (formData: Record<string, any>) => {
    if (!formDef) return;
    try {
      setSubmitting(true);
      setError(null);

      const result = await trpcMutate('forms.submit', {
        form_definition_id: formDef.id,
        patient_id: patientId || undefined,
        encounter_id: encounterId || undefined,
        form_data: formData,
      });

      setSuccess(true);
      onSubmitted?.(result?.submission_id || result?.id);

      // Auto-close after 1.5s
      setTimeout(() => {
        setIsOpen(false);
        setSuccess(false);
        setFormDef(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [formDef, patientId, encounterId, onSubmitted]);

  // Button styles
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    borderRadius: '8px', cursor: 'pointer', fontWeight: 500,
    transition: 'all 0.15s', width: fullWidth ? '100%' : undefined,
    justifyContent: fullWidth ? 'center' : undefined,
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '6px 12px', fontSize: '12px' },
    md: { padding: '8px 16px', fontSize: '13px' },
    lg: { padding: '10px 20px', fontSize: '14px' },
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: { background: '#1976d2', color: '#fff', border: 'none' },
    secondary: { background: '#f5f5f5', color: '#333', border: '1px solid #ddd' },
    outline: { background: 'transparent', color: '#1976d2', border: '1px solid #1976d2' },
    ghost: { background: 'transparent', color: '#1976d2', border: 'none' },
  };

  return (
    <React.Fragment>
      <button
        onClick={openForm}
        disabled={loading}
        style={{ ...baseStyle, ...sizeStyles[size], ...variantStyles[variant] }}
      >
        {loading ? (
          <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        ) : icon ? (
          <span>{icon}</span>
        ) : null}
        {label}
      </button>

      {/* Modal overlay */}
      {isOpen && formDef && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '16px',
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            maxWidth: '600px', width: '100%', maxHeight: '90vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexShrink: 0,
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{formDef.name}</h3>
                {formDef.description && (
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#666' }}>{formDef.description}</p>
                )}
              </div>
              <button
                onClick={() => { setIsOpen(false); setFormDef(null); setError(null); setSuccess(false); }}
                disabled={submitting}
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#999', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              {success ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#10003;</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#2e7d32' }}>Submitted successfully</div>
                </div>
              ) : (
                <InlineFormRenderer
                  definition={formDef}
                  onSubmit={handleSubmit}
                  readOnly={submitting}
                />
              )}

              {submitting && (
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#666', fontSize: '13px' }}>
                  <div style={{ width: '14px', height: '14px', border: '2px solid #ccc', borderTopColor: '#1976d2', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                  Submitting...
                </div>
              )}

              {error && (
                <div style={{ marginTop: '12px', padding: '10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', color: '#dc2626' }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
};

export default FormLauncher;
