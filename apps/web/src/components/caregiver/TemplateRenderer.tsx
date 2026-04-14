'use client';

import { useState, useEffect, useCallback } from 'react';

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: input }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

interface TemplateField {
  id: string; type: string; label: string; order: number;
  required?: boolean; placeholder?: string; options?: string[];
  auto_populate_from?: string; ai_hint?: string; default_value?: any;
}

interface TemplateRendererProps {
  template: any;
  patientId?: string;
  encounterId?: string;
  onSubmit: (data: Record<string, any>) => void;
  onCancel: () => void;
}

export default function TemplateRenderer({ template, patientId, encounterId, onSubmit, onCancel }: TemplateRendererProps) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [autoPopulated, setAutoPopulated] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFieldIds, setAiFieldIds] = useState<Set<string>>(new Set());
  const [startTime] = useState(Date.now());

  const fields: TemplateField[] = template?.template_fields || template?.fields || [];

  // Auto-populate fields from patient context
  useEffect(() => {
    if (!patientId || !encounterId) return;
    (async () => {
      try {
        const ctx = await trpcQuery('doctorDashboard.patientContext', { patient_id: patientId, encounter_id: encounterId });
        if (!ctx) return;
        const populated: Record<string, any> = {};
        const popKeys = new Set<string>();
        for (const f of fields) {
          if (!f.auto_populate_from) continue;
          const val = resolveAutoPopulate(f.auto_populate_from, ctx);
          if (val !== undefined && val !== null && val !== '') {
            populated[f.id] = val;
            popKeys.add(f.id);
          }
        }
        setValues(prev => ({ ...prev, ...populated }));
        setAutoPopulated(popKeys);
      } catch { /* ignore */ }
    })();
  }, [patientId, encounterId]);

  // AI Smart Defaults — fill free-text fields with AI-generated content
  const handleAiFill = async () => {
    if (!patientId || !encounterId) return;
    setAiLoading(true);
    try {
      const aiFields = fields.filter(f => (f.type === 'textarea' || f.type === 'text') && f.ai_hint);
      if (aiFields.length === 0) { setAiLoading(false); return; }

      const result = await trpcMutate('templateManagement.aiSmartDefaults', {
        fields: aiFields.map(f => ({ id: f.id, type: f.type, label: f.label, ai_hint: f.ai_hint })),
        patient_id: patientId,
        encounter_id: encounterId,
      });

      if (result?.defaults) {
        const newAiIds = new Set<string>();
        setValues(prev => {
          const next = { ...prev };
          for (const [fid, val] of Object.entries(result.defaults)) {
            if (val && !prev[fid]) { // only fill if not already manually entered
              next[fid] = val;
              newAiIds.add(fid);
            }
          }
          return next;
        });
        setAiFieldIds(newAiIds);
      }
    } catch (err) {
      console.error('AI smart defaults error:', err);
    } finally {
      setAiLoading(false);
    }
  };

  const setValue = (fieldId: string, value: any) => {
    setValues(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async () => {
    // Check required fields
    for (const f of fields) {
      if (f.required && !values[f.id] && f.type !== 'section_header' && f.type !== 'divider') {
        alert(`"${f.label}" is required.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const modified = Object.keys(values).filter(k => !autoPopulated.has(k));
      const skipped = fields.filter(f => !f.required && !values[f.id] && f.type !== 'section_header' && f.type !== 'divider').map(f => f.id);

      // Log usage
      await trpcMutate('templateManagement.logUsage', {
        template_id: template.id,
        template_version: template.template_version || 1,
        patient_id: patientId,
        encounter_id: encounterId,
        filled_data: values,
        completion_time_seconds: elapsed,
        fields_modified: modified,
        fields_skipped: skipped,
      });

      onSubmit(values);
    } catch (err) {
      console.error('Template submit error:', err);
      onSubmit(values); // still pass data even if logging fails
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '12px 0', borderBottom: '1px solid #e0e0e0' }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{template.template_name || 'Template'}</h3>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>v{template.template_version || 1} · {fields.length} fields</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ padding: '6px 14px', fontSize: 13, background: '#e0e0e0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          {patientId && encounterId && (
            <button onClick={handleAiFill} disabled={aiLoading} style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 600,
              background: aiLoading ? '#ccc' : '#f3e5f5', color: aiLoading ? '#888' : '#7b1fa2',
              border: '1px solid #ce93d8', borderRadius: 6, cursor: 'pointer',
            }}>{aiLoading ? '🤖 Filling…' : '🤖 AI Fill'}</button>
          )}
          <button onClick={handleSubmit} disabled={submitting} style={{
            padding: '6px 18px', fontSize: 13, fontWeight: 600, background: submitting ? '#ccc' : '#1565c0',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
          }}>{submitting ? 'Saving…' : '💾 Submit'}</button>
        </div>
      </div>

      {fields.map(f => (
        <div key={f.id} style={{ marginBottom: 14 }}>
          {f.type === 'section_header' ? (
            <h3 style={{ fontSize: 15, fontWeight: 700, borderBottom: '2px solid #1565c0', paddingBottom: 4, color: '#1565c0', marginTop: 8 }}>{f.label}</h3>
          ) : f.type === 'divider' ? (
            <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '8px 0' }} />
          ) : (
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 }}>
                {f.label} {f.required && <span style={{ color: '#c62828' }}>*</span>}
                {autoPopulated.has(f.id) && <span style={{ fontSize: 10, color: '#1565c0', marginLeft: 6, fontWeight: 400 }}>🔄 auto-filled</span>}
                {aiFieldIds.has(f.id) && <span style={{ fontSize: 10, color: '#7b1fa2', marginLeft: 6, fontWeight: 400 }}>🤖 AI-generated</span>}
              </label>
              {renderFieldInput(f, values[f.id], (v) => setValue(f.id, v))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function renderFieldInput(f: TemplateField, value: any, onChange: (v: any) => void) {
  const baseStyle: React.CSSProperties = { width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6, fontFamily: 'system-ui' };

  switch (f.type) {
    case 'text':
    case 'numeric':
    case 'date':
    case 'time':
    case 'datetime':
      return <input type={f.type === 'numeric' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'datetime' ? 'datetime-local' : 'text'}
        value={value || ''} onChange={e => onChange(e.target.value)} placeholder={f.placeholder || ''} style={baseStyle} />;

    case 'textarea':
      return <textarea value={value || ''} onChange={e => onChange(e.target.value)} placeholder={f.placeholder || ''}
        rows={3} style={{ ...baseStyle, resize: 'vertical' }} />;

    case 'checkbox':
      return <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18 }} /> {f.label}
      </label>;

    case 'dropdown':
      return <select value={value || ''} onChange={e => onChange(e.target.value)} style={baseStyle}>
        <option value="">Select…</option>
        {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>;

    case 'checkbox_group':
      return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {(f.options || []).map(o => (
          <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <input type="checkbox" checked={(value || []).includes(o)}
              onChange={e => {
                const arr = value || [];
                onChange(e.target.checked ? [...arr, o] : arr.filter((v: string) => v !== o));
              }} /> {o}
          </label>
        ))}
      </div>;

    case 'signature':
      return <div style={{ width: '100%', height: 60, border: '1px dashed #90caf9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: value ? '#e8f5e9' : '#f5f9ff', color: value ? '#2e7d32' : '#90caf9', fontSize: 13 }}
        onClick={() => onChange(value ? null : `Signed at ${new Date().toISOString()}`)}>
        {value ? '✅ Signed' : '✍️ Tap to sign'}
      </div>;

    case 'medication_list':
    case 'vitals_grid':
    case 'icd_picker':
    case 'procedure_picker':
    case 'drug_picker':
    case 'patient_data_auto':
      return <div style={{ padding: 10, border: '1px solid #e0e0e0', borderRadius: 6, background: '#fafafa', fontSize: 13 }}>
        {typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value, null, 2) : `${f.type} — data will be auto-populated`}
      </div>;

    default:
      return <input value={value || ''} onChange={e => onChange(e.target.value)} style={baseStyle} />;
  }
}

function resolveAutoPopulate(source: string, ctx: any): any {
  if (!ctx) return undefined;
  switch (source) {
    case 'patient.name': return ctx.vitals?.[0]?.patient_name || '';
    case 'patient.allergies': return (ctx.allergies || []).map((a: any) => a.substance).join(', ');
    case 'vitals.latest': {
      const v = ctx.vitals || [];
      return v.map((vi: any) => `${vi.observation_type?.replace('vital_', '')}: ${vi.value_quantity || vi.value_text}${vi.unit ? ' ' + vi.unit : ''}`).join(', ');
    }
    case 'labs.recent': {
      const l = ctx.labs || [];
      return l.slice(0, 5).map((li: any) => `${li.test_code || li.test_name}: ${li.result_value || li.order_status}${li.is_abnormal ? '↑' : ''}`).join(', ');
    }
    case 'meds.active':
    case 'meds.discharge': {
      const m = ctx.activeOrders || [];
      return m.map((mi: any) => `${mi.drug_name} ${mi.dose_quantity || ''}${mi.dose_unit || ''} ${mi.route || ''} ${mi.frequency_code || ''}`).join('\n');
    }
    case 'problems.active': return (ctx.problems || []).map((p: any) => p.code_display || p.condition_name).join(', ');
    case 'encounter.chief_complaint': return ''; // Would need encounter data
    case 'encounter.primary_diagnosis': return '';
    default: return undefined;
  }
}
