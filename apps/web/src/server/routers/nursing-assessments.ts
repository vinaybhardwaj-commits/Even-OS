import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { nursingAssessments, patientAssignments, clinicalImpressions } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, desc, sql } from 'drizzle-orm';

// ============================================================
// NURSING ASSESSMENTS — NS.3
// 6 assessment types with scoring + auto-generated nursing notes
// ============================================================

// Assessment definitions with schedule
const ASSESSMENT_DEFS = [
  { key: 'pain', label: 'Pain Assessment (NRS)', icon: '😣', frequency_hours: 4, required: true },
  { key: 'morse_falls', label: 'Morse Fall Scale', icon: '🦿', frequency_hours: 8, required: true },
  { key: 'braden', label: 'Braden Pressure Injury', icon: '🩹', frequency_hours: 24, required: true },
  { key: 'restraint', label: 'Restraint Check', icon: '🔒', frequency_hours: 2, required: false },
  { key: 'skin', label: 'Skin Assessment', icon: '🔍', frequency_hours: 8, required: true },
  { key: 'general', label: 'General Nursing Note', icon: '📝', frequency_hours: 0, required: false },
] as const;

// Morse Fall Scale scoring
function scoreMorseFalls(data: any): { score: number; risk: string } {
  let score = 0;
  if (data.history_of_falling) score += 25;
  if (data.secondary_diagnosis) score += 15;
  if (data.ambulatory_aid === 'furniture') score += 15;
  else if (data.ambulatory_aid === 'crutches_cane_walker') score += 30;
  if (data.iv_or_heparin_lock) score += 20;
  if (data.gait === 'impaired') score += 10;
  else if (data.gait === 'weak') score += 20;
  if (data.mental_status === 'forgets_limitations') score += 15;

  const risk = score >= 45 ? 'high' : score >= 25 ? 'moderate' : 'low';
  return { score, risk };
}

// Braden Scale scoring (lower = higher risk)
function scoreBraden(data: any): { score: number; risk: string } {
  const score = (data.sensory_perception || 4) + (data.moisture || 4) +
    (data.activity || 4) + (data.mobility || 4) +
    (data.nutrition || 4) + (data.friction_shear || 3);

  const risk = score <= 9 ? 'very_high' : score <= 12 ? 'high' :
    score <= 14 ? 'moderate' : score <= 18 ? 'mild' : 'no_risk';
  return { score, risk };
}

// Generate nursing note text from assessment
function generateNoteText(assessmentType: string, data: any, scores: any): string {
  switch (assessmentType) {
    case 'pain':
      return `Pain Assessment (NRS): Score ${data.pain_score}/10. ` +
        `Location: ${data.location || 'not specified'}. ` +
        `Character: ${data.character || 'not specified'}. ` +
        `Interventions: ${data.interventions || 'none documented'}.`;

    case 'morse_falls':
      return `Morse Fall Scale Assessment: Score ${scores.score} (${scores.risk} risk). ` +
        `History of falling: ${data.history_of_falling ? 'Yes' : 'No'}. ` +
        `Ambulatory aid: ${data.ambulatory_aid || 'none'}. ` +
        `Gait: ${data.gait || 'normal'}. ` +
        `Mental status: ${data.mental_status || 'oriented'}.`;

    case 'braden':
      return `Braden Scale Assessment: Score ${scores.score}/23 (${scores.risk} risk). ` +
        `Sensory: ${data.sensory_perception}/4, Moisture: ${data.moisture}/4, ` +
        `Activity: ${data.activity}/4, Mobility: ${data.mobility}/4, ` +
        `Nutrition: ${data.nutrition}/4, Friction: ${data.friction_shear}/3.`;

    case 'restraint':
      return `Restraint Check: Type: ${data.restraint_type || 'N/A'}. ` +
        `Circulation: ${data.circulation_status || 'adequate'}. ` +
        `Skin integrity: ${data.skin_integrity || 'intact'}. ` +
        `Need continues: ${data.restraint_continues ? 'Yes' : 'No'}. ` +
        `Notes: ${data.notes || 'none'}.`;

    case 'skin':
      return `Skin Assessment: Integrity: ${data.integrity || 'intact'}. ` +
        `Areas of concern: ${data.areas_of_concern || 'none'}. ` +
        `Wounds: ${data.wound_count || 0}. ` +
        `IV sites: ${data.iv_site_status || 'N/A'}. ` +
        `Notes: ${data.notes || 'none'}.`;

    case 'general':
      return data.notes || 'General nursing note.';

    default:
      return `${assessmentType} assessment completed.`;
  }
}

