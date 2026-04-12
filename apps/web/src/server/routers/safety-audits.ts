import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';

const sql = neon(process.env.DATABASE_URL!);

// ─── ENUMS ───────────────────────────────────────────────────────
const safetyRoundStatusEnum = z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']);
const findingSeverityEnum = z.enum(['minor', 'major']);
const findingStatusEnum = z.enum(['open', 'in_progress', 'closed']);
const auditTypeEnum = z.enum(['concurrent', 'retrospective']);
const clinicalAuditStatusEnum = z.enum(['scheduled', 'in_progress', 'completed']);
const auditFindingStatusEnum = z.enum(['open', 'closed']);
const complaintSeverityEnum = z.enum(['minor', 'moderate', 'major']);
const complaintStatusEnum = z.enum(['open', 'acknowledged', 'in_progress', 'resolved', 'escalated', 'closed']);
const indicatorFrequencyEnum = z.enum(['daily', 'weekly', 'monthly', 'quarterly']);
const indicatorDataSourceEnum = z.enum(['auto_computed', 'manual_entry', 'hybrid']);
const definitionStatusEnum = z.enum(['assumed', 'confirmed', 'not_applicable']);

// ════════════════════════════════════════════════════════════════════
// QUALITY INDICATOR DEFINITIONS (5 endpoints)
// ════════════════════════════════════════════════════════════════════

const createDefinitionInput = z.object({
  qid_indicator_id: z.string().min(1).max(20),
  indicator_name: z.string().min(1).max(255),
  qid_nabh_chapter: z.string().min(1).max(50),
  qid_department: z.string().min(1).max(100),
  numerator_query: z.string().min(1),
  denominator_query: z.string().min(1),
  target_value: z.number().nonnegative(),
  qid_frequency: indicatorFrequencyEnum,
  qid_data_source: indicatorDataSourceEnum,
  qid_notes: z.string().optional(),
});

const updateDefinitionInput = z.object({
  id: z.string().uuid(),
  indicator_name: z.string().max(255).optional(),
  target_value: z.number().nonnegative().optional(),
  qid_notes: z.string().optional(),
});

// ─── CREATE DEFINITION ───────────────────────────────────────────────
const createDefinition = adminProcedure
  .input(createDefinitionInput)
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        INSERT INTO quality_indicator_definitions (
          hospital_id, qid_indicator_id, indicator_name,
          qid_nabh_chapter, qid_department,
          numerator_query, denominator_query,
          target_value, qid_frequency, qid_data_source,
          definition_status, definition_authored_by_user_id, definition_authored_at,
          qid_notes, qid_created_at, qid_updated_at
        )
        VALUES (
          ${hospitalId}, ${input.qid_indicator_id}, ${input.indicator_name},
          ${input.qid_nabh_chapter}, ${input.qid_department},
          ${input.numerator_query}, ${input.denominator_query},
          ${input.target_value}, ${input.qid_frequency}, ${input.qid_data_source},
          'assumed', ${userId}, NOW(),
          ${input.qid_notes || null}, NOW(), NOW()
        )
        RETURNING id, qid_indicator_id, indicator_name, definition_status, qid_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create quality indicator definition',
        });
      }

      return {
        id: rows[0].id,
        qid_indicator_id: rows[0].qid_indicator_id,
        indicator_name: rows[0].indicator_name,
        definition_status: rows[0].definition_status,
        created_at: rows[0].qid_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error creating quality indicator definition',
      });
    }
  });

// ─── GET DEFINITION ──────────────────────────────────────────────────
const getDefinition = adminProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        SELECT
          id, hospital_id, qid_indicator_id, indicator_name,
          qid_nabh_chapter, qid_department,
          numerator_query, denominator_query,
          target_value, qid_frequency, qid_data_source,
          definition_status, definition_authored_by_user_id, definition_authored_at,
          definition_confirmed_by_user_id, definition_confirmed_at,
          qid_notes, qid_created_at, qid_updated_at
        FROM quality_indicator_definitions
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        LIMIT 1;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Quality indicator definition not found',
        });
      }

      return rows[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching quality indicator definition',
      });
    }
  });

