import { unlinkSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, PDF_DIR, UNFILED_PROJECT_ID } from "./db";
import type { DocumentItem, DocumentQuery, Folder, Project } from "./types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/* ---------------------------------------------------------------- projects */

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  sort: number;
  is_system: number;
  created_at: number;
  document_count: number;
  annotation_count: number;
  last_opened_at: number | null;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  color: r.color,
  icon: r.icon,
  description: r.description,
  sort: r.sort,
  isSystem: !!r.is_system,
  createdAt: r.created_at,
  documentCount: r.document_count,
  annotationCount: r.annotation_count,
  lastOpenedAt: r.last_opened_at,
});

const PROJECT_SELECT = `
  SELECT p.*, COUNT(d.id) AS document_count, MAX(d.last_opened_at) AS last_opened_at,
    (SELECT COUNT(*) FROM annotations a JOIN documents d2 ON d2.id = a.document_id
     WHERE d2.project_id = p.id) AS annotation_count
  FROM projects p LEFT JOIN documents d ON d.project_id = p.id`;

export function listProjects(): Project[] {
  const rows = db()
    .prepare(`${PROJECT_SELECT} GROUP BY p.id ORDER BY p.sort, p.created_at`)
    .all() as ProjectRow[];
  return rows.map(toProject);
}

export function getProject(id: string): Project {
  const row = db().prepare(`${PROJECT_SELECT} WHERE p.id = ? GROUP BY p.id`).get(id) as
    | ProjectRow
    | undefined;
  if (!row) throw new HttpError(404, "找不到專案");
  return toProject(row);
}

export function createProject(input: {
  name: string;
  color?: string;
  icon?: string;
  description?: string;
}): Project {
  const name = input.name?.trim();
  if (!name) throw new HttpError(400, "專案名稱不可空白");
  const id = nanoid(10);
  const { m } = db()
    .prepare(`SELECT COALESCE(MAX(sort), 0) AS m FROM projects WHERE is_system = 0`)
    .get() as { m: number };
  db()
    .prepare(
      `INSERT INTO projects (id, name, color, icon, description, sort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      input.color ?? "#6366f1",
      input.icon ?? "📁",
      input.description ?? "",
      m + 1,
      Date.now(),
    );
  return getProject(id);
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "color" | "icon" | "description" | "sort">>,
): Project {
  const current = getProject(id);
  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  if (!name) throw new HttpError(400, "專案名稱不可空白");
  if (current.isSystem && patch.name !== undefined && name !== current.name)
    throw new HttpError(400, "系統專案不可改名");
  db()
    .prepare(
      `UPDATE projects SET name = ?, color = ?, icon = ?, description = ?, sort = ? WHERE id = ?`,
    )
    .run(
      name,
      patch.color ?? current.color,
      patch.icon ?? current.icon,
      patch.description ?? current.description,
      patch.sort ?? current.sort,
      id,
    );
  return getProject(id);
}

/** Deleting a project moves its documents to「未分類」rather than deleting them. */
export function deleteProject(id: string): void {
  const project = getProject(id);
  if (project.isSystem) throw new HttpError(400, "系統專案不可刪除");
  const tx = db().transaction(() => {
    db()
      .prepare(
        `UPDATE documents SET project_id = ?, folder_id = NULL, updated_at = ? WHERE project_id = ?`,
      )
      .run(UNFILED_PROJECT_ID, Date.now(), id);
    db().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  });
  tx();
}

/* ----------------------------------------------------------------- folders */

interface FolderRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  document_count: number;
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  projectId: r.project_id,
  parentId: r.parent_id,
  name: r.name,
  sort: r.sort,
  documentCount: r.document_count,
});

const FOLDER_SELECT = `
  SELECT f.*, (SELECT COUNT(*) FROM documents d WHERE d.folder_id = f.id) AS document_count
  FROM folders f`;

export function listFolders(projectId?: string): Folder[] {
  const rows = (
    projectId
      ? db().prepare(`${FOLDER_SELECT} WHERE f.project_id = ? ORDER BY f.sort, f.name`).all(projectId)
      : db().prepare(`${FOLDER_SELECT} ORDER BY f.sort, f.name`).all()
  ) as FolderRow[];
  return rows.map(toFolder);
}

export function getFolder(id: string): Folder {
  const row = db().prepare(`${FOLDER_SELECT} WHERE f.id = ?`).get(id) as FolderRow | undefined;
  if (!row) throw new HttpError(404, "找不到資料夾");
  return toFolder(row);
}

/** Ids of a folder and every folder nested under it. */
export function descendantFolderIds(folderId: string): string[] {
  const rows = db()
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id)
       SELECT id FROM tree`,
    )
    .all(folderId) as { id: string }[];
  return rows.map((r) => r.id);
}

