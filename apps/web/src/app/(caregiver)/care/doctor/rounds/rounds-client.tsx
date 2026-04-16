'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── tRPC helpers ────────────────────────────────────────────────────────────
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
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface PatientCard {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  patient_gender: string | null;
  patient_dob: string | null;
  bed_label: string | null;
  ward_name: string | null;
  chief_complaint: string | null;
  primary_diagnosis: string | null;
  news2_score: number;
  news2_risk: string;
  acuity: string;
  // Rich context loaded per card
  vitals?: any[];
  labs?: any[];
  activeOrders?: any[];
  recentNotes?: any[];
  problems?: any[];
  needs_decision?: boolean;
}

interface WardTab {
  ward_id: string;
  ward_name: string;
  patient_count: number;
}

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

const CONSULTANT_ROLES = [
  'visiting_consultant', 'specialist_cardiologist',
  'specialist_neurologist', 'specialist_orthopedic',
];

// ── Component ───────────────────────────────────────────────────────────────
export default function RoundsClient({ userId, userRole, userName }: Props) {
  const router = useRouter();
  const isConsultant = CONSULTANT_ROLES.includes(userRole);

  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientCard[]>([]);
  const [wards, setWards] = useState<WardTab[]>([]);
  const [activeWard, setActiveWard] = useState<string | null>(null);
  const [companionOpen, setCompanionOpen] = useState<string | null>(null);
  const [companionText, setCompanionText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // ── Load patients with rich context ───────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [pts, wrds] = await Promise.all([
        trpcQuery('doctorDashboard.myPatients', activeWard ? { ward_id: activeWard } : {}),
        isConsultant ? trpcQuery('doctorDashboard.myWards') : Promise.resolve([]),
      ]);
      if (!pts) { setLoading(false); return; }

      // Enrich each patient with context data
      const enriched = await Promise.all(
        (pts as any[]).map(async (p: any) => {
          const ctx = await trpcQuery('doctorDashboard.patientContext', {
            patient_id: p.patient_id,
            encounter_id: p.encounter_id,
          });

          // Determine "needs decision" flag
          const hasNewLabs = (ctx?.labs || []).some((l: any) => l.is_abnormal || l.is_critical);
          const hasPendingCosign = (ctx?.recentNotes || []).some((n: any) => n.status === 'ready_for_review');
          const hasHighNEWS2 = p.news2_score >= 5;

          return {
            ...p,
            vitals: ctx?.vitals || [],
            labs: ctx?.labs || [],
            activeOrders: ctx?.activeOrders || [],
            recentNotes: ctx?.recentNotes || [],
            problems: ctx?.problems || [],
            needs_decision: hasNewLabs || hasPendingCosign || hasHighNEWS2,
          };
        })
      );

      setPatients(enriched);
      if (isConsultant && wrds) setWards(wrds);
    } catch (err) {
      console.error('Rounds load error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWard, isConsultant]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Save companion note ───────────────────────────────────────────────
  const saveCompanionNote = async (patient: PatientCard) => {
    if (!companionText.trim()) return;
    setSaving(true);
    try {
      await trpcMutate('clinicalNotes.createNursing', {
        patient_id: patient.patient_id,
        encounter_id: patient.encounter_id,
        shift_summary: `[Rounds Companion] ${companionText.trim()}`,
        pain_assessment: 'N/A — companion note',
      });
      setSaveSuccess(patient.encounter_id);
      setCompanionText('');
      setCompanionOpen(null);
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err) {
      alert('Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const formatAge = (dob: string | null) => {
    if (!dob) return '';
    return `${Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000)}y`;
  };

  const timeAgo = (dt: string | null) => {
    if (!dt) return '';
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  const formatVital = (type: string) => {
    const m: Record<string, string> = {
      vital_temperature: 'T', vital_pulse: 'HR', vital_bp_systolic: 'SBP',
      vital_bp_diastolic: 'DBP', vital_spo2: 'SpO2', vital_rr: 'RR',
    };
    return m[type] || type;
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
        <p style={{ color: '#666' }}>Loading rounds…</p>
      </div>
    );
  }

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>📋 Rounds View</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {patients.length} patient{patients.length !== 1 ? 's' : ''}
            {patients.filter(p => p.needs_decision).length > 0 &&
              ` · ${patients.filter(p => p.needs_decision).length} need decision`}
          </p>
        </div>
      </header>

      {/* ── Ward tabs (consultant) ─────────────────────────────────────── */}
      {isConsultant && wards.length > 1 && (
        <div style={{ padding: '8px 24px', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', gap: 6 }}>
          <button
            onClick={() => { setActiveWard(null); setLoading(true); }}
            style={{
              padding: '6px 14px', fontSize: 13, borderRadius: 20, border: 'none',
              background: !activeWard ? '#1565c0' : '#e3f2fd', color: !activeWard ? '#fff' : '#1565c0',
              fontWeight: 600, cursor: 'pointer',
            }}
          >All Wards</button>
          {wards.map(w => (
            <button key={w.ward_id}
              onClick={() => { setActiveWard(w.ward_id); setLoading(true); }}
              style={{
                padding: '6px 14px', fontSize: 13, borderRadius: 20, border: 'none',
                background: activeWard === w.ward_id ? '#1565c0' : '#e3f2fd',
                color: activeWard === w.ward_id ? '#fff' : '#1565c0',
                fontWeight: 600, cursor: 'pointer',
              }}
            >{w.ward_name} ({w.patient_count})</button>
          ))}
        </div>
      )}

      {/* ── Patient cards ──────────────────────────────────────────────── */}
      <div style={{ padding: '16px 24px 100px', maxWidth: 1200, margin: '0 auto' }}>
        {patients.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 36 }}>📋</p>
            <p style={{ fontWeight: 600 }}>No Patients for Rounds</p>
            <p style={{ color: '#888' }}>No active patients assigned to you.</p>
          </div>
        ) : (
          patients.map(p => (
            <div key={p.encounter_id} style={{
              background: '#fff', borderRadius: 12,
              border: p.needs_decision ? '2px solid #ff9800' : '1px solid #e0e0e0',
              marginBottom: 16, overflow: 'hidden',
            }}>
              {/* "Needs decision" banner */}
              {p.needs_decision && (
                <div style={{
                  background: '#fff3e0', padding: '4px 16px',
                  fontSize: 12, fontWeight: 600, color: '#e65100',
                }}>
                  ⚡ Needs your decision — new labs, pending co-sign, or escalation
                </div>
              )}

              {/* Card header */}
              <div style={{
                padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', borderBottom: '1px solid #f0f0f0',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {p.bed_label && (
                    <span style={{
                      fontSize: 13, fontWeight: 700, background: '#1565c0',
                      color: '#fff', borderRadius: 6, padding: '3px 10px',
                    }}>{p.bed_label}</span>
                  )}
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{p.patient_name}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {p.patient_uhid} · {formatAge(p.patient_dob)} {p.patient_gender || ''}
                      · {p.chief_complaint || p.primary_diagnosis || 'No diagnosis'}
                    </div>
                  </div>
                </div>
                <div style={{
                  textAlign: 'center', padding: '4px 12px', borderRadius: 8,
                  background: p.news2_score >= 7 ? '#ffebee' : p.news2_score >= 5 ? '#fff8e1' : '#e8f5e9',
                }}>
                  <div style={{
                    fontSize: 22, fontWeight: 700,
                    color: p.news2_score >= 7 ? '#c62828' : p.news2_score >= 5 ? '#f57f17' : '#2e7d32',
                  }}>{p.news2_score}</div>
                  <div style={{ fontSize: 10, color: '#999' }}>NEWS2</div>
                </div>
              </div>

              {/* Card body: 4-column layout */}
              <div className="dash-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>

                {/* Key Labs (24h) */}
                <div style={{ padding: '10px 14px', borderRight: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 4 }}>🧪 KEY LABS</div>
                  {(p.labs || []).slice(0, 4).map((l: any, i: number) => (
                    <div key={i} style={{
                      fontSize: 12, marginBottom: 2,
                      fontWeight: l.is_abnormal || l.is_critical ? 700 : 400,
                      color: l.is_critical ? '#c62828' : l.is_abnormal ? '#e65100' : '#333',
                    }}>
                      {l.test_code || l.test_name}: {l.result_value || l.order_status}
                      {l.result_unit ? ` ${l.result_unit}` : ''}
                      {l.is_abnormal && '↑'}
                      {l.reference_range && <span style={{ color: '#aaa', fontSize: 10 }}> ({l.reference_range})</span>}
                    </div>
                  ))}
                  {(!p.labs || p.labs.length === 0) && <div style={{ fontSize: 11, color: '#ccc' }}>No results</div>}
                </div>

                {/* Vitals (latest) */}
                <div style={{ padding: '10px 14px', borderRight: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 4 }}>💓 VITALS</div>
                  {(p.vitals || []).slice(0, 6).map((v: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 1 }}>
                      <span style={{ color: '#888' }}>{formatVital(v.observation_type)}: </span>
                      <span style={{ fontWeight: 600 }}>{v.value_quantity || v.value_text}{v.unit ? ` ${v.unit}` : ''}</span>
                    </div>
                  ))}
                  {(!p.vitals || p.vitals.length === 0) && <div style={{ fontSize: 11, color: '#ccc' }}>No vitals</div>}
                </div>

                {/* Active Issues + Orders */}
                <div style={{ padding: '10px 14px', borderRight: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 4 }}>📋 ACTIVE ISSUES</div>
                  {(p.problems || []).slice(0, 3).map((pr: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 1 }}>
                      {i + 1}. {pr.code_display}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginTop: 6, marginBottom: 4 }}>💊 ORDERS ({(p.activeOrders || []).length})</div>
                  {(p.activeOrders || []).slice(0, 3).map((o: any, i: number) => (
                    <div key={i} style={{ fontSize: 11, marginBottom: 1 }}>
                      {o.is_high_alert && '⚠️ '}{o.drug_name} {o.dose_quantity}{o.dose_unit}
                    </div>
                  ))}
                </div>

                {/* Resident's latest note */}
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 4 }}>📝 LATEST NOTE</div>
                  {(p.recentNotes ?? []).length > 0 ? (() => {
                    const note = (p.recentNotes ?? [])[0];
                    return (
                      <div>
                        <div style={{ fontSize: 11, color: '#666' }}>
                          {note.author_name} · {timeAgo(note.created_at)}
                        </div>
                        <div style={{ fontSize: 12, marginTop: 2, fontStyle: 'italic', color: '#555' }}>
                          &ldquo;{(note.excerpt || '').slice(0, 120)}…&rdquo;
                        </div>
                      </div>
                    );
                  })() : <div style={{ fontSize: 11, color: '#ccc' }}>No notes today</div>}
                </div>
              </div>

              {/* Card actions */}
              <div style={{
                padding: '8px 14px', borderTop: '1px solid #f0f0f0',
                display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <button onClick={() => router.push(`/care/doctor/note?encounter=${p.encounter_id}&patient=${p.patient_id}`)}
                  style={actionBtnStyle('#1565c0')}>📝 Add Note</button>
                <button onClick={() => { setCompanionOpen(companionOpen === p.encounter_id ? null : p.encounter_id); setCompanionText(''); }}
                  style={actionBtnStyle('#7b1fa2')}>💬 Quick Note</button>
                <button onClick={() => router.push(`/care/doctor/cosign`)}
                  style={actionBtnStyle('#e65100')}>📋 Co-sign</button>
                {saveSuccess === p.encounter_id && (
                  <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>✅ Saved</span>
                )}
              </div>

              {/* Companion note input */}
              {companionOpen === p.encounter_id && (
                <div style={{ padding: '8px 14px 14px', background: '#f9f0ff', borderTop: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#7b1fa2', marginBottom: 6 }}>
                    💬 Rounds Companion — quick capture
                  </div>
                  <textarea
                    value={companionText}
                    onChange={e => setCompanionText(e.target.value)}
                    placeholder={`Dr. ${userName?.split(' ')[0]} said: ...`}
                    rows={2}
                    style={{
                      width: '100%', padding: 8, fontSize: 13, borderRadius: 6,
                      border: '1px solid #d0d0d0', fontFamily: 'system-ui', resize: 'vertical',
                    }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => saveCompanionNote(p)}
                      disabled={saving || !companionText.trim()}
                      style={{
                        padding: '6px 16px', fontSize: 13, fontWeight: 600,
                        background: saving || !companionText.trim() ? '#ccc' : '#7b1fa2',
                        color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                      }}
                    >{saving ? 'Saving…' : 'Save'}</button>
                    <button
                      onClick={() => { setCompanionOpen(null); setCompanionText(''); }}
                      style={{ padding: '6px 12px', fontSize: 13, background: '#f0f0f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Bottom Tab Bar ──────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'home', label: 'Patients', icon: '🩺', href: '/care/doctor' },
          { key: 'rounds', label: 'Rounds', icon: '📋', href: '/care/doctor/rounds' },
          { key: 'notes', label: 'Notes', icon: '📝', href: '/care/doctor/note' },
          { key: 'cosign', label: 'Co-Sign', icon: '✍️', href: '/care/doctor/cosign' },
          { key: 'more', label: 'More', icon: '⋯', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'rounds' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'rounds' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
function actionBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    background: `${color}15`, color, border: `1px solid ${color}40`,
    borderRadius: 6, cursor: 'pointer',
  };
}
