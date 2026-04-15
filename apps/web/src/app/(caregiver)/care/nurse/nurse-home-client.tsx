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

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ── Types ────────────────────────────────────────────────────
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
  const [isChargeThisShift, setIsChargeThisShift] = useState(false);
  const [currentShiftInstanceId, setCurrentShiftInstanceId] = useState<string | null>(null);
  // Bed click popup
  const [clickedBed, setClickedBed] = useState<Bed | null>(null);
  // Assignment flow (charge nurse)
  const [showAssignPopup, setShowAssignPopup] = useState(false);
  const [assignBed, setAssignBed] = useState<Bed | null>(null);
  const [onShiftNurses, setOnShiftNurses] = useState<{ id: string; name: string; patient_count: number }[]>([]);
  const [selectedNurseId, setSelectedNurseId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  // Refresh clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [boardData, patientsData, statsData, shiftData] = await Promise.all([
        trpcQuery('bed.board', {}),
        trpcQuery('patientAssignments.myPatients', {}),
        trpcQuery('bed.stats'),
        trpcQuery('shifts.getCurrentShift'),
      ]);
      setWards(boardData?.wards || []);
      setMyPatients(patientsData || []);
      setBedStats(statsData);

      // Check if current user is the charge nurse for this shift
      // Multiple checks: (1) admin role, (2) charge_nurse_id on shift instance,
      // (3) user's permanent role is charge_nurse, (4) role_during_shift in roster
      const isAdmin = ['hospital_admin', 'admin', 'super_admin'].includes(userRole);
      const isChargeOnShift = shiftData?.charge_nurse_id === userId;
      const isChargeRole = userRole === 'charge_nurse';
      const isChargeRoster = shiftData?.role_during_shift === 'charge_nurse';
      const isCharge = isAdmin || isChargeOnShift || isChargeRole || isChargeRoster;
      setIsChargeThisShift(isCharge);
      setCurrentShiftInstanceId(shiftData?.instance_id || null);

      // If no shift data but user is charge_nurse role, try to find any active shift instance
      if (isCharge && !shiftData?.instance_id) {
        // Fallback: find any active shift instance for today where this user is charge
        const fallbackShift = await trpcQuery('bed.board', {});
        // We'll use the first ward's shift instance if available
      }

      // Load on-shift nurses for assignment (charge nurse only)
      if (isCharge && shiftData?.instance_id) {
        try {
          const statsData2 = await trpcQuery('patientAssignments.stats', { shift_instance_id: shiftData.instance_id });
          if (statsData2?.nurse_loads) {
            setOnShiftNurses(statsData2.nurse_loads.map((n: any) => ({
              id: n.nurse_id, name: n.nurse_name, patient_count: n.patient_count,
            })));
          }
        } catch { /* stats not critical */ }
      }
    } catch (err) {
      console.error('Nurse home load error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, userRole]);

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
          {isChargeThisShift && (
            <Link href="/care/nurse/charge" style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
              background: '#fef3c7', color: '#92400e', textDecoration: 'none', border: '1px solid #fcd34d',
            }}>
              👩‍⚕️ Ward Command
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
                        if (hasPatient && bed.patient_id) {
                          setClickedBed(bed);
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

      {/* ── BED CLICK POPUP ── */}
      {clickedBed && clickedBed.patient_id && (
        <div
          onClick={() => setClickedBed(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px', padding: '24px', width: '360px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
              {clickedBed.patient_name || 'Unknown Patient'}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
              {clickedBed.patient_uhid} · {clickedBed.code} · {clickedBed.encounter_class || 'IPD'}
            </div>
            {clickedBed.diagnosis && (
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px' }}>
                {clickedBed.diagnosis}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <Link
                href={`/care/patient/${clickedBed.patient_id}`}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', textAlign: 'center',
                  background: '#3b82f6', color: '#fff', fontWeight: '600', fontSize: '14px',
                  textDecoration: 'none',
                }}
                onClick={() => setClickedBed(null)}
              >
                📋 Patient Chart
              </Link>
              <Link
                href={`/care/nurse/bedside?patient=${clickedBed.patient_id}&encounter=${clickedBed.encounter_id}`}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', textAlign: 'center',
                  background: '#10b981', color: '#fff', fontWeight: '600', fontSize: '14px',
                  textDecoration: 'none',
                }}
                onClick={() => setClickedBed(null)}
              >
                🩺 Bedside View
              </Link>
            </div>
            {/* Assign to Nurse — charge nurse only */}
            {isChargeThisShift && (
              <button
                onClick={() => {
                  setAssignBed(clickedBed);
                  setShowAssignPopup(true);
                  setClickedBed(null);
                  setSelectedNurseId('');
                  setAssignError('');
                }}
                style={{
                  width: '100%', marginTop: '10px', padding: '12px', borderRadius: '10px',
                  background: '#f59e0b', color: '#fff', fontWeight: '600', fontSize: '14px',
                  border: 'none', cursor: 'pointer',
                }}
              >
                👩‍⚕️ Assign to Nurse
              </button>
            )}
            <button
              onClick={() => setClickedBed(null)}
              style={{
                width: '100%', marginTop: '8px', padding: '8px', borderRadius: '8px',
                border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280',
                fontSize: '13px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── ASSIGN NURSE POPUP ── */}
      {showAssignPopup && assignBed && (
        <div
          onClick={() => setShowAssignPopup(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '16px', padding: '24px', width: '380px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px', color: '#111827' }}>
              Assign Patient to Nurse
            </h3>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
              {assignBed.patient_name} ({assignBed.patient_uhid}) · {assignBed.code}
            </div>

            {assignError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', color: '#dc2626', marginBottom: '12px' }}>
                {assignError}
              </div>
            )}

            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '6px' }}>
              Select Nurse (on shift)
            </label>
            <select
              value={selectedNurseId}
              onChange={(e) => setSelectedNurseId(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #d1d5db', fontSize: '14px', marginBottom: '8px',
              }}
            >
              <option value="">— Select a nurse —</option>
              {/* Self-assign option */}
              <option value={userId}>
                {userName} (me)
              </option>
              {onShiftNurses.filter(n => n.id !== userId).map(n => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.patient_count} patients)
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button
                disabled={!selectedNurseId || assigning}
                onClick={async () => {
                  if (!selectedNurseId || !assignBed.patient_id || !assignBed.encounter_id) return;
                  setAssigning(true);
                  setAssignError('');
                  try {
                    // Find ward_id for this bed
                    const wardId = wards.find(w => w.beds.some(b => b.id === assignBed.id))?.ward_id;
                    if (!wardId) throw new Error('Ward not found for this bed');

                    // Find shift instance for this ward
                    const shiftForWard = currentShiftInstanceId;
                    if (!shiftForWard) throw new Error('No active shift found');

                    await trpcMutate('patientAssignments.assign', {
                      shift_instance_id: shiftForWard,
                      nurse_id: selectedNurseId,
                      patient_id: assignBed.patient_id,
                      encounter_id: assignBed.encounter_id,
                      ward_id: wardId,
                      bed_label: assignBed.code,
                    });
                    setShowAssignPopup(false);
                    setAssignBed(null);
                    loadData(); // refresh
                  } catch (err) {
                    setAssignError(err instanceof Error ? err.message : 'Assignment failed');
                  } finally {
                    setAssigning(false);
                  }
                }}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
                  background: selectedNurseId ? '#3b82f6' : '#d1d5db',
                  color: '#fff', fontWeight: '600', fontSize: '14px',
                  cursor: selectedNurseId ? 'pointer' : 'default',
                  opacity: assigning ? 0.6 : 1,
                }}
              >
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
              <button
                onClick={() => { setShowAssignPopup(false); setAssignBed(null); }}
                style={{
                  padding: '12px 20px', borderRadius: '10px', border: '1px solid #e5e7eb',
                  background: '#fff', color: '#6b7280', fontSize: '14px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
