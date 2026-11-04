"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DocumentCard } from "@/components/DocumentCard";
import { ProjectDialog } from "@/components/LibraryDialogs";
import { api, formatTime, libraryHref, useLibraryChanged } from "@/lib/client";
import type { DocumentItem, Project } from "@/lib/types";

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [recent, setRecent] = useState<DocumentItem[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.projects().then(setProjects);
    api.documents({ view: "recent" }).then((d) => setRecent(d.slice(0, 6)));
  }, []);
  useEffect(load, [load]);
  useLibraryChanged(load);
  const byId = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-bold">我的專案</h1>
      <p className="mt-1 text-sm text-slate-500">依主題分類你的 PDF，之後的筆記與 AI 問答也會依專案分區。</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={libraryHref(p.id)}
            data-testid="project-card"
            className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-md"
            style={{ borderTop: `4px solid ${p.color}` }}
          >
            <div className="flex items-center gap-2 text-lg font-semibold">
              <span>{p.icon}</span>
              <span className="truncate">{p.name}</span>
            </div>
            <p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{p.description || " "}</p>
            <div className="mt-3 flex justify-between text-xs text-slate-400">
              <span>
                {p.documentCount} 份文件{p.annotationCount ? `・${p.annotationCount} 則筆記` : ""}
              </span>
              <span>{p.lastOpenedAt ? `最近閱讀：${formatTime(p.lastOpenedAt)}` : ""}</span>
            </div>
          </Link>
        ))}
        <button
          onClick={() => setCreating(true)}
          className="flex min-h-36 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
        >
          ＋ 新增專案
        </button>
      </div>

      {recent.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">最近閱讀</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {recent.map((d) => (
              <DocumentCard key={d.id} doc={d} project={byId.get(d.projectId)} location={byId.get(d.projectId)?.name} />
            ))}
          </div>
        </>
      )}

      {creating && <ProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
