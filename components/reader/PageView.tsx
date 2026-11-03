"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { NormRect } from "@/lib/types";
import { loadPdfJs, type PDFDocumentProxy } from "./pdfjs";

/** An annotation's shapes on one page, ready to draw. */
export interface PageHighlight {
  id: string;
  type: "highlight" | "area" | "note";
  hex: string;
  rects: NormRect[];
}

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
  highlights,
  selectedId,
  flash,
  areaMode,
  onArea,
  onPick,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  scale: number;
  active: boolean;
  query: string;
  /** Index of the search hit on this page to emphasise, or -1. */
  currentHit: number;
  highlights: PageHighlight[];
  selectedId: string | null;
  /** Annotation to blink; `n` changes on every request so the same one can blink again. */
  flash: { id: string; n: number } | null;
  areaMode: boolean;
  onArea: (page: number, rect: NormRect, image: string) => void;
  onPick: (id: string | null) => void;
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

  /* Clicking on a highlight selects it (the text layer sits on top, so hit-test by position). */
  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    const hit = [...highlights]
      .reverse()
      .find((h) => h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
    onPick(hit?.id ?? null);
  };

  /* Area (box) selection: drag a rectangle, then crop it out of the rendered canvas. */
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const areaRect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };
  const finishArea = () => {
    const canvas = canvasRef.current;
    setDrag(null);
    if (!areaRect || !canvas || !canvas.width) return;
    const W = size.width * scale;
    const H = size.height * scale;
    if (areaRect.w < 8 || areaRect.h < 8) return;
    const sx = canvas.width / W;
    const crop = document.createElement("canvas");
    crop.width = Math.round(areaRect.w * sx);
    crop.height = Math.round(areaRect.h * sx);
    crop
      .getContext("2d")!
      .drawImage(canvas, areaRect.x * sx, areaRect.y * sx, crop.width, crop.height, 0, 0, crop.width, crop.height);
    onArea(
      pageNumber,
      { page: pageNumber, x: areaRect.x / W, y: areaRect.y / H, w: areaRect.w / W, h: areaRect.h / H },
      crop.toDataURL("image/png"),
    );
  };

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      onClick={pick}
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
      <div className="hl-layer">
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}${flash?.id === h.id ? `-${flash.n}` : ""}`}
              data-annotation={h.id}
              className={`${h.type === "area" ? "hl-area" : "hl-rect"} ${selectedId === h.id ? "hl-selected" : ""} ${
                flash?.id === h.id ? "hl-flash" : ""
              }`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                ...(h.type === "area"
                  ? { borderColor: h.hex, background: `${h.hex}22` }
                  : { background: h.hex, opacity: 0.45 }),
              }}
            />
          )),
        )}
      </div>
      <div ref={textRef} className="textLayer" />
      {areaMode && active && (
        <div
          className="area-overlay"
          data-testid={`area-overlay-${pageNumber}`}
          onPointerDown={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            e.currentTarget.setPointerCapture(e.pointerId);
            const x = e.clientX - b.left;
            const y = e.clientY - b.top;
            setDrag({ x0: x, y0: y, x1: x, y1: y });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const b = e.currentTarget.getBoundingClientRect();
            setDrag({
              ...drag,
              x1: Math.min(Math.max(0, e.clientX - b.left), b.width),
              y1: Math.min(Math.max(0, e.clientY - b.top), b.height),
            });
          }}
          onPointerUp={finishArea}
          onClick={(e) => e.stopPropagation()}
        >
          {areaRect && (
            <div
              className="absolute border-2 border-dashed border-indigo-500 bg-indigo-500/10"
              style={{ left: areaRect.x, top: areaRect.y, width: areaRect.w, height: areaRect.h }}
            />
          )}
        </div>
      )}
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
