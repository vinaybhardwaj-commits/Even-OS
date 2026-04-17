/**
 * `ingest_document` queue handler (N.4).
 *
 * Invoked from src/app/api/ai/jobs/process-queue/route.ts whenever an
 * ai_request_queue row has prompt_template='ingest_document'. Reads the
 * mrd_document_references row, extracts text, asks Qwen 2.5 14B to produce
 * structured proposals, writes them into chart_update_proposals, and
 * auto-accepts the safe ones (confidence > 0.95 && type ∈ {condition,
 * allergy, problem}) by inserting into the canonical clinical tables.
 *
 * Safe auto-accept matrix:
 *   - condition   → INSERT INTO conditions,  applied_row_id set
 *   - allergy     → INSERT INTO allergy_intolerances, applied_row_id set
 *   - problem     → stays as chart_update_proposals row (no canonical table);
 *                   status='accepted', applied_row_id=null
 *   - medication  → ALWAYS pending (needs prescriber_id + proper dose parsing)
 *   - lab_result  → ALWAYS pending (needs labOrders.id — synthetic orders
 *                   would corrupt the lab module)
 *   - procedure   → ALWAYS pending (needs performer_id + OT context)
 *
 * The `recorded_by` for auto-accepted rows is the document's `uploaded_by`
 * — whoever added the document owns the attributed update. This keeps
 * provenance auditable without introducing a system user.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { generateInsight } from '@/lib/ai/llm-client';
import {
  extractDocumentText,
  clampForPrompt,
} from './extractors';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseExtractionResult,
  AUTO_ACCEPT_THRESHOLD,
  type ProposalItem,
} from './extract-prompt';

// tagged-template SQL with $1,$2… positional params is the project convention
// — both forms are supported by the Neon HTTP driver.
type Sql = NeonQueryFunction<false, false>;

export interface QueueItem {
  id: string;
  hospital_id: string; // uuid of hospitals.id (not the text key)
  input_data: any;
  attempts: number;
  max_attempts: number;
}

export interface IngestResult {
  ok: boolean;
  proposals_created: number;
  proposals_auto_accepted: number;
  document_id?: string | null;
  error?: string;
  doc_type_suggestion?: string;
}

/**
 * Entry point. Looks up the document, extracts text, calls the LLM,
 * writes proposals. Throws on unrecoverable errors so the queue driver
 * bumps attempts / marks 'failed'.
 */
