/**
 * /admin/billing — RETIRED. Replaced by /admin/billing-v2 (ships A.1–A.6).
 *
 * AD.5: pure server-side redirect. The old billing-client.tsx lives on
 * as a dead file so the redirect stays self-contained, but the URL
 * /admin/billing now silently routes to the canonical Billing v2 page.
 * The manifest entry is kept (marked hideFromNav + status: 'legacy')
 * so the CI gate still accounts for this page.tsx on disk.
 *
 * Nested routes (/admin/billing/insurers, /admin/billing/insurer-rules,
 * /admin/billing/approvals, /admin/billing/implants) are NOT affected —
 * those are the live Billing v2 admin surfaces.
 */
import { redirect } from 'next/navigation';

export default function BillingPage() {
  redirect('/admin/billing-v2');
}
