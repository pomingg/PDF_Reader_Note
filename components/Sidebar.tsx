"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  childFolders,
  DND_FOLDER,
  folderPath,
  isInternalDrag,
  libraryHref,
  moveDropped,
  useLibraryChanged,
} from "@/lib/client";
import type { Folder, Project } from "@/lib/types";
import { ConfirmDialog, NameDialog, ProjectDialog } from "./LibraryDialogs";
import { Menu } from "./Menu";

type DialogState =
  | { kind: "newProject" }
  | { kind: "editProject"; project: Project }
  | { kind: "deleteProject"; project: Project }
  | { kind: "newFolder"; projectId: string; parentId: string | null }
  | { kind: "renameFolder"; folder: Folder }
  | { kind: "deleteFolder"; folder: Folder }
  | null;

const EXPANDED_KEY = "pdfnotes:expanded";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Highlights a row while something draggable hovers over it, and moves it on drop. */
function useDropTarget(target: { projectId: string; folderId?: string | null }) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!isInternalDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        try {
          await moveDropped(e.dataTransfer, target);
        } catch (err) {
          alert((err as Error).message);
        }
      },
    },
  };
}

export function Sidebar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);

  const activeProject = pathname === "/library" ? sp.get("project") : null;
  const activeFolder = pathname === "/library" ? sp.get("folder") : null;
  const activeView = pathname === "/library" && !activeProject ? (sp.get("view") ?? "all") : null;

  const load = useCallback(() => {
    Promise.all([api.projects(), api.folders()]).then(([p, f]) => {
      setProjects(p);
      setFolders(f);
    });
  }, []);
  useEffect(load, [load]);
  useLibraryChanged(load);
  useEffect(() => setExpanded(loadExpanded()), []);

  // Keep the path to the active folder open.
  useEffect(() => {
    if (!activeProject) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(activeProject);
      folderPath(folders, activeFolder).forEach((f) => next.add(f.id));
      return next.size === prev.size ? prev : next;
    });
  }, [activeProject, activeFolder, folders]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  const navCls = (active: boolean) =>
    `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
      active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700 hover:bg-slate-100"
    }`;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <Link href="/" className="flex items-center gap-2 px-4 py-4 text-base font-semibold">
        <span className="text-xl">📖</span> PDF 閱讀筆記
      </Link>

      <nav className="space-y-0.5 px-2">
        <Link href="/" className={navCls(pathname === "/")}>
          🏠 首頁
        </Link>
        <Link href="/library?view=all" className={navCls(activeView === "all")}>
          🗂️ 全部文件
        </Link>
        <Link href="/library?view=recent" className={navCls(activeView === "recent")}>
          🕘 最近閱讀
        </Link>
      </nav>

      <div className="mt-4 flex items-center justify-between px-4 pb-1">
        <span className="text-xs font-semibold tracking-wide text-slate-400">專案</span>
        <button
          className="rounded px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-100"
          title="新增專案"
          aria-label="新增專案"
          onClick={() => setDialog({ kind: "newProject" })}
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {projects.map((p) => (
          <ProjectNode
            key={p.id}
            project={p}
            folders={folders}
            expanded={expanded}
            toggle={toggle}
            activeProject={activeProject}
            activeFolder={activeFolder}
            setDialog={setDialog}
          />
        ))}
      </div>

      {dialog?.kind === "newProject" && (
        <ProjectDialog onClose={() => setDialog(null)} onSaved={(p) => router.push(libraryHref(p.id))} />
      )}
      {dialog?.kind === "editProject" && (
        <ProjectDialog project={dialog.project} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "deleteProject" && (
        <ConfirmDialog
          title="刪除專案"
          message={`確定刪除「${dialog.project.name}」？專案內的資料夾會一併刪除，文件會移到「未分類」，不會被刪掉。`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteProject(dialog.project.id);
            if (activeProject === dialog.project.id) router.push("/");
          }}
        />
      )}
      {dialog?.kind === "newFolder" && (
        <NameDialog
          title="新增資料夾"
          label="資料夾名稱"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const f = await api.createFolder({ projectId: dialog.projectId, parentId: dialog.parentId, name });
            setExpanded((prev) => new Set(prev).add(dialog.projectId).add(dialog.parentId ?? dialog.projectId));
            router.push(libraryHref(f.projectId, f.id));
          }}
        />
      )}
      {dialog?.kind === "renameFolder" && (
        <NameDialog
          title="重新命名資料夾"
          label="資料夾名稱"
          initial={dialog.folder.name}
          onClose={() => setDialog(null)}
          onSubmit={(name) => api.updateFolder(dialog.folder.id, { name })}
        />
      )}
      {dialog?.kind === "deleteFolder" && (
        <ConfirmDialog
          title="刪除資料夾"
          message={`確定刪除「${dialog.folder.name}」及其子資料夾？裡面的文件會移到專案最上層，不會被刪掉。`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteFolder(dialog.folder.id);
            if (activeFolder) router.push(libraryHref(dialog.folder.projectId));
          }}
        />
      )}
    </aside>
  );
}

