'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutMsg, setLockoutMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLockoutMsg('');
    setLoading(true);

    try {
      const res = await fetch('/api/trpc/auth.login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: { email, password, hospital_id: 'EHRC' },
        }),
      });

      const data = await res.json();
      const result = data.result?.data?.json;

      if (result?.success) {
        // Full page navigation (not router.push) so the entire React tree
        // remounts — ChatProvider, shift context, etc. all initialize fresh
        // with the new auth cookie present.
        if (result.must_change_password) {
          window.location.href = '/change-password';
        } else {
          window.location.href = '/dashboard';
        }
        return; // prevent setLoading(false) flash
      } else if (result?.requires_device_verification) {
        // Credentials correct but new device — redirect to OTP
        window.location.href = `/verify-device?uid=${result.user_id}`;
      } else {
        const errMsg = data.error?.json?.message || 'Invalid credentials';
        if (errMsg.includes('locked')) {
          setLockoutMsg(errMsg);
        } else {
          setError(errMsg);
        }
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-900">Even OS</h1>
          <p className="text-gray-500 mt-2 text-sm">Hospital Operating System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {lockoutMsg && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <span className="text-lg leading-5">🔒</span>
              <div>
                <p className="font-medium">Account Locked</p>
                <p className="mt-1">{lockoutMsg}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              placeholder="you@even.in"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !!lockoutMsg}
            className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          <Link href="/forgot-password" className="text-blue-600 hover:underline">
            Forgot password?
          </Link>
        </p>

        <p className="text-center text-xs text-gray-400 mt-8">
          Even Healthcare © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
