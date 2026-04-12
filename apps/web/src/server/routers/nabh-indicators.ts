import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import { nabhIndicators } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

export const nabhIndicatorsRouter = router({

  // ─── LIST (paginated, filterable, searchable) ─────────────
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, category, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(nabhIndicators.hospital_id, ctx.user.hospital_id)];
      if (category) conditions.push(eq(nabhIndicators.category, category));
      if (search) {
        conditions.push(or(
          ilike(nabhIndicators.name, `%${search}%`),
          ilike(nabhIndicators.indicator_code, `%${search}%`),
          ilike(nabhIndicators.description, `%${search}%`),
        )!);
      }

      const where = and(...conditions);
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(nabhIndicators).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select().from(nabhIndicators)
        .where(where)
        .orderBy(nabhIndicators.category, nabhIndicators.indicator_code)
        .limit(pageSize).offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── GET ──────────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db.select().from(nabhIndicators)
        .where(and(eq(nabhIndicators.id, input.id as any), eq(nabhIndicators.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Indicator not found' });
      return row;
    }),

  // ─── CATEGORIES (distinct) ────────────────────────────────
  categories: adminProcedure.query(async ({ ctx }) => {
    const rows = await db.selectDistinct({ category: nabhIndicators.category })
      .from(nabhIndicators)
      .where(eq(nabhIndicators.hospital_id, ctx.user.hospital_id))
      .orderBy(nabhIndicators.category);
    return rows.map(r => r.category);
  }),

  // ─── SEED (bulk insert 100+ standard NABH indicators) ────
  seed: adminProcedure.mutation(async ({ ctx }) => {

    // Check if already seeded
    const existing = await db.select({ count: sql<number>`count(*)` })
      .from(nabhIndicators)
      .where(eq(nabhIndicators.hospital_id, ctx.user.hospital_id));
    if (Number(existing[0]?.count ?? 0) > 0) {
      return { seeded: 0, message: 'Indicators already exist. Skipping seed.' };
    }

    const indicators = getNABHSeedData();
    let seeded = 0;

    for (const ind of indicators) {
      await db.insert(nabhIndicators).values({
        hospital_id: ctx.user.hospital_id,
        indicator_code: ind.code,
        name: ind.name,
        description: ind.description,
        category: ind.category,
        calculation_type: ind.calculation_type,
        target_value: ind.target_value,
        unit: ind.unit,
      });
      seeded++;
    }

    await writeAuditLog(ctx.user, {
      action: 'INSERT', table_name: 'nabh_indicators',
      row_id: 'seed', new_values: { seeded },
      reason: `Seeded ${seeded} NABH indicators`,
    });

    return { seeded, message: `Successfully seeded ${seeded} indicators` };
  }),

  // ─── STATS ────────────────────────────────────────────────
  stats: adminProcedure.query(async ({ ctx }) => {
    const result = await db.select({
      total: sql<number>`count(*)`,
      auto: sql<number>`count(*) FILTER (WHERE calculation_type = 'auto')`,
      manual: sql<number>`count(*) FILTER (WHERE calculation_type = 'manual')`,
    }).from(nabhIndicators)
      .where(eq(nabhIndicators.hospital_id, ctx.user.hospital_id));

    const catCounts = await db.select({
      category: nabhIndicators.category,
      count: sql<number>`count(*)`,
    }).from(nabhIndicators)
      .where(eq(nabhIndicators.hospital_id, ctx.user.hospital_id))
      .groupBy(nabhIndicators.category)
      .orderBy(nabhIndicators.category);

    return {
      total: Number(result[0]?.total ?? 0),
      auto: Number(result[0]?.auto ?? 0),
      manual: Number(result[0]?.manual ?? 0),
      byCategory: catCounts.map(r => ({ category: r.category, count: Number(r.count) })),
    };
  }),
});

