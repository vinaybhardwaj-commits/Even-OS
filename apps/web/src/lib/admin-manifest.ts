/**
 * Admin Route Manifest — single source of truth for every admin surface.
 *
 * Consumed by:
 *  - <AdminSidebar /> — pillar-grouped nav
 *  - <CommandPalette /> — ⌘K searchable index
 *  - /admin (Command Center) — tile grid
 *  - scripts/verify-admin-manifest.ts — CI gate that fails the build on drift
 *
 * Drift prevention: the CI gate verifies two invariants on every build:
 *   1. Every page.tsx under src/app/(admin)/admin/** has a manifest entry
 *      (unless its path appears in SKIP_PATHS below).
 *   2. Every manifest entry whose path begins with /admin/ points at a real
 *      page.tsx on disk.
 * That is how we avoid ever repeating the "50 pages unreachable" mess again.
 *
 * AD.2 ships the full enumeration. ~95 pages on disk → ~92 manifest entries
 * (index page + one dynamic segment excluded).
 */

export type AdminPillar =
  | 'ops'
  | 'clinical'
  | 'diagnostics'
  | 'revenue'
  | 'finance'
  | 'quality'
  | 'platform'
  | 'people';

export interface AdminRoute {
  path: string;             // URL path, e.g. "/admin/bed-board"
  title: string;            // Human title, e.g. "Bed Board"
  pillar: AdminPillar;      // Which of the 8 top-level groupings
  icon?: string;            // Emoji or short glyph
  blurb?: string;           // One-line description (used in tile + palette)
  roles: string[];          // Roles that can see this route in nav
  keywords?: string[];      // Extra search terms for command palette
  shippedIn?: string;       // Sprint code (e.g. "BM.2") — used for "what's new"
  status?: 'live' | 'beta' | 'legacy' | 'stub';
  hideFromNav?: boolean;    // If true, route is registered but NOT shown in sidebar
                            // (e.g. sub-wizards like /admin/patients/register)
}

export const PILLAR_META: Record<AdminPillar, { label: string; icon: string; order: number; blurb: string }> = {
  ops:         { label: 'Operations',     icon: '🏥', order: 1, blurb: 'Beds, admissions, transfers, shifts' },
  clinical:    { label: 'Clinical',       icon: '🩺', order: 2, blurb: 'Patients, EMR, CPOE, pathways' },
  diagnostics: { label: 'Diagnostics',    icon: '🧬', order: 3, blurb: 'Lab, radiology, blood bank, QC' },
  revenue:     { label: 'Revenue',        icon: '₹',  order: 4, blurb: 'Billing, insurance, claims' },
  finance:     { label: 'Finance',        icon: '📊', order: 5, blurb: 'GL, AR/AP, statements, GST' },
  quality:     { label: 'Quality & Safety', icon: '🛡️', order: 6, blurb: 'Incidents, RCA, NABH, audits' },
  platform:    { label: 'Platform & AI',  icon: '⚙️', order: 7, blurb: 'AI, forms, templates, integrations' },
  people:      { label: 'People',         icon: '👥', order: 8, blurb: 'Users, roles, portal, chat' },
};

// Role sets used frequently
const ADMIN = ['super_admin', 'hospital_admin'];
const ADMIN_DEPT = [...ADMIN, 'dept_head'];
const ALL_STAFF = [...ADMIN_DEPT, 'clinician', 'staff', 'analyst'];

/**
 * Paths the CI gate should NOT require in the manifest.
 * - /admin itself is the Command Center landing, not a nav target.
 * - Dynamic segments ([id]) are not nav targets.
 */
export const MANIFEST_SKIP_PATHS = new Set<string>([
  '/admin',
  '/admin/patients/[id]',
]);

