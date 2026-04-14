'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Type Definitions ────────────────────────────────────────────────────────
interface LSQLeadCard {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F';
  procedure: string;
  doctor: string;
  source: string;
  phone: string;
  synced_at: string;
}

interface PatientCard {
  id: string;
  name: string;
  day_count: number;
  procedure: string;
  doctor: string;
  insurance_status: 'verified' | 'pending' | 'failed';
  insurance_amount?: string;
  next_action: string;
  tat_status: 'on_track' | 'at_risk' | 'exceeded';
  phase: 'pre_admission' | 'admitted' | 'pre_op' | 'in_surgery' | 'post_op' | 'dc_planning' | 'discharged_today';
}

interface KPIData {
  total_active: number;
  avg_los_days: number;
  avg_los_target: number;
  discharges_today: number;
  escalations_today: number;
  new_lsq_leads: number;
}

// ── Constants ───────────────────────────────────────────────────────────────
const KANBAN_COLUMNS = [
  { key: 'pre_admission', label: 'PRE-ADMISSION', bgColor: '#fffacd' },
  { key: 'admitted', label: 'ADMITTED', bgColor: '#e3f2fd' },
  { key: 'pre_op', label: 'PRE-OP', bgColor: '#e8eaf6' },
  { key: 'in_surgery', label: 'IN SURGERY', bgColor: '#f3e5f5' },
  { key: 'post_op', label: 'POST-OP', bgColor: '#e8f5e9' },
  { key: 'dc_planning', label: 'DC PLANNING', bgColor: '#fff3e0' },
  { key: 'discharged_today', label: 'DISCHARGED TODAY', bgColor: '#f5f5f5' },
] as const;

const COLOR_MAP = {
  navy: '#0d47a1',
  blue: '#1976d2',
  green: '#388e3c',
  amber: '#f57f17',
  red: '#c62828',
  lightGray: '#f5f5f5',
  white: '#ffffff',
  border: '#e0e0e0',
  text: '#212121',
  textLight: '#666666',
};

const PROCEDURE_MAP: Record<string, string> = {
  'CABG': 'CABG',
  'TKR': 'Total Knee Replacement',
  'hip': 'Hip Replacement',
  'appendix': 'Lap Appendectomy',
  'hernia': 'Hernia Repair',
  'chole': 'Lap Cholecystectomy',
  'pneumonia': 'Pneumonia Treatment',
};

// ── Mock Data (for demo; replace with actual API calls) ──────────────────────
const MOCK_LSQ_LEADS: LSQLeadCard[] = [
  {
    id: 'lead-1',
    name: 'Meena Kumari',
    age: 55,
    gender: 'F',
    procedure: 'Hip Replacement',
    doctor: 'Dr. Rajan',
    source: 'Even App',
    phone: '+91-98765-43210',
    synced_at: '14 Apr 07:00',
  },
  {
    id: 'lead-2',
    name: 'Rahul Verma',
    age: 42,
    gender: 'M',
    procedure: 'Lap Appendectomy',
    doctor: 'Dr. Gupta',
    source: 'Practo',
    phone: '+91-87654-32109',
    synced_at: '14 Apr 06:30',
  },
];