// ─── LIST DEFINITIONS ────────────────────────────────────────────────
const listDefinitions = adminProcedure
  .input(z.object({
    nabh_chapter: z.string().optional(),
    department: z.string().optional(),
    data_source: indicatorDataSourceEnum.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.pageSize;

      // Count total
      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM quality_indicator_definitions
        WHERE hospital_id = ${hospitalId}
          AND (${input.nabh_chapter ?? null}::text IS NULL OR qid_nabh_chapter = ${input.nabh_chapter ?? null})
          AND (${input.department ?? null}::text IS NULL OR qid_department = ${input.department ?? null})
          AND (${input.data_source ?? null}::text IS NULL OR qid_data_source = ${input.data_source ?? null});
      `;

      const countRows = (countResult as any);
      const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

      // Fetch records
      const result = await sql`
        SELECT
          id, qid_indicator_id, indicator_name,
          qid_nabh_chapter, qid_department,
          target_value, qid_frequency, qid_data_source,
          definition_status, definition_authored_at,
          definition_confirmed_at, qid_notes, qid_created_at
        FROM quality_indicator_definitions
        WHERE hospital_id = ${hospitalId}
          AND (${input.nabh_chapter ?? null}::text IS NULL OR qid_nabh_chapter = ${input.nabh_chapter ?? null})
          AND (${input.department ?? null}::text IS NULL OR qid_department = ${input.department ?? null})
          AND (${input.data_source ?? null}::text IS NULL OR qid_data_source = ${input.data_source ?? null})
        ORDER BY qid_created_at DESC
        LIMIT ${input.pageSize} OFFSET ${offset};
      `;

      const rows = (result as any) || [];

      return {
        data: rows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing quality indicator definitions',
      });
    }
  });

// ─── UPDATE DEFINITION ───────────────────────────────────────────────
const updateDefinition = adminProcedure
  .input(updateDefinitionInput)
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE quality_indicator_definitions
        SET
          indicator_name = COALESCE(${input.indicator_name ?? null}::varchar, indicator_name),
          target_value = COALESCE(${input.target_value ?? null}::numeric, target_value),
          qid_notes = COALESCE(${input.qid_notes ?? null}::text, qid_notes),
          qid_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, indicator_name, target_value, qid_updated_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Quality indicator definition not found',
        });
      }

      return {
        id: rows[0].id,
        indicator_name: rows[0].indicator_name,
        target_value: rows[0].target_value,
        updated_at: rows[0].qid_updated_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error updating quality indicator definition',
      });
    }
  });

// ─── CONFIRM DEFINITION ──────────────────────────────────────────────
const confirmDefinition = adminProcedure
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        UPDATE quality_indicator_definitions
        SET
          definition_status = 'confirmed',
          definition_confirmed_by_user_id = ${userId},
          definition_confirmed_at = NOW(),
          qid_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, definition_status, definition_confirmed_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Quality indicator definition not found',
        });
      }

      return {
        id: rows[0].id,
        definition_status: rows[0].definition_status,
        confirmed_at: rows[0].definition_confirmed_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error confirming quality indicator definition',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// SAFETY ROUNDS (6 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── SCHEDULE ROUND ──────────────────────────────────────────────────
const scheduleRound = protectedProcedure
  .input(z.object({
    sr_department: z.string().min(1).max(100),
    scheduled_date: z.string().datetime(),
    template_name: z.string().min(1).max(255),
    sr_assigned_to_user_id: z.string().uuid().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        INSERT INTO safety_rounds (
          hospital_id, sr_department, scheduled_date, template_name,
          sr_assigned_to_user_id, sr_status, sr_created_at
        )
        VALUES (
          ${hospitalId}, ${input.sr_department}, ${input.scheduled_date}::timestamptz,
          ${input.template_name}, ${input.sr_assigned_to_user_id || null}::uuid,
          'scheduled', NOW()
        )
        RETURNING id, sr_department, scheduled_date, sr_status, sr_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to schedule safety round',
        });
      }

      return {
        id: rows[0].id,
        sr_department: rows[0].sr_department,
        sr_status: rows[0].sr_status,
        created_at: rows[0].sr_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error scheduling safety round',
      });
    }
  });

// ─── LIST ROUNDS ─────────────────────────────────────────────────────
const listRounds = protectedProcedure
  .input(z.object({
    department: z.string().optional(),
    status: safetyRoundStatusEnum.optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.pageSize;

      // Count total
      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM safety_rounds
        WHERE hospital_id = ${hospitalId}
          AND (${input.department ?? null}::text IS NULL OR sr_department = ${input.department ?? null})
          AND (${input.status ?? null}::text IS NULL OR sr_status = ${input.status ?? null})
          AND (${input.date_from ?? null}::timestamptz IS NULL OR scheduled_date >= ${input.date_from ?? null}::timestamptz)
          AND (${input.date_to ?? null}::timestamptz IS NULL OR scheduled_date <= ${input.date_to ?? null}::timestamptz);
      `;

      const countRows = (countResult as any);
      const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

      // Fetch records with findings count
      const result = await sql`
        SELECT
          sr.id, sr.sr_department, sr.scheduled_date, sr.template_name,
          sr.sr_status, sr.sr_completed_at, sr.sr_notes, sr.sr_created_at,
          COUNT(srf.id)::int as findings_count
        FROM safety_rounds sr
        LEFT JOIN safety_round_findings srf ON sr.id = srf.srf_safety_round_id
        WHERE sr.hospital_id = ${hospitalId}
          AND (${input.department ?? null}::text IS NULL OR sr.sr_department = ${input.department ?? null})
          AND (${input.status ?? null}::text IS NULL OR sr.sr_status = ${input.status ?? null})
          AND (${input.date_from ?? null}::timestamptz IS NULL OR sr.scheduled_date >= ${input.date_from ?? null}::timestamptz)
          AND (${input.date_to ?? null}::timestamptz IS NULL OR sr.scheduled_date <= ${input.date_to ?? null}::timestamptz)
        GROUP BY sr.id
        ORDER BY sr.scheduled_date DESC
        LIMIT ${input.pageSize} OFFSET ${offset};
      `;

      const rows = (result as any) || [];

      return {
        data: rows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing safety rounds',
      });
    }
  });

// ─── GET ROUND ───────────────────────────────────────────────────────
const getRound = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        SELECT
          sr.id, sr.hospital_id, sr.sr_department, sr.scheduled_date, sr.template_name,
          sr.sr_assigned_to_user_id, sr.sr_status, sr.sr_completed_at,
          sr.sr_completed_by_user_id, sr.sr_notes, sr.sr_created_at,
          COUNT(srf.id)::int as findings_count
        FROM safety_rounds sr
        LEFT JOIN safety_round_findings srf ON sr.id = srf.srf_safety_round_id
        WHERE sr.id = ${input.id}::uuid AND sr.hospital_id = ${hospitalId}
        GROUP BY sr.id
        LIMIT 1;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round not found',
        });
      }

      return rows[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching safety round',
      });
    }
  });

