/**
 * /admin/test-catalog — RETIRED. Replaced by /admin/lab/test-catalog-v2
 * (ships B.2 as part of LIS v2).
 *
 * AD.5: pure server-side redirect. Manifest entry kept (hideFromNav +
 * status: 'legacy') so the CI gate still accounts for this page.
 */
import { redirect } from 'next/navigation';

export default function TestCatalogPage() {
  redirect('/admin/lab/test-catalog-v2');
}
