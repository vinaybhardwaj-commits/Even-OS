'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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

const categoryColors: Record<string, { bg: string; text: string }> = {
  census: { bg: 'bg-blue-50', text: 'text-blue-800' },
  finance: { bg: 'bg-green-50', text: 'text-green-800' },
  quality: { bg: 'bg-purple-50', text: 'text-purple-800' },
  staffing: { bg: 'bg-yellow-50', text: 'text-yellow-800' },
  infection: { bg: 'bg-red-50', text: 'text-red-800' },
  los: { bg: 'bg-indigo-50', text: 'text-indigo-800' },
  billing: { bg: 'bg-emerald-50', text: 'text-emerald-800' },
  compliance: { bg: 'bg-orange-50', text: 'text-orange-800' },
  incidents: { bg: 'bg-pink-50', text: 'text-pink-800' },
};

const tierLabels: Record<number, string> = {
  1: 'Wall View',
  2: 'MOD',
  3: 'GM',
  4: 'CEO',
};

interface KpiDefinition {
  id: string;
  kpi_name: string;
  kpi_code: string;
  description: string | null;
  formula_type: string;
  refresh_cadence: string;
  target_value: string | null;
  warning_threshold: string | null;
  critical_threshold: string | null;
  unit: string | null;
  display_format: string | null;
  dashboard_tiers: number[];
  category: string | null;
  enabled: boolean;
}