// ─── START ROUND ─────────────────────────────────────────────────────
const startRound = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE safety_rounds
        SET sr_status = 'in_progress'
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, sr_status;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round not found',
        });
      }

      return {
        id: rows[0].id,
        sr_status: rows[0].sr_status,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error starting safety round',
      });
    }
  });

// ─── COMPLETE ROUND ──────────────────────────────────────────────────
const completeRound = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    sr_notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        UPDATE safety_rounds
        SET
          sr_status = 'completed',
          sr_completed_at = NOW(),
          sr_completed_by_user_id = ${userId},
          sr_notes = COALESCE(${input.sr_notes ?? null}::text, sr_notes)
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, sr_status, sr_completed_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round not found',
        });
      }

      return {
        id: rows[0].id,
        sr_status: rows[0].sr_status,
        completed_at: rows[0].sr_completed_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error completing safety round',
      });
    }
  });

// ─── CANCEL ROUND ────────────────────────────────────────────────────
const cancelRound = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE safety_rounds
        SET sr_status = 'cancelled'
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, sr_status;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round not found',
        });
      }

      return {
        id: rows[0].id,
        sr_status: rows[0].sr_status,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error cancelling safety round',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// SAFETY ROUND FINDINGS (4 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── ADD FINDING ─────────────────────────────────────────────────────
const addFinding = protectedProcedure
  .input(z.object({
    srf_safety_round_id: z.string().uuid(),
    checklist_item: z.string().min(1).max(255),
    finding_description: z.string().min(1),
    srf_severity: findingSeverityEnum,
    photo_attachment_url: z.string().url().optional(),
    target_closure_date: z.string().date(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        INSERT INTO safety_round_findings (
          hospital_id, srf_safety_round_id, checklist_item,
          finding_description, srf_severity, photo_attachment_url,
          srf_assigned_by_user_id, target_closure_date,
          srf_status, srf_created_at, srf_updated_at
        )
        VALUES (
          ${hospitalId}, ${input.srf_safety_round_id}::uuid, ${input.checklist_item},
          ${input.finding_description}, ${input.srf_severity}, ${input.photo_attachment_url || null},
          ${userId}, ${input.target_closure_date}::date,
          'open', NOW(), NOW()
        )
        RETURNING id, checklist_item, srf_severity, srf_status, srf_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add safety round finding',
        });
      }

      return {
        id: rows[0].id,
        checklist_item: rows[0].checklist_item,
        srf_severity: rows[0].srf_severity,
        srf_status: rows[0].srf_status,
        created_at: rows[0].srf_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error adding safety round finding',
      });
    }
  });

// ─── UPDATE FINDING ──────────────────────────────────────────────────
const updateFinding = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    srf_severity: findingSeverityEnum.optional(),
    srf_status: findingStatusEnum.optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE safety_round_findings
        SET
          srf_severity = COALESCE(${input.srf_severity ?? null}::text, srf_severity),
          srf_status = COALESCE(${input.srf_status ?? null}::text, srf_status),
          srf_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, srf_severity, srf_status, srf_updated_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round finding not found',
        });
      }

      return {
        id: rows[0].id,
        srf_severity: rows[0].srf_severity,
        srf_status: rows[0].srf_status,
        updated_at: rows[0].srf_updated_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error updating safety round finding',
      });
    }
  });

// ─── CLOSE FINDING ───────────────────────────────────────────────────
const closeFinding = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    closure_notes: z.string().optional(),
    closure_evidence_url: z.string().url().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        UPDATE safety_round_findings
        SET
          srf_status = 'closed',
          srf_closed_at = NOW(),
          srf_closed_by_user_id = ${userId},
          closure_notes = COALESCE(${input.closure_notes ?? null}::text, closure_notes),
          closure_evidence_url = COALESCE(${input.closure_evidence_url ?? null}::text, closure_evidence_url),
          srf_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, srf_status, srf_closed_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round finding not found',
        });
      }

      return {
        id: rows[0].id,
        srf_status: rows[0].srf_status,
        closed_at: rows[0].srf_closed_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error closing safety round finding',
      });
    }
  });

