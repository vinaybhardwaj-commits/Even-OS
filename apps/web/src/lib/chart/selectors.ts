/**
 * chartSelectors.forRole() — server-side projection for the patient chart.
 *
 * Shipped with PC.3.1 (Role/Tab Model foundation). Reads
 * `chart_permission_matrix` to derive the visible tabs, overview card order,
 * action-bar preset, sensitive-field list, and allowed write actions for a
 * given (role, hospital) pair.
 *
 * Safe-default behaviour: if the matrix lookup fails, the table is missing
 * (seeder hasn't run yet), or the role has no row — the function returns the
 * hardcoded pre-PC.3 config for that role. The chart MUST continue to render
 * correctly even if this whole layer is down. The client components keep
 * their inline fallback copies so SSR doesn't block on matrix hydration.
 *
 * All projection decisions happen server-side. The client never sees a wider
 * config than the matrix allows — per PRD §7 (server-side projection only,
 * never client-side hiding of sensitive data).
 *
 * Consumers:
 *   - app/(caregiver)/care/patient/[id]/page.tsx → passes the result into
 *     PatientChartClient as a new `chartConfig` prop (PC.3.2 will wire it
 *     into the client; in PC.3.1 the prop is threaded but ignored so nothing
 *     visible changes).
 *   - admin overlay (PC.3.3) will call `forRole('super_admin')` to get the
 *     full-access config even when the acting role is restricted.
 */

import { neon } from '@neondatabase/serverless';

export type ActionBarPreset = {
  primary: string[];
  secondary: string[];
};

export type ChartConfig = {
  role: string;
  hospital_id: string;
  tabs: string[];
  overview_layout: string[];
  action_bar_preset: ActionBarPreset;
  sensitive_fields: string[];
  allowed_write_actions: string[];
  source: 'matrix' | 'fallback';
};

// ── Fallback presets (same as migration seeds) ──────────────────────────────
// These exist so the chart still renders if the matrix is missing or the
// query fails. Kept in sync with /api/migrations/chart-role-model/route.ts.

