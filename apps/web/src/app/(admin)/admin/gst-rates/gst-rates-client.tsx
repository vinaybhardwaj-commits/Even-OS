'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

interface GstRate {
  id: string;
  category: string;
  percentage: string;
  effective_date: string;
  description: string | null;
  created_at: string;
}

function formatIndianDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isCurrentRate(rate: GstRate, allRates: GstRate[], now: Date): boolean {
  const rateDate = new Date(rate.effective_date);
  if (rateDate > now) return false;

  const sameCategory = allRates.filter(r => r.category === rate.category);
  const effectiveRates = sameCategory.filter(r => new Date(r.effective_date) <= now);
  if (effectiveRates.length === 0) return false;

  const latest = effectiveRates.sort((a, b) =>
    new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime()
  )[0];

  return latest.id === rate.id;
}

export function GstRatesClient() {
  const [rates, setRates] = useState<GstRate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [currentRates, setCurrentRates] = useState<Array<{ category: string; percentage: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    category: '',
    percentage: '',
    effective_date: '',
    description: '',
  });
  const [categoryOption, setCategoryOption] = useState<'existing' | 'new'>('existing');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [ratesData, categoriesData, currentRatesData] = await Promise.all([
        trpcQuery('gstRates.list'),
        trpcQuery('gstRates.categories'),
        trpcQuery('gstRates.currentRates'),
      ]);
      setRates(ratesData || []);
      setCategories(categoriesData || []);
      setCurrentRates(currentRatesData || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GST rates');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRate(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.category || !formData.percentage || !formData.effective_date) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setCreating(true);
      await trpcMutate('gstRates.create', {
        category: formData.category,
        percentage: formData.percentage,
        effective_date: formData.effective_date,
        description: formData.description || undefined,
      });
      setShowModal(false);
      setFormData({ category: '', percentage: '', effective_date: '', description: '' });
      setCategoryOption('existing');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-600">Loading GST rates...</div>
      </div>
    );
  }

  const now = new Date();
  const groupedRates = rates.reduce((acc, rate) => {
    if (!acc[rate.category]) acc[rate.category] = [];
    acc[rate.category].push(rate);
    return acc;
  }, {} as Record<string, GstRate[]>);

  const totalRates = rates.length;
  const totalCategories = categories.length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white p-6">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Link href="/dashboard" className="hover:opacity-80 transition text-xl">
            ←
          </Link>
          <h1 className="text-3xl font-bold">GST Rates</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <span className="text-red-600 flex-shrink-0 mt-0.5 text-lg">⚠</span>
            <div className="text-red-800">{error}</div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="text-gray-600 text-sm font-medium">Total Rates</div>
            <div className="text-3xl font-bold text-blue-900 mt-2">{totalRates}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="text-gray-600 text-sm font-medium">Categories</div>
            <div className="text-3xl font-bold text-blue-900 mt-2">{totalCategories}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="text-gray-600 text-sm font-medium">Current Effective Rates</div>
            <div className="text-sm text-gray-700 mt-2 space-y-1">
              {currentRates.slice(0, 2).map((r: any) => (
                <div key={r.category} className="flex justify-between">
                  <span>{r.category}:</span>
                  <span className="font-semibold text-blue-900">{r.percentage}%</span>
                </div>
              ))}
              {currentRates.length > 2 && (
                <div className="text-gray-500 text-xs">+{currentRates.length - 2} more</div>
              )}
            </div>
          </div>
        </div>

        {/* Button Bar */}
        <div className="mb-6 flex justify-end">
          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-900 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-blue-800 transition"
          >
            + New Rate
          </button>
        </div>

        {/* Rates Table */}
        {Object.keys(groupedRates).length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-600">No GST rates configured yet. Click "New Rate" to get started.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedRates).map(([category, categoryRates]) => (
              <div key={category} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-6 py-3">
                  <h3 className="font-semibold text-gray-900">{category}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase">
                          Percentage
                        </th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase">
                          Effective Date
                        </th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase">
                          Description
                        </th>
                        <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRates
                        .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())
                        .map((rate) => {
                          const isCurrent = isCurrentRate(rate, rates, now);
                          return (
                            <tr key={rate.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-6 py-4 font-semibold text-gray-900">{rate.percentage}%</td>
                              <td className="px-6 py-4 text-gray-700">{formatIndianDate(rate.effective_date)}</td>
                              <td className="px-6 py-4 text-gray-600 text-sm">{rate.description || '—'}</td>
                              <td className="px-6 py-4">
                                {isCurrent ? (
                                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Current
                                  </span>
                                ) : new Date(rate.effective_date) > now ? (
                                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    Scheduled
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                    Archived
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Rate Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">New GST Rate</h2>
            </div>
            <form onSubmit={handleCreateRate} className="p-6 space-y-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setCategoryOption('existing')}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${
                      categoryOption === 'existing'
                        ? 'bg-blue-900 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Existing
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoryOption('new')}
                    className={`px-3 py-1 rounded text-sm font-medium transition ${
                      categoryOption === 'new'
                        ? 'bg-blue-900 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    New
                  </button>
                </div>
                {categoryOption === 'existing' ? (
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                  >
                    <option value="">Select a category...</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="Enter new category name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                )}
              </div>

              {/* Percentage */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Percentage (%) *</label>
                <input
                  type="text"
                  value={formData.percentage}
                  onChange={(e) => setFormData({ ...formData, percentage: e.target.value })}
                  placeholder="e.g., 5 or 12.5"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
                <p className="text-xs text-gray-500 mt-1">Format: number with up to 2 decimal places</p>
              </div>

              {/* Effective Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Effective Date *</label>
                <input
                  type="date"
                  value={formData.effective_date}
                  onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., GST on medicines, exempt items, etc."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setFormData({ category: '', percentage: '', effective_date: '', description: '' });
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-blue-900 text-white rounded-lg font-medium hover:bg-blue-800 transition disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
