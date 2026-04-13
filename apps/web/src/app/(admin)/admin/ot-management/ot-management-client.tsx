'use client';

import { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface OTRoom {
  id: string;
  room_name: string;
  room_number: string;
  room_type: string | null;
  floor: string | null;
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved';
  equipment: any;
  specialties: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface OTSchedule {
  id: string;
  schedule_number: string;
  status: 'requested' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'postponed';
  procedure_name: string;
  procedure_code: string | null;
  estimated_duration_min: number | null;
  actual_duration_min: number | null;
  primary_surgeon: string;
  surgeon_name: string;
  assistant_surgeon: string | null;
  anesthetist: string | null;
  scrub_nurse: string | null;
  circulating_nurse: string | null;
  scheduled_date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  wheels_in: string | null;
  wheels_out: string | null;
  patient_id: string;
  patient_name: string;
  uhid: string;
  room_id: string | null;
  room_name: string | null;
  priority: 'emergency' | 'urgent' | 'elective';
  consent_obtained: boolean;
  site_marked: boolean;
  blood_arranged: boolean;
  pre_op_diagnosis: string | null;
  post_op_diagnosis: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface OTChecklist {
  id: string;
  schedule_id: string;
  phase: 'sign_in' | 'time_out' | 'sign_out';
  patient_identity_confirmed: boolean | null;
  site_marked: boolean | null;
  consent_signed: boolean | null;
  anesthesia_machine_checked: boolean | null;
  pulse_oximeter_functioning: boolean | null;
  allergies_known: boolean | null;
  airway_risk: boolean | null;
  blood_loss_risk: boolean | null;
  team_introduced: boolean | null;
  patient_name_procedure_confirmed: boolean | null;
  antibiotics_given: boolean | null;
  imaging_displayed: boolean | null;
  critical_steps_discussed: boolean | null;
  equipment_issues: boolean | null;
  instrument_count_correct: boolean | null;
  specimen_labeled: boolean | null;
  equipment_problems_noted: boolean | null;
  recovery_plan_discussed: boolean | null;
  completed_by: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

interface AnesthesiaRecord {
  id: string;
  schedule_id: string;
  patient_id: string;
  patient_name: string;
  procedure_name: string;
  asa_class: 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | null;
  anesthesia_type: 'general' | 'spinal' | 'epidural' | 'regional_block' | 'local' | 'sedation' | 'combined';
  airway_assessment: string | null;
  fasting_hours: number | null;
  allergies_noted: string | null;
  comorbidities: string | null;
  induction_time: string | null;
  intubation_time: string | null;
  extubation_time: string | null;
  agents_used: any;
  fluids_given: any;
  blood_products: any;
  estimated_blood_loss_ml: number | null;
  urine_output_ml: number | null;
  vitals_timeline: any;
  complications: string | null;
  difficult_airway: boolean;
  anaphylaxis: boolean;
  recovery_status: 'in_ot' | 'in_pacu' | 'stable' | 'discharged_to_ward' | 'icu_transfer' | 'complication';
  aldrete_score: number | null;
  pacu_admission_time: string | null;
  pacu_discharge_time: string | null;
  anesthetist_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface OTAnalytics {
  total_rooms: number;
  available_rooms: number;
  occupied_rooms: number;
  maintenance_rooms: number;
  total_schedules_today: number;
  confirmed_today: number;
  in_progress: number;
  completed_today: number;
  cancelled_today: number;
  average_turnover_minutes: number | null;
  on_time_start_rate: number;
  cancellation_rate: number;
  room_utilization: Array<{ room_name: string; utilization_percent: number }>;
  cases_by_status: Record<string, number>;
  anesthesia_types: Record<string, number>;
}

type TabType = 'board' | 'schedule' | 'rooms' | 'checklist' | 'anesthesia' | 'analytics' | 'ai-ot';

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatTime(dateString: string | null | undefined): string {
  if (!dateString) return '--:--';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  return `${formatDate(dateString)} ${formatTime(dateString)}`;
}

function getDurationDisplay(minutes: number | null | undefined): string {
  if (!minutes) return '--';
  return `${minutes} min`;
}

function getStatusBadgeColor(status: string): { bg: string; text: string; icon: string } {
  const colors: Record<string, { bg: string; text: string; icon: string }> = {
    requested: { bg: '#4a3a1a', text: '#ffd700', icon: '&#x1F4CB;' },
    confirmed: { bg: '#2a3a4a', text: '#55ccff', icon: '&#x2705;' },
    in_progress: { bg: '#2a4a2a', text: '#55ff55', icon: '&#x23F3;' },
    completed: { bg: '#3a3a3a', text: '#a0a0a0', icon: '&#x2713;' },
    cancelled: { bg: '#4a1a1a', text: '#ff5555', icon: '&#x2717;' },
    postponed: { bg: '#4a3a2a', text: '#ffaa55', icon: '&#x1F56F;' },
    available: { bg: '#2a4a2a', text: '#55ff55', icon: '&#x2705;' },
    occupied: { bg: '#4a1a1a', text: '#ff5555', icon: '&#x26A0;' },
    cleaning: { bg: '#4a3a1a', text: '#ffd700', icon: '&#x23F0;' },
    maintenance: { bg: '#3a3a3a', text: '#a0a0a0', icon: '&#x1F527;' },
    reserved: { bg: '#2a3a4a', text: '#55ccff', icon: '&#x1F512;' },
    emergency: { bg: '#4a1a1a', text: '#ff5555', icon: '&#x1F6A8;' },
    urgent: { bg: '#4a3a1a', text: '#ffaa55', icon: '&#x26A0;' },
    elective: { bg: '#2a3a4a', text: '#55ccff', icon: '&#x1F4C8;' },
  };
  return colors[status] || { bg: '#2a2a2a', text: '#a0a0a0', icon: '&#x2753;' };
}

function formatIndianNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return value.toLocaleString('en-IN');
}

// ═══════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: OT BOARD
// ═══════════════════════════════════════════════════════════════════════════

function OTBoardTab({ schedules, rooms }: { schedules: OTSchedule[]; rooms: OTRoom[] }) {
  const [statusUpdate, setStatusUpdate] = useState<string | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<OTSchedule | null>(null);
  const [updating, setUpdating] = useState(false);

  // Group by room
  const groupedByRoom = schedules.reduce((acc, s) => {
    const roomKey = s.room_name || 'Unassigned';
    if (!acc[roomKey]) acc[roomKey] = [];
    acc[roomKey].push(s);
    return acc;
  }, {} as Record<string, OTSchedule[]>);

  const handleStatusUpdate = async (scheduleId: string, newStatus: string) => {
    setUpdating(true);
    try {
      await trpcMutate('otManagement.updateScheduleStatus', { schedule_id: scheduleId, status: newStatus });
      setStatusUpdate(null);
      setSelectedSchedule(null);
      // Refetch would go here
    } catch (err) {
      alert('Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ padding: '16px', color: '#e0e0e0' }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Today's Surgery Schedule</h3>
      {Object.entries(groupedByRoom).length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#888' }}>
          <span style={{ fontSize: '24px' }}>&#x1F3E5;</span>
          <p>No surgeries scheduled for today</p>
        </div>
      ) : (
        Object.entries(groupedByRoom).map(([roomName, roomSchedules]) => (
          <div key={roomName} style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#55ccff', marginBottom: '8px' }}>{roomName}</div>
            {roomSchedules.map((sch) => {
              const statusColor = getStatusBadgeColor(sch.status);
              const priorityColor = getStatusBadgeColor(sch.priority);
              return (
                <div
                  key={sch.id}
                  style={{
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #0f3460',
                    borderRadius: '6px',
                    padding: '12px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedSchedule(sch)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                        {formatTime(sch.scheduled_start)} - {sch.patient_name} ({sch.uhid})
                      </div>
                      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '6px' }}>{sch.procedure_name}</div>
                      <div style={{ fontSize: '11px', color: '#888' }}>Surgeon: {sch.surgeon_name}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div
                        style={{
                          backgroundColor: statusColor.bg,
                          color: statusColor.text,
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {sch.status.replace(/_/g, ' ')}
                      </div>
                      <div
                        style={{
                          backgroundColor: priorityColor.bg,
                          color: priorityColor.text,
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {sch.priority}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}

      {selectedSchedule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedSchedule(null)}
        >
          <div
            style={{
              backgroundColor: '#16213e',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
              color: '#e0e0e0',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Case Details</h2>
            <div style={{ display: 'grid', gap: '12px', marginBottom: '16px', fontSize: '13px' }}>
              <div>
                <span style={{ color: '#888' }}>Patient:</span> {selectedSchedule.patient_name} ({selectedSchedule.uhid})
              </div>
              <div>
                <span style={{ color: '#888' }}>Procedure:</span> {selectedSchedule.procedure_name}
              </div>
              <div>
                <span style={{ color: '#888' }}>Surgeon:</span> {selectedSchedule.surgeon_name}
              </div>
              <div>
                <span style={{ color: '#888' }}>Scheduled:</span> {formatDateTime(selectedSchedule.scheduled_start)}
              </div>
              <div>
                <span style={{ color: '#888' }}>Room:</span> {selectedSchedule.room_name || 'Unassigned'}
              </div>
              <div>
                <span style={{ color: '#888' }}>Priority:</span> {selectedSchedule.priority}
              </div>
              <div>
                <span style={{ color: '#888' }}>Current Status:</span> {selectedSchedule.status}
              </div>
              {selectedSchedule.notes && (
                <div>
                  <span style={{ color: '#888' }}>Notes:</span> {selectedSchedule.notes}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {['confirmed', 'in_progress', 'completed', 'cancelled'].map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusUpdate(selectedSchedule.id, status)}
                  disabled={updating}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: selectedSchedule.status === status ? '#0f3460' : '#2a2a3e',
                    border: `1px solid ${selectedSchedule.status === status ? '#55ccff' : '#0f3460'}`,
                    borderRadius: '4px',
                    color: selectedSchedule.status === status ? '#55ccff' : '#e0e0e0',
                    fontSize: '12px',
                    cursor: updating ? 'not-allowed' : 'pointer',
                    opacity: updating ? 0.5 : 1,
                  }}
                >
                  {status.replace(/_/g, ' ')}
                </button>
              ))}
            </div>

            <button
              onClick={() => setSelectedSchedule(null)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#0f3460',
                border: 'none',
                borderRadius: '4px',
                color: '#55ccff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2: SCHEDULE
// ═══════════════════════════════════════════════════════════════════════════

function ScheduleTab({ schedules }: { schedules: OTSchedule[] }) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [roomFilter, setRoomFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [selectedSchedule, setSelectedSchedule] = useState<OTSchedule | null>(null);

  const uniqueRooms = Array.from(new Set(schedules.map((s) => s.room_name).filter((x): x is string => !!x)));
  const uniqueStatuses = Array.from(new Set(schedules.map((s) => s.status)));

  const filtered = schedules.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (roomFilter && s.room_name !== roomFilter) return false;
    if (dateFilter && !s.scheduled_date.startsWith(dateFilter)) return false;
    return true;
  });

  return (
    <div style={{ padding: '16px', color: '#e0e0e0' }}>
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#888' }}>Date</label>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={{
              padding: '8px',
              backgroundColor: '#1a1a2e',
              border: '1px solid #0f3460',
              borderRadius: '4px',
              color: '#e0e0e0',
              fontSize: '12px',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#888' }}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '8px',
              backgroundColor: '#1a1a2e',
              border: '1px solid #0f3460',
              borderRadius: '4px',
              color: '#e0e0e0',
              fontSize: '12px',
            }}
          >
            <option value="">All</option>
            {uniqueStatuses.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#888' }}>Room</label>
          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            style={{
              padding: '8px',
              backgroundColor: '#1a1a2e',
              border: '1px solid #0f3460',
              borderRadius: '4px',
              color: '#e0e0e0',
              fontSize: '12px',
            }}
          >
            <option value="">All</option>
            {uniqueRooms.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #0f3460' }}>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Date</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Sch#</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Patient</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Procedure</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Surgeon</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Room</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Duration</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
                  No schedules found
                </td>
              </tr>
            ) : (
              filtered.map((sch) => {
                const statusColor = getStatusBadgeColor(sch.status);
                return (
                  <tr
                    key={sch.id}
                    style={{
                      borderBottom: '1px solid #0f3460',
                      cursor: 'pointer',
                      backgroundColor: '#1a1a2e',
                    }}
                    onClick={() => setSelectedSchedule(sch)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#242438';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#1a1a2e';
                    }}
                  >
                    <td style={{ padding: '8px' }}>{formatDate(sch.scheduled_date)}</td>
                    <td style={{ padding: '8px' }}>{sch.schedule_number}</td>
                    <td style={{ padding: '8px' }}>{sch.patient_name}</td>
                    <td style={{ padding: '8px' }}>{sch.procedure_name}</td>
                    <td style={{ padding: '8px' }}>{sch.surgeon_name}</td>
                    <td style={{ padding: '8px' }}>{sch.room_name || '--'}</td>
                    <td style={{ padding: '8px' }}>{getDurationDisplay(sch.estimated_duration_min)}</td>
                    <td style={{ padding: '8px' }}>
                      <div
                        style={{
                          backgroundColor: statusColor.bg,
                          color: statusColor.text,
                          padding: '3px 6px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          display: 'inline-block',
                        }}
                      >
                        {sch.status}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedSchedule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedSchedule(null)}
        >
          <div
            style={{
              backgroundColor: '#16213e',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              padding: '24px',
              width: '90%',
              maxWidth: '600px',
              color: '#e0e0e0',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Full Schedule Details</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Schedule #</span>
                {selectedSchedule.schedule_number}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Status</span>
                {selectedSchedule.status}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Patient</span>
                {selectedSchedule.patient_name} ({selectedSchedule.uhid})
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Priority</span>
                {selectedSchedule.priority}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Procedure</span>
                {selectedSchedule.procedure_name}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Est. Duration</span>
                {getDurationDisplay(selectedSchedule.estimated_duration_min)}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Primary Surgeon</span>
                {selectedSchedule.surgeon_name}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Room</span>
                {selectedSchedule.room_name || '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Scheduled Date</span>
                {formatDate(selectedSchedule.scheduled_date)}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Scheduled Time</span>
                {formatTime(selectedSchedule.scheduled_start)} - {formatTime(selectedSchedule.scheduled_end)}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Actual Start</span>
                {formatDateTime(selectedSchedule.actual_start) || '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Actual End</span>
                {formatDateTime(selectedSchedule.actual_end) || '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Consent</span>
                {selectedSchedule.consent_obtained ? '&#x2705; Obtained' : '&#x2717; Pending'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Site Marked</span>
                {selectedSchedule.site_marked ? '&#x2705; Yes' : '&#x2717; No'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Blood Arranged</span>
                {selectedSchedule.blood_arranged ? '&#x2705; Yes' : '&#x2717; No'}
              </div>
              {selectedSchedule.pre_op_diagnosis && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Pre-op Diagnosis</span>
                  {selectedSchedule.pre_op_diagnosis}
                </div>
              )}
              {selectedSchedule.post_op_diagnosis && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Post-op Diagnosis</span>
                  {selectedSchedule.post_op_diagnosis}
                </div>
              )}
              {selectedSchedule.notes && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Notes</span>
                  {selectedSchedule.notes}
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedSchedule(null)}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '20px',
                backgroundColor: '#0f3460',
                border: 'none',
                borderRadius: '4px',
                color: '#55ccff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3: ROOMS
// ═══════════════════════════════════════════════════════════════════════════

function RoomsTab({ rooms }: { rooms: OTRoom[] }) {
  const [selectedRoom, setSelectedRoom] = useState<OTRoom | null>(null);

  const activeRooms = rooms.filter((r) => r.is_active);

  return (
    <div style={{ padding: '16px', color: '#e0e0e0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
        {activeRooms.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: '#666' }}>
            No active OT rooms
          </div>
        ) : (
          activeRooms.map((room) => {
            const statusColor = getStatusBadgeColor(room.status);
            return (
              <div
                key={room.id}
                style={{
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '6px',
                  padding: '16px',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedRoom(room)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#55ccff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#0f3460';
                }}
              >
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>{room.room_name}</div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Room {room.room_number}</div>
                <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '12px' }}>{room.room_type || 'Standard'}</div>
                <div
                  style={{
                    backgroundColor: statusColor.bg,
                    color: statusColor.text,
                    padding: '6px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 500,
                    display: 'inline-block',
                  }}
                >
                  {room.status}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedRoom && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedRoom(null)}
        >
          <div
            style={{
              backgroundColor: '#16213e',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
              color: '#e0e0e0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Room Details</h2>
            <div style={{ display: 'grid', gap: '12px', marginBottom: '16px', fontSize: '13px' }}>
              <div>
                <span style={{ color: '#888' }}>Room Name:</span> {selectedRoom.room_name}
              </div>
              <div>
                <span style={{ color: '#888' }}>Room Number:</span> {selectedRoom.room_number}
              </div>
              <div>
                <span style={{ color: '#888' }}>Type:</span> {selectedRoom.room_type || 'Standard'}
              </div>
              <div>
                <span style={{ color: '#888' }}>Floor:</span> {selectedRoom.floor || 'N/A'}
              </div>
              <div>
                <span style={{ color: '#888' }}>Status:</span> {selectedRoom.status}
              </div>
              {selectedRoom.specialties && (
                <div>
                  <span style={{ color: '#888' }}>Specialties:</span>{' '}
                  {Array.isArray(selectedRoom.specialties) ? selectedRoom.specialties.join(', ') : 'N/A'}
                </div>
              )}
              <div>
                <span style={{ color: '#888' }}>Active:</span> {selectedRoom.is_active ? '✓ Yes' : '✗ No'}
              </div>
            </div>

            <button
              onClick={() => setSelectedRoom(null)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#0f3460',
                border: 'none',
                borderRadius: '4px',
                color: '#55ccff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4: CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════

function ChecklistTab({ schedules }: { schedules: OTSchedule[] }) {
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
  const [checklists, setChecklists] = useState<OTChecklist[]>([]);
  const [activePhase, setActivePhase] = useState<'sign_in' | 'time_out' | 'sign_out'>('sign_in');
  const [loading, setLoading] = useState(false);

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId);

  const handleScheduleSelect = async (schedId: string) => {
    setSelectedScheduleId(schedId);
    setLoading(true);
    try {
      const data = await trpcQuery('otManagement.getChecklists', { schedule_id: schedId });
      setChecklists(Array.isArray(data) ? data : []);
      setActivePhase('sign_in');
    } catch {
      setChecklists([]);
    } finally {
      setLoading(false);
    }
  };

  const currentPhaseChecklist = checklists.find((c) => c.phase === activePhase);

  const signInItems = [
    { key: 'patient_identity_confirmed', label: 'Patient identity confirmed' },
    { key: 'site_marked', label: 'Site marked' },
    { key: 'consent_signed', label: 'Consent signed' },
    { key: 'anesthesia_machine_checked', label: 'Anesthesia machine checked' },
    { key: 'pulse_oximeter_functioning', label: 'Pulse oximeter functioning' },
    { key: 'allergies_known', label: 'Allergies known' },
    { key: 'airway_risk', label: 'Airway risk assessed' },
    { key: 'blood_loss_risk', label: 'Blood loss risk assessed' },
  ];

  const timeOutItems = [
    { key: 'team_introduced', label: 'Team introduced' },
    { key: 'patient_name_procedure_confirmed', label: 'Patient name & procedure confirmed' },
    { key: 'antibiotics_given', label: 'Antibiotics given' },
    { key: 'imaging_displayed', label: 'Imaging displayed' },
    { key: 'critical_steps_discussed', label: 'Critical steps discussed' },
    { key: 'equipment_issues', label: 'Equipment issues noted' },
  ];

  const signOutItems = [
    { key: 'instrument_count_correct', label: 'Instrument count correct' },
    { key: 'specimen_labeled', label: 'Specimen labeled' },
    { key: 'equipment_problems_noted', label: 'Equipment problems noted' },
    { key: 'recovery_plan_discussed', label: 'Recovery plan discussed' },
  ];

  const items = activePhase === 'sign_in' ? signInItems : activePhase === 'time_out' ? timeOutItems : signOutItems;

  const completedCount = currentPhaseChecklist
    ? items.filter((item) => currentPhaseChecklist[item.key as keyof OTChecklist]).length
    : 0;
  const completionPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  const handleCheckItem = async (key: string, value: boolean) => {
    if (!currentPhaseChecklist) return;
    try {
      await trpcMutate('otManagement.updateChecklist', {
        checklist_id: currentPhaseChecklist.id,
        [key]: value,
      });
      setChecklists((prev) =>
        prev.map((c) =>
          c.id === currentPhaseChecklist.id ? { ...c, [key]: value } : c
        )
      );
    } catch {
      alert('Failed to update checklist');
    }
  };

  return (
    <div style={{ padding: '16px', color: '#e0e0e0' }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>WHO Surgical Safety Checklist</h3>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: '#888' }}>Select Schedule</label>
        <select
          value={selectedScheduleId}
          onChange={(e) => handleScheduleSelect(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: '#1a1a2e',
            border: '1px solid #0f3460',
            borderRadius: '4px',
            color: '#e0e0e0',
            fontSize: '13px',
          }}
        >
          <option value="">-- Choose a surgery --</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.schedule_number} - {s.patient_name} ({formatDate(s.scheduled_date)})
            </option>
          ))}
        </select>
      </div>

      {selectedScheduleId && selectedSchedule && (
        <>
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#1a1a2e', borderRadius: '6px', fontSize: '12px' }}>
            <div>
              <span style={{ color: '#888' }}>Patient:</span> {selectedSchedule.patient_name}
            </div>
            <div>
              <span style={{ color: '#888' }}>Procedure:</span> {selectedSchedule.procedure_name}
            </div>
          </div>

          <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
            {(['sign_in', 'time_out', 'sign_out'] as const).map((phase) => (
              <button
                key={phase}
                onClick={() => setActivePhase(phase)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: activePhase === phase ? '#0f3460' : '#1a1a2e',
                  border: `1px solid ${activePhase === phase ? '#55ccff' : '#0f3460'}`,
                  borderRadius: '4px',
                  color: activePhase === phase ? '#55ccff' : '#e0e0e0',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: activePhase === phase ? 600 : 400,
                }}
              >
                {phase.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>Loading...</div>
          ) : (
            <>
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#1a1a2e', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', marginBottom: '6px', color: '#888' }}>Completion</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      flex: 1,
                      height: '8px',
                      backgroundColor: '#0f3460',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${completionPercent}%`,
                        height: '100%',
                        backgroundColor: completionPercent === 100 ? '#55ff55' : '#ffaa55',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, minWidth: '35px' }}>{completionPercent}%</div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '10px' }}>
                {items.map((item) => {
                  const isChecked = currentPhaseChecklist ? currentPhaseChecklist[item.key as keyof OTChecklist] : false;
                  return (
                    <label
                      key={item.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px',
                        backgroundColor: '#1a1a2e',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        gap: '8px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!isChecked}
                        onChange={(e) => handleCheckItem(item.key, e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '13px' }}>{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5: ANESTHESIA
// ═══════════════════════════════════════════════════════════════════════════

function AnesthesiaTab({ records }: { records: AnesthesiaRecord[] }) {
  const [selectedRecord, setSelectedRecord] = useState<AnesthesiaRecord | null>(null);

  return (
    <div style={{ padding: '16px', color: '#e0e0e0' }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Anesthesia Records</h3>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #0f3460' }}>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Patient</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Procedure</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>ASA Class</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Type</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Recovery</th>
              <th style={{ padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500 }}>Aldrete</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
                  No anesthesia records
                </td>
              </tr>
            ) : (
              records.map((rec) => (
                <tr
                  key={rec.id}
                  style={{
                    borderBottom: '1px solid #0f3460',
                    cursor: 'pointer',
                    backgroundColor: '#1a1a2e',
                  }}
                  onClick={() => setSelectedRecord(rec)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#242438';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#1a1a2e';
                  }}
                >
                  <td style={{ padding: '8px' }}>{rec.patient_name}</td>
                  <td style={{ padding: '8px' }}>{rec.procedure_name}</td>
                  <td style={{ padding: '8px' }}>{rec.asa_class || '--'}</td>
                  <td style={{ padding: '8px' }}>{rec.anesthesia_type}</td>
                  <td style={{ padding: '8px' }}>{rec.recovery_status.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '8px' }}>{rec.aldrete_score ?? '--'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedRecord && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedRecord(null)}
        >
          <div
            style={{
              backgroundColor: '#16213e',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              padding: '24px',
              width: '90%',
              maxWidth: '700px',
              color: '#e0e0e0',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Anesthesia Details</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Patient</span>
                {selectedRecord.patient_name}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Procedure</span>
                {selectedRecord.procedure_name}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>ASA Class</span>
                {selectedRecord.asa_class || '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Type</span>
                {selectedRecord.anesthesia_type}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Fasting Hours</span>
                {selectedRecord.fasting_hours ?? '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Induction Time</span>
                {formatDateTime(selectedRecord.induction_time)}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Intubation Time</span>
                {formatDateTime(selectedRecord.intubation_time)}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Extubation Time</span>
                {formatDateTime(selectedRecord.extubation_time)}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Est. Blood Loss</span>
                {selectedRecord.estimated_blood_loss_ml ? `${formatIndianNumber(selectedRecord.estimated_blood_loss_ml)} ml` : '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Urine Output</span>
                {selectedRecord.urine_output_ml ? `${formatIndianNumber(selectedRecord.urine_output_ml)} ml` : '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Recovery Status</span>
                {selectedRecord.recovery_status.replace(/_/g, ' ')}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Aldrete Score</span>
                {selectedRecord.aldrete_score ?? '--'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Difficult Airway</span>
                {selectedRecord.difficult_airway ? '⚠ Yes' : 'No'}
              </div>
              <div>
                <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Anaphylaxis</span>
                {selectedRecord.anaphylaxis ? '⚠ Yes' : 'No'}
              </div>
              {selectedRecord.complications && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Complications</span>
                  {selectedRecord.complications}
                </div>
              )}
              {selectedRecord.notes && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: '#888', display: 'block', fontSize: '11px' }}>Notes</span>
                  {selectedRecord.notes}
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedRecord(null)}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '20px',
                backgroundColor: '#0f3460',
                border: 'none',
                borderRadius: '4px',
                color: '#55ccff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 6: ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

function AnalyticsTab({ analytics }: { analytics: OTAnalytics | null }) {
  if (!analytics) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: '#666' }}>
        Loading analytics...
      </div>
    );
  }

  const statCards = [
    { label: 'Total Rooms', value: formatIndianNumber(analytics.total_rooms) },
    { label: 'Available', value: formatIndianNumber(analytics.available_rooms), color: '#55ff55' },
    { label: 'Occupied', value: formatIndianNumber(analytics.occupied_rooms), color: '#ff5555' },
    { label: 'Maintenance', value: formatIndianNumber(analytics.maintenance_rooms), color: '#ffaa55' },
    { label: 'Cases Today', value: formatIndianNumber(analytics.total_schedules_today) },
    { label: 'Confirmed', value: formatIndianNumber(analytics.confirmed_today) },
    { label: 'In Progress', value: formatIndianNumber(analytics.in_progress), color: '#55ff55' },
    { label: 'Completed', value: formatIndianNumber(analytics.completed_today) },
    { label: 'Cancelled', value: formatIndianNumber(analytics.cancelled_today), color: '#ff5555' },
    { label: 'Avg Turnover', value: `${analytics.average_turnover_minutes ?? '--'} min` },
    { label: 'On-time Start', value: `${Math.round(analytics.on_time_start_rate * 100)}%` },
    { label: 'Cancellation Rate', value: `${Math.round(analytics.cancellation_rate * 100)}%` },
  ];

  return (
    <div style={{ padding: '16px', color: '#e0e0e0' }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>OT Analytics</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        {statCards.map((card, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: '#1a1a2e',
              border: '1px solid #0f3460',
              borderRadius: '6px',
              padding: '12px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>{card.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: card.color || '#55ccff' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: '20px', marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Room Utilization</h4>
      <div style={{ display: 'grid', gap: '8px', marginBottom: '24px' }}>
        {analytics.room_utilization && analytics.room_utilization.length > 0 ? (
          analytics.room_utilization.map((room, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <div style={{ minWidth: '80px', color: '#888' }}>{room.room_name}</div>
              <div
                style={{
                  flex: 1,
                  height: '16px',
                  backgroundColor: '#0f3460',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${room.utilization_percent}%`,
                    height: '100%',
                    backgroundColor: room.utilization_percent > 75 ? '#55ff55' : room.utilization_percent > 50 ? '#ffaa55' : '#ff8844',
                  }}
                />
              </div>
              <div style={{ minWidth: '40px', textAlign: 'right' }}>{Math.round(room.utilization_percent)}%</div>
            </div>
          ))
        ) : (
          <div style={{ color: '#666', textAlign: 'center', padding: '12px' }}>No utilization data</div>
        )}
      </div>

      <h4 style={{ marginTop: '20px', marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Case Status Distribution</h4>
      <div style={{ display: 'grid', gap: '8px', marginBottom: '24px' }}>
        {Object.entries(analytics.cases_by_status || {}).map(([status, count], idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <div style={{ minWidth: '100px', color: '#888' }}>{status.replace(/_/g, ' ')}</div>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 8px',
                backgroundColor: '#0f3460',
                borderRadius: '3px',
              }}
            >
              {count}
            </div>
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: '20px', marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Anesthesia Types</h4>
      <div style={{ display: 'grid', gap: '8px' }}>
        {Object.entries(analytics.anesthesia_types || {}).map(([type, count], idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <div style={{ minWidth: '120px', color: '#888' }}>{type.replace(/_/g, ' ')}</div>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 8px',
                backgroundColor: '#0f3460',
                borderRadius: '3px',
              }}
            >
              {count}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CLIENT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function OTManagementClient() {
  const [activeTab, setActiveTab] = useState<TabType>('board');

  // AI OT Intelligence State
  const [aiOTAnalysis, setAiOTAnalysis] = useState<any>(null);
  const [aiOTTurnover, setAiOTTurnover] = useState<any>(null);
  const [aiOTReport, setAiOTReport] = useState<any>(null);
  const [aiOTLoading, setAiOTLoading] = useState(false);
  const [aiOTError, setAiOTError] = useState('');
  const [schedules, setSchedules] = useState<OTSchedule[]>([]);
  const [rooms, setRooms] = useState<OTRoom[]>([]);
  const [anesthesiaRecords, setAnesthesiaRecords] = useState<AnesthesiaRecord[]>([]);
  const [analytics, setAnalytics] = useState<OTAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [schedulesData, roomsData, anesthesiaData, analyticsData] = await Promise.all([
          trpcQuery('otManagement.listSchedules', { status_filter: '', room_filter: '' }).catch(() => []),
          trpcQuery('otManagement.listRooms').catch(() => []),
          trpcQuery('otManagement.listAnesthesiaRecords').catch(() => []),
          trpcQuery('otManagement.getAnalytics').catch(() => null),
        ]);

        setSchedules(Array.isArray(schedulesData) ? schedulesData : []);
        setRooms(Array.isArray(roomsData) ? roomsData : []);
        setAnesthesiaRecords(Array.isArray(anesthesiaData) ? anesthesiaData : []);
        setAnalytics(analyticsData);
      } catch (err) {
        setError('Failed to load data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const tabs: Array<{ id: TabType; label: string; icon: string }> = [
    { id: 'board', label: 'OT Board', icon: '&#x1F3E5;' },
    { id: 'schedule', label: 'Schedule', icon: '&#x1F4C5;' },
    { id: 'rooms', label: 'Rooms', icon: '&#x1F6A4;' },
    { id: 'checklist', label: 'Checklist', icon: '&#x2713;' },
    { id: 'anesthesia', label: 'Anesthesia', icon: '&#x1F489;' },
    { id: 'analytics', label: 'Analytics', icon: '&#x1F4CA;' },
    { id: 'ai-ot', label: 'AI OT', icon: '🤖' },
  ];

  return (
    <div style={{ width: '100%', height: '100%', backgroundColor: '#0f1419', color: '#e0e0e0', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px', backgroundColor: '#16213e', borderBottom: '1px solid #0f3460' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>OT Management</h1>
      </div>

      {/* Error message */}
      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#4a1a1a', color: '#ff5555', borderBottom: '1px solid #0f3460' }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #0f3460', backgroundColor: '#16213e', overflowX: 'auto' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 16px',
              backgroundColor: activeTab === tab.id ? '#0f3460' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #55ccff' : '2px solid transparent',
              color: activeTab === tab.id ? '#55ccff' : '#888',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: activeTab === tab.id ? 600 : 400,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                (e.currentTarget as HTMLElement).style.color = '#aaa';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                (e.currentTarget as HTMLElement).style.color = '#888';
              }
            }}
          >
            <span style={{ marginRight: '6px' }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>&#x23F3;</div>
            <div>Loading OT data...</div>
          </div>
        ) : activeTab === 'board' ? (
          <OTBoardTab schedules={schedules} rooms={rooms} />
        ) : activeTab === 'schedule' ? (
          <ScheduleTab schedules={schedules} />
        ) : activeTab === 'rooms' ? (
          <RoomsTab rooms={rooms} />
        ) : activeTab === 'checklist' ? (
          <ChecklistTab schedules={schedules} />
        ) : activeTab === 'anesthesia' ? (
          <AnesthesiaTab records={anesthesiaRecords} />
        ) : activeTab === 'ai-ot' ? (
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#7C3AED' }}>🤖 AI OT Intelligence</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={async () => {
                    setAiOTLoading(true); setAiOTError('');
                    try {
                      const res = await fetch('/api/trpc/evenAI.analyzeOTSchedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: {} }) });
                      const json = await res.json();
                      if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
                      setAiOTAnalysis(json.result?.data?.json);
                    } catch (e: any) { setAiOTError(e.message); }
                    finally { setAiOTLoading(false); }
                  }}
                  disabled={aiOTLoading}
                  style={{ padding: '6px 12px', backgroundColor: '#7C3AED', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: aiOTLoading ? 0.5 : 1 }}
                >
                  Analyze Schedule
                </button>
                <button
                  onClick={async () => {
                    setAiOTLoading(true); setAiOTError('');
                    try {
                      const params = `?input=${encodeURIComponent(JSON.stringify({ days: 30 }))}`;
                      const res = await fetch(`/api/trpc/evenAI.getOTTurnover${params}`);
                      const json = await res.json();
                      if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
                      setAiOTTurnover(json.result?.data?.json?.analysis);
                    } catch (e: any) { setAiOTError(e.message); }
                    finally { setAiOTLoading(false); }
                  }}
                  disabled={aiOTLoading}
                  style={{ padding: '6px 12px', backgroundColor: '#5B21B6', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: aiOTLoading ? 0.5 : 1 }}
                >
                  Turnover Analysis
                </button>
                <button
                  onClick={async () => {
                    setAiOTLoading(true); setAiOTError('');
                    try {
                      const res = await fetch('/api/trpc/evenAI.getOTEfficiency', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: {} }) });
                      const json = await res.json();
                      if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
                      setAiOTReport(json.result?.data?.json);
                    } catch (e: any) { setAiOTError(e.message); }
                    finally { setAiOTLoading(false); }
                  }}
                  disabled={aiOTLoading}
                  style={{ padding: '6px 12px', backgroundColor: '#4C1D95', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: aiOTLoading ? 0.5 : 1 }}
                >
                  Efficiency Report
                </button>
              </div>
            </div>

            {aiOTError && (
              <div style={{ padding: '12px', backgroundColor: '#4a1a1a', color: '#ff5555', borderRadius: '6px', marginBottom: '12px', fontSize: '13px' }}>{aiOTError}</div>
            )}

            {aiOTLoading && <p style={{ color: '#7C3AED', fontSize: '13px' }}>Loading AI analysis...</p>}

            {aiOTAnalysis && (
              <div style={{ backgroundColor: '#1a1235', border: '1px solid #7C3AED33', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#a78bfa', marginBottom: '12px' }}>Schedule Analysis</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ backgroundColor: '#0f1419', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#888' }}>Procedures</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#55ccff' }}>{aiOTAnalysis.total_procedures || 0}</div>
                  </div>
                  <div style={{ backgroundColor: '#0f1419', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#888' }}>Utilization</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#55ccff' }}>{aiOTAnalysis.utilization_pct?.toFixed(0) || 0}%</div>
                  </div>
                  <div style={{ backgroundColor: '#0f1419', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#888' }}>Gaps Found</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: aiOTAnalysis.gaps_found > 0 ? '#f59e0b' : '#10b981' }}>{aiOTAnalysis.gaps_found || 0}</div>
                  </div>
                  <div style={{ backgroundColor: '#0f1419', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#888' }}>Overlaps</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: aiOTAnalysis.overlaps_found > 0 ? '#ef4444' : '#10b981' }}>{aiOTAnalysis.overlaps_found || 0}</div>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#888' }}>AI Cards Generated: {aiOTAnalysis.card_count || 0}</div>
              </div>
            )}

            {aiOTTurnover && (
              <div style={{ backgroundColor: '#1a1235', border: '1px solid #7C3AED33', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#a78bfa', marginBottom: '12px' }}>Turnover Analysis (30 days)</h3>
                <div style={{ fontSize: '13px', color: '#a78bfa', marginBottom: '8px' }}>Overall Avg Turnover: <strong>{aiOTTurnover.overall_avg_turnover_min?.toFixed(0) || 'N/A'} min</strong></div>
                {aiOTTurnover.rooms && aiOTTurnover.rooms.length > 0 && (
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #333' }}>
                        <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Room</th>
                        <th style={{ textAlign: 'right', padding: '8px', color: '#888' }}>Avg Turnover</th>
                        <th style={{ textAlign: 'right', padding: '8px', color: '#888' }}>Procedures</th>
                        <th style={{ textAlign: 'right', padding: '8px', color: '#888' }}>Utilization</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiOTTurnover.rooms.map((room: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #222' }}>
                          <td style={{ padding: '8px', color: '#e0e0e0' }}>{room.room_name || room.room_id?.slice(0, 8)}</td>
                          <td style={{ padding: '8px', textAlign: 'right', color: '#e0e0e0' }}>{room.avg_turnover_min?.toFixed(0) || 'N/A'} min</td>
                          <td style={{ padding: '8px', textAlign: 'right', color: '#e0e0e0' }}>{room.procedure_count || 0}</td>
                          <td style={{ padding: '8px', textAlign: 'right', color: '#e0e0e0' }}>{room.utilization_pct?.toFixed(0) || 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {aiOTReport && (
              <div style={{ backgroundColor: '#1a1235', border: '1px solid #7C3AED33', borderRadius: '8px', padding: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#a78bfa', marginBottom: '12px' }}>
                  Efficiency Report
                  <span style={{ marginLeft: '8px', fontSize: '10px', padding: '2px 6px', backgroundColor: aiOTReport.source === 'llm' ? '#7C3AED' : '#374151', color: '#fff', borderRadius: '4px' }}>
                    {aiOTReport.source === 'llm' ? 'AI Generated' : 'Template'}
                  </span>
                </h3>
                <div style={{ fontSize: '13px', color: '#d1d5db', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{aiOTReport.narrative}</div>
              </div>
            )}

            {!aiOTLoading && !aiOTAnalysis && !aiOTTurnover && !aiOTReport && !aiOTError && (
              <p style={{ color: '#888', fontSize: '13px' }}>Click one of the analysis buttons above to generate AI insights for OT operations.</p>
            )}
          </div>
        ) : (
          <AnalyticsTab analytics={analytics} />
        )}
      </div>
    </div>
  );
}
