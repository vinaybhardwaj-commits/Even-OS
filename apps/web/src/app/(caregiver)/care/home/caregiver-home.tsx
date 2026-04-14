'use client';

// ── Role group mapping ────────────────────────────────────────────────
function getRoleGroup(role: string): string {
  if (role.includes('nurse') || role.includes('nursing')) return 'nursing';
  if (['resident', 'senior_resident', 'intern', 'hospitalist', 'visiting_consultant'].includes(role)) return 'clinical';
  if (role.includes('specialist')) return 'clinical';
  if (role === 'surgeon' || role === 'anaesthetist' || role === 'ot_nurse') return 'surgical';
  if (role.includes('pharmac')) return 'pharmacy';
  if (role.includes('lab') || role === 'phlebotomist') return 'lab';
  if (role.includes('radiol')) return 'radiology';
  if (role.includes('billing') || role.includes('insurance') || role.includes('financial') || role.includes('accounts')) return 'billing';
  if (['receptionist', 'ip_coordinator'].includes(role)) return 'support';
  if (['super_admin', 'hospital_admin', 'system_super_admin'].includes(role)) return 'admin';
  return 'general';
}

// ── Quick action definitions per role group ─────────────────────────
interface QuickAction {
  label: string;
  href: string;
  icon: string;
  color: string;
  description: string;
}

const ROLE_ACTIONS: Record<string, QuickAction[]> = {
  nursing: [
    { label: 'My Patients', href: '/care/nurse', icon: '🏥', color: 'bg-emerald-50 border-emerald-200 text-emerald-700', description: 'View assigned patients, vitals, tasks' },
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'View weekly shift schedule' },
    { label: 'Handoff Notes', href: '/care/nurse/handoff', icon: '📋', color: 'bg-amber-50 border-amber-200 text-amber-700', description: 'Prepare or review shift handoff' },
    { label: 'eMAR', href: '/care/nurse/emar', icon: '💊', color: 'bg-purple-50 border-purple-200 text-purple-700', description: 'Medication administration records' },
  ],
  clinical: [
    { label: 'My Patients', href: '/care/doctor', icon: '🩺', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'Round on assigned patients' },
    { label: 'Orders', href: '/care/doctor/orders', icon: '📝', color: 'bg-indigo-50 border-indigo-200 text-indigo-700', description: 'Write and review orders' },
    { label: 'Co-Sign Queue', href: '/care/doctor/cosign', icon: '✅', color: 'bg-amber-50 border-amber-200 text-amber-700', description: 'Pending notes requiring co-signature' },
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'View weekly schedule' },
  ],
  surgical: [
    { label: 'OT Schedule', href: '/care/ot', icon: '🔪', color: 'bg-purple-50 border-purple-200 text-purple-700', description: 'Today\'s operating theatre schedule' },
    { label: 'My Patients', href: '/care/doctor', icon: '🩺', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'Pre-op and post-op patients' },
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'View weekly schedule' },
  ],
  pharmacy: [
    { label: 'Dispensing Queue', href: '/care/pharmacy', icon: '💊', color: 'bg-amber-50 border-amber-200 text-amber-700', description: 'Orders pending dispensing' },
    { label: 'Verification', href: '/care/pharmacy/verify', icon: '✅', color: 'bg-green-50 border-green-200 text-green-700', description: 'Verify medication orders' },
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'View weekly schedule' },
  ],
  lab: [
    { label: 'Worklist', href: '/care/lab', icon: '🔬', color: 'bg-cyan-50 border-cyan-200 text-cyan-700', description: 'Pending specimens and tests' },
    { label: 'Results Entry', href: '/care/lab/results', icon: '📊', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'Enter and verify results' },
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'View weekly schedule' },
  ],
  radiology: [
    { label: 'Worklist', href: '/care/lab', icon: '📡', color: 'bg-indigo-50 border-indigo-200 text-indigo-700', description: 'Pending imaging studies' },
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'View weekly schedule' },
  ],
  billing: [
    { label: 'Billing Queue', href: '/care/billing', icon: '💰', color: 'bg-orange-50 border-orange-200 text-orange-700', description: 'Pending bills and claims' },
    { label: 'Insurance Claims', href: '/care/billing/claims', icon: '📄', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'Pre-auth and settlement' },
  ],
  support: [
    { label: 'Patient Queue', href: '/care/customer-care', icon: '👥', color: 'bg-pink-50 border-pink-200 text-pink-700', description: 'Front desk patient queue' },
    { label: 'Admissions', href: '/care/customer-care/admissions', icon: '🏥', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'Pending admissions' },
  ],
  admin: [
    { label: 'Admin Dashboard', href: '/admin', icon: '⚙️', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'Hospital administration' },
  ],
  general: [
    { label: 'My Schedule', href: '/care/schedule', icon: '📅', color: 'bg-gray-50 border-gray-200 text-gray-700', description: 'View weekly schedule' },
  ],
};

interface CaregiverHomeProps {
  userName: string;
  userRole: string;
  targetRoute: string;
}

export default function CaregiverHome({ userName, userRole, targetRoute }: CaregiverHomeProps) {
  const roleGroup = getRoleGroup(userRole);
  const actions = ROLE_ACTIONS[roleGroup] || ROLE_ACTIONS.general;
  const firstName = userName.split(' ')[0];

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 care-content-padded">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--care-text)' }}>
          {greeting}, {firstName}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--care-text-secondary)' }}>
          Welcome to Even OS Caregiver Views
        </p>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--care-text-muted)' }}>
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {actions.map(action => (
            <a key={action.href} href={action.href}
              className={`block p-4 rounded-xl border transition-all hover:shadow-md ${action.color}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{action.icon}</span>
                <div>
                  <div className="font-semibold text-sm">{action.label}</div>
                  <div className="text-xs opacity-70 mt-0.5">{action.description}</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Status note */}
      <div className="mt-8 p-4 rounded-xl border" style={{ backgroundColor: 'var(--care-primary-light)', borderColor: 'var(--care-border)' }}>
        <p className="text-sm" style={{ color: 'var(--care-text-secondary)' }}>
          Caregiver Views are being built progressively. Your persona-specific workspace
          will be available as each module goes live. For now, use the quick actions above
          to access available features.
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--care-text-muted)' }}>
          Your home route: <code className="bg-white/50 px-1.5 py-0.5 rounded text-xs">{targetRoute}</code>
        </p>
      </div>
    </div>
  );
}
