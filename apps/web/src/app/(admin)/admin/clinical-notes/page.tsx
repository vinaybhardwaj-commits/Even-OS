import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ClinicalNotesClient from './clinical-notes-client';

export default async function ClinicalNotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <ClinicalNotesClient />;
}
