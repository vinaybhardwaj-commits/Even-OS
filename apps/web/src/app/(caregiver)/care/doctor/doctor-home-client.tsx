'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── tRPC helpers ─────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ─────────────────────────────────────────────────────
interface Bed {
  id: string;
  code: string;
  name: string;
  bed_status: string;
  patient_id: string | null;
  patient_uhid: string | null;
  patient_name: string | null;
  patient_gender: string | null;
  encounter_id: string | null;
  encounter_class: string | null;
  admission_at: string | null;
  diagnosis: string | null;
}
interface Ward { ward_id: string; ward_code: string; ward_name: string; ward_capacity: number; beds: Bed[]; }
interface BedStats { total: number; occupied: number; available: number; maintenance: number; }

interface NewAdmit {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  patient_uhid: string;
  gender: string | null;
  dob: string | null;
  chief_complaint: string | null;
  preliminary_diagnosis_icd10: string | null;
  admission_at: string;
  encounter_class: string;
  ward_name: string | null;
  attending_name: string | null;
}
interface CriticalPatient extends NewAdmit {
  news2_score: number;
  news2_at: string;
}
interface SidebarCounts {
  new_admits?: number;
  cosign_pending?: number;
  labs_pending?: number;
  discharge_due?: number;
}
interface Props { userId: string; userName: string; userRole: string; }

// ── Helpers ─────────────────────────────────────────────────
function calcAge(dob: string | null): number {
  if (!dob) return 0;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}
