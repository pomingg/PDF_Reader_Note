import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.PDF_NOTES_DATA_DIR
  ? path.resolve(process.env.PDF_NOTES_DATA_DIR)
  : path.join(process.cwd(), "data");
export const PDF_DIR = path.join(DATA_DIR, "pdfs");
export const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");

/** The built-in project that holds documents not yet sorted anywhere. */
export const UNFILED_PROJECT_ID = "unfiled";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  icon        TEXT NOT NULL DEFAULT '📁',
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_project ON folders(project_id);

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  filename       TEXT NOT NULL,
  size           INTEGER NOT NULL DEFAULT 0,
  page_count     INTEGER,
  last_page      INTEGER NOT NULL DEFAULT 1,
  last_opened_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);

-- Highlights, area snapshots and free notes. Each anchored annotation keeps two
-- locators: normalised rects (0-1 of the page, zoom independent) and the quoted
-- text with surrounding context, so it can be re-found and searched later.
CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('highlight', 'area', 'note')),
  color       TEXT NOT NULL DEFAULT 'yellow',
  page        INTEGER,            -- first page; NULL = note on the whole document
  rects       TEXT NOT NULL DEFAULT '[]', -- JSON [{page,x,y,w,h}]
  quote       TEXT NOT NULL DEFAULT '',
  prefix      TEXT NOT NULL DEFAULT '',
  suffix      TEXT NOT NULL DEFAULT '',
  comment     TEXT NOT NULL DEFAULT '',  -- Markdown
  image       TEXT,               -- snapshot file name for area annotations
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_document ON annotations(document_id);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS annotation_tags (
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (annotation_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_annotation_tags_tag ON annotation_tags(tag_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __pdfNotesDb: Database.Database | undefined;
}

function open(): Database.Database {
  mkdirSync(PDF_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, name, color, icon, description, sort, is_system, created_at)
     VALUES (?, '未分類', '#94a3b8', '📥', '尚未歸類的文件', 9999, 1, ?)`,
  ).run(UNFILED_PROJECT_ID, Date.now());
  return db;
}

/** Single shared connection (survives Next.js dev hot reloads). */
export function db(): Database.Database {
  if (!globalThis.__pdfNotesDb) globalThis.__pdfNotesDb = open();
  return globalThis.__pdfNotesDb;
}