// ─── LIST FINDINGS ───────────────────────────────────────────────────
const listFindings = protectedProcedure
  .input(z.object({
    srf_safety_round_id: z.string().uuid(),
    srf_status: findingStatusEnum.optional(),
    srf_severity: findingSeverityEnum.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.pageSize;

      // Count total
      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM safety_round_findings
        WHERE hospital_id = ${hospitalId}
          AND srf_safety_round_id = ${input.srf_safety_round_id}::uuid
          AND (${input.srf_status ?? null}::text IS NULL OR srf_status = ${input.srf_status ?? null})
          AND (${input.srf_severity ?? null}::text IS NULL OR srf_severity = ${input.srf_severity ?? null});
      `;

      const countRows = (countResult as any);
      const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

      // Fetch records
      const result = await sql`
        SELECT
          id, checklist_item, finding_description, srf_severity,
          photo_attachment_url, target_closure_date, srf_status,
          closure_notes, srf_closed_at, srf_created_at
        FROM safety_round_findings
        WHERE hospital_id = ${hospitalId}
          AND srf_safety_round_id = ${input.srf_safety_round_id}::uuid
          AND (${input.srf_status ?? null}::text IS NULL OR srf_status = ${input.srf_status ?? null})
          AND (${input.srf_severity ?? null}::text IS NULL OR srf_severity = ${input.srf_severity ?? null})
        ORDER BY srf_created_at DESC
        LIMIT ${input.pageSize} OFFSET ${offset};
      `;

      const rows = (result as any) || [];

      return {
        data: rows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing safety round findings',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// SAFETY ROUND TEMPLATES (3 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── CREATE TEMPLATE ─────────────────────────────────────────────────
const createTemplate = adminProcedure
  .input(z.object({
    srt_template_name: z.string().min(1).max(255),
    srt_description: z.string().optional(),
    checklist_items: z.array(z.string()).min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        INSERT INTO safety_round_templates (
          hospital_id, srt_template_name, srt_description,
          checklist_items, srt_is_active, srt_created_at
        )
        VALUES (
          ${hospitalId}, ${input.srt_template_name}, ${input.srt_description || null},
          ${JSON.stringify(input.checklist_items)}, true, NOW()
        )
        RETURNING id, srt_template_name, srt_is_active, srt_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create safety round template',
        });
      }

      return {
        id: rows[0].id,
        srt_template_name: rows[0].srt_template_name,
        srt_is_active: rows[0].srt_is_active,
        created_at: rows[0].srt_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error creating safety round template',
      });
    }
  });

// ─── LIST TEMPLATES ──────────────────────────────────────────────────
const listTemplates = protectedProcedure
  .query(async ({ ctx }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        SELECT
          id, srt_template_name, srt_description,
          checklist_items, srt_is_active, srt_created_at
        FROM safety_round_templates
        WHERE hospital_id = ${hospitalId} AND srt_is_active = true
        ORDER BY srt_created_at DESC;
      `;

      const rows = (result as any) || [];
      return rows;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing safety round templates',
      });
    }
  });

// ─── DEACTIVATE TEMPLATE ─────────────────────────────────────────────
const deactivateTemplate = adminProcedure
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE safety_round_templates
        SET srt_is_active = false
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, srt_is_active;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Safety round template not found',
        });
      }

      return {
        id: rows[0].id,
        srt_is_active: rows[0].srt_is_active,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error deactivating safety round template',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// CLINICAL AUDITS (5 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── SCHEDULE AUDIT ──────────────────────────────────────────────────
const scheduleAudit = protectedProcedure
  .input(z.object({
    ca_nabh_chapter: z.string().min(1).max(100),
    audit_type: auditTypeEnum,
    ca_scheduled_date: z.string().datetime(),
    sample_size: z.number().int().min(1),
    auditor_user_id: z.string().uuid().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        INSERT INTO clinical_audits (
          hospital_id, ca_nabh_chapter, audit_type,
          ca_scheduled_date, sample_size, auditor_user_id,
          ca_status, ca_created_at
        )
        VALUES (
          ${hospitalId}, ${input.ca_nabh_chapter}, ${input.audit_type},
          ${input.ca_scheduled_date}::timestamptz, ${input.sample_size}, ${input.auditor_user_id || null}::uuid,
          'scheduled', NOW()
        )
        RETURNING id, ca_nabh_chapter, audit_type, ca_status, ca_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to schedule clinical audit',
        });
      }

      return {
        id: rows[0].id,
        ca_nabh_chapter: rows[0].ca_nabh_chapter,
        audit_type: rows[0].audit_type,
        ca_status: rows[0].ca_status,
        created_at: rows[0].ca_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error scheduling clinical audit',
      });
    }
  });

