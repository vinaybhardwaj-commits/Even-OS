'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/trpc/auth.requestPasswordReset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { email } }),
      });

      const data = await res.json();
      if (data.result?.data?.json?.success) {
        setSubmitted(true);
      } else {
        setError(data.error?.json?.message || 'Something went wrong');
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
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-blue-900">Even OS</h1>
          <p className="text-gray-500 mt-2 text-sm">Reset your password</p>
        </div>

        {submitted ? (
          <div>
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-6">
              If an account exists with <strong>{email}</strong>, a reset link has been sent. Check your inbox.
            </div>
            <p className="text-sm text-gray-500 text-center mb-4">
              Didn't receive the email? Check your spam folder or try again in a few minutes.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setSubmitted(false); setEmail(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Try Another Email
              </button>
              <Link
                href="/login"
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors text-center"
              >
                Back to Login
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-sm text-gray-600 mb-2">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <p className="text-center text-sm text-gray-500">
              <Link href="/login" className="text-blue-600 hover:underline">Back to Login</Link>
            </p>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">
          Even Healthcare © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
