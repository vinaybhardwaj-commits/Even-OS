'use client';

import { useEffect, useState } from 'react';

// ─── TYPES ─────────────────────────────────────────────────────
interface Patient {
  id: string;
  uhid: string;
  first_name: string;
  last_name: string;
}

interface ClinicalNote {
  id: string;
  patient_id: string;
  note_type: string;
  status: string;
  author_id: string;
  author_name?: string;
  subjective?: string;
  shift_summary?: string;
  procedure_name?: string;
  created_at: string;
  signed_at?: string;
  signed_by_user_id?: string;
}

interface CoSignItem {
  id: string;
  patient_id: string;
  clinical_impression_id: string;
  note_type: string;
  author_name: string;
  required_signer_id: string;
  required_signer_name: string;
  status: string;
  created_at: string;
  signed_at?: string;
}

interface Document {
  id: string;
  patient_id: string;
  document_type: string;
  title: string;
  author_id?: string;
  author_name?: string;
  attachment_url?: string;
  created_at: string;
}

interface User {
  id: string;
  full_name: string;
}

// ─── FORMATTING HELPERS ────────────────────────────────────────

function formatDate(dateString?: string): string {
  if (!dateString) return '—';
  try {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '—';
  }
}

function getTimeSince(dateString?: string): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return '—';
  }
}

function getStatusBadgeColor(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#2a2a2a', text: '#a0a0a0' },
    ready_for_review: { bg: '#4a3a1a', text: '#ffd700' },
    signed: { bg: '#1a4a2a', text: '#55ff55' },
    amended: { bg: '#2a3a4a', text: '#55ccff' },
    pending: { bg: '#4a3a1a', text: '#ffd700' },
    expired: { bg: '#4a1a1a', text: '#ff5555' },
    cancelled: { bg: '#4a1a1a', text: '#ff5555' },
  };
  return colors[status] || { bg: '#2a2a2a', text: '#a0a0a0' };
}

function getNoteTypeColor(noteType: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    soap_note: { bg: '#1a3a4a', text: '#55ccff' },
    nursing_note: { bg: '#2a4a1a', text: '#aaffaa' },
    operative_note: { bg: '#4a1a2a', text: '#ff55aa' },
    anaesthesia_record: { bg: '#3a3a1a', text: '#ffff55' },
    discharge_summary: { bg: '#1a4a3a', text: '#55ffcc' },
    death_summary: { bg: '#4a1a1a', text: '#ff5555' },
    shift_handover: { bg: '#2a2a4a', text: '#aa99ff' },
    mlc_form: { bg: '#4a2a1a', text: '#ffaa55' },
    referral_letter: { bg: '#2a3a2a', text: '#99ff99' },
  };
  return colors[noteType] || { bg: '#2a2a2a', text: '#a0a0a0' };
}

function getUrgencyColor(hoursOld: number): { bg: string; text: string; label: string } {
  if (hoursOld > 4) return { bg: '#4a1a1a', text: '#ff5555', label: 'URGENT' };
  if (hoursOld > 2) return { bg: '#4a3a1a', text: '#ffaa55', label: 'HIGH' };
  return { bg: '#1a4a2a', text: '#55ff55', label: 'NORMAL' };
}

function getPreviewText(note: ClinicalNote): string {
  let text = '';
  if (note.subjective) text = note.subjective.substring(0, 100);
  else if (note.shift_summary) text = note.shift_summary.substring(0, 100);
  else if (note.procedure_name) text = note.procedure_name.substring(0, 100);
  else text = '(empty note)';
  return text.length === 100 ? text + '...' : text;
}

// ─── MODAL COMPONENTS ──────────────────────────────────────────

interface CreateNoteModalProps {
  isOpen: boolean;
  noteType: string;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  loading?: boolean;
  patients?: Patient[];
  users?: User[];
}

