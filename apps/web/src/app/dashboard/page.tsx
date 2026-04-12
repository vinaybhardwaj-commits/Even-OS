'use client';

import { useEffect, useState } from 'react';

interface UserInfo {
  name: string;
  email: string;
  role: string;
  hospital_id: string;
  department?: string;
}

export default function DashboardPage() {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    fetch('/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D')
      .then((r) => r.json())
      .then((data) => {
        if (data.result?.data?.json) {
          setUser(data.result.data.json);
        } else {
          window.location.href = '/login';
        }
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Even OS</h1>
          <p className="text-blue-200 text-xs">Hospital Operating System</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">{user.name}</p>
          <p className="text-blue-200 text-xs">{user.role} · {user.department || 'N/A'}</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome, {user.name.split(' ')[0]}</h2>
        <p className="text-gray-500 mb-8">Even OS is being set up. Modules will appear here as they come online.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { name: 'OPD', icon: '🏥', status: 'Coming soon' },
            { name: 'IPD', icon: '🛏️', status: 'Coming soon' },
            { name: 'Emergency', icon: '🚑', status: 'Coming soon' },
            { name: 'OT', icon: '🔬', status: 'Coming soon' },
            { name: 'Pharmacy', icon: '💊', status: 'Coming soon' },
            { name: 'Lab & Radiology', icon: '🧪', status: 'Coming soon' },
            { name: 'Billing', icon: '💰', status: 'Coming soon' },
            { name: 'Nursing', icon: '👩‍⚕️', status: 'Coming soon' },
            { name: 'Administration', icon: '⚙️', status: 'Coming soon' },
          ].map((mod) => (
            <div
              key={mod.name}
              className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 opacity-60"
            >
              <span className="text-2xl">{mod.icon}</span>
              <div>
                <h3 className="font-semibold text-gray-900">{mod.name}</h3>
                <p className="text-xs text-gray-400 mt-1">{mod.status}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
