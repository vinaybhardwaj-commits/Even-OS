'use client';

/**
 * OverviewLsqCard — PC.4.A.5 (19 Apr 2026)
 *
 * Right-sidebar card on the patient Overview tab showing LSQ (LeadSquared
 * CRM) lineage for a patient. Rendered for all roles on Overview; CCE
 * teams rely on this most heavily (per PRD v2.0 decision #22 — "Sewa +
 * LSQ tiles on Overview").
 *
 * Display rules:
 *   - Hidden entirely if the patient is NOT from LSQ (null query result).
 *   - When present: lead-id pill, status pill (synced/processed/merged),
 *     relative-time "synced N days ago", source-type footer.
 *
 * Data: lsq.getByPatient({ patient_id })
 *       Returns { lsq_lead_id, status, synced_at, source_type, has_sync_state } | null
 *
 * Fetch: uses the same fetch-based trpcQuery helper as other chart-side
 * components (NOT tRPC React hooks) — parent file is patient-chart-client.tsx.
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

interface LsqLead {
  lsq_lead_id: string | null;
  status: 'synced' | 'processed' | 'merged' | null;
  synced_at: string | null;
  source_type: string | null;
  has_sync_state: boolean;
}

interface Props {
  patientId: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '—';
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function statusColor(status: LsqLead['status']) {
  switch (status) {
    case 'merged':    return { bg: '#E0E7FF', fg: '#3730A3' };
    case 'processed': return { bg: '#DCFCE7', fg: '#166534' };
    case 'synced':
    default:          return { bg: '#FEF9C3', fg: '#854D0E' };
  }
}

export default function OverviewLsqCard({ patientId }: Props) {
  const [lead, setLead] = useState<LsqLead | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await trpcQuery('lsq.getByPatient', { patient_id: patientId });
        if (!cancelled) {
          setLead((result as LsqLead | null) ?? null);
          setLoaded(true);
        }
      } catch (err) {
        // Non-fatal — LSQ is a courtesy surface; failures hide the card.
        // eslint-disable-next-line no-console
        console.warn('[PC.4.A.5] lsq.getByPatient failed:', err);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  // Hide card entirely for non-LSQ patients (null result) and while loading.
  if (!loaded || !lead) return null;

  const sc = statusColor(lead.status);
  const leadShort = lead.lsq_lead_id
    ? (lead.lsq_lead_id.length > 10 ? `…${lead.lsq_lead_id.slice(-6)}` : lead.lsq_lead_id)
    : '—';

  return (
    <div style={{
      background: 'white',
      borderRadius: 12,
      padding: 20,
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      border: '1px solid #EEF2FF',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <h3 style={{
          fontSize: 13, fontWeight: 700, margin: 0,
          textTransform: 'uppercase', color: '#666',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 800,
            background: '#4F46E5', color: 'white',
            padding: '2px 6px', borderRadius: 4,
            letterSpacing: 0.5,
          }}>LSQ</span>
          Lead Source
        </h3>
        <span title={lead.status ?? 'synced'} style={{
          fontSize: 11, fontWeight: 700,
          background: sc.bg, color: sc.fg,
          padding: '2px 8px', borderRadius: 10,
          textTransform: 'capitalize',
        }}>{lead.status ?? 'synced'}</span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#666' }}>Lead ID</span>
          <span
            title={lead.lsq_lead_id ?? '—'}
            style={{ fontFamily: 'monospace', fontWeight: 600, color: '#002054' }}
          >{leadShort}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#666' }}>Last sync</span>
          <span
            title={lead.synced_at ?? ''}
            style={{ fontWeight: 600, color: '#002054' }}
          >{relativeTime(lead.synced_at)}</span>
        </div>
        {lead.source_type && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: '#666' }}>Source</span>
            <span style={{ fontWeight: 600, color: '#002054', textTransform: 'capitalize' }}>
              {lead.source_type.replace(/_/g, ' ')}
            </span>
          </div>
        )}
      </div>

      {!lead.has_sync_state && (
        <div style={{
          marginTop: 10, padding: '6px 8px',
          background: '#FEF9C3', color: '#854D0E',
          borderRadius: 6, fontSize: 11, lineHeight: 1.3,
        }}>
          Lead id on patient but no sync-state row — legacy import.
        </div>
      )}
    </div>
  );
}
