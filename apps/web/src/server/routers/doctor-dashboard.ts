import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// DOCTOR DASHBOARD — DV.1
// Read-only queries for doctor home, context panel, sidebar
// ============================================================

const DOCTOR_ROLES = [
  'resident', 'senior_resident', 'intern', 'visiting_consultant',
  'hospitalist', 'specialist_cardiologist', 'specialist_neurologist',
  'specialist_orthopedic', 'admin', 'super_admin',
];

const CONSULTANT_ROLES = [
  'visiting_consultant', 'specialist_cardiologist',
  'specialist_neurologist', 'specialist_orthopedic',
];

export const doctorDashboardRouter = router({

  // ── Acuity-sorted patient list for assigned doctor ─────────────────────
  myPatients: protectedProcedure
    .input(z.object({
      ward_id: z.string().uuid().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Get patients assigned to this doctor via encounters (attending_doctor_id or admitting_doctor_id)
      const rows = await getSql()`
        SELECT
          e.id AS encounter_id,
          e.patient_id,
          e.encounter_class,
          e.status AS encounter_status,
          e.chief_complaint,
          e.primary_diagnosis,
          e.current_location_id AS ward_id,
          e.admission_datetime,
          e.planned_discharge_date,
          p.full_name AS patient_name,
          p.uhid AS patient_uhid,
          p.gender AS patient_gender,
          p.dob AS patient_dob,
          p.phone AS patient_phone,
          l.name AS ward_name,
          b.label AS bed_label,
          COALESCE(n2.total_score, 0) AS news2_score,
          COALESCE(n2.risk_level, 'low') AS news2_risk,
          n2.calculated_at AS news2_at,
          al.allergy_count
        FROM encounters e
        JOIN patients p ON p.id = e.patient_id
        LEFT JOIN locations l ON l.id = e.current_location_id
        LEFT JOIN beds b ON b.id = e.bed_id
        LEFT JOIN LATERAL (
          SELECT total_score, risk_level, calculated_at
          FROM news2_scores
          WHERE patient_id = e.patient_id AND hospital_id = ${hospitalId}
          ORDER BY calculated_at DESC LIMIT 1
        ) n2 ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS allergy_count
          FROM allergy_intolerances
          WHERE patient_id = e.patient_id AND hospital_id = ${hospitalId} AND is_deleted = false
        ) al ON true
        WHERE e.hospital_id = ${hospitalId}
          AND e.status IN ('in_progress', 'admitted')
          AND (e.attending_doctor_id = ${userId}::uuid
               OR e.admitting_doctor_id = ${userId}::uuid)
          ${input?.ward_id ? getSql()`AND e.current_location_id = ${input.ward_id}::uuid` : getSql()``}
        ORDER BY COALESCE(n2.total_score, 0) DESC, e.admission_datetime ASC;
      `;

      return (rows as any[]).map(r => ({
        encounter_id: r.encounter_id,
        patient_id: r.patient_id,
        encounter_class: r.encounter_class,
        encounter_status: r.encounter_status,
        chief_complaint: r.chief_complaint,
        primary_diagnosis: r.primary_diagnosis,
        ward_id: r.ward_id,
        ward_name: r.ward_name,
        bed_label: r.bed_label,
        admission_datetime: r.admission_datetime,
        planned_discharge_date: r.planned_discharge_date,
        patient_name: r.patient_name,
        patient_uhid: r.patient_uhid,
        patient_gender: r.patient_gender,
        patient_dob: r.patient_dob,
        news2_score: r.news2_score || 0,
        news2_risk: r.news2_risk || 'low',
        news2_at: r.news2_at,
        allergy_count: r.allergy_count || 0,
        acuity: r.news2_score >= 7 ? 'critical' : r.news2_score >= 5 ? 'attention' : 'stable',
      }));
    }),

  // ── Patient context panel (vitals, labs, orders, notes) ────────────────
  patientContext: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [vitals, labs, activeOrders, recentNotes, problems, allergies] = await Promise.all([
        // Latest vitals
        getSql()`
          SELECT observation_type, value_quantity, value_text, unit, effective_datetime
          FROM observations
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}::uuid
            AND encounter_id = ${input.encounter_id}::uuid
            AND observation_type IN ('vital_temperature','vital_pulse','vital_bp_systolic','vital_bp_diastolic','vital_spo2','vital_rr')
          ORDER BY effective_datetime DESC
          LIMIT 12
        `,
        // Recent lab results (last 5 orders)
        getSql()`
          SELECT lo.id AS order_id, lo.lo_panel_name AS test_name, lo.lo_status AS order_status, lo.lo_ordered_at AS ordered_at,
                 lr.lr_test_code AS test_code, COALESCE(lr.value_numeric::text, lr.value_text) AS result_value,
                 lr.lr_unit AS result_unit, lr.lr_ref_range_text AS reference_range,
                 (lr.lr_flag != 'normal') AS is_abnormal, lr.lr_is_critical AS is_critical, lr.lr_resulted_at AS resulted_at
          FROM lab_orders lo
          LEFT JOIN lab_results lr ON lr.lr_order_id = lo.id
          WHERE lo.hospital_id = ${hospitalId}
            AND lo.lo_patient_id = ${input.patient_id}::uuid
            AND lo.lo_encounter_id = ${input.encounter_id}::uuid
          ORDER BY lo.lo_ordered_at DESC
          LIMIT 20
        `,
        // Active medication orders
        getSql()`
          SELECT id, drug_name, generic_name, dose_quantity, dose_unit, route, frequency_code, status, is_high_alert
          FROM medication_requests
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}::uuid
            AND encounter_id = ${input.encounter_id}::uuid
            AND status = 'active'
            AND is_deleted = false
          ORDER BY created_at DESC
        `,
        // Recent clinical notes (last 5)
        getSql()`
          SELECT ci.id, ci.note_type, ci.status, ci.created_at,
                 u.full_name AS author_name,
                 LEFT(ci.free_text_content, 200) AS excerpt
          FROM clinical_impressions ci
          LEFT JOIN users u ON u.id = ci.author_id
          WHERE ci.hospital_id = ${hospitalId}
            AND ci.patient_id = ${input.patient_id}::uuid
            AND ci.encounter_id = ${input.encounter_id}::uuid
          ORDER BY ci.created_at DESC
          LIMIT 5
        `,
        // Active problems
        getSql()`
          SELECT id, condition_name AS code_display, clinical_status, severity, onset_date
          FROM conditions
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}::uuid
            AND clinical_status IN ('active', 'recurrence')
          ORDER BY onset_date DESC
        `,
        // Allergies
        getSql()`
          SELECT id, substance, reaction AS reaction_type, severity, allergy_verification_status AS status
          FROM allergy_intolerances
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}::uuid
            AND allergy_verification_status != 'entered-in-error'
            AND is_deleted = false
        `,
      ]);

      return {
        vitals: vitals as any[],
        labs: labs as any[],
        activeOrders: activeOrders as any[],
        recentNotes: recentNotes as any[],
        problems: problems as any[],
        allergies: allergies as any[],
      };
    }),

  // ── Sidebar counts (new admits, co-sign, labs pending, discharge due) ──
  sidebarCounts: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const [newAdmits, coSignPending, labsPending, dischargeDue] = await Promise.all([
        // New admits in last 12h assigned to this doctor without a workup note
        getSql()`
          SELECT COUNT(*)::int AS count
          FROM encounters e
          WHERE e.hospital_id = ${hospitalId}
            AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
            AND e.status IN ('in_progress', 'admitted')
            AND e.admission_datetime >= NOW() - INTERVAL '12 hours'
            AND NOT EXISTS (
              SELECT 1 FROM clinical_impressions ci
              WHERE ci.encounter_id = e.id AND ci.note_type = 'soap_note'
            )
        `,
        // Notes pending co-sign for this doctor
        getSql()`
          SELECT COUNT(*)::int AS count
          FROM clinical_impressions ci
          JOIN encounters e ON e.id = ci.encounter_id
          WHERE ci.hospital_id = ${hospitalId}
            AND ci.status = 'ready_for_review'
            AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
        `,
        // Lab orders pending results for this doctor's patients
        getSql()`
          SELECT COUNT(*)::int AS count
          FROM lab_orders lo
          JOIN encounters e ON e.id = lo.encounter_id
          WHERE lo.hospital_id = ${hospitalId}
            AND lo.status IN ('ordered', 'collected', 'received')
            AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
        `,
        // Patients with planned discharge today
        getSql()`
          SELECT COUNT(*)::int AS count
          FROM encounters e
          WHERE e.hospital_id = ${hospitalId}
            AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
            AND e.status IN ('in_progress', 'admitted')
            AND e.planned_discharge_date::date = CURRENT_DATE
        `,
      ]);

      return {
        new_admits: ((newAdmits as any)?.[0]?.count) || 0,
        cosign_pending: ((coSignPending as any)?.[0]?.count) || 0,
        labs_pending: ((labsPending as any)?.[0]?.count) || 0,
        discharge_due: ((dischargeDue as any)?.[0]?.count) || 0,
      };
    }),

  // ── New admits list (last 12h, no workup note) ────────────────────────
  newAdmits: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const rows = await getSql()`
        SELECT e.id AS encounter_id, e.patient_id, e.chief_complaint,
               e.admission_datetime, e.encounter_class,
               p.full_name AS patient_name, p.uhid AS patient_uhid,
               l.name AS ward_name, b.label AS bed_label
        FROM encounters e
        JOIN patients p ON p.id = e.patient_id
        LEFT JOIN locations l ON l.id = e.current_location_id
        LEFT JOIN beds b ON b.id = e.bed_id
        WHERE e.hospital_id = ${hospitalId}
          AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
          AND e.status IN ('in_progress', 'admitted')
          AND e.admission_datetime >= NOW() - INTERVAL '12 hours'
          AND NOT EXISTS (
            SELECT 1 FROM clinical_impressions ci
            WHERE ci.encounter_id = e.id AND ci.note_type = 'soap_note'
          )
        ORDER BY e.admission_datetime DESC;
      `;
      return rows as any[];
    }),

  // ── Co-sign queue ─────────────────────────────────────────────────────
  cosignQueue: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const rows = await getSql()`
        SELECT ci.id AS note_id, ci.note_type, ci.status, ci.created_at,
               LEFT(ci.text_content, 300) AS excerpt,
               u.full_name AS author_name,
               p.full_name AS patient_name, p.uhid AS patient_uhid,
               e.id AS encounter_id, e.patient_id,
               b.label AS bed_label
        FROM clinical_impressions ci
        JOIN encounters e ON e.id = ci.encounter_id
        JOIN patients p ON p.id = ci.patient_id
        LEFT JOIN users u ON u.id = ci.author_id
        LEFT JOIN beds b ON b.id = e.bed_id
        WHERE ci.hospital_id = ${hospitalId}
          AND ci.status = 'ready_for_review'
          AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
        ORDER BY ci.created_at ASC;
      `;
      return rows as any[];
    }),

  // ── Labs pending for my patients ──────────────────────────────────────
  labsPending: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const rows = await getSql()`
        SELECT lo.id AS order_id, lo.test_name, lo.status, lo.ordered_at,
               p.full_name AS patient_name, p.uhid AS patient_uhid,
               b.label AS bed_label, e.patient_id, e.id AS encounter_id
        FROM lab_orders lo
        JOIN encounters e ON e.id = lo.encounter_id
        JOIN patients p ON p.id = lo.patient_id
        LEFT JOIN beds b ON b.id = e.bed_id
        WHERE lo.hospital_id = ${hospitalId}
          AND lo.status IN ('ordered', 'collected', 'received')
          AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
        ORDER BY lo.ordered_at ASC;
      `;
      return rows as any[];
    }),

  // ── Discharge due today ───────────────────────────────────────────────
  dischargeDue: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const rows = await getSql()`
        SELECT e.id AS encounter_id, e.patient_id, e.planned_discharge_date,
               e.chief_complaint, e.primary_diagnosis, e.admission_datetime,
               p.full_name AS patient_name, p.uhid AS patient_uhid,
               l.name AS ward_name, b.label AS bed_label
        FROM encounters e
        JOIN patients p ON p.id = e.patient_id
        LEFT JOIN locations l ON l.id = e.current_location_id
        LEFT JOIN beds b ON b.id = e.bed_id
        WHERE e.hospital_id = ${hospitalId}
          AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
          AND e.status IN ('in_progress', 'admitted')
          AND e.planned_discharge_date::date = CURRENT_DATE
        ORDER BY e.planned_discharge_date ASC;
      `;
      return rows as any[];
    }),

  // ── Distinct wards for ward tabs (consultant view) ────────────────────
  myWards: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const rows = await getSql()`
        SELECT DISTINCT l.id AS ward_id, l.name AS ward_name,
               COUNT(*)::int AS patient_count
        FROM encounters e
        JOIN locations l ON l.id = e.current_location_id
        WHERE e.hospital_id = ${hospitalId}
          AND (e.attending_doctor_id = ${userId}::uuid OR e.admitting_doctor_id = ${userId}::uuid)
          AND e.status IN ('in_progress', 'admitted')
        GROUP BY l.id, l.name
        ORDER BY l.name;
      `;
      return rows as any[];
    }),

  // ── Hospital-wide overview (for RMO/generalist doctor home) ───────────────
  // Not filtered by attending_practitioner_id — shows everything admitted in
  // the hospital. Used by the Doctor Home bed board.
  hospitalOverview: protectedProcedure
    .query(async ({ ctx }) => {
      const hospitalId = ctx.user.hospital_id;

      const [admittedCount, newAdmitsRows, criticalRows] = await Promise.all([
        getSql()`
          SELECT COUNT(*)::int AS count
          FROM encounters e
          WHERE e.hospital_id = ${hospitalId}
            AND e.status = 'in-progress'
        `,
        // New admits in last 24h
        getSql()`
          SELECT e.id AS encounter_id, e.patient_id, e.chief_complaint,
                 e.preliminary_diagnosis_icd10, e.admission_at, e.encounter_class,
                 p.name_full AS patient_name, p.uhid AS patient_uhid,
                 p.gender, p.dob,
                 l.name AS ward_name,
                 u.full_name AS attending_name
          FROM encounters e
          JOIN patients p ON p.id = e.patient_id
          LEFT JOIN locations l ON l.id = e.current_location_id
          LEFT JOIN users u ON u.id = e.attending_practitioner_id
          WHERE e.hospital_id = ${hospitalId}
            AND e.status = 'in-progress'
            AND e.admission_at >= NOW() - INTERVAL '24 hours'
          ORDER BY e.admission_at DESC
          LIMIT 50
        `,
        // Critical patients: latest NEWS2 >= 5
        getSql()`
          SELECT e.id AS encounter_id, e.patient_id,
                 p.name_full AS patient_name, p.uhid AS patient_uhid,
                 p.gender, p.dob,
                 l.name AS ward_name,
                 e.chief_complaint, e.preliminary_diagnosis_icd10,
                 e.admission_at,
                 u.full_name AS attending_name,
                 n2.total_score AS news2_score,
                 n2.calculated_at AS news2_at
          FROM encounters e
          JOIN patients p ON p.id = e.patient_id
          LEFT JOIN locations l ON l.id = e.current_location_id
          LEFT JOIN users u ON u.id = e.attending_practitioner_id
          JOIN LATERAL (
            SELECT total_score, calculated_at
            FROM news2_scores n
            WHERE n.patient_id = e.patient_id AND n.hospital_id = ${hospitalId}
            ORDER BY n.calculated_at DESC LIMIT 1
          ) n2 ON true
          WHERE e.hospital_id = ${hospitalId}
            AND e.status = 'in-progress'
            AND n2.total_score >= 5
          ORDER BY n2.total_score DESC, n2.calculated_at DESC
          LIMIT 20
        `,
      ]);

      return {
        admitted_count: ((admittedCount as any)?.[0]?.count) || 0,
        new_admits: (newAdmitsRows as any) || [],
        critical_patients: (criticalRows as any) || [],
      };
    }),

});
