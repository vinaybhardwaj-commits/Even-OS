'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ─── Types (match bed router response) ───────────────────────
type Bed = {
  id: string;
  code: string;
  name: string;
  bed_status: 'available' | 'occupied' | 'reserved' | 'blocked' | 'housekeeping' | 'terminal_cleaning' | 'maintenance';
  patient_id?: string;
  patient_uhid?: string;
  patient_name?: string;
  patient_gender?: string;
  encounter_id?: string;
  encounter_class?: string;
  admission_at?: string;
  diagnosis?: string;
  chief_complaint?: string;
  expected_los_days?: number;
  journey_type?: string;
  terminal_cleaning_started_at?: string;
};

type PreflightWarning = {
  type: 'gender_mismatch' | 'isolation_room' | 'pre_auth_required' | 'bed_not_available' | string;
  severity: 'warn' | 'info';
  message: string;
};

type AssignmentPreflight = {
  bed: { id: string; code: string; room_code: string; ward_name: string; room_type: string; room_tag: string };
  patient: { id: string; uhid: string; name_full: string; gender: string; patient_category: string };
  co_occupant_gender: string | null;
  warnings: PreflightWarning[];
};

type TransferPreflight = {
  encounter: { id: string; patient_name: string; patient_uhid: string; gender: string };
  destination_bed: { id: string; code: string; room_code: string; ward_name: string };
  co_occupant_gender: string | null;
  warnings: PreflightWarning[];
};

type QueuePatient = {
  id: string;
  uhid: string;
  name_full: string;
  phone: string;
  gender: string;
  dob: string;
  blood_group: string;
  patient_category: string;
  created_at: string;
};

type TransferBedOption = {
  bed_id: string;
  bed_code: string;
  bed_name: string;
  bed_status: string;
  room_id: string;
  room_code: string;
  room_type: string;
  room_tag: string;
  ward_id: string;
  ward_code: string;
  ward_name: string;
  ward_type: string;
  floor_id: string;
  floor_name: string;
  floor_number: number;
};

type DischargeMilestone = {
  id: string;
  milestone: string;
  sequence: number;
  completed_at: string | null;
  notes: string | null;
};

type DischargeReadiness = {
  order: { id: string; status: string; reason: string; summary: string | null; ordered_at: string } | null;
  milestones: DischargeMilestone[];
  total: number;
  done: number;
  all_complete: boolean;
};

type DrawerAction = 'status' | 'tag' | 'history' | 'assign' | 'transfer' | 'discharge' | null;

type AdmitFormState = {
  encounter_class: 'ipd' | 'emergency' | 'day_care';
  admission_type: 'elective' | 'emergency' | 'day_care' | 'transfer_in';
  chief_complaint: string;
  preliminary_diagnosis: string;
  expected_los_days: string;
  pre_auth_status: 'not_required' | 'obtained' | 'override';
  pre_auth_number: string;
  pre_auth_override_reason: string;
};

type DischargeFormState = {
  reason: 'recovered' | 'referred' | 'self_discharge' | 'death' | 'lama';
  summary: string;
  force: boolean;
};

type Room = {
  id: string;
  code: string;
  name: string;
  room_type: string;
  room_tag: string;
  capacity: number;
  infrastructure_flags: any;
  beds: Bed[];
};

type Ward = {
  id: string;
  code: string;
  name: string;
  ward_type: string;
  capacity: number;
  infrastructure_flags: any;
  rooms: Room[];
};

type Floor = {
  id: string;
  code: string;
  name: string;
  floor_number: number;
  wards: Ward[];
};

type StatusCounts = {
  available: number;
  occupied: number;
  reserved: number;
  blocked: number;
  housekeeping: number;
  terminal_cleaning: number;
  maintenance: number;
  total: number;
};

type WardSummary = {
  ward_code: string;
  ward_name: string;
  ward_type: string;
  floor_number: number;
  total: number;
  available: number;
  occupied: number;
};

type Stats = {
  global: StatusCounts;
  floor: StatusCounts | null;
  wards: WardSummary[];
};

type FloorSummary = {
  id: string;
  code: string;
  name: string;
  floor_number: number;
  total_beds: number;
  available_beds: number;
  occupied_beds: number;
};

type BedHistoryEntry = {
  id: string;
  status: string;
  reason: string | null;
  changed_at: string;
  changed_by_user_id: string | null;
};

// ─── tRPC fetch helpers ──────────────────────────────────────
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

// ─── Utility helpers ─────────────────────────────────────────
function getGenderIcon(gender?: string): string {
  if (!gender) return '';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return '♂';
  if (g === 'female' || g === 'f') return '♀';
  return '◯';
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatDateTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function daysSince(isoString?: string): number {
  if (!isoString) return 0;
  const ms = Date.now() - new Date(isoString).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function formatDuration(isoString?: string): { label: string; mins: number } {
  if (!isoString) return { label: '—', mins: 0 };
  const mins = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 60000));
  if (mins < 60) return { label: `${mins}m`, mins };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { label: `${h}h ${m}m`, mins };
}

// SLA threshold (minutes) for terminal cleaning turnaround
const TERMINAL_SLA_MINS = 120;

function slaTone(mins: number): { chip: string; label: string } {
  if (mins < 60) return { chip: 'bg-purple-100 text-purple-800 border-purple-200', label: 'on-track' };
  if (mins < TERMINAL_SLA_MINS) return { chip: 'bg-amber-100 text-amber-800 border-amber-200', label: 'nearing SLA' };
  return { chip: 'bg-red-100 text-red-800 border-red-200', label: 'SLA BREACHED' };
}

