'use client';

import { useSearchParams } from 'next/navigation';

/**
 * Floating Action Button that appears on any admin page when navigated
 * from the Test Cockpit (?from=cockpit query param).
 *
 * Include this component in the root layout — it auto-hides when
 * the param is absent.
 */
export function CockpitFab() {
  const searchParams = useSearchParams();
  const fromCockpit = searchParams.get('from') === 'cockpit';

  if (!fromCockpit) return null;

  return (
    <a
      href="/admin/test-cockpit"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-indigo-600 text-white px-4 py-3 rounded-full shadow-lg hover:bg-indigo-700 transition-all hover:shadow-xl group"
      title="Back to Test Cockpit"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
      </svg>
      <span className="text-sm font-medium">Cockpit</span>
    </a>
  );
}
