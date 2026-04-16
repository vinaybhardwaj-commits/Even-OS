import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { BedStructureClient } from './bed-structure-client';

const ADMIN_ROLES = ['super_admin', 'hospital_admin', 'gm'];

export default async function BedStructurePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!ADMIN_ROLES.includes(user.role || '')) redirect('/admin/bed-board');
  return <BedStructureClient userRole={user.role || ''} />;
}
