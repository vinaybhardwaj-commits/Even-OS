'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface User { sub: string; hospital_id: string; role: string; email: string; name: string; }

type TabType = 'inventory' | 'crossmatch' | 'reactions' | 'analytics';

type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
type BloodComponent = 'whole_blood' | 'prbc' | 'ffp' | 'platelet_concentrate' | 'cryoprecipitate' | 'sdp' | 'granulocytes' | 'plasma';
type UnitStatus = 'available' | 'reserved' | 'crossmatched' | 'issued' | 'transfused' | 'returned' | 'expired' | 'discarded';
type CrossmatchStatus = 'requested' | 'sample_received' | 'testing' | 'compatible' | 'incompatible' | 'cancelled';
type ReactionType = 'febrile' | 'allergic' | 'hemolytic_acute' | 'hemolytic_delayed' | 'anaphylactic' | 'trali' | 'taco' | 'septic' | 'other';
type ReactionSeverity = 'mild' | 'moderate' | 'severe' | 'life_threatening' | 'fatal';

interface BloodUnit {
  id: string;
  unit_number: string;
  blood_group: BloodGroup;
  component: BloodComponent;
  status: UnitStatus;
  donor_id: string | null;
  donor_name: string | null;
  donation_date: string | null;
  donation_type: string | null;
  volume_ml: number | null;
  bag_type: string | null;
  anticoagulant: string | null;
  storage_location: string | null;
  storage_temp: string | null;
  expiry_date: string;
  issued_to_patient_id: string | null;
  issued_at: string | null;
  received_from: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
}

interface CrossmatchRequest {
  id: string;
  request_number: string;
  patient_id: string;
  encounter_id: string | null;
  status: CrossmatchStatus;
  patient_blood_group: BloodGroup | null;
  component_requested: BloodComponent;
  units_requested: number;
  urgency: string;
  indication: string | null;
  two_sample_verified: boolean;
  crossmatch_result: string | null;
  crossmatched_units: string[] | null;
  requested_at: string;
}

interface TransfusionReaction {
  id: string;
  patient_id: string;
  unit_id: string | null;
  reaction_type: ReactionType;
  severity: ReactionSeverity;
  onset_minutes: number | null;
  symptoms: string[] | null;
  temperature: string | null;
  blood_pressure: string | null;
  heart_rate: number | null;
  spo2: number | null;
  transfusion_stopped: boolean;
  treatment_given: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  reported_at: string;
}

interface InventoryRow {
  blood_group: BloodGroup;
  component: BloodComponent;
  count: number;
}

