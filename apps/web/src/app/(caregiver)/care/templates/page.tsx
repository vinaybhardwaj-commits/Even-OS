import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TemplateLibraryClient from './template-library-client';

export default async function TemplateLibraryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <TemplateLibraryClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
