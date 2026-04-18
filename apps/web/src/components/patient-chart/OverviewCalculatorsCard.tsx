'use client';

/**
 * OverviewCalculatorsCard — PC.2b2 (18 Apr 2026)
 *
 * Right-sidebar card on the patient Overview tab. Two sections:
 *   1. Pinned calculators — user-level pins (listPins) rendered as chips.
 *      Click → opens Calculators tab with that calc pre-selected.
 *   2. Red-band last 24 h — results whose band.color = 'red' for this
 *      patient, newest first. Surfaces high-acuity findings the care team
 *      should see without opening the Calculators tab.
 *
 * Per V's locked decision (PC.2b):
 *   "Pinned + red-band last 24 h on Overview."
 *
 * Safety notes:
 *   - Red-band section is purely informational; no mutation surfaces here.
 *   - Clicking a chip or red row is a navigation action, not a calc run.
 */

import { useEffect, useState } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface PinnedCalc {
  id: string;
  slug: string;
  name: string;
  specialty: string;
  effective_pinned: boolean;
}

interface RedBandResult {
  result_id: string;
  calc_id: string;
  score: number;
  band_key: string;
  ran_at: string;
  calc_name: string;
  calc_slug: string;
  calc_specialty: string;
  band_label: string;
  band_color: string;
  band_clinical_action: string | null;
}

interface Props {
  patientId: string;
  /** Opens the Calculators tab. If calcId provided, pre-selects that calc. */
  onOpenCalc: (calcId?: string) => void;
}

function timeAgoShort(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function OverviewCalculatorsCard({ patientId, onOpenCalc }: Props) {
  const [pins, setPins] = useState<PinnedCalc[]>([]);
  const [reds, setReds] = useState<RedBandResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [pinsData, redsData] = await Promise.all([
        trpcQuery('calculators.listPins'),
        trpcQuery('calculators.listRedBandRecent', { patient_id: patientId, hours: 24, limit: 10 }),
      ]);
      if (cancelled) return;
      setPins(Array.isArray(pinsData) ? (pinsData as PinnedCalc[]) : []);
      setReds(Array.isArray(redsData) ? (redsData as RedBandResult[]) : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const hasAny = pins.length > 0 || reds.length > 0;

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
            fontSize: 13,
            fontWeight: 700,
            margin: 0,
            textTransform: 'uppercase',
            color: '#666',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>🧮</span> Clinical Calculators
        </h3>
        <button
          onClick={() => onOpenCalc()}
          style={{
            fontSize: 11,
            color: '#0055FF',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Open →
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 0' }}>Loading…</div>
      )}

      {!loading && !hasAny && (
        <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 4px', lineHeight: 1.5 }}>
          No pinned calculators yet. Open the Calculators tab and tap ⭐ on a calc to pin it here.
        </div>
      )}

      {/* Red-band results (last 24h) — render first; highest priority */}
      {!loading && reds.length > 0 && (
        <div style={{ marginBottom: pins.length > 0 ? 16 : 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#DC2626',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            🚨 Red-band · last 24 h
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {reds.map((r) => (
              <button
                key={r.result_id}
                onClick={() => onOpenCalc(r.calc_id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  background: '#FEE2E2',
                  border: '1px solid #FCA5A5',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.calc_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#7F1D1D', marginTop: 2 }}>
                    {r.band_label} · {timeAgoShort(r.ran_at)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: '#991B1B',
                    fontFamily: 'monospace',
                    minWidth: 28,
                    textAlign: 'right',
                  }}
                >
                  {r.score}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pinned calcs */}
      {!loading && pins.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#666',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            Pinned
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pins.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpenCalc(p.id)}
                title={`${p.name} · ${p.specialty}`}
                style={{
                  fontSize: 12,
                  padding: '6px 10px',
                  background: '#EEF2FF',
                  border: '1px solid #C7D2FE',
                  color: '#3730A3',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