const FALLBACK_PRESETS = {
  doctor: {
    tabs: ['overview','vitals','labs','orders','notes','plan','journey','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','brief','vitals_snapshot','journey','active_orders','active_meds','problems','allergies','recent_notes','calculators_pinned'],
    action_bar_preset: { primary: ['soap','prescribe','labs','consults'], secondary: ['complaints','handoff'] },
    sensitive_fields: [] as string[],
    allowed_write_actions: ['note.create','note.amend','order.place','order.cancel','problem.add','problem.update','vitals.record','plan.update','discharge.initiate','cosign.approve'],
  },
  charge_nurse: {
    tabs: ['overview','vitals','emar','assessments','notes','orders','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','vitals_snapshot','emar_due','assessments_due','active_orders','active_meds','problems','allergies','handoff_notes'],
    action_bar_preset: { primary: ['record_vitals','administer_med','assessment','handoff'], secondary: ['complaints','escalate'] },
    sensitive_fields: [] as string[],
    allowed_write_actions: ['note.create','vitals.record','emar.administer','emar.hold','emar.refuse','assessment.submit','handoff.create','escalation.raise'],
  },
  nurse: {
    tabs: ['overview','vitals','emar','assessments','notes','orders','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','vitals_snapshot','emar_due','assessments_due','active_meds','problems','allergies','recent_notes'],
    action_bar_preset: { primary: ['record_vitals','administer_med','assessment','nursing_note'], secondary: ['complaints'] },
    sensitive_fields: [] as string[],
    allowed_write_actions: ['note.create','vitals.record','emar.administer','emar.hold','emar.refuse','assessment.submit'],
  },
  pharmacist: {
    tabs: ['overview','orders','vitals','calculators','documents'],
    overview_layout: ['bed_attending','active_meds','allergies','ddi_alerts','dispensing_queue'],
    action_bar_preset: { primary: ['verify_order','dispense','clarify_dose','ddi_check'], secondary: ['complaints'] },
    sensitive_fields: ['diagnosis','notes_snippet'],
    allowed_write_actions: ['medication.verify','medication.dispense','medication.clarify','ddi.resolve'],
  },
  lab: {
    tabs: ['overview','labs','calculators','documents'],
    overview_layout: ['bed_attending','lab_orders_pending','critical_values','sample_collection'],
    action_bar_preset: { primary: ['collect_sample','verify_result','flag_critical','batch_accept'], secondary: ['complaints'] },
    sensitive_fields: ['diagnosis','notes_snippet'],
    allowed_write_actions: ['lab.collect','lab.verify','lab.release','critical.flag'],
  },
  cce: {
    tabs: ['overview','brief','documents','billing'],
    overview_layout: ['bed_attending','brief','complaints','comms_threads','bill_summary'],
    action_bar_preset: { primary: ['raise_complaint','create_ticket','contact_family','log_visit'], secondary: [] as string[] },
    sensitive_fields: ['diagnosis','notes_snippet','procedures','mlc_reason','medications','allergies'],
    allowed_write_actions: ['complaint.raise','ticket.create','visit.log','note.cce'],
  },
  billing: {
    tabs: ['overview','billing','journey','documents'],
    overview_layout: ['bed_attending','bill_summary','insurance_status','tpa_queries','preauth_status','package_status'],
    action_bar_preset: { primary: ['generate_bill','apply_adjustment','submit_preauth','raise_query'], secondary: ['complaints'] },
    sensitive_fields: ['diagnosis','procedures','notes_snippet'],
    allowed_write_actions: ['bill.generate','bill.adjust','preauth.submit','enhancement.submit','query.raise','refund.initiate'],
  },
  admin: {
    tabs: ['overview','vitals','labs','orders','notes','plan','emar','assessments','billing','journey','brief','calculators','documents','forms'],
    overview_layout: ['bed_attending','brief','vitals_snapshot','journey','active_orders','active_meds','problems','allergies','recent_notes','bill_summary','audit_badge','edit_lock_state'],
    action_bar_preset: { primary: ['admin_overlay','edit_lock_toggle','audit_trail','export_mrd'], secondary: ['complaints'] },
    sensitive_fields: [] as string[],
    allowed_write_actions: ['admin.override','edit_lock.toggle','audit.review','export.mrd'],
  },
} as const;

const ROLE_TO_PRESET: Record<string, keyof typeof FALLBACK_PRESETS> = {
  resident: 'doctor', senior_resident: 'doctor', intern: 'doctor',
  visiting_consultant: 'doctor', hospitalist: 'doctor', consultant: 'doctor',
  senior_consultant: 'doctor', specialist_cardiologist: 'doctor',
  specialist_neurologist: 'doctor', specialist_orthopedic: 'doctor',
  surgeon: 'doctor', anaesthetist: 'doctor',
  radiologist: 'doctor', senior_radiologist: 'doctor',
  nurse: 'nurse', senior_nurse: 'nurse', nursing_manager: 'nurse', ot_nurse: 'nurse',
  charge_nurse: 'charge_nurse', nursing_supervisor: 'charge_nurse',
  pharmacist: 'pharmacist', senior_pharmacist: 'pharmacist', chief_pharmacist: 'pharmacist',
  lab_technician: 'lab', senior_lab_technician: 'lab', lab_manager: 'lab', radiology_technician: 'lab',
  ip_coordinator: 'cce', receptionist: 'cce',
  billing_manager: 'billing', billing_executive: 'billing', insurance_coordinator: 'billing',
  super_admin: 'admin', hospital_admin: 'admin', operations_manager: 'admin',
  department_head: 'admin', medical_director: 'admin',
};

