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

// ── Types ─────────────────────────────────────────────────────────────────
interface CurrentShift {
  roster_id: string;
  roster_status: string;
  role_during_shift: string;
  instance_id: string;
  instance_status: string;
  ward_id: string;
  shift_date: string;
  template_name: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  color: string | null;
  charge_nurse_id: string | null;
}

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:${m} ${ampm}`;
}

/**
 * ShiftBadge — displays the current user's active shift in a compact badge.
 * Place in the caregiver top bar / header area.
 *
 * Shows: shift name, time range, role, and a color dot matching the template.
 * If no shift is rostered today, shows "Off Duty" in gray.
 */
export default function ShiftBadge() {
  const [shift, setShift] = useState<CurrentShift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpcQuery('shifts.getCurrentShift')
      .then(data => {
        if (data && data.length > 0) {
          // Pick the most relevant shift (first active, or first planned)
          const active = data.find((s: CurrentShift) => s.instance_status === 'active');
          setShift(active || data[0]);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg animate-pulse">
        <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        <div className="w-20 h-4 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-400">
        <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        <span>Off Duty</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
      style={{ backgroundColor: (shift.color || '#3B82F6') + '15' }}>
      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: shift.color || '#3B82F6' }} />
      <div>
        <span className="font-medium" style={{ color: shift.color || '#3B82F6' }}>
          {shift.template_name}
        </span>
        <span className="text-gray-500 ml-1.5 text-xs">
          {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
        </span>
      </div>
      <span className="text-xs px-1.5 py-0.5 bg-white/50 rounded text-gray-600 capitalize">
        {shift.role_during_shift}
      </span>
    </div>
  );
}
