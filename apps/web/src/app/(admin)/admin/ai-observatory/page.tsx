import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AIObservatoryClient } from './ai-observatory-client';

export default async function AIObservatoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-violet-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/admin" className="text-violet-200 hover:text-white text-sm">&larr; Admin</a>
          <h1 className="text-xl font-bold">AI Observatory</h1>
        </div>
        <span className="text-sm text-violet-100">{user.name}</span>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <AIObservatoryClient />
      </main>
    </div>
  );
}