function fallback(role: string, hospital_id: string): ChartConfig {
  const presetKey = ROLE_TO_PRESET[role] ?? 'doctor'; // unknown roles get the richest default
  const p = FALLBACK_PRESETS[presetKey];
  return {
    role,
    hospital_id,
    tabs: [...p.tabs],
    overview_layout: [...p.overview_layout],
    action_bar_preset: { primary: [...p.action_bar_preset.primary], secondary: [...p.action_bar_preset.secondary] },
    sensitive_fields: [...p.sensitive_fields],
    allowed_write_actions: [...p.allowed_write_actions],
    source: 'fallback',
  };
}

export const chartSelectors = {
  /**
   * Returns the chart projection config for a given role + hospital.
   *
   * Looks up `chart_permission_matrix` on (role, hospital_id). If a row
   * exists, its values are returned with `source: 'matrix'`. On any error
   * (missing table, empty result, DB unreachable) the hardcoded fallback
   * preset is returned with `source: 'fallback'` so the chart still renders.
   */
  async forRole(role: string, hospital_id: string): Promise<ChartConfig> {
    if (!role || !hospital_id) return fallback(role ?? 'resident', hospital_id ?? 'unknown');

    const url = process.env.DATABASE_URL;
    if (!url) return fallback(role, hospital_id);

    try {
      const sql = neon(url);
      const rows = (await sql`
        SELECT tabs, overview_layout, action_bar_preset,
               sensitive_fields, allowed_write_actions
          FROM chart_permission_matrix
         WHERE role = ${role}
           AND hospital_id = ${hospital_id}
           AND role_tag IS NULL
         LIMIT 1
      `) as Array<{
        tabs: string[];
        overview_layout: unknown;
        action_bar_preset: unknown;
        sensitive_fields: string[];
        allowed_write_actions: string[];
      }>;

      if (rows.length === 0) return fallback(role, hospital_id);

      const r = rows[0];
      const overview_layout = Array.isArray(r.overview_layout)
        ? (r.overview_layout as string[])
        : [];
      const action_bar_preset = (typeof r.action_bar_preset === 'object' && r.action_bar_preset !== null)
        ? (r.action_bar_preset as ActionBarPreset)
        : { primary: [], secondary: [] };

      return {
        role,
        hospital_id,
        tabs: r.tabs ?? [],
        overview_layout,
        action_bar_preset: {
          primary: action_bar_preset.primary ?? [],
          secondary: action_bar_preset.secondary ?? [],
        },
        sensitive_fields: r.sensitive_fields ?? [],
        allowed_write_actions: r.allowed_write_actions ?? [],
        source: 'matrix',
      };
    } catch {
      // Table missing, network blip, role typo — whatever it is, don't block
      // the chart. Return the fallback so the UI keeps rendering.
      return fallback(role, hospital_id);
    }
  },

  /**
   * Convenience — returns just the visible-tab list for a role.
   * Used by getTabsForRole() client-side via the config prop.
   */
  async tabsForRole(role: string, hospital_id: string): Promise<string[]> {
    const c = await this.forRole(role, hospital_id);
    return c.tabs;
  },
};

export function fallbackConfigForRole(role: string, hospital_id: string): ChartConfig {
  return fallback(role, hospital_id);
}


// ─── PC.3.3.D — convenience helper for tRPC procedures ─────────
// Wraps chartSelectors.forRole() with a safe JWT-shaped call site so
// routers can do `const cfg = await resolveChartConfigForUser(ctx.user)`
// without reaching into chartSelectors directly. Falls back to a
// permissive config on any decode mishap so queries never 500 on this.

export async function resolveChartConfigForUser(user: {
  role?: string | null;
  hospital_id?: string | null;
} | null | undefined): Promise<ChartConfig> {
  const role = user?.role ?? 'resident';
  const hospital = user?.hospital_id ?? 'unknown';
  try {
    return await chartSelectors.forRole(role, hospital);
  } catch {
    return fallback(role, hospital);
  }
}
