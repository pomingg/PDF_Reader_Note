import { nanoid } from "nanoid";
import { db } from "./db";
import { getDocument, HttpError } from "./library";
import type { Bookmark } from "./types";

interface Row {
  id: string;
  document_id: string;
  page: number;
  title: string;
  created_at: number;
}
const toBookmark = (r: Row): Bookmark => ({ id: r.id, documentId: r.document_id, page: r.page, title: r.title, createdAt: r.created_at });

export function listBookmarks(documentId: string): Bookmark[] {
  getDocument(documentId);
  return (db().prepare(`SELECT * FROM bookmarks WHERE document_id = ? ORDER BY page, created_at`).all(documentId) as Row[]).map(toBookmark);
}

export function addBookmark(documentId: string, input: { page: number; title?: string }): Bookmark {
  getDocument(documentId);
  const page = Number(input.page);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, "頁碼不正確");
  const existing = db().prepare(`SELECT * FROM bookmarks WHERE document_id = ? AND page = ?`).get(documentId, page) as Row | undefined;
  if (existing) return toBookmark(existing);
  const id = nanoid(10);
  db()
    .prepare(`INSERT INTO bookmarks (id, document_id, page, title, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, documentId, page, String(input.title ?? "").trim().slice(0, 200), Date.now());
  return toBookmark(db().prepare(`SELECT * FROM bookmarks WHERE id = ?`).get(id) as Row);
}

export function renameBookmark(id: string, title: string): Bookmark {
  const r = db().prepare(`UPDATE bookmarks SET title = ? WHERE id = ?`).run(String(title ?? "").trim().slice(0, 200), id);
  if (!Number(r.changes)) throw new HttpError(404, "找不到書籤");
  return toBookmark(db().prepare(`SELECT * FROM bookmarks WHERE id = ?`).get(id) as Row);
}

export function deleteBookmark(id: string) {
  db().prepare(`DELETE FROM bookmarks WHERE id = ?`).run(id);
}
