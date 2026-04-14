'use client';

import { useState, useEffect } from 'react';

// ─── Route catalog ──────────────────────────────────────────────────────────

interface RouteCard {
  name: string;
  path: string;
  desc: string;
  badge?: string; // e.g. "15m refresh", "no auth"
}

interface RouteGroup {
  title: string;
  icon: string;
  color: string; // tailwind bg class for the section header
  routes: RouteCard[];
}

const ROUTE_GROUPS: RouteGroup[] = [
  {
    title: 'Persona Dashboards',
    icon: '\u{1F3AF}', // 🎯
    color: 'bg-indigo-600',
    routes: [
      { name: 'CEO Dashboard', path: '/admin/ceo-dashboard', desc: 'Strategic metrics — EBITDA, revenue trends, NABH compliance, YTD', badge: '15m refresh' },
      { name: 'GM Dashboard', path: '/admin/gm-dashboard', desc: 'Operational oversight — census, occupancy, staffing, financial KPIs', badge: '5m refresh' },
      { name: 'MOD Dashboard', path: '/admin/mod-dashboard', desc: 'Real-time alerts — critical alerts, staffing, pending tasks, incidents', badge: '60s refresh' },
      { name: 'Wall View', path: '/admin/wall-view', desc: 'Public wall-mounted display — occupancy, alerts, critical metrics', badge: 'No auth · 30s refresh' },
    ],
  },
  {
    title: 'Clinical',
    icon: '\u{1FA7A}', // 🩺
    color: 'bg-rose-600',
    routes: [
      { name: 'Vitals & Observations', path: '/admin/vitals', desc: 'NEWS2 scoring, vital signs entry, observation charts' },
      { name: 'Clinical Orders', path: '/admin/orders', desc: 'Active orders, order entry, status tracking' },
      { name: 'Medication Orders (CPOE)', path: '/admin/medication-orders', desc: 'Computerized physician order entry & eMAR link' },
      { name: 'eMAR', path: '/admin/emar', desc: 'Electronic medication administration record' },
      { name: 'Clinical Notes', path: '/admin/clinical-notes', desc: 'SOAP notes, operative notes, co-sign queue' },
      { name: 'Care Pathways', path: '/admin/care-pathways', desc: 'DAG-based care plans, milestones, escalation, variance' },
      { name: 'Problem List', path: '/admin/problem-list', desc: 'Active conditions and problem tracking' },
      { name: 'Allergies', path: '/admin/allergies', desc: 'Allergy records and alerts' },
      { name: 'Consents', path: '/admin/consents', desc: 'Consent documentation and tracking' },
      { name: 'Critical Values', path: '/admin/critical-values', desc: 'Lab critical value alerts and acknowledgement' },
      { name: 'Alert Queue', path: '/admin/alert-queue', desc: 'Pending clinical alerts requiring action' },
    ],
  },
  {
    title: 'Operations',
    icon: '\u{1F3E5}', // 🏥
    color: 'bg-emerald-600',
    routes: [
      { name: 'Admissions', path: '/admin/admissions', desc: '4-step admission wizard, pre-auth gate, checklists' },
      { name: 'Bed Board', path: '/admin/bed-board', desc: 'Visual bed grid, occupancy, housekeeping status' },
      { name: 'Patients', path: '/admin/patients', desc: 'Patient registry, search, UHID management' },
      { name: 'Register Patient', path: '/admin/patients/register', desc: '5-step registration wizard' },
      { name: 'Transfers', path: '/admin/transfers', desc: 'Intra-hospital transfer workflow' },
      { name: 'Discharge', path: '/admin/discharge', desc: 'Milestone tracker, discharge queue, force discharge' },
      { name: 'Wristbands', path: '/admin/wristbands', desc: 'Print queue, patient wristband management' },
      { name: 'Dedup', path: '/admin/dedup', desc: 'Duplicate patient detection queue, exceptions, activity log' },
      { name: 'OT Management', path: '/admin/ot-management', desc: 'Scheduling, WHO checklist, anesthesia, equipment, turnover' },
    ],
  },
  {
    title: 'Billing & Revenue',
    icon: '\u{1F4B0}', // 💰
    color: 'bg-amber-600',
    routes: [
      { name: 'Billing', path: '/admin/billing', desc: 'Billing accounts, deposits, room charges, packages' },
      { name: 'Billing V2', path: '/admin/billing-v2', desc: 'Enhanced billing interface with AI insights' },
      { name: 'Insurance Claims', path: '/admin/insurance-claims', desc: 'Pre-auth, enhancement, TPA deductions, settlement' },
      { name: 'Patient Payments', path: '/admin/patient-payments', desc: 'Payment monitor and collection tracking' },
      { name: 'Revenue Dashboard', path: '/admin/revenue-dashboard', desc: 'Revenue intelligence — refunds, invoices, analytics' },
      { name: 'DR & Performance', path: '/admin/dr-performance', desc: 'Doctor performance and revenue contribution' },
      { name: 'GST Rates', path: '/admin/gst-rates', desc: 'GST rate configuration' },
    ],
  },
  {
    title: 'Lab & Diagnostics',
    icon: '\u{1F52C}', // 🔬
    color: 'bg-purple-600',
    routes: [
      { name: 'Lab & Radiology', path: '/admin/lab-radiology', desc: 'Panels, orders, results, specimens, imaging, LOINC' },
      { name: 'Lab Worklist', path: '/admin/lab-worklist', desc: 'Active lab orders and processing queue' },
      { name: 'Lab Reports', path: '/admin/lab-reports', desc: 'Finalized lab report viewer' },
      { name: 'Test Catalog', path: '/admin/test-catalog', desc: 'Test/panel configuration' },
      { name: 'Culture & Histopath', path: '/admin/culture-histopath', desc: 'Microbiology culture and histopathology results' },
      { name: 'Blood Bank', path: '/admin/blood-bank', desc: 'Blood product inventory and crossmatch' },
      { name: 'QC Levey-Jennings', path: '/admin/qc-levey-jennings', desc: 'Quality control charts for lab instruments' },
    ],
  },
  {
    title: 'Pharmacy',
    icon: '\u{1F48A}', // 💊
    color: 'bg-teal-600',
    routes: [
      { name: 'Pharmacy', path: '/admin/pharmacy', desc: 'Vendors, inventory, dispensing, narcotics, POs, alerts' },
      { name: 'Drug Master', path: '/admin/drug-master', desc: 'Drug formulary management and bulk import' },
    ],
  },
  {
    title: 'Quality & Safety',
    icon: '\u{1F6E1}', // 🛡
    color: 'bg-red-600',
    routes: [
      { name: 'Incident Reporting', path: '/admin/incident-reporting', desc: 'Adverse events, med errors, falls, quality indicators' },
      { name: 'RCA', path: '/admin/rca', desc: 'Root cause analysis — fishbone, five-why, CAPA, effectiveness' },
      { name: 'Infection Surveillance', path: '/admin/infection-surveillance', desc: 'HAI tracking, antibiotic stewardship, antibiogram' },
      { name: 'Safety & Audits', path: '/admin/safety-audits', desc: 'Safety rounds, audits, complaints, NABH indicators' },
      { name: 'NABH Indicators', path: '/admin/nabh-indicators', desc: '100 seeded quality indicators and tracking' },
      { name: 'KPI Definitions', path: '/admin/kpi-definitions', desc: 'Define and configure operational KPIs' },
      { name: 'Compliance Tracker', path: '/admin/compliance', desc: 'Regulatory compliance tracking' },
    ],
  },
  {
    title: 'Configuration & Masters',
    icon: '\u{2699}\u{FE0F}', // ⚙️
    color: 'bg-gray-600',
    routes: [
      { name: 'Charge Master', path: '/admin/charge-master', desc: 'Service charges, version history, bulk CSV import' },
      { name: 'Order Sets', path: '/admin/order-sets', desc: 'Pre-built clinical order sets' },
      { name: 'Consent Templates', path: '/admin/consent-templates', desc: 'Consent form template management' },
      { name: 'Discharge Templates', path: '/admin/discharge-templates', desc: 'Discharge summary templates' },
      { name: 'Approval Hierarchies', path: '/admin/approval-hierarchies', desc: 'Multi-level approval chain configuration' },
      { name: 'Retention Rules', path: '/admin/retention-rules', desc: 'Document retention policy configuration' },
    ],
  },
  {
    title: 'Patient Portal',
    icon: '\u{1F464}', // 👤
    color: 'bg-sky-600',
    routes: [
      { name: 'Patient Feedback', path: '/admin/patient-feedback', desc: 'Feedback collection and sentiment analysis' },
      { name: 'Patient Payments', path: '/admin/patient-payments', desc: 'Online payment tracking' },
      { name: 'Patient Services', path: '/admin/patient-services', desc: 'Service requests and scheduling' },
    ],
  },
  {
    title: 'Integrations & System',
    icon: '\u{1F50C}', // 🔌
    color: 'bg-orange-600',
    routes: [
      { name: 'Integration Dashboard', path: '/admin/integrations', desc: 'System integrations overview and health' },
      { name: 'LSQ Sync', path: '/admin/lsq-sync', desc: 'LeadSquared CRM sync — IPD WIN leads' },
      { name: 'HL7 Analyzer', path: '/admin/hl7-analyzer', desc: 'HL7 message parser and validator' },
      { name: 'HL7 Messages', path: '/admin/hl7-messages', desc: 'HL7 message log and history' },
      { name: 'Event Bus', path: '/admin/event-bus', desc: 'Internal event bus monitor' },
    ],
  },
  {
    title: 'AI & Intelligence',
    icon: '\u{1F9E0}', // 🧠
    color: 'bg-violet-600',
    routes: [
      { name: 'AI Observatory', path: '/admin/ai-observatory', desc: 'AI job queue, engine status, feedback, costs' },
      { name: 'AI Settings', path: '/admin/ai-settings', desc: 'AI engine configuration and model settings' },
    ],
  },
  {
    title: 'Security & Users',
    icon: '\u{1F512}', // 🔒
    color: 'bg-slate-700',
    routes: [
      { name: 'User Management', path: '/admin/users', desc: 'Create, suspend, delete users, PIN reset' },
      { name: 'Roles & Permissions', path: '/admin/roles', desc: 'RBAC role and permission matrix' },
      { name: 'Login Attempts', path: '/admin/login-attempts', desc: 'Login audit trail and suspicious activity' },
      { name: 'Security Dashboard', path: '/admin/security-dashboard', desc: 'Security posture overview' },
    ],
  },
  {
    title: 'Documents',
    icon: '\u{1F4C4}', // 📄
    color: 'bg-cyan-700',
    routes: [
      { name: 'MRD Documents', path: '/admin/mrd-documents', desc: 'Medical Records Department — document browser' },
    ],
  },
  {
    title: 'Caregiver Views',
    icon: '\u{1F469}\u{200D}\u{2695}\u{FE0F}', // 👩‍⚕️
    color: 'bg-emerald-500',
    routes: [
      { name: 'Caregiver Home', path: '/care/home', desc: 'Role-based home with quick actions', badge: 'Light theme' },
      { name: 'My Schedule', path: '/care/schedule', desc: 'Weekly shift schedule and leave requests' },
      { name: 'Nurse Station', path: '/care/nurse', desc: 'Patient assignments, ward grid, task sidebar', badge: 'NS.1' },
      { name: 'Bedside View', path: '/care/nurse/bedside', desc: 'iPad vitals entry, NEWS2, I/O, assessments', badge: 'NS.2+NS.3' },
      { name: 'eMAR', path: '/care/nurse/emar', desc: 'Medication timeline, Give/Hold/Refuse, Med Round, CDS alerts', badge: 'NS.4' },
      { name: 'Charge Nurse', path: '/care/nurse/charge', desc: 'Ward command center: bed grid, staffing, escalation feed', badge: 'NS.5' },
      { name: 'Shift Handoff', path: '/care/nurse/handoff', desc: 'SBAR handoff write/read/ward summary, auto-populate, print', badge: 'NS.6' },
      { name: 'Worksheet', path: '/care/nurse/worksheet', desc: 'Phone pocket view: patient × task grid with status icons', badge: 'NS.6' },
      { name: 'Doctor Home', path: '/care/doctor', desc: 'Acuity-sorted patients, context panel, sidebar (new admits/co-sign/labs/DC)', badge: 'DV.1' },
      { name: 'Rounds View', path: '/care/doctor/rounds', desc: 'Rich patient cards, key labs, vitals, orders, companion quick notes', badge: 'DV.2' },
      { name: 'SOAP Notes', path: '/care/doctor/note', desc: 'SOAP form with auto-populated O, quick-insert chips, post-rounds batch mode', badge: 'DV.3' },
      { name: 'Co-Sign + Discharge', path: '/care/doctor/cosign', desc: 'Batch co-sign approval, reject/addendum, discharge summary form', badge: 'DV.4' },
    ],
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

// ─── Role impersonation ────────────────────────────────────────────────────

const IMPERSONATION_ROLES = [
  { value: '', label: 'No impersonation', group: '' },
  // Nursing
  { value: 'nurse', label: 'Staff Nurse', group: 'nursing' },
  { value: 'charge_nurse', label: 'Charge Nurse', group: 'nursing' },
  { value: 'icu_nurse', label: 'ICU Nurse', group: 'nursing' },
  { value: 'ot_nurse', label: 'OT Nurse', group: 'nursing' },
  // Clinical
  { value: 'resident_doctor', label: 'Resident Doctor', group: 'clinical' },
  { value: 'consultant', label: 'Consultant', group: 'clinical' },
  { value: 'surgeon', label: 'Surgeon', group: 'clinical' },
  { value: 'anaesthetist', label: 'Anaesthetist', group: 'clinical' },
  // Pharmacy & Lab
  { value: 'pharmacist', label: 'Pharmacist', group: 'pharmacy' },
  { value: 'lab_technician', label: 'Lab Technician', group: 'lab' },
  // Billing & Support
  { value: 'billing_executive', label: 'Billing Executive', group: 'billing' },
  { value: 'receptionist', label: 'Receptionist', group: 'support' },
  { value: 'ip_coordinator', label: 'IP Coordinator', group: 'support' },
  // Executive
  { value: 'hospital_admin', label: 'Hospital Admin', group: 'admin' },
  { value: 'medical_director', label: 'Medical Director', group: 'executive' },
];

function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : '';
}

function setCookie(name: string, value: string, days: number = 1) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${expires}; SameSite=Lax`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TestCockpitClient({ userName }: { userName: string }) {
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(ROUTE_GROUPS.map(g => g.title)));
  const [impersonatedRole, setImpersonatedRole] = useState('');

  // Load existing impersonation from cookie
  useEffect(() => {
    const existing = getCookie('test_role');
    if (existing) setImpersonatedRole(existing);
  }, []);

  const handleImpersonation = (role: string) => {
    setImpersonatedRole(role);
    if (role) {
      setCookie('test_role', role, 1);
    } else {
      deleteCookie('test_role');
    }
  };

  const toggleGroup = (title: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const expandAll = () => setExpandedGroups(new Set(ROUTE_GROUPS.map(g => g.title)));
  const collapseAll = () => setExpandedGroups(new Set());

  const lowerSearch = search.toLowerCase();

  const totalRoutes = ROUTE_GROUPS.reduce((sum, g) => sum + g.routes.length, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {'\u{1F9EA}'} Test Cockpit
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {totalRoutes} pages across {ROUTE_GROUPS.length} groups — Hi {userName}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Search pages..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />

              {/* Role impersonation */}
              <div className="flex items-center gap-2">
                <select
                  value={impersonatedRole}
                  onChange={e => handleImpersonation(e.target.value)}
                  className={`border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${impersonatedRole ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300'}`}
                >
                  {IMPERSONATION_ROLES.map(r => (
                    <option key={r.value} value={r.value}>
                      {r.group ? `[${r.group}] ` : ''}{r.label}
                    </option>
                  ))}
                </select>
                {impersonatedRole && (
                  <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full font-medium whitespace-nowrap">
                    Impersonating: {impersonatedRole.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              <button onClick={expandAll} className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                Expand All
              </button>
              <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap">
                Collapse All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Route groups */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {ROUTE_GROUPS.map(group => {
          const filteredRoutes = group.routes.filter(r =>
            !search || r.name.toLowerCase().includes(lowerSearch) || r.desc.toLowerCase().includes(lowerSearch) || r.path.toLowerCase().includes(lowerSearch)
          );
          if (search && filteredRoutes.length === 0) return null;
          const isExpanded = expandedGroups.has(group.title);

          return (
            <div key={group.title} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group.title)}
                className={`w-full flex items-center justify-between px-5 py-3 ${group.color} text-white hover:opacity-90 transition-opacity`}
              >
                <span className="flex items-center gap-2 text-base font-semibold">
                  <span className="text-lg">{group.icon}</span>
                  {group.title}
                  <span className="text-xs font-normal opacity-80">({filteredRoutes.length})</span>
                </span>
                <svg
                  className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Route cards */}
              {isExpanded && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                  {filteredRoutes.map(route => (
                    <div
                      key={route.path}
                      className="group border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-md transition-all bg-white"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 text-sm truncate">{route.name}</h3>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{route.desc}</p>
                          <p className="text-xs text-gray-400 mt-1 font-mono">{route.path}</p>
                          {route.badge && (
                            <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700 font-medium">
                              {route.badge}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                        <a
                          href={`${route.path}?from=cockpit`}
                          className="flex-1 text-center text-xs font-medium bg-indigo-600 text-white rounded-md py-1.5 hover:bg-indigo-700 transition-colors"
                        >
                          Open
                        </a>
                        <a
                          href={`${route.path}?from=cockpit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-center text-xs font-medium border border-gray-300 text-gray-700 rounded-md py-1.5 hover:bg-gray-50 transition-colors"
                        >
                          New Tab {'\u{2197}\u{FE0F}'}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Future builds callout */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mt-6">
          <h2 className="font-semibold text-amber-800 flex items-center gap-2">
            {'\u{1F6A7}'} Planned — Nurse Station
          </h2>
          <p className="text-sm text-amber-700 mt-2">
            <strong>iPad Bedside View:</strong> Optimized vitals entry, nursing notes (I/O, pain, falls risk, wound care),
            patient-per-swipe workflow — designed for bedside use with large touch targets.
          </p>
          <p className="text-sm text-amber-700 mt-1">
            <strong>Desktop Nurse Hub:</strong> Full-function view combining nursing notes, EHR, communications,
            operations, inventory, pharmaceutical delivery — everything a nurse needs in one screen.
          </p>
          <p className="text-xs text-amber-600 mt-2 italic">These will appear here as testable links once built.</p>
        </div>
      </div>
    </div>
  );
}
