'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ── tRPC helpers ─────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ────────────────────────────────────────────────────
interface Bed {
  id: string;
  code: string;
  name: string;
  bed_status: string;
  patient_uhid: string | null;
  patient_name: string | null;
  patient_gender: string | null;
  encounter_id: string | null;
  encounter_class: string | null;
  admission_at: string | null;
  diagnosis: string | null;
}

interface Ward {
  ward_id: string;
  ward_code: string;
  ward_name: string;
  ward_capacity: number;
  beds: Bed[];
}

interface MyPatient {
  assignment: {
    id: string;
    patient_id: string;
    encounter_id: string;
    bed_label: string | null;
    status: string;
  };
  patient_name: string;
  patient_uhid: string;
  patient_gender: string | null;
  patient_dob: string | null;
  encounter_status: string;
  encounter_class: string;
  chief_complaint: string | null;
  admission_at: string | null;
  diet_type: string | null;
  ward_name: string;
}

interface BedStats {
  total: number;
  occupied: number;
  available: number;
  maintenance: number;
}

// ── Helpers ──────────────────────────────────────────────────

function daysSince(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return `Day ${diff + 1}`;
}

function bedColor(bed: Bed): string {
  if (bed.bed_status === 'maintenance') return '#6b7280'; // gray
  if (bed.bed_status === 'reserved') return '#f59e0b'; // amber
  if (!bed.encounter_id) return '#22c55e'; // green — available
  if (bed.encounter_class === 'ED') return '#ef4444'; // red — emergency
  return '#3b82f6'; // blue — occupied
}