// ─── LIST AUDITS ─────────────────────────────────────────────────────
const listAudits = protectedProcedure
  .input(z.object({
    ca_nabh_chapter: z.string().optional(),
    ca_status: clinicalAuditStatusEnum.optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.pageSize;

      // Count total
      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM clinical_audits
        WHERE hospital_id = ${hospitalId}
          AND (${input.ca_nabh_chapter ?? null}::text IS NULL OR ca_nabh_chapter = ${input.ca_nabh_chapter ?? null})
          AND (${input.ca_status ?? null}::text IS NULL OR ca_status = ${input.ca_status ?? null})
          AND (${input.date_from ?? null}::timestamptz IS NULL OR ca_scheduled_date >= ${input.date_from ?? null}::timestamptz)
          AND (${input.date_to ?? null}::timestamptz IS NULL OR ca_scheduled_date <= ${input.date_to ?? null}::timestamptz);
      `;

      const countRows = (countResult as any);
      const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

      // Fetch records with findings count
      const result = await sql`
        SELECT
          ca.id, ca.ca_nabh_chapter, ca.audit_type,
          ca.ca_scheduled_date, ca.sample_size, ca.ca_status,
          ca.compliance_score, ca.ca_completed_at, ca.ca_notes, ca.ca_created_at,
          COUNT(caf.id)::int as findings_count
        FROM clinical_audits ca
        LEFT JOIN clinical_audit_findings caf ON ca.id = caf.caf_clinical_audit_id
        WHERE ca.hospital_id = ${hospitalId}
          AND (${input.ca_nabh_chapter ?? null}::text IS NULL OR ca.ca_nabh_chapter = ${input.ca_nabh_chapter ?? null})
          AND (${input.ca_status ?? null}::text IS NULL OR ca.ca_status = ${input.ca_status ?? null})
          AND (${input.date_from ?? null}::timestamptz IS NULL OR ca.ca_scheduled_date >= ${input.date_from ?? null}::timestamptz)
          AND (${input.date_to ?? null}::timestamptz IS NULL OR ca.ca_scheduled_date <= ${input.date_to ?? null}::timestamptz)
        GROUP BY ca.id
        ORDER BY ca.ca_scheduled_date DESC
        LIMIT ${input.pageSize} OFFSET ${offset};
      `;

      const rows = (result as any) || [];

      return {
        data: rows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing clinical audits',
      });
    }
  });

// ─── GET AUDIT ───────────────────────────────────────────────────────
const getAudit = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        SELECT
          ca.id, ca.ca_nabh_chapter, ca.audit_type,
          ca.ca_scheduled_date, ca.sample_size, ca.auditor_user_id,
          ca.ca_status, ca.ca_completed_at, ca.compliance_score,
          ca.ca_notes, ca.ca_created_at,
          COUNT(caf.id)::int as findings_count
        FROM clinical_audits ca
        LEFT JOIN clinical_audit_findings caf ON ca.id = caf.caf_clinical_audit_id
        WHERE ca.id = ${input.id}::uuid AND ca.hospital_id = ${hospitalId}
        GROUP BY ca.id
        LIMIT 1;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Clinical audit not found',
        });
      }

      return rows[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching clinical audit',
      });
    }
  });

// ─── COMPLETE AUDIT ──────────────────────────────────────────────────
const completeAudit = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    compliance_score: z.number().nonnegative().max(100),
    ca_notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE clinical_audits
        SET
          ca_status = 'completed',
          ca_completed_at = NOW(),
          compliance_score = ${input.compliance_score},
          ca_notes = COALESCE(${input.ca_notes ?? null}::text, ca_notes)
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, ca_status, ca_completed_at, compliance_score;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Clinical audit not found',
        });
      }

      return {
        id: rows[0].id,
        ca_status: rows[0].ca_status,
        completed_at: rows[0].ca_completed_at,
        compliance_score: rows[0].compliance_score,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error completing clinical audit',
      });
    }
  });

// ─── ADD AUDIT FINDING ───────────────────────────────────────────────
const addAuditFinding = protectedProcedure
  .input(z.object({
    caf_clinical_audit_id: z.string().uuid(),
    caf_checklist_item: z.string().min(1).max(255),
    caf_finding_description: z.string().min(1),
    caf_severity: findingSeverityEnum,
    caf_target_closure_date: z.string().date(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        INSERT INTO clinical_audit_findings (
          hospital_id, caf_clinical_audit_id, caf_checklist_item,
          caf_finding_description, caf_severity, caf_assigned_at,
          caf_target_closure_date, caf_status, caf_created_at
        )
        VALUES (
          ${hospitalId}, ${input.caf_clinical_audit_id}::uuid, ${input.caf_checklist_item},
          ${input.caf_finding_description}, ${input.caf_severity}, NOW(),
          ${input.caf_target_closure_date}::date, 'open', NOW()
        )
        RETURNING id, caf_checklist_item, caf_severity, caf_status, caf_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add clinical audit finding',
        });
      }

      return {
        id: rows[0].id,
        caf_checklist_item: rows[0].caf_checklist_item,
        caf_severity: rows[0].caf_severity,
        caf_status: rows[0].caf_status,
        created_at: rows[0].caf_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error adding clinical audit finding',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// AUDIT FINDINGS (2 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── CLOSE AUDIT FINDING ────────────────────────────────────────────
const closeAuditFinding = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    caf_closure_notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE clinical_audit_findings
        SET
          caf_status = 'closed',
          caf_closed_at = NOW(),
          caf_closure_notes = COALESCE(${input.caf_closure_notes ?? null}::text, caf_closure_notes)
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, caf_status, caf_closed_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Clinical audit finding not found',
        });
      }

      return {
        id: rows[0].id,
        caf_status: rows[0].caf_status,
        closed_at: rows[0].caf_closed_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error closing clinical audit finding',
      });
    }
  });

// ─── LIST AUDIT FINDINGS ────────────────────────────────────────────
const listAuditFindings = protectedProcedure
  .input(z.object({
    caf_clinical_audit_id: z.string().uuid(),
    caf_status: auditFindingStatusEnum.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.pageSize;

      // Count total
      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM clinical_audit_findings
        WHERE hospital_id = ${hospitalId}
          AND caf_clinical_audit_id = ${input.caf_clinical_audit_id}::uuid
          AND (${input.caf_status ?? null}::text IS NULL OR caf_status = ${input.caf_status ?? null});
      `;

      const countRows = (countResult as any);
      const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

      // Fetch records
      const result = await sql`
        SELECT
          id, caf_checklist_item, caf_finding_description, caf_severity,
          caf_target_closure_date, caf_status,
          caf_closure_notes, caf_closed_at, caf_created_at
        FROM clinical_audit_findings
        WHERE hospital_id = ${hospitalId}
          AND caf_clinical_audit_id = ${input.caf_clinical_audit_id}::uuid
          AND (${input.caf_status ?? null}::text IS NULL OR caf_status = ${input.caf_status ?? null})
        ORDER BY caf_created_at DESC
        LIMIT ${input.pageSize} OFFSET ${offset};
      `;

      const rows = (result as any) || [];

      return {
        data: rows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing clinical audit findings',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// COMPLAINTS (6 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── SUBMIT COMPLAINT ────────────────────────────────────────────────
const submitComplaint = protectedProcedure
  .input(z.object({
    sc_patient_id: z.string().uuid().optional(),
    complaint_category: z.string().min(1).max(100),
    complaint_description: z.string().min(1),
    department_involved: z.string().max(100).optional(),
    staff_member_involved_name: z.string().max(255).optional(),
    sc_incident_date: z.string().datetime(),
    sc_severity: complaintSeverityEnum,
    sc_anonymous: z.boolean().default(false),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Generate complaint_id (e.g., COMP-2026-4-12-001)
      const dateStr = new Date().toISOString().split('T')[0].replaceAll('-', '-');
      const countResult = await sql`
        SELECT COUNT(*)::int as count
        FROM sewa_complaints
        WHERE hospital_id = ${hospitalId}
          AND complaint_id LIKE ${dateStr.replace(/\d{4}$/, '')}%
        ORDER BY complaint_id DESC LIMIT 1;
      `;
      const countRows = (countResult as any) || [];
      const nextNum = (countRows.length > 0 ? parseInt((countRows[0].count || 0).toString()) : 0) + 1;
      const complaintId = `COMP-${dateStr}-${String(nextNum).padStart(3, '0')}`;

      // Calculate SLA times
      const nowDate = new Date();
      const acknowledgmentDue = new Date(nowDate.getTime() + 24 * 60 * 60 * 1000);
      const resolutionDue = new Date(nowDate.getTime() + 72 * 60 * 60 * 1000);

      const result = await sql`
        INSERT INTO sewa_complaints (
          hospital_id, sc_patient_id, complaint_id, complaint_category,
          complaint_description, department_involved, staff_member_involved_name,
          sc_incident_date, sc_severity, sc_anonymous, sc_status,
          acknowledgement_sla_due_at, resolution_sla_due_at,
          sc_submitted_by_user_id, sc_submitted_at, sc_created_at, sc_updated_at
        )
        VALUES (
          ${hospitalId}, ${input.sc_patient_id || null}::uuid, ${complaintId},
          ${input.complaint_category}, ${input.complaint_description},
          ${input.department_involved || null}, ${input.staff_member_involved_name || null},
          ${input.sc_incident_date}::timestamptz, ${input.sc_severity}, ${input.sc_anonymous},
          'open', ${acknowledgmentDue.toISOString()}::timestamptz,
          ${resolutionDue.toISOString()}::timestamptz,
          ${userId}, NOW(), NOW(), NOW()
        )
        RETURNING id, complaint_id, sc_severity, sc_status, sc_created_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to submit complaint',
        });
      }

      return {
        id: rows[0].id,
        complaint_id: rows[0].complaint_id,
        sc_severity: rows[0].sc_severity,
        sc_status: rows[0].sc_status,
        created_at: rows[0].sc_created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error submitting complaint',
      });
    }
  });

// ─── LIST COMPLAINTS ────────────────────────────────────────────────
const listComplaints = protectedProcedure
  .input(z.object({
    sc_status: complaintStatusEnum.optional(),
    sc_severity: complaintSeverityEnum.optional(),
    department_involved: z.string().optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const offset = (input.page - 1) * input.pageSize;

      // Count total
      const countResult = await sql`
        SELECT COUNT(*) as total
        FROM sewa_complaints
        WHERE hospital_id = ${hospitalId}
          AND (${input.sc_status ?? null}::text IS NULL OR sc_status = ${input.sc_status ?? null})
          AND (${input.sc_severity ?? null}::text IS NULL OR sc_severity = ${input.sc_severity ?? null})
          AND (${input.department_involved ?? null}::text IS NULL OR department_involved = ${input.department_involved ?? null})
          AND (${input.date_from ?? null}::timestamptz IS NULL OR sc_incident_date >= ${input.date_from ?? null}::timestamptz)
          AND (${input.date_to ?? null}::timestamptz IS NULL OR sc_incident_date <= ${input.date_to ?? null}::timestamptz);
      `;

      const countRows = (countResult as any);
      const total = countRows && countRows.length > 0 ? parseInt(countRows[0].total) : 0;

      // Fetch records
      const result = await sql`
        SELECT
          id, complaint_id, complaint_category, complaint_description,
          department_involved, staff_member_involved_name,
          sc_incident_date, sc_severity, sc_status, sc_anonymous,
          acknowledgement_sla_due_at, resolution_sla_due_at,
          sc_acknowledged_at, sc_resolved_at, sc_escalated_at,
          sc_submitted_at, sc_created_at
        FROM sewa_complaints
        WHERE hospital_id = ${hospitalId}
          AND (${input.sc_status ?? null}::text IS NULL OR sc_status = ${input.sc_status ?? null})
          AND (${input.sc_severity ?? null}::text IS NULL OR sc_severity = ${input.sc_severity ?? null})
          AND (${input.department_involved ?? null}::text IS NULL OR department_involved = ${input.department_involved ?? null})
          AND (${input.date_from ?? null}::timestamptz IS NULL OR sc_incident_date >= ${input.date_from ?? null}::timestamptz)
          AND (${input.date_to ?? null}::timestamptz IS NULL OR sc_incident_date <= ${input.date_to ?? null}::timestamptz)
        ORDER BY sc_incident_date DESC
        LIMIT ${input.pageSize} OFFSET ${offset};
      `;

      const rows = (result as any) || [];

      return {
        data: rows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error listing complaints',
      });
    }
  });

// ─── ACKNOWLEDGE COMPLAINT ──────────────────────────────────────────
const acknowledgeComplaint = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    acknowledgement_message: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        UPDATE sewa_complaints
        SET
          sc_status = 'acknowledged',
          sc_acknowledged_at = NOW(),
          acknowledgement_message = COALESCE(${input.acknowledgement_message ?? null}::text, acknowledgement_message),
          sc_processed_by_user_id = ${userId},
          sc_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, sc_status, sc_acknowledged_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Complaint not found',
        });
      }

      return {
        id: rows[0].id,
        sc_status: rows[0].sc_status,
        acknowledged_at: rows[0].sc_acknowledged_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error acknowledging complaint',
      });
    }
  });

// ─── RESOLVE COMPLAINT ──────────────────────────────────────────────
const resolveComplaint = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    resolution_message: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;

      const result = await sql`
        UPDATE sewa_complaints
        SET
          sc_status = 'resolved',
          sc_resolved_at = NOW(),
          resolution_message = COALESCE(${input.resolution_message ?? null}::text, resolution_message),
          sc_processed_by_user_id = ${userId},
          sc_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, sc_status, sc_resolved_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Complaint not found',
        });
      }

      return {
        id: rows[0].id,
        sc_status: rows[0].sc_status,
        resolved_at: rows[0].sc_resolved_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error resolving complaint',
      });
    }
  });

