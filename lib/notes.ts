import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, SNAPSHOT_DIR } from "./db";
import { HttpError, getDocument } from "./library";
import { DEFAULT_COLORS, type Annotation, type ColorDef, type NewAnnotation, type NormRect, type Tag } from "./types";

interface AnnotationRow {
  id: string;
  document_id: string;
  type: Annotation["type"];
  color: string;
  page: number | null;
  rects: string;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  image: string | null;
  source: "user" | "ai";
  created_at: number;
  updated_at: number;
  tags: string | null;
}

const SELECT = `
  SELECT a.*, (SELECT json_group_array(t.name) FROM annotation_tags at JOIN tags t ON t.id = at.tag_id
               WHERE at.annotation_id = a.id) AS tags
  FROM annotations a`;

const toAnnotation = (r: AnnotationRow): Annotation => ({
  id: r.id,
  documentId: r.document_id,
  type: r.type,
  color: r.color,
  page: r.page,
  rects: JSON.parse(r.rects) as NormRect[],
  quote: r.quote,
  prefix: r.prefix,
  suffix: r.suffix,
  comment: r.comment,
  imageUrl: r.image ? `/api/annotations/${r.id}/image?v=${r.updated_at}` : null,
  source: r.source,
  tags: ((r.tags ? JSON.parse(r.tags) : []) as string[]).sort((a, b) => a.localeCompare(b)),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listAnnotations(documentId: string): Annotation[] {
  getDocument(documentId);
  const rows = db()
    .prepare(`${SELECT} WHERE a.document_id = ? ORDER BY COALESCE(a.page, 0), a.created_at`)
    .all(documentId) as AnnotationRow[];
  return rows.map(toAnnotation);
}

export function getAnnotation(id: string): Annotation {
  const row = db().prepare(`${SELECT} WHERE a.id = ?`).get(id) as AnnotationRow | undefined;
  if (!row) throw new HttpError(404, "找不到筆記");
  return toAnnotation(row);
}

function cleanRects(rects: unknown): NormRect[] {
  if (!Array.isArray(rects)) return [];
  const clamp = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
  return rects
    .filter((r) => r && Number.isInteger(r.page) && r.page > 0)
    .slice(0, 500)
    .map((r) => ({ page: r.page, x: clamp(r.x), y: clamp(r.y), w: clamp(r.w), h: clamp(r.h) }));
}

const cleanTags = (tags: unknown): string[] =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean))].slice(0, 30)
    : [];

function setTags(annotationId: string, names: string[]) {
  const d = db();
  d.prepare(`DELETE FROM annotation_tags WHERE annotation_id = ?`).run(annotationId);
  for (const name of names) {
    d.prepare(`INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)`).run(nanoid(10), name, Date.now());
    const { id } = d.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as { id: string };
    d.prepare(`INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) VALUES (?, ?)`).run(annotationId, id);
  }
}

function saveSnapshot(id: string, dataUrl: string): string {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "截圖格式錯誤");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(400, "截圖太大");
  const name = `${id}.${m[1] === "jpeg" ? "jpg" : "png"}`;
  writeFileSync(path.join(/*turbopackIgnore: true*/ SNAPSHOT_DIR, name), buf);
  return name;
}

export function createAnnotation(documentId: string, input: NewAnnotation): Annotation {
  getDocument(documentId);
  if (!["highlight", "area", "note"].includes(input.type)) throw new HttpError(400, "未知的筆記類型");
  const rects = cleanRects(input.rects);
  if (input.type !== "note" && !rects.length) throw new HttpError(400, "缺少標註位置");
  if (input.type === "highlight" && !input.quote?.trim()) throw new HttpError(400, "缺少選取文字");

  const id = nanoid(12);
  const now = Date.now();
  const page = input.type === "note" ? (input.page ?? null) : Math.min(...rects.map((r) => r.page));
  const image = input.type === "area" && input.image ? saveSnapshot(id, input.image) : null;

  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO annotations (id, document_id, type, color, page, rects, quote, prefix, suffix, comment, image,
           source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
      )
      .run(
        id,
        documentId,
        input.type,
        input.color || "yellow",
        page,
        JSON.stringify(rects),
        (input.quote ?? "").slice(0, 20000),
        (input.prefix ?? "").slice(0, 200),
        (input.suffix ?? "").slice(0, 200),
        input.comment ?? "",
        image,
        now,
        now,
      );
    setTags(id, cleanTags(input.tags));
  })();
  return getAnnotation(id);
}