// ─── 100 NABH Seed Indicators ───────────────────────────────
function getNABHSeedData() {
  return [
    // Infection Control (15)
    { code: 'IC-01', name: 'Hand Hygiene Compliance Rate', description: 'Percentage of hand hygiene opportunities where proper hand hygiene is performed', category: 'infection_control', calculation_type: 'auto', target_value: '85', unit: '%' },
    { code: 'IC-02', name: 'Surgical Site Infection Rate', description: 'Number of SSIs per 100 surgical procedures', category: 'infection_control', calculation_type: 'auto', target_value: '2', unit: '%' },
    { code: 'IC-03', name: 'CLABSI Rate', description: 'Central line-associated bloodstream infections per 1000 central line days', category: 'infection_control', calculation_type: 'auto', target_value: '1', unit: 'per 1000 line days' },
    { code: 'IC-04', name: 'CAUTI Rate', description: 'Catheter-associated urinary tract infections per 1000 catheter days', category: 'infection_control', calculation_type: 'auto', target_value: '2', unit: 'per 1000 catheter days' },
    { code: 'IC-05', name: 'VAP Rate', description: 'Ventilator-associated pneumonia per 1000 ventilator days', category: 'infection_control', calculation_type: 'auto', target_value: '5', unit: 'per 1000 ventilator days' },
    { code: 'IC-06', name: 'Blood Culture Contamination Rate', description: 'Percentage of blood cultures that are contaminated', category: 'infection_control', calculation_type: 'auto', target_value: '3', unit: '%' },
    { code: 'IC-07', name: 'Antibiotic Prophylaxis Compliance', description: 'Surgical antibiotic prophylaxis given within recommended window', category: 'infection_control', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'IC-08', name: 'Needle Stick Injury Rate', description: 'Needle stick injuries per 1000 HCW days', category: 'infection_control', calculation_type: 'manual', target_value: '0.5', unit: 'per 1000 HCW days' },
    { code: 'IC-09', name: 'Bio-Medical Waste Segregation Compliance', description: 'Percentage of waste correctly segregated at source', category: 'infection_control', calculation_type: 'manual', target_value: '95', unit: '%' },
    { code: 'IC-10', name: 'Sterilization Failure Rate', description: 'Failed biological indicators per total sterilization cycles', category: 'infection_control', calculation_type: 'auto', target_value: '0', unit: '%' },
    { code: 'IC-11', name: 'Environmental Cleaning Compliance', description: 'Audit score for environmental cleaning', category: 'infection_control', calculation_type: 'manual', target_value: '90', unit: '%' },
    { code: 'IC-12', name: 'PPE Compliance Rate', description: 'Percentage of observations with correct PPE usage', category: 'infection_control', calculation_type: 'manual', target_value: '95', unit: '%' },
    { code: 'IC-13', name: 'Multi-Drug Resistant Organism Rate', description: 'MDRO isolates per 1000 patient days', category: 'infection_control', calculation_type: 'auto', target_value: '5', unit: 'per 1000 patient days' },
    { code: 'IC-14', name: 'Isolation Precaution Compliance', description: 'Compliance with isolation protocols for identified cases', category: 'infection_control', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'IC-15', name: 'Staff Immunization Rate', description: 'Percentage of eligible staff immunized (Hepatitis B, Flu)', category: 'infection_control', calculation_type: 'manual', target_value: '90', unit: '%' },

    // Patient Safety (15)
    { code: 'PS-01', name: 'Patient Fall Rate', description: 'Falls per 1000 patient days', category: 'patient_safety', calculation_type: 'auto', target_value: '3', unit: 'per 1000 patient days' },
    { code: 'PS-02', name: 'Medication Error Rate', description: 'Medication errors per 1000 medication doses', category: 'patient_safety', calculation_type: 'auto', target_value: '0.5', unit: 'per 1000 doses' },
    { code: 'PS-03', name: 'Adverse Drug Reaction Reporting Rate', description: 'ADRs reported per 1000 admissions', category: 'patient_safety', calculation_type: 'auto', target_value: '5', unit: 'per 1000 admissions' },
    { code: 'PS-04', name: 'Blood Transfusion Reaction Rate', description: 'Transfusion reactions per 1000 units transfused', category: 'patient_safety', calculation_type: 'auto', target_value: '1', unit: 'per 1000 units' },
    { code: 'PS-05', name: 'Patient Identification Compliance', description: 'Compliance with two-identifier patient ID protocol', category: 'patient_safety', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'PS-06', name: 'Pressure Ulcer Incidence Rate', description: 'Hospital-acquired pressure ulcers per 1000 patient days', category: 'patient_safety', calculation_type: 'auto', target_value: '2', unit: 'per 1000 patient days' },
    { code: 'PS-07', name: 'Surgical Safety Checklist Compliance', description: 'WHO Surgical Safety Checklist completion rate', category: 'patient_safety', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'PS-08', name: 'Critical Value Reporting Time', description: 'Percentage of critical values reported within 30 minutes', category: 'patient_safety', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'PS-09', name: 'Restraint Usage Rate', description: 'Physical restraint episodes per 1000 patient days', category: 'patient_safety', calculation_type: 'auto', target_value: '5', unit: 'per 1000 patient days' },
    { code: 'PS-10', name: 'Near Miss Reporting Rate', description: 'Near miss events reported per month', category: 'patient_safety', calculation_type: 'manual', target_value: '10', unit: 'per month' },
    { code: 'PS-11', name: 'Sentinel Event Rate', description: 'Sentinel events per 10,000 admissions', category: 'patient_safety', calculation_type: 'auto', target_value: '0', unit: 'per 10000 admissions' },
    { code: 'PS-12', name: 'Wrong-Site Surgery Rate', description: 'Wrong site/procedure/patient surgeries per 10,000 procedures', category: 'patient_safety', calculation_type: 'auto', target_value: '0', unit: 'per 10000 procedures' },
    { code: 'PS-13', name: 'Code Blue Response Time', description: 'Average time from code call to team arrival (minutes)', category: 'patient_safety', calculation_type: 'auto', target_value: '3', unit: 'minutes' },
    { code: 'PS-14', name: 'Deep Vein Thrombosis Prophylaxis Rate', description: 'At-risk patients receiving DVT prophylaxis', category: 'patient_safety', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'PS-15', name: 'Informed Consent Compliance', description: 'Procedures with documented informed consent', category: 'patient_safety', calculation_type: 'manual', target_value: '100', unit: '%' },

    // Medication Safety (10)
    { code: 'MS-01', name: 'High-Alert Medication Compliance', description: 'Compliance with high-alert medication protocols', category: 'medication_safety', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'MS-02', name: 'Antibiotic Utilization Rate', description: 'Defined daily doses per 1000 patient days', category: 'medication_safety', calculation_type: 'auto', target_value: '500', unit: 'DDD per 1000 patient days' },
    { code: 'MS-03', name: 'Drug-Drug Interaction Alert Override Rate', description: 'Critical DDI alerts overridden by prescribers', category: 'medication_safety', calculation_type: 'auto', target_value: '10', unit: '%' },
    { code: 'MS-04', name: 'Formulary Compliance Rate', description: 'Prescriptions within hospital formulary', category: 'medication_safety', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'MS-05', name: 'Medication Reconciliation Completion', description: 'Patients with completed medication reconciliation at admission', category: 'medication_safety', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'MS-06', name: 'IV Medication Administration Accuracy', description: 'IV meds administered at correct rate and concentration', category: 'medication_safety', calculation_type: 'manual', target_value: '99', unit: '%' },
    { code: 'MS-07', name: 'Look-Alike Sound-Alike Drug Error Rate', description: 'LASA-related medication errors per 10000 dispensing events', category: 'medication_safety', calculation_type: 'auto', target_value: '0', unit: 'per 10000' },
    { code: 'MS-08', name: 'Narcotic Discrepancy Rate', description: 'Narcotic count discrepancies per month', category: 'medication_safety', calculation_type: 'manual', target_value: '0', unit: 'per month' },
    { code: 'MS-09', name: 'Pharmacist Intervention Rate', description: 'Clinical interventions by pharmacists per 100 orders', category: 'medication_safety', calculation_type: 'auto', target_value: '5', unit: 'per 100 orders' },
    { code: 'MS-10', name: 'Emergency Drug Kit Compliance', description: 'Emergency drug kits checked and compliant on audit', category: 'medication_safety', calculation_type: 'manual', target_value: '100', unit: '%' },

    // Clinical Outcomes (15)
    { code: 'CO-01', name: 'Hospital Mortality Rate', description: 'In-hospital deaths per 100 discharges', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '2', unit: '%' },
    { code: 'CO-02', name: 'ICU Mortality Rate', description: 'ICU deaths per 100 ICU admissions', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '15', unit: '%' },
    { code: 'CO-03', name: 'Readmission Rate (30-day)', description: 'Unplanned readmissions within 30 days of discharge', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '5', unit: '%' },
    { code: 'CO-04', name: 'Average Length of Stay', description: 'Average days from admission to discharge', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '5', unit: 'days' },
    { code: 'CO-05', name: 'Return to ICU Rate', description: 'Patients returning to ICU within 48 hours of transfer out', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '3', unit: '%' },
    { code: 'CO-06', name: 'Unplanned Return to OT Rate', description: 'Unplanned return to operating theatre within 24 hours', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '1', unit: '%' },
    { code: 'CO-07', name: 'Left Against Medical Advice Rate', description: 'Patients leaving AMA per 100 discharges', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '2', unit: '%' },
    { code: 'CO-08', name: 'Emergency C-Section Rate', description: 'Emergency cesarean sections per 100 deliveries', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '15', unit: '%' },
    { code: 'CO-09', name: 'Neonatal Mortality Rate', description: 'Neonatal deaths per 1000 live births', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '5', unit: 'per 1000 live births' },
    { code: 'CO-10', name: 'Maternal Mortality Rate', description: 'Maternal deaths per 100,000 live births', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '50', unit: 'per 100000 live births' },
    { code: 'CO-11', name: 'Ventilator Weaning Success Rate', description: 'Successful extubation on first attempt', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '80', unit: '%' },
    { code: 'CO-12', name: 'Cardiac Arrest Survival Rate', description: 'Survival to discharge after in-hospital cardiac arrest', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '20', unit: '%' },
    { code: 'CO-13', name: 'Stroke Door-to-Needle Time', description: 'Percentage of stroke patients receiving thrombolysis within 60 min', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '75', unit: '%' },
    { code: 'CO-14', name: 'STEMI Door-to-Balloon Time', description: 'STEMI patients with PCI within 90 minutes', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'CO-15', name: 'Surgical Mortality Rate', description: 'Deaths within 30 days of surgery per 100 procedures', category: 'clinical_outcomes', calculation_type: 'auto', target_value: '1', unit: '%' },

    // Nursing Care (10)
    { code: 'NC-01', name: 'Nurse-to-Patient Ratio', description: 'Average nurse-to-patient ratio per shift', category: 'nursing_care', calculation_type: 'manual', target_value: '5', unit: 'patients per nurse' },
    { code: 'NC-02', name: 'Pain Assessment Compliance', description: 'Patients with documented pain assessment within 4 hours', category: 'nursing_care', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'NC-03', name: 'Nursing Documentation Compliance', description: 'Complete nursing documentation per audit', category: 'nursing_care', calculation_type: 'manual', target_value: '90', unit: '%' },
    { code: 'NC-04', name: 'Patient Education Completion', description: 'Discharge education documented and signed', category: 'nursing_care', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'NC-05', name: 'Hourly Rounding Compliance', description: 'Documented hourly rounds on eligible patients', category: 'nursing_care', calculation_type: 'manual', target_value: '90', unit: '%' },
    { code: 'NC-06', name: 'Skin Assessment on Admission', description: 'Braden Scale assessment within 8 hours of admission', category: 'nursing_care', calculation_type: 'auto', target_value: '100', unit: '%' },
    { code: 'NC-07', name: 'Fall Risk Assessment Compliance', description: 'Fall risk assessment completed on admission', category: 'nursing_care', calculation_type: 'auto', target_value: '100', unit: '%' },
    { code: 'NC-08', name: 'Medication Administration Timing', description: 'Medications administered within 30 min of scheduled time', category: 'nursing_care', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'NC-09', name: 'Patient Handoff Compliance (SBAR)', description: 'Shift handoffs using SBAR format', category: 'nursing_care', calculation_type: 'manual', target_value: '95', unit: '%' },
    { code: 'NC-10', name: 'Nurse Turnover Rate', description: 'Annual nursing staff turnover percentage', category: 'nursing_care', calculation_type: 'manual', target_value: '15', unit: '%' },

    // Laboratory (10)
    { code: 'LB-01', name: 'Lab Turnaround Time (Routine)', description: 'Percentage of routine tests reported within 4 hours', category: 'laboratory', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'LB-02', name: 'Lab Turnaround Time (STAT)', description: 'Percentage of STAT tests reported within 1 hour', category: 'laboratory', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'LB-03', name: 'Sample Rejection Rate', description: 'Rejected lab samples per 100 samples received', category: 'laboratory', calculation_type: 'auto', target_value: '2', unit: '%' },
    { code: 'LB-04', name: 'Critical Value Notification Time', description: 'Critical values communicated within 15 minutes', category: 'laboratory', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'LB-05', name: 'Lab QC Failure Rate', description: 'Internal QC failures per 100 test runs', category: 'laboratory', calculation_type: 'auto', target_value: '2', unit: '%' },
    { code: 'LB-06', name: 'EQAS Participation Rate', description: 'Participation in external quality assurance schemes', category: 'laboratory', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'LB-07', name: 'Hemolysis Rate', description: 'Hemolyzed samples per 100 blood draws', category: 'laboratory', calculation_type: 'auto', target_value: '2', unit: '%' },
    { code: 'LB-08', name: 'Lab Report Amendment Rate', description: 'Amended reports per 1000 reports issued', category: 'laboratory', calculation_type: 'auto', target_value: '1', unit: 'per 1000' },
    { code: 'LB-09', name: 'Blood Bank Cross-Match to Transfusion Ratio', description: 'C:T ratio target', category: 'laboratory', calculation_type: 'auto', target_value: '2.5', unit: 'ratio' },
    { code: 'LB-10', name: 'Lab Equipment Downtime', description: 'Unplanned equipment downtime hours per month', category: 'laboratory', calculation_type: 'manual', target_value: '4', unit: 'hours per month' },

    // Radiology (5)
    { code: 'RD-01', name: 'Radiology Report Turnaround Time', description: 'Percentage of reports finalized within 24 hours', category: 'radiology', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'RD-02', name: 'STAT Imaging Report Time', description: 'STAT imaging reported within 1 hour', category: 'radiology', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'RD-03', name: 'Repeat/Reject Imaging Rate', description: 'Repeat or rejected images per 100 examinations', category: 'radiology', calculation_type: 'auto', target_value: '3', unit: '%' },
    { code: 'RD-04', name: 'CT Contrast Reaction Rate', description: 'Contrast reactions per 1000 CT studies', category: 'radiology', calculation_type: 'auto', target_value: '1', unit: 'per 1000' },
    { code: 'RD-05', name: 'Radiation Dose Compliance', description: 'CT scans within diagnostic reference levels', category: 'radiology', calculation_type: 'manual', target_value: '95', unit: '%' },

    // Patient Experience (10)
    { code: 'PE-01', name: 'Patient Satisfaction Score', description: 'Overall patient satisfaction survey score', category: 'patient_experience', calculation_type: 'manual', target_value: '85', unit: '%' },
    { code: 'PE-02', name: 'Patient Complaint Rate', description: 'Formal complaints per 1000 discharges', category: 'patient_experience', calculation_type: 'auto', target_value: '5', unit: 'per 1000 discharges' },
    { code: 'PE-03', name: 'Complaint Resolution Time', description: 'Average days to resolve patient complaints', category: 'patient_experience', calculation_type: 'auto', target_value: '7', unit: 'days' },
    { code: 'PE-04', name: 'Emergency Wait Time', description: 'Average time from registration to doctor consultation (minutes)', category: 'patient_experience', calculation_type: 'auto', target_value: '30', unit: 'minutes' },
    { code: 'PE-05', name: 'OPD Wait Time', description: 'Average OPD waiting time (minutes)', category: 'patient_experience', calculation_type: 'auto', target_value: '20', unit: 'minutes' },
    { code: 'PE-06', name: 'Discharge Process Time', description: 'Average time from discharge order to patient exit (hours)', category: 'patient_experience', calculation_type: 'auto', target_value: '4', unit: 'hours' },
    { code: 'PE-07', name: 'Net Promoter Score', description: 'Hospital NPS from patient surveys', category: 'patient_experience', calculation_type: 'manual', target_value: '50', unit: 'NPS' },
    { code: 'PE-08', name: 'Communication Satisfaction', description: 'Patient satisfaction with doctor-patient communication', category: 'patient_experience', calculation_type: 'manual', target_value: '90', unit: '%' },
    { code: 'PE-09', name: 'Food Service Satisfaction', description: 'Patient satisfaction with food service quality', category: 'patient_experience', calculation_type: 'manual', target_value: '80', unit: '%' },
    { code: 'PE-10', name: 'Post-Discharge Follow-up Rate', description: 'Patients contacted within 48 hours of discharge', category: 'patient_experience', calculation_type: 'auto', target_value: '80', unit: '%' },

    // Operational (10)
    { code: 'OP-01', name: 'Bed Occupancy Rate', description: 'Average bed occupancy percentage', category: 'operational', calculation_type: 'auto', target_value: '80', unit: '%' },
    { code: 'OP-02', name: 'OT Utilization Rate', description: 'Operating theatre utilization during scheduled hours', category: 'operational', calculation_type: 'auto', target_value: '75', unit: '%' },
    { code: 'OP-03', name: 'Emergency Department Boarding Time', description: 'Average ED boarding hours for admitted patients', category: 'operational', calculation_type: 'auto', target_value: '4', unit: 'hours' },
    { code: 'OP-04', name: 'Surgery Cancellation Rate', description: 'Surgeries cancelled on day of procedure', category: 'operational', calculation_type: 'auto', target_value: '5', unit: '%' },
    { code: 'OP-05', name: 'Equipment Availability Rate', description: 'Critical equipment uptime percentage', category: 'operational', calculation_type: 'manual', target_value: '98', unit: '%' },
    { code: 'OP-06', name: 'Ambulance Response Time', description: 'Average ambulance response time (minutes)', category: 'operational', calculation_type: 'auto', target_value: '15', unit: 'minutes' },
    { code: 'OP-07', name: 'Medical Records Completion Rate', description: 'Records completed within 24 hours of discharge', category: 'operational', calculation_type: 'auto', target_value: '90', unit: '%' },
    { code: 'OP-08', name: 'Staff Absenteeism Rate', description: 'Unplanned staff absence percentage', category: 'operational', calculation_type: 'manual', target_value: '3', unit: '%' },
    { code: 'OP-09', name: 'Fire Drill Compliance', description: 'Fire drills conducted per quarter', category: 'operational', calculation_type: 'manual', target_value: '1', unit: 'per quarter' },
    { code: 'OP-10', name: 'Utility Failure Response Time', description: 'Response time to utility failures (minutes)', category: 'operational', calculation_type: 'manual', target_value: '15', unit: 'minutes' },

    // Documentation & Compliance (10)
    { code: 'DC-01', name: 'Consent Form Completion Rate', description: 'Procedures with properly completed consent forms', category: 'documentation_compliance', calculation_type: 'auto', target_value: '100', unit: '%' },
    { code: 'DC-02', name: 'Discharge Summary Completion', description: 'Discharge summaries completed within 24 hours', category: 'documentation_compliance', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'DC-03', name: 'Clinical Pathway Compliance', description: 'Patients on clinical pathways with documented compliance', category: 'documentation_compliance', calculation_type: 'manual', target_value: '85', unit: '%' },
    { code: 'DC-04', name: 'Mortality Review Rate', description: 'Deaths reviewed within 7 days', category: 'documentation_compliance', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'DC-05', name: 'Policy Review Currency', description: 'Policies reviewed within last 12 months', category: 'documentation_compliance', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'DC-06', name: 'Incident Report Filing Rate', description: 'Incidents reported within 24 hours of occurrence', category: 'documentation_compliance', calculation_type: 'auto', target_value: '95', unit: '%' },
    { code: 'DC-07', name: 'Staff Credentialing Currency', description: 'Staff with up-to-date credentials and privileges', category: 'documentation_compliance', calculation_type: 'manual', target_value: '100', unit: '%' },
    { code: 'DC-08', name: 'Safety Audit Score', description: 'Average internal safety audit score', category: 'documentation_compliance', calculation_type: 'manual', target_value: '90', unit: '%' },
    { code: 'DC-09', name: 'Training Completion Rate', description: 'Staff completing mandatory annual training', category: 'documentation_compliance', calculation_type: 'manual', target_value: '95', unit: '%' },
    { code: 'DC-10', name: 'Root Cause Analysis Completion', description: 'RCAs completed within 45 days of sentinel event', category: 'documentation_compliance', calculation_type: 'manual', target_value: '100', unit: '%' },
  ];
}
