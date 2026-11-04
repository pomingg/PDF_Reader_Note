import { nanoid } from "nanoid";
import { colorKeyFromAny } from "./colors";
import { db, UNFILED_PROJECT_ID } from "./db";
import { getProject, HttpError } from "./library";
import { pruneTags } from "./notes";

/** A highlight or note from a reading app, already normalised. */
export interface EbookAnnotationInput {
  /** Id in the source app (stable across syncs). */
  externalId: string;
  quote?: string;
  note?: string;
  color?: unknown;
  location?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface EbookInput {
  source: string;
  /** Book id in the source app. */
  externalId: string;
  title?: string;
  author?: string;
  annotations: EbookAnnotationInput[];
  /**
   * True when `annotations` is the book's full list, so anything missing was
   * deleted in the source app. Partial captures (a single new highlight) leave the rest alone.
   */
  complete?: boolean;
}

export interface EbookSyncResult {
  documentId: string;
  bookCreated: boolean;
  created: number;
  updated: number;
  removed: number;
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** Project new books from a source go to (configurable on the sync page), default 未分類. */
export function defaultProjectFor(source: string): string {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(`${source}_project`) as
    | { value: string }
    | undefined;
  if (row?.value) {
    try {
      return getProject(row.value).id;
    } catch {
      /* project was deleted */
    }
  }
  return UNFILED_PROJECT_ID;
}

/** Create or update an ebook and its notes from a sync. Safe to call repeatedly with the same data. */
export function upsertEbook(input: EbookInput): EbookSyncResult {
  const source = clean(input.source, 40);
  const bookId = clean(String(input.externalId ?? ""), 200);
  if (!source || !bookId) throw new HttpError(400, "缺少書籍來源或編號");
  const d = db();
  const now = Date.now();
  const result: EbookSyncResult = { documentId: "", bookCreated: false, created: 0, updated: 0, removed: 0 };

  d.transaction(() => {
    let doc = d
      .prepare(`SELECT id, title, author FROM documents WHERE source = ? AND external_id = ?`)
      .get(source, bookId) as { id: string; title: string; author: string | null } | undefined;
    const title = clean(input.title, 300);
    const author = clean(input.author, 200);
    if (!doc) {
      const id = nanoid(12);
      d.prepare(
        `INSERT INTO documents (id, project_id, folder_id, title, filename, size, kind, author, source, external_id,
           created_at, updated_at)
         VALUES (?, ?, NULL, ?, '', 0, 'ebook', ?, ?, ?, ?, ?)`,
      ).run(id, defaultProjectFor(source), title || `未命名書籍（${bookId}）`, author || null, source, bookId, now, now);
      doc = { id, title, author };
      result.bookCreated = true;
    } else if ((title && /^未命名書籍/.test(doc.title)) || (author && !doc.author)) {
      // Fill in details we did not have the first time; never overwrite a title the user renamed.
      d.prepare(`UPDATE documents SET title = ?, author = COALESCE(author, ?), updated_at = ? WHERE id = ?`).run(
        title && /^未命名書籍/.test(doc.title) ? title : doc.title,
        author || null,
        now,
        doc.id,
      );
    }
    result.documentId = doc.id;

    type Row = { id: string; external_key: string; quote: string; comment: string; external_note: string | null; color: string; location: string | null; external_removed: number | null };
    const existing = new Map(
      (d.prepare(
        `SELECT id, external_key, quote, comment, external_note, color, location, external_removed FROM annotations
         WHERE document_id = ? AND origin = ?`,
      ).all(doc.id, source) as Row[]).map((r) => [r.external_key, r]),
    );
    const seen = new Set<string>();

    for (const a of input.annotations.slice(0, 5000)) {
      const ext = clean(String(a.externalId ?? ""), 200);
      const quote = clean(a.quote, 20000);
      const note = clean(a.note, 20000);
      if (!ext || (!quote && !note)) continue;
      const key = `${source}:${ext}`;
      seen.add(key);
      const color = colorKeyFromAny(a.color);
      const location = clean(a.location, 300) || null;
      const cur = existing.get(key);
      if (!cur) {
        d.prepare(
          `INSERT INTO annotations (id, document_id, type, color, page, rects, quote, prefix, suffix, comment, image, source,
             origin, external_key, external_note, location, external_removed, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, '[]', ?, '', '', ?, NULL, 'user', ?, ?, ?, ?, 0, ?, ?)`,
        ).run(nanoid(12), doc.id, quote ? "highlight" : "note", color, quote, note, source, key, note, location,
          Number(a.createdAt) || now, Number(a.updatedAt) || now);
        result.created++;
        continue;
      }
      // The user may have edited the note here: only take the app's new note if ours is untouched.
      const comment = cur.comment === (cur.external_note ?? "") ? note : cur.comment;
      const changed =
        cur.quote !== quote || cur.comment !== comment || cur.color !== color || (cur.location ?? null) !== location ||
        (cur.external_note ?? "") !== note || cur.external_removed;
      if (changed) {
        d.prepare(
          `UPDATE annotations SET quote = ?, comment = ?, external_note = ?, color = ?, location = ?, external_removed = 0,
             updated_at = ? WHERE id = ?`,
        ).run(quote, comment, note, color, location, now, cur.id);
        result.updated++;
      }
    }

    if (input.complete) {
      for (const [key, row] of existing) {
        if (!seen.has(key) && !row.external_removed) {
          d.prepare(`UPDATE annotations SET external_removed = 1, updated_at = ? WHERE id = ?`).run(now, row.id);
          result.removed++;
        }
      }
    }
    if (result.created || result.updated || result.removed) {
      d.prepare(`UPDATE documents SET updated_at = ? WHERE id = ?`).run(now, doc.id);
    }
  })();
  pruneTags();
  return result;
}
