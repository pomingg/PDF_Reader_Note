"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, folderPath, libraryHref } from "@/lib/client";
import {
  DEFAULT_COLORS,
  type Annotation,
  type ColorDef,
  type DocumentItem,
  type Folder,
  type NewAnnotation,
  type NormRect,
  type Project,
} from "@/lib/types";
import { Menu } from "@/components/Menu";
import { extractPdfAnnotations } from "./importPdfAnnotations";
import { colorHex, NotesPanel } from "./NotesPanel";
import { pageBox, PageView, snapToDevice, type PageHighlight, type PageSize } from "./PageView";
import { readSelection, type TextSelection } from "./selection";
import { SelectionToolbar } from "./SelectionToolbar";
import { openPdf, type PDFDocumentProxy } from "./pdfjs";
import { findHits, getAllPageText, OutlinePanel, SearchPanel, ThumbnailPanel, type SearchHit } from "./SidePanels";

const GAP = 16;
const PAD = 24;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
type Tab = "outline" | "thumbs" | "search";
type ZoomMode = "fit" | "manual";
const NO_HIGHLIGHTS: PageHighlight[] = [];

/** Document notes first, then by page and position on the page. */
function sortAnnotations(list: Annotation[]) {
  const key = (a: Annotation) => [a.page ?? 0, a.rects[0]?.y ?? -1, a.rects[0]?.x ?? 0, a.createdAt];
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

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

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [colors, setColors] = useState<ColorDef[]>(DEFAULT_COLORS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [areaMode, setAreaMode] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [textSel, setTextSel] = useState<TextSelection | null>(null);
  const [noteError, setNoteError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);

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
        api.annotations(docId).then((a) => !cancelled && setAnnotations(sortAnnotations(a)));
        api.colors().then((c) => !cancelled && setColors(c));

        const opened = await openPdf(`/api/documents/${docId}/file?v=${d.fileVersion}`);
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

  // Device pixel ratio changes when the window moves to another screen or the browser zoom changes.
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const update = () => {
      setDpr(window.devicePixelRatio || 1);
      mq?.removeEventListener("change", update);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener("change", update);
    };
    update();
    return () => mq?.removeEventListener("change", update);
  }, []);

  // Width and screen position of the scroll area, used to centre pages on whole device pixels.
  const [view, setView] = useState({ width: 0, originX: 0 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ width: el.clientWidth, originX: el.getBoundingClientRect().left });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf]);

  /** Page sizes on screen, snapped to device pixels so pages render sharply. */
  const boxes = useMemo(() => sizes.map((s) => pageBox(s, scale, dpr)), [sizes, scale, dpr]);

  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = PAD;
    for (const b of boxes) {
      out.push(y);
      y += b.h + GAP;
    }
    return out;
  }, [boxes]);

  const contentWidth = useMemo(
    () => Math.max(view.width, Math.max(0, ...boxes.map((b) => b.w)) + PAD * 2),
    [boxes, view.width],
  );
  const pageLeft = useCallback(
    (w: number) => snapToDevice(view.originX + Math.max(PAD, (contentWidth - w) / 2), dpr) - view.originX,
    [contentWidth, dpr, view.originX],
  );

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
        const h = boxes[page - 1].h + GAP;
        anchor.current = { page, frac: (el.scrollTop - offsets[page - 1]) / h };
      }
      setZoomMode(mode);
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 100) / 100)));
    },
    [offsets, pageAt, boxes],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (el && a && offsets.length) {
      el.scrollTop = offsets[a.page - 1] + a.frac * (boxes[a.page - 1].h + GAP);
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

  /* ------------------------------------------------------------------ notes */

  const pageHighlights = useMemo(() => {
    const map = new Map<number, PageHighlight[]>();
    for (const a of annotations) {
      if (a.type === "note") continue;
      const hex = colorHex(colors, a.color);
      const byPage = new Map<number, NormRect[]>();
      for (const r of a.rects) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
      for (const [page, rects] of byPage) {
        map.set(page, [...(map.get(page) ?? []), { id: a.id, type: a.type, hex, rects, imported: a.origin === "pdf" }]);
      }
    }
    return map;
  }, [annotations, colors]);

  /**
   * Bring in highlights / notes that other PDF apps saved inside the file.
   * Runs by itself the first time a file version is opened; also from the notes panel.
   */
  const importFromPdf = useCallback(
    async (manual: boolean) => {
      if (!pdf || !doc) return;
      setImporting(true);
      try {
        const items = await extractPdfAnnotations(pdf);
        const res = await api.importAnnotations(docId, items, doc.fileVersion);
        if (res.created.length) setAnnotations((prev) => sortAnnotations([...prev, ...res.created]));
        setDoc((d) => (d ? { ...d, needsAnnotationScan: false } : d));
        if (manual || res.created.length) {
          setNotice(
            res.created.length
              ? `已從 PDF 匯入 ${res.created.length} 則註解${res.skipped ? `（略過 ${res.skipped} 則重複）` : ""}`
              : items.length
                ? `PDF 中的 ${items.length} 則註解都已匯入過`
                : "這份 PDF 沒有其他軟體留下的註解",
          );
          setNotesOpen(true);
        }
      } catch (e) {
        report(e);
      } finally {
        setImporting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdf, doc?.fileVersion, docId],
  );
  const autoImported = useRef(false);
  useEffect(() => {
    if (pdf && doc?.needsAnnotationScan && !autoImported.current) {
      autoImported.current = true;
      importFromPdf(false);
    }
  }, [pdf, doc?.needsAnnotationScan, importFromPdf]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const report = (e: unknown) => {
    setNoteError((e as Error).message || "儲存失敗");
    setTimeout(() => setNoteError(""), 4000);
  };

  const addAnnotation = useCallback(
    async (input: NewAnnotation, opts: { select?: boolean; focus?: boolean } = {}) => {
      try {
        const a = await api.createAnnotation(docId, input);
        setAnnotations((prev) => sortAnnotations([...prev, a]));
        if (opts.select) {
          setNotesOpen(true);
          setSelectedId(a.id);
        }
        if (opts.focus) setFocusId(a.id);
        return a;
      } catch (e) {
        report(e);
      }
    },
    [docId],
  );

  const highlightSelection = useCallback(
    async (color: string, withNote = false) => {
      const sel = textSel;
      if (!sel) return;
      window.getSelection()?.removeAllRanges();
      setTextSel(null);
      await addAnnotation(
        { type: "highlight", color, rects: sel.rects, quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix },
        { select: withNote, focus: withNote },
      );
    },
    [textSel, addAnnotation],
  );

  const onArea = useCallback(
    (page: number, rect: NormRect, image: string) => {
      setAreaMode(false);
      addAnnotation({ type: "area", color: colors[0].key, rects: [rect], image }, { select: true, focus: true });
    },
    [addAnnotation, colors],
  );

  const onPick = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setNotesOpen(true);
  }, []);

  const updateNote = useCallback((id: string, patch: { color?: string; comment?: string; tags?: string[] }) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    api
      .updateAnnotation(id, patch)
      .then((saved) => setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...saved, comment: a.comment } : a))))
      .catch(report);
  }, []);

  const deleteNote = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setSelectedId(null);
    api.deleteAnnotation(id).catch(report);
  }, []);

  /** Scroll an annotation into view and blink it. */
  const jumpTo = useCallback(
    (a: Annotation) => {
      const el = scroller.current;
      const r = a.rects[0];
      if (el && r && offsets.length) {
        el.scrollTop = offsets[r.page - 1] + r.y * boxes[r.page - 1].h - el.clientHeight * 0.3;
        setFlash({ id: a.id, n: Date.now() });
      } else if (a.page) goToPage(a.page);
    },
    [offsets, sizes, scale, goToPage],
  );
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  // Track the text selection to show the colour toolbar.
  const refreshSelection = useCallback(() => {
    if (scroller.current) setTextSel(readSelection(scroller.current));
  }, []);
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setTextSel(null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

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
      } else if (mod || e.altKey || isTyping(e)) {
        return;
      } else if (textSel && /^[1-4]$/.test(e.key) && colors[Number(e.key) - 1]) {
        e.preventDefault();
        highlightSelection(colors[Number(e.key) - 1].key);
      } else if (textSel && e.key.toLowerCase() === "n") {
        e.preventDefault();
        highlightSelection(colors[0].key, true);
      } else if (e.key.toLowerCase() === "a" && pdf) {
        e.preventDefault();
        setAreaMode((m) => !m);
      } else if (e.key === "Escape") {
        setAreaMode(false);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scale, changeScale, fitScale, textSel, colors, highlightSelection, pdf]);

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
        <button
          className={`btn px-2 py-1 text-xs ${areaMode ? "border-indigo-500 bg-indigo-50 text-indigo-700" : ""}`}
          aria-pressed={areaMode}
          title="框選圖表或公式（A）"
          onClick={() => setAreaMode((m) => !m)}
        >
          ⬚ 框選
        </button>
        <button
          className={`btn px-2 py-1 text-xs ${notesOpen ? "border-indigo-300 text-indigo-700" : ""}`}
          aria-label="切換筆記側欄"
          onClick={() => setNotesOpen((o) => !o)}
        >
          📝 筆記 {annotations.length || ""}
        </button>
        <Menu
          trigger="⬇"
          triggerClassName="icon-btn"
          label="匯出"
          items={[
            {
              label: "匯出筆記（Markdown）",
              onClick: () => (window.location.href = `/api/export/markdown?documentId=${docId}`),
            },
            {
              label: "下載含重點的 PDF",
              onClick: () => (window.location.href = `/api/documents/${docId}/annotated-pdf`),
            },
          ]}
        />
      </header>
      {areaMode && (
        <div className="bg-indigo-600 py-1 text-center text-xs text-white">
          框選模式：在頁面上拖曳出範圍即可擷取（Esc 取消）
        </div>
      )}
      {noteError && <div className="bg-red-600 py-1 text-center text-xs text-white">{noteError}</div>}
      {notice && (
        <div className="bg-emerald-600 py-1 text-center text-xs text-white" data-testid="notice">
          {notice}
        </div>
      )}

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

        <div
          ref={scroller}
          className="relative min-w-0 flex-1 overflow-auto"
          onScroll={() => {
            updateVisible();
            if (textSel) refreshSelection();
          }}
          onMouseUp={() => setTimeout(refreshSelection, 0)}
          onKeyUp={(e) => e.shiftKey && refreshSelection()}
          data-testid="pdf-scroller"
        >
          {error && <div className="m-8 rounded-lg bg-red-50 p-4 text-red-700">{error}</div>}
          {!pdf && !error && <div className="p-8 text-center text-slate-500">PDF 載入中…</div>}
          {pdf && (
            <div style={{ paddingTop: PAD, paddingBottom: PAD, width: contentWidth }}>
              {sizes.map((s, i) => (
                <PageView
                  key={i}
                  pdf={pdf}
                  pageNumber={i + 1}
                  size={s}
                  scale={scale}
                  dpr={dpr}
                  left={pageLeft(boxes[i]?.w ?? 0)}
                  active={visible.has(i + 1)}
                  query={query}
                  currentHit={currentHit?.page === i + 1 ? currentHit.index : -1}
                  highlights={pageHighlights.get(i + 1) ?? NO_HIGHLIGHTS}
                  selectedId={selectedId}
                  flash={flash}
                  areaMode={areaMode}
                  onArea={onArea}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </div>

        {notesOpen && pdf && (
          <aside className="w-80 shrink-0 border-l border-slate-200 bg-slate-50" data-testid="notes-panel">
            <NotesPanel
              annotations={annotations}
              colors={colors}
              setColors={setColors}
              selectedId={selectedId}
              focusId={focusId}
              currentPage={currentPage}
              onSelect={(a) => {
                setSelectedId(a.id);
                jumpTo(a);
              }}
              onUpdate={updateNote}
              onDelete={deleteNote}
              onAddNote={(page) => addAnnotation({ type: "note", page }, { select: true, focus: true })}
              onImport={() => importFromPdf(true)}
              importing={importing}
            />
          </aside>
        )}
      </div>

      {textSel && !areaMode && (
        <SelectionToolbar
          anchor={textSel.anchor}
          colors={colors}
          onColor={(c) => highlightSelection(c)}
          onNote={() => highlightSelection(colors[0].key, true)}
          onCopy={() => {
            navigator.clipboard?.writeText(textSel.quote);
            window.getSelection()?.removeAllRanges();
            setTextSel(null);
          }}
        />
      )}
    </div>
  );
}
