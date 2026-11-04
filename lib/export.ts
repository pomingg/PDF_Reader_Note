import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { DATA_DIR, db, PDF_DIR, SNAPSHOT_DIR, UNFILED_PROJECT_ID } from "./db";
import { descendantFolderIds, getDocument, getFolder, getProject, HttpError, listFolders, listProjects } from "./library";
import { getColors, listAnnotations } from "./notes";
import type { Annotation, ColorDef, DocumentItem, Folder, Project } from "./types";

/* ============================================================ Markdown */

const COLOR_EMOJI: Record<string, string> = { yellow: "🟡", red: "🔴", green: "🟢", blue: "🔵" };

/** Make a string safe as a file or folder name on Windows, macOS and Linux. */
export function safeName(name: string, fallback = "未命名"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/** Obsidian tags cannot contain spaces. */
const asTag = (t: string) => "#" + t.trim().replace(/\s+/g, "_");

const yamlString = (s: string) => JSON.stringify(s);

function sortForExport(list: Annotation[]): Annotation[] {
  return [...list].sort(
    (a, b) =>
      (a.page ?? 0) - (b.page ?? 0) ||
      (a.rects[0]?.y ?? -1) - (b.rects[0]?.y ?? -1) ||
      (a.rects[0]?.x ?? 0) - (b.rects[0]?.x ?? 0) ||
      a.createdAt - b.createdAt,
  );
}

/**
 * Push headings inside a note down so they sit under the export's own
 * "## 第 N 頁 / ### 重點" outline (code fences are left alone).
 */
export function demoteHeadings(text: string, by: number): string {
  let fenced = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      const m = /^(#{1,6})(\s.*)$/.exec(line);
      return m ? "#".repeat(Math.min(6, m[1].length + by)) + m[2] : line;
    })
    .join("\n");
}

const quoteBlock = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");

interface DocMarkdown {
  markdown: string;
  /** asset path (relative to the .md file) -> absolute snapshot path on disk */
  assets: Map<string, string>;
}

export function documentMarkdown(
  doc: DocumentItem,
  ctx: { project: Project; folderPath: string; colors: ColorDef[]; exportedAt?: Date },
): DocMarkdown {
  const annotations = sortForExport(listAnnotations(doc.id));
  const assets = new Map<string, string>();
  const colorOf = (key: string) => ctx.colors.find((c) => c.key === key);
  const allTags = [...new Set(annotations.flatMap((a) => a.tags))].sort();
  const date = (ctx.exportedAt ?? new Date()).toISOString().slice(0, 10);

  const out: string[] = [
    "---",
    `title: ${yamlString(doc.title)}`,
    `project: ${yamlString(ctx.project.name)}`,
    ...(ctx.folderPath ? [`folder: ${yamlString(ctx.folderPath)}`] : []),
    ...(doc.pageCount ? [`pages: ${doc.pageCount}`] : []),
    `tags: [${allTags.map((t) => yamlString(t.replace(/\s+/g, "_"))).join(", ")}]`,
    `exported: ${date}`,
    `document_id: ${doc.id}`,
    "source: pdf-reader-note",
    "---",
    "",
    `# ${doc.title}`,
    "",
  ];

  const docNotes = annotations.filter((a) => a.type === "note" && a.page == null);
  const anchored = annotations.filter((a) => !(a.type === "note" && a.page == null));

  if (docNotes.length) {
    out.push("## 文件筆記", "");
    for (const n of docNotes) {
      out.push(...(n.source === "ai" ? ["*🤖 AI 產生*", ""] : []), demoteHeadings(n.comment.trim(), 2) || "（空白筆記）", "");
      if (n.tags.length) out.push(n.tags.map(asTag).join(" "), "");
    }
  }

  let page = -1;
  for (const a of anchored) {
    if (a.page !== page) {
      page = a.page ?? 0;
      out.push(`## 第 ${page} 頁`, "");
    }
    const ai = a.source === "ai" ? " 🤖" : "";
    if (a.type === "note") {
      out.push(`### 📝 頁面筆記 · p.${a.page}${ai}`, "");
    } else {
      const c = colorOf(a.color);
      const kind = a.type === "area" ? "框選" : (c?.label ?? "重點");
      out.push(`### ${COLOR_EMOJI[a.color] ?? "🖍️"} ${kind}${a.type === "area" && c ? `（${c.label}）` : ""} · p.${a.page}${ai}`, "");
    }
    if (a.type === "highlight" && a.quote) out.push(quoteBlock(a.quote), "");
    if (a.type === "area") {
      const file = snapshotFile(a.id);
      if (file) {
        const rel = `assets/${safeName(doc.title)}-${a.id}${path.extname(file)}`;
        assets.set(rel, file);
        out.push(`![框選 p.${a.page}](<${rel}>)`, "");
      }
    }
    if (a.comment.trim()) out.push(demoteHeadings(a.comment.trim(), 3), "");
    if (a.tags.length) out.push(a.tags.map(asTag).join(" "), "");
  }

  if (!annotations.length) out.push("*（這份文件還沒有筆記）*", "");
  return { markdown: out.join("\n").replace(/\n{3,}/g, "\n\n"), assets };
}

