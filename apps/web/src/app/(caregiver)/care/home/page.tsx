import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CaregiverHome from './caregiver-home';

/**
 * /care/home — Role-based redirect hub.
 *
 * Reads JWT role → maps to the correct persona home route.
 * If no specific persona route exists yet (not built), shows
 * a welcome page with available actions.
 */

// ── Role → Home Route Mapping ─────────────────────────────────────────
const ROLE_HOME_MAP: Record<string, string> = {
  // Nursing group → Nurse Station
  nurse: '/care/nurse',
  senior_nurse: '/care/nurse',
  charge_nurse: '/care/nurse',
  nursing_supervisor: '/care/nurse',
  nursing_manager: '/care/nurse',
  nursing_assistant: '/care/nurse',

  // Clinical / Doctor group → Doctor View
  resident: '/care/doctor',
  senior_resident: '/care/doctor',
  intern: '/care/doctor',
  visiting_consultant: '/care/doctor',
  hospitalist: '/care/doctor',
  specialist_cardiologist: '/care/doctor',
  specialist_neurologist: '/care/doctor',
  specialist_orthopedic: '/care/doctor',

  // Surgical group → OT View
  surgeon: '/care/ot',
  anaesthetist: '/care/ot',
  ot_nurse: '/care/ot',

  // Pharmacy group
  chief_pharmacist: '/care/pharmacy',
  senior_pharmacist: '/care/pharmacy',
  pharmacist: '/care/pharmacy',
  pharmacy_technician: '/care/pharmacy',

  // Lab group
  lab_director: '/care/lab',
  senior_lab_technician: '/care/lab',
  lab_technician: '/care/lab',
  phlebotomist: '/care/lab',
  lab_manager: '/care/lab',

  // Radiology group
  chief_radiologist: '/care/lab',  // Radiology tab within lab view
  senior_radiologist: '/care/lab',
  radiologist: '/care/lab',
  radiology_technician: '/care/lab',

  // Billing group
  billing_manager: '/care/billing',
  billing_executive: '/care/billing',
  insurance_coordinator: '/care/billing',
  financial_analyst: '/care/billing',
  accounts_manager: '/care/billing',

  // Support / Front desk group
  receptionist: '/care/customer-care',
  ip_coordinator: '/care/customer-care',

  // Admin → redirect to admin dashboard
  super_admin: '/admin',
  hospital_admin: '/admin',
  system_super_admin: '/admin',

  // Executive → admin dashboard
  medical_director: '/admin',
  department_head: '/admin',
  coo: '/admin',
  cfo: '/admin',
  hospital_director: '/admin',
  operations_manager: '/admin',
};

export default async function CaregiverHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Check if the target route actually exists (built) or if we should
  // show the welcome page. For now, no persona routes exist yet,
  // so we always show the welcome page.
  const targetRoute = ROLE_HOME_MAP[user.role];

  // Auto-redirect to persona home if the route is built
  const BUILT_ROUTES = ['/care/nurse'];
  if (targetRoute && BUILT_ROUTES.includes(targetRoute)) {
    redirect(targetRoute);
  }

  return (
    <CaregiverHome
      userName={user.name}
      userRole={user.role}
      targetRoute={targetRoute || '/care/home'}
    />
  );
}
