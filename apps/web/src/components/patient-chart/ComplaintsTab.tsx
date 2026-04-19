'use client';

/**
 * ComplaintsTab — PC.4.A.6 (19 Apr 2026)
 *
 * Full-tab view of every complaint for a patient, as the dedicated
 * "Complaints" tab in the CCE default tab order (PRD v2.0 lock #1):
 *   Overview → Brief → Comms → Complaints → Bill
 *
 * Surfaces:
 *   - Filter chips: Open | In Progress | Resolved | All
 *   - Raise CTA (reuses RaiseComplaintModal in mode='raise')
 *   - Row list with priority pill, SLA badge, subject, category, raised-by
 *   - Row click → RaiseComplaintModal in mode='detail'
 *   - "Open Chat" CTA bubbles up so parent can open dual-room slider
 *
 * Reuses:
 *   - complaints.listByPatient({ patient_id, include_closed })
 *   - complaints.countOpenByPatient({ patient_id })
 *   - RaiseComplaintModal (mode='raise' | 'detail')
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import RaiseComplaintModal from './RaiseComplaintModal';

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
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
  sla_due_at: string;
  raised_by_user_name: string;
  created_at: string;
  resolved_at?: string | null;
}

interface Counts { open: number; breached: number; at_risk: number; }

type FilterKey = 'open' | 'in_progress' | 'resolved' | 'all';

interface Props {
  patientId: string;
  encounterId?: string | null;
  onOpenChat?: () => void;
}

const PRIORITY_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B', label: 'CRITICAL' },
  high:     { bg: '#FEF3C7', fg: '#92400E', label: 'HIGH' },
  normal:   { bg: '#E0E7FF', fg: '#3730A3', label: 'NORMAL' },
  low:      { bg: '#F3F4F6', fg: '#4B5563', label: 'LOW' },
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  open:        { bg: '#FEE2E2', fg: '#991B1B', label: 'Open' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E', label: 'In Progress' },
  resolved:    { bg: '#ECFDF5', fg: '#065F46', label: 'Resolved' },
  closed:      { bg: '#F3F4F6', fg: '#4B5563', label: 'Closed' },
};

function slaBadge(sla: string, status: ComplaintRow['status']): { text: string; bg: string; fg: string } | null {
  if (status === 'resolved' || status === 'closed') return null;
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

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} days ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ComplaintsTab({ patientId, encounterId, onOpenChat }: Props) {
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ open: 0, breached: 0, at_risk: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('open');
  const [refreshToken, setRefreshToken] = useState(0);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [list, ct] = await Promise.all([
          trpcQuery('complaints.listByPatient', { patient_id: patientId, include_closed: true }),
          trpcQuery('complaints.countOpenByPatient', { patient_id: patientId }),
        ]);
        if (cancelled) return;
        setRows(Array.isArray(list) ? list : []);
        setCounts(ct ?? { open: 0, breached: 0, at_risk: 0 });
      } catch (err) {
        console.warn('ComplaintsTab load error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId, refreshToken]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter(r => r.status === 'open');
    if (filter === 'in_progress') return rows.filter(r => r.status === 'in_progress');
    if (filter === 'resolved') return rows.filter(r => r.status === 'resolved' || r.status === 'closed');
    return rows;
  }, [rows, filter]);

  const tallies = useMemo(() => ({
    open: rows.filter(r => r.status === 'open').length,
    in_progress: rows.filter(r => r.status === 'in_progress').length,
    resolved: rows.filter(r => r.status === 'resolved' || r.status === 'closed').length,
    all: rows.length,
  }), [rows]);

  const onSubmitted = useCallback(() => {
    setRaiseOpen(false);
    setDetailId(null);
    setRefreshToken(x => x + 1);
  }, []);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>
            Complaints
          </h2>
          <div style={{ marginTop: 4, fontSize: 13, color: '#6B7280' }}>
            {counts.open} open
            {counts.breached > 0 && <> · <span style={{ color: '#991B1B', fontWeight: 600 }}>{counts.breached} breached</span></>}
            {counts.at_risk > 0 && <> · <span style={{ color: '#92400E', fontWeight: 600 }}>{counts.at_risk} at-risk</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              style={{
                padding: '8px 14px', borderRadius: 6, border: '1px solid #D1D5DB',
                background: 'white', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
              title="Open patient chat to discuss these complaints"
            >
              💬 Open Chat
            </button>
          )}
          <button
            type="button"
            onClick={() => setRaiseOpen(true)}
            style={{
              padding: '8px 14px', borderRadius: 6, border: 'none',
              background: '#0055FF', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            + Raise complaint
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          { key: 'open',        label: 'Open',        count: tallies.open },
          { key: 'in_progress', label: 'In Progress', count: tallies.in_progress },
          { key: 'resolved',    label: 'Resolved',    count: tallies.resolved },
          { key: 'all',         label: 'All',         count: tallies.all },
        ] as const).map(chip => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            style={{
              padding: '6px 12px', borderRadius: 999,
              border: filter === chip.key ? '1px solid #0055FF' : '1px solid #D1D5DB',
              background: filter === chip.key ? '#EFF6FF' : 'white',
              color: filter === chip.key ? '#0055FF' : '#374151',
              fontSize: 12, fontWeight: filter === chip.key ? 600 : 500, cursor: 'pointer',
            }}
          >
            {chip.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{chip.count}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding: '32px 16px', textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
          Loading complaints…
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <div style={{
          padding: '40px 16px', textAlign: 'center', color: '#6B7280', fontSize: 14,
          background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: 8,
        }}>
          {filter === 'open' ? 'No open complaints for this patient.' :
           filter === 'in_progress' ? 'Nothing currently in progress.' :
           filter === 'resolved' ? 'No resolved complaints yet.' :
           'No complaints logged for this patient.'}
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(row => {
            const prio = PRIORITY_COLORS[row.priority] ?? PRIORITY_COLORS.normal;
            const stat = STATUS_COLORS[row.status] ?? STATUS_COLORS.open;
            const sla = slaBadge(row.sla_due_at, row.status);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setDetailId(row.id)}
                style={{
                  textAlign: 'left', padding: 14, borderRadius: 8,
                  border: '1px solid #E5E7EB', background: 'white', cursor: 'pointer',
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'start',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                      background: prio.bg, color: prio.fg,
                    }}>{prio.label}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: stat.bg, color: stat.fg,
                    }}>{stat.label}</span>
                    {sla && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: sla.bg, color: sla.fg,
                      }}>{sla.text}</span>
                    )}
                    {encounterId && row.encounter_id === encounterId && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                        background: '#F3F4F6', color: '#4B5563',
                      }}>This encounter</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>
                    {row.category} · Raised by {row.raised_by_user_name || '—'} · {relativeTime(row.created_at)}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                  {new Date(row.created_at).toLocaleDateString()}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <RaiseComplaintModal
        open={raiseOpen}
        mode="raise"
        patientId={patientId}
        encounterId={encounterId}
        onClose={() => setRaiseOpen(false)}
        onSubmitted={onSubmitted}
      />
      <RaiseComplaintModal
        open={!!detailId}
        mode="detail"
        patientId={patientId}
        encounterId={encounterId}
        complaintId={detailId}
        onClose={() => setDetailId(null)}
        onSubmitted={onSubmitted}
      />
    </div>
  );
}
