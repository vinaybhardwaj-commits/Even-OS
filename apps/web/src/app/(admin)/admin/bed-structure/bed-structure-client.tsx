'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────
type Bed = {
  id: string;
  location_type: 'bed';
  parent_location_id: string | null;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  bed_status: string;
  floor_number: number | null;
  infrastructure_flags: Record<string, any> | null;
  created_at: string;
};

type Room = {
  id: string;
  location_type: 'room';
  parent_location_id: string | null;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  room_type: string | null;
  floor_number: number | null;
  room_tag: string | null;
  infrastructure_flags: Record<string, any> | null;
  capacity: number | null;
  beds: Bed[];
  active_bed_count: number;
  occupied_bed_count: number;
};

type Ward = {
  id: string;
  location_type: 'ward';
  parent_location_id: string | null;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  ward_type: string | null;
  floor_number: number | null;
  infrastructure_flags: Record<string, any> | null;
  capacity: number | null;
  rooms: Room[];
  active_room_count: number;
  total_active_beds: number;
  occupied_beds: number;
};

type Floor = {
  id: string;
  location_type: 'floor';
  code: string;
  name: string;
  floor_number: number;
  status: 'active' | 'inactive';
  wards: Ward[];
  active_ward_count: number;
};

type StructureTree = Floor[];

type AuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: any;
  new_values: any;
  performed_by_user_id: string | null;
  performed_at: string;
  reason: string | null;
};

type SelectedNode =
  | { kind: 'floor'; data: Floor }
  | { kind: 'ward'; data: Ward }
  | { kind: 'room'; data: Room }
  | { kind: 'bed'; data: Bed }
  | null;

type ModalKind =
  | { kind: 'rename'; node: Exclude<SelectedNode, null> }
  | { kind: 'decom'; node: Exclude<SelectedNode, null> }
  | { kind: 'reactivate'; node: Exclude<SelectedNode, null> }
  | { kind: 'convert-room'; node: { kind: 'room'; data: Room } }
  | { kind: 'move-bed'; node: { kind: 'bed'; data: Bed } }
  | { kind: 'add-ward' }
  | { kind: 'add-room'; ward: Ward }
  | { kind: 'add-bed'; room: Room }
  | { kind: 'infra'; node: Exclude<SelectedNode, null> }
  | null;

const INFRA_KEYS: Array<{ key: string; label: string }> = [
  { key: 'oxygen', label: 'Oxygen Line' },
  { key: 'suction', label: 'Suction' },
  { key: 'monitor', label: 'Cardiac Monitor' },
  { key: 'telemetry', label: 'Telemetry' },
  { key: 'isolation_ready', label: 'Isolation-Ready' },
  { key: 'attached_bathroom', label: 'Attached Bathroom' },
  { key: 'attendant_bed', label: 'Attendant Bed' },
  { key: 'negative_pressure', label: 'Negative Pressure' },
];

