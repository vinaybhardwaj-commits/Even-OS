/**
 * OCR engine for the document-ingest pipeline (N.6).
 *
 * Used when N.4's text extractor produces < 40 chars (image-only PDFs,
 * scans, photos). Routes the blob through Tesseract.js — pure-JS WASM,
 * no native binaries — and returns text + a 0-1 confidence score that
 * downstream code stores on `mrd_ocr_results.ocr_confidence`.
 *
 * Supported inputs:
 *   - image/png, image/jpeg, image/webp, image/tiff, image/bmp
 *     → Tesseract recognises the buffer directly.
 *   - application/pdf
 *     → Each page is rasterised via unpdf's `renderPageAsImage` (which
 *       uses @napi-rs/canvas under the hood — bundled prebuilt for
 *       linux-x64 so Vercel lambdas work). Each page's PNG is OCR'd
 *       and the texts are concatenated with `\n\n--- page N ---\n\n`
 *       headers so position is recoverable downstream.
 *   - anything else → throws (worker marks `ocr_failed`).
 *
 * Performance / cold-start caveats:
 *   - First invocation in a fresh Vercel lambda downloads `eng.traineddata`
 *     (~10MB) and the WASM binary. Subsequent calls reuse the cached worker.
 *   - We tear the worker down at the end of each `runOcrOnDocument` call to
 *     keep the lambda RSS bounded — background-queue work isn't latency
 *     sensitive and the overhead is acceptable.
 */

import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

export type OcrEngine = 'tesseract-image' | 'tesseract-pdf';

export interface OcrResult {
  text: string;
  /** 0-1 average across pages (or single image). */
  confidence: number;
  /** 1 for images; PDF page count for PDFs. */
  pageCount: number;
  engine: OcrEngine;
  language: 'eng';
  processingTimeMs: number;
  /** Bytes fetched from blob URL. */
  bytes: number;
}

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'image/bmp',
]);

function squashWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isImageMime(mime: string | null | undefined, filename?: string | null): boolean {
  const m = (mime || '').toLowerCase();
  if (IMAGE_MIMES.has(m)) return true;
  const f = (filename || '').toLowerCase();
  return /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(f);
}

function isPdfMime(mime: string | null | undefined, filename?: string | null): boolean {
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf') return true;
  const f = (filename || '').toLowerCase();
  return f.endsWith('.pdf');
}

/**
 * Recognise a single image buffer with a fresh Tesseract worker.
 * Tears the worker down before returning so we don't leak WASM heap
 * across invocations.
 */
async function ocrImageBuffer(buf: ArrayBuffer): Promise<{ text: string; confidence: number }> {
  let worker: TesseractWorker | null = null;
  try {
    worker = await createWorker('eng');
    const u8 = new Uint8Array(buf);
    // tesseract.js accepts Uint8Array / Buffer / Blob / etc.
    const { data } = await worker.recognize(u8 as any);
    return {
      text: data.text || '',
      // Tesseract returns 0-100; normalise to 0-1.
      confidence: typeof data.confidence === 'number' ? data.confidence / 100 : 0,
    };
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch { /* swallow */ }
    }
  }
}

/**
 * Render every page of a PDF to PNG via unpdf + @napi-rs/canvas, OCR
 * each, and stitch the results together.
 */
async function ocrPdfBuffer(buf: ArrayBuffer): Promise<{ text: string; confidence: number; pageCount: number }> {
  // Lazy import to avoid pulling unpdf into the cold path of pure-image OCR.
  const unpdf = await import('unpdf');

  const u8 = new Uint8Array(buf);

  // unpdf exposes `getDocumentProxy` (pdfjs PDFDocumentProxy) so we can
  // discover page count, then `renderPageAsImage` for each page.
  const proxy: any = await (unpdf as any).getDocumentProxy(u8);
  const pageCount: number = proxy?.numPages ?? 0;
  if (!pageCount) {
    return { text: '', confidence: 0, pageCount: 0 };
  }

  const pageTexts: string[] = [];
  let confSum = 0;
  let confCount = 0;

  // OCR is sequential — running pages in parallel would multiply RSS by N.
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    let pngBuf: Uint8Array | ArrayBuffer | null = null;
    try {
      pngBuf = await (unpdf as any).renderPageAsImage(u8, pageNum, {
        canvas: () => import('@napi-rs/canvas'),
        scale: 2, // 2x boosts OCR accuracy at acceptable bytes
      });
    } catch (err: any) {
      pageTexts.push(`[page ${pageNum}: render failed — ${err?.message ?? 'unknown'}]`);
      continue;
    }
    if (!pngBuf) {
      pageTexts.push(`[page ${pageNum}: no image produced]`);
      continue;
    }
    const ab = pngBuf instanceof ArrayBuffer
      ? pngBuf
      : (pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength) as ArrayBuffer);

    const { text, confidence } = await ocrImageBuffer(ab);
    pageTexts.push(`--- page ${pageNum} ---\n${text.trim()}`);
    if (confidence > 0) {
      confSum += confidence;
      confCount++;
    }
  }

  return {
    text: pageTexts.join('\n\n'),
    confidence: confCount > 0 ? confSum / confCount : 0,
    pageCount,
  };
}

/**
 * Main entry point. Fetches the blob, dispatches on mime, returns text.
 * Throws on unrecoverable errors so the queue worker can mark the job
 * `ocr_failed` and bump attempts.
 */
export async function runOcrOnDocument(params: {
  blobUrl: string;
  mime?: string | null;
  filename?: string | null;
}): Promise<OcrResult> {
  const t0 = Date.now();

  const res = await fetch(params.blobUrl);
  if (!res.ok) {
    throw new Error(`OCR fetch failed (${res.status} ${res.statusText}): ${params.blobUrl}`);
  }
  const buf = await res.arrayBuffer();
  const bytes = buf.byteLength;

  if (isImageMime(params.mime, params.filename)) {
    const { text, confidence } = await ocrImageBuffer(buf);
    return {
      text: squashWhitespace(text),
      confidence,
      pageCount: 1,
      engine: 'tesseract-image',
      language: 'eng',
      processingTimeMs: Date.now() - t0,
      bytes,
    };
  }

  if (isPdfMime(params.mime, params.filename)) {
    const { text, confidence, pageCount } = await ocrPdfBuffer(buf);
    return {
      text: squashWhitespace(text),
      confidence,
      pageCount,
      engine: 'tesseract-pdf',
      language: 'eng',
      processingTimeMs: Date.now() - t0,
      bytes,
    };
  }

  throw new Error(
    `OCR not supported for mime=${params.mime ?? 'null'} filename=${params.filename ?? 'null'} ` +
    `— only image/* and application/pdf can be OCR'd`,
  );
}
