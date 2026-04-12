'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface PatientStats {
  total: number;
  active: number;
  registered_today: number;
  registered_this_week: number;
}

interface Patient {
  id: string;
  uhid: string;
  name_full: string;
  phone: string;
  dob: string;
  gender: string;
  blood_group: string;
  patient_category: 'cash' | 'insured' | 'even_capitated';
  status: string;
  created_at: string;
}

const categoryBadgeColor = {
  cash: 'bg-gray-100 text-gray-800',
  insured: 'bg-blue-100 text-blue-800',
  even_capitated: 'bg-green-100 text-green-800',
};

const categoryLabel = {
  cash: 'Cash',
  insured: 'Insured',
  even_capitated: 'Even Capitated',
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}m ago`;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export function PatientsClient() {
  const router = useRouter();
  const [stats, setStats] = useState<PatientStats | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const statsData = await trpcQuery('patient.stats');
        setStats(statsData);

        const input = {
          search: searchQuery || undefined,
          patient_category: categoryFilter || undefined,
          status: statusFilter || undefined,
          page: currentPage,
          pageSize,
        };
        const patientsData = await trpcQuery('patient.list', input);
        setPatients(patientsData.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load patients');
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchData, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, categoryFilter, statusFilter, currentPage]);

  const totalPages = stats ? Math.ceil(stats.total / pageSize) : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-900 text-white px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <Link href="/admin" className="text-blue-100 hover:text-white text-sm mb-2 inline-block">
            ← Dashboard
          </Link>
          <h1 className="text-3xl font-bold">Patient Registry</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white px-4 py-3 rounded border border-gray-200 shadow-sm">
              <div className="text-sm text-gray-600">Total Patients</div>
              <div className="text-2xl font-bold text-gray-900">{stats.total.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-white px-4 py-3 rounded border border-gray-200 shadow-sm">
              <div className="text-sm text-gray-600">Active</div>
              <div className="text-2xl font-bold text-gray-900">{stats.active.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-white px-4 py-3 rounded border border-gray-200 shadow-sm">
              <div className="text-sm text-gray-600">Today</div>
              <div className="text-2xl font-bold text-gray-900">{stats.registered_today.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-white px-4 py-3 rounded border border-gray-200 shadow-sm">
              <div className="text-sm text-gray-600">This Week</div>
              <div className="text-2xl font-bold text-gray-900">{stats.registered_this_week.toLocaleString('en-IN')}</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded border border-gray-200 shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <input
              type="text"
              placeholder="Search UHID, phone, or name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              <option value="cash">Cash</option>
              <option value="insured">Insured</option>
              <option value="even_capitated">Even Capitated</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex justify-end mb-4">
            <button
              onClick={() => router.push('/admin/patients/register')}
              className="px-4 py-2 bg-blue-900 text-white rounded text-sm font-medium hover:bg-blue-800"
            >
              + Register Patient
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading patients...</div>
          ) : patients.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No patients found</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">UHID</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">Phone</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">DOB</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">Gender</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map((patient) => (
                      <tr key={patient.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-blue-600">
                          <Link href={`/admin/patients/${patient.id}`} className="hover:underline">
                            {patient.uhid}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {patient.name_full}
                        </td>
                        <td className="px-4 py-3">{patient.phone}</td>
                        <td className="px-4 py-3">{formatDate(patient.dob)}</td>
                        <td className="px-4 py-3">{patient.gender}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${categoryBadgeColor[patient.patient_category]}`}>
                            {categoryLabel[patient.patient_category]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className={`px-2 py-1 rounded ${patient.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {patient.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatRelativeDate(patient.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center mt-6 text-sm text-gray-600">
                <div>
                  Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, stats?.total || 0)} of{' '}
                  {stats?.total.toLocaleString('en-IN')} patients
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-3 py-2 rounded text-sm ${
                          currentPage === page
                            ? 'bg-blue-900 text-white'
                            : 'border border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
