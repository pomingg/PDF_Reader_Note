"use client";

import type * as PdfJs from "pdfjs-dist";

export type PDFDocumentProxy = PdfJs.PDFDocumentProxy;
export type PDFPageProxy = PdfJs.PDFPageProxy;

let lib: Promise<typeof PdfJs> | null = null;

/** Load pdf.js lazily in the browser only, pointing it at the assets in /public/pdfjs. */
export function loadPdfJs(): Promise<typeof PdfJs> {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

/** Open a PDF. Call `destroy()` when done to free the worker resources. */
export async function openPdf(url: string): Promise<{ pdf: PDFDocumentProxy; destroy: () => void }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    url,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
  const pdf = await task.promise;
  return { pdf, destroy: () => void task.destroy() };
}
