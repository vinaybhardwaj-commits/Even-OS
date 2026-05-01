'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// ============================================================
// SCM Dashboard — Phase 1.5 first cut
//
// Hub view for the SCM Core module. Pulls KPIs from the canonical
// SCM tables via scm.* tRPC procedures (NOT pharmacy.* re-exports —
// new code lives on the canonical namespace per Q2 Path C lock).
//
// Tile design: each tile shows a count + current state + link to its
// dedicated sub-page. No deep CRUD here — that's in /admin/scm/items,
// /admin/scm/vendors, etc.
// ============================================================

interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
  department?: string;
}

// --- tRPC HTTP helpers (matches existing pharmacy-client.tsx pattern) ---
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

interface KpiCounts {
  itemsTotal: number;
  itemsActive: number;
  itemsByKind: Record<string, number>;
  inventoryRows: number;
  lowStockRows: number;
  expiringRows: number;
  vendors: number;
  alertsPending: number;
  posByStatus: Record<string, number>;
}

const initialCounts: KpiCounts = {
  itemsTotal: 0,
  itemsActive: 0,
  itemsByKind: {},
  inventoryRows: 0,
  lowStockRows: 0,
  expiringRows: 0,
  vendors: 0,
  alertsPending: 0,
  posByStatus: {},
};

export default function ScmDashboardClient({ user }: { user: User }) {
  const [counts, setCounts] = useState<KpiCounts>(initialCounts);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Parallel KPI fetches — items list (paged big), inventory, vendors, alerts, POs
        const [items, inventory, lowStock, expiring, vendors, alerts, pos] = await Promise.all([
          trpcQuery('scm.items.list', { limit: 500, include_network: true }),
          trpcQuery('scm.inventory.list', {}),
          trpcQuery('scm.inventory.list', { low_stock_only: true }),
          trpcQuery('scm.inventory.expiryWatchlist', { days_until_expiry: 30 }),
          trpcQuery('scm.vendors.list', {}),
          trpcQuery('scm.alerts.list', { only_unreviewed: true, limit: 500 }),
          trpcQuery('scm.purchaseOrders.list', {}),
        ]);
        if (cancelled) return;

        const itemsArr: any[] = Array.isArray(items) ? items : [];
        const itemsByKind: Record<string, number> = {};
        let activeCount = 0;
        for (const it of itemsArr) {
          itemsByKind[it.kind] = (itemsByKind[it.kind] || 0) + 1;
          if (it.status === 'active') activeCount += 1;
        }

        const posArr: any[] = Array.isArray(pos) ? pos : [];
        const posByStatus: Record<string, number> = {};
        for (const po of posArr) {
          posByStatus[po.status] = (posByStatus[po.status] || 0) + 1;
        }

        setCounts({
          itemsTotal: itemsArr.length,
          itemsActive: activeCount,
          itemsByKind,
          inventoryRows: Array.isArray(inventory) ? inventory.length : 0,
          lowStockRows: Array.isArray(lowStock) ? lowStock.length : 0,
          expiringRows: Array.isArray(expiring) ? expiring.length : 0,
          vendors: Array.isArray(vendors) ? vendors.length : 0,
          alertsPending: Array.isArray(alerts) ? alerts.length : 0,
          posByStatus,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load SCM dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>📦 SCM Core — Dashboard</h1>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          Hospital: <strong>{user.hospital_id}</strong> · Role: <strong>{user.role}</strong>
        </div>
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0, marginBottom: 24 }}>
        Universal item master, multi-location inventory, procurement, and procurement alerts. KX replacement, December 2026 launch.
      </p>

      {error ? (
        <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: 24 }}>
          {error}
        </div>
      ) : null}

      {/* ─── KPI tiles ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
        <Tile
          icon="📚"
          title="Items"
          value={loading ? '…' : counts.itemsTotal.toString()}
          subtitle={`${counts.itemsActive} active`}
          href="/admin/scm/items"
          color="#3b82f6"
        />
        <Tile
          icon="📦"
          title="Inventory rows"
          value={loading ? '…' : counts.inventoryRows.toString()}
          subtitle={`across all locations`}
          href="/admin/scm/items"
          color="#8b5cf6"
        />
        <Tile
          icon="⚠️"
          title="Low stock"
          value={loading ? '…' : counts.lowStockRows.toString()}
          subtitle={`below reorder level`}
          href="/admin/scm/items"
          color={counts.lowStockRows > 0 ? '#f59e0b' : '#10b981'}
        />
        <Tile
          icon="⏰"
          title="Expiring (30d)"
          value={loading ? '…' : counts.expiringRows.toString()}
          subtitle={`expires within 30 days`}
          href="/admin/scm/items"
          color={counts.expiringRows > 0 ? '#f59e0b' : '#10b981'}
        />
        <Tile
          icon="🏢"
          title="Vendors"
          value={loading ? '…' : counts.vendors.toString()}
          subtitle={`registered`}
          href="/admin/scm/vendors"
          color="#06b6d4"
        />
        <Tile
          icon="🔔"
          title="Pending alerts"
          value={loading ? '…' : counts.alertsPending.toString()}
          subtitle={`auto-reorder drafts`}
          href="/admin/scm/items"
          color={counts.alertsPending > 0 ? '#ef4444' : '#10b981'}
        />
      </div>

      {/* ─── Items by kind breakdown ───────────────────── */}
      <Section title="Items by kind">
        {loading ? (
          <div style={{ color: '#6b7280' }}>Loading…</div>
        ) : Object.keys(counts.itemsByKind).length === 0 ? (
          <Empty
            message="No items yet."
            hint="Run the phase-1.3 backfill script to import drug_master into items, or create items directly via the items page."
          />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(counts.itemsByKind)
              .sort((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <KindChip key={kind} kind={kind} count={count} />
              ))}
          </div>
        )}
      </Section>

      {/* ─── PO status pipeline ────────────────────────── */}
      <Section title="Purchase orders by state">
        {loading ? (
          <div style={{ color: '#6b7280' }}>Loading…</div>
        ) : Object.keys(counts.posByStatus).length === 0 ? (
          <Empty message="No purchase orders yet." hint="Create one from the items page (Phase 1.5b will add a dedicated PO admin page)." />
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            {[
              'draft',
              'approved',
              'sent_to_vendor',
              'partially_received',
              'received',
              'closed',
              'cancelled',
            ].map((status) => (
              <PoStateColumn key={status} status={status} count={counts.posByStatus[status] || 0} />
            ))}
          </div>
        )}
      </Section>

      {/* ─── Quick links ──────────────────────────────── */}
      <Section title="Sub-pages">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          <NavCard
            href="/admin/scm/items"
            title="Items master"
            blurb="Drugs / consumables / implants / reagents / linen / CSSD packs / equipment spares — universal item master with Codes Q3 5-state lifecycle."
          />
          <NavCard
            href="/admin/scm/vendors"
            title="Vendors"
            blurb="Vendor master with GST, drug license, payment terms, performance metrics. Same vendor row used by Pharmacy clinical + SCM procurement."
          />
          <NavCard
            href="/admin/scm/roles"
            title="Roles & SoD (Phase 1.6)"
            blurb="7 SCM RBAC roles. Read-only matrix here; assignment + permission middleware lands in Phase 1.6 (mid-Nov per V's lock)."
          />
          <NavCard
            href="/admin/pharmacy"
            title="Pharmacy (legacy view)"
            blurb="Existing pharmacy admin page still works via the deprecation re-exports (pharmacy.* → scm.*). Phase 8 cleanup removes it."
            external
          />
        </div>
      </Section>

      {/* ─── Footer note ──────────────────────────────── */}
      <div style={{ marginTop: 32, padding: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#4b5563' }}>
        <strong>Phase status:</strong> SCM Phase 1.5 (admin pages) — first-cut UI. Forms and full CRUD wiring continue in Phase 1.6 alongside SoD permission middleware.
        <br />
        <strong>Cross-PRD:</strong> Codes Phase 1 (FK gate to <code>codes</code>), Billing v3 Phase 1 (3-way match against <code>vendor_invoices</code>), and OT (issue / consumption flow) all consume this module.
      </div>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────

function Tile({
  icon,
  title,
  value,
  subtitle,
  href,
  color,
}: {
  icon: string;
  title: string;
  value: string;
  subtitle?: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: 16,
        background: '#ffffff',
        border: `1px solid #e5e7eb`,
        borderRadius: 10,
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        transition: 'transform 0.1s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{title}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {subtitle ? <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{subtitle}</div> : null}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px 0', color: '#374151' }}>{title}</h2>
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>{children}</div>
    </section>
  );
}

