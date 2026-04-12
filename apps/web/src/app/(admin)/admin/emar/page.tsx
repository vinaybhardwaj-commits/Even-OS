import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { EmarClient } from './emar-client';

export const metadata = {
  title: 'eMAR | Even OS',
  description: 'Electronic Medication Administration Record',
};

export default async function EmarPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <EmarClient />;
}
