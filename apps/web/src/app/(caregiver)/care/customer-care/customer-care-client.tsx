'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/caregiver';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Constants ───────────────────────────────────────────────────────────────
const JOURNEY_STAGES = [
  { key: 'lead', label: 'LEAD', color: '#90caf9' },
  { key: 'tele', label: 'TELE', color: '#80cbc4' },
  { key: 'opd', label: 'OPD', color: '#a5d6a7' },
  { key: 'pre_adm', label: 'PRE-ADM', color: '#fff59d' },
  { key: 'adm', label: 'ADM', color: '#ffe082' },
  { key: 'pre_op', label: 'PRE-OP', color: '#ffcc80' },
  { key: 'surg', label: 'SURG', color: '#ef9a9a' },
  { key: 'post_op', label: 'POST-OP', color: '#f48fb1' },
  { key: 'rehab', label: 'REHAB', color: '#ce93d8' },
  { key: 'dc', label: 'DC', color: '#b39ddb' },
  { key: 'post_dc', label: 'POST-DC', color: '#9fa8da' },
] as const;

type StageKey = typeof JOURNEY_STAGES[number]['key'];
type FilterKey = 'all' | 'at_risk' | 'discharge_today' | 'new_admits' | 'long_stay' | 'follow_up';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'at_risk', label: 'At Risk' },
  { key: 'discharge_today', label: 'Discharge Today' },
  { key: 'new_admits', label: 'New Admits' },
  { key: 'long_stay', label: 'Long Stay >5d' },
  { key: 'follow_up', label: 'Post-DC Follow-up' },
];

interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function mapEncounterToStage(enc: any): StageKey {
  const status = enc.status || enc.encounter_status || '';
  const hasOT = enc.has_ot_schedule;
  const discharged = status === 'discharged' || status === 'completed';
  if (discharged) return 'post_dc';
  if (status === 'discharge_initiated') return 'dc';
  if (enc.discharge_initiated) return 'dc';
  if (hasOT && enc.ot_completed) return 'post_op';
  if (hasOT && enc.ot_in_progress) return 'surg';
  if (hasOT) return 'pre_op';
  if (status === 'in_progress' || status === 'admitted') return 'adm';
  if (status === 'pre_admission') return 'pre_adm';
  return 'lead';
}

function daysIn(dt: string | null): number {
  if (!dt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dt).getTime()) / 86400000));
}

