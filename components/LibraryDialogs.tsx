"use client";

import { useEffect, useState } from "react";
import { api, childFolders, notifyLibraryChanged } from "@/lib/client";
import type { DocumentItem, Folder, Project } from "@/lib/types";
import { Dialog, Field } from "./Dialog";

export const PROJECT_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];
export const PROJECT_ICONS = ["📁", "📚", "🔬", "💼", "💰", "🧠", "📝", "⚖️", "🏥", "💻", "🎓", "🌏"];

function useAsyncSubmit(onDone: () => void) {
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      notifyLibraryChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { error, run };
}

const ErrorText = ({ error }: { error: string }) =>
  error ? <p className="text-sm text-red-600">{error}</p> : null;

export function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved?: (p: Project) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [icon, setIcon] = useState(project?.icon ?? PROJECT_ICONS[0]);
  const { error, run } = useAsyncSubmit(onClose);

  return (
    <Dialog
      title={project ? "編輯專案" : "新增專案"}
      submitLabel={project ? "儲存" : "建立"}
      onClose={onClose}
      onSubmit={() =>
        run(async () => {
          const body = { name, description, color, icon };
          const saved = project ? await api.updateProject(project.id, body) : await api.createProject(body);
          onSaved?.(saved);
        })
      }
    >
      <Field label="名稱">
        <input
          className="input"
          value={name}
          disabled={project?.isSystem}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：論文研究"
        />
      </Field>
      <Field label="說明（選填）">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="圖示">
        <div className="flex flex-wrap gap-1">
          {PROJECT_ICONS.map((i) => (
            <button
              type="button"
              key={i}
              aria-label={`圖示 ${i}`}
              onClick={() => setIcon(i)}
              className={`h-9 w-9 rounded-lg text-lg ${icon === i ? "bg-indigo-100 ring-2 ring-indigo-400" : "hover:bg-slate-100"}`}
            >
              {i}
            </button>
          ))}
        </div>
      </Field>
      <Field label="顏色">
        <div className="flex gap-2">
          {PROJECT_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={`顏色 ${c}`}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-offset-2 ring-slate-500" : ""}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      <ErrorText error={error} />
    </Dialog>
  );
}

export function NameDialog({
  title,
  label,
  initial = "",
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const { error, run } = useAsyncSubmit(onClose);
  return (
    <Dialog title={title} onClose={onClose} onSubmit={() => run(() => onSubmit(name))}>
      <Field label={label}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <ErrorText error={error} />
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "刪除",
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
}) {
  const { error, run } = useAsyncSubmit(onClose);
  return (
    <Dialog title={title} danger submitLabel={confirmLabel} onClose={onClose} onSubmit={() => run(onConfirm)}>
      <p className="text-sm text-slate-600">{message}</p>
      <ErrorText error={error} />
    </Dialog>
  );
}

/** Every place a document can live, as indented options: project, then its folder tree. */
export function useLocationOptions() {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    Promise.all([api.projects(), api.folders()]).then(([projects, folders]) => {
      const out: { value: string; label: string }[] = [];
      const walk = (p: Project, parent: string | null, depth: number) => {
        for (const f of childFolders(folders, p.id, parent)) {
          out.push({ value: `${p.id}/${f.id}`, label: `${"　".repeat(depth)}📂 ${f.name}` });
          walk(p, f.id, depth + 1);
        }
      };
      for (const p of projects) {
        out.push({ value: `${p.id}/`, label: `${p.icon} ${p.name}` });
        walk(p, null, 1);
      }
      setOptions(out);
    });
  }, []);
  return options;
}

export function MoveDialog({ doc, onClose }: { doc: DocumentItem; onClose: () => void }) {
  const options = useLocationOptions();
  const [value, setValue] = useState(`${doc.projectId}/${doc.folderId ?? ""}`);
  const { error, run } = useAsyncSubmit(onClose);
  return (
    <Dialog
      title={`移動「${doc.title}」`}
      submitLabel="移動"
      onClose={onClose}
      onSubmit={() =>
        run(() => {
          const [projectId, folderId] = value.split("/");
          return api.updateDocument(doc.id, folderId ? { folderId } : { projectId, folderId: null });
        })
      }
    >
      <Field label="移動到">
        <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <ErrorText error={error} />
    </Dialog>
  );
}

export type { Folder };
