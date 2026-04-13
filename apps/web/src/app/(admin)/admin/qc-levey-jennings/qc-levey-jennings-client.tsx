'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface User { sub: string; hospital_id: string; role: string; email: string; name: string; }

type TabType = 'lots' | 'runs' | 'chart' | 'analytics';
type LotStatus = 'active' | 'expired' | 'depleted';
type RunStatus = 'accepted' | 'rejected' | 'warning' | 'pending_review';

interface QcLot {
  id: string;
  lot_number: string;
  manufacturer: string | null;
  material_name: string;
  level: string;
  analyte: string;
  analyzer: string | null;
  department: string | null;
  unit: string | null;
  target_mean: number;
  target_sd: number;
  target_cv: number | null;
  peer_mean: number | null;
  peer_sd: number | null;
  status: LotStatus;
  expiry_date: string;
  created_at: string;
}

interface QcRun {
  id: string;
  lot_id: string;
  measured_value: number;
  z_score: number | null;
  sd_index: number | null;
  status: RunStatus;
  rule_violated: string;
  action_taken: string | null;
  action_notes: string | null;
  operator: string;
  run_datetime: string;
  shift: string | null;
  reviewed_by: string | null;
}

interface LjChartPoint {
  id: string;
  value: number;
  z_score: number | null;
  status: RunStatus;
  rule_violated: string;
  datetime: string;
  action_taken: string | null;
}

interface LjChartData {
  lot: { id: string; analyte: string; level: string; unit: string | null; analyzer: string | null };
  control_lines: { mean: number; plus_1sd: number; plus_2sd: number; plus_3sd: number; minus_1sd: number; minus_2sd: number; minus_3sd: number };
  runs: LjChartPoint[];
}

