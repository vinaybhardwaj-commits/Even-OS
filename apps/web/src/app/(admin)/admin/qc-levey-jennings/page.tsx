/**
 * /admin/qc-levey-jennings — RETIRED. Replaced by /admin/lab/qc-enhancement
 * (ships B.4 as part of LIS v2 — multi-rule Westgard, Levey-Jennings chart,
 * SDI trending, EQAS).
 *
 * AD.5: pure server-side redirect. The old qc-levey-jennings-client lives
 * on as a dead file so the redirect stays self-contained. Manifest entry
 * is kept (hideFromNav + status: 'legacy') so the CI gate still accounts
 * for this page.tsx on disk.
 */
import { redirect } from 'next/navigation';

export default function QcLeveyJenningsPage() {
  redirect('/admin/lab/qc-enhancement');
}
