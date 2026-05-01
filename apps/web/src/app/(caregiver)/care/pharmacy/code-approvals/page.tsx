import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PharmacyCodeApprovalsClient from './pharmacy-code-approvals-client';

export default async function PharmacyCodeApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Phase 2 — Pharmacy Supervisor queue per SOP §5.6.
  // RBAC: caller must hold pharmacy_supervisor (codes_role) OR be super_admin /
  // hospital_admin / chief_pharmacist / senior_pharmacist (existing pharmacist
  // ladder). Server-side router enforces the codes_role check at submit time.
  const allowed = [
    'super_admin', 'hospital_admin',
    'chief_pharmacist', 'senior_pharmacist', 'pharmacist',
  ];
  if (!allowed.includes(user.role)) redirect('/');
  return <PharmacyCodeApprovalsClient user={user} />;
}
