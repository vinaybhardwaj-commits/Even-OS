import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const isAdmin = ['super_admin', 'hospital_admin'].includes(user.role);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <h1 className="text-xl font-bold">Even OS</h1>
        <div className="flex items-center gap-4">
          <a href="/profile" className="text-sm text-blue-100 hover:text-white transition-colors">
            {user.name} ({user.role})
          </a>
          <form action="/api/trpc/auth.logout" method="POST">
            <button className="text-sm text-blue-100 hover:text-white transition-colors">
              Sign Out
            </button>
          </form>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome to Even OS</h2>
          <p className="text-gray-500 mb-6">Sprint S1 — Full auth system with RBAC, device trust, and emergency access.</p>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-6 border border-blue-100">
              <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">Role</p>
              <p className="text-2xl font-bold text-blue-900 mt-2">{user.role.replace(/_/g, ' ')}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-6 border border-green-100">
              <p className="text-xs text-green-600 font-semibold uppercase tracking-wide">Hospital</p>
              <p className="text-2xl font-bold text-green-900 mt-2">{user.hospital_id}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-6 border border-purple-100">
              <p className="text-xs text-purple-600 font-semibold uppercase tracking-wide">Department</p>
              <p className="text-2xl font-bold text-purple-900 mt-2">{user.department || 'System'}</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <a href="/profile" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                <span className="text-2xl">👤</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">My Profile</p>
                  <p className="text-xs text-gray-500">Password, devices, activity</p>
                </div>
              </a>
              <a href="/break-glass" className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors">
                <span className="text-2xl">🚨</span>
                <div>
                  <p className="text-sm font-semibold text-red-800">Break-Glass</p>
                  <p className="text-xs text-red-600">Emergency access</p>
                </div>
              </a>
            </div>
          </div>

          {/* Admin Links */}
          {isAdmin && (
            <div className="mt-8 pt-8 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Administration</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <a href="/admin/users" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">👥</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Users</p>
                    <p className="text-xs text-gray-500">Manage staff accounts</p>
                  </div>
                </a>
                <a href="/admin/roles" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">🔐</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Roles</p>
                    <p className="text-xs text-gray-500">Permissions matrix</p>
                  </div>
                </a>
                <a href="/admin/login-attempts" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">📋</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Login Attempts</p>
                    <p className="text-xs text-gray-500">Auth log & lockouts</p>
                  </div>
                </a>
              </div>
            </div>
          )}

          {/* Master Data */}
          {isAdmin && (
            <div className="mt-8 pt-8 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Master Data</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <a href="/admin/charge-master" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#8377;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Charge Master</p>
                    <p className="text-xs text-gray-500">Prices, procedures, labs</p>
                  </div>
                </a>
                <a href="/admin/drug-master" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#128138;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Drug Master</p>
                    <p className="text-xs text-gray-500">Medications & formulary</p>
                  </div>
                </a>
                <a href="/admin/order-sets" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#128203;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Order Sets</p>
                    <p className="text-xs text-gray-500">Reusable order templates</p>
                  </div>
                </a>
                <a href="/admin/consent-templates" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#128221;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Consent Forms</p>
                    <p className="text-xs text-gray-500">Versioned consent templates</p>
                  </div>
                </a>
                <a href="/admin/discharge-templates" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#128196;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Discharge Templates</p>
                    <p className="text-xs text-gray-500">Summary field config</p>
                  </div>
                </a>
              </div>
            </div>
          )}

          {/* Clinical */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Clinical</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <a href="/admin/patients" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                <span className="text-2xl">&#128101;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Patient Registry</p>
                  <p className="text-xs text-gray-500">Register, search & manage</p>
                </div>
              </a>
              <a href="/admin/dedup" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-yellow-50 hover:border-yellow-200 transition-colors">
                <span className="text-2xl">&#8596;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Dedup Queue</p>
                  <p className="text-xs text-gray-500">Review & merge duplicates</p>
                </div>
              </a>
            </div>
          </div>

          {/* Governance */}
          {isAdmin && (
            <div className="mt-8 pt-8 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Governance</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <a href="/admin/gst-rates" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#37;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">GST Rates</p>
                    <p className="text-xs text-gray-500">Tax rates & effective dates</p>
                  </div>
                </a>
                <a href="/admin/approval-hierarchies" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#9878;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Approval Hierarchies</p>
                    <p className="text-xs text-gray-500">Thresholds & approvers</p>
                  </div>
                </a>
                <a href="/admin/nabh-indicators" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                  <span className="text-2xl">&#9733;</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">NABH Indicators</p>
                    <p className="text-xs text-gray-500">100 quality metrics</p>
                  </div>
                </a>
              </div>
            </div>
          )}

          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">System Status</h3>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <p className="text-sm text-gray-600">Sprint S3b — Dedup Engine: Live dedup check, admin queue, merge/dismiss. 26 routes.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
