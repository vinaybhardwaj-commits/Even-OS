/**
 * My Work — role-keyed action tile map for the Command Center "My Work" rail.
 *
 * Why this exists
 * ---------------
 * The AdminSidebar already enumerates ~90 routes. That's good for discovery
 * but terrible for daily use — every role needs 6-8 surfaces they hit every
 * morning, not a dropdown of 90. `MY_WORK_ACTIONS` is a small, hand-curated
 * cheat-sheet of the *actual* tiles each role reaches for first.
 *
 * Design principles
 * -----------------
 * 1. Every tile here MUST correspond to a real, shipped /admin/* page.
 *    The admin-manifest CI gate guarantees the routes exist.
 * 2. 6-8 tiles per role, max. More than that and it stops being "my work"
 *    and starts being "all modules".
 * 3. One icon per tile, blurb is a *verb phrase* answering "what's this for"
 *    — not a noun phrase like the manifest's blurb.
 * 4. Order matters: the first tile should be the thing this role opens
 *    most often.
 *
 * Extending
 * ---------
 * New role? Add an entry to MY_WORK_ACTIONS. Unknown role falls back to
 * an empty array — the rail simply doesn't render for that user.
 */

export type MyWorkAction = {
  title: string;
  blurb: string;  // verb-phrase action description
  href: string;   // must be a live /admin/* path (or auth-scoped non-admin)
  icon: string;
};

export const MY_WORK_ACTIONS: Record<string, MyWorkAction[]> = {
  super_admin: [
    { title: 'Users',                blurb: 'Invite, suspend, assign roles',        href: '/admin/users',                  icon: '👥' },
    { title: 'Dedup Queue',          blurb: 'Merge potential patient duplicates',   href: '/admin/dedup',                  icon: '↔' },
    { title: 'Security Dashboard',   blurb: 'Login anomalies, MFA, device trust',   href: '/admin/security-dashboard',     icon: '🛡️' },
    { title: 'Approval Hierarchies', blurb: 'Configure who signs off on what',      href: '/admin/approval-hierarchies',   icon: '🪜' },
    { title: 'AI Observatory',       blurb: 'Background LLM jobs and latency',      href: '/admin/ai-observatory',         icon: '🔭' },
    { title: 'Forms & Commands',     blurb: 'Slash commands, 26 forms live',        href: '/admin/forms',                  icon: '📝' },
    { title: 'Integrations',         blurb: 'HL7, LSQ, event bus wiring',           href: '/admin/integrations',           icon: '🔗' },
    { title: 'Login Attempts',       blurb: 'Auth log and lockouts',                href: '/admin/login-attempts',         icon: '📋' },
  ],

  hospital_admin: [
    { title: 'Revenue Dashboard',    blurb: 'Collections, refunds, analytics',      href: '/admin/revenue-dashboard',      icon: '📈' },
    { title: 'Insurance Claims',     blurb: 'Pre-auth, enhancement, TPA settle',    href: '/admin/insurance-claims',       icon: '📋' },
    { title: 'GM Dashboard',         blurb: 'Daily KPI cockpit',                    href: '/admin/gm-dashboard',           icon: '📊' },
    { title: 'Incident Reporting',   blurb: 'Adverse events, falls, med errors',    href: '/admin/incident-reporting',     icon: '⚠️' },
    { title: 'NABH Indicators',      blurb: '100 quality metrics tracked',          href: '/admin/nabh-indicators',        icon: '★' },
    { title: 'Compliance',           blurb: 'NABH, DPDP, audit readiness',          href: '/admin/compliance',             icon: '📜' },
    { title: 'Patient Feedback',     blurb: 'Surveys, ratings, NPS',                href: '/admin/patient-feedback',       icon: '💬' },
    { title: 'Charge Master',        blurb: 'Prices, procedures, labs',             href: '/admin/charge-master',          icon: '₹' },
  ],

  dept_head: [
    { title: 'Wall View',            blurb: 'Rotating floor display',               href: '/admin/wall-view',              icon: '🖥️' },
    { title: 'Bed Board',            blurb: 'Live floor/ward/room/bed grid',        href: '/admin/bed-board',              icon: '🛏️' },
    { title: 'Critical Values',      blurb: 'Read-back & escalation',               href: '/admin/critical-values',        icon: '🚨' },
    { title: 'Incident Reporting',   blurb: 'Adverse events, falls',                href: '/admin/incident-reporting',     icon: '⚠️' },
    { title: 'Clinical Notes',       blurb: 'Progress notes, co-sign queue',        href: '/admin/clinical-notes',         icon: '🗒️' },
    { title: 'OT Management',        blurb: 'Schedule, WHO checklist, turnover',    href: '/admin/ot-management',          icon: '🏨' },
    { title: 'Lab & Radiology',      blurb: 'Orders, results, specimens',           href: '/admin/lab-radiology',          icon: '🧬' },
    { title: 'Duty Roster',          blurb: 'Staff schedules and assignments',      href: '/admin/duty-roster',            icon: '🗓️' },
  ],
};

/**
 * Resolve the My Work tile list for a role. Unknown roles get an empty
 * list — the consumer can check length and render a placeholder.
 */
export function actionsForRole(role: string): MyWorkAction[] {
  return MY_WORK_ACTIONS[role] ?? [];
}
