import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { db } from "./db";
import { getFolder, getProject, HttpError } from "./library";
import type { LinkedFolder, ScanResult } from "./types";

const IS_WIN = process.platform === "win32";
/** Compare paths the way the OS does (Windows ignores case). */
const norm = (p: string) => (IS_WIN ? path.resolve(p).toLowerCase() : path.resolve(p));
const isInside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent).replace(/[\\/]+$/, "");
  return c === p || c.startsWith(p + path.sep);
};

const SKIP_DIR = /^(\$RECYCLE\.BIN|System Volume Information|node_modules|\..+)$/i;
const MAX_FILES = 5000;

/** Size + hash of the first 64 KB: recognises a file after it was moved or renamed. */
export function contentSig(file: string, size: number): string {
  const buf = Buffer.alloc(Math.min(size, 65536));
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  return `${size}:${createHash("sha1").update(buf).digest("hex")}`;
}

interface Found {
  file: string;
  /** Sub-folder names below the linked folder. */
  dirs: string[];
}

function findPdfs(root: string): Found[] {
  const out: Found[] = [];
  const walk = (dir: string, dirs: string[]) => {
    if (dirs.length > 12 || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no permission etc.
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) walk(full, [...dirs, e.name]);
      } else if (e.isFile() && /\.pdf$/i.test(e.name) && !e.name.startsWith("~$")) {
        out.push({ file: full, dirs });
        if (out.length >= MAX_FILES) return;
      }
    }
  };
  walk(root, []);
  return out;
}

/* ------------------------------------------------------------ linked folders */

interface LinkedRow {
  id: string;
  path: string;
  project_id: string;
  folder_id: string | null;
  scanned_at: number | null;
}

function toLinked(r: LinkedRow): LinkedFolder {
  const docs = db()
    .prepare(`SELECT local_path FROM documents WHERE local_path IS NOT NULL`)
    .all() as { local_path: string }[];
  return {
    id: r.id,
    path: r.path,
    projectId: r.project_id,
    folderId: r.folder_id,
    scannedAt: r.scanned_at,
    documentCount: docs.filter((d) => isInside(d.local_path, r.path)).length,
  };
}

export function listLinkedFolders(): LinkedFolder[] {
  return (db().prepare(`SELECT * FROM linked_folders ORDER BY created_at`).all() as LinkedRow[]).map(toLinked);
}

export function addLinkedFolder(input: { path: string; projectId: string; folderId?: string | null }): {
  folder: LinkedFolder;
  result: ScanResult;
} {
  const dir = path.resolve(String(input.path ?? "").trim());
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new HttpError(400, "找不到這個資料夾");
  }
  if (!st.isDirectory()) throw new HttpError(400, "這不是資料夾");
  getProject(input.projectId);
  const folderId = input.folderId || null;
  if (folderId && getFolder(folderId).projectId !== input.projectId) throw new HttpError(400, "資料夾不屬於此專案");
  for (const lf of listLinkedFolders()) {
    if (isInside(dir, lf.path)) throw new HttpError(400, `這個資料夾已經在連結的「${lf.path}」裡面了`);
  }
  const id = nanoid(10);
  db()
    .prepare(`INSERT INTO linked_folders (id, path, project_id, folder_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, dir, input.projectId, folderId, Date.now());
  // A folder nested inside the new one is now redundant: its files are covered.
  for (const lf of listLinkedFolders()) {
    if (lf.id !== id && isInside(lf.path, dir)) db().prepare(`DELETE FROM linked_folders WHERE id = ?`).run(lf.id);
  }
  const result = scanLinkedFolder(id);
  return { folder: toLinked(db().prepare(`SELECT * FROM linked_folders WHERE id = ?`).get(id) as LinkedRow), result };
}

/** Stop watching a folder. Its documents and notes stay; their files are still opened in place. */
export function removeLinkedFolder(id: string) {
  const r = db().prepare(`DELETE FROM linked_folders WHERE id = ?`).run(id);
  if (!Number(r.changes)) throw new HttpError(404, "找不到這個連結");
}

/** Find (or create) the app folder for a sub-folder path under a linked folder. */
function ensureFolder(projectId: string, parentId: string | null, names: string[]): string | null {
  let current = parentId;
  for (const name of names) {
    const existing = db()
      .prepare(
        `SELECT id FROM folders WHERE project_id = ? AND ${current ? "parent_id = ?" : "parent_id IS NULL"} AND name = ?`,
      )
      .get(...(current ? [projectId, current, name] : [projectId, name])) as { id: string } | undefined;
    if (existing) {
      current = existing.id;
    } else {
      const id = nanoid(10);
      db()
        .prepare(`INSERT INTO folders (id, project_id, parent_id, name, sort, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
        .run(id, projectId, current, name, Date.now());
      current = id;
    }
  }
  return current;
}

interface DocRow {
  id: string;
  local_path: string;
  size: number;
  file_mtime: number | null;
  content_sig: string | null;
  missing: number | null;
}

/**
 * Bring the library in line with a linked folder on disk: add new PDFs, notice
 * changed ones (so annotations made in other apps get imported), follow moved /
 * renamed files by content, and flag files that are gone. Notes are never lost.
 */
