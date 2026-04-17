'use client';

/**
 * BriefTab — Continuously-regenerated Patient Brief (Sprint N.6).
 *
 * The 13th tab on the patient chart. Reads the latest non-stale row from
 * `patient_briefs` and renders:
 *   • header strip        — version pill, generated_at, trigger reason,
 *                           Regenerate-now button
 *   • hallucination banner (yellow, only if flags > 0) → clickable to
 *                           expand a per-flag panel with source-field
 *                           detail
 *   • narrative           — the LLM's free-text summary
 *   • structured cards    — HPI, Problems, Allergies, Current Meds,
 *                           Recent Labs, Plan (each card renders whatever
 *                           array/object shape the model produced)
 *   • sources panel       — collapsible, groups patient_brief_sources by
 *                           source_table so clinicians can see which
 *                           chart records fed this brief
 *
 * Data wiring:
 *   - patientBriefs.getLatestBrief({ patient_id })   — one round-trip
 *     returns { brief, pending } so we can show a "Regenerating…" pill
 *     when an ai_request_queue row is still mid-flight.
 *   - patientBriefs.regenerateBrief({ patient_id })  — manual priority
 *     critical enqueue; returns { ok: true } and we refetch after 800ms.
 *   - patientBriefs.flagIssue({ brief_id, description }) — lets the
 *     clinician raise a human flag when they spot something the
 *     automated grounding check missed.
 *
 * Role gate: any clinical read role (super_admin, medical_director,
 * consultant family, resident/intern, nurse family). Doctors can
 * regenerate or flag; nurses see read-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

// ── tRPC helpers (match DocumentsTab convention) ────────────────────────────
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

// ── Role gates (mirror patientBriefs router) ────────────────────────────────
const DOCTOR_ROLES = new Set<string>([
  'super_admin', 'hospital_admin', 'medical_director', 'department_head',
  'consultant', 'senior_consultant', 'visiting_consultant',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'hospitalist', 'senior_resident', 'resident', 'intern', 'surgeon',
  'anaesthetist',
]);
function isDoctor(role: string) { return DOCTOR_ROLES.has(role); }

// ── Types ───────────────────────────────────────────────────────────────────
interface HallucinationFlag {
  type?: string;           // 'problem' | 'allergy' | 'current_med' | 'recent_lab' | 'narrative'
  field?: string;          // 'name' | 'icd10' | 'substance' | 'drug' | ...
  value?: string | number;
  reason?: string;
  [k: string]: any;
}

interface BriefSourceRef {
  source_table: string;
  source_id: string;
  [k: string]: any;
}

interface BriefRow {
  id: string;
  version: number;
  narrative: string;
  structured: any;         // { hpi, problems[], allergies[], current_meds[], recent_labs[], plan[] }
  trigger_event: string;
  triggered_by: string | null;
  llm_audit_id: string | null;
  source_ids: BriefSourceRef[];
  hallucination_flags: HallucinationFlag[];
  is_stale: boolean;
  supersedes_id: string | null;
  generated_at: string;
  created_at: string;
}

interface PendingRow {
  id: string;
  priority: string;
  status: string;
  created_at: string;
  trigger: string | null;
}

interface Props {
  patientId: string;
  userRole: string;
  userName?: string;
}

// ── Utilities ───────────────────────────────────────────────────────────────
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)   return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30)  return `${days}d ago`;
  return d.toLocaleDateString();
}

function prettifyTrigger(t: string | null | undefined): string {
  if (!t) return 'Unknown trigger';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function asArray<T = any>(v: any): T[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

// ── Component ───────────────────────────────────────────────────────────────
export default function BriefTab({ patientId, userRole }: Props) {
  const [brief, setBrief] = useState<BriefRow | null>(null);
  const [pending, setPending] = useState<PendingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [flagDraft, setFlagDraft] = useState('');
  const [flagSaving, setFlagSaving] = useState(false);
  const [flagSaved, setFlagSaved] = useState(false);

  const canRegenerate = isDoctor(userRole);
  const canFlag = isDoctor(userRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery('patientBriefs.getLatestBrief', { patient_id: patientId });
      if (!res) throw new Error('Failed to load brief');
      setBrief(res.brief);
      setPending(res.pending);
    } catch (e: any) {
      setError(e?.message || 'Failed to load brief');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const onRegenerate = useCallback(async () => {
    if (!canRegenerate || regenerating) return;
    setRegenerating(true);
    try {
      await trpcMutate('patientBriefs.regenerateBrief', {
        patient_id: patientId,
        reason: 'Manual refresh from Brief tab',
      });
      // Give the queue worker a beat; then refetch to pick up the
      // pending row (the real brief will land a few sec later).
      setTimeout(() => { load(); setRegenerating(false); }, 900);
    } catch (e: any) {
      setError(e?.message || 'Regenerate failed');
      setRegenerating(false);
    }
  }, [canRegenerate, regenerating, patientId, load]);

  const onFlag = useCallback(async () => {
    if (!brief || !canFlag || flagSaving) return;
    const desc = flagDraft.trim();
    if (desc.length < 5) return;
    setFlagSaving(true);
    try {
      await trpcMutate('patientBriefs.flagIssue', {
        brief_id: brief.id,
        description: desc,
      });
      setFlagDraft('');
      setFlagSaved(true);
      setTimeout(() => setFlagSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Flag failed');
    } finally {
      setFlagSaving(false);
    }
  }, [brief, canFlag, flagSaving, flagDraft]);

  // Group sources by table for the provenance panel.
  const sourceGroups = useMemo(() => {
    if (!brief?.source_ids || !Array.isArray(brief.source_ids)) return [];
    const groups: Record<string, BriefSourceRef[]> = {};
    for (const s of brief.source_ids) {
      const k = s?.source_table || 'unknown';
      (groups[k] ||= []).push(s);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [brief?.source_ids]);

  const flags = Array.isArray(brief?.hallucination_flags) ? (brief!.hallucination_flags as HallucinationFlag[]) : [];
  const structured = brief?.structured || {};

  // ── Loading / empty states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 24, color: '#666' }}>Loading patient brief…</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: '#B00020', marginBottom: 12 }}>Error: {error}</div>
        <button onClick={load} style={btnSecondary}>Retry</button>
      </div>
    );
  }

  if (!brief) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#002054', marginTop: 0 }}>Patient Brief</h2>
        <p style={{ color: '#666', marginTop: 8 }}>
          No brief has been generated yet for this patient. A brief is created automatically
          whenever the chart changes (notes, vitals, meds, documents, admission, discharge).
        </p>
        {pending ? (
          <div style={pillAmber}>Regenerating now — check back in a moment.</div>
        ) : canRegenerate ? (
          <button onClick={onRegenerate} disabled={regenerating} style={btnPrimary}>
            {regenerating ? 'Queuing…' : 'Generate brief now'}
          </button>
        ) : null}
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 18, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#002054', margin: 0 }}>
            Patient Brief
            <span style={versionPill}>v{brief.version}</span>
            {brief.is_stale && <span style={stalePill}>Stale</span>}
          </h2>
          <div style={{ marginTop: 6, color: '#555', fontSize: 13 }}>
            Generated {formatRelative(brief.generated_at)} · Trigger: {prettifyTrigger(brief.trigger_event)}
            {pending && <span style={pillAmberInline}>Regenerating…</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {sourceGroups.length > 0 && (
            <button onClick={() => setSourcesOpen((o) => !o)} style={btnSecondary}>
              {sourcesOpen ? 'Hide' : 'View'} sources ({brief.source_ids?.length || 0})
            </button>
          )}
          {canRegenerate && (
            <button onClick={onRegenerate} disabled={regenerating || !!pending} style={btnPrimary}>
              {regenerating ? 'Queuing…' : pending ? 'Queued' : 'Regenerate now'}
            </button>
          )}
        </div>
      </div>

      {/* Hallucination banner */}
      {flags.length > 0 && (
        <div style={flagsBanner}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ color: '#8A5A00' }}>⚠ {flags.length} grounding flag{flags.length === 1 ? '' : 's'}</strong>
              <span style={{ color: '#5A3C00', marginLeft: 8, fontSize: 13 }}>
                — the automated check couldn't verify {flags.length === 1 ? 'this fact' : 'these facts'} against the source chart.
                Treat the brief cautiously.
              </span>
            </div>
            <button onClick={() => setFlagsOpen((o) => !o)} style={btnGhostAmber}>
              {flagsOpen ? 'Hide detail' : 'Show detail'}
            </button>
          </div>
          {flagsOpen && (
            <div style={{ marginTop: 12, background: '#fff', border: '1px solid #E8D08A', borderRadius: 8, padding: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b4e00' }}>
                    <th style={thCell}>Category</th>
                    <th style={thCell}>Field</th>
                    <th style={thCell}>Value</th>
                    <th style={thCell}>Why flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #F3E6B8' }}>
                      <td style={tdCell}>{f.type || '—'}</td>
                      <td style={tdCell}>{f.field || '—'}</td>
                      <td style={tdCell}><code style={codeMono}>{String(f.value ?? '')}</code></td>
                      <td style={tdCell}>{f.reason || 'not in source corpus'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Narrative */}
      <section style={cardBase}>
        <h3 style={cardTitle}>Narrative</h3>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, color: '#1a1a1a', fontSize: 14 }}>
          {brief.narrative?.trim() || <span style={{ color: '#888' }}>No narrative produced.</span>}
        </div>
      </section>

      {/* Structured cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
        <StructuredCard
          title="History of Present Illness"
          icon="🩺"
          empty="No HPI."
        >
          {typeof structured.hpi === 'string' && structured.hpi.trim()
            ? <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{structured.hpi}</div>
            : null}
        </StructuredCard>

        <StructuredCard title="Problems" icon="🧾" empty="No active problems.">
          {asArray(structured.problems).map((p: any, i: number) => (
            <div key={i} style={itemRow}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {p?.name || p?.condition || 'Unnamed problem'}
                {p?.icd10 && <span style={codePill}>{p.icd10}</span>}
              </div>
              {(p?.status || p?.notes) && (
                <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                  {p?.status && <span>{p.status}</span>}
                  {p?.status && p?.notes && <span> · </span>}
                  {p?.notes && <span>{p.notes}</span>}
                </div>
              )}
            </div>
          ))}
        </StructuredCard>

        <StructuredCard title="Allergies" icon="⚠️" empty="No known allergies.">
          {asArray(structured.allergies).map((a: any, i: number) => (
            <div key={i} style={itemRow}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {a?.substance || 'Unknown allergen'}
                {a?.severity && <span style={{ ...codePill, background: sevColor(a.severity).bg, color: sevColor(a.severity).fg }}>{a.severity}</span>}
              </div>
              {a?.reaction && (
                <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>Reaction: {a.reaction}</div>
              )}
            </div>
          ))}
        </StructuredCard>

        <StructuredCard title="Current Medications" icon="💊" empty="No current medications.">
          {asArray(structured.current_meds).map((m: any, i: number) => (
            <div key={i} style={itemRow}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {m?.drug || m?.name || 'Unnamed medication'}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {[m?.dose, m?.route, m?.frequency].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
          ))}
        </StructuredCard>

        <StructuredCard title="Recent Labs" icon="🧪" empty="No recent labs (30 days).">
          {asArray(structured.recent_labs).map((l: any, i: number) => (
            <div key={i} style={itemRow}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {l?.test || l?.test_name || 'Lab'}
                </div>
                <div style={{ fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {l?.value ?? '—'}{l?.unit ? ` ${l.unit}` : ''}
                  {l?.flag && l?.flag !== 'normal' && (
                    <span style={{ ...codePill, background: '#fde1e1', color: '#9a1b1b' }}>{l.flag}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </StructuredCard>

        <StructuredCard title="Plan" icon="🗺" empty="No plan captured.">
          {asArray(structured.plan).map((step: any, i: number) => (
            <div key={i} style={{ ...itemRow, display: 'flex', gap: 8 }}>
              <div style={{ color: '#0055FF', fontWeight: 700 }}>{i + 1}.</div>
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                {typeof step === 'string' ? step : (step?.item || step?.action || JSON.stringify(step))}
              </div>
            </div>
          ))}
        </StructuredCard>
      </div>

      {/* Sources panel */}
      {sourcesOpen && sourceGroups.length > 0 && (
        <section style={{ ...cardBase, marginTop: 16 }}>
          <h3 style={cardTitle}>Sources feeding this brief</h3>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
            These are the chart records that were provided to the LLM when the brief was generated.
          </div>
          {sourceGroups.map(([table, rows]) => (
            <details key={table} style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0055FF' }}>
                {table} ({rows.length})
              </summary>
              <div style={{ marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: '#444', padding: '3px 0' }}>
                    {r.source_id}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}

      {/* Flag issue panel — doctors only */}
      {canFlag && (
        <section style={{ ...cardBase, marginTop: 16, background: '#F8FAFF' }}>
          <h3 style={cardTitle}>Spotted something off?</h3>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
            Raise a human flag if the brief contains an error the automated grounding check missed.
            Flags feed back into the next regeneration and show up in the admin Observatory.
          </div>
          <textarea
            value={flagDraft}
            onChange={(e) => setFlagDraft(e.target.value)}
            placeholder="Describe what's wrong — e.g. 'Says patient is on warfarin but that was stopped Tue'"
            style={{
              width: '100%', minHeight: 72, padding: 10, border: '1px solid #D4DAE8',
              borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div style={{ fontSize: 12, color: flagSaved ? '#047857' : '#888' }}>
              {flagSaved ? '✓ Flag recorded — thanks.' : `${flagDraft.trim().length}/2000 chars`}
            </div>
            <button
              onClick={onFlag}
              disabled={flagSaving || flagDraft.trim().length < 5}
              style={{ ...btnSecondary, opacity: flagDraft.trim().length < 5 ? 0.5 : 1 }}
            >
              {flagSaving ? 'Submitting…' : 'Submit flag'}
            </button>
          </div>
        </section>
      )}

      {/* Footer meta */}
      <div style={{ marginTop: 16, fontSize: 11, color: '#888' }}>
        Generated by Even AI · Brief id <code>{brief.id}</code>
        {brief.llm_audit_id && <> · audit <code>{brief.llm_audit_id}</code></>}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function StructuredCard({
  title, icon, children, empty,
}: {
  title: string; icon?: string; children?: any; empty?: string;
}) {
  const hasContent = !!(Array.isArray(children) ? children.filter(Boolean).length : children);
  return (
    <section style={cardBase}>
      <h3 style={cardTitle}>{icon ? <span style={{ marginRight: 6 }}>{icon}</span> : null}{title}</h3>
      {hasContent ? children : <div style={{ fontSize: 12, color: '#999' }}>{empty || '—'}</div>}
    </section>
  );
}

// ─── Styling tokens ─────────────────────────────────────────────────────────
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6, border: 'none',
  background: '#0055FF', color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6, border: '1px solid #CFD6E4',
  background: '#fff', color: '#002054', fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
};
const btnGhostAmber: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #E8D08A',
  background: '#fff', color: '#8A5A00', fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
};

const cardBase: React.CSSProperties = {
  background: '#fff', border: '1px solid #E5E8F0', borderRadius: 10,
  padding: 14, marginTop: 12,
};
const cardTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: '#002054',
  margin: 0, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4,
};
const itemRow: React.CSSProperties = {
  padding: '6px 0', borderTop: '1px solid #F0F2F7',
};
const versionPill: React.CSSProperties = {
  marginLeft: 10, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
  padding: '2px 8px', borderRadius: 999, background: '#E6EDFF', color: '#0055FF',
};
const stalePill: React.CSSProperties = {
  marginLeft: 6, fontSize: 11, fontWeight: 700,
  padding: '2px 8px', borderRadius: 999, background: '#F3F3F3', color: '#555',
};
const codePill: React.CSSProperties = {
  marginLeft: 8, fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace',
  padding: '1px 6px', borderRadius: 4, background: '#F3F6FD', color: '#3d4b6b',
};
const pillAmber: React.CSSProperties = {
  display: 'inline-block', marginTop: 10, padding: '6px 10px',
  background: '#FFF5D6', color: '#8A5A00', borderRadius: 6, fontSize: 13, fontWeight: 600,
};
const pillAmberInline: React.CSSProperties = {
  marginLeft: 10, padding: '2px 8px', borderRadius: 999,
  background: '#FFF5D6', color: '#8A5A00', fontSize: 11, fontWeight: 700,
};
const flagsBanner: React.CSSProperties = {
  background: '#FFF8E1', border: '1px solid #E8D08A', borderRadius: 10,
  padding: 12, marginBottom: 12,
};
const thCell: React.CSSProperties = {
  padding: '4px 8px', fontWeight: 600, fontSize: 12,
};
const tdCell: React.CSSProperties = {
  padding: '6px 8px', verticalAlign: 'top', fontSize: 12,
};
const codeMono: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#1a1a1a',
};

function sevColor(sev: string): { bg: string; fg: string } {
  const s = (sev || '').toLowerCase();
  if (s === 'severe' || s === 'anaphylaxis' || s === 'high') return { bg: '#fde1e1', fg: '#9a1b1b' };
  if (s === 'moderate') return { bg: '#FFF0C2', fg: '#6b4e00' };
  return { bg: '#E6EDFF', fg: '#0055FF' };
}