interface TreeProps {
  folders: Folder[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  activeProject: string | null;
  activeFolder: string | null;
  setDialog: (d: DialogState) => void;
}

function Caret({ open, visible, onClick }: { open: boolean; visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={open ? "收合" : "展開"}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] text-slate-400 hover:bg-slate-200 ${
        visible ? "" : "invisible"
      }`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {open ? "▼" : "▶"}
    </button>
  );
}

function ProjectNode({ project: p, ...tree }: TreeProps & { project: Project }) {
  const drop = useDropTarget({ projectId: p.id, folderId: null });
  const children = childFolders(tree.folders, p.id, null);
  const open = tree.expanded.has(p.id);
  const active = tree.activeProject === p.id && !tree.activeFolder;

  return (
    <div>
      <Link
        href={libraryHref(p.id)}
        {...drop.props}
        className={`group flex items-center gap-1 rounded-lg px-1 py-1 text-sm ${
          drop.over ? "bg-indigo-100 ring-2 ring-indigo-300" : active ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-100"
        }`}
      >
        <Caret open={open} visible={children.length > 0} onClick={() => tree.toggle(p.id)} />
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
        <span>{p.icon}</span>
        <span className={`flex-1 truncate ${active ? "font-medium" : ""}`}>{p.name}</span>
        <span className="text-xs text-slate-400 group-hover:hidden">{p.documentCount || ""}</span>
        <Menu
          className="hidden group-hover:block"
          items={[
            { label: "新增資料夾", onClick: () => tree.setDialog({ kind: "newFolder", projectId: p.id, parentId: null }) },
            { label: "編輯專案", onClick: () => tree.setDialog({ kind: "editProject", project: p }) },
            ...(p.isSystem
              ? []
              : [{ label: "刪除專案", danger: true, onClick: () => tree.setDialog({ kind: "deleteProject", project: p }) }]),
          ]}
        />
      </Link>
      {open && (
        <div className="ml-3 border-l border-slate-100 pl-1">
          {children.map((f) => (
            <FolderNode key={f.id} folder={f} {...tree} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderNode({ folder: f, ...tree }: TreeProps & { folder: Folder }) {
  const drop = useDropTarget({ projectId: f.projectId, folderId: f.id });
  const children = childFolders(tree.folders, f.projectId, f.id);
  const open = tree.expanded.has(f.id);
  const active = tree.activeFolder === f.id;

  return (
    <div>
      <Link
        href={libraryHref(f.projectId, f.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_FOLDER, f.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        {...drop.props}
        className={`group flex items-center gap-1 rounded-lg px-1 py-1 text-sm ${
          drop.over ? "bg-indigo-100 ring-2 ring-indigo-300" : active ? "bg-indigo-50 font-medium text-indigo-700" : "hover:bg-slate-100"
        }`}
      >
        <Caret open={open} visible={children.length > 0} onClick={() => tree.toggle(f.id)} />
        <span>{open && children.length ? "📂" : "📁"}</span>
        <span className="flex-1 truncate">{f.name}</span>
        <span className="text-xs text-slate-400 group-hover:hidden">{f.documentCount || ""}</span>
        <Menu
          className="hidden group-hover:block"
          items={[
            { label: "新增子資料夾", onClick: () => tree.setDialog({ kind: "newFolder", projectId: f.projectId, parentId: f.id }) },
            { label: "重新命名", onClick: () => tree.setDialog({ kind: "renameFolder", folder: f }) },
            { label: "刪除資料夾", danger: true, onClick: () => tree.setDialog({ kind: "deleteFolder", folder: f }) },
          ]}
        />
      </Link>
      {open && children.length > 0 && (
        <div className="ml-3 border-l border-slate-100 pl-1">
          {children.map((c) => (
            <FolderNode key={c.id} folder={c} {...tree} />
          ))}
        </div>
      )}
    </div>
  );
}
