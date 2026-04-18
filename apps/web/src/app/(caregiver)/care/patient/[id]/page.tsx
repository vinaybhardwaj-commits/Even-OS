import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PatientChartClient from './patient-chart-client';
import { chartSelectors } from '@/lib/chart/selectors';

// All clinical + ops roles can view patient charts
const CHART_ROLES = [
  'nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'nursing_manager',
  'resident', 'senior_resident', 'intern', 'visiting_consultant', 'hospitalist',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic',
  'surgeon', 'anaesthetist', 'ot_nurse',
  'pharmacist', 'senior_pharmacist', 'chief_pharmacist',
  'lab_technician', 'senior_lab_technician', 'lab_manager',
  'radiologist', 'senior_radiologist', 'radiology_technician',
  'billing_manager', 'billing_executive', 'insurance_coordinator',
  'ip_coordinator', 'receptionist',
  'medical_director', 'department_head',
  'super_admin', 'hospital_admin', 'operations_manager',
  'staff',
];

export default async function PatientChartPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!CHART_ROLES.includes(user.role)) redirect('/care/home');

  // PC.3.1 projection layer — resolves the chart config for this role.
  // Safe-default: returns fallback preset if matrix is missing / empty.
  // PC.3.1 threads it as a prop but the client doesn't yet read it.
  // PC.3.2 will activate it for tab filtering + overview layout.
  const chartConfig = await chartSelectors.forRole(user.role, user.hospital_id);

  return <PatientChartClient
    patientId={params.id}
    userId={user.sub}
    userRole={user.role}
    userName={user.name}
    hospitalId={user.hospital_id}
    chartConfig={chartConfig}
  />;
}