interface Stats {
  available_units: number;
  issued_units: number;
  near_expiry: number;
  discarded_units: number;
  pending_crossmatch: number;
  total_reactions: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS: BloodComponent[] = ['whole_blood', 'prbc', 'ffp', 'platelet_concentrate', 'cryoprecipitate', 'sdp', 'granulocytes', 'plasma'];
const COMPONENT_LABELS: Record<BloodComponent, string> = {
  whole_blood: 'Whole Blood', prbc: 'PRBC', ffp: 'FFP',
  platelet_concentrate: 'Platelet Conc.', cryoprecipitate: 'Cryoprecipitate',
  sdp: 'SDP', granulocytes: 'Granulocytes', plasma: 'Plasma',
};
const STATUS_COLORS: Record<UnitStatus, string> = {
  available: '#22c55e', reserved: '#3b82f6', crossmatched: '#a855f7',
  issued: '#f59e0b', transfused: '#06b6d4', returned: '#6b7280',
  expired: '#ef4444', discarded: '#dc2626',
};
const XM_STATUS_COLORS: Record<CrossmatchStatus, string> = {
  requested: '#f59e0b', sample_received: '#3b82f6', testing: '#a855f7',
  compatible: '#22c55e', incompatible: '#ef4444', cancelled: '#6b7280',
};
const SEVERITY_COLORS: Record<ReactionSeverity, string> = {
  mild: '#22c55e', moderate: '#f59e0b', severe: '#ef4444',
  life_threatening: '#dc2626', fatal: '#7f1d1d',
};

function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function daysUntil(d: string) { return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24)); }

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as Record<string,string>).message || res.statusText); }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function BloodBankClient({ user }: { user: User }) {
  const [tab, setTab] = useState<TabType>('inventory');

  const tabs: { key: TabType; label: string }[] = [
    { key: 'inventory', label: 'Inventory' },
    { key: 'crossmatch', label: 'Crossmatch' },
    { key: 'reactions', label: 'Reactions' },
    { key: 'analytics', label: 'Analytics' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Blood Bank</h1>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>Inventory, crossmatch workflow, transfusion reaction surveillance</p>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #334155', paddingBottom: 2 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '8px 20px', borderRadius: '6px 6px 0 0', background: tab === t.key ? '#1e293b' : 'transparent',
                color: tab === t.key ? '#f1f5f9' : '#94a3b8', fontWeight: tab === t.key ? 600 : 400, border: 'none', cursor: 'pointer', fontSize: 14 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'inventory' && <InventoryTab user={user} />}
        {tab === 'crossmatch' && <CrossmatchTab user={user} />}
        {tab === 'reactions' && <ReactionsTab user={user} />}
        {tab === 'analytics' && <AnalyticsTab user={user} />}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 1 — Inventory Grid + Add Unit                                  */
/* ================================================================== */

function InventoryTab({ user }: { user: User }) {
  const [grid, setGrid] = useState<InventoryRow[]>([]);
  const [units, setUnits] = useState<BloodUnit[]>([]);
  const [nearExpiry, setNearExpiry] = useState(0);
  const [filterBG, setFilterBG] = useState<BloodGroup | ''>('');
  const [filterComp, setFilterComp] = useState<BloodComponent | ''>('');
  const [filterStatus, setFilterStatus] = useState<UnitStatus | ''>('');
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadGrid = useCallback(async () => {
    try {
      const r = await api(`/api/trpc/bloodBank.getInventory?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id }))}`);
      const d = r.result?.data;
      setGrid(d?.inventory ?? []);
      setNearExpiry(d?.near_expiry ?? 0);
    } catch { /* ignore */ }
  }, [user.hospital_id]);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { hospital_id: user.hospital_id, limit: 100, offset: 0 };
      if (filterBG) params.blood_group = filterBG;
      if (filterComp) params.component = filterComp;
      if (filterStatus) params.status = filterStatus;
      const r = await api(`/api/trpc/bloodBank.listUnits?input=${encodeURIComponent(JSON.stringify(params))}`);
      setUnits(r.result?.data?.units ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, filterBG, filterComp, filterStatus]);

  useEffect(() => { loadGrid(); loadUnits(); }, [loadGrid, loadUnits]);

  return (
    <div>
      {/* Stock matrix */}
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Stock Matrix (Available Units)</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {nearExpiry > 0 && (
              <span style={{ background: '#7f1d1d', color: '#fca5a5', padding: '4px 12px', borderRadius: 12, fontSize: 13 }}>
                {nearExpiry} near expiry (7d)
              </span>
            )}
            <button onClick={() => setShowAdd(!showAdd)}
              style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              + Add Unit
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: 8, color: '#94a3b8' }}>Component</th>
                {BLOOD_GROUPS.map(bg => <th key={bg} style={{ textAlign: 'center', padding: 8, color: '#94a3b8' }}>{bg}</th>)}
                <th style={{ textAlign: 'center', padding: 8, color: '#94a3b8' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {COMPONENTS.map(comp => {
                const row = BLOOD_GROUPS.map(bg => grid.find(g => g.blood_group === bg && g.component === comp)?.count ?? 0);
                const total = row.reduce((a, b) => a + b, 0);
                return (
                  <tr key={comp} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: 8, fontWeight: 500 }}>{COMPONENT_LABELS[comp]}</td>
                    {row.map((c, i) => (
                      <td key={i} style={{ textAlign: 'center', padding: 8, color: c > 0 ? '#22c55e' : '#475569' }}>{c}</td>
                    ))}
                    <td style={{ textAlign: 'center', padding: 8, fontWeight: 700, color: total > 0 ? '#f1f5f9' : '#475569' }}>{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add unit form */}
      {showAdd && <AddUnitForm user={user} onDone={() => { setShowAdd(false); loadGrid(); loadUnits(); }} />}

      {/* Filters + unit list */}
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <select value={filterBG} onChange={e => setFilterBG(e.target.value as BloodGroup | '')}
            style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
            <option value="">All Blood Groups</option>
            {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
          </select>
          <select value={filterComp} onChange={e => setFilterComp(e.target.value as BloodComponent | '')}
            style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
            <option value="">All Components</option>
            {COMPONENTS.map(c => <option key={c} value={c}>{COMPONENT_LABELS[c]}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as UnitStatus | '')}
            style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
            <option value="">All Statuses</option>
            {(['available','reserved','crossmatched','issued','transfused','returned','expired','discarded'] as UnitStatus[]).map(s =>
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>

        {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Unit #', 'Group', 'Component', 'Status', 'Volume', 'Expiry', 'Days Left', 'Source', 'Storage'].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {units.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No units found</td></tr>
              ) : units.map(u => {
                const days = daysUntil(u.expiry_date);
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>{u.unit_number}</td>
                    <td style={{ padding: 8, fontWeight: 700, color: '#f1f5f9' }}>{u.blood_group}</td>
                    <td style={{ padding: 8 }}>{COMPONENT_LABELS[u.component]}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: STATUS_COLORS[u.status] + '22', color: STATUS_COLORS[u.status] }}>
                        {u.status}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>{u.volume_ml ? `${u.volume_ml} mL` : '—'}</td>
                    <td style={{ padding: 8 }}>{fmtDate(u.expiry_date)}</td>
                    <td style={{ padding: 8, color: days <= 3 ? '#ef4444' : days <= 7 ? '#f59e0b' : '#94a3b8', fontWeight: days <= 7 ? 700 : 400 }}>
                      {days < 0 ? 'EXPIRED' : `${days}d`}
                    </td>
                    <td style={{ padding: 8, color: '#94a3b8' }}>{u.received_from ?? '—'}</td>
                    <td style={{ padding: 8, color: '#94a3b8' }}>{u.storage_location ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Unit Form                                                      */
/* ------------------------------------------------------------------ */

function AddUnitForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [form, setForm] = useState({
    unit_number: '', blood_group: 'O+' as BloodGroup, component: 'prbc' as BloodComponent,
    donor_name: '', donation_type: 'voluntary', volume_ml: '350',
    bag_type: 'triple', anticoagulant: 'CPDA-1', storage_location: '',
    storage_temp: '2-6C', expiry_date: '', received_from: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.unit_number || !form.expiry_date) { setError('Unit number and expiry date required'); return; }
    setSaving(true); setError('');
    try {
      await api('/api/trpc/bloodBank.addUnit', {
        hospital_id: user.hospital_id,
        unit_number: form.unit_number,
        blood_group: form.blood_group,
        component: form.component,
        donor_name: form.donor_name || undefined,
        donation_type: form.donation_type || undefined,
        volume_ml: form.volume_ml ? parseInt(form.volume_ml) : undefined,
        bag_type: form.bag_type || undefined,
        anticoagulant: form.anticoagulant || undefined,
        storage_location: form.storage_location || undefined,
        storage_temp: form.storage_temp || undefined,
        expiry_date: form.expiry_date,
        received_from: form.received_from || undefined,
        notes: form.notes || undefined,
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save'); }
    setSaving(false);
  };

  const inputStyle = { padding: '6px 10px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13, width: '100%' };

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 20, marginBottom: 20, border: '1px solid #dc2626' }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Receive New Unit</h3>
      {error && <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Unit Number *</label>
          <input value={form.unit_number} onChange={e => setForm({...form, unit_number: e.target.value})} style={inputStyle} placeholder="e.g. BB-20260413-001" /></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Blood Group *</label>
          <select value={form.blood_group} onChange={e => setForm({...form, blood_group: e.target.value as BloodGroup})} style={inputStyle}>
            {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}</select></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Component *</label>
          <select value={form.component} onChange={e => setForm({...form, component: e.target.value as BloodComponent})} style={inputStyle}>
            {COMPONENTS.map(c => <option key={c} value={c}>{COMPONENT_LABELS[c]}</option>)}</select></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Expiry Date *</label>
          <input type="date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} style={inputStyle} /></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Volume (mL)</label>
          <input value={form.volume_ml} onChange={e => setForm({...form, volume_ml: e.target.value})} style={inputStyle} /></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Donor Name</label>
          <input value={form.donor_name} onChange={e => setForm({...form, donor_name: e.target.value})} style={inputStyle} /></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Donation Type</label>
          <select value={form.donation_type} onChange={e => setForm({...form, donation_type: e.target.value})} style={inputStyle}>
            <option value="voluntary">Voluntary</option><option value="replacement">Replacement</option><option value="autologous">Autologous</option>
          </select></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Bag Type</label>
          <select value={form.bag_type} onChange={e => setForm({...form, bag_type: e.target.value})} style={inputStyle}>
            <option value="single">Single</option><option value="double">Double</option><option value="triple">Triple</option><option value="quadruple">Quadruple</option>
          </select></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Anticoagulant</label>
          <select value={form.anticoagulant} onChange={e => setForm({...form, anticoagulant: e.target.value})} style={inputStyle}>
            <option value="CPDA-1">CPDA-1</option><option value="SAGM">SAGM</option><option value="ACD">ACD</option>
          </select></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Storage Location</label>
          <input value={form.storage_location} onChange={e => setForm({...form, storage_location: e.target.value})} style={inputStyle} placeholder="e.g. Fridge A-2" /></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Storage Temp</label>
          <select value={form.storage_temp} onChange={e => setForm({...form, storage_temp: e.target.value})} style={inputStyle}>
            <option value="2-6C">2-6°C (RBCs)</option><option value="-18C">-18°C (FFP/Cryo)</option><option value="20-24C">20-24°C (Platelets)</option>
          </select></div>

        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Received From</label>
          <input value={form.received_from} onChange={e => setForm({...form, received_from: e.target.value})} style={inputStyle} placeholder="e.g. Red Cross Blood Bank" /></div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Notes</label>
        <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2}
          style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving...' : 'Save Unit'}
        </button>
        <button onClick={onDone} style={{ padding: '8px 24px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 2 — Crossmatch Requests                                       */
/* ================================================================== */

function CrossmatchTab({ user }: { user: User }) {
  const [requests, setRequests] = useState<CrossmatchRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState<CrossmatchStatus | ''>('');
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { hospital_id: user.hospital_id, limit: 100 };
      if (filterStatus) params.status = filterStatus;
      const r = await api(`/api/trpc/bloodBank.listCrossmatches?input=${encodeURIComponent(JSON.stringify(params))}`);
      setRequests(r.result?.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, filterStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Crossmatch Requests</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as CrossmatchStatus | '')}
              style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
              <option value="">All Statuses</option>
              {(['requested','sample_received','testing','compatible','incompatible','cancelled'] as CrossmatchStatus[]).map(s =>
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <button onClick={() => setShowNew(!showNew)}
              style={{ padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              + New Request
            </button>
          </div>
        </div>

        {showNew && <NewCrossmatchForm user={user} onDone={() => { setShowNew(false); load(); }} />}

        {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Request #', 'Patient', 'Blood Grp', 'Component', 'Units', 'Urgency', 'Status', '2-Sample', 'Requested'].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No crossmatch requests</td></tr>
              ) : requests.map(xm => (
                <tr key={xm.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, fontFamily: 'monospace' }}>{xm.request_number}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{xm.patient_id.slice(0, 8)}...</td>
                  <td style={{ padding: 8, fontWeight: 700 }}>{xm.patient_blood_group ?? '—'}</td>
                  <td style={{ padding: 8 }}>{COMPONENT_LABELS[xm.component_requested]}</td>
                  <td style={{ padding: 8, textAlign: 'center' }}>{xm.units_requested}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: xm.urgency === 'emergency' ? '#7f1d1d' : xm.urgency === 'urgent' ? '#78350f' : '#1e293b',
                      color: xm.urgency === 'emergency' ? '#fca5a5' : xm.urgency === 'urgent' ? '#fcd34d' : '#94a3b8' }}>
                      {xm.urgency}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: XM_STATUS_COLORS[xm.status] + '22', color: XM_STATUS_COLORS[xm.status] }}>
                      {xm.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ padding: 8, textAlign: 'center' }}>
                    {xm.two_sample_verified
                      ? <span style={{ color: '#22c55e', fontWeight: 700 }}>Yes</span>
                      : <span style={{ color: '#f59e0b' }}>No</span>}
                  </td>
                  <td style={{ padding: 8, color: '#94a3b8' }}>{fmtDateTime(xm.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function NewCrossmatchForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [form, setForm] = useState({
    patient_id: '', patient_blood_group: '' as BloodGroup | '',
    component_requested: 'prbc' as BloodComponent, units_requested: '1',
    urgency: 'routine', indication: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.patient_id) { setError('Patient ID required'); return; }
    setSaving(true); setError('');
    try {
      await api('/api/trpc/bloodBank.requestCrossmatch', {
        hospital_id: user.hospital_id,
        patient_id: form.patient_id,
        patient_blood_group: form.patient_blood_group || undefined,
        component_requested: form.component_requested,
        units_requested: parseInt(form.units_requested) || 1,
        urgency: form.urgency,
        indication: form.indication || undefined,
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    setSaving(false);
  };

  const inputStyle = { padding: '6px 10px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13, width: '100%' };

  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #7c3aed' }}>
      {error && <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Patient ID *</label>
          <input value={form.patient_id} onChange={e => setForm({...form, patient_id: e.target.value})} style={inputStyle} placeholder="UUID" /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Patient Blood Group</label>
          <select value={form.patient_blood_group} onChange={e => setForm({...form, patient_blood_group: e.target.value as BloodGroup | ''})} style={inputStyle}>
            <option value="">Unknown</option>{BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}</select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Component</label>
          <select value={form.component_requested} onChange={e => setForm({...form, component_requested: e.target.value as BloodComponent})} style={inputStyle}>
            {COMPONENTS.map(c => <option key={c} value={c}>{COMPONENT_LABELS[c]}</option>)}</select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Units</label>
          <input type="number" min="1" max="20" value={form.units_requested} onChange={e => setForm({...form, units_requested: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Urgency</label>
          <select value={form.urgency} onChange={e => setForm({...form, urgency: e.target.value})} style={inputStyle}>
            <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Indication</label>
          <input value={form.indication} onChange={e => setForm({...form, indication: e.target.value})} style={inputStyle} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving...' : 'Submit Request'}
        </button>
        <button onClick={onDone} style={{ padding: '8px 20px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 3 — Transfusion Reactions                                      */
/* ================================================================== */

function ReactionsTab({ user }: { user: User }) {
  const [reactions, setReactions] = useState<TransfusionReaction[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`/api/trpc/bloodBank.listReactions?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id, limit: 100 }))}`);
      setReactions(r.result?.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Transfusion Reactions</h2>

      {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              {['Patient', 'Unit', 'Type', 'Severity', 'Onset', 'Stopped', 'Vitals', 'Outcome', 'Reported'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {reactions.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No transfusion reactions recorded</td></tr>
            ) : reactions.map(rx => (
              <tr key={rx.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{rx.patient_id.slice(0, 8)}...</td>
                <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{rx.unit_id ? rx.unit_id.slice(0, 8) + '...' : '—'}</td>
                <td style={{ padding: 8 }}>{rx.reaction_type.replace(/_/g, ' ')}</td>
                <td style={{ padding: 8 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    background: SEVERITY_COLORS[rx.severity] + '22', color: SEVERITY_COLORS[rx.severity] }}>
                    {rx.severity.replace(/_/g, ' ')}
                  </span>
                </td>
                <td style={{ padding: 8 }}>{rx.onset_minutes != null ? `${rx.onset_minutes} min` : '—'}</td>
                <td style={{ padding: 8, color: rx.transfusion_stopped ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                  {rx.transfusion_stopped ? 'Yes' : 'No'}
                </td>
                <td style={{ padding: 8, fontSize: 11, color: '#94a3b8' }}>
                  {[rx.temperature && `T:${rx.temperature}`, rx.blood_pressure && `BP:${rx.blood_pressure}`,
                    rx.heart_rate && `HR:${rx.heart_rate}`, rx.spo2 && `SpO2:${rx.spo2}%`].filter(Boolean).join(' ') || '—'}
                </td>
                <td style={{ padding: 8, color: rx.outcome === 'resolved' ? '#22c55e' : rx.outcome === 'death' ? '#ef4444' : '#f59e0b' }}>
                  {rx.outcome ?? '—'}
                </td>
                <td style={{ padding: 8, color: '#94a3b8' }}>{fmtDateTime(rx.reported_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ================================================================== */
/*  TAB 4 — Analytics                                                  */
/* ================================================================== */

function AnalyticsTab({ user }: { user: User }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/api/trpc/bloodBank.stats?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id }))}`);
        setStats(r.result?.data ?? null);
      } catch { /* ignore */ }
    })();
  }, [user.hospital_id]);

  if (!stats) return <p style={{ color: '#64748b' }}>Loading analytics...</p>;

  const cards: { label: string; value: number; color: string; sub?: string }[] = [
    { label: 'Available Units', value: stats.available_units, color: '#22c55e' },
    { label: 'Issued (Active)', value: stats.issued_units, color: '#f59e0b' },
    { label: 'Near Expiry (7d)', value: stats.near_expiry, color: stats.near_expiry > 0 ? '#ef4444' : '#94a3b8' },
    { label: 'Discarded', value: stats.discarded_units, color: '#dc2626' },
    { label: 'Pending Crossmatch', value: stats.pending_crossmatch, color: '#a855f7' },
    { label: 'Total Reactions', value: stats.total_reactions, color: stats.total_reactions > 0 ? '#ef4444' : '#22c55e' },
  ];

  const utilization = stats.available_units + stats.issued_units > 0
    ? ((stats.issued_units / (stats.available_units + stats.issued_units)) * 100).toFixed(1)
    : '0.0';

  const wastage = stats.available_units + stats.discarded_units > 0
    ? ((stats.discarded_units / (stats.available_units + stats.discarded_units)) * 100).toFixed(1)
    : '0.0';

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* KPI gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Utilization Rate</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#3b82f6' }}>{utilization}%</div>
          <div style={{ background: '#0f172a', borderRadius: 4, height: 8, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ background: '#3b82f6', height: '100%', width: `${utilization}%`, borderRadius: 4 }} />
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>Issued / (Available + Issued)</p>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>Wastage Rate</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: parseFloat(wastage) > 5 ? '#ef4444' : '#22c55e' }}>{wastage}%</div>
          <div style={{ background: '#0f172a', borderRadius: 4, height: 8, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ background: parseFloat(wastage) > 5 ? '#ef4444' : '#22c55e', height: '100%', width: `${Math.min(parseFloat(wastage) * 5, 100)}%`, borderRadius: 4 }} />
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>Discarded / (Available + Discarded) — target &lt; 5%</p>
        </div>
      </div>
    </div>
  );
}
