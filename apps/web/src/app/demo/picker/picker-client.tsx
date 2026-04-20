'use client';

import { useState } from 'react';
import {
  Stethoscope,
  UserRound,
  UserCog,
  ClipboardCheck,
  Headphones,
  AlertTriangle,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { DemoRole, DemoRoleKey } from '@/lib/demo/roles';

/**
 * DEMO.4 — PickerClient
 *
 * Renders the 4-card persona grid and handles the fetch to
 * `POST /api/demo/switch`. On success we do a hard
 * `window.location.href = data.redirect` so the next request is
 * made with the fresh `even_session` cookie (router.push would
 * keep the React tree mounted with the old session context).
 */

// Icon registry — keeps the roles.ts config string-based so it
// doesn't drag lucide types into the server bundle. Add new keys
// here when extending DEMO_ROLES.
const ICON_MAP: Record<string, LucideIcon> = {
  Stethoscope,
  UserRound,
  UserCog,
  ClipboardCheck,
  Headphones,
};

interface PickerClientProps {
  roles: DemoRole[];
}

export default function PickerClient({ roles }: PickerClientProps) {
  const [busy, setBusy] = useState<DemoRoleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickRole(roleKey: DemoRoleKey) {
    if (busy) return;
    setBusy(roleKey);
    setError(null);

    try {
      const res = await fetch('/api/demo/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleKey }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        redirect?: string;
      };

      if (!res.ok || !data.ok) {
        setError(data.error || `Switch failed (HTTP ${res.status})`);
        setBusy(null);
        return;
      }

      // Hard reload so middleware + layouts re-read the new cookie
      // on the next request. Do NOT use router.push.
      window.location.href = data.redirect || '/';
    } catch {
      setError('Connection error. Please try again.');
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-blue-900 flex flex-col items-center px-4 py-10">
      {/* Header */}
      <div className="w-full max-w-4xl text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-blue-800/30 border border-blue-400/30 text-blue-200 px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wide mb-4">
          Demo Mode
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-white">
          Choose a persona
        </h1>
        <p className="text-blue-200 mt-2 text-sm md:text-base">
          Pick a role below to see Even OS through their eyes. You can log out and sign back in as{' '}
          <code className="bg-blue-900/50 px-1.5 py-0.5 rounded text-blue-100 text-xs">demo@even.in</code>{' '}
          to switch again.
        </p>
      </div>

      {/* Live-data warning banner */}
      <div className="w-full max-w-4xl mb-8">
        <div className="bg-amber-50/95 border border-amber-300 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Live EHRC data — handle with care</p>
            <p className="mt-0.5 text-amber-800">
              Once you pick a role you'll be signed in as that user against the
              real EHRC hospital database. Any orders, notes, or edits will be
              saved for real. Stick to read-only actions unless you intend to
              create production data.
            </p>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="w-full max-w-4xl mb-6">
          <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-4xl">
        {roles.map((role) => {
          const Icon = ICON_MAP[role.icon] ?? UserRound;
          const isBusy = busy === role.key;
          const disabled = busy !== null;

          return (
            <button
              key={role.key}
              type="button"
              onClick={() => pickRole(role.key)}
              disabled={disabled}
              className={[
                'group relative bg-white rounded-xl p-6 text-left shadow-lg transition-all',
                'border-2 border-transparent',
                disabled
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:border-blue-400 hover:shadow-xl hover:-translate-y-0.5',
                isBusy ? 'ring-2 ring-blue-500' : '',
              ].join(' ')}
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {role.label}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {role.description}
                  </p>
                  <p className="text-xs text-gray-400 mt-2 font-mono truncate">
                    {role.target_email}
                  </p>
                </div>
              </div>

              {isBusy && (
                <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="text-center mt-10 text-xs text-blue-300">
        Even Healthcare &middot; EHRC &middot; Demo session auto-expires in 5 minutes
      </div>
    </div>
  );
}
