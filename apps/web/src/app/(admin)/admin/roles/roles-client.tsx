'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── tRPC helpers (same pattern as drug-master, users) ──────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Query failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Mutation failed');
  return json.result?.data?.json;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Role {
  id: string;
  name: string;
  description: string | null;
  role_group: string;
  session_timeout_minutes: number;
  is_active: boolean;
  is_system_role: boolean;
  permission_count: number;
  user_count: number;
}

interface RoleDetail extends Role {
  permissions: { id: string; resource: string; action: string }[];
  assigned_users: { id: string; full_name: string; email: string }[];
  created_at: string;
  updated_at: string;
}

interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

interface PermissionGroup {
  resource: string;
  permissions: Permission[];
}

interface Template {
  key: string;
  name: string;
  description: string;
  role_group: string;
  permissions: string[];
}

interface Stats {
  total_roles: number;
  active_roles: number;
  total_permissions: number;
  total_mappings: number;
  roles_by_group: { role_group: string; count: number }[];
}

// ── Constants ──────────────────────────────────────────────────────────────
const GROUP_ORDER = ['system', 'admin', 'executive', 'clinical', 'nursing', 'pharmacy', 'lab', 'radiology', 'billing', 'support'];

const GROUP_COLORS: Record<string, { border: string; bg: string; badge: string; text: string }> = {
  system:    { border: 'border-red-200',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',    text: 'text-red-700' },
  admin:     { border: 'border-purple-200', bg: 'bg-purple-50', badge: 'bg-purple-100 text-purple-700', text: 'text-purple-700' },
  executive: { border: 'border-blue-200',   bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   text: 'text-blue-700' },
  clinical:  { border: 'border-teal-200',   bg: 'bg-teal-50',   badge: 'bg-teal-100 text-teal-700',   text: 'text-teal-700' },
  nursing:   { border: 'border-pink-200',   bg: 'bg-pink-50',   badge: 'bg-pink-100 text-pink-700',   text: 'text-pink-700' },
  pharmacy:  { border: 'border-amber-200',  bg: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700',  text: 'text-amber-700' },
  lab:       { border: 'border-cyan-200',   bg: 'bg-cyan-50',   badge: 'bg-cyan-100 text-cyan-700',   text: 'text-cyan-700' },
  radiology: { border: 'border-indigo-200', bg: 'bg-indigo-50', badge: 'bg-indigo-100 text-indigo-700', text: 'text-indigo-700' },
  billing:   { border: 'border-orange-200', bg: 'bg-orange-50', badge: 'bg-orange-100 text-orange-700', text: 'text-orange-700' },
  support:   { border: 'border-gray-200',   bg: 'bg-gray-100',  badge: 'bg-gray-200 text-gray-700',   text: 'text-gray-700' },
};

function getGroupStyle(group: string) {
  return GROUP_COLORS[group] || GROUP_COLORS.support;
}

function formatRoleName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function RolesClient() {
  // ─ State ─
  const [roles, setRoles] = useState<Role[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Detail panel
  const [selectedRole, setSelectedRole] = useState<RoleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create/Edit modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDetail | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', description: '', role_group: 'support', session_timeout_minutes: 480 });

  // Template browser
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  // Clone modal
  const [cloneTarget, setCloneTarget] = useState<Role | null>(null);
  const [cloneName, setCloneName] = useState('');

  const searchTimeout = useRef<NodeJS.Timeout>();

  // ─ Data Fetching ─
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listData, statsData, templateData] = await Promise.all([
        trpcQuery('roles.list', {}),
        trpcQuery('roles.stats'),
        trpcQuery('roles.templates'),
      ]);
      setRoles(listData);
      setStats(statsData);
      setTemplates(templateData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchRoleDetail = async (roleId: string) => {
    setDetailLoading(true);
    try {
      const detail = await trpcQuery('roles.get', { id: roleId });
      setSelectedRole(detail);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  // ─ Filtered roles ─
  const filteredRoles = roles.filter(r => {
    if (groupFilter !== 'all' && r.role_group !== groupFilter) return false;
    if (statusFilter === 'active' && !r.is_active) return false;
    if (statusFilter === 'inactive' && r.is_active) return false;
    if (statusFilter === 'system' && !r.is_system_role) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Group filtered roles
  const groupedRoles: Record<string, Role[]> = {};
  for (const r of filteredRoles) {
    if (!groupedRoles[r.role_group]) groupedRoles[r.role_group] = [];
    groupedRoles[r.role_group].push(r);
  }

  // ─ Handlers ─
  const handleSearch = (val: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(val), 200);
  };

  const handleCreate = async () => {
    setError(''); setSuccess('');
    try {
      if (editingRole) {
        await trpcMutate('roles.update', {
          id: editingRole.id,
          description: createForm.description,
          session_timeout_minutes: createForm.session_timeout_minutes,
          role_group: createForm.role_group,
        });
        setSuccess(`Role "${formatRoleName(editingRole.name)}" updated`);
      } else {
        await trpcMutate('roles.create', createForm);
        setSuccess(`Role "${formatRoleName(createForm.name)}" created`);
      }
      setShowCreateModal(false);
      setEditingRole(null);
      setCreateForm({ name: '', description: '', role_group: 'support', session_timeout_minutes: 480 });
      fetchData();
      if (selectedRole && editingRole?.id === selectedRole.id) {
        fetchRoleDetail(selectedRole.id);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setError(''); setSuccess('');
    try {
      await trpcMutate('roles.delete', { id: deleteTarget.id, force: deleteTarget.user_count > 0 });
      setSuccess(`Role "${formatRoleName(deleteTarget.name)}" deleted`);
      setDeleteTarget(null);
      if (selectedRole?.id === deleteTarget.id) setSelectedRole(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleClone = async () => {
    if (!cloneTarget || !cloneName.trim()) return;
    setError(''); setSuccess('');
    try {
      await trpcMutate('roles.clone', { source_role_id: cloneTarget.id, new_name: cloneName.trim() });
      setSuccess(`Role cloned as "${formatRoleName(cloneName.trim())}"`);
      setCloneTarget(null);
      setCloneName('');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleActive = async (role: Role) => {
    setError(''); setSuccess('');
    try {
      await trpcMutate('roles.toggleActive', { id: role.id });
      setSuccess(`Role "${formatRoleName(role.name)}" ${role.is_active ? 'deactivated' : 'activated'}`);
      fetchData();
      if (selectedRole?.id === role.id) fetchRoleDetail(role.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateFromTemplate = async (templateKey: string) => {
    setError(''); setSuccess('');
    try {
      const result = await trpcMutate('roles.createFromTemplate', { template_key: templateKey });
      setSuccess(`Role "${formatRoleName(result.name)}" created from template with ${result.permissions_set} permissions`);
      setShowTemplateModal(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openEdit = (role: RoleDetail) => {
    setEditingRole(role);
    setCreateForm({
      name: role.name,
      description: role.description || '',
      role_group: role.role_group,
      session_timeout_minutes: role.session_timeout_minutes,
    });
    setShowCreateModal(true);
  };

  // ─ Render ─
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-blue-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Roles &amp; Permissions</h1>
          {stats && (
            <span className="text-blue-200 text-sm ml-2">
              {stats.total_roles} roles &middot; {stats.total_permissions} permissions &middot; {stats.total_mappings} mappings
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTemplateModal(true)}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium transition-colors"
          >
            Templates
          </button>
          <button
            onClick={() => { setEditingRole(null); setCreateForm({ name: '', description: '', role_group: 'support', session_timeout_minutes: 480 }); setShowCreateModal(true); }}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-medium transition-colors"
          >
            + New Role
          </button>
          <a href="/admin/users" className="text-blue-200 hover:text-white text-sm">Users &rarr;</a>
        </div>
      </header>

      {/* Alerts */}
      <div className="max-w-7xl mx-auto px-6 mt-4">
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">&times;</button>
          </div>
        )}
        {success && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex justify-between items-center">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600 ml-3">&times;</button>
          </div>
        )}
      </div>

      <main className="max-w-7xl mx-auto px-6 pb-8">
        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 mt-2">
            <div className="bg-white rounded-lg p-3 border shadow-sm">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Roles</p>
              <p className="text-2xl font-bold text-gray-800">{stats.total_roles}</p>
              <p className="text-xs text-gray-400 mt-0.5">{stats.active_roles} active</p>
            </div>
            <div className="bg-white rounded-lg p-3 border shadow-sm">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Permissions</p>
              <p className="text-2xl font-bold text-gray-800">{stats.total_permissions}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border shadow-sm">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Mappings</p>
              <p className="text-2xl font-bold text-gray-800">{stats.total_mappings}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border shadow-sm">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Role Groups</p>
              <p className="text-2xl font-bold text-gray-800">{stats.roles_by_group.length}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg border shadow-sm p-4 mb-5">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="text"
              placeholder="Search roles..."
              onChange={e => handleSearch(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="all">All Groups</option>
              {GROUP_ORDER.map(g => (
                <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="system">System Roles</option>
            </select>
            <span className="text-sm text-gray-400 ml-auto">{filteredRoles.length} roles shown</span>
          </div>
        </div>

        {/* Content: Role Cards + Detail Panel */}
        <div className="flex gap-5">
          {/* Left: Role Cards */}
          <div className={`${selectedRole ? 'w-1/2' : 'w-full'} transition-all`}>
            {loading ? (
              <div className="bg-white rounded-lg border p-12 text-center text-gray-400">Loading roles...</div>
            ) : filteredRoles.length === 0 ? (
              <div className="bg-white rounded-lg border p-12 text-center text-gray-400">
                No roles match your search. Try adjusting filters.
              </div>
            ) : (
              <div className="space-y-5">
                {GROUP_ORDER.filter(g => groupedRoles[g]).map(group => {
                  const style = getGroupStyle(group);
                  return (
                    <div key={group}>
                      <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.badge.split(' ')[0]}`}></span>
                        {group} ({groupedRoles[group].length})
                      </h2>
                      <div className={`grid ${selectedRole ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'} gap-3`}>
                        {groupedRoles[group].map(role => (
                          <div
                            key={role.id}
                            onClick={() => fetchRoleDetail(role.id)}
                            className={`rounded-lg border p-4 cursor-pointer transition-all hover:shadow-md ${style.border} ${style.bg} ${selectedRole?.id === role.id ? 'ring-2 ring-blue-400 shadow-md' : ''} ${!role.is_active ? 'opacity-50' : ''}`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-800 truncate">{formatRoleName(role.name)}</p>
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{role.description || 'No description'}</p>
                              </div>
                              <div className="text-right flex-shrink-0 ml-2">
                                <p className="text-lg font-bold text-gray-700">{role.permission_count}</p>
                                <p className="text-xs text-gray-400">perms</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
                              <span className="px-1.5 py-0.5 bg-white/60 rounded">{role.session_timeout_minutes}m timeout</span>
                              <span className="px-1.5 py-0.5 bg-white/60 rounded">{role.user_count} users</span>
                              {role.is_system_role && <span className="px-1.5 py-0.5 bg-white/50 rounded text-red-600 font-medium">system</span>}
                              {!role.is_active && <span className="px-1.5 py-0.5 bg-white/50 rounded text-gray-500 font-medium">inactive</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Detail Panel */}
          {selectedRole && (
            <div className="w-1/2 sticky top-4 self-start">
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                {/* Detail Header */}
                <div className={`px-5 py-4 border-b ${getGroupStyle(selectedRole.role_group).bg}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">{formatRoleName(selectedRole.name)}</h3>
                      <p className="text-sm text-gray-600 mt-0.5">{selectedRole.description || 'No description'}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getGroupStyle(selectedRole.role_group).badge}`}>
                          {selectedRole.role_group}
                        </span>
                        {selectedRole.is_system_role && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">system</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedRole.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                          {selectedRole.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => setSelectedRole(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
                  </div>
                </div>

                {detailLoading ? (
                  <div className="p-8 text-center text-gray-400">Loading details...</div>
                ) : (
                  <>
                    {/* Action Buttons */}
                    <div className="px-5 py-3 border-b bg-gray-50 flex flex-wrap gap-2">
                      {!selectedRole.is_system_role && (
                        <>
                          <button
                            onClick={() => openEdit(selectedRole)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleActive(selectedRole)}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${selectedRole.is_active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                          >
                            {selectedRole.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => { setCloneTarget(selectedRole); setCloneName(selectedRole.name + '_copy'); }}
                        className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded text-xs font-medium hover:bg-purple-200 transition-colors"
                      >
                        Clone
                      </button>
                      {!selectedRole.is_system_role && (
                        <button
                          onClick={() => setDeleteTarget(selectedRole)}
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="px-5 py-3 border-b grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Permissions</p>
                        <p className="text-xl font-bold text-gray-800">{selectedRole.permissions.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Users</p>
                        <p className="text-xl font-bold text-gray-800">{selectedRole.assigned_users.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase">Timeout</p>
                        <p className="text-xl font-bold text-gray-800">{selectedRole.session_timeout_minutes}m</p>
                      </div>
                    </div>

                    {/* Permissions grouped by resource */}
                    <div className="px-5 py-3 border-b max-h-64 overflow-y-auto">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Permissions ({selectedRole.permissions.length})</h4>
                      {selectedRole.permissions.length === 0 ? (
                        <p className="text-sm text-gray-400">No permissions assigned</p>
                      ) : (
                        (() => {
                          const byResource: Record<string, string[]> = {};
                          for (const p of selectedRole.permissions) {
                            if (!byResource[p.resource]) byResource[p.resource] = [];
                            byResource[p.resource].push(p.action);
                          }
                          return Object.entries(byResource).sort(([a], [b]) => a.localeCompare(b)).map(([resource, actions]) => (
                            <div key={resource} className="mb-2">
                              <p className="text-xs font-semibold text-gray-700">{resource}</p>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {actions.sort().map(action => (
                                  <span key={action} className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                                    {action}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ));
                        })()
                      )}
                    </div>

                    {/* Assigned Users */}
                    <div className="px-5 py-3 max-h-48 overflow-y-auto">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Assigned Users ({selectedRole.assigned_users.length})
                      </h4>
                      {selectedRole.assigned_users.length === 0 ? (
                        <p className="text-sm text-gray-400">No users have this role</p>
                      ) : (
                        <div className="space-y-1">
                          {selectedRole.assigned_users.map(u => (
                            <div key={u.id} className="flex items-center gap-2 text-sm">
                              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-medium">
                                {(u.full_name || u.email)[0].toUpperCase()}
                              </span>
                              <span className="text-gray-700">{u.full_name || u.email}</span>
                              <span className="text-xs text-gray-400">{u.email}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Create/Edit Modal ────────────────────────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 m-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">{editingRole ? 'Edit Role' : 'Create Role'}</h3>

            <div className="space-y-3">
              {!editingRole && (
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Role Name (snake_case)</label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={e => setCreateForm({ ...createForm, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                    placeholder="e.g. senior_pharmacist"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Description</label>
                <textarea
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="What this role is responsible for"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Role Group</label>
                  <select
                    value={createForm.role_group}
                    onChange={e => setCreateForm({ ...createForm, role_group: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  >
                    {GROUP_ORDER.map(g => (
                      <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Session Timeout (min)</label>
                  <input
                    type="number"
                    value={createForm.session_timeout_minutes}
                    onChange={e => setCreateForm({ ...createForm, session_timeout_minutes: parseInt(e.target.value) || 480 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setShowCreateModal(false); setEditingRole(null); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!editingRole && !createForm.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {editingRole ? 'Save Changes' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template Browser Modal ───────────────────────────────────────── */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTemplateModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 m-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Role Templates</h3>
            <p className="text-sm text-gray-500 mb-4">Pre-configured roles with permissions. Click to create.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map(t => {
                const style = getGroupStyle(t.role_group);
                return (
                  <div key={t.key} className={`rounded-lg border p-4 ${style.border} ${style.bg} hover:shadow-md transition-shadow`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-800">{t.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${style.badge}`}>{t.role_group}</span>
                          <span className="text-xs text-gray-400">{t.permissions.length} permissions</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCreateFromTemplate(t.key)}
                      className="mt-3 w-full px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors"
                    >
                      Create from Template
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => setShowTemplateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 m-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-red-700 mb-2">Delete Role</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to delete <strong>{formatRoleName(deleteTarget.name)}</strong>?
            </p>
            {deleteTarget.user_count > 0 && (
              <p className="text-sm text-amber-600 mt-2 p-2 bg-amber-50 border border-amber-200 rounded">
                Warning: {deleteTarget.user_count} user(s) currently have this role assigned. They will lose this role.
              </p>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">
                Delete Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clone Modal ──────────────────────────────────────────────────── */}
      {cloneTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCloneTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 m-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Clone Role</h3>
            <p className="text-sm text-gray-500 mb-3">
              Clone <strong>{formatRoleName(cloneTarget.name)}</strong> with all {cloneTarget.permission_count} permissions.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">New Role Name (snake_case)</label>
              <input
                type="text"
                value={cloneName}
                onChange={e => setCloneName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setCloneTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={handleClone}
                disabled={!cloneName.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-40 transition-colors"
              >
                Clone Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
