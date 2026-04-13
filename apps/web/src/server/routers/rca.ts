import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ─── ENUMS AND VALIDATION SCHEMAS ─────────────────────────────────────────

const rcaIncidentTypeEnum = z.enum([
  'near_miss',
  'adverse_event',
  'sentinel_event',
  'medication_error',
  'fall',
  'infection',
  'equipment_failure',
  'surgical_complication',
  'patient_complaint',
]);

const rcaSeverityEnum = z.enum(['minor', 'moderate', 'major', 'catastrophic']);

const rcaInvStatusEnum = z.enum([
  'not_started',
  'timeline_in_progress',
  'timeline_complete',
  'fishbone_in_progress',
  'fishbone_complete',
  'five_why_in_progress',
  'five_why_complete',
  'draft_report',
  'rca_complete',
]);

const rcaTeamRoleEnum = z.enum([
  'quality_head',
  'department_head',
  'clinical_expert',
  'pharmacy',
  'nursing',
  'admin',
  'observer',
]);

const fishboneCategoryEnum = z.enum([
  'people',
  'process',
  'systems',
  'environment',
  'training',
  'communication',
]);

const capaActionTypeEnum = z.enum(['corrective', 'preventive']);

const capaStatusEnum = z.enum([
  'planned',
  'in_progress',
  'implemented',
  'pending_effectiveness_review',
  'effectiveness_verified',
  'ineffective',
  'closed',
]);

const effectivenessReviewStatusEnum = z.enum(['pending', 'effective', 'ineffective']);

// ─── INPUT SCHEMAS ────────────────────────────────────────────────────────

const initiateRcaInput = z.object({
  adverse_event_id: z.string().uuid(),
});

const getRcaInput = z.object({
  rca_id: z.string().uuid(),
});