function timeAgo(ts: string | null): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
function daysSince(ts: string | null): string {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
  return `Day ${diff + 1}`;
}
function bedColor(bed: Bed): string {
  if (!bed.encounter_id) {
    if (bed.bed_status === 'maintenance' || bed.bed_status === 'out_of_service') return '#9ca3af';
    return '#22c55e';
  }
  if (bed.encounter_class === 'emergency' || bed.encounter_class === 'icu') return '#dc2626';
  return '#3b82f6';
}
function formatTime(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m} ${ampm}`;
}
function news2Color(score: number): string {
  if (score >= 7) return '#dc2626';
  if (score >= 5) return '#f97316';
  if (score >= 3) return '#f59e0b';
  return '#22c55e';
}

function openPatientChat(encounterId: string) {
  window.dispatchEvent(new CustomEvent('open-patient-chat', {
    detail: { channelId: `patient-${encounterId}` },
  }));
}


export default function DoctorHomeClient({ userId, userName, userRole }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [wards, setWards] = useState<Ward[]>([]);
  const [bedStats, setBedStats] = useState<BedStats | null>(null);
  const [selectedWard, setSelectedWard] = useState('');
  const [overview, setOverview] = useState<{
    admitted_count: number;
    new_admits: NewAdmit[];
    critical_patients: CriticalPatient[];
  } | null>(null);
  const [sidebar, setSidebar] = useState<SidebarCounts>({});
  const [now, setNow] = useState(new Date());

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const displayTitle = userName?.toLowerCase().startsWith('dr') ? userName : `Dr. ${userName}`;
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [boardData, statsData, overviewData, sidebarData] = await Promise.all([
        trpcQuery('bed.board', {}),
        trpcQuery('bed.stats'),
        trpcQuery('doctorDashboard.hospitalOverview'),
        trpcQuery('doctorDashboard.sidebarCounts').catch(() => ({})),
      ]);

      const flat: Ward[] = [];
      for (const floor of boardData?.floors || []) {
        for (const w of floor.wards || []) {
          const beds: Bed[] = [];
          for (const r of w.rooms || []) {
            for (const b of r.beds || []) {
              beds.push({
                id: b.id, code: b.code, name: b.name, bed_status: b.bed_status,
                patient_id: b.patient_id || null,
                patient_uhid: b.patient_uhid || null,
                patient_name: b.patient_name || null,
                patient_gender: b.patient_gender || null,
                encounter_id: b.encounter_id || null,
                encounter_class: b.encounter_class || null,
                admission_at: b.admission_at || null,
                diagnosis: b.chief_complaint || b.diagnosis || null,
              });
            }
          }
          flat.push({
            ward_id: w.id, ward_code: w.code, ward_name: w.name,
            ward_capacity: w.capacity ?? beds.length, beds,
          });
        }
      }
      setWards(flat);

      const g = statsData?.global;
      setBedStats(g ? {
        total: g.total ?? 0, available: g.available ?? 0,
        occupied: g.occupied ?? 0, maintenance: g.maintenance ?? 0,
      } : null);

      setOverview(overviewData || { admitted_count: 0, new_admits: [], critical_patients: [] });
      setSidebar(sidebarData || {});
    } catch (err) {
      console.error('Doctor home load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const iv = setInterval(loadData, 60_000);
    return () => clearInterval(iv);
  }, [loadData]);

  const visibleWards = useMemo(() => {
    if (!selectedWard) return wards;
    return wards.filter(w => w.ward_code === selectedWard);
  }, [wards, selectedWard]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await trpcQuery('patient.search', { query: searchQuery.trim(), limit: 15 });
        setSearchResults(Array.isArray(res) ? res : []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>🩺</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Loading hospital overview…</div>
        </div>
      </div>
    );
  }

  const critical = overview?.critical_patients || [];
  const newAdmits = overview?.new_admits || [];

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px 20px' }}>
      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e5e7eb',
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>
            {greeting}, {displayTitle}
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {formatTime(now)} · {userRole}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setSearchOpen(true); setSearchQuery(''); }}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', cursor: 'pointer',
            }}
          >🔍 Patient Search</button>
          <Link href="/care/doctor/cosign" style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: (sidebar.cosign_pending ?? 0) > 0 ? '#fef3c7' : '#f3f4f6',
            color: (sidebar.cosign_pending ?? 0) > 0 ? '#92400e' : '#374151',
            textDecoration: 'none', border: `1px solid ${(sidebar.cosign_pending ?? 0) > 0 ? '#fcd34d' : '#e5e7eb'}`,
          }}>
            ✍️ Co-Sign {(sidebar.cosign_pending ?? 0) > 0 ? `(${sidebar.cosign_pending})` : ''}
          </Link>
          <Link href="/care/doctor/rounds" style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: '#f3f4f6', color: '#374151', textDecoration: 'none', border: '1px solid #e5e7eb',
          }}>📋 Ward Rounds</Link>
        </div>
      </div>

      {/* ── STATS STRIP ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Admitted Patients', value: overview?.admitted_count ?? 0, color: '#3b82f6', icon: '🏥' },
          { label: 'New Admits (24h)', value: newAdmits.length, color: '#8b5cf6', icon: '🆕' },
          { label: 'Critical (NEWS2 ≥ 5)', value: critical.length, color: '#dc2626', icon: '⚠️' },
          { label: 'Labs Pending', value: sidebar.labs_pending ?? 0, color: '#f59e0b', icon: '🧪' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e5e7eb',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ fontSize: 24 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── WARD BED GRID ── */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>🛏️ Ward Bed Grid</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={selectedWard}
              onChange={(e) => setSelectedWard(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 13, border: '1px solid #d1d5db', background: '#fff', color: '#374151' }}
            >
              <option value="">All Wards</option>
              {wards.map(w => (
                <option key={w.ward_code} value={w.ward_code}>{w.ward_name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#6b7280' }}>
              <span>🟢 Available</span>
              <span>🔵 Occupied</span>
              <span>🔴 Emergency/ICU</span>
              <span>⚪ Maintenance</span>
            </div>
          </div>
        </div>

        {visibleWards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>No ward data available.</div>
        ) : (
          visibleWards.map(ward => (
            <div key={ward.ward_id} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                {ward.ward_name}
                <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>
                  {ward.beds.filter(b => b.encounter_id).length}/{ward.beds.length} occupied
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {ward.beds.map(bed => {
                  const bg = bedColor(bed);
                  const has = !!bed.encounter_id;
                  return (
                    <div
                      key={bed.id}
                      onClick={() => { if (has && bed.patient_id) router.push(`/care/patient/${bed.patient_id}`); }}
                      title={has
                        ? `${bed.patient_name} (${bed.patient_uhid})\n${bed.diagnosis || 'No diagnosis'}\n${daysSince(bed.admission_at)}`
                        : `${bed.name} — ${bed.bed_status}`
                      }
                      style={{
                        background: bg + '18', border: `2px solid ${bg}`, borderRadius: 8, padding: 8,
                        textAlign: 'center', cursor: has ? 'pointer' : 'default',
                        transition: 'transform 0.1s', minHeight: 72,
                        display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      }}
                      onMouseEnter={(e) => has && (e.currentTarget.style.transform = 'scale(1.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: bg, marginBottom: 2 }}>{bed.code}</div>
                      {has ? (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {bed.patient_name?.split(' ').slice(0, 2).join(' ') || ''}
                          </div>
                          <div style={{ fontSize: 10, color: '#6b7280' }}>{bed.patient_uhid}</div>
                          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{daysSince(bed.admission_at)}</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 10, color: '#9ca3af' }}>{bed.bed_status}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── BOTTOM TWO COLUMNS: CRITICAL + NEW ADMITS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>
            ⚠️ Needs Attention <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>· NEWS2 ≥ 5</span>
          </h2>
          {critical.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No critical patients.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {critical.map(p => (
                <div
                  key={p.encounter_id}
                  style={{
                    padding: 12, background: '#fef2f2', borderLeft: `4px solid ${news2Color(p.news2_score)}`,
                    borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <Link
                    href={`/care/patient/${p.patient_id}`}
                    style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                  >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{p.patient_name}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {p.patient_uhid} · {p.ward_name || 'Ward ?'} · {calcAge(p.dob)}{p.gender?.charAt(0).toUpperCase() || ''}
                    </div>
                    {p.chief_complaint && (
                      <div style={{ fontSize: 11, color: '#475467', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.chief_complaint}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: news2Color(p.news2_score), lineHeight: 1 }}>{p.news2_score}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const }}>NEWS2</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{timeAgo(p.news2_at)}</div>
                  </div>
                  </Link>
                  <button
                    onClick={() => openPatientChat(p.encounter_id)}
                    title="Open patient chat"
                    style={{
                      flexShrink: 0, width: 32, height: 32,
                      background: 'white', border: '1px solid #d0d5dd', borderRadius: 8,
                      cursor: 'pointer', fontSize: 14, lineHeight: 1,
                    }}
                  >💬</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>
            🆕 Recently Admitted <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>· last 24h</span>
          </h2>
          {newAdmits.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No new admissions in the last 24h.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {newAdmits.slice(0, 12).map(p => (
                <div
                  key={p.encounter_id}
                  style={{
                    padding: 12, background: '#eff6ff', borderLeft: '4px solid #3b82f6',
                    borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <Link
                    href={`/care/patient/${p.patient_id}`}
                    style={{ textDecoration: 'none', color: 'inherit', flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}
                  >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{p.patient_name}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {p.patient_uhid} · {p.ward_name || 'Ward ?'} · {calcAge(p.dob)}{p.gender?.charAt(0).toUpperCase() || ''}
                    </div>
                    {p.chief_complaint && (
                      <div style={{ fontSize: 12, color: '#475467', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.chief_complaint}
                      </div>
                    )}
                    {p.attending_name && (
                      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>Attending: {p.attending_name}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 11, color: '#6b7280' }}>
                    {timeAgo(p.admission_at)}
                  </div>
                  </Link>
                  <button
                    onClick={() => openPatientChat(p.encounter_id)}
                    title="Open patient chat"
                    style={{
                      flexShrink: 0, width: 32, height: 32,
                      background: 'white', border: '1px solid #d0d5dd', borderRadius: 8,
                      cursor: 'pointer', fontSize: 14, lineHeight: 1,
                    }}
                  >💬</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── SEARCH MODAL ── */}
      {searchOpen && (
        <div
          onClick={() => setSearchOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: '10vh', zIndex: 1000,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'white', borderRadius: 12, width: '90%', maxWidth: 560,
            maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          }}>
            <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by UHID, name, or phone…"
                style={{ width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d0d5dd', borderRadius: 8, outline: 'none' }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {searching && <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Searching…</div>}
              {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No results.</div>
              )}
              {searchResults.map((r: any) => (
                <Link
                  key={r.id}
                  href={`/care/patient/${r.id}`}
                  onClick={() => setSearchOpen(false)}
                  style={{ display: 'block', padding: '10px 16px', textDecoration: 'none', color: 'inherit', borderBottom: '1px solid #f3f4f6' }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{r.name_full || r.full_name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {r.uhid} {r.dob ? `· ${calcAge(r.dob)} yrs` : ''} {r.phone_number ? `· ${r.phone_number}` : r.phone ? `· ${r.phone}` : ''}
                  </div>
                </Link>
              ))}
            </div>
            <div style={{ padding: '8px 16px', borderTop: '1px solid #e5e7eb', fontSize: 11, color: '#9ca3af' }}>
              Esc to close · {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
