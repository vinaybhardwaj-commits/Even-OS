// =============================================================================
// PDF → layout-preserved text extractor
// =============================================================================
// Wraps `pdftotext -layout` (poppler-utils) via child_process.spawn. Layout mode
// preserves column alignment which the parsers rely on.
//
// Why pdftotext:
//   - Available on Linux (apt: poppler-utils) and Mac (brew install poppler).
//   - 100x faster than pdfjs-dist on the 144-page investigations PDF.
//   - No npm dep needed.
//
// If pdftotext is missing, the function throws with a clear install hint.
// =============================================================================

import { spawn } from 'node:child_process';

export interface ExtractOptions {
  /** Override the `pdftotext` binary path. */
  binary?: string;
  /** Pass through extra flags. Default: ['-layout']. */
  flags?: string[];
  /** Page range. Optional. */
  firstPage?: number;
  lastPage?: number;
}

/**
 * Extract text from `pdfPath`. Returns layout-preserved string.
 * Spawns `pdftotext -layout <path> -` and pipes stdout.
 */
export async function extractPdfText(
  pdfPath: string,
  opts: ExtractOptions = {},
): Promise<string> {
  const bin = opts.binary || process.env.PDFTOTEXT_BIN || 'pdftotext';
  const flags = opts.flags || ['-layout'];
  const args: string[] = [...flags];
  if (opts.firstPage) args.push('-f', String(opts.firstPage));
  if (opts.lastPage) args.push('-l', String(opts.lastPage));
  args.push(pdfPath, '-');

  return await new Promise<string>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(bin, args);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `pdftotext not found. Install poppler-utils:\n` +
              `  Mac:    brew install poppler\n` +
              `  Linux:  sudo apt-get install poppler-utils`,
          ),
        );
        return;
      }
      reject(err);
      return;
    }

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on('data', (b: Buffer) => chunks.push(b));
    proc.stderr.on('data', (b: Buffer) => errChunks.push(b));

    proc.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `pdftotext not found. Install poppler-utils:\n` +
              `  Mac:    brew install poppler\n` +
              `  Linux:  sudo apt-get install poppler-utils`,
          ),
        );
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(
          new Error(
            `pdftotext exited ${code}: ${Buffer.concat(errChunks).toString('utf8')}`,
          ),
        );
      }
    });
  });
}

/**
 * Split layout text into non-empty lines and tag each with its 1-based number.
 * Blank lines are dropped but the line count survives via `lineNo` so error
 * messages can point back at the source.
 */
export function* iterateLines(text: string): Generator<{ lineNo: number; line: string }> {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (trimmed.length === 0) continue;
    yield { lineNo: i + 1, line: trimmed };
  }
}
