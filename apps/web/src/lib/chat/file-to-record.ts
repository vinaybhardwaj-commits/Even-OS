/**
 * File-to-Record Pipeline — OC.4c
 *
 * When a file is uploaded in a patient chat channel, this pipeline:
 * 1. Creates a record in mrd_document_references (medical record)
 * 2. Links the chat_attachment to it via patient_document_id
 * 3. Queues the document for classification (low confidence by default)
 *
 * Called after a chat attachment is inserted in a patient channel.
 */

import { neon } from '@neondatabase/serverless';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

interface FileToRecordParams {
  attachment_id: string;     // chat_attachments.id
  message_id: number;        // chat_messages.id
  channel_id: string;        // chat_channels.channel_id (e.g., "patient-{encounter_id}")
  file_name: string;
  file_type: string;         // MIME
  file_size: number;
  file_url: string;
  uploaded_by: string;       // user sub
  hospital_id: string;
}

/**
 * Auto-route a chat attachment to the patient's medical record.
 * Only applies to patient channels. For other channel types, no-op.
 */
export async function routeFileToMedicalRecord(params: FileToRecordParams) {
  const sql = getSql();

  try {
    // Only process patient channels
    if (!params.channel_id.startsWith('patient-')) return null;

    const encounterId = params.channel_id.replace('patient-', '');

    // Look up patient_id from the channel's encounter
    const [encounter] = await sql`
      SELECT patient_id FROM encounters
      WHERE id = ${encounterId}::uuid
      LIMIT 1
    `;
    if (!encounter) return null;

    const patientId = encounter.patient_id;

    // Infer document type from MIME
    const docType = inferDocumentType(params.file_type, params.file_name);

    // 1. Create mrd_document_references entry
    const [docRef] = await sql`
      INSERT INTO mrd_document_references (
        patient_id, encounter_id, document_type,
        document_class_confidence, blob_url, content_type,
        file_size_bytes, status, uploaded_by
      )
      VALUES (
        ${patientId}::uuid,
        ${encounterId}::uuid,
        ${docType},
        'low',
        ${params.file_url},
        ${params.file_type},
        ${String(params.file_size)},
        'current',
        ${params.uploaded_by}
      )
      RETURNING id
    `;

    if (!docRef) return null;

    // 2. Link chat_attachment to the MRD document
    await sql`
      UPDATE chat_attachments
      SET patient_document_id = ${docRef.id}::uuid,
          document_category = ${docType}
      WHERE id = ${params.attachment_id}::uuid
    `;

    // 3. Queue for classification (AI will re-classify later)
    await sql`
      INSERT INTO mrd_document_classification_queue (
        document_reference_id, patient_id,
        classification_reason, detected_class, status
      )
      VALUES (
        ${docRef.id}::uuid,
        ${patientId}::uuid,
        'chat_upload_auto_classify',
        ${docType},
        'pending'
      )
      ON CONFLICT DO NOTHING
    `;

    return { document_reference_id: docRef.id, document_type: docType };
  } catch (err) {
    console.error('[file-to-record] routeFileToMedicalRecord failed:', err);
    return null;
  }
}

/**
 * Infer document type from MIME type and file name.
 */
function inferDocumentType(mimeType: string, fileName: string): string {
  const lower = fileName.toLowerCase();

  // Image types — likely clinical photos
  if (mimeType.startsWith('image/')) {
    if (lower.includes('xray') || lower.includes('x-ray')) return 'radiology_report';
    if (lower.includes('ecg') || lower.includes('ekg')) return 'other';
    return 'other'; // Will be re-classified by AI
  }

  // PDF — could be anything
  if (mimeType === 'application/pdf') {
    if (lower.includes('lab') || lower.includes('report')) return 'lab_report';
    if (lower.includes('consent')) return 'consent';
    if (lower.includes('discharge')) return 'discharge_summary';
    if (lower.includes('referral')) return 'referral_letter';
    if (lower.includes('prescription') || lower.includes('rx')) return 'prescription';
    if (lower.includes('insurance') || lower.includes('tpa')) return 'insurance_card';
    return 'other';
  }

  return 'other';
}