function assertParent(projectId: string, parentId: string | null) {
  if (!parentId) return;
  const parent = getFolder(parentId);
  if (parent.projectId !== projectId) throw new HttpError(400, "上層資料夾不屬於此專案");
}

export function createFolder(input: {
  projectId: string;
  parentId?: string | null;
  name: string;
}): Folder {
  const name = input.name?.trim();
  if (!name) throw new HttpError(400, "資料夾名稱不可空白");
  getProject(input.projectId);
  const parentId = input.parentId || null;
  assertParent(input.projectId, parentId);
  const id = nanoid(10);
  db()
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(id, input.projectId, parentId, name, Date.now());
  return getFolder(id);
}

/**
 * Rename and/or move a folder. Moving to another project carries every
 * sub-folder and document inside it along.
 */
export function updateFolder(
  id: string,
  patch: { name?: string; parentId?: string | null; projectId?: string },
): Folder {
  const current = getFolder(id);
  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  if (!name) throw new HttpError(400, "資料夾名稱不可空白");

  const projectId = patch.projectId ?? current.projectId;
  let parentId = patch.parentId !== undefined ? patch.parentId || null : current.parentId;
  if (patch.projectId && patch.projectId !== current.projectId && patch.parentId === undefined)
    parentId = null;
  getProject(projectId);
  assertParent(projectId, parentId);

  const subtree = descendantFolderIds(id);
  if (parentId && subtree.includes(parentId))
    throw new HttpError(400, "不能把資料夾移到自己的子資料夾裡");

  const tx = db().transaction(() => {
    db()
      .prepare(`UPDATE folders SET name = ?, parent_id = ?, project_id = ? WHERE id = ?`)
      .run(name, parentId, projectId, id);
    if (projectId !== current.projectId) {
      const marks = subtree.map(() => "?").join(",");
      db().prepare(`UPDATE folders SET project_id = ? WHERE id IN (${marks})`).run(projectId, ...subtree);
      db()
        .prepare(`UPDATE documents SET project_id = ?, updated_at = ? WHERE folder_id IN (${marks})`)
        .run(projectId, Date.now(), ...subtree);
    }
  });
  tx();
  return getFolder(id);
}

/** Deleting a folder keeps its documents: they move up to the project root. */
export function deleteFolder(id: string): void {
  getFolder(id);
  const subtree = descendantFolderIds(id);
  const marks = subtree.map(() => "?").join(",");
  const tx = db().transaction(() => {
    db()
      .prepare(`UPDATE documents SET folder_id = NULL, updated_at = ? WHERE folder_id IN (${marks})`)
      .run(Date.now(), ...subtree);
    db().prepare(`DELETE FROM folders WHERE id = ?`).run(id);
  });
  tx();
}

/* --------------------------------------------------------------- documents */

interface DocumentRow {
  id: string;
  project_id: string;
  folder_id: string | null;
  title: string;
  filename: string;
  size: number;
  page_count: number | null;
  last_page: number;
  last_opened_at: number | null;
  created_at: number;
  updated_at: number;
  annotation_count: number;
}

/** Documents with their annotation count, usable like a table. */
const DOCS = `(SELECT d.*, (SELECT COUNT(*) FROM annotations a WHERE a.document_id = d.id) AS annotation_count
  FROM documents d)`;

