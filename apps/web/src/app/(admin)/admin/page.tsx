import { redirect } from 'next/navigation';

/**
 * /admin index — redirects to the GM Dashboard (primary admin landing page).
 */
export default function AdminIndexPage() {
  redirect('/admin/gm-dashboard');
}
