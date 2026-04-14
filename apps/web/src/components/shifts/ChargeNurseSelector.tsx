'use client';

import { useState, useEffect } from 'react';

// ── tRPC helper ───────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

interface ShiftOption {
  roster_id: string;
  instance_id: string;
  template_name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
  ward_id: string;
  role_during_shift: string;
}

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

interface ChargeNurseSelectorProps {
  onSelect?: (instanceId: string, wardId: string) => void;
}

/**
 * ChargeNurseSelector — dropdown for charge nurses to pick their active shift.
 * Sets the context for shift handoff, patient assignments, and ward views.
 *
 * Shows all of today's rostered shifts for the current user.
 * Fires onSelect(instanceId, wardId) when a shift is chosen.
 */
export default function ChargeNurseSelector({ onSelect }: ChargeNurseSelectorProps) {
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpcQuery('shifts.getCurrentShift')
      .then(data => {
        if (data && data.length > 0) {
          setShifts(data);
          // Auto-select first (or active) shift
          const active = data.find((s: ShiftOption) => s.role_during_shift === 'charge_nurse');
          const pick = active || data[0];
          setSelected(pick.instance_id);
          onSelect?.(pick.instance_id, pick.ward_id);
        }
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="h-10 w-48 bg-gray-100 rounded-lg animate-pulse" />;
  }

  if (shifts.length === 0) {
    return (
      <div className="px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-400">
        No shifts today
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={selected}
        onChange={e => {
          setSelected(e.target.value);
          const shift = shifts.find(s => s.instance_id === e.target.value);
          if (shift) onSelect?.(shift.instance_id, shift.ward_id);
        }}
        className="appearance-none bg-white border rounded-lg px-3 py-2 pr-8 text-sm font-medium min-w-[200px]"
      >
        {shifts.map(s => (
          <option key={s.instance_id} value={s.instance_id}>
            {s.template_name} ({formatTime(s.start_time)}–{formatTime(s.end_time)}) — {s.role_during_shift}
          </option>
        ))}
      </select>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
        ▾
      </div>
    </div>
  );
}