const MOCK_PATIENTS: PatientCard[] = [
  // PRE-ADMISSION (4)
  {
    id: 'pat-1',
    name: 'Meena Kumari',
    day_count: 0,
    procedure: 'Hip Replacement',
    doctor: 'Dr. Rajan',
    insurance_status: 'verified',
    insurance_amount: '₹3L',
    next_action: 'Pre-auth pending',
    tat_status: 'at_risk',
    phase: 'pre_admission',
  },
  {
    id: 'pat-2',
    name: 'Ananya Reddy',
    day_count: 1,
    procedure: 'Total Knee Replacement',
    doctor: 'Dr. Sharma',
    insurance_status: 'verified',
    insurance_amount: '₹2.5L',
    next_action: 'PAC scheduled',
    tat_status: 'on_track',
    phase: 'pre_admission',
  },
  {
    id: 'pat-3',
    name: 'Vikram Joshi',
    day_count: 2,
    procedure: 'Hernia Repair',
    doctor: 'Dr. Patel',
    insurance_status: 'verified',
    insurance_amount: '₹80K',
    next_action: 'Financial counselling done',
    tat_status: 'on_track',
    phase: 'pre_admission',
  },
  {
    id: 'pat-4',
    name: 'Deepika Nair',
    day_count: 0,
    procedure: 'Lap Cholecystectomy',
    doctor: 'Dr. Singh',
    insurance_status: 'pending',
    next_action: 'OT slot pending',
    tat_status: 'at_risk',
    phase: 'pre_admission',
  },
  // ADMITTED (6)
  {
    id: 'pat-5',
    name: 'Rajesh Kumar',
    day_count: 3,
    procedure: 'CABG',
    doctor: 'Dr. Sharma',
    insurance_status: 'verified',
    insurance_amount: '₹5L',
    next_action: 'Daily monitoring',
    tat_status: 'on_track',
    phase: 'admitted',
  },
  {
    id: 'pat-6',
    name: 'Priya Sharma',
    day_count: 1,
    procedure: 'Total Knee Replacement',
    doctor: 'Dr. Reddy',
    insurance_status: 'verified',
    insurance_amount: '₹2.5L',
    next_action: 'Pre-op labs due',
    tat_status: 'on_track',
    phase: 'admitted',
  },
  {
    id: 'pat-7',
    name: 'Suresh Patel',
    day_count: 5,
    procedure: 'Pneumonia Treatment',
    doctor: 'Dr. Gupta',
    insurance_status: 'verified',
    insurance_amount: '₹1.2L',
    next_action: 'Discharge planning',
    tat_status: 'exceeded',
    phase: 'admitted',
  },
  {
    id: 'pat-8',
    name: 'Amit Singh',
    day_count: 0,
    procedure: 'Lap Cholecystectomy',
    doctor: 'Dr. Nair',
    insurance_status: 'verified',
    insurance_amount: '₹90K',
    next_action: 'Admission checklist',
    tat_status: 'on_track',
    phase: 'admitted',
  },
  {
    id: 'pat-9',
    name: 'Kavitha Rao',
    day_count: 5,
    procedure: 'Total Knee Replacement',
    doctor: 'Dr. Bhat',
    insurance_status: 'verified',
    insurance_amount: '₹2.5L',
    next_action: 'DC counselling',
    tat_status: 'on_track',
    phase: 'admitted',
  },
  {
    id: 'pat-10',
    name: 'Nisha Gupta',
    day_count: 2,
    procedure: 'Appendectomy',
    doctor: 'Dr. Kumar',
    insurance_status: 'verified',
    insurance_amount: '₹70K',
    next_action: 'Wound check',
    tat_status: 'on_track',
    phase: 'admitted',
  },
  // PRE-OP (2)
  {
    id: 'pat-11',
    name: 'Lakshmi Devi',
    day_count: 0,
    procedure: 'Hip Replacement',
    doctor: 'Dr. Varma',
    insurance_status: 'verified',
    insurance_amount: '₹3L',
    next_action: 'PAC done',
    tat_status: 'on_track',
    phase: 'pre_op',
  },
  {
    id: 'pat-12',
    name: 'Arjun Mehta',
    day_count: 1,
    procedure: 'Hernia Repair',
    doctor: 'Dr. Saxena',
    insurance_status: 'verified',
    insurance_amount: '₹80K',
    next_action: 'Labs pending',
    tat_status: 'at_risk',
    phase: 'pre_op',
  },
  // IN SURGERY (1)
  {
    id: 'pat-13',
    name: 'Sanjay Kumar',
    day_count: 0,
    procedure: 'Total Knee Replacement',
    doctor: 'Dr. Chopra',
    insurance_status: 'verified',
    insurance_amount: '₹2.5L',
    next_action: 'OT-2, 2h 15min elapsed',
    tat_status: 'on_track',
    phase: 'in_surgery',
  },
  // POST-OP (3)
  {
    id: 'pat-14',
    name: 'Rajesh K',
    day_count: 3,
    procedure: 'CABG',
    doctor: 'Dr. Sharma',
    insurance_status: 'verified',
    insurance_amount: '₹5L',
    next_action: 'ICU monitoring',
    tat_status: 'on_track',
    phase: 'post_op',
  },
  {
    id: 'pat-15',
    name: 'Geeta Sharma',
    day_count: 1,
    procedure: 'Lap Cholecystectomy',
    doctor: 'Dr. Singh',
    insurance_status: 'verified',
    insurance_amount: '₹90K',
    next_action: 'Pain management',
    tat_status: 'on_track',
    phase: 'post_op',
  },
  {
    id: 'pat-16',
    name: 'Mohan Das',
    day_count: 2,
    procedure: 'Hernia Repair',
    doctor: 'Dr. Patel',
    insurance_status: 'verified',
    insurance_amount: '₹80K',
    next_action: 'Mobilization',
    tat_status: 'on_track',
    phase: 'post_op',
  },
  // DC PLANNING (2)
  {
    id: 'pat-17',
    name: 'Kavitha R',
    day_count: 5,
    procedure: 'Total Knee Replacement',
    doctor: 'Dr. Bhat',
    insurance_status: 'verified',
    insurance_amount: '₹2.5L',
    next_action: 'DC tomorrow',
    tat_status: 'on_track',
    phase: 'dc_planning',
  },
  {
    id: 'pat-18',
    name: 'Suresh P',
    day_count: 5,
    procedure: 'Pneumonia Treatment',
    doctor: 'Dr. Gupta',
    insurance_status: 'verified',
    insurance_amount: '₹1.2L',
    next_action: 'Billing pending',
    tat_status: 'at_risk',
    phase: 'dc_planning',
  },
  // DISCHARGED TODAY (1)
  {
    id: 'pat-19',
    name: 'Ravi Krishnan',
    day_count: 5,
    procedure: 'Total Knee Replacement',
    doctor: 'Dr. Menon',
    insurance_status: 'verified',
    insurance_amount: '₹2.5L',
    next_action: 'Discharged 09:30',
    tat_status: 'on_track',
    phase: 'discharged_today',
  },
];