export const nursingAssessmentsRouter = router({

  // ── Get assessment definitions (for Assess tab) ───────────────────────

  getDefinitions: protectedProcedure
    .query(async () => {
      return ASSESSMENT_DEFS;
    }),

  // ── Submit an assessment ──────────────────────────────────────────────

  submit: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      assignment_id: z.string().uuid().optional(),
      assessment_type: z.enum(['admission', 'shift_start', 'routine', 'focused', 'discharge']),
      assessment_key: z.string(), // pain, morse_falls, braden, restraint, skin, general
      pain_score: z.number().int().min(0).max(10).optional(),
      fall_risk_score: z.number().int().optional(),
      braden_score: z.number().int().optional(),
      mobility_status: z.string().optional(),
      diet_compliance: z.string().optional(),
      iv_site_status: z.string().optional(),
      wound_status: z.string().optional(),
      neuro_status: z.string().optional(),
      notes: z.string().optional(),
      assessment_data: z.record(z.any()).optional(),
      is_flagged: z.boolean().default(false),
      flag_reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Calculate scores based on assessment key
      let computedScores: any = {};
      const data = input.assessment_data || {};

      if (input.assessment_key === 'morse_falls') {
        computedScores = scoreMorseFalls(data);
        input.fall_risk_score = computedScores.score;
        // Auto-flag high risk
        if (computedScores.risk === 'high') {
          input.is_flagged = true;
          input.flag_reason = `Morse Fall Scale: HIGH risk (score ${computedScores.score})`;
        }
      }

      if (input.assessment_key === 'braden') {
        computedScores = scoreBraden(data);
        input.braden_score = computedScores.score;
        if (computedScores.risk === 'very_high' || computedScores.risk === 'high') {
          input.is_flagged = true;
          input.flag_reason = `Braden Scale: ${computedScores.risk} risk (score ${computedScores.score})`;
        }
      }

      if (input.assessment_key === 'pain' && input.pain_score !== undefined && input.pain_score >= 7) {
        input.is_flagged = true;
        input.flag_reason = `Severe pain: NRS ${input.pain_score}/10`;
      }

      // Insert assessment
      const [assessment] = await db.insert(nursingAssessments).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id,
        assignment_id: input.assignment_id || null,
        nurse_id: ctx.user.sub,
        assessment_type: input.assessment_type,
        pain_score: input.pain_score ?? null,
        fall_risk_score: input.fall_risk_score ?? null,
        braden_score: input.braden_score ?? null,
        mobility_status: input.mobility_status || null,
        diet_compliance: input.diet_compliance || null,
        iv_site_status: input.iv_site_status || null,
        wound_status: input.wound_status || null,
        neuro_status: input.neuro_status || null,
        notes: input.notes || null,
        assessment_data: input.assessment_data ? JSON.stringify({ ...input.assessment_data, _key: input.assessment_key, _scores: computedScores }) : null,
        is_flagged: input.is_flagged,
        flag_reason: input.flag_reason || null,
      }).returning();

      // Auto-generate nursing note in clinical_impressions
      const noteText = generateNoteText(input.assessment_key, { ...data, ...input }, computedScores);
      await db.insert(clinicalImpressions).values({
        hospital_id: ctx.user.hospital_id,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id,
        note_type: 'nursing_note',
        status: 'signed',
        objective: noteText,
        pain_assessment: input.assessment_key === 'pain' ? `NRS ${input.pain_score}/10` : null,
        fall_risk_assessment: input.assessment_key === 'morse_falls' ? `Morse ${computedScores.score} (${computedScores.risk})` : null,
        skin_integrity_assessment: input.assessment_key === 'skin' ? (data.integrity || 'intact') : null,
        wound_assessment: input.assessment_key === 'skin' ? (data.wound_count ? `${data.wound_count} wounds` : null) : null,
        author_id: ctx.user.sub,
      });

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'nursing_assessments',
        row_id: assessment.id,
        new_values: { assessment_key: input.assessment_key, patient_id: input.patient_id },
        reason: `${input.assessment_key} assessment submitted`,
      });

      return { assessment, scores: computedScores };
    }),

  // ── Get latest assessments for a patient (for Assess tab status) ──────

  latest: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      // Get the most recent assessment for each type
      const rows = await db.select()
        .from(nursingAssessments)
        .where(and(
          eq(nursingAssessments.hospital_id, ctx.user.hospital_id),
          eq(nursingAssessments.patient_id, input.patient_id),
          eq(nursingAssessments.encounter_id, input.encounter_id),
        ))
        .orderBy(desc(nursingAssessments.created_at))
        .limit(50);

      // Group by assessment_key (stored in assessment_data._key)
      const byKey: Record<string, typeof rows[0]> = {};
      for (const row of rows) {
        const data = row.assessment_data as any;
        const key = data?._key || 'unknown';
        if (!byKey[key]) {
          byKey[key] = row;
        }
      }

      return byKey;
    }),

  // ── Assessment history for a patient + key ────────────────────────────

  history: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      assessment_key: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(nursingAssessments.hospital_id, ctx.user.hospital_id),
        eq(nursingAssessments.patient_id, input.patient_id),
        eq(nursingAssessments.encounter_id, input.encounter_id),
      ];

      // Filter by key if provided (stored in assessment_data jsonb)
      const rows = await db.select()
        .from(nursingAssessments)
        .where(and(...conditions))
        .orderBy(desc(nursingAssessments.created_at))
        .limit(input.limit);

      // Filter by key client-side since it's in JSONB
      if (input.assessment_key) {
        return rows.filter(r => {
          const data = r.assessment_data as any;
          return data?._key === input.assessment_key;
        });
      }

      return rows;
    }),
});
