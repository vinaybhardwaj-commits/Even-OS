'use client';

import { useState, useEffect, useCallback } from 'react';

// ── tRPC helpers ────────────────────────────────────────────────────────────
async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.message || JSON.stringify(json.error));
  return json.result?.data?.json;
}

// ── Types ───────────────────────────────────────────────────────────────────
type AdminTab = 'lots' | 'runs' | 'westgard' | 'eqas' | 'stats';

interface Props {
  userId: string;
  userRole: string;
  userName: string;
  breadcrumbs: { label: string; href?: string }[];
}

// ── Format helpers ──────────────────────────────────────────────────────────
function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDecimal(val: string | number | null | undefined, places = 4): string {
  if (!val) return '0.00';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return num.toFixed(places);
}

function getStatusBadgeColor(status: string): string {
  if (status === 'pass') return '#e8f5e9';
  if (status === 'warning') return '#fff3e0';
  if (status === 'fail') return '#ffebee';
  return '#f5f5f5';
}

function getStatusBadgeTextColor(status: string): string {
  if (status === 'pass') return '#2e7d32';
  if (status === 'warning') return '#e65100';
  if (status === 'fail') return '#c62828';
  return '#424242';
}

function getPerformanceBadgeColor(rating: string): string {
  if (rating === 'acceptable') return '#e8f5e9';
  if (rating === 'warning') return '#fff3e0';
  if (rating === 'unacceptable') return '#ffebee';
  return '#f5f5f5';
}

function getPerformanceBadgeTextColor(rating: string): string {
  if (rating === 'acceptable') return '#2e7d32';
  if (rating === 'warning') return '#e65100';
  if (rating === 'unacceptable') return '#c62828';
  return '#424242';
}

