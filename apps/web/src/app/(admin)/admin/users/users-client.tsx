'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── tRPC helpers ───────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Query failed');
  return json.result?.data?.json;
}

async function trpcMutate(procedure: string, data: any) {
  const res = await fetch(`/api/trpc/${procedure}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: data }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Operation failed');
  return json.result?.data?.json;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface User {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[] | null;
  status: string;
  last_active_at: string | null;
  login_count: number;
  must_change_password: boolean;
  created_at: string;
}

interface Role {
  name: string;
  description: string | null;
  role_group: string;
}

interface Props {
  initialUsers: User[];
  availableRoles: Role[];
  departments: string[];
  currentUserId: string;
}

interface RoleHistoryEntry {
  id: string;
  action: string;
  old_data: any;
  new_data: any;
  actor_email: string | null;
  reason: string | null;
  timestamp: string;
}

// ── Constants ──────────────────────────────────────────────────────────────
const GROUP_ORDER = ['system', 'admin', 'executive', 'clinical', 'nursing', 'pharmacy', 'lab', 'radiology', 'billing', 'support'];

const GROUP_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  executive: 'bg-blue-100 text-blue-700',
  clinical: 'bg-teal-100 text-teal-700',
  nursing: 'bg-pink-100 text-pink-700',
  pharmacy: 'bg-amber-100 text-amber-700',
  lab: 'bg-cyan-100 text-cyan-700',
  radiology: 'bg-indigo-100 text-indigo-700',
  billing: 'bg-orange-100 text-orange-700',
  support: 'bg-gray-100 text-gray-600',
  system: 'bg-red-100 text-red-700',
};

// Conflicting role groups — a user should not have roles from multiple of these
const CONFLICTING_GROUPS = [
  ['nursing', 'pharmacy'],
  ['nursing', 'lab'],
  ['nursing', 'radiology'],
  ['pharmacy', 'lab'],
];

function formatName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function UsersClient({ initialUsers, availableRoles, departments, currentUserId }: Props) {
  const router = useRouter();
  const [users] = useState<User[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Role picker state (for edit modal)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  // Role history
  const [historyUser, setHistoryUser] = useState<{ id: string; name: string } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<RoleHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Filtered users
  const filtered = users.filter(u => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (deptFilter !== 'all' && u.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    }
    return true;
  });

  // Group roles by category
  const roleGroups = availableRoles.reduce((acc, r) => {
    if (!acc[r.role_group]) acc[r.role_group] = [];
    acc[r.role_group].push(r);
    return acc;
  }, {} as Record<string, Role[]>);

  // ─ Conflict detection ─
  const getConflicts = useCallback((roleNames: string[]) => {
    const roleGroupMap = new Map(availableRoles.map(r => [r.name, r.role_group]));
    const activeGroups = new Set(roleNames.map(r => roleGroupMap.get(r)).filter(Boolean));
    const conflicts: string[] = [];
    for (const [g1, g2] of CONFLICTING_GROUPS) {
      if (activeGroups.has(g1) && activeGroups.has(g2)) {
        conflicts.push(`${g1} + ${g2}`);
      }
    }
    return conflicts;
  }, [availableRoles]);

  // ─ Role picker helpers ─
  const toggleRole = (roleName: string) => {
    setSelectedRoles(prev => {
      if (prev.includes(roleName)) {
        return prev.filter(r => r !== roleName);
      }
      return [...prev, roleName];
    });
  };

  const moveRoleUp = (index: number) => {
    if (index <= 0) return;
    setSelectedRoles(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveRoleDown = (index: number) => {
    setSelectedRoles(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  // ─ Handlers ─
  async function handleCreate(form: HTMLFormElement) {
    setLoading(true);
    setMessage(null);
    try {
      const fd = new FormData(form);
      const formRoles = Array.from(fd.getAll('roles')) as string[];
      await trpcMutate('users.create', {
        email: fd.get('email'),
        full_name: fd.get('full_name'),
        department: fd.get('department'),
        roles: formRoles,
        password: fd.get('password'),
      });
      setMessage({ type: 'success', text: 'User created successfully' });
      setShowCreate(false);
      router.refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate() {
    if (!editingUser) return;
    setLoading(true);
    setMessage(null);
    try {
      await trpcMutate('users.update', {
        id: editingUser.id,
        full_name: (document.getElementById('edit-full-name') as HTMLInputElement)?.value || editingUser.full_name,
        department: (document.getElementById('edit-department') as HTMLSelectElement)?.value || editingUser.department,
        roles: selectedRoles,
      });
      setMessage({ type: 'success', text: 'User updated' });
      setEditingUser(null);
      router.refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSuspend(userId: string) {
    if (!confirm('Suspend this user? They will lose access immediately.')) return;
    setLoading(true);
    try {
      await trpcMutate('users.suspend', { id: userId });
      setMessage({ type: 'success', text: 'User suspended' });
      router.refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate(userId: string) {
    setLoading(true);
    try {
      await trpcMutate('users.activate', { id: userId });
      setMessage({ type: 'success', text: 'User activated' });
      router.refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(form: HTMLFormElement) {
    if (!resetUser) return;
    setLoading(true);
    try {
      const fd = new FormData(form);
      await trpcMutate('users.resetPassword', {
        id: resetUser.id,
        new_password: fd.get('new_password') as string,
      });
      setMessage({ type: 'success', text: 'Password reset. User will be prompted to change on next login.' });
      setResetUser(null);
      router.refresh();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function openRoleHistory(userId: string, userName: string) {
    setHistoryUser({ id: userId, name: userName });
    setHistoryLoading(true);
    try {
      const result = await trpcQuery('users.roleHistory', { user_id: userId });
      setHistoryEntries(result.entries || []);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setHistoryLoading(false);
    }
  }

  function openEditUser(u: User) {
    setEditingUser(u);
    setSelectedRoles(u.roles || []);
  }

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      suspended: 'bg-red-100 text-red-700',
      deleted: 'bg-gray-100 text-gray-500',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || 'bg-gray-100'}`}>{status}</span>;
  }

  function roleBadge(role: string, isPrimary: boolean = false) {
    const roleInfo = availableRoles.find(r => r.name === role);
    const color = roleInfo ? (GROUP_COLORS[roleInfo.role_group] || 'bg-gray-100 text-gray-600') : 'bg-gray-100 text-gray-600';
    return (
      <span key={role} className={`text-xs px-2 py-0.5 rounded font-medium ${color} mr-1 mb-1 inline-block`}>
        {isPrimary && <span className="mr-0.5" title="Primary role (used for JWT)">★</span>}
        {role.replace(/_/g, ' ')}
      </span>
    );
  }

  const conflicts = getConflicts(selectedRoles);

  return (
    <>
      {/* Message */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.text}
          <button className="float-right font-bold" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            + Add User
          </button>
          <a href="/admin/roles" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            Manage Roles
          </a>
        </div>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Department</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Roles</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Last Active</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Logins</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">{u.full_name}</span>
                    {u.must_change_password && <span className="ml-2 text-xs text-amber-600" title="Must change password">🔑</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{u.department}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-0.5">
                      {(u.roles || []).map((r, i) => roleBadge(r, i === 0))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusBadge(u.status)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.last_active_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-center">{u.login_count}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEditUser(u)} className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">Edit</button>
                      <button onClick={() => openRoleHistory(u.id, u.full_name)} className="px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded">History</button>
                      <button onClick={() => setResetUser(u)} className="px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded">Reset PW</button>
                      {u.id !== currentUserId && (
                        u.status === 'active'
                          ? <button onClick={() => handleSuspend(u.id)} className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">Suspend</button>
                          : <button onClick={() => handleActivate(u.id)} className="px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded">Activate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No users match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          Showing {filtered.length} of {users.length} users
        </div>
      </div>

      {/* ── Create User Modal ──────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="Add New User" onClose={() => setShowCreate(false)}>
          <form onSubmit={e => { e.preventDefault(); handleCreate(e.currentTarget); }}>
            <div className="space-y-4">
              <Field label="Full Name" name="full_name" type="text" required />
              <Field label="Email" name="email" type="email" required />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select name="department" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Select...</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  <option value="__new">+ New department</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Roles</label>
                <p className="text-xs text-gray-400 mb-1">First selected role = primary role (used for login session).</p>
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-2">
                  {GROUP_ORDER.filter(g => roleGroups[g]).map(group => (
                    <div key={group}>
                      <p className="text-xs text-gray-400 uppercase font-semibold mb-1">{group}</p>
                      {roleGroups[group].map(r => (
                        <label key={r.name} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                          <input type="checkbox" name="roles" value={r.name} className="rounded border-gray-300" />
                          <span className="text-sm">{r.name.replace(/_/g, ' ')}</span>
                          {r.description && <span className="text-xs text-gray-400">— {r.description}</span>}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <Field label="Temporary Password" name="password" type="password" required minLength={8} placeholder="Min 8 characters" />
              <p className="text-xs text-gray-400">User will be required to change this on first login.</p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit User Modal (improved role picker) ─────────────────────── */}
      {editingUser && (
        <Modal title={`Edit: ${editingUser.full_name}`} onClose={() => setEditingUser(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input id="edit-full-name" type="text" defaultValue={editingUser.full_name} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <select id="edit-department" required defaultValue={editingUser.department} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Assigned Roles — ordered, with primary indicator */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Roles</label>
              <p className="text-xs text-gray-400 mb-2">First role = primary (drives JWT session). Drag or use arrows to reorder.</p>

              {selectedRoles.length === 0 ? (
                <p className="text-sm text-gray-400 p-2 border border-dashed border-gray-300 rounded-lg">No roles assigned. Select from below.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-2">
                  {selectedRoles.map((roleName, index) => {
                    const roleInfo = availableRoles.find(r => r.name === roleName);
                    const groupColor = roleInfo ? (GROUP_COLORS[roleInfo.role_group] || 'bg-gray-100 text-gray-600') : 'bg-gray-100 text-gray-600';
                    return (
                      <div key={roleName} className={`flex items-center gap-2 px-3 py-2 ${index === 0 ? 'bg-blue-50' : ''}`}>
                        <div className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => moveRoleUp(index)} disabled={index === 0} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-20">▲</button>
                          <button type="button" onClick={() => moveRoleDown(index)} disabled={index === selectedRoles.length - 1} className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-20">▼</button>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${groupColor}`}>
                          {formatName(roleName)}
                        </span>
                        {index === 0 && <span className="text-xs px-1.5 py-0.5 bg-blue-200 text-blue-800 rounded font-medium">★ Primary</span>}
                        {roleInfo?.description && <span className="text-xs text-gray-400 truncate">{roleInfo.description}</span>}
                        <button type="button" onClick={() => toggleRole(roleName)} className="ml-auto text-xs text-red-400 hover:text-red-600">&times;</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Conflict warning */}
              {conflicts.length > 0 && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-2">
                  ⚠️ Potentially conflicting role groups: {conflicts.join(', ')}. Verify this user needs roles in both groups.
                </div>
              )}
            </div>

            {/* Role browser — grouped checkboxes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Available Roles</label>
              <div className="max-h-52 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-2">
                {GROUP_ORDER.filter(g => roleGroups[g]).map(group => (
                  <div key={group}>
                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">{group}</p>
                    {roleGroups[group].map(r => {
                      const isSelected = selectedRoles.includes(r.name);
                      return (
                        <label key={r.name} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRole(r.name)}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm">{r.name.replace(/_/g, ' ')}</span>
                          {r.description && <span className="text-xs text-gray-400 truncate">— {r.description}</span>}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button
              type="button"
              onClick={handleUpdate}
              disabled={loading || selectedRoles.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Reset Password Modal ───────────────────────────────────────── */}
      {resetUser && (
        <Modal title={`Reset Password: ${resetUser.full_name}`} onClose={() => setResetUser(null)}>
          <form onSubmit={e => { e.preventDefault(); handleResetPassword(e.currentTarget); }}>
            <p className="text-sm text-gray-600 mb-4">
              Set a new temporary password for <strong>{resetUser.email}</strong>.
              They will be required to change it on next login.
            </p>
            <Field label="New Temporary Password" name="new_password" type="password" required minLength={8} placeholder="Min 8 characters" />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setResetUser(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={loading} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Role History Modal ──────────────────────────────────────────── */}
      {historyUser && (
        <Modal title={`Role History: ${historyUser.name}`} onClose={() => setHistoryUser(null)}>
          {historyLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading history...</p>
          ) : historyEntries.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No role changes recorded for this user.</p>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {historyEntries.map(entry => {
                const newData = entry.new_data || {};
                const oldData = entry.old_data || {};
                return (
                  <div key={entry.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">{formatDate(entry.timestamp)}</span>
                      <span className="text-xs text-gray-400">by {entry.actor_email || 'system'}</span>
                    </div>
                    {entry.reason && <p className="text-sm text-gray-700 mb-2">{entry.reason}</p>}
                    <div className="flex flex-wrap gap-2">
                      {(newData.added || []).map((r: string) => (
                        <span key={`+${r}`} className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">+ {formatName(r)}</span>
                      ))}
                      {(newData.removed || []).map((r: string) => (
                        <span key={`-${r}`} className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded">- {formatName(r)}</span>
                      ))}
                      {newData.primary_changed && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                          ★ Primary: {formatName(oldData.primary_role || 'none')} → {formatName(newData.primary_role || 'none')}
                        </span>
                      )}
                    </div>
                    {newData.roles && (
                      <p className="text-xs text-gray-400 mt-1">Result: {newData.roles.map((r: string) => formatName(r)).join(', ')}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// ── Reusable components ────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input {...props} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
    </div>
  );
}
