/**
 * /admin/lab-worklist — MISROUTE fix. The canonical page lives at
 * /admin/lab/worklist (nested under the Lab v2 admin cluster). This
 * stub exists because the old /dashboard tile grid and a few internal
 * references linked to /admin/lab-worklist directly — a route that
 * never existed — so users hit a 404.
 *
 * AD.5: pure server-side redirect. Manifest entry is registered with
 * hideFromNav + status: 'legacy' so the CI gate still accounts for this
 * page.tsx on disk.
 */
import { redirect } from 'next/navigation';

export default function LabWorklistPage() {
  redirect('/admin/lab/worklist');
}
