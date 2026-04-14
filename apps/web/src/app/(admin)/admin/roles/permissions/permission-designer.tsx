'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

// ── tRPC helpers ───────────────────────────────────────────────────────────
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
interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

interface RoleDetail {
  id: string;
  name: string;
  description: string | null;
  role_group: string;
  session_timeout_minutes: number;
  is_active: boolean;
  is_system_role: boolean;
  permissions: Permission[];
  users: { id: string; full_name: string; email: string; department: string | null }[];
}

interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  role_group: string;
  permission_count: number;
  user_count: number;
  is_system_role: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────
const GROUP_COLORS: Record<string, string> = {
  system: 'bg-red-50 border-red-200',
  admin: 'bg-purple-50 border-purple-200',
  executive: 'bg-blue-50 border-blue-200',
  clinical: 'bg-teal-50 border-teal-200',
  nursing: 'bg-pink-50 border-pink-200',
  pharmacy: 'bg-amber-50 border-amber-200',
  lab: 'bg-cyan-50 border-cyan-200',
  radiology: 'bg-indigo-50 border-indigo-200',
  billing: 'bg-orange-50 border-orange-200',
  support: 'bg-gray-100 border-gray-200',
};

const RESOURCE_ICONS: Record<string, string> = {
  patient: '🏥', observation: '📊', medication: '💊', medication_order: '📋',
  medication_administration: '💉', nursing_assessment: '🩺', clinical_note: '📝',
  shift_handoff: '🔄', encounter: '📁', bed: '🛏️', allergy: '⚠️',
  condition: '📌', escalation: '🚨', order: '📦', billing: '💰',
  pharmacy: '🏪', lab: '🔬', radiology: '📡', report: '📈',
  user: '👤', role: '🔐', audit: '📜', setting: '⚙️', department: '🏢',
};

