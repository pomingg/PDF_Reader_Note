"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "./pdfjs";

/* ------------------------------------------------------------------ outline */

interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

type RawOutline = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;

async function resolveOutline(pdf: PDFDocumentProxy, items: RawOutline): Promise<OutlineNode[]> {
  return Promise.all(
    (items ?? []).map(async (item) => {
      let page: number | null = null;
      try {
        const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        const ref = dest?.[0];
        if (ref != null) page = (typeof ref === "object" ? await pdf.getPageIndex(ref) : Number(ref)) + 1;
      } catch {
        /* unresolvable destination */
      }
      return { title: item.title, page, children: await resolveOutline(pdf, item.items) };
    }),
  );
}

export function OutlinePanel({
  pdf,
  currentPage,
  onGo,
}: {
  pdf: PDFDocumentProxy;
  currentPage: number;
  onGo: (page: number) => void;
}) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    pdf.getOutline().then((o) => resolveOutline(pdf, o)).then(setOutline);
  }, [pdf]);

  if (!outline) return <p className="p-4 text-sm text-slate-400">載入中…</p>;
  if (!outline.length) return <p className="p-4 text-sm text-slate-400">這份 PDF 沒有內建目錄</p>;

  // The entry containing the current page: the last one whose page <= currentPage.
  const flat: OutlineNode[] = [];
  const walk = (ns: OutlineNode[]) => ns.forEach((n) => (flat.push(n), walk(n.children)));
  walk(outline);
  const active = flat.filter((n) => n.page != null && n.page <= currentPage).at(-1);

  const render = (nodes: OutlineNode[], depth: number) =>
    nodes.map((n, i) => (
      <div key={i}>
        <button
          disabled={n.page == null}
          onClick={() => n.page && onGo(n.page)}
          className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100 ${
            n === active ? "bg-indigo-50 text-indigo-700" : "text-slate-700"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className="flex-1">{n.title}</span>
          {n.page && <span className="text-xs text-slate-400">{n.page}</span>}
        </button>
        {render(n.children, depth + 1)}
      </div>
    ));
  return <div className="p-2">{render(outline, 0)}</div>;
}

/* --------------------------------------------------------------- thumbnails */

function Thumb({
  pdf,
  page,
  current,
  aspect,
  onGo,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  current: boolean;
  aspect: number;
  onGo: (p: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current!;
    let done = false;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || done) return;
      done = true;
      io.disconnect();
      const p = await pdf.getPage(page);
      const vp = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: 240 / vp.width });
      el.width = viewport.width;
      el.height = viewport.height;
      await p.render({ canvasContext: el.getContext("2d")!, canvas: el, viewport }).promise.catch(() => {});
    });
    io.observe(el);
    return () => io.disconnect();
  }, [pdf, page]);

  useEffect(() => {
    if (current) btn.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <button ref={btn} onClick={() => onGo(page)} className="flex flex-col items-center gap-1">
      <canvas
        ref={ref}
        className={`w-28 bg-white shadow ${current ? "ring-2 ring-indigo-500" : "ring-1 ring-slate-200"}`}
        style={{ aspectRatio: String(aspect) }}
      />
      <span className={`text-xs ${current ? "font-semibold text-indigo-600" : "text-slate-500"}`}>{page}</span>
    </button>
  );
}

export function ThumbnailPanel({
  pdf,
  aspect,
  currentPage,
  onGo,
}: {
  pdf: PDFDocumentProxy;
  aspect: number;
  currentPage: number;
  onGo: (page: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-4">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Thumb key={i} pdf={pdf} page={i + 1} aspect={aspect} current={currentPage === i + 1} onGo={onGo} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- search */

export interface SearchHit {
  page: number;
  /** n-th hit on that page */
  index: number;
  before: string;
  match: string;
  after: string;
}

const pageTextCache = new WeakMap<PDFDocumentProxy, Promise<string[]>>();

/** Plain text of every page (cached per document). */
export function getAllPageText(pdf: PDFDocumentProxy): Promise<string[]> {
  let p = pageTextCache.get(pdf);
  if (!p) {
    p = Promise.all(
      Array.from({ length: pdf.numPages }, async (_, i) => {
        const page = await pdf.getPage(i + 1);
        const content = await page.getTextContent();
        return content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
      }),
    );
    pageTextCache.set(pdf, p);
  }
  return p;
}

export function findHits(texts: string[], query: string, limit = 500): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  texts.forEach((text, i) => {
    const lower = text.toLowerCase();
    let n = 0;
    for (let j = lower.indexOf(q); j !== -1 && hits.length < limit; j = lower.indexOf(q, j + q.length)) {
      hits.push({
        page: i + 1,
        index: n++,
        before: text.slice(Math.max(0, j - 30), j).replace(/\s+/g, " "),
        match: text.slice(j, j + q.length),
        after: text.slice(j + q.length, j + q.length + 40).replace(/\s+/g, " "),
      });
    }
  });
  return hits;
}

export function SearchPanel({
  query,
  setQuery,
  hits,
  searching,
  current,
  setCurrent,
  inputRef,
}: {
  query: string;
  setQuery: (q: string) => void;
  hits: SearchHit[];
  searching: boolean;
  current: number;
  setCurrent: (i: number) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const step = (d: number) => hits.length && setCurrent((current + d + hits.length) % hits.length);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-3">
        <input
          ref={inputRef}
          className="input"
          placeholder="搜尋全文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span data-testid="search-count">
            {searching ? "搜尋中…" : query.trim() ? `${hits.length ? current + 1 : 0} / ${hits.length} 筆` : "按 Enter 跳到下一筆"}
          </span>
          <span className="flex gap-1">
            <button className="icon-btn h-6 w-6" aria-label="上一筆" onClick={() => step(-1)}>
              ↑
            </button>
            <button className="icon-btn h-6 w-6" aria-label="下一筆" onClick={() => step(1)}>
              ↓
            </button>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {hits.map((h, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`block w-full rounded px-2 py-1.5 text-left text-xs leading-relaxed ${
              i === current ? "bg-indigo-50" : "hover:bg-slate-100"
            }`}
          >
            <span className="mr-1 font-semibold text-slate-400">p.{h.page}</span>
            <span className="text-slate-600">
              …{h.before}
              <mark className="bg-yellow-200 text-slate-900">{h.match}</mark>
              {h.after}…
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