export function KpiDefinitionsClient() {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterTier, setFilterTier] = useState<number | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingKpi, setEditingKpi] = useState<KpiDefinition | null>(null);

  // Form state
  const [form, setForm] = useState({
    kpi_name: '', kpi_code: '', description: '',
    formula_type: 'sql_query' as string,
    formula_query: '', data_source: '',
    refresh_cadence: 'hourly' as string,
    target_value: '', warning_threshold: '', critical_threshold: '',
    unit: '', display_format: 'integer' as string,
    dashboard_tiers: [3] as number[],
    category: 'census' as string,
  });

  const loadKpis = async () => {
    try {
      setLoading(true);
      const input: any = { enabled_only: true };
      if (filterCategory) input.category = filterCategory;
      if (filterTier) input.tier = filterTier;
      const data = await trpcQuery('dashboards.listKpis', input);
      setKpis(data.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadKpis(); }, [filterCategory, filterTier]);

  const handleSubmit = async () => {
    try {
      const payload: any = {
        ...form,
        target_value: form.target_value ? parseFloat(form.target_value) : undefined,
        warning_threshold: form.warning_threshold ? parseFloat(form.warning_threshold) : undefined,
        critical_threshold: form.critical_threshold ? parseFloat(form.critical_threshold) : undefined,
      };

      if (editingKpi) {
        await trpcMutate('dashboards.updateKpi', { id: editingKpi.id, ...payload });
      } else {
        await trpcMutate('dashboards.createKpi', payload);
      }
      setShowForm(false);
      setEditingKpi(null);
      resetForm();
      loadKpis();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Disable this KPI definition?')) return;
    try {
      await trpcMutate('dashboards.deleteKpi', { id });
      loadKpis();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const resetForm = () => {
    setForm({
      kpi_name: '', kpi_code: '', description: '',
      formula_type: 'sql_query', formula_query: '', data_source: '',
      refresh_cadence: 'hourly', target_value: '', warning_threshold: '',
      critical_threshold: '', unit: '', display_format: 'integer',
      dashboard_tiers: [3], category: 'census',
    });
  };

  const startEdit = (kpi: KpiDefinition) => {
    setEditingKpi(kpi);
    setForm({
      kpi_name: kpi.kpi_name,
      kpi_code: kpi.kpi_code,
      description: kpi.description || '',
      formula_type: kpi.formula_type,
      formula_query: '',
      data_source: '',
      refresh_cadence: kpi.refresh_cadence || 'hourly',
      target_value: kpi.target_value || '',
      warning_threshold: kpi.warning_threshold || '',
      critical_threshold: kpi.critical_threshold || '',
      unit: kpi.unit || '',
      display_format: kpi.display_format || 'integer',
      dashboard_tiers: Array.isArray(kpi.dashboard_tiers) ? kpi.dashboard_tiers : [],
      category: kpi.category || 'census',
    });
    setShowForm(true);
  };

  const toggleTier = (tier: number) => {
    setForm(prev => ({
      ...prev,
      dashboard_tiers: prev.dashboard_tiers.includes(tier)
        ? prev.dashboard_tiers.filter(t => t !== tier)
        : [...prev.dashboard_tiers, tier].sort(),
    }));
  };

  // Group KPIs by category
  const grouped = kpis.reduce<Record<string, KpiDefinition[]>>((acc, kpi) => {
    const cat = kpi.category || 'uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(kpi);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <span className="text-gray-900">KPI Definitions</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">KPI Definitions</h1>
            <p className="text-gray-600 text-sm mt-1">
              {kpis.length} KPIs defined across {Object.keys(grouped).length} categories
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setEditingKpi(null); setShowForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + Add KPI
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-600 hover:underline">dismiss</button>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-6">
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">All Categories</option>
            {['census', 'finance', 'quality', 'staffing', 'infection', 'los', 'billing', 'compliance', 'incidents'].map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <select
            value={filterTier}
            onChange={e => setFilterTier(e.target.value ? parseInt(e.target.value) : '')}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">All Tiers</option>
            <option value="1">Tier 1 — Wall View</option>
            <option value="2">Tier 2 — MOD</option>
            <option value="3">Tier 3 — GM</option>
            <option value="4">Tier 4 — CEO</option>
          </select>
        </div>

        {/* KPI List grouped by category */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading KPIs...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No KPIs defined yet. Click &quot;+ Add KPI&quot; to create one.
          </div>
        ) : (
          Object.entries(grouped).sort().map(([cat, items]) => {
            const colors = categoryColors[cat] || { bg: 'bg-gray-50', text: 'text-gray-800' };
            return (
              <div key={cat} className="mb-6">
                <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-3 ${colors.bg} ${colors.text}`}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)} ({items.length})
                </div>
                <div className="bg-white border rounded-lg divide-y">
                  {items.map(kpi => (
                    <div key={kpi.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{kpi.kpi_name}</span>
                          <span className="text-xs font-mono text-gray-400">{kpi.kpi_code}</span>
                        </div>
                        {kpi.description && (
                          <p className="text-sm text-gray-500 mt-0.5">{kpi.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                          <span>Target: {kpi.target_value || '—'} {kpi.unit || ''}</span>
                          <span>Refresh: {kpi.refresh_cadence || 'hourly'}</span>
                          <span>Format: {kpi.display_format || 'integer'}</span>
                          <div className="flex gap-1">
                            {(Array.isArray(kpi.dashboard_tiers) ? kpi.dashboard_tiers : []).map((t: number) => (
                              <span key={t} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">
                                T{t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEdit(kpi)} className="text-blue-600 hover:underline text-sm">Edit</button>
                        <button onClick={() => handleDelete(kpi.id)} className="text-red-500 hover:underline text-sm">Disable</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
              <h2 className="text-lg font-bold mb-4">
                {editingKpi ? 'Edit KPI Definition' : 'Add KPI Definition'}
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">KPI Name</label>
                  <input value={form.kpi_name} onChange={e => setForm(p => ({ ...p, kpi_name: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="e.g. Current Census" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">KPI Code</label>
                  <input value={form.kpi_code} onChange={e => setForm(p => ({ ...p, kpi_code: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm font-mono" placeholder="e.g. CENSUS_CURRENT" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {['census', 'finance', 'quality', 'staffing', 'infection', 'los', 'billing', 'compliance', 'incidents'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Formula Type</label>
                  <select value={form.formula_type} onChange={e => setForm(p => ({ ...p, formula_type: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="sql_query">SQL Query</option>
                    <option value="aggregation">Aggregation</option>
                    <option value="derived">Derived</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Value</label>
                  <input type="number" value={form.target_value} onChange={e => setForm(p => ({ ...p, target_value: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="count, %, INR, minutes" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Warning Threshold (%)</label>
                  <input type="number" value={form.warning_threshold} onChange={e => setForm(p => ({ ...p, warning_threshold: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Critical Threshold (%)</label>
                  <input type="number" value={form.critical_threshold} onChange={e => setForm(p => ({ ...p, critical_threshold: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Format</label>
                  <select value={form.display_format} onChange={e => setForm(p => ({ ...p, display_format: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="integer">Integer</option>
                    <option value="decimal_2">Decimal (2)</option>
                    <option value="percentage">Percentage</option>
                    <option value="currency">Currency (INR)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Cadence</label>
                  <select value={form.refresh_cadence} onChange={e => setForm(p => ({ ...p, refresh_cadence: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="real_time">Real-time</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dashboard Tiers</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTier(t)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                          form.dashboard_tiers.includes(t)
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        T{t} — {tierLabels[t]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                <button onClick={() => { setShowForm(false); setEditingKpi(null); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                  Cancel
                </button>
                <button onClick={handleSubmit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
                  {editingKpi ? 'Update KPI' : 'Create KPI'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
