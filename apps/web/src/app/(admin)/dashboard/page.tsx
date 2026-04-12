import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <h1 className="text-xl font-bold">Even OS</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-blue-100">{user.name} ({user.role})</span>
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
          <p className="text-gray-500 mb-6">Sprint S0 scaffold complete. Dashboard modules will be added in subsequent sprints.</p>

          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-6 border border-blue-100">
              <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">Role</p>
              <p className="text-2xl font-bold text-blue-900 mt-2">{user.role}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-6 border border-green-100">
              <p className="text-xs text-green-600 font-semibold uppercase tracking-wide">Hospital</p>
              <p className="text-2xl font-bold text-green-900 mt-2">{user.hospital_id.slice(0, 8)}...</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-6 border border-purple-100">
              <p className="text-xs text-purple-600 font-semibold uppercase tracking-wide">Department</p>
              <p className="text-2xl font-bold text-purple-900 mt-2">{user.department || 'System'}</p>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">System Status</h3>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <p className="text-sm text-gray-600">Application ready. Build in progress.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
