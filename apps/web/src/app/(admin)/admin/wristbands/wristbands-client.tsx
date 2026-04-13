'use client';

import { useState, useEffect } from 'react';

interface WristbandStats {
  queued: number;
  printing: number;
  printed: number;
  failed: number;
}

interface WristbandJob {
  id: string;
  format: string;
  status: string;
  created_at: string;
  printed_at: string | null;
  printer_id: string | null;
  uhid: string;
  patient_name: string;
  gender: string;
  dob: string;
  blood_group: string;
  phone: string;
  encounter_class: string;
  admission_at: string;
}

interface ListResponse {
  items: WristbandJob[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? '?input=' + encodeURIComponent(JSON.stringify(input)) : '';
  const res = await fetch('/api/trpc/' + path + params);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutation(path: string, input: any) {
  const res = await fetch('/api/trpc/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

export function WristbandsClient() {
  const [stats, setStats] = useState<WristbandStats>({ queued: 0, printing: 0, printed: 0, failed: 0 });
  const [status, setStatus] = useState<string>('queued');
  const [jobs, setJobs] = useState<WristbandJob[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 10;

  const fetchStats = async () => {
    try {
      const data = await trpcQuery('wristband.stats');
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchJobs = async (selectedStatus: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpcQuery('wristband.list', {
        status: selectedStatus,
        page: pageNum,
        pageSize,
      });
      setJobs(data.items);
      setTotalPages(data.totalPages);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchJobs(status, 1);
    setPage(1);
  }, [status]);

  const handleMarkPrinted = async (jobId: string) => {
    try {
      await trpcMutation('wristband.markPrinted', { job_id: jobId });
      await fetchStats();
      await fetchJobs(status, page);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReprint = async (jobId: string) => {
    try {
      await trpcMutation('wristband.reprint', { job_id: jobId });
      await fetchStats();
      await fetchJobs(status, page);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getStatusBadgeClass = (jobStatus: string) => {
    switch (jobStatus) {
      case 'queued':
        return 'bg-yellow-100 text-yellow-800';
      case 'printing':
        return 'bg-blue-100 text-blue-800';
      case 'printed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <a href="/admin" className="text-blue-900 hover:text-blue-700 text-sm font-medium mb-4 inline-block">
            ← Dashboard
          </a>
          <h1 className="text-3xl font-bold text-gray-900">Wristband Queue</h1>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-white px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
              <div className="text-sm text-yellow-700 font-medium">Queued</div>
              <div className="text-2xl font-bold text-yellow-900">{stats.queued.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="text-sm text-blue-700 font-medium">Printing</div>
              <div className="text-2xl font-bold text-blue-900">{stats.printing.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <div className="text-sm text-green-700 font-medium">Printed</div>
              <div className="text-2xl font-bold text-green-900">{stats.printed.toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <div className="text-sm text-red-700 font-medium">Failed</div>
              <div className="text-2xl font-bold text-red-900">{stats.failed.toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white border-t border-gray-200 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <div className="flex gap-2">
              {['queued', 'printing', 'printed', 'failed'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setStatus(tab)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${
                    status === tab
                      ? 'border-blue-900 text-blue-900'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Patient</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Info</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Format</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Created</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Printed</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-900">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-600">
                      No jobs found
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{job.patient_name}</div>
                        <div className="text-xs text-gray-600">UHID: {job.uhid}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        <div>{job.gender} • {job.dob}</div>
                        <div>BG: {job.blood_group}</div>
                        <div>Class: {job.encounter_class}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-700">{job.format}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(job.status)}`}>
                          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        {formatDate(job.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        {formatDate(job.printed_at)}
                      </td>
                      <td className="px-4 py-3">
                        {job.status === 'queued' && (
                          <button
                            onClick={() => handleMarkPrinted(job.id)}
                            className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700"
                          >
                            Mark Printed
                          </button>
                        )}
                        {(job.status === 'printed' || job.status === 'failed') && (
                          <button
                            onClick={() => handleReprint(job.id)}
                            className="px-3 py-1 bg-blue-900 text-white text-xs font-medium rounded hover:bg-blue-800"
                          >
                            Reprint
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (page > 1) {
                      setPage(page - 1);
                      fetchJobs(status, page - 1);
                    }
                  }}
                  disabled={page === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => {
                    if (page < totalPages) {
                      setPage(page + 1);
                      fetchJobs(status, page + 1);
                    }
                  }}
                  disabled={page === totalPages}
                  className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="text-center py-8 text-gray-600">
              Loading...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
