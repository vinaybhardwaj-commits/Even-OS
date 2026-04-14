import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import MySchedule from '@/components/shifts/MySchedule';

/**
 * /care/schedule — My Schedule page.
 * Shows the current user's weekly shift schedule.
 */
export default async function SchedulePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <div className="py-6 px-4 care-content-padded">
      <MySchedule />
    </div>
  );
}
