"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, folderPath, libraryHref } from "@/lib/client";
import type { DocumentItem, Folder, Project } from "@/lib/types";
import { PageView, type PageSize } from "./PageView";
import { openPdf, type PDFDocumentProxy } from "./pdfjs";
import { findHits, getAllPageText, OutlinePanel, SearchPanel, ThumbnailPanel, type SearchHit } from "./SidePanels";

const GAP = 16;
const PAD = 24;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
type Tab = "outline" | "thumbs" | "search";
type ZoomMode = "fit" | "manual";

export function Reader({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState("");

  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [currentPage, setCurrentPage] = useState(1);
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("outline");
  const [pageInput, setPageInput] = useState("1");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [hitIndex, setHitIndex] = useState(-1);

  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  /* ---------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const d = await api.document(docId);
        if (cancelled) return;
        setDoc(d);
        api.projects().then((ps) => setProject(ps.find((p) => p.id === d.projectId) ?? null));
        api.folders(d.projectId).then(setFolders);

        const opened = await openPdf(`/api/documents/${docId}/file`);
        destroy = opened.destroy;
        const loaded = opened.pdf;
        if (cancelled) return destroy();
        const s = await Promise.all(
          Array.from({ length: loaded.numPages }, async (_, i) => {
            const vp = (await loaded.getPage(i + 1)).getViewport({ scale: 1 });
            return { width: vp.width, height: vp.height };
          }),
        );
        if (cancelled) return;
        setSizes(s);
        setPdf(loaded);
        api.updateDocument(docId, { opened: true, pageCount: loaded.numPages }).then(setDoc);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "無法開啟這份 PDF");
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [docId]);

  /* ----------------------------------------------------------------- layout */

  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      out.push(y);
      y += s.height * scale + GAP;
    }
    return out;
  }, [sizes, scale]);

  const maxWidth = useMemo(() => Math.max(1, ...sizes.map((s) => s.width)), [sizes]);
  const fitScale = useCallback(() => {
    const w = scroller.current?.clientWidth ?? 800;
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, (w - PAD * 2) / maxWidth));
  }, [maxWidth]);

  const pageAt = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
    [offsets],
  );

  const updateVisible = useCallback(() => {
    const el = scroller.current;
    if (!el || !offsets.length) return;
    const top = el.scrollTop;
    const first = pageAt(top - el.clientHeight);
    const last = pageAt(top + el.clientHeight * 2);
    setVisible((prev) => {
      const next = new Set<number>();
      for (let p = first; p <= last; p++) next.add(p);
      return next.size === prev.size && [...next].every((p) => prev.has(p)) ? prev : next;
    });
    setCurrentPage(pageAt(top + el.clientHeight * 0.35));
  }, [offsets, pageAt]);

  const goToPage = useCallback(
    (page: number) => {
      const el = scroller.current;
      const p = Math.min(Math.max(1, page), offsets.length);
      if (el && offsets.length) el.scrollTop = offsets[p - 1] - 8;
    },
    [offsets],
  );

  // Keep the reading position fixed while zooming: remember page + offset within it.
  const anchor = useRef<{ page: number; frac: number } | null>(null);
  const changeScale = useCallback(
    (next: number, mode: ZoomMode = "manual") => {
      const el = scroller.current;
      if (el && offsets.length) {
        const page = pageAt(el.scrollTop);
        const h = sizes[page - 1].height * scale + GAP;
        anchor.current = { page, frac: (el.scrollTop - offsets[page - 1]) / h };
      }
      setZoomMode(mode);
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 100) / 100)));
    },
    [offsets, pageAt, scale, sizes],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (el && a && offsets.length) {
      el.scrollTop = offsets[a.page - 1] + a.frac * (sizes[a.page - 1].height * scale + GAP);
      anchor.current = null;
    }
    updateVisible();
  }, [offsets, scale, sizes, updateVisible]);

  // First layout: fit width, then jump to where the reader left off.
  useLayoutEffect(() => {
    if (!pdf || !doc || !sizes.length || restored.current) return;
    restored.current = true;
    const page = Math.min(Math.max(1, doc.lastPage), sizes.length);
    const next = fitScale();
    if (Math.abs(next - scale) < 0.005) {
      if (page > 1 && scroller.current) scroller.current.scrollTop = offsets[page - 1];
      updateVisible();
    } else {
      anchor.current = { page, frac: 0 };
      setScale(next);
    }
  }, [pdf, doc, sizes, fitScale, scale, offsets, updateVisible]);

  // Re-fit when the window or side panel changes size.
  useEffect(() => {
    const el = scroller.current;
    if (!el || zoomMode !== "fit" || !sizes.length) return;
    const ro = new ResizeObserver(() => {
      const s = fitScale();
      if (Math.abs(s - scale) > 0.01) changeScale(s, "fit");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomMode, fitScale, scale, changeScale, sizes.length]);

  /* --------------------------------------------------------------- progress */

  useEffect(() => setPageInput(String(currentPage)), [currentPage]);
  useEffect(() => {
    if (!restored.current || !doc) return;
    const t = setTimeout(() => api.updateDocument(docId, { lastPage: currentPage }), 800);
    return () => clearTimeout(t);
  }, [currentPage, docId, doc]);

  /* ----------------------------------------------------------------- search */

  useEffect(() => {
    if (!pdf || !query.trim()) {
      setHits([]);
      setHitIndex(-1);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const texts = await getAllPageText(pdf);
      if (cancelled) return;
      const found = findHits(texts, query);
      setHits(found);
      setSearching(false);
      setHitIndex(found.length ? 0 : -1);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pdf, query]);

  const currentHit = hitIndex >= 0 ? hits[hitIndex] : undefined;
  useEffect(() => {
    if (currentHit && !visible.has(currentHit.page)) goToPage(currentHit.page);
    // Only when the selected hit changes; the page view scrolls the mark into view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHit]);

  /* -------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setPanelOpen(true);
        setTab("search");
        setTimeout(() => searchInput.current?.select(), 0);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        changeScale(scale * 1.15);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        changeScale(scale / 1.15);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        changeScale(fitScale(), "fit");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scale, changeScale, fitScale]);

  /* ----------------------------------------------------------------- render */

  const crumbs = folderPath(folders, doc?.folderId);
  const backHref = doc ? libraryHref(doc.projectId, doc.folderId) : "/";
  const numPages = pdf?.numPages ?? 0;

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* toolbar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <Link href={backHref} className="icon-btn" title="回到資料夾" aria-label="回到資料夾">
          ←
        </Link>
        <button
          className={`icon-btn ${panelOpen ? "bg-slate-100" : ""}`}
          title="側欄"
          aria-label="切換側欄"
          onClick={() => setPanelOpen((o) => !o)}
        >
          ☰
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" data-testid="doc-title">
            {doc?.title ?? "載入中…"}
          </div>
          {project && (
            <div className="truncate text-xs text-slate-400">
              {project.icon} {project.name}
              {crumbs.map((f) => ` / ${f.name}`).join("")}
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(pageInput, 10);
            if (n) goToPage(n);
          }}
        >
          <input
            aria-label="頁碼"
            className="w-12 rounded border border-slate-300 px-1 py-0.5 text-center"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => setPageInput(String(currentPage))}
          />
          <span className="text-slate-500" data-testid="page-count">
            / {numPages || "–"}
          </span>
        </form>

        <div className="ml-2 flex items-center gap-1 text-sm">
          <button className="icon-btn" aria-label="縮小" onClick={() => changeScale(scale / 1.15)}>
            −
          </button>
          <span className="w-12 text-center tabular-nums" data-testid="zoom-level">
            {Math.round(scale * 100)}%
          </span>
          <button className="icon-btn" aria-label="放大" onClick={() => changeScale(scale * 1.15)}>
            +
          </button>
          <button
            className={`btn ml-1 px-2 py-1 text-xs ${zoomMode === "fit" ? "border-indigo-300 text-indigo-700" : ""}`}
            onClick={() => changeScale(fitScale(), "fit")}
          >
            符合寬度
          </button>
        </div>
        <button
          className="icon-btn"
          title="搜尋 (Ctrl+F)"
          aria-label="搜尋"
          onClick={() => {
            setPanelOpen(true);
            setTab("search");
            setTimeout(() => searchInput.current?.focus(), 0);
          }}
        >
          🔍
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {panelOpen && pdf && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="flex border-b border-slate-200 text-sm">
              {(
                [
                  ["outline", "目錄"],
                  ["thumbs", "縮圖"],
                  ["search", "搜尋"],
                ] as [Tab, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 ${tab === t ? "border-b-2 border-indigo-600 font-medium text-indigo-700" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "outline" && <OutlinePanel pdf={pdf} currentPage={currentPage} onGo={goToPage} />}
              {tab === "thumbs" && (
                <ThumbnailPanel
                  pdf={pdf}
                  aspect={sizes[0] ? sizes[0].width / sizes[0].height : 0.75}
                  currentPage={currentPage}
                  onGo={goToPage}
                />
              )}
              {tab === "search" && (
                <SearchPanel
                  query={query}
                  setQuery={setQuery}
                  hits={hits}
                  searching={searching}
                  current={hitIndex}
                  setCurrent={setHitIndex}
                  inputRef={searchInput}
                />
              )}
            </div>
          </aside>
        )}

        <div ref={scroller} className="relative min-w-0 flex-1 overflow-auto" onScroll={updateVisible} data-testid="pdf-scroller">
          {error && <div className="m-8 rounded-lg bg-red-50 p-4 text-red-700">{error}</div>}
          {!pdf && !error && <div className="p-8 text-center text-slate-500">PDF 載入中…</div>}
          {pdf && (
            <div style={{ paddingTop: PAD, paddingBottom: PAD, minWidth: maxWidth * scale + PAD * 2 }}>
              {sizes.map((s, i) => (
                <PageView
                  key={i}
                  pdf={pdf}
                  pageNumber={i + 1}
                  size={s}
                  scale={scale}
                  active={visible.has(i + 1)}
                  query={query}
                  currentHit={currentHit?.page === i + 1 ? currentHit.index : -1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
