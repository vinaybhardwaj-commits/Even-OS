/**
 * MyWorkRail — role-adaptive action tile grid for the Command Center.
 *
 * Pure server-side rendering: no data fetching, no hooks. The tile list is
 * fully determined by the user's role via @/lib/my-work. This keeps the
 * rail cheap to render and reliable — it works even if every API is down.
 *
 * Layout: 2 cols on md, 3 cols on xl. Titles + one-line verb phrase +
 * icon. Clicking any tile deep-links to a live /admin/* page.
 */
import Link from 'next/link';
import { actionsForRole, type MyWorkAction } from '@/lib/my-work';

interface MyWorkRailProps {
  role: string;
}

export function MyWorkRail({ role }: MyWorkRailProps) {
  const actions = actionsForRole(role);

  // If no actions are defined for this role, skip the rail entirely rather
  // than render an empty shell. The /admin page already gates to admin
  // roles so this is mostly defensive.
  if (actions.length === 0) return null;

  return (
    <section aria-label="My Work" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
          My Work
        </h2>
        <span className="text-[11px] text-slate-500">
          Role: <span className="font-mono">{role}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {actions.map(action => (
          <Tile key={action.href} action={action} />
        ))}
      </div>
    </section>
  );
}

function Tile({ action }: { action: MyWorkAction }) {
  return (
    <Link
      href={action.href}
      className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-md hover:-translate-y-0.5"
    >
      <span
        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-base text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"
        aria-hidden="true"
      >
        {action.icon}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold leading-tight text-slate-900 group-hover:text-blue-900">
          {action.title}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">
          {action.blurb}
        </span>
      </span>
    </Link>
  );
}
