'use client';

import Link from 'next/link';

// ============================================================
// SCM Roles — Phase 1.5 first cut (READ-ONLY)
//
// Documents the 7 SCM RBAC roles + their intended permissions and SoD
// constraints. Assignment + permission-middleware enforcement land in
// Phase 1.6. Until then, all SCM router writes accept the action regardless
// of role (the schema captures `approver_role` etc. but does not enforce).
//
// Path B (V's lock): per-hospital admin self-service via THIS page when
// Phase 1.6 ships. GMs assign by mid-November. V is sole final approver
// for role-mapping changes.
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface ScmRoleSpec {
  key: string;
  label: string;
  pillar: 'procurement' | 'inventory' | 'oversight';
  blurb: string;
  canDo: string[];
  cannotDo: string[];
  sodConflicts: string[];
}

const SCM_ROLES: ScmRoleSpec[] = [
  {
    key: 'pr_creator',
    label: 'Purchase Requisition Creator',
    pillar: 'procurement',
    blurb: 'Department staff who initiate procurement requests for their cost center.',
    canDo: [
      'Create purchase requisitions (PRs)',
      'Edit own draft PRs',
      'View own PR status / history',
    ],
    cannotDo: [
      'Approve own PR',
      'Create POs directly',
      'Receive goods (GRN)',
    ],
    sodConflicts: ['po_approver', 'grn_creator'],
  },
  {
    key: 'po_approver',
    label: 'Purchase Order Approver',
    pillar: 'procurement',
    blurb: 'KPMG approval matrix participant. Tier-routed: HOD ≤₹50K / Procurement Head ₹50K-2L / Finance ₹2L-10L / Facility Director ≥₹10L.',
    canDo: [
      'Approve POs in own tier',
      'View all POs across hospital',
      'Reject with reason',
    ],
    cannotDo: [
      'Create PR or PO',
      'Receive goods',
      'Edit vendor master',
    ],
    sodConflicts: ['pr_creator', 'po_creator', 'grn_creator'],
  },
  {
    key: 'po_creator',
    label: 'Purchase Order Creator',
    pillar: 'procurement',
    blurb: 'Procurement team member converting approved PRs to POs and managing direct POs (high-tier approval bypass).',
    canDo: [
      'Convert PR → PO',
      'Create direct POs',
      'Add line items, send to vendor',
    ],
    cannotDo: [
      'Approve own PO',
      'Receive goods (separate role)',
    ],
    sodConflicts: ['po_approver', 'grn_creator'],
  },
  {
    key: 'grn_creator',
    label: 'Goods Receipt Creator',
    pillar: 'inventory',
    blurb: 'Warehouse / receiving staff. Distinct from PR/PO roles per KPMG SoD.',
    canDo: [
      'Create GRN against PO',
      'Run KPMG 10-item inspection checklist',
      'Generate stock movements (grn_receive)',
    ],
    cannotDo: [
      'Create PR or PO',
      'Approve PO',
      'Adjust inventory after GRN (separate role)',
    ],
    sodConflicts: ['pr_creator', 'po_creator', 'po_approver'],
  },
  {
    key: 'inventory_manager',
    label: 'Inventory Manager',
    pillar: 'inventory',
    blurb: 'Stock adjustments, transfers, condemnation handling, expiry management.',
    canDo: [
      'Adjust stock (with reason)',
      'Transfer between locations',
      'Mark items expired / damaged',
      'Resolve auto-reorder drafts (alerts)',
    ],
    cannotDo: [
      'Create PR / PO / GRN',
      'Modify item master',
    ],
    sodConflicts: ['pr_creator', 'po_creator', 'grn_creator'],
  },
  {
    key: 'item_master_steward',
    label: 'Item Master Steward',
    pillar: 'oversight',
    blurb: 'Curates the items table — adds new items, advances lifecycle states, manages deprecations.',
    canDo: [
      'Create / edit items',
      'Transition items through lifecycle (Codes Q3 5-state)',
      'Initiate deprecations (with reason + urgency_tier)',
      'Manage handling rules (cold chain, LASA, narcotic, …)',
    ],
    cannotDo: [
      'Final-approve clinical/CMS-GM gate transitions',
      'Make procurement decisions',
    ],
    sodConflicts: [],
  },
  {
    key: 'scm_admin',
    label: 'SCM Administrator',
    pillar: 'oversight',
    blurb: 'Hospital-level oversight. Can read everything; selective writes for emergency override (audited).',
    canDo: [
      'View all SCM data + audit log',
      'Override SoD blocks in emergencies (event-logged)',
      'Manage SCM role assignments (Path B)',
      'Run reports + KPMG audit support exports',
    ],
    cannotDo: [
      'Bypass V/Architecture Committee approval for cross-hospital changes',
    ],
    sodConflicts: [],
  },
];