export const adminRoutes: AdminRoute[] = [
  // ── Operations ───────────────────────────────────────────────────────
  { path: '/admin/bed-board',     title: 'Bed Board',      pillar: 'ops', icon: '🛏️', blurb: 'Live floor/ward/room/bed grid with patient details', roles: ADMIN_DEPT, shippedIn: 'BM.2', status: 'live', keywords: ['beds','grid','occupancy','assign','transfer'] },
  { path: '/admin/bed-structure', title: 'Bed Structure',  pillar: 'ops', icon: '🏗️', blurb: 'Admin tree editor for wards, rooms, beds',          roles: ADMIN,      shippedIn: 'BM.3', status: 'live', keywords: ['wards','rooms','tree','structure'] },
  { path: '/admin/bed-rack',      title: 'Bed Rack',       pillar: 'ops', icon: '📊', blurb: 'Gantt-style bed timeline with LOS + turnover',      roles: ADMIN_DEPT, shippedIn: 'BM.5', status: 'live', keywords: ['gantt','timeline','los'] },
  { path: '/admin/admissions',    title: 'Admissions',     pillar: 'ops', icon: '🏥', blurb: 'Admit wizard, checklist, pre-auth',                 roles: ADMIN_DEPT, shippedIn: 'S4a', status: 'live' },
  { path: '/admin/transfers',     title: 'Transfers',      pillar: 'ops', icon: '⇄',  blurb: 'Bed & ward transfers',                              roles: ADMIN_DEPT, shippedIn: 'S4b', status: 'live' },
  { path: '/admin/discharge',     title: 'Discharge',      pillar: 'ops', icon: '✔️', blurb: 'Milestones & discharge queue',                      roles: ADMIN_DEPT, shippedIn: 'S4b', status: 'live' },
  { path: '/admin/wristbands',    title: 'Wristbands',     pillar: 'ops', icon: '🎟️', blurb: 'Print queue for patient wristbands',                roles: ADMIN_DEPT, shippedIn: 'S3c', status: 'live' },
  { path: '/admin/shifts',        title: 'Shift Management', pillar: 'ops', icon: '📅', blurb: 'Templates, rosters, shift calendar',             roles: ADMIN,      shippedIn: 'Phase 0B', status: 'live' },
  { path: '/admin/duty-roster',   title: 'Duty Roster',    pillar: 'ops', icon: '🗓️', blurb: 'Staff schedules & assignments',                    roles: ADMIN,      shippedIn: 'Phase 0B', status: 'live' },
  { path: '/admin/ot-management', title: 'OT Management',  pillar: 'ops', icon: '🏨', blurb: 'OT scheduling, WHO checklist, turnover',            roles: ADMIN_DEPT, shippedIn: 'S7c', status: 'live', keywords: ['surgery','theatre','anesthesia'] },

  // ── Clinical ─────────────────────────────────────────────────────────
  { path: '/admin/patients',          title: 'Patient Registry',  pillar: 'clinical', icon: '👥', blurb: 'Register, search, manage patients',      roles: ADMIN_DEPT, shippedIn: 'S3a', status: 'live' },
  { path: '/admin/patients/register', title: 'Register Patient',  pillar: 'clinical', icon: '➕', blurb: '5-step registration wizard',             roles: ADMIN_DEPT, shippedIn: 'S3a', status: 'live', hideFromNav: true, keywords: ['new patient','register','wizard'] },
  { path: '/admin/dedup',             title: 'Dedup Queue',       pillar: 'clinical', icon: '↔',  blurb: 'Review & merge patient duplicates',      roles: ADMIN,      shippedIn: 'S3b', status: 'live' },
  { path: '/admin/calculators',       title: 'Calculators',       pillar: 'clinical', icon: '🧮', blurb: 'MDCalc scoring engine, 10+ calcs',       roles: ALL_STAFF,  shippedIn: 'PC.2', status: 'live', keywords: ['mdcalc','score','meld','news2'] },
  { path: '/admin/care-pathways',     title: 'Care Pathways',     pillar: 'clinical', icon: '🎯', blurb: 'DAG templates, milestones, escalation',  roles: ADMIN_DEPT, shippedIn: 'S5d', status: 'live' },
  { path: '/admin/templates',         title: 'Template Management', pillar: 'clinical', icon: '📝', blurb: 'User-built templates, pre-built suite', roles: ADMIN,    shippedIn: 'TM.1', status: 'live' },
  { path: '/admin/chart/roles',       title: 'Chart Permissions', pillar: 'clinical', icon: '🔐', blurb: 'Role-tab matrix, preview-as-role',       roles: ADMIN,      shippedIn: 'PC.3.4', status: 'live' },
  { path: '/admin/clinical-notes',    title: 'Clinical Notes',    pillar: 'clinical', icon: '🗒️', blurb: 'Progress notes, co-sign queue',          roles: ADMIN_DEPT, shippedIn: 'S5b', status: 'live' },
  { path: '/admin/problem-list',      title: 'Problem List',      pillar: 'clinical', icon: '📋', blurb: 'Active / resolved conditions',           roles: ADMIN_DEPT, shippedIn: 'S5a', status: 'live' },
  { path: '/admin/allergies',         title: 'Allergies',         pillar: 'clinical', icon: '⚠️', blurb: 'Allergy registry, severity, reactions',  roles: ADMIN_DEPT, shippedIn: 'S5a', status: 'live' },
  { path: '/admin/vitals',            title: 'Vitals',            pillar: 'clinical', icon: '❤️', blurb: 'Vitals observations, NEWS2, trends',     roles: ADMIN_DEPT, shippedIn: 'S5a', status: 'live' },
  { path: '/admin/orders',            title: 'Orders',            pillar: 'clinical', icon: '📥', blurb: 'All CPOE orders, status tracking',       roles: ADMIN_DEPT, shippedIn: 'S5c', status: 'live', keywords: ['cpoe','order management'] },
  { path: '/admin/order-sets',        title: 'Order Sets',        pillar: 'clinical', icon: '📦', blurb: 'Bundled order templates by condition',   roles: ADMIN,      shippedIn: 'S2b', status: 'live' },
  { path: '/admin/medication-orders', title: 'Medication Orders', pillar: 'clinical', icon: '💊', blurb: 'CPOE med orders with CDS checks',        roles: ADMIN_DEPT, shippedIn: 'S5c', status: 'live' },
  { path: '/admin/emar',              title: 'eMAR',              pillar: 'clinical', icon: '📈', blurb: 'Electronic Medication Admin Record',     roles: ADMIN_DEPT, shippedIn: 'NS.4', status: 'live', keywords: ['mar','administration'] },
  { path: '/admin/pharmacy',          title: 'Pharmacy',          pillar: 'clinical', icon: '🏪', blurb: 'Inventory, dispensing, POs, narcotics',  roles: ADMIN_DEPT, shippedIn: 'S7a', status: 'live' },
  { path: '/admin/drug-master',       title: 'Drug Master',       pillar: 'clinical', icon: '🧪', blurb: 'Formulary, strength, route, contraindications', roles: ADMIN, shippedIn: 'S2a', status: 'live' },
  { path: '/admin/consents',          title: 'Consents',          pillar: 'clinical', icon: '✍️', blurb: 'Patient consent documents, signatures',  roles: ADMIN_DEPT, shippedIn: 'S2b', status: 'live' },
  { path: '/admin/consent-templates', title: 'Consent Templates', pillar: 'clinical', icon: '📄', blurb: 'Reusable consent forms by procedure',    roles: ADMIN,      shippedIn: 'S2b', status: 'live' },
  { path: '/admin/discharge-templates', title: 'Discharge Templates', pillar: 'clinical', icon: '📤', blurb: 'Discharge summary templates',        roles: ADMIN,      shippedIn: 'S2b', status: 'live' },

  // ── Diagnostics ──────────────────────────────────────────────────────
  { path: '/admin/lab-radiology',     title: 'Lab & Radiology',   pillar: 'diagnostics', icon: '🧬', blurb: 'Orders, results, specimens, imaging', roles: ADMIN_DEPT, shippedIn: 'S7b', status: 'live' },
  { path: '/admin/lab/worklist',      title: 'Lab Worklist',      pillar: 'diagnostics', icon: '📚', blurb: 'Worklist, specimens, barcode, TAT',  roles: ADMIN_DEPT, shippedIn: 'B.2', status: 'live' },
  { path: '/admin/lab/test-catalog-v2', title: 'Test Catalog v2', pillar: 'diagnostics', icon: '📕', blurb: 'Test master with panels, tariffs, TAT', roles: ADMIN,    shippedIn: 'B.2', status: 'live' },
  { path: '/admin/lab/qc-enhancement',title: 'QC & Westgard',     pillar: 'diagnostics', icon: '📈', blurb: 'Multi-rule Westgard, LJ chart, SDI', roles: ADMIN_DEPT, shippedIn: 'B.4', status: 'live', keywords: ['westgard','sigma','eqas'] },
  { path: '/admin/lab/external-labs', title: 'External Labs',     pillar: 'diagnostics', icon: '🏥', blurb: 'Outsourced lab vendors, TAT, pricing', roles: ADMIN,    shippedIn: 'B.1', status: 'live' },
  { path: '/admin/lab/outsourced',    title: 'Outsourced Orders', pillar: 'diagnostics', icon: '↗️', blurb: 'Track tests sent to external labs',    roles: ADMIN_DEPT, shippedIn: 'B.1', status: 'live' },
  { path: '/admin/lab/analytics',     title: 'Lab Analytics',     pillar: 'diagnostics', icon: '📊', blurb: 'TAT, volume, revenue analytics',       roles: ADMIN,      shippedIn: 'B.6', status: 'live' },
  { path: '/admin/lab-reports',       title: 'Lab Reports',       pillar: 'diagnostics', icon: '📄', blurb: 'Browse/print lab result reports',      roles: ADMIN_DEPT, shippedIn: 'S7b', status: 'live' },
  { path: '/admin/blood-bank',        title: 'Blood Bank',        pillar: 'diagnostics', icon: '🩸', blurb: 'Inventory, crossmatch, reactions',    roles: ADMIN_DEPT, shippedIn: 'S7b', status: 'live' },
  { path: '/admin/culture-histopath', title: 'Culture & Histopath', pillar: 'diagnostics', icon: '🔬', blurb: 'Culture sensitivity, histopathology', roles: ADMIN_DEPT, shippedIn: 'S7b', status: 'live' },
  { path: '/admin/hl7-analyzer',      title: 'HL7 Analyzers',     pillar: 'diagnostics', icon: '🔌', blurb: 'Adapters, messages, dead letters',    roles: ADMIN,      shippedIn: 'L.8', status: 'live' },
  { path: '/admin/test-cockpit',      title: 'Test Cockpit',      pillar: 'diagnostics', icon: '🛠️', blurb: 'Lab engineering console (internal)',   roles: ADMIN,      status: 'beta' },
  { path: '/admin/test-catalog',      title: 'Test Catalog (legacy)', pillar: 'diagnostics', icon: '🗃️', blurb: 'Redirects to Test Catalog v2',     roles: ADMIN,      status: 'legacy', hideFromNav: true, keywords: ['old','deprecated','redirect'] },
  { path: '/admin/qc-levey-jennings', title: 'Levey-Jennings (legacy)', pillar: 'diagnostics', icon: '📉', blurb: 'Redirects to QC & Westgard',       roles: ADMIN,      status: 'legacy', hideFromNav: true, keywords: ['old','deprecated','redirect'] },
  { path: '/admin/lab-worklist',      title: 'Lab Worklist (redirect)', pillar: 'diagnostics', icon: '🧪', blurb: 'Redirects to /admin/lab/worklist', roles: ADMIN,      status: 'legacy', hideFromNav: true, keywords: ['worklist','redirect','misroute'] },

  // ── Revenue ──────────────────────────────────────────────────────────
  { path: '/admin/billing-v2',            title: 'Billing v2',       pillar: 'revenue', icon: '💰', blurb: 'Accounts, deposits, packages, room charges', roles: ADMIN_DEPT, shippedIn: 'A.1', status: 'live' },
  { path: '/admin/billing/insurers',      title: 'Insurer Master',   pillar: 'revenue', icon: '🏦', blurb: '31 insurers seeded, contracts, SLAs', roles: ADMIN,      shippedIn: 'A.2', status: 'live' },
  { path: '/admin/billing/insurer-rules', title: 'TPA Rules',        pillar: 'revenue', icon: '⚖️', blurb: '10-type rules engine, deductions',    roles: ADMIN,      shippedIn: 'A.3', status: 'live' },
  { path: '/admin/billing/approvals',     title: 'Waiver Approvals', pillar: 'revenue', icon: '✅', blurb: '4-tier waiver governance',             roles: ADMIN,      shippedIn: 'A.4', status: 'live' },
  { path: '/admin/billing/implants',      title: 'Implants Registry',pillar: 'revenue', icon: '🦾', blurb: 'Implant codes, pricing, traceability', roles: ADMIN,      shippedIn: 'A.5', status: 'live' },
  { path: '/admin/insurance-claims',      title: 'Insurance Claims', pillar: 'revenue', icon: '📋', blurb: 'Pre-auth, enhancement, TPA settlement', roles: ADMIN_DEPT, shippedIn: 'S6b', status: 'live' },
  { path: '/admin/revenue-dashboard',     title: 'Revenue Dashboard',pillar: 'revenue', icon: '📈', blurb: 'Refunds, invoices, analytics, trends', roles: ADMIN,      shippedIn: 'S6c', status: 'live' },
  { path: '/admin/charge-master',         title: 'Charge Master',    pillar: 'revenue', icon: '₹',  blurb: 'Prices, procedures, labs',             roles: ADMIN,      shippedIn: 'S2a', status: 'live' },
  { path: '/admin/billing',               title: 'Billing (legacy)', pillar: 'revenue', icon: '🗄️', blurb: 'Redirects to Billing v2',              roles: ADMIN,      status: 'legacy', hideFromNav: true, keywords: ['old','deprecated','redirect'] },

  // ── Finance ──────────────────────────────────────────────────────────
  { path: '/admin/finance/dashboard',         title: 'Finance Dashboard',   pillar: 'finance', icon: '📊', blurb: 'Revenue, cash, AR aging, close status', roles: ADMIN, shippedIn: 'C.7', status: 'live' },
  { path: '/admin/finance/chart-of-accounts', title: 'Chart of Accounts',   pillar: 'finance', icon: '📖', blurb: '92 accounts across 5 types',             roles: ADMIN, shippedIn: 'C.1', status: 'live' },
  { path: '/admin/finance/journal-entries',   title: 'Journal Entries',     pillar: 'finance', icon: '📝', blurb: 'Double-entry JE with balanced validation', roles: ADMIN, shippedIn: 'C.2', status: 'live' },
  { path: '/admin/finance/vendors',           title: 'Vendors (AP)',        pillar: 'finance', icon: '🏢', blurb: 'Vendor contracts, invoices, TDS',         roles: ADMIN, shippedIn: 'C.3', status: 'live' },
  { path: '/admin/finance/receivables',       title: 'Receivables (AR)',    pillar: 'finance', icon: '📤', blurb: 'AR ledger, aging, collections',           roles: ADMIN, shippedIn: 'C.4', status: 'live' },
  { path: '/admin/finance/statements',        title: 'Financial Statements', pillar: 'finance', icon: '📑', blurb: 'P&L, Balance Sheet, Cash Flow',         roles: ADMIN, shippedIn: 'C.5', status: 'live' },
  { path: '/admin/finance/gst',               title: 'GST Module',          pillar: 'finance', icon: '%',  blurb: 'GSTR-1/3B, ITC ledger, reconciliation',   roles: ADMIN, shippedIn: 'C.6', status: 'live' },
  { path: '/admin/finance/periods',           title: 'Accounting Periods',  pillar: 'finance', icon: '🔒', blurb: 'Period close workflow, soft/hard lock',   roles: ADMIN, shippedIn: 'C.7', status: 'live' },
  { path: '/admin/gst-rates',                 title: 'GST Rates',           pillar: 'finance', icon: '%',  blurb: 'GST rate master (HSN/SAC)',               roles: ADMIN, shippedIn: 'S2c', status: 'live' },

  // ── Quality & Safety ─────────────────────────────────────────────────
  { path: '/admin/incident-reporting',    title: 'Incident Reporting',    pillar: 'quality', icon: '⚠️', blurb: 'Adverse events, falls, medication errors', roles: ADMIN_DEPT, shippedIn: 'S8a', status: 'live' },
  { path: '/admin/rca',                   title: 'RCA Engine',            pillar: 'quality', icon: '🔍', blurb: 'Fishbone, five-why, CAPA tracking',        roles: ADMIN_DEPT, shippedIn: 'S8b', status: 'live' },
  { path: '/admin/infection-surveillance',title: 'Infection Surveillance',pillar: 'quality', icon: '🦠', blurb: 'HAI tracking, antibiotic stewardship',     roles: ADMIN_DEPT, shippedIn: 'S8c', status: 'live' },
  { path: '/admin/safety-audits',         title: 'Safety & Audits',       pillar: 'quality', icon: '📋', blurb: 'Rounds, audits, complaints',               roles: ADMIN_DEPT, shippedIn: 'S8d', status: 'live' },
  { path: '/admin/nabh-indicators',       title: 'NABH Indicators',       pillar: 'quality', icon: '★',  blurb: '100 quality metrics tracked',              roles: ADMIN,      shippedIn: 'S2c', status: 'live' },
  { path: '/admin/critical-values',       title: 'Critical Values',       pillar: 'quality', icon: '🚨', blurb: 'NABH alerts, read-back, escalation',       roles: ADMIN_DEPT, shippedIn: 'S5a', status: 'live' },

  // ── Platform & AI ────────────────────────────────────────────────────
  { path: '/admin/status',          title: 'System Status',     pillar: 'platform', icon: '🩺', blurb: 'Deploy, DB, LLM, errors, sessions — operator deep-dive', roles: ['super_admin'], shippedIn: 'AD.4', status: 'live', keywords: ['system','health','deploy','probe','uptime','diagnostics'] },
  { path: '/admin/ai-observatory',  title: 'AI Observatory',    pillar: 'platform', icon: '🔭', blurb: 'Background LLM jobs, latency, feedback',   roles: ADMIN, shippedIn: 'AI.1', status: 'live', keywords: ['llm','qwen','observatory'] },
  { path: '/admin/ai-settings',     title: 'AI Settings',       pillar: 'platform', icon: '🎛️', blurb: 'Thresholds, feature flags, prompts',       roles: ADMIN, shippedIn: 'AI.6', status: 'live' },
  { path: '/admin/forms',           title: 'Forms & Commands',  pillar: 'platform', icon: '📝', blurb: 'Slash commands, 26 forms, submission viewer', roles: ADMIN, shippedIn: 'SC.1', status: 'live' },
  { path: '/admin/forms/audit',     title: 'Form Audit',        pillar: 'platform', icon: '📜', blurb: 'Submission audit log',                      roles: ADMIN, shippedIn: 'SC.3', status: 'live' },
  { path: '/admin/gm-dashboard',    title: 'GM Dashboard',      pillar: 'platform', icon: '📊', blurb: 'GM KPI cockpit',                            roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/mod-dashboard',   title: 'MOD Dashboard',     pillar: 'platform', icon: '🏩', blurb: 'Medical Officer on Duty cockpit',          roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/ceo-dashboard',   title: 'CEO Dashboard',     pillar: 'platform', icon: '💼', blurb: 'CEO-level KPIs',                            roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/wall-view',       title: 'Wall View',         pillar: 'platform', icon: '🖥️', blurb: 'Auto-rotating floor TV display',            roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/dr-performance',  title: 'Dr Performance',    pillar: 'platform', icon: '👨‍⚕️', blurb: 'Per-doctor performance metrics',          roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/kpi-definitions', title: 'KPI Definitions',   pillar: 'platform', icon: '📐', blurb: 'Define KPI formulas and targets',           roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/alert-queue',     title: 'Alert Queue',       pillar: 'platform', icon: '🔔', blurb: 'System-wide alerts triage',                 roles: ADMIN, shippedIn: 'S12', status: 'live' },
  { path: '/admin/integrations',    title: 'Integrations',      pillar: 'platform', icon: '🔗', blurb: 'HL7, LSQ, event bus overview',              roles: ADMIN, shippedIn: 'S15', status: 'live' },
  { path: '/admin/hl7-messages',    title: 'HL7 Messages',      pillar: 'platform', icon: '📥', blurb: 'HL7 message log and dead letters',          roles: ADMIN, shippedIn: 'S15', status: 'live' },
  { path: '/admin/event-bus',       title: 'Event Bus',         pillar: 'platform', icon: '🔁', blurb: 'Internal event fan-out',                    roles: ADMIN, shippedIn: 'S15', status: 'live' },
  { path: '/admin/lsq-sync',        title: 'LSQ Sync',          pillar: 'platform', icon: '🔗', blurb: 'LeadSquared CRM import',                    roles: ADMIN, shippedIn: 'S4c', status: 'live' },
  { path: '/admin/approval-hierarchies', title: 'Approval Hierarchies', pillar: 'platform', icon: '🪜', blurb: 'Who approves what — config',       roles: ADMIN, shippedIn: 'S2c', status: 'live' },
  { path: '/admin/security-dashboard', title: 'Security',       pillar: 'platform', icon: '🛡️', blurb: 'Login anomalies, MFA, device trust',       roles: ADMIN, shippedIn: 'S16', status: 'live' },
  { path: '/admin/compliance',      title: 'Compliance',        pillar: 'platform', icon: '📜', blurb: 'NABH, DPDP, audit readiness',               roles: ADMIN, shippedIn: 'S16', status: 'live' },
  { path: '/admin/retention-rules', title: 'Retention Rules',   pillar: 'platform', icon: '🗄️', blurb: 'Data retention and purge rules',           roles: ADMIN, shippedIn: 'S17', status: 'live' },
  { path: '/admin/mrd-documents',   title: 'MRD Documents',     pillar: 'platform', icon: '📂', blurb: 'Medical record documents browser',          roles: ADMIN, shippedIn: 'S17', status: 'live' },

  // ── People ───────────────────────────────────────────────────────────
  { path: '/admin/users',             title: 'Users',             pillar: 'people', icon: '👥', blurb: 'Manage staff accounts',               roles: ADMIN, shippedIn: 'S1', status: 'live' },
  { path: '/admin/roles',             title: 'Roles',             pillar: 'people', icon: '🔐', blurb: 'Roles and permissions matrix',        roles: ADMIN, shippedIn: 'S1', status: 'live' },
  { path: '/admin/roles/permissions', title: 'Role Permissions',  pillar: 'people', icon: '🗝️', blurb: 'Per-role permission editor',          roles: ADMIN, shippedIn: 'S1', status: 'live' },
  { path: '/admin/login-attempts',    title: 'Login Attempts',    pillar: 'people', icon: '📋', blurb: 'Auth log & lockouts',                 roles: ADMIN, shippedIn: 'S1', status: 'live' },
  { path: '/admin/patient-feedback',  title: 'Patient Feedback',  pillar: 'people', icon: '💬', blurb: 'Surveys, ratings, NPS',               roles: ADMIN, shippedIn: 'S14', status: 'live' },
  { path: '/admin/patient-payments',  title: 'Patient Payments',  pillar: 'people', icon: '💳', blurb: 'Portal payment transactions',         roles: ADMIN, shippedIn: 'S14', status: 'live' },
  { path: '/admin/patient-services',  title: 'Patient Services',  pillar: 'people', icon: '🛎️', blurb: 'Service requests from portal',        roles: ADMIN, shippedIn: 'S14', status: 'live' },
  { path: '/profile',                 title: 'My Profile',        pillar: 'people', icon: '👤', blurb: 'Password, devices, activity',         roles: ALL_STAFF, status: 'live' },
  { path: '/break-glass',             title: 'Break-Glass',       pillar: 'people', icon: '🚨', blurb: 'Emergency access (audited)',          roles: ALL_STAFF, status: 'live' },
];

