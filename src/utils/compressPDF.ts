/**
 * Client-side PDF compression using MuPDF.js (WASM).
 *
 * What it does:
 *   - Opens the PDF in-browser via MuPDF
 *   - Subsets fonts
 *   - Re-writes the PDF with aggressive-but-safe options:
 *       compress streams, compress fonts, compress images (lossless re-deflate),
 *       deduplicate objects, clean syntax, sanitize unused content
 *   - Compares compressed vs. original and returns whichever is smaller
 *
 * This mirrors what Adobe Acrobat's "Reduced Size PDF" does. It does NOT
 * downsample images, so text and vector graphics remain crisp.
 *
 * Honest caveats (all handled gracefully by this util):
 *   - Encrypted / password-protected PDFs → returns original, reason='encrypted'
 *   - PDFs that grow after round-tripping → returns original, reason='grew'
 *   - Files too large for safe WASM processing → returns original, reason='too_large_for_wasm'
 *   - Any internal MuPDF error → returns original, reason='error'
 *
 * License note: MuPDF.js is AGPL-3.0. This project needs to expose attribution
 * and link to the MuPDF source per AGPL terms. See app About/Credits screen.
 */

// Lazy-import so the ~11 MB WASM binary is only fetched when compression is
// actually triggered, not on initial page load.
let mupdfPromise: Promise<typeof import('mupdf')> | null = null;
async function loadMuPDF() {
  if (!mupdfPromise) {
    mupdfPromise = import('mupdf');
  }
  return mupdfPromise;
}

export type CompressionReason =
  | 'encrypted'
  | 'grew'
  | 'error'
  | 'too_large_for_wasm'
  | 'skipped_small';

export interface CompressionResult {
  /** The blob to upload. Always safe to upload — falls back to the original on any failure. */
  blob: Blob;
  originalBytes: number;
  compressedBytes: number;
  /** True if the returned blob is the compressed version; false if we fell back to original. */
  usedCompressed: boolean;
  /** Reason we fell back, when applicable. */
  reason?: CompressionReason;
}

export interface CompressOptions {
  /** If the file is already smaller than this, skip compression entirely. Default: 0. */
  skipBelowBytes?: number;
  /** Reject (fall back) for files larger than this before loading WASM. Default: 30 MB. */
  maxInputBytes?: number;
  /** Optional progress callback: called with 'loading' | 'compressing' | 'done'. */
  onProgress?: (stage: 'loading-wasm' | 'compressing' | 'done') => void;
}

const DEFAULT_MAX_INPUT_BYTES = 30 * 1024 * 1024; // 30 MB

function toBlob(file: File | Blob, bytes: Uint8Array | null): Blob {
  if (bytes) return new Blob([bytes], { type: 'application/pdf' });
  return file instanceof Blob ? file : new Blob([file]);
}

export async function compressPDF(
  file: File | Blob,
  opts: CompressOptions = {}
): Promise<CompressionResult> {
  const originalBytes = file.size;
  const skipBelow = opts.skipBelowBytes ?? 0;
  const maxInput = opts.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;

  if (originalBytes <= skipBelow) {
    return {
      blob: toBlob(file, null),
      originalBytes,
      compressedBytes: originalBytes,
      usedCompressed: false,
      reason: 'skipped_small',
    };
  }

  if (originalBytes > maxInput) {
    return {
      blob: toBlob(file, null),
      originalBytes,
      compressedBytes: originalBytes,
      usedCompressed: false,
      reason: 'too_large_for_wasm',
    };
  }

  try {
    opts.onProgress?.('loading-wasm');
    const mupdf = await loadMuPDF();

    opts.onProgress?.('compressing');
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    let compressedU8: Uint8Array | null = null;
    let reason: CompressionReason | undefined;

    try {
      if (doc.needsPassword()) {
        reason = 'encrypted';
      } else {
        const pdfDoc = doc.asPDF();
        if (!pdfDoc) {
          reason = 'error';
        } else {
          // Subset fonts — typically a big win on plans that embed full font sets.
          try {
            pdfDoc.subsetFonts();
          } catch {
            // Non-fatal — continue to save.
          }

          const buf = pdfDoc.saveToBuffer({
            compress: true,
            'compress-images': true,
            'compress-fonts': true,
            garbage: 'deduplicate',
            clean: true,
            sanitize: true,
            linearize: false,
          });
          // Copy out of WASM heap before we destroy the document.
          compressedU8 = new Uint8Array(buf.asUint8Array());
        }
      }
    } finally {
      try {
        doc.destroy();
      } catch {
        /* ignore */
      }
    }

    opts.onProgress?.('done');

    if (reason === 'encrypted') {
      return {
        blob: toBlob(file, null),
        originalBytes,
        compressedBytes: originalBytes,
        usedCompressed: false,
        reason,
      };
    }

    if (!compressedU8) {
      return {
        blob: toBlob(file, null),
        originalBytes,
        compressedBytes: originalBytes,
        usedCompressed: false,
        reason: 'error',
      };
    }

    const compressedBytes = compressedU8.byteLength;
    if (compressedBytes >= originalBytes) {
      return {
        blob: toBlob(file, null),
        originalBytes,
        compressedBytes,
        usedCompressed: false,
        reason: 'grew',
      };
    }

    return {
      blob: new Blob([compressedU8], { type: 'application/pdf' }),
      originalBytes,
      compressedBytes,
      usedCompressed: true,
    };
  } catch (err) {
    console.error('[compressPDF] Compression failed, falling back to original:', err);
    opts.onProgress?.('done');
    return {
      blob: toBlob(file, null),
      originalBytes,
      compressedBytes: originalBytes,
      usedCompressed: false,
      reason: 'error',
    };
  }
}

export function formatBytesMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}
