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
}

export interface DocumentQuery {
  view?: "all" | "recent";
  projectId?: string;
  folderId?: string;
  /** Include documents in sub-folders of folderId (or the whole project when only projectId is set). */
  recursive?: boolean;
  q?: string;
}