// ─── ESCALATE COMPLAINT ─────────────────────────────────────────────
const escalateComplaint = protectedProcedure
  .input(z.object({
    id: z.string().uuid(),
    escalated_to_user_id: z.string().uuid(),
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        UPDATE sewa_complaints
        SET
          sc_status = 'escalated',
          sc_escalated_at = NOW(),
          escalated_to_user_id = ${input.escalated_to_user_id}::uuid,
          sc_updated_at = NOW()
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        RETURNING id, sc_status, sc_escalated_at;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Complaint not found',
        });
      }

      return {
        id: rows[0].id,
        sc_status: rows[0].sc_status,
        escalated_at: rows[0].sc_escalated_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error escalating complaint',
      });
    }
  });

// ─── GET COMPLAINT ──────────────────────────────────────────────────
const getComplaint = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        SELECT
          id, hospital_id, sc_patient_id, complaint_id, complaint_category,
          complaint_description, department_involved, staff_member_involved_name,
          sc_incident_date, sc_severity, sc_status, sc_anonymous,
          acknowledgement_sla_due_at, sc_acknowledged_at, acknowledgement_message,
          resolution_sla_due_at, sc_resolved_at, resolution_message,
          sc_escalated_at, escalated_to_user_id,
          satisfaction_survey_sent, satisfaction_survey_response, satisfaction_notes,
          sc_submitted_at, sc_created_at, sc_updated_at
        FROM sewa_complaints
        WHERE id = ${input.id}::uuid AND hospital_id = ${hospitalId}
        LIMIT 1;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Complaint not found',
        });
      }

      return rows[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching complaint',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// DASHBOARDS (2 endpoints)
// ════════════════════════════════════════════════════════════════════

// ─── QUALITY DASHBOARD ──────────────────────────────────────────────
const qualityDashboard = protectedProcedure
  .query(async ({ ctx }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        WITH indicator_stats AS (
          SELECT
            COUNT(*)::int as total_definitions,
            COUNT(*) FILTER (WHERE definition_status = 'confirmed')::int as confirmed_count
          FROM quality_indicator_definitions
          WHERE hospital_id = ${hospitalId}
        ),
        round_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE DATE(scheduled_date) = CURRENT_DATE)::int as rounds_today,
            COUNT(*) FILTER (WHERE DATE_PART('month', scheduled_date) = DATE_PART('month', CURRENT_DATE)
                          AND DATE_PART('year', scheduled_date) = DATE_PART('year', CURRENT_DATE))::int as rounds_month
          FROM safety_rounds
          WHERE hospital_id = ${hospitalId}
        ),
        finding_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE srf_status = 'open')::int as open_findings,
            COUNT(*) FILTER (WHERE srf_severity = 'major')::int as major_findings
          FROM safety_round_findings
          WHERE hospital_id = ${hospitalId}
        ),
        audit_stats AS (
          SELECT
            AVG(compliance_score)::numeric(5,2) as avg_compliance,
            COUNT(*) FILTER (WHERE ca_status = 'completed')::int as completed_audits,
            COUNT(*)::int as total_audits
          FROM clinical_audits
          WHERE hospital_id = ${hospitalId}
        )
        SELECT
          (SELECT total_definitions FROM indicator_stats) as total_definitions,
          (SELECT confirmed_count FROM indicator_stats) as confirmed_definitions,
          (SELECT CASE WHEN (SELECT total_definitions FROM indicator_stats) > 0
                      THEN ROUND(100 * (SELECT confirmed_count FROM indicator_stats)::numeric / (SELECT total_definitions FROM indicator_stats), 2)
                      ELSE 0 END) as confirmation_percentage,
          (SELECT rounds_today FROM round_stats) as rounds_today,
          (SELECT rounds_month FROM round_stats) as rounds_this_month,
          (SELECT open_findings FROM finding_stats) as open_findings,
          (SELECT major_findings FROM finding_stats) as major_findings,
          (SELECT avg_compliance FROM audit_stats) as avg_compliance_score,
          (SELECT completed_audits FROM audit_stats) as completed_audits,
          (SELECT total_audits FROM audit_stats) as total_audits;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        return {
          total_definitions: 0,
          confirmed_definitions: 0,
          confirmation_percentage: 0,
          rounds_today: 0,
          rounds_this_month: 0,
          open_findings: 0,
          major_findings: 0,
          avg_compliance_score: 0,
          completed_audits: 0,
          total_audits: 0,
        };
      }

      return {
        total_definitions: rows[0].total_definitions || 0,
        confirmed_definitions: rows[0].confirmed_definitions || 0,
        confirmation_percentage: parseFloat(rows[0].confirmation_percentage || 0),
        rounds_today: rows[0].rounds_today || 0,
        rounds_this_month: rows[0].rounds_this_month || 0,
        open_findings: rows[0].open_findings || 0,
        major_findings: rows[0].major_findings || 0,
        avg_compliance_score: parseFloat(rows[0].avg_compliance_score || 0),
        completed_audits: rows[0].completed_audits || 0,
        total_audits: rows[0].total_audits || 0,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching quality dashboard',
      });
    }
  });

