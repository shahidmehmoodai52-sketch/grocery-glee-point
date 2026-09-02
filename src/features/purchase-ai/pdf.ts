import * as pdfjsLib from "pdfjs-dist";
// Vite resolves this to a static asset URL and bundles the worker file alongside the app.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Renders the first page of a PDF to a compressed JPEG data URL — the same
 * shape fileToCompressedDataUrl() produces for a photo — so a scanned/exported
 * purchase bill PDF can flow through the exact same AI extraction pipeline.
 * Only the first page is rendered: a supplier purchase bill is virtually
 * always a single page, and multi-page merging is out of scope here.
 */
export async function pdfToCompressedDataUrl(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<string> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(3, maxDim / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    await loadingTask.destroy();
  }
}
