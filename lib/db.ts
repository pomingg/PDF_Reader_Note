import { DatabaseSync, type SQLInputValue } from "node:sqlite";
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

-- Raw data received from reading apps (e.g. the HyRead browser extension), kept
-- for troubleshooting and for re-parsing when the parser improves.
CREATE TABLE IF NOT EXISTS integration_captures (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'response',
  page_title  TEXT NOT NULL DEFAULT '',
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'stored',  -- stored | parsed | unparsed | error
  detail      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
`;

/** A prepared statement. Rows come back as plain objects; callers cast them. */
export interface Statement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

/**
 * Thin wrapper over Node's built-in SQLite (node:sqlite), so nothing has to be
 * compiled during `npm install`. Same file format as any other SQLite library.
 */
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(statement: string): void;
  /** Wrap `fn` so it runs inside one transaction (nested calls join the outer one). */
  transaction<T>(fn: () => T): () => T;
}

function wrap(raw: DatabaseSync): Db {
  let depth = 0;
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        all: (...p) => stmt.all(...(p as SQLInputValue[])),
        get: (...p) => stmt.get(...(p as SQLInputValue[])),
        run: (...p) => stmt.run(...(p as SQLInputValue[])),
      };
    },
    exec: (sql) => raw.exec(sql),
    pragma: (statement) => raw.exec(`PRAGMA ${statement}`),
    transaction:
      (fn) =>
      () => {
        if (depth > 0) return fn();
        raw.exec("BEGIN IMMEDIATE");
        depth++;
        try {
          const result = fn();
          raw.exec("COMMIT");
          return result;
        } catch (err) {
          raw.exec("ROLLBACK");
          throw err;
        } finally {
          depth--;
        }
      },
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __pdfNotesDb: Db | undefined;
}

function open(): Db {
  mkdirSync(PDF_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const db = wrap(new DatabaseSync(path.join(DATA_DIR, "app.db")));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, name, color, icon, description, sort, is_system, created_at)
     VALUES (?, '未分類', '#94a3b8', '📥', '尚未歸類的文件', 9999, 1, ?)`,
  ).run(UNFILED_PROJECT_ID, Date.now());
  return db;
}

/** Columns added after the first release; added in place to existing databases. */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  // NULL = created here, 'pdf' = imported from annotations embedded in the PDF file
  ["annotations", "origin", "TEXT"],
  // de-duplication key for imported annotations
  ["annotations", "external_key", "TEXT"],
  // bumped whenever the PDF file is replaced (NULL = 1)
  ["documents", "file_version", "INTEGER"],
  // file_version whose embedded annotations were already imported (NULL = never)
  ["documents", "annots_scanned_version", "INTEGER"],
  // 'pdf' (NULL) or 'ebook' (a book read elsewhere, e.g. HyRead: notes only, no file)
  ["documents", "kind", "TEXT"],
  ["documents", "author", "TEXT"],
  // where an ebook comes from ('hyread', ...) and its id there
  ["documents", "source", "TEXT"],
  ["documents", "external_id", "TEXT"],
  // position inside an ebook (chapter / page / CFI), shown instead of a page number
  ["annotations", "location", "TEXT"],
  // 1 when the note was deleted in the source app (kept here, shown as removed)
  ["annotations", "external_removed", "INTEGER"],
  // last note text received from the source app, to tell whether the user edited it here since
  ["annotations", "external_note", "TEXT"],
];

function migrate(db: Db) {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_annotations_external ON annotations(document_id, external_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_external ON documents(source, external_id)`);
}

/** Single shared connection (survives Next.js dev hot reloads). */
export function db(): Db {
  if (!globalThis.__pdfNotesDb) globalThis.__pdfNotesDb = open();
  return globalThis.__pdfNotesDb;
}