function bedLabel(bed: Bed): string {
  if (bed.bed_status === 'maintenance') return '🔧';
  if (!bed.encounter_id) return '✓';
  return bed.patient_name?.split(' ')[0] || bed.patient_uhid || '●';
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr}:${m} ${ampm}`;
}

// ── Component ────────────────────────────────────────────────
const CHARGE_ROLES = ['charge_nurse', 'nursing_supervisor', 'hospital_admin', 'admin', 'super_admin'];

export default function NurseHomeClient({
  userId, userName, userRole,
}: {
  userId: string;
  userName: string;
  userRole: string;
}) {
  const [wards, setWards] = useState<Ward[]>([]);
  const [myPatients, setMyPatients] = useState<MyPatient[]>([]);
  const [bedStats, setBedStats] = useState<BedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWard, setSelectedWard] = useState<string>('');
  const [now, setNow] = useState(new Date());

  // Refresh clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [boardData, patientsData, statsData] = await Promise.all([
        trpcQuery('bed.board', {}),
        trpcQuery('patientAssignments.myPatients', {}),
        trpcQuery('bed.stats'),
      ]);
      setWards(boardData?.wards || []);
      setMyPatients(patientsData || []);
      setBedStats(statsData);
    } catch (err) {
      console.error('Nurse home load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter wards
  const visibleWards = selectedWard
    ? wards.filter(w => w.ward_code === selectedWard)
    : wards;

  const firstName = userName?.split(' ')[0] || 'Nurse';
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏥</div>
          <div>Loading ward data…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px 20px' }}>
      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb',
      }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111827', margin: 0 }}>
            {greeting}, {firstName}
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0' }}>
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {formatTime(now)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link href="/care/nurse/handoff" style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
            background: '#f3f4f6', color: '#374151', textDecoration: 'none', border: '1px solid #e5e7eb',
          }}>
            📋 Handoff
          </Link>
          <Link href="/care/nurse/emar" style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
            background: '#f3f4f6', color: '#374151', textDecoration: 'none', border: '1px solid #e5e7eb',
          }}>
            💊 eMAR
          </Link>
          {CHARGE_ROLES.includes(userRole) && (
            <Link href="/care/nurse/charge" style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
              background: '#f3f4f6', color: '#374151', textDecoration: 'none', border: '1px solid #e5e7eb',
            }}>
              👩‍⚕️ Charge Nurse
            </Link>
          )}
        </div>
      </div>

      {/* ── STATS STRIP ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px',
        marginBottom: '20px',
      }}>
        {[
          { label: 'My Patients', value: myPatients.length, color: '#3b82f6', icon: '🩺' },
          { label: 'Beds Available', value: bedStats?.available ?? 0, color: '#22c55e', icon: '🛏️' },
          { label: 'Beds Occupied', value: bedStats?.occupied ?? 0, color: '#f59e0b', icon: '👤' },
          { label: 'Total Beds', value: bedStats?.total ?? 0, color: '#6b7280', icon: '🏥' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: '#fff', borderRadius: '12px', padding: '16px',
            border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <div style={{ fontSize: '24px' }}>{stat.icon}</div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── WARD BED GRID ── */}
      <div style={{
        background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb',
        padding: '16px', marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#111827', margin: 0 }}>
            🛏️ Ward Bed Grid
          </h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={selectedWard}
              onChange={(e) => setSelectedWard(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
                border: '1px solid #d1d5db', background: '#fff', color: '#374151',
              }}
            >
              <option value="">All Wards</option>
              {wards.map(w => (
                <option key={w.ward_code} value={w.ward_code}>{w.ward_name}</option>
              ))}
            </select>
            {/* Legend */}
            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#6b7280' }}>
              <span>🟢 Available</span>
              <span>🔵 Occupied</span>
              <span>🔴 Emergency</span>
              <span>⚪ Maintenance</span>
            </div>
          </div>
        </div>

        {visibleWards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
            No ward data available. Beds may not be configured yet.
          </div>
        ) : (
          visibleWards.map(ward => (
            <div key={ward.ward_id} style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                {ward.ward_name}
                <span style={{ color: '#9ca3af', fontWeight: '400', marginLeft: '8px' }}>
                  {ward.beds.filter(b => b.encounter_id).length}/{ward.beds.length} occupied
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                gap: '8px',
              }}>
                {ward.beds.map(bed => {
                  const bg = bedColor(bed);
                  const hasPatient = !!bed.encounter_id;
                  return (
                    <div
                      key={bed.id}
                      onClick={() => {
                        if (hasPatient && bed.encounter_id) {
                          // Navigate to patient chart
                          const patientId = bed.encounter_id; // encounter links to patient
                          window.location.href = `/care/patient/${bed.encounter_id.split('-')[0]}`;
                        }
                      }}
                      title={hasPatient
                        ? `${bed.patient_name} (${bed.patient_uhid})\n${bed.diagnosis || 'No diagnosis'}\n${daysSince(bed.admission_at)}`
                        : `${bed.name} — Available`
                      }
                      style={{
                        background: bg + '18',
                        border: `2px solid ${bg}`,
                        borderRadius: '8px',
                        padding: '8px',
                        textAlign: 'center',
                        cursor: hasPatient ? 'pointer' : 'default',
                        transition: 'transform 0.1s',
                        minHeight: '60px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                      onMouseEnter={(e) => hasPatient && (e.currentTarget.style.transform = 'scale(1.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      <div style={{ fontSize: '11px', fontWeight: '700', color: bg, marginBottom: '2px' }}>
                        {bed.code || bed.name}
                      </div>
                      <div style={{
                        fontSize: hasPatient ? '11px' : '16px',
                        color: hasPatient ? '#374151' : bg,
                        fontWeight: hasPatient ? '500' : '700',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {bedLabel(bed)}
                      </div>
                      {hasPatient && bed.patient_uhid && (
                        <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}>
                          {bed.patient_uhid}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── MY ASSIGNED PATIENTS ── */}
      <div style={{
        background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb',
        padding: '16px', marginBottom: '20px',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#111827', margin: '0 0 16px' }}>
          🩺 My Assigned Patients ({myPatients.length})
        </h2>

        {myPatients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
            <div>No patients assigned to you this shift.</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Assignments are made by the Charge Nurse via the{' '}
              <Link href="/care/nurse/charge" style={{ color: '#3b82f6' }}>Charge Nurse</Link> page.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
            {myPatients.map(p => {
              const acuity = p.encounter_class === 'ED' ? 'critical' : 'medium';
              const acuityColor = acuity === 'critical' ? '#ef4444' : '#f59e0b';
              return (
                <Link
                  key={p.assignment.id}
                  href={`/care/patient/${p.assignment.patient_id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{
                    border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px',
                    borderLeft: `4px solid ${acuityColor}`,
                    transition: 'box-shadow 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '14px', color: '#111827' }}>
                          {p.patient_name || 'Unknown'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                          {p.patient_uhid} · {p.patient_gender || ''} · {p.assignment.bed_label || 'No bed'}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '12px',
                        background: acuityColor + '20', color: acuityColor,
                      }}>
                        {p.encounter_class}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                      {p.chief_complaint && <span>💬 {p.chief_complaint}</span>}
                      {p.admission_at && <span>📅 {daysSince(p.admission_at)}</span>}
                      {p.diet_type && <span>🍽️ {p.diet_type}</span>}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#9ca3af' }}>
                      {p.ward_name}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── QUICK LINKS ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px',
      }}>
        {[
          { label: 'Nurse Station', href: '/care/nurse/bedside', icon: '🖥️', desc: 'Bedside documentation' },
          { label: 'Shift Worksheet', href: '/care/nurse/worksheet', icon: '📝', desc: 'Shift tasks & notes' },
          { label: 'Patient Registry', href: '/admin/patients', icon: '📂', desc: 'All patients (read-only)' },
          { label: 'Schedule', href: '/care/schedule', icon: '📅', desc: 'View shift schedule' },
        ].map(link => (
          <Link key={link.href} href={link.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{
              background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb',
              padding: '14px', transition: 'box-shadow 0.2s', cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ fontSize: '20px', marginBottom: '6px' }}>{link.icon}</div>
              <div style={{ fontWeight: '600', fontSize: '13px', color: '#111827' }}>{link.label}</div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>{link.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
