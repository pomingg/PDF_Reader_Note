import { createHash, timingSafeEqual } from "node:crypto";
import { openSync, readdirSync, readSync, closeSync, statSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db } from "../db";
import { upsertEbook, type EbookAnnotationInput, type EbookInput, type EbookSyncResult } from "../ebooks";
import { HttpError } from "../library";

export const SOURCE = "hyread";
const MAX_CAPTURES = 300;

/* ------------------------------------------------------------------ token */

/** Secret the browser extension must send, so other web pages cannot write notes. */
export function getSyncToken(): string {
  const row = db().prepare(`SELECT value FROM settings WHERE key = 'hyread_token'`).get() as { value: string } | undefined;
  return row?.value ?? regenerateSyncToken();
}

export function regenerateSyncToken(): string {
  const token = nanoid(32);
  db()
    .prepare(`INSERT INTO settings (key, value) VALUES ('hyread_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(token);
  return token;
}

export function checkToken(req: Request) {
  const sent = req.headers.get("x-sync-token") ?? "";
  const expected = getSyncToken();
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, "同步金鑰不正確，請到「HyRead 同步」頁複製最新的金鑰到擴充功能設定");
  }
}

/** CORS: only the browser extension may call the sync endpoints from a page context. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!origin.startsWith("chrome-extension://") && !origin.startsWith("moz-extension://")) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-sync-token",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/* ------------------------------------------------------------- sanitising */

// Credentials only: "auth" alone / authorization / auth_code etc., but not "author".
const SENSITIVE = /token|cookie|^auth$|authoriz|auth_?(code|key|info)|session|passw|secret|signature|^sign$|credential|^key$|api_?key|jwt|bearer/i;

/** Drop anything that looks like a credential and cap sizes before storing. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 40) return null;
  if (typeof value === "string") return value.length > 20000 ? value.slice(0, 20000) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, 3000).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[已移除]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Strip credential-looking query parameters from a URL. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (SENSITIVE.test(k)) u.searchParams.set(k, "[已移除]");
    return u.toString().slice(0, 2000);
  } catch {
    return String(raw).slice(0, 2000);
  }
}

/* ----------------------------------------------------------------- parser */

const TEXT_KEYS = /^(text|content|highlight(ed)?_?text|selected_?text|selection|quote|excerpt|sel_?text|mark(ed)?_?text|underline_?text|orig(inal)?_?text|sentence|digest|htext)$/i;
const NOTE_KEYS = /^(note|notes|comment|memo|remark|annotation(_?text)?|note_?(text|content)|user_?note|thought|ntext)$/i;
const ID_KEYS = /^(id|_id|uuid|guid|annotation_?id|note_?id|highlight_?id|mark_?id|bookmark_?id|nid|aid|hid|sn|seq)$/i;
const BOOK_ID_KEYS = /^(book_?id|book_?uid|ebook_?id|asset_?id|isbn|bid|book_?no|product_?id|content_?id|item_?id)$/i;
const BOOK_TITLE_KEYS = /^(book_?name|book_?title|bookname)$/i;
const AUTHOR_KEYS = /^(author|authors|writer|book_?author)$/i;
const COLOR_KEYS = /^(color|colour|highlight_?color|mark_?color|hl_?color)$/i;
const LOCATION_KEYS = /^(chapter|chapter_?(name|title)|page|page_?no|page_?num|position|location|cfi|epubcfi|start_?cfi|range|spine_?index|section)$/i;
const TIME_KEYS = /^(created?_?(at|time|date)|create_?time|update_?time|updated?_?(at|time)|timestamp|mtime|ctime|modify_?time)$/i;
const MARKER_KEYS = /highlight|annot|note|mark|underline|memo|comment|劃線|筆記/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function pick(o: Obj, re: RegExp): unknown {
  for (const [k, v] of Object.entries(o)) if (re.test(k) && v != null && v !== "") return v;
  return undefined;
}

function toTime(v: unknown): number | undefined {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

function locationOf(o: Obj): string | undefined {
  const chapter = str(pick(o, /^chapter_?(name|title)?$/i));
  const page = str(pick(o, /^page(_?(no|num))?$/i));
  if (chapter || page) return [chapter, page && `第 ${page} 頁`].filter(Boolean).join(" · ");
  const other = str(pick(o, LOCATION_KEYS));
  return other ? (other.length > 60 ? `位置 ${other.slice(0, 57)}…` : `位置 ${other}`) : undefined;
}

const hashOf = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Book title from the page title, e.g. "原子習慣 - HyRead" -> "原子習慣". */
function titleFromPage(t: string) {
  return t.replace(/\s*[-|｜–—]\s*HyRead.*$/i, "").replace(/^HyRead\s*[-|｜–—]?\s*/i, "").trim();
}

/**
 * Best-effort extraction of highlights from a JSON blob whose exact format we
 * do not know yet: walk it and keep objects that look like annotations
 * (a text or note field plus an id, a location, a colour or an annotation-ish key).
 */
export function extractBooks(capture: { url: string; pageTitle: string; payload: unknown }): EbookInput[] {
  const books = new Map<string, EbookInput>();
  let urlBookId = "";
  try {
    const u = new URL(capture.url);
    for (const [k, v] of u.searchParams) if (BOOK_ID_KEYS.test(k) && v) urlBookId = v;
  } catch {
    /* not a URL */
  }

  const visit = (node: unknown, ctx: { bookId?: string; title?: string; author?: string; marker: boolean }, depth: number) => {
    if (depth > 30) return;
    if (Array.isArray(node)) {
      for (const v of node) visit(v, ctx, depth + 1);
      return;
    }
    if (!isObj(node)) return;
    const here = {
      bookId: str(pick(node, BOOK_ID_KEYS)) || ctx.bookId,
      title: str(pick(node, BOOK_TITLE_KEYS)) || ctx.title,
      author: str(pick(node, AUTHOR_KEYS)) || ctx.author,
      marker: ctx.marker,
    };
    const quote = str(pick(node, TEXT_KEYS));
    const note = str(pick(node, NOTE_KEYS));
    const location = locationOf(node);
    const id = str(pick(node, ID_KEYS));
    const looksLike =
      (quote || note) &&
      (location || pick(node, COLOR_KEYS) !== undefined || note || ctx.marker || Object.keys(node).some((k) => MARKER_KEYS.test(k)));
    if (looksLike && (quote.length <= 5000 || note)) {
      const bookId = here.bookId || urlBookId || (capture.pageTitle ? `title:${hashOf(titleFromPage(capture.pageTitle))}` : "");
      if (bookId) {
        const book =
          books.get(bookId) ??
          ({ source: SOURCE, externalId: bookId, title: here.title || titleFromPage(capture.pageTitle), author: here.author, annotations: [] } as EbookInput);
        const ann: EbookAnnotationInput = {
          externalId: id || hashOf(`${quote}|${note}|${location ?? ""}`),
          quote,
          note,
          color: pick(node, COLOR_KEYS),
          location,
          createdAt: toTime(pick(node, /^created?_?(at|time|date)$|^create_?time$|^timestamp$|^ctime$/i)),
          updatedAt: toTime(pick(node, TIME_KEYS)),
        };
        book.annotations.push(ann);
        books.set(bookId, book);
        return; // an annotation: don't descend into its own fields
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") visit(v, { ...here, marker: here.marker || MARKER_KEYS.test(k) }, depth + 1);
    }
  };
  visit(capture.payload, { marker: MARKER_KEYS.test(capture.url) }, 0);
  return [...books.values()];
}

/* --------------------------------------------------------------- captures */

export interface CaptureInput {
  url: string;
  kind?: string;
  pageTitle?: string;
  payload: unknown;
}

export interface CaptureSummary {
  id: string;
  url: string;
  kind: string;
  pageTitle: string;
  status: string;
  detail: string;
  createdAt: number;
}

/** Store a capture from the extension and turn whatever we recognise into ebook notes. */
export function receiveCapture(input: CaptureInput): { id: string; status: string; results: EbookSyncResult[] } {
  const payload = sanitize(input.payload);
  const url = sanitizeUrl(String(input.url ?? ""));
  const pageTitle = String(input.pageTitle ?? "").slice(0, 300);
  const id = nanoid(12);
  db()
    .prepare(
      `INSERT INTO integration_captures (id, source, url, kind, page_title, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'stored', ?)`,
    )
    .run(id, SOURCE, url, String(input.kind ?? "response").slice(0, 20), pageTitle, JSON.stringify(payload), Date.now());
  db()
    .prepare(
      `DELETE FROM integration_captures WHERE source = ? AND id NOT IN
         (SELECT id FROM integration_captures WHERE source = ? ORDER BY created_at DESC LIMIT ?)`,
    )
    .run(SOURCE, SOURCE, MAX_CAPTURES);
  return { id, ...processCapture(id, { url, pageTitle, payload }) };
}

function processCapture(id: string, capture: { url: string; pageTitle: string; payload: unknown }) {
  let status = "unparsed";
  let detail = "";
  const results: EbookSyncResult[] = [];
  try {
    const books = extractBooks(capture);
    for (const b of books) results.push(upsertEbook(b));
    if (results.length) {
      status = "parsed";
      const n = (k: keyof EbookSyncResult) => results.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      detail = `${books.length} 本書：新增 ${n("created")}、更新 ${n("updated")} 則`;
    } else {
      detail = "沒有辨識出劃線或筆記（已保存原始資料，供日後解析）";
    }
  } catch (err) {
    status = "error";
    detail = (err as Error).message.slice(0, 300);
  }
  db().prepare(`UPDATE integration_captures SET status = ?, detail = ? WHERE id = ?`).run(status, detail, id);
  return { status, results };
}

/** Run the parser again over everything stored (after the parser learns a new format). */
export function reprocessAll(): { captures: number; parsed: number } {
  const rows = db()
    .prepare(`SELECT id, url, page_title, payload FROM integration_captures WHERE source = ? ORDER BY created_at`)
    .all(SOURCE) as { id: string; url: string; page_title: string; payload: string }[];
  let parsed = 0;
  for (const r of rows) {
    const { status } = processCapture(r.id, { url: r.url, pageTitle: r.page_title, payload: JSON.parse(r.payload) });
    if (status === "parsed") parsed++;
  }
  return { captures: rows.length, parsed };
}

export function listCaptures(limit = 50): CaptureSummary[] {
  return (
    db()
      .prepare(
        `SELECT id, url, kind, page_title, status, detail, created_at FROM integration_captures
         WHERE source = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(SOURCE, limit) as { id: string; url: string; kind: string; page_title: string; status: string; detail: string; created_at: number }[]
  ).map((r) => ({ id: r.id, url: r.url, kind: r.kind, pageTitle: r.page_title, status: r.status, detail: r.detail, createdAt: r.created_at }));
}