// ── Component ───────────────────────────────────────────────────────────────
export default function QCEnhancementAdminClient({
  userId,
  userRole,
  userName,
  breadcrumbs,
}: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('lots');
  const [loading, setLoading] = useState(true);
  const [lots, setLots] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [westgardRules, setWestgardRules] = useState<any[]>([]);
  const [eqasResults, setEqasResults] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [components, setComponents] = useState<any[]>([]);

  const [filterComponent, setFilterComponent] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [search, setSearch] = useState('');
  const [filterLot, setFilterLot] = useState('');
  const [filterScheme, setFilterScheme] = useState('');

  const [showCreateLot, setShowCreateLot] = useState(false);
  const [showRecordRun, setShowRecordRun] = useState(false);
  const [showRecordEqas, setShowRecordEqas] = useState(false);

  const [lotForm, setLotForm] = useState({
    lot_number: '',
    material_name: '',
    manufacturer: '',
    level: 'level_1',
    component_id: '',
    target_mean: '',
    target_sd: '',
    unit: '',
    received_date: new Date().toISOString().slice(0, 16),
    expiry_date: '',
    opened_date: '',
  });

  const [runForm, setRunForm] = useState({
    lot_id: '',
    measured_value: '',
    instrument: '',
    notes: '',
  });

  const [eqasForm, setEqasForm] = useState({
    scheme_name: '',
    cycle_name: '',
    component_id: '',
    sample_id: '',
    reported_value: '',
    expected_value: '',
    peer_group_mean: '',
    peer_group_sd: '',
    peer_group_cv: '',
    reported_date: new Date().toISOString().slice(0, 16),
    notes: '',
  });

  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [lotList, runList, rules, eqasList, statsData] = await Promise.all([
        trpcQuery('qcEnhancement.listLots', {
          component_id: filterComponent || undefined,
          level: filterLevel || undefined,
          search: search || undefined,
          pageSize: 100,
        }),
        trpcQuery('qcEnhancement.listRuns', {
          lot_id: filterLot || undefined,
          pageSize: 100,
        }),
        trpcQuery('qcEnhancement.getWestgardConfig'),
        trpcQuery('qcEnhancement.listEqas', {
          scheme_name: filterScheme || undefined,
          pageSize: 100,
        }),
        trpcQuery('qcEnhancement.stats'),
      ]);
      setLots(lotList?.items || []);
      setRuns(runList?.items || []);
      setWestgardRules(rules?.items || []);
      setEqasResults(eqasList?.items || []);
      setStats(statsData || {});
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterComponent, filterLevel, search, filterLot, filterScheme]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load components on mount
  useEffect(() => {
    (async () => {
      try {
        // Fetch lab panel components
        const comps = await trpcQuery('labRadiology.listComponents');
        setComponents(comps?.items || []);
      } catch (err) {
        console.error('Error loading components:', err);
      }
    })();
  }, []);

  // ── Create Lot ───────────────────────────────────────────────────────
  const handleCreateLot = async () => {
    try {
      if (!lotForm.lot_number || !lotForm.material_name || !lotForm.component_id) {
        alert('Please fill in required fields');
        return;
      }
      setCreating(true);
      const payload = {
        ...lotForm,
        received_date: lotForm.received_date || undefined,
        expiry_date: lotForm.expiry_date || undefined,
        opened_date: lotForm.opened_date || undefined,
      };
      await trpcMutate('qcEnhancement.createLot', payload);
      alert('QC lot created');
      setLotForm({
        lot_number: '',
        material_name: '',
        manufacturer: '',
        level: 'level_1',
        component_id: '',
        target_mean: '',
        target_sd: '',
        unit: '',
        received_date: new Date().toISOString().slice(0, 16),
        expiry_date: '',
        opened_date: '',
      });
      setShowCreateLot(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  // ── Record Run ───────────────────────────────────────────────────────
  const handleRecordRun = async () => {
    try {
      if (!runForm.lot_id || !runForm.measured_value) {
        alert('Please select lot and enter value');
        return;
      }
      setRecording(true);
      await trpcMutate('qcEnhancement.recordRun', runForm);
      alert('QC run recorded');
      setRunForm({ lot_id: '', measured_value: '', instrument: '', notes: '' });
      setShowRecordRun(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRecording(false);
    }
  };

  // ── Record EQAS ──────────────────────────────────────────────────────
  const handleRecordEqas = async () => {
    try {
      if (!eqasForm.scheme_name || !eqasForm.reported_value) {
        alert('Please fill in required fields');
        return;
      }
      setRecording(true);
      await trpcMutate('qcEnhancement.recordEqas', eqasForm);
      alert('EQAS result recorded');
      setEqasForm({
        scheme_name: '',
        cycle_name: '',
        component_id: '',
        sample_id: '',
        reported_value: '',
        expected_value: '',
        peer_group_mean: '',
        peer_group_sd: '',
        peer_group_cv: '',
        reported_date: new Date().toISOString().slice(0, 16),
        notes: '',
      });
      setShowRecordEqas(false);
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRecording(false);
    }
  };

  // ── Toggle Westgard Rule ─────────────────────────────────────────────
  const handleToggleWestgardRule = async (ruleId: string, field: string, value: boolean) => {
    try {
      await trpcMutate('qcEnhancement.updateWestgardRule', {
        id: ruleId,
        [field]: value,
      });
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // ── Toggle Lot Active ────────────────────────────────────────────────
  const handleToggleLotActive = async (lotId: string, currentActive: boolean) => {
    try {
      await trpcMutate('qcEnhancement.toggleLotActive', {
        id: lotId,
        is_active: !currentActive,
      });
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // ── Sign Off Run ─────────────────────────────────────────────────────
  const handleSignOffRun = async (runId: string) => {
    try {
      await trpcMutate('qcEnhancement.signOffRun', { run_id: runId });
      loadData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <h1>QC Enhancement</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', fontSize: '14px' }}>
      {/* Breadcrumbs */}
      <div style={{ marginBottom: '20px', fontSize: '12px', color: '#999' }}>
        {breadcrumbs.map((b, i) => (
          <span key={i}>
            {b.href ? <a href={b.href} style={{ color: '#0066cc' }}>{b.label}</a> : b.label}
            {i < breadcrumbs.length - 1 && ' / '}
          </span>
        ))}
      </div>

      <h1 style={{ marginBottom: '20px' }}>QC Enhancement</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: '20px' }}>
        {(['lots', 'runs', 'westgard', 'eqas', 'stats'] as AdminTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: activeTab === tab ? '#0066cc' : '#f5f5f5',
              color: activeTab === tab ? 'white' : '#333',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 'bold' : 'normal',
            }}
          >
            {tab === 'lots' && 'QC Lots'}
            {tab === 'runs' && 'QC Runs'}
            {tab === 'westgard' && 'Westgard Rules'}
            {tab === 'eqas' && 'EQAS Results'}
            {tab === 'stats' && 'Statistics'}
          </button>
        ))}
      </div>

      {/* TAB: QC Lots */}
      {activeTab === 'lots' && (
        <div>
          <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search lot number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', minWidth: '200px' }}
            />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
            >
              <option value="">All Levels</option>
              <option value="level_1">Level 1</option>
              <option value="level_2">Level 2</option>
              <option value="level_3">Level 3</option>
            </select>
            <button
              onClick={() => setShowCreateLot(!showCreateLot)}
              style={{
                padding: '8px 16px',
                background: '#0066cc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              + New Lot
            </button>
          </div>

          {/* Create Lot Form */}
          {showCreateLot && (
            <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '4px', marginBottom: '20px' }}>
              <h3>Create QC Lot</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Lot Number *"
                  value={lotForm.lot_number}
                  onChange={(e) => setLotForm({ ...lotForm, lot_number: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="text"
                  placeholder="Material Name *"
                  value={lotForm.material_name}
                  onChange={(e) => setLotForm({ ...lotForm, material_name: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="text"
                  placeholder="Manufacturer"
                  value={lotForm.manufacturer}
                  onChange={(e) => setLotForm({ ...lotForm, manufacturer: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <select
                  value={lotForm.level}
                  onChange={(e) => setLotForm({ ...lotForm, level: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                >
                  <option value="level_1">Level 1</option>
                  <option value="level_2">Level 2</option>
                  <option value="level_3">Level 3</option>
                </select>
                <select
                  value={lotForm.component_id}
                  onChange={(e) => setLotForm({ ...lotForm, component_id: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                >
                  <option value="">Select Component *</option>
                  {components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.test_name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Target Mean"
                  value={lotForm.target_mean}
                  onChange={(e) => setLotForm({ ...lotForm, target_mean: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Target SD"
                  value={lotForm.target_sd}
                  onChange={(e) => setLotForm({ ...lotForm, target_sd: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="text"
                  placeholder="Unit"
                  value={lotForm.unit}
                  onChange={(e) => setLotForm({ ...lotForm, unit: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="datetime-local"
                  value={lotForm.received_date}
                  onChange={(e) => setLotForm({ ...lotForm, received_date: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="datetime-local"
                  value={lotForm.expiry_date}
                  onChange={(e) => setLotForm({ ...lotForm, expiry_date: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>
              <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleCreateLot}
                  disabled={creating}
                  style={{
                    padding: '8px 16px',
                    background: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => setShowCreateLot(false)}
                  style={{
                    padding: '8px 16px',
                    background: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Lots Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Lot Number</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Material</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Level</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Component</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Target Mean ± SD</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Unit</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Expiry Date</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => {
                  const now = new Date();
                  const expiry = lot.expiry_date ? new Date(lot.expiry_date) : null;
                  const daysToExpiry = expiry ? Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
                  const expiryBg =
                    lot.is_expired || (daysToExpiry !== null && daysToExpiry < 0)
                      ? '#ffebee'
                      : daysToExpiry !== null && daysToExpiry < 30
                        ? '#fff3e0'
                        : 'transparent';

                  return (
                    <tr key={lot.id} style={{ borderBottom: '1px solid #eee', background: expiryBg }}>
                      <td style={{ padding: '10px' }}>{lot.lot_number}</td>
                      <td style={{ padding: '10px' }}>{lot.material_name}</td>
                      <td style={{ padding: '10px' }}>{lot.level}</td>
                      <td style={{ padding: '10px' }}>{lot.component_name || '—'}</td>
                      <td style={{ padding: '10px' }}>
                        {formatDecimal(lot.target_mean, 2)} ± {formatDecimal(lot.target_sd, 2)}
                      </td>
                      <td style={{ padding: '10px' }}>{lot.unit}</td>
                      <td style={{ padding: '10px' }}>{formatDate(lot.expiry_date)}</td>
                      <td style={{ padding: '10px' }}>
                        {lot.is_active ? (
                          <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>Active</span>
                        ) : (
                          <span style={{ color: '#c62828', fontWeight: 'bold' }}>Inactive</span>
                        )}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <button
                          onClick={() => handleToggleLotActive(lot.id, lot.is_active)}
                          style={{
                            padding: '4px 8px',
                            background: lot.is_active ? '#ff9800' : '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '12px',
                          }}
                        >
                          {lot.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: QC Runs */}
      {activeTab === 'runs' && (
        <div>
          <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <select
              value={filterLot}
              onChange={(e) => setFilterLot(e.target.value)}
              style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', minWidth: '200px' }}
            >
              <option value="">All Lots</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.lot_number} - {lot.material_name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowRecordRun(!showRecordRun)}
              style={{
                padding: '8px 16px',
                background: '#0066cc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              + Record Run
            </button>
          </div>

          {/* Record Run Form */}
          {showRecordRun && (
            <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '4px', marginBottom: '20px' }}>
              <h3>Record QC Run</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <select
                  value={runForm.lot_id}
                  onChange={(e) => setRunForm({ ...runForm, lot_id: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                >
                  <option value="">Select Lot *</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.lot_number}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Measured Value *"
                  step="0.0001"
                  value={runForm.measured_value}
                  onChange={(e) => setRunForm({ ...runForm, measured_value: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="text"
                  placeholder="Instrument"
                  value={runForm.instrument}
                  onChange={(e) => setRunForm({ ...runForm, instrument: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <textarea
                  placeholder="Notes"
                  value={runForm.notes}
                  onChange={(e) => setRunForm({ ...runForm, notes: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', gridColumn: '1 / -1' }}
                />
              </div>
              <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleRecordRun}
                  disabled={recording}
                  style={{
                    padding: '8px 16px',
                    background: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {recording ? 'Recording...' : 'Record'}
                </button>
                <button
                  onClick={() => setShowRecordRun(false)}
                  style={{
                    padding: '8px 16px',
                    background: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Runs Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Lot</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Value</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Z-Score</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Violations</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Tech</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Signed Off</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px' }}>{formatDate(run.run_date)}</td>
                    <td style={{ padding: '10px' }}>{run.lot_number}</td>
                    <td style={{ padding: '10px' }}>{formatDecimal(run.measured_value, 4)}</td>
                    <td style={{ padding: '10px' }}>{formatDecimal(run.z_score, 4)}</td>
                    <td style={{ padding: '10px' }}>
                      <span
                        style={{
                          background: getStatusBadgeColor(run.result_status),
                          color: getStatusBadgeTextColor(run.result_status),
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontWeight: 'bold',
                        }}
                      >
                        {run.result_status?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px' }}>
                      {run.westgard_violations && run.westgard_violations.length > 0
                        ? run.westgard_violations.map((v: any) => v.rule_code).join(', ')
                        : '—'}
                    </td>
                    <td style={{ padding: '10px' }}>{run.tech_name}</td>
                    <td style={{ padding: '10px' }}>
                      {run.tech_sign_off ? (
                        <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>✓</span>
                      ) : (
                        <span style={{ color: '#999' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px' }}>
                      {!run.tech_sign_off && (
                        <button
                          onClick={() => handleSignOffRun(run.id)}
                          style={{
                            padding: '4px 8px',
                            background: '#2196f3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '12px',
                          }}
                        >
                          Sign Off
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Westgard Rules */}
      {activeTab === 'westgard' && (
        <div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Rule Code</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Rule Name</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Description</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Warning</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Reject</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Block Results</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Active</th>
                </tr>
              </thead>
              <tbody>
                {westgardRules.map((rule) => (
                  <tr key={rule.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px', fontWeight: 'bold' }}>{rule.rule_code}</td>
                    <td style={{ padding: '10px' }}>{rule.rule_name}</td>
                    <td style={{ padding: '10px', maxWidth: '300px' }}>{rule.description || '—'}</td>
                    <td style={{ padding: '10px' }}>
                      {rule.is_warning ? <span style={{ color: '#2e7d32' }}>✓</span> : '—'}
                    </td>
                    <td style={{ padding: '10px' }}>
                      {rule.is_reject ? <span style={{ color: '#2e7d32' }}>✓</span> : '—'}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <input
                        type="checkbox"
                        checked={rule.block_patient_results}
                        onChange={(e) =>
                          handleToggleWestgardRule(rule.id, 'block_patient_results', e.target.checked)
                        }
                      />
                    </td>
                    <td style={{ padding: '10px' }}>
                      <input
                        type="checkbox"
                        checked={rule.is_active}
                        onChange={(e) =>
                          handleToggleWestgardRule(rule.id, 'is_active', e.target.checked)
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: EQAS Results */}
      {activeTab === 'eqas' && (
        <div>
          <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search scheme..."
              value={filterScheme}
              onChange={(e) => setFilterScheme(e.target.value)}
              style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', minWidth: '200px' }}
            />
            <button
              onClick={() => setShowRecordEqas(!showRecordEqas)}
              style={{
                padding: '8px 16px',
                background: '#0066cc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              + Record EQAS
            </button>
          </div>

          {/* Record EQAS Form */}
          {showRecordEqas && (
            <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '4px', marginBottom: '20px' }}>
              <h3>Record EQAS Result</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Scheme Name *"
                  value={eqasForm.scheme_name}
                  onChange={(e) => setEqasForm({ ...eqasForm, scheme_name: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="text"
                  placeholder="Cycle Name"
                  value={eqasForm.cycle_name}
                  onChange={(e) => setEqasForm({ ...eqasForm, cycle_name: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <select
                  value={eqasForm.component_id}
                  onChange={(e) => setEqasForm({ ...eqasForm, component_id: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                >
                  <option value="">Select Component</option>
                  {components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.test_name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Sample ID"
                  value={eqasForm.sample_id}
                  onChange={(e) => setEqasForm({ ...eqasForm, sample_id: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Reported Value *"
                  step="0.0001"
                  value={eqasForm.reported_value}
                  onChange={(e) => setEqasForm({ ...eqasForm, reported_value: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Expected Value"
                  step="0.0001"
                  value={eqasForm.expected_value}
                  onChange={(e) => setEqasForm({ ...eqasForm, expected_value: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Peer Group Mean *"
                  step="0.0001"
                  value={eqasForm.peer_group_mean}
                  onChange={(e) => setEqasForm({ ...eqasForm, peer_group_mean: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Peer Group SD *"
                  step="0.0001"
                  value={eqasForm.peer_group_sd}
                  onChange={(e) => setEqasForm({ ...eqasForm, peer_group_sd: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Peer Group CV"
                  step="0.0001"
                  value={eqasForm.peer_group_cv}
                  onChange={(e) => setEqasForm({ ...eqasForm, peer_group_cv: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <input
                  type="datetime-local"
                  value={eqasForm.reported_date}
                  onChange={(e) => setEqasForm({ ...eqasForm, reported_date: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <textarea
                  placeholder="Notes"
                  value={eqasForm.notes}
                  onChange={(e) => setEqasForm({ ...eqasForm, notes: e.target.value })}
                  style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', gridColumn: '1 / -1' }}
                />
              </div>
              <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleRecordEqas}
                  disabled={recording}
                  style={{
                    padding: '8px 16px',
                    background: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {recording ? 'Recording...' : 'Record'}
                </button>
                <button
                  onClick={() => setShowRecordEqas(false)}
                  style={{
                    padding: '8px 16px',
                    background: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* EQAS Results Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Scheme</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Cycle</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Component</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Reported</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Expected</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>SDI</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Performance</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {eqasResults.map((result) => (
                  <tr key={result.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px' }}>{result.scheme_name}</td>
                    <td style={{ padding: '10px' }}>{result.cycle_name || '—'}</td>
                    <td style={{ padding: '10px' }}>{result.component_name || '—'}</td>
                    <td style={{ padding: '10px' }}>{formatDecimal(result.reported_value, 4)}</td>
                    <td style={{ padding: '10px' }}>{formatDecimal(result.expected_value, 4)}</td>
                    <td style={{ padding: '10px' }}>{formatDecimal(result.sdi, 4)}</td>
                    <td style={{ padding: '10px' }}>
                      <span
                        style={{
                          background: getPerformanceBadgeColor(result.performance_rating),
                          color: getPerformanceBadgeTextColor(result.performance_rating),
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontWeight: 'bold',
                        }}
                      >
                        {result.performance_rating?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px' }}>{formatDate(result.reported_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Statistics */}
      {activeTab === 'stats' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div style={{ background: '#e8f5e9', padding: '20px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Active Lots</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#2e7d32' }}>
                {stats?.active_lots_count || 0}
              </div>
            </div>
            <div style={{ background: '#fff3e0', padding: '20px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Runs This Month</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#e65100' }}>
                {stats?.runs_this_month || 0}
              </div>
            </div>
            <div style={{ background: '#e3f2fd', padding: '20px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Pass Count</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#1976d2' }}>
                {stats?.runs_by_status?.find((s: any) => s.status === 'pass')?.cnt || 0}
              </div>
            </div>
            <div style={{ background: '#ffebee', padding: '20px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Fail Count</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#c62828' }}>
                {stats?.runs_by_status?.find((s: any) => s.status === 'fail')?.cnt || 0}
              </div>
            </div>
          </div>

          <h3>EQAS Performance Summary</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Performance Rating</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {stats?.eqas_by_performance?.map((row: any) => (
                  <tr key={row.rating} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px' }}>
                      <span
                        style={{
                          background: getPerformanceBadgeColor(row.rating),
                          color: getPerformanceBadgeTextColor(row.rating),
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontWeight: 'bold',
                        }}
                      >
                        {row.rating?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px' }}>{row.cnt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