function formatName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function PermissionDesigner() {
  const searchParams = useSearchParams();
  const roleId = searchParams.get('role_id');

  // ─ State ─
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [allRoles, setAllRoles] = useState<RoleListItem[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [grouped, setGrouped] = useState<Record<string, Permission[]>>({});
  const [resources, setResources] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Working set of selected permission IDs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Search/filter
  const [search, setSearch] = useState('');
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());

  // Copy-from-role modal
  const [showCopyModal, setShowCopyModal] = useState(false);

  // Diff preview modal
  const [showDiffModal, setShowDiffModal] = useState(false);

  // ─ Initial permission set (for diff calculation) ─
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());

  // ─ Load data ─
  const fetchData = useCallback(async () => {
    if (!roleId) return;
    setLoading(true);
    try {
      const [roleData, permData, rolesData] = await Promise.all([
        trpcQuery('roles.get', { id: roleId }),
        trpcQuery('roles.allPermissions'),
        trpcQuery('roles.list', {}),
      ]);
      setRole(roleData);
      setAllPermissions(permData.permissions);
      setGrouped(permData.grouped);
      setResources(permData.resources);
      setAllRoles(rolesData);

      // Set initial selected state from role's current permissions
      const currentPermIds = new Set<string>(roleData.permissions.map((p: Permission) => p.id));
      setSelectedIds(currentPermIds);
      setOriginalIds(currentPermIds);

      // Expand all resources that have at least one permission assigned
      const assignedResources = new Set<string>(roleData.permissions.map((p: Permission) => p.resource));
      setExpandedResources(assignedResources);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roleId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─ Diff calculations ─
  const diff = useMemo(() => {
    const added = [...selectedIds].filter(id => !originalIds.has(id));
    const removed = [...originalIds].filter(id => !selectedIds.has(id));
    const hasChanges = added.length > 0 || removed.length > 0;

    // Resolve names
    const permMap = new Map(allPermissions.map(p => [p.id, p]));
    const addedPerms = added.map(id => permMap.get(id)).filter(Boolean) as Permission[];
    const removedPerms = removed.map(id => permMap.get(id)).filter(Boolean) as Permission[];

    return { added, removed, addedPerms, removedPerms, hasChanges };
  }, [selectedIds, originalIds, allPermissions]);

  // ─ Filtered resources ─
  const filteredResources = useMemo(() => {
    if (!search) return resources;
    const q = search.toLowerCase();
    return resources.filter(r => {
      if (r.toLowerCase().includes(q)) return true;
      // Check if any action in this resource matches
      return (grouped[r] || []).some(p => p.action.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    });
  }, [resources, search, grouped]);

  // ─ Toggle helpers ─
  const togglePermission = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleResource = (resource: string) => {
    const resourcePerms = grouped[resource] || [];
    const allSelected = resourcePerms.every(p => selectedIds.has(p.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Remove all
        resourcePerms.forEach(p => next.delete(p.id));
      } else {
        // Add all
        resourcePerms.forEach(p => next.add(p.id));
      }
      return next;
    });
  };

  const toggleExpandResource = (resource: string) => {
    setExpandedResources(prev => {
      const next = new Set(prev);
      if (next.has(resource)) next.delete(resource);
      else next.add(resource);
      return next;
    });
  };

  const expandAll = () => setExpandedResources(new Set(resources));
  const collapseAll = () => setExpandedResources(new Set());

  const selectAll = () => {
    setSelectedIds(new Set(allPermissions.map(p => p.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // ─ Copy permissions from another role ─
  const copyFromRole = async (sourceRoleId: string) => {
    try {
      const sourceRole = await trpcQuery('roles.get', { id: sourceRoleId });
      const sourcePermIds = new Set<string>(sourceRole.permissions.map((p: Permission) => p.id));
      setSelectedIds(sourcePermIds);
      setShowCopyModal(false);
      setSuccess(`Copied ${sourcePermIds.size} permissions from "${formatName(sourceRole.name)}". Review and click Apply to save.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─ Save permissions ─
  const handleSave = async () => {
    if (!role) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await trpcMutate('roles.setPermissions', {
        role_id: role.id,
        permission_ids: [...selectedIds],
      });
      setSuccess(
        `Permissions updated: +${result.added} added, -${result.removed} removed. ` +
        `${result.total} total permissions. ${result.affected_users} user(s) affected.`
      );
      // Update original set to reflect saved state
      setOriginalIds(new Set(selectedIds));
      setShowDiffModal(false);
      // Refresh role detail
      const updatedRole = await trpcQuery('roles.get', { id: role.id });
      setRole(updatedRole);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSelectedIds(new Set(originalIds));
    setSuccess('');
  };

  // ─ Resource stats ─
  const getResourceStats = (resource: string) => {
    const perms = grouped[resource] || [];
    const selected = perms.filter(p => selectedIds.has(p.id)).length;
    return { total: perms.length, selected };
  };

  // ─ No role ID ─
  if (!roleId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-sm border text-center">
          <h2 className="text-xl font-bold text-gray-800">Permission Designer</h2>
          <p className="text-gray-500 mt-2">Select a role from the <a href="/admin/roles" className="text-blue-600 hover:underline">Roles page</a> to edit permissions.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading permission designer...</p>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-sm border text-center">
          <h2 className="text-xl font-bold text-red-700">Role not found</h2>
          <p className="text-gray-500 mt-2"><a href="/admin/roles" className="text-blue-600 hover:underline">Back to Roles</a></p>
        </div>
      </div>
    );
  }

  const groupStyle = GROUP_COLORS[role.role_group] || GROUP_COLORS.support;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-blue-900 text-white px-6 py-3 flex justify-between items-center shadow-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <a href="/admin/roles" className="text-blue-200 hover:text-white text-sm">&larr; Roles</a>
          <h1 className="text-lg font-bold">Permission Designer</h1>
          <span className="text-blue-200 text-sm">
            {formatName(role.name)} &middot; {selectedIds.size}/{allPermissions.length} permissions
          </span>
        </div>
        <div className="flex items-center gap-3">
          {role.is_system_role && (
            <span className="px-2 py-1 bg-red-600/30 rounded text-xs text-red-200">System Role — Read Only</span>
          )}
          {diff.hasChanges && !role.is_system_role && (
            <span className="px-2 py-1 bg-amber-600/30 rounded text-xs text-amber-200">
              Unsaved: +{diff.added.length} / -{diff.removed.length}
            </span>
          )}
        </div>
      </header>

      {/* Alerts */}
      <div className="max-w-[1600px] mx-auto w-full px-6 mt-3">
        {error && (
          <div className="mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}
        {success && (
          <div className="mb-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex justify-between items-center">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600">&times;</button>
          </div>
        )}
      </div>

      {/* Main two-panel layout */}
      <div className="flex-1 flex max-w-[1600px] mx-auto w-full px-6 pb-24 gap-5 mt-2">
        {/* Left Panel: Role Info */}
        <div className="w-80 flex-shrink-0 space-y-4">
          {/* Role Card */}
          <div className={`rounded-xl border p-5 ${groupStyle}`}>
            <h2 className="text-lg font-bold text-gray-800">{formatName(role.name)}</h2>
            <p className="text-sm text-gray-600 mt-1">{role.description || 'No description'}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded-full font-medium">{role.role_group}</span>
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded-full">{role.session_timeout_minutes}m timeout</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${role.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                {role.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          {/* Permission Stats */}
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Permission Summary</h3>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-blue-700">{selectedIds.size}</p>
                <p className="text-xs text-gray-400">Selected</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-400">{allPermissions.length}</p>
                <p className="text-xs text-gray-400">Total Available</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-gray-500 mb-2">By resource:</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {resources.map(r => {
                  const { total, selected } = getResourceStats(r);
                  if (selected === 0) return null;
                  return (
                    <div key={r} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700">{RESOURCE_ICONS[r] || '📋'} {formatName(r)}</span>
                      <span className="text-gray-500 font-mono">{selected}/{total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Affected Users */}
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Affected Users ({role.users.length})
            </h3>
            {role.users.length === 0 ? (
              <p className="text-sm text-gray-400">No users assigned</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {role.users.map(u => (
                  <div key={u.id} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center font-medium flex-shrink-0">
                      {(u.full_name || u.email)[0].toUpperCase()}
                    </span>
                    <span className="text-gray-700 truncate">{u.full_name || u.email}</span>
                  </div>
                ))}
              </div>
            )}
            {diff.hasChanges && role.users.length > 0 && (
              <p className="text-xs text-amber-600 mt-2 p-2 bg-amber-50 rounded">
                Changes will affect {role.users.length} user(s)
              </p>
            )}
          </div>

          {/* Bulk Actions */}
          {!role.is_system_role && (
            <div className="bg-white rounded-xl border p-4 space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bulk Actions</h3>
              <button onClick={() => setShowCopyModal(true)} className="w-full px-3 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors">
                Copy Permissions from Role...
              </button>
              <button onClick={selectAll} className="w-full px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors">
                Select All ({allPermissions.length})
              </button>
              <button onClick={deselectAll} className="w-full px-3 py-2 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors">
                Deselect All
              </button>
              <button onClick={handleReset} className="w-full px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors">
                Reset to Saved State
              </button>
            </div>
          )}
        </div>

        {/* Right Panel: Permission Grid */}
        <div className="flex-1 min-w-0">
          {/* Toolbar */}
          <div className="bg-white rounded-lg border shadow-sm p-3 mb-3 flex flex-wrap items-center gap-3 sticky top-0 z-10">
            <input
              type="text"
              placeholder="Search resources or actions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button onClick={expandAll} className="text-xs text-blue-600 hover:text-blue-800">Expand All</button>
            <button onClick={collapseAll} className="text-xs text-blue-600 hover:text-blue-800">Collapse All</button>
            <span className="text-xs text-gray-400 ml-auto">{filteredResources.length} resources</span>
          </div>

          {/* Permission groups */}
          <div className="space-y-2">
            {filteredResources.map(resource => {
              const perms = grouped[resource] || [];
              const { total, selected } = getResourceStats(resource);
              const isExpanded = expandedResources.has(resource);
              const allSelected = selected === total;
              const someSelected = selected > 0 && selected < total;
              const icon = RESOURCE_ICONS[resource] || '📋';

              return (
                <div key={resource} className="bg-white rounded-lg border overflow-hidden">
                  {/* Resource header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => toggleExpandResource(resource)}>
                    <span className="text-sm">{isExpanded ? '▼' : '▶'}</span>
                    <span className="text-base">{icon}</span>
                    <span className="font-semibold text-sm text-gray-800">{formatName(resource)}</span>
                    <span className="text-xs text-gray-400 ml-1">{selected}/{total}</span>

                    {/* Progress bar */}
                    <div className="flex-1 mx-3 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[200px]">
                      <div
                        className={`h-full rounded-full transition-all ${allSelected ? 'bg-green-500' : someSelected ? 'bg-blue-400' : 'bg-gray-200'}`}
                        style={{ width: `${total > 0 ? (selected / total) * 100 : 0}%` }}
                      />
                    </div>

                    {/* Resource-level toggle */}
                    {!role.is_system_role && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleResource(resource); }}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          allSelected
                            ? 'bg-red-100 text-red-600 hover:bg-red-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {allSelected ? 'Revoke All' : 'Grant All'}
                      </button>
                    )}
                  </div>

                  {/* Permissions list */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-50">
                      {perms.sort((a, b) => a.action.localeCompare(b.action)).map(perm => {
                        const isSelected = selectedIds.has(perm.id);
                        const wasOriginal = originalIds.has(perm.id);
                        const isAdded = isSelected && !wasOriginal;
                        const isRemoved = !isSelected && wasOriginal;

                        return (
                          <label
                            key={perm.id}
                            className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                              role.is_system_role ? 'cursor-default' : 'hover:bg-blue-50'
                            } ${isAdded ? 'bg-green-50' : isRemoved ? 'bg-red-50' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => !role.is_system_role && togglePermission(perm.id)}
                              disabled={role.is_system_role}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-gray-800 font-medium">{perm.action}</span>
                              {perm.description && (
                                <span className="text-xs text-gray-400 ml-2">{perm.description}</span>
                              )}
                            </div>
                            <span className="text-xs font-mono text-gray-300">{resource}.{perm.action}</span>
                            {isAdded && <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">+new</span>}
                            {isRemoved && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-medium">-removed</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Sticky bottom bar ─ Diff summary + Apply ────────────────────── */}
      {diff.hasChanges && !role.is_system_role && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-20">
          <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {diff.added.length > 0 && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">
                    +{diff.added.length} added
                  </span>
                )}
                {diff.removed.length > 0 && (
                  <span className="px-2 py-1 bg-red-100 text-red-600 rounded text-sm font-medium">
                    -{diff.removed.length} removed
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-500">
                {role.users.length} user(s) will be affected
              </span>
              <button
                onClick={() => setShowDiffModal(true)}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                View full diff
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Discard Changes
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Apply Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Diff Preview Modal ──────────────────────────────────────────── */}
      {showDiffModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDiffModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 m-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Permission Changes Preview</h3>
            <p className="text-sm text-gray-500 mb-4">
              Reviewing changes for <strong>{formatName(role?.name || '')}</strong> &middot; {role?.users.length || 0} user(s) affected
            </p>

            {diff.addedPerms.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-green-700 mb-2">
                  + Adding {diff.addedPerms.length} permission(s)
                </h4>
                <div className="space-y-1">
                  {diff.addedPerms.sort((a, b) => `${a.resource}.${a.action}`.localeCompare(`${b.resource}.${b.action}`)).map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-sm px-3 py-1.5 bg-green-50 rounded">
                      <span className="text-green-600 font-mono">{p.resource}.{p.action}</span>
                      {p.description && <span className="text-xs text-gray-400">{p.description}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {diff.removedPerms.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-red-700 mb-2">
                  - Removing {diff.removedPerms.length} permission(s)
                </h4>
                <div className="space-y-1">
                  {diff.removedPerms.sort((a, b) => `${a.resource}.${a.action}`.localeCompare(`${b.resource}.${b.action}`)).map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-sm px-3 py-1.5 bg-red-50 rounded">
                      <span className="text-red-600 font-mono">{p.resource}.{p.action}</span>
                      {p.description && <span className="text-xs text-gray-400">{p.description}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {role && role.users.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-700 font-medium mb-1">Affected Users</p>
                <div className="space-y-0.5">
                  {role.users.map(u => (
                    <p key={u.id} className="text-xs text-amber-600">{u.full_name || u.email}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-5 pt-4 border-t">
              <button onClick={() => setShowDiffModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : `Apply ${diff.added.length + diff.removed.length} Changes`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Copy From Role Modal ────────────────────────────────────────── */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCopyModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 m-4 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Copy Permissions From Role</h3>
            <p className="text-sm text-gray-500 mb-4">
              This will replace the current selection with the source role's permissions. Review before applying.
            </p>

            <div className="space-y-2">
              {allRoles.filter(r => r.id !== role?.id).map(r => (
                <button
                  key={r.id}
                  onClick={() => copyFromRole(r.id)}
                  className="w-full text-left px-4 py-3 border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-gray-800">{formatName(r.name)}</span>
                    <span className="text-xs text-gray-400">{r.permission_count} perms</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{r.description || r.role_group}</p>
                </button>
              ))}
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => setShowCopyModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
