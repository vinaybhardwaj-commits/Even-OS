import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import MyTasksClient from './my-tasks-client';

/**
 * /care/my-tasks — CHAT.X.6 UI.a
 *
 * Dedicated "My Tasks" landing for the signed-in user. Lists every task where
 * they are the assignee, grouped by in_progress / pending / completed, with
 * Start / Complete / Cancel actions. Hits the canonical `tasks` table via
 * `tasks.listMine`, `tasks.myCounts`, `tasks.updateStatus`. Completion goes
 * through `chat.completeTask` so the chat message stays authoritative.
 */
export default async function MyTasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <MyTasksClient userId={user.sub} userName={user.name} />;
}
