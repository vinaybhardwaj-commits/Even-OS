import { redirect } from 'next/navigation';

/**
 * Admin patient detail → redirect to Patient Chart v3 (caregiver)
 * The Patient Chart at /care/patient/[id] is role-adaptive and works for all roles.
 * This prevents the 404 when clicking a patient in the admin registry.
 */
export default function AdminPatientDetailPage({ params }: { params: { id: string } }) {
  redirect(`/care/patient/${params.id}`);
}