// ─── Status styling ──────────────────────────────────────────
const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; label: string; dot: string }> = {
  available:         { bg: 'bg-green-50',   border: 'border-green-300',   text: 'text-green-800',   label: 'Available',         dot: 'bg-green-500' },
  occupied:          { bg: 'bg-blue-50',    border: 'border-blue-400',    text: 'text-blue-900',    label: 'Occupied',          dot: 'bg-blue-500' },
  reserved:          { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-800',   label: 'Reserved',          dot: 'bg-amber-500' },
  blocked:           { bg: 'bg-red-50',     border: 'border-red-300',     text: 'text-red-800',     label: 'Blocked',           dot: 'bg-red-500' },
  housekeeping:      { bg: 'bg-orange-50',  border: 'border-orange-300',  text: 'text-orange-800',  label: 'Housekeeping',      dot: 'bg-orange-500' },
  terminal_cleaning: { bg: 'bg-purple-50',  border: 'border-purple-300',  text: 'text-purple-800',  label: 'Terminal Cleaning', dot: 'bg-purple-500' },
  maintenance:       { bg: 'bg-gray-100',   border: 'border-gray-400',    text: 'text-gray-700',    label: 'Maintenance',       dot: 'bg-gray-500' },
};

const ROOM_TAG_STYLES: Record<string, { label: string; className: string }> = {
  none:      { label: '',          className: '' },
  day_care:  { label: 'Day Care',  className: 'bg-teal-100 text-teal-800' },
  maternity: { label: 'Maternity', className: 'bg-pink-100 text-pink-800' },
  isolation: { label: 'Isolation', className: 'bg-red-100 text-red-800' },
};

const WARD_TYPE_LABELS: Record<string, string> = {
  general: 'General Ward',
  icu: 'ICU',
  nicu: 'NICU',
  pacu: 'PACU',
  dialysis: 'Dialysis',
  day_care: 'Day Care',
  maternity: 'Maternity',
  step_down: 'Step-Down',
};

const ADMIN_ROLES = new Set(['super_admin', 'hospital_admin', 'gm']);

// ─── Main Client Component ───────────────────────────────────
interface BedBoardClientProps {
  userRole: string;
}

export function BedBoardClient({ userRole }: BedBoardClientProps) {
  const isAdmin = ADMIN_ROLES.has(userRole);

  const [floorsList, setFloorsList] = useState<FloorSummary[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');
  const [boardData, setBoardData] = useState<Floor[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [drawerBed, setDrawerBed] = useState<{ bed: Bed; room: Room; ward: Ward; floor: Floor } | null>(null);
  const [drawerReason, setDrawerReason] = useState('');
  const [drawerAction, setDrawerAction] = useState<DrawerAction>(null);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [drawerHistory, setDrawerHistory] = useState<BedHistoryEntry[]>([]);

  // ─── BM.3 Operational flow state ───
  // Assign
  const [assignTab, setAssignTab] = useState<'queue' | 'walkin'>('queue');
  const [assignSearch, setAssignSearch] = useState('');
  const [assignQueue, setAssignQueue] = useState<QueuePatient[]>([]);
  const [walkinResults, setWalkinResults] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [assignPreflight, setAssignPreflight] = useState<AssignmentPreflight | null>(null);
  const [admitForm, setAdmitForm] = useState<AdmitFormState>({
    encounter_class: 'ipd',
    admission_type: 'elective',
    chief_complaint: '',
    preliminary_diagnosis: '',
    expected_los_days: '',
    pre_auth_status: 'not_required',
    pre_auth_number: '',
    pre_auth_override_reason: '',
  });

  // Transfer
  const [transferBeds, setTransferBeds] = useState<TransferBedOption[]>([]);
  const [transferFilterFloor, setTransferFilterFloor] = useState<number | 'all'>('all');
  const [transferSelectedBedId, setTransferSelectedBedId] = useState<string | null>(null);
  const [transferPreflight, setTransferPreflight] = useState<TransferPreflight | null>(null);

  // Discharge
  const [dischargeReadiness, setDischargeReadiness] = useState<DischargeReadiness | null>(null);
  const [dischargeForm, setDischargeForm] = useState<DischargeFormState>({
    reason: 'recovered',
    summary: '',
    force: false,
  });

  // AI Bed Intelligence
  const [showAI, setShowAI] = useState(false);
  const [aiPredictions, setAiPredictions] = useState<any[]>([]);
  const [aiForecast, setAiForecast] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const pollInterval = useRef<NodeJS.Timeout>();

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const boardInput = selectedFloor === 'all' ? undefined : { floor_number: selectedFloor };
      const statsInput = selectedFloor === 'all' ? undefined : { floor_number: selectedFloor };
      const [board, statsData, floorsData] = await Promise.all([
        trpcQuery('bed.board', boardInput),
        trpcQuery('bed.stats', statsInput),
        trpcQuery('bed.listFloors'),
      ]);
      setBoardData(board?.floors || []);
      setStats(statsData);
      setFloorsList(floorsData || []);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load bed board');
      setLoading(false);
    }
  }, [selectedFloor]);

  useEffect(() => {
    fetchData();
    if (pollInterval.current) clearInterval(pollInterval.current);
    pollInterval.current = setInterval(fetchData, 10000);
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [fetchData]);

  // Refresh drawer state after fetch
  useEffect(() => {
    if (!drawerBed) return;
    for (const floor of boardData) {
      for (const ward of floor.wards) {
        for (const room of ward.rooms) {
          for (const bed of room.beds) {
            if (bed.id === drawerBed.bed.id) {
              setDrawerBed({ bed, room, ward, floor });
              return;
            }
          }
        }
      }
    }
  }, [boardData]);

  const resetFlowState = () => {
    setAssignTab('queue');
    setAssignSearch('');
    setAssignQueue([]);
    setWalkinResults([]);
    setSelectedPatient(null);
    setAssignPreflight(null);
    setAdmitForm({
      encounter_class: 'ipd',
      admission_type: 'elective',
      chief_complaint: '',
      preliminary_diagnosis: '',
      expected_los_days: '',
      pre_auth_status: 'not_required',
      pre_auth_number: '',
      pre_auth_override_reason: '',
    });
    setTransferBeds([]);
    setTransferFilterFloor('all');
    setTransferSelectedBedId(null);
    setTransferPreflight(null);
    setDischargeReadiness(null);
    setDischargeForm({ reason: 'recovered', summary: '', force: false });
  };

  const handleBedClick = (bed: Bed, room: Room, ward: Ward, floor: Floor) => {
    setDrawerBed({ bed, room, ward, floor });
    setDrawerReason('');
    setDrawerAction(null);
    setDrawerHistory([]);
    resetFlowState();
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      await trpcMutate('bed.updateStatus', {
        bed_id: drawerBed.bed.id,
        status: newStatus,
        reason: drawerReason || undefined,
      });
      setSuccess(`Bed ${drawerBed.bed.code} → ${STATUS_STYLES[newStatus]?.label || newStatus}`);
      setDrawerAction(null);
      setDrawerReason('');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Status update failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleTagRoom = async (tag: 'none' | 'day_care' | 'maternity' | 'isolation') => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      await trpcMutate('bed.tagRoom', {
        room_id: drawerBed.room.id,
        tag,
        reason: drawerReason || undefined,
      });
      setSuccess(`Room ${drawerBed.room.code} tag → ${tag === 'none' ? 'cleared' : tag}`);
      setDrawerAction(null);
      setDrawerReason('');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Tag update failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleLoadHistory = async () => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      const history = await trpcQuery('bed.history', { bed_id: drawerBed.bed.id, limit: 20 });
      setDrawerHistory(history || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    } finally {
      setDrawerBusy(false);
    }
  };

  // ─── BM.3 HANDLERS ───
  const handleOpenAssign = async () => {
    if (!drawerBed) return;
    resetFlowState();
    setDrawerAction('assign');
    setDrawerBusy(true);
    try {
      const queue = await trpcQuery('bed.admissionQueue', { limit: 20 });
      setAssignQueue(queue || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load admission queue');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSearchAssignQueue = async (search: string) => {
    setAssignSearch(search);
    if (search.trim().length > 0 && search.trim().length < 2) return;
    setDrawerBusy(true);
    try {
      const queue = await trpcQuery('bed.admissionQueue', {
        search: search.trim() || undefined,
        limit: 20,
      });
      setAssignQueue(queue || []);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSearchWalkin = async (term: string) => {
    setAssignSearch(term);
    if (term.trim().length < 2) {
      setWalkinResults([]);
      return;
    }
    setDrawerBusy(true);
    try {
      const results = await trpcQuery('patient.search', { query: term.trim(), limit: 20 });
      setWalkinResults(Array.isArray(results) ? results : (results?.items || []));
    } catch (err: any) {
      setError(err.message || 'Patient search failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSelectPatientForAssign = async (patient: any) => {
    if (!drawerBed) return;
    // "Change patient" path — clear selection and preflight
    if (!patient) {
      setSelectedPatient(null);
      setAssignPreflight(null);
      return;
    }
    setSelectedPatient(patient);
    setDrawerBusy(true);
    try {
      const preflight = await trpcQuery('bed.assignmentPreflight', {
        bed_id: drawerBed.bed.id,
        patient_id: patient.id,
      });
      setAssignPreflight(preflight);
      // Auto-set pre_auth_status based on category
      if (preflight?.patient?.patient_category === 'insured') {
        setAdmitForm(f => ({ ...f, pre_auth_status: 'obtained' }));
      }
    } catch (err: any) {
      setError(err.message || 'Preflight failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSubmitAdmit = async () => {
    if (!drawerBed || !selectedPatient) return;
    if (!admitForm.chief_complaint.trim()) {
      setError('Chief complaint is required');
      return;
    }
    setDrawerBusy(true);
    try {
      await trpcMutate('encounter.admit', {
        patient_id: selectedPatient.id,
        encounter_class: admitForm.encounter_class,
        admission_type: admitForm.admission_type,
        chief_complaint: admitForm.chief_complaint.trim(),
        preliminary_diagnosis: admitForm.preliminary_diagnosis.trim() || undefined,
        expected_los_days: admitForm.expected_los_days ? parseInt(admitForm.expected_los_days, 10) : undefined,
        bed_id: drawerBed.bed.id,
        pre_auth_status: admitForm.pre_auth_status,
        pre_auth_number: admitForm.pre_auth_number.trim() || undefined,
        pre_auth_override_reason: admitForm.pre_auth_override_reason.trim() || undefined,
      });
      setSuccess(`Admitted ${selectedPatient.name_full} to bed ${drawerBed.bed.code}`);
      setDrawerAction(null);
      resetFlowState();
      await fetchData();
      setTimeout(() => setSuccess(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Admission failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleOpenTransfer = async () => {
    if (!drawerBed) return;
    resetFlowState();
    setDrawerAction('transfer');
    setDrawerBusy(true);
    try {
      const beds = await trpcQuery('bed.availableBedsForTransfer', {
        exclude_bed_id: drawerBed.bed.id,
        limit: 150,
      });
      setTransferBeds(beds || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load available beds');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSelectTransferBed = async (bed: TransferBedOption) => {
    if (!drawerBed?.bed.encounter_id) return;
    setTransferSelectedBedId(bed.bed_id);
    setDrawerBusy(true);
    try {
      const preflight = await trpcQuery('bed.transferPreflight', {
        encounter_id: drawerBed.bed.encounter_id,
        to_bed_id: bed.bed_id,
      });
      setTransferPreflight(preflight);
    } catch (err: any) {
      setError(err.message || 'Transfer preflight failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSubmitTransfer = async () => {
    if (!drawerBed?.bed.encounter_id || !transferSelectedBedId) return;
    if (!drawerReason.trim()) {
      setError('Transfer reason is required');
      return;
    }
    setDrawerBusy(true);
    try {
      await trpcMutate('encounter.transfer', {
        encounter_id: drawerBed.bed.encounter_id,
        to_bed_id: transferSelectedBedId,
        transfer_type: 'bed',
        reason: drawerReason.trim(),
      });
      setSuccess(`Transfer complete — bed released to terminal cleaning`);
      setDrawerAction(null);
      setDrawerReason('');
      resetFlowState();
      await fetchData();
      setTimeout(() => setSuccess(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Transfer failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleOpenDischarge = async () => {
    if (!drawerBed?.bed.encounter_id) return;
    resetFlowState();
    setDrawerAction('discharge');
    setDrawerBusy(true);
    try {
      const readiness = await trpcQuery('bed.dischargeReadiness', {
        encounter_id: drawerBed.bed.encounter_id,
      });
      setDischargeReadiness(readiness);
    } catch (err: any) {
      setError(err.message || 'Failed to load discharge readiness');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleSubmitDischarge = async () => {
    if (!drawerBed?.bed.encounter_id) return;
    setDrawerBusy(true);
    try {
      // Initiate discharge if no order exists yet
      if (!dischargeReadiness?.order || dischargeReadiness.order.status === 'completed') {
        await trpcMutate('encounter.initiateDischarge', {
          encounter_id: drawerBed.bed.encounter_id,
          reason: dischargeForm.reason,
          summary: dischargeForm.summary.trim() || undefined,
        });
      }
      // Complete discharge
      await trpcMutate('encounter.completeDischarge', {
        encounter_id: drawerBed.bed.encounter_id,
        force: dischargeForm.force,
      });
      setSuccess(`Discharged — bed released to terminal cleaning (2h SLA)`);
      setDrawerAction(null);
      resetFlowState();
      await fetchData();
      setTimeout(() => setSuccess(''), 3500);
    } catch (err: any) {
      setError(err.message || 'Discharge failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const handleMarkClean = async () => {
    if (!drawerBed) return;
    setDrawerBusy(true);
    try {
      await trpcMutate('bed.updateStatus', {
        bed_id: drawerBed.bed.id,
        status: 'available',
        reason: drawerReason.trim() || 'Terminal cleaning complete — bed available',
      });
      setSuccess(`Bed ${drawerBed.bed.code} marked available`);
      setDrawerReason('');
      await fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Mark clean failed');
    } finally {
      setDrawerBusy(false);
    }
  };

  const loadAIData = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const [preds, forecast] = await Promise.all([
        trpcQuery('evenAI.getBedPredictions', {}),
        trpcQuery('evenAI.getOccupancyForecast', { days: 7 }),
      ]);
      setAiPredictions(preds?.predictions || []);
      setAiForecast(forecast?.forecast || null);
    } catch (err: any) {
      setAiError(err.message || 'Failed to load AI predictions');
    } finally {
      setAiLoading(false);
    }
  };

  const runPredictions = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      await trpcMutate('evenAI.runBedPredictions', {});
      await loadAIData();
    } catch (err: any) {
      setAiError(err.message || 'Failed to run predictions');
      setAiLoading(false);
    }
  };

  // Flatten to the wards we should render (on selected floor, or all floors stacked)
  const displayedFloors = useMemo(() => {
    if (selectedFloor === 'all') return boardData;
    return boardData.filter(f => f.floor_number === selectedFloor);
  }, [boardData, selectedFloor]);

  const displayedStats = stats?.floor || stats?.global || null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">
            &larr; Dashboard
          </a>
          <h1 className="text-xl font-bold">Bed Board</h1>
          <span className="text-xs text-blue-200">3-tier · Floor → Ward → Room → Bed</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-blue-100">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Live · 10s
          </span>
          {lastUpdated && (
            <span>
              {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </header>

      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Floor Tabs */}
        <div className="mb-5">
          <div className="flex items-center gap-2 border-b border-gray-200">
            <button
              onClick={() => setSelectedFloor('all')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                selectedFloor === 'all'
                  ? 'border-blue-900 text-blue-900'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              All Floors
              <span className="ml-2 text-xs text-gray-500">
                {stats?.global.total || 0} beds
              </span>
            </button>
            {floorsList.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedFloor(f.floor_number)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  selectedFloor === f.floor_number
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {f.name}
                <span className="ml-2 text-xs text-gray-500">
                  {f.occupied_beds}/{f.total_beds}
                </span>
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-50 rounded disabled:opacity-50 mb-1"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {displayedStats && (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
            <StatCard label="Total" value={displayedStats.total} tone="blue" />
            <StatCard label="Available" value={displayedStats.available} tone="green" />
            <StatCard label="Occupied" value={displayedStats.occupied} tone="blue-solid" />
            <StatCard label="Reserved" value={displayedStats.reserved} tone="amber" />
            <StatCard label="Blocked" value={displayedStats.blocked} tone="red" />
            <StatCard label="HK" value={displayedStats.housekeeping} tone="orange" />
            <StatCard label="Terminal" value={displayedStats.terminal_cleaning} tone="purple" />
            <StatCard label="Maint." value={displayedStats.maintenance} tone="gray" />
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 font-medium">×</button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* AI Panel Toggle */}
        <div className="mb-6">
          <button
            onClick={() => { setShowAI(!showAI); if (!showAI && aiPredictions.length === 0) loadAIData(); }}
            className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 flex items-center gap-2"
          >
            🤖 {showAI ? 'Hide' : 'Show'} AI Bed Intelligence
          </button>

          {showAI && (
            <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-violet-900">AI Bed Intelligence</h2>
                <button
                  onClick={runPredictions}
                  disabled={aiLoading}
                  className="px-3 py-1 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {aiLoading ? 'Running…' : 'Run Predictions'}
                </button>
              </div>

              {aiError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">{aiError}</div>}
              {aiLoading && <p className="text-violet-700 text-xs">Loading AI predictions…</p>}

              {aiForecast && (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold text-violet-800 mb-2">Occupancy Forecast (7 days)</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Current Occupancy</p>
                      <p className="text-lg font-bold text-violet-900">{aiForecast.current?.occupancy_pct?.toFixed(0) || 0}%</p>
                    </div>
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Occupied / Total</p>
                      <p className="text-lg font-bold text-violet-900">{aiForecast.current?.occupied || 0} / {aiForecast.current?.total_beds || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Pred. Discharges Today</p>
                      <p className="text-lg font-bold text-green-700">{aiForecast.predicted_discharges?.[0]?.count || 0}</p>
                    </div>
                    <div className="bg-white rounded p-2 border border-violet-100">
                      <p className="text-[10px] text-gray-500">Pred. Discharges (7d)</p>
                      <p className="text-lg font-bold text-green-700">
                        {aiForecast.predicted_discharges?.reduce((s: number, d: any) => s + (d.count || 0), 0) || 0}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {aiPredictions.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-violet-800 mb-2">Discharge Predictions ({aiPredictions.length})</h3>
                  <div className="bg-white rounded border border-violet-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-violet-100 text-violet-900">
                          <th className="text-left p-2">Bed</th>
                          <th className="text-left p-2">Patient</th>
                          <th className="text-left p-2">Predicted</th>
                          <th className="text-left p-2">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiPredictions.slice(0, 20).map((pred: any, idx: number) => (
                          <tr key={idx} className="border-t border-violet-50">
                            <td className="p-2 font-medium">{pred.bed_number || pred.bed_id?.slice(0, 8)}</td>
                            <td className="p-2">{pred.patient_name || 'N/A'}</td>
                            <td className="p-2">{pred.predicted_discharge_at ? formatDateTime(pred.predicted_discharge_at) : 'N/A'}</td>
                            <td className="p-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                (pred.confidence || 0) >= 0.8 ? 'bg-green-100 text-green-800'
                                : (pred.confidence || 0) >= 0.5 ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                                {((pred.confidence || 0) * 100).toFixed(0)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!aiLoading && aiPredictions.length === 0 && !aiError && (
                <p className="text-violet-700 text-xs">No predictions yet. Click &quot;Run Predictions&quot;.</p>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mb-5 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-gray-500 font-medium">Bed Status:</span>
          {Object.entries(STATUS_STYLES).map(([status, s]) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.dot}`} />
              <span className="text-gray-700">{s.label}</span>
            </span>
          ))}
        </div>

        {/* Floor Canvas */}
        {loading && boardData.length === 0 ? (
          <div className="text-center py-12 text-gray-500">Loading bed board…</div>
        ) : displayedFloors.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No active beds for this floor.</div>
        ) : (
          <div className="space-y-6">
            {displayedFloors.map(floor => (
              <FloorSection
                key={floor.id}
                floor={floor}
                onBedClick={handleBedClick}
                activeBedId={drawerBed?.bed.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Right-side Drawer */}
      {drawerBed && (
        <BedDrawer
          data={drawerBed}
          isAdmin={isAdmin}
          busy={drawerBusy}
          reason={drawerReason}
          setReason={setDrawerReason}
          action={drawerAction}
          setAction={setDrawerAction}
          history={drawerHistory}
          onLoadHistory={handleLoadHistory}
          onUpdateStatus={handleUpdateStatus}
          onTagRoom={handleTagRoom}
          // BM.3 flows
          assignTab={assignTab}
          setAssignTab={setAssignTab}
          assignSearch={assignSearch}
          assignQueue={assignQueue}
          walkinResults={walkinResults}
          selectedPatient={selectedPatient}
          assignPreflight={assignPreflight}
          admitForm={admitForm}
          setAdmitForm={setAdmitForm}
          onOpenAssign={handleOpenAssign}
          onSearchAssignQueue={handleSearchAssignQueue}
          onSearchWalkin={handleSearchWalkin}
          onSelectPatientForAssign={handleSelectPatientForAssign}
          onSubmitAdmit={handleSubmitAdmit}
          transferBeds={transferBeds}
          transferFilterFloor={transferFilterFloor}
          setTransferFilterFloor={setTransferFilterFloor}
          transferSelectedBedId={transferSelectedBedId}
          transferPreflight={transferPreflight}
          onOpenTransfer={handleOpenTransfer}
          onSelectTransferBed={handleSelectTransferBed}
          onSubmitTransfer={handleSubmitTransfer}
          dischargeReadiness={dischargeReadiness}
          dischargeForm={dischargeForm}
          setDischargeForm={setDischargeForm}
          onOpenDischarge={handleOpenDischarge}
          onSubmitDischarge={handleSubmitDischarge}
          onMarkClean={handleMarkClean}
          onClose={() => {
            setDrawerBed(null);
            setDrawerAction(null);
            setDrawerReason('');
            setDrawerHistory([]);
            resetFlowState();
          }}
        />
      )}
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'blue-solid' | 'green' | 'amber' | 'red' | 'orange' | 'purple' | 'gray';
}) {
  const tones: Record<string, { border: string; text: string; label: string }> = {
    blue:         { border: 'border-blue-200',   text: 'text-blue-900',    label: 'text-blue-600' },
    'blue-solid': { border: 'border-blue-300',   text: 'text-blue-800',    label: 'text-blue-700' },
    green:        { border: 'border-green-200',  text: 'text-green-700',   label: 'text-green-600' },
    amber:        { border: 'border-amber-200',  text: 'text-amber-700',   label: 'text-amber-600' },
    red:          { border: 'border-red-200',    text: 'text-red-700',     label: 'text-red-600' },
    orange:       { border: 'border-orange-200', text: 'text-orange-700',  label: 'text-orange-600' },
    purple:       { border: 'border-purple-200', text: 'text-purple-700',  label: 'text-purple-600' },
    gray:         { border: 'border-gray-200',   text: 'text-gray-700',    label: 'text-gray-600' },
  };
  const t = tones[tone];
  return (
    <div className={`bg-white rounded-lg p-3 border ${t.border} shadow-sm`}>
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${t.label}`}>{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${t.text}`}>{value}</p>
    </div>
  );
}

// ─── FloorSection ────────────────────────────────────────────
function FloorSection({
  floor,
  onBedClick,
  activeBedId,
}: {
  floor: Floor;
  onBedClick: (bed: Bed, room: Room, ward: Ward, floor: Floor) => void;
  activeBedId?: string;
}) {
  const floorTotalBeds = floor.wards.reduce((sum, w) => sum + w.rooms.reduce((s, r) => s + r.beds.length, 0), 0);
  const floorOccupied = floor.wards.reduce((sum, w) =>
    sum + w.rooms.reduce((s, r) => s + r.beds.filter(b => b.bed_status === 'occupied').length, 0), 0
  );

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3 pb-2 border-b-2 border-gray-300">
        <h2 className="text-xl font-bold text-gray-900">{floor.name}</h2>
        <span className="text-xs text-gray-500">
          {floor.wards.length} ward{floor.wards.length !== 1 ? 's' : ''} · {floorOccupied}/{floorTotalBeds} occupied
        </span>
      </div>

      <div className="space-y-4">
        {floor.wards.map(ward => (
          <WardSection
            key={ward.id}
            ward={ward}
            floor={floor}
            onBedClick={onBedClick}
            activeBedId={activeBedId}
          />
        ))}
      </div>
    </section>
  );
}

// ─── WardSection ─────────────────────────────────────────────
function WardSection({
  ward,
  floor,
  onBedClick,
  activeBedId,
}: {
  ward: Ward;
  floor: Floor;
  onBedClick: (bed: Bed, room: Room, ward: Ward, floor: Floor) => void;
  activeBedId?: string;
}) {
  const totalBeds = ward.rooms.reduce((s, r) => s + r.beds.length, 0);
  const occupied = ward.rooms.reduce((s, r) => s + r.beds.filter(b => b.bed_status === 'occupied').length, 0);
  const available = ward.rooms.reduce((s, r) => s + r.beds.filter(b => b.bed_status === 'available').length, 0);
  const wardTypeLabel = WARD_TYPE_LABELS[ward.ward_type] || ward.ward_type;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-semibold text-gray-900">{ward.name}</h3>
          <span className="text-xs text-gray-500">{wardTypeLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium">{available} avail</span>
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">{occupied} occ</span>
          <span className="text-gray-500">of {totalBeds}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {ward.rooms.map(room => (
          <RoomCard
            key={room.id}
            room={room}
            ward={ward}
            floor={floor}
            onBedClick={onBedClick}
            activeBedId={activeBedId}
          />
        ))}
      </div>
    </div>
  );
}

// ─── RoomCard ────────────────────────────────────────────────
function RoomCard({
  room,
  ward,
  floor,
  onBedClick,
  activeBedId,
}: {
  room: Room;
  ward: Ward;
  floor: Floor;
  onBedClick: (bed: Bed, room: Room, ward: Ward, floor: Floor) => void;
  activeBedId?: string;
}) {
  const capacity = Math.max(room.beds.length, room.capacity || 1);
  // Proportional width: semi-private (2 beds) is wider than private/suite (1 bed)
  const widthClass = capacity === 2 ? 'w-[22rem]' : 'w-[10.5rem]';
  const roomTypeLabel: Record<string, string> = {
    private: 'Private',
    semi_private: 'Semi-Private',
    suite: 'Suite',
    icu_room: 'ICU',
    nicu_room: 'NICU',
    pacu_bay: 'PACU Bay',
    dialysis_station: 'Dialysis',
    general: 'General',
  };
  const label = roomTypeLabel[room.room_type] || room.room_type;
  const tag = ROOM_TAG_STYLES[room.room_tag || 'none'] || ROOM_TAG_STYLES.none;

  return (
    <div className={`${widthClass} border border-gray-300 rounded-lg bg-gray-50 p-2 shadow-sm`}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800">{room.code}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
        {tag.label && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${tag.className}`}>
            {tag.label}
          </span>
        )}
      </div>

      <div className={`grid gap-2 ${capacity === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {room.beds.map(bed => (
          <BedCell
            key={bed.id}
            bed={bed}
            isActive={activeBedId === bed.id}
            onClick={() => onBedClick(bed, room, ward, floor)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── BedCell ─────────────────────────────────────────────────
function BedCell({
  bed,
  isActive,
  onClick,
}: {
  bed: Bed;
  isActive: boolean;
  onClick: () => void;
}) {
  const style = STATUS_STYLES[bed.bed_status] || STATUS_STYLES.available;
  const isOccupied = bed.bed_status === 'occupied';
  const isTerminal = bed.bed_status === 'terminal_cleaning';
  const sla = isTerminal ? formatDuration(bed.terminal_cleaning_started_at) : null;
  const slaStyle = sla ? slaTone(sla.mins) : null;

  return (
    <button
      onClick={onClick}
      className={`text-left relative border-2 rounded-md p-2 min-h-[100px] transition-all hover:shadow-md ${
        style.bg
      } ${style.border} ${isActive ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-900">{bed.code}</span>
        <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      </div>

      {isOccupied && bed.patient_name ? (
        <div className="space-y-0.5">
          <div className="text-[11px] font-semibold text-gray-900 truncate">
            {bed.patient_name}
          </div>
          <div className="text-[10px] text-gray-600 truncate">
            {getGenderIcon(bed.patient_gender)} {bed.patient_uhid}
          </div>
          {bed.admission_at && (
            <div className="text-[10px] text-gray-500">
              Day {daysSince(bed.admission_at) + 1}
            </div>
          )}
          {bed.diagnosis && (
            <div className="text-[10px] text-gray-600 line-clamp-2 leading-tight">
              {bed.diagnosis}
            </div>
          )}
        </div>
      ) : isTerminal && sla && slaStyle ? (
        <div className="text-center py-1">
          <div className={`text-xs font-medium ${style.text}`}>{style.label}</div>
          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${slaStyle.chip}`}>
            ⏱ {sla.label}
          </span>
        </div>
      ) : (
        <div className={`text-center py-3 text-xs font-medium ${style.text}`}>
          {style.label}
        </div>
      )}
    </button>
  );
}

// ─── BedDrawer (Right-side panel) ────────────────────────────
function BedDrawer({
  data,
  isAdmin,
  busy,
  reason,
  setReason,
  action,
  setAction,
  history,
  onLoadHistory,
  onUpdateStatus,
  onTagRoom,
  // BM.3
  assignTab,
  setAssignTab,
  assignSearch,
  assignQueue,
  walkinResults,
  selectedPatient,
  assignPreflight,
  admitForm,
  setAdmitForm,
  onOpenAssign,
  onSearchAssignQueue,
  onSearchWalkin,
  onSelectPatientForAssign,
  onSubmitAdmit,
  transferBeds,
  transferFilterFloor,
  setTransferFilterFloor,
  transferSelectedBedId,
  transferPreflight,
  onOpenTransfer,
  onSelectTransferBed,
  onSubmitTransfer,
  dischargeReadiness,
  dischargeForm,
  setDischargeForm,
  onOpenDischarge,
  onSubmitDischarge,
  onMarkClean,
  onClose,
}: {
  data: { bed: Bed; room: Room; ward: Ward; floor: Floor };
  isAdmin: boolean;
  busy: boolean;
  reason: string;
  setReason: (s: string) => void;
  action: DrawerAction;
  setAction: (a: DrawerAction) => void;
  history: BedHistoryEntry[];
  onLoadHistory: () => void;
  onUpdateStatus: (status: string) => void;
  onTagRoom: (tag: 'none' | 'day_care' | 'maternity' | 'isolation') => void;
  // BM.3
  assignTab: 'queue' | 'walkin';
  setAssignTab: (t: 'queue' | 'walkin') => void;
  assignSearch: string;
  assignQueue: QueuePatient[];
  walkinResults: any[];
  selectedPatient: any | null;
  assignPreflight: AssignmentPreflight | null;
  admitForm: AdmitFormState;
  setAdmitForm: (f: AdmitFormState | ((prev: AdmitFormState) => AdmitFormState)) => void;
  onOpenAssign: () => void;
  onSearchAssignQueue: (s: string) => void;
  onSearchWalkin: (s: string) => void;
  onSelectPatientForAssign: (p: any) => void;
  onSubmitAdmit: () => void;
  transferBeds: TransferBedOption[];
  transferFilterFloor: number | 'all';
  setTransferFilterFloor: (f: number | 'all') => void;
  transferSelectedBedId: string | null;
  transferPreflight: TransferPreflight | null;
  onOpenTransfer: () => void;
  onSelectTransferBed: (b: TransferBedOption) => void;
  onSubmitTransfer: () => void;
  dischargeReadiness: DischargeReadiness | null;
  dischargeForm: DischargeFormState;
  setDischargeForm: (f: DischargeFormState | ((prev: DischargeFormState) => DischargeFormState)) => void;
  onOpenDischarge: () => void;
  onSubmitDischarge: () => void;
  onMarkClean: () => void;
  onClose: () => void;
}) {
  const { bed, room, ward, floor } = data;
  const style = STATUS_STYLES[bed.bed_status] || STATUS_STYLES.available;
  const isOccupied = bed.bed_status === 'occupied';
  const isAvailable = bed.bed_status === 'available';
  const isTerminal = bed.bed_status === 'terminal_cleaning';
  const currentTag = room.room_tag || 'none';

  const statusOptions: Array<{ status: string; label: string; color: string }> = [
    { status: 'available',         label: 'Mark Available',         color: 'bg-green-600 hover:bg-green-700' },
    { status: 'reserved',          label: 'Reserve',                color: 'bg-amber-600 hover:bg-amber-700' },
    { status: 'blocked',           label: 'Block',                  color: 'bg-red-600 hover:bg-red-700' },
    { status: 'housekeeping',      label: 'Housekeeping',           color: 'bg-orange-600 hover:bg-orange-700' },
    { status: 'terminal_cleaning', label: 'Terminal Cleaning',      color: 'bg-purple-600 hover:bg-purple-700' },
    { status: 'maintenance',       label: 'Maintenance',            color: 'bg-gray-600 hover:bg-gray-700' },
  ].filter(o => o.status !== bed.bed_status);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-30" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-40 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`p-4 border-b-2 ${style.border} ${style.bg}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl font-bold text-gray-900">{bed.code}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
                  {style.label}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                {floor.name} · {ward.name} · Room {room.code}
              </div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl leading-none">×</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Patient Info (if occupied) */}
          {isOccupied && bed.patient_name ? (
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Patient</h3>
              <div className="space-y-1.5">
                <div>
                  <div className="text-base font-semibold text-gray-900">
                    {getGenderIcon(bed.patient_gender)} {bed.patient_name}
                  </div>
                  <div className="text-xs text-gray-600">UHID: {bed.patient_uhid}</div>
                </div>
                {bed.admission_at && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Admitted:</span>{' '}
                    {formatDateTime(bed.admission_at)}
                    <span className="text-gray-500 ml-1">(Day {daysSince(bed.admission_at) + 1})</span>
                  </div>
                )}
                {bed.encounter_class && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Class:</span> {bed.encounter_class}
                  </div>
                )}
                {bed.expected_los_days != null && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Expected LOS:</span> {bed.expected_los_days} day(s)
                  </div>
                )}
                {bed.chief_complaint && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Complaint:</span> {bed.chief_complaint}
                  </div>
                )}
                {bed.diagnosis && bed.diagnosis !== bed.chief_complaint && (
                  <div className="text-xs text-gray-700">
                    <span className="text-gray-500">Diagnosis:</span> {bed.diagnosis}
                  </div>
                )}
                {bed.encounter_id && (
                  <a
                    href={`/admin/encounters/${bed.encounter_id}`}
                    className="inline-block mt-2 text-xs text-blue-700 hover:text-blue-900 font-medium"
                  >
                    View encounter →
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Status</h3>
              <div className="text-sm text-gray-700">
                Bed is currently <span className="font-semibold">{style.label.toLowerCase()}</span>.
              </div>
            </div>
          )}

          {/* Room Info */}
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Room</h3>
            <div className="text-sm text-gray-800">
              <div><span className="text-gray-500">Type:</span> {room.room_type.replace('_', '-')}</div>
              <div><span className="text-gray-500">Capacity:</span> {room.capacity} bed{room.capacity !== 1 ? 's' : ''}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gray-500">Tag:</span>
                {currentTag === 'none' ? (
                  <span className="text-gray-400 italic">none</span>
                ) : (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${ROOM_TAG_STYLES[currentTag]?.className || ''}`}>
                    {ROOM_TAG_STYLES[currentTag]?.label || currentTag}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 space-y-3">
            {action === null && (
              <>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Actions</h3>

                {/* Primary actions — BM.3 */}
                {isOccupied && (
                  <>
                    <button
                      onClick={onOpenTransfer}
                      className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Transfer Patient
                    </button>
                    <button
                      onClick={onOpenDischarge}
                      className="w-full px-3 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Discharge Patient
                    </button>
                  </>
                )}

                {isAvailable && (
                  <button
                    onClick={onOpenAssign}
                    className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Assign Patient
                  </button>
                )}

                {/* Mark Clean quick action for terminal_cleaning */}
                {isTerminal && (
                  <button
                    onClick={onMarkClean}
                    disabled={busy}
                    className="w-full px-3 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    ✓ Mark Clean → Available
                  </button>
                )}

                {!isOccupied && (
                  <button
                    onClick={() => setAction('status')}
                    className="w-full px-3 py-2 text-sm font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Change Status
                  </button>
                )}

                <button
                  onClick={() => setAction('tag')}
                  className="w-full px-3 py-2 text-sm font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Tag Room
                </button>

                <button
                  onClick={() => { setAction('history'); onLoadHistory(); }}
                  className="w-full px-3 py-2 text-sm font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  View History
                </button>
              </>
            )}

            {action === 'status' && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase">Change Status</h3>
                  <button onClick={() => setAction(null)} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
                </div>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  maxLength={200}
                  rows={2}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="space-y-1.5">
                  {statusOptions.map(opt => (
                    <button
                      key={opt.status}
                      onClick={() => onUpdateStatus(opt.status)}
                      disabled={busy}
                      className={`w-full px-3 py-2 text-sm font-medium text-white rounded disabled:opacity-50 ${opt.color}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {action === 'tag' && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase">Tag Room</h3>
                  <button onClick={() => setAction(null)} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
                </div>
                <p className="text-xs text-gray-600">
                  Room tags are temporary (e.g., Day Care auto-clears on discharge). Applies to all beds in {room.code}.
                </p>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  maxLength={200}
                  rows={2}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  {(['none', 'day_care', 'maternity', 'isolation'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => onTagRoom(t)}
                      disabled={busy || t === currentTag}
                      className={`px-3 py-2 text-xs font-medium rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                        t === currentTag
                          ? 'bg-gray-100 text-gray-500 border-gray-300'
                          : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {t === 'none' ? 'Clear Tag' : ROOM_TAG_STYLES[t].label}
                      {t === currentTag && ' (current)'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {action === 'assign' && (
              <AssignPanel
                bed={bed}
                room={room}
                busy={busy}
                assignTab={assignTab}
                setAssignTab={setAssignTab}
                assignSearch={assignSearch}
                assignQueue={assignQueue}
                walkinResults={walkinResults}
                selectedPatient={selectedPatient}
                assignPreflight={assignPreflight}
                admitForm={admitForm}
                setAdmitForm={setAdmitForm}
                onSearchAssignQueue={onSearchAssignQueue}
                onSearchWalkin={onSearchWalkin}
                onSelectPatientForAssign={onSelectPatientForAssign}
                onSubmitAdmit={onSubmitAdmit}
                onBack={() => setAction(null)}
              />
            )}

            {action === 'transfer' && (
              <TransferPanel
                bed={bed}
                ward={ward}
                floor={floor}
                busy={busy}
                reason={reason}
                setReason={setReason}
                transferBeds={transferBeds}
                transferFilterFloor={transferFilterFloor}
                setTransferFilterFloor={setTransferFilterFloor}
                transferSelectedBedId={transferSelectedBedId}
                transferPreflight={transferPreflight}
                onSelectTransferBed={onSelectTransferBed}
                onSubmitTransfer={onSubmitTransfer}
                onBack={() => setAction(null)}
              />
            )}

            {action === 'discharge' && (
              <DischargePanel
                bed={bed}
                busy={busy}
                dischargeReadiness={dischargeReadiness}
                dischargeForm={dischargeForm}
                setDischargeForm={setDischargeForm}
                onSubmitDischarge={onSubmitDischarge}
                onBack={() => setAction(null)}
              />
            )}

            {action === 'history' && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase">Status History</h3>
                  <button onClick={() => setAction(null)} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
                </div>
                {busy && history.length === 0 ? (
                  <p className="text-xs text-gray-500">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-gray-500">No history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map(h => {
                      const s = STATUS_STYLES[h.status] || STATUS_STYLES.available;
                      return (
                        <div key={h.id} className="text-xs border-l-2 pl-2 py-1" style={{ borderColor: 'currentColor' }}>
                          <div className="flex items-center justify-between">
                            <span className={`font-semibold ${s.text}`}>{s.label}</span>
                            <span className="text-gray-500">{formatDateTime(h.changed_at)}</span>
                          </div>
                          {h.reason && <div className="text-gray-600 mt-0.5">{h.reason}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Admin-only quick links */}
            {isAdmin && action === null && (
              <div className="pt-3 mt-3 border-t border-gray-200">
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Admin</h3>
                <div className="space-y-1.5">
                  <a
                    href="/admin/bed-structure"
                    className="block w-full px-3 py-2 text-xs font-medium bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 text-center"
                  >
                    Edit Layout <span className="text-gray-400">(BM.4)</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── AssignPanel ─────────────────────────────────────────────
function AssignPanel({
  bed,
  room,
  busy,
  assignTab,
  setAssignTab,
  assignSearch,
  assignQueue,
  walkinResults,
  selectedPatient,
  assignPreflight,
  admitForm,
  setAdmitForm,
  onSearchAssignQueue,
  onSearchWalkin,
  onSelectPatientForAssign,
  onSubmitAdmit,
  onBack,
}: {
  bed: Bed;
  room: Room;
  busy: boolean;
  assignTab: 'queue' | 'walkin';
  setAssignTab: (t: 'queue' | 'walkin') => void;
  assignSearch: string;
  assignQueue: QueuePatient[];
  walkinResults: any[];
  selectedPatient: any | null;
  assignPreflight: AssignmentPreflight | null;
  admitForm: AdmitFormState;
  setAdmitForm: (f: AdmitFormState | ((prev: AdmitFormState) => AdmitFormState)) => void;
  onSearchAssignQueue: (s: string) => void;
  onSearchWalkin: (s: string) => void;
  onSelectPatientForAssign: (p: any) => void;
  onSubmitAdmit: () => void;
  onBack: () => void;
}) {
  const isInsured = selectedPatient?.patient_category === 'insured' || assignPreflight?.patient?.patient_category === 'insured';

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Assign Patient to {bed.code}</h3>
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
      </div>

      {!selectedPatient ? (
        <>
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setAssignTab('queue')}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                assignTab === 'queue' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Admission Queue
            </button>
            <button
              onClick={() => setAssignTab('walkin')}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                assignTab === 'walkin' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Walk-in / Search
            </button>
          </div>

          {/* Search box */}
          <input
            type="text"
            value={assignSearch}
            onChange={e => {
              const v = e.target.value;
              if (assignTab === 'queue') onSearchAssignQueue(v);
              else onSearchWalkin(v);
            }}
            placeholder={assignTab === 'queue' ? 'Filter queue by name / UHID / phone' : 'Search patients (min 2 chars)'}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Results list */}
          <div className="max-h-64 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
            {(assignTab === 'queue' ? assignQueue : walkinResults).length === 0 ? (
              <div className="p-3 text-xs text-gray-500 text-center">
                {busy ? 'Loading…' : assignTab === 'walkin' && assignSearch.trim().length < 2
                  ? 'Type at least 2 characters to search.'
                  : 'No patients found.'}
              </div>
            ) : (
              (assignTab === 'queue' ? assignQueue : walkinResults).map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => onSelectPatientForAssign(p)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {getGenderIcon(p.gender)} {p.name_full || p.name}
                      </div>
                      <div className="text-[11px] text-gray-600">
                        {p.uhid} · {p.phone || 'no phone'}
                      </div>
                    </div>
                    {p.patient_category && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        p.patient_category === 'insured' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {p.patient_category}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          {/* Selected patient summary */}
          <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-blue-900">
                {getGenderIcon(selectedPatient.gender)} {selectedPatient.name_full || selectedPatient.name}
              </div>
              <div className="text-[11px] text-blue-700">
                {selectedPatient.uhid} · {selectedPatient.phone || 'no phone'}
                {selectedPatient.patient_category && ` · ${selectedPatient.patient_category}`}
              </div>
            </div>
            <button
              onClick={() => onSelectPatientForAssign(null as any)}
              className="text-[11px] text-blue-700 hover:text-blue-900 underline"
            >
              change
            </button>
          </div>

          {/* Preflight warnings */}
          {assignPreflight?.warnings && assignPreflight.warnings.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-semibold text-gray-500 uppercase">Pre-admission checks</h4>
              {assignPreflight.warnings.map((w, i) => (
                <div key={i} className={`text-xs px-2 py-1.5 rounded border flex items-start gap-2 ${
                  w.severity === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'
                }`}>
                  <span className="font-semibold">{w.severity === 'warn' ? '⚠' : 'ℹ'}</span>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Admit form */}
          <div className="space-y-2 pt-1 border-t border-gray-100">
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase mt-2">Admission details</h4>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Encounter class</label>
                <select
                  value={admitForm.encounter_class}
                  onChange={e => setAdmitForm(f => ({ ...f, encounter_class: e.target.value as any }))}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-1"
                >
                  <option value="ipd">IPD</option>
                  <option value="emergency">Emergency</option>
                  <option value="day_care">Day Care</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-medium">Admission type</label>
                <select
                  value={admitForm.admission_type}
                  onChange={e => setAdmitForm(f => ({ ...f, admission_type: e.target.value as any }))}
                  className="w-full text-xs border border-gray-300 rounded px-1.5 py-1"
                >
                  <option value="elective">Elective</option>
                  <option value="emergency">Emergency</option>
                  <option value="day_care">Day Care</option>
                  <option value="transfer_in">Transfer-In</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-gray-500 font-medium">Chief complaint <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={admitForm.chief_complaint}
                onChange={e => setAdmitForm(f => ({ ...f, chief_complaint: e.target.value }))}
                maxLength={500}
                placeholder="e.g. Chest pain, fever for 3 days"
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-1"
              />
            </div>

            <div>
              <label className="text-[10px] text-gray-500 font-medium">Preliminary diagnosis</label>
              <input
                type="text"
                value={admitForm.preliminary_diagnosis}
                onChange={e => setAdmitForm(f => ({ ...f, preliminary_diagnosis: e.target.value }))}
                maxLength={500}
                placeholder="optional"
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-1"
              />
            </div>

            <div>
              <label className="text-[10px] text-gray-500 font-medium">Expected LOS (days)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={admitForm.expected_los_days}
                onChange={e => setAdmitForm(f => ({ ...f, expected_los_days: e.target.value }))}
                placeholder="optional"
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-1"
              />
            </div>

            {isInsured && (
              <div className="bg-purple-50 border border-purple-200 rounded p-2 space-y-2">
                <h5 className="text-[11px] font-semibold text-purple-900">Pre-authorization (insured)</h5>
                <select
                  value={admitForm.pre_auth_status}
                  onChange={e => setAdmitForm(f => ({ ...f, pre_auth_status: e.target.value as any }))}
                  className="w-full text-xs border border-purple-300 rounded px-1.5 py-1 bg-white"
                >
                  <option value="obtained">Obtained</option>
                  <option value="override">Emergency override</option>
                </select>
                {admitForm.pre_auth_status === 'obtained' && (
                  <input
                    type="text"
                    value={admitForm.pre_auth_number}
                    onChange={e => setAdmitForm(f => ({ ...f, pre_auth_number: e.target.value }))}
                    maxLength={100}
                    placeholder="Pre-auth number"
                    className="w-full text-xs border border-purple-300 rounded px-1.5 py-1"
                  />
                )}
                {admitForm.pre_auth_status === 'override' && (
                  <input
                    type="text"
                    value={admitForm.pre_auth_override_reason}
                    onChange={e => setAdmitForm(f => ({ ...f, pre_auth_override_reason: e.target.value }))}
                    maxLength={500}
                    placeholder="Emergency override reason"
                    className="w-full text-xs border border-purple-300 rounded px-1.5 py-1"
                  />
                )}
              </div>
            )}

            <button
              onClick={onSubmitAdmit}
              disabled={busy || !admitForm.chief_complaint.trim()}
              className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Admitting…' : `Admit to ${bed.code}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ─── TransferPanel ───────────────────────────────────────────
function TransferPanel({
  bed,
  ward,
  floor,
  busy,
  reason,
  setReason,
  transferBeds,
  transferFilterFloor,
  setTransferFilterFloor,
  transferSelectedBedId,
  transferPreflight,
  onSelectTransferBed,
  onSubmitTransfer,
  onBack,
}: {
  bed: Bed;
  ward: Ward;
  floor: Floor;
  busy: boolean;
  reason: string;
  setReason: (s: string) => void;
  transferBeds: TransferBedOption[];
  transferFilterFloor: number | 'all';
  setTransferFilterFloor: (f: number | 'all') => void;
  transferSelectedBedId: string | null;
  transferPreflight: TransferPreflight | null;
  onSelectTransferBed: (b: TransferBedOption) => void;
  onSubmitTransfer: () => void;
  onBack: () => void;
}) {
  // Unique floor numbers for filter pills
  const floorNumbers = Array.from(new Set(transferBeds.map(b => b.floor_number))).sort((a, b) => a - b);
  const filteredBeds = transferFilterFloor === 'all'
    ? transferBeds
    : transferBeds.filter(b => b.floor_number === transferFilterFloor);

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Transfer {bed.patient_name || 'patient'}</h3>
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs">
        <div className="text-gray-600">From:</div>
        <div className="font-medium text-gray-900">
          {floor.name} · {ward.name} · Room {bed.code.replace(/[AB]$/, '')} · Bed {bed.code}
        </div>
        <div className="text-[10px] text-gray-500 mt-1">Source bed will move to <span className="font-semibold text-purple-700">terminal cleaning</span> after transfer.</div>
      </div>

      {/* Floor filter pills */}
      {floorNumbers.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 font-medium">Floor:</span>
          <button
            onClick={() => setTransferFilterFloor('all')}
            className={`px-2 py-0.5 text-[11px] rounded ${
              transferFilterFloor === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            All ({transferBeds.length})
          </button>
          {floorNumbers.map(n => {
            const count = transferBeds.filter(b => b.floor_number === n).length;
            return (
              <button
                key={n}
                onClick={() => setTransferFilterFloor(n)}
                className={`px-2 py-0.5 text-[11px] rounded ${
                  transferFilterFloor === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {n}F ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Destination list */}
      <div className="max-h-56 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
        {filteredBeds.length === 0 ? (
          <div className="p-3 text-xs text-gray-500 text-center">
            {busy ? 'Loading…' : 'No available beds on this floor.'}
          </div>
        ) : (
          filteredBeds.map(b => (
            <button
              key={b.bed_id}
              onClick={() => onSelectTransferBed(b)}
              className={`w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors ${
                transferSelectedBedId === b.bed_id ? 'bg-blue-100' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-gray-900">
                    {b.bed_code} <span className="text-gray-500 font-normal">· {b.room_code}</span>
                  </div>
                  <div className="text-[10px] text-gray-600">
                    {b.floor_name} · {b.ward_name} · {b.room_type.replace('_', '-')}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {b.room_tag && b.room_tag !== 'none' && (
                    <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${ROOM_TAG_STYLES[b.room_tag]?.className || ''}`}>
                      {ROOM_TAG_STYLES[b.room_tag]?.label || b.room_tag}
                    </span>
                  )}
                  <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                    b.bed_status === 'available' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {b.bed_status}
                  </span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Preflight + reason + submit */}
      {transferSelectedBedId && transferPreflight && (
        <>
          {transferPreflight.warnings.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-semibold text-gray-500 uppercase">Transfer checks</h4>
              {transferPreflight.warnings.map((w, i) => (
                <div key={i} className={`text-xs px-2 py-1.5 rounded border flex items-start gap-2 ${
                  w.severity === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'
                }`}>
                  <span className="font-semibold">{w.severity === 'warn' ? '⚠' : 'ℹ'}</span>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-[10px] text-gray-500 font-medium">Transfer reason <span className="text-red-500">*</span></label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Step-down from ICU, isolation required, bed preference"
              maxLength={500}
              rows={2}
              className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <button
            onClick={onSubmitTransfer}
            disabled={busy || !reason.trim()}
            className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Transferring…' : `Transfer to ${transferPreflight.destination_bed.code}`}
          </button>
        </>
      )}
    </>
  );
}

// ─── DischargePanel ──────────────────────────────────────────
function DischargePanel({
  bed,
  busy,
  dischargeReadiness,
  dischargeForm,
  setDischargeForm,
  onSubmitDischarge,
  onBack,
}: {
  bed: Bed;
  busy: boolean;
  dischargeReadiness: DischargeReadiness | null;
  dischargeForm: DischargeFormState;
  setDischargeForm: (f: DischargeFormState | ((prev: DischargeFormState) => DischargeFormState)) => void;
  onSubmitDischarge: () => void;
  onBack: () => void;
}) {
  const hasOrder = !!dischargeReadiness?.order && dischargeReadiness.order.status !== 'completed';
  const allComplete = !!dischargeReadiness?.all_complete;
  const total = dischargeReadiness?.total || 0;
  const done = dischargeReadiness?.done || 0;

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Discharge {bed.patient_name || 'patient'}</h3>
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-800">← Back</button>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs">
        <div className="text-gray-600">Releasing bed {bed.code}:</div>
        <div className="font-medium text-gray-900">→ <span className="text-purple-700">Terminal Cleaning</span> (2h SLA)</div>
      </div>

      {/* Milestones */}
      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase">Discharge milestones</h4>
            <span className={`text-[11px] font-semibold ${allComplete ? 'text-green-700' : 'text-amber-700'}`}>
              {done} / {total}
            </span>
          </div>
          <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-40 overflow-y-auto">
            {(dischargeReadiness?.milestones || []).map(m => (
              <div key={m.id} className="px-2.5 py-1.5 flex items-center justify-between">
                <span className="text-xs text-gray-800">
                  {m.completed_at ? '✓' : '○'} {m.milestone}
                </span>
                {m.completed_at && (
                  <span className="text-[10px] text-gray-500">{formatDateTime(m.completed_at)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reason + summary */}
      <div>
        <label className="text-[10px] text-gray-500 font-medium">Discharge reason <span className="text-red-500">*</span></label>
        <select
          value={dischargeForm.reason}
          onChange={e => setDischargeForm(f => ({ ...f, reason: e.target.value as any }))}
          disabled={hasOrder}
          className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 disabled:bg-gray-50"
        >
          <option value="recovered">Recovered</option>
          <option value="referred">Referred</option>
          <option value="self_discharge">Self-discharge</option>
          <option value="death">Death</option>
          <option value="lama">LAMA (Left Against Medical Advice)</option>
        </select>
        {hasOrder && (
          <p className="text-[10px] text-gray-500 mt-1">Reason locked — discharge already initiated.</p>
        )}
      </div>

      <div>
        <label className="text-[10px] text-gray-500 font-medium">Discharge summary</label>
        <textarea
          value={dischargeForm.summary}
          onChange={e => setDischargeForm(f => ({ ...f, summary: e.target.value }))}
          placeholder="optional"
          maxLength={5000}
          rows={3}
          disabled={hasOrder}
          className="w-full text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:bg-gray-50"
        />
      </div>

      {/* Force option if milestones incomplete */}
      {total > 0 && !allComplete && (
        <label className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-900 cursor-pointer">
          <input
            type="checkbox"
            checked={dischargeForm.force}
            onChange={e => setDischargeForm(f => ({ ...f, force: e.target.checked }))}
            className="mt-0.5"
          />
          <span>
            <strong>Force discharge</strong> — complete discharge even though {total - done} milestone(s) incomplete. Use cautiously.
          </span>
        </label>
      )}

      <button
        onClick={onSubmitDischarge}
        disabled={busy || (total > 0 && !allComplete && !dischargeForm.force)}
        className="w-full px-3 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Discharging…' : hasOrder ? 'Complete Discharge' : 'Initiate & Complete Discharge'}
      </button>
    </>
  );
}