export function scanLinkedFolder(id: string): ScanResult {
  const lf = db().prepare(`SELECT * FROM linked_folders WHERE id = ?`).get(id) as LinkedRow | undefined;
  if (!lf) throw new HttpError(404, "找不到這個連結");
  const result: ScanResult = { added: 0, updated: 0, relinked: 0, missing: 0 };
  const now = Date.now();
  const d = db();

  // A folder that is temporarily unavailable (unplugged drive) must not mark everything missing.
  if (!existsSync(lf.path)) return result;

  const found = findPdfs(lf.path);
  const ignored = new Set((d.prepare(`SELECT path FROM linked_ignores`).all() as { path: string }[]).map((r) => norm(r.path)));
  const docs = (d.prepare(`SELECT id, local_path, size, file_mtime, content_sig, missing FROM documents WHERE local_path IS NOT NULL`).all() as DocRow[])
    .filter((r) => isInside(r.local_path, lf.path));
  const byPath = new Map(docs.map((r) => [norm(r.local_path), r]));
  const seen = new Set<string>();

  d.transaction(() => {
    const newFiles: { f: Found; size: number; mtime: number; sig: string }[] = [];
    for (const f of found) {
      const key = norm(f.file);
      if (ignored.has(key)) continue;
      let st;
      try {
        st = statSync(f.file);
      } catch {
        continue;
      }
      const mtime = Math.round(st.mtimeMs);
      const doc = byPath.get(key);
      if (doc) {
        seen.add(doc.id);
        if (doc.size !== st.size || doc.file_mtime !== mtime || doc.missing) {
          // Changed on disk (e.g. highlighted in Acrobat): bump the version so embedded annotations are re-imported.
          const changed = doc.size !== st.size || doc.file_mtime !== mtime;
          d.prepare(
            `UPDATE documents SET size = ?, file_mtime = ?, content_sig = ?, missing = 0,
               file_version = COALESCE(file_version, 1) + ?, updated_at = ? WHERE id = ?`,
          ).run(st.size, mtime, contentSig(f.file, st.size), changed ? 1 : 0, now, doc.id);
          result.updated++;
        }
        continue;
      }
      newFiles.push({ f, size: st.size, mtime, sig: contentSig(f.file, st.size) });
    }

    // Files no longer where we left them: candidates for "moved / renamed".
    const gone = docs.filter((r) => !seen.has(r.id) && !existsSync(r.local_path));
    for (const nf of newFiles) {
      const match = gone.find((g) => g.content_sig === nf.sig && !seen.has(g.id));
      if (match) {
        d.prepare(
          `UPDATE documents SET local_path = ?, file_mtime = ?, missing = 0, updated_at = ? WHERE id = ?`,
        ).run(nf.f.file, nf.mtime, now, match.id);
        seen.add(match.id);
        result.relinked++;
        continue;
      }
      const folderId = ensureFolder(lf.project_id, lf.folder_id, nf.f.dirs);
      d.prepare(
        `INSERT INTO documents (id, project_id, folder_id, title, filename, size, local_path, file_mtime, content_sig,
           missing, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?, ?)`,
      ).run(nanoid(12), lf.project_id, folderId, path.basename(nf.f.file).replace(/\.pdf$/i, ""), nf.size, nf.f.file,
        nf.mtime, nf.sig, now, now);
      result.added++;
    }

    for (const r of docs) {
      if (!seen.has(r.id) && !r.missing && !existsSync(r.local_path)) {
        d.prepare(`UPDATE documents SET missing = 1, updated_at = ? WHERE id = ?`).run(now, r.id);
        result.missing++;
      }
    }
    d.prepare(`UPDATE linked_folders SET scanned_at = ? WHERE id = ?`).run(now, lf.id);
  })();
  return result;
}

let lastScanAll = 0;

/** Rescan every linked folder; called when the library opens, at most once a minute unless forced. */
export function scanAllLinked(force = false): ScanResult & { scanned: boolean } {
  const total: ScanResult = { added: 0, updated: 0, relinked: 0, missing: 0 };
  if (!force && Date.now() - lastScanAll < 60_000) return { ...total, scanned: false };
  lastScanAll = Date.now();
  for (const lf of listLinkedFolders()) {
    const r = scanLinkedFolder(lf.id);
    total.added += r.added;
    total.updated += r.updated;
    total.relinked += r.relinked;
    total.missing += r.missing;
  }
  return { ...total, scanned: true };
}

/* ------------------------------------------------------------ folder browser */

export interface DirListing {
  path: string | null;
  parent: string | null;
  dirs: { name: string; path: string }[];
  pdfCount: number;
  places: { name: string; path: string }[];
}

/** Places to start browsing from: drives on Windows, plus home / Desktop / Documents / Downloads. */
function places(): { name: string; path: string }[] {
  const home = os.homedir();
  const out: { name: string; path: string }[] = [];
  const add = (name: string, p: string) => {
    try {
      if (statSync(p).isDirectory()) out.push({ name, path: p });
    } catch {
      /* missing */
    }
  };
  add("桌面", path.join(home, "Desktop"));
  add("文件", path.join(home, "Documents"));
  add("下載", path.join(home, "Downloads"));
  add("使用者資料夾", home);
  if (IS_WIN) {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") add(`${letter}: 磁碟`, `${letter}:\\`);
  } else {
    add("根目錄 /", "/");
  }
  return out;
}

/** List the sub-folders of a folder (and how many PDFs it holds) for the folder picker. */
export function listDir(dir?: string | null): DirListing {
  if (!dir) return { path: null, parent: null, dirs: [], pdfCount: 0, places: places() };
  const p = path.resolve(dir);
  let entries;
  try {
    entries = readdirSync(p, { withFileTypes: true });
  } catch {
    throw new HttpError(400, "無法開啟這個資料夾");
  }
  const parent = path.dirname(p);
  return {
    path: p,
    parent: parent === p ? null : parent,
    dirs: entries
      .filter((e) => e.isDirectory() && !SKIP_DIR.test(e.name))
      .map((e) => ({ name: e.name, path: path.join(p, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")),
    pdfCount: entries.filter((e) => e.isFile() && /\.pdf$/i.test(e.name)).length,
    places: places(),
  };
}