function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div style={{ color: '#6b7280', fontSize: 14 }}>
      <div style={{ fontWeight: 500, marginBottom: 4 }}>{message}</div>
      {hint ? <div style={{ fontSize: 12, color: '#9ca3af' }}>{hint}</div> : null}
    </div>
  );
}

function KindChip({ kind, count }: { kind: string; count: number }) {
  const colorMap: Record<string, string> = {
    drug: '#3b82f6',
    consumable: '#06b6d4',
    implant: '#ef4444',
    reagent: '#8b5cf6',
    linen: '#10b981',
    cssd_pack: '#f59e0b',
    equipment_spare: '#6366f1',
    general: '#6b7280',
  };
  const color = colorMap[kind] || '#6b7280';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: '#f3f4f6',
        border: `1px solid ${color}33`,
        borderRadius: 999,
        fontSize: 13,
      }}
    >
      <span style={{ width: 8, height: 8, background: color, borderRadius: 999 }} />
      <span style={{ fontWeight: 500 }}>{kind.replace(/_/g, ' ')}</span>
      <span style={{ color: '#6b7280' }}>({count})</span>
    </div>
  );
}

function PoStateColumn({ status, count }: { status: string; count: number }) {
  const labelMap: Record<string, string> = {
    draft: 'Draft',
    approved: 'Approved',
    sent_to_vendor: 'Sent to vendor',
    partially_received: 'Partial',
    received: 'Received',
    closed: 'Closed',
    cancelled: 'Cancelled',
  };
  const label = labelMap[status] || status;
  const colorMap: Record<string, string> = {
    draft: '#9ca3af',
    approved: '#3b82f6',
    sent_to_vendor: '#8b5cf6',
    partially_received: '#f59e0b',
    received: '#10b981',
    closed: '#6b7280',
    cancelled: '#ef4444',
  };
  const color = colorMap[status] || '#6b7280';
  return (
    <div style={{ flex: 1, padding: 12, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{count}</div>
    </div>
  );
}

function NavCard({ href, title, blurb, external }: { href: string; title: string; blurb: string; external?: boolean }) {
  const Component: any = external ? 'a' : Link;
  const props: any = external ? { href } : { href };
  return (
    <Component
      {...props}
      style={{
        display: 'block',
        padding: 16,
        background: '#fafafa',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: '#1f2937' }}>{title}</div>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{blurb}</div>
    </Component>
  );
}
