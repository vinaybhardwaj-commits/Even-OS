'use client';

import { useState, useEffect, useCallback } from 'react';
import { PatientIdentityStrip, EmptyState } from '@/components/caregiver';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface PatientRow {
  encounter_id: string;
  patient_id: string;
  encounter_class: string;
  encounter_status: string;
  chief_complaint: string | null;
  primary_diagnosis: string | null;
  ward_id: string | null;
  ward_name: string | null;
  bed_label: string | null;
  admission_datetime: string | null;
  planned_discharge_date: string | null;
  patient_name: string;
  patient_uhid: string;
  patient_gender: string | null;
  patient_dob: string | null;
  news2_score: number;
  news2_risk: string;
  news2_at: string | null;
  allergy_count: number;
  acuity: 'critical' | 'attention' | 'stable';
}

interface SidebarCounts {
  new_admits: number;
  cosign_pending: number;
  labs_pending: number;
  discharge_due: number;
}

interface ContextData {
  vitals: any[];
  labs: any[];
  activeOrders: any[];
  recentNotes: any[];
  problems: any[];
  allergies: any[];
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

// ── Constants ───────────────────────────────────────────────────────────────
const ACUITY_CONFIG = {
  critical: { label: 'CRITICAL', icon: '🔴', bg: '#ffebee', border: '#ef9a9a', text: '#c62828' },
  attention: { label: 'NEEDS ATTENTION', icon: '🟡', bg: '#fff8e1', border: '#ffe082', text: '#f57f17' },
  stable: { label: 'STABLE', icon: '🟢', bg: '#e8f5e9', border: '#a5d6a7', text: '#2e7d32' },
} as const;

const CONSULTANT_ROLES = [
  'visiting_consultant', 'specialist_cardiologist',
  'specialist_neurologist', 'specialist_orthopedic',
];

type SidebarSection = 'overview' | 'newAdmits' | 'cosign' | 'labsPending' | 'discharge';

// ── Component ───────────────────────────────────────────────────────────────
export default function DoctorHomeClient({ userId, userRole, userName }: Props) {
  const isConsultant = CONSULTANT_ROLES.includes(userRole);

  // State
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [counts, setCounts] = useState<SidebarCounts>({ new_admits: 0, cosign_pending: 0, labs_pending: 0, discharge_due: 0 });
  const [wards, setWards] = useState<WardTab[]>([]);
  const [activeWard, setActiveWard] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientRow | null>(null);
  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [activeSidebar, setActiveSidebar] = useState<SidebarSection>('overview');
  const [sidebarData, setSidebarData] = useState<any[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(false);

  // ── Load patient list + sidebar counts ─────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [pts, cnts, wrds] = await Promise.all([
        trpcQuery('doctorDashboard.myPatients', activeWard ? { ward_id: activeWard } : {}),
        trpcQuery('doctorDashboard.sidebarCounts'),
        isConsultant ? trpcQuery('doctorDashboard.myWards') : Promise.resolve([]),
      ]);
      setPatients(pts || []);
      setCounts(cnts || { new_admits: 0, cosign_pending: 0, labs_pending: 0, discharge_due: 0 });
      if (isConsultant && wrds) setWards(wrds);
    } catch (err) {
      console.error('Doctor dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWard, isConsultant]);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Load patient context panel ────────────────────────────────────────
  const selectPatient = useCallback(async (p: PatientRow) => {
    setSelectedPatient(p);
    setContextLoading(true);
    try {
      const data = await trpcQuery('doctorDashboard.patientContext', {
        patient_id: p.patient_id,
        encounter_id: p.encounter_id,
      });
      setContextData(data);
    } catch { setContextData(null); }
    finally { setContextLoading(false); }
  }, []);

  // ── Load sidebar detail ───────────────────────────────────────────────
  const loadSidebarDetail = useCallback(async (section: SidebarSection) => {
    setActiveSidebar(section);
    if (section === 'overview') return;
    setSidebarLoading(true);
    try {
      const endpointMap: Record<string, string> = {
        newAdmits: 'doctorDashboard.newAdmits',
        cosign: 'doctorDashboard.cosignQueue',
        labsPending: 'doctorDashboard.labsPending',
        discharge: 'doctorDashboard.dischargeDue',
      };
      const data = await trpcQuery(endpointMap[section]);
      setSidebarData(data || []);
    } catch { setSidebarData([]); }
    finally { setSidebarLoading(false); }
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────
  const groupedPatients = {
    critical: patients.filter(p => p.acuity === 'critical'),
    attention: patients.filter(p => p.acuity === 'attention'),
    stable: patients.filter(p => p.acuity === 'stable'),
  };

  const formatAge = (dob: string | null) => {
    if (!dob) return '';
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000);
    return `${age}y`;
  };

  const timeAgo = (dt: string | null) => {
    if (!dt) return '';
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
        <p style={{ color: '#666' }}>Loading your patients…</p>
      </div>
    );
  }

  return (
    <div className="caregiver-theme" style={{
      fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh',
      display: 'grid',
      gridTemplateColumns: '1fr 360px',
      gridTemplateRows: 'auto 1fr',
    }}>

      {/* ═══ HEADER ═══════════════════════════════════════════════════════ */}
      <header style={{
        gridColumn: '1 / -1', background: '#fff',
        borderBottom: '1px solid #e0e0e0', padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            🩺 Dr. {userName?.split(' ')[0]}&apos;s Dashboard
          </h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {patients.length} active patient{patients.length !== 1 ? 's' : ''}
            {isConsultant ? ' · Consultant View' : ' · RMO View'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/care/home" style={{
            padding: '6px 14px', fontSize: 13, background: '#f0f0f0',
            borderRadius: 6, textDecoration: 'none', color: '#333',
          }}>⌂ Home</a>
        </div>
      </header>

      {/* ═══ LEFT: PATIENT LIST ═══════════════════════════════════════════ */}
      <main style={{ overflow: 'auto', padding: '16px 20px 100px' }}>

        {/* Ward tabs (consultant only) */}
        {isConsultant && wards.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setActiveWard(null); setLoading(true); }}
              style={{
                padding: '6px 14px', fontSize: 13, borderRadius: 20, border: 'none',
                background: !activeWard ? '#1565c0' : '#e3f2fd',
                color: !activeWard ? '#fff' : '#1565c0',
                fontWeight: 600, cursor: 'pointer',
              }}
            >All Wards ({patients.length})</button>
            {wards.map(w => (
              <button
                key={w.ward_id}
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

        {/* Sidebar action cards (mobile-visible, above patient list) */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { key: 'newAdmits' as SidebarSection, label: 'New Admits', count: counts.new_admits, icon: '🆕', color: '#e91e63' },
            { key: 'cosign' as SidebarSection, label: 'Co-Sign', count: counts.cosign_pending, icon: '✍️', color: '#ff9800' },
            { key: 'labsPending' as SidebarSection, label: 'Labs Pending', count: counts.labs_pending, icon: '🧪', color: '#2196f3' },
            { key: 'discharge' as SidebarSection, label: 'D/C Due', count: counts.discharge_due, icon: '🏥', color: '#4caf50' },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => loadSidebarDetail(item.key)}
              style={{
                flex: '1 1 100px', padding: '10px 12px', borderRadius: 10,
                border: activeSidebar === item.key ? `2px solid ${item.color}` : '1px solid #e0e0e0',
                background: '#fff', cursor: 'pointer', textAlign: 'center',
                minWidth: 80,
              }}
            >
              <div style={{ fontSize: 22 }}>{item.icon}</div>
              <div style={{
                fontSize: 22, fontWeight: 700,
                color: item.count > 0 ? item.color : '#999',
              }}>{item.count}</div>
              <div style={{ fontSize: 11, color: '#666' }}>{item.label}</div>
            </button>
          ))}
        </div>

        {/* Acuity-grouped patient list */}
        {patients.length === 0 ? (
          <EmptyState title="No Active Patients" message="You have no admitted patients assigned to you." icon="🩺" />
        ) : (
          (['critical', 'attention', 'stable'] as const).map(acuity => {
            const group = groupedPatients[acuity];
            if (group.length === 0) return null;
            const cfg = ACUITY_CONFIG[acuity];
            return (
              <div key={acuity} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: cfg.text,
                  padding: '4px 10px', borderRadius: '6px 6px 0 0',
                  background: cfg.bg, borderLeft: `3px solid ${cfg.border}`,
                }}>
                  {cfg.icon} {cfg.label} ({group.length})
                </div>
                {group.map(p => {
                  const isSelected = selectedPatient?.encounter_id === p.encounter_id;
                  return (
                    <div
                      key={p.encounter_id}
                      onClick={() => selectPatient(p)}
                      style={{
                        background: isSelected ? '#e3f2fd' : '#fff',
                        border: `1px solid ${isSelected ? '#90caf9' : '#e0e0e0'}`,
                        borderLeft: `3px solid ${cfg.border}`,
                        borderTop: 'none',
                        padding: '10px 14px', cursor: 'pointer',
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center', gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {p.bed_label && (
                            <span style={{
                              fontSize: 11, fontWeight: 700, background: '#1565c0',
                              color: '#fff', borderRadius: 4, padding: '2px 6px',
                            }}>{p.bed_label}</span>
                          )}
                          <span style={{ fontSize: 15, fontWeight: 600 }}>{p.patient_name}</span>
                          <span style={{ fontSize: 12, color: '#888' }}>
                            {formatAge(p.patient_dob)} {p.patient_gender || ''}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>
                          {p.chief_complaint || p.primary_diagnosis || 'No diagnosis'}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          {p.patient_uhid} · {p.ward_name || 'Unknown ward'}
                          {p.admission_datetime && ` · Adm ${timeAgo(p.admission_datetime)}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 18, fontWeight: 700,
                          color: p.news2_score >= 7 ? '#c62828' : p.news2_score >= 5 ? '#f57f17' : '#2e7d32',
                        }}>
                          {p.news2_score}
                        </div>
                        <div style={{ fontSize: 10, color: '#999' }}>NEWS2</div>
                        {p.allergy_count > 0 && (
                          <div style={{ fontSize: 10, color: '#e91e63', fontWeight: 600, marginTop: 2 }}>
                            ⚠️ {p.allergy_count} allerg{p.allergy_count === 1 ? 'y' : 'ies'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </main>

      {/* ═══ RIGHT: CONTEXT PANEL + SIDEBAR ═══════════════════════════════ */}
      <aside style={{
        borderLeft: '1px solid #e0e0e0', background: '#fff',
        overflow: 'auto', padding: 0,
      }}>
        {/* Sidebar detail view */}
        {activeSidebar !== 'overview' ? (
          <div style={{ padding: 16 }}>
            <button
              onClick={() => { setActiveSidebar('overview'); setSidebarData([]); }}
              style={{
                fontSize: 13, color: '#1565c0', background: 'none',
                border: 'none', cursor: 'pointer', marginBottom: 12, fontWeight: 600,
              }}
            >← Back to patient context</button>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>
              {activeSidebar === 'newAdmits' && '🆕 New Admits (12h)'}
              {activeSidebar === 'cosign' && '✍️ Co-Sign Queue'}
              {activeSidebar === 'labsPending' && '🧪 Labs Pending'}
              {activeSidebar === 'discharge' && '🏥 Discharge Due Today'}
            </h3>

            {sidebarLoading ? (
              <p style={{ color: '#888' }}>Loading…</p>
            ) : sidebarData.length === 0 ? (
              <p style={{ color: '#888', fontSize: 13 }}>No items.</p>
            ) : (
              sidebarData.map((item: any, i: number) => (
                <div key={item.encounter_id || item.note_id || item.order_id || i} style={{
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #e8e8e8', marginBottom: 8,
                  cursor: 'pointer', fontSize: 13,
                }}
                  onClick={() => {
                    const p = patients.find(pt => pt.encounter_id === (item.encounter_id));
                    if (p) { selectPatient(p); setActiveSidebar('overview'); }
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {item.bed_label && <span style={{ color: '#1565c0' }}>[{item.bed_label}] </span>}
                    {item.patient_name || item.author_name || item.test_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    {item.patient_uhid && `${item.patient_uhid} · `}
                    {item.chief_complaint || item.note_type || item.status || ''}
                    {item.ordered_at && ` · Ordered ${timeAgo(item.ordered_at)}`}
                    {item.admission_datetime && ` · Adm ${timeAgo(item.admission_datetime)}`}
                  </div>
                  {item.excerpt && (
                    <div style={{ fontSize: 12, color: '#555', marginTop: 4, fontStyle: 'italic' }}>
                      &ldquo;{item.excerpt.slice(0, 120)}…&rdquo;
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : !selectedPatient ? (
          /* No patient selected */
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 36 }}>👈</p>
            <p style={{ fontWeight: 600, color: '#666' }}>Select a patient</p>
            <p style={{ fontSize: 13, color: '#999' }}>Click any patient to view vitals, labs, orders, and notes.</p>
          </div>
        ) : (
          /* Patient context panel */
          <div style={{ padding: 0 }}>
            {/* Patient identity */}
            <div style={{
              padding: '12px 16px', background: '#f5f7ff',
              borderBottom: '1px solid #e0e0e0',
            }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedPatient.patient_name}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {selectedPatient.patient_uhid} · {formatAge(selectedPatient.patient_dob)} {selectedPatient.patient_gender || ''}
                {selectedPatient.bed_label && ` · Bed ${selectedPatient.bed_label}`}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {selectedPatient.chief_complaint || selectedPatient.primary_diagnosis || 'No diagnosis'}
              </div>
            </div>

            {contextLoading ? (
              <p style={{ padding: 20, color: '#888', textAlign: 'center' }}>Loading context…</p>
            ) : contextData ? (
              <div style={{ padding: '8px 16px' }}>

                {/* Vitals */}
                <ContextSection title="💓 Latest Vitals" count={contextData.vitals.length}>
                  {contextData.vitals.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {contextData.vitals.slice(0, 6).map((v: any, i: number) => (
                        <div key={i} style={{ fontSize: 12, padding: '3px 6px', background: '#fafafa', borderRadius: 4 }}>
                          <span style={{ color: '#888' }}>{formatVitalLabel(v.observation_type)}: </span>
                          <span style={{ fontWeight: 600 }}>{v.value_quantity || v.value_text}{v.unit ? ` ${v.unit}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p style={{ fontSize: 12, color: '#999' }}>No vitals recorded</p>}
                </ContextSection>

                {/* Labs */}
                <ContextSection title="🧪 Recent Labs" count={contextData.labs.length}>
                  {contextData.labs.length > 0 ? (
                    contextData.labs.slice(0, 8).map((l: any, i: number) => (
                      <div key={i} style={{
                        fontSize: 12, padding: '3px 6px', marginBottom: 2,
                        background: l.is_abnormal ? '#fff3e0' : l.is_critical ? '#ffebee' : '#fafafa',
                        borderRadius: 4, display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>{l.test_code || l.test_name}</span>
                        <span style={{ fontWeight: l.is_abnormal || l.is_critical ? 700 : 400, color: l.is_critical ? '#c62828' : l.is_abnormal ? '#e65100' : '#333' }}>
                          {l.result_value || l.order_status}{l.result_unit ? ` ${l.result_unit}` : ''}
                          {l.is_abnormal && ' ↑'}
                        </span>
                      </div>
                    ))
                  ) : <p style={{ fontSize: 12, color: '#999' }}>No lab results</p>}
                </ContextSection>

                {/* Active Orders */}
                <ContextSection title="💊 Active Meds" count={contextData.activeOrders.length}>
                  {contextData.activeOrders.length > 0 ? (
                    contextData.activeOrders.slice(0, 6).map((o: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, padding: '3px 6px', marginBottom: 2 }}>
                        {o.is_high_alert && <span style={{ color: '#c62828' }}>⚠️ </span>}
                        <span style={{ fontWeight: 600 }}>{o.drug_name}</span>
                        <span style={{ color: '#666' }}> {o.dose_quantity}{o.dose_unit} {o.route} {o.frequency_code}</span>
                      </div>
                    ))
                  ) : <p style={{ fontSize: 12, color: '#999' }}>No active medications</p>}
                </ContextSection>

                {/* Problems */}
                <ContextSection title="📋 Problems" count={contextData.problems.length}>
                  {contextData.problems.length > 0 ? (
                    contextData.problems.slice(0, 5).map((pr: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, padding: '2px 6px' }}>
                        {pr.code_display || 'Unknown condition'}
                        {pr.severity && <span style={{ color: '#888' }}> ({pr.severity})</span>}
                      </div>
                    ))
                  ) : <p style={{ fontSize: 12, color: '#999' }}>No active problems</p>}
                </ContextSection>

                {/* Allergies */}
                {contextData.allergies.length > 0 && (
                  <ContextSection title="⚠️ Allergies" count={contextData.allergies.length}>
                    {contextData.allergies.map((a: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, padding: '2px 6px', color: '#c62828' }}>
                        {a.substance} ({a.severity || a.reaction_type || 'unknown'})
                      </div>
                    ))}
                  </ContextSection>
                )}

                {/* Recent Notes */}
                <ContextSection title="📝 Recent Notes" count={contextData.recentNotes.length}>
                  {contextData.recentNotes.length > 0 ? (
                    contextData.recentNotes.map((n: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, padding: '4px 6px', marginBottom: 4, borderLeft: '2px solid #e0e0e0', paddingLeft: 8 }}>
                        <div style={{ fontWeight: 600 }}>{n.author_name} · {n.note_type?.replace(/_/g, ' ')}</div>
                        <div style={{ color: '#666', fontSize: 11 }}>{timeAgo(n.created_at)}</div>
                        {n.excerpt && <div style={{ color: '#555', marginTop: 2, fontStyle: 'italic' }}>&ldquo;{n.excerpt.slice(0, 150)}…&rdquo;</div>}
                      </div>
                    ))
                  ) : <p style={{ fontSize: 12, color: '#999' }}>No notes</p>}
                </ContextSection>

              </div>
            ) : null}
          </div>
        )}
      </aside>

      {/* ═══ BOTTOM TAB BAR (mobile) ═════════════════════════════════════ */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff',
        borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'home', label: 'Patients', icon: '🩺', href: '/care/doctor' },
          { key: 'rounds', label: 'Rounds', icon: '📋', href: '/care/doctor/rounds' },
          { key: 'notes', label: 'Notes', icon: '📝', href: '/care/doctor/note' },
          { key: 'cosign', label: 'Co-Sign', icon: '✍️', href: '/care/doctor/cosign' },
          { key: 'more', label: 'More', icon: '⋯', href: '/care/home' },
        ].map(tab => (
          <a
            key={tab.key}
            href={tab.href}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', padding: '4px 0',
              textDecoration: 'none', fontSize: 10,
              color: tab.key === 'home' ? '#1565c0' : '#888',
              fontWeight: tab.key === 'home' ? 700 : 400,
            }}
          >
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function ContextSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{title}</span>
        {count > 0 && <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>({count})</span>}
      </div>
      {children}
    </div>
  );
}

function formatVitalLabel(type: string): string {
  const map: Record<string, string> = {
    vital_temperature: 'Temp',
    vital_pulse: 'HR',
    vital_bp_systolic: 'SBP',
    vital_bp_diastolic: 'DBP',
    vital_spo2: 'SpO2',
    vital_rr: 'RR',
  };
  return map[type] || type;
}