// ─── COMPLAINTS DASHBOARD ───────────────────────────────────────────
const complaintsDashboard = protectedProcedure
  .query(async ({ ctx }) => {
    try {
      const hospitalId = ctx.user.hospital_id;

      const result = await sql`
        WITH status_counts AS (
          SELECT
            COUNT(*) FILTER (WHERE sc_status = 'open')::int as open_count,
            COUNT(*) FILTER (WHERE sc_status = 'acknowledged')::int as acknowledged_count,
            COUNT(*) FILTER (WHERE sc_status = 'in_progress')::int as in_progress_count,
            COUNT(*) FILTER (WHERE sc_status = 'resolved')::int as resolved_count,
            COUNT(*) FILTER (WHERE sc_status = 'escalated')::int as escalated_count,
            COUNT(*) FILTER (WHERE sc_status = 'closed')::int as closed_count
          FROM sewa_complaints
          WHERE hospital_id = ${hospitalId}
        ),
        sla_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE sc_status = 'resolved' AND sc_resolved_at <= resolution_sla_due_at)::int as sla_met,
            COUNT(*) FILTER (WHERE sc_status = 'resolved')::int as total_resolved,
            AVG(EXTRACT(EPOCH FROM (sc_resolved_at - sc_submitted_at)) / 3600)::numeric(10,2) as avg_resolution_hours
          FROM sewa_complaints
          WHERE hospital_id = ${hospitalId} AND sc_resolved_at IS NOT NULL
        ),
        dept_stats AS (
          SELECT
            department_involved,
            COUNT(*)::int as complaint_count
          FROM sewa_complaints
          WHERE hospital_id = ${hospitalId} AND department_involved IS NOT NULL
          GROUP BY department_involved
          ORDER BY complaint_count DESC
          LIMIT 5
        )
        SELECT
          (SELECT open_count FROM status_counts) as open_complaints,
          (SELECT acknowledged_count FROM status_counts) as acknowledged_complaints,
          (SELECT in_progress_count FROM status_counts) as in_progress_complaints,
          (SELECT resolved_count FROM status_counts) as resolved_complaints,
          (SELECT escalated_count FROM status_counts) as escalated_complaints,
          (SELECT closed_count FROM status_counts) as closed_complaints,
          (SELECT avg_resolution_hours FROM sla_stats) as avg_resolution_hours,
          (SELECT CASE WHEN (SELECT total_resolved FROM sla_stats) > 0
                      THEN ROUND(100 * (SELECT sla_met FROM sla_stats)::numeric / (SELECT total_resolved FROM sla_stats), 2)
                      ELSE 0 END) as sla_adherence_percentage,
          (SELECT json_agg(json_build_object('department', department_involved, 'count', complaint_count))
           FROM dept_stats) as complaints_by_department;
      `;

      const rows = (result as any);
      if (!rows || rows.length === 0) {
        return {
          open_complaints: 0,
          acknowledged_complaints: 0,
          in_progress_complaints: 0,
          resolved_complaints: 0,
          escalated_complaints: 0,
          closed_complaints: 0,
          avg_resolution_hours: 0,
          sla_adherence_percentage: 0,
          complaints_by_department: [],
        };
      }

      return {
        open_complaints: rows[0].open_complaints || 0,
        acknowledged_complaints: rows[0].acknowledged_complaints || 0,
        in_progress_complaints: rows[0].in_progress_complaints || 0,
        resolved_complaints: rows[0].resolved_complaints || 0,
        escalated_complaints: rows[0].escalated_complaints || 0,
        closed_complaints: rows[0].closed_complaints || 0,
        avg_resolution_hours: parseFloat(rows[0].avg_resolution_hours || 0),
        sla_adherence_percentage: parseFloat(rows[0].sla_adherence_percentage || 0),
        complaints_by_department: rows[0].complaints_by_department || [],
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error fetching complaints dashboard',
      });
    }
  });

// ════════════════════════════════════════════════════════════════════
// ROUTER EXPORT
// ════════════════════════════════════════════════════════════════════

export const safetyAuditsRouter = router({
  // Indicator Definitions
  createDefinition,
  getDefinition,
  listDefinitions,
  updateDefinition,
  confirmDefinition,

  // Safety Rounds
  scheduleRound,
  listRounds,
  getRound,
  startRound,
  completeRound,
  cancelRound,

  // Safety Round Findings
  addFinding,
  updateFinding,
  closeFinding,
  listFindings,

  // Safety Round Templates
  createTemplate,
  listTemplates,
  deactivateTemplate,

  // Clinical Audits
  scheduleAudit,
  listAudits,
  getAudit,
  completeAudit,
  addAuditFinding,

  // Audit Findings
  closeAuditFinding,
  listAuditFindings,

  // Complaints
  submitComplaint,
  listComplaints,
  acknowledgeComplaint,
  resolveComplaint,
  escalateComplaint,
  getComplaint,

  // Dashboards
  qualityDashboard,
  complaintsDashboard,
});