const listRcasInput = z.object({
  rca_inv_status: rcaInvStatusEnum.optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

const updateRcaStatusInput = z.object({
  rca_id: z.string().uuid(),
  rca_inv_status: rcaInvStatusEnum,
});

const signOffInput = z.object({
  rca_id: z.string().uuid(),
  role: z.enum(['quality_head', 'ceo']),
});

// Team Member procedures
const addTeamMemberInput = z.object({
  rca_id: z.string().uuid(),
  user_id: z.string().uuid(),
  rtm_role: rcaTeamRoleEnum,
});

const removeTeamMemberInput = z.object({
  rtm_id: z.string().uuid(),
});

const listTeamMembersInput = z.object({
  rca_id: z.string().uuid(),
});

// Timeline procedures
const addTimelineEventInput = z.object({
  rca_id: z.string().uuid(),
  event_time: z.string().datetime(),
  event_description: z.string().min(1).max(5000),
  sequence_order: z.number().int().nonnegative(),
  data_source: z.string().max(100),
});

const updateTimelineEventInput = z.object({
  rte_id: z.string().uuid(),
  event_time: z.string().datetime().optional(),
  event_description: z.string().max(5000).optional(),
  sequence_order: z.number().int().nonnegative().optional(),
});

const listTimelineInput = z.object({
  rca_id: z.string().uuid(),
});

// Fishbone procedures
const addFishboneFactorInput = z.object({
  rca_id: z.string().uuid(),
  rff_category: fishboneCategoryEnum,
  factor_description: z.string().min(1).max(5000),
  is_contributing_factor: z.boolean().default(false),
});

const updateFishboneFactorInput = z.object({
  rff_id: z.string().uuid(),
  factor_description: z.string().max(5000).optional(),
  is_contributing_factor: z.boolean().optional(),
});

const getFishboneInput = z.object({
  rca_id: z.string().uuid(),
});

// Five Why procedures
const addFiveWhyInput = z.object({
  rca_id: z.string().uuid(),
  question_sequence: z.number().int().nonnegative(),
  rfw_question: z.string().min(1).max(2000),
  rfw_answer: z.string().min(1).max(5000),
  contributing_factor: z.string().max(2000).optional(),
  is_root_cause: z.boolean().default(false),
});

const updateFiveWhyInput = z.object({
  rfw_id: z.string().uuid(),
  rfw_question: z.string().max(2000).optional(),
  rfw_answer: z.string().max(5000).optional(),
  contributing_factor: z.string().max(2000).optional(),
  is_root_cause: z.boolean().optional(),
});

const getFiveWhyChainInput = z.object({
  rca_id: z.string().uuid(),
});

// CAPA procedures
const addCapaItemInput = z.object({
  rca_id: z.string().uuid(),
  action_description: z.string().min(1).max(5000),
  action_type: capaActionTypeEnum,
  responsible_user_id: z.string().uuid(),
  target_implementation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateCapaStatusInput = z.object({
  rci_id: z.string().uuid(),
  capa_status: capaStatusEnum,
  implementation_notes: z.string().max(5000).optional(),
});

const updateCapaProgressInput = z.object({
  rci_id: z.string().uuid(),
  completion_estimate_percent: z.number().int().min(0).max(100),
});

const addEffectivenessReviewInput = z.object({
  rci_id: z.string().uuid(),
  effectiveness_review_status: effectivenessReviewStatusEnum,
  effectiveness_evidence: z.string().max(5000),
});

const listCapaItemsInput = z.object({
  rca_id: z.string().uuid().optional(),
  capa_status: capaStatusEnum.optional(),
  responsible_user_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});

// Analytics
const rcaDashboardInput = z.object({
  hospital_id: z.string().optional(),
});

const rcaOverdueAlertsInput = z.object({
  hospital_id: z.string().optional(),
});

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────

async function getRcaWithDetails(hospitalId: string, rcaId: string) {
  const rcaResult = await getSql()`
    SELECT * FROM rca_investigations
    WHERE id = ${rcaId} AND hospital_id = ${hospitalId};
  `;

  const rcaRows = (rcaResult as any);
  if (!rcaRows || rcaRows.length === 0) {
    return null;
  }

  const rca = rcaRows[0];

  // Get team members with user details
  const teamResult = await getSql()`
    SELECT rtm.*, u.email, u.full_name
    FROM rca_team_members rtm
    LEFT JOIN users u ON rtm.rtm_user_id = u.id
    WHERE rtm.rtm_rca_id = ${rcaId} AND rtm.hospital_id = ${hospitalId}
    ORDER BY rtm.rtm_added_at;
  `;

  const timeline = await getSql()`
    SELECT * FROM rca_timeline_events
    WHERE rte_rca_id = ${rcaId} AND hospital_id = ${hospitalId}
    ORDER BY sequence_order ASC;
  `;

  const fishbone = await getSql()`
    SELECT * FROM rca_fishbone_factors
    WHERE rff_rca_id = ${rcaId} AND hospital_id = ${hospitalId}
    ORDER BY rff_category, rff_added_at;
  `;

  const fiveWhy = await getSql()`
    SELECT * FROM rca_five_why
    WHERE rfw_rca_id = ${rcaId} AND hospital_id = ${hospitalId}
    ORDER BY question_sequence ASC;
  `;

  const capaItems = await getSql()`
    SELECT rci.*, u.email, u.full_name
    FROM rca_capa_items rci
    LEFT JOIN users u ON rci.responsible_user_id = u.id
    WHERE rci.rci_rca_id = ${rcaId} AND rci.hospital_id = ${hospitalId}
    ORDER BY rci.rci_created_at;
  `;

  return {
    ...rca,
    team: (teamResult as any) || [],
    timeline: (timeline as any) || [],
    fishbone: (fishbone as any) || [],
    fiveWhy: (fiveWhy as any) || [],
    capaItems: (capaItems as any) || [],
  };
}

// ─── ROUTER ────────────────────────────────────────────────────────────────

export const rcaRouter = router({
  // ─── RCA INVESTIGATIONS ────────────────────────────────────────────────────

  initiateRca: adminProcedure
    .input(initiateRcaInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Get adverse event details
        const aeResult = await getSql()`
          SELECT * FROM adverse_events
          WHERE id = ${input.adverse_event_id} AND hospital_id = ${hospitalId};
        `;

        const aeRows = (aeResult as any);
        if (!aeRows || aeRows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Adverse event not found',
          });
        }

        const adverseEvent = aeRows[0];

        // Check if RCA already exists for this adverse event
        if (adverseEvent.has_rca) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'RCA already initiated for this adverse event',
          });
        }

        // Calculate deadline (45 days from now)
        const now = new Date();
        const deadline = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

        // Create RCA investigation
        const rcaResult = await getSql()`
          INSERT INTO rca_investigations (
            hospital_id, adverse_event_id, rca_incident_type, rca_severity,
            rca_incident_date, rca_inv_status, investigation_start_date,
            investigation_deadline, rca_created_at, rca_updated_at
          )
          VALUES (
            ${hospitalId}, ${input.adverse_event_id}, ${adverseEvent.incident_type}, ${adverseEvent.ae_severity},
            ${adverseEvent.incident_date}, 'not_started', NOW(),
            ${deadline.toISOString()}, NOW(), NOW()
          )
          RETURNING *;
        `;

        const rcaRows = (rcaResult as any);
        if (!rcaRows || rcaRows.length === 0) {
          throw new Error('Failed to create RCA investigation');
        }

        const rca = rcaRows[0];

        // Update adverse event with RCA reference
        await getSql()`
          UPDATE adverse_events
          SET has_rca = true, rca_id = ${rca.id}
          WHERE id = ${input.adverse_event_id} AND hospital_id = ${hospitalId};
        `;

        return { success: true, rca };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to initiate RCA: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  getRca: protectedProcedure
    .input(getRcaInput)
    .query(async ({ ctx, input }) => {
      try {
        const rca = await getRcaWithDetails(ctx.user.hospital_id, input.rca_id);
        if (!rca) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'RCA not found' });
        }
        return rca;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch RCA: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listRcas: protectedProcedure
    .input(listRcasInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const statusVal = input.rca_inv_status ?? null;
        const dateFrom = input.date_from ?? null;
        const dateTo = input.date_to ?? null;

        const result = await getSql()`
          SELECT
            ri.*,
            ae.incident_description,
            EXTRACT(DAY FROM (ri.investigation_deadline - NOW()))::int as days_remaining
          FROM rca_investigations ri
          LEFT JOIN adverse_events ae ON ri.adverse_event_id = ae.id
          WHERE ri.hospital_id = ${hospitalId}
            AND (${statusVal}::rca_status IS NULL OR ri.rca_inv_status = ${statusVal}::rca_status)
            AND (${dateFrom}::timestamptz IS NULL OR ri.investigation_start_date >= ${dateFrom}::timestamptz)
            AND (${dateTo}::timestamptz IS NULL OR ri.investigation_start_date <= ${dateTo}::timestamptz)
          ORDER BY ri.investigation_start_date DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const countResult = await getSql()`
          SELECT COUNT(*) as total
          FROM rca_investigations ri
          WHERE ri.hospital_id = ${hospitalId}
            AND (${statusVal}::rca_status IS NULL OR ri.rca_inv_status = ${statusVal}::rca_status)
            AND (${dateFrom}::timestamptz IS NULL OR ri.investigation_start_date >= ${dateFrom}::timestamptz)
            AND (${dateTo}::timestamptz IS NULL OR ri.investigation_start_date <= ${dateTo}::timestamptz);
        `;

        return {
          items: (result as any) || [],
          total: ((countResult as any)[0]?.total || 0),
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list RCAs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateRcaStatus: adminProcedure
    .input(updateRcaStatusInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          UPDATE rca_investigations
          SET rca_inv_status = ${input.rca_inv_status}, rca_updated_at = NOW()
          WHERE id = ${input.rca_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'RCA not found' });
        }

        return { success: true, rca: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update RCA status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  signOff: adminProcedure
    .input(signOffInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const rca = await getSql()`
          SELECT * FROM rca_investigations
          WHERE id = ${input.rca_id} AND hospital_id = ${hospitalId};
        `;

        const rcaRows = (rca as any);
        if (!rcaRows || rcaRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'RCA not found' });
        }

        const isQualityHead = input.role === 'quality_head';

        const result = await getSql()`
          UPDATE rca_investigations
          SET
            signed_by_quality_head_at = CASE WHEN ${isQualityHead} THEN NOW() ELSE signed_by_quality_head_at END,
            signed_by_ceo_at = CASE WHEN ${!isQualityHead} THEN NOW() ELSE signed_by_ceo_at END
          WHERE id = ${input.rca_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        return { success: true, rca: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to sign off: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── TEAM MEMBERS ──────────────────────────────────────────────────────────

  addTeamMember: protectedProcedure
    .input(addTeamMemberInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Verify RCA exists
        const rca = await getSql()`
          SELECT id FROM rca_investigations
          WHERE id = ${input.rca_id} AND hospital_id = ${hospitalId};
        `;

        const rcaRows = (rca as any);
        if (!rcaRows || rcaRows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'RCA not found' });
        }

        const result = await getSql()`
          INSERT INTO rca_team_members (
            hospital_id, rtm_rca_id, rtm_user_id, rtm_role, rtm_added_at,
            rtm_added_by_user_id
          )
          VALUES (${hospitalId}, ${input.rca_id}, ${input.user_id}, ${input.rtm_role}, NOW(), ${ctx.user.sub})
          RETURNING *;
        `;

        const rows = (result as any);
        return { success: true, teamMember: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add team member: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  removeTeamMember: protectedProcedure
    .input(removeTeamMemberInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          DELETE FROM rca_team_members
          WHERE id = ${input.rtm_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Team member not found' });
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to remove team member: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listTeamMembers: protectedProcedure
    .input(listTeamMembersInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT rtm.*, u.email, u.full_name
          FROM rca_team_members rtm
          LEFT JOIN users u ON rtm.rtm_user_id = u.id
          WHERE rtm.rtm_rca_id = ${input.rca_id} AND rtm.hospital_id = ${hospitalId}
          ORDER BY rtm.rtm_added_at;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list team members: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── TIMELINE EVENTS ───────────────────────────────────────────────────────

  addTimelineEvent: protectedProcedure
    .input(addTimelineEventInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          INSERT INTO rca_timeline_events (
            hospital_id, rte_rca_id, event_time, event_description,
            sequence_order, data_source, rte_added_by_user_id, rte_added_at
          )
          VALUES (
            ${hospitalId}, ${input.rca_id}, ${input.event_time}, ${input.event_description},
            ${input.sequence_order}, ${input.data_source}, ${ctx.user.sub}, NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        return { success: true, event: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add timeline event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateTimelineEvent: protectedProcedure
    .input(updateTimelineEventInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const eventTime = input.event_time ?? null;
        const eventDesc = input.event_description ?? null;
        const seqOrder = input.sequence_order ?? null;

        const result = await getSql()`
          UPDATE rca_timeline_events
          SET
            event_time = COALESCE(${eventTime}::timestamptz, event_time),
            event_description = COALESCE(${eventDesc}::text, event_description),
            sequence_order = COALESCE(${seqOrder}::int, sequence_order),
            rte_added_at = NOW()
          WHERE id = ${input.rte_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Timeline event not found' });
        }

        return { success: true, event: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update timeline event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listTimeline: protectedProcedure
    .input(listTimelineInput)
    .query(async ({ ctx, input }) => {
      try {
        const result = await getSql()`
          SELECT * FROM rca_timeline_events
          WHERE rte_rca_id = ${input.rca_id} AND hospital_id = ${ctx.user.hospital_id}
          ORDER BY sequence_order ASC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list timeline events: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── FISHBONE ANALYSIS ────────────────────────────────────────────────────

  addFishboneFactor: protectedProcedure
    .input(addFishboneFactorInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          INSERT INTO rca_fishbone_factors (
            hospital_id, rff_rca_id, rff_category, factor_description,
            is_contributing_factor, rff_added_by_user_id, rff_added_at
          )
          VALUES (
            ${hospitalId}, ${input.rca_id}, ${input.rff_category}, ${input.factor_description},
            ${input.is_contributing_factor}, ${ctx.user.sub}, NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        return { success: true, factor: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add fishbone factor: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateFishboneFactor: protectedProcedure
    .input(updateFishboneFactorInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const factorDesc = input.factor_description ?? null;
        const isContributing = input.is_contributing_factor ?? null;

        const result = await getSql()`
          UPDATE rca_fishbone_factors
          SET
            factor_description = COALESCE(${factorDesc}::text, factor_description),
            is_contributing_factor = COALESCE(${isContributing}::boolean, is_contributing_factor)
          WHERE id = ${input.rff_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Fishbone factor not found' });
        }

        return { success: true, factor: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update fishbone factor: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  getFishbone: protectedProcedure
    .input(getFishboneInput)
    .query(async ({ ctx, input }) => {
      try {
        const result = await getSql()`
          SELECT * FROM rca_fishbone_factors
          WHERE rff_rca_id = ${input.rca_id} AND hospital_id = ${ctx.user.hospital_id}
          ORDER BY rff_category, rff_added_at;
        `;

        const factors = (result as any) || [];

        // Group by category
        const grouped: Record<string, any[]> = {};
        factors.forEach((f: any) => {
          if (!grouped[f.rff_category]) grouped[f.rff_category] = [];
          grouped[f.rff_category].push(f);
        });

        return grouped;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get fishbone factors: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── FIVE WHY ANALYSIS ─────────────────────────────────────────────────────

  addFiveWhy: protectedProcedure
    .input(addFiveWhyInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          INSERT INTO rca_five_why (
            hospital_id, rfw_rca_id, question_sequence, rfw_question,
            rfw_answer, contributing_factor, is_root_cause, rfw_added_by_user_id, rfw_added_at
          )
          VALUES (
            ${hospitalId}, ${input.rca_id}, ${input.question_sequence}, ${input.rfw_question},
            ${input.rfw_answer}, ${input.contributing_factor || null}, ${input.is_root_cause}, ${ctx.user.sub}, NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        return { success: true, item: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add Five Why item: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateFiveWhy: protectedProcedure
    .input(updateFiveWhyInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const question = input.rfw_question ?? null;
        const answer = input.rfw_answer ?? null;
        const contribFactor = input.contributing_factor ?? null;
        const isRoot = input.is_root_cause ?? null;

        const result = await getSql()`
          UPDATE rca_five_why
          SET
            rfw_question = COALESCE(${question}::text, rfw_question),
            rfw_answer = COALESCE(${answer}::text, rfw_answer),
            contributing_factor = COALESCE(${contribFactor}::text, contributing_factor),
            is_root_cause = COALESCE(${isRoot}::boolean, is_root_cause)
          WHERE id = ${input.rfw_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Five Why item not found' });
        }

        return { success: true, item: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update Five Why item: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  getFiveWhyChain: protectedProcedure
    .input(getFiveWhyChainInput)
    .query(async ({ ctx, input }) => {
      try {
        const result = await getSql()`
          SELECT * FROM rca_five_why
          WHERE rfw_rca_id = ${input.rca_id} AND hospital_id = ${ctx.user.hospital_id}
          ORDER BY question_sequence ASC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get Five Why chain: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── CAPA ITEMS ────────────────────────────────────────────────────────────

  addCapaItem: protectedProcedure
    .input(addCapaItemInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          INSERT INTO rca_capa_items (
            hospital_id, rci_rca_id, action_description, action_type,
            responsible_user_id, rci_assigned_at, rci_assigned_by_user_id,
            target_implementation_date, capa_status, completion_estimate_percent,
            rci_created_at, rci_updated_at
          )
          VALUES (
            ${hospitalId}, ${input.rca_id}, ${input.action_description}, ${input.action_type},
            ${input.responsible_user_id}, NOW(), ${ctx.user.sub},
            ${input.target_implementation_date}, 'planned', 0,
            NOW(), NOW()
          )
          RETURNING *;
        `;

        const rows = (result as any);
        return { success: true, item: rows[0] };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add CAPA item: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateCapaStatus: protectedProcedure
    .input(updateCapaStatusInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const isImplemented = input.capa_status === 'implemented';

        const result = await getSql()`
          UPDATE rca_capa_items
          SET
            capa_status = ${input.capa_status}::capa_status,
            implementation_notes = COALESCE(${input.implementation_notes || null}::text, implementation_notes),
            capa_status_updated_at = NOW(),
            capa_updated_by_user_id = ${ctx.user.sub},
            effectiveness_review_due_at = CASE WHEN ${isImplemented} THEN NOW() + INTERVAL '30 days' ELSE effectiveness_review_due_at END,
            implemented_at = CASE WHEN ${isImplemented} THEN NOW() ELSE implemented_at END,
            rci_updated_at = NOW()
          WHERE id = ${input.rci_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'CAPA item not found' });
        }

        return { success: true, item: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update CAPA status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  updateCapaProgress: protectedProcedure
    .input(updateCapaProgressInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          UPDATE rca_capa_items
          SET completion_estimate_percent = ${input.completion_estimate_percent}, rci_updated_at = NOW()
          WHERE id = ${input.rci_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'CAPA item not found' });
        }

        return { success: true, item: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update CAPA progress: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  addEffectivenessReview: protectedProcedure
    .input(addEffectivenessReviewInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          UPDATE rca_capa_items
          SET
            effectiveness_review_status = ${input.effectiveness_review_status},
            effectiveness_evidence = ${input.effectiveness_evidence},
            effectiveness_reviewed_by_user_id = ${ctx.user.sub},
            effectiveness_reviewed_at = NOW(),
            rci_updated_at = NOW()
          WHERE id = ${input.rci_id} AND hospital_id = ${hospitalId}
          RETURNING *;
        `;

        const rows = (result as any);
        if (!rows || rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'CAPA item not found' });
        }

        return { success: true, item: rows[0] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to add effectiveness review: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  listCapaItems: protectedProcedure
    .input(listCapaItemsInput)
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const rcaIdVal = input.rca_id ?? null;
        const capaStatusVal = input.capa_status ?? null;
        const responsibleVal = input.responsible_user_id ?? null;

        const result = await getSql()`
          SELECT rci.*, u.email, u.full_name
          FROM rca_capa_items rci
          LEFT JOIN users u ON rci.responsible_user_id = u.id
          WHERE rci.hospital_id = ${hospitalId}
            AND (${rcaIdVal}::uuid IS NULL OR rci.rci_rca_id = ${rcaIdVal}::uuid)
            AND (${capaStatusVal}::capa_status IS NULL OR rci.capa_status = ${capaStatusVal}::capa_status)
            AND (${responsibleVal}::uuid IS NULL OR rci.responsible_user_id = ${responsibleVal}::uuid)
          ORDER BY rci.rci_created_at DESC
          LIMIT ${input.limit} OFFSET ${input.offset};
        `;

        const countResult = await getSql()`
          SELECT COUNT(*) as total
          FROM rca_capa_items rci
          WHERE rci.hospital_id = ${hospitalId}
            AND (${rcaIdVal}::uuid IS NULL OR rci.rci_rca_id = ${rcaIdVal}::uuid)
            AND (${capaStatusVal}::capa_status IS NULL OR rci.capa_status = ${capaStatusVal}::capa_status)
            AND (${responsibleVal}::uuid IS NULL OR rci.responsible_user_id = ${responsibleVal}::uuid);
        `;

        return {
          items: (result as any) || [],
          total: ((countResult as any)[0]?.total || 0),
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list CAPA items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // ─── ANALYTICS ─────────────────────────────────────────────────────────────

  rcaDashboard: protectedProcedure
    .input(rcaDashboardInput)
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Open RCAs
        const openResult = await getSql()`
          SELECT COUNT(*) as count
          FROM rca_investigations
          WHERE hospital_id = ${hospitalId}
          AND rca_inv_status NOT IN ('rca_complete');
        `;

        // Overdue RCAs
        const overdueResult = await getSql()`
          SELECT COUNT(*) as count
          FROM rca_investigations
          WHERE hospital_id = ${hospitalId}
          AND investigation_deadline < NOW()
          AND rca_inv_status NOT IN ('rca_complete');
        `;

        // Average days to complete
        const avgResult = await getSql()`
          SELECT AVG(EXTRACT(DAY FROM (rca_completed_at - investigation_start_date))) as avg_days
          FROM rca_investigations
          WHERE hospital_id = ${hospitalId}
          AND rca_inv_status = 'rca_complete';
        `;

        // CAPA status distribution
        const capaStatusResult = await getSql()`
          SELECT capa_status, COUNT(*) as count
          FROM rca_capa_items
          WHERE hospital_id = ${hospitalId}
          GROUP BY capa_status;
        `;

        return {
          openRcas: ((openResult as any)[0]?.count || 0),
          overdueRcas: ((overdueResult as any)[0]?.count || 0),
          avgDaysToComplete: Math.round((((avgResult as any)[0]?.avg_days || 0))),
          capaStatusDistribution: (capaStatusResult as any) || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch RCA dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  rcaOverdueAlerts: protectedProcedure
    .input(rcaOverdueAlertsInput)
    .query(async ({ ctx }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const result = await getSql()`
          SELECT
            ri.*,
            ae.incident_description,
            EXTRACT(DAY FROM (NOW() - ri.investigation_deadline))::int as days_overdue
          FROM rca_investigations ri
          LEFT JOIN adverse_events ae ON ri.adverse_event_id = ae.id
          WHERE ri.hospital_id = ${hospitalId}
          AND ri.investigation_deadline < NOW()
          AND ri.rca_inv_status NOT IN ('rca_complete')
          ORDER BY ri.investigation_deadline ASC;
        `;

        return (result as any) || [];
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch overdue alerts: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),
});