export function syncStatus() {
  const books = db().prepare(`SELECT COUNT(*) AS n FROM documents WHERE source = ?`).get(SOURCE) as { n: number };
  const notes = db().prepare(`SELECT COUNT(*) AS n FROM annotations WHERE origin = ?`).get(SOURCE) as { n: number };
  const last = db().prepare(`SELECT MAX(created_at) AS t FROM integration_captures WHERE source = ?`).get(SOURCE) as { t: number | null };
  const project = db().prepare(`SELECT value FROM settings WHERE key = 'hyread_project'`).get() as { value: string } | undefined;
  return {
    token: getSyncToken(),
    books: books.n,
    notes: notes.n,
    lastCaptureAt: last.t,
    projectId: project?.value ?? null,
    suggestedFolder: suggestedFolder(),
    captures: listCaptures(30),
  };
}

/** Where the HyRead desktop app keeps its data on this computer, if it is installed. */
function suggestedFolder(): string | null {
  const roots = [process.env.APPDATA, process.env.HOME && path.join(process.env.HOME, "Library", "Application Support")];
  for (const r of roots) {
    if (!r) continue;
    const dir = path.join(r, "HyRead");
    try {
      if (statSync(dir).isDirectory()) return dir;
    } catch {
      /* not here */
    }
  }
  return null;
}