export async function processIngestDocument(sql: Sql, item: QueueItem): Promise<IngestResult> {
  const input = typeof item.input_data === 'string' ? JSON.parse(item.input_data) : item.input_data;
  const documentId: string | undefined = input?.document_id;
  const patientIdFromInput: string | undefined = input?.patient_id;

  if (!documentId) {
    return { ok: false, proposals_created: 0, proposals_auto_accepted: 0, error: 'missing document_id' };
  }

  // 1. Look up the document + its uploader + the patient's text-hospital_id.
  const docRows = await sql(
    `SELECT
       d.id, d.patient_id, d.encounter_id, d.content_type, d.blob_url,
       d.uploaded_by, d.document_type,
       p.hospital_id AS text_hospital_id
     FROM mrd_document_references d
     JOIN patients p ON p.id = d.patient_id
     WHERE d.id = $1
     LIMIT 1`,
    [documentId],
  );
  if (!docRows || docRows.length === 0) {
    return { ok: false, proposals_created: 0, proposals_auto_accepted: 0, error: `document not found: ${documentId}` };
  }
  const doc = docRows[0];
  if (patientIdFromInput && doc.patient_id !== patientIdFromInput) {
    return { ok: false, proposals_created: 0, proposals_auto_accepted: 0, error: 'patient_id mismatch' };
  }

  // 2. Extract text from the blob.
  // ─────────────────────────────────────────────────────────────
  // N.6 — if this job was re-enqueued by the OCR worker, the
  // canonical text is already in mrd_ocr_results and we should
  // skip the unpdf/mammoth path entirely. The OCR worker writes
  // raw_ocr_text and bumps the document's status to 'ocr_succeeded';
  // we read the latest row by processed_at DESC.
  // ─────────────────────────────────────────────────────────────
  let extraction: { text: string; pages?: number; extractor: string; bytes: number };
  if (input?.use_ocr_text === true) {
    const ocrRows = await sql(
      `SELECT raw_ocr_text
         FROM mrd_ocr_results
        WHERE document_reference_id = $1
        ORDER BY processed_at DESC
        LIMIT 1`,
      [documentId],
    );
    const ocrText = ocrRows?.[0]?.raw_ocr_text || '';
    extraction = {
      text: ocrText,
      extractor: 'ocr',
      bytes: ocrText.length,
    };
  } else {
    extraction = await extractDocumentText({
      blobUrl: doc.blob_url,
      mime: doc.content_type,
      filename: undefined,
    });
  }
  if (!extraction.text || extraction.text.length < 40) {
    // ─────────────────────────────────────────────────────────────
    // N.6 — when the unpdf/mammoth extractor produces nothing usable
    // and the input is a PDF or image, enqueue an `ocr_document` job
    // and let the Tesseract worker take a swing. We only do this when
    // we WEREN'T already running on OCR text (otherwise it's a loop:
    // OCR produced too few chars → re-enqueue OCR → ...).
    // ─────────────────────────────────────────────────────────────
    const mime = (doc.content_type || '').toLowerCase();
    const ocrEligible =
      input?.use_ocr_text !== true &&
      (mime === 'application/pdf' || mime.startsWith('image/'));

    if (ocrEligible) {
      await sql(
        `UPDATE mrd_document_references SET status = 'ocr_pending' WHERE id = $1`,
        [documentId],
      );
      await sql(
        `INSERT INTO ai_request_queue (
           hospital_id, module, priority, input_data, prompt_template, status, attempts, max_attempts
         )
         VALUES ($1, 'clinical', 'high', $2::jsonb, 'ocr_document', 'pending', 0, 3)`,
        [
          item.hospital_id,
          JSON.stringify({
            document_id: documentId,
            patient_id: doc.patient_id,
            triggered_by: 'ingest_document_fallback',
          }),
        ],
      );
      return {
        ok: true, // we successfully handed it off; queue worker will mark ingest done
        proposals_created: 0,
        proposals_auto_accepted: 0,
        document_id: documentId,
        error: `0-chars from extractor — enqueued for OCR (mime=${mime})`,
      };
    }

    await sql(
      `UPDATE mrd_document_references SET status = 'ingestion_failed' WHERE id = $1`,
      [documentId],
    );
    return {
      ok: false,
      proposals_created: 0,
      proposals_auto_accepted: 0,
      document_id: documentId,
      error: `extractor produced ${extraction.text.length} chars — likely image-only or unsupported`,
    };
  }

  // Persist the OCR/text-extraction result for future auditability.
  // When we're already running on OCR text the row was written by the
  // OCR worker — don't double-insert (and don't overwrite its real
  // ocr_confidence with our placeholder 1.0).
  if (input?.use_ocr_text !== true) {
    await sql(
      `INSERT INTO mrd_ocr_results (
         document_reference_id, raw_ocr_text, ocr_confidence,
         detected_language, processing_time_ms, processed_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [documentId, extraction.text.slice(0, 500_000), 1.0, 'en', 0],
    );
  }

  // 3. Call the LLM.
  const clamped = clampForPrompt(extraction.text);
  const userPrompt = buildUserPrompt(clamped, {
    docTypeHint: doc.document_type ?? undefined,
    filename: undefined,
  });

  const llm = await generateInsight({
    hospital_id: item.hospital_id, // uuid
    module: 'document_ingest',
    system_prompt: SYSTEM_PROMPT,
    user_prompt: userPrompt,
    max_tokens: 2000,
    temperature: 0.1,
    triggered_by: 'event',
  });
  if (!llm || !llm.content) {
    return {
      ok: false,
      proposals_created: 0,
      proposals_auto_accepted: 0,
      document_id: documentId,
      error: 'LLM returned no content',
    };
  }

  // 4. Parse + validate JSON.
  const parsed = parseExtractionResult(llm.content);
  if (!parsed.ok) {
    return {
      ok: false,
      proposals_created: 0,
      proposals_auto_accepted: 0,
      document_id: documentId,
      error: parsed.error,
    };
  }

  // 5. Write proposals + auto-accept the safe high-confidence ones.
  let created = 0;
  let autoAccepted = 0;
  for (const prop of parsed.data.proposals) {
    const result = await writeProposal(sql, {
      hospitalTextId: doc.text_hospital_id,
      patientId: doc.patient_id,
      encounterId: doc.encounter_id,
      sourceDocumentId: documentId,
      uploadedBy: doc.uploaded_by,
      proposal: prop,
    });
    if (result.created) created++;
    if (result.autoAccepted) autoAccepted++;
  }

  // 6. Mark the document as ingested (regardless of whether any proposals
  // landed — "ingested" means we ran the pipeline successfully).
  await sql(
    `UPDATE mrd_document_references SET status = 'ingested' WHERE id = $1`,
    [documentId],
  );

  return {
    ok: true,
    proposals_created: created,
    proposals_auto_accepted: autoAccepted,
    document_id: documentId,
    doc_type_suggestion: parsed.data.doc_type_suggestion,
  };
}

// ---------------------------------------------------------------------------
// Per-proposal writer — handles the auto-accept branching.
// ---------------------------------------------------------------------------

async function writeProposal(
  sql: Sql,
  p: {
    hospitalTextId: string;
    patientId: string;
    encounterId: string | null;
    sourceDocumentId: string;
    uploadedBy: string;
    proposal: ProposalItem;
  },
): Promise<{ created: boolean; autoAccepted: boolean }> {
  const { hospitalTextId, patientId, encounterId, sourceDocumentId, uploadedBy, proposal } = p;

  // Auto-accept decision.
  const safeForAutoApply = proposal.confidence >= AUTO_ACCEPT_THRESHOLD &&
    (proposal.proposal_type === 'condition' ||
     proposal.proposal_type === 'allergy' ||
     proposal.proposal_type === 'problem');

  let appliedRowId: string | null = null;

  if (safeForAutoApply) {
    if (proposal.proposal_type === 'condition') {
      const pl = proposal.payload;
      const onset = normaliseDate(pl.onset_date);
      const rows = await sql(
        `INSERT INTO conditions (
           hospital_id, patient_id, encounter_id,
           icd10_code, condition_name, clinical_status, verification_status,
           onset_date, notes, recorded_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'unconfirmed', $7, $8, $9)
         RETURNING id`,
        [
          hospitalTextId,
          patientId,
          encounterId,
          pl.icd_hint ?? null,
          pl.name,
          pl.status,
          onset,
          pl.notes ?? null,
          uploadedBy,
        ],
      );
      appliedRowId = rows[0]?.id ?? null;
    } else if (proposal.proposal_type === 'allergy') {
      const pl = proposal.payload;
      const severity = pl.severity === 'unknown' ? 'moderate' : pl.severity;
      const rows = await sql(
        `INSERT INTO allergy_intolerances (
           hospital_id, patient_id, encounter_id,
           substance, reaction, severity, category, criticality,
           allergy_verification_status, notes, recorded_by
         )
         VALUES ($1, $2, $3, $4, $5, $6::allergy_severity,
                 'medication'::allergy_category, 'low'::allergy_criticality,
                 'unconfirmed', $7, $8)
         RETURNING id`,
        [
          hospitalTextId,
          patientId,
          encounterId,
          pl.substance,
          pl.reaction ?? null,
          severity,
          pl.notes ?? null,
          uploadedBy,
        ],
      );
      appliedRowId = rows[0]?.id ?? null;
    }
    // 'problem' has no canonical target table — the proposal row itself
    // serves as the accepted record with applied_row_id=null.
  }

  const status = safeForAutoApply ? 'accepted' : 'pending';
  const reviewedBy = safeForAutoApply ? uploadedBy : null;

  await sql(
    `INSERT INTO chart_update_proposals (
       hospital_id, patient_id, encounter_id, source_document,
       proposal_type, payload, confidence, extraction_notes,
       status, reviewed_by, reviewed_at, applied_row_id
     )
     VALUES ($1, $2, $3, $4, $5::chart_proposal_type, $6::jsonb, $7, $8,
             $9::chart_proposal_status, $10, $11, $12)`,
    [
      hospitalTextId,
      patientId,
      encounterId,
      sourceDocumentId,
      proposal.proposal_type,
      JSON.stringify(proposal.payload),
      proposal.confidence,
      proposal.extraction_notes ?? null,
      status,
      reviewedBy,
      safeForAutoApply ? new Date().toISOString() : null,
      appliedRowId,
    ],
  );

  return { created: true, autoAccepted: safeForAutoApply };
}

function normaliseDate(s: string | undefined): string | null {
  if (!s) return null;
  // Try ISO; if it parses, round-trip so Postgres gets a clean value.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

