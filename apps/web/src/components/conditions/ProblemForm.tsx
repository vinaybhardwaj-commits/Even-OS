'use client';

import { useState } from 'react';

/**
 * ProblemForm — Reusable modal form for adding a Condition (problem list entry).
 *
 * Wraps the conditions.create tRPC endpoint. Designed for the Patient Chart
 * plan tab but usable anywhere.
 *
 * Styling: inline styles (matches patient-chart-client.tsx aesthetic,
 * NOT the Tailwind-based admin pages).
 */

interface ProblemFormProps {
  patientId: string;
  encounterId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

type ClinicalStatus = 'active' | 'inactive' | 'resolved' | 'remission';
type VerificationStatus = 'unconfirmed' | 'provisional' | 'differential' | 'confirmed';
type Severity = '' | 'mild' | 'moderate' | 'severe';

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.message || json.error?.json?.message || 'Operation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

export default function ProblemForm({ patientId, encounterId, onClose, onSaved }: ProblemFormProps) {
  const [conditionName, setConditionName] = useState('');
  const [icd10Code, setIcd10Code] = useState('');
  const [clinicalStatus, setClinicalStatus] = useState<ClinicalStatus>('active');
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('provisional');
  const [severity, setSeverity] = useState<Severity>('');
  const [onsetDate, setOnsetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!conditionName.trim()) {
      setError('Condition name is required');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const input: any = {
        patient_id: patientId,
        condition_name: conditionName.trim(),
        clinical_status: clinicalStatus,
        verification_status: verificationStatus,
      };
      if (encounterId) input.encounter_id = encounterId;
      if (icd10Code.trim()) input.icd10_code = icd10Code.trim();
      if (severity) input.severity = severity;
      if (onsetDate) input.onset_date = onsetDate;
      if (notes.trim()) input.notes = notes.trim();

      await trpcMutate('conditions.create', input);
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid #d0d5dd',
    borderRadius: 8,
    fontFamily: 'inherit',
    background: 'white',
    color: '#111',
    outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    color: '#475467',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    marginBottom: 6,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111' }}>Add Problem</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{ padding: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div>
            <label style={labelStyle}>Condition Name *</label>
            <input
              type="text"
              value={conditionName}
              onChange={(e) => setConditionName(e.target.value)}
              placeholder="e.g., Type 2 Diabetes Mellitus"
              style={fieldStyle}
              maxLength={255}
              required
              autoFocus
            />
          </div>

          <div>
            <label style={labelStyle}>ICD-10 Code (optional)</label>
            <input
              type="text"
              value={icd10Code}
              onChange={(e) => setIcd10Code(e.target.value)}
              placeholder="e.g., E11.9"
              style={fieldStyle}
              maxLength={10}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Clinical Status *</label>
              <select
                value={clinicalStatus}
                onChange={(e) => setClinicalStatus(e.target.value as ClinicalStatus)}
                style={fieldStyle}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="resolved">Resolved</option>
                <option value="remission">Remission</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Verification *</label>
              <select
                value={verificationStatus}
                onChange={(e) => setVerificationStatus(e.target.value as VerificationStatus)}
                style={fieldStyle}
              >
                <option value="unconfirmed">Unconfirmed</option>
                <option value="provisional">Provisional</option>
                <option value="differential">Differential</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Severity (optional)</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                style={fieldStyle}
              >
                <option value="">Not specified</option>
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Onset Date (optional)</label>
              <input
                type="date"
                value={onsetDate}
                onChange={(e) => setOnsetDate(e.target.value)}
                style={fieldStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Clinical notes and observations..."
              rows={3}
              maxLength={1000}
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: 'white',
                border: '1px solid #d0d5dd',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                color: '#111',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !conditionName.trim()}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: (submitting || !conditionName.trim()) ? '#9ca3af' : '#0055FF',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'white',
                cursor: (submitting || !conditionName.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Saving…' : 'Add Problem'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