// ── Component: KPI Card ──────────────────────────────────────────────────────
function KPICard({
  label,
  value,
  subtext,
  bgColor,
  textColor,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  bgColor: string;
  textColor: string;
}) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        backgroundColor: bgColor,
        minWidth: '140px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: '500',
          color: COLOR_MAP.textLight,
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '20px',
          fontWeight: '700',
          color: textColor,
        }}
      >
        {value}
      </div>
      {subtext && (
        <div
          style={{
            fontSize: '11px',
            color: COLOR_MAP.textLight,
            marginTop: '2px',
          }}
        >
          {subtext}
        </div>
      )}
    </div>
  );
}

// ── Component: LSQ Lead Card ─────────────────────────────────────────────────
function LSQLeadCard({ lead }: { lead: LSQLeadCard }) {
  return (
    <div
      style={{
        backgroundColor: COLOR_MAP.white,
        border: `1px solid ${COLOR_MAP.border}`,
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '8px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: '600',
              color: COLOR_MAP.text,
            }}
          >
            {lead.name}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: COLOR_MAP.textLight,
              marginTop: '2px',
            }}
          >
            {lead.age}
            {lead.gender === 'F' ? 'F' : 'M'} | {lead.procedure}
          </div>
        </div>
        <div
          style={{
            fontSize: '11px',
            backgroundColor: '#e3f2fd',
            color: COLOR_MAP.blue,
            padding: '2px 6px',
            borderRadius: '4px',
            fontWeight: '500',
          }}
        >
          {lead.source}
        </div>
      </div>

      <div
        style={{
          fontSize: '12px',
          color: COLOR_MAP.textLight,
          marginBottom: '4px',
        }}
      >
        Dr. {lead.doctor.replace('Dr. ', '')} | Phone: {lead.phone}
      </div>

      <div
        style={{
          fontSize: '11px',
          color: '#999',
          marginBottom: '8px',
        }}
      >
        Synced: {lead.synced_at}
      </div>

      <button
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: COLOR_MAP.blue,
          color: COLOR_MAP.white,
          border: 'none',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: '600',
          cursor: 'pointer',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = '#1565c0';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = COLOR_MAP.blue;
        }}
      >
        Begin Pre-Admission
      </button>
    </div>
  );
}

