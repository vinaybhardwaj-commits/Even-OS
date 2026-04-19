'use client';

/**
 * UserMenu — avatar dropdown with profile / break-glass / logout.
 * Logout hits /api/auth/logout (existing endpoint) then redirects to /login.
 */
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    role: string;
    department?: string;
  };
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  dept_head: 'Dept Head',
  clinician: 'Clinician',
  staff: 'Staff',
  analyst: 'Analyst',
  patient: 'Patient',
};

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const initials = (user.name || user.email || '?')
    .split(/\s+/)
    .map(s => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-100"
        aria-label="User menu"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
          {initials}
        </span>
        <span className="hidden flex-col items-start md:flex">
          <span className="text-xs font-medium text-slate-900">{user.name || user.email}</span>
          <span className="text-[10px] text-slate-500">{ROLE_LABEL[user.role] || user.role}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-60 overflow-hidden rounded-lg bg-white text-sm shadow-xl ring-1 ring-slate-900/5">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="truncate font-semibold text-slate-900">{user.name || user.email}</div>
            <div className="truncate text-xs text-slate-500">{user.email}</div>
            <div className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
              {ROLE_LABEL[user.role] || user.role}
            </div>
            {user.department && (
              <div className="mt-1 text-[11px] text-slate-500">{user.department}</div>
            )}
          </div>
          <Link
            href="/profile"
            className="block px-4 py-2 text-slate-700 hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            👤 My Profile
          </Link>
          <Link
            href="/break-glass"
            className="block px-4 py-2 text-slate-700 hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            🚨 Break-Glass Access
          </Link>
          <button
            type="button"
            onClick={logout}
            className="block w-full border-t border-slate-100 px-4 py-2 text-left text-slate-700 hover:bg-slate-50"
          >
            ↪ Sign out
          </button>
        </div>
      )}
    </div>
  );
}
