"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatTime, notifyLibraryChanged, useLibraryChanged } from "@/lib/client";
import type { LinkedFolder, Project } from "@/lib/types";

/** Manage the computer folders whose PDFs are opened in place. */
export function LinkedFoldersSection() {
  const [folders, setFolders] = useState<LinkedFolder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(() => {
    api.linkedFolders().then(setFolders);
    api.projects().then(setProjects);
  }, []);
  useEffect(load, [load]);
  useLibraryChanged(load);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="linked-section">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">📂 已連結的電腦資料夾</h2>
        {folders.length > 0 && (
          <button
            className="btn text-xs"
            onClick={async () => {
              const r = await api.scanLinked(true);
              setMessage(`重新整理完成：新增 ${r.added}、更新 ${r.updated}、找回 ${r.relinked}、找不到 ${r.missing} 份`);
              notifyLibraryChanged();
            }}
          >
            全部重新整理
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        連結的資料夾裡的 PDF 會直接開啟原檔，不會複製；新增、修改或搬移的檔案會自動同步。要連結新資料夾，請到專案頁按「📂 連結電腦資料夾」。
      </p>
      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
      <div className="mt-3 divide-y divide-slate-100 text-sm">
        {folders.map((f) => (
          <div key={f.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">{f.path}</div>
              <div className="text-xs text-slate-400">
                放在「{projectName(f.projectId)}」・{f.documentCount} 份 PDF・上次掃描 {formatTime(f.scannedAt)}
              </div>
            </div>
            <button
              className="btn text-xs"
              onClick={async () => {
                if (!confirm("停止連結這個資料夾？已加入的文件與筆記會保留，只是之後不再自動同步新檔案。")) return;
                await api.unlinkFolder(f.id);
                notifyLibraryChanged();
              }}
            >
              停止連結
            </button>
          </div>
        ))}
        {!folders.length && <p className="py-3 text-center text-slate-400">還沒有連結任何資料夾</p>}
      </div>
    </section>
  );
}