// ── Component: Patient Mini Card ─────────────────────────────────────────────
function PatientMiniCard({
  patient,
  onClick,
}: {
  patient: PatientCard;
  onClick: () => void;
}) {
  const getTATColor = (status: string) => {
    if (status === 'on_track') return '#4caf50';
    if (status === 'at_risk') return '#ff9800';
    return '#d32f2f';
  };

  const getTATLabel = (status: string) => {
    if (status === 'on_track') return '✓ On track';
    if (status === 'at_risk') return '⚠ At risk';
    return '✗ Exceeded';
  };

  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: COLOR_MAP.white,
        border: `1px solid ${COLOR_MAP.border}`,
        borderRadius: '8px',
        padding: '8px',
        marginBottom: '8px',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        minWidth: '180px',
        flexShrink: 0,
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.12)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '4px',
        }}
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: '600',
            color: COLOR_MAP.text,
            flex: 1,
          }}
        >
          {patient.name}
        </div>
        <div
          style={{
            fontSize: '11px',
            fontWeight: '600',
            color: '#999',
            marginLeft: '4px',
          }}
        >
          Day {patient.day_count}
        </div>
      </div>

      <div
        style={{
          fontSize: '11px',
          color: COLOR_MAP.textLight,
          marginBottom: '4px',
          lineHeight: '1.3',
        }}
      >
        {patient.procedure} · {patient.doctor}
      </div>

      {patient.insurance_amount && (
        <div
          style={{
            fontSize: '11px',
            color: '#4caf50',
            fontWeight: '500',
            marginBottom: '4px',
          }}
        >
          {patient.insurance_amount} ✓
        </div>
      )}

      <div
        style={{
          fontSize: '10px',
          color: COLOR_MAP.textLight,
          marginBottom: '4px',
          lineHeight: '1.3',
          minHeight: '20px',
        }}
      >
        {patient.next_action}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: '10px',
          fontWeight: '500',
          color: getTATColor(patient.tat_status),
        }}
      >
        {getTATLabel(patient.tat_status)}
      </div>
    </div>
  );
}

