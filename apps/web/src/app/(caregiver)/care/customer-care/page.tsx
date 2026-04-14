import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CustomerCareClient from './customer-care-client';
import CoordinatorPipelineClient from './coordinator-pipeline-client';

const CC_ROLES = [
  'receptionist', 'ip_coordinator', 'front_desk', 'customer_care',
  'admin', 'super_admin',
];

interface SearchParams {
  view?: string;
}

export default async function CustomerCarePage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!CC_ROLES.includes(user.role)) redirect('/care/home');

  const view = searchParams.view || 'gantt';

  return (
    <>
      {view === 'pipeline' ? (
        <CoordinatorPipelineClient userId={user.sub} userRole={user.role} userName={user.name} />
      ) : (
        <CustomerCareClient userId={user.sub} userRole={user.role} userName={user.name} />
      )}
    </>
  );
}
