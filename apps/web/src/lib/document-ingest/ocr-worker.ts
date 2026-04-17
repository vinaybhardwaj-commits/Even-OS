/**
 * `ocr_document` queue handler (N.6).
 *
 * Invoked from src/app/api/ai/jobs/process-queue/route.ts whenever an
 * ai_request_queue row has prompt_template='ocr_document'. Two ways jobs
 * land in this queue:
 *   1. N.4's worker auto-enqueues OCR when its text extractor produces
 *      < 40 chars from a PDF or image — the document is "image-only"
 *      so we hand it to Tesseract.
 *   2. An admin or a clinician can manually re-trigger OCR for a
 *      `mrd_document_references` row in `ingestion_failed` status via
 *      the patient chart Documents tab.
 *
 * Lifecycle:
 *   pending  →  status='ocr_pending'   (queued)
 *           →  status='ocr_succeeded' + insert mrd_ocr_results row
 *              + re-enqueue ingest_document with use_ocr_text=true
 *           →  N.4 picks the ingest_document up, reads OCR text from
 *              mrd_ocr_results instead of running unpdf, then runs the
 *              normal extract→Qwen→proposals pipeline.
 *           →  status='ingested' (final)
 *
 *   pending  →  status='ocr_failed' (no usable text or unsupported mime)
 *
 * Why we re-enqueue rather than inline the LLM call:
 *   - Each phase is independently retryable / observable.
 *   - The same proposals path runs whether text came from unpdf or OCR
 *     (single source of truth for prompt construction + auto-accept).
 *   - Attempt counters are scoped per phase; a flaky LLM doesn't burn
 *     OCR retries.
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { runOcrOnDocument } from './ocr';

type Sql = NeonQueryFunction<false, false>;

export interface OcrQueueItem {
  id: string;
  hospital_id: string; // uuid of hospitals.id
  input_data: any;
  attempts: number;
  max_attempts: number;
}

export interface OcrJobResult {
  ok: boolean;
  document_id?: string | null;
  page_count?: number;
  text_chars?: number;
  confidence?: number;
  reingest_enqueued?: boolean;
  error?: string;
}

const OCR_MIN_USABLE_CHARS = 40;

export async function processOcrDocument(sql: Sql, item: OcrQueueItem): Promise<OcrJobResult> {
  const input = typeof item.input_data === 'string' ? JSON.parse(item.input_data) : item.input_data;
  const documentId: string | undefined = input?.document_id;
  if (!documentId) {
    return { ok: false, error: 'missing document_id' };
  }

  // 1. Look up the document.
  const docRows = await sql(
    `SELECT
       d.id, d.patient_id, d.encounter_id, d.content_type, d.blob_url,
       d.uploaded_by, d.document_type, d.status,
       p.hospital_id AS text_hospital_id
     FROM mrd_document_references d
     JOIN patients p ON p.id = d.patient_id
     WHERE d.id = $1
     LIMIT 1`,
    [documentId],
  );
  if (!docRows || docRows.length === 0) {
    return { ok: false, error: `document not found: ${documentId}`, document_id: documentId };
  }
  const doc = docRows[0];

  // 2. Mark the document `ocr_pending` so the Documents tab can show a
  // spinner / status pill while the queue worker is busy.
  await sql(
    `UPDATE mrd_document_references SET status = 'ocr_pending' WHERE id = $1`,
    [documentId],
  );

  // 3. Run OCR.
  let ocr;
  try {
    ocr = await runOcrOnDocument({
      blobUrl: doc.blob_url,
      mime: doc.content_type,
      filename: null,
    });
  } catch (err: any) {
    await sql(
      `UPDATE mrd_document_references SET status = 'ocr_failed' WHERE id = $1`,
      [documentId],
    );
    return {
      ok: false,
      document_id: documentId,
      error: `OCR engine threw: ${err?.message ?? 'unknown'}`,
    };
  }

  if (!ocr.text || ocr.text.length < OCR_MIN_USABLE_CHARS) {
    await sql(
      `UPDATE mrd_document_references SET status = 'ocr_failed' WHERE id = $1`,
      [documentId],
    );
    return {
      ok: false,
      document_id: documentId,
      page_count: ocr.pageCount,
      text_chars: ocr.text?.length ?? 0,
      confidence: ocr.confidence,
      error: `OCR produced ${ocr.text?.length ?? 0} chars (< ${OCR_MIN_USABLE_CHARS}) — likely blank/unreadable scan`,
    };
  }

  // 4. Persist OCR result. We always INSERT (a fresh row per attempt) so
  // historical OCR runs are auditable; the worker / Documents tab queries
  // ORDER BY processed_at DESC LIMIT 1 to get the latest.
  await sql(
    `INSERT INTO mrd_ocr_results (
       document_reference_id, raw_ocr_text, ocr_confidence,
       detected_language, processing_time_ms, processed_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      documentId,
      ocr.text.slice(0, 500_000),
      ocr.confidence.toFixed(3),
      ocr.language,
      String(ocr.processingTimeMs),
    ],
  );

  // 5. Mark `ocr_succeeded` (intermediate state) — N.4's ingest_document
  // worker is what flips it to `ingested` once proposals are written.
  await sql(
    `UPDATE mrd_document_references SET status = 'ocr_succeeded' WHERE id = $1`,
    [documentId],
  );

  // 6. Re-enqueue an ingest_document job that pulls text from
  // mrd_ocr_results instead of re-running unpdf. The N.4 worker checks
  // input_data.use_ocr_text and short-circuits the extractor.
  await sql(
    `INSERT INTO ai_request_queue (
       hospital_id, module, priority, input_data, prompt_template, status, attempts, max_attempts
     )
     VALUES ($1, 'clinical', 'high', $2::jsonb, 'ingest_document', 'pending', 0, 3)`,
    [
      item.hospital_id,
      JSON.stringify({
        document_id: documentId,
        patient_id: doc.patient_id,
        use_ocr_text: true,
        triggered_by: 'ocr_worker',
        ocr_confidence: ocr.confidence,
      }),
    ],
  );

  return {
    ok: true,
    document_id: documentId,
    page_count: ocr.pageCount,
    text_chars: ocr.text.length,
    confidence: ocr.confidence,
    reingest_enqueued: true,
  };
}
