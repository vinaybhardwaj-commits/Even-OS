import MySchedule from '@/components/shifts/MySchedule';

/**
 * /care/schedule — My Schedule page.
 * Shows the current user's weekly shift schedule.
 * Auth is handled by the (caregiver) layout.
 */
export default function SchedulePage() {
  return (
    <div className="py-6 px-4 care-content-padded">
      <MySchedule />
    </div>
  );
}
