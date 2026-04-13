import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Hl7AnalyzerClient from './hl7-analyzer-client';

export default async function Hl7AnalyzerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <Hl7AnalyzerClient user={user} />;
}
