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
              <a href="/admin/bed-board" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-green-200 transition-colors">
                <span className="text-2xl">&#128719;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Bed Board</p>
                  <p className="text-xs text-gray-500">Real-time bed grid</p>
                </div>
              </a>
              <a href="/admin/wristbands" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-200 transition-colors">
                <span className="text-2xl">&#9000;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Wristbands</p>
                  <p className="text-xs text-gray-500">Print queue & tracking</p>
                </div>
              </a>
              <a href="/admin/admissions" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-orange-50 hover:border-orange-200 transition-colors">
                <span className="text-2xl">&#127973;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Admissions</p>
                  <p className="text-xs text-gray-500">Admit, checklist & pre-auth</p>
                </div>
              </a>
              <a href="/admin/transfers" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-cyan-50 hover:border-cyan-200 transition-colors">
                <span className="text-2xl">&#8644;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Transfers</p>
                  <p className="text-xs text-gray-500">Bed & ward transfers</p>
                </div>
              </a>
              <a href="/admin/discharge" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-rose-50 hover:border-rose-200 transition-colors">
                <span className="text-2xl">&#10004;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Discharge</p>
                  <p className="text-xs text-gray-500">Milestones & discharge queue</p>
                </div>
              </a>
              <a href="/admin/orders" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-teal-50 hover:border-teal-200 transition-colors">
                <span className="text-2xl">&#128203;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Orders & Vitals</p>
                  <p className="text-xs text-gray-500">Clinical orders, vitals, notes</p>
                </div>
              </a>
              <a href="/admin/consents" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-amber-50 hover:border-amber-200 transition-colors">
                <span className="text-2xl">&#128221;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Consents & Forms</p>
                  <p className="text-xs text-gray-500">Stage forms, consent tracking</p>
                </div>
              </a>
              <a href="/admin/billing" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 transition-colors">
                <span className="text-2xl">&#8377;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Billing</p>
                  <p className="text-xs text-gray-500">Charges, invoices, TPA claims</p>
                </div>
              </a>
              <a href="/admin/problem-list" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-red-50 hover:border-red-200 transition-colors">
                <span className="text-2xl">&#128209;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Problem List</p>
                  <p className="text-xs text-gray-500">Conditions & ICD-10 tracking</p>
                </div>
              </a>
              <a href="/admin/allergies" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-pink-50 hover:border-pink-200 transition-colors">
                <span className="text-2xl">&#9888;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Allergies</p>
                  <p className="text-xs text-gray-500">Allergy tracking & CDS alerts</p>
                </div>
              </a>
              <a href="/admin/vitals" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-sky-50 hover:border-sky-200 transition-colors">
                <span className="text-2xl">&#127777;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Vitals & I/O</p>
                  <p className="text-xs text-gray-500">Observations, NEWS2, alerts</p>
                </div>
              </a>
              <a href="/admin/clinical-notes" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-violet-50 hover:border-violet-200 transition-colors">
                <span className="text-2xl">&#128221;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Clinical Notes</p>
                  <p className="text-xs text-gray-500">SOAP, operative, co-sign queue</p>
                </div>
              </a>
              <a href="/admin/medication-orders" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-rose-50 hover:border-rose-200 transition-colors">
                <span className="text-2xl">&#128138;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">CPOE &amp; eMAR</p>
                  <p className="text-xs text-gray-500">Medication orders, labs, CDS</p>
                </div>
              </a>
              <a href="/admin/care-pathways" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-teal-50 hover:border-teal-200 transition-colors">
                <span className="text-2xl">&#127919;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Care Pathways</p>
                  <p className="text-xs text-gray-500">DAG templates, milestones, escalation</p>
                </div>
              </a>
              <a href="/admin/billing-v2" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 transition-colors">
                <span className="text-2xl">&#128176;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Billing V2</p>
                  <p className="text-xs text-gray-500">Accounts, deposits, packages, room charges</p>
                </div>
              </a>
              <a href="/admin/insurance-claims" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                <span className="text-2xl">&#128203;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Insurance Claims</p>
                  <p className="text-xs text-gray-500">Pre-auth, TPA, deductions, settlement</p>
                </div>
              </a>
              <a href="/admin/revenue-dashboard" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 transition-colors">
                <span className="text-2xl">&#128200;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Revenue Dashboard</p>
                  <p className="text-xs text-gray-500">Refunds, invoices, analytics, trends</p>
                </div>
              </a>
              <a href="/admin/pharmacy" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-green-200 transition-colors">
                <span className="text-2xl">&#128138;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Pharmacy</p>
                  <p className="text-xs text-gray-500">Dispensing, inventory, narcotics, POs</p>
                </div>
              </a>
              <a href="/admin/lab-radiology" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                <span className="text-2xl">&#129516;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Lab &amp; Radiology</p>
                  <p className="text-xs text-gray-500">Orders, results, specimens, imaging</p>
                </div>
              </a>
              <a href="/admin/ot-management" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                <span className="text-2xl">&#129657;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">OT Management</p>
                  <p className="text-xs text-gray-500">Scheduling, WHO checklist, anesthesia</p>
                </div>
              </a>
              <a href="/admin/emar" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                <span className="text-2xl">&#128137;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">eMAR</p>
                  <p className="text-xs text-gray-500">Medication administration, 5 Rights</p>
                </div>
              </a>
            </div>
          </div>

          {/* Integrations */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Integrations</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <a href="/admin/lsq-sync" className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                <span className="text-2xl">&#128279;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">LSQ Sync</p>
                  <p className="text-xs text-gray-500">LeadSquared CRM import</p>
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
              <p className="text-sm text-gray-600">Hole-plug sprint complete: package ceiling engine, PACS/OHIF stubs, eMAR 5-Rights, event sourcing. 118 tables, 311 routes, 48 pages.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