const PILLAR_COLORS: Record<ScmRoleSpec['pillar'], string> = {
  procurement: '#3b82f6',
  inventory: '#10b981',
  oversight: '#8b5cf6',
};

export default function ScmRolesClient({ user }: { user: User }) {
  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link href="/admin/scm/dashboard" style={{ color: '#3b82f6', textDecoration: 'none' }}>SCM</Link>
        <span>›</span>
        <span>Roles & SoD</span>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>🔐 SCM Roles & Segregation of Duties</h1>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 24px 0' }}>
        Read-only matrix of the 7 SCM RBAC roles. Assignment flow + permission-middleware enforcement land in <strong>Phase 1.6</strong>.
        Until then, the SCM routers do NOT yet block writes by role — every action is allowed (and audit-logged).
      </p>

      {/* ─── Status banner ──────────────────────────── */}
      <div
        style={{
          padding: 16,
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: 8,
          marginBottom: 24,
          fontSize: 14,
          color: '#92400e',
        }}
      >
        <strong>Phase 1.6 (mid-Nov 2026):</strong> per-hospital admin self-service for role assignment via this page.
        GMs assign through the UI; V is sole final approver. SoD permission middleware enforces the conflict matrix
        below at write-time on every SCM router mutation.
      </div>

      {/* ─── Roles by pillar ──────────────────────── */}
      {(['procurement', 'inventory', 'oversight'] as const).map((pillar) => {
        const inPillar = SCM_ROLES.filter((r) => r.pillar === pillar);
        return (
          <section key={pillar} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: PILLAR_COLORS[pillar] }} />
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, textTransform: 'capitalize', color: '#374151' }}>
                {pillar}
              </h2>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                ({inPillar.length} role{inPillar.length === 1 ? '' : 's'})
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
              {inPillar.map((r) => (
                <RoleCard key={r.key} role={r} pillarColor={PILLAR_COLORS[r.pillar]} />
              ))}
            </div>
          </section>
        );
      })}

      {/* ─── KPMG approval matrix ─────────────────── */}
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

      {/* ─── SoD conflict matrix ─────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#374151' }}>Segregation of Duties — conflict matrix</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          A user may NOT hold both roles in any conflict pair below for the same hospital. The middleware will reject role assignment if it would violate the matrix.
        </p>
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr>
                <Th>Role A</Th>
                <Th>Cannot also hold</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              <tr><Td>pr_creator</Td><Td>po_approver, grn_creator</Td><Td>Originator must not approve own request or receive own goods</Td></tr>
              <tr><Td>po_creator</Td><Td>po_approver, grn_creator</Td><Td>PO author must not approve own PO or receive own goods</Td></tr>
              <tr><Td>po_approver</Td><Td>pr_creator, po_creator, grn_creator</Td><Td>Approver must be independent of all upstream + receipt steps</Td></tr>
              <tr><Td>grn_creator</Td><Td>pr_creator, po_creator, po_approver</Td><Td>Receiver must not be involved in originating the procurement</Td></tr>
              <tr><Td>inventory_manager</Td><Td>pr_creator, po_creator, grn_creator</Td><Td>Stock-adjustment authority must be separate from procurement chain</Td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Footer note ─────────────────────────── */}
      <div style={{ padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#4b5563' }}>
        <strong>Currently signed in as:</strong> {user.name || user.email} (<code>{user.role}</code>) at {user.hospital_id}. SCM router writes are accepted regardless of role assignment until Phase 1.6 middleware ships; every write is audit-logged.
      </div>
    </div>
  );
}

function RoleCard({ role, pillarColor }: { role: ScmRoleSpec; pillarColor: string }) {
  return (
    <div style={{ padding: 16, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <code style={{ fontSize: 11, padding: '2px 6px', background: `${pillarColor}22`, color: pillarColor, borderRadius: 4, fontWeight: 600 }}>
          {role.key}
        </code>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{role.label}</div>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px 0', lineHeight: 1.5 }}>{role.blurb}</p>

      <PermissionList title="Can do" items={role.canDo} color="#10b981" icon="✓" />
      <PermissionList title="Cannot do" items={role.cannotDo} color="#ef4444" icon="✗" />

      {role.sodConflicts.length > 0 ? (
        <div style={{ marginTop: 12, padding: 10, background: '#fef3c7', borderRadius: 6, fontSize: 12 }}>
          <strong style={{ color: '#92400e' }}>SoD conflicts:</strong>{' '}
          <span style={{ color: '#78350f' }}>cannot also be {role.sodConflicts.map((s) => <code key={s} style={{ background: '#fff', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{s}</code>)}</span>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{children}</td>;
}
