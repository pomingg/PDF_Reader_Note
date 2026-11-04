"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DocumentCard } from "@/components/DocumentCard";
import { ConfirmDialog, MoveDialog, NameDialog } from "@/components/LibraryDialogs";
import {
  api,
  childFolders,
  DND_FOLDER,
  folderPath,
  isInternalDrag,
  libraryHref,
  moveDropped,
  notifyLibraryChanged,
  useLibraryChanged,
} from "@/lib/client";
import type { DocumentItem, Folder, Project } from "@/lib/types";

type DialogState =
  | { kind: "newFolder" }
  | { kind: "rename"; doc: DocumentItem }
  | { kind: "move"; doc: DocumentItem }
  | { kind: "delete"; doc: DocumentItem }
  | null;

export default function LibraryPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}

function Library() {
  const sp = useSearchParams();
  const projectId = sp.get("project") ?? undefined;
  const folderId = sp.get("folder") ?? undefined;
  const view = (sp.get("view") as "all" | "recent" | null) ?? "all";

  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [q, setQ] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [uploading, setUploading] = useState(false);
  const [fileDrag, setFileDrag] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const project = projects.find((p) => p.id === projectId);
  const crumbs = folderPath(folders, folderId);
  const searching = q.trim().length > 0;

  const load = useCallback(() => {
    api.projects().then(setProjects);
    api.folders().then(setFolders);
    const query = searching
      ? scopeAll || !projectId
        ? { q }
        : { projectId, folderId, recursive: true, q }
      : projectId
        ? { projectId, folderId }
        : { view };
    api.documents(query).then(setDocs);
  }, [projectId, folderId, view, q, searching, scopeAll]);
  useEffect(load, [load]);
  useLibraryChanged(load);

  const upload = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return setError("請選擇 PDF 檔");
    setUploading(true);
    setError("");
    try {
      await api.upload(pdfs, { projectId, folderId });
      notifyLibraryChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const subfolders = projectId && !searching ? childFolders(folders, projectId, folderId ?? null) : [];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const locationOf = (d: DocumentItem) =>
    [projectById.get(d.projectId)?.name, ...folderPath(folders, d.folderId).map((f) => f.name)]
      .filter(Boolean)
      .join(" / ");
  const showLocation = !projectId || searching;

  const title = project
    ? (crumbs.at(-1)?.name ?? project.name)
    : projectId
      ? "\u00a0" // still loading
      : view === "recent"
      ? "最近閱讀"
      : "全部文件";

  return (
    <div
      className="relative min-h-full p-8"
      onDragOver={(e) => {
        if (isInternalDrag(e.dataTransfer) || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setFileDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setFileDrag(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setFileDrag(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <div className="mx-auto max-w-5xl">
        {/* breadcrumb */}
        {project && (
          <div className="mb-1 flex flex-wrap items-center gap-1 text-sm text-slate-500">
            <Link href={libraryHref(project.id)} className="hover:text-indigo-600">
              {project.icon} {project.name}
            </Link>
            {crumbs.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <span>/</span>
                <Link href={libraryHref(project.id, f.id)} className="hover:text-indigo-600">
                  {f.name}
                </Link>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-2xl font-bold">{title}</h1>
          {projectId && (
            <button className="btn" onClick={() => setDialog({ kind: "newFolder" })}>
              ＋ 新增資料夾
            </button>
          )}
          {(projectId || view === "all") && (
            <a
              className="btn"
              data-testid="export-scope"
              title="把這裡所有文件的筆記匯出成 Markdown（zip）"
              href={
                projectId
                  ? `/api/export/markdown?projectId=${projectId}${folderId ? `&folderId=${folderId}` : ""}`
                  : "/api/export/markdown?all=1"
              }
              download
            >
              ⬇ 匯出筆記
            </a>
          )}
          <button className="btn btn-primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? "上傳中…" : "⬆ 上傳 PDF"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            data-testid="upload-input"
            onChange={(e) => {
              upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        {project?.description && !folderId && <p className="mt-1 text-sm text-slate-500">{project.description}</p>}
        {!projectId && view === "all" && (
          <p className="mt-1 text-sm text-slate-500">在這裡上傳的文件會放進「未分類」，之後可拖到左側專案。</p>
        )}

        <div className="mt-5 flex items-center gap-3">
          <input
            className="input max-w-sm"
            placeholder={projectId && !scopeAll ? "搜尋此專案的文件名稱…" : "搜尋所有文件名稱…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {projectId && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
              搜尋全部專案
            </label>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {subfolders.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {subfolders.map((f) => (
              <FolderTile key={f.id} folder={f} folders={folders} />
            ))}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {docs.map((d) => (
            <DocumentCard
              key={d.id}
              doc={d}
              project={projectById.get(d.projectId)}
              location={showLocation ? locationOf(d) : undefined}
              menu={[
                { label: "重新命名", onClick: () => setDialog({ kind: "rename", doc: d }) },
                { label: "移動到…", onClick: () => setDialog({ kind: "move", doc: d }) },
                { label: "刪除", danger: true, onClick: () => setDialog({ kind: "delete", doc: d }) },
              ]}
            />
          ))}
        </div>

        {docs.length === 0 && subfolders.length === 0 && (
          <div className="mt-10 rounded-xl border-2 border-dashed border-slate-300 p-12 text-center text-slate-500">
            {searching ? "找不到符合的文件" : view === "recent" && !projectId ? "還沒有閱讀紀錄" : "把 PDF 拖到這裡，或按「上傳 PDF」"}
          </div>
        )}
      </div>

      {fileDrag && (
        <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-2xl border-4 border-dashed border-indigo-400 bg-indigo-50/80 text-lg font-medium text-indigo-700">
          放開以上傳到「{title}」
        </div>
      )}

      {dialog?.kind === "newFolder" && projectId && (
        <NameDialog
          title="新增資料夾"
          label="資料夾名稱"
          onClose={() => setDialog(null)}
          onSubmit={(name) => api.createFolder({ projectId, parentId: folderId ?? null, name })}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title="重新命名文件"
          label="文件名稱"
          initial={dialog.doc.title}
          onClose={() => setDialog(null)}
          onSubmit={(title) => api.updateDocument(dialog.doc.id, { title })}
        />
      )}
      {dialog?.kind === "move" && <MoveDialog doc={dialog.doc} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="刪除文件"
          message={`確定刪除「${dialog.doc.title}」？PDF 檔案會從資料夾中移除，無法復原。`}
          onClose={() => setDialog(null)}
          onConfirm={() => api.deleteDocument(dialog.doc.id)}
        />
      )}
    </div>
  );
}

function FolderTile({ folder: f, folders }: { folder: Folder; folders: Folder[] }) {
  const [over, setOver] = useState(false);
  const nested = childFolders(folders, f.projectId, f.id).length;
  return (
    <Link
      href={libraryHref(f.projectId, f.id)}
      draggable
      data-testid="folder-tile"
      onDragStart={(e) => e.dataTransfer.setData(DND_FOLDER, f.id)}
      onDragOver={(e) => {
        if (!isInternalDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        if (!isInternalDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        try {
          await moveDropped(e.dataTransfer, { projectId: f.projectId, folderId: f.id });
        } catch (err) {
          alert((err as Error).message);
        }
      }}
      className={`flex items-center gap-2 rounded-xl border bg-white p-3 text-sm ${
        over ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200" : "border-slate-200 hover:border-indigo-300"
      }`}
    >
      <span className="text-2xl">📁</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{f.name}</span>
        <span className="text-xs text-slate-400">
          {f.documentCount} 份文件{nested ? `・${nested} 個資料夾` : ""}
        </span>
      </span>
    </Link>
  );
}
