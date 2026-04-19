'use client';

/**
 * OverviewComplaintsCard — PC.4.A.4 (19 Apr 2026)
 *
 * Right-sidebar card on the patient Overview tab showing open patient
 * complaints. Renders:
 *   - Empty state: "No open complaints" + Raise button
 *   - Occupied: count badge (breached/at-risk/open) + list of up to 4
 *     newest complaints, click-through to detail (opens Raise modal
 *     scoped to detail mode for now — PC.4.A.5 adds a dedicated drawer).
 *   - Always: "Raise complaint" CTA that opens the modal.
 *
 * Per V's locked decision #22 (PRD v2.0): Sewa tile on Overview, raise
 * pill in secondary action row. This is the Sewa-facing tile (renamed
 * "Complaints" in Even-OS — see 58-patient-complaints.ts for why the
 * sewa_complaints table was NOT reused).
 *
 * Called from: patient-chart-client.tsx Overview right column, between
 * OverviewCalculatorsCard and the Journey Status card.
 *
 * Data:
 *   - complaints.listByPatient({ patient_id }) → ComplaintRow[]
 *   - complaints.countOpenByPatient({ patient_id }) → { open, breached, at_risk }
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

// ── Types ───────────────────────────────────────────────────────────
interface ComplaintRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  subject: string;
  sla_due_at: string;
  raised_by_user_name: string;
  created_at: string;
}

interface Counts { open: number; breached: number; at_risk: number; }

interface Props {
  patientId: string;
  onRaise: () => void;
  onOpenDetail: (complaintId: string) => void;
  /** Optional bump counter — parent can increment after raise to force re-fetch */
  refreshToken?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────
const PRIORITY_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B', label: 'CRITICAL' },
  high:     { bg: '#FEF3C7', fg: '#92400E', label: 'HIGH' },
  normal:   { bg: '#E0E7FF', fg: '#3730A3', label: 'NORMAL' },
  low:      { bg: '#F3F4F6', fg: '#4B5563', label: 'LOW' },
};

function slaBadge(sla: string): { text: string; bg: string; fg: string } {
  const due = new Date(sla).getTime();
  const now = Date.now();
  const diffMs = due - now;
  if (diffMs < 0) {
    const h = Math.floor(-diffMs / 3_600_000);
    const m = Math.floor(((-diffMs) % 3_600_000) / 60_000);
    return {
      text: h >= 1 ? `Breached ${h}h${m}m` : `Breached ${m}m`,
      bg: '#FEE2E2', fg: '#991B1B',
    };
  }
  if (diffMs <= 3_600_000) {
    const m = Math.max(1, Math.floor(diffMs / 60_000));
    return { text: `Due in ${m}m`, bg: '#FEF3C7', fg: '#92400E' };
  }
  const h = Math.floor(diffMs / 3_600_000);
  return { text: `Due in ${h}h`, bg: '#ECFDF5', fg: '#065F46' };
}

export default function OverviewComplaintsCard({
  patientId, onRaise, onOpenDetail, refreshToken,
}: Props) {
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ open: 0, breached: 0, at_risk: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [list, c] = await Promise.all([
        trpcQuery('complaints.listByPatient', { patient_id: patientId }),
        trpcQuery('complaints.countOpenByPatient', { patient_id: patientId }),
      ]);
      if (cancelled) return;
      setRows(Array.isArray(list) ? (list as ComplaintRow[]) : []);
      setCounts(
        c && typeof c === 'object'
          ? {
              open: Number((c as any).open) || 0,
              breached: Number((c as any).breached) || 0,
              at_risk: Number((c as any).at_risk) || 0,
            }
          : { open: 0, breached: 0, at_risk: 0 },
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [patientId, refreshToken]);

  const headlineColor = counts.breached > 0 ? '#DC2626'
    : counts.at_risk > 0 ? '#D97706'
    : counts.open > 0 ? '#2563EB'
    : '#666';

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3
          style={{
            fontSize: 13, fontWeight: 700, margin: 0,
            textTransform: 'uppercase', color: '#666',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span>📣</span> Complaints
          {counts.open > 0 && (
            <span
              style={{
                fontSize: 11, fontWeight: 700,
                padding: '2px 8px', borderRadius: 999,
                background: headlineColor === '#DC2626' ? '#FEE2E2'
                  : headlineColor === '#D97706' ? '#FEF3C7' : '#DBEAFE',
                color: headlineColor,
              }}
            >
              {counts.breached > 0 ? `${counts.breached} BREACHED` :
               counts.at_risk > 0  ? `${counts.at_risk} AT RISK` :
                                     `${counts.open} OPEN`}
            </span>
          )}
        </h3>
        <button
          onClick={onRaise}
          style={{
            fontSize: 11, color: '#0055FF',
            background: 'none', border: 'none',
            cursor: 'pointer', fontWeight: 600,
          }}
        >
          + Raise
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 0' }}>Loading…</div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 4px', lineHeight: 1.5 }}>
          No open complaints on this patient. Tap <strong>+ Raise</strong> to file one.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.slice(0, 4).map((r) => {
            const pc = PRIORITY_COLORS[r.priority] || PRIORITY_COLORS.normal;
            const sb = slaBadge(r.sla_due_at);
            return (
              <button
                key={r.id}
                onClick={() => onOpenDetail(r.id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '10px 12px',
                  background: '#F9FAFB', border: '1px solid #E5E7EB',
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 9, fontWeight: 700,
                      padding: '1px 6px', borderRadius: 4,
                      background: pc.bg, color: pc.fg, letterSpacing: 0.3,
                    }}
                  >
                    {pc.label}
                  </span>
                  <span
                    style={{
                      fontSize: 9, fontWeight: 700,
                      padding: '1px 6px', borderRadius: 4,
                      background: sb.bg, color: sb.fg, letterSpacing: 0.3,
                    }}
                  >
                    {sb.text}
                  </span>
                  <span style={{ fontSize: 10, color: '#6B7280' }}>· {r.category}</span>
                </div>
                <div
                  style={{
                    fontSize: 13, fontWeight: 600, color: '#111827',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {r.subject}
                </div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  {r.status === 'in_progress' ? 'In progress' : 'Open'} · raised by {r.raised_by_user_name}
                </div>
              </button>
            );
          })}
          {rows.length > 4 && (
            <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', paddingTop: 4 }}>
              + {rows.length - 4} more · tap a card to see detail
            </div>
          )}
        </div>
      )}
    </div>
  );
}