/**
 * Filter routes by user role. Used by sidebar + landing tile grid.
 * Routes flagged with hideFromNav are excluded.
 */
export function routesForRole(role: string): AdminRoute[] {
  return adminRoutes.filter(r => r.roles.includes(role) && !r.hideFromNav);
}

/**
 * Filter routes by user role, including hideFromNav entries. For the command
 * palette — we still want to be able to search for "register patient" even
 * though that route isn't in the sidebar.
 */
export function searchableRoutesForRole(role: string): AdminRoute[] {
  return adminRoutes.filter(r => r.roles.includes(role));
}

/**
 * Group routes by pillar, ordered per PILLAR_META.order.
 */
export function routesByPillar(routes: AdminRoute[]): Array<{ pillar: AdminPillar; meta: typeof PILLAR_META[AdminPillar]; routes: AdminRoute[] }> {
  const buckets = new Map<AdminPillar, AdminRoute[]>();
  for (const r of routes) {
    if (!buckets.has(r.pillar)) buckets.set(r.pillar, []);
    buckets.get(r.pillar)!.push(r);
  }
  return (Object.keys(PILLAR_META) as AdminPillar[])
    .filter(p => buckets.has(p))
    .sort((a, b) => PILLAR_META[a].order - PILLAR_META[b].order)
    .map(p => ({ pillar: p, meta: PILLAR_META[p], routes: buckets.get(p)! }));
}

/**
 * Simple fuzzy match for command palette: matches title, path, keywords.
 */
export function searchRoutes(routes: AdminRoute[], query: string): AdminRoute[] {
  const q = query.trim().toLowerCase();
  if (!q) return routes;
  return routes.filter(r => {
    if (r.title.toLowerCase().includes(q)) return true;
    if (r.path.toLowerCase().includes(q)) return true;
    if (r.blurb?.toLowerCase().includes(q)) return true;
    if (r.keywords?.some(k => k.toLowerCase().includes(q))) return true;
    return false;
  });
}