// ─── tRPC helpers ────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ─── Utility ─────────────────────────────────────────────────
function statusPill(status: 'active' | 'inactive') {
  if (status === 'active') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-800">● active</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-200 text-gray-600">○ inactive</span>;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function bedStatusColor(s: string): string {
  switch (s) {
    case 'available': return 'text-green-700';
    case 'occupied': return 'text-blue-700';
    case 'reserved': return 'text-amber-700';
    case 'blocked': return 'text-red-700';
    case 'housekeeping': return 'text-orange-700';
    case 'terminal_cleaning': return 'text-purple-700';
    case 'maintenance': return 'text-gray-700';
    default: return 'text-gray-600';
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export function BedStructureClient({ userRole }: { userRole: string }) {
  const [tab, setTab] = useState<'tree' | 'audit'>('tree');
  const [tree, setTree] = useState<StructureTree>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedNode>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [showInactive, setShowInactive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, a] = await Promise.all([
        trpcQuery('bed.structureTree', { include_inactive: true }),
        trpcQuery('bed.structureAudit', { limit: 100 }),
      ]);
      setTree(t || []);
      setAudit(a || []);
      // Auto-expand floors on first load
      if (expanded.size === 0 && (t || []).length > 0) {
        const initial = new Set<string>();
        for (const f of t as Floor[]) initial.add(f.id);
        setExpanded(initial);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load structure');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function refreshAfterMutation(msg: string) {
    notify(msg);
    setModal(null);
    await load();
    // Re-select the node if still in tree
    if (selected) {
      const id = selected.data.id;
      const found = findNode(tree, id);
      setSelected(found);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <Link href="/admin/bed-board" className="hover:text-gray-700">← Bed Board</Link>
                <span>/</span>
                <span className="text-gray-900">Edit Layout</span>
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mt-1">Bed Structure Editor</h1>
              <p className="text-sm text-gray-600 mt-1">Structural changes to wards, rooms, and beds. All actions are audit-logged. Codes are permanent — only names can be renamed.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal({ kind: 'add-ward' })}
                className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >+ Add Ward</button>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mt-4 border-b border-gray-200 -mb-px">
            <button
              onClick={() => setTab('tree')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'tree' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >Tree Editor</button>
            <button
              onClick={() => setTab('audit')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'audit' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >Structural Audit ({audit.length})</button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 bg-green-600 text-white rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {/* Body */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading structure…</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
        ) : tab === 'tree' ? (
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-7">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-gray-600">
                  {tree.length} floor{tree.length !== 1 && 's'} · {tree.reduce((n, f) => n + f.wards.filter(w => w.status === 'active').length, 0)} active wards · {tree.reduce((n, f) => n + f.wards.reduce((m, w) => m + w.total_active_beds, 0), 0)} active beds
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                {tree.map(floor => (
                  <TreeFloor
                    key={floor.id}
                    floor={floor}
                    expanded={expanded}
                    toggle={toggle}
                    selected={selected}
                    setSelected={setSelected}
                    showInactive={showInactive}
                    onAddRoom={(ward: Ward) => setModal({ kind: 'add-room', ward })}
                    onAddBed={(room: Room) => setModal({ kind: 'add-bed', room })}
                  />
                ))}
              </div>
            </div>

            <div className="col-span-12 lg:col-span-5">
              <DetailPanel
                node={selected}
                onRename={(n: Exclude<SelectedNode, null>) => setModal({ kind: 'rename', node: n })}
                onDecom={(n: Exclude<SelectedNode, null>) => setModal({ kind: 'decom', node: n })}
                onReactivate={(n: Exclude<SelectedNode, null>) => setModal({ kind: 'reactivate', node: n })}
                onConvertRoom={(n: { kind: 'room'; data: Room }) => setModal({ kind: 'convert-room', node: n })}
                onMoveBed={(n: { kind: 'bed'; data: Bed }) => setModal({ kind: 'move-bed', node: n })}
                onEditInfra={(n: Exclude<SelectedNode, null>) => setModal({ kind: 'infra', node: n })}
              />
            </div>
          </div>
        ) : (
          <AuditTab audit={audit} />
        )}
      </div>

      {/* Modals */}
      {modal?.kind === 'rename' && (
        <RenameModal node={modal.node} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'decom' && (
        <DecomModal node={modal.node} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'reactivate' && (
        <ReactivateModal node={modal.node} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'convert-room' && (
        <ConvertRoomModal room={modal.node.data} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'move-bed' && (
        <MoveBedModal bed={modal.node.data} tree={tree} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'add-ward' && (
        <AddWardModal onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'add-room' && (
        <AddRoomModal ward={modal.ward} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'add-bed' && (
        <AddBedModal room={modal.room} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
      {modal?.kind === 'infra' && (
        <InfraModal node={modal.node} onClose={() => setModal(null)} onDone={refreshAfterMutation} />
      )}
    </div>
  );
}

function findNode(tree: StructureTree, id: string): SelectedNode {
  for (const f of tree) {
    if (f.id === id) return { kind: 'floor', data: f };
    for (const w of f.wards) {
      if (w.id === id) return { kind: 'ward', data: w };
      for (const r of w.rooms) {
        if (r.id === id) return { kind: 'room', data: r };
        for (const b of r.beds) {
          if (b.id === id) return { kind: 'bed', data: b };
        }
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// TREE COMPONENTS
// ═══════════════════════════════════════════════════════════

function TreeFloor({ floor, expanded, toggle, selected, setSelected, showInactive, onAddRoom, onAddBed }: any) {
  const open = expanded.has(floor.id);
  const isSelected = selected?.data?.id === floor.id;
  const wards = showInactive ? floor.wards : floor.wards.filter((w: Ward) => w.status === 'active');
  return (
    <div>
      <div
        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-indigo-50' : ''}`}
        onClick={() => { toggle(floor.id); setSelected({ kind: 'floor', data: floor }); }}
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400 w-4 text-xs">{open ? '▼' : '▶'}</span>
          <span className="font-semibold text-sm text-gray-900">Floor {floor.floor_number} — {floor.name}</span>
          <span className="text-xs text-gray-500">{floor.active_ward_count} active ward{floor.active_ward_count !== 1 && 's'}</span>
        </div>
      </div>
      {open && (
        <div className="pl-6 bg-gray-50/50">
          {wards.map((ward: Ward) => (
            <TreeWard
              key={ward.id}
              ward={ward}
              expanded={expanded}
              toggle={toggle}
              selected={selected}
              setSelected={setSelected}
              showInactive={showInactive}
              onAddRoom={onAddRoom}
              onAddBed={onAddBed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeWard({ ward, expanded, toggle, selected, setSelected, showInactive, onAddRoom, onAddBed }: any) {
  const open = expanded.has(ward.id);
  const isSelected = selected?.data?.id === ward.id;
  const rooms = showInactive ? ward.rooms : ward.rooms.filter((r: Room) => r.status === 'active');
  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div
        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100 ${isSelected ? 'bg-indigo-50' : ''} ${ward.status === 'inactive' ? 'opacity-60' : ''}`}
        onClick={() => { toggle(ward.id); setSelected({ kind: 'ward', data: ward }); }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-gray-400 w-4 text-xs">{open ? '▼' : '▶'}</span>
          <span className="font-medium text-sm text-gray-900 truncate">{ward.code}</span>
          <span className="text-xs text-gray-600 truncate">{ward.name}</span>
          {ward.ward_type && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded uppercase">{ward.ward_type}</span>}
          {statusPill(ward.status)}
          <span className="text-xs text-gray-500 ml-auto">{ward.occupied_beds}/{ward.total_active_beds} beds</span>
        </div>
        {ward.status === 'active' && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddRoom(ward); }}
            className="ml-2 text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50"
            title="Add room to this ward"
          >+ Room</button>
        )}
      </div>
      {open && (
        <div className="pl-6 bg-white">
          {rooms.map((room: Room) => (
            <TreeRoom
              key={room.id}
              room={room}
              expanded={expanded}
              toggle={toggle}
              selected={selected}
              setSelected={setSelected}
              showInactive={showInactive}
              onAddBed={onAddBed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeRoom({ room, expanded, toggle, selected, setSelected, showInactive, onAddBed }: any) {
  const open = expanded.has(room.id);
  const isSelected = selected?.data?.id === room.id;
  const beds = showInactive ? room.beds : room.beds.filter((b: Bed) => b.status === 'active');
  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div
        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-indigo-50' : ''} ${room.status === 'inactive' ? 'opacity-60' : ''}`}
        onClick={() => { toggle(room.id); setSelected({ kind: 'room', data: room }); }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-gray-400 w-4 text-xs">{beds.length > 0 ? (open ? '▼' : '▶') : ' '}</span>
          <span className="font-medium text-sm text-gray-800">{room.code}</span>
          <span className="text-xs text-gray-600 truncate">{room.name}</span>
          {room.room_type && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">{room.room_type.replace('_', ' ')}</span>}
          {room.room_tag && room.room_tag !== 'none' && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">{room.room_tag}</span>
          )}
          {statusPill(room.status)}
          <span className="text-xs text-gray-500 ml-auto">{room.occupied_bed_count}/{room.active_bed_count} beds</span>
        </div>
        {room.status === 'active' && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddBed(room); }}
            className="ml-2 text-xs px-2 py-0.5 bg-white border border-gray-300 rounded hover:bg-gray-50"
            title="Add overflow bed"
          >+ Bed</button>
        )}
      </div>
      {open && beds.length > 0 && (
        <div className="pl-6 bg-gray-50/30">
          {beds.map((bed: Bed) => (
            <div
              key={bed.id}
              onClick={() => setSelected({ kind: 'bed', data: bed })}
              className={`flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 first:border-t-0 cursor-pointer hover:bg-white ${selected?.data?.id === bed.id ? 'bg-indigo-50' : ''} ${bed.status === 'inactive' ? 'opacity-60' : ''}`}
            >
              <span className="text-gray-300 w-4 text-xs">•</span>
              <span className="text-sm font-mono text-gray-800">{bed.code}</span>
              <span className="text-xs text-gray-500">{bed.name}</span>
              <span className={`text-[10px] uppercase font-medium ${bedStatusColor(bed.bed_status)}`}>{bed.bed_status.replace('_', ' ')}</span>
              {statusPill(bed.status)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════

function DetailPanel({ node, onRename, onDecom, onReactivate, onConvertRoom, onMoveBed, onEditInfra }: any) {
  if (!node) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 text-center">
        Select an item in the tree to view details and structural actions.
      </div>
    );
  }
  const d = node.data;
  const isActive = d.status === 'active';

  return (
    <div className="bg-white border border-gray-200 rounded-lg sticky top-4">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{node.kind}</div>
            <div className="text-lg font-semibold text-gray-900">{d.code}</div>
            <div className="text-sm text-gray-600">{d.name}</div>
          </div>
          {statusPill(d.status)}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 text-sm">
        {node.kind === 'ward' && (
          <>
            <MetaRow label="Ward Type" value={d.ward_type || '—'} />
            <MetaRow label="Floor" value={String(d.floor_number || '—')} />
            <MetaRow label="Rooms" value={`${d.active_room_count}`} />
            <MetaRow label="Beds" value={`${d.occupied_beds} occupied / ${d.total_active_beds} active`} />
          </>
        )}
        {node.kind === 'room' && (
          <>
            <MetaRow label="Room Type" value={d.room_type?.replace('_', ' ') || '—'} />
            <MetaRow label="Capacity" value={`${d.capacity || 0}`} />
            <MetaRow label="Floor" value={String(d.floor_number || '—')} />
            <MetaRow label="Room Tag" value={d.room_tag || 'none'} />
            <MetaRow label="Beds" value={`${d.occupied_bed_count} occupied / ${d.active_bed_count} active`} />
          </>
        )}
        {node.kind === 'bed' && (
          <>
            <MetaRow label="Bed Status" value={(d.bed_status || '').replace('_', ' ')} />
            <MetaRow label="Floor" value={String(d.floor_number || '—')} />
          </>
        )}
        {node.kind === 'floor' && (
          <>
            <MetaRow label="Floor Number" value={String(d.floor_number)} />
            <MetaRow label="Active Wards" value={String(d.active_ward_count)} />
          </>
        )}

        {/* Infrastructure flags for ward/room/bed */}
        {node.kind !== 'floor' && (
          <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-semibold text-gray-700">Infrastructure</div>
              {isActive && (
                <button onClick={() => onEditInfra(node)} className="text-xs text-indigo-600 hover:underline">edit</button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {INFRA_KEYS.map(({ key, label }) => {
                const on = Boolean((d.infrastructure_flags || {})[key]);
                return (
                  <span key={key} className={`text-[10px] px-1.5 py-0.5 rounded border ${on ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                    {on ? '✓' : '·'} {label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-200 space-y-2">
        <div className="text-xs font-semibold text-gray-700">Actions</div>
        <div className="grid grid-cols-2 gap-2">
          {node.kind !== 'floor' && isActive && (
            <button onClick={() => onRename(node)} className="px-3 py-2 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">Rename</button>
          )}
          {node.kind === 'room' && isActive && (
            <button onClick={() => onConvertRoom(node)} className="px-3 py-2 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">Convert Room Type</button>
          )}
          {node.kind === 'bed' && isActive && (
            <button onClick={() => onMoveBed(node)} className="px-3 py-2 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">Move Bed</button>
          )}
          {node.kind !== 'floor' && isActive && (
            <button onClick={() => onDecom(node)} className="px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-800 rounded hover:bg-red-100">
              Decommission {node.kind === 'ward' ? 'Ward' : node.kind === 'room' ? 'Room' : 'Bed'}
            </button>
          )}
          {node.kind !== 'floor' && !isActive && (
            <button onClick={() => onReactivate(node)} className="px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded hover:bg-emerald-100">
              Reactivate
            </button>
          )}
        </div>
        <div className="text-[10px] text-gray-500 pt-2">Code is permanent: <span className="font-mono">{d.code}</span>. Only names can be renamed.</div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AUDIT TAB
// ═══════════════════════════════════════════════════════════

function AuditTab({ audit }: { audit: AuditEntry[] }) {
  const actionColor = (action: string) => {
    if (action.endsWith('_added') || action.endsWith('_created')) return 'bg-emerald-100 text-emerald-800';
    if (action.endsWith('_decommissioned')) return 'bg-red-100 text-red-800';
    if (action === 'location_reactivated') return 'bg-blue-100 text-blue-800';
    if (action === 'location_renamed' || action === 'bed_moved') return 'bg-amber-100 text-amber-800';
    if (action === 'room_converted') return 'bg-purple-100 text-purple-800';
    if (action === 'infrastructure_flags_updated') return 'bg-indigo-100 text-indigo-800';
    return 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">When</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Action</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Entity</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Reason</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {audit.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">No structural changes recorded yet.</td></tr>
          ) : audit.map(a => (
            <tr key={a.id}>
              <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-600">{fmtDateTime(a.performed_at)}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${actionColor(a.action)}`}>{a.action}</span>
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-700">{a.entity_type}</td>
              <td className="px-4 py-2 text-xs text-gray-700">{a.reason || '—'}</td>
              <td className="px-4 py-2 text-[11px] text-gray-500 font-mono max-w-[320px] truncate" title={JSON.stringify({ old: a.old_values, new: a.new_values })}>
                {a.new_values ? JSON.stringify(a.new_values).slice(0, 60) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════

function ModalShell({ title, children, onClose }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="font-semibold text-gray-900">{title}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function RenameModal({ node, onClose, onDone }: any) {
  const [name, setName] = useState(node.data.name);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.renameLocation', {
        location_id: node.data.id,
        new_name: name,
        reason: reason || undefined,
      });
      onDone(`Renamed ${node.kind}: ${node.data.name} → ${name}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Rename ${node.kind}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500">Code <span className="font-mono text-gray-700">{node.data.code}</span> is permanent and will not change.</div>
        <div>
          <label className="text-xs font-medium text-gray-700">New name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Reason (optional)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., rebranded ward" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy || !name || name === node.data.name} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function DecomModal({ node, onClose, onDone }: any) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) { setErr('Reason is required'); return; }
    setBusy(true); setErr(null);
    try {
      if (node.kind === 'ward') {
        await trpcMutate('bed.decommissionWard', { ward_id: node.data.id, reason });
      } else if (node.kind === 'room') {
        await trpcMutate('bed.decommissionRoom', { room_id: node.data.id, reason });
      } else if (node.kind === 'bed') {
        await trpcMutate('bed.decommissionBed', { bed_id: node.data.id, reason });
      }
      onDone(`Decommissioned ${node.kind} ${node.data.code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const cascadeWarning = node.kind === 'ward'
    ? 'This will cascade to all rooms and beds in this ward.'
    : node.kind === 'room'
    ? 'This will cascade to all beds in this room.'
    : 'This will mark the single bed inactive.';

  return (
    <ModalShell title={`Decommission ${node.kind}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800">
          <div className="font-semibold mb-1">Heads up</div>
          {cascadeWarning} Occupied beds will block this action.
        </div>
        <div>
          <div className="text-sm"><span className="text-gray-500">Code:</span> <span className="font-mono">{node.data.code}</span></div>
          <div className="text-sm"><span className="text-gray-500">Name:</span> {node.data.name}</div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Reason <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., renovation, equipment failure, ward reorganized" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-red-600 text-white rounded disabled:opacity-50">
            {busy ? 'Working…' : 'Decommission'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ReactivateModal({ node, onClose, onDone }: any) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) { setErr('Reason is required'); return; }
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.reactivateLocation', { location_id: node.data.id, reason });
      onDone(`Reactivated ${node.kind} ${node.data.code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Reactivate ${node.kind}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm text-gray-700">Bring <span className="font-mono">{node.data.code}</span> back online.</div>
        {node.kind === 'bed' && <div className="text-xs text-gray-500">Bed status will reset to <span className="font-medium">available</span>.</div>}
        <div>
          <label className="text-xs font-medium text-gray-700">Reason <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., renovation complete, equipment restored" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-emerald-600 text-white rounded disabled:opacity-50">
            {busy ? 'Working…' : 'Reactivate'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ConvertRoomModal({ room, onClose, onDone }: { room: Room; onClose: () => void; onDone: (msg: string) => void }) {
  const [newType, setNewType] = useState<'private' | 'semi_private' | 'suite'>((room.room_type as any) || 'private');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.convertRoom', {
        room_id: room.id,
        new_room_type: newType,
        reason: reason || undefined,
      });
      onDone(`Converted room ${room.code} to ${newType}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Convert room ${room.code}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm text-gray-600">Current: <span className="font-medium">{(room.room_type || '').replace('_', ' ')}</span></div>
        <div>
          <label className="text-xs font-medium text-gray-700">Convert to</label>
          <select value={newType} onChange={e => setNewType(e.target.value as any)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="private">Private (1 bed)</option>
            <option value="semi_private">Semi-private (2 beds)</option>
            <option value="suite">Suite (1 bed)</option>
          </select>
        </div>
        <div className="text-xs text-gray-500">Semi-private → private/suite deactivates bed B. Private/suite → semi-private adds a new B bed.</div>
        <div>
          <label className="text-xs font-medium text-gray-700">Reason (optional)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy || newType === room.room_type} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Converting…' : 'Convert'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function MoveBedModal({ bed, tree, onClose, onDone }: { bed: Bed; tree: StructureTree; onClose: () => void; onDone: (msg: string) => void }) {
  const [toRoomId, setToRoomId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rooms = useMemo(() => {
    const list: Array<{ id: string; code: string; name: string; ward_name: string; floor_number: number | null }> = [];
    for (const f of tree) {
      for (const w of f.wards.filter(x => x.status === 'active')) {
        for (const r of w.rooms.filter(x => x.status === 'active')) {
          if (r.id === bed.parent_location_id) continue;
          list.push({ id: r.id, code: r.code, name: r.name, ward_name: w.name, floor_number: r.floor_number });
        }
      }
    }
    return list;
  }, [tree, bed.parent_location_id]);

  async function submit() {
    if (!toRoomId) { setErr('Pick a destination room'); return; }
    if (!reason.trim()) { setErr('Reason is required'); return; }
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.moveBed', { bed_id: bed.id, to_room_id: toRoomId, reason });
      onDone(`Moved bed ${bed.code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Move bed ${bed.code}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500">Code remains <span className="font-mono">{bed.code}</span>. Only the parent room changes.</div>
        <div>
          <label className="text-xs font-medium text-gray-700">Destination room</label>
          <select value={toRoomId} onChange={e => setToRoomId(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="">— Select room —</option>
            {rooms.map(r => (
              <option key={r.id} value={r.id}>F{r.floor_number} · {r.ward_name} · {r.code} — {r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Reason <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., overflow rearrangement, infra upgrade" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Moving…' : 'Move bed'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AddWardModal({ onClose, onDone }: any) {
  const [floor, setFloor] = useState('1');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [wardType, setWardType] = useState<'general' | 'icu' | 'nicu' | 'pacu' | 'dialysis' | 'day_care' | 'maternity' | 'step_down'>('general');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!code || !name) { setErr('Code and name are required'); return; }
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.addWard', {
        floor_number: parseInt(floor, 10),
        ward_code: code,
        ward_name: name,
        ward_type: wardType,
      });
      onDone(`Created ward ${code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title="Add Ward" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Floor</label>
            <select value={floor} onChange={e => setFloor(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="1">Floor 1</option>
              <option value="2">Floor 2</option>
              <option value="3">Floor 3</option>
              <option value="4">Floor 4</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Ward type</label>
            <select value={wardType} onChange={e => setWardType(e.target.value as any)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm">
              <option value="general">General</option>
              <option value="icu">ICU</option>
              <option value="nicu">NICU</option>
              <option value="pacu">PACU</option>
              <option value="dialysis">Dialysis</option>
              <option value="day_care">Day Care</option>
              <option value="maternity">Maternity</option>
              <option value="step_down">Step Down</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Ward code</label>
          <input value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono" placeholder="e.g., GW-5F" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Ward name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., General Ward 5F" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Creating…' : 'Create ward'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AddRoomModal({ ward, onClose, onDone }: { ward: Ward; onClose: () => void; onDone: (msg: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState<'private' | 'semi_private' | 'suite' | 'icu_room' | 'nicu_room' | 'pacu_bay' | 'dialysis_station' | 'general'>('private');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!code || !name) { setErr('Code and name are required'); return; }
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.addRoom', {
        ward_id: ward.id,
        room_code: code,
        room_name: name,
        room_type: roomType,
        floor_number: ward.floor_number || 1,
      });
      onDone(`Created room ${code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Add Room to ${ward.code}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500">Beds are auto-created: semi-private = 2 (A/B), private/suite = 1.</div>
        <div>
          <label className="text-xs font-medium text-gray-700">Room type</label>
          <select value={roomType} onChange={e => setRoomType(e.target.value as any)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="private">Private</option>
            <option value="semi_private">Semi-private</option>
            <option value="suite">Suite</option>
            <option value="icu_room">ICU Room</option>
            <option value="nicu_room">NICU Room</option>
            <option value="pacu_bay">PACU Bay</option>
            <option value="dialysis_station">Dialysis Station</option>
            <option value="general">General</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Room code</label>
          <input value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono" placeholder="e.g., 5-01" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Room name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., Room 5-01" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Creating…' : 'Create room + beds'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AddBedModal({ room, onClose, onDone }: { room: Room; onClose: () => void; onDone: (msg: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('overflow bed');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!code) { setErr('Bed code required'); return; }
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.addBed', {
        room_id: room.id,
        bed_code: code,
        bed_name: name || undefined,
        reason,
      });
      onDone(`Added bed ${code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Add bed to ${room.code}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500">For overflow beds beyond the room's designed capacity. The room's capacity is informational — it does not block adding beds.</div>
        <div>
          <label className="text-xs font-medium text-gray-700">Bed code</label>
          <input value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono" placeholder={`e.g., ${room.code}C`} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Bed name (optional)</label>
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="Defaults to 'Bed {code}'" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Reason</label>
          <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Adding…' : 'Add bed'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function InfraModal({ node, onClose, onDone }: any) {
  const initial = (node.data.infrastructure_flags || {}) as Record<string, any>;
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const k of INFRA_KEYS) out[k.key] = Boolean(initial[k.key]);
    return out;
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await trpcMutate('bed.updateInfrastructureFlags', {
        location_id: node.data.id,
        flags,
        reason: reason || undefined,
      });
      onDone(`Updated infrastructure on ${node.data.code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <ModalShell title={`Infrastructure on ${node.data.code}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500">Clinical essentials checklist. These flags are referenced by preflight checks during assignment (e.g., isolation, monitored bed).</div>
        <div className="grid grid-cols-2 gap-2">
          {INFRA_KEYS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={Boolean(flags[key])}
                onChange={e => setFlags(f => ({ ...f, [key]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Reason (optional)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded text-sm" placeholder="e.g., added oxygen line" />
        </div>
        {err && <div className="text-xs text-red-700 bg-red-50 p-2 rounded">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
