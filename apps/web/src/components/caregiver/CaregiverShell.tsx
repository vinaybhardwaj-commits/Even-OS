'use client';

import { useState, useEffect } from 'react';
import ShiftBadge from '@/components/shifts/ShiftBadge';

// ── Role display helpers ──────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Admin',
  hospital_admin: 'Admin',
  nurse: 'Nurse',
  senior_nurse: 'Sr. Nurse',
  charge_nurse: 'Charge Nurse',
  nursing_supervisor: 'Nursing Supervisor',
  nursing_manager: 'Nursing Manager',
  nursing_assistant: 'Nursing Asst.',
  resident: 'Resident',
  senior_resident: 'Sr. Resident',
  intern: 'Intern',
  visiting_consultant: 'Visiting Consultant',
  hospitalist: 'Hospitalist',
  specialist_cardiologist: 'Cardiologist',
  specialist_neurologist: 'Neurologist',
  specialist_orthopedic: 'Orthopedic',
  chief_pharmacist: 'Chief Pharmacist',
  senior_pharmacist: 'Sr. Pharmacist',
  pharmacist: 'Pharmacist',
  pharmacy_technician: 'Pharm. Tech',
  lab_director: 'Lab Director',
  senior_lab_technician: 'Sr. Lab Tech',
  lab_technician: 'Lab Tech',
  phlebotomist: 'Phlebotomist',
  lab_manager: 'Lab Manager',
  chief_radiologist: 'Chief Radiologist',
  senior_radiologist: 'Sr. Radiologist',
  radiologist: 'Radiologist',
  radiology_technician: 'Rad. Tech',
  billing_manager: 'Billing Manager',
  billing_executive: 'Billing Exec.',
  insurance_coordinator: 'Insurance Coord.',
  receptionist: 'Receptionist',
  ip_coordinator: 'IP Coordinator',
  surgeon: 'Surgeon',
  anaesthetist: 'Anaesthetist',
  ot_nurse: 'OT Nurse',
};

function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getRoleColor(role: string): string {
  if (role.includes('nurse') || role.includes('nursing')) return 'bg-emerald-100 text-emerald-700';
  if (['resident', 'senior_resident', 'intern', 'hospitalist', 'visiting_consultant'].includes(role)) return 'bg-blue-100 text-blue-700';
  if (role.includes('specialist') || role === 'surgeon' || role === 'anaesthetist') return 'bg-purple-100 text-purple-700';
  if (role.includes('pharmac')) return 'bg-amber-100 text-amber-700';
  if (role.includes('lab') || role === 'phlebotomist') return 'bg-cyan-100 text-cyan-700';
  if (role.includes('radiol')) return 'bg-indigo-100 text-indigo-700';
  if (role.includes('billing') || role.includes('insurance') || role.includes('financial') || role.includes('accounts')) return 'bg-orange-100 text-orange-700';
  if (['receptionist', 'ip_coordinator'].includes(role)) return 'bg-pink-100 text-pink-700';
  return 'bg-gray-100 text-gray-700';
}

interface CaregiverShellProps {
  user: {
    name: string;
    role: string;
    department: string;
    email: string;
  };
  children: React.ReactNode;
}

export default function CaregiverShell({ user, children }: CaregiverShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifCount] = useState(0); // Placeholder for future notification system

  // Close menu on route change (simplified)
  useEffect(() => {
    setMenuOpen(false);
  }, [children]);

  return (
    <div className="caregiver-theme min-h-screen bg-[var(--care-bg)]">
      {/* ── Top Bar (48px) ──────────────────────────────────────────── */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center px-3 gap-3 sticky top-0 z-40 shadow-sm">
        {/* Logo / Brand */}
        <a href="/care/home" className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-6 h-6 bg-even-blue rounded-md flex items-center justify-center">
            <span className="text-white text-xs font-bold">E</span>
          </div>
          <span className="text-sm font-semibold text-gray-800 hidden sm:inline">Even OS</span>
        </a>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-200 hidden sm:block" />

        {/* Role badge */}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getRoleColor(user.role)}`}>
          {getRoleLabel(user.role)}
        </span>

        {/* Department */}
        {user.department && (
          <span className="text-xs text-gray-400 hidden md:inline">{user.department}</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Shift Badge */}
        <div className="hidden sm:block">
          <ShiftBadge />
        </div>

        {/* Notification bell */}
        <button className="relative p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {notifCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
              {notifCount}
            </span>
          )}
        </button>

        {/* Avatar / User menu */}
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="w-7 h-7 rounded-full bg-even-blue text-white text-xs font-medium flex items-center justify-center hover:bg-blue-700 transition-colors">
            {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 w-56 bg-white rounded-xl shadow-lg border z-50 py-2">
                <div className="px-3 py-2 border-b">
                  <div className="text-sm font-medium text-gray-800">{user.name}</div>
                  <div className="text-xs text-gray-400">{user.email}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{getRoleLabel(user.role)}</div>
                </div>
                <a href="/care/home" className="block px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Home</a>
                <a href="/care/schedule" className="block px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">My Schedule</a>
                <a href="/profile" className="block px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Profile</a>
                <div className="border-t mt-1 pt-1">
                  <form action="/api/auth/logout" method="POST">
                    <button type="submit" className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                      Sign Out
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <main className="min-h-[calc(100vh-48px)]">
        {children}
      </main>

      {/* ── Bottom Tab Bar (phone only, <768px) ─────────────────────── */}
      {/* Rendered by individual persona views via BottomTabBar component */}
    </div>
  );
}
