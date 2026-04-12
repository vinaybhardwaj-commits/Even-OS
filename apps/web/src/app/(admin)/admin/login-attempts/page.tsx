import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb } from '@even-os/db';
import { loginAttempts } from '@db/schema';
import { eq, desc } from 'drizzle-orm';
import LoginAttemptsClient from './login-attempts-client';

export default async function LoginAttemptsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!['super_admin', 'hospital_admin'].includes(user.role)) redirect('/dashboard');

  const db = getDb();
  const attempts = await db.select()
    .from(loginAttempts)
    .where(eq(loginAttempts.hospital_id, user.hospital_id))
    .orderBy(desc(loginAttempts.attempted_at))
    .limit(200);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Login Attempts</h1>
        </div>
        <span className="text-sm text-blue-100">{user.name}</span>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        <LoginAttemptsClient attempts={JSON.parse(JSON.stringify(attempts))} />
      </main>
    </div>
  );
}
