import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listDemoRoles } from '@/lib/demo/roles';
import PickerClient from './picker-client';

export const dynamic = 'force-dynamic';

/**
 * DEMO.4 — /demo/picker
 *
 * The landing page the `demo@even.in` session is routed to after login.
 * Middleware (DEMO.5) will enforce this routing once shipped; until then
 * this page also checks the caller and bounces non-demo sessions so the
 * picker isn't reachable from a regular admin/caregiver session.
 *
 * The page itself is a thin server shell — it gates on auth + env,
 * passes the serialized role list to PickerClient, and lets the client
 * handle the fetch to `POST /api/demo/switch`.
 */
export default async function DemoPickerPage() {
  // Env kill-switch — mirrors DEMO.1 login gate. If the flag is off
  // there is no demo account anyway, but a bookmarked /demo/picker URL
  // shouldn't render a fake-looking picker.
  if (process.env.DEMO_ACCOUNT_ENABLED !== 'true') {
    redirect('/login');
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // Only the demo user should see the picker. Any other role that
  // somehow lands here goes to the normal dashboard.
  if (user.role !== 'demo') {
    redirect('/dashboard');
  }

  const roles = listDemoRoles();

  return <PickerClient roles={roles} />;
}
