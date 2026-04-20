/**
 * DEMO.2 — Demo persona picker catalog.
 *
 * Single source of truth for the 4 cards shown on /demo/picker (DEMO.4) and
 * the allowlist checked by POST /api/demo/switch (DEMO.3).
 *
 * Adding a card later (Admin, Billing, Supply Chain, etc.) is a
 * one-commit config change:
 *   1. Create / confirm the target test user exists in EHRC.
 *   2. Append a new DemoRole entry below.
 *   3. Add the icon name to the icon map in the picker page
 *      (apps/web/src/app/demo/picker/page.tsx — built in DEMO.4).
 * No migration, no router change, no RBAC edit needed — the switch endpoint
 * reads DEMO_ROLES directly and RBAC only cares that session.role === 'demo'.
 *
 * If this list grows past ~10 entries, promote it to a `demo_roles` DB table
 * with an /admin/demo-roles CRUD UI. For now, config-file keeps the surface
 * minimal and the extension path clear.
 *
 * Design locked-in 20 Apr 2026 (PRD §9).
 */

/** Strict union — any new key here must ALSO appear in DEMO_ROLES below. */
export type DemoRoleKey =
  | 'doctor_consultant'
  | 'doctor_resident'
  | 'charge_nurse'
  | 'nurse';

export interface DemoRole {
  /** Machine key — sent by the picker to POST /api/demo/switch. */
  key: DemoRoleKey;
  /** Human label rendered on the card title. */
  label: string;
  /** One-line description rendered under the label on the card. */
  description: string;
  /** Email of the existing EHRC test user the session will swap into. */
  target_email: string;
  /** lucide-react icon name (PascalCase) — resolved in the picker page's icon map. */
  icon: string;
  /** Render order; lowest first. */
  order: number;
}

export const DEMO_ROLES: readonly DemoRole[] = [
  {
    key: 'doctor_consultant',
    label: 'Doctor (Consultant)',
    description: 'Senior physician / hospitalist view — admissions, rounds, orders, discharge.',
    target_email: 'dr.patel@even.in',
    icon: 'Stethoscope',
    order: 1,
  },
  {
    key: 'doctor_resident',
    label: 'Doctor (Resident / RMO)',
    description: 'Resident medical officer view — ward notes, CPOE, escalations.',
    target_email: 'dr.arun.jose@even.in',
    icon: 'UserRound',
    order: 2,
  },
  {
    key: 'charge_nurse',
    label: 'Charge Nurse View',
    description: 'Shift-lead view — bed board, roster, handoffs, staffing.',
    target_email: 'charge.nurse@even.in',
    icon: 'UserCog',
    order: 3,
  },
  {
    key: 'nurse',
    label: 'Ward Nurse View',
    description: 'Bedside nurse view — vitals, meds, nursing tasks, assessments.',
    target_email: 'test.nurse@even.in',
    icon: 'ClipboardCheck',
    order: 4,
  },
] as const;

/** Strongly-typed tuple of valid keys — useful for Zod enum inputs. */
export const DEMO_ROLE_KEYS: readonly DemoRoleKey[] =
  DEMO_ROLES.map((r) => r.key) as DemoRoleKey[];

/** Lookup a role by key. Returns undefined if the key is not in DEMO_ROLES. */
export function getDemoRole(key: string): DemoRole | undefined {
  return DEMO_ROLES.find((r) => r.key === key);
}

/** Ordered copy of DEMO_ROLES sorted by `order` ascending. */
export function listDemoRoles(): DemoRole[] {
  return [...DEMO_ROLES].sort((a, b) => a.order - b.order);
}

/** Type guard — `role` is a valid DemoRoleKey. */
export function isDemoRoleKey(role: unknown): role is DemoRoleKey {
  return typeof role === 'string' && DEMO_ROLE_KEYS.includes(role as DemoRoleKey);
}