export function setDefaultProject(projectId: string | null) {
  if (projectId) {
    db()
      .prepare(`INSERT INTO settings (key, value) VALUES ('hyread_project', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(projectId);
  } else {
    db().prepare(`DELETE FROM settings WHERE key = 'hyread_project'`).run();
  }
}

/** Recent captures (already sanitised) as text the user can send for troubleshooting. */
export function diagnostics(limit = 25): string {
  const rows = db()
    .prepare(
      `SELECT url, kind, page_title, status, detail, payload, created_at FROM integration_captures
       WHERE source = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(SOURCE, limit) as { url: string; kind: string; page_title: string; status: string; detail: string; payload: string; created_at: number }[];
  const out = rows.map((r) => ({
    time: new Date(r.created_at).toISOString(),
    url: r.url,
    kind: r.kind,
    pageTitle: r.page_title,
    status: r.status,
    detail: r.detail,
    payload: r.payload.length > 12000 ? r.payload.slice(0, 12000) + "…(截斷)" : JSON.parse(r.payload),
  }));
  return JSON.stringify({ app: "pdf-reader-note", source: SOURCE, generatedAt: new Date().toISOString(), captures: out }, null, 1);
}

/* ------------------------------------------------------- local folder scan */

const SKIP_DIRS = /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|Crashpad|blob_storage|Dictionaries|logs?)$/i;

export interface ScannedFile {
  path: string;
  size: number;
  modifiedAt: number;
  type: string;
}

function sniff(file: string, name: string): string {
  if (/^(CURRENT|LOCK|LOG(\.old)?|MANIFEST-\d+)$/.test(name) || /\.(ldb)$/i.test(name)) return "LevelDB";
  let buf = Buffer.alloc(16);
  try {
    const fd = openSync(file, "r");
    const n = readSync(fd, buf, 0, 16, 0);
    closeSync(fd);
    buf = buf.subarray(0, n);
  } catch {
    return "無法讀取";
  }
  if (buf.toString("latin1").startsWith("SQLite format 3")) return "SQLite";
  const head = buf.toString("utf8").trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "JSON";
  if (/\.(log)$/i.test(name)) return "LevelDB 記錄";
  if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(buf.toString("latin1"))) return "文字";
  return "二進位";
}

/**
 * List a folder's files (sizes, types, last change) so we can see where a
 * desktop reading app keeps its notes. Read-only; skips caches.
 */
export function scanFolder(dir: string): { root: string; files: ScannedFile[]; truncated: boolean } {
  const root = path.resolve(dir);
  let st;
  try {
    st = statSync(root);
  } catch {
    throw new HttpError(400, "找不到這個資料夾");
  }
  if (!st.isDirectory()) throw new HttpError(400, "這不是資料夾");
  const files: ScannedFile[] = [];
  let truncated = false;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || files.length >= 600) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= 600) {
        truncated = true;
        return;
      }
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.test(e.name)) walk(full, depth + 1);
      } else if (e.isFile()) {
        try {
          const s = statSync(full);
          files.push({ path: path.relative(root, full), size: s.size, modifiedAt: s.mtimeMs, type: sniff(full, e.name) });
        } catch {
          /* vanished */
        }
      }
    }
  };
  walk(root, 0);
  files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return { root, files, truncated };
}
