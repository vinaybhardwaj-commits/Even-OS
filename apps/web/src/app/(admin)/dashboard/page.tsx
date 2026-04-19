/**
 * /dashboard — legacy landing, now a thin role-aware redirect.
 *
 * Before AD.5 this was a 554-line hand-rolled tile grid that went stale
 * almost immediately and accumulated dead links (/admin/lab-worklist,
 * /admin/chat-audit, /admin/chat-channels) plus a hardcoded "Sprint L.8"
 * status banner. The new canonical landing is /admin (the Command Center
 * that ships in AD.1–AD.4), which is generated from the admin-manifest.
 *
 * We keep /dashboard reachable because:
 *   - many sub-pages still have a "← Dashboard" back-link,
 *   - many role-gate fallbacks call redirect('/dashboard'),
 *   - old bookmarks shouldn't 404 mid-shift.
 *
 * Clinical roles still get dispatched to their caregiver home. Every
 * other role falls through to /admin.
 */
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

// Clinical roles land on their caregiver home. Non-clinical roles fall
// through to the Command Center at /admin.
const CAREGIVER_REDIRECTS: Record<string, string> = {
  nurse: '/care/nurse',
  charge_nurse: '/care/nurse',
  nursing_supervisor: '/care/nurse',
  staff_nurse: '/care/nurse',
  ot_nurse: '/care/nurse',
  resident: '/care/doctor',
  senior_resident: '/care/doctor',
  intern: '/care/doctor',
  hospitalist: '/care/doctor',
  visiting_consultant: '/care/doctor',
  surgeon: '/care/doctor',
  anaesthetist: '/care/doctor',
  pharmacist: '/care/pharmacy',
  lab_technician: '/care/lab',
  radiologist: '/care/lab',
  receptionist: '/care/customer-care',
  ip_coordinator: '/care/customer-care',
  billing_executive: '/care/billing',
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Clinical role → caregiver home.
  const caregiverRoute = CAREGIVER_REDIRECTS[user.role];
  if (caregiverRoute) redirect(caregiverRoute);

  // Everybody else (admin roles, analysts, super_admin) → Command Center.
  // The /admin landing itself re-gates on role and will send non-admins
  // back to '/'.
  redirect('/admin');
}
