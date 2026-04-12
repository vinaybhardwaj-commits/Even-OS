import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getDb } from '@even-os/db';
import { roles, rolePermissions, permissions } from '@db/schema';
import { eq, and, sql, count } from 'drizzle-orm';

export default async function AdminRolesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const adminRoles = ['super_admin', 'hospital_admin'];
  if (!adminRoles.includes(user.role)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-sm border">
          <h2 className="text-xl font-bold text-red-700">Access Denied</h2>
          <p className="text-gray-500 mt-2">Admin permissions required.</p>
        </div>
      </div>
    );
  }

  const db = getDb();

  // Fetch roles with permission counts
  const roleRows = await db.select({
    id: roles.id,
    name: roles.name,
    description: roles.description,
    role_group: roles.role_group,
    session_timeout_minutes: roles.session_timeout_minutes,
    is_active: roles.is_active,
    is_system_role: roles.is_system_role,
  })
    .from(roles)
    .where(eq(roles.hospital_id, user.hospital_id));

  // Get permission counts per role
  const permCounts = await db.select({
    role_id: rolePermissions.role_id,
    count: sql<number>`count(*)`,
  })
    .from(rolePermissions)
    .groupBy(rolePermissions.role_id);

  const countMap = new Map(permCounts.map(pc => [pc.role_id, Number(pc.count)]));

  // Fetch all permissions
  const allPerms = await db.select({
    id: permissions.id,
    resource: permissions.resource,
    action: permissions.action,
  }).from(permissions);

  // Get all role_permission mappings
  const allMappings = await db.select({
    role_id: rolePermissions.role_id,
    permission_id: rolePermissions.permission_id,
  }).from(rolePermissions);

  // Group roles by role_group
  const groups: Record<string, typeof roleRows> = {};
  for (const role of roleRows) {
    const g = role.role_group;
    if (!groups[g]) groups[g] = [];
    groups[g].push(role);
  }

  const groupOrder = ['system', 'admin', 'executive', 'clinical', 'nursing', 'pharmacy', 'lab', 'radiology', 'billing', 'support'];
  const groupColors: Record<string, string> = {
    system: 'border-red-200 bg-red-50',
    admin: 'border-purple-200 bg-purple-50',
    executive: 'border-blue-200 bg-blue-50',
    clinical: 'border-teal-200 bg-teal-50',
    nursing: 'border-pink-200 bg-pink-50',
    pharmacy: 'border-amber-200 bg-amber-50',
    lab: 'border-cyan-200 bg-cyan-50',
    radiology: 'border-indigo-200 bg-indigo-50',
    billing: 'border-orange-200 bg-orange-50',
    support: 'border-gray-200 bg-gray-50',
  };

  // Build permission mapping for display
  const mappingSet = new Set(allMappings.map(m => `${m.role_id}:${m.permission_id}`));

  // Group permissions by resource
  const permByResource: Record<string, { id: string; action: string }[]> = {};
  for (const p of allPerms) {
    if (!permByResource[p.resource]) permByResource[p.resource] = [];
    permByResource[p.resource].push({ id: p.id, action: p.action });
  }
  const resourceOrder = Object.keys(permByResource).sort();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Roles &amp; Permissions</h1>
        </div>
        <div className="flex items-center gap-4">
          <a href="/admin/users" className="text-blue-200 hover:text-white text-sm">Users &rarr;</a>
          <span className="text-sm text-blue-100">{user.name}</span>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Roles</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{roleRows.length}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Permissions</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{allPerms.length}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Mappings</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{allMappings.length}</p>
          </div>
        </div>

        {/* Role cards by group */}
        <div className="space-y-6 mb-8">
          {groupOrder.filter(g => groups[g]).map(group => (
            <div key={group}>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{group} Roles</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {groups[group].map(role => (
                  <div key={role.id} className={`rounded-lg border p-4 ${groupColors[group] || 'bg-white border-gray-200'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-800">{role.name.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-gray-700">{countMap.get(role.id) || 0}</p>
                        <p className="text-xs text-gray-400">perms</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <span>Timeout: {role.session_timeout_minutes}m</span>
                      {role.is_system_role && <span className="px-1.5 py-0.5 bg-white/50 rounded text-red-600 font-medium">system</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Permission Matrix */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-800">Permission Matrix</h2>
            <p className="text-xs text-gray-500 mt-1">Rows = resources, columns = roles. Green = granted.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-100 z-10 min-w-[160px]">Resource.Action</th>
                  {roleRows.map(r => (
                    <th key={r.id} className="px-1 py-2 text-center font-medium text-gray-500 min-w-[28px]" title={r.name}>
                      <span className="writing-mode-vertical" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', display: 'inline-block', maxHeight: '100px', overflow: 'hidden' }}>
                        {r.name.replace(/_/g, ' ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {resourceOrder.map(resource => (
                  permByResource[resource].map((perm, i) => (
                    <tr key={`${resource}.${perm.action}`} className="hover:bg-gray-50">
                      <td className="px-3 py-1 text-gray-700 sticky left-0 bg-white z-10 border-r border-gray-100">
                        {i === 0 && <span className="font-semibold text-gray-800">{resource}</span>}
                        {i === 0 ? '.' : <span className="text-gray-300 ml-[1ch]">.</span>}
                        <span className="text-gray-600">{perm.action}</span>
                      </td>
                      {roleRows.map(role => {
                        const has = mappingSet.has(`${role.id}:${perm.id}`);
                        return (
                          <td key={role.id} className="px-1 py-1 text-center">
                            {has
                              ? <span className="inline-block w-4 h-4 rounded-sm bg-green-500" title="Granted"></span>
                              : <span className="inline-block w-4 h-4 rounded-sm bg-gray-100" title="Not granted"></span>
                            }
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