function snapshotFile(annotationId: string): string | null {
  const row = db().prepare(`SELECT image FROM annotations WHERE id = ?`).get(annotationId) as
    | { image: string | null }
    | undefined;
  if (!row?.image) return null;
  const file = path.join(SNAPSHOT_DIR, row.image);
  return existsSync(file) ? file : null;
}

function folderNames(folders: Folder[], folderId: string | null): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  let cur = folderId ? byId.get(folderId) : undefined;
  while (cur && out.length < 50) {
    out.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Uint8Array;
}

export type MarkdownScope =
  | { documentId: string }
  | { projectId: string; folderId?: string | null }
  | { all: true };

/**
 * Export notes as Markdown. A single document without snapshots comes back as
 * a plain .md file; anything else is a zip that mirrors project / folder layout.
 */
export function exportMarkdown(scope: MarkdownScope): ExportFile {
  const colors = getColors();
  const projects = new Map(listProjects().map((p) => [p.id, p]));
  const folders = listFolders();
  const exportedAt = new Date();
  const stamp = exportedAt.toISOString().slice(0, 10);

  let docs: DocumentItem[];
  let zipName: string;
  /** Folder depth to strip from paths, so a folder export starts at that folder. */
  let base: string[] = [];

  if ("documentId" in scope) {
    docs = [getDocument(scope.documentId)];
    zipName = safeName(docs[0].title);
  } else if ("projectId" in scope) {
    const project = getProject(scope.projectId);
    let ids: { id: string }[];
    if (scope.folderId) {
      const folderIds = descendantFolderIds(getFolder(scope.folderId).id);
      ids = db()
        .prepare(`SELECT id FROM documents WHERE folder_id IN (${folderIds.map(() => "?").join(",")}) ORDER BY title`)
        .all(...folderIds) as { id: string }[];
    } else {
      ids = db().prepare(`SELECT id FROM documents WHERE project_id = ? ORDER BY title`).all(project.id) as { id: string }[];
    }
    docs = ids.map((r) => getDocument(r.id));
    base = scope.folderId ? folderNames(folders, scope.folderId).slice(0, -1) : [];
    zipName = safeName(scope.folderId ? `${project.name}-${getFolder(scope.folderId).name}` : project.name);
  } else {
    const ids = db().prepare(`SELECT id FROM documents ORDER BY title`).all() as { id: string }[];
    docs = ids.map((r) => getDocument(r.id));
    zipName = "全部";
  }

  const rendered = docs.map((doc) => {
    const project = projects.get(doc.projectId)!;
    const names = folderNames(folders, doc.folderId);
    return { doc, project, names, md: documentMarkdown(doc, { project, folderPath: names.join("/"), colors, exportedAt }) };
  });

  if ("documentId" in scope && rendered[0].md.assets.size === 0) {
    return {
      filename: `${safeName(rendered[0].doc.title)}.md`,
      contentType: "text/markdown; charset=utf-8",
      body: strToU8(rendered[0].md.markdown),
    };
  }

  const files: Zippable = {};
  const used = new Set<string>();
  for (const { doc, project, names, md } of rendered) {
    // Zip layout: 專案/資料夾/…/文件.md (a single-document zip keeps everything at the top level).
    const dir =
      "documentId" in scope
        ? ""
        : [safeName(project.name), ...names.slice(base.length).map((n) => safeName(n))].join("/");
    let name = safeName(doc.title);
    for (let i = 2; used.has(`${dir}/${name}`.toLowerCase()); i++) name = `${safeName(doc.title)} (${i})`;
    used.add(`${dir}/${name}`.toLowerCase());
    // Asset links are relative to the .md file, so keep them next to it.
    for (const [rel, abs] of md.assets) {
      files[[dir, rel].filter(Boolean).join("/")] = [readFileSync(abs), { level: 0 }];
    }
    files[[dir, `${name}.md`].filter(Boolean).join("/")] = strToU8(md.markdown);
  }
  if (!Object.keys(files).length) files["README.md"] = strToU8("（這個範圍內沒有文件）\n");

  return {
    filename: `${zipName}-筆記-${stamp}.zip`,
    contentType: "application/zip",
    body: zipSync(files, { level: 6 }),
  };
}

