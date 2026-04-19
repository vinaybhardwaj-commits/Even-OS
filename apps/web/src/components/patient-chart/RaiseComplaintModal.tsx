'use client';

/**
 * RaiseComplaintModal — PC.4.A.4 (19 Apr 2026)
 *
 * Modal surface for the "Raise Complaint" action pill. Two modes:
 *   - mode='raise' → form (category, priority, subject, description). Submits
 *     complaints.raise, calls onSubmitted({ complaint }) on success.
 *   - mode='detail' → read-only view of a complaint + inline status controls
 *     (Mark in progress / Resolve / Close). Resolve/Close require a
 *     resolution note. Shows raise+resolution snapshots + SLA.
 *
 * Stays consistent with the chart's native-modal look (white card, 480px
 * width echoing the Orders slider shell per locked decision #21, but
 * centered dialog here since it's transient, not a slider).
 *
 * This file uses the fetch-based trpcQuery/trpcMutate pattern — same as
 * patient-chart-client.tsx — not tRPC React hooks. Consistency with PC.4.A.3.
 */

import { useEffect, useState } from 'react';

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const msg = json?.error?.json?.message ?? json?.error?.message ?? 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

interface ComplaintRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  subject: string;
  description: string;
  sla_due_at: string;
  raised_by_user_name: string;
  raised_by_user_role: string;
  resolved_by_user_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

type Mode = 'raise' | 'detail';

