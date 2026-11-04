"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Field } from "@/components/Dialog";
import { Markdown } from "@/components/Markdown";
import { Menu } from "@/components/Menu";
import { api } from "@/lib/client";
import type { Annotation, ColorDef, Tag } from "@/lib/types";

type TypeFilter = "all" | "highlight" | "area" | "note";

export function colorHex(colors: ColorDef[], key: string) {
  return colors.find((c) => c.key === key)?.hex ?? "#facc15";
}

export function NotesPanel({
  annotations,
  colors,
  setColors,
  selectedId,
  focusId,
  currentPage,
  onSelect,
  onUpdate,
  onDelete,
  onAddNote,
  onImport,
  importing,
}: {
  annotations: Annotation[];
  colors: ColorDef[];
  setColors: (c: ColorDef[]) => void;
  selectedId: string | null;
  /** Annotation whose editor should grab keyboard focus (just created). */
  focusId: string | null;
  currentPage: number;
  onSelect: (a: Annotation) => void;
  onUpdate: (id: string, patch: { color?: string; comment?: string; tags?: string[] }) => void;
  onDelete: (id: string) => void;
  onAddNote: (page: number | null) => void;
  /** Omit to hide the "import from PDF" button (e.g. for ebooks). */
  onImport?: () => void;
  importing?: boolean;
}) {
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [editingColors, setEditingColors] = useState(false);

  useEffect(() => {
    api.tags().then(setAllTags);
  }, [annotations]);

  const docTags = useMemo(() => [...new Set(annotations.flatMap((a) => a.tags))].sort(), [annotations]);
  const shown = annotations.filter(
    (a) =>
      (!colorFilter || (a.type !== "note" && a.color === colorFilter)) &&
      (typeFilter === "all" || a.type === typeFilter) &&
      (!tagFilter || a.tags.includes(tagFilter)),
  );
  const filtered = colorFilter || typeFilter !== "all" || tagFilter;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm font-semibold">
            筆記 <span className="font-normal text-slate-400">{annotations.length}</span>
          </span>
          {onImport && (
            <button
              className="icon-btn h-7 w-7"
              title="匯入其他 PDF 軟體（Acrobat、Edge、iPad App…）存在這份 PDF 裡的重點與備註"
              aria-label="從 PDF 匯入註解"
              disabled={importing}
              onClick={onImport}
            >
              {importing ? "…" : "⤓"}
            </button>
          )}
          <button className="icon-btn h-7 w-7" title="顏色意義設定" aria-label="顏色設定" onClick={() => setEditingColors(true)}>
            ⚙
          </button>
          <AddNoteButton currentPage={currentPage} onAdd={onAddNote} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {colors.map((c) => (
            <button
              key={c.key}
              onClick={() => setColorFilter(colorFilter === c.key ? null : c.key)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                colorFilter === c.key ? "border-slate-500 bg-slate-100" : "border-slate-200"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.hex }} />
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            aria-label="類型篩選"
            className="input py-1 text-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          >
            <option value="all">全部類型</option>
            <option value="highlight">重點</option>
            <option value="area">框選</option>
            <option value="note">筆記</option>
          </select>
          <select
            aria-label="標籤篩選"
            className="input py-1 text-xs"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">全部標籤</option>
            {docTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3" data-testid="notes-list">
        {shown.map((a) => (
          <NoteCard
            key={a.id}
            a={a}
            colors={colors}
            selected={a.id === selectedId}
            focus={a.id === focusId}
            allTags={allTags}
            onSelect={() => onSelect(a)}
            onUpdate={(p) => onUpdate(a.id, p)}
            onDelete={() => onDelete(a.id)}
          />
        ))}
        {!shown.length && (
          <p className="px-2 py-8 text-center text-sm leading-relaxed text-slate-400">
            {filtered ? (
              "沒有符合篩選的筆記"
            ) : (
              <>
                選取文字後選顏色即可畫重點
                <br />
                按工具列的「框選」可擷取圖表或公式
              </>
            )}
          </p>
        )}
      </div>

      {editingColors && (
        <ColorSettingsDialog
          colors={colors}
          onClose={() => setEditingColors(false)}
          onSave={async (c) => {
            setColors(await api.saveColors(c));
            setEditingColors(false);
          }}
        />
      )}
    </div>
  );
}

function AddNoteButton({ currentPage, onAdd }: { currentPage: number; onAdd: (page: number | null) => void }) {
  return (
    <Menu
      trigger="＋ 筆記"
      triggerClassName="btn px-2 py-1 text-xs"
      items={[
        // currentPage 0 = no pages (ebooks): only whole-book notes
        ...(currentPage > 0 ? [{ label: `第 ${currentPage} 頁的筆記`, onClick: () => onAdd(currentPage) }] : []),
        { label: currentPage > 0 ? "整份文件的筆記" : "整本書的筆記", onClick: () => onAdd(null) },
      ]}
    />
  );
}

const TYPE_LABEL = { highlight: "重點", area: "框選", note: "筆記" } as const;

function NoteCard({
  a,
  colors,
  selected,
  focus,
  allTags,
  onSelect,
  onUpdate,
  onDelete,
}: {
  a: Annotation;
  colors: ColorDef[];
  selected: boolean;
  focus: boolean;
  allTags: Tag[];
  onSelect: () => void;
  onUpdate: (p: { color?: string; comment?: string; tags?: string[] }) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(a.comment);
  const [preview, setPreview] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => setDraft(a.comment), [a.comment]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEffect(() => {
    if (focus && selected) textarea.current?.focus();
  }, [focus, selected]);

  // Save the comment shortly after typing stops.
  useEffect(() => {
    if (draft === a.comment) return;
    const t = setTimeout(() => onUpdateRef.current({ comment: draft }), 600);
    return () => clearTimeout(t);
  }, [draft, a.comment]);

  const hex = colorHex(colors, a.color);
  const addTag = (raw: string) => {
    const names = raw
      .split(/[,，\s]+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (names.length) onUpdate({ tags: [...new Set([...a.tags, ...names])] });
    setTagInput("");
  };

  return (
    <div
      ref={ref}
      data-testid="note-card"
      data-annotation={a.id}
      onClick={() => !selected && onSelect()}
      className={`rounded-lg border bg-white text-sm ${
        selected ? "border-indigo-400 shadow-md ring-1 ring-indigo-200" : "cursor-pointer border-slate-200 hover:border-slate-300"
      }`}
      style={{ borderLeft: `4px solid ${a.type === "note" ? "#94a3b8" : hex}` }}
    >
      <div className="flex items-center gap-2 px-3 pt-2 text-xs text-slate-400">
        <span>{TYPE_LABEL[a.type]}</span>
        <span>{a.location ?? (a.page ? `p.${a.page}` : a.origin && a.origin !== "pdf" ? "" : "整份文件")}</span>
        {a.source === "ai" && <span className="rounded bg-violet-100 px-1 text-violet-700">AI</span>}
        {a.origin === "pdf" && (
          <span className="rounded bg-sky-100 px-1 text-sky-700" title="從 PDF 檔內建的註解匯入">
            PDF 匯入
          </span>
        )}
        {a.origin === "hyread" && (
          <span className="rounded bg-orange-100 px-1 text-orange-700" title="從 HyRead 同步">
            HyRead
          </span>
        )}
        {a.removed && (
          <span className="rounded bg-slate-200 px-1 text-slate-600" title="已在原本的閱讀軟體中刪除，這裡仍保留">
            來源已刪除
          </span>
        )}
        <span className="flex-1" />
        {selected && (
          <button
            className="text-slate-400 hover:text-red-600"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("確定刪除這則筆記？")) onDelete();
            }}
          >
            刪除
          </button>
        )}
      </div>

      {a.type === "highlight" && (
        <blockquote className={`mx-3 mt-1 text-slate-700 ${selected ? "" : "line-clamp-3"}`}>{a.quote}</blockquote>
      )}
      {a.type === "area" && a.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.imageUrl} alt="框選擷取" className="mx-3 mt-1 max-h-48 max-w-[calc(100%-1.5rem)] rounded border border-slate-200" />
      )}

      {selected ? (
        <div className="space-y-2 p-3" onClick={(e) => e.stopPropagation()}>
          {a.type !== "note" && (
            <div className="flex gap-1">
              {colors.map((c) => (
                <button
                  key={c.key}
                  title={c.label}
                  aria-label={`改成${c.label}`}
                  onClick={() => onUpdate({ color: c.key })}
                  className={`h-6 w-6 rounded-full ${a.color === c.key ? "ring-2 ring-slate-500 ring-offset-1" : ""}`}
                  style={{ background: c.hex }}
                />
              ))}
            </div>
          )}
          <div className="flex gap-2 text-xs">
            <button className={preview ? "text-slate-400" : "font-medium text-indigo-600"} onClick={() => setPreview(false)}>
              編輯
            </button>
            <button className={preview ? "font-medium text-indigo-600" : "text-slate-400"} onClick={() => setPreview(true)}>
              預覽
            </button>
            <span className="flex-1 text-right text-slate-400">支援 Markdown 與 $公式$</span>
          </div>
          {preview ? (
            <div className="min-h-20 rounded-lg border border-slate-200 p-2">
              {draft ? <Markdown>{draft}</Markdown> : <span className="text-slate-400">（沒有內容）</span>}
            </div>
          ) : (
            <textarea
              ref={textarea}
              aria-label="備註內容"
              className="input min-h-28 font-mono text-xs"
              placeholder="寫下你的備註、解析或疑問…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== a.comment && onUpdate({ comment: draft })}
            />
          )}
          <div className="flex flex-wrap items-center gap-1">
            {a.tags.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                #{t}
                <button aria-label={`移除標籤 ${t}`} onClick={() => onUpdate({ tags: a.tags.filter((x) => x !== t) })}>
                  ×
                </button>
              </span>
            ))}
            <input
              aria-label="新增標籤"
              list={`tags-${a.id}`}
              className="min-w-20 flex-1 rounded border border-transparent px-1 py-0.5 text-xs outline-none focus:border-slate-300"
              placeholder="＋ 標籤（Enter）"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              onBlur={() => tagInput && addTag(tagInput)}
            />
            <datalist id={`tags-${a.id}`}>
              {allTags.filter((t) => !a.tags.includes(t.name)).map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </div>
        </div>
      ) : (
        <div className="space-y-1 px-3 pb-2 pt-1">
          {a.comment && <Markdown className="text-slate-800">{a.comment}</Markdown>}
          {!a.comment && a.type === "note" && <p className="text-slate-400">（空白筆記）</p>}
          {a.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {a.tags.map((t) => (
                <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColorSettingsDialog({
  colors,
  onClose,
  onSave,
}: {
  colors: ColorDef[];
  onClose: () => void;
  onSave: (c: ColorDef[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(colors);
  return (
    <Dialog title="螢光筆顏色意義" submitLabel="儲存" onClose={onClose} onSubmit={() => onSave(draft)}>
      <p className="text-sm text-slate-500">設定每個顏色代表的意思，方便日後篩選與 AI 整理。快捷鍵依序為 1–4。</p>
      {draft.map((c, i) => (
        <Field key={c.key} label={`顏色 ${i + 1}`}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`顏色 ${i + 1} 色碼`}
              value={c.hex}
              onChange={(e) => setDraft(draft.map((d) => (d.key === c.key ? { ...d, hex: e.target.value } : d)))}
              className="h-9 w-12 cursor-pointer rounded border border-slate-300"
            />
            <input
              className="input"
              aria-label={`顏色 ${i + 1} 名稱`}
              value={c.label}
              onChange={(e) => setDraft(draft.map((d) => (d.key === c.key ? { ...d, label: e.target.value } : d)))}
            />
          </div>
        </Field>
      ))}
    </Dialog>
  );
}
