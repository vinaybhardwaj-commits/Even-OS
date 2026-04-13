import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ComplianceClient from './compliance-client';

export default async function CompliancePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'super_admin') redirect('/dashboard');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Compliance Tracker</h1>
        </div>
        <span className="text-sm text-blue-100">{user.name}</span>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <ComplianceClient />
      </main>
    </div>
  );
}
