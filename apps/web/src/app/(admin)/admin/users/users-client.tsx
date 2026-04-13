'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function UsersClient({ initialUsers, availableRoles, departments, currentUserId }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  // Group roles by category for display
  const roleGroups = availableRoles.reduce((acc, r) => {
    if (!acc[r.role_group]) acc[r.role_group] = [];
    acc[r.role_group].push(r);
    return acc;
  }, {} as Record<string, Role[]>);

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

  async function handleCreate(form: HTMLFormElement) {
    setLoading(true);
    setMessage(null);
    try {
      const fd = new FormData(form);
      const selectedRoles = Array.from(fd.getAll('roles')) as string[];
      await trpcMutate('users.create', {
        email: fd.get('email'),
        full_name: fd.get('full_name'),
        department: fd.get('department'),
        roles: selectedRoles,
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

  async function handleUpdate(form: HTMLFormElement) {
    if (!editingUser) return;
    setLoading(true);
    setMessage(null);
    try {
      const fd = new FormData(form);
      const selectedRoles = Array.from(fd.getAll('roles')) as string[];
      await trpcMutate('users.update', {
        id: editingUser.id,
        full_name: fd.get('full_name') as string,
        department: fd.get('department') as string,
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

  function formatDate(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      suspended: 'bg-red-100 text-red-700',
      deleted: 'bg-gray-100 text-gray-500',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || 'bg-gray-100'}`}>{status}</span>;
  }

  function roleBadge(role: string) {
    const groupColors: Record<string, string> = {
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
    const roleInfo = availableRoles.find(r => r.name === role);
    const color = roleInfo ? (groupColors[roleInfo.role_group] || 'bg-gray-100 text-gray-600') : 'bg-gray-100 text-gray-600';
    return <span key={role} className={`text-xs px-2 py-0.5 rounded font-medium ${color} mr-1 mb-1 inline-block`}>{role.replace(/_/g, ' ')}</span>;
  }

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
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
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
                    {u.must_change_password && (
                      <span className="ml-2 text-xs text-amber-600" title="Must change password">🔑</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{u.department}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-0.5">
                      {(u.roles || []).map(r => roleBadge(r))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusBadge(u.status)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.last_active_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-center">{u.login_count}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditingUser(u)} className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">Edit</button>
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
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">No users match your filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          Showing {filtered.length} of {users.length} users
        </div>
      </div>

      {/* Create User Modal */}
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
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-2">
                  {Object.entries(roleGroups).map(([group, groupRoles]) => (
                    <div key={group}>
                      <p className="text-xs text-gray-400 uppercase font-semibold mb-1">{group}</p>
                      {groupRoles.map(r => (
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

      {/* Edit User Modal */}
      {editingUser && (
        <Modal title={`Edit: ${editingUser.full_name}`} onClose={() => setEditingUser(null)}>
          <form onSubmit={e => { e.preventDefault(); handleUpdate(e.currentTarget); }}>
            <div className="space-y-4">
              <Field label="Full Name" name="full_name" type="text" required defaultValue={editingUser.full_name} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select name="department" required defaultValue={editingUser.department} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Roles</label>
                <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-2">
                  {Object.entries(roleGroups).map(([group, groupRoles]) => (
                    <div key={group}>
                      <p className="text-xs text-gray-400 uppercase font-semibold mb-1">{group}</p>
                      {groupRoles.map(r => (
                        <label key={r.name} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            name="roles"
                            value={r.name}
                            defaultChecked={editingUser.roles?.includes(r.name)}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm">{r.name.replace(/_/g, ' ')}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reset Password Modal */}
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
    </>
  );
}

// Reusable components
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
