"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, folderPath, libraryHref, useLibraryChanged } from "@/lib/client";
import { DEFAULT_COLORS, type Annotation, type ColorDef, type DocumentItem, type Folder, type Project } from "@/lib/types";
import { NotesPanel } from "./NotesPanel";

const SOURCE_LABEL: Record<string, string> = { hyread: "HyRead" };

/**
 * An ebook read in another app (e.g. HyRead): there is no file to show, so the
 * page is the list of highlights and notes, editable like any other notes.
 */
export function EbookView({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [colors, setColors] = useState<ColorDef[]>(DEFAULT_COLORS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .document(docId)
      .then((d) => {
        setDoc(d);
        api.projects().then((ps) => setProject(ps.find((p) => p.id === d.projectId) ?? null));
        api.folders(d.projectId).then(setFolders);
        api.updateDocument(docId, { opened: true });
      })
      .catch((e) => setError((e as Error).message));
    api.annotations(docId).then(setAnnotations);
  }, [docId]);
  useEffect(load, [load]);
  useEffect(() => {
    api.colors().then(setColors);
  }, []);
  // New highlights arriving from a sync show up without reloading.
  useLibraryChanged(load);
  useEffect(() => {
    const t = setInterval(() => api.annotations(docId).then(setAnnotations), 15000);
    return () => clearInterval(t);
  }, [docId]);

  const update = useCallback((id: string, patch: { color?: string; comment?: string; tags?: string[] }) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    api.updateAnnotation(id, patch).catch((e) => setError((e as Error).message));
  }, []);

  const crumbs = folderPath(folders, doc?.folderId);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <Link href={doc ? libraryHref(doc.projectId, doc.folderId) : "/"} className="icon-btn" aria-label="回到資料夾">
          ←
        </Link>
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
        <a
          className="icon-btn"
          title="匯出這本書的筆記（Markdown）"
          aria-label="匯出筆記"
          href={`/api/export/markdown?documentId=${docId}`}
          download
        >
          ⬇
        </a>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {doc && (
          <div className="mb-4 flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-orange-400 text-sm font-bold text-white">
              書
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold">{doc.title}</h1>
              {doc.author && <p className="text-sm text-slate-600">{doc.author}</p>}
              <p className="mt-1 text-xs text-slate-400">
                {doc.source ? `從 ${SOURCE_LABEL[doc.source] ?? doc.source} 同步` : "電子書筆記"}・{annotations.length} 則筆記・
                在原本的 App 畫重點後會自動同步過來
              </p>
            </div>
          </div>
        )}
        <div className="h-[calc(100vh-14rem)] min-h-96 overflow-hidden rounded-xl border border-slate-200 bg-slate-50" data-testid="notes-panel">
          <NotesPanel
            annotations={annotations}
            colors={colors}
            setColors={setColors}
            selectedId={selectedId}
            focusId={focusId}
            currentPage={0}
            onSelect={(a) => setSelectedId(a.id)}
            onUpdate={update}
            onDelete={(id) => {
              setAnnotations((prev) => prev.filter((a) => a.id !== id));
              setSelectedId(null);
              api.deleteAnnotation(id).catch((e) => setError((e as Error).message));
            }}
            onAddNote={async (page) => {
              const a = await api.createAnnotation(docId, { type: "note", page });
              setAnnotations((prev) => [a, ...prev]);
              setSelectedId(a.id);
              setFocusId(a.id);
            }}
          />
        </div>
      </main>
    </div>
  );
}
