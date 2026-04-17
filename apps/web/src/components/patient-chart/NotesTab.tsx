'use client';

/**
 * NotesTab — Notes v2 (Sprint N.3)
 *
 * Replaces the legacy inline NotesTab. Two stacked regions:
 *   1. EDITOR   — note-type dropdown → template picker → adaptive labeled
 *                 textareas → draft autosave (2s debounce; server primary,
 *                 localStorage fallback) → submit to the matching
 *                 clinicalNotes.createXxx endpoint → clearDraft.
 *   2. TIMELINE — filter by type/author/date + keyword search +
 *                 pagination; click a row to expand the full note body in
 *                 an inline drawer.
 *
 * Data wiring:
 *   - templateManagement.list({ category })     — template picker
 *   - noteDrafts.getDraft / saveDraft / clear  — autosave
 *   - clinicalNotes.listNotes                  — timeline (paged)
 *   - clinicalNotes.getDetail                  — expanded drawer body
 *   - clinicalNotes.createProgressNote / …     — submit (9 variants)
 *
 * The editor is intentionally labeled textareas per section (no rich text
 * dependency). One set of fields per note_type is rendered; others hidden.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ── tRPC fetch helpers (superjson-wrapped) ─────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) return null;
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
  if (!res.ok) throw new Error(`Mutation failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || 'Mutation error');
  return json.result?.data?.json;
}

// ── Role gates ─────────────────────────────────────────────────────────────
const DOCTOR_ROLES = new Set([
  'resident', 'senior_resident', 'intern',
  'visiting_consultant', 'hospitalist', 'consultant', 'senior_consultant',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'surgeon', 'anaesthetist',
  'department_head', 'medical_director', 'hospital_admin', 'super_admin',
]);
const NURSE_ROLES = new Set([
  'nurse', 'senior_nurse', 'charge_nurse',
  'nursing_supervisor', 'nursing_manager', 'ot_nurse', 'nursing_assistant',
]);

// ── Note type catalog (value, label, category for templates, roles) ────────
interface NoteTypeDef {
  value: string;                 // note_type enum value
  label: string;                 // dropdown label
  badge: string;                 // short badge for timeline chip
  color: string;                 // badge color
  category: string | null;       // template_category filter (null = no templates)
  roles: 'doctor' | 'nurse' | 'both';
  // editor field set
  fields: {
    key: string;                 // form state key
    label: string;               // shown above textarea
    hint?: string;               // placeholder/tooltip
    required?: boolean;
    maxLength: number;
    rows: number;
  }[];
  // endpoint name on clinicalNotes.*
  endpoint: string;
  // extra transform for the submit payload
  payloadBuilder?: (form: Record<string, string>) => Record<string, any>;
}

const NOTE_TYPES: NoteTypeDef[] = [
  {
    value: 'progress_note', label: 'Progress Note', badge: 'Progress', color: '#0055FF',
    category: 'progress', roles: 'doctor',
    endpoint: 'createProgressNote',
    fields: [
      { key: 'subjective', label: 'Subjective (S)', hint: 'Patient-reported symptoms, concerns', maxLength: 5000, rows: 4 },
      { key: 'objective',  label: 'Objective (O)',  hint: 'Vitals, exam findings, labs', maxLength: 5000, rows: 5 },
      { key: 'assessment', label: 'Assessment (A)', hint: 'Clinical impression, diagnosis', maxLength: 5000, rows: 4 },
      { key: 'plan',       label: 'Plan (P)',       hint: 'Management, orders, follow-up', maxLength: 5000, rows: 4 },
    ],
  },
  {
    value: 'ward_round_note', label: 'Ward Round', badge: 'Round', color: '#7C3AED',
    category: 'progress', roles: 'doctor',
    endpoint: 'createWardRoundNote',
    fields: [
      { key: 'subjective', label: 'Subjective', maxLength: 5000, rows: 3 },
      { key: 'objective',  label: 'Objective',  maxLength: 5000, rows: 4 },
      { key: 'assessment', label: 'Assessment', maxLength: 5000, rows: 3 },
      { key: 'plan',       label: 'Plan',       maxLength: 5000, rows: 3 },
    ],
  },
  {
    value: 'admission_note', label: 'Admission Note', badge: 'Admit', color: '#DC2626',
    category: 'admission', roles: 'doctor',
    endpoint: 'createAdmissionNote',
    fields: [
      { key: 'admission_details', label: 'Admission Details', hint: 'History, reason for admission, initial exam', required: true, maxLength: 10000, rows: 12 },
      { key: 'diagnosis_list',    label: 'Diagnosis List (one per line)', hint: 'Each line becomes a diagnosis entry', maxLength: 5000, rows: 4 },
    ],
    payloadBuilder: (f) => ({
      admission_details: f.admission_details || '',
      diagnosis_list: (f.diagnosis_list || '')
        .split('\n').map(s => s.trim()).filter(Boolean)
        .map(d => ({ text: d })),
    }),
  },
  {
    value: 'physical_exam', label: 'Physical Exam', badge: 'P/E', color: '#059669',
    category: 'assessment', roles: 'doctor',
    endpoint: 'createPhysicalExam',
    fields: [
      { key: 'objective',  label: 'Exam Findings (Objective)', required: true, maxLength: 10000, rows: 10 },
      { key: 'assessment', label: 'Assessment', maxLength: 5000, rows: 4 },
    ],
  },
  {
    value: 'procedure_note', label: 'Procedure Note', badge: 'Proc', color: '#B45309',
    category: 'operative', roles: 'doctor',
    endpoint: 'createProcedureNote',
    fields: [
      { key: 'procedure_name',      label: 'Procedure Name', required: true, maxLength: 500, rows: 1 },
      { key: 'operative_findings',  label: 'Operative Findings', maxLength: 10000, rows: 6 },
      { key: 'complications',       label: 'Complications (if any)', maxLength: 5000, rows: 3 },
      { key: 'plan',                label: 'Post-procedure Plan', maxLength: 5000, rows: 3 },
    ],
  },
  {
    value: 'consultation_note', label: 'Consultation Note', badge: 'Consult', color: '#0EA5E9',
    category: 'consultation', roles: 'doctor',
    endpoint: 'createConsultNote',
    fields: [
      { key: 'subjective', label: 'Subjective', maxLength: 5000, rows: 3 },
      { key: 'objective',  label: 'Objective',  maxLength: 5000, rows: 3 },
      { key: 'assessment', label: 'Assessment', required: true, maxLength: 5000, rows: 4 },
      { key: 'plan',       label: 'Recommendations', required: true, maxLength: 5000, rows: 4 },
    ],
  },
  {
    value: 'soap_note', label: 'SOAP Note (legacy)', badge: 'SOAP', color: '#0055FF',
    category: 'progress', roles: 'doctor',
    endpoint: 'createSoap',
    fields: [
      { key: 'subjective', label: 'Subjective', maxLength: 5000, rows: 4 },
      { key: 'objective',  label: 'Objective',  maxLength: 5000, rows: 4 },
      { key: 'assessment', label: 'Assessment', maxLength: 5000, rows: 4 },
      { key: 'plan',       label: 'Plan',       maxLength: 5000, rows: 4 },
    ],
  },
  {
    value: 'shift_handover', label: 'Shift Handover', badge: 'Handoff', color: '#F59E0B',
    category: 'handoff', roles: 'both',
    endpoint: 'createHandoverNote',
    fields: [
      { key: 'shift_summary', label: 'Shift Summary', required: true, hint: 'Highlights, pending tasks, watch items', maxLength: 10000, rows: 10 },
    ],
  },
  {
    value: 'nursing_note', label: 'Nursing Note', badge: 'Nursing', color: '#0B8A3E',
    category: 'nursing', roles: 'nurse',
    endpoint: 'createNursing',
    fields: [
      { key: 'shift_summary', label: 'Nursing Observations', required: true, maxLength: 10000, rows: 10 },
    ],
  },
  {
    value: 'death_summary', label: 'Death Summary', badge: 'Death', color: '#6B7280',
    category: 'discharge', roles: 'doctor',
    endpoint: 'createDeathSummary',
    fields: [
      { key: 'death_datetime',        label: 'Death Date/Time (ISO)', required: true, hint: '2026-04-17T14:32', maxLength: 40, rows: 1 },
      { key: 'immediate_cause_icd10', label: 'Immediate Cause (ICD-10)', maxLength: 20, rows: 1 },
      { key: 'antecedent_cause_icd10',label: 'Antecedent Cause (ICD-10)', maxLength: 20, rows: 1 },
      { key: 'underlying_cause_icd10',label: 'Underlying Cause (ICD-10)', maxLength: 20, rows: 1 },
      { key: 'course_in_hospital',    label: 'Course in Hospital', maxLength: 10000, rows: 8 },
    ],
  },
];

function noteDefFor(v: string): NoteTypeDef | undefined {
  return NOTE_TYPES.find(n => n.value === v);
}

function filterTypesForRole(role: string): NoteTypeDef[] {
  if (DOCTOR_ROLES.has(role)) return NOTE_TYPES.filter(n => n.roles !== 'nurse');
  if (NURSE_ROLES.has(role))  return NOTE_TYPES.filter(n => n.roles !== 'doctor');
  return NOTE_TYPES.filter(n => n.roles === 'both');
}

// ── Props ──────────────────────────────────────────────────────────────────
interface NotesTabV2Props {
  userRole: string;
  userName: string;
  userId: string;
  patientId: string;
  encounterId: string | null;
}

// ── localStorage helpers ───────────────────────────────────────────────────
function lsKey(patientId: string, encounterId: string, noteType: string, authorId: string) {
  return `even-os:note-draft:${patientId}:${encounterId}:${noteType}:${authorId}`;
}
function lsSave(key: string, body: Record<string, string>, templateId: string | null) {
  try { localStorage.setItem(key, JSON.stringify({ body, template_id: templateId, saved_at: Date.now() })); } catch {}
}
function lsLoad(key: string): { body: Record<string, string>; template_id: string | null } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return { body: obj.body || {}, template_id: obj.template_id || null };
  } catch { return null; }
}
function lsClear(key: string) { try { localStorage.removeItem(key); } catch {} }

// ── Main component ─────────────────────────────────────────────────────────
export default function NotesTab({ userRole, userName, userId, patientId, encounterId }: NotesTabV2Props) {
  const availableTypes = useMemo(() => filterTypesForRole(userRole), [userRole]);
  const [noteType, setNoteType] = useState<string>(availableTypes[0]?.value || 'progress_note');
  const def = noteDefFor(noteType);

  const [form, setForm] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'offline'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedForSlot = useRef<string>('');   // guard against stale loads

  // Reset form + reload draft whenever slot changes
  useEffect(() => {
    if (!encounterId) return;
    const slotKey = `${patientId}|${encounterId}|${noteType}|${userId}`;
    loadedForSlot.current = slotKey;

    // Reset immediately to avoid flashing prior content
    setForm({});
    setTemplateId(null);
    setSaveState('idle');
    setLastSavedAt(null);

    (async () => {
      // 1. Try server draft
      const serverDraft = await trpcQuery('noteDrafts.getDraft', {
        patient_id: patientId, encounter_id: encounterId, note_type: noteType,
      });
      if (loadedForSlot.current !== slotKey) return; // raced to another slot

      if (serverDraft) {
        setForm((serverDraft.body as Record<string, string>) || {});
        setTemplateId(serverDraft.template_id || null);
        setLastSavedAt(serverDraft.updated_at || null);
        return;
      }
      // 2. Fallback to localStorage
      const local = lsLoad(lsKey(patientId, encounterId, noteType, userId));
      if (local) {
        setForm(local.body || {});
        setTemplateId(local.template_id || null);
      }
    })();
  }, [patientId, encounterId, noteType, userId]);

  // Load templates for the category
  useEffect(() => {
    if (!def?.category) { setTemplates([]); return; }
    (async () => {
      const rows = await trpcQuery('templateManagement.list',
        { scope: 'all', category: def.category, limit: 100 });
      setTemplates(Array.isArray(rows) ? rows : []);
    })();
  }, [def?.category]);

  // Autosave loop — server primary, localStorage fallback
  useEffect(() => {
    if (!encounterId) return;
    if (Object.keys(form).length === 0 && !templateId) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      lsSave(lsKey(patientId, encounterId, noteType, userId), form, templateId);
      try {
        const res = await trpcMutate('noteDrafts.saveDraft', {
          patient_id: patientId,
          encounter_id: encounterId,
          note_type: noteType,
          body: form,
          template_id: templateId,
        });
        if (res?.ok) {
          setSaveState('saved');
          setLastSavedAt(res.updated_at || new Date().toISOString());
        } else {
          setSaveState('offline');
        }
      } catch {
        setSaveState('offline');
      }
    }, 1800);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [form, templateId, patientId, encounterId, noteType, userId]);

  // Apply a template to the form (merges `sections` into keyed fields)
  const applyTemplate = useCallback(async (tId: string) => {
    if (!tId) { setTemplateId(null); return; }
    setTemplateId(tId);
    const tpl = await trpcQuery('templateManagement.get', { id: tId });
    if (!tpl) return;

    // Templates store their section defaults in template_sections (array) or template_body (jsonb)
    const sections: any[] = tpl.template_sections || tpl.sections || [];
    const merged: Record<string, string> = { ...form };
    if (Array.isArray(sections)) {
      for (const s of sections) {
        const key: string | undefined = s.field_key || s.key || s.slug;
        const val: string | undefined = s.default_value ?? s.content ?? s.placeholder;
        if (key && typeof val === 'string' && !merged[key]) merged[key] = val;
      }
    }
    // Fallback — if template_body has a sections object
    const body = tpl.template_body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string' && !merged[k]) merged[k] = v;
      }
    }
    setForm(merged);
  }, [form]);

  // Submit — call the right endpoint, then clear draft
  const handleSubmit = useCallback(async (status: 'draft' | 'signed') => {
    if (!def || !encounterId) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const base: Record<string, any> = {
        patient_id: patientId,
        encounter_id: encounterId,
        status,
        ...(templateId ? { template_id: templateId } : {}),
      };
      const body = def.payloadBuilder ? def.payloadBuilder(form) : { ...form };
      const payload = { ...base, ...body };

      // Strip empty optional strings to avoid zod .max() on empty strings
      for (const k of Object.keys(payload)) {
        if (payload[k] === '' || payload[k] === null || payload[k] === undefined) {
          delete payload[k];
        }
      }
      // Required field guard
      for (const f of def.fields) {
        if (f.required && !payload[f.key]) {
          throw new Error(`"${f.label}" is required`);
        }
      }
      await trpcMutate(`clinicalNotes.${def.endpoint}`, payload);
      // Clear draft (best-effort)
      try {
        await trpcMutate('noteDrafts.clearDraft', {
          patient_id: patientId, encounter_id: encounterId, note_type: noteType,
        });
      } catch {}
      lsClear(lsKey(patientId, encounterId, noteType, userId));

      setForm({});
      setTemplateId(null);
      setSaveState('idle');
      setLastSavedAt(null);
      setBanner({ kind: 'ok', msg: `Note ${status === 'signed' ? 'signed' : 'saved as draft'}.` });
      // Trigger timeline reload
      setTimelineRefreshKey(k => k + 1);
    } catch (e: any) {
      setBanner({ kind: 'err', msg: e?.message || 'Submit failed' });
    } finally {
      setSubmitting(false);
    }
  }, [def, form, templateId, patientId, encounterId, noteType, userId]);

  // Timeline state (for refresh trigger)
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);

  if (!encounterId) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>
        No active encounter — notes are scoped to an admission.
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── EDITOR CARD ───────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>New note</h3>
          <SaveBadge state={saveState} lastSavedAt={lastSavedAt} />
        </div>

        {/* Type + template row */}
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <Label>Note type</Label>
            <select value={noteType}
              onChange={e => setNoteType(e.target.value)}
              style={selectStyle}>
              {availableTypes.map(t =>
                <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Template {templates.length > 0 && <span style={{ color: '#6B7280', fontWeight: 400 }}>({templates.length} available)</span>}</Label>
            <select value={templateId || ''}
              onChange={e => applyTemplate(e.target.value)}
              disabled={templates.length === 0}
              style={{ ...selectStyle, opacity: templates.length === 0 ? 0.5 : 1 }}>
              <option value="">— No template —</option>
              {templates.map(tpl =>
                <option key={tpl.id} value={tpl.id}>
                  {tpl.template_name}{tpl.template_scope !== 'system' ? ` · ${tpl.template_scope}` : ''}
                </option>)}
            </select>
          </div>
        </div>

        {/* Adaptive fields */}
        {def?.fields.map(f => (
          <div key={f.key} style={{ marginBottom: 12 }}>
            <Label>
              {f.label}
              {f.required && <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>}
            </Label>
            {f.rows === 1 ? (
              <input
                type="text"
                value={form[f.key] || ''}
                maxLength={f.maxLength}
                placeholder={f.hint}
                onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                style={inputStyle}
              />
            ) : (
              <textarea
                value={form[f.key] || ''}
                maxLength={f.maxLength}
                placeholder={f.hint}
                rows={f.rows}
                onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                style={textareaStyle}
              />
            )}
            <div style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'right', marginTop: 2 }}>
              {(form[f.key] || '').length} / {f.maxLength}
            </div>
          </div>
        ))}

        {banner && (
          <div style={{
            padding: '8px 12px', borderRadius: 8,
            background: banner.kind === 'ok' ? '#ECFDF5' : '#FEE2E2',
            color: banner.kind === 'ok' ? '#065F46' : '#991B1B',
            border: `1px solid ${banner.kind === 'ok' ? '#A7F3D0' : '#FECACA'}`,
            fontSize: 13, marginBottom: 12,
          }}>{banner.msg}</div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => handleSubmit('draft')}
            disabled={submitting}
            style={btnSecondary}>
            {submitting ? 'Saving…' : 'Save as draft'}
          </button>
          <button
            onClick={() => handleSubmit('signed')}
            disabled={submitting}
            style={btnPrimary}>
            {submitting ? 'Submitting…' : 'Sign & submit'}
          </button>
        </div>
      </div>

      {/* ── TIMELINE CARD ─────────────────────────────────────────────── */}
      <NotesTimeline
        patientId={patientId}
        encounterId={encounterId}
        refreshKey={timelineRefreshKey}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Timeline sub-component
// ───────────────────────────────────────────────────────────────────────────
interface NotesTimelineProps {
  patientId: string;
  encounterId: string | null;
  refreshKey: number;
}

function NotesTimeline({ patientId, encounterId, refreshKey }: NotesTimelineProps) {
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 15;
  const [rows, setRows] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await trpcQuery('clinicalNotes.listNotes', {
      patient_id: patientId,
      ...(encounterId ? { encounter_id: encounterId } : {}),
      ...(typeFilter ? { note_type: typeFilter } : {}),
      limit: pageSize,
      offset: page * pageSize,
    });
    setRows(res?.notes || []);
    setCount(res?.count || 0);
    setLoading(false);
  }, [patientId, encounterId, typeFilter, page]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      [r.subjective, r.objective, r.assessment, r.plan, r.shift_summary, r.procedure_name, r.note_type]
        .filter(Boolean).some((v: string) => v.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null); setExpandedDetail(null); return;
    }
    setExpandedId(id);
    setExpandedDetail(null);
    const d = await trpcQuery('clinicalNotes.getDetail', { note_id: id });
    if (d) setExpandedDetail(d);
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Notes timeline</h3>
        <span style={{ fontSize: 12, color: '#6B7280' }}>
          {loading ? 'Loading…' : `${filtered.length} of ${count} on this page`}
        </span>
      </div>

      {/* Filter row */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 90px', gap: 8, marginBottom: 12 }}>
        <select value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
          style={selectStyle}>
          <option value="">All note types</option>
          {NOTE_TYPES.map(t =>
            <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search in visible notes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={inputStyle}
        />
        <button onClick={() => load()} style={btnSecondary}>Refresh</button>
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && !loading && (
          <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            No notes match the current filter.
          </div>
        )}
        {filtered.map(r => {
          const d = noteDefFor(r.note_type);
          const badge = d?.badge || r.note_type;
          const color = d?.color || '#6B7280';
          const snippet =
            r.procedure_name
            || r.assessment
            || r.plan
            || r.subjective
            || r.shift_summary
            || r.objective
            || '(no content)';
          const isOpen = expandedId === r.id;
          return (
            <div key={r.id} style={{ border: '1px solid #E5E7EB', borderRadius: 8 }}>
              <div
                onClick={() => toggleExpand(r.id)}
                style={{
                  display: 'flex', gap: 12, alignItems: 'center',
                  padding: '10px 12px', cursor: 'pointer',
                  background: isOpen ? '#F9FAFB' : '#FFF',
                }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                  fontSize: 11, fontWeight: 600, color: '#FFF', background: color,
                  minWidth: 60, textAlign: 'center',
                }}>{badge}</span>
                <span style={{ fontSize: 13, color: '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {String(snippet).slice(0, 120)}
                </span>
                <span style={{ fontSize: 11, color: r.status === 'signed' ? '#059669' : '#B45309', fontWeight: 500 }}>
                  {r.status}
                </span>
                <span style={{ fontSize: 11, color: '#6B7280' }}>
                  {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                </span>
                <span style={{ fontSize: 14, color: '#9CA3AF' }}>{isOpen ? '▾' : '▸'}</span>
              </div>
              {isOpen && (
                <div style={{ padding: 12, borderTop: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 13 }}>
                  {!expandedDetail ? (
                    <div style={{ color: '#9CA3AF' }}>Loading full note…</div>
                  ) : (
                    <NoteDetailView note={expandedDetail} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          style={{ ...btnSecondary, opacity: page === 0 ? 0.5 : 1 }}>
          ← Prev
        </button>
        <span style={{ fontSize: 12, color: '#6B7280', alignSelf: 'center' }}>Page {page + 1}</span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={rows.length < pageSize}
          style={{ ...btnSecondary, opacity: rows.length < pageSize ? 0.5 : 1 }}>
          Next →
        </button>
      </div>
    </div>
  );
}

function NoteDetailView({ note }: { note: any }) {
  const fields: { label: string; value: any }[] = [
    { label: 'Subjective', value: note.subjective },
    { label: 'Objective', value: note.objective },
    { label: 'Assessment', value: note.assessment },
    { label: 'Plan', value: note.plan },
    { label: 'Admission details', value: note.admission_details },
    { label: 'Procedure', value: note.procedure_name },
    { label: 'Operative findings', value: note.operative_findings },
    { label: 'Complications', value: note.complications },
    { label: 'Shift summary', value: note.shift_summary },
    { label: 'Course in hospital', value: note.course_in_hospital },
    { label: 'Death datetime', value: note.death_datetime },
    { label: 'Immediate cause', value: note.immediate_cause_icd10 },
  ].filter(f => f.value !== null && f.value !== undefined && f.value !== '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {fields.map(f => (
        <div key={f.label}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {f.label}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', color: '#111827' }}>{String(f.value)}</div>
        </div>
      ))}
      {fields.length === 0 && (
        <div style={{ color: '#9CA3AF' }}>This note has no body fields.</div>
      )}
      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
        Status: {note.status} · Created {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
        {note.signed_at ? ` · Signed ${new Date(note.signed_at).toLocaleString()}` : ''}
      </div>
    </div>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function SaveBadge({ state, lastSavedAt }: { state: string; lastSavedAt: string | null }) {
  const map: Record<string, { txt: string; color: string; bg: string }> = {
    idle:    { txt: 'Unsaved',  color: '#9CA3AF', bg: '#F3F4F6' },
    saving:  { txt: 'Saving…',  color: '#B45309', bg: '#FEF3C7' },
    saved:   { txt: 'Saved',    color: '#065F46', bg: '#ECFDF5' },
    error:   { txt: 'Error',    color: '#991B1B', bg: '#FEE2E2' },
    offline: { txt: 'Offline (local only)', color: '#B45309', bg: '#FEF3C7' },
  };
  const m = map[state] || map.idle;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 11, color: m.color, background: m.bg,
      padding: '3px 10px', borderRadius: 12, fontWeight: 500,
    }}>
      {m.txt}
      {lastSavedAt && state === 'saved' && (
        <span style={{ color: '#6B7280', fontWeight: 400 }}>
          · {new Date(lastSavedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: '#FFF', border: '1px solid #E5E7EB',
  borderRadius: 12, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', lineHeight: 1.5 };
const selectStyle: React.CSSProperties = { ...inputStyle, background: '#FFF' };
const btnPrimary: React.CSSProperties = {
  padding: '9px 18px', background: '#0055FF', color: '#FFF',
  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '9px 18px', background: '#FFF', color: '#374151',
  border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
