'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BreakGlassPage() {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ break_glass_id: string; expires_at: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!confirmed) {
      setError('You must acknowledge that all actions will be logged');
      return;
    }

    if (reason.length < 10) {
      setError('Please provide a detailed reason (at least 10 characters)');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/trpc/auth.breakGlass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { reason } }),
      });

      const data = await res.json();
      if (data.result?.data?.json?.success) {
        setResult(data.result.data.json);
      } else {
        setError(data.error?.json?.message || 'Failed to activate emergency access');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-red-900 text-white px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-red-200 hover:text-white text-sm">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Break-Glass Emergency Access</h1>
        </div>
      </header>

      <main className="p-6 max-w-2xl mx-auto">
        {result ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div className="text-center">
              <div className="text-5xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold text-red-900 mb-2">Emergency Access Active</h2>
              <p className="text-gray-600 mb-6">All actions during this session are being logged and will be reviewed by a super admin.</p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 space-y-2">
              <p className="text-sm"><strong>Break-Glass ID:</strong> <code className="text-xs bg-red-100 px-1 rounded">{result.break_glass_id}</code></p>
              <p className="text-sm"><strong>Expires:</strong> {new Date(result.expires_at).toLocaleString('en-IN')}</p>
              <p className="text-sm"><strong>Reason:</strong> {reason}</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-6">
              <p className="font-medium mb-1">What you can do:</p>
              <p>Emergency access grants temporary elevated permissions for patient safety situations. You can access clinical data and perform critical actions that your normal role may not allow. All actions are immutably logged.</p>
            </div>

            <button
              onClick={() => router.push('/dashboard')}
              className="w-full bg-red-700 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-red-800 transition-colors"
            >
              Continue to Dashboard
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <h2 className="font-bold text-red-900 text-lg mb-2">⚠️ Emergency Access Only</h2>
              <p className="text-sm text-red-800">
                Break-glass access is for genuine emergencies only — situations where patient safety requires
                immediate access to data or functionality beyond your normal role. This grants elevated permissions
                for 1 hour.
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-sm text-gray-700 space-y-2">
              <p><strong>What happens when you activate:</strong></p>
              <p>1. You receive temporary elevated access for 1 hour</p>
              <p>2. Every action is immutably logged with your name and timestamp</p>
              <p>3. All super admins are notified by email immediately</p>
              <p>4. Your break-glass session will be reviewed post-hoc</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-2">
                  Emergency Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition text-sm"
                  placeholder="Describe the emergency situation and why you need elevated access..."
                  required
                  minLength={10}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Be specific. This will be reviewed by hospital administration.
                </p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">
                  I understand that all my actions during this session will be logged, reviewed, and that
                  misuse of break-glass access may result in disciplinary action.
                </span>
              </label>

              <button
                type="submit"
                disabled={loading || !confirmed || reason.length < 10}
                className="w-full bg-red-700 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Activating...' : 'Activate Emergency Access'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
