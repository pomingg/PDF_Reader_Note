"use client";

import { useEffect } from "react";
import type {
  Annotation,
  ColorDef,
  DocumentItem,
  DocumentQuery,
  Folder,
  ImportedAnnotation,
  ImportResult,
  NewAnnotation,
  Project,
  Tag,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `請求失敗（${res.status}）`);
  return data as T;
}

const send = <T>(method: string, url: string, body?: unknown) =>
  request<T>(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** Tell every mounted view (sidebar, lists) that library data changed. */
export function notifyLibraryChanged() {
  window.dispatchEvent(new Event("library:changed"));
}

export const api = {
  projects: () => request<Project[]>("/api/projects"),
  createProject: (p: { name: string; color?: string; icon?: string; description?: string }) =>
    send<Project>("POST", "/api/projects", p),
  updateProject: (id: string, p: Partial<Project>) => send<Project>("PATCH", `/api/projects/${id}`, p),
  deleteProject: (id: string) => send("DELETE", `/api/projects/${id}`),

  folders: (projectId?: string) =>
    request<Folder[]>(`/api/folders${projectId ? `?projectId=${projectId}` : ""}`),
  createFolder: (f: { projectId: string; parentId?: string | null; name: string }) =>
    send<Folder>("POST", "/api/folders", f),
  updateFolder: (id: string, f: { name?: string; parentId?: string | null; projectId?: string }) =>
    send<Folder>("PATCH", `/api/folders/${id}`, f),
  deleteFolder: (id: string) => send("DELETE", `/api/folders/${id}`),

  documents: (q: DocumentQuery) => {
    const sp = new URLSearchParams();
    if (q.view) sp.set("view", q.view);
    if (q.projectId) sp.set("projectId", q.projectId);
    if (q.folderId) sp.set("folderId", q.folderId);
    if (q.recursive) sp.set("recursive", "1");
    if (q.q) sp.set("q", q.q);
    return request<DocumentItem[]>(`/api/documents?${sp}`);
  },
  document: (id: string) => request<DocumentItem>(`/api/documents/${id}`),
  updateDocument: (
    id: string,
    p: { title?: string; projectId?: string; folderId?: string | null; pageCount?: number; lastPage?: number; opened?: boolean },
  ) => send<DocumentItem>("PATCH", `/api/documents/${id}`, p),
  deleteDocument: (id: string) => send("DELETE", `/api/documents/${id}`),
  annotations: (documentId: string) => request<Annotation[]>(`/api/documents/${documentId}/annotations`),
  createAnnotation: (documentId: string, a: NewAnnotation) =>
    send<Annotation>("POST", `/api/documents/${documentId}/annotations`, a),
  updateAnnotation: (id: string, p: { color?: string; comment?: string; tags?: string[]; page?: number | null }) =>
    send<Annotation>("PATCH", `/api/annotations/${id}`, p),
  deleteAnnotation: (id: string) => send("DELETE", `/api/annotations/${id}`),
  importAnnotations: (documentId: string, items: ImportedAnnotation[], fileVersion?: number) =>
    send<ImportResult>("POST", `/api/documents/${documentId}/annotations/import`, { items, fileVersion }),
  replaceFile: (documentId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<DocumentItem>(`/api/documents/${documentId}/file`, { method: "PUT", body: form });
  },
  tags: () => request<Tag[]>("/api/tags"),
  colors: () => request<ColorDef[]>("/api/settings/colors"),
  saveColors: (c: ColorDef[]) => send<ColorDef[]>("PUT", "/api/settings/colors", c),

  upload: (files: File[], target: { projectId?: string; folderId?: string }) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (target.projectId) form.set("projectId", target.projectId);
    if (target.folderId) form.set("folderId", target.folderId);
    return request<DocumentItem[]>("/api/documents", { method: "POST", body: form });
  },
};

/* ------------------------------------------------------------ drag & drop */

export const DND_DOC = "application/x-pdfnotes-doc";
export const DND_FOLDER = "application/x-pdfnotes-folder";

/** Move whatever was dropped (a document or a folder) into a project or folder. */
export async function moveDropped(
  dt: DataTransfer,
  target: { projectId: string; folderId?: string | null },
) {
  const docId = dt.getData(DND_DOC);
  const folderId = dt.getData(DND_FOLDER);
  if (docId) {
    await api.updateDocument(docId, target.folderId ? { folderId: target.folderId } : { projectId: target.projectId, folderId: null });
  } else if (folderId) {
    if (folderId === target.folderId) return;
    await api.updateFolder(folderId, { projectId: target.projectId, parentId: target.folderId ?? null });
  } else return;
  notifyLibraryChanged();
}

export const isInternalDrag = (dt: DataTransfer) =>
  dt.types.includes(DND_DOC) || dt.types.includes(DND_FOLDER);

/* ---------------------------------------------------------------- helpers */

export function folderPath(folders: Folder[], folderId: string | null | undefined): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  let cur = folderId ? byId.get(folderId) : undefined;
  while (cur && out.length < 50) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

export function childFolders(folders: Folder[], projectId: string, parentId: string | null) {
  return folders.filter((f) => f.projectId === projectId && f.parentId === parentId);
}

export function libraryHref(projectId?: string, folderId?: string | null) {
  if (folderId) return `/library?project=${projectId}&folder=${folderId}`;
  if (projectId) return `/library?project=${projectId}`;
  return "/library";
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(ts: number | null) {
  if (!ts) return "尚未閱讀";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString("zh-TW");
}

/** Re-run `load` whenever the library changes. */
export function useLibraryChanged(load: () => void) {
  useEffect(() => {
    window.addEventListener("library:changed", load);
    return () => window.removeEventListener("library:changed", load);
  }, [load]);
}
