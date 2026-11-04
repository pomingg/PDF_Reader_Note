"use client";

import { memo, useEffect, useRef } from "react";
import { loadPdfJs, type PDFDocumentProxy } from "./pdfjs";

export interface PageSize {
  width: number;
  height: number;
}

/**
 * One PDF page: a canvas plus a selectable text layer. Pages only render while
 * `active` (near the viewport) and drop their bitmap again when scrolled away.
 */
export const PageView = memo(function PageView({
  pdf,
  pageNumber,
  size,
  scale,
  active,
  query,
  currentHit,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  scale: number;
  active: boolean;
  query: string;
  /** Index of the search hit on this page to emphasise, or -1. */
  currentHit: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const textReady = useRef(0);
  const markHits = useRef<() => void>(() => {});
  const pendingScroll = useRef(false);

  markHits.current = () => {
    const layer = textRef.current;
    if (!layer) return;
    highlightText(layer, query, currentHit);
    if (pendingScroll.current && currentHit >= 0) {
      const mark = layer.querySelectorAll("mark.search-hit")[currentHit];
      if (mark) {
        mark.scrollIntoView({ block: "center" });
        pendingScroll.current = false;
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = textRef.current;
    if (!canvas || !layer) return;
    if (!active) {
      canvas.width = canvas.height = 0;
      layer.replaceChildren();
      textReady.current = 0;
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: { cancel: () => void } | null = null;

    (async () => {
      const pdfjs = await loadPdfJs();
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width * dpr);
      off.height = Math.floor(viewport.height * dpr);
      const ctx = off.getContext("2d")!;
      renderTask = page.render({
        canvasContext: ctx,
        canvas: off,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      try {
        await renderTask.promise;
      } catch {
        return; // cancelled
      }
      if (cancelled) return;
      // Swap in the finished bitmap at once so zooming never flashes blank.
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")!.drawImage(off, 0, 0);

      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      textLayer = tl;
      layer.replaceChildren();
      try {
        await tl.render();
      } catch {
        return;
      }
      if (cancelled) return;
      textReady.current++;
      markHits.current();
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, scale, active]);

  useEffect(() => {
    pendingScroll.current = currentHit >= 0;
    if (textReady.current) markHits.current();
  }, [query, currentHit]);

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      style={
        {
          width: size.width * scale,
          height: size.height * scale,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      <div ref={textRef} className="textLayer" />
      {!active && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">{pageNumber}</div>
      )}
    </div>
  );
});

/** Wrap every occurrence of `query` inside the text layer's spans in <mark>. */
function highlightText(layer: HTMLElement, query: string, current: number) {
  layer.querySelectorAll("mark.search-hit").forEach((m) => m.replaceWith(document.createTextNode(m.textContent ?? "")));
  layer.normalize();
  const q = query.trim().toLowerCase();
  if (!q) return;
  let n = 0;
  layer.querySelectorAll("span").forEach((span) => {
    if (span.children.length) return;
    const text = span.textContent ?? "";
    const lower = text.toLowerCase();
    if (!lower.includes(q)) return;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (let j = lower.indexOf(q); j !== -1; j = lower.indexOf(q, i)) {
      frag.append(text.slice(i, j));
      const mark = document.createElement("mark");
      mark.className = n === current ? "search-hit current" : "search-hit";
      mark.textContent = text.slice(j, j + q.length);
      frag.append(mark);
      n++;
      i = j + q.length;
    }
    frag.append(text.slice(i));
    span.replaceChildren(frag);
  });
}
