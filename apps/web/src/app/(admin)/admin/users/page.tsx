import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users, roles } from '@db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import UsersClient from './users-client';

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const adminRoles = ['super_admin', 'hospital_admin'];
  if (!adminRoles.includes(user.role)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-sm border">
          <h2 className="text-xl font-bold text-red-700">Access Denied</h2>
          <p className="text-gray-500 mt-2">You need admin permissions to view this page.</p>
          <p className="text-sm text-gray-400 mt-1">Your role: {user.role}</p>
        </div>
      </div>
    );
  }

  // Fetch users for this hospital
  const userRows = await db.select({
    id: users.id,
    email: users.email,
    full_name: users.full_name,
    department: users.department,
    roles: users.roles,
    status: users.status,
    last_active_at: users.last_active_at,
    login_count: users.login_count,
    must_change_password: users.must_change_password,
    created_at: users.created_at,
  })
    .from(users)
    .where(eq(users.hospital_id, user.hospital_id))
    .orderBy(desc(users.last_active_at));

  // Fetch available roles
  const roleRows = await db.select({
    name: roles.name,
    description: roles.description,
    role_group: roles.role_group,
  })
    .from(roles)
    .where(and(
      eq(roles.hospital_id, user.hospital_id),
      eq(roles.is_active, true),
    ));

  // Fetch departments
  const deptRows = await db.selectDistinct({ department: users.department })
    .from(users)
    .where(eq(users.hospital_id, user.hospital_id));

  const departments = deptRows.map(d => d.department).filter(Boolean).sort();

  // Stats
  const stats = {
    total: userRows.length,
    active: userRows.filter(u => u.status === 'active').length,
    suspended: userRows.filter(u => u.status === 'suspended').length,
    needsPasswordChange: userRows.filter(u => u.must_change_password).length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">User Management</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-blue-100">{user.name} ({user.role})</span>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Users</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
            <p className="text-xs text-green-600 uppercase tracking-wide">Active</p>
            <p className="text-3xl font-bold text-green-700 mt-1">{stats.active}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-red-200 shadow-sm">
            <p className="text-xs text-red-600 uppercase tracking-wide">Suspended</p>
            <p className="text-3xl font-bold text-red-700 mt-1">{stats.suspended}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-amber-200 shadow-sm">
            <p className="text-xs text-amber-600 uppercase tracking-wide">Needs Password</p>
            <p className="text-3xl font-bold text-amber-700 mt-1">{stats.needsPasswordChange}</p>
          </div>
        </div>

        <UsersClient
          initialUsers={JSON.parse(JSON.stringify(userRows))}
          availableRoles={roleRows}
          departments={departments as string[]}
          currentUserId={user.sub}
        />
      </main>
    </div>
  );
}
