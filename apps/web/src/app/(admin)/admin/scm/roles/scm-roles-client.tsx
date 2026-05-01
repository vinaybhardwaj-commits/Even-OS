'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Roles — Phase 1.6 (Path B GO-LIVE for assignment write flow)
//
// Two tabs:
//   1. Reference matrix (Phase 1.5 read-only docs)
//   2. Assignments (NEW; lists current SCM role assignments + assign / revoke)
//
// Authority for assign / revoke:
//   - super_admin / hospital_admin (app-level admin override)
//   - scm_admin (the SCM oversight role)
//
// Server-side enforcement:
//   - scm.roles.* router calls assertCanManageRoles() at the top of each
//     mutation; throws FORBIDDEN if the user lacks the right role.
//   - Assign also validates SoD conflicts via assertNoSoDConflict() and
//     rejects with BAD_REQUEST if conflicting roles already held.
//
// Client-side conflict preview is precomputed below — UI shows which
// allowed/blocked roles a user can be assigned given their current set.
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface ScmRoleAssignmentRow {
  id: string;
  hospital_id: string;
  user_id: string;
  scm_role: ScmRole;
  granted_by: string;
  granted_at: string;
  grant_reason: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  notes: string | null;
  // joined
  user_full_name: string | null;
  user_email: string | null;
  user_role: string | null;
  granted_by_name: string | null;
  revoked_by_name: string | null;
}

type ScmRole =
  | 'pr_creator'
  | 'po_approver'
  | 'po_creator'
  | 'grn_creator'
  | 'inventory_manager'
  | 'item_master_steward'
  | 'scm_admin';

const SCM_ROLES: ScmRole[] = [
  'pr_creator',
  'po_approver',
  'po_creator',
  'grn_creator',
  'inventory_manager',
  'item_master_steward',
  'scm_admin',
];

const SCM_ROLE_LABELS: Record<ScmRole, string> = {
  pr_creator: 'Purchase Requisition Creator',
  po_approver: 'Purchase Order Approver',
  po_creator: 'Purchase Order Creator',
  grn_creator: 'Goods Receipt Creator',
  inventory_manager: 'Inventory Manager',
  item_master_steward: 'Item Master Steward',
  scm_admin: 'SCM Administrator',
};

const SCM_SOD_CONFLICTS: Record<ScmRole, ScmRole[]> = {
  pr_creator: ['po_approver', 'grn_creator'],
  po_creator: ['po_approver', 'grn_creator'],
  po_approver: ['pr_creator', 'po_creator', 'grn_creator'],
  grn_creator: ['pr_creator', 'po_creator', 'po_approver'],
  inventory_manager: ['pr_creator', 'po_creator', 'grn_creator'],
  item_master_steward: [],
  scm_admin: [],
};

interface ScmRoleSpec {
  key: ScmRole;
  pillar: 'procurement' | 'inventory' | 'oversight';
  blurb: string;
  canDo: string[];
  cannotDo: string[];
}

const SCM_ROLE_SPECS: ScmRoleSpec[] = [
  { key: 'pr_creator', pillar: 'procurement', blurb: 'Department staff who initiate procurement requests for their cost center.', canDo: ['Create purchase requisitions (PRs)', 'Edit own draft PRs', 'View own PR status / history'], cannotDo: ['Approve own PR', 'Create POs directly', 'Receive goods (GRN)'] },
  { key: 'po_approver', pillar: 'procurement', blurb: 'KPMG approval matrix participant. Tier-routed: HOD ≤₹50K / Procurement Head ₹50K-2L / Finance ₹2L-10L / Facility Director ≥₹10L.', canDo: ['Approve POs in own tier', 'View all POs across hospital', 'Reject with reason'], cannotDo: ['Create PR or PO', 'Receive goods', 'Edit vendor master'] },
  { key: 'po_creator', pillar: 'procurement', blurb: 'Procurement team member converting approved PRs to POs and managing direct POs (high-tier approval bypass).', canDo: ['Convert PR → PO', 'Create direct POs', 'Add line items, send to vendor'], cannotDo: ['Approve own PO', 'Receive goods (separate role)'] },
  { key: 'grn_creator', pillar: 'inventory', blurb: 'Warehouse / receiving staff. Distinct from PR/PO roles per KPMG SoD.', canDo: ['Create GRN against PO', 'Run KPMG 10-item inspection checklist', 'Generate stock movements (grn_receive)'], cannotDo: ['Create PR or PO', 'Approve PO', 'Adjust inventory after GRN (separate role)'] },
  { key: 'inventory_manager', pillar: 'inventory', blurb: 'Stock adjustments, transfers, condemnation handling, expiry management.', canDo: ['Adjust stock (with reason)', 'Transfer between locations', 'Mark items expired / damaged', 'Resolve auto-reorder drafts (alerts)'], cannotDo: ['Create PR / PO / GRN', 'Modify item master'] },
  { key: 'item_master_steward', pillar: 'oversight', blurb: 'Curates the items table — adds new items, advances lifecycle states, manages deprecations.', canDo: ['Create / edit items', 'Transition items through lifecycle (Codes Q3 5-state)', 'Initiate deprecations (with reason + urgency_tier)', 'Manage handling rules (cold chain, LASA, narcotic, …)'], cannotDo: ['Final-approve clinical/CMS-GM gate transitions', 'Make procurement decisions'] },
  { key: 'scm_admin', pillar: 'oversight', blurb: 'Hospital-level oversight. Can read everything; selective writes for emergency override (audited). Manages SCM role assignments.', canDo: ['View all SCM data + audit log', 'Override SoD blocks in emergencies (event-logged)', 'Manage SCM role assignments (Path B)', 'Run reports + KPMG audit support exports'], cannotDo: ['Bypass V/Architecture Committee approval for cross-hospital changes'] },
];

