import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  patientPortalPreferences, delegatedUsers, patientFeedback, patientPayments,
  preAdmissionForms, medicationRefillRequests, postDischargeTasks, patientPortalAuditLog
} from '@db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export const patientPortalRouter = router({
  // Portal Preferences
  getPreferences: protectedProcedure
    .input(z.object({ patient_id: z.string() }))
    .query(async ({ input }) => {
      const prefs = await db.query.patientPortalPreferences.findFirst({
        where: eq(patientPortalPreferences.patient_id, input.patient_id as any),
      });
      return prefs || null;
    }),

  updatePreferences: protectedProcedure
    .input(z.object({
      patient_id: z.string(),
      language: z.string().optional(),
      notification_sms: z.boolean().optional(),
      notification_email: z.boolean().optional(),
      notification_push: z.boolean().optional(),
      preferred_contact_method: z.string().optional(),
      two_factor_enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await db.update(patientPortalPreferences)
        .set({
          language: input.language,
          notification_sms: input.notification_sms,
          notification_email: input.notification_email,
          notification_push: input.notification_push,
          two_factor_enabled: input.two_factor_enabled,
          updated_at: new Date(),
        })
        .where(eq(patientPortalPreferences.patient_id, input.patient_id as any))
        .returning();
      return result[0];
    }),

  // Delegated Users
  listDelegatedUsers: protectedProcedure
    .input(z.object({ patient_id: z.string() }))
    .query(async ({ input }) => {
      const users = await db.query.delegatedUsers.findMany({
        where: eq(delegatedUsers.patient_id, input.patient_id as any),
      });
      return users;
    }),

  addDelegatedUser: protectedProcedure
    .input(z.object({
      patient_id: z.string(),
      delegated_user_name: z.string(),
      delegated_user_phone: z.string(),
      delegated_user_email: z.string().optional(),
      relationship: z.string(),
    }))
    .mutation(async ({ input }) => {
      const result = await db.insert(delegatedUsers)
        .values({
          patient_id: input.patient_id as any,
          delegated_user_name: input.delegated_user_name,
          delegated_user_phone: input.delegated_user_phone,
          delegated_user_email: input.delegated_user_email,
          relationship: input.relationship as any,
          status: 'invited',
        })
        .returning();
      return result[0];
    }),

  // Feedback
  submitFeedback: protectedProcedure
    .input(z.object({
      patient_id: z.string().optional(),
      encounter_id: z.string().optional(),
      feedback_type: z.string(),
      department: z.string().optional(),
      clinician_name: z.string().optional(),
      rating_score: z.number().optional(),
      nps_score: z.number().optional(),
      feedback_text: z.string().optional(),
      is_anonymous: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const result = await db.insert(patientFeedback)
        .values({
          patient_id: input.patient_id as any,
          encounter_id: input.encounter_id as any,
          feedback_type: input.feedback_type as any,
          department: input.department,
          clinician_name: input.clinician_name,
          rating_score: input.rating_score,
          nps_score: input.nps_score,
          feedback_text: input.feedback_text,
          is_anonymous: input.is_anonymous,
        })
        .returning();
      return result[0];
    }),

  listFeedback: protectedProcedure
    .input(z.object({
      feedback_type: z.string().optional(),
      department: z.string().optional(),
      escalated: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const where = and(
        input.feedback_type ? eq(patientFeedback.feedback_type, input.feedback_type as any) : undefined,
        input.department ? eq(patientFeedback.department, input.department) : undefined,
        input.escalated !== undefined ? eq(patientFeedback.escalated, input.escalated) : undefined,
      );

      const feedback = await db.query.patientFeedback.findMany({
        where,
        orderBy: desc(patientFeedback.created_at),
        limit: input.limit,
        offset: (input.page - 1) * input.limit,
      });

      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientFeedback)
        .where(where);

      return {
        feedback,
        total: countResult[0]?.count || 0,
      };
    }),

  respondToFeedback: protectedProcedure
    .input(z.object({
      id: z.string(),
      response: z.string(),
    }))
    .mutation(async ({ input }) => {
      const result = await db.update(patientFeedback)
        .set({
          department_response: input.response,
          responded_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(patientFeedback.id, input.id as any))
        .returning();
      return result[0];
    }),

  getFeedbackSummary: protectedProcedure
    .query(async () => {
      const totalResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientFeedback);

      const csatResult = await db
        .select({ avg: sql<number>`avg(rating_score)::float` })
        .from(patientFeedback)
        .where(sql`rating_score IS NOT NULL`);

      const npsResult = await db
        .select({ avg: sql<number>`avg(nps_score)::float` })
        .from(patientFeedback)
        .where(sql`nps_score IS NOT NULL`);

      const escalationsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientFeedback)
        .where(and(
          eq(patientFeedback.escalated, true),
          sql`department_response IS NULL`
        ));

      return {
        total_feedback: totalResult[0]?.count || 0,
        avg_csat_rating: csatResult[0]?.avg || 0,
        avg_nps_score: npsResult[0]?.avg || 0,
        escalations_pending: escalationsResult[0]?.count || 0,
        feedback_by_type: [],
      };
    }),

  // Payments
  listPayments: protectedProcedure
    .input(z.object({
      patient_id: z.string(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const payments = await db.query.patientPayments.findMany({
        where: eq(patientPayments.patient_id, input.patient_id as any),
        orderBy: desc(patientPayments.created_at),
        limit: input.limit,
        offset: (input.page - 1) * input.limit,
      });

      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientPayments)
        .where(eq(patientPayments.patient_id, input.patient_id as any));

      return {
        payments,
        total: countResult[0]?.count || 0,
      };
    }),

  getPaymentSummary: protectedProcedure
    .query(async () => {
      const totalResult = await db
        .select({ sum: sql<string>`sum(amount)::text` })
        .from(patientPayments)
        .where(eq(patientPayments.status, 'success'));

      const successResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientPayments)
        .where(eq(patientPayments.status, 'success'));

      const totalCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(patientPayments);

      const successRate = totalCountResult[0]?.count
        ? Math.round((successResult[0]?.count || 0) / totalCountResult[0].count * 100)
        : 0;

      return {
        total_collected: totalResult[0]?.sum || '0',
        success_rate: successRate.toString(),
        by_method: [],
      };
    }),

  // Pre-Admission Forms
  listForms: protectedProcedure
    .input(z.object({
      patient_id: z.string(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const forms = await db.query.preAdmissionForms.findMany({
        where: and(
          eq(preAdmissionForms.patient_id, input.patient_id as any),
          input.status ? eq(preAdmissionForms.status, input.status as any) : undefined,
        ),
        orderBy: desc(preAdmissionForms.created_at),
      });
      return forms;
    }),

  verifyForm: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const result = await db.update(preAdmissionForms)
        .set({
          status: 'verified',
          verified_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(preAdmissionForms.id, input.id as any))
        .returning();
      return result[0];
    }),

  // Medication Refills
  listRefillRequests: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const refills = await db.query.medicationRefillRequests.findMany({
        where: input.status
          ? eq(medicationRefillRequests.status, input.status as any)
          : undefined,
        orderBy: desc(medicationRefillRequests.requested_at),
        limit: input.limit,
        offset: (input.page - 1) * input.limit,
      });

      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(medicationRefillRequests)
        .where(input.status
          ? eq(medicationRefillRequests.status, input.status as any)
          : undefined
        );

      return {
        refills,
        total: countResult[0]?.count || 0,
      };
    }),

  reviewRefill: protectedProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(['approved', 'denied']),
      pharmacy_feedback: z.string().optional(),
      pickup_location: z.string().optional(),
      pickup_ready_at: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await db.update(medicationRefillRequests)
        .set({
          status: input.status as any,
          pharmacy_feedback: input.pharmacy_feedback,
          pickup_location: input.pickup_location,
          pickup_ready_at: input.pickup_ready_at,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(medicationRefillRequests.id, input.id as any))
        .returning();
      return result[0];
    }),
});
