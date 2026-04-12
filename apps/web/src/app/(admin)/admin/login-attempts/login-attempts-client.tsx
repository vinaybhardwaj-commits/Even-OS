'use client';

import { useState, useMemo } from 'react';

interface Attempt {
  id: string;
  email: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string;
  user_agent: string | null;
  attempted_at: string;
}

export default function LoginAttemptsClient({ attempts }: { attempts: Attempt[] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');

  const filtered = useMemo(() => {
    return attempts.filter(a => {
      if (filter === 'success' && !a.success) return false;
      if (filter === 'failed' && a.success) return false;
      if (search && !a.email.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [attempts, search, filter]);

  // Stats
  const totalAttempts = attempts.length;
  const successCount = attempts.filter(a => a.success).length;
  const failedCount = attempts.filter(a => !a.success).length;
  const uniqueEmails = new Set(attempts.filter(a => !a.success).map(a => a.email)).size;

  // Check for locked accounts (5+ failed in last 10min)
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentFailed = attempts.filter(a => !a.success && a.attempted_at > tenMinAgo);
  const failedByEmail = recentFailed.reduce((acc, a) => {
    acc[a.email] = (acc[a.email] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const lockedAccounts = Object.entries(failedByEmail).filter(([_, count]) => count >= 5);

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function failureLabel(reason: string | null) {
    const labels: Record<string, string> = {
      wrong_password: 'Wrong password',
      user_not_found: 'User not found',
      account_suspended: 'Account suspended',
      device_verification_pending: 'New device (OTP sent)',
    };
    return reason ? (labels[reason] || reason) : '';
  }

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase font-semibold">Total (last 200)</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{totalAttempts}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-green-200 p-4">
          <p className="text-xs text-green-600 uppercase font-semibold">Successful</p>
          <p className="text-2xl font-bold text-green-800 mt-1">{successCount}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-4">
          <p className="text-xs text-red-600 uppercase font-semibold">Failed</p>
          <p className="text-2xl font-bold text-red-800 mt-1">{failedCount}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-4">
          <p className="text-xs text-amber-600 uppercase font-semibold">Locked Now</p>
          <p className="text-2xl font-bold text-amber-800 mt-1">{lockedAccounts.length}</p>
        </div>
      </div>

      {/* Locked accounts alert */}
      {lockedAccounts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 mb-1">Currently locked accounts (5+ failed attempts in 10min):</p>
          {lockedAccounts.map(([email, count]) => (
            <p key={email} className="text-sm text-amber-700">
              <span className="font-mono">{email}</span> — {count} failed attempts
            </p>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex gap-3">
        <input
          type="text"
          placeholder="Filter by email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <select value={filter} onChange={e => setFilter(e.target.value as any)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="all">All</option>
          <option value="success">Successful</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Time</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Reason</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(a => (
                <tr key={a.id} className={`hover:bg-gray-50 ${!a.success ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(a.attempted_at)}</td>
                  <td className="px-4 py-2 text-gray-800 font-mono text-xs">{a.email}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {a.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{a.success ? '—' : failureLabel(a.failure_reason)}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs font-mono">{a.ip_address}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No matching attempts</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          Showing {filtered.length} of {attempts.length} attempts
        </div>
      </div>
    </div>
  );
}
