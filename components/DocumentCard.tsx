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
        <div className="truncate font-medium text-slate-800">{doc.title}</div>
        {location && <div className="truncate text-xs text-slate-500">{location}</div>}
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
          <span>{doc.pageCount ? `${doc.pageCount} 頁` : "—"}</span>
          <span>{formatSize(doc.size)}</span>
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
