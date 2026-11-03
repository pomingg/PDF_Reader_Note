import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.PDF_NOTES_DATA_DIR
  ? path.resolve(process.env.PDF_NOTES_DATA_DIR)
  : path.join(process.cwd(), "data");
export const PDF_DIR = path.join(DATA_DIR, "pdfs");

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
`;

declare global {
  // eslint-disable-next-line no-var
  var __pdfNotesDb: Database.Database | undefined;
}

function open(): Database.Database {
  mkdirSync(PDF_DIR, { recursive: true });
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
