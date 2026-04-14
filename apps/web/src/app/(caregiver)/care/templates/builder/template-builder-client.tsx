'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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

// ── Field type palette ──────────────────────────────────────────────────────
const FIELD_TYPES = [
  { type: 'section_header', label: 'Section Header', icon: '📌' },
  { type: 'text', label: 'Short Text', icon: '✏️' },
  { type: 'textarea', label: 'Long Text', icon: '📝' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑️' },
  { type: 'checkbox_group', label: 'Checkbox Group', icon: '☑️' },
  { type: 'dropdown', label: 'Dropdown', icon: '📋' },
  { type: 'numeric', label: 'Number', icon: '🔢' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'time', label: 'Time', icon: '⏰' },
  { type: 'datetime', label: 'Date & Time', icon: '📅' },
  { type: 'signature', label: 'Signature', icon: '✍️' },
  { type: 'medication_list', label: 'Medication List', icon: '💊' },
  { type: 'vitals_grid', label: 'Vitals Grid', icon: '💓' },
  { type: 'icd_picker', label: 'ICD Diagnosis Picker', icon: '🏷️' },
  { type: 'procedure_picker', label: 'Procedure Picker', icon: '🔪' },
  { type: 'drug_picker', label: 'Drug Picker', icon: '💊' },
  { type: 'patient_data_auto', label: 'Auto-Populate Field', icon: '🔄' },
  { type: 'divider', label: 'Divider', icon: '➖' },
];

const CATEGORIES = [
  'discharge', 'operative', 'handoff', 'admission', 'assessment',
  'consent', 'nursing', 'progress', 'consultation', 'referral', 'custom',
];

const AUTO_POPULATE_SOURCES = [
  'patient.name', 'patient.uhid', 'patient.age', 'patient.gender', 'patient.allergies',
  'encounter.chief_complaint', 'encounter.primary_diagnosis', 'encounter.admission_date',
  'encounter.attending_doctor', 'encounter.bed_label', 'encounter.ward_name',
  'vitals.latest', 'vitals.news2', 'labs.recent', 'meds.active', 'meds.discharge',
  'problems.active', 'procedures.performed', 'io.balance_24h', 'notes.last_soap',
];

interface FieldDef {
  id: string; type: string; label: string; order: number;
  required?: boolean; placeholder?: string; options?: string[];
  auto_populate_from?: string; ai_hint?: string;
  default_value?: any;
  conditional_on?: { field_id: string; value: any };
}

interface Props { userId: string; userRole: string; userName: string; }

export default function TemplateBuilderClient({ userId, userRole, userName }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

  // Template metadata
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [scope, setScope] = useState('personal');
  const [fields, setFields] = useState<FieldDef[]>([]);

  // UI state
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [loaded, setLoaded] = useState(!editId);

  // Load existing template if editing
  useEffect(() => {
    if (!editId) return;
    (async () => {
      const tpl = await trpcQuery('templateManagement.get', { id: editId });
      if (tpl) {
        setName(tpl.template_name || '');
        setDescription(tpl.template_description || '');
        setCategory(tpl.template_category || 'custom');
        setScope(tpl.template_scope || 'personal');
        setFields(tpl.template_fields || []);
        setIsEdit(true);
      }
      setLoaded(true);
    })();
  }, [editId]);

  // ── Field operations ──────────────────────────────────────────────────
  const addField = (type: string) => {
    const newField: FieldDef = {
      id: crypto.randomUUID(),
      type,
      label: FIELD_TYPES.find(f => f.type === type)?.label || 'New Field',
      order: fields.length + 1,
      required: false,
    };
    setFields([...fields, newField]);
    setSelectedField(newField.id);
  };

  const updateField = (id: string, updates: Partial<FieldDef>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id).map((f, i) => ({ ...f, order: i + 1 })));
    if (selectedField === id) setSelectedField(null);
  };

  const moveField = (id: string, direction: 'up' | 'down') => {
    const idx = fields.findIndex(f => f.id === id);
    if (direction === 'up' && idx > 0) {
      const next = [...fields];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      setFields(next.map((f, i) => ({ ...f, order: i + 1 })));
    } else if (direction === 'down' && idx < fields.length - 1) {
      const next = [...fields];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      setFields(next.map((f, i) => ({ ...f, order: i + 1 })));
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!name.trim()) { alert('Template name is required.'); return; }
    if (fields.length === 0) { alert('Add at least one field.'); return; }
    setSaving(true);
    try {
      if (isEdit && editId) {
        await trpcMutate('templateManagement.update', {
          id: editId, name: name.trim(), description: description.trim(),
          fields, change_summary: 'Updated via template builder',
        });
      } else {
        await trpcMutate('templateManagement.create', {
          name: name.trim(), description: description.trim(),
          category: category as any, scope: scope as any, fields,
        });
      }
      router.push('/care/templates');
    } catch (err) { alert('Failed to save template'); }
    finally { setSaving(false); }
  };

  const selectedFieldData = fields.find(f => f.id === selectedField);

  if (!loaded) return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p>Loading…</p></div>;

  // ── PREVIEW MODE ──────────────────────────────────────────────────────
  if (previewMode) {
    return (
      <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>
        <header style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>👁 Preview: {name}</h1>
          <button onClick={() => setPreviewMode(false)} style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, background: '#e0e0e0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>← Back to Editor</button>
        </header>
        <div style={{ padding: '20px 24px', maxWidth: 700, margin: '0 auto' }}>
          {fields.map(f => (
            <div key={f.id} style={{ marginBottom: 14 }}>
              {f.type === 'section_header' ? (
                <h3 style={{ fontSize: 16, fontWeight: 700, borderBottom: '2px solid #1565c0', paddingBottom: 4, color: '#1565c0' }}>{f.label}</h3>
              ) : f.type === 'divider' ? (
                <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '12px 0' }} />
              ) : (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 }}>
                    {f.label} {f.required && <span style={{ color: '#c62828' }}>*</span>}
                    {f.auto_populate_from && <span style={{ fontSize: 10, color: '#1565c0', marginLeft: 6 }}>🔄 {f.auto_populate_from}</span>}
                  </label>
                  {['text', 'numeric', 'date', 'time', 'datetime'].includes(f.type) && (
                    <input type={f.type === 'numeric' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                      placeholder={f.placeholder || ''} disabled
                      style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6, background: '#fafafa' }} />
                  )}
                  {f.type === 'textarea' && (
                    <textarea rows={3} placeholder={f.placeholder || ''} disabled
                      style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6, background: '#fafafa', fontFamily: 'system-ui' }} />
                  )}
                  {f.type === 'checkbox' && (
                    <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" disabled /> {f.label}
                    </label>
                  )}
                  {f.type === 'dropdown' && (
                    <select disabled style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6, background: '#fafafa' }}>
                      <option>Select…</option>
                      {(f.options || []).map(o => <option key={o}>{o}</option>)}
                    </select>
                  )}
                  {f.type === 'checkbox_group' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(f.options || []).map(o => (
                        <label key={o} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="checkbox" disabled /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.type === 'signature' && (
                    <div style={{ width: '100%', height: 60, border: '1px dashed #ccc', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 13 }}>✍️ Signature field</div>
                  )}
                  {['medication_list', 'vitals_grid', 'icd_picker', 'procedure_picker', 'drug_picker', 'patient_data_auto'].includes(f.type) && (
                    <div style={{ padding: 12, border: '1px dashed #90caf9', borderRadius: 6, background: '#f5f9ff', color: '#1565c0', fontSize: 12 }}>
                      {f.type === 'medication_list' && '💊 Medication list (auto-populated from patient orders)'}
                      {f.type === 'vitals_grid' && '💓 Vitals grid (auto-populated from latest vitals)'}
                      {f.type === 'icd_picker' && '🏷️ ICD-10 diagnosis search picker'}
                      {f.type === 'procedure_picker' && '🔪 Procedure search picker'}
                      {f.type === 'drug_picker' && '💊 Drug search picker'}
                      {f.type === 'patient_data_auto' && `🔄 Auto: ${f.auto_populate_from || 'not configured'}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── EDITOR MODE ───────────────────────────────────────────────────────
  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/care/templates')} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer' }}>←</button>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>🔨 {isEdit ? 'Edit' : 'Build'} Template</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setPreviewMode(true)} style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, background: '#e3f2fd', color: '#1565c0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>👁 Preview</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '6px 20px', fontSize: 13, fontWeight: 600, background: saving ? '#ccc' : '#1565c0', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
          }}>{saving ? 'Saving…' : '💾 Save'}</button>
        </div>
      </header>

      {/* 3-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 280px', height: 'calc(100vh - 56px)' }}>

        {/* LEFT: Field palette */}
        <div style={{ background: '#fff', borderRight: '1px solid #e0e0e0', padding: 12, overflow: 'auto' }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8 }}>ADD FIELD</h3>
          {FIELD_TYPES.map(ft => (
            <button key={ft.type} onClick={() => addField(ft.type)} style={{
              display: 'flex', gap: 8, alignItems: 'center', width: '100%',
              padding: '6px 8px', marginBottom: 2, fontSize: 12,
              background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, cursor: 'pointer',
              textAlign: 'left',
            }}>
              <span style={{ fontSize: 14 }}>{ft.icon}</span>
              <span>{ft.label}</span>
            </button>
          ))}
        </div>

        {/* CENTER: Template canvas */}
        <div style={{ padding: 16, overflow: 'auto' }}>
          {/* Metadata */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name"
                  style={{ width: '100%', padding: 8, fontSize: 14, border: '1px solid #d0d0d0', borderRadius: 6 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Scope</label>
                  <select value={scope} onChange={e => setScope(e.target.value)}
                    style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }}>
                    <option value="personal">🔒 Personal</option>
                    <option value="department">🏥 Department</option>
                    <option value="system">🌐 System</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description…"
                style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid #d0d0d0', borderRadius: 6 }} />
            </div>
          </div>

          {/* Fields list */}
          {fields.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
              <p style={{ fontSize: 36 }}>👈</p>
              <p style={{ fontWeight: 600 }}>Add fields from the palette</p>
              <p style={{ fontSize: 13 }}>Click any field type on the left to start building your template.</p>
            </div>
          ) : (
            fields.map((f, i) => (
              <div key={f.id} onClick={() => setSelectedField(f.id)} style={{
                background: selectedField === f.id ? '#e3f2fd' : '#fff',
                border: `1px solid ${selectedField === f.id ? '#90caf9' : '#e0e0e0'}`,
                borderRadius: 8, padding: '8px 12px', marginBottom: 4,
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              }}>
                <span style={{ fontSize: 14, color: '#999' }}>{i + 1}</span>
                <span style={{ fontSize: 14 }}>{FIELD_TYPES.find(ft => ft.type === f.type)?.icon || '📋'}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
                  {f.required && <span style={{ color: '#c62828', marginLeft: 4, fontSize: 11 }}>required</span>}
                  {f.auto_populate_from && <span style={{ color: '#1565c0', marginLeft: 4, fontSize: 10 }}>🔄 {f.auto_populate_from}</span>}
                </div>
                <span style={{ fontSize: 11, color: '#999' }}>{f.type}</span>
                <button onClick={(e) => { e.stopPropagation(); moveField(f.id, 'up'); }} style={iconBtn}>↑</button>
                <button onClick={(e) => { e.stopPropagation(); moveField(f.id, 'down'); }} style={iconBtn}>↓</button>
                <button onClick={(e) => { e.stopPropagation(); removeField(f.id); }} style={{ ...iconBtn, color: '#c62828' }}>✕</button>
              </div>
            ))
          )}
        </div>

        {/* RIGHT: Field properties */}
        <div style={{ background: '#fff', borderLeft: '1px solid #e0e0e0', padding: 12, overflow: 'auto' }}>
          {!selectedFieldData ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
              <p style={{ fontSize: 13 }}>Select a field to edit its properties</p>
            </div>
          ) : (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Field Properties</h3>

              <label style={propLabel}>Label</label>
              <input value={selectedFieldData.label} onChange={e => updateField(selectedFieldData.id, { label: e.target.value })}
                style={propInput} />

              <label style={propLabel}>Type</label>
              <select value={selectedFieldData.type} onChange={e => updateField(selectedFieldData.id, { type: e.target.value })}
                style={propInput}>
                {FIELD_TYPES.map(ft => <option key={ft.type} value={ft.type}>{ft.icon} {ft.label}</option>)}
              </select>

              <label style={{ ...propLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={selectedFieldData.required || false}
                  onChange={e => updateField(selectedFieldData.id, { required: e.target.checked })} />
                Required
              </label>

              <label style={propLabel}>Placeholder</label>
              <input value={selectedFieldData.placeholder || ''} onChange={e => updateField(selectedFieldData.id, { placeholder: e.target.value })}
                placeholder="Placeholder text…" style={propInput} />

              {(selectedFieldData.type === 'dropdown' || selectedFieldData.type === 'checkbox_group') && (
                <>
                  <label style={propLabel}>Options (one per line)</label>
                  <textarea value={(selectedFieldData.options || []).join('\n')}
                    onChange={e => updateField(selectedFieldData.id, { options: e.target.value.split('\n').filter(Boolean) })}
                    rows={4} style={{ ...propInput, fontFamily: 'system-ui', resize: 'vertical' }} />
                </>
              )}

              {(selectedFieldData.type === 'patient_data_auto' || selectedFieldData.type === 'vitals_grid' || selectedFieldData.type === 'medication_list') && (
                <>
                  <label style={propLabel}>Auto-populate from</label>
                  <select value={selectedFieldData.auto_populate_from || ''}
                    onChange={e => updateField(selectedFieldData.id, { auto_populate_from: e.target.value })}
                    style={propInput}>
                    <option value="">Select data source…</option>
                    {AUTO_POPULATE_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </>
              )}

              <label style={propLabel}>AI Hint</label>
              <input value={selectedFieldData.ai_hint || ''} onChange={e => updateField(selectedFieldData.id, { ai_hint: e.target.value })}
                placeholder="Hint for AI auto-fill…" style={propInput} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const propLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginTop: 10, marginBottom: 3 };
const propInput: React.CSSProperties = { width: '100%', padding: 6, fontSize: 12, border: '1px solid #d0d0d0', borderRadius: 4 };
const iconBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: '2px 4px', color: '#888' };
