import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TemplateBuilderClient from './template-builder-client';

export default async function TemplateBuilderPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <TemplateBuilderClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