const PILLAR_COLORS: Record<ScmRoleSpec['pillar'], string> = {
  procurement: '#3b82f6',
  inventory: '#10b981',
  oversight: '#8b5cf6',
};

// --- tRPC HTTP helpers ---
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
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

function fmtRel(d: string | null): string {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-IN');
}

// ============================================================

export default function ScmRolesClient({ user }: { user: User }) {
  type Tab = 'matrix' | 'assignments';
  const [tab, setTab] = useState<Tab>('assignments');

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Roles & SoD</span>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>🔐 SCM Roles & Segregation of Duties</h1>

      {/* ─── Tabs ────────────────────── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <TabButton active={tab === 'assignments'} onClick={() => setTab('assignments')}>Assignments</TabButton>
        <TabButton active={tab === 'matrix'} onClick={() => setTab('matrix')}>Reference matrix</TabButton>
      </div>

      {tab === 'assignments' ? <AssignmentsTab user={user} /> : <MatrixTab user={user} />}
    </div>
  );
}

// ─── ASSIGNMENTS TAB (Phase 1.6) ──────────────────────────────────

function AssignmentsTab({ user }: { user: User }) {
  const [assignments, setAssignments] = useState<ScmRoleAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);
  const [filterRole, setFilterRole] = useState<ScmRole | ''>('');
  const [showAssign, setShowAssign] = useState(false);
  const [revokeFor, setRevokeFor] = useState<ScmRoleAssignmentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery('scm.roles.list', {
        active_only: activeOnly,
        scm_role: filterRole || undefined,
      });
      setAssignments(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }, [activeOnly, filterRole]);

  useEffect(() => {
    load();
  }, [load]);

  // KPIs
  const activeCount = assignments.filter((a) => !a.revoked_at).length;
  const byRole = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of assignments) {
      if (a.revoked_at) continue;
      m[a.scm_role] = (m[a.scm_role] || 0) + 1;
    }
    return m;
  }, [assignments]);

  return (
    <div>
      {/* ─── Phase 1.6 status banner ─────── */}
      <div
        style={{
          padding: 12,
          background: '#f0f9ff',
          border: '1px solid #93c5fd',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
          color: '#1e40af',
        }}
      >
        <strong>Phase 1.6 active:</strong> SoD permission middleware now ENFORCES role checks on every SCM mutation server-side.
        super_admin / hospital_admin bypass; everyone else needs the right SCM role assignment.
        scm_admin can also manage assignments here.
      </div>

      {/* ─── KPI strip ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Active assignments" value={activeCount} color="#3b82f6" />
        <Kpi label="po_approver" value={byRole.po_approver || 0} color="#3b82f6" />
        <Kpi label="grn_creator" value={byRole.grn_creator || 0} color="#10b981" />
        <Kpi label="inventory_manager" value={byRole.inventory_manager || 0} color="#10b981" />
      </div>

      {/* ─── Filters ────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as ScmRole | '')}
          style={{ ...inputStyle, width: 220 }}
        >
          <option value="">All roles</option>
          {SCM_ROLES.map((r) => (
            <option key={r} value={r}>{SCM_ROLE_LABELS[r]}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
        <button onClick={() => setShowAssign(true)} style={{ ...btnNew, marginLeft: 'auto' }}>+ Assign role</button>
      </div>

      {error ? <ErrorBox msg={error} /> : null}

      {/* ─── Assignments table ─────── */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <Th>User</Th>
              <Th>SCM role</Th>
              <Th>Granted</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><Td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>Loading…</Td></tr>
            ) : assignments.length === 0 ? (
              <tr>
                <Td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                  No assignments {activeOnly ? '(active)' : ''}.{' '}
                  <button onClick={() => setShowAssign(true)} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Assign one
                  </button>
                  ?
                </Td>
              </tr>
            ) : (
              assignments.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: a.revoked_at ? 0.55 : 1 }}>
                  <Td>
                    <div style={{ fontWeight: 500 }}>{a.user_full_name || '(unknown)'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{a.user_email || ''} {a.user_role ? `· ${a.user_role}` : ''}</div>
                  </Td>
                  <Td>
                    <code style={{ fontSize: 11, padding: '2px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: 4, fontWeight: 500 }}>
                      {a.scm_role}
                    </code>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{SCM_ROLE_LABELS[a.scm_role]}</div>
                  </Td>
                  <Td style={{ fontSize: 12, color: '#6b7280' }}>
                    {fmtRel(a.granted_at)}
                    {a.granted_by_name ? <div style={{ fontSize: 11, color: '#9ca3af' }}>by {a.granted_by_name}</div> : null}
                    {a.grant_reason ? <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>"{a.grant_reason}"</div> : null}
                  </Td>
                  <Td>
                    {a.revoked_at ? (
                      <div>
                        <span style={{ padding: '2px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: 999, fontSize: 11, fontWeight: 500 }}>revoked</span>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          {fmtRel(a.revoked_at)} {a.revoked_by_name ? `by ${a.revoked_by_name}` : ''}
                        </div>
                        {a.revoke_reason ? <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>"{a.revoke_reason}"</div> : null}
                      </div>
                    ) : (
                      <span style={{ padding: '2px 8px', background: '#d1fae5', color: '#065f46', borderRadius: 999, fontSize: 11, fontWeight: 500 }}>active</span>
                    )}
                  </Td>
                  <Td>
                    {!a.revoked_at ? (
                      <button onClick={() => setRevokeFor(a)} style={btnSecondarySmall}>Revoke</button>
                    ) : null}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
        Showing {assignments.length} assignment{assignments.length === 1 ? '' : 's'} for hospital <strong>{user.hospital_id}</strong>
      </div>

      {showAssign ? <AssignModal currentUser={user} onClose={() => setShowAssign(false)} onAssigned={load} /> : null}
      {revokeFor ? <RevokeModal assignment={revokeFor} onClose={() => setRevokeFor(null)} onRevoked={load} /> : null}
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────

function AssignModal({ currentUser, onClose, onAssigned }: { currentUser: User; onClose: () => void; onAssigned: () => void }) {
  const [userId, setUserId] = useState('');
  const [scmRole, setScmRole] = useState<ScmRole>('inventory_manager');
  const [grantReason, setGrantReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live SoD preview — load target user's existing roles
  const [existingRoles, setExistingRoles] = useState<ScmRole[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    // Validate UUID-ish before triggering
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    if (!looksLikeUuid) {
      setExistingRoles([]);
      setPreviewErr(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewErr(null);
    (async () => {
      try {
        const data = await trpcQuery('scm.roles.listForUser', { user_id: userId });
        if (cancelled) return;
        setExistingRoles((data?.roles as ScmRole[]) || []);
      } catch (e: any) {
        if (cancelled) return;
        setPreviewErr(e?.message || 'Failed to load existing roles');
        setExistingRoles([]);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const conflictRoles = SCM_SOD_CONFLICTS[scmRole].filter((c) => existingRoles.includes(c));
  const wouldConflict = conflictRoles.length > 0;
  const alreadyHeld = existingRoles.includes(scmRole);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.roles.assign', {
        user_id: userId,
        scm_role: scmRole,
        grant_reason: grantReason || undefined,
        notes: notes || undefined,
      });
      onAssigned();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Assign failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Assign SCM role" onClose={onClose}>
      <div style={infoBox}>
        <div style={{ fontSize: 13 }}>
          You ({currentUser.name}) are assigning at hospital <code>{currentUser.hospital_id}</code>.
          Server-side SoD enforcement: <strong>active</strong>.
        </div>
      </div>

      <Field label="User ID (UUID)">
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value.trim())}
          style={inputStyle}
          placeholder="e.g. a348b32e-d932-4451-ba8f-ef608f3d40be"
        />
      </Field>

      <Field label="SCM role to assign">
        <select value={scmRole} onChange={(e) => setScmRole(e.target.value as ScmRole)} style={inputStyle}>
          {SCM_ROLES.map((r) => (
            <option key={r} value={r}>{SCM_ROLE_LABELS[r]} ({r})</option>
          ))}
        </select>
      </Field>

      {/* SoD live preview */}
      {userId.length >= 8 ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: alreadyHeld ? '#fef2f2' : wouldConflict ? '#fef3c7' : '#f0fdf4',
            border: `1px solid ${alreadyHeld ? '#fca5a5' : wouldConflict ? '#fde68a' : '#86efac'}`,
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {previewLoading ? (
            <span style={{ color: '#6b7280' }}>Checking existing roles…</span>
          ) : previewErr ? (
            <span style={{ color: '#991b1b' }}>SoD preview: {previewErr}</span>
          ) : (
            <>
              <strong>SoD preview:</strong>{' '}
              <span style={{ color: '#6b7280' }}>
                Currently holds: {existingRoles.length === 0 ? 'no SCM roles' : existingRoles.map((r) => <code key={r} style={{ background: '#fff', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{r}</code>)}
              </span>
              <div style={{ marginTop: 6 }}>
                {alreadyHeld ? (
                  <span style={{ color: '#991b1b' }}>⚠ Already holds <code>{scmRole}</code> — assignment will be rejected.</span>
                ) : wouldConflict ? (
                  <span style={{ color: '#92400e' }}>
                    ✗ Conflict: assigning <code>{scmRole}</code> conflicts with existing {conflictRoles.map((r) => <code key={r} style={{ background: '#fff', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{r}</code>)}. Revoke first.
                  </span>
                ) : (
                  <span style={{ color: '#065f46' }}>✓ No SoD conflicts. Assignment will succeed.</span>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      <Field label="Grant reason (optional, audit-logged)">
        <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} style={inputStyle} placeholder="Why this user / role / now?" />
      </Field>
      <Field label="Notes (optional)">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
      </Field>

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button
          onClick={submit}
          disabled={submitting || !userId || alreadyHeld || wouldConflict || previewLoading}
          style={btnPrimary(submitting || !userId || alreadyHeld || wouldConflict || previewLoading)}
        >
          {submitting ? 'Assigning…' : `Assign ${SCM_ROLE_LABELS[scmRole]}`}
        </button>
      </div>
    </Modal>
  );
}

function RevokeModal({ assignment, onClose, onRevoked }: { assignment: ScmRoleAssignmentRow; onClose: () => void; onRevoked: () => void }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await trpcMutate('scm.roles.revoke', {
        assignment_id: assignment.id,
        revoke_reason: reason || undefined,
      });
      onRevoked();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Revoke failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Revoke ${assignment.scm_role}`} onClose={onClose}>
      <div style={infoBox}>
        <div><strong>User:</strong> {assignment.user_full_name || '—'} ({assignment.user_email || '—'})</div>
        <div><strong>Role:</strong> <code>{assignment.scm_role}</code> — {SCM_ROLE_LABELS[assignment.scm_role]}</div>
        <div><strong>Granted:</strong> {fmtRel(assignment.granted_at)} by {assignment.granted_by_name || '—'}</div>
      </div>

      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 12 }}>
        Revocation is <strong>soft</strong> — the row is preserved with <code>revoked_at</code> set, audit trail intact.
        After revocation the user can be re-granted the same role later (creates a new active row).
      </p>

      <Field label="Revoke reason (optional, audit-logged)">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ ...inputStyle, minHeight: 60 }}
          placeholder="Role no longer applicable / role rotation / etc."
        />
      </Field>

      {err ? <ErrorBox msg={err} /> : null}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>
          {submitting ? 'Revoking…' : 'Confirm revoke'}
        </button>
      </div>
    </Modal>
  );
}

// ─── MATRIX TAB (Phase 1.5 docs) ──────────────────────────────────

function MatrixTab({ user }: { user: User }) {
  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 24px 0' }}>
        Reference matrix of the 7 SCM RBAC roles, KPMG approval matrix, and SoD conflict pairs. Server-side enforcement of these rules went live in <strong>Phase 1.6</strong>.
      </p>

      {(['procurement', 'inventory', 'oversight'] as const).map((pillar) => {
        const inPillar = SCM_ROLE_SPECS.filter((r) => r.pillar === pillar);
        return (
          <section key={pillar} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: PILLAR_COLORS[pillar] }} />
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, textTransform: 'capitalize', color: '#374151' }}>{pillar}</h2>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>({inPillar.length} role{inPillar.length === 1 ? '' : 's'})</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
              {inPillar.map((r) => <RoleCard key={r.key} role={r} pillarColor={PILLAR_COLORS[r.pillar]} conflicts={SCM_SOD_CONFLICTS[r.key]} />)}
            </div>
          </section>
        );
      })}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#374151' }}>KPMG approval matrix (PO tiers)</h2>
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr>
                <Th>PO total</Th>
                <Th>Approver role</Th>
                <Th>Co-approval</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              <tr><Td>≤ ₹50,000</Td><Td>HOD</Td><Td>—</Td><Td>Department head signs off</Td></tr>
              <tr><Td>₹50,000 – ₹2L</Td><Td>Procurement Head</Td><Td>—</Td><Td>Procurement team head</Td></tr>
              <tr><Td>₹2L – ₹10L</Td><Td>Finance In-Charge</Td><Td>—</Td><Td>Finance review for budget impact</Td></tr>
              <tr><Td>≥ ₹10L</Td><Td>Facility Director</Td><Td>CMS/GM</Td><Td>Director + GM co-approval required</Td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#374151' }}>SoD conflict matrix (server-enforced)</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          A user may NOT hold both roles in any conflict pair below for the same hospital. <code>scm.roles.assign</code> rejects assignments that would violate this matrix.
        </p>
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr>
                <Th>Role</Th>
                <Th>Cannot also hold</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {SCM_ROLE_SPECS.filter((r) => SCM_SOD_CONFLICTS[r.key].length > 0).map((r) => (
                <tr key={r.key}>
                  <Td><code>{r.key}</code></Td>
                  <Td>{SCM_SOD_CONFLICTS[r.key].map((c) => <code key={c} style={{ marginRight: 4, background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{c}</code>)}</Td>
                  <Td style={{ color: '#6b7280' }}>{r.blurb}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#4b5563' }}>
        <strong>Currently signed in as:</strong> {user.name || user.email} (<code>{user.role}</code>) at {user.hospital_id}.
      </div>
    </div>
  );
}

function RoleCard({ role, pillarColor, conflicts }: { role: ScmRoleSpec; pillarColor: string; conflicts: ScmRole[] }) {
  return (
    <div style={{ padding: 16, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <code style={{ fontSize: 11, padding: '2px 6px', background: `${pillarColor}22`, color: pillarColor, borderRadius: 4, fontWeight: 600 }}>
          {role.key}
        </code>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{SCM_ROLE_LABELS[role.key]}</div>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px 0', lineHeight: 1.5 }}>{role.blurb}</p>
      <PermissionList title="Can do" items={role.canDo} color="#10b981" icon="✓" />
      <PermissionList title="Cannot do" items={role.cannotDo} color="#ef4444" icon="✗" />
      {conflicts.length > 0 ? (
        <div style={{ marginTop: 12, padding: 10, background: '#fef3c7', borderRadius: 6, fontSize: 12 }}>
          <strong style={{ color: '#92400e' }}>SoD conflicts:</strong>{' '}
          <span style={{ color: '#78350f' }}>cannot also be {conflicts.map((s) => <code key={s} style={{ background: '#fff', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{s}</code>)}</span>
        </div>
      ) : null}
    </div>
  );
}

function PermissionList({ title, items, color, icon }: { title: string; items: string[]; color: string; icon: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{title}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, padding: '2px 0' }}>
            <span style={{ color, fontWeight: 700, fontSize: 12, marginTop: 1 }}>{icon}</span>
            <span style={{ color: '#374151' }}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Atoms ──────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? '#3b82f6' : 'transparent'}`,
        color: active ? '#1e40af' : '#6b7280',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, maxWidth: 720, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 8 }}>
      <span style={{ color: '#374151', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 12, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>{msg}</div>;
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', ...style }}>{children}</th>;
}

function Td({ children, colSpan, style }: { children: React.ReactNode; colSpan?: number; style?: React.CSSProperties }) {
  return <td colSpan={colSpan} style={{ padding: '10px 12px', verticalAlign: 'middle', ...style }}>{children}</td>;
}

const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const infoBox: React.CSSProperties = { padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 };
const btnNew: React.CSSProperties = { padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' };
const btnSecondarySmall: React.CSSProperties = { padding: '4px 10px', background: 'white', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer' };
const btnPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  background: disabled ? '#93c5fd' : '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
