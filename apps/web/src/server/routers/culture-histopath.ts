/**
 * Culture & Sensitivity + Histopathology — Module 8 LIS (L.5)
 *
 * Multi-day microbiology culture tracking with organism identification
 * and sequential antibiotic sensitivity (S/I/R). Histopathology multi-stage
 * workflow: accessioning → grossing → microscopy → diagnosis → report.
 *
 * Endpoints:
 *   Culture & Sensitivity:
 *   1. createCulture       — Start culture from lab order
 *   2. recordOrganism      — Identify organism with SNOMED
 *   3. addSensitivity      — Add antibiotic S/I/R result
 *   4. updateCultureStatus — Multi-day workflow updates
 *   5. declareNoGrowth     — Declare no growth after incubation
 *   6. getCultureDetail    — Full culture with organisms + sensitivities
 *   7. listCultures        — Culture list with filters
 *
 *   Histopathology:
 *   8. createCase          — Accession new histopath case
 *   9. recordGrossing      — Gross description + photos
 *  10. recordMicroscopy    — Microscopy findings + special stains
 *  11. recordDiagnosis     — ICD-10 coded diagnosis + pathologist sign
 *  12. getCaseDetail       — Full case with all stages
 *  13. listCases           — Case list with filters
 *  14. stats               — Dashboard counts
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  cultureOrders, organismIdentifications, antibioticSensitivities,
  histopathCases,
} from '@db/schema';
import { eq, and, desc, count, sql, gte, asc } from 'drizzle-orm';

export const cultureHistopathRouter = router({

  // ==============================================================
  // CULTURE & SENSITIVITY
  // ==============================================================

  // 1. CREATE CULTURE
  createCulture: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      order_id: z.string().uuid(),
      specimen_id: z.string().uuid().optional(),
      patient_id: z.string().uuid(),
      specimen_source: z.string().optional(),
      collection_date: z.string().optional(),
      media_used: z.array(z.string()).optional(),
      incubation_temp: z.string().optional(),
      incubation_atmosphere: z.string().optional(),
      incubation_hours: z.number().optional(),
      clinical_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');

      const [culture] = await db.insert(cultureOrders).values({
        hospital_id: input.hospital_id,
        order_id: input.order_id,
        specimen_id: input.specimen_id ?? null,
        patient_id: input.patient_id,
        culture_number: `CUL-${dateKey}-${seq}`,
        status: 'inoculated',
        specimen_source: input.specimen_source ?? null,
        collection_date: input.collection_date ? new Date(input.collection_date) : null,
        media_used: input.media_used ?? null,
        inoculated_by: ctx.user.sub,
        incubation_temp: input.incubation_temp ?? '37°C',
        incubation_atmosphere: input.incubation_atmosphere ?? 'aerobic',
        incubation_hours: input.incubation_hours ?? 24,
        clinical_notes: input.clinical_notes ?? null,
      }).returning();

      return culture;
    }),

  // 2. RECORD ORGANISM
  recordOrganism: protectedProcedure
    .input(z.object({
      culture_id: z.string().uuid(),
      organism_name: z.string().min(1),
      snomed_code: z.string().optional(),
      gram_stain: z.string().optional(),
      morphology: z.string().optional(),
      identification_method: z.string().optional(),
      colony_count: z.string().optional(),
      is_significant: z.boolean().default(true),
      is_contaminant: z.boolean().default(false),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [culture] = await db.select()
        .from(cultureOrders)
        .where(eq(cultureOrders.id, input.culture_id))
        .limit(1);

      if (!culture) throw new TRPCError({ code: 'NOT_FOUND', message: 'Culture not found' });

      const [organism] = await db.insert(organismIdentifications).values({
        hospital_id: culture.hospital_id,
        culture_id: input.culture_id,
        organism_name: input.organism_name,
        snomed_code: input.snomed_code ?? null,
        gram_stain: input.gram_stain ?? null,
        morphology: input.morphology ?? null,
        identification_method: input.identification_method ?? null,
        colony_count: input.colony_count ?? null,
        is_significant: input.is_significant,
        is_contaminant: input.is_contaminant,
        identified_by: ctx.user.sub,
        notes: input.notes ?? null,
      }).returning();

      // Update culture status
      await db.update(cultureOrders)
        .set({ status: 'organism_identified', updated_at: new Date() })
        .where(eq(cultureOrders.id, input.culture_id));

      return organism;
    }),

  // 3. ADD SENSITIVITY
  addSensitivity: protectedProcedure
    .input(z.object({
      organism_id: z.string().uuid(),
      antibiotic_name: z.string().min(1),
      antibiotic_code: z.string().optional(),
      antibiotic_class: z.string().optional(),
      result: z.enum(['S', 'I', 'R']),
      mic_value: z.string().optional(),
      zone_diameter_mm: z.number().optional(),
      breakpoint_standard: z.string().optional(),
      breakpoint_year: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [organism] = await db.select()
        .from(organismIdentifications)
        .where(eq(organismIdentifications.id, input.organism_id))
        .limit(1);

      if (!organism) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organism not found' });

      const [sensitivity] = await db.insert(antibioticSensitivities).values({
        hospital_id: organism.hospital_id,
        organism_id: input.organism_id,
        antibiotic_name: input.antibiotic_name,
        antibiotic_code: input.antibiotic_code ?? null,
        antibiotic_class: input.antibiotic_class ?? null,
        result: input.result,
        mic_value: input.mic_value ?? null,
        zone_diameter_mm: input.zone_diameter_mm ?? null,
        breakpoint_standard: input.breakpoint_standard ?? null,
        breakpoint_year: input.breakpoint_year ?? null,
        tested_by: ctx.user.sub,
        notes: input.notes ?? null,
      }).returning();

      // Update culture status
      await db.update(cultureOrders)
        .set({ status: 'sensitivity_in_progress', updated_at: new Date() })
        .where(eq(cultureOrders.id, organism.culture_id));

      return sensitivity;
    }),

  // 4. UPDATE CULTURE STATUS
  updateCultureStatus: protectedProcedure
    .input(z.object({
      culture_id: z.string().uuid(),
      status: z.enum(['inoculated', 'growing', 'organism_identified', 'sensitivity_in_progress', 'sensitivity_complete', 'no_growth', 'cancelled']),
    }))
    .mutation(async ({ input }) => {
      const [updated] = await db.update(cultureOrders)
        .set({ status: input.status, updated_at: new Date() })
        .where(eq(cultureOrders.id, input.culture_id))
        .returning();

      return updated;
    }),

  // 5. DECLARE NO GROWTH
  declareNoGrowth: protectedProcedure
    .input(z.object({
      culture_id: z.string().uuid(),
      final_hours: z.number().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(cultureOrders)
        .set({
          status: 'no_growth',
          no_growth_declared_at: new Date(),
          no_growth_declared_by: ctx.user.sub,
          final_no_growth_hours: input.final_hours,
          updated_at: new Date(),
        })
        .where(eq(cultureOrders.id, input.culture_id))
        .returning();

      return updated;
    }),

  // 6. GET CULTURE DETAIL
  getCultureDetail: protectedProcedure
    .input(z.object({ culture_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [culture] = await db.select()
        .from(cultureOrders)
        .where(eq(cultureOrders.id, input.culture_id))
        .limit(1);

      if (!culture) throw new TRPCError({ code: 'NOT_FOUND', message: 'Culture not found' });

      const organisms = await db.select()
        .from(organismIdentifications)
        .where(eq(organismIdentifications.culture_id, input.culture_id))
        .orderBy(asc(organismIdentifications.created_at));

      // For each organism, get sensitivities
      const organismsWithSensitivities = await Promise.all(
        organisms.map(async (org) => {
          const sensitivities = await db.select()
            .from(antibioticSensitivities)
            .where(eq(antibioticSensitivities.organism_id, org.id))
            .orderBy(asc(antibioticSensitivities.antibiotic_name));

          return { ...org, sensitivities };
        })
      );

      return { culture, organisms: organismsWithSensitivities };
    }),

  // 7. LIST CULTURES
  listCultures: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['inoculated', 'growing', 'organism_identified', 'sensitivity_in_progress', 'sensitivity_complete', 'no_growth', 'cancelled']).optional(),
      patient_id: z.string().uuid().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(cultureOrders.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(cultureOrders.status, input.status));
      if (input.patient_id) conditions.push(eq(cultureOrders.patient_id, input.patient_id));

      const cultures = await db.select()
        .from(cultureOrders)
        .where(and(...conditions))
        .orderBy(desc(cultureOrders.created_at))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db.select({ total: count() })
        .from(cultureOrders)
        .where(and(...conditions));

      return { cultures, total: totalRow?.total ?? 0 };
    }),

  // ==============================================================
  // HISTOPATHOLOGY
  // ==============================================================

  // 8. CREATE CASE
  createCase: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      order_id: z.string().uuid().optional(),
      patient_id: z.string().uuid(),
      specimen_type: z.enum(['biopsy', 'excision', 'resection', 'cytology', 'fnac', 'frozen_section', 'autopsy', 'other']),
      specimen_description: z.string().optional(),
      specimen_site: z.string().optional(),
      laterality: z.string().optional(),
      number_of_pieces: z.number().optional(),
      clinical_history: z.string().optional(),
      clinical_diagnosis: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');

      const [hpCase] = await db.insert(histopathCases).values({
        hospital_id: input.hospital_id,
        order_id: input.order_id ?? null,
        patient_id: input.patient_id,
        case_number: `HP-${dateKey}-${seq}`,
        specimen_type: input.specimen_type,
        stage: 'accessioned',
        specimen_description: input.specimen_description ?? null,
        specimen_site: input.specimen_site ?? null,
        laterality: input.laterality ?? null,
        number_of_pieces: input.number_of_pieces ?? 1,
        clinical_history: input.clinical_history ?? null,
        clinical_diagnosis: input.clinical_diagnosis ?? null,
      }).returning();

      return hpCase;
    }),

  // 9. RECORD GROSSING
  recordGrossing: protectedProcedure
    .input(z.object({
      case_id: z.string().uuid(),
      gross_description: z.string().min(1),
      gross_photos: z.array(z.object({ url: z.string(), caption: z.string().optional() })).optional(),
      cassette_count: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(histopathCases)
        .set({
          stage: 'grossing',
          gross_description: input.gross_description,
          gross_photos: input.gross_photos ?? null,
          gross_by: ctx.user.sub,
          gross_at: new Date(),
          cassette_count: input.cassette_count ?? null,
          updated_at: new Date(),
        })
        .where(eq(histopathCases.id, input.case_id))
        .returning();

      return updated;
    }),

  // 10. RECORD MICROSCOPY
  recordMicroscopy: protectedProcedure
    .input(z.object({
      case_id: z.string().uuid(),
      microscopy_findings: z.string().min(1),
      special_stains: z.array(z.object({ stain_name: z.string(), result: z.string() })).optional(),
      ihc_markers: z.array(z.object({ marker: z.string(), result: z.string() })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db.update(histopathCases)
        .set({
          stage: 'microscopy',
          microscopy_findings: input.microscopy_findings,
          special_stains: input.special_stains ?? null,
          ihc_markers: input.ihc_markers ?? null,
          microscopy_by: ctx.user.sub,
          microscopy_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(histopathCases.id, input.case_id))
        .returning();

      return updated;
    }),

  // 11. RECORD DIAGNOSIS
  recordDiagnosis: protectedProcedure
    .input(z.object({
      case_id: z.string().uuid(),
      diagnosis_text: z.string().min(1),
      icd10_code: z.string().optional(),
      icd10_description: z.string().optional(),
      tumor_grade: z.string().optional(),
      tumor_stage: z.string().optional(),
      margin_status: z.string().optional(),
      synoptic_report: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [hpCase] = await db.select()
        .from(histopathCases)
        .where(eq(histopathCases.id, input.case_id))
        .limit(1);

      if (!hpCase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });

      const now = new Date();
      const accessioned = hpCase.accessioned_at ? new Date(hpCase.accessioned_at) : hpCase.created_at;
      const tatHours = Math.round((now.getTime() - accessioned.getTime()) / (1000 * 60 * 60));

      const [updated] = await db.update(histopathCases)
        .set({
          stage: 'diagnosis',
          diagnosis_text: input.diagnosis_text,
          icd10_code: input.icd10_code ?? null,
          icd10_description: input.icd10_description ?? null,
          tumor_grade: input.tumor_grade ?? null,
          tumor_stage: input.tumor_stage ?? null,
          margin_status: input.margin_status ?? null,
          synoptic_report: input.synoptic_report ?? null,
          pathologist_id: ctx.user.sub,
          diagnosed_at: now,
          reported_at: now,
          tat_hours: tatHours,
          updated_at: now,
        })
        .where(eq(histopathCases.id, input.case_id))
        .returning();

      return updated;
    }),

  // 12. GET CASE DETAIL
  getCaseDetail: protectedProcedure
    .input(z.object({ case_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [hpCase] = await db.select()
        .from(histopathCases)
        .where(eq(histopathCases.id, input.case_id))
        .limit(1);

      if (!hpCase) throw new TRPCError({ code: 'NOT_FOUND', message: 'Case not found' });
      return hpCase;
    }),

  // 13. LIST CASES
  listCases: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      stage: z.enum(['accessioned', 'grossing', 'processing', 'embedding', 'sectioning', 'staining', 'microscopy', 'diagnosis', 'reported', 'amended']).optional(),
      specimen_type: z.enum(['biopsy', 'excision', 'resection', 'cytology', 'fnac', 'frozen_section', 'autopsy', 'other']).optional(),
      patient_id: z.string().uuid().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(histopathCases.hospital_id, input.hospital_id)];
      if (input.stage) conditions.push(eq(histopathCases.stage, input.stage));
      if (input.specimen_type) conditions.push(eq(histopathCases.specimen_type, input.specimen_type));
      if (input.patient_id) conditions.push(eq(histopathCases.patient_id, input.patient_id));

      const cases = await db.select()
        .from(histopathCases)
        .where(and(...conditions))
        .orderBy(desc(histopathCases.created_at))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db.select({ total: count() })
        .from(histopathCases)
        .where(and(...conditions));

      return { cases, total: totalRow?.total ?? 0 };
    }),

  // 14. STATS
  stats: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const [activeCultures] = await db.select({ total: count() })
        .from(cultureOrders)
        .where(and(
          eq(cultureOrders.hospital_id, input.hospital_id),
          sql`${cultureOrders.status} NOT IN ('no_growth', 'sensitivity_complete', 'cancelled')`,
        ));

      const [pendingSensitivity] = await db.select({ total: count() })
        .from(cultureOrders)
        .where(and(
          eq(cultureOrders.hospital_id, input.hospital_id),
          eq(cultureOrders.status, 'sensitivity_in_progress'),
        ));

      const [totalOrganisms] = await db.select({ total: count() })
        .from(organismIdentifications)
        .where(eq(organismIdentifications.hospital_id, input.hospital_id));

      const [activeHpCases] = await db.select({ total: count() })
        .from(histopathCases)
        .where(and(
          eq(histopathCases.hospital_id, input.hospital_id),
          sql`${histopathCases.stage} NOT IN ('reported', 'amended')`,
        ));

      const [pendingDiagnosis] = await db.select({ total: count() })
        .from(histopathCases)
        .where(and(
          eq(histopathCases.hospital_id, input.hospital_id),
          eq(histopathCases.stage, 'microscopy'),
        ));

      const [totalHpCases] = await db.select({ total: count() })
        .from(histopathCases)
        .where(eq(histopathCases.hospital_id, input.hospital_id));

      return {
        active_cultures: activeCultures?.total ?? 0,
        pending_sensitivity: pendingSensitivity?.total ?? 0,
        total_organisms: totalOrganisms?.total ?? 0,
        active_hp_cases: activeHpCases?.total ?? 0,
        pending_diagnosis: pendingDiagnosis?.total ?? 0,
        total_hp_cases: totalHpCases?.total ?? 0,
      };
    }),
});
