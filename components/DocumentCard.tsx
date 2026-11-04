"use client";

import Link from "next/link";
import { DND_DOC, formatSize, formatTime } from "@/lib/client";
import type { DocumentItem, Project } from "@/lib/types";
import { Menu, type MenuItem } from "./Menu";

export function DocumentCard({
  doc,
  project,
  location,
  menu,
}: {
  doc: DocumentItem;
  project?: Project;
  /** Human readable location shown under the title (e.g. in "all" or search views). */
  location?: string;
  menu?: MenuItem[];
}) {
  const progress = doc.pageCount ? Math.min(1, doc.lastPage / doc.pageCount) : 0;
  return (
    <Link
      href={`/read/${doc.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_DOC, doc.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-testid="doc-card"
      className="group relative flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300 hover:shadow-sm"
    >
      <div
        className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
        style={{ background: project?.color ?? "#94a3b8" }}
      >
        PDF
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-slate-800">{doc.title}</span>
          {doc.localPath && !doc.missing && (
            <span className="shrink-0 text-xs text-sky-600" title={`直接開啟電腦裡的檔案：${doc.localPath}`}>
              🔗
            </span>
          )}
          {doc.missing && (
            <span className="shrink-0 rounded bg-red-100 px-1 text-xs text-red-700" title={doc.localPath ?? ""}>
              找不到檔案
            </span>
          )}
        </div>
        {location && <div className="truncate text-xs text-slate-500">{location}</div>}
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
          <span>{doc.pageCount ? `${doc.pageCount} 頁` : "—"}</span>
          <span>{formatSize(doc.size)}</span>
          {doc.annotationCount > 0 && <span className="text-indigo-500">📝 {doc.annotationCount}</span>}
          <span>{formatTime(doc.lastOpenedAt)}</span>
        </div>
        {doc.lastOpenedAt && doc.pageCount ? (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-slate-100" title={`讀到第 ${doc.lastPage} 頁`}>
            <div className="h-full bg-indigo-400" style={{ width: `${progress * 100}%` }} />
          </div>
        ) : null}
      </div>
      {menu && <Menu items={menu} className="opacity-0 group-hover:opacity-100" />}
    </Link>
  );
}