// ── Component: Kanban Column ─────────────────────────────────────────────────
function KanbanColumn({
  column,
  patients,
  onCardClick,
}: {
  column: (typeof KANBAN_COLUMNS)[number];
  patients: PatientCard[];
  onCardClick: (patient: PatientCard) => void;
}) {
  const patientCount = patients.length;

  return (
    <div
      style={{
        minWidth: '220px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          backgroundColor: column.bgColor,
          padding: '8px 12px',
          borderRadius: '6px 6px 0 0',
          fontSize: '12px',
          fontWeight: '700',
          color: COLOR_MAP.text,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <span>{column.label}</span>
        <span
          style={{
            backgroundColor: COLOR_MAP.text,
            color: COLOR_MAP.white,
            borderRadius: '12px',
            padding: '2px 6px',
            fontSize: '11px',
            fontWeight: '600',
          }}
        >
          {patientCount}
        </span>
      </div>

      <div
        style={{
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 320px)',
          flex: 1,
        }}
      >
        {patients.length === 0 ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              fontSize: '12px',
              color: '#ccc',
            }}
          >
            No patients
          </div>
        ) : (
          patients.map((patient) => (
            <PatientMiniCard
              key={patient.id}
              patient={patient}
              onClick={() => onCardClick(patient)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Component: Detail Panel ──────────────────────────────────────────────────
function DetailPanel({
  patient,
  onClose,
}: {
  patient: PatientCard | null;
  onClose: () => void;
}) {
  if (!patient) return null;

  const phaseMap: Record<string, number> = {
    pre_admission: 1,
    admitted: 2,
    pre_op: 3,
    in_surgery: 4,
    post_op: 5,
    dc_planning: 6,
    discharged_today: 7,
  };

  const currentPhase = phaseMap[patient.phase];

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        width: '320px',
        height: '100vh',
        backgroundColor: COLOR_MAP.white,
        borderLeft: `1px solid ${COLOR_MAP.border}`,
        boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: `1px solid ${COLOR_MAP.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: '14px',
            fontWeight: '700',
            color: COLOR_MAP.text,
          }}
        >
          Patient Details
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: COLOR_MAP.textLight,
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {/* Patient Info */}
        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              fontSize: '16px',
              fontWeight: '700',
              color: COLOR_MAP.text,
              marginBottom: '4px',
            }}
          >
            {patient.name}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: COLOR_MAP.textLight,
            }}
          >
            Day {patient.day_count} of admission
          </div>
        </div>

        {/* Procedure & Doctor */}
        <div
          style={{
            backgroundColor: '#f5f5f5',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLOR_MAP.textLight,
              marginBottom: '4px',
            }}
          >
            PROCEDURE & DOCTOR
          </div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: '600',
              color: COLOR_MAP.text,
              marginBottom: '2px',
            }}
          >
            {patient.procedure}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: COLOR_MAP.textLight,
            }}
          >
            {patient.doctor}
          </div>
        </div>

        {/* Insurance */}
        <div
          style={{
            backgroundColor: '#f5f5f5',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLOR_MAP.textLight,
              marginBottom: '4px',
            }}
          >
            INSURANCE STATUS
          </div>
          <div
            style={{
              fontSize: '12px',
              color:
                patient.insurance_status === 'verified'
                  ? '#4caf50'
                  : patient.insurance_status === 'pending'
                    ? '#ff9800'
                    : '#d32f2f',
              fontWeight: '600',
              textTransform: 'capitalize',
            }}
          >
            {patient.insurance_status}
          </div>
          {patient.insurance_amount && (
            <div
              style={{
                fontSize: '12px',
                color: COLOR_MAP.text,
                marginTop: '4px',
              }}
            >
              {patient.insurance_amount}
            </div>
          )}
        </div>

        {/* Journey Timeline */}
        <div
          style={{
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLOR_MAP.textLight,
              marginBottom: '8px',
            }}
          >
            JOURNEY TIMELINE
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { label: 'Pre-Adm', phase: 1 },
              { label: 'Admitted', phase: 2 },
              { label: 'Pre-Op', phase: 3 },
              { label: 'Surgery', phase: 4 },
              { label: 'Post-Op', phase: 5 },
              { label: 'DC Plan', phase: 6 },
              { label: 'Discharged', phase: 7 },
            ].map((item) => (
              <div
                key={item.phase}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: '500',
                  backgroundColor:
                    item.phase === currentPhase
                      ? COLOR_MAP.blue
                      : item.phase < currentPhase
                        ? COLOR_MAP.green
                        : COLOR_MAP.lightGray,
                  color:
                    item.phase <= currentPhase
                      ? COLOR_MAP.white
                      : COLOR_MAP.textLight,
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>

        {/* Pending Actions */}
        <div
          style={{
            backgroundColor: '#f5f5f5',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLOR_MAP.textLight,
              marginBottom: '4px',
            }}
          >
            PENDING ACTIONS
          </div>
          <div
            style={{
              fontSize: '12px',
              color: COLOR_MAP.text,
              lineHeight: '1.5',
            }}
          >
            {patient.next_action}
          </div>
        </div>

        {/* TAT Status */}
        <div
          style={{
            backgroundColor:
              patient.tat_status === 'on_track'
                ? '#e8f5e9'
                : patient.tat_status === 'at_risk'
                  ? '#fff3e0'
                  : '#ffebee',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLOR_MAP.textLight,
              marginBottom: '4px',
            }}
          >
            TAT STATUS
          </div>
          <div
            style={{
              fontSize: '12px',
              fontWeight: '600',
              color:
                patient.tat_status === 'on_track'
                  ? '#4caf50'
                  : patient.tat_status === 'at_risk'
                    ? '#ff9800'
                    : '#d32f2f',
              textTransform: 'capitalize',
            }}
          >
            {patient.tat_status.replace('_', ' ')}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div
        style={{
          padding: '16px',
          borderTop: `1px solid ${COLOR_MAP.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <button
          style={{
            padding: '10px',
            backgroundColor: COLOR_MAP.blue,
            color: COLOR_MAP.white,
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#1565c0';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = COLOR_MAP.blue;
          }}
        >
          Advance Journey
        </button>
        <button
          style={{
            padding: '10px',
            backgroundColor: COLOR_MAP.red,
            color: COLOR_MAP.white,
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#b71c1c';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = COLOR_MAP.red;
          }}
        >
          Flag Issue
        </button>
        <button
          style={{
            padding: '10px',
            backgroundColor: COLOR_MAP.green,
            color: COLOR_MAP.white,
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#2e7d32';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = COLOR_MAP.green;
          }}
        >
          Contact Team
        </button>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
interface Props {
  userId: string;
  userRole: string;
  userName: string;
}

export default function CoordinatorPipelineClient({
  userId,
  userRole,
  userName,
}: Props) {
  const [kpiData, setKPIData] = useState<KPIData>({
    total_active: 19,
    avg_los_days: 4.2,
    avg_los_target: 3.5,
    discharges_today: 3,
    escalations_today: 1,
    new_lsq_leads: 2,
  });

  const [lsqLeads, setLsqLeads] = useState<LSQLeadCard[]>(MOCK_LSQ_LEADS);
  const [allPatients, setAllPatients] = useState<PatientCard[]>(MOCK_PATIENTS);
  const [selectedPatient, setSelectedPatient] = useState<PatientCard | null>(null);

  const handleSwitchView = (viewName: string) => {
    const url = viewName === 'gantt' ? '/care/customer-care' : `/care/customer-care?view=${viewName}`;
    window.location.href = url;
  };

  const patientsByPhase = (phase: string) =>
    allPatients.filter((p) => p.phase === phase);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#fafafa',
      }}
    >
      {/* Header with Tabs */}
      <div
        style={{
          backgroundColor: COLOR_MAP.white,
          borderBottom: `1px solid ${COLOR_MAP.border}`,
          padding: '12px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: '700',
              color: COLOR_MAP.text,
              marginBottom: '4px',
              margin: 0,
            }}
          >
            🏥 Customer Care — Patient Journey
          </h1>
          <p
            style={{
              fontSize: '12px',
              color: COLOR_MAP.textLight,
              margin: 0,
            }}
          >
            Kanban pipeline view for admission coordination
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => handleSwitchView('gantt')}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #e0e0e0',
              backgroundColor: '#f5f5f5',
              color: '#333',
              fontWeight: '600',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#efefef';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }}
          >
            📊 Gantt View
          </button>
          <button
            onClick={() => handleSwitchView('pipeline')}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: '#1565c0',
              color: COLOR_MAP.white,
              fontWeight: '600',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#1e40af';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#1565c0';
            }}
          >
            🔀 Pipeline View
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          padding: '20px',
        }}
      >

        {/* KPI Cards */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '24px',
            overflowX: 'auto',
            paddingBottom: '8px',
          }}
        >
          <KPICard
            label="Total Active"
            value={kpiData.total_active}
            bgColor={COLOR_MAP.navy}
            textColor={COLOR_MAP.white}
          />
          <KPICard
            label="Avg LOS"
            value={`${kpiData.avg_los_days}d`}
            subtext={`target ${kpiData.avg_los_target}d`}
            bgColor="#fff3e0"
            textColor={COLOR_MAP.amber}
          />
          <KPICard
            label="Discharges Today"
            value={kpiData.discharges_today}
            bgColor="#e8f5e9"
            textColor={COLOR_MAP.green}
          />
          <KPICard
            label="Escalations"
            value={kpiData.escalations_today}
            bgColor="#ffebee"
            textColor={COLOR_MAP.red}
          />
          <KPICard
            label="New LSQ Leads"
            value={kpiData.new_lsq_leads}
            bgColor="#e3f2fd"
            textColor={COLOR_MAP.blue}
          />
        </div>

        {/* LSQ Leads Section */}
        <div style={{ marginBottom: '24px' }}>
          <h2
            style={{
              fontSize: '14px',
              fontWeight: '700',
              color: COLOR_MAP.text,
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            📌 New LSQ Leads
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            {lsqLeads.map((lead) => (
              <LSQLeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        </div>

        {/* Kanban Pipeline */}
        <div style={{ marginBottom: '24px' }}>
          <h2
            style={{
              fontSize: '14px',
              fontWeight: '700',
              color: COLOR_MAP.text,
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Patient Pipeline
          </h2>

          <div
            style={{
              display: 'flex',
              gap: '12px',
              overflowX: 'auto',
              paddingBottom: '12px',
              backgroundColor: COLOR_MAP.white,
              borderRadius: '8px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            {KANBAN_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.key}
                column={column}
                patients={patientsByPhase(column.key)}
                onCardClick={setSelectedPatient}
              />
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        <DetailPanel
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
        />
      </div>
    </div>
  );
}
