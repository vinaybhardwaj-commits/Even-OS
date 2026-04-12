import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb } from '@even-os/db';
import { users, trustedDevices, loginAttempts } from '@db/schema';
import { eq, and, desc } from 'drizzle-orm';
import ProfileClient from './profile-client';

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = getDb();

  // Get full user profile
  const [profile] = await db.select()
    .from(users)
    .where(eq(users.id, user.sub))
    .limit(1);

  if (!profile) redirect('/login');

  // Get trusted devices
  const devices = await db.select()
    .from(trustedDevices)
    .where(and(
      eq(trustedDevices.user_id, user.sub),
      eq(trustedDevices.is_active, true),
    ))
    .orderBy(desc(trustedDevices.last_seen_at));

  // Get recent login activity
  const recentLogins = await db.select()
    .from(loginAttempts)
    .where(eq(loginAttempts.email, user.email))
    .orderBy(desc(loginAttempts.attempted_at))
    .limit(20);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">My Profile</h1>
        </div>
        <span className="text-sm text-blue-100">{user.name}</span>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        <ProfileClient
          profile={JSON.parse(JSON.stringify({
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            department: profile.department,
            roles: profile.roles,
            status: profile.status,
            login_count: profile.login_count,
            first_login_at: profile.first_login_at,
            last_active_at: profile.last_active_at,
            created_at: profile.created_at,
          }))}
          devices={JSON.parse(JSON.stringify(devices))}
          recentLogins={JSON.parse(JSON.stringify(recentLogins))}
        />
      </main>
    </div>
  );
}