interface Props {
  open: boolean;
  mode: Mode;
  patientId: string;
  encounterId?: string | null;
  /** Required when mode='detail' */
  complaintId?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const CATEGORIES = [
  'Billing', 'Clinical care', 'Nursing', 'Doctor conduct', 'Staff conduct',
  'Facility / cleanliness', 'Wait time', 'Food', 'Communication', 'Other',
];

const PRIORITIES: Array<{ key: 'low'|'normal'|'high'|'critical'; label: string; sla: string; bg: string; fg: string }> = [
  { key: 'low',      label: 'Low',      sla: '72h SLA', bg: '#F3F4F6', fg: '#4B5563' },
  { key: 'normal',   label: 'Normal',   sla: '24h SLA', bg: '#E0E7FF', fg: '#3730A3' },
  { key: 'high',     label: 'High',     sla: '4h SLA',  bg: '#FEF3C7', fg: '#92400E' },
  { key: 'critical', label: 'Critical', sla: '1h SLA',  bg: '#FEE2E2', fg: '#991B1B' },
];

export default function RaiseComplaintModal({
  open, mode, patientId, encounterId, complaintId, onClose, onSubmitted,
}: Props) {
  // Raise form state
  const [category, setCategory] = useState<string>('Clinical care');
  const [priority, setPriority] = useState<'low'|'normal'|'high'|'critical'>('normal');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  // Detail state
  const [row, setRow] = useState<ComplaintRow | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open-change
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (mode === 'raise') {
      setCategory('Clinical care');
      setPriority('normal');
      setSubject('');
      setDescription('');
    } else {
      setRow(null);
      setResolutionNote('');
    }
  }, [open, mode]);

  // Load detail row
  useEffect(() => {
    if (!open || mode !== 'detail' || !complaintId) return;
    let cancelled = false;
    (async () => {
      const data = await trpcQuery('complaints.getById', { id: complaintId });
      if (!cancelled && data) {
        setRow(data as ComplaintRow);
        setResolutionNote((data as ComplaintRow).resolution_note ?? '');
      }
    })();
    return () => { cancelled = true; };
  }, [open, mode, complaintId]);

  if (!open) return null;

  async function handleRaise() {
    setError(null);
    if (subject.trim().length < 3) { setError('Subject must be at least 3 characters.'); return; }
    if (description.trim().length < 3) { setError('Description must be at least 3 characters.'); return; }
    setBusy(true);
    try {
      await trpcMutate('complaints.raise', {
        patient_id: patientId,
        encounter_id: encounterId ?? null,
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise complaint');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransition(nextStatus: 'in_progress' | 'resolved' | 'closed') {
    if (!row) return;
    setError(null);
    if ((nextStatus === 'resolved' || nextStatus === 'closed') && resolutionNote.trim().length === 0) {
      setError('Resolution note is required when resolving or closing.');
      return;
    }
    setBusy(true);
    try {
      await trpcMutate('complaints.updateStatus', {
        id: row.id,
        status: nextStatus,
        resolution_note: (nextStatus === 'resolved' || nextStatus === 'closed')
          ? resolutionNote.trim()
          : undefined,
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update complaint');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: '100%', maxHeight: '90vh',
          overflowY: 'auto', background: 'white',
          borderRadius: 14, padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {mode === 'raise' ? '📣 Raise Complaint' : '📣 Complaint Detail'}
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}
            aria-label="Close"
          >×</button>
        </div>

        {mode === 'raise' && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 14,
                border: '1px solid #D1D5DB', borderRadius: 8,
                fontSize: 14, fontFamily: 'inherit',
              }}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Priority
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 14 }}>
              {PRIORITIES.map((p) => {
                const active = priority === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => setPriority(p.key)}
                    style={{
                      padding: '8px 10px', fontSize: 13, fontWeight: 600,
                      background: active ? p.bg : 'white',
                      color: active ? p.fg : '#4B5563',
                      border: active ? `2px solid ${p.fg}` : '1px solid #D1D5DB',
                      borderRadius: 8, cursor: 'pointer',
                      fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <div>{p.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 500, marginTop: 2, opacity: 0.75 }}>{p.sla}</div>
                  </button>
                );
              })}
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. TPA pre-auth not submitted in 6h"
              maxLength={200}
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 14,
                border: '1px solid #D1D5DB', borderRadius: 8,
                fontSize: 14, fontFamily: 'inherit',
              }}
            />

            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's wrong? What should happen? Who did you already talk to?"
              rows={5}
              maxLength={4000}
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 14,
                border: '1px solid #D1D5DB', borderRadius: 8,
                fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
              }}
            />

            {error && (
              <div style={{
                fontSize: 13, color: '#991B1B', background: '#FEE2E2',
                padding: '8px 10px', borderRadius: 8, marginBottom: 12,
              }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                disabled={busy}
                style={{
                  padding: '8px 14px', fontSize: 14, fontWeight: 600,
                  background: 'white', border: '1px solid #D1D5DB',
                  borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                  color: '#374151', fontFamily: 'inherit',
                }}
              >Cancel</button>
              <button
                onClick={handleRaise}
                disabled={busy}
                style={{
                  padding: '8px 14px', fontSize: 14, fontWeight: 600,
                  background: '#0055FF', color: 'white', border: 'none',
                  borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
                }}
              >{busy ? 'Raising…' : 'Raise Complaint'}</button>
            </div>
          </>
        )}

        {mode === 'detail' && !row && (
          <div style={{ fontSize: 13, color: '#6B7280', padding: '16px 0' }}>Loading…</div>
        )}

        {mode === 'detail' && row && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: PRIORITIES.find(p => p.key === row.priority)?.bg ?? '#E5E7EB',
                color:     PRIORITIES.find(p => p.key === row.priority)?.fg ?? '#111827',
                letterSpacing: 0.5,
              }}>{row.priority.toUpperCase()}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: '#F3F4F6', color: '#374151', letterSpacing: 0.5,
              }}>{row.status.replace('_', ' ').toUpperCase()}</span>
              <span style={{ fontSize: 11, color: '#6B7280', alignSelf: 'center' }}>· {row.category}</span>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px 0', color: '#111827' }}>
              {row.subject}
            </h3>
            <p style={{ fontSize: 13, color: '#374151', margin: '0 0 14px 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {row.description}
            </p>

            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 14 }}>
              Raised by {row.raised_by_user_name} ({row.raised_by_user_role}) on{' '}
              {new Date(row.created_at).toLocaleString()}<br />
              SLA due: {new Date(row.sla_due_at).toLocaleString()}
            </div>

            {row.resolved_at && (
              <div style={{
                fontSize: 12, color: '#065F46', background: '#ECFDF5',
                padding: '8px 10px', borderRadius: 8, marginBottom: 14,
              }}>
                Resolved by {row.resolved_by_user_name} on{' '}
                {new Date(row.resolved_at).toLocaleString()}<br />
                <em style={{ color: '#064E3B' }}>{row.resolution_note}</em>
              </div>
            )}

            {(row.status === 'open' || row.status === 'in_progress') && (
              <>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Resolution note (required to resolve or close)
                </label>
                <textarea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="What was done? What did the patient/family confirm?"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px 10px', marginBottom: 12,
                    border: '1px solid #D1D5DB', borderRadius: 8,
                    fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
                  }}
                />
              </>
            )}

            {error && (
              <div style={{
                fontSize: 13, color: '#991B1B', background: '#FEE2E2',
                padding: '8px 10px', borderRadius: 8, marginBottom: 12,
              }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {row.status === 'open' && (
                <button
                  onClick={() => handleTransition('in_progress')}
                  disabled={busy}
                  style={{
                    padding: '8px 14px', fontSize: 13, fontWeight: 600,
                    background: 'white', border: '1px solid #D1D5DB',
                    borderRadius: 8, color: '#374151', cursor: busy ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >Mark in progress</button>
              )}
              {(row.status === 'open' || row.status === 'in_progress') && (
                <>
                  <button
                    onClick={() => handleTransition('resolved')}
                    disabled={busy}
                    style={{
                      padding: '8px 14px', fontSize: 13, fontWeight: 600,
                      background: '#10B981', color: 'white', border: 'none',
                      borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                      opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
                    }}
                  >Resolve</button>
                  <button
                    onClick={() => handleTransition('closed')}
                    disabled={busy}
                    style={{
                      padding: '8px 14px', fontSize: 13, fontWeight: 600,
                      background: '#6B7280', color: 'white', border: 'none',
                      borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                      opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
                    }}
                  >Close</button>
                </>
              )}
              <button
                onClick={onClose}
                disabled={busy}
                style={{
                  padding: '8px 14px', fontSize: 13, fontWeight: 600,
                  background: 'white', border: '1px solid #D1D5DB',
                  borderRadius: 8, color: '#374151', cursor: busy ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
