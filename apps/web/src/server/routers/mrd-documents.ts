import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  mrdDocumentReferences, mrdDocumentClassificationQueue, mrdOcrResults,
  mrdDocumentRetentionRules, mrdMediaObjects, mrdDocumentAuditLog, mrdDocumentEmbeddings,
  patients,
} from '@db/schema';
import { eq, and, sql, desc, ilike, or, isNull, gte, lte } from 'drizzle-orm';

export const mrdDocumentsRouter = router({

  // ─── DOCUMENT REFERENCES ─────────────────────────────────

  listDocuments: adminProcedure
    .input(z.object({
      patient_id: z.string().uuid().optional(),
      document_type: z.string().optional(),
      status: z.enum(['current', 'superseded', 'deleted', 'all']).default('current'),
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [];

      if (input.patient_id) conditions.push(eq(mrdDocumentReferences.patient_id, input.patient_id as any));
      if (input.document_type) conditions.push(eq(mrdDocumentReferences.document_type, input.document_type));
      if (input.status !== 'all') conditions.push(eq(mrdDocumentReferences.status, input.status));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(mrdDocumentReferences).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(mrdDocumentReferences)
        .where(where)
        .orderBy(desc(mrdDocumentReferences.created_at))
        .limit(input.limit)
        .offset(input.offset);

      return { items: rows, total };
    }),

  getDocument: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [doc] = await db.select().from(mrdDocumentReferences)
        .where(eq(mrdDocumentReferences.id, input.id as any)).limit(1);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      return doc;
    }),

  uploadDocument: adminProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      document_type: z.string().min(1).max(100),
      content_type: z.string().optional(),
      file_size_bytes: z.string().optional(),
      blob_url: z.string().optional(),
      blob_hash: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const doc = await db.insert(mrdDocumentReferences).values({
        patient_id: input.patient_id as any,
        encounter_id: input.encounter_id as any,
        document_type: input.document_type,
        content_type: input.content_type,
        file_size_bytes: input.file_size_bytes,
        blob_url: input.blob_url,
        blob_hash: input.blob_hash,
        status: 'current',
        scanned_at: new Date(),
        uploaded_by: ctx.user.sub,
      }).returning();

      if (input.blob_url && input.blob_hash) {
        await db.insert(mrdMediaObjects).values({
          blob_url: input.blob_url,
          blob_path: `documents/${input.patient_id}/${doc[0].id}`,
          filename: `${doc[0].id}.pdf`,
          content_type: input.content_type || 'application/pdf',
          file_size_bytes: input.file_size_bytes,
          blob_hash: input.blob_hash,
          uploaded_by: ctx.user.sub,
        });
      }

      await db.insert(mrdDocumentAuditLog).values({
        document_reference_id: doc[0].id as any,
        patient_id: input.patient_id as any,
        action: 'upload',
        performed_by: ctx.user.sub,
        new_values: JSON.stringify(doc[0]),
      });

      return doc[0];
    }),

  updateDocument: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      document_type: z.string().optional(),
      status: z.enum(['current', 'superseded', 'deleted']).optional(),
      ocr_text: z.string().optional(),
      ocr_confidence: z.string().optional(),
      fhir_resource: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [oldDoc] = await db.select().from(mrdDocumentReferences)
        .where(eq(mrdDocumentReferences.id, input.id as any)).limit(1);
      if (!oldDoc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      const updateData: any = {};
      if (input.document_type) updateData.document_type = input.document_type;
      if (input.status) updateData.status = input.status;
      if (input.ocr_text) updateData.ocr_text = input.ocr_text;
      if (input.ocr_confidence) updateData.ocr_confidence = input.ocr_confidence;
      if (input.fhir_resource) updateData.fhir_resource = input.fhir_resource;

      const updated = await db.update(mrdDocumentReferences)
        .set(updateData)
        .where(eq(mrdDocumentReferences.id, input.id as any))
        .returning();

      await db.insert(mrdDocumentAuditLog).values({
        document_reference_id: input.id as any,
        patient_id: oldDoc.patient_id,
        action: 'update',
        performed_by: ctx.user.sub,
        old_values: JSON.stringify(oldDoc),
        new_values: JSON.stringify(updated[0]),
      });

      return updated[0];
    }),

  deleteDocument: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      deletion_reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await db.select().from(mrdDocumentReferences)
        .where(eq(mrdDocumentReferences.id, input.id as any)).limit(1);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      const updated = await db.update(mrdDocumentReferences)
        .set({
          status: 'deleted',
          deleted_at: new Date(),
          deleted_by: ctx.user.sub,
          deletion_reason: input.deletion_reason,
        })
        .where(eq(mrdDocumentReferences.id, input.id as any))
        .returning();

      await db.insert(mrdDocumentAuditLog).values({
        document_reference_id: input.id as any,
        patient_id: doc.patient_id,
        action: 'delete',
        action_detail: input.deletion_reason,
        performed_by: ctx.user.sub,
      });

      return updated[0];
    }),

  getDocumentStats: adminProcedure
    .input(z.object({ patient_id: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const conditions = input.patient_id ? [eq(mrdDocumentReferences.patient_id, input.patient_id as any)] : [];
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const countByType = await db.select({
        type: mrdDocumentReferences.document_type,
        count: sql<number>`count(*)`,
      }).from(mrdDocumentReferences)
        .where(where)
        .groupBy(mrdDocumentReferences.document_type);

      const ocrStats = await db.select({
        processed: sql<number>`count(case when ${mrdOcrResults.id} is not null then 1 end)`,
        total: sql<number>`count(*)`,
      }).from(mrdDocumentReferences)
        .leftJoin(mrdOcrResults, eq(mrdDocumentReferences.id, mrdOcrResults.document_reference_id))
        .where(where);

      return {
        countByType: countByType.map(x => ({ type: x.type, count: Number(x.count) })),
        ocrProcessed: Number(ocrStats[0]?.processed ?? 0),
        ocrTotal: Number(ocrStats[0]?.total ?? 0),
      };
    }),

  // ─── CLASSIFICATION QUEUE ────────────────────────────────

  listClassificationQueue: adminProcedure
    .input(z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'escalated', 'all']).default('pending'),
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [];
      if (input.status !== 'all') conditions.push(eq(mrdDocumentClassificationQueue.status, input.status));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(mrdDocumentClassificationQueue).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(mrdDocumentClassificationQueue)
        .where(where)
        .orderBy(desc(mrdDocumentClassificationQueue.created_at))
        .limit(input.limit)
        .offset(input.offset);

      const statusCounts = await db.select({
        status: mrdDocumentClassificationQueue.status,
        count: sql<number>`count(*)`,
      }).from(mrdDocumentClassificationQueue)
        .groupBy(mrdDocumentClassificationQueue.status);

      return {
        items: rows,
        total,
        statusCounts: statusCounts.map(x => ({ status: x.status, count: Number(x.count) })),
      };
    }),

  approveClassification: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      approved_class: z.string(),
      approved_uhid: z.string(),
      reviewer_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.update(mrdDocumentClassificationQueue)
        .set({
          status: 'approved',
          approved_class: input.approved_class,
          approved_uhid: input.approved_uhid,
          reviewed_by: ctx.user.sub,
          reviewed_at: new Date(),
          reviewer_notes: input.reviewer_notes,
        })
        .where(eq(mrdDocumentClassificationQueue.id, input.id as any))
        .returning();

      if (!updated[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Classification not found' });
      return updated[0];
    }),

  rejectClassification: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      reviewer_notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.update(mrdDocumentClassificationQueue)
        .set({
          status: 'rejected',
          reviewed_by: ctx.user.sub,
          reviewed_at: new Date(),
          reviewer_notes: input.reviewer_notes,
        })
        .where(eq(mrdDocumentClassificationQueue.id, input.id as any))
        .returning();

      if (!updated[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Classification not found' });
      return updated[0];
    }),

  addToClassificationQueue: adminProcedure
    .input(z.object({
      document_reference_id: z.string().uuid(),
      classification_reason: z.string(),
      detected_class: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await db.select().from(mrdDocumentReferences)
        .where(eq(mrdDocumentReferences.id, input.document_reference_id as any)).limit(1);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      const queued = await db.insert(mrdDocumentClassificationQueue).values({
        document_reference_id: input.document_reference_id as any,
        patient_id: doc.patient_id,
        classification_reason: input.classification_reason,
        detected_class: input.detected_class,
        status: 'pending',
      }).returning();

      return queued[0];
    }),

  // ─── OCR RESULTS ──────────────────────────────────────────

  getOcrResult: adminProcedure
    .input(z.object({ document_reference_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [result] = await db.select().from(mrdOcrResults)
        .where(eq(mrdOcrResults.document_reference_id, input.document_reference_id as any)).limit(1);
      return result || null;
    }),

  recordOcrResult: adminProcedure
    .input(z.object({
      document_reference_id: z.string().uuid(),
      raw_ocr_text: z.string(),
      ocr_confidence: z.string().optional(),
      detected_language: z.string().optional(),
      extracted_uhid: z.string().optional(),
      extracted_patient_name: z.string().optional(),
      extracted_dob: z.string().optional(),
      extracted_phone: z.string().optional(),
      extracted_email: z.string().optional(),
      extracted_fields: z.any().optional(),
      processing_time_ms: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(mrdOcrResults).values({
        document_reference_id: input.document_reference_id as any,
        raw_ocr_text: input.raw_ocr_text,
        ocr_confidence: input.ocr_confidence,
        detected_language: input.detected_language,
        extracted_uhid: input.extracted_uhid,
        extracted_patient_name: input.extracted_patient_name,
        extracted_dob: input.extracted_dob,
        extracted_phone: input.extracted_phone,
        extracted_email: input.extracted_email,
        extracted_fields: input.extracted_fields,
        processing_time_ms: input.processing_time_ms,
      }).returning();

      // Update document with OCR text and mark as processed
      await db.update(mrdDocumentReferences)
        .set({
          ocr_text: input.raw_ocr_text,
          ocr_confidence: input.ocr_confidence,
          ocr_processed_at: new Date(),
          indexed_at: new Date(),
        })
        .where(eq(mrdDocumentReferences.id, input.document_reference_id as any));

      return result[0];
    }),

  // ─── RETENTION RULES ──────────────────────────────────────

  listRetentionRules: adminProcedure
    .input(z.object({}).optional().default({}))
    .query(async ({ ctx, input }) => {
      return await db.select().from(mrdDocumentRetentionRules).orderBy(mrdDocumentRetentionRules.document_type);
    }),

  getRetentionRule: adminProcedure
    .input(z.object({ document_type: z.string() }))
    .query(async ({ ctx, input }) => {
      const [rule] = await db.select().from(mrdDocumentRetentionRules)
        .where(eq(mrdDocumentRetentionRules.document_type, input.document_type)).limit(1);
      return rule || null;
    }),

  updateRetentionRule: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      retention_days: z.string().optional(),
      rationale: z.string().optional(),
      auto_delete: z.boolean().optional(),
      archive_before_delete: z.boolean().optional(),
      notification_days_before_deletion: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateData: any = {};
      if (input.retention_days) updateData.retention_days = input.retention_days;
      if (input.rationale) updateData.rationale = input.rationale;
      if (input.auto_delete !== undefined) updateData.auto_delete = input.auto_delete;
      if (input.archive_before_delete !== undefined) updateData.archive_before_delete = input.archive_before_delete;
      if (input.notification_days_before_deletion) updateData.notification_days_before_deletion = input.notification_days_before_deletion;
      updateData.updated_at = new Date();
      updateData.updated_by = ctx.user.sub;

      const updated = await db.update(mrdDocumentRetentionRules)
        .set(updateData)
        .where(eq(mrdDocumentRetentionRules.id, input.id as any))
        .returning();

      if (!updated[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Retention rule not found' });
      return updated[0];
    }),

  // ─── DOCUMENT SEARCH ──────────────────────────────────────

  searchDocuments: adminProcedure
    .input(z.object({
      query: z.string().min(1),
      patient_id: z.string().uuid().optional(),
      limit: z.number().min(1).max(500).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [
        ilike(mrdDocumentReferences.ocr_text, `%${input.query}%`),
      ];

      if (input.patient_id) conditions.push(eq(mrdDocumentReferences.patient_id, input.patient_id as any));

      const where = and(...conditions);

      const rows = await db.select()
        .from(mrdDocumentReferences)
        .where(where)
        .orderBy(desc(mrdDocumentReferences.created_at))
        .limit(input.limit);

      return rows;
    }),

  getDocumentsForPatient: adminProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const docs = await db.select()
        .from(mrdDocumentReferences)
        .where(and(
          eq(mrdDocumentReferences.patient_id, input.patient_id as any),
          eq(mrdDocumentReferences.status, 'current'),
        ))
        .orderBy(desc(mrdDocumentReferences.created_at));

      // Group by type
      const grouped: Record<string, any[]> = {};
      docs.forEach(doc => {
        if (!grouped[doc.document_type]) grouped[doc.document_type] = [];
        grouped[doc.document_type].push(doc);
      });

      return grouped;
    }),

  // ─── AUDIT LOG ────────────────────────────────────────────

  listDocumentAuditLog: adminProcedure
    .input(z.object({
      document_reference_id: z.string().uuid().optional(),
      patient_id: z.string().uuid().optional(),
      action: z.string().optional(),
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [];

      if (input.document_reference_id) conditions.push(eq(mrdDocumentAuditLog.document_reference_id, input.document_reference_id as any));
      if (input.patient_id) conditions.push(eq(mrdDocumentAuditLog.patient_id, input.patient_id as any));
      if (input.action) conditions.push(eq(mrdDocumentAuditLog.action, input.action));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(mrdDocumentAuditLog).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(mrdDocumentAuditLog)
        .where(where)
        .orderBy(desc(mrdDocumentAuditLog.timestamp))
        .limit(input.limit)
        .offset(input.offset);

      return { items: rows, total };
    }),
});
