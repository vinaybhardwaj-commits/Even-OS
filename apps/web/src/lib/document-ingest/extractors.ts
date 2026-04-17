/**
 * Document text extractors for the LLM ingestion pipeline (N.4).
 *
 * Routes a fetched blob's bytes to the right extractor based on its mime
 * type / extension, returning a normalised `{ text, pages?, extractor }`
 * shape that downstream LLM extraction can consume.
 *
 * Per Notes v2 PRD §5.7 (and the Auto-accept > 0.95 path), N.4 handles
 * text-extractable formats only — image-only PDFs and scans are deferred
 * to N.5 (OCR). When an extractor produces empty text we surface that as
 * `text: ''` so the worker can mark the job 'failed' with a useful reason
 * instead of silently producing zero proposals.
 */

import { extractText as unpdfExtract } from 'unpdf';
import mammoth from 'mammoth';

export type ExtractorKind = 'pdf' | 'docx' | 'txt' | 'md' | 'unknown';

export interface ExtractionResult {
  text: string;
  pages?: number;
  extractor: ExtractorKind;
  bytes: number;
}

// Decode helpers ---------------------------------------------------------

function decodeUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

function squashWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Per-format extractors --------------------------------------------------

async function extractPdf(buf: ArrayBuffer): Promise<ExtractionResult> {
  const u8 = new Uint8Array(buf);
  const out = await unpdfExtract(u8, { mergePages: true });
  const text = Array.isArray(out.text) ? out.text.join('\n\n') : out.text;
  return {
    text: squashWhitespace(text || ''),
    pages: out.totalPages,
    extractor: 'pdf',
    bytes: buf.byteLength,
  };
}

async function extractDocx(buf: ArrayBuffer): Promise<ExtractionResult> {
  const nodeBuf = Buffer.from(buf);
  const { value } = await mammoth.extractRawText({ buffer: nodeBuf });
  return {
    text: squashWhitespace(value || ''),
    extractor: 'docx',
    bytes: buf.byteLength,
  };
}

function extractPlainText(buf: ArrayBuffer, kind: 'txt' | 'md'): ExtractionResult {
  return {
    text: squashWhitespace(decodeUtf8(buf)),
    extractor: kind,
    bytes: buf.byteLength,
  };
}

// Mime / extension routing ----------------------------------------------

function guessKind(mime: string | null | undefined, filename: string | null | undefined): ExtractorKind {
  const m = (mime || '').toLowerCase();
  const f = (filename || '').toLowerCase();

  if (m === 'application/pdf' || f.endsWith('.pdf')) return 'pdf';
  if (
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    f.endsWith('.docx')
  ) return 'docx';
  if (m === 'text/markdown' || f.endsWith('.md')) return 'md';
  if (m.startsWith('text/') || f.endsWith('.txt')) return 'txt';
  return 'unknown';
}

/**
 * Main entry point: fetch a blob URL, dispatch on mime, return text.
 * Caller owns rate-limiting / retries.
 */
export async function extractDocumentText(params: {
  blobUrl: string;
  mime?: string | null;
  filename?: string | null;
}): Promise<ExtractionResult> {
  const kind = guessKind(params.mime, params.filename);
  if (kind === 'unknown') {
    return { text: '', extractor: 'unknown', bytes: 0 };
  }

  const res = await fetch(params.blobUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch blob (${res.status} ${res.statusText}): ${params.blobUrl}`);
  }
  const buf = await res.arrayBuffer();

  switch (kind) {
    case 'pdf':  return extractPdf(buf);
    case 'docx': return extractDocx(buf);
    case 'txt':  return extractPlainText(buf, 'txt');
    case 'md':   return extractPlainText(buf, 'md');
  }
}

/**
 * Truncate extracted text to a token-friendly length for the LLM prompt.
 * Qwen 14B context is generous but we keep extraction prompts predictable
 * (and audit-friendly). Splits on paragraph boundaries when possible.
 */
export function clampForPrompt(text: string, maxChars = 24_000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const lastBreak = head.lastIndexOf('\n\n');
  return lastBreak > maxChars * 0.6 ? head.slice(0, lastBreak) : head;
}