// ── Component ───────────────────────────────────────────────────────────────
export default function CustomerCareClient({ userId, userRole, userName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [encounters, setEncounters] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [dischargeQueue, setDischargeQueue] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [claims, setClaims] = useState<any[]>([]);

  // ── Load data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [enc, st, dq, cl] = await Promise.all([
        trpcQuery('encounter.listActive'),
        trpcQuery('encounter.stats'),
        trpcQuery('encounter.dischargeQueue'),
        trpcQuery('insuranceClaims.claimStats'),
      ]);
      // encounter.listActive returns { items, total, ... } or plain array
      const encItems = Array.isArray(enc) ? enc : (enc?.items || []);
      setEncounters(encItems);
      setStats(st);
      // encounter.dischargeQueue returns { items, total, ... } or plain array
      const dqItems = Array.isArray(dq) ? dq : (dq?.items || [])
      setDischargeQueue(dqItems);
      setClaims(cl);
    } catch (err) {
      console.error('CC load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // ── Build patient journey map ─────────────────────────────────────────
  const patientsWithStage = encounters.map(enc => ({
    ...enc,
    stage: mapEncounterToStage(enc),
    los_days: daysIn(enc.admission_datetime || enc.admission_at || enc.created_at),
  }));

  // ── Filter ────────────────────────────────────────────────────────────
  const filtered = patientsWithStage.filter(p => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'at_risk') return p.los_days > 5 || p.stage === 'dc';
    if (activeFilter === 'discharge_today') return p.stage === 'dc' || p.planned_discharge_date?.startsWith(new Date().toISOString().slice(0, 10));
    if (activeFilter === 'new_admits') return p.los_days <= 1 && (p.stage === 'adm' || p.stage === 'pre_adm');
    if (activeFilter === 'long_stay') return p.los_days > 5;
    if (activeFilter === 'follow_up') return p.stage === 'post_dc';
    return true;
  });

  // Group by stage
  const stageGroups: Record<StageKey, any[]> = {} as any;
  JOURNEY_STAGES.forEach(s => { stageGroups[s.key] = []; });
  filtered.forEach(p => {
    const s = p.stage as StageKey;
    if (stageGroups[s]) stageGroups[s].push(p);
  });

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}><p style={{ color: '#666' }}>Loading patient journey…</p></div>;
  }

  return (
    <div className="caregiver-theme" style={{ fontFamily: 'system-ui', background: '#f5f6fa', minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e0e0e0',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>🏥 Customer Care — Patient Journey</h1>
          <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
            {encounters.length} active patients · {dischargeQueue.length} pending discharge
          </p>
        </div>
      </header>

      {/* KPI Bar */}
      <div style={{
        display: 'flex', gap: 10, padding: '12px 24px', background: '#fff',
        borderBottom: '1px solid #eee', flexWrap: 'wrap',
      }}>
        {[
          { label: 'Active Patients', value: encounters.length, icon: '👥', color: '#1565c0' },
          { label: 'Avg LOS', value: (() => {
            const withLos = patientsWithStage.filter(p => p.los_days > 0);
            if (withLos.length === 0) return 'N/A';
            const avg = withLos.reduce((s, p) => s + p.los_days, 0) / withLos.length;
            return `${Math.round(avg)}d`;
          })(), icon: '📊', color: '#7b1fa2' },
          { label: 'Discharges Today', value: dischargeQueue.length, icon: '🏥', color: '#2e7d32' },
          { label: 'Pending Admits', value: patientsWithStage.filter(p => p.stage === 'pre_adm').length, icon: '📋', color: '#e65100' },
          { label: 'Escalations', value: patientsWithStage.filter(p => p.los_days > 5).length, icon: '⚠️', color: '#c62828' },
        ].map(kpi => (
          <div key={kpi.label} style={{
            flex: '1 1 150px', padding: '10px 14px', borderRadius: 8,
            border: '1px solid #e0e0e0', background: '#fafafa', textAlign: 'center',
          }}>
            <div style={{ fontSize: 22 }}>{kpi.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 24px', flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setActiveFilter(f.key)} style={{
            padding: '5px 14px', fontSize: 12, borderRadius: 20, border: 'none',
            background: activeFilter === f.key ? '#1565c0' : '#e3f2fd',
            color: activeFilter === f.key ? '#fff' : '#1565c0',
            fontWeight: 600, cursor: 'pointer',
          }}>{f.label}</button>
        ))}
      </div>

      {/* Content: Gantt + Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedPatient ? '1fr 380px' : '1fr' }}>

        {/* ═══ GANTT BOARD ═══ */}
        <div style={{ padding: '8px 24px 100px', overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyState title="No Patients" message="No patients match the selected filter." icon="🏥" />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${JOURNEY_STAGES.length}, minmax(90px, 1fr))`,
              gap: 4,
            }}>
              {/* Stage headers */}
              {JOURNEY_STAGES.map(s => (
                <div key={s.key} style={{
                  textAlign: 'center', padding: '6px 4px', fontSize: 11, fontWeight: 700,
                  background: s.color, borderRadius: '6px 6px 0 0', color: '#333',
                }}>
                  {s.label}
                  <div style={{ fontSize: 10, fontWeight: 400, color: '#555' }}>
                    ({stageGroups[s.key].length})
                  </div>
                </div>
              ))}

              {/* Patient cards per stage column */}
              {JOURNEY_STAGES.map(s => (
                <div key={`col-${s.key}`} style={{
                  background: `${s.color}22`, borderRadius: '0 0 6px 6px',
                  padding: 4, minHeight: 80,
                }}>
                  {stageGroups[s.key].map((p: any) => {
                    const isLong = p.los_days > 5;
                    const isSelected = selectedPatient?.id === p.id;
                    return (
                      <div key={p.id} onClick={() => setSelectedPatient(p)} style={{
                        background: isSelected ? '#e3f2fd' : isLong ? '#fff3e0' : '#fff',
                        border: `1px solid ${isLong ? '#ffcc80' : isSelected ? '#90caf9' : '#e0e0e0'}`,
                        borderRadius: 6, padding: '6px 8px', marginBottom: 4, cursor: 'pointer',
                        fontSize: 11,
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>
                          {p.patient_name || p.name_full || 'Patient'}
                        </div>
                        <div style={{ color: '#666' }}>
                          {p.bed_label || p.bed_code || p.bed_name || p.ward_name || ''}
                        </div>
                        {isLong && (
                          <div style={{ color: '#e65100', fontWeight: 600, marginTop: 2 }}>
                            ⚠️ {p.los_days}d
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ RIGHT PANEL ═══ */}
        {selectedPatient && (
          <aside style={{
            borderLeft: '1px solid #e0e0e0', background: '#fff',
            padding: 16, overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>📋 Patient Detail</h3>
              <button onClick={() => setSelectedPatient(null)} style={{
                background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#999',
              }}>✕</button>
            </div>

            <div style={{ fontSize: 13 }}>
              <p><strong>Name:</strong> {selectedPatient.patient_name || selectedPatient.name_full}</p>
              <p><strong>UHID:</strong> {selectedPatient.uhid || selectedPatient.patient_uhid || 'N/A'}</p>
              <p><strong>Bed:</strong> {selectedPatient.bed_label || selectedPatient.bed_code || selectedPatient.bed_name || 'Not assigned'}</p>
              <p><strong>Ward:</strong> {selectedPatient.ward_name || 'N/A'}</p>
              <p><strong>Stage:</strong> <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                background: JOURNEY_STAGES.find(s => s.key === selectedPatient.stage)?.color || '#eee',
              }}>{JOURNEY_STAGES.find(s => s.key === selectedPatient.stage)?.label || selectedPatient.stage}</span></p>
              <p><strong>LOS:</strong> {selectedPatient.los_days} day{selectedPatient.los_days !== 1 ? 's' : ''}</p>
              <p><strong>Diagnosis:</strong> {selectedPatient.chief_complaint || selectedPatient.primary_diagnosis || 'N/A'}</p>
              <p><strong>Doctor:</strong> {selectedPatient.attending_doctor_name || 'Not assigned'}</p>
              <p><strong>Admission:</strong> {(selectedPatient.admission_datetime || selectedPatient.admission_at) ? new Date(selectedPatient.admission_datetime || selectedPatient.admission_at).toLocaleDateString('en-IN') : 'N/A'}</p>
              {selectedPatient.planned_discharge_date && (
                <p><strong>Planned D/C:</strong> {new Date(selectedPatient.planned_discharge_date).toLocaleDateString('en-IN')}</p>
              )}
            </div>

            {/* Quick actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
              <button style={ccBtnStyle('#1565c0')}>📋 View Full Journey</button>
              <button style={ccBtnStyle('#7b1fa2')}>💰 View Financials</button>
              <button style={ccBtnStyle('#e65100')}>⚠️ Escalate</button>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#fff', borderTop: '1px solid #e0e0e0',
        zIndex: 30, padding: '6px 0 env(safe-area-inset-bottom)',
      }}>
        {[
          { key: 'journey', label: 'Journey', icon: '🏥', href: '/care/customer-care' },
          { key: 'home', label: 'Home', icon: '⌂', href: '/care/home' },
        ].map(tab => (
          <a key={tab.key} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '4px 0', textDecoration: 'none', fontSize: 10,
            color: tab.key === 'journey' ? '#1565c0' : '#888',
            fontWeight: tab.key === 'journey' ? 700 : 400,
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function ccBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '8px 0', fontSize: 13, fontWeight: 600,
    background: `${color}15`, color, border: `1px solid ${color}40`,
    borderRadius: 6, cursor: 'pointer',
  };
}
