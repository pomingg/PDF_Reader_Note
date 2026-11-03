// Shapes shared by the API routes and the browser.

export interface Project {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  sort: number;
  isSystem: boolean;
  createdAt: number;
  documentCount: number;
  annotationCount: number;
  lastOpenedAt: number | null;
}

export interface Folder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  sort: number;
  documentCount: number;
}

export interface DocumentItem {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  size: number;
  pageCount: number | null;
  lastPage: number;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  annotationCount: number;
  /** Increases each time the PDF file is replaced. */
  fileVersion: number;
  /** True until annotations embedded in the current PDF file have been imported. */
  needsAnnotationScan: boolean;
}

export interface DocumentQuery {
  view?: "all" | "recent";
  projectId?: string;
  folderId?: string;
  /** Include documents in sub-folders of folderId (or the whole project when only projectId is set). */
  recursive?: boolean;
  q?: string;
}

/* ------------------------------------------------------------------ notes */

export type AnnotationType = "highlight" | "area" | "note";

/** A rectangle on one page, as fractions (0-1) of the page width / height. */
export interface NormRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation {
  id: string;
  documentId: string;
  type: AnnotationType;
  color: string;
  page: number | null;
  rects: NormRect[];
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  /** URL of the snapshot image for area annotations. */
  imageUrl: string | null;
  source: "user" | "ai";
  /** "pdf" when imported from annotations embedded in the PDF file. */
  origin: "pdf" | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface NewAnnotation {
  type: AnnotationType;
  color?: string;
  page?: number | null;
  rects?: NormRect[];
  quote?: string;
  prefix?: string;
  suffix?: string;
  comment?: string;
  tags?: string[];
  /** data:image/png;base64,... for area snapshots */
  image?: string;
}

/** An annotation found inside the PDF file, ready to import. */
export interface ImportedAnnotation extends NewAnnotation {
  /** Stable key so the same embedded annotation is never imported twice. */
  externalKey: string;
}

export interface ImportResult {
  created: Annotation[];
  skipped: number;
}

export interface Tag {
  id: string;
  name: string;
  count: number;
}

/** One of the highlighter colours and what it means to the reader. */
export interface ColorDef {
  key: string;
  hex: string;
  label: string;
}

export const DEFAULT_COLORS: ColorDef[] = [
  { key: "yellow", hex: "#facc15", label: "重點" },
  { key: "red", hex: "#f87171", label: "疑問" },
  { key: "green", hex: "#4ade80", label: "定義" },
  { key: "blue", hex: "#60a5fa", label: "例子" },
];
