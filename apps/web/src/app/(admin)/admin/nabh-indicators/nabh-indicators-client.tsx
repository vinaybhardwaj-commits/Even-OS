'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// tRPC helper functions
async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

// Category color mapping
const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  infection_control: { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200' },
  patient_safety: { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200' },
  medication_safety: { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
  clinical_outcomes: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  nursing_care: { bg: 'bg-pink-50', text: 'text-pink-800', border: 'border-pink-200' },
  laboratory: { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200' },
  radiology: { bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-200' },
  patient_experience: { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-200' },
  operational: { bg: 'bg-gray-50', text: 'text-gray-800', border: 'border-gray-200' },
  documentation_compliance: { bg: 'bg-teal-50', text: 'text-teal-800', border: 'border-teal-200' },
};

const displayCategoryName = (cat: string): string => {
  return cat.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

interface Stats {
  total: number;
  auto: number;
  manual: number;
  byCategory: Array<{ category: string; count: number }>;
}

interface Indicator {
  id: string;
  indicator_code: string;
  name: string;
  category: string;
  description: string;
  calculation_type: string;
  target_value: string | null;
  unit: string | null;
}

interface ListResponse {
  items: Indicator[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Categories {
  [key: number]: string;
}

export function NabhIndicatorsClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [data, setData] = useState<ListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const statsData = await trpcQuery('nabhIndicators.stats');
        setStats(statsData);
        const catData = await trpcQuery('nabhIndicators.categories');
        setCategories(catData || []);
        if (statsData.total > 0) {
          const listData = await trpcQuery('nabhIndicators.list', {
            search: search || undefined,
            category: selectedCategory || undefined,
            page,
            pageSize: 50,
          });
          setData(listData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Load data when filters change
  useEffect(() => {
    if (!stats || stats.total === 0) return;
    const load = async () => {
      try {
        setLoading(true);
        const listData = await trpcQuery('nabhIndicators.list', {
          search: search || undefined,
          category: selectedCategory || undefined,
          page: 1,
          pageSize: 50,
        });
        setData(listData);
        setPage(1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [search, selectedCategory, stats]);

  // Handle pagination
  const handlePageChange = async (newPage: number) => {
    if (!stats || stats.total === 0) return;
    try {
      setLoading(true);
      const listData = await trpcQuery('nabhIndicators.list', {
        search: search || undefined,
        category: selectedCategory || undefined,
        page: newPage,
        pageSize: 50,
      });
      setData(listData);
      setPage(newPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Handle seed
  const handleSeed = async () => {
    try {
      setSeeding(true);
      setError(null);
      const result = await trpcMutate('nabhIndicators.seed', {});
      // Reload stats and categories
      const statsData = await trpcQuery('nabhIndicators.stats');
      setStats(statsData);
      const catData = await trpcQuery('nabhIndicators.categories');
      setCategories(catData || []);
      // Load initial data
      const listData = await trpcQuery('nabhIndicators.list', {
        page: 1,
        pageSize: 50,
      });
      setData(listData);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed indicators');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white px-6 py-6">
        <div className="flex items-center gap-3 mb-4">
          <Link
            href="/dashboard"
            className="p-1 hover:bg-blue-800 rounded transition-colors text-2xl"
          >
            ←
          </Link>
          <h1 className="text-3xl font-bold">NABH Quality Indicators</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="text-sm font-medium text-gray-600">Total Indicators</div>
              <div className="text-3xl font-bold text-blue-900 mt-1">{stats.total}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="text-sm font-medium text-gray-600">Auto-Calculated</div>
              <div className="text-3xl font-bold text-blue-900 mt-1">{stats.auto}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="text-sm font-medium text-gray-600">Manual Entry</div>
              <div className="text-3xl font-bold text-blue-900 mt-1">{stats.manual}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="text-sm font-medium text-gray-600">Categories</div>
              <div className="text-3xl font-bold text-blue-900 mt-1">{categories.length}</div>
            </div>
          </div>
        )}

        {/* Seed Button - shown when total is 0 */}
        {stats && stats.total === 0 && (
          <div className="mb-8 bg-white border border-gray-200 rounded-lg p-8 shadow-sm text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Indicators Found</h2>
            <p className="text-gray-600 mb-6">
              Seed 100 NABH quality indicators to get started. These indicators cover all key quality domains.
            </p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-6 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center gap-2 mx-auto"
            >
              {seeding && <span className="inline-block animate-spin">⟳</span>}
              Seed 100 NABH Indicators
            </button>
          </div>
        )}

        {/* Category Breakdown */}
        {stats && stats.total > 0 && stats.byCategory.length > 0 && (
          <div className="mb-8 bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Category Breakdown</h3>
            <div className="flex flex-wrap gap-2">
              {stats.byCategory.map(cat => {
                const colors = categoryColors[cat.category] || categoryColors.operational;
                return (
                  <div
                    key={cat.category}
                    className={`px-3 py-1 rounded-full text-sm font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
                  >
                    {displayCategoryName(cat.category)}: {cat.count}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search and Filter */}
        {stats && stats.total > 0 && (
          <>
            <div className="mb-6 flex gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by code or name..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="px-4 py-2 border border-gray-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-900 bg-white"
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>
                    {displayCategoryName(cat)}
                  </option>
                ))}
              </select>
            </div>

            {/* Table */}
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Code</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Category</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Target</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Unit</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading && !data && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center">
                        <span className="inline-block animate-spin">⟳</span>
                      </td>
                    </tr>
                  )}
                  {data &&
                    data.items.map(indicator => {
                      const colors =
                        categoryColors[indicator.category] || categoryColors.operational;
                      return (
                        <tr key={indicator.id} className="hover:bg-gray-50">
                          <td className="px-6 py-3 text-sm font-medium text-gray-900">
                            {indicator.indicator_code}
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-700">{indicator.name}</td>
                          <td className="px-6 py-3 text-sm">
                            <span
                              className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
                            >
                              {displayCategoryName(indicator.category)}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-700">
                            {indicator.target_value || '-'}
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-700">
                            {indicator.unit || '-'}
                          </td>
                          <td className="px-6 py-3 text-sm">
                            <span
                              className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                indicator.calculation_type === 'auto'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {indicator.calculation_type === 'auto' ? 'Auto' : 'Manual'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Showing {(page - 1) * 50 + 1} to {Math.min(page * 50, data.total)} of{' '}
                  {data.total} indicators
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1 || loading}
                    className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {Array.from({ length: data.totalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      disabled={loading}
                      className={`px-4 py-2 border rounded-lg ${
                        p === page
                          ? 'bg-blue-900 text-white border-blue-900'
                          : 'border-gray-200 hover:bg-gray-50'
                      } disabled:opacity-50`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page === data.totalPages || loading}
                    className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
