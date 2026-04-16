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
  const [assignShiftInstanceId, setAssignShiftInstanceId] = useState<string | null>(null);
  const [onShiftNurses, setOnShiftNurses] = useState<{ id: string; name: string; role: string }[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [selectedNurseId, setSelectedNurseId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  // Transfer flow
  const [showTransferPopup, setShowTransferPopup] = useState(false);
  const [transferBed, setTransferBed] = useState<Bed | null>(null);
  const [transferDestId, setTransferDestId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  // Role gates
  const NURSING_ROLES = [
    'nurse', 'charge_nurse', 'icu_nurse', 'ot_nurse',
    'nicu_nurse', 'dialysis_nurse', 'cath_lab_nurse', 'endoscopy_nurse',
    'staff_nurse', 'nursing_supervisor',
  ];
  const isUserANurse = NURSING_ROLES.includes(userRole);
  const CAN_TRANSFER = [
    'super_admin', 'hospital_admin', 'admin', 'charge_nurse', 'nursing_supervisor',
    'medical_director', 'unit_head', 'ip_coordinator', 'receptionist',
  ].includes(userRole);

  // Refresh clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [boardData, patientsData, statsData, shiftArr] = await Promise.all([
        trpcQuery('bed.board', {}),
        trpcQuery('patientAssignments.myPatients', {}),
        trpcQuery('bed.stats'),
        trpcQuery('shifts.getCurrentShift'),
      ]);

      // getCurrentShift returns an array (up to 3 shifts/day per user).
      // Pick the first rostered shift for this user. Admins typically have
      // no roster entries → shiftData is null and per-ward shift lookup is
      // used when they open an assignment popup.
      const shiftData = Array.isArray(shiftArr) && shiftArr.length > 0 ? shiftArr[0] : null;

      // bed.board returns { floors: [{ wards: [{ rooms: [{ beds: [] }] }] }] } after
      // the 3-tier refactor (BM.2). Flatten floors→wards and rooms→beds so the nurse
      // home's flat Ward[] shape still works.
      const flatWards: Ward[] = [];
      for (const floor of boardData?.floors || []) {
        for (const w of floor.wards || []) {
          const beds: Bed[] = [];
          for (const r of w.rooms || []) {
            for (const b of r.beds || []) {
              beds.push({
                id: b.id,
                code: b.code,
                name: b.name,
                bed_status: b.bed_status,
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
          flatWards.push({
            ward_id: w.id,
            ward_code: w.code,
            ward_name: w.name,
            ward_capacity: w.capacity ?? beds.length,
            beds,
          });
        }
      }
      setWards(flatWards);
      setMyPatients(patientsData || []);

      // bed.stats returns { global: { total, available, occupied, ... }, floor, wards }.
      // The nurse home stats strip reads top-level total/available/occupied/maintenance.
      const g = statsData?.global;
      setBedStats(g ? {
        total: g.total ?? 0,
        available: g.available ?? 0,
        occupied: g.occupied ?? 0,
        maintenance: g.maintenance ?? 0,
      } : null);

      // Check if current user is the charge nurse for this shift
      // Multiple checks: (1) admin role, (2) charge_nurse_id on shift instance,
      // (3) user's permanent role is charge_nurse, (4) role_during_shift in roster
      const isAdmin = ['hospital_admin', 'admin', 'super_admin', 'nursing_supervisor'].includes(userRole);
      const isChargeOnShift = shiftData?.charge_nurse_id === userId;
      const isChargeRole = userRole === 'charge_nurse';
      const isChargeRoster = shiftData?.role_during_shift === 'charge_nurse';
      const isCharge = isAdmin || isChargeOnShift || isChargeRole || isChargeRoster;
      setIsChargeThisShift(isCharge);
      setCurrentShiftInstanceId(shiftData?.instance_id || null);

      // Note: the per-ward roster is fetched lazily when the user opens
      // an assignment popup (see openAssignForBed below) because the right
      // shift instance is the one for the BED's ward — which is not
      // necessarily the current user's rostered ward.
    } catch (err) {
      console.error('Nurse home load error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, userRole]);

  useEffect(() => { loadData(); }, [loadData]);

  // Open assign-to-nurse popup for a given bed. Fetches the per-ward shift
  // instance + roster so we show the nurses rostered on THAT ward's shift,
  // not the logged-in user's shift (which may not exist for admins).
  const openAssignForBed = useCallback(async (bed: Bed) => {
    const wardId = wards.find(w => w.beds.some(b => b.id === bed.id))?.ward_id;
    if (!wardId) {
      setAssignError('Could not resolve ward for this bed');
      return;
    }
    setAssignBed(bed);
    setShowAssignPopup(true);
    setClickedBed(null);
    setSelectedNurseId('');
    setAssignError('');
    setOnShiftNurses([]);
    setAssignShiftInstanceId(null);
    setRosterLoading(true);
    try {
      const data = await trpcQuery('shifts.getActiveShiftForWard', { ward_id: wardId });
      if (!data) {
        setAssignError('No active or planned shift for this ward today. Create a shift instance in Admin → Shifts.');
        setOnShiftNurses([]);
        return;
      }
      setAssignShiftInstanceId(data.instance_id);
      // Filter roster to nurse roles only. Match against either the
      // role_during_shift field OR — for cases where the roster role is
      // blank/generic — include anyone whose role_during_shift contains 'nurse'.
      const nurses = (data.roster || [])
        .filter((r: any) => {
          const role = (r.role_during_shift || '').toLowerCase();
          return NURSING_ROLES.includes(role) || role.includes('nurse');
        })
        .map((r: any) => ({
          id: r.user_id,
          name: r.user_name,
          role: r.role_during_shift || 'nurse',
        }));
      setOnShiftNurses(nurses);
      if (nurses.length === 0) {
        setAssignError('No nurses rostered on this ward\'s shift. Add staff via Admin → Shifts → Roster.');
      }
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Failed to load roster');
    } finally {
      setRosterLoading(false);
    }
  }, [wards]);

  // Open transfer popup for a given bed (must be occupied).
  const openTransferForBed = useCallback((bed: Bed) => {
    setTransferBed(bed);
    setShowTransferPopup(true);
    setClickedBed(null);
    setTransferDestId('');
    setTransferReason('');
    setTransferError('');
  }, []);

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
          { label: 'Bed Board', href: '/admin/bed-board', icon: '🛏', desc: 'Floor view, assign & transfer' },
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
            {/* Assign to Nurse — charge nurse / admins */}
            {isChargeThisShift && (
              <button
                onClick={() => clickedBed && openAssignForBed(clickedBed)}
                style={{
                  width: '100%', marginTop: '10px', padding: '12px', borderRadius: '10px',
                  background: '#f59e0b', color: '#fff', fontWeight: '600', fontSize: '14px',
                  border: 'none', cursor: 'pointer',
                }}
              >
                👩‍⚕️ Assign to Nurse
              </button>
            )}
            {/* Transfer Bed — charge / admins / coordinators */}
            {CAN_TRANSFER && (
              <button
                onClick={() => clickedBed && openTransferForBed(clickedBed)}
                style={{
                  width: '100%', marginTop: '8px', padding: '12px', borderRadius: '10px',
                  background: '#8b5cf6', color: '#fff', fontWeight: '600', fontSize: '14px',
                  border: 'none', cursor: 'pointer',
                }}
              >
                🔀 Transfer Bed
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
              Select Nurse (rostered on this ward's shift)
            </label>
            <select
              value={selectedNurseId}
              onChange={(e) => setSelectedNurseId(e.target.value)}
              disabled={rosterLoading}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #d1d5db', fontSize: '14px', marginBottom: '8px',
                background: rosterLoading ? '#f9fafb' : '#fff',
              }}
            >
              <option value="">
                {rosterLoading ? 'Loading roster…' : '— Select a nurse —'}
              </option>
              {/* Self-assign option only if current user is a nurse role */}
              {isUserANurse && onShiftNurses.every(n => n.id !== userId) && (
                <option value={userId}>
                  {userName} (me)
                </option>
              )}
              {onShiftNurses.map(n => (
                <option key={n.id} value={n.id}>
                  {n.name}{n.id === userId ? ' (me)' : ''} — {n.role.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button
                disabled={!selectedNurseId || assigning || !assignShiftInstanceId}
                onClick={async () => {
                  if (!selectedNurseId || !assignBed.patient_id || !assignBed.encounter_id) return;
                  setAssigning(true);
                  setAssignError('');
                  try {
                    const wardId = wards.find(w => w.beds.some(b => b.id === assignBed.id))?.ward_id;
                    if (!wardId) throw new Error('Ward not found for this bed');
                    if (!assignShiftInstanceId) throw new Error('No active shift for this ward today');

                    await trpcMutate('patientAssignments.assign', {
                      shift_instance_id: assignShiftInstanceId,
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
                  background: selectedNurseId && assignShiftInstanceId ? '#3b82f6' : '#d1d5db',
                  color: '#fff', fontWeight: '600', fontSize: '14px',
                  cursor: selectedNurseId && assignShiftInstanceId ? 'pointer' : 'default',
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

      {/* ── TRANSFER BED POPUP ── */}
      {showTransferPopup && transferBed && (
        <div
          onClick={() => setShowTransferPopup(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '16px', padding: '24px', width: '420px',
            maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px', color: '#111827' }}>
              🔀 Transfer to Another Bed
            </h3>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '14px' }}>
              From: <b>{transferBed.code}</b> · {transferBed.patient_name} ({transferBed.patient_uhid})
            </div>

            {transferError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', color: '#dc2626', marginBottom: '12px' }}>
                {transferError}
              </div>
            )}

            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '6px' }}>
              Destination Bed (available beds across wards)
            </label>
            <select
              value={transferDestId}
              onChange={(e) => setTransferDestId(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #d1d5db', fontSize: '14px', marginBottom: '10px',
              }}
            >
              <option value="">— Select destination bed —</option>
              {wards.map(w => {
                const avail = w.beds.filter(b =>
                  b.id !== transferBed.id &&
                  b.bed_status !== 'maintenance' &&
                  !b.encounter_id,
                );
                if (avail.length === 0) return null;
                return (
                  <optgroup key={w.ward_id} label={w.ward_name}>
                    {avail.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '6px' }}>
              Reason (optional)
            </label>
            <textarea
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              rows={2}
              placeholder="e.g., Isolation precaution, Upgrade to private, Patient request"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #d1d5db', fontSize: '13px', marginBottom: '12px',
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                disabled={!transferDestId || transferring}
                onClick={async () => {
                  if (!transferDestId || !transferBed.encounter_id) return;
                  setTransferring(true);
                  setTransferError('');
                  try {
                    await trpcMutate('encounter.transfer', {
                      encounter_id: transferBed.encounter_id,
                      to_bed_id: transferDestId,
                      transfer_type: 'bed',
                      reason: transferReason || undefined,
                    });
                    setShowTransferPopup(false);
                    setTransferBed(null);
                    setTransferDestId('');
                    setTransferReason('');
                    loadData();
                  } catch (err) {
                    setTransferError(err instanceof Error ? err.message : 'Transfer failed');
                  } finally {
                    setTransferring(false);
                  }
                }}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
                  background: transferDestId ? '#8b5cf6' : '#d1d5db',
                  color: '#fff', fontWeight: '600', fontSize: '14px',
                  cursor: transferDestId ? 'pointer' : 'default',
                  opacity: transferring ? 0.6 : 1,
                }}
              >
                {transferring ? 'Transferring…' : 'Confirm Transfer'}
              </button>
              <button
                onClick={() => { setShowTransferPopup(false); setTransferBed(null); }}
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