const toDocument = (r: DocumentRow): DocumentItem => ({
  id: r.id,
  projectId: r.project_id,
  folderId: r.folder_id,
  title: r.title,
  size: r.size,
  pageCount: r.page_count,
  lastPage: r.last_page,
  lastOpenedAt: r.last_opened_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  annotationCount: r.annotation_count,
});

export function listDocuments(query: DocumentQuery): DocumentItem[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.folderId) {
    const ids = query.recursive ? descendantFolderIds(query.folderId) : [query.folderId];
    where.push(`folder_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  } else if (query.projectId) {
    where.push("project_id = ?");
    params.push(query.projectId);
    if (!query.recursive) where.push("folder_id IS NULL");
  }
  if (query.q?.trim()) {
    where.push("title LIKE ? ESCAPE '\\'");
    params.push(`%${query.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  }
  if (query.view === "recent") where.push("last_opened_at IS NOT NULL");

  const order =
    query.view === "recent" ? "last_opened_at DESC" : "COALESCE(last_opened_at, 0) DESC, created_at DESC";
  const limit = query.view === "recent" ? "LIMIT 50" : "";
  const sql = `SELECT * FROM ${DOCS} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} ${limit}`;
  return (db().prepare(sql).all(...params) as DocumentRow[]).map(toDocument);
}

function getDocumentRow(id: string): DocumentRow {
  const row = db().prepare(`SELECT * FROM ${DOCS} WHERE id = ?`).get(id) as DocumentRow | undefined;
  if (!row) throw new HttpError(404, "找不到文件");
  return row;
}

export const getDocument = (id: string): DocumentItem => toDocument(getDocumentRow(id));

export function documentFilePath(id: string): string {
  return path.join(PDF_DIR, getDocumentRow(id).filename);
}

/** Resolve where a document should live, validating the project/folder pair. */
function resolveLocation(projectId?: string | null, folderId?: string | null) {
  if (folderId) {
    const folder = getFolder(folderId);
    return { projectId: folder.projectId, folderId: folder.id };
  }
  const pid = projectId || UNFILED_PROJECT_ID;
  getProject(pid);
  return { projectId: pid, folderId: null };
}

export function createDocument(input: {
  title: string;
  filename: string;
  size: number;
  projectId?: string | null;
  folderId?: string | null;
  id: string;
}): DocumentItem {
  const loc = resolveLocation(input.projectId, input.folderId);
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO documents (id, project_id, folder_id, title, filename, size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, loc.projectId, loc.folderId, input.title, input.filename, input.size, now, now);
  return getDocument(input.id);
}

export function updateDocument(
  id: string,
  patch: {
    title?: string;
    projectId?: string;
    folderId?: string | null;
    pageCount?: number;
    lastPage?: number;
    opened?: boolean;
  },
): DocumentItem {
  const cur = getDocumentRow(id);
  const title = patch.title !== undefined ? patch.title.trim() : cur.title;
  if (!title) throw new HttpError(400, "文件名稱不可空白");

  let projectId = cur.project_id;
  let folderId = cur.folder_id;
  if (patch.projectId !== undefined || patch.folderId !== undefined) {
    const loc = resolveLocation(patch.projectId ?? (patch.folderId ? null : cur.project_id), patch.folderId ?? null);
    projectId = loc.projectId;
    folderId = loc.folderId;
  }
  const moved = projectId !== cur.project_id || folderId !== cur.folder_id || title !== cur.title;

  db()
    .prepare(
      `UPDATE documents SET title = ?, project_id = ?, folder_id = ?, page_count = ?, last_page = ?,
         last_opened_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      title,
      projectId,
      folderId,
      patch.pageCount ?? cur.page_count,
      patch.lastPage ?? cur.last_page,
      patch.opened ? Date.now() : cur.last_opened_at,
      moved ? Date.now() : cur.updated_at,
      id,
    );
  return getDocument(id);
}

export function deleteDocument(id: string): void {
  const file = documentFilePath(id);
  db().prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  try {
    unlinkSync(file);
  } catch {
    /* file already gone */
  }
}