/* ============================================================ Backup */

export const BACKUP_VERSION = 1;

/** Columns per table, in insert order. Restore only ever writes these. */
const TABLES: Record<string, string[]> = {
  projects: ["id", "name", "color", "icon", "description", "sort", "is_system", "created_at"],
  folders: ["id", "project_id", "parent_id", "name", "sort", "created_at"],
  documents: [
    "id", "project_id", "folder_id", "title", "filename", "size", "page_count", "last_page", "last_opened_at",
    "created_at", "updated_at",
  ],
  annotations: [
    "id", "document_id", "type", "color", "page", "rects", "quote", "prefix", "suffix", "comment", "image",
    "source", "created_at", "updated_at",
  ],
  tags: ["id", "name", "created_at"],
  annotation_tags: ["annotation_id", "tag_id"],
  settings: ["key", "value"],
};

type Row = Record<string, unknown>;
interface BackupJson {
  app: "pdf-reader-note";
  version: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
}

/** File names we ever write: generated ids plus an extension. Blocks path tricks in a zip. */
const SAFE_FILE = /^[A-Za-z0-9_-]{1,64}\.(pdf|png|jpg)$/;

function buildBackup(): Zippable {
  const tables: Record<string, Row[]> = {};
  for (const [table, cols] of Object.entries(TABLES)) {
    tables[table] = db().prepare(`SELECT ${cols.join(", ")} FROM ${table}`).all() as Row[];
  }
  const json: BackupJson = { app: "pdf-reader-note", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
  const files: Zippable = { "backup.json": strToU8(JSON.stringify(json, null, 1)) };
  for (const d of tables.documents) {
    const f = path.join(PDF_DIR, String(d.filename));
    if (existsSync(f)) files[`pdfs/${d.filename}`] = [readFileSync(f), { level: 0 }];
  }
  for (const a of tables.annotations) {
    if (!a.image) continue;
    const f = path.join(SNAPSHOT_DIR, String(a.image));
    if (existsSync(f)) files[`snapshots/${a.image}`] = [readFileSync(f), { level: 0 }];
  }
  return files;
}

export function exportBackup(): ExportFile {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return { filename: `pdf-notes-backup-${stamp}.zip`, contentType: "application/zip", body: zipSync(buildBackup()) };
}

export interface RestoreResult {
  projects: number;
  documents: number;
  annotations: number;
  safetyBackup: string;
}

/** Replace everything with the contents of a backup zip. */
export function restoreBackup(zip: Uint8Array): RestoreResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new HttpError(400, "不是有效的 zip 檔");
  }
  const raw = entries["backup.json"];
  if (!raw) throw new HttpError(400, "zip 裡找不到 backup.json，這不是本程式的備份檔");

  let json: BackupJson;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(400, "backup.json 內容損毀");
  }
  if (json?.app !== "pdf-reader-note" || typeof json.version !== "number") throw new HttpError(400, "不是本程式的備份檔");
  if (json.version > BACKUP_VERSION) throw new HttpError(400, "備份檔來自較新版本，請先更新程式");
  for (const t of Object.keys(TABLES)) {
    if (!Array.isArray(json.tables?.[t])) throw new HttpError(400, `備份檔缺少資料表 ${t}`);
  }

  // Every referenced file must be present and have a safe name.
  const pdfs = new Map<string, Uint8Array>();
  for (const d of json.tables.documents) {
    const name = String(d.filename);
    if (!SAFE_FILE.test(name)) throw new HttpError(400, "備份檔中的 PDF 檔名不合法");
    const data = entries[`pdfs/${name}`];
    if (!data) throw new HttpError(400, `備份檔缺少 PDF：${d.title ?? name}`);
    pdfs.set(name, data);
  }
  const snaps = new Map<string, Uint8Array>();
  for (const a of json.tables.annotations) {
    if (!a.image) continue;
    const name = String(a.image);
    if (!SAFE_FILE.test(name)) throw new HttpError(400, "備份檔中的截圖檔名不合法");
    const data = entries[`snapshots/${name}`];
    if (data) snaps.set(name, data);
    else a.image = null; // keep the note, lose only the missing picture
  }

  // Safety net: keep what is there now.
  const backupsDir = path.join(DATA_DIR, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const safety = path.join(backupsDir, `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
  writeFileSync(safety, zipSync(buildBackup()));

  const d = db();
  const replaceAll = d.transaction(() => {
    d.pragma("defer_foreign_keys = ON");
    for (const t of Object.keys(TABLES).reverse()) d.prepare(`DELETE FROM ${t}`).run();
    for (const [t, cols] of Object.entries(TABLES)) {
      const stmt = d.prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      for (const row of json.tables[t]) stmt.run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
    }
    d.prepare(
      `INSERT OR IGNORE INTO projects (id, name, color, icon, description, sort, is_system, created_at)
       VALUES (?, '未分類', '#94a3b8', '📥', '尚未歸類的文件', 9999, 1, ?)`,
    ).run(UNFILED_PROJECT_ID, Date.now());
  });
  try {
    replaceAll(); // all or nothing: any bad row rolls the whole restore back
  } catch (err) {
    console.error("restore failed", err);
    throw new HttpError(400, "備份檔中的資料有誤，已取消還原，目前資料沒有任何變更");
  }

  for (const [name, data] of pdfs) writeFileSync(path.join(PDF_DIR, name), data);
  for (const [name, data] of snaps) writeFileSync(path.join(SNAPSHOT_DIR, name), data);
  removeUnreferenced(PDF_DIR, new Set(pdfs.keys()));
  removeUnreferenced(SNAPSHOT_DIR, new Set(snaps.keys()));

  return {
    projects: json.tables.projects.length,
    documents: json.tables.documents.length,
    annotations: json.tables.annotations.length,
    safetyBackup: path.relative(DATA_DIR, safety),
  };
}

function removeUnreferenced(dir: string, keep: Set<string>) {
  for (const f of readdirSync(dir)) {
    if (!keep.has(f)) {
      try {
        unlinkSync(path.join(dir, f));
      } catch {
        /* ignore */
      }
    }
  }
}