interface Stats {
  active_lots: number;
  runs_today: number;
  pending_review: number;
  rejected_today: number;
  warnings_today: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<RunStatus, string> = {
  accepted: '#22c55e', rejected: '#ef4444', warning: '#f59e0b', pending_review: '#3b82f6',
};
const LOT_STATUS_COLORS: Record<LotStatus, string> = {
  active: '#22c55e', expired: '#ef4444', depleted: '#6b7280',
};

function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtDateTime(d: string | null) { return d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as Record<string, string>).message || res.statusText); }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function QcLeveyJenningsClient({ user }: { user: User }) {
  const [tab, setTab] = useState<TabType>('lots');
  const [selectedLot, setSelectedLot] = useState<QcLot | null>(null);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'lots', label: 'QC Lots' },
    { key: 'runs', label: 'QC Runs' },
    { key: 'chart', label: 'LJ Chart' },
    { key: 'analytics', label: 'Analytics' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>QC & Levey-Jennings</h1>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>Westgard multi-rule evaluation, control lot management, LJ charting</p>

        {selectedLot && (
          <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>Selected lot:</span>
            <span style={{ fontWeight: 700 }}>{selectedLot.analyte}</span>
            <span style={{ color: '#94a3b8' }}>—</span>
            <span>{selectedLot.level}</span>
            <span style={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: 12 }}>{selectedLot.lot_number}</span>
            <button onClick={() => setSelectedLot(null)} style={{ marginLeft: 'auto', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>Clear</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #334155', paddingBottom: 2 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '8px 20px', borderRadius: '6px 6px 0 0', background: tab === t.key ? '#1e293b' : 'transparent',
                color: tab === t.key ? '#f1f5f9' : '#94a3b8', fontWeight: tab === t.key ? 600 : 400, border: 'none', cursor: 'pointer', fontSize: 14 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'lots' && <LotsTab user={user} onSelectLot={(lot) => { setSelectedLot(lot); setTab('runs'); }} />}
        {tab === 'runs' && <RunsTab user={user} selectedLot={selectedLot} />}
        {tab === 'chart' && <ChartTab user={user} selectedLot={selectedLot} />}
        {tab === 'analytics' && <AnalyticsTab user={user} />}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 1 — QC Lots                                                    */
/* ================================================================== */

function LotsTab({ user, onSelectLot }: { user: User; onSelectLot: (lot: QcLot) => void }) {
  const [lots, setLots] = useState<QcLot[]>([]);
  const [filterStatus, setFilterStatus] = useState<LotStatus | ''>('');
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { hospital_id: user.hospital_id, limit: 100 };
      if (filterStatus) params.status = filterStatus;
      const r = await api(`/api/trpc/qcLeveyJennings.listLots?input=${encodeURIComponent(JSON.stringify(params))}`);
      setLots(r.result?.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.hospital_id, filterStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Control Material Lots</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as LotStatus | '')}
              style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
              <option value="">All Statuses</option>
              {(['active', 'expired', 'depleted'] as LotStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setShowAdd(!showAdd)}
              style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              + New Lot
            </button>
          </div>
        </div>

        {showAdd && <AddLotForm user={user} onDone={() => { setShowAdd(false); load(); }} />}

        {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Analyte', 'Level', 'Lot #', 'Analyzer', 'Mean', 'SD', 'CV%', 'Status', 'Expiry', ''].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {lots.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No lots found</td></tr>
              ) : lots.map(lot => (
                <tr key={lot.id} style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer' }} onClick={() => onSelectLot(lot)}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{lot.analyte}</td>
                  <td style={{ padding: 8 }}>{lot.level}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{lot.lot_number}</td>
                  <td style={{ padding: 8, color: '#94a3b8' }}>{lot.analyzer ?? '—'}</td>
                  <td style={{ padding: 8 }}>{(lot.peer_mean ?? lot.target_mean).toFixed(2)} {lot.unit ?? ''}</td>
                  <td style={{ padding: 8 }}>{(lot.peer_sd ?? lot.target_sd).toFixed(2)}</td>
                  <td style={{ padding: 8 }}>{lot.target_cv ? `${lot.target_cv.toFixed(1)}%` : '—'}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: LOT_STATUS_COLORS[lot.status] + '22', color: LOT_STATUS_COLORS[lot.status] }}>
                      {lot.status}
                    </span>
                  </td>
                  <td style={{ padding: 8, color: '#94a3b8' }}>{fmtDate(lot.expiry_date)}</td>
                  <td style={{ padding: 8 }}>
                    <button style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                      View Runs →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Lot Form                                                       */
/* ------------------------------------------------------------------ */

function AddLotForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [form, setForm] = useState({
    lot_number: '', manufacturer: '', material_name: '', level: 'Level 1 (Low)',
    analyte: '', analyzer: '', department: '', unit: 'mg/dL',
    target_mean: '', target_sd: '', target_cv: '', expiry_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.lot_number || !form.analyte || !form.target_mean || !form.target_sd || !form.expiry_date) {
      setError('Lot #, analyte, mean, SD, and expiry required'); return;
    }
    setSaving(true); setError('');
    try {
      await api('/api/trpc/qcLeveyJennings.createLot', {
        hospital_id: user.hospital_id,
        lot_number: form.lot_number,
        manufacturer: form.manufacturer || undefined,
        material_name: form.material_name || form.analyte,
        level: form.level,
        analyte: form.analyte,
        analyzer: form.analyzer || undefined,
        department: form.department || undefined,
        unit: form.unit || undefined,
        target_mean: parseFloat(form.target_mean),
        target_sd: parseFloat(form.target_sd),
        target_cv: form.target_cv ? parseFloat(form.target_cv) : undefined,
        expiry_date: form.expiry_date,
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    setSaving(false);
  };

  const inputStyle = { padding: '6px 10px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13, width: '100%' };

  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #3b82f6' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Register New QC Lot</h3>
      {error && <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Lot Number *</label>
          <input value={form.lot_number} onChange={e => setForm({...form, lot_number: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Analyte *</label>
          <input value={form.analyte} onChange={e => setForm({...form, analyte: e.target.value})} style={inputStyle} placeholder="e.g. Glucose" /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Level</label>
          <select value={form.level} onChange={e => setForm({...form, level: e.target.value})} style={inputStyle}>
            <option>Level 1 (Low)</option><option>Level 2 (Normal)</option><option>Level 3 (High)</option>
          </select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Manufacturer</label>
          <input value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Material Name</label>
          <input value={form.material_name} onChange={e => setForm({...form, material_name: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Analyzer</label>
          <input value={form.analyzer} onChange={e => setForm({...form, analyzer: e.target.value})} style={inputStyle} placeholder="e.g. Beckman AU5800" /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Department</label>
          <input value={form.department} onChange={e => setForm({...form, department: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Unit</label>
          <input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Target Mean *</label>
          <input type="number" step="any" value={form.target_mean} onChange={e => setForm({...form, target_mean: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Target SD *</label>
          <input type="number" step="any" value={form.target_sd} onChange={e => setForm({...form, target_sd: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>CV%</label>
          <input type="number" step="any" value={form.target_cv} onChange={e => setForm({...form, target_cv: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Expiry Date *</label>
          <input type="date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} style={inputStyle} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving...' : 'Save Lot'}
        </button>
        <button onClick={onDone} style={{ padding: '8px 20px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 2 — QC Runs                                                    */
/* ================================================================== */

function RunsTab({ user, selectedLot }: { user: User; selectedLot: QcLot | null }) {
  const [runs, setRuns] = useState<QcRun[]>([]);
  const [showRecord, setShowRecord] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedLot) return;
    setLoading(true);
    try {
      const r = await api(`/api/trpc/qcLeveyJennings.listRuns?input=${encodeURIComponent(JSON.stringify({ lot_id: selectedLot.id, limit: 200 }))}`);
      setRuns(r.result?.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedLot]);

  useEffect(() => { load(); }, [load]);

  if (!selectedLot) {
    return (
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 40, textAlign: 'center' }}>
        <p style={{ color: '#64748b', fontSize: 16 }}>Select a QC lot from the Lots tab to view runs</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>QC Runs — {selectedLot.analyte} ({selectedLot.level})</h2>
          <button onClick={() => setShowRecord(!showRecord)}
            style={{ padding: '8px 16px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            + Record Run
          </button>
        </div>

        {showRecord && <RecordRunForm user={user} lotId={selectedLot.id} onDone={() => { setShowRecord(false); load(); }} />}

        {loading ? <p style={{ color: '#64748b' }}>Loading...</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Date/Time', 'Value', 'Z-Score', 'SD Index', 'Status', 'Rule', 'Action', 'Operator', 'Reviewed'].map(h =>
                  <th key={h} style={{ textAlign: 'left', padding: 8, color: '#94a3b8', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No runs recorded yet</td></tr>
              ) : runs.map(run => (
                <tr key={run.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8 }}>{fmtDateTime(run.run_datetime)}</td>
                  <td style={{ padding: 8, fontWeight: 700, fontFamily: 'monospace' }}>{run.measured_value.toFixed(2)}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', color: run.z_score && Math.abs(run.z_score) > 2 ? '#ef4444' : '#94a3b8' }}>
                    {run.z_score?.toFixed(2) ?? '—'}
                  </td>
                  <td style={{ padding: 8, fontFamily: 'monospace' }}>{run.sd_index?.toFixed(1) ?? '—'}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: STATUS_COLORS[run.status] + '22', color: STATUS_COLORS[run.status] }}>
                      {run.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11, color: run.rule_violated !== 'none' ? '#ef4444' : '#475569' }}>
                    {run.rule_violated === 'none' ? '—' : run.rule_violated}
                  </td>
                  <td style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>{run.action_taken ?? '—'}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>{run.operator.slice(0, 8)}...</td>
                  <td style={{ padding: 8, color: run.reviewed_by ? '#22c55e' : '#f59e0b', fontSize: 12 }}>
                    {run.reviewed_by ? 'Yes' : 'Pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RecordRunForm({ user, lotId, onDone }: { user: User; lotId: string; onDone: () => void }) {
  const [form, setForm] = useState({ measured_value: '', shift: 'morning', temperature: '', reagent_lot: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ status: string; rule_violated: string } | null>(null);

  const save = async () => {
    if (!form.measured_value) { setError('Measured value required'); return; }
    setSaving(true); setError(''); setResult(null);
    try {
      const r = await api('/api/trpc/qcLeveyJennings.recordRun', {
        hospital_id: user.hospital_id,
        lot_id: lotId,
        measured_value: parseFloat(form.measured_value),
        shift: form.shift || undefined,
        temperature: form.temperature ? parseFloat(form.temperature) : undefined,
        reagent_lot: form.reagent_lot || undefined,
      });
      const westgard = r.result?.data?.westgard;
      if (westgard) setResult({ status: westgard.status, rule_violated: westgard.rule_violated });
      setTimeout(() => onDone(), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    setSaving(false);
  };

  const inputStyle = { padding: '6px 10px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13, width: '100%' };

  return (
    <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #22c55e' }}>
      {error && <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: 8, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {result && (
        <div style={{ background: result.status === 'accepted' ? '#14532d' : result.status === 'rejected' ? '#7f1d1d' : '#78350f',
          color: result.status === 'accepted' ? '#86efac' : result.status === 'rejected' ? '#fca5a5' : '#fcd34d',
          padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
          Westgard: {result.status.toUpperCase()} {result.rule_violated !== 'none' ? `(${result.rule_violated})` : ''}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Measured Value *</label>
          <input type="number" step="any" value={form.measured_value} onChange={e => setForm({...form, measured_value: e.target.value})} style={inputStyle} autoFocus /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Shift</label>
          <select value={form.shift} onChange={e => setForm({...form, shift: e.target.value})} style={inputStyle}>
            <option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="night">Night</option>
          </select></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Ambient Temp (°C)</label>
          <input type="number" step="0.1" value={form.temperature} onChange={e => setForm({...form, temperature: e.target.value})} style={inputStyle} /></div>
        <div><label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Reagent Lot</label>
          <input value={form.reagent_lot} onChange={e => setForm({...form, reagent_lot: e.target.value})} style={inputStyle} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '8px 20px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Evaluating...' : 'Record & Evaluate'}
        </button>
        <button onClick={onDone} style={{ padding: '8px 20px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB 3 — Levey-Jennings Chart (Canvas)                              */
/* ================================================================== */

function ChartTab({ user, selectedLot }: { user: User; selectedLot: QcLot | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [chartData, setChartData] = useState<LjChartData | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!selectedLot) return;
    (async () => {
      try {
        const r = await api(`/api/trpc/qcLeveyJennings.ljChartData?input=${encodeURIComponent(JSON.stringify({ lot_id: selectedLot.id, days }))}`);
        setChartData(r.result?.data ?? null);
      } catch { /* ignore */ }
    })();
  }, [selectedLot, days]);

  useEffect(() => {
    if (!chartData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { control_lines: cl, runs } = chartData;
    const W = canvas.width;
    const H = canvas.height;
    const pad = { top: 40, right: 30, bottom: 50, left: 70 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    // Y range: mean ± 4 SD
    const yMin = cl.mean - 4 * (cl.plus_1sd - cl.mean);
    const yMax = cl.mean + 4 * (cl.plus_1sd - cl.mean);
    const yScale = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const xScale = (i: number) => pad.left + (runs.length > 1 ? (i / (runs.length - 1)) * plotW : plotW / 2);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    // Control line bands
    const bands = [
      { y1: cl.plus_3sd, y2: cl.plus_2sd, color: 'rgba(239,68,68,0.08)' },
      { y1: cl.plus_2sd, y2: cl.plus_1sd, color: 'rgba(245,158,11,0.08)' },
      { y1: cl.plus_1sd, y2: cl.minus_1sd, color: 'rgba(34,197,94,0.06)' },
      { y1: cl.minus_1sd, y2: cl.minus_2sd, color: 'rgba(245,158,11,0.08)' },
      { y1: cl.minus_2sd, y2: cl.minus_3sd, color: 'rgba(239,68,68,0.08)' },
    ];
    for (const b of bands) {
      ctx.fillStyle = b.color;
      ctx.fillRect(pad.left, yScale(b.y1), plotW, yScale(b.y2) - yScale(b.y1));
    }

    // Control lines
    const drawLine = (y: number, color: string, label: string, dash?: number[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash ?? []);
      ctx.beginPath();
      ctx.moveTo(pad.left, yScale(y));
      ctx.lineTo(pad.left + plotW, yScale(y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${label} (${y.toFixed(1)})`, pad.left - 6, yScale(y) + 4);
    };

    drawLine(cl.mean, '#22c55e', 'Mean');
    drawLine(cl.plus_1sd, '#f59e0b', '+1SD', [4, 4]);
    drawLine(cl.minus_1sd, '#f59e0b', '-1SD', [4, 4]);
    drawLine(cl.plus_2sd, '#ef4444', '+2SD', [6, 3]);
    drawLine(cl.minus_2sd, '#ef4444', '-2SD', [6, 3]);
    drawLine(cl.plus_3sd, '#dc2626', '+3SD');
    drawLine(cl.minus_3sd, '#dc2626', '-3SD');

    // Data line
    if (runs.length > 1) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      runs.forEach((r, i) => {
        const x = xScale(i), y = yScale(r.value);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Data points
    runs.forEach((r, i) => {
      const x = xScale(i), y = yScale(r.value);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      const color = r.status === 'rejected' ? '#ef4444' : r.status === 'warning' ? '#f59e0b' : '#22c55e';
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Title
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Levey-Jennings — ${chartData.lot.analyte} (${chartData.lot.level})`, W / 2, 24);

    // X-axis dates (first, middle, last)
    if (runs.length > 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const showIndices = [0, Math.floor(runs.length / 2), runs.length - 1].filter((v, i, a) => a.indexOf(v) === i);
      for (const idx of showIndices) {
        ctx.fillText(fmtDate(runs[idx].datetime), xScale(idx), H - 10);
      }
    }
  }, [chartData]);

  if (!selectedLot) {
    return (
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 40, textAlign: 'center' }}>
        <p style={{ color: '#64748b', fontSize: 16 }}>Select a QC lot from the Lots tab to view the LJ chart</p>
      </div>
    );
  }

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Levey-Jennings Chart</h2>
        <select value={days} onChange={e => setDays(parseInt(e.target.value))}
          style={{ padding: '6px 12px', background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, fontSize: 13 }}>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {!chartData ? <p style={{ color: '#64748b' }}>Loading chart data...</p> : chartData.runs.length === 0 ? (
        <p style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No runs in selected period</p>
      ) : (
        <canvas ref={canvasRef} width={1200} height={500} style={{ width: '100%', height: 'auto', borderRadius: 8 }} />
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} /> Accepted
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} /> Warning
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} /> Rejected
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 2, background: '#22c55e', display: 'inline-block' }} /> Mean
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 2, background: '#f59e0b', display: 'inline-block', borderTop: '1px dashed #f59e0b' }} /> ±1SD
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 2, background: '#ef4444', display: 'inline-block' }} /> ±2SD / ±3SD
        </span>
      </div>
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
        const r = await api(`/api/trpc/qcLeveyJennings.stats?input=${encodeURIComponent(JSON.stringify({ hospital_id: user.hospital_id }))}`);
        setStats(r.result?.data ?? null);
      } catch { /* ignore */ }
    })();
  }, [user.hospital_id]);

  if (!stats) return <p style={{ color: '#64748b' }}>Loading analytics...</p>;

  const cards: { label: string; value: number; color: string }[] = [
    { label: 'Active Lots', value: stats.active_lots, color: '#3b82f6' },
    { label: 'Runs Today', value: stats.runs_today, color: '#22c55e' },
    { label: 'Pending Review', value: stats.pending_review, color: '#f59e0b' },
    { label: 'Rejected Today', value: stats.rejected_today, color: stats.rejected_today > 0 ? '#ef4444' : '#22c55e' },
    { label: 'Warnings Today', value: stats.warnings_today, color: stats.warnings_today > 0 ? '#f59e0b' : '#22c55e' },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#1e293b', borderRadius: 8, padding: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Westgard Rules Reference</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 8, color: '#94a3b8' }}>Rule</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#94a3b8' }}>Trigger</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#94a3b8' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['1-2s', '1 value > ±2 SD', 'WARNING — investigate'],
              ['1-3s', '1 value > ±3 SD', 'REJECT — random error'],
              ['2-2s', '2 consecutive > ±2 SD (same side)', 'REJECT — systematic error'],
              ['R-4s', 'Consecutive differ by > 4 SD', 'REJECT — random error'],
              ['4-1s', '4 consecutive > ±1 SD (same side)', 'REJECT — systematic shift'],
              ['7-T', '7 consecutive trending up or down', 'WARNING — drift detected'],
              ['7-x', '7 consecutive on same side of mean', 'WARNING — systematic bias'],
              ['10-x', '10 consecutive on same side of mean', 'REJECT — significant bias'],
            ].map(([rule, trigger, action]) => (
              <tr key={rule} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 8, fontFamily: 'monospace', fontWeight: 600 }}>{rule}</td>
                <td style={{ padding: 8 }}>{trigger}</td>
                <td style={{ padding: 8, color: action.startsWith('REJECT') ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
