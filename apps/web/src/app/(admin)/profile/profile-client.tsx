'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Device {
  id: string;
  device_id: string;
  device_name: string | null;
  browser: string | null;
  os: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface LoginAttempt {
  id: string;
  email: string;
  success: boolean;
  failure_reason: string | null;
  ip_address: string;
  attempted_at: string;
}

interface Props {
  profile: {
    id: string;
    email: string;
    full_name: string;
    department: string;
    roles: string[] | null;
    status: string;
    login_count: number;
    first_login_at: string | null;
    last_active_at: string | null;
    created_at: string;
  };
  devices: Device[];
  recentLogins: LoginAttempt[];
}

export default function ProfileClient({ profile, devices, recentLogins }: Props) {
  const router = useRouter();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function formatDate(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPw.length < 8) { setMessage({ type: 'error', text: 'Min 8 characters' }); return; }
    if (newPw !== confirmPw) { setMessage({ type: 'error', text: 'Passwords do not match' }); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/trpc/auth.changePassword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { current_password: currentPw, new_password: newPw } }),
      });
      const data = await res.json();
      if (data.result?.data?.json?.success) {
        setMessage({ type: 'success', text: 'Password changed successfully' });
        setShowChangePassword(false);
        setCurrentPw(''); setNewPw(''); setConfirmPw('');
      } else {
        setMessage({ type: 'error', text: data.error?.json?.message || 'Failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Connection error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveDevice(deviceId: string) {
    if (!confirm('Remove this trusted device? You will need to verify via email next time you log in from it.')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/trpc/profile.removeDevice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { device_id: deviceId } }),
      });
      const data = await res.json();
      if (data.result?.data?.json?.success) {
        setMessage({ type: 'success', text: 'Device removed' });
        router.refresh();
      } else {
        setMessage({ type: 'error', text: 'Failed to remove device' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Connection error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.text}
          <button className="float-right font-bold" onClick={() => setMessage(null)}>&times;</button>
        </div>
      )}

      {/* Profile Info */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Account Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Name</p>
            <p className="text-sm text-gray-800 mt-1">{profile.full_name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Email</p>
            <p className="text-sm text-gray-800 mt-1">{profile.email}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Department</p>
            <p className="text-sm text-gray-800 mt-1">{profile.department}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Roles</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {(profile.roles || []).map(r => (
                <span key={r} className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{r.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Total Logins</p>
            <p className="text-sm text-gray-800 mt-1">{profile.login_count}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Last Active</p>
            <p className="text-sm text-gray-800 mt-1">{formatDate(profile.last_active_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Account Created</p>
            <p className="text-sm text-gray-800 mt-1">{formatDate(profile.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase font-semibold">Status</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${profile.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {profile.status}
            </span>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-100">
          {showChangePassword ? (
            <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
              <input type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="password" placeholder="New password (min 8 chars)" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required minLength={8} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div className="flex gap-2">
                <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {loading ? 'Saving...' : 'Change Password'}
                </button>
                <button type="button" onClick={() => setShowChangePassword(false)} className="px-4 py-2 text-gray-600 text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowChangePassword(true)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
              Change Password
            </button>
          )}
        </div>
      </div>

      {/* Trusted Devices */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Trusted Devices</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-gray-500">No trusted devices yet. Your device will be registered on next login.</p>
        ) : (
          <div className="space-y-3">
            {devices.map(d => (
              <div key={d.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-800">{d.device_name || 'Unknown Device'}</p>
                  <p className="text-xs text-gray-500">
                    {d.browser && d.os ? `${d.browser} · ${d.os}` : 'Details not available'}
                    {' · '}First seen {formatDate(d.first_seen_at)} · Last seen {formatDate(d.last_seen_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveDevice(d.id)}
                  className="text-xs text-red-600 hover:bg-red-50 px-3 py-1 rounded"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Login Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Recent Login Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Time</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Details</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentLogins.map(l => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-600 text-xs">{formatDate(l.attempted_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${l.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {l.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{l.failure_reason || 'Authenticated'}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs font-mono">{l.ip_address}</td>
                </tr>
              ))}
              {recentLogins.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No login activity</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