function CreateNoteModal({ isOpen, noteType, onClose, onSubmit, loading, patients = [], users = [] }: CreateNoteModalProps) {
  const [patientId, setPatientId] = useState('');
  const [encounterId, setEncounterId] = useState('');
  const [requiredSignerId, setRequiredSignerId] = useState('');

  // SOAP fields
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');

  // Nursing fields
  const [shiftSummary, setShiftSummary] = useState('');
  const [painAssessment, setPainAssessment] = useState('');
  const [woundAssessment, setWoundAssessment] = useState('');
  const [fallRiskAssessment, setFallRiskAssessment] = useState('');
  const [skinIntegrityAssessment, setSkinIntegrityAssessment] = useState('');

  // Operative fields
  const [procedureName, setProcedureName] = useState('');
  const [surgeonId, setSurgeonId] = useState('');
  const [anesthesiaType, setAnesthesiaType] = useState('');
  const [operativeFindings, setOperativeFindings] = useState('');
  const [bloodLossMl, setBloodLossMl] = useState('');
  const [complications, setComplications] = useState('');
  const [operationStartDatetime, setOperationStartDatetime] = useState('');
  const [operationEndDatetime, setOperationEndDatetime] = useState('');

  // Discharge fields
  const [admissionDetails, setAdmissionDetails] = useState('');
  const [courseInHospital, setCourseInHospital] = useState('');
  const [conditionAtDischarge, setConditionAtDischarge] = useState('');
  const [followupInstructions, setFollowupInstructions] = useState('');
  const [dischargeDestination, setDischargeDestination] = useState('home');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      patient_id: patientId,
      encounter_id: encounterId || undefined,
      note_type: noteType,
      required_signer_id: requiredSignerId || undefined,
    };

    if (noteType === 'soap_note') {
      payload.subjective = subjective;
      payload.objective = objective;
      payload.assessment = assessment;
      payload.plan = plan;
    } else if (noteType === 'nursing_note') {
      payload.shift_summary = shiftSummary;
      payload.pain_assessment = painAssessment;
      payload.wound_assessment = woundAssessment;
      payload.fall_risk_assessment = fallRiskAssessment;
      payload.skin_integrity_assessment = skinIntegrityAssessment;
    } else if (noteType === 'operative_note') {
      payload.procedure_name = procedureName;
      payload.surgeon_id = surgeonId;
      payload.anesthesia_type = anesthesiaType;
      payload.operative_findings = operativeFindings;
      payload.blood_loss_ml = bloodLossMl ? parseInt(bloodLossMl) : undefined;
      payload.complications = complications;
      payload.operation_start_datetime = operationStartDatetime;
      payload.operation_end_datetime = operationEndDatetime;
    } else if (noteType === 'discharge_summary') {
      payload.admission_details = admissionDetails;
      payload.course_in_hospital = courseInHospital;
      payload.condition_at_discharge = conditionAtDischarge;
      payload.followup_instructions = followupInstructions;
      payload.discharge_destination = dischargeDestination;
    }

    await onSubmit(payload);
    handleClose();
  };

  const handleClose = () => {
    setPatientId('');
    setEncounterId('');
    setRequiredSignerId('');
    setSubjective('');
    setObjective('');
    setAssessment('');
    setPlan('');
    setShiftSummary('');
    setPainAssessment('');
    setWoundAssessment('');
    setFallRiskAssessment('');
    setSkinIntegrityAssessment('');
    setProcedureName('');
    setSurgeonId('');
    setAnesthesiaType('');
    setOperativeFindings('');
    setBloodLossMl('');
    setComplications('');
    setOperationStartDatetime('');
    setOperationEndDatetime('');
    setAdmissionDetails('');
    setCourseInHospital('');
    setConditionAtDischarge('');
    setFollowupInstructions('');
    setDischargeDestination('home');
    onClose();
  };

  if (!isOpen) return null;

  const renderFormFields = () => {
    switch (noteType) {
      case 'soap_note':
        return (
          <>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Subjective</label>
              <textarea
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
                placeholder="Patient's description of symptoms..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Objective</label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Physical exam, vital signs, lab results..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Assessment</label>
              <textarea
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                placeholder="Diagnosis, clinical impression..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Plan</label>
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                placeholder="Treatment plan, medications, follow-up..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
          </>
        );
      case 'nursing_note':
        return (
          <>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Shift Summary</label>
              <textarea
                value={shiftSummary}
                onChange={(e) => setShiftSummary(e.target.value)}
                placeholder="Summary of shift activities..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Pain Assessment</label>
              <textarea
                value={painAssessment}
                onChange={(e) => setPainAssessment(e.target.value)}
                placeholder="Pain level, location, interventions..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Wound Assessment</label>
              <textarea
                value={woundAssessment}
                onChange={(e) => setWoundAssessment(e.target.value)}
                placeholder="Wound condition, dressing changes..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Fall Risk Assessment</label>
              <textarea
                value={fallRiskAssessment}
                onChange={(e) => setFallRiskAssessment(e.target.value)}
                placeholder="Fall risk level, precautions..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Skin Integrity Assessment</label>
              <textarea
                value={skinIntegrityAssessment}
                onChange={(e) => setSkinIntegrityAssessment(e.target.value)}
                placeholder="Skin condition, pressure areas, care plan..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
          </>
        );
      case 'operative_note':
        return (
          <>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Procedure Name *</label>
              <input
                type="text"
                value={procedureName}
                onChange={(e) => setProcedureName(e.target.value)}
                placeholder="e.g., Appendectomy, Cholecystectomy..."
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Surgeon</label>
              <select
                value={surgeonId}
                onChange={(e) => setSurgeonId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select surgeon...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Anesthesia Type</label>
              <select
                value={anesthesiaType}
                onChange={(e) => setAnesthesiaType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select anesthesia...</option>
                <option value="general">General</option>
                <option value="regional">Regional</option>
                <option value="local">Local</option>
                <option value="iv_sedation">IV Sedation</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Operative Findings</label>
              <textarea
                value={operativeFindings}
                onChange={(e) => setOperativeFindings(e.target.value)}
                placeholder="Key findings during surgery..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Blood Loss (mL)</label>
                <input
                  type="number"
                  value={bloodLossMl}
                  onChange={(e) => setBloodLossMl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #0f3460',
                    borderRadius: '4px',
                    color: '#e0e0e0',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Duration (min)</label>
                <input
                  type="text"
                  placeholder="Auto-calculated"
                  disabled
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #0f3460',
                    borderRadius: '4px',
                    color: '#808080',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Start Time</label>
                <input
                  type="datetime-local"
                  value={operationStartDatetime}
                  onChange={(e) => setOperationStartDatetime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #0f3460',
                    borderRadius: '4px',
                    color: '#e0e0e0',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>End Time</label>
                <input
                  type="datetime-local"
                  value={operationEndDatetime}
                  onChange={(e) => setOperationEndDatetime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #0f3460',
                    borderRadius: '4px',
                    color: '#e0e0e0',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Complications</label>
              <textarea
                value={complications}
                onChange={(e) => setComplications(e.target.value)}
                placeholder="Any intra- or post-operative complications..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
          </>
        );
      case 'discharge_summary':
        return (
          <>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Admission Details</label>
              <textarea
                value={admissionDetails}
                onChange={(e) => setAdmissionDetails(e.target.value)}
                placeholder="Chief complaint, indication for admission..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Course in Hospital</label>
              <textarea
                value={courseInHospital}
                onChange={(e) => setCourseInHospital(e.target.value)}
                placeholder="Hospital course summary..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Condition at Discharge</label>
              <textarea
                value={conditionAtDischarge}
                onChange={(e) => setConditionAtDischarge(e.target.value)}
                placeholder="Patient's condition at discharge..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Follow-up Instructions</label>
              <textarea
                value={followupInstructions}
                onChange={(e) => setFollowupInstructions(e.target.value)}
                placeholder="Medications, activity, diet, follow-up appointments..."
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Discharge Destination</label>
              <select
                value={dischargeDestination}
                onChange={(e) => setDischargeDestination(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="home">Home</option>
                <option value="rehabilitation">Rehabilitation Center</option>
                <option value="hospice">Hospice</option>
                <option value="other_hospital">Other Hospital</option>
                <option value="ltc_facility">Long-term Care Facility</option>
              </select>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '24px', width: '90%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', color: '#e0e0e0' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Create {noteType.replace(/_/g, ' ')} Note</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Patient *</label>
              <select
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} ({p.uhid})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Encounter (optional)</label>
              <input
                type="text"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                placeholder="Encounter UUID"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {renderFormFields()}

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Required Signer (optional)</label>
            <select
              value={requiredSignerId}
              onChange={(e) => setRequiredSignerId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            >
              <option value="">No specific signer required</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2a2a2a',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: loading ? '#2a3a4a' : '#1a4a2a',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: loading ? '#a0a0a0' : '#55ff55',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {loading ? 'Creating...' : 'Create Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface UploadDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  loading?: boolean;
  patients?: Patient[];
}

function UploadDocumentModal({ isOpen, onClose, onSubmit, loading, patients = [] }: UploadDocumentModalProps) {
  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('other');
  const [description, setDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      patient_id: patientId,
      title,
      document_type: documentType,
      description: description || undefined,
      attachment_url: attachmentUrl || undefined,
    });
    setPatientId('');
    setTitle('');
    setDocumentType('other');
    setDescription('');
    setAttachmentUrl('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '24px', width: '90%', maxWidth: '500px', color: '#e0e0e0' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Upload Document</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Patient *</label>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            >
              <option value="">Select patient...</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name} ({p.uhid})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Lab Report, X-Ray"
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Document Type</label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            >
              <option value="discharge_summary">Discharge Summary</option>
              <option value="consent_form">Consent Form</option>
              <option value="operative_note">Operative Note</option>
              <option value="lab_report">Lab Report</option>
              <option value="imaging_report">Imaging Report</option>
              <option value="referral_letter">Referral Letter</option>
              <option value="scanned_record">Scanned Record</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Attachment URL</label>
            <input
              type="url"
              value={attachmentUrl}
              onChange={(e) => setAttachmentUrl(e.target.value)}
              placeholder="https://..."
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2a2a2a',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: loading ? '#2a3a4a' : '#1a4a2a',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: loading ? '#a0a0a0' : '#55ff55',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {loading ? 'Uploading...' : 'Upload Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── MAIN CLIENT COMPONENT ─────────────────────────────────────

export default function ClinicalNotesClient() {
  const [activeTab, setActiveTab] = useState<'notes' | 'cosign' | 'documents' | 'ai'>('notes');
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [cosignQueue, setCosignQueue] = useState<CoSignItem[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // AI state
  const [aiDischargeDraft, setAiDischargeDraft] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiEncounterId, setAiEncounterId] = useState('');

  const [selectedPatient, setSelectedPatient] = useState('');
  const [noteTypeFilter, setNoteTypeFilter] = useState('');

  const [createNoteModal, setCreateNoteModal] = useState<{ isOpen: boolean; noteType: string }>({ isOpen: false, noteType: '' });
  const [uploadDocumentModal, setUploadDocumentModal] = useState(false);

  const [statsLoading, setStatsLoading] = useState(false);
  const [cosignStats, setCosignStats] = useState({ pending: 0, signed_today: 0, overdue: 0 });

  // Fetch patients
  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const response = await fetch('/api/trpc/patient.list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: {} }),
        });
        if (!response.ok) throw new Error('Failed to fetch patients');
        const data = await response.json();
        setPatients(data.result?.data || []);
      } catch (error) {
        console.error('Error fetching patients:', error);
      }
    };

    const fetchUsers = async () => {
      try {
        const response = await fetch('/api/trpc/auth.listUsers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: {} }),
        });
        if (!response.ok) throw new Error('Failed to fetch users');
        const data = await response.json();
        setUsers(data.result?.data || []);
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    fetchPatients();
    fetchUsers();
  }, []);

  // Fetch notes
  const fetchNotes = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/trpc/clinicalNotes.listNotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            patient_id: selectedPatient || undefined,
            note_type: noteTypeFilter || undefined,
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to fetch notes');
      const data = await response.json();
      setNotes(data.result?.data || []);
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch cosign queue
  const fetchCosignQueue = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/trpc/clinicalNotes.cosignQueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: {} }),
      });
      if (!response.ok) throw new Error('Failed to fetch cosign queue');
      const data = await response.json();
      setCosignQueue(data.result?.data || []);

      // Calculate stats
      const pending = data.result?.data?.filter((item: CoSignItem) => item.status === 'pending').length || 0;
      const today = new Date().toDateString();
      const signed_today = data.result?.data?.filter(
        (item: CoSignItem) => item.status === 'signed' && new Date(item.signed_at || '').toDateString() === today,
      ).length || 0;
      const overdue = data.result?.data?.filter((item: CoSignItem) => {
        if (item.status !== 'pending') return false;
        const created = new Date(item.created_at);
        const now = new Date();
        return (now.getTime() - created.getTime()) / 3600000 > 4;
      }).length || 0;

      setCosignStats({ pending, signed_today, overdue });
    } catch (error) {
      console.error('Error fetching cosign queue:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch documents
  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/trpc/clinicalNotes.listDocuments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            patient_id: selectedPatient || undefined,
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to fetch documents');
      const data = await response.json();
      setDocuments(data.result?.data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle tab changes
  useEffect(() => {
    if (activeTab === 'notes') {
      fetchNotes();
    } else if (activeTab === 'cosign') {
      fetchCosignQueue();
    } else if (activeTab === 'documents') {
      fetchDocuments();
    }
  }, [activeTab, selectedPatient, noteTypeFilter]);

  // AI discharge summary generation
  const handleGenerateDischarge = async () => {
    if (!aiEncounterId.trim()) {
      setAiError('Please enter an encounter ID');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    try {
      const response = await fetch('/api/trpc/evenAI.runDischargeSummary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { encounter_id: aiEncounterId } }),
      });

      if (!response.ok) throw new Error('Failed to generate discharge summary');
      const data = await response.json();

      if (data.result?.data?.json) {
        setAiDischargeDraft(data.result.data.json);
      } else {
        setAiError('No discharge summary generated');
      }
    } catch (err: any) {
      setAiError(err.message || 'Failed to generate discharge summary');
    } finally {
      setAiLoading(false);
    }
  };

  // Create note
  const handleCreateNote = async (data: any) => {
    setLoading(true);
    try {
      const response = await fetch('/api/trpc/clinicalNotes.createNote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: data }),
      });
      if (!response.ok) throw new Error('Failed to create note');
      setCreateNoteModal({ isOpen: false, noteType: '' });
      fetchNotes();
    } catch (error) {
      console.error('Error creating note:', error);
      alert('Failed to create note');
    } finally {
      setLoading(false);
    }
  };

  // Sign note
  const handleSignNote = async (cosignId: string) => {
    try {
      const response = await fetch('/api/trpc/clinicalNotes.signNote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { cosign_id: cosignId } }),
      });
      if (!response.ok) throw new Error('Failed to sign note');
      fetchCosignQueue();
    } catch (error) {
      console.error('Error signing note:', error);
      alert('Failed to sign note');
    }
  };

  // Upload document
  const handleUploadDocument = async (data: any) => {
    setLoading(true);
    try {
      const response = await fetch('/api/trpc/clinicalNotes.uploadDocument', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: data }),
      });
      if (!response.ok) throw new Error('Failed to upload document');
      setUploadDocumentModal(false);
      fetchDocuments();
    } catch (error) {
      console.error('Error uploading document:', error);
      alert('Failed to upload document');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '16px', backgroundColor: '#0f1419', color: '#e0e0e0', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 700 }}>Clinical Notes Management</h1>
        <p style={{ margin: 0, fontSize: '13px', color: '#a0a0a0' }}>Create, review, and manage clinical documentation</p>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', borderBottom: '1px solid #0f3460', paddingBottom: '12px' }}>
        {(['notes', 'cosign', 'documents', 'ai'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              backgroundColor: activeTab === tab ? (tab === 'ai' ? '#4c1d95' : '#1a4a2a') : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: activeTab === tab ? (tab === 'ai' ? '#e9d5ff' : '#55ff55') : '#a0a0a0',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {tab === 'notes' && `📝 Notes`}
            {tab === 'cosign' && `✔ Co-sign Queue`}
            {tab === 'documents' && `📄 Documents`}
            {tab === 'ai' && `💯 AI Draft`}
          </button>
        ))}
      </div>

      {/* Tab 1: Clinical Notes */}
      {activeTab === 'notes' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Patient</label>
              <select
                value={selectedPatient}
                onChange={(e) => setSelectedPatient(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">All Patients</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} ({p.uhid})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Note Type</label>
              <select
                value={noteTypeFilter}
                onChange={(e) => setNoteTypeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">All Types</option>
                <option value="soap_note">SOAP</option>
                <option value="nursing_note">Nursing</option>
                <option value="operative_note">Operative</option>
                <option value="anaesthesia_record">Anaesthesia</option>
                <option value="discharge_summary">Discharge</option>
                <option value="death_summary">Death Summary</option>
                <option value="shift_handover">Shift Handover</option>
                <option value="mlc_form">MLC Form</option>
                <option value="referral_letter">Referral</option>
              </select>
            </div>
          </div>

          {/* Create Note Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '24px' }}>
            {[
              { label: 'SOAP', type: 'soap_note' },
              { label: 'Nursing', type: 'nursing_note' },
              { label: 'Operative', type: 'operative_note' },
              { label: 'Discharge', type: 'discharge_summary' },
            ].map((item) => (
              <button
                key={item.type}
                onClick={() => setCreateNoteModal({ isOpen: true, noteType: item.type })}
                style={{
                  padding: '10px 12px',
                  backgroundColor: '#1a4a2a',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#55ff55',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                + {item.label}
              </button>
            ))}
          </div>

          {/* Notes List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#a0a0a0' }}>Loading...</div>
          ) : notes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#a0a0a0' }}>No notes found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {notes.map((note) => {
                const noteTypeBg = getNoteTypeColor(note.note_type);
                const statusBg = getStatusBadgeColor(note.status);
                return (
                  <div
                    key={note.id}
                    style={{
                      backgroundColor: '#1a1a2e',
                      border: '1px solid #0f3460',
                      borderRadius: '6px',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#1a4a2a';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#0f3460';
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                      <span
                        style={{
                          backgroundColor: noteTypeBg.bg,
                          color: noteTypeBg.text,
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        {note.note_type.replace(/_/g, ' ')}
                      </span>
                      <span
                        style={{
                          backgroundColor: statusBg.bg,
                          color: statusBg.text,
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                        }}
                      >
                        {note.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '8px', fontSize: '12px' }}>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Author</div>
                        <div style={{ fontWeight: 500 }}>{note.author_name || 'Unknown'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Created</div>
                        <div style={{ fontWeight: 500 }}>{formatDate(note.created_at)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Time</div>
                        <div style={{ fontWeight: 500 }}>{getTimeSince(note.created_at)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>ID</div>
                        <div style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '11px' }}>{note.id.substring(0, 8)}...</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#808080', fontStyle: 'italic' }}>
                      {getPreviewText(note)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Co-sign Queue */}
      {activeTab === 'cosign' && (
        <div>
          {/* Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#a0a0a0', marginBottom: '4px' }}>PENDING</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffaa55' }}>{cosignStats.pending}</div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#a0a0a0', marginBottom: '4px' }}>SIGNED TODAY</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#55ff55' }}>{cosignStats.signed_today}</div>
            </div>
            <div style={{ backgroundColor: '#1a1a2e', border: '1px solid #0f3460', borderRadius: '6px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#a0a0a0', marginBottom: '4px' }}>OVERDUE (> 4h)</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#ff5555' }}>{cosignStats.overdue}</div>
            </div>
          </div>

          {/* Queue List (grouped by urgency) */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#a0a0a0' }}>Loading...</div>
          ) : cosignQueue.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#a0a0a0' }}>No pending signatures</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {cosignQueue
                .sort((a, b) => {
                  const aTime = new Date(a.created_at).getTime();
                  const bTime = new Date(b.created_at).getTime();
                  return bTime - aTime;
                })
                .map((item) => {
                  const now = new Date();
                  const created = new Date(item.created_at);
                  const hoursOld = (now.getTime() - created.getTime()) / 3600000;
                  const urgency = getUrgencyColor(hoursOld);
                  const noteTypeBg = getNoteTypeColor(item.note_type);

                  return (
                    <div
                      key={item.id}
                      style={{
                        backgroundColor: '#1a1a2e',
                        border: `1px solid ${urgency.bg}`,
                        borderRadius: '6px',
                        padding: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                        <span
                          style={{
                            backgroundColor: urgency.bg,
                            color: urgency.text,
                            padding: '4px 8px',
                            borderRadius: '3px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          {urgency.label}
                        </span>
                        <span
                          style={{
                            backgroundColor: noteTypeBg.bg,
                            color: noteTypeBg.text,
                            padding: '4px 8px',
                            borderRadius: '3px',
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                          }}
                        >
                          {item.note_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 80px', gap: '12px', marginBottom: '8px', fontSize: '12px' }}>
                        <div>
                          <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Patient</div>
                          <div style={{ fontWeight: 500 }}>{item.patient_id.substring(0, 8)}...</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Author</div>
                          <div style={{ fontWeight: 500 }}>{item.author_name}</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Requested Signer</div>
                          <div style={{ fontWeight: 500 }}>{item.required_signer_name}</div>
                        </div>
                        <div>
                          <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Time Since Created</div>
                          <div style={{ fontWeight: 500 }}>{getTimeSince(item.created_at)}</div>
                        </div>
                        <button
                          onClick={() => handleSignNote(item.id)}
                          style={{
                            backgroundColor: '#1a4a2a',
                            border: '1px solid #0f3460',
                            borderRadius: '4px',
                            color: '#55ff55',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '6px 8px',
                            alignSelf: 'flex-end',
                          }}
                        >
                          ✔ Sign
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Documents */}
      {activeTab === 'documents' && (
        <div>
          {/* Filters & Upload */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Patient</label>
              <select
                value={selectedPatient}
                onChange={(e) => setSelectedPatient(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">All Patients</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} ({p.uhid})
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setUploadDocumentModal(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1a4a2a',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#55ff55',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              📄 Upload Document
            </button>
          </div>

          {/* Documents List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#a0a0a0' }}>Loading...</div>
          ) : documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#a0a0a0' }}>No documents found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {documents.map((doc) => {
                const docTypeBg = getNoteTypeColor(doc.document_type);
                return (
                  <div
                    key={doc.id}
                    style={{
                      backgroundColor: '#1a1a2e',
                      border: '1px solid #0f3460',
                      borderRadius: '6px',
                      padding: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                      <span
                        style={{
                          backgroundColor: docTypeBg.bg,
                          color: docTypeBg.text,
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        {doc.document_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', fontSize: '12px' }}>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Title</div>
                        <div style={{ fontWeight: 500 }}>{doc.title}</div>
                      </div>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Author</div>
                        <div style={{ fontWeight: 500 }}>{doc.author_name || 'Unknown'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Created</div>
                        <div style={{ fontWeight: 500 }}>{formatDate(doc.created_at)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#a0a0a0', marginBottom: '2px' }}>Attachment</div>
                        {doc.attachment_url ? (
                          <a href={doc.attachment_url} target="_blank" rel="noopener noreferrer" style={{ color: '#55ff55', textDecoration: 'none' }}>
                            View 🥮
                          </a>
                        ) : (
                          <span style={{ color: '#a0a0a0' }}>N/A</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: AI Draft */}
      {activeTab === 'ai' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#e9d5ff' }}>Encounter ID</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input
                type="text"
                value={aiEncounterId}
                onChange={(e) => setAiEncounterId(e.target.value)}
                placeholder="Enter encounter ID..."
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #4c1d95',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  fontSize: '13px',
                }}
              />
              <button
                onClick={handleGenerateDischarge}
                disabled={aiLoading}
                style={{
                  padding: '10px 20px',
                  backgroundColor: aiLoading ? '#6b21a8' : '#7c3aed',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#e9d5ff',
                  cursor: aiLoading ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                {aiLoading ? 'Generating...' : '💯 Generate Discharge Summary'}
              </button>
            </div>
          </div>

          {aiError && (
            <div style={{ padding: '12px', backgroundColor: '#7f1d1d', border: '1px solid #dc2626', borderRadius: '4px', color: '#fca5a5', marginBottom: '16px', fontSize: '13px' }}>
              {aiError}
            </div>
          )}

          {aiDischargeDraft && (
            <div style={{ backgroundColor: '#1a1a2e', border: '1px solid #4c1d95', borderRadius: '6px', padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '4px' }}>Patient Name</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#e9d5ff' }}>{aiDischargeDraft.patient_name || 'N/A'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '4px' }}>Primary Diagnosis</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#e9d5ff' }}>{aiDischargeDraft.primary_diagnosis || 'N/A'}</div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px', fontWeight: 600 }}>Hospital Course</div>
                <div style={{ fontSize: '13px', color: '#e0e0e0', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                  {aiDischargeDraft.hospital_course || 'N/A'}
                </div>
              </div>

              {aiDischargeDraft.medications && Array.isArray(aiDischargeDraft.medications) && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px', fontWeight: 600 }}>Medications</div>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: '#e0e0e0', fontSize: '13px' }}>
                    {aiDischargeDraft.medications.map((med: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {med}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px', fontWeight: 600 }}>Follow-up Instructions</div>
                <div style={{ fontSize: '13px', color: '#e0e0e0', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                  {aiDischargeDraft.follow_up_instructions || 'N/A'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <CreateNoteModal
        isOpen={createNoteModal.isOpen}
        noteType={createNoteModal.noteType}
        onClose={() => setCreateNoteModal({ isOpen: false, noteType: '' })}
        onSubmit={handleCreateNote}
        loading={loading}
        patients={patients}
        users={users}
      />

      <UploadDocumentModal isOpen={uploadDocumentModal} onClose={() => setUploadDocumentModal(false)} onSubmit={handleUploadDocument} loading={loading} patients={patients} />
    </div>
  );
}
