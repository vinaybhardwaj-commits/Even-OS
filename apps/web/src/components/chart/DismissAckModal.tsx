'use client';

import { useEffect, useState } from 'react';

/**
 * PC.4.B.4 — Ack-reason modal shown when dismissing a critical-severity
 * notification. Server enforces 4-500 char ack_reason for critical events;
 * this modal enforces the same bounds at the UI layer for clean UX.
 */
interface DismissAckModalProps {
  open: boolean;
  eventIds: string[];
  /** Count of critical events in the batch (for wording). */
  criticalCount: number;
  onClose: () => void;
  onConfirm: (ackReason: string) => Promise<void> | void;
}

export function DismissAckModal({
  open,
  eventIds,
  criticalCount,
  onClose,
  onConfirm,
}: DismissAckModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setErr(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const len = reason.trim().length;
  const valid = len >= 4 && len <= 500;

  const handleConfirm = async () => {
    if (!valid) {
      setErr('Reason must be 4–500 characters.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Dismiss failed.');
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dismiss-ack-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: 'calc(100vw - 32px)',
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8, height: 8, borderRadius: 8,
              background: '#dc2626',
            }}
          />
          <h3
            id="dismiss-ack-title"
            style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}
          >
            Dismiss {criticalCount > 1 ? `${criticalCount} critical alerts` : 'critical alert'}
          </h3>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
          Dismissing a critical notification requires a short acknowledgement.
          This is logged against the alert. Reason (4–500 chars):
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="e.g. Repeat lab drawn, value confirmed normal. Attending aware."
          style={{
            width: '100%',
            padding: 10,
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            fontSize: 13,
            resize: 'vertical',
            fontFamily: 'inherit',
            lineHeight: 1.45,
            color: '#0f172a',
            outline: 'none',
          }}
          autoFocus
          disabled={submitting}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: len > 500 ? '#dc2626' : '#64748b' }}>
            {len}/500 {len < 4 ? '· min 4' : ''}
          </span>
          {err ? (
            <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>{err}</span>
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              color: '#334155',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!valid || submitting}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #b91c1c',
              background: !valid || submitting ? '#fecaca' : '#dc2626',
              fontSize: 13,
              fontWeight: 700,
              color: '#ffffff',
              cursor: !valid || submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Dismissing…' : 'Confirm dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
}
