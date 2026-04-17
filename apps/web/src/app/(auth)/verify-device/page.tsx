'use client';

import { useState, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function VerifyDeviceForm() {
  const searchParams = useSearchParams();
  const userId = searchParams.get('uid') || '';

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function handleInput(index: number, value: string) {
    if (!/^\d?$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    if (!userId) {
      setError('Invalid session. Please log in again.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/trpc/auth.verifyDevice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { user_id: userId, code: fullCode } }),
      });

      const data = await res.json();
      if (data.result?.data?.json?.success) {
        const result = data.result.data.json;
        // Full page navigation so ChatProvider remounts with auth cookie
        if (result.must_change_password) {
          window.location.href = '/change-password';
        } else {
          window.location.href = '/dashboard';
        }
        return;
      } else {
        setError(data.error?.json?.message || 'Invalid code');
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md text-center">
          <h1 className="text-3xl font-bold text-blue-900 mb-4">Even OS</h1>
          <p className="text-gray-500 mb-4">Invalid verification session.</p>
          <a href="/login" className="text-blue-600 hover:underline text-sm">Go to Login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-blue-900">Even OS</h1>
          <p className="text-gray-500 mt-2 text-sm">Verify your device</p>
        </div>

        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm mb-6">
          We've sent a 6-digit code to your email. Enter it below to trust this device.
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-center gap-3" onPaste={handlePaste}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleInput(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              />
            ))}
          </div>

          <button
            type="submit"
            disabled={loading || code.join('').length !== 6}
            className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verifying...' : 'Verify & Continue'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Code expires in 10 minutes. <a href="/login" className="text-blue-600 hover:underline">Back to Login</a>
          </p>
        </form>

        <p className="text-center text-xs text-gray-400 mt-8">
          Even Healthcare © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

export default function VerifyDevicePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md text-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    }>
      <VerifyDeviceForm />
    </Suspense>
  );
}