export function updateAnnotation(
  id: string,
  patch: { color?: string; comment?: string; tags?: string[]; page?: number | null },
): Annotation {
  const cur = getAnnotation(id);
  db().transaction(() => {
    db()
      .prepare(`UPDATE annotations SET color = ?, comment = ?, page = ?, updated_at = ? WHERE id = ?`)
      .run(
        patch.color ?? cur.color,
        patch.comment ?? cur.comment,
        cur.type === "note" && patch.page !== undefined ? patch.page : cur.page,
        Date.now(),
        id,
      );
    if (patch.tags) setTags(id, cleanTags(patch.tags));
  })();
  return getAnnotation(id);
}

export function deleteAnnotation(id: string): void {
  const row = db().prepare(`SELECT image FROM annotations WHERE id = ?`).get(id) as { image: string | null } | undefined;
  if (!row) throw new HttpError(404, "找不到筆記");
  db().prepare(`DELETE FROM annotations WHERE id = ?`).run(id);
  removeSnapshot(row.image);
  pruneTags();
}

export function snapshotPath(id: string): string {
  const row = db().prepare(`SELECT image FROM annotations WHERE id = ?`).get(id) as { image: string | null } | undefined;
  if (!row?.image) throw new HttpError(404, "沒有截圖");
  return path.join(SNAPSHOT_DIR, row.image);
}

function removeSnapshot(name: string | null) {
  if (!name) return;
  try {
    unlinkSync(path.join(SNAPSHOT_DIR, name));
  } catch {
    /* already gone */
  }
}

/** Snapshot files of a document's annotations (removed when the document is deleted). */
export function documentSnapshots(documentId: string): string[] {
  return (
    db().prepare(`SELECT image FROM annotations WHERE document_id = ? AND image IS NOT NULL`).all(documentId) as {
      image: string;
    }[]
  ).map((r) => r.image);
}
export const removeSnapshots = (names: string[]) => names.forEach(removeSnapshot);

/** Drop tags no annotation uses any more. */
export function pruneTags() {
  db().prepare(`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM annotation_tags)`).run();
}

export function listTags(): Tag[] {
  return db()
    .prepare(
      `SELECT t.id, t.name, COUNT(at.annotation_id) AS count FROM tags t
       LEFT JOIN annotation_tags at ON at.tag_id = t.id GROUP BY t.id ORDER BY count DESC, t.name`,
    )
    .all() as Tag[];
}

/* --------------------------------------------------------------- settings */

export function getColors(): ColorDef[] {
  const row = db().prepare(`SELECT value FROM settings WHERE key = 'colors'`).get() as { value: string } | undefined;
  if (!row) return DEFAULT_COLORS;
  try {
    const saved = JSON.parse(row.value) as ColorDef[];
    return DEFAULT_COLORS.map((d) => ({ ...d, ...saved.find((s) => s.key === d.key), key: d.key }));
  } catch {
    return DEFAULT_COLORS;
  }
}

export function setColors(colors: ColorDef[]): ColorDef[] {
  const merged = DEFAULT_COLORS.map((d) => {
    const c = colors.find((x) => x.key === d.key);
    return {
      key: d.key,
      hex: c && /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : d.hex,
      label: c?.label?.trim().slice(0, 20) || d.label,
    };
  });
  db()
    .prepare(`INSERT INTO settings (key, value) VALUES ('colors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(JSON.stringify(merged));
  return merged;
}
